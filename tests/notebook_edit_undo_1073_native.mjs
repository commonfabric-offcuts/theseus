// Scratch Core and real card editors. Native keyboard/clipboard commands;
// no handler-dispatch claim and no physical-phone or timing claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { parseDeck, cardText } from '../web/deck.mjs';

const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], selected = new RegExp(process.argv[3] ?? '');
await mkdir(evidence, { recursive: true });
const files = ['web/deck-page.mjs', 'web/notebook-page.mjs', 'web/writing-input.mjs', 'web/notebook-writing.mjs',
  'web/notebook-edit-history.mjs',
  'web/notebook-card-text.mjs', 'web/deck.mjs', 'web/card-details.mjs', 'web/notebook-sheet.mjs', 'web/app.mjs',
  'web/image-pick.mjs', 'tests/fixtures/ui_http.py', 'tests/fixture_control.mjs', 'tests/notebook_edit_undo_1073_native.mjs'];
const sha = b => createHash('sha256').update(b).digest('hex'), hashes = {};
for (const file of files) {
  const bytes = await readFile(file); hashes[file] = sha(bytes); const out = `${evidence}/source/${file}`;
  await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, bytes);
}
await writeFile(`${evidence}/start.json`, JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture), owned = new Set([fixture.pid]), results = [], cleanup = {};
let origin, browser, profile, watcher, failure, version;
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retain() {
  const ps = processes(); for (let changed = true; changed;) { changed = false; for (const p of ps) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; } }
  writeFileSync(`${evidence}/owned.json`, JSON.stringify({ profile, fixturePid: fixture.pid, ownedPids: [...owned] }));
}
const textIn = body => cardText(parseDeck(body).cards[0]);
const state = field => field.evaluate(e => ({ text: e.value, selection: [e.selectionStart, e.selectionEnd], direction: e.selectionDirection,
  connected: e.isConnected, focused: document.activeElement === e, token: e.dataset.undo1073, scroll: [e.scrollLeft, e.scrollTop] }));
const same = (actual, expected) => actual.text === expected.text && JSON.stringify(actual.selection) === JSON.stringify(expected.selection);

