// Item 650's cases live in native-compose. State seeding uses the real adapters'
// state branches; all width changes use native pointer/keyboard input. WebKit's
// public touchscreen API has taps only, so narrow-width drags use its native
// mouse; Chromium also exercises a native touch drag through CDP.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function composerWidthCases(h) {
  const { check, page, open, press, until, picture, close, control, root, evidence, engine, second, HEIC } = h;
  const inputs = ['web/reader.mjs', 'web/inline-composer.mjs', 'web/composer-width.mjs', 'web/aim.css', 'web/writing-helpers.mjs', 'web/compose-bar.mjs', 'web/app.mjs', 'web/index.html', 'tests/reader_compose_native.mjs', 'tests/composer_width_native.mjs', 'tests/ui_composer_width.test.mjs', 'tests/fixtures/ui_http.py'];
  const hashes = {};
  for (const name of inputs) {
    let bytes;
    try { bytes = await readFile(path.join(root, name)); } catch (error) { if (error.code !== 'ENOENT' || name !== 'web/composer-width.mjs') throw error; hashes[name] = null; continue; }
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.dirname(path.join(evidence, 'item-650-source', name)), { recursive: true });
    await writeFile(path.join(evidence, 'item-650-source', name), bytes);
  }
  await writeFile(path.join(evidence, 'item-650-inputs.json'), JSON.stringify(hashes, null, 2));
  const BASE = '1bc72642c726076e29362171131bc1babf7e2c50';
  const baseHashes = {};
  for (const name of ['web/reader.mjs', 'web/inline-composer.mjs', 'web/aim.css']) {
    const bytes = execFileSync('git', ['show', `${BASE}:${name}`], { cwd: root });
    baseHashes[name] = createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.dirname(path.join(evidence, 'item-650-base-source', name)), { recursive: true });
    await writeFile(path.join(evidence, 'item-650-base-source', name), bytes);
  }
  await writeFile(path.join(evidence, 'item-650-base-inputs.json'), JSON.stringify({ commit: BASE, hashes: baseHashes }, null, 2));
  const refusedName = 'item650-refused.heic';
  const receipts = [];
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
      draft: JSON.stringify(e?.draft), context: JSON.stringify(e?.context), mode: adapter.mode ?? 'new',
      source: document.querySelector('#source-body').textContent, sendDisabled: document.querySelector(a.send).disabled,
      sendDim: document.querySelector(a.send).getAttribute('aria-disabled'), images: document.querySelector(a.strip).textContent };
  }, a);
  const instrument = (p, baseline = false) => p.route(/\/(reader|inline-composer)\.mjs(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const file = route.request().url().includes('/inline-composer.mjs') ? 'inline-composer.mjs' : 'reader.mjs';
    const source = baseline ? execFileSync('git', ['show', `${BASE}:web/${file}`], { cwd: root, encoding: 'utf8' }) : await response.text();
    const name = route.request().url().includes('/inline-composer.mjs') ? 'item650Inline' : 'item650Reader';
    const needle = 'this.callbacks = callbacks;';
    assert.equal(source.split(needle).length, 2, 'one adapter constructor observation point');
    await route.fulfill({ response, body: source.replace(needle, `${needle} window.${name} = this;`) });
  });
  async function setup(surface, state, shape, scheme, { baseline = false, mutation = null } = {}) {
    let applied = null;
    const prepare = async p => {
      await instrument(p, baseline);
      if (surface === 'New message' && state === 'error') {
        let refused = false;
        await p.route('**/api/view', route => {
          const request = route.request().postDataJSON();
          if (!refused && request?.name === 'editor_state' && request.args?.source_ref?.kind === 'topic') {
            refused = true;
            return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVER_BUSY', message: 'Composer temporarily unavailable', retryable: true } }) });
          }
          return route.continue();
        });
      }
      if (baseline) await p.route(/\/aim\.css(?:\?.*)?$/, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: execFileSync('git', ['show', `${BASE}:web/aim.css`], { cwd: root, encoding: 'utf8' }) });
      });
      if (mutation) await p.route(/\/composer-width\.mjs(?:\?.*)?$/, async route => {
        const response = await route.fetch(), original = await response.text();
        assert.equal(original.split(mutation.old).length, 2, `unique applied mutant ${mutation.name}`);
        const changed = original.replace(mutation.old, mutation.new);
        assert.notEqual(changed, original, 'mutant changes served bytes');
        applied = { name: mutation.name, engine, file: 'web/composer-width.mjs', original: createHash('sha256').update(original).digest('hex'), mutated: createHash('sha256').update(changed).digest('hex') };
        await writeFile(path.join(evidence, `${engine}-item-650-${mutation.name}.mjs`), changed);
        await route.fulfill({ response, body: changed });
      });
    };
    const a = at(surface), p = await page(surface === 'Wide Reader' ? 'wide' : shape, scheme, '/?topic=t1', undefined, prepare);
    if (surface === 'New message') {
      await until(p, () => !document.querySelector('#inline-composer').hidden, 'the new-message composer');
      await press(p, '#new-message');
      await until(p, () => document.querySelector('#new-message-sheet').open, 'the new-message sheet');
    } else await open(p, second);
    let release = () => {}, held = null;
    if (state !== 'empty' && !(state === 'error' && surface === 'New message')) {
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
      // Seed the actual upload owner's refused branch. This is a geometry
      // check, independent of engine-specific file chooser/Blob capture.
      // No fake DOM or resize event is used; all recovery controls are painted
      // by imageChoices/paintImageRows, and opening them is a native press.
      await p.evaluate(([a, name]) => {
        const adapter = window[a.ref], editor = adapter.editor;
        const uploads = adapter.callbacks.uploads(editor), state = uploads.initialize();
        state.entries.push({ selection_id: 'item-650-refused', origin: 'file',
          binding: { instance_id: editor.context.instanceId, actor_id: editor.context.actor,
            editor_key: editor.key, source_ref: structuredClone(editor.context.sourceRef),
            topic_id: editor.context.topicId, captured_cycle_id: editor.clientCycleId,
            authority: structuredClone(uploads.session.authority) },
          owner: { kind: 'cycle', id: editor.clientCycleId }, version: 1, selected: true,
          file: { name, size: 12, type: 'image/heic', last_modified: 0 },
          bytes_ref: null, bytes_state: 'durable', choice: 0,
          attempts: [{ role: 'image', phase: 'refused', publish_response: { error: { code: 'MEDIA_INVALID' } } }],
          ready_descriptor: null, association: null, local_error: null });
        state.revision++; editor.passiveImages = false; adapter.paintStatus();
      }, [a, refusedName]);
      await until(p, a => Boolean(document.querySelector(`${a.strip} [data-method=asDownload]:not([disabled])`)), 'the refused image offers Attach as download', a);
      if (surface === 'New message') await press(p, `${a.strip} .image-open`);
      else await press(p, a.send, true);
      await until(p, a => document.querySelector(`${a.strip} .image-choice`)?.hasAttribute('data-open'), 'both recovery controls open', a);
      assert.equal(await p.locator(a.strip).getByRole('button', { name: 'Attach as download', exact: true }).count(), 1);
      assert.equal(await p.locator(a.strip).getByRole('button', { name: `Remove ${refusedName}`, exact: true }).count(), 1);
    }
    // These branches are seeded through the actual adapter/state objects,
    // rather than imitating their DOM. No synthetic resize handler is called.
    if (state === 'read-only') await p.evaluate(a => {
      const adapter = window[a.ref]; adapter.editor.adopting = true; adapter.paintStatus();
    }, a);
    if (state === 'error' && surface !== 'New message') await p.evaluate(a => {
      window[a.ref].notice('Composer temporarily unavailable. Your writing is kept.');
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
    return { p, a, release, held, applied };
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
      await p.locator(`${a.dialog} > .composer-edge[data-edge=left]`).click();
      near((await geometry(p, a)).width, initial.width, 'a click alone changes no width');
      for (const side of ['left', 'right']) {
        const before = await geometry(p, a), inward = side === 'left' ? STEP_PX : -STEP_PX;
        await drag(p, a, side, inward, 25, touch);
        const shrunk = await geometry(p, a);
        near(shrunk.width, before.width - 2 * STEP_PX, `${side} shrinks both edges symmetrically`);
        near(shrunk.left, before.left + STEP_PX, 'left edge moves inward');
        near(shrunk.right, before.right - STEP_PX, 'right edge moves inward');
        near(shrunk.center, initial.center, 'stays centred');
        await picture(p, `${label}-dragged-${side}`);
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
      for (const side of ['left', 'right']) {
        const edge = p.locator(`${a.dialog} > .composer-edge[data-edge="${side}"]`);
        await edge.press(side === 'left' ? 'ArrowRight' : 'ArrowLeft');
        near((await geometry(p, a)).width, initial.width - 32, 'keyboard moves the focused edge symmetrically');
        await edge.press(side === 'left' ? 'ArrowLeft' : 'ArrowRight');
        near((await geometry(p, a)).width, initial.width, 'keyboard grows it back');
      }
      assert.deepEqual(await kept(p, a), saved, 'width changes preserve exact writing, selection, destination, mode, privacy and recovery controls');
      assert.deepEqual(commands, [], 'dragging neither saves nor sends nor changes recipients');
      await picture(p, `${label}-after`);
    } finally { p.off('request', observe); }
  }
  for (const surface of surfaces) for (const state of surface === 'New message' ? ['refused with recovery', 'error'] : ['refused with recovery']) for (const shape of surface === 'Wide Reader' ? ['stacked'] : shapes) for (const scheme of ['light', 'dark']) {
    await check(`item 650 base reproof ${surface} ${state} ${shape} ${scheme}`, async () => {
      const { p, a } = await setup(surface, state, shape, scheme, { baseline: true });
      await picture(p, `item-650-base-${surface.replaceAll(' ', '-')}-${state.replaceAll(' ', '-')}`);
      await assert.rejects(() => proof(p, a, 'base'), error => error.code === 'ERR_ASSERTION' && /either edge offers width adjustment/.test(error.message), 'base application fails because width edges are absent');
      console.log(`RED-PROVED ${engine} ${surface} ${state} ${shape} ${scheme} at ${BASE}: missing width edges`);
      await close(p);
    });
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
          const adapter = window[a.ref]; if (adapter.editor) adapter.editor.adopting = false;
          if (a.ref === 'item650Reader') adapter.presentation.sourceUnavailable = false;
        }, a);
        await close(p);
      });
    }
  }
  const mutations = [
    { name: 'left-inert', old: "width + 2 * delta * (side === 'left' ? -1 : 1)", new: "width + (side === 'left' ? 0 : 2 * delta)", expected: /left shrinks both edges symmetrically/ },
    { name: 'right-inert', old: "width + 2 * delta * (side === 'left' ? -1 : 1)", new: "width + (side === 'right' ? 0 : -2 * delta)", expected: /right shrinks both edges symmetrically/ },
    { name: 'asymmetric', old: 'width + 2 * delta', new: 'width + delta', expected: /left shrinks both edges symmetrically/ },
    { name: 'not-centred', old: "const delta = event.clientX - drag.x;", new: "dialog.style.marginLeft = '0px'; const delta = event.clientX - drag.x;", expected: /left edge moves inward|stays centred/ },
    { name: 'vertical-resize', old: "const delta = event.clientX - drag.x;", new: "dialog.style.height = '400px'; const delta = event.clientX - drag.x;", expected: /no vertical movement|no vertical resize/ },
    { name: 'keyboard-inert', old: "const delta = event.key === 'ArrowLeft' ? -16 : 16;", new: "const delta = 0;", expected: /keyboard moves the focused edge symmetrically/ },
    { name: 'writing-lost', old: "const delta = event.clientX - drag.x;", new: "doc.querySelector('#writing-body').value = 'lost'; const delta = event.clientX - drag.x;", expected: /width changes preserve exact writing/ },
  ];
  for (const mutation of mutations) await check(`item 650 applied mutant ${mutation.name} and restored control`, async () => {
    const broken = await setup('Reader', 'writing', 'stacked', 'light', { mutation });
    assert.ok(broken.applied, 'the product source mutant was actually served');
    await assert.rejects(() => proof(broken.p, broken.a, `mutant-${mutation.name}`), error => error.code === 'ERR_ASSERTION' && mutation.expected.test(error.message), `the gesture catches ${mutation.name} on its own assertion`);
    await close(broken.p);
    await control({ method: 'reset_drafts' });
    const restored = await setup('Reader', 'writing', 'stacked', 'light');
    await proof(restored.p, restored.a, `restored-${mutation.name}`);
    await close(restored.p);
    receipts.push({ ...broken.applied, caught: true, restored: true, restoredHash: hashes['web/composer-width.mjs'] });
    await writeFile(path.join(evidence, `item-650-mutants-${engine}.json`), JSON.stringify(receipts, null, 2));
    console.log(`MUTANT ${engine} ${mutation.name}: applied, caught, original restored and control passed`);
  });

}
