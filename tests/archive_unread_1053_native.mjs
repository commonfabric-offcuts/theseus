//1053 actual archived-reply unread signal through real Core/HTTP and native shelf input.
// Real scratch commands create records; actual pointer input archives and opens the dossier.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_BROWSER ?? 'chromium', out = process.argv[2];
const red = process.argv.includes('--red');
const count = process.argv.includes('--list') ? 20 : 1;
const look = process.argv.includes('--paper') ? 'paper' : 'bookends';
const theme = process.argv.includes('--dark') ? 'dark' : 'light';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ["web/archive-shelf.mjs", "web/archive-shelf.css", "web/stack-feed.mjs", "web/reply-stacks.mjs", "web/stack-order.mjs", "web/card-reading.mjs", "web/marks.mjs", "web/topic-navigation.mjs", "web/outline-rail.mjs", "web/things-rail.mjs", "web/key-tree.mjs", "web/reveal.mjs", "web/pane-keys.mjs", "web/aim.css", "web/stack-look.css", "web/rails.css", "web/look.css", "web/index.html", "tests/fixtures/ui_http.py", "tests/fixture_control.mjs", "tests/ui_archive_unread_1053.test.mjs", "tests/archive_unread_1053_native.mjs"];
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
  const topic = 'shelf1053', away = 'shelf1053-away';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'New replies on an archived dossier' }, { id: away, title: 'Away while a reply arrives' }] });
  const roots = [];
  for (let n = 0; n < count; n++) {
    const made = await control({ method: 'agent_message', operation_id: 'shelf1053-root-' + n,
      topic_id: topic, source: 'topic', join: n === 0, member: n === 0,
      divergence_reason: 'Separate archived fixture dossier ' + n, read: true,
      body: 'Read dossier ' + n + '. This must stay unread only after a new reply arrives.' });
    assert.equal(made.status, 'committed'); roots.push(made.result.message_id);
  }
  const root = roots.at(-1);
  const originals = await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: topic, limit: 50 } });
  for (const id of roots.slice(0, -1)) {
    const item = originals.items.find(i => i.id === id); assert.ok(item);
    assert.equal((await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside',
      operation_id: 'shelf1053-archive-' + id, message_id: id, args: { through: item.seq } })).status, 'committed');
  }
  await writeFile(out + '/seed-identities.json', JSON.stringify({ topic, root, roots, originals }, null, 2));
  profile = await mkdtemp(out + '/' + engine + '-profile-');
  await resources('profile created before browser launch');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); assert.ok(owned.size);
  await resources('browser launched');
  await writeFile(out + '/launch-processes.json', JSON.stringify(ps().filter(p => owned.has(p.pid)), null, 2));
  const cells = [[1280, look, theme]];
  for (const [width, look, theme] of cells) {
    assert.ok(load() < 12); const key = `${width}-${look}-${theme}`;
    const row = { key, width, look, theme, checks: [], observations: [], errors: [], network: [], served: {}, executed: {}, captureErrors: [] }; rows.push(row);
    const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: theme, hasTouch: width === 390, isMobile: false });
    await context.addInitScript(look => {
      localStorage.setItem('theseus-look', look); window.cursorInputs = []; window.cursorWrites = []; window.cursorKeyEvents = [];
      addEventListener('keydown', e => cursorKeyEvents.push(e), true);
      for (const type of ['keydown', 'wheel', 'click']) addEventListener(type, e => cursorInputs.push({ type,
        key: e.key, trusted: e.isTrusted, target: e.target.tagName, inRail: !!e.target.closest?.('#things') }), true);
      const originalFetch = window.fetch;
      window.fetch = (input, init) => {
        let request; try { request = JSON.parse(init?.body); } catch { /* Not a JSON command. */ }
        const answer = originalFetch.call(window, input, init);
        if (request?.kind === 'stack.aside') answer.then(r => r.clone().json()).then(
          receipt => cursorWrites.push({ operation_id: request.operation_id, target: request.target, args: request.args, receipt }),
          error => cursorWrites.push({ operation_id: request.operation_id, error: String(error) }));
        return answer;
      };
    }, look);
    const page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', e => row.errors.push(e.stack));
    let phase = 'initial load';
    for (const event of ['request', 'requestfinished', 'requestfailed']) page.on(event, request => row.network.push({
      event, phase, at: Date.now(), url: request.url(), failure: request.failure()?.errorText ?? null,
    }));
    // Setup navigation must not tear down the independently loading rails.
    // Keep page errors unfiltered, and preserve the failed earlier phase.
    const settled = async next => { await page.waitForLoadState('networkidle'); phase = next; };
    const captured = [];
    page.on('response', response => {
      const path = files.find(f => f.startsWith('web/') && f !== 'web/index.html' && new URL(response.url()).pathname.endsWith('/' + f.split('/').at(-1)));
      if (!path) return;
      const task = (async () => {
        const bytes = await response.body(); assert.equal(sha(bytes), hashes[path], 'original executed response ' + path);
        await mkdir(out + '/executed-bodies', { recursive: true }); await writeFile(out + '/executed-bodies/' + sha(bytes), bytes);
        row.executed[path] = { sha256: sha(bytes), url: response.url(), status: response.status() };
      })().catch(e => row.captureErrors.push(e.stack));
      captured.push(task);
    });
    const check = (name, action) => { try { action(); row.checks.push({ name, passed: true }); }
      catch (e) { row.checks.push({ name, passed: false, error: e.stack }); } };
    const snap = () => page.evaluate(({ root, topic }) => {
      const rect = el => el?.isConnected && el.getClientRects().length ? el.getBoundingClientRect().toJSON() : null;
      const shown = el => !!rect(el) && !el.hidden && getComputedStyle(el).visibility === 'visible';
      const replica = document.querySelector(`.shelf-dossier[data-id="${root}"]`), mark = replica?.querySelector('.shelf-new');
      const shelf = document.querySelector('#archive-shelf'), count = shelf?.querySelector('.archive-shelf-count');
      const mr = rect(mark), sr = rect(shelf);
      const inShelfViewport = !!mr && !!sr && mr.top >= Math.max(0, sr.top) && mr.bottom <= Math.min(innerHeight, sr.bottom)
        && mr.left >= Math.max(0, sr.left) && mr.right <= Math.min(innerWidth, sr.right);
      const hit = !!mr && !!replica?.contains(document.elementFromPoint(mr.x + mr.width / 2, mr.y + mr.height / 2));
      const link = document.querySelector(`#rail a[href="?topic=${topic}"]`);
      return { replica: { exists: !!replica, title: replica?.title, label: replica?.getAttribute('aria-label'), rect: rect(replica) },
        mark: { text: mark?.textContent ?? null, shown: shown(mark), rect: mr, inShelfViewport, hit },
        archivedCount: count?.textContent, shelfShown: shown(shelf), view: shelf?.dataset.view,
        storageView: localStorage.getItem('theseus-archive-view'), shelfRows: shelf?.querySelectorAll('.shelf-dossier').length,
        railUnread: link?.querySelector('.unread-count')?.textContent ?? '',
        feedRootShown: shown(document.querySelector(`#messages .reply-stack[data-stack="${root}"]`)),
        active: { tag: document.activeElement.tagName, shelf: document.activeElement.closest('.shelf-dossier')?.dataset.id },
        viewport: { width: innerWidth, height: innerHeight } };
    }, { root, topic });
    const record = async phase => { const state = await snap(); row.observations.push({ phase, ...state });
      if (['unread reply archived before reading', 'native List scroll exposes new reply', 'after shelf opening'].includes(phase))
        await page.screenshot({ path: out + '/' + key + '-' + phase.replaceAll(' ', '-') + '.png' });
      return state;
    };
    try {
      await page.goto(origin + '/?topic=' + topic); await page.locator('body[data-ready=true]').waitFor();
      await page.locator(`#messages .reply-stack[data-stack="${root}"]`).waitFor();
      for (const path of files.filter(f => f.startsWith('web/') && f !== 'web/index.html')) {
        const url = await page.evaluate(name => performance.getEntriesByType('resource').find(r => new URL(r.name).pathname.endsWith('/' + name))?.name, path.split('/').at(-1));
        assert.ok(url, 'actual loaded owner ' + path); const bytes = await (await page.request.get(url)).body();
        assert.equal(sha(bytes), hashes[path]); row.served[path] = sha(bytes);
        await mkdir(out + '/served-bodies', { recursive: true }); await writeFile(out + '/served-bodies/' + sha(bytes), bytes);
      }
      await Promise.all(captured); assert.deepEqual(row.captureErrors, []);
      for (const path of Object.keys(row.served)) assert.equal(row.executed[path]?.sha256, hashes[path], 'captured original page response ' + path);
      const section = page.locator(`#messages .reply-stack[data-stack="${root}"]`);
      await section.hover(); await section.locator('[aria-label="Archive"]').first().click();
      await page.locator(`.shelf-dossier[data-id="${root}"]`).waitFor();
      await page.waitForFunction(n => document.querySelectorAll('.shelf-dossier').length === n && !document.querySelector('.shelf-ghost'), count);
      await record('read dossier archived');
      // Core intentionally reawakens a dossier for a newer other-author reply.
      // Stay on another real scratch topic so that reply is not read, then
      // personally archive the existing unread content before returning.
      row.archiveInputs = await page.evaluate(() => cursorInputs);
      await settled('away navigation');
      await page.goto(origin + '/?topic=' + away); await page.locator('body[data-ready=true]').waitFor();
      const made = await control({ method: 'agent_message', operation_id: 'shelf1053-new-reply',
        topic_id: topic, reply_to: root, sender: 'fixture-notebook-agent',
        reply_without_quote: 'Isolated new reply in the archived dossier.', addressees: [facts.actor],
        body: 'A newly arrived reply hidden in the archived dossier. Reading the shelf alone must not read these words.' });
      assert.equal(made.status, 'committed'); const reply = made.result.message_id;
      const truth = async () => ({
        topics: await control({ method: 'agent_view', actor: facts.actor, name: 'workspace_topics', args: { workspace_id: 'w1', build: false, limit: 50 } }),
        messages: await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: topic, message_ids: [root, reply] } }),
      });
      row.reawakened = await truth(); const arrived = row.reawakened.messages.items.find(i => i.id === reply);
      assert.equal(arrived.unread, true); assert.equal(arrived.stack_position.below, false, 'new other-author reply intentionally reawakens the dossier');
      row.rearchive = await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside',
        operation_id: 'shelf1053-archive-existing-unread', message_id: root, args: { through: arrived.seq } });
      assert.equal(row.rearchive.status, 'committed'); row.beforeReturn = await truth();
      assert.equal(row.beforeReturn.messages.items.find(i => i.id === reply).unread, true);
      assert.equal(row.beforeReturn.messages.items.find(i => i.id === reply).stack_position.below, true);
      await settled('return navigation');
      await page.goto(origin + '/?topic=' + topic); await page.locator('body[data-ready=true]').waitFor();
      await page.waitForFunction(root => document.querySelector(`.shelf-dossier[data-id="${root}"]`)?.dataset.folder === 'true', root);
      await page.waitForFunction(topic => document.querySelector(`#rail a[href="?topic=${topic}"] .unread-count`)?.textContent === '1', topic);
      row.afterArrival = await truth(); let s = await record('unread reply archived before reading');
      if (count > 18) {
        await page.locator('#archive-shelf').hover(); await page.mouse.wheel(0, 700);
        await page.waitForFunction(root => {
          const mark = document.querySelector(`.shelf-dossier[data-id="${root}"] .shelf-new`), shelf = document.querySelector('#archive-shelf');
          if (!mark || !shelf) return false;
          const m = mark.getBoundingClientRect(), s = shelf.getBoundingClientRect();
          return m.top >= Math.max(0, s.top) && m.bottom <= Math.min(innerHeight, s.bottom)
            && mark.closest('.shelf-dossier').contains(document.elementFromPoint(m.x + m.width / 2, m.y + m.height / 2));
        }, root);
        s = await record('native List scroll exposes new reply');
      }
      check('real Core archived reply is unread and topic count is1', () => {
        assert.equal(row.afterArrival.messages.items.find(i => i.id === reply).unread, true);
        assert.equal(row.afterArrival.messages.items.find(i => i.id === root).stack_position.below, true);
        assert.equal(row.afterArrival.topics.items.find(i => i.id === topic).unread, 1);
      });
      check('rail unread1 is retained while the dossier stays archived', () => {
        assert.equal(s.railUnread, '1'); assert.equal(s.feedRootShown, false);
      });
      check('default Auto chooses the actual Grid/List for the dossier count', () => {
        assert.equal(s.storageView, null); assert.equal(s.view, count > 18 ? 'list' : 'grid'); assert.equal(s.shelfRows, count);
      });
      check('archived replica exposes its one new reply', () => { assert.equal(s.mark.text, '1 new'); assert.equal(s.mark.shown, true); });
      check('new mark is inside the actual shelf viewport and hit-testable', () => { assert.equal(s.mark.inShelfViewport, true); assert.equal(s.mark.hit, true); });
      check('Archived count says one message is new', () => assert.match(s.archivedCount, /1 new/));
      check('archived replica accessible label carries new count', () => assert.match(s.replica.label, /1 new/));
      if (!red) {
        await settled('reload');
        await page.reload(); await page.locator('body[data-ready=true]').waitFor();
        await page.locator(`.shelf-dossier[data-id="${root}"]`).waitFor();
        // The rail and feed load independently. A ready feed/shelf does not
        // promise that the rail's authoritative topic projection has painted.
        await page.waitForFunction(topic => document.querySelector(`#rail a[href="?topic=${topic}"] .unread-count`)?.textContent === '1', topic);
        s = await record('new reply retained after reload');
        check('reload preserves the new shelf mark without reading hidden words', () => { assert.equal(s.mark.text, '1 new'); assert.equal(s.mark.shown, true); assert.equal(s.railUnread, '1'); });
        row.afterReload = await truth(); check('Core reply remains unread after shelf repaint/reload', () => assert.equal(row.afterReload.messages.items.find(i => i.id === reply).unread, true));
        await page.locator(`.shelf-dossier[data-id="${root}"]`).click();
        await page.locator(`#messages .reply-stack[data-stack="${root}"]`).waitFor({ state: 'visible' });
        await page.waitForFunction(reply => { const entry = document.querySelector(`#messages [data-id="${reply}"]`); return !!entry && entry.getClientRects().length > 0; }, reply);
        await page.waitForFunction(topic => !document.querySelector(`#rail a[href="?topic=${topic}"] .unread-count`), topic);
        row.afterOpen = await truth(); s = await record('after shelf opening');
        check('shelf opening brings back and reads the actual reply', () => {
          assert.equal(row.afterOpen.messages.items.find(i => i.id === root).stack_position.below, false);
          assert.equal(row.afterOpen.messages.items.find(i => i.id === reply).unread, false);
          assert.equal(row.afterOpen.topics.items.find(i => i.id === topic).unread, 0);
        });
        // Re-archive after actual reading: the new mark must not become sticky.
        await section.hover(); await section.locator('[aria-label="Archive"]').first().click();
        await page.locator(`.shelf-dossier[data-id="${root}"]`).waitFor(); s = await record('read reply archived again');
        check('read dossier returns to shelf without phantom new marks', () => { assert.equal(s.mark.shown, false); assert.doesNotMatch(s.archivedCount, /new/); });
      }
      row.inputs = [...(row.archiveInputs ?? []), ...await page.evaluate(() => cursorInputs)]; row.writes = await page.evaluate(() => cursorWrites);
      assert.ok(row.inputs.some(x => x.type === 'click'), 'actual native archive press retained');
      assert.ok(row.inputs.every(x => x.trusted)); assert.deepEqual(row.errors, []); await Promise.all(captured); assert.deepEqual(row.captureErrors, []);
      row.passed = row.checks.every(c => c.passed);
    } catch (e) { row.error = e.stack; row.passed = false; await record('driver failure').catch(() => {});
      row.inputs = [...(row.archiveInputs ?? []), ...await page.evaluate(() => cursorInputs).catch(() => [])]; await page.screenshot({ path: out + '/' + key + '-error.png' }).catch(() => {}); }
    retain(); await resources('cell ' + key + ' before context close');
    await context.close(); await writeFile(out + '/observations.json', JSON.stringify(rows, null, 2));
    console.log(JSON.stringify({ key, passed: row.passed, failed: row.checks.filter(c => !c.passed).map(c => c.name), error: row.error?.split('\n')[0] }));
    if (row.error) break;
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
assert.equal(failure, undefined); assert.ok(rows.length && rows.every(row => row.passed), 'inspect real rail cursor observations');
