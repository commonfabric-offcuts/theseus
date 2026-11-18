// Item 652's own cases live in native-compose, which owns both engines and cleanup.
// Every measured comparison uses GEOMETRY_PX or FONT_PX; the carousel mutant is
// hundreds of pixels outside those bounds, not a rounding difference.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const GEOMETRY_PX = 2, FONT_PX = .15, TOUCH_PX = .5;
const BODY = '## Plan\n\nShip the exact words.\n\n### Child\n\nKeep these child words.\n\n## Notes\n\nKeep these notes.\n';
const EDIT = 'Plan\nShip the exact words. Edited on this device.';
const EXPECTED = BODY.replace('Ship the exact words.', 'Ship the exact words. Edited on this device.');
const STATES = ['normal', 'writing', 'empty', 'busy', 'refused retry', 'refused discard', 'read only', 'save error', 'read error', 'conflict mine', 'conflict saved', 'authority refusal', 'device error'];
const INPUTS = ['web/aim.css', 'web/deck-page.mjs', 'web/notebook-page.mjs', 'web/notebook-writing.mjs', 'tests/reader_compose_native.mjs', 'tests/card_editor_652.mjs', 'tests/ui_card_editor_652.test.mjs', 'tests/notebook_sheet_native.mjs', 'tests/notebook_card_images_native.mjs', 'tests/fixtures/ui_http.py', 'aim_next/web_build.py'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function cardEditor652({ check, page, until, press, picture, control, facts, engine, evidence, root }) {
  let serial = 0;
  const source = Object.fromEntries(await Promise.all(INPUTS.map(async f => [f, sha(await readFile(path.join(root, f)))])));
  const cssPath = path.join(root, 'web/aim.css'), css = await readFile(cssPath, 'utf8');
  const baseline = !css.includes('Item 652:');
  await mkdir(path.join(evidence, engine), { recursive: true });
  await writeFile(path.join(evidence, engine, 'item-652-source.json'), JSON.stringify({
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source,
    baseline, tolerances: { GEOMETRY_PX, FONT_PX, TOUCH_PX }, states: STATES,
  }, null, 2));

  const held = async (_p, id) => control({ method: 'agent_view', actor: facts.actor, name: 'memory_current', args: { item_id: id } });
  const scenario = async (shape, scheme, surface, state, suffix = '') => {
    const id = `card-652-${engine}-${++serial}${suffix}`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Card editor', body: state === 'empty' ? '' : BODY })).status, 'committed');
    const host = surface === 'sheet' ? '#new-message-sheet .notebook-sheet-page:not([hidden])' : '.deck-page';
    const field = `${host} .deck-editor`, status = surface === 'sheet' ? '#new-message-sheet .deck-status' : `${host} .deck-status`;
    let fail = state.startsWith('refused') ? 'FORBIDDEN' : state === 'save error' || state.startsWith('conflict') ? 'NETWORK' : state === 'authority refusal' ? 'AUTHORITY_CHANGED' : null;
    let release, busyRequest, entered;
    const busyEntered = new Promise(done => { entered = done; });
    const attempts = [];
    let opened;
    const openingRead = new Promise(done => { opened = done; });
    const prepare = async p => {
      if (state === 'device error') await p.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...rest) {
          if (this.name === 'writing') throw Error('Device copy unavailable in fixture');
          return put.call(this, value, ...rest);
        };
      });
      await p.route('**/api/view', async route => {
        const q = route.request().postDataJSON();
        if (q.name === 'memory_current' && q.args?.item_id === id) {
          if (state === 'read error') return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Page read unavailable' } } });
          if (state === 'read only') {
            const response = await route.fetch(), value = await response.json();
            return route.fulfill({ response, json: { ...value, reader_may_write: false } });
          }
        }
        await route.continue();
      });
      await p.route('**/api/command', async route => {
        const q = route.request().postDataJSON();
        if (q.kind === 'memory.read' && q.target?.item_id === id) opened();
        if (q.kind !== 'memory.revise' || q.target?.item_id !== id) return route.continue();
        attempts.push(q);
        if (state === 'busy' && !busyRequest) {
          busyRequest = q;
          await new Promise(done => { release = done; entered(); });
        }
        if (fail === 'NETWORK') return route.abort('failed');
        if (fail) return route.fulfill({ json: { instance_id: q.instance_id, operation_id: q.operation_id, kind: q.kind,
          status: 'rejected', recorded: false, error: { code: fail, message: 'Access temporarily removed' } } });
        await route.continue();
      });
    };
    const p = await page(shape, scheme, surface === 'sheet' ? `/?topic=t1&page=${id}` : `/?cards=${id}`, facts, prepare);
    const save = async wanted => {
      await until(p, s => document.querySelector(s)?.querySelector('[data-save="saved"]'), 'confirmed save', status, 15000);
      assert.equal((await held(p, id)).body, wanted, 'Core holds the exact page body');
    };
    try {
      if (state === 'read error') {
        await until(p, () => document.body.textContent.includes('Page read unavailable'), 'read error is visible');
        assert.equal(await p.locator(field).count(), 0, 'a failed read never offers a blank editor to overwrite the page');
        await picture(p, `item-652-${surface}-${state}`);
        return;
      }
      await until(p, h => Boolean(document.querySelector(h)?.querySelector('.deck-card,.deck-empty')), 'cards or empty page', host);
      if (surface === 'sheet') await Promise.race([openingRead, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('The sheet never recorded its opening read')), 15000); timer.unref(); })]);
      if (state === 'read only') {
        await until(p, s => document.querySelector(s)?.textContent.includes('To read'), 'read-only sign', status);
        await press(p, `${host} .deck-card .deck-title`);
        assert.equal(await p.locator(field).count(), 0, 'read-only cards never open for writing');
        assert.equal(attempts.length, 0, 'read-only makes no save');
      } else if (state !== 'normal') {
        await press(p, `${host} .deck-bar button:${state === 'empty' ? 'nth-of-type(2)' : 'first-of-type'}`);
        await until(p, f => document.activeElement === document.querySelector(f), 'the native press focuses card writing', field);
        if (state !== 'empty') {
          await p.keyboard.press('ControlOrMeta+A');
          await p.keyboard.insertText(EDIT);
        }
        if (state === 'busy') { await busyEntered; await until(p, s => document.querySelector(s)?.querySelector('[data-save="saving"]'), 'saving is visible', status); }
        else if (state.startsWith('refused') || state === 'authority refusal') await until(p, ([f, s]) => document.querySelector(f)?.readOnly && document.querySelector(s)?.querySelectorAll('button').length === 2, 'refusal keeps writing and both recovery controls', [field, status]);
        else if (state === 'save error' || state.startsWith('conflict') || state === 'device error') await until(p, s => Boolean(document.querySelector(s)?.querySelector('.deck-again')), 'transport error offers Try again', status);
        else if (state === 'writing') await save(EXPECTED);
        if (state.startsWith('conflict')) {
          fail = null;
          assert.equal((await control({ method: 'memory_revise', operation_id: id + '-remote', item_id: id, expected_revision: 1,
            title: 'Card editor', body: BODY.replace('Ship the exact words.', 'Remote words on the same card.') })).status, 'committed');
          fail = null;
          await until(p, h => !document.querySelector(h).querySelector('.notebook-conflict').hidden, 'same-card conflict keeps both versions', host);
        }
      }
      await picture(p, `item-652-${surface}-${state}${suffix}`);
      const servedCss = sha(await (await p.request.get(facts.origin + '/aim.css')).body());
      assert.equal(servedCss, sha(await readFile(cssPath)), 'the fixture serves the declared current CSS source, including a source mutant');
      const geometry = await p.evaluate(([h, f, st]) => {
        const list = document.querySelector(h).querySelector('.deck-cards'), rows = [...list.querySelectorAll('.deck-card:not([hidden])')];
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const box = document.querySelector(f), style = box && getComputedStyle(box);
        const controls = [...document.querySelector(h).querySelectorAll('.deck-bar button,.deck-fold,.deck-bubble'), ...document.querySelector(st).querySelectorAll('button')].filter(e => e.getClientRects().length);
        return { display: getComputedStyle(list).display, rows: rows.map(rect), sideways: document.documentElement.scrollWidth - innerWidth,
          box: box && { ...rect(box), border: parseFloat(style.borderTopWidth), font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight), words: box.value },
          controls: controls.map(e => ({ ...rect(e), name: e.getAttribute('aria-label') || e.textContent.trim(), title: e.title, glyph: e.matches('.deck-fold,.deck-bubble') })) };
      }, [host, field, status]);
      const errors = [];
      const require = (ok, message) => { if (!ok) errors.push(message); };
      require(geometry.display === 'grid', 'the laptop list is the default, never a phone carousel');
      require(geometry.sideways <= GEOMETRY_PX, `no horizontal page overflow (GEOMETRY_PX=${GEOMETRY_PX})`);
      for (const [i, row] of geometry.rows.entries()) {
        require(row.x >= -GEOMETRY_PX && row.right <= (shape === 'stacked' ? 1280 : Number(shape.slice(-3))) + GEOMETRY_PX, `card ${i} fits width within GEOMETRY_PX`);
        if (i) require(row.y >= geometry.rows[i - 1].bottom - GEOMETRY_PX, `card ${i} follows the preceding card vertically within GEOMETRY_PX`);
      }
      if (geometry.box) {
        require(geometry.box.border <= FONT_PX, 'the shared in-place editor has no separate textarea border');
        require(Math.abs(geometry.box.font - 14.72) <= FONT_PX, `the laptop words face (FONT_PX=${FONT_PX})`);
        require(geometry.box.words === (state === 'empty' ? '' : EDIT), 'the exact writing is retained');
      }
      if (p.touch) for (const c of geometry.controls) {
        require(c.width >= 44 - TOUCH_PX && c.height >= 44 - TOUCH_PX, `${c.name} has a 44px touch target within TOUCH_PX`);
        require(Boolean(c.name), 'every touch control has an accessible name');
        if (c.glyph) require(Boolean(c.title), `${c.name} has a tooltip`);
      }
      await writeFile(path.join(evidence, engine, `${shape}-${scheme}-item-652-${surface}-${state}-geometry.json`), JSON.stringify({ geometry, errors, servedCss, GEOMETRY_PX, FONT_PX, TOUCH_PX }, null, 2));
      // Check recovery even on the red baseline, before reporting its layout failure.
      if (state === 'busy') { assert.ok(release && busyRequest, 'a real save is held'); release(); await save(EXPECTED); }
      if (state.startsWith('refused') || state === 'save error') {
        assert.equal((await held(p, id)).body, BODY, 'refused/error writing has not changed the saved page');
        fail = null;
        if (state === 'refused discard') { await press(p, `${status} button:last-child`); await until(p, f => !document.querySelector(f), 'discard ends writing', field); assert.equal((await held(p, id)).body, BODY); }
        else { await press(p, `${status} .deck-again`); await save(EXPECTED); }
        if (state === 'save error') assert.equal(attempts[0].operation_id, attempts[1].operation_id, 'uncertain retry keeps its operation identity');
        if (state === 'refused retry') assert.notEqual(attempts[0].operation_id, attempts[1].operation_id, 'definite refusal retries with a fresh request');
      }
      if (state.startsWith('conflict')) {
        const wanted = state === 'conflict mine' ? EXPECTED : BODY.replace('Ship the exact words.', 'Remote words on the same card.');
        await press(p, `${host} .notebook-conflict button:${state === 'conflict mine' ? 'first-of-type' : 'last-of-type'}`);
        await save(wanted);
      }
      if (state === 'authority refusal') {
        fail = null;
        await press(p, `${status} .deck-again`);
        await until(p, s => document.querySelector(s).textContent.includes('Reload this page'), 'authority recovery requires reopening', status);
        assert.equal(attempts.length, 1, 'authority refusal cannot retry a save under an old binding');
        assert.equal((await held(p, id)).body, BODY);
      }
      if (state === 'device error') {
        assert.equal(attempts.length, 0, 'a failed device copy sends no request');
        assert.equal((await held(p, id)).body, BODY);
      }
      if (state === 'empty') {
        await press(p, `${host} .deck-bar button:first-of-type`);
        assert.equal((await held(p, id)).body, '', 'Done on an empty new card saves nothing');
        assert.equal(attempts.length, 0);
      }
      if (state === 'writing') {
        await press(p, `${host} .deck-bar button:first-of-type`);
        await until(p, f => !document.querySelector(f), 'Done leaves writing', field);
        assert.equal((await held(p, id)).body, EXPECTED, 'only the chosen card changes; child and following card stay exact');
      }
      assert.deepEqual(p.errors, [], 'no page errors');
      assert.deepEqual(errors, [], JSON.stringify({ geometry, GEOMETRY_PX, FONT_PX, TOUCH_PX }));
      return geometry;
    } finally { release?.(); await p.ctx.close(); }
  };

  // B1 measures the unchanged opening transition, before any writing replaces it.
  // These bounds admit subpixel/font rounding in both engines; 44px body padding
  // is far outside them. Line membership is derived with LINE_PX, never exact y.
  const POSITION_PX = 2, LINE_PX = 2, SIZE_PX = 2;
  const entryWords = 'Amber birds carry small seeds beside the river while quiet boats cross under the old stone bridge.';
  const entryBody = `## Plan\n\n${entryWords}\n\n### Child\n\nKeep these child words.\n\n## Notes\n\nKeep these notes.\n`;
  const entry = async (shape, scheme, surface, suffix = '') => {
    const id = `card-652-b1-${engine}-${++serial}`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Unchanged parent', body: entryBody })).status, 'committed');
    const host = surface === 'sheet' ? '#new-message-sheet .notebook-sheet-page:not([hidden])' : '.deck-page';
    const p = await page(shape, scheme, surface === 'sheet' ? `/?topic=t1&page=${id}` : `/?cards=${id}`, facts);
    const attempts = [];
    await p.route('**/api/command', async route => {
      const q = route.request().postDataJSON();
      if (q.kind === 'memory.revise' && q.target?.item_id === id) attempts.push(q);
      await route.continue();
    });
    const measure = () => p.evaluate(h => {
      const root = document.querySelector(h), rows = [...root.querySelectorAll('.deck-card:not([hidden])')];
      const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const row = rows[0], origin = rect(row), field = row.querySelector('.deck-editor');
      let text, offset = 0, mirror;
      if (field) {
        // Textareas expose no character ranges. A measurement-only mirror uses
        // their actual computed layout, including any applied source padding.
        const style = getComputedStyle(field), box = rect(field);
        mirror = document.createElement('div');
        for (const key of style) mirror.style.setProperty(key, style.getPropertyValue(key));
        Object.assign(mirror.style, { position: 'fixed', left: `${box.x}px`, top: `${box.y}px`,
          width: `${box.width}px`, height: 'auto', minHeight: '0', margin: '0', visibility: 'hidden', pointerEvents: 'none' });
        mirror.textContent = field.value;
        document.body.append(mirror);
        text = mirror; offset = field.value.indexOf('\n') + 1;
      } else text = row.querySelector('.deck-words');
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), characters = [];
      let node, index = 0;
      while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++, index++) {
        if (index < offset || /\s/.test(node.data[i])) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        characters.push({ letter: node.data[i], x: r.x - origin.x, y: r.y - origin.y, width: r.width });
      }
      mirror?.remove();
      return { rows: rows.map(rect), characters, chevron: rect(row.querySelector('.deck-fold')),
        value: field?.value, editor: field && { ...rect(field), paddingLeft: getComputedStyle(field).paddingLeft,
          paddingTop: getComputedStyle(field).paddingTop, textIndent: getComputedStyle(field).textIndent },
        sideways: document.documentElement.scrollWidth - innerWidth };
    }, host);
    const errors = [], require = (ok, message) => { if (!ok) errors.push(message); };
    const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
    let before, editing, done;
    try {
      await until(p, h => document.querySelector(h)?.querySelectorAll('.deck-card').length === 3, 'B1 parent, child and following card loaded', host);
      await until(p, () => document.fonts.status === 'loaded' && document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'B1 fonts and opening settled');
      before = await measure();
      assert.equal(before.characters.map(c => c.letter).join(''), entryWords.replace(/\s/g, ''), 'the measured read body is the exact unchanged fixture');
      await picture(p, `item-652-B1-${surface}-read${suffix}`);
      await press(p, `${host} .deck-bar button:first-of-type`);
      await until(p, h => document.activeElement === document.querySelector(h)?.querySelector('.deck-editor'), 'B1 native Edit focuses the unchanged parent', host);
      editing = await measure();
      await picture(p, `item-652-B1-${surface}-edit${suffix}`);
      assert.equal(editing.value, `Plan\n${entryWords}`, 'Edit keeps the exact title and words without replacement');
      assert.equal(editing.characters.map(c => c.letter).join(''), before.characters.map(c => c.letter).join(''), 'the editor mirror measures the same body characters');
      const lines = chars => {
        const starts = [];
        chars.forEach((c, i) => { if (!starts.length || Math.abs(c.y - chars[starts.at(-1)].y) > LINE_PX) starts.push(i); });
        return starts;
      };
      require(JSON.stringify(lines(editing.characters)) === JSON.stringify(lines(before.characters)), `B1 unchanged body wraps on the same characters (LINE_PX=${LINE_PX})`);
      for (const [i, c] of editing.characters.entries()) {
        require(close(c.x, before.characters[i].x, POSITION_PX) && close(c.y, before.characters[i].y, POSITION_PX), `B1 unchanged body character ${i} stays in place (POSITION_PX=${POSITION_PX})`);
        require(close(c.width, before.characters[i].width, SIZE_PX), `B1 body character ${i} keeps its width (SIZE_PX=${SIZE_PX})`);
      }
      for (const [i, row] of editing.rows.entries()) for (const key of ['x', 'y', 'width', 'height'])
        require(close(row[key], before.rows[i][key], key === 'x' || key === 'y' ? POSITION_PX : SIZE_PX), `B1 card ${i} ${key} stays in place (POSITION_PX=${POSITION_PX}, SIZE_PX=${SIZE_PX})`);
      for (const key of ['x', 'y', 'width', 'height']) require(close(editing.chevron[key], before.chevron[key], POSITION_PX), `B1 chevron ${key} stays in place (POSITION_PX=${POSITION_PX})`);
      require(editing.sideways <= SIZE_PX, `B1 no horizontal overflow (SIZE_PX=${SIZE_PX})`);
      const servedCss = sha(await (await p.request.get(facts.origin + '/aim.css')).body());
      assert.equal(servedCss, sha(await readFile(cssPath)), 'B1 serves the actual source CSS, including any applied mutant');
      await press(p, `${host} .deck-bar button:first-of-type`);
      await until(p, h => !document.querySelector(h)?.querySelector('.deck-editor'), 'B1 native Done leaves unchanged writing', host);
      done = await measure();
      assert.equal(attempts.length, 0, 'opening and closing unchanged writing never submits a revision');
      const saved = await held(p, id);
      assert.equal(saved.body, entryBody, 'Core keeps exact parent, child and following card words');
      assert.equal(saved.source_ref.revision, 1, 'unchanged Edit and Done create no revision');
      assert.deepEqual(p.errors, [], 'B1 no page errors');
      await writeFile(path.join(evidence, engine, `${shape}-${scheme}-item-652-B1-${surface}${suffix}.json`), JSON.stringify({
        id, before, editing, done, errors, attempts, saved, servedCss, tolerances: { POSITION_PX, LINE_PX, SIZE_PX },
      }, null, 2));
      assert.deepEqual(errors, [], 'B1 unchanged body and adjacent cards retain their geometry');
    } finally { await p.ctx.close(); }
  };
  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const scheme of ['light', 'dark']) for (const surface of ['full', 'sheet'])
    await check(`item 652 B1 unchanged parent Edit ${surface} ${shape} ${scheme}`, () => entry(shape, scheme, surface));

  await check('item 652 B1 applied whole-body padding mutant and restored controls', async () => {
    const old = '.deck-parent>.deck-editor{text-indent:2.75rem}';
    const replacement = '.deck-parent>.deck-editor{padding-left:2.75rem;text-indent:0}';
    assert.equal(css.split(old).length, 2, 'B1 exactly one coarse-pointer padding mutation site');
    const mutated = css.replace(old, replacement);
    const trail = { file: 'web/aim.css', old, replacement, before: sha(css), applied: sha(mutated), caught: [], restored: null, restoredControls: [] };
    const restartPadding = async () => {
      assert.equal((await control({ method: 'server_stop' })).stopped, true);
      assert.equal((await control({ method: 'server_start' })).origin, facts.origin, 'B1 isolated origin is retained');
    };
    try {
      await writeFile(cssPath, mutated);
      assert.equal(sha(await readFile(cssPath)), trail.applied, 'B1 padding source mutant actually applied');
      await restartPadding();
      for (const surface of ['full', 'sheet']) {
        try { await entry('phone-320', 'light', surface, '-padding-mutant'); }
        catch (error) {
          assert.equal(error.code, 'ERR_ASSERTION');
          assert.match(error.message, /B1 unchanged body and adjacent cards retain their geometry/);
          assert.ok(error.actual.some(message => message.startsWith('B1 unchanged body character')), 'B1 catches displaced body characters');
          assert.ok(error.actual.some(message => message.startsWith('B1 unchanged body wraps')), 'B1 catches body rewrapping');
          trail.caught.push({ surface, error: error.stack, geometryErrors: error.actual });
        }
      }
    } finally {
      await writeFile(cssPath, css);
      trail.restored = sha(await readFile(cssPath));
      await restartPadding();
      await writeFile(path.join(evidence, engine, 'item-652-B1-padding-mutant.json'), JSON.stringify(trail, null, 2));
    }
    assert.equal(trail.caught.length, 2, 'B1 padding mutant is caught on both surfaces');
    assert.equal(trail.restored, trail.before, 'B1 source restored byte-for-byte');
    for (const surface of ['full', 'sheet']) {
      await entry('phone-320', 'light', surface, '-padding-restored');
      trail.restoredControls.push({ surface, passed: true });
    }
    await writeFile(path.join(evidence, engine, 'item-652-B1-padding-mutant.json'), JSON.stringify(trail, null, 2));
  });

  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const scheme of ['light', 'dark']) for (const surface of ['full', 'sheet']) for (const state of STATES) {
    await check(`item 652 ${surface} ${shape} ${scheme} ${state}`, () => scenario(shape, scheme, surface, state));
  }
  if (baseline) return;
  // A fixture snapshots its web build at startup. Restart it after each source
  // mutation and restoration, then verify the bytes actually served to the page.
  const restart = async () => {
    assert.equal((await control({ method: 'server_stop' })).stopped, true);
    const started = await control({ method: 'server_start' });
    assert.equal(started.origin, facts.origin, 'the isolated fixture keeps its origin');
  };
  const breaks = [
    { name: 'carousel', old: '.deck-cards{list-style:none;margin:0;padding:0;display:grid;gap:.45rem}',
      to: '.deck-cards{list-style:none;margin:0;padding:0;display:flex;gap:.45rem}.deck-card{flex:0 0 100%}', state: 'normal', caught: /laptop list/ },
    { name: 'separate editor', old: '.deck-editor{min-height:var(--kept,0px);padding:0;border:0;',
      to: '.deck-editor{min-height:var(--kept,0px);padding:0;border:3px solid var(--line);', state: 'writing', caught: /separate textarea border/ },
    { name: 'small chevron', old: '@media(pointer:coarse){.deck-fold{width:2.75rem;height:2.75rem;min-height:2.75rem}',
      to: '@media(pointer:coarse){.deck-fold{width:1.75rem;height:1.75rem;min-height:1.75rem}', state: 'normal', caught: /44px touch target/ },
  ];
  for (const mutation of breaks) await check(`item 652 applied ${mutation.name} mutant and restored control`, async () => {
    assert.equal(css.split(mutation.old).length, 2, 'one source mutation site');
    const mutated = css.replace(mutation.old, mutation.to);
    const trail = { file: 'web/aim.css', old: mutation.old, replacement: mutation.to, before: sha(css), applied: sha(mutated), caught: null, restored: null };
    try {
      await writeFile(cssPath, mutated);
      assert.equal(sha(await readFile(cssPath)), trail.applied, 'the source mutation actually applied');
      await restart();
      try { await scenario('phone-320', 'light', 'full', mutation.state, '-mutant-' + mutation.name.replaceAll(' ', '-')); }
      catch (error) { assert.equal(error.code, 'ERR_ASSERTION'); assert.match(error.message, mutation.caught); trail.caught = error.stack; }
      assert.ok(trail.caught, 'the native assertion catches the source mutant');
    } finally {
      await writeFile(cssPath, css); trail.restored = sha(await readFile(cssPath));
      await restart();
    }
    assert.equal(trail.restored, trail.before, 'source restored byte-for-byte');
    await scenario('phone-320', 'light', 'full', mutation.state, '-restored-' + mutation.name.replaceAll(' ', '-'));
    await writeFile(path.join(evidence, engine, `item-652-mutant-${mutation.name.replaceAll(' ', '-')}.json`), JSON.stringify(trail, null, 2));
  });
}
