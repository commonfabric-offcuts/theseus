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
  const states = ['empty', 'writing', 'saving', 'busy', 'refused with recovery', 'read-only', 'error',
    'permission unavailable', 'access unconfirmed', 'access checking', 'conflict review', 'composition refused',
    'recovery discovery', 'authority recovery blocked', 'authority recovery ready', 'private note'];
  const shapes = ['phone-320', 'phone-375', 'phone-390', 'stacked'];
  // Named tolerances: fractional CSS layout and native pointer rounding differ
  // between engines. A 16px edge movement changes the width by 32px, well above
  // the 2px bounds, and all mutants below exceed them.
  const GEOMETRY_PX = 2, TOUCH_PX = 0.5, STEP_PX = 16;
  const near = (actual, expected, words) => assert.ok(Math.abs(actual - expected) <= GEOMETRY_PX,
    `${words}, tolerance ${GEOMETRY_PX}px: ${actual} vs ${expected}`);
  const at = surface => surface === 'New message'
    ? { dialog: '#new-message-sheet', composer: '#inline-composer', field: '#inline-writing-body', sign: '#inline-save-state', send: '#inline-send', plus: '#inline-plus-button', add: '#inline-add-image', strip: '#inline-attachments', retry: '#inline-retry', review: '#inline-review-versions', ref: 'item650Inline' }
    : { dialog: '#reader', composer: '#reader-composer', field: '#writing-body', sign: '#save-state', send: '#send-reply', plus: '#plus-button', add: '#add-image', strip: '#writing-attachments', retry: '#retry-source', review: '#review-versions', ref: 'item650Reader' };
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
      sendDim: document.querySelector(a.send).getAttribute('aria-disabled'), images: document.querySelector(a.strip).textContent,
      recovery: JSON.stringify([e?.conflict, e?.authorityRecovery, e?.recoveryDiscovery]),
      controls: [a.retry, a.review].map(selector => {
        const el = document.querySelector(selector); return [el.textContent, el.hidden, el.disabled];
      }) };
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
    let applied = null, servedHash = null;
    const prepare = async p => {
      await instrument(p, baseline);
      // Observe the actual registry change path: Reader's Review button is
      // painted by app.changed, separately from Reader.paintStatus.
      await p.route(/\/app\.mjs(?:\?.*)?$/, async route => {
        const response = await route.fetch(), source = await response.text();
        await route.fulfill({ response, body: `${source}\nwindow.item650Changed = changed;\n` });
      });
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
      if (!baseline) await p.route(/\/composer-width\.mjs(?:\?.*)?$/, async route => {
        const response = await route.fetch(), original = await response.text();
        servedHash = createHash('sha256').update(original).digest('hex');
        assert.equal(servedHash, hashes['web/composer-width.mjs'], 'actual served original source matches the declared snapshot');
        if (!mutation) { await route.fulfill({ response, body: original }); return; }
        assert.equal(original.split(mutation.old).length, 2, `unique applied mutant ${mutation.name}`);
        const changed = original.replace(mutation.old, mutation.new);
        assert.notEqual(changed, original, 'mutant changes served bytes');
        applied = { name: mutation.name, engine, file: 'web/composer-width.mjs', original: createHash('sha256').update(original).digest('hex'), mutated: createHash('sha256').update(changed).digest('hex') };
        await writeFile(path.join(evidence, `${engine}-item-650-${mutation.name}.mjs`), changed);
        await route.fulfill({ response, body: changed });
      });
    };
    const a = at(surface), p = await page(surface === 'Wide Reader' ? 'wide' : shape, scheme, '/?topic=t1', undefined, prepare);
    if (!baseline) assert.equal(servedHash, hashes['web/composer-width.mjs'], 'the fresh page loaded the exact original source before any mutation');
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
    // Distinct access and review branches paint different status/recovery
    // controls. New message has topic access even though it has no source body.
    if (['permission unavailable', 'access unconfirmed', 'access checking'].includes(state)) await p.evaluate(([a, state]) => {
      const adapter = window[a.ref], presentation = adapter.presentation;
      adapter.editor.unavailable = true; presentation.destinationAvailable = false;
      presentation.availabilityUnconfirmed = state !== 'permission unavailable';
      presentation.availabilityChecking = state === 'access checking';
      if (a.ref === 'item650Reader') {
        presentation.sourceUnavailable = state === 'permission unavailable';
        adapter.hideUnavailableSource();
      }
      adapter.paintStatus();
    }, [a, state]);
    if (['conflict review', 'composition refused', 'recovery discovery', 'authority recovery blocked', 'authority recovery ready'].includes(state)) {
      await p.evaluate(([a, state]) => {
        const adapter = window[a.ref], editor = adapter.editor;
        // Keep the actual editor's writing/destination and preserve the seed
        // for cleanup; no private state from another actor is introduced.
        window.item650LocalVersion = editor.localVersion;
        if (state === 'conflict review' || state === 'composition refused') editor.conflict = {
          error: { code: state === 'composition refused' ? 'INVALID_TOPIC_COMPOSITION' : 'REVISION_CONFLICT' },
          remote: { ...structuredClone(editor.draft), body: 'Other saved item 650 version.' },
        };
        if (state === 'recovery discovery') { editor.recoveryDiscovery = true; editor.localVersion = 0; }
        if (state.startsWith('authority recovery')) editor.authorityRecovery = {
          phase: state.endsWith('ready') ? 'ready' : 'blocked',
          message: 'Runtime changed — review saved version', authority: { authority_id: 'item650-runtime', authority_epoch: 2 },
          remote: { ...structuredClone(editor.draft), body: 'Saved item 650 runtime version.' },
        };
        window.item650Changed(editor);
      }, [a, state]);
    }
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
  async function stateProof(p, a, state) {
    const value = await kept(p, a);
    if (['read-only', 'composition refused', 'recovery discovery'].includes(state)) assert.equal(value.readOnly, true, `${state} really makes writing read-only`);
    if (state === 'conflict review' || state.startsWith('authority recovery')) assert.equal(value.readOnly, false, `${state} keeps local typing available`);
    if (['permission unavailable', 'access unconfirmed', 'access checking'].includes(state)) {
      const [text, hidden, disabled] = value.controls[0];
      assert.equal(text, 'Retry access');
      assert.equal(hidden, a.ref === 'item650Inline' && state === 'access checking', `${state} paints its actual Retry access branch`);
      if (!hidden) assert.equal(disabled, state === 'access checking', `${state} admits retry only once checking ends`);
      assert.equal(value.sendDisabled || value.sendDim === 'true', true, 'unavailable access cannot send');
    }
    if (['conflict review', 'composition refused', 'recovery discovery'].includes(state) || state.startsWith('authority recovery')) {
      assert.equal(value.controls[1][1], false, `${state} offers Review versions`);
      assert.equal(value.sendDisabled || value.sendDim === 'true', true, `${state} blocks sending`);
      // Exercise the recovery control, read its actual dialog, and return by
      // its native close control before testing the composer's own edges.
      await press(p, a.review);
      await until(p, () => document.querySelector('#version-review').open, 'the version review');
      const text = await p.locator('#review-content').textContent();
      assert.ok(text.includes(value.text), 'review preserves the exact local writing');
      if (state.startsWith('authority recovery')) {
        assert.equal(await p.locator('#review-retry').isVisible(), true, 'authority recovery offers Retry');
        assert.equal(await p.locator('#review-save').isDisabled(), state.endsWith('blocked'), 'only ready authority recovery offers resume');
      }
      await press(p, '#review-close');
      await until(p, () => !document.querySelector('#version-review').open, 'review closes back to its composer');
    }
  }
  // A traversal, not focus() or Locator.press(): every iteration performs the
  // next native Tab and reads the resulting focus stop. Stop after one cycle.
  async function tabToEdge(p, a, side) {
    const seen = new Set();
    for (;;) {
      await p.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
      const stop = await p.evaluate(a => {
        const el = document.activeElement, dialog = document.querySelector(a.dialog);
        return { index: [...document.querySelectorAll('*')].indexOf(el),
          side: el?.parentElement === dialog ? el.dataset.edge : null,
          ring: el?.matches(':focus-visible') };
      }, a);
      if (stop.side === side) { assert.equal(stop.ring, true, 'Tab gives the edge visible keyboard focus'); return; }
      if (seen.has(stop.index)) break;
      seen.add(stop.index);
    }
    assert.fail(`native Tab reaches the ${side} composer edge before its focus order repeats`);
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
  async function returnDrag(p, a, side, touch, onShrink) {
    const before = await geometry(p, a), inward = side === 'left' ? STEP_PX : -STEP_PX;
    const b = await p.locator(`${a.dialog} > .composer-edge[data-edge="${side}"]`).boundingBox();
    assert.ok(b, 'the return drag has a native hit target');
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const shrink = async () => {
      const g = await geometry(p, a);
      near(g.width, before.width - 2 * STEP_PX, `${side} shrinks both edges symmetrically`);
      await onShrink(g);
    };
    const restored = async () => near((await geometry(p, a)).width, before.width, `${side} held return to origin restores width`);
    if (touch) {
      const cdp = await p.ctx.newCDPSession(p);
      await p.evaluate(a => {
        window.item650PointerMoves = [];
        document.querySelector(a.dialog).addEventListener('pointermove', event => {
          window.item650PointerMoves.push({ x: event.clientX, trusted: event.isTrusted, type: event.pointerType });
        }, { capture: true });
      }, a);
      const delivered = async expected => {
        await until(p, expected => window.item650PointerMoves.some(e => e.trusted && e.type === 'touch' && Math.abs(e.x - expected) < .5), 'the trusted native touch move delivered', expected);
        await p.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      };
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + inward, y }] });
        await delivered(x + inward);
        await shrink();
        await p.evaluate(() => { window.item650PointerMoves = []; });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await delivered(x);
        await restored();
      } finally {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      }
    } else {
      await p.mouse.move(x, y); await p.mouse.down();
      try {
        await p.mouse.move(x + inward, y, { steps: 4 }); await shrink();
        await p.mouse.move(x, y, { steps: 4 }); await restored();
      } finally { await p.mouse.up(); }
    }
    await until(p, () => !document.querySelector('[data-width-dragging]'), 'the return drag releases');
    near((await geometry(p, a)).width, before.width, `${side} released return keeps the restored width`);
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
        const before = await geometry(p, a);
        // This same held gesture proves symmetry AND B1 reversal. Separate
        // shrink/release/grow gestures duplicate those measurements and make
        // the complete state matrix exceed the hosted job's fixed limit.
        await returnDrag(p, a, side, touch, async shrunk => {
          near(shrunk.left, before.left + STEP_PX, 'left edge moves inward');
          near(shrunk.right, before.right - STEP_PX, 'right edge moves inward');
          near(shrunk.center, initial.center, 'stays centred');
          near(shrunk.top, initial.top, 'no vertical movement'); near(shrunk.height, initial.height, 'no vertical resize');
          // Both sides reach the same measured box. Preserve one resized
          // original per state, alongside the state-before original.
          if (side === 'left') await picture(p, `${label}-dragged-left`);
        });
        const grown = await geometry(p, a);
        near(grown.width, before.width, `${side} grows symmetrically`);
        near(grown.center, initial.center, 'growing stays centred');
        await drag(p, a, side, 0, 35, touch);
        const vertical = await geometry(p, a);
        near(vertical.width, before.width, 'vertical dragging cannot resize');
        near(vertical.top, initial.top, 'vertical dragging cannot move');
        assert.deepEqual(await kept(p, a), saved, 'width changes preserve exact writing, selection, destination, mode, privacy and recovery controls');
      }
      for (const side of ['left', 'right']) {
        await tabToEdge(p, a, side);
        // WebKit's native focus traversal can move a textarea's selection.
        // Snapshot after traversal, then require each width act to keep it.
        const reached = await kept(p, a);
        await p.keyboard.press(side === 'left' ? 'ArrowRight' : 'ArrowLeft');
        near((await geometry(p, a)).width, initial.width - 32, 'keyboard moves the focused edge symmetrically');
        assert.deepEqual(await kept(p, a), reached, 'keyboard width changes preserve exact writing, selection, destination, mode, privacy and recovery controls');
        await p.keyboard.press(side === 'left' ? 'ArrowLeft' : 'ArrowRight');
        near((await geometry(p, a)).width, initial.width, 'keyboard grows it back');
        assert.deepEqual(await kept(p, a), reached, 'keyboard return preserves exact writing, selection, destination, mode, privacy and recovery controls');
      }
      const final = await kept(p, a);
      assert.deepEqual({ ...final, start: saved.start, end: saved.end }, saved, 'native traversal and width changes preserve exact writing and its owners');
      assert.deepEqual(commands, [], 'dragging neither saves nor sends nor changes recipients');
    } finally { p.off('request', observe); }
  }
  async function chooseMode(p, mode) {
    await press(p, '#reader-menu');
    await until(p, () => Boolean(document.querySelector('[role=menu]')), 'the layout menu');
    await press(p, `[role=menuitem]:text-is("${mode === 'wide' ? 'Wide' : 'Stacked'} layout")`);
    await until(p, mode => document.querySelector('#reader').dataset.layout === mode, 'the chosen layout', mode);
    await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(x => x.playState !== 'running'), 'the settled layout');
  }
  async function putAway(p, a) {
    await press(p, a.dialog === '#reader' ? '#reader-close' : '#new-message-close');
    await until(p, a => !document.querySelector(a.dialog).open, 'the composer closed', a);
  }
  async function openNew(p) {
    await press(p, '#new-message');
    await until(p, () => document.querySelector('#new-message-sheet').open, 'New message opens');
  }
  async function lifetimeProof(shape, scheme, mutation = null, phase = mutation ? `mutant-${mutation.name}` : 'normal') {
    const { p, a, applied } = await setup('Reader', 'writing', shape, scheme, { mutation });
    try {
    const n = at('New message'), saved = await kept(p, a), initial = await geometry(p, a);
    const phone = initial.view <= 760, touch = engine === 'chromium' && p.touch;
    const defaults = { stacked: phone ? initial.view : Math.min(72 * 16, initial.view - 48),
      wide: phone ? initial.view : Math.min(100 * 16, initial.view - 48) };
    const width = async (adapter, expected, words) => {
      const g = await geometry(p, adapter);
      near(g.width, expected, words);
      near(g.center, g.view / 2, `${words}: centred`);
    };
    await width(a, defaults.stacked, 'stacked starts at its source-defined default');
    await picture(p, `item-650-lifetime-${phase}-default-stacked`);
    await drag(p, a, 'left', 16, 0, touch);
    const stacked = defaults.stacked - 32;
    await width(a, stacked, 'stacked keeps its chosen width');
    let wide;
    if (!phone) {
      await chooseMode(p, 'wide');
      await width(a, defaults.wide, 'unchosen Wide uses its own default without stacked leakage');
      await picture(p, `item-650-lifetime-${phase}-default-wide`);
      await drag(p, a, 'right', -32);
      wide = defaults.wide - 64;
      await width(a, wide, 'Wide keeps its own chosen width');
      await chooseMode(p, 'stacked');
      await width(a, stacked, 'switching back restores stacked choice');
      await chooseMode(p, 'wide');
      await width(a, wide, 'switching back restores Wide choice');
    }
    assert.deepEqual(await kept(p, a), saved, 'mode switches preserve exact writing, To, images and selection');
    await picture(p, `item-650-lifetime-${phase}-reader-chosen`);
    await putAway(p, a);
    await openNew(p);
    await width(n, defaults.stacked, 'New message has its independent default');
    await press(p, n.field); await p.keyboard.insertText('Independent New message item 650 writing.');
    await until(p, n => document.querySelector(n.sign).dataset.save === 'saved', 'New message writing saved', n);
    const newSaved = await kept(p, n);
    await drag(p, n, 'right', -16, 0, touch);
    await width(n, defaults.stacked - 32, 'New message keeps its own chosen width');
    assert.deepEqual(await kept(p, n), newSaved, 'New message resize keeps exact writing, To, images and selection');
    await picture(p, `item-650-lifetime-${phase}-new-chosen`);
    await putAway(p, n); await openNew(p);
    await width(n, defaults.stacked - 32, 'New message close/reopen restores its choice');
    await putAway(p, n); await open(p, second);
    await width(a, phone ? stacked : wide, 'Reader close/reopen restores its current mode choice');
    if (!phone) {
      await chooseMode(p, 'stacked');
      await width(a, stacked, 'New message leaves stacked choice independent');
      await chooseMode(p, 'wide');
      await width(a, wide, 'New message leaves Wide choice independent');
    }
    await p.reload();
    await until(p, () => document.body?.dataset.ready === 'true', 'reloaded application');
    await open(p, second);
    assert.equal(await p.locator('#reader').getAttribute('data-layout'), phone ? 'stacked' : 'wide', 'reload keeps the separate existing mode preference');
    await width(a, phone ? defaults.stacked : defaults.wide, 'reload restores current mode source-defined default');
    if (!phone) {
      await chooseMode(p, 'stacked');
      await width(a, defaults.stacked, 'reload restores stacked source-defined default');
    }
    await picture(p, `item-650-lifetime-${phase}-reader-reloaded`);
    await putAway(p, a); await openNew(p);
    await width(n, defaults.stacked, 'reload restores independent New message default');
    await picture(p, `item-650-lifetime-${phase}-new-reloaded`);
    return applied;
    } finally { await close(p); }
  }
  for (const shape of [...shapes, 'very-wide-stacked']) for (const scheme of ['light', 'dark']) {
    await check(`item 650 independent mode widths ${shape} ${scheme}: close reopen and reload defaults`, () => lifetimeProof(shape, scheme));
  }
  const lifetimeMutations = [
    { name: 'wrong-mode', old: "dialog.dataset.layout === 'wide' ? 'wide' : 'stacked'", new: "'stacked'", expected: /Wide keeps its own chosen width/ },
    { name: 'undersize', old: 'const setWidth = width => dialog.style.setProperty(widthProperty(), `${width}px`);',
      new: 'const setWidth = width => dialog.style.setProperty(widthProperty(), `${width - 16}px`);', expected: /stacked keeps its chosen width/ },
  ];
  for (const mutation of lifetimeMutations) await check(`item 650 applied mutant ${mutation.name} and restored mode widths`, async () => {
    await assert.rejects(() => lifetimeProof('stacked', 'light', mutation), error => error.code === 'ERR_ASSERTION' && mutation.expected.test(error.message), `mode widths catch ${mutation.name} on its intended assertion`);
    await control({ method: 'reset_drafts' });
    await lifetimeProof('stacked', 'light', null, `restored-${mutation.name}`);
    const changed = await readFile(path.join(evidence, `${engine}-item-650-${mutation.name}.mjs`));
    receipts.push({ name: mutation.name, engine, file: 'web/composer-width.mjs', original: hashes['web/composer-width.mjs'],
      mutated: createHash('sha256').update(changed).digest('hex'), caught: true, restored: true, restoredHash: hashes['web/composer-width.mjs'] });
    await writeFile(path.join(evidence, `item-650-mutants-${engine}.json`), JSON.stringify(receipts, null, 2));
  });
  for (const surface of surfaces) for (const state of ['refused with recovery', ...(surface === 'New message' ? ['error'] : []),
    'permission unavailable', 'access unconfirmed', 'access checking', 'conflict review', 'composition refused',
    'recovery discovery', 'authority recovery blocked', 'authority recovery ready']) for (const shape of surface === 'Wide Reader' ? ['stacked'] : shapes) for (const scheme of ['light', 'dark']) {
    await check(`item 650 base reproof ${surface} ${state} ${shape} ${scheme}`, async () => {
      const { p, a } = await setup(surface, state, shape, scheme, { baseline: true });
      await picture(p, `item-650-base-${surface.replaceAll(' ', '-')}-${state.replaceAll(' ', '-')}`);
      await assert.rejects(() => proof(p, a, 'base'), error => error.code === 'ERR_ASSERTION' && /either edge offers width adjustment/.test(error.message), 'base application fails because width edges are absent');
      console.log(`RED-PROVED ${engine} ${surface} ${state} ${shape} ${scheme} at ${BASE}: missing width edges`);
      await close(p);
    });
  }
  for (const surface of surfaces) for (const state of states) {
    if (surface === 'New message' && state === 'private note') continue;
    for (const shape of surface === 'Wide Reader' ? ['stacked'] : shapes) for (const scheme of ['light', 'dark']) {
      await check(`item 650 ${surface} ${state} ${shape} ${scheme}`, async () => {
        const { p, a, release, held } = await setup(surface, state, shape, scheme);
        try {
          await stateProof(p, a, state);
          const label = `item-650-${surface.replaceAll(' ', '-')}-${state.replaceAll(' ', '-')}`;
          await picture(p, `${label}-before`);
          await proof(p, a, label, engine === 'chromium' && p.touch);
        } finally { release(); if (held) await held; }
        // Seeded states are reversed before ordinary owned-page cleanup.
        await p.evaluate(a => {
          const adapter = window[a.ref], editor = adapter.editor;
          if (editor) {
            editor.adopting = false; editor.unavailable = false; editor.conflict = null;
            editor.authorityRecovery = null; editor.recoveryDiscovery = false;
            if (window.item650LocalVersion !== undefined) editor.localVersion = window.item650LocalVersion;
          }
          if (adapter.presentation) {
            adapter.presentation.sourceUnavailable = false; adapter.presentation.availabilityUnconfirmed = false;
            adapter.presentation.availabilityChecking = false; adapter.presentation.destinationAvailable = true;
          }
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
    { name: 'return-origin-discarded', old: 'const delta = event.clientX - drag.x;', new: 'const delta = event.clientX - drag.x; if (Math.abs(delta) < 1) return;', expected: /held return to origin restores width/ },
    { name: 'return-drift', old: 'const delta = event.clientX - drag.x;', new: 'const delta = event.clientX - drag.x; if (delta !== 0) drag.moved = true; if (delta === 0 && drag.moved) drag.width -= 16;', expected: /held return to origin restores width/ },
    { name: 'tab-unreachable', old: 'edge.tabIndex = 0;', new: 'edge.tabIndex = -1;', expected: /native Tab reaches the left composer edge/ },
  ];
  // Break width in each newly covered branch using the real adapter state.
  // Each control must pass for that same state after source restoration.
  for (const surface of ['Reader', 'New message']) for (const state of [
    'permission unavailable', 'access unconfirmed', 'access checking', 'conflict review', 'composition refused',
    'recovery discovery', 'authority recovery blocked', 'authority recovery ready',
  ]) mutations.push({ name: `${surface.replaceAll(' ', '-')}-${state.replaceAll(' ', '-')}-inert`, surface, state,
    old: "width + 2 * delta * (side === 'left' ? -1 : 1)", new: "width + (side === 'left' ? 0 : 2 * delta)",
    expected: /left shrinks both edges symmetrically/ });
  for (const mutation of mutations) await check(`item 650 applied mutant ${mutation.name} and restored control`, async () => {
    const surface = mutation.surface ?? 'Reader', state = mutation.state ?? 'writing';
    const broken = await setup(surface, state, 'stacked', 'light', { mutation });
    assert.ok(broken.applied, 'the product source mutant was actually served');
    await stateProof(broken.p, broken.a, state);
    await assert.rejects(() => proof(broken.p, broken.a, `mutant-${mutation.name}`), error => error.code === 'ERR_ASSERTION' && mutation.expected.test(error.message), `the gesture catches ${mutation.name} on its own assertion`);
    await close(broken.p);
    await control({ method: 'reset_drafts' });
    const restored = await setup(surface, state, 'stacked', 'light');
    await stateProof(restored.p, restored.a, state);
    await proof(restored.p, restored.a, `restored-${mutation.name}`);
    await close(restored.p);
    receipts.push({ ...broken.applied, caught: true, restored: true, restoredHash: hashes['web/composer-width.mjs'] });
    await writeFile(path.join(evidence, `item-650-mutants-${engine}.json`), JSON.stringify(receipts, null, 2));
    console.log(`MUTANT ${engine} ${mutation.name}: applied, caught, original restored and control passed`);
  });

}
