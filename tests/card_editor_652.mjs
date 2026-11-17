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
const INPUTS = ['web/aim.css', 'web/deck-page.mjs', 'web/notebook-page.mjs', 'web/notebook-writing.mjs', 'tests/reader_compose_native.mjs', 'tests/card_editor_652.mjs'];
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
          if (surface === 'sheet') await openingRead;
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
      if (surface === 'sheet') await openingRead;
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
          assert.equal((await control({ method: 'memory_revise', operation_id: id + '-remote', item_id: id, expected_revision: 1,
            title: 'Card editor', body: BODY.replace('Ship the exact words.', 'Remote words on the same card.') })).status, 'committed');
          fail = null;
          await press(p, `${status} .deck-again`);
          await until(p, h => !document.querySelector(h).querySelector('.notebook-conflict').hidden, 'same-card conflict keeps both versions', host);
        }
      }
      await picture(p, `item-652-${surface}-${state}`);
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
      await writeFile(path.join(evidence, engine, `${shape}-${scheme}-item-652-${surface}-${state}-geometry.json`), JSON.stringify({ geometry, errors, GEOMETRY_PX, FONT_PX, TOUCH_PX }, null, 2));
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
    } finally { release?.(); }
  };

  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const scheme of ['light', 'dark']) for (const surface of ['full', 'sheet']) for (const state of STATES) {
    await check(`item 652 ${surface} ${shape} ${scheme} ${state}`, () => scenario(shape, scheme, surface, state));
  }
  if (baseline) return;
  // Applied source mutant, served by the real fixture, then restored byte-for-byte.
  // Its native assertion is caught here rather than accepted as a passing UI.
  await check('item 652 applied phone carousel mutant and restored control', async () => {
    const mutated = css + '\n@media(max-width:760px){.deck-cards{display:flex}.deck-card{flex:0 0 100%}}\n';
    const trail = { file: 'web/aim.css', before: sha(css), applied: sha(mutated), caught: null, restored: null };
    try {
      await writeFile(cssPath, mutated);
      assert.equal(sha(await readFile(cssPath)), trail.applied, 'the source mutation actually applied');
      try { await scenario('phone-320', 'light', 'full', 'normal', '-mutant'); }
      catch (error) { assert.equal(error.code, 'ERR_ASSERTION'); assert.match(error.message, /laptop list/); trail.caught = error.stack; }
      assert.ok(trail.caught, 'the native layout assertion catches the mutant');
    } finally { await writeFile(cssPath, css); trail.restored = sha(await readFile(cssPath)); }
    assert.equal(trail.restored, trail.before, 'source restored byte-for-byte');
    await scenario('phone-320', 'light', 'full', 'normal', '-restored');
    await writeFile(path.join(evidence, engine, 'item-652-mutant.json'), JSON.stringify(trail, null, 2));
  });
}
