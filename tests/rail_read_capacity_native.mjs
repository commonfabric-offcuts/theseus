import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, appendFile, writeFile, copyFile, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadavg} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {fixtureControl} from './fixture_control.mjs';

const [source, output, baseline, ...alternatives] = process.argv.slice(2);
assert.ok(source && output && baseline, 'usage: measure.mjs SOURCE OUTPUT BASELINE [VARIANT=WEB ...]');
const variants = Object.fromEntries([[baseline, resolve(source, 'web')], ...alternatives.map(argument => {
  const split = argument.indexOf('=');
  assert.ok(split > 0, 'name and web directory are required for each alternate');
  return [argument.slice(0, split), resolve(argument.slice(split + 1))];
})]);
const sizes = (process.env.AIM_RAIL_SIZES ?? '100,30000').split(',').map(Number);
const clients = (process.env.AIM_RAIL_CLIENTS ?? '2,3').split(',').map(Number);
const repeats = Number(process.env.AIM_RAIL_REPEATS ?? '6');
const slow = Number(process.env.AIM_RAIL_DELAY_MS ?? '0');
const stimuli = (process.env.AIM_RAIL_STIMULI ?? 'feed,link').split(',');
const paintWaitMs = Number(process.env.AIM_RAIL_PAINT_WAIT_MS ?? '2500');
const recoverDim = process.env.AIM_RAIL_RECOVERY === '1';
const verifyPassive = process.env.AIM_RAIL_PASSIVE_PROOF === '1';
const {chromium} = await import(process.env.AIM_PLAYWRIGHT_CORE);
const notice = '#things > .notice';
await mkdir(output, {recursive: false});
await copyFile(new URL(import.meta.url), resolve(output, 'producer.mjs'));
await copyFile(new URL('./fixtures/rail_read_capacity.py', import.meta.url), resolve(output, 'producer-fixture.py'));

function counter(items, key) {
  const counts = {};
  for (const item of items) {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

async function until(check, words, timeout = 15000) {
  const end = performance.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (performance.now() >= end) throw Error(words);
    await sleep(30);
  }
}

async function observe(page, context) {
  const cdp = await context.newCDPSession(page);
  const requests = new Map(), pending = new Set(), captures = new Set();
  const wall = () => performance.timeOrigin + performance.now();
  const stackIncludes = (stack, find) => {
    for (let next = stack; next; next = next.parent) {
      if (next.callFrames.some(frame => find(frame.url.split('/').at(-1)))) return true;
    }
    return false;
  };
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setAsyncCallStackDepth', {maxDepth: 24});
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', event => {
    if (new URL(event.request.url).pathname !== '/api/view') return;
    const {name, args} = JSON.parse(event.request.postData);
    const rail = stackIncludes(event.initiator?.stack, file => ['things-rail.mjs', 'workspace-links.mjs'].includes(file));
    const readClass = Object.entries(event.request.headers)
      .find(([header]) => header.toLowerCase() === 'x-aim-read-class')?.[1] ?? 'foreground';
    requests.set(event.requestId, {name, args, readClass, rail, started: wall()});
    pending.add(event.requestId);
  });
  cdp.on('Network.responseReceived', event => {
    const row = requests.get(event.requestId);
    if (row) row.status = event.response.status;
  });
  cdp.on('Network.loadingFailed', event => {
    const row = requests.get(event.requestId);
    if (row) row.transportError = event.errorText;
    pending.delete(event.requestId);
  });
  cdp.on('Network.loadingFinished', event => {
    const row = requests.get(event.requestId);
    if (!row) return;
    pending.delete(event.requestId);
    row.finished = wall();
    if (row.status !== 503) return;
    const capture = cdp.send('Network.getResponseBody', {requestId: event.requestId})
      .then(({body}) => {
        const parsed = JSON.parse(body);
        row.error = parsed.error?.code;
        row.errorMessage = parsed.error?.message;
        row.recorded = parsed.recorded;
      })
      .catch(error => { row.captureError = error.message; });
    captures.add(capture);
    capture.finally(() => captures.delete(capture));
  });
  function clear() {
    assert.equal(pending.size + captures.size, 0, 'the preceding requests settled');
    requests.clear();
  }
  return {requests, pending, captures, clear};
}