try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  await writeFile(`${evidence}/fixture.json`, JSON.stringify({ origin, fixturePid: fixture.pid }));
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); watcher = setInterval(retain, 250);
  for (const surface of ['sheet', 'page']) for (const action of ['typing', 'copy', 'cut', 'paste', 'delete', 'words', 'line']) {
    const key = `${surface}-${action}`; if (!selected.test(key)) continue;
    const result = { key, errors: [], checks: [], served: {}, responses: [] }, jobs = [], waiters = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    await context.addInitScript(() => {
      localStorage.setItem('theseus-look', 'bookends'); window.undo1073Events = [];
      for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'copy', 'cut', 'paste', 'select']) document.addEventListener(type, event => {
        const field = event.target; if (!field.matches?.('.deck-editor')) return;
        const row = { type, key: event.key, code: event.code, inputType: event.inputType, trusted: event.isTrusted,
          text: field.value, selection: [field.selectionStart, field.selectionEnd] };
        window.undo1073Events.push(row); queueMicrotask(() => { row.preventedAfter = event.defaultPrevented; });
      }, true);
    });
    const page = await context.newPage(); page.setDefaultTimeout(9000); page.on('pageerror', e => result.errors.push(e.stack));
    const pending = new Set(); let starts = 0;
    const done = r => { if (pending.delete(r)) for (const wake of waiters.splice(0)) wake(); };
    page.on('request', r => { if (['/api/view', '/api/command', '/api/bootstrap'].includes(new URL(r.url()).pathname)) { pending.add(r); starts++; } });
    page.on('requestfinished', done); page.on('requestfailed', done);
    page.on('response', response => {
      const file = 'web/' + new URL(response.url()).pathname.split('/').at(-1);
      if (Object.hasOwn(hashes, file)) {
        const job = response.body().then(async bytes => { result.served[file] = sha(bytes); const out = `${evidence}/served-${key}/${file}`; await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, bytes); });
        job.catch(() => {}); jobs.push(job);
      }
      let args; try { args = response.request().postDataJSON(); } catch {}
      if (args?.kind === 'memory.revise') {
        const row = { args: args.args }; result.responses.push(row);
        const job = response.json().then(receipt => { row.receipt = receipt; for (const wake of waiters.splice(0)) wake(); }); job.catch(() => {}); jobs.push(job);
      }
    });
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const drain = async () => {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      const deadline = Date.now() + 9000;
      for (;;) {
        while (pending.size) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('API drain timed out')), Math.max(1, deadline - Date.now())); waiters.push(() => { clearTimeout(timer); resolve(); }); });
        const before = starts; await frames(); if (!pending.size && starts === before) return;
        assert.ok(Date.now() < deadline, 'API readers settle');
      }
    };
    let item, field;
    const core = () => control({ method: 'agent_view', actor: facts.actor, name: 'memory_current', args: { item_id: item } });
    const kept = async shown => {
      const deadline = Date.now() + 9000; let witnessed;
      for (;;) {
        assert.ok(Date.now() < deadline, 'actual writing reaches Core');
        const source = await core();
        if (textIn(source.body) === shown) { assert.equal(cardText(parseDeck(source.body).cards[1]), 'Neighbor\nKeep this neighbor.'); return source; }
        const record = result.responses.find(r => textIn(r.args.body) === shown && r.receipt?.status === 'committed');
        if (record && record !== witnessed) { witnessed = record; continue; }
        await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Writing receipt did not confirm the actual field')), Math.max(1, deadline - Date.now())); waiters.push(() => { clearTimeout(timer); resolve(); }); });
        assert.ok(Date.now() < deadline, 'actual writing reaches Core');
      }
    };
    const snapshot = async (name, savedText) => { await frames(); const s = await state(field); result[name] = s; result[`${name}Core`] = await kept(savedText ?? s.text); await drain(); return s; };
    try {
      item = `undo1073-${engine}-${key}`;
      await control({ method: 'agent_page', operation_id: `create-${item}`, item_id: item, topic_id: 't1', title: `Undo1073 ${key}`,
        body: '## Heading\n\nAlpha beta gamma.\n\n## Neighbor\n\nKeep this neighbor.\n' });
      await page.goto(origin + (surface === 'sheet' ? '/?topic=t1&page=' + item : '/?cards=' + item + '&view=cards'));
      await page.locator('body[data-ready=true]').waitFor(); await drain();
      const host = page.locator(surface === 'sheet' ? '#notebook-sheet-dialog[open]' : '#deck-page');
      await host.locator('.deck-card[data-index="0"] .deck-title').click(); field = host.locator('.deck-editor'); await field.waitFor();
      await field.evaluate(e => { e.dataset.undo1073 = 'original-field'; e.setSelectionRange(e.value.length, e.value.length); });
      const initial = await snapshot('initial');
      await page.keyboard.insertText(' typed'); const typed = await snapshot('typed');
      let before = typed, expectedAfter;
      if (action === 'typing') { before = initial; expectedAfter = typed; }
      else if (action === 'copy') {
        await field.evaluate(e => e.setSelectionRange(8, 13)); const selectedCopy = await state(field);
        await page.keyboard.press('Meta+C'); const copied = await snapshot('copied'); result.checks.push({ name: 'copy leaves text and selection', passed: same(copied, selectedCopy) });
        before = initial; expectedAfter = typed;
      } else if (action === 'words') {
        // Real key-by-key typing checks the word rule, unlike insertText's
        // single whole-string input event used in the per-action cases.
        await page.keyboard.type(' words more');
        before = { text: typed.text + ' words ', selection: [typed.text.length + 7, typed.text.length + 7] };
        expectedAfter = { text: typed.text + ' words more', selection: [typed.text.length + 11, typed.text.length + 11] };
        const after = await snapshot('afterAction'); result.checks.push({ name: 'word typing applies exact text and caret', passed: same(after, expectedAfter) });
      } else if (action === 'line') {
        await field.evaluate(e => e.setSelectionRange(14, 18)); before = await snapshot('beforeAction');
        await page.keyboard.press('Alt+ArrowUp');
        expectedAfter = { text: 'Alpha beta gamma. typed\nHeading', selection: [6, 10] };
        const after = await snapshot('afterAction'); result.checks.push({ name: 'line key applies exact text and selection', passed: same(after, expectedAfter) });
      } else {
        if (action === 'paste') {
          // Clipboard is seeded only by copying this fixture's own Alpha text.
          await field.evaluate(e => { const at = e.value.indexOf('Alpha'); e.setSelectionRange(at, at + 5); }); await page.keyboard.press('Meta+C');
        }
        await field.evaluate(e => { const at = e.value.indexOf('beta'); e.setSelectionRange(at, at + 4); }); before = await snapshot('beforeAction');
        await page.keyboard.press(action === 'cut' ? 'Meta+X' : action === 'paste' ? 'Meta+V' : 'Backspace');
        const at = before.selection[0], insert = action === 'paste' ? 'Alpha' : '';
        expectedAfter = { text: before.text.slice(0, at) + insert + before.text.slice(before.selection[1]), selection: [at + insert.length, at + insert.length] };
        const after = await snapshot('afterAction'); result.checks.push({ name: action + ' applies exact replacement', passed: same(after, expectedAfter) });
      }
      // Undo of a word leaves its preceding space in the live field. The
      // existing card serializer trims trailing whitespace in the saved body;
      // assert that Core value separately from the exact live text/caret.
      await page.keyboard.press('Meta+Z'); const undone = await snapshot('undone', action === 'words' ? before.text.trimEnd() : undefined); result.checks.push({ name: action + ' Undo text and caret', passed: same(undone, before), expected: before });
      await page.keyboard.press('Meta+Shift+Z'); const redone = await snapshot('redone'); result.checks.push({ name: action + ' Redo text and caret', passed: same(redone, expectedAfter), expected: expectedAfter });
      if (['cut', 'paste', 'delete'].includes(action)) {
        await page.keyboard.press('Meta+Z'); const first = await snapshot('firstOfTwoUndo');
        await page.keyboard.press('Meta+Z'); const second = await snapshot('secondOfTwoUndo');
        result.checks.push({ name: action + ' two Undo steps reach prior replacement then prior typing', passed: same(first, before) && same(second, initial) });
        await page.keyboard.press('Meta+Shift+Z'); const firstRedo = await snapshot('firstOfTwoRedo');
        await page.keyboard.press('Meta+Shift+Z'); const secondRedo = await snapshot('secondOfTwoRedo');
        result.checks.push({ name: action + ' two Redo steps restore typing then replacement', passed: same(firstRedo, typed) && same(secondRedo, expectedAfter) });
      }
      result.events = await page.evaluate(() => window.undo1073Events); await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
      result.checks.push({ name: 'same edit field remains connected and focused', passed: redone.token === initial.token && redone.connected && redone.focused });
      await page.keyboard.press('Escape'); await field.waitFor({ state: 'detached' }); await drain();
      result.finishedCore = await kept(redone.text); if (engine === 'webkit') await page.waitForLoadState('networkidle');
      await page.reload(); await page.locator('body[data-ready=true]').waitFor(); await drain();
      result.reloadedCore = await core(); result.checks.push({ name: 'finished writing survives reload', passed: textIn(result.reloadedCore.body) === redone.text });
      assert.deepEqual(result.errors, []); result.passed = result.checks.every(c => c.passed);
    } catch (e) { result.driverError = e.stack; result.events = await page.evaluate(() => window.undo1073Events).catch(() => []); await page.screenshot({ path: `${evidence}/${key}-driver-error.png`, fullPage: true }); }
    await drain().catch(e => { result.drainError = e.stack; }); await Promise.all(jobs); results.push(result);
    await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2)); retain(); await context.close();
    console.log(JSON.stringify({ engine, key, passed: result.passed, checks: result.checks, driverError: result.driverError }));
  }
} catch (e) { failure = e.stack; }
finally {
  clearInterval(watcher); if (browser) { retain(); await browser.close(); } cleanup.disconnected = browser ? !browser.isConnected() : true;
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid)); cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  cleanup.tcp = origin ? await new Promise(resolve => { const u = new URL(origin), socket = net.createConnection({ host: u.hostname, port: +u.port }); socket.once('connect', () => { socket.destroy(); resolve({ refused: false }); }); socket.once('error', e => resolve({ refused: e.code === 'ECONNREFUSED', code: e.code })); }) : null;
  const end = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(file))]))); cleanup.inputsUnchanged = JSON.stringify(hashes) === JSON.stringify(end);
  await writeFile(`${evidence}/end.json`, JSON.stringify({ hashes: end, unchanged: cleanup.inputsUnchanged }, null, 2));
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, version, results, cleanup, failure }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, ''); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true); assert.equal(cleanup.tcp?.refused, true); assert.equal(cleanup.inputsUnchanged, true);
assert.equal(failure, undefined); assert.ok(results.length && results.every(r => r.passed && !r.driverError && !r.drainError && !r.errors.length), 'inspect retained Undo/Redo/driver failures');
