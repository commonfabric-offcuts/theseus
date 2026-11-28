// Real Team controls against scratch Core/HTTP/runner; native model protocol is synthetic.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { scopedChangesPage } from '../web/freshness.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const output = path.resolve(process.argv[2]); await mkdir(output, { recursive: true });
const { chromium, webkit } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engines = process.env.AIM_SEAT_ENGINE ? [process.env.AIM_SEAT_ENGINE] : process.env.AIM_SEAT_SMOKE ? ['chromium'] : ['chromium', 'webkit'];
const hash = text => createHash('sha256').update(text).digest('hex');
const sourceFiles = ['aim_next/hosted_seats.py', 'aim_next/seat_host.py', 'aim_next/effects_runner.py', 'aim_next/runner.py',
  'aim_next/codex_host.py', 'aim_next/store.py', 'aim_next/migrations.py', 'aim_next/validation.py', 'aim_next/cli.py', 'tools/deploy.py',
  'web/headless-seat.mjs', 'web/seat-journal.mjs', 'web/outcome-page-layout.mjs', 'web/app.mjs', 'web/outcome-refresh.mjs', 'web/people.mjs', 'web/aim.css',
  'tests/headless_seat_1002_native.mjs', 'tests/fixtures/headless_seat_1002.py', 'tests/fixtures/fake_codex_app_server.py', 'docs/headless-seat-1002.md'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(path.join(root, name)))])));
const result = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source_files: sourceHashes,
  cases: [], errors: [], cleanup: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (act, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  do { const value = await act(); if (value) return value; await wait(50); } while (Date.now() < end);
  throw Error('No observed ' + label);
};
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n')
  .map(line => { const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return match && { pid: +match[1], parent: +match[2], command: match[3] }; }).filter(Boolean);
