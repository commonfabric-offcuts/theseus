// Item 650's cases live in native-compose. State seeding uses the real adapters'
// state branches; all width changes use native pointer/keyboard input. WebKit's
// public touchscreen API has taps only, so narrow-width drags use its native
// mouse; Chromium also exercises a native touch drag through CDP.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function composerWidthCases(h) {
  const { check, page, open, press, until, picture, close, control, root, evidence, engine, second, HEIC } = h;
  const inputs = ['web/reader.mjs', 'web/inline-composer.mjs', 'web/composer-width.mjs', 'web/aim.css', 'web/writing-helpers.mjs', 'web/compose-bar.mjs', 'web/app.mjs', 'web/index.html', 'tests/reader_compose_native.mjs', 'tests/composer_width_native.mjs', 'tests/fixtures/ui_http.py'];
  const hashes = {};
  for (const name of inputs) {
    let bytes;
    try { bytes = await readFile(path.join(root, name)); } catch (error) { if (error.code !== 'ENOENT' || name !== 'web/composer-width.mjs') throw error; hashes[name] = null; continue; }
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.dirname(path.join(evidence, 'item-650-source', name)), { recursive: true });
    await writeFile(path.join(evidence, 'item-650-source', name), bytes);
  }
  await writeFile(path.join(evidence, 'item-650-inputs.json'), JSON.stringify(hashes, null, 2));
  const surfaces = ['Reader', 'New message', 'Wide Reader'];
  const states = ['empty', 'writing', 'saving', 'busy', 'refused with recovery', 'read-only', 'error', 'permission unavailable', 'private note'];
  const shapes = ['phone-320', 'phone-375', 'phone-390', 'stacked'];
  // Named tolerances: fractional CSS layout and native pointer rounding differ
  // between engines. A 16px edge movement changes the width by 32px, well above
  // the 2px bounds, and all mutants below exceed them.
  const GEOMETRY_PX = 2, TOUCH_PX = 0.5, STEP_PX = 16;
  const near = (actual, expected, words) => assert.ok(Math.abs(actual - expected) <= GEOMETRY_PX,
    `${words}, tolerance ${GEOMETRY_PX}px: ${actual} vs ${expected}`);
  const at = surface => surface === 'New message'
    ? { dialog: '#new-message-sheet', composer: '#inline-composer', field: '#inline-writing-body', sign: '#inline-save-state', send: '#inline-send', plus: '#inline-plus-button', add: '#inline-add-image', strip: '#inline-attachments', ref: 'item650Inline' }
    : { dialog: '#reader', composer: '#reader-composer', field: '#writing-body', sign: '#save-state', send: '#send-reply', plus: '#plus-button', add: '#add-image', strip: '#writing-attachments', ref: 'item650Reader' };
  const geometry = (p, a) => p.evaluate(a => {
    const d = document.querySelector(a.dialog), b = d.getBoundingClientRect();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height,
      center: (b.left + b.right) / 2, open: d.open, view: innerWidth };
  }, a);
  const kept = (p, a) => p.evaluate(a => {
    const adapter = window[a.ref], e = adapter.editor, f = document.querySelector(a.field);
    return { text: f.value, start: f.selectionStart, end: f.selectionEnd, readOnly: f.readOnly, disabled: f.disabled,
      draft: JSON.stringify(e.draft), context: JSON.stringify(e.context), mode: adapter.mode ?? 'new',
      source: document.querySelector('#source-body').textContent, sendDisabled: document.querySelector(a.send).disabled,
      sendDim: document.querySelector(a.send).getAttribute('aria-disabled'), images: document.querySelector(a.strip).textContent };
  }, a);
  const instrument = p => p.route(/\/(reader|inline-composer)\.mjs(?:\?.*)?$/, async route => {
    const response = await route.fetch(), source = await response.text();
    const name = route.request().url().includes('/inline-composer.mjs') ? 'item650Inline' : 'item650Reader';
    const needle = 'this.callbacks = callbacks;';
    assert.equal(source.split(needle).length, 2, 'one adapter constructor observation point');
    await route.fulfill({ response, body: source.replace(needle, `${needle} window.${name} = this;`) });
  });
  async function setup(surface, state, shape, scheme) {
    const a = at(surface), p = await page(surface === 'Wide Reader' ? 'wide' : shape, scheme, '/?topic=t1', undefined, instrument);
    if (surface === 'New message') {
      await until(p, () => !document.querySelector('#inline-composer').hidden, 'the new-message composer');
      await press(p, '#new-message');
      await until(p, () => document.querySelector('#new-message-sheet').open, 'the new-message sheet');
    } else await open(p, second);
    let release = () => {}, held = null;
    if (state !== 'empty') {
      await press(p, a.field);
      await p.keyboard.insertText(`Exact item 650 writing — ${surface}.`);
      await until(p, a => document.querySelector(a.sign).dataset.save === 'saved', 'the exact writing saved', a, 15000);
    }
    if (state === 'saving' || state === 'busy') {
      const kind = state === 'saving' ? 'draft.save' : 'submission.prepare';
      const waiting = p.waitForRequest(request => request.url().endsWith('/api/command') && request.postDataJSON()?.kind === kind, { timeout: 15000 });
      held = new Promise(resolve => { release = resolve; });
      await p.route('**/api/command', async route => {
        if (route.request().postDataJSON()?.kind === kind) { await held; }
        await route.continue();
      });
      if (state === 'saving') await p.keyboard.insertText(' Saving stays exact.');
      else await press(p, a.send);
      await waiting;
      if (state === 'saving') await until(p, a => document.querySelector(a.sign).dataset.save === 'saving', 'the saving state', a);
      else await until(p, a => window[a.ref].editor.submissions.some(s => s.status === 'preparing'), 'the preparing state', a);
    }
    if (state === 'refused with recovery') {
      await press(p, a.plus);
      const chooser = p.waitForEvent('filechooser');
      await press(p, a.add);
      await (await chooser).setFiles(HEIC);
      await until(p, a => document.querySelector(`${a.strip} .image-choice`)?.hasAttribute('data-needs'), 'the refused image', a, 20000);
      if (surface === 'New message') await press(p, `${a.strip} .image-open`);
      else await press(p, a.send, true);
      await until(p, a => document.querySelector(`${a.strip} .image-choice`)?.hasAttribute('data-open'), 'both recovery controls open', a);
      assert.equal(await p.locator(a.strip).getByRole('button', { name: 'Attach as download', exact: true }).count(), 1);
      assert.equal(await p.locator(a.strip).getByRole('button', { name: 'Remove', exact: true }).count(), 1);
    }
    // These branches are seeded through the actual adapter/state objects,
    // rather than imitating their DOM. No synthetic resize handler is called.
    if (state === 'read-only') await p.evaluate(a => {
      const adapter = window[a.ref]; adapter.editor.adopting = true; adapter.paintStatus();
    }, a);
    if (state === 'error') await p.evaluate(a => {
      const adapter = window[a.ref];
      if (a.ref === 'item650Inline') adapter.fail('Composer temporarily unavailable');
      else adapter.notice('Composer temporarily unavailable. Your writing is kept.');
    }, a);
    if (state === 'permission unavailable') await p.evaluate(a => {
      const adapter = window[a.ref]; adapter.presentation.sourceUnavailable = true;
      adapter.hideUnavailableSource(); adapter.paintStatus();
    }, a);
    if (state === 'private note') {
      await press(p, '#plus-button');
      await until(p, () => !document.querySelector('#plus-panel').hidden, 'the plus panel');
      await press(p, '#toggle-note');
      await until(p, () => window.item650Reader.mode === 'note', 'the private note');
      await press(p, a.field); await p.keyboard.insertText('Private item 650 note, never a reply.');
      await until(p, a => document.querySelector(a.sign).dataset.save === 'saved', 'the private note saved', a, 15000);
    }
    await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(x => x.playState !== 'running'), 'the settled state');
    return { p, a, release, held };
  }
  async function drag(p, a, side, dx, dy = 0, touch = false) {
    const selector = `${a.dialog} > .composer-edge[data-edge="${side}"]`;
    const b = await p.locator(selector).boundingBox();
    assert.ok(b, 'the edge has a native hit target');
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (touch) {
      const cdp = await p.ctx.newCDPSession(p);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await cdp.detach(); }
    } else {
      await p.mouse.move(x, y); await p.mouse.down();
      await p.mouse.move(x + dx, y + dy, { steps: 4 }); await p.mouse.up();
    }
    await until(p, () => !document.querySelector('[data-width-dragging]'), 'the edge release');
  }
  async function proof(p, a, label, touch = false) {
    assert.equal(await p.locator(`${a.dialog} > .composer-edge`).count(), 2, 'either edge offers width adjustment');
    const saved = await kept(p, a), initial = await geometry(p, a);
    const commands = [];
    const observe = request => { if (request.url().endsWith('/api/command')) commands.push(request.postDataJSON()); };
    p.on('request', observe);
    try {
      const edges = await p.evaluate(a => [...document.querySelectorAll(`${a.dialog} > .composer-edge`)].map(el => {
        const b = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), title: el.title, width: b.width, height: b.height };
      }), a);
      for (const edge of edges) {
        assert.ok(edge.label && edge.title, 'each edge has an accessible name and tooltip');
        assert.ok(edge.width >= 44 - TOUCH_PX && edge.height >= 44 - TOUCH_PX, `touch target tolerance ${TOUCH_PX}px: ${JSON.stringify(edge)}`);
      }
      for (const side of ['left', 'right']) {
        const before = await geometry(p, a), inward = side === 'left' ? STEP_PX : -STEP_PX;
        await drag(p, a, side, inward, 25, touch);
        const shrunk = await geometry(p, a);
        near(shrunk.width, before.width - 2 * STEP_PX, `${side} shrinks both edges symmetrically`);
        near(shrunk.left, before.left + STEP_PX, 'left edge moves inward');
        near(shrunk.right, before.right - STEP_PX, 'right edge moves inward');
        near(shrunk.center, initial.center, 'stays centred');
        near(shrunk.top, initial.top, 'no vertical movement'); near(shrunk.height, initial.height, 'no vertical resize');
        await drag(p, a, side, -inward, -25, touch);
        const grown = await geometry(p, a);
        near(grown.width, before.width, `${side} grows symmetrically`);
        near(grown.center, initial.center, 'growing stays centred');
        await drag(p, a, side, 0, 35, touch);
        const vertical = await geometry(p, a);
        near(vertical.width, before.width, 'vertical dragging cannot resize');
        near(vertical.top, initial.top, 'vertical dragging cannot move');
      }
      assert.deepEqual(await kept(p, a), saved, 'width changes preserve exact writing, selection, destination, mode, privacy and recovery controls');
      assert.deepEqual(commands, [], 'dragging neither saves nor sends nor changes recipients');
      await picture(p, `${label}-after`);
    } finally { p.off('request', observe); }
  }
  for (const surface of surfaces) for (const state of states) {
    if (surface === 'New message' && ['permission unavailable', 'private note'].includes(state)) continue;
    for (const shape of surface === 'Wide Reader' ? ['stacked'] : shapes) for (const scheme of ['light', 'dark']) {
      await check(`item 650 ${surface} ${state} ${shape} ${scheme}`, async () => {
        const { p, a, release, held } = await setup(surface, state, shape, scheme);
        try {
          const label = `item-650-${surface.replaceAll(' ', '-')}-${state.replaceAll(' ', '-')}`;
          await picture(p, `${label}-before`);
          await proof(p, a, label, engine === 'chromium' && p.touch);
        } finally { release(); if (held) await held; }
        // Seeded states are reversed before ordinary owned-page cleanup.
        await p.evaluate(a => {
          const adapter = window[a.ref]; adapter.editor.adopting = false;
          if (a.ref === 'item650Reader') adapter.presentation.sourceUnavailable = false;
        }, a);
        await close(p);
      });
    }
  }
}
