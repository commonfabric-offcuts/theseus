// Isolated Core and actual browser selection/keys. No physical device, IME,
// software-keyboard or performance inference. Filters narrow named evidence.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { parseDeck } from '../web/deck.mjs';

const engine = process.env.AIM_ENGINE ?? 'chromium', evidence = resolve(process.argv[2]);
assert.ok(['chromium', 'webkit'].includes(engine)); assert.ok(isAbsolute(process.argv[2]));
const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), cells = new RegExp(process.env.AIM_1075_CELLS ?? '.'), cases = new RegExp(process.env.AIM_1075_CASES ?? '.');
await mkdir(evidence, { recursive: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['web/deck.mjs', 'web/notebook-page.mjs', 'web/notebook-card-split.mjs'];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(name)])));
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', '--live'], { env: process.env });
const { control, exit, errors } = fixtureControl(fixture), results = [], observations = [], owned = new Map(), cleanup = {}, navigationErrors = [];
let browser, profile, origin, sampler, fatal, serial = 0;
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const fields = line.trim().split(/\s+/), command = fields.slice(7).join(' '), row = { pid: +fields[0], ppid: +fields[1], started: fields.slice(2, 7).join(' '), command };
  row.commandSHA256 = hash(command); row.key = [row.pid, row.started, row.commandSHA256].join(':'); return row;
});
const sample = () => {
  const rows = processes(), descendants = new Set([process.pid]);
  for (let changed = true; changed;) { changed = false; for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; } }
  for (const row of rows) if (row.pid !== process.pid && descendants.has(row.pid)) owned.set(row.key, { pid: row.pid, ppid: row.ppid, started: row.started, commandSHA256: row.commandSHA256 });
};
const neighbor = '\n\n## Neighbor\n\nKeep neighbor.\n';
const examples = [
  { name: 'move-and-one-step-undo', text: '## Source\n\nbefore payload after' + neighbor, selected: 'payload', after: '## Source\n\nbefore  after\n\n## payload' + neighbor, titles: ['Source', 'payload', 'Neighbor'], undo: true },
  { name: 'leading-trailing-whitespace', text: '## Source\n\nleft  moved  right' + neighbor, selected: '  moved  ', after: '## Source\n\nleftright\n\n## moved' + neighbor, titles: ['Source', 'moved', 'Neighbor'] },
  { name: 'newline-selection', text: '## Source\n\nbefore first\nsecond after' + neighbor, selected: 'first\nsecond', after: '## Source\n\nbefore  after\n\n## first\n\nsecond' + neighbor, titles: ['Source', 'first', 'Neighbor'] },
  { name: 'heading-selection', text: '## Source\n\n````\n## literal title\n\nline\n````' + neighbor, selected: '## literal title\n\nline', after: '## Source\n\n````\n\n````\n\n## literal title\n\nline' + neighbor, titles: ['Source', 'literal title', 'Neighbor'] },
  { name: 'parent-child-group', text: '## Source\n\nleft payload right\n\n### Child\n\nchild\n\n#### Grandchild\n\ngrand' + neighbor, selected: 'payload', after: '## Source\n\nleft  right\n\n### Child\n\nchild\n\n#### Grandchild\n\ngrand\n\n## payload' + neighbor, titles: ['Source', 'Child', 'Grandchild', 'payload', 'Neighbor'], depths: [0, 1, 2, 0, 0] },
  { name: 'whole-source-title-children-retained', text: '## Source\n\nwords\n\n### Child\n\nchild' + neighbor, selected: 'Source\nwords', after: '## Source\n\n### Child\n\nchild\n\n## Source\n\nwords' + neighbor, titles: ['Source', 'Child', 'Source', 'Neighbor'], depths: [0, 1, 0, 0] },
  { name: 'whitespace-only', text: '## Source\n\nleft \n right' + neighbor, selected: ' \n ', unchanged: true, titles: ['Source', 'Neighbor'] },
  { name: 'no-selection', text: '## Source\n\nwords\n\n### Child\n\nchild' + neighbor, selected: null, unchanged: true, titles: ['Source', 'Child', 'Neighbor'] },
  { name: 'compact-existing-markdown', text: '## Source\nbefore payload after\n\n## Neighbor\nKeep neighbor.\n', selected: 'payload', after: '## Source\n\nbefore  after\n\n## payload\n\n## Neighbor\nKeep neighbor.\n', titles: ['Source', 'payload', 'Neighbor'], undo: true },
  { name: 'untitled-whole-source', text: '##\n\npayload\n\n### Child\n\nchild' + neighbor, selected: '\npayload', after: '##\n\n### Child\n\nchild\n\n## payload' + neighbor, titles: ['', 'Child', 'payload', 'Neighbor'], depths: [0, 1, 0, 0], undo: true, keyOpen: true },
];
try {
  const ready = await control({ method: 'ready' }); origin = ready.origin;
  await writeFile(`${evidence}/fixture-ready.json`, JSON.stringify({ ready, pid: fixture.pid, effectivePycache: process.env.PYTHONPYCACHEPREFIX }, null, 2));
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); cleanup.version = browser.version(); sample(); sampler = setInterval(sample, 500);
  for (const [surface, roomy, colorScheme] of [['full', false, 'light'], ['sheet', false, 'dark'], ['full', true, 'dark'], ['sheet', true, 'light']]) {
    const cell = `${surface}-${roomy ? 'roomy' : 'compact'}-${colorScheme}`; if (!cells.test(cell)) continue;
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, colorScheme });
    await context.addInitScript(roomy => {
      localStorage.setItem('theseus-rail-roomy', roomy ? '1' : '0'); globalThis.split1075Events = [];
      for (const type of ['keydown', 'beforeinput', 'input', 'select', 'focusin']) document.addEventListener(type, event => {
        if (!event.target.matches?.('.deck-editor')) return;
        globalThis.split1075Events.push({ type, key: event.key, trusted: event.isTrusted, text: event.target.value,
          selection: [event.target.selectionStart, event.target.selectionEnd] });
      }, true);
    }, roomy);
    const page = await context.newPage(), pageErrors = [], jobs = [], receipts = [], served = new Set(); let navigating = true;
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => {
      const text = error.stack ?? error.message;
      if (engine === 'webkit' && navigating && text.split('\n')[0] === `Fetch API cannot load ${origin}/api/view due to access control checks.`) navigationErrors.push({ cell, text });
      else pageErrors.push(text);
    });
    page.on('response', response => {
      const filename = new URL(response.url()).pathname.split('/').at(-1), name = 'web/' + filename;
      if (sources[name] && !served.has(name)) {
        served.add(name); jobs.push(response.body().then(async bytes => {
          assert.deepEqual(bytes, sources[name], 'actual served owner ' + name);
          await mkdir(`${evidence}/served/${cell}/web`, { recursive: true }); await writeFile(`${evidence}/served/${cell}/${name}`, bytes);
        }));
      }
      let request; try { request = response.request().postDataJSON(); } catch {}
      if (request?.kind === 'memory.revise') {
        const record = { request }; receipts.push(record); jobs.push(response.json().then(receipt => { record.receipt = receipt; }));
      }
    });
    const selector = surface === 'full' ? '#deck-page' : '#notebook-sheet-dialog .notebook-sheet-page:not([hidden])';
    const host = () => page.locator(selector), field = () => host().locator('.deck-editor');
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const example of examples) {
      if (!cases.test(example.name)) continue;
      const result = { cell, name: example.name, receipts: [], sourceSHA256: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, hash(v)])) };
      let item;
      const current = () => control({ method: 'agent_view', name: 'memory_current', args: { item_id: item } });
      const kept = async expected => {
        let source;
        for (let i = 0; i < 160; i++) { source = await current(); if (source.body === expected) return source; await page.waitForTimeout(25); }
        assert.equal(source.body, expected, 'actual scratch Core body');
      };
      try {
        item = `split1075-${engine}-${++serial}`;
        assert.equal((await control({ method: 'agent_page', operation_id: item, item_id: item, topic_id: 't1', title: 'Selection split ' + serial, body: example.text })).status, 'committed');
        const url = origin + (surface === 'full' ? `/?cards=${item}&view=cards` : `/?topic=t1&page=${item}`);
        const opened = surface === 'full' ? null : page.waitForResponse(r => {
          if (!r.url().endsWith('/api/command')) return false;
          const command = r.request().postDataJSON(); return command.kind === 'memory.read' && command.target?.item_id === item;
        }).then(r => r.json());
        navigating = true; await page.goto(url); await page.locator('body[data-ready=true]').waitFor();
        await host().locator('.deck-card[data-index="0"] .deck-title').waitFor(); if (opened) assert.equal((await opened).status, 'committed');
        await frames(); navigating = false;
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-rail-roomy')), roomy);
        if (example.keyOpen) await host().locator('.deck-card[data-index="0"]').press('Meta+Enter');
        else await host().locator('.deck-card[data-index="0"] .deck-title').click();
        await field().waitFor();
        const before = await field().inputValue(), baseline = await current(); result.initial = { before, baseline };
        await field().press('Meta+a'); await page.keyboard.press('ArrowLeft');
        const start = example.selected === null ? 0 : before.indexOf(example.selected); assert.ok(start >= 0);
        for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight');
        for (let i = 0; i < (example.selected?.length ?? 0); i++) await page.keyboard.press('Shift+ArrowRight');
        result.selection = await field().evaluate(f => ({ text: f.value, start: f.selectionStart, end: f.selectionEnd, selected: f.value.slice(f.selectionStart, f.selectionEnd), focused: document.activeElement === f }));
        assert.equal(result.selection.selected, example.selected ?? ''); assert.equal(result.selection.focused, true);
        const firstReceipt = receipts.length;
        await page.keyboard.press('Meta+Enter'); await field().waitFor();
        result.newEditor = await field().evaluate(f => ({ text: f.value, start: f.selectionStart, end: f.selectionEnd, focused: document.activeElement === f }));
        assert.equal(result.newEditor.text, example.unchanged ? '' : example.selected, 'new editor holds the exact selected string');
        assert.equal(result.newEditor.focused, true); assert.equal(result.newEditor.start, result.newEditor.text.length); assert.equal(result.newEditor.end, result.newEditor.start);
        const expected = example.after ?? example.text, saved = await kept(expected); result.saved = saved;
        assert.deepEqual(parseDeck(saved.body).cards.map(c => c.title), example.titles);
        if (example.depths) assert.deepEqual(parseDeck(saved.body).cards.map(c => c.depth), example.depths);
        assert.equal(parseDeck(saved.body).cards.at(-1).words, 'Keep neighbor.');
        assert.equal(saved.source_ref.revision, baseline.source_ref.revision + (example.unchanged ? 0 : 1), 'one actual saved split revision, no intermediate remove/add');
        if (example.undo) {
          await page.keyboard.press('Meta+z'); await field().waitFor({ state: 'detached' });
          result.undone = await kept(example.text);
          assert.equal(result.undone.source_ref.revision, saved.source_ref.revision + 1, 'one inverse revision restores both sides');
        } else {
          await page.keyboard.press('Escape'); await field().waitFor({ state: 'detached' }); await kept(expected);
        }
        result.events = await page.evaluate(() => globalThis.split1075Events);
        assert.ok(result.events.some(e => e.key === 'Enter' && e.trusted), 'trusted native initiating Return');
        if (example.selected) assert.ok(result.events.some(e => e.key === 'ArrowRight' && e.trusted), 'trusted native selection keys');
        await page.screenshot({ path: `${evidence}/${cell}-${example.name}.png` });
        // A sheet consumes its deep-link parameter while open. Reopen that
        // original link in a new document; a bare reload is only the topic.
        navigating = true;
        if (surface === 'full') await page.reload(); else await page.goto(url);
        await page.locator('body[data-ready=true]').waitFor(); await host().locator('.deck-card[data-index="0"]').waitFor(); await frames(); navigating = false;
        result.reloaded = await kept(example.undo ? example.text : expected);
        assert.deepEqual(parseDeck(result.reloaded.body).cards.map(c => c.title), example.undo ? parseDeck(example.text).cards.map(c => c.title) : example.titles);
        assert.deepEqual(pageErrors, []); result.passed = true; result.receipts = receipts.slice(firstReceipt);
      } catch (error) {
        result.error = error.stack; result.passed = false; result.coreAtFailure = item ? await current().catch(e => ({ error: e.message })) : null;
        result.events = await page.evaluate(() => globalThis.split1075Events).catch(() => []);
        await page.screenshot({ path: `${evidence}/${cell}-${example.name}-failure.png` }).catch(() => {});
      }
      results.push(result); sample(); await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ cell, name: example.name, passed: result.passed, error: result.error?.split('\n').slice(0, 3) }));
    }
    navigating = true; const completed = await Promise.allSettled(jobs); observations.push({ cell, served: [...served], jobErrors: completed.filter(r => r.status === 'rejected').map(r => String(r.reason)) });
    assert.ok(served.has('web/deck.mjs') && served.has('web/notebook-page.mjs'));
    if (sources['web/notebook-page.mjs'].includes('selectionCardSplit')) assert.ok(served.has('web/notebook-card-split.mjs'));
    assert.ok(completed.every(r => r.status === 'fulfilled')); await context.close();
  }
} catch (error) { fatal = error.stack; }
finally {
  clearInterval(sampler); if (browser) { sample(); await browser.close(); cleanup.browserClose = true; }
  cleanup.disconnected = !browser || !browser.isConnected(); fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const live = processes(); cleanup.remainingOwnedIdentities = live.filter(row => owned.has(row.key)).map(({ pid, started, commandSHA256 }) => ({ pid, started, commandSHA256 }));
  cleanup.matchingProfileProcesses = live.filter(row => profile && row.command.includes(profile)).map(({ pid, started, commandSHA256 }) => ({ pid, started, commandSHA256 }));
  cleanup.profile = profile; cleanup.owned = [...owned.values()];
  if (profile && cleanup.disconnected && !cleanup.remainingOwnedIdentities.length && !cleanup.matchingProfileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : true;
  cleanup.tcp = origin ? await new Promise(resolve => { const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port }); socket.once('connect', () => { socket.destroy(); resolve({ refused: false }); }); socket.once('error', e => resolve({ refused: e.code === 'ECONNREFUSED', code: e.code })); }) : null;
  cleanup.origin = origin;
  const end = Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await readFile(name))])));
  cleanup.sourceUnchanged = names.every(name => end[name] === hash(sources[name]));
  await writeFile(`${evidence}/native.json`, JSON.stringify({ engine, results, observations, navigationErrors, fatal, cleanup, end, limits: 'Desktop headless1280×960, Compact/Roomy and light/dark, full/sheet; no physical-device/IME/performance claim.500ms owned descendant identity sampling and boundary checks are not exhaustive process history.' }, null, 2));
}
assert.equal(cleanup.browserClose, true); assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureExit.signal, null);
assert.equal(cleanup.fixtureErrors, ''); assert.deepEqual(cleanup.remainingOwnedIdentities, []); assert.deepEqual(cleanup.matchingProfileProcesses, []); assert.equal(cleanup.profileAbsent, true); assert.equal(cleanup.tcp?.refused, true); assert.equal(cleanup.sourceUnchanged, true);
assert.equal(fatal, undefined); assert.ok(results.length && results.every(r => r.passed), 'inspect retained selected-text/native failures');