async function livePage(browser, origin) {
  const context = await browser.newContext({viewport: {width: 1440, height: 930}, reducedMotion: 'reduce'});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8500);
    const traffic = await observe(page, context);
    let frame;
    const ready = new Promise(resolve => { frame = resolve; });
    page.on('websocket', ws => ws.on('framereceived', frame));
    // The fixture's test links have no outside network dependency.
    await page.route('https://example.invalid/**', route => route.abort());
    // One command is the stimulus. Seen reports are isolated from its commit window.
    await page.route('**/api/command', route => route.request().postDataJSON()?.kind === 'topic.read_through'
      ? route.fulfill({status: 503, body: '{}'}) : route.continue());
    await page.goto(origin + '/?topic=target');
    await page.locator('body[data-ready=true]').waitFor();
    await page.locator('#things .things-sections:not([aria-busy])').waitFor({state: 'attached'});
    await Promise.race([ready, sleep(7000, null, {ref: false}).then(() => { throw Error('No real commit-stream frame'); })]);
    let retries = 0;
    for (;;) {
      // A successful retry and a refused retry both settle their requests.
      // Wait for that boundary so a second refusal gets its own retry.
      await settle([{traffic}]);
      if (!(await page.locator(notice).isVisible())) break;
      assert.ok(++retries <= 6, 'initial rail reaches a complete state');
      await page.locator('#things').getByRole('button', {name: 'Try again', exact: true}).click();
    }
    const links = page.locator('#things details[data-key=previews]');
    await links.waitFor();
    if (await links.getAttribute('open') === null) await links.locator('summary button').first().click();
    await page.locator('#things a[href="https://example.invalid/saved/warm"]').waitFor();
    await page.evaluate(async () => {
      const {ThingsRail, SECTIONS} = await import('/things-rail.mjs');
      const expected = SECTIONS.map(([key]) => key);
      const painted = ThingsRail.prototype.paint;
      ThingsRail.prototype.paint = function (found) {
        const before = new Map([...this.sections].map(([key, part]) => [key, part.drawn]));
        const result = painted.call(this, found);
        const watching = window.measureRail;
        if (!watching) return result;
        const place = found.messages.length > 0;
        const checked = {
          notebook: found.notebook !== undefined, prs: place, images: place,
          waiting: found.pipeline !== undefined, previews: place && found.links !== undefined,
          tools: found.tools !== undefined, pipeline: found.pipeline !== undefined,
        };
        const filled = expected.filter(key => {
          const part = this.sections.get(key);
          return checked[key] && !part.details.hidden && part.details.open && part.body.childElementCount;
        }).map(key => {
          const part = this.sections.get(key);
          const box = part.details.getBoundingClientRect();
          return {key, changed: before.get(key) !== part.drawn, inViewport: box.bottom > 0 && box.top < innerHeight};
        });
        const previews = this.sections.get('previews').body;
        const hasLink = [...previews.querySelectorAll('a')].some(anchor => anchor.href === watching.link);
        requestAnimationFrame(() => {
          if (window.measureRail !== watching) return;
          const at = performance.timeOrigin + performance.now();
          for (const part of filled) {
            if (part.key === 'previews' && !hasLink) continue;
            watching.sections[part.key] ??= {...part, at};
          }
          if (expected.every(key => watching.sections[key])) watching.finishRail(true);
        });
        return result;
      };
      window.railExpected = expected;
    });
    await page.waitForFunction(() => window.railExpected.every(key => {
      const part = document.querySelector('#things details[data-key="' + key + '"]');
      return part && !part.hidden && part.open && part.querySelector('.things-body').childElementCount > 0;
    }), null, {timeout: 8000});
    return {context, page, traffic, retries};
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function settle(pages) {
  let seen = -1, changed = performance.now();
  const requestCount = () => pages.reduce((n, entry) => n + entry.traffic.requests.size, 0);
  await until(() => {
    const total = requestCount();
    if (total !== seen || pages.some(entry => entry.traffic.pending.size || entry.traffic.captures.size)) {
      changed = performance.now(); seen = total;
    }
    return performance.now() - changed >= 300;
  }, 'browser traffic failed to settle');
}