const present = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
// Each isolated instance stays below the production cap8; all32 matrix cells remain.
const batches = engines.flatMap(engine => (process.env.AIM_SEAT_LAYOUT_ONLY || process.env.AIM_SEAT_SMOKE || process.env.AIM_SEAT_RECOVERY_ONLY ? [0] : [0, 1, 2]).map(batch => ({ engine, batch })));
for (const { engine, batch } of batches) {
  const fixtureName = engine + (batch ? '-batch-' + batch : '') + '-fixture';
  const fixture = spawn('/usr/bin/python3', ['-I', path.join(root, 'tests/fixtures/headless_seat_1002.py'), path.join(output, fixtureName)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const channel = fixtureControl(fixture); let browser, persistent, profile, info, tracker; const pids = new Set(), errors = [];
  const phases = new WeakMap();
  const watchPage = page => {
    phases.set(page, 'active');
    page.on('pageerror', error => {
      const phase = phases.get(page), firstLine = error.stack?.split('\n')[0] ?? '';
      const detail = { message: error.message, stack: error.stack, phase };
      // Same narrow leaving-page allowance as the existing native WebKit
      // harnesses. An active-page error, another engine or another diagnostic
      // still fails. Every allowed cancellation is retained.
      if (engine === 'webkit' && phase === 'leaving' && /^Fetch API cannot load \S+ due to access control checks\.$/.test(firstLine)) {
        result.leaving_read_cancellations ??= []; result.leaving_read_cancellations.push(detail);
      } else errors.push(detail);
    });
    return page;
  };
  const closePage = async page => { phases.set(page, 'leaving'); await page.close(); };
  const observe = () => {
    const rows = processes(); let changed = true;
    for (const row of rows) if (profile && row.command.includes(profile)) pids.add(row.pid);
    while (changed) { changed = false; for (const row of rows) if (pids.has(row.parent) && !pids.has(row.pid)) { pids.add(row.pid); changed = true; } }
  };
  try {
    info = await channel.control({ method: 'info' });
    profile = await mkdtemp(path.join(os.tmpdir(), 'theseus-seat-1002-' + engine + '-'));
    persistent = await ({ chromium, webkit }[engine]).launchPersistentContext(profile, {
      headless: true, ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}), viewport: { width: 1280, height: 900 },
    });
    browser = persistent.browser(); assert.ok(browser, 'an owned browser supports Browser.close');
    result.browsers ??= []; result.browsers.push({ engine, version: browser.version() });
    observe(); tracker = setInterval(observe, 200);
    const allSpecs = process.env.AIM_SEAT_LAYOUT_ONLY || process.env.AIM_SEAT_RECOVERY_ONLY ? [] : process.env.AIM_SEAT_SMOKE ? [{ width: 320, theme: 'dark', look: 'paper' }] :
      [1280, 390, 375, 320].flatMap(width => ['light', 'dark'].flatMap(theme => ['', 'paper'].map(look => ({ width, theme, look }))));
    const specs = process.env.AIM_SEAT_SMOKE || process.env.AIM_SEAT_RECOVERY_ONLY ? allSpecs : allSpecs.slice(batch * 6, batch * 6 + 6);
    let serial = batch * 6;
    const prepare = async (context, workspace, spec) => {
      await channel.control({ method: 'workspace', workspace });
      await context.addInitScript(look => {
        look ? localStorage.setItem('theseus-look', look) : localStorage.removeItem('theseus-look');
        window.seatTrusted = [];
        window.seatStorage = { puts: [], committed: [], aborted: [] };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...rest) {
          if (this.name === 'drafts' && value?.form && value?.key) {
            const observed = { revision: value.revision, name: value.form.name, role: value.form.role.slice(0, 80) };
            seatStorage.puts.push(observed);
            this.transaction.addEventListener('complete', () => seatStorage.committed.push(observed));
            this.transaction.addEventListener('abort', () => seatStorage.aborted.push(observed));
          }
          return put.call(this, value, ...rest);
        };
        for (const type of ['input', 'click', 'focus', 'blur']) addEventListener(type, event => window.seatTrusted.push({ type,
          trusted: event.isTrusted, id: event.target.id, value: event.target.value, active: document.activeElement?.id }), true);
      }, spec.look);
      const page = watchPage(await context.newPage());
      await page.emulateMedia({ colorScheme: spec.theme });
      await page.goto(info.origin + '/?workspace=' + workspace);
      await page.locator('body[data-ready=true]').waitFor();
      const agents = page.locator('#outcome-tab-agents');
      if (await agents.isVisible()) await agents.click();
      await page.locator('#team-people .add-chip').waitFor({ state: 'visible' });
      return page;
    };
    const press = async (page, selector, touch) => { const target = page.locator(selector); touch ? await target.tap() : await target.click(); };
    const open = async (page, touch) => {
      await press(page, '#team-people .add-chip', touch);
      await press(page, '#add-headless-seat', touch);
      await page.locator('#headless-seat-role:not([readonly])').waitFor();
    };
    const type = async (page, selector, text, touch) => {
      await press(page, selector, touch); await page.keyboard.press('Meta+A'); await page.keyboard.insertText(text);
    };
    for (const spec of specs) {
      const row = { engine, ...spec, workspace: 'seat-' + engine + '-' + (++serial) }; result.cases.push(row);
      const touch = spec.width < 800;
      const context = await browser.newContext({ viewport: { width: spec.width, height: 900 }, hasTouch: touch, isMobile: engine === 'chromium' && touch });
      const page = await prepare(context, row.workspace, spec);
      try {
        const beforeTopic = await channel.control({ method: 'changes', workspace: row.workspace });
        await open(page, touch);
        assert.match(await page.locator('.seat-access').innerText(), /full access on this Mac.*sub-agents/);
        const name = 'Fixture ' + engine + ' ' + serial;
        const first = 'Keep Δ bytes exactly.  ';
        await type(page, '#headless-seat-name', name, touch);
        await type(page, '#headless-seat-role', first, touch);
        await page.keyboard.press('Enter'); await page.keyboard.insertText('Second line.');
        const role = first + '\nSecond line.';
        assert.equal(await page.locator('#headless-seat-role').inputValue(), role, 'native Return inserts a newline');
        assert.match(await page.locator('#headless-seat-model option:checked').innerText(), /^Template default · /);
        assert.match(await page.locator('#headless-seat-reasoning_effort option:checked').innerText(), /^Template default · /);
        assert.equal((await channel.control({ method: 'inspect', workspace: row.workspace })).seats.length, 0);
        const geometry = await page.locator('.seat-form').evaluate(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1 && !geometry.overflow, JSON.stringify(geometry));
        const button = await page.locator('#headless-seat-submit').boundingBox(); assert.ok(button.height >= 44 && button.width >= 44);
        row.geometry = geometry; row.role_sha256 = hash(role);
        await page.screenshot({ path: path.join(output, engine + '-' + serial + '-form.png'), fullPage: true });
        if (serial % 2) await press(page, '#headless-seat-submit', touch);
        else {
          for (const id of ['headless-seat-model', 'headless-seat-reasoning_effort', 'headless-seat-submit']) {
            await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), id);
          }
          await page.keyboard.press('Enter');
        }
        const state = await until(async () => {
          const state = await channel.control({ method: 'inspect', workspace: row.workspace });
          return state.seats.length === 1 && state.messages.some(message => message[0] === state.seats[0][1]) && state;
        }, 'actual fixture seat hello', 30000);
        assert.equal(state.seats[0][2], 'ready'); assert.equal(state.seats[0][5], role); assert.equal(state.routes_unchanged, true);
        assert.equal(state.messages.filter(message => message[0] === 'lead').length, 1);
        assert.equal(state.messages.filter(message => message[0] === state.seats[0][1]).length, 1);
        assert.equal(state.messages.find(message => message[0] === state.seats[0][1])[2], state.seats[0][7]);
        await until(async () => (await page.locator('.seat-statuses').innerText()).includes('Ready'), 'actual Live Team progress');
        row.trusted = await page.evaluate(() => seatTrusted);
        assert.ok(row.trusted.length && row.trusted.every(event => event.trusted), 'all Team input is native');
        const afterTopic = await channel.control({ method: 'changes', workspace: row.workspace, cursor: beforeTopic.page.checkpoint });
        scopedChangesPage(afterTopic.page, afterTopic.bootstrap, afterTopic.page.scope, beforeTopic.page.checkpoint);
        assert.ok(afterTopic.page.items.some(item => item.resource_kind === 'topic'), 'topic progress includes the real first task and hello');
        row.topic_reader = { before: beforeTopic.page.checkpoint, after: afterTopic.page, accepted: true };
        row.state = state; row.passed = true;
        await page.screenshot({ path: path.join(output, engine + '-' + serial + '-ready.png'), fullPage: true });
      } finally { phases.set(page, 'leaving'); await context.close(); }
    }
    if (batch === 2 || process.env.AIM_SEAT_LAYOUT_ONLY || process.env.AIM_SEAT_SMOKE) {
      const held = watchPage(await persistent.newPage());
      await held.goto(info.origin + '/outcome-page-layout.mjs');
      await held.evaluate(async () => {
        const { OutcomePageLayout } = await import('/outcome-page-layout.mjs');
        const host = document.createElement('main'), team = document.createElement('section'), role = document.createElement('textarea');
        role.id = 'held-layout-role'; team.append(role); host.append(team); document.body.replaceChildren(host);
        window.heldSeatLayout = new OutcomePageLayout({ host, team, reader: 'fixture', color: () => '', cards: { filter() {} } });
      });
      await held.locator('#held-layout-role').click(); await held.keyboard.insertText('Kept');
      await held.evaluate(() => heldSeatLayout.setPurpose(null));
      assert.equal(await held.evaluate(() => document.activeElement?.id), 'held-layout-role', 'a workspace repaint must retain native Team input focus');
      await held.keyboard.insertText(' newest');
      assert.equal(await held.locator('#held-layout-role').inputValue(), 'Kept newest');
      result.cases.push({ engine, name: 'same-parent-Team-repaint-retains-native-writing-focus', passed: true });
      await closePage(held);
    }
    if (!process.env.AIM_SEAT_LAYOUT_ONLY && (batch === 2 || process.env.AIM_SEAT_SMOKE || process.env.AIM_SEAT_RECOVERY_ONLY)) {
    // Durable native IndexedDB, lost committed response, newer typing, whole page close/reopen.
    const spec = { width: 1280, theme: 'light', look: '' }, workspace = 'recover-' + engine;
    const page = await prepare(persistent, workspace, spec); await open(page, false);
    await type(page, '#headless-seat-name', 'Recover ' + engine, false);
    const role = 'Exact durable Δ role.\n  Keep spaces.';
    await type(page, '#headless-seat-role', role, false);
    let release, arrived;
    const held = new Promise(resolve => { arrived = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    let original;
    await page.route('**/api/command', async route => {
      const request = route.request().postDataJSON();
      if (request.kind !== 'workspace.hosted_seat_add') return route.continue();
      original = request;
      await route.fetch(); arrived(); await released;
      await route.abort('failed');
    });
    await press(page, '#headless-seat-submit', false); await held;
    const newer = 'Newer unsent role stays.';
    await type(page, '#headless-seat-role', newer, false); release();
    await page.locator('#headless-seat-retry:not([disabled])').waitFor();
    const recoveryProof = { engine, name: 'durable recovery observations', passed: false,
      observed: await page.evaluate(() => ({ role: document.querySelector('#headless-seat-role').value,
        focus: document.activeElement?.id, events: seatTrusted, storage: seatStorage })) };
    result.recovery_observations ??= []; result.recovery_observations.push(recoveryProof);
    assert.equal(recoveryProof.observed.role, newer, 'native typing reached the role field without focus loss');
    const keptDraft = () => page.evaluate(async () => {
      const { openSeatJournal } = await import('/seat-journal.mjs');
      const bootstrap = await (await fetch('/api/bootstrap', { headers: { Authorization: 'Bearer ' + document.querySelector('meta[name="aim-next-session"]').content, 'X-AIM-Read-Class': 'foreground' } })).json();
      const journal = await openSeatJournal(bootstrap, new URL(location).searchParams.get('workspace'));
      const row = await journal.get(); journal.close(); return row;
    });
    const firstKept = await keptDraft();
    recoveryProof.first_kept_form = firstKept.form;
    recoveryProof.first_kept_revision = firstKept.revision;
    recoveryProof.after_read = await page.evaluate(() => ({ role: document.querySelector('#headless-seat-role').value,
      focus: document.activeElement?.id, events: seatTrusted, storage: seatStorage }));
    // An input handler queues an asynchronous strict transaction. API idleness
    // does not establish its commit; close only after reading the exact kept
    // bytes, without repeating a gesture or changing the input to make it pass.
    const digestBefore = await until(async () => {
      const kept = await keptDraft(); return kept.form.role === newer && kept;
    }, 'actual device commit of newer typing');
    assert.deepEqual(digestBefore.request, original); assert.equal(digestBefore.form.role, newer);
    assert.equal(await page.locator('#headless-seat-role').inputValue(), newer);
    await closePage(page);
    const reopened = watchPage(await persistent.newPage()); await reopened.goto(info.origin + '/?workspace=' + workspace);
    await until(async () => (await reopened.locator('.headless-seats .notice').innerText()).includes('unconfirmed'), 'unconfirmed Add visible before opening its form');
    await open(reopened, false);
    assert.equal(await reopened.locator('#headless-seat-role').inputValue(), newer);
    await press(reopened, '#headless-seat-retry', false);
    await until(async () => (await reopened.locator('#headless-seat-retry').isHidden()), 'same committed operation lookup');
    const state = await channel.control({ method: 'inspect', workspace });
    assert.equal(state.seats.length, 1); assert.equal(state.seats[0][5], role);
    assert.equal(await reopened.locator('#headless-seat-role').inputValue(), newer);
    // A stale writer gets an explicit refusal, preserving the authoritative bytes.
    const storage = await reopened.evaluate(async () => {
      const { openSeatJournal } = await import('/seat-journal.mjs');
      const bootstrap = await (await fetch('/api/bootstrap', { headers: { Authorization: 'Bearer ' + document.querySelector('meta[name="aim-next-session"]').content, 'X-AIM-Read-Class': 'foreground' } })).json(), workspace = new URL(location).searchParams.get('workspace');
      const one = await openSeatJournal(bootstrap, workspace), two = await openSeatJournal(bootstrap, workspace);
      const before = await one.get();
      const next = await one.put({ ...before, form: { name: 'Writer A', role: 'Kept by the winning writer.' } }, before.revision);
      let refusal;
      try { await two.put({ ...before, form: { name: 'Writer B', role: 'Must not overwrite.' } }, before.revision); } catch (error) { refusal = error.message; }
      const after = await one.get();
      const largeRole = 'K' + '\n'.repeat(16383);
      const large = { ...after, form: { name: 'Large next role', role: largeRole }, request: {
        v: 1, instance_id: bootstrap.instance_id, operation_id: 'idb-only-large-role', kind: 'workspace.hosted_seat_add',
        target: { workspace_id: workspace }, expected: { workspace_revision: 0, authority: {
          authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch } },
        args: { name: 'Large sent role', role: largeRole } } };
      await one.put(large, after.revision);
      const recovered = await two.get();
      const fullRole = { form_bytes: new TextEncoder().encode(recovered.form.role).length,
        request_bytes: new TextEncoder().encode(recovered.request.args.role).length,
        exact: recovered.form.role === largeRole && recovered.request.args.role === largeRole };
      one.close(); two.close(); return { next, refusal, after, fullRole };
    });
    assert.match(storage.refusal, /another tab/); assert.deepEqual(storage.after, storage.next);
    assert.deepEqual(storage.fullRole, { form_bytes: 16384, request_bytes: 16384, exact: true });
    result.cases.push({ engine, name: 'durable-lost-answer-close-reopen-CAS', passed: true,
      original, retained_sha256: hash(JSON.stringify(digestBefore)), storage, state });
    await closePage(reopened);
    // An opaque saved row must be preserved, with publication blocked and
    // new writing still held in the visible fields instead of a null crash.
    const brokenWorkspace = 'unreadable-' + engine;
    const broken = await prepare(persistent, brokenWorkspace, spec);
    const opaqueBefore = await broken.evaluate(async () => {
      const bootstrap = await (await fetch('/api/bootstrap', { headers: { Authorization: 'Bearer ' + document.querySelector('meta[name="aim-next-session"]').content, 'X-AIM-Read-Class': 'foreground' } })).json();
      const key = JSON.stringify([bootstrap.instance_id, bootstrap.actor, bootstrap.authority.authority_id,
        bootstrap.authority.authority_epoch, new URL(location).searchParams.get('workspace')]);
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('theseus-seat-add', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const row = { key, v: 99, revision: 1, opaque: 'Keep these unknown original bytes.' };
      await new Promise((resolve, reject) => { const tx = database.transaction('drafts', 'readwrite', { durability: 'strict' });
        tx.objectStore('drafts').put(row); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      database.close(); return JSON.stringify(row);
    });
    phases.set(broken, 'leaving'); await broken.reload();
    await open(broken, false);
    phases.set(broken, 'active');
    await until(async () => (await broken.locator('.headless-seats .notice').innerText()).includes('kept'), 'named unreadable saved request');
    assert.equal(await broken.locator('#headless-seat-submit').isDisabled(), true, 'unreadable saved request blocks publication');
    await type(broken, '#headless-seat-name', 'Unsaved name', false);
    await type(broken, '#headless-seat-role', 'Keep this visible writing.', false);
    assert.equal(await broken.locator('#headless-seat-role').inputValue(), 'Keep this visible writing.');
    assert.equal((await channel.control({ method: 'inspect', workspace: brokenWorkspace })).seats.length, 0);
    const opaqueAfter = await broken.evaluate(async () => {
      const database = await new Promise(resolve => { const request = indexedDB.open('theseus-seat-add', 1); request.onsuccess = () => resolve(request.result); });
      const rows = await new Promise(resolve => { const request = database.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); });
      database.close(); return JSON.stringify(rows.find(row => row.v === 99));
    });
    assert.equal(opaqueAfter, opaqueBefore, 'the original unreadable record remains byte exact');
    result.cases.push({ engine, name: 'unreadable-device-row-refuses-without-overwrite', passed: true, opaque_sha256: hash(opaqueAfter) });
    await closePage(broken);
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
  } catch (error) {
    result.errors.push({ engine, error: error.stack });
  } finally {
    if (tracker) clearInterval(tracker);
    if (browser) { observe(); await browser.close(); }
    const absent = await until(() => [...pids].every(pid => !present(pid)), 'every owned browser PID absent', 10000).catch(() => false);
    assert.equal(absent, true, 'owned browser cleanup must finish');
    if (profile) {
      assert.ok(!processes().some(row => row.command.includes(profile)));
      await rm(profile, { recursive: true });
    }
    fixture.stdin.end(); const ended = await channel.exit;
    assert.equal(ended.code, 0, channel.errors()); assert.equal(present(fixture.pid), false);
    const cleanup = JSON.parse(await readFile(path.join(output, fixtureName, 'cleanup.json'), 'utf8'));
    result.cleanup.push({ engine, batch, pids: [...pids], all_absent: absent, browser_close: true, profile_removed: true, fixture_exit: ended, ...cleanup });
    await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  }
}
assert.deepEqual(result.errors, [], 'native cases failed; see retained results.json');
for (const name of sourceFiles) assert.equal(hash(await readFile(path.join(root, name))), sourceHashes[name], 'source unchanged through native run: ' + name);
console.log(JSON.stringify({ passed: result.cases.length, cleanup: result.cleanup.length, output }));
