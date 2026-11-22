// Real Core/HTTP rail records, actual browser keys and exposed selection geometry.
// Initial focus and the separately labelled boundary probes use focus setup.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_BROWSER ?? 'chromium', out = process.argv[2];
const preflight = process.argv.includes('--preflight'), grammar = process.argv.includes('--grammar');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['web/things-rail.mjs', 'web/key-tree.mjs', 'web/reveal.mjs',
  'web/arrow-reach.mjs', 'web/panes.mjs', 'web/pane-keys.mjs',
  'web/archive-shelf.mjs', 'web/archive-shelf.css', 'web/rails.css',
  'web/image-pick.mjs', 'web/image-rail-menu.mjs', 'web/aim.css', 'web/look.css',
  'web/index.html', 'tests/fixtures/ui_http.py', 'tests/fixture_control.mjs',
  'tests/visible_rail_cursor_1048_1034_native.mjs'];
await mkdir(out, { recursive: true });
const hashes = {};
for (const path of files) {
  const bytes = await readFile(path); hashes[path] = sha(bytes);
  await mkdir(out + '/source-bytes/' + path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(out + '/source-bytes/' + path, bytes);
}
await writeFile(out + '/source.json', JSON.stringify({
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes,
}, null, 2));
const load = () => Number(execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).match(/load averages?:\s*([0-9.]+)/)?.[1]);
assert.ok(load() < 12, 'one owned workload, load below12/18');
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live', '--images', '--media']);
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
  const topic = 'cursor1048';
  const noImagesTopic = 'cursor1048-noimages';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Images and Archive cursor1048' }] });
  assert.equal((await control({ method: 'agent_message', operation_id: 'cursor1048-join', topic_id: topic,
    source: 'topic', join: true, member: true, body: 'Isolated Notebook and cursor source.',
    divergence_reason: 'Fixture introduction to its new isolated topic.', read: true })).status, 'committed');
  await control({ method: 'seed', topic_id: topic, memory_items: 1 });
  const archiveIds = [];
  for (let n = 0; n < 20; n++) {
    const result = await control({ method: 'agent_message', operation_id: 'cursor1048-archive-' + n,
      topic_id: topic, source: 'topic', sender: 'person', read: true,
      body: 'Archived cursor dossier ' + n + '. Real retained words.' });
    assert.equal(result.status, 'committed'); archiveIds.push(result.result.message_id);
  }
  const messages = await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: topic, direction: 'before', limit: 50 } });
  await writeFile(out + '/seed-messages.json', JSON.stringify(messages, null, 2));
  for (const id of archiveIds) {
    const message = messages.items.find(each => each.id === id); assert.ok(message);
    const result = await control({ method: 'stack_act', sender: facts.actor,
      kind: 'stack.aside', operation_id: 'cursor1048-aside-' + id, message_id: id, args: { through: message.seq } });
    assert.equal(result.status, 'committed');
  }
  const imageMessages = [];
  for (let batch = 0; batch < 3; batch++) {
    const imageResult = await control({ method: 'agent_message', operation_id: 'cursor1048-images-' + batch,
      topic_id: topic, source: 'topic', sender: 'person', read: true, body: 'Images for visible cursor1048, batch ' + batch,
      attachments: Array.from({ length: 7 }, (_, i) => ({ name: 'cursor1048-' + (batch * 7 + i) + '.png', png: [48 + batch * 7 + i, 36] })) });
    assert.equal(imageResult.status, 'committed'); imageMessages.push(imageResult.result.message_id);
  }
  await writeFile(out + '/seed-identities.json', JSON.stringify({ topic, archiveIds, imageMessages }, null, 2));
  if (grammar) {
    // Actual Core piece in another topic draws Pipeline below Images without
    // inventing nodes or adding a Waiting section to the topic under test.
    await control({ method: 'navigation_topics', topics: [
      { id: topic, title: 'Images and Archive cursor1048' },
      { id: noImagesTopic, title: 'Archive with no Images' }] });
    await control({ method: 'light_outcome', exists: true, outcome: 'w1', title: 'Isolated outcome',
      topic: { id: 'cursor1048-build', title: 'Real intervening Pipeline topic' } });
    const pipe = (suffix, kind, args) => control({ method: 'pipeline', kind,
      operation_id: 'cursor1048-pipe-' + suffix, target: { workspace_id: 'w1' }, args });
    const receipts = [];
    receipts.push(await pipe('on', 'pipeline.configure', { enabled: true }));
    receipts.push(await pipe('stages', 'pipeline.stages_set', { stages: [{ stage_id: 'build', name: 'Build' }] }));
    const item = await pipe('item', 'pipeline.item_add', { title: 'Intervening Pipeline check', section: 'now', size: 'small', sources: [{ note: 'Isolated cursor fixture' }] });
    receipts.push(item);
    receipts.push(await pipe('start', 'pipeline.piece_start', { numbers: [item.result.number], topic_id: 'cursor1048-build', stage_id: 'build' }));
    for (const receipt of receipts) assert.equal(receipt.status, 'committed');
    await writeFile(out + '/pipeline-receipts.json', JSON.stringify(receipts, null, 2));
    for (let n = 0; n < 4; n++) {
      const made = await control({ method: 'agent_message', operation_id: 'cursor1048-noimages-' + n,
        topic_id: noImagesTopic, source: 'topic', sender: 'person', read: true, body: 'No Images archived dossier ' + n });
      assert.equal(made.status, 'committed');
    }
    const originals = await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: noImagesTopic, limit: 50 } });
    for (const message of originals.items) assert.equal((await control({ method: 'stack_act', sender: facts.actor,
      kind: 'stack.aside', operation_id: 'cursor1048-noimages-aside-' + message.id,
      message_id: message.id, args: { through: message.seq } })).status, 'committed');
    await writeFile(out + '/noimages-originals.json', JSON.stringify(originals, null, 2));
  }
  profile = await mkdtemp(out + '/' + engine + '-profile-');
  await resources('profile created before browser launch');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); assert.ok(owned.size);
  await resources('browser launched');
  await writeFile(out + '/launch-processes.json', JSON.stringify(ps().filter(p => owned.has(p.pid)), null, 2));
  const cells = preflight ? [[1280, 'bookends', 'light']] : grammar ? [[1280, 'bookends', 'light'], [1280, 'paper', 'dark']] : [1280, 390].flatMap(width =>
    ['bookends', 'paper'].flatMap(look => ['light', 'dark'].map(theme => [width, look, theme])));
  for (const [width, look, theme] of cells) {
    assert.ok(load() < 12); const key = `${width}-${look}-${theme}`;
    const row = { key, width, look, theme, checks: [], observations: [], errors: [], served: {}, executed: {}, captureErrors: [] }; rows.push(row);
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
    const snap = () => page.evaluate(() => {
      const rect = el => el?.isConnected && el.getClientRects().length ? el.getBoundingClientRect().toJSON() : null;
      const active = document.activeElement, tile = active?.closest('[data-rail-image]'), shelfItem = active?.closest('.shelf-dossier');
      const rail = document.querySelector('#things'), shelf = document.querySelector('#archive-shelf');
      const shelfShown = !!shelf && !shelf.hidden && getComputedStyle(shelf).visibility === 'visible';
      const grid = [...document.querySelectorAll('#things [data-rail-image]')].map(el => ({ id: el.dataset.railImage, rect: rect(el) }));
      const shelfItems = [...document.querySelectorAll('#archive-shelf .shelf-dossier')].map(el => ({ id: el.dataset.id, rect: rect(el) }));
      const target = tile ?? shelfItem ?? active, box = rect(target), railBox = rect(rail), shelfBox = shelfShown ? rect(shelf) : null;
      const upper = Math.max(0, railBox?.top ?? 0, shelfItem ? shelfBox?.top ?? 0 : 0);
      const lower = Math.min(innerHeight, railBox?.bottom ?? innerHeight, tile && shelfBox ? shelfBox.top : innerHeight);
      const probes = box && box.width > 0 && box.height > 0 ? [box.top + 3, (box.top + box.bottom) / 2, box.bottom - 3].map(y => {
        const x = (box.left + box.right) / 2, at = document.elementFromPoint(x, y);
        return { x, y, hit: at?.tagName, inside: !!at && (target === at || target.contains(at)) };
      }) : [];
      return { active: { tag: active.tagName, className: active.className, image: tile?.dataset.railImage,
        shelf: shelfItem?.dataset.id, href: active.getAttribute('href'), section: active.closest('.things-sec')?.dataset.key,
        feed: !!active.closest('#main'), focusVisible: active.matches(':focus-visible'), tabIndex: active.tabIndex },
        grid, shelfItems, box, railBox, shelfBox, shelfShown, railTop: rail.scrollTop,
        shelfTop: shelf?.scrollTop ?? null, shelfMax: shelf ? shelf.scrollHeight - shelf.clientHeight : null,
        visible: !!box && box.width > 0 && box.height > 0 && box.top >= upper - 1 && box.bottom <= lower + 1 &&
          box.left >= Math.max(0, railBox?.left ?? 0) - 1 && box.right <= Math.min(innerWidth, railBox?.right ?? innerWidth) + 1 && probes.every(p => p.inside),
        viewport: { width: innerWidth, height: innerHeight }, lastKeyDefaultPrevented: window.cursorKeyEvents.at(-1)?.defaultPrevented ?? null,
        rovingRows: [...document.querySelectorAll('#things [role=treeitem][tabindex=\"0\"]')].map(el => ({ shelf: el.dataset.id, image: el.dataset.railImage, section: el.closest('.things-sec')?.dataset.key })),
        upper, lower, probes, roving: [...document.querySelectorAll('#things [role=treeitem][tabindex="0"]')].map(el => el.className),
        pageY: scrollY };
    });
    const record = async phase => {
      const s = await snap(); row.observations.push({ phase, ...s });
      if (width === 1280 && ['image Down 3', 'past final Images row', 'Up from first Archive row'].includes(phase)) {
        await page.screenshot({ path: out + '/' + key + '-' + phase.replaceAll(' ', '-') + '.png' });
      }
      return s;
    };
    const press = async key => { await page.keyboard.press(key); await page.evaluate(() => new Promise(r => requestAnimationFrame(r))); };
    const focusImage = async id => page.locator(`#things [data-rail-image="${id}"]`).focus();
    try {
      await page.goto(origin + '/?topic=' + topic); await page.locator('body[data-ready=true]').waitFor();
      if (width === 390) { await page.locator('#things-open').click(); await page.waitForFunction(() => getComputedStyle(document.querySelector('#things')).transform === 'none'); }
      await page.waitForFunction(() => document.querySelectorAll('#things [data-rail-image]').length >= 20 &&
        [...document.querySelectorAll('#things img.image-thumb')].every(el => !el.hidden));
      if (width === 1280) await page.locator('#archive-shelf:not([hidden]) .shelf-dossier').last().waitFor({ state: 'attached' });
      for (const path of files.filter(f => f.startsWith('web/') && f !== 'web/index.html')) {
        const url = await page.evaluate(name => performance.getEntriesByType('resource').find(r => new URL(r.name).pathname.endsWith('/' + name))?.name, path.split('/').at(-1));
        assert.ok(url, 'actual loaded owner ' + path); const bytes = await (await page.request.get(url)).body();
        assert.equal(sha(bytes), hashes[path]); row.served[path] = sha(bytes);
        await mkdir(out + '/served-bodies', { recursive: true }); await writeFile(out + '/served-bodies/' + sha(bytes), bytes);
      }
      await Promise.all(captured); assert.deepEqual(row.captureErrors, []);
      for (const path of Object.keys(row.served)) assert.equal(row.executed[path]?.sha256, hashes[path], 'captured original page response ' + path);
      let s = await record('ready');
      if (grammar) {
        await page.locator('#things .things-sec[data-key=pipeline]:not([hidden]) .pipe-open').waitFor();
        const pipeSummary = page.locator('#things .things-sec[data-key=pipeline]>summary');
        const pipeLastHref = await page.locator('#things .things-sec[data-key=pipeline] .pipe-open').getAttribute('href');
        const toggleImages = async () => {
          // Disclosure focus is setup; native wheel first exposes it so the
          // page Return owner can recognise the actual visible control.
          const b = await page.locator('#things').boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + 80); await page.mouse.wheel(0, -100000);
          await page.waitForFunction(() => document.querySelector('#things').scrollTop === 0);
          const was = await page.locator('#things [data-key=images]').evaluate(el => el.open);
          await page.locator('#things [data-key=images] .things-disclosure').focus();
          await record('visible Images disclosure focus setup'); await press('Enter');
          await page.waitForFunction(open => document.querySelector('#things [data-key=images]').open === open, !was);
        };
        const lastImage = s.grid.at(-1).id;
        await focusImage(lastImage); await record('Pipeline boundary Images focus setup');
        await press('ArrowDown'); s = await record('Images Down to intervening Pipeline');
        check('Images Down preserves intervening Pipeline heading', () => assert.equal(s.active.section, 'pipeline'));
        check('Pipeline heading is exposed above actual shelf', () => assert.equal(s.visible, true));
        const firstArchiveIds = s.shelfItems.slice(0, 2).map(el => el.id);
        for (const id of firstArchiveIds) {
          await page.locator(`#archive-shelf .shelf-dossier[data-id="${id}"]`).focus(); await record('Pipeline boundary Archive focus setup ' + id);
          await press('ArrowUp'); s = await record('Archive Up to preceding Pipeline row ' + id);
          check('every first-row Archive column exits to Pipeline ' + id, () => assert.equal(s.active.href, pipeLastHref));
          check('moving Archive boundary consumes key ' + id, () => assert.equal(s.lastKeyDefaultPrevented, true));
          check('Pipeline row exposed from Archive Up ' + id, () => assert.equal(s.visible, true));
        }
        // Put the actual final visual row on screen with a trusted wheel.
        let b = s.shelfBox; await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2); await page.mouse.wheel(0, 100000);
        await page.waitForFunction(() => { const el = document.querySelector('#archive-shelf'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 1; });
        s = await snap(); const lastShelfTop = s.shelfItems.at(-1).rect.top;
        for (const item of s.shelfItems.filter(el => Math.abs(el.rect.top - lastShelfTop) < 1)) {
          await page.locator(`#archive-shelf .shelf-dossier[data-id="${item.id}"]`).focus(); const before = await record('last Archive row focus setup ' + item.id);
          await press('ArrowDown'); const after = await record('last Archive row no exit Down ' + item.id);
          check('each final Archive column stays with no exit ' + item.id, () => assert.equal(after.active.shelf, item.id));
          check('no-exit Archive stay prevents the native default ' + item.id, () => assert.equal(after.lastKeyDefaultPrevented, true));
          check('no-exit Archive stay keeps its exposed scroll position ' + item.id, () => {
            assert.equal(after.visible, true);
            assert.deepEqual([after.pageY, after.railTop, after.shelfTop], [before.pageY, before.railTop, before.shelfTop]);
          });
        }
        b = (await snap()).shelfBox; await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2); await page.mouse.wheel(0, -100000);
        await page.waitForFunction(() => document.querySelector('#archive-shelf').scrollTop === 0);
        await page.locator('#archive-shelf .shelf-dossier').first().focus(); await press('ArrowRight');
        const kept = await record('dossier2 before whole shelf hide'); row.resizeKept = kept.active.shelf;
        check('resize probe starts on the second actual dossier', () => assert.equal(row.resizeKept, kept.shelfItems[1].id));
        await page.setViewportSize({ width: 1000, height: 800 });
        await page.waitForFunction(() => document.querySelector('#archive-shelf').hidden); const hidden = await record('whole shelf hidden at1000');
        check('resize actually hides the whole shelf', () => assert.equal(hidden.shelfShown, false));
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => !document.querySelector('#archive-shelf').hidden);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(r))); const shown = await record('whole shelf shown at1280');
        check('whole shelf return keeps dossier2 roving identity', () => assert.ok(shown.rovingRows.some(el => el.shelf === row.resizeKept)));
        await page.locator('#messages .message-card').first().focus(); await press('ArrowRight');
        s = await record('feed Right after shelf returns');
        check('real pane entry restores kept dossier2 after resize', () => assert.equal(s.active.shelf, row.resizeKept));
        // Fold through the actual disclosure key owner, not a DOM open write.
        await toggleImages();
        assert.equal(await page.locator('#things [data-key=images]').evaluate(el => el.open), false);
        await page.locator('#archive-shelf .shelf-dossier').first().focus(); await record('folded Images Archive focus setup');
        await press('ArrowUp'); s = await record('Archive Up while Images folded');
        check('folded Images leaves Archive Up with the tree', () => assert.equal(s.active.href, pipeLastHref));
        check('folded Images route is exposed', () => assert.equal(s.visible, true));
        await toggleImages();
        assert.equal(await page.locator('#things [data-key=images]').evaluate(el => el.open), true);
        // Removal elsewhere is an actual scratch Core mutation, followed by
        // live paint. The shared KeyTree must keep the neighbouring dossier.
        const ids = await page.locator('#archive-shelf .shelf-dossier').evaluateAll(els => els.map(el => el.dataset.id));
        const removed = ids[5]; await page.locator(`#archive-shelf .shelf-dossier[data-id="${removed}"]`).focus();
        await record('external removal focus setup');
        row.externalRemoval = await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside',
          operation_id: 'cursor1048-external-remove-' + key, message_id: removed, args: { through: null } });
        assert.equal(row.externalRemoval.status, 'committed');
        await page.waitForFunction(id => !document.querySelector(`.shelf-dossier[data-id="${id}"]`), removed);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(r))); s = await record('selected replica removed by other Core act');
        check('external removal keeps the next surviving dossier', () => assert.equal(s.active.shelf, ids[6]));
        check('external removal exposes the replacement dossier', () => assert.equal(s.visible, true));
        check('external removal retains one roving stop', () => assert.equal(s.roving.length, 1));
        row.externalReadback = (await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: topic, message_ids: [removed] } })).items[0];
        check('external removal has Core below false', () => assert.equal(row.externalReadback.stack_position.below, false));
        const original = messages.items.find(each => each.id === removed); assert.ok(original);
        row.externalRestoration = await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside',
          operation_id: 'cursor1048-external-restore-' + key, message_id: removed, args: { through: original.seq } });
        assert.equal(row.externalRestoration.status, 'committed');
        await page.locator(`#archive-shelf .shelf-dossier[data-id="${removed}"]`).waitFor();
        // A real second topic has no image attachments at all, not merely a
        // hidden grid inserted by the test.
        const outcomeDisclosure = page.locator('#rail .ol-outcome[data-workspace-id=\"w1\"] > .ol-row .ol-disclosure');
        if (await outcomeDisclosure.getAttribute('aria-expanded') !== 'true') await outcomeDisclosure.click();
        await page.locator(`#rail a[href=\"?topic=${noImagesTopic}\"]`).click();
        await page.locator('#main h1', { hasText: 'Archive with no Images' }).waitFor();
        await page.locator('#archive-shelf:not([hidden]) .shelf-dossier').last().waitFor();
        await page.locator('#things [data-key=pipeline]:not([hidden]) .pipe-open').waitFor();
        assert.equal(await page.locator('#things [data-rail-image]').count(), 0);
        await page.locator('#archive-shelf .shelf-dossier').first().focus(); await record('no Images Archive focus setup');
        await press('ArrowUp'); s = await record('Archive Up with no Images');
        check('absent Images leaves Archive Up with the tree', () => assert.equal(s.active.href, pipeLastHref));
        check('absent Images previous row is exposed', () => assert.equal(s.visible, true));
        await page.screenshot({ path: out + '/' + key + '-noimages.png' });
      } else {
      if (width === 1280) {
        assert.ok(s.shelfShown && s.shelfMax > 100, 'real overflowing Archive shelf');
        const b = s.shelfBox; await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2); await page.mouse.wheel(0, 100000);
        await page.waitForFunction(() => document.querySelector('#archive-shelf').scrollTop > 100); await record('native shelf wheel leaves old scroll below top');
      } else check('phone does not invent a shelf', () => assert.equal(s.shelfShown, false));
      // Initial feed focus is setup, followed by actual pane arrow input.
      if (width === 390) { await press('Escape'); await page.locator('#messages .message-card').first().focus();
        await press('ArrowRight'); s = await record('phone feed Right keeps the closed pane closed');
        check('closed phone rail is not an arrow destination', () => assert.equal(s.active.feed, true));
        await page.locator('#things-open').click(); await page.waitForFunction(() => getComputedStyle(document.querySelector('#things')).transform === 'none');
        await page.locator('#things .things-sec[data-key=notebook]>summary').focus();
      } else { await page.locator('#messages .message-card').first().focus(); await press('ArrowRight'); }
      s = await record('feed to rail tree'); check('feed Right reaches Notebook tree', () => assert.equal(s.active.section, 'notebook'));
      await press('ArrowRight'); s = await record('heading Right reaches disclosure');
      check('one real tree roving stop', () => assert.equal(s.roving.length, 1));
      await press('Enter'); await press('Enter'); await press('ArrowDown'); await record('native disclosure Return twice then Down');
      for (let n = 0; n < 12; n++) { s = await snap(); if (s.active.image) break; await press('ArrowDown'); }
      s = await record('first Images tile'); assert.ok(s.active.image, 'tree Down enters actual image grid');
      const first = s.grid[0], last = s.grid.at(-1), finalTop = last.rect.top;
      check('Images exceeds room above shelf', () => assert.ok(s.grid.at(-1).rect.bottom - first.rect.top > s.lower - s.upper));
      for (let n = 0; n < s.grid.length; n++) {
        s = await record('image Down ' + n);
        if (!s.active.image) break;
        check('selected Images tile exposed ' + n, () => assert.equal(s.visible, true, JSON.stringify({ image: s.active.image, box: s.box, shelf: s.shelfBox, probes: s.probes })));
        const current = s.active.image; await press('ArrowDown'); const next = await snap();
        if (next.active.image === current) break;
      }
      s = await record('past final Images row');
      if (width === 1280) {
        check('Down beyond Images enters first actual Archive item', () => assert.equal(s.active.shelf, s.shelfItems[0]?.id));
        check('Archive entry is exposed', () => assert.equal(s.visible, true));
        check('Archive entry scrolls back toward top', () => assert.ok(s.shelfTop < 100));
        // Separate labelled Up boundary probe: wheel top, then set up visible first-item focus.
        const b = s.shelfBox; await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2); await page.mouse.wheel(0, -100000);
        await page.waitForFunction(() => document.querySelector('#archive-shelf').scrollTop === 0);
        await page.locator('#archive-shelf .shelf-dossier').first().focus(); await record('Up boundary focus setup on first Archive item');
        await press('ArrowUp'); s = await record('Up from first Archive row');
        const bottomRowIds = s.grid.filter(c => Math.abs(c.rect.top - s.grid.at(-1).rect.top) < 1).map(c => c.id);
        check('Up from Archive enters final Images row', () => assert.ok(bottomRowIds.includes(s.active.image)));
        check('Up final image is exposed above shelf', () => assert.equal(s.visible, true));
        for (const id of bottomRowIds) {
          await focusImage(id); await record('column round trip focus setup ' + id);
          await press('ArrowDown'); let round = await record('column round trip Down ' + id);
          check('direct round trip enters first actual Archive ' + id, () => assert.equal(round.active.shelf, round.shelfItems[0].id));
          await press('ArrowUp'); round = await record('column round trip Up ' + id);
          check('direct round trip retains departed Images column ' + id, () => assert.equal(round.active.image, id));
          check('direct round trip image exposed ' + id, () => assert.equal(round.visible, true));
        }
        await press('ArrowDown'); s = await record('return to first Archive for native controls');
        const firstArchive = s.shelfItems[0].id;
        check('Archive boundary remains the actual first item', () => assert.equal(s.active.shelf, firstArchive));
        await press('ArrowRight'); s = await record('Archive Right');
        check('Archive Right follows its real columns', () => assert.equal(s.active.shelf, s.shelfItems[1].id));
        await press('ArrowDown'); s = await record('Archive Down');
        check('Archive Down keeps its drawn column', () => assert.equal(s.active.shelf, s.shelfItems[3].id));
        check('Archive selected row is exposed in its scroller', () => assert.equal(s.visible, true));
        const restored = s.active.shelf;
        await press('Shift+F10'); await page.getByRole('menuitem', { name: 'Bring back', exact: true }).waitFor();
        await press('Escape'); s = await record('Archive menu Escape');
        check('Archive menu returns the same replica', () => assert.equal(s.active.shelf, restored));
        let count = await page.evaluate(() => cursorWrites.length);
        await press('Enter'); await page.waitForFunction(n => cursorWrites.length > n, count);
        row.restoreReceipt = await page.evaluate(() => cursorWrites.at(-1));
        check('Archive Return receives its actual committed receipt', () => assert.equal(row.restoreReceipt.receipt?.status, 'committed'));
        await page.waitForFunction(id => !document.querySelector(`.shelf-dossier[data-id="${id}"]`), restored);
        const readBack = async () => (await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: topic, message_ids: [restored] } })).items[0];
        row.restored = await readBack(); check('Archive Return confirms Core Bring back', () => assert.equal(row.restored.stack_position.below, false));
        count = await page.evaluate(() => cursorWrites.length);
        await press('Meta+z'); await page.waitForFunction(n => cursorWrites.length > n, count);
        row.undoReceipt = await page.evaluate(() => cursorWrites.at(-1));
        check('native Undo receives its actual committed receipt', () => assert.equal(row.undoReceipt.receipt?.status, 'committed'));
        await page.locator(`.shelf-dossier[data-id="${restored}"]`).waitFor();
        row.undo = await readBack(); check('native Undo returns the retained dossier to Archive', () => assert.equal(row.undo.stack_position.below, true));
      }
      if (width === 390) {
        const before = await snap(), finalTop = before.grid.at(-1).rect.top;
        for (const tile of before.grid.filter(el => Math.abs(el.rect.top - finalTop) < 1)) {
          await focusImage(tile.id); const from = await record('no shelf final Images focus setup ' + tile.id);
          await press('ArrowDown'); const after = await record('no shelf final Images Down ' + tile.id);
          check('each final Images column stays with no shelf or exit ' + tile.id, () => assert.equal(after.active.image, tile.id));
          check('no-exit Images stay prevents the native default ' + tile.id, () => assert.equal(after.lastKeyDefaultPrevented, true));
          check('no-exit Images stay keeps its exposed scroll position ' + tile.id, () => {
            assert.equal(after.visible, true);
            assert.deepEqual([after.pageY, after.railTop], [from.pageY, from.railTop]);
          });
        }
      }
      await focusImage(first.id); await press('ArrowRight'); s = await record('image Right actual neighbor');
      check('horizontal image route', () => assert.equal(s.active.image, s.grid[1]?.id));
      await press('Shift+F10'); await page.getByRole('menuitem', { name: 'Copy link', exact: true }).waitFor();
      row.imageMenu = await page.locator('.message-menu-list [role^=menuitem]').allTextContents(); await press('Escape');
      s = await record('image menu Escape'); check('image menu returns same tile', () => assert.equal(s.active.image, s.grid[1]?.id));
      const opened = context.waitForEvent('page'); await press('Enter'); const popup = await opened; await popup.waitForLoadState();
      check('image Return opens actual retained bytes', () => assert.match(popup.url(), /^blob:/)); await popup.close();
      if (width === 390) {
        await press('Escape'); await page.locator('#messages .stack-more').first().click();
        const archived = page.locator(`#messages .reply-stack[data-stack="${archiveIds[0]}"]`);
        await archived.waitFor(); await archived.scrollIntoViewIfNeeded(); row.phoneArchived = await archived.boundingBox();
        check('phone retains real feed Archive access', () => assert.ok(row.phoneArchived.width > 0 && row.phoneArchived.height > 0));
      }
      }
      await page.bringToFront(); await page.screenshot({ path: out + '/' + key + '.png' });
      row.inputs = await page.evaluate(() => cursorInputs); row.writes = await page.evaluate(() => cursorWrites);
      assert.ok(row.inputs.filter(x => x.type === 'keydown').length >= (grammar ? 6 : 11));
      assert.ok(row.inputs.every(x => x.trusted)); assert.deepEqual(row.errors, []); await Promise.all(captured); assert.deepEqual(row.captureErrors, []);
      row.passed = row.checks.every(c => c.passed);
    } catch (e) { row.error = e.stack; row.passed = false; await record('driver failure').catch(() => {});
      row.inputs = await page.evaluate(() => cursorInputs).catch(() => []); await page.screenshot({ path: out + '/' + key + '-error.png' }).catch(() => {}); }
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