async function watch(page, label, link, primary) {
  await page.evaluate(({label, link, notice, primary}) => {
    const feed = document.querySelector('#messages');
    const links = document.querySelector('#things-previews-body');
    const status = document.querySelector(notice);
    const paints = {}, scheduled = new Set(), notices = [];
    const stamp = () => performance.timeOrigin + performance.now();
    let finish, finishRail;
    const done = new Promise(resolve => { finish = resolve; });
    const railDone = new Promise(resolve => { finishRail = resolve; });
    const record = (name, shows) => {
      if (!shows || scheduled.has(name)) return;
      scheduled.add(name);
      requestAnimationFrame(() => {
        paints[name] = stamp();
        if (name === primary) finish(true);
      });
    };
    const reader = new MutationObserver(() => {
      record('feed', feed.textContent.includes(label));
      record('links', [...links.querySelectorAll('a')].some(anchor => anchor.href === link && anchor.getClientRects().length));
    });
    const changes = new MutationObserver(() => { notices.push({at: stamp(), hidden: status.hidden, words: status.textContent}); });
    reader.observe(feed, {subtree: true, childList: true, characterData: true});
    reader.observe(links, {subtree: true, childList: true, characterData: true});
    changes.observe(status, {attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true});
    window.measureRail = {link, paints, notices, reader, changes, done, railDone, finishRail, sections: {}};
  }, {label, link, notice, primary});
}

const code = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const owners = ['things-rail.mjs', 'workspace-links.mjs', 'rail-read-order.mjs', 'api.mjs'];
const webHashes = Object.fromEntries(await Promise.all(Object.entries(variants).map(async ([id, web]) => [id,
  Object.fromEntries(await Promise.all(owners.map(async owner =>
    [owner, createHash('sha256').update(await readFile(resolve(web, owner))).digest('hex')])))])));
const browser = await chromium.launch({executablePath: process.env.AIM_CHROME});
const metadata = {code, variants, sizes, clients, repeats, slow, stimuli, paintWaitMs, recoverDim, verifyPassive,
  webHashes, loadAtStart: loadavg(), browser: browser.version()};
await writeFile(resolve(output, 'run.json'), JSON.stringify(metadata, null, 2) + '\n');

