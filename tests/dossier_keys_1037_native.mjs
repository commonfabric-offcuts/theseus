//1037 real scratch Core/HTTP: three dossiers, native reorder/archive/Undo and retained key inputs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_BROWSER ?? 'chromium', out = process.argv[2];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ["web/stack-feed.mjs", "web/pane-keys.mjs", "web/stack-menu-items.mjs", "web/interaction-guide.mjs", "web/reply-stacks.mjs", "web/stack-order.mjs", "web/card-reading.mjs", "web/message-menu.mjs", "web/card-replies.mjs", "web/reveal.mjs", "web/rails.mjs", "web/outline-rail.mjs", "web/things-rail.mjs", "web/archive-shelf.mjs", "web/api.mjs", "web/aim.css", "web/stack-look.css", "web/rails.css", "web/index.html", "tests/fixtures/ui_http.py", "tests/fixture_control.mjs", "tests/ui_dossier_keys_1037.test.mjs", "tests/dossier_keys_1037_native.mjs"];
await mkdir(out, { recursive: true });
const hashes = {};
for (const path of files) {
  const bytes = await readFile(path); hashes[path] = sha(bytes);
  await mkdir(out + '/source-bytes/' + (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''), { recursive: true });
  await writeFile(out + '/source-bytes/' + path, bytes);
}
await writeFile(out + '/source.json', JSON.stringify({
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes,
}, null, 2));
const load = () => Number(execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).match(/load averages?:\s*([0-9.]+)/)?.[1]);
assert.ok(load() < 12, 'one owned workload, load below12/18');
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit, errors } = fixtureControl(fixture);
const rows = [], cleanup = {}, owned = new Set(), fixtureOwned = new Set([fixture.pid]);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  .split('\n').flatMap(line => { const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return m ? [{ pid: +m[1], ppid: +m[2], command: m[3] }] : []; });
let browser, profile, origin, version, failure;
const resources = async phase => writeFile(out + '/resource-checkpoint.json', JSON.stringify({
  phase, fixturePid: fixture.pid, fixtureOwned: [...fixtureOwned], owned: [...owned], profile, origin,
}, null, 2));
function retain() {
  const list = ps();
  for (const set of [owned, fixtureOwned]) for (let changed = true; changed;) {
    changed = false;
    for (const p of list) if ((set.has(p.ppid) || set === owned && profile && p.command.includes(profile)) && !set.has(p.pid)) {
      set.add(p.pid); changed = true;
    }
  }
}
const portClosed = address => new Promise(resolve => {
  const u = new URL(address), socket = net.createConnection({ host: u.hostname, port: +u.port });
  socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
});
try {
  await resources('fixture spawned');
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  await resources('fixture ready');
  profile = await mkdtemp(out + '/' + engine + '-profile-');
  await resources('profile created before browser launch');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); assert.ok(owned.size);
  await resources('browser launched');
  await writeFile(out + '/launch-processes.json', JSON.stringify(ps().filter(p => owned.has(p.pid)), null, 2));
  for (const action of ['down', 'up', 'archive-root', 'archive-child', 'return', 'negative']) {
    assert.ok(load() < 12);
    const topic = 'keys1037-' + action, roots = [], children = [];
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Dossier keys ' + action }] });
    for (let n = 0; n < 3; n++) {
      const root = await control({ method: 'agent_message', operation_id: topic + '-root-' + n,
        topic_id: topic, source: 'topic', join: n === 0, member: n === 0, read: true,
        addressees: [facts.actor], divergence_reason: 'Separate keyboard fixture dossier ' + n,
        body: 'Dossier ' + n + ' for the actual ' + action + ' keyboard act.' });
      assert.equal(root.status, 'committed'); roots.push(root.result.message_id);
      const child = await control({ method: 'agent_message', operation_id: topic + '-child-' + n,
        topic_id: topic, reply_to: roots[n], read: true, addressees: [facts.actor],
        reply_without_quote: 'Isolated child keyboard selection.', body: 'Child ' + n + ' keeps its containing dossier.' });
      assert.equal(child.status, 'committed'); children.push(child.result.message_id);
    }
    const row = { key: action, topic, roots, children, checks: [], observations: [], errors: [], served: {}, executed: {}, captureErrors: [] }; rows.push(row);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    await context.addInitScript(() => {
      window.key1037Inputs = []; window.key1037Writes = []; window.key1037Pending = 0;
      for (const type of ['keydown', 'click', 'wheel']) addEventListener(type, e => {
        const row = { type, key: e.key, meta: e.metaKey, alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey,
          trusted: e.isTrusted, target: e.target.tagName, message: e.target.closest?.('[data-id]')?.dataset.id,
          dossier: e.target.closest?.('.reply-stack')?.dataset.stack };
        key1037Inputs.push(row); queueMicrotask(() => row.defaultPrevented = e.defaultPrevented);
      }, true);
      const fetchOf = window.fetch;
      window.fetch = (input, init) => {
        let request; try { request = JSON.parse(init?.body); } catch {}
        key1037Pending++;
        const answer = fetchOf.call(window, input, init);
        const watched = request?.kind ? answer.then(r => r.clone().json()).then(
          receipt => key1037Writes.push({ request, receipt }), error => key1037Writes.push({ request, error: String(error) }))
          : answer.then(() => {}, () => {});
        watched.finally(() => key1037Pending--);
        return answer;
      };
    });
    const page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', e => row.errors.push(e.stack));
    const captures = [];
    page.on('response', response => {
      const path = files.find(f => f.startsWith('web/') && f !== 'web/index.html' && new URL(response.url()).pathname.endsWith('/' + f.split('/').at(-1)));
      if (!path) return;
      captures.push((async () => {
        const bytes = await response.body(), digest = sha(bytes); assert.equal(digest, hashes[path]);
        await mkdir(out + '/executed-bodies', { recursive: true }); await writeFile(out + '/executed-bodies/' + digest, bytes);
        row.executed[path] = { sha256: digest, url: response.url(), status: response.status() };
      })().catch(e => row.captureErrors.push(e.stack)));
    });
    const check = (name, fn) => { try { fn(); row.checks.push({ name, passed: true }); } catch (e) { row.checks.push({ name, passed: false, error: e.stack }); } };
    const truth = () => control({ method: 'agent_view', actor: facts.actor, name: 'stack_positions', args: { topic_id: topic, message_ids: [...roots, ...children] } });
    const position = (answer, id) => answer.items.find(x => x.message_id === id).stack_position;
    const snapshot = phase => page.evaluate(({ roots, children, phase }) => {
      const shown = e => !!e?.getClientRects().length && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
      return { phase, order: [...document.querySelectorAll('#messages .reply-stack')].filter(e => roots.includes(e.dataset.stack) && shown(e)).map(e => e.dataset.stack),
        archived: [...document.querySelectorAll('.shelf-dossier')].map(e => e.dataset.id).filter(id => roots.includes(id)),
        active: { tag: document.activeElement.tagName, message: document.activeElement.closest('[data-id]')?.dataset.id,
          dossier: document.activeElement.closest('.reply-stack')?.dataset.stack, shelf: document.activeElement.closest('.shelf-dossier')?.dataset.id },
        childReply: Boolean(document.querySelector(`#messages [data-id="${children[1]}"][data-card-reply] .card-reply-composer`)?.getClientRects().length),
        inputs: key1037Inputs, writes: key1037Writes };
    }, { roots, children, phase });
    const record = async phase => { const s = await snapshot(phase); row.observations.push(s); return s; };
    const mutationsMade = () => page.evaluate(() => key1037Writes.filter(x => ['stack.place', 'stack.aside', 'stack.join'].includes(x.request.kind)).length);
    // loadState(networkidle) may already hold before a key schedules its
    // queued command. Observe the real event turn, outstanding requests and
    // captured command receipts instead of sampling optimistic paint as Core.
    const settledKey = async () => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => key1037Pending === 0);
    };
    const toggle = `#messages .reply-stack[data-stack="${roots[1]}"] > .stack-toggle`;
    const selectRoot = async () => {
      await page.mouse.move(2, 2); await page.locator(toggle).hover();
      await page.waitForFunction(sel => document.activeElement === document.querySelector(sel), toggle);
    };
    const selectChild = async () => {
      if (await page.locator(toggle).getAttribute('data-state') !== 'open') await page.locator(toggle).click();
      await page.mouse.move(2, 2); await page.locator(`#messages [data-id="${children[1]}"] > .message-preview`).hover();
      await page.waitForFunction(id => document.activeElement === document.querySelector(`#messages .message-card[data-id="${id}"]`), children[1]);
    };
    try {
      await page.goto(origin + '/?topic=' + topic); await page.locator('body[data-ready=true]').waitFor();
      await page.waitForFunction(ids => ids.every(id => document.querySelector(`#messages .reply-stack[data-stack="${id}"]`)), roots);
      await page.waitForLoadState('networkidle'); await Promise.all(captures); assert.deepEqual(row.captureErrors, []);
      for (const path of ['web/stack-feed.mjs', 'web/pane-keys.mjs', 'web/stack-menu-items.mjs', 'web/interaction-guide.mjs']) assert.equal(row.executed[path]?.sha256, hashes[path], 'original loaded changed owner ' + path);
      for (const [path, meta] of Object.entries(row.executed)) {
        const bytes = await (await page.request.get(meta.url)).body(); assert.equal(sha(bytes), hashes[path]); row.served[path] = sha(bytes);
        await mkdir(out + '/served-bodies', { recursive: true }); await writeFile(out + '/served-bodies/' + sha(bytes), bytes);
      }
      row.beforeCore = await truth(); const before = await record('before selection'); assert.equal(before.order.length, 3);
      if (action === 'negative') {
        await page.keyboard.press('Meta+ArrowRight'); await settledKey();
        const noSelection = await record('no selection');
        check('no selection emits no dossier mutation', () => assert.equal(noSelection.writes.filter(x => x.request.kind.startsWith('stack.')).length, 0));
        const field = page.locator('#inline-writing-body'); await field.click(); await page.keyboard.insertText('Exact unsent1037 writing');
        for (const key of ['Meta+ArrowDown', 'Meta+ArrowUp', 'Meta+ArrowRight']) await page.keyboard.press(key);
        await settledKey();
        const writing = await record('writing keeps shortcuts');
        const written = await field.inputValue();
        check('writing retains exact words', () => assert.equal(written, 'Exact unsent1037 writing'));
        check('writing emits no dossier mutation', () => assert.equal(writing.writes.filter(x => x.request.kind.startsWith('stack.')).length, 0));
        const star = await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: children[1], operation_id: topic + '-star', args: { starred: true } }); assert.equal(star.status, 'committed');
        await page.waitForFunction(id => document.querySelector(`#messages .reply-stack[data-stack="${id}"] .stack-star`), roots[1]);
        await page.locator(toggle).click(); await selectRoot(); await page.keyboard.press('Meta+ArrowRight'); await settledKey();
        row.afterCore = await truth(); const held = await record('star holds dossier');
        check('star hold refuses archive without sending a dossier mutation', () => { assert.equal(position(row.afterCore, roots[1]).below, false); assert.equal(held.writes.filter(x => x.request.kind.startsWith('stack.')).length, 0); });
        await page.locator('#outline-keys summary').click();
        row.visibleLegend = await page.locator('#outline-keys').evaluate(keys => Object.fromEntries([...keys.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent])));
        check('visible Keys names Command-Down reorder and Command-Right archive', () => { assert.match(row.visibleLegend['⌘↓'] ?? '', /stack down/); assert.match(row.visibleLegend['⌘→'] ?? '', /archive the selected dossier/); });
        await page.locator('.guide-open').click();
        const guide = page.locator('dialog.interaction-guide[open]'); await guide.waitFor({ state: 'visible' });
        row.visibleGuide = await guide.getByText('Reply stacks', { exact: true }).evaluate(term => term.nextElementSibling.textContent);
        check('visible interaction guide names both restored defaults', () => { assert.match(row.visibleGuide, /⌘↑ and ⌘↓ move its stack up and down/); assert.match(row.visibleGuide, /⌘→ archives the selected dossier/); });
        await page.screenshot({ path: out + '/visible-interaction-guide.png' });
        await guide.getByRole('button', { name: 'Close', exact: true }).click();
      } else if (action === 'return') {
        await selectChild(); await page.keyboard.press('Enter');
        await page.locator(`#messages [data-id="${children[1]}"][data-card-reply] .card-reply-composer`).waitFor({ state: 'visible' });
        const returned = await record('Return opens exact child reply');
        check('Return still opens the selected child reply', () => assert.equal(returned.childReply, true));
        row.afterCore = await truth();
        check('Return neither archives nor reorders', () => { assert.deepEqual(returned.order, before.order); assert.equal(returned.writes.filter(x => x.request.kind.startsWith('stack.')).length, 0); });
      } else {
        if (action === 'archive-child') await selectChild(); else await selectRoot();
        await record('exact native selection');
        const beforeMutationCount = await mutationsMade();
        await page.keyboard.press(action === 'down' ? 'Meta+ArrowDown' : action === 'up' ? 'Meta+ArrowUp' : 'Meta+ArrowRight');
        await settledKey();
        if (action === 'down' || action === 'up') await page.waitForFunction(count => key1037Writes.filter(x => ['stack.place', 'stack.aside', 'stack.join'].includes(x.request.kind)).length > count, beforeMutationCount);
        row.afterCore = await truth();
        const after = await record('after named key');
        await page.screenshot({ path: out + '/' + action + '-after-key.png' });
        const mutations = after.writes.filter(x => ['stack.place', 'stack.aside', 'stack.join'].includes(x.request.kind));
        const expected = [...before.order], index = expected.indexOf(roots[1]);
        if (action === 'down' || action === 'up') {
          const next = index + (action === 'down' ? 1 : -1); [expected[index], expected[next]] = [expected[next], expected[index]];
          check('three dossiers reorder in the requested direction', () => assert.deepEqual(after.order, expected));
          check('reorder records placement and never archives', () => { assert.ok(mutations.length > 0); assert.ok(mutations.every(x => x.request.kind === 'stack.place' && x.receipt.status === 'committed')); assert.equal(position(row.afterCore, roots[1]).below, false); });
        } else {
          check('archive removes only the containing dossier from the feed', () => assert.deepEqual(after.order, before.order.filter(id => id !== roots[1])));
          check('archive records exactly one whole-dossier act', () => { assert.equal(mutations.length, 1); assert.equal(mutations[0].request.kind, 'stack.aside'); assert.equal(mutations[0].request.target.message_id, roots[1]); assert.equal(mutations[0].receipt.status, 'committed'); assert.equal(position(row.afterCore, roots[1]).below, true); assert.equal(position(row.afterCore, children[1]).below, true); });
        }
        const beforeUndoCount = await mutationsMade();
        await page.keyboard.press('Meta+z'); await settledKey();
        if (mutations.length) await page.waitForFunction(count => key1037Writes.filter(x => ['stack.place', 'stack.aside', 'stack.join'].includes(x.request.kind)).length > count, beforeUndoCount);
        row.undoCore = await truth();
        const undo = await record('after native Undo');
        check('Command-Z restores the original three-dossier order', () => assert.deepEqual(undo.order, before.order));
        check('Undo retains containing identity and restores its Core position', () => { assert.equal(position(row.undoCore, children[1]).root_id, roots[1]); assert.equal(position(row.undoCore, roots[1]).below, false); assert.equal(position(row.undoCore, roots[1]).order_key, position(row.beforeCore, roots[1]).order_key); });
      }
      await page.waitForLoadState('networkidle'); await Promise.all(captures); assert.deepEqual(row.captureErrors, []); assert.deepEqual(row.errors, []);
      row.inputs = await page.evaluate(() => key1037Inputs); row.writes = await page.evaluate(() => key1037Writes);
      assert.ok(row.inputs.some(x => x.type === 'keydown' && (action === 'return' ? x.key === 'Enter' : x.meta))); assert.ok(row.inputs.every(x => x.trusted));
      row.passed = row.checks.every(x => x.passed);
    } catch (e) {
      row.error = e.stack; row.passed = false; await record('driver failure').catch(() => {});
      row.inputs = await page.evaluate(() => key1037Inputs).catch(() => []); row.writes = await page.evaluate(() => key1037Writes).catch(() => []);
      await page.screenshot({ path: out + '/' + action + '-error.png' }).catch(() => {});
    }
    retain(); await resources('before ' + action + ' context close'); await context.close();
    if (row.errors.length) row.passed = false;
    await writeFile(out + '/observations.json', JSON.stringify(rows, null, 2));
    console.log(JSON.stringify({ key: action, passed: row.passed, failed: row.checks.filter(x => !x.passed).map(x => x.name), error: row.error?.split('\n')[0] }));
  }
} catch (e) { failure = e.stack; }
finally {
  if (browser) { retain(); await browser.close(); } cleanup.browserClosed = browser ? !browser.isConnected() : true;
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const list = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = list.filter(p => owned.has(p.pid));
  cleanup.fixtureOwnedPids = [...fixtureOwned]; cleanup.remainingFixtureOwned = list.filter(p => fixtureOwned.has(p.pid));
  cleanup.fixtureAbsent = !list.some(p => p.pid === fixture.pid); cleanup.profileProcesses = profile ? list.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : true;
  cleanup.portClosed = origin ? await portClosed(origin) : null;
  await resources('cleanup observed');
  await writeFile(out + '/results.json', JSON.stringify({ engine, version, hashes, rows, cleanup, failure }, null, 2));
}
assert.ok(cleanup.browserClosed && cleanup.fixtureAbsent && cleanup.profileAbsent && cleanup.portClosed);
assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.remainingFixtureOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
const endHashes = {};
for (const path of files) { endHashes[path] = sha(await readFile(path)); assert.equal(endHashes[path], hashes[path], path + ' unchanged during phase'); }
await writeFile(out + '/source-end.json', JSON.stringify({ hashes: endHashes }, null, 2));
assert.equal(failure, undefined); assert.ok(rows.length && rows.every(row => row.passed), 'inspect real dossier key observations');