async function trial({pages, control, size, count, repeat, variant, stimulus}) {
  await settle(pages);
  for (const page of pages) page.traffic.clear();
  const run = [variant, size, count, repeat, stimulus].join('-');
  const label = 'Rail concurrency ' + run;
  const link = 'https://example.invalid/' + (stimulus === 'link' ? 'saved/' : 'previews/') + run;
  const primary = stimulus === 'feed' ? 'feed' : 'links';
  await Promise.all(pages.map(({page}) => watch(page, label, link, primary)));
  await control({method: 'read_delay', variant, ms: slow, read_class: 'foreground'});
  const before = await control({method: 'admission_events', variant, after: Number.MAX_SAFE_INTEGER});
  const beforeCommitLoad = loadavg();
  const commit = await control({method: stimulus, label, run});
  await until(() => pages.some(entry => entry.traffic.requests.size > 0), 'no measured requests after actual commit');
  const painted = await Promise.all(pages.map(({page}) => page.evaluate(async ms => {
    let timeout;
    const deadline = new Promise(resolve => {
      timeout = setTimeout(() => resolve(false), ms);
    });
    try {
      const [primary, rail] = await Promise.all([
        Promise.race([window.measureRail.done, deadline]),
        Promise.race([window.measureRail.railDone, deadline])
      ]);
      return {primary, rail};
    } finally { clearTimeout(timeout); }
  }, paintWaitMs)));
  await settle(pages);
  const {events, fatal} = await control({method: 'admission_events', variant, after: before.next});
  assert.deepEqual(fatal, []);
  await control({method: 'read_delay', variant, ms: 0});
  const receipts = await Promise.all(pages.map(async ({page, traffic, retries}, index) => {
    const paint = await page.evaluate(() => {
      const {paints, notices, reader, changes, sections} = window.measureRail;
      reader.disconnect(); changes.disconnect();
      window.measureRail = null;
      return {paints, notices, sections, expected: window.railExpected};
    });
    const requests = [...traffic.requests.values()];
    assert.ok(requests.every(row => !row.captureError), 'retained every observed 503 response body');
    const sections = Object.fromEntries(Object.entries(paint.sections).map(([key, {at, ...part}]) => [key,
      {...part, ms: Math.round(at - commit.committed_at_ms)}]));
    const filled = paint.expected.every(key => sections[key]);
    return {client: index + 1, retries, primaryPaintedInWindow: painted[index].primary,
      railPaintedInWindow: painted[index].rail, notice: await page.locator(notice).isVisible(),
      notices: paint.notices,
      commitToPaint: Object.fromEntries(Object.entries(paint.paints)
        .map(([surface, at]) => [surface, Math.round(at - commit.committed_at_ms)])),
      sections, expectedSections: paint.expected,
      lastSectionMs: filled ? Math.max(...Object.values(sections).map(part => part.ms)) : null,
      refusals: counter(requests.filter(row => row.status === 503), row => row.name),
      requests};
  }));
  const queue = events.filter(event => event.lanes);
  const maximumWaiting = Object.fromEntries(['foreground', 'background'].map(lane =>
    [lane, Math.max(0, ...queue.map(event => event.lanes[lane].waiting))]));
  const refused = queue.filter(event => ['full', 'expired', 'withdrawn'].includes(event.event));
  const refusalReasons = counter(refused, event => event.read_class + '/' + event.event);
  const admissionByView = counter(refused, event => (event.view ?? 'other endpoint') + '/' + event.read_class + '/' + event.event);
  const refusedConnections = events.filter(event => event.event === 'connection-full').length;
  const record = {run, variant, count, size, repeat, stimulus, commit, receipts, maximumWaiting, refusalReasons, refusedConnections,
    admissionByView, beforeCommitLoad, settledLoad: loadavg(), events};
  await appendFile(resolve(output, 'observations.jsonl'), JSON.stringify(record) + '\n');
  const railRefusals = receipts.reduce((n, client) => n + client.requests.filter(row => row.rail && row.status === 503).length, 0);
  console.log(JSON.stringify({run, maximumWaiting, refusalReasons, railRefusals, painted, load: beforeCommitLoad[0]}));
}

async function dimRecovery({pages, control, size, count, repeat, variant}) {
  await settle(pages);
  for (const entry of pages) entry.traffic.clear();
  await Promise.all(pages.map(({page}) => page.evaluate(() => {
    const foot = document.querySelector('#rail .rail-foot');
    const changes = [];
    let current = foot.querySelector('button[data-dim-set][aria-pressed=true]')?.dataset.dimSet;
    const observer = new MutationObserver(() => {
      const next = foot.querySelector('button[data-dim-set][aria-pressed=true]')?.dataset.dimSet;
      if (!next || next === current) return;
      current = next;
      requestAnimationFrame(() => changes.push({value: next, at: performance.timeOrigin + performance.now()}));
    });
    observer.observe(foot, {attributes: true, attributeFilter: ['aria-pressed'], childList: true, subtree: true});
    window.measureDim = {changes, observer};
  })));
  await control({method: 'read_fault', variant, name: 'rail_dimming', read_class: 'background', count: 1,
    status: 503, body: {error: {code: 'SERVER_BUSY', message: 'This read could not enter its bounded lane.', retryable: true}}});
  const commit = await control({method: 'dim'});
  await Promise.all(pages.map(({page}) => page.waitForFunction(value =>
    window.measureDim.changes.some(row => row.value === String(value)) &&
      !document.querySelector('#rail .rail-dim-retry'), commit.selected, {timeout: 7000})));
  await settle(pages);
  assert.deepEqual(await control({method: 'read_fault_clear', variant}), {withdrawn: 0}, 'the planned refusal reached a reader');
  const recovered = await Promise.all(pages.map(async ({page, traffic}, index) => {
    const reads = [...traffic.requests.values()].filter(row => row.name === 'rail_dimming');
    const state = await page.evaluate(value => {
      window.measureDim.observer.disconnect();
      const at = window.measureDim.changes.find(row => row.value === String(value)).at;
      return {at, dimmed: document.querySelector('#outline .ol-outcome[data-workspace-id=w]')?.dataset.dimmed};
    }, commit.selected);
    assert.equal(state.dimmed, 'true', 'the confirmed choice dims the actual outline');
    const refused = reads.filter(row => row.error === 'SERVER_BUSY');
    if (refused.length) {
      assert.ok(refused.every(row => row.readClass === 'background'));
      assert.ok(reads.some(row => row.status === 200 && row.started >= refused[0].finished), 'a refused Dim read retried successfully');
    }
    return {client: index + 1, reads, state, catchUpMs: refused.length ? Math.round(state.at - refused[0].finished) : null};
  }));
  assert.ok(recovered.some(row => Number.isFinite(row.catchUpMs)), 'observe a refused reader through its rendered recovery');
  await appendFile(resolve(output, 'dim-recovery.jsonl'), JSON.stringify({variant, size, count, repeat, commit, recovered}) + '\n');
  console.log(JSON.stringify({variant, size, count, repeat, catchUpMs: recovered.map(row => row.catchUpMs)}));
}

try {
  for (const size of sizes) {
    const fixture = spawn('/usr/bin/python3', ['-I', '-B', new URL('./fixtures/rail_read_capacity.py', import.meta.url).pathname,
      resolve(source), resolve(output, 'instance-' + size), String(size),
      ...Object.entries(variants).map(([label, web]) => label + '=' + web)]);
    const {control, exit, errors} = fixtureControl(fixture);
    try {
      const servers = await control({method: 'ready'});
      await writeFile(resolve(output, 'capacity-' + size + '.json'), JSON.stringify(
        Object.fromEntries(Object.entries(servers).map(([label, value]) => [label, value.capability])), null, 2) + '\n');
      for (const count of clients) {
        for (let repeat = 1; repeat <= repeats; repeat++) {
          const names = Object.keys(variants);
          const order = repeat % 2 ? names : names.reverse();
          for (const variant of order) {
            const pages = [];
            try {
              // Only one variant has page clients connected during its commit.
              for (let i = 0; i < count; i++) pages.push(await livePage(browser, servers[variant].origin));
              if (recoverDim) await dimRecovery({pages, control, size, count, repeat, variant});
              else for (const stimulus of stimuli) {
                await trial({pages, control, size, count, repeat, variant, stimulus});
              }
            } finally {
              await Promise.all(pages.map(({context}) => context.close()));
            }
          }
        }
      }
      if (verifyPassive && !recoverDim) {
        const count = Math.max(...clients);
        for (const variant of Object.keys(variants)) {
          const pages = [];
          try {
            for (let i = 0; i < count; i++) pages.push(await livePage(browser, servers[variant].origin));
            for (let repeat = 1; repeat <= 3; repeat++) await dimRecovery({pages, control, size, count, repeat, variant});
          } finally {
            await Promise.all(pages.map(({context}) => context.close()));
          }
        }
      }
    } finally {
      fixture.stdin.end();
      assert.deepEqual(await exit, {code: 0, signal: null}, errors());
      assert.equal(errors(), '');
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, 'cleanup.json'), JSON.stringify({browserClosed: !browser.isConnected()}) + '\n');
}
