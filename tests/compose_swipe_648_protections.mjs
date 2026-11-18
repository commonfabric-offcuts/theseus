// Item 648: real input, real app guards, HTTP permission/failure seams.
// Observers delegate unchanged and never invoke an application action.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { geometry648 } from './swipe_648_geometry.mjs';

export async function observe648(p) {
  await p.addInitScript(() => {
    window.swipe648Inputs = [];
    window.swipe648TargetTerminals = [];
    const observedTargets = new WeakSet();
    document.addEventListener('touchstart', e => {
      const target = e.target;
      if (observedTargets.has(target)) return;
      observedTargets.add(target);
      for (const type of ['touchend', 'touchcancel']) target.addEventListener(type, terminal => {
        window.swipe648TargetTerminals.push({ type, trusted: terminal.isTrusted,
          connected: target.isConnected, target: target.nodeName,
          ids: [...terminal.changedTouches].map(t => t.identifier) });
      }, { capture: true, passive: true });
    }, { capture: true, passive: true });
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'wheel']) document.addEventListener(type, e => {
      window.swipe648Inputs.push({ type, trusted: e.isTrusted, target: e.target.id, inSource: Boolean(e.target.closest('#source-body')), ctrl: e.ctrlKey });
    }, { capture: true, passive: true });
  });
  await p.route('**/reader.mjs', async route => {
    const response = await route.fetch(), body = await response.body();
    p.swipe648ReaderHash = createHash('sha256').update(body).digest('hex');
    await route.fulfill({ response, body });
  });
  await p.route('**/aim.css', async route => {
    const response = await route.fetch(), body = await response.body();
    p.swipe648CssHash = createHash('sha256').update(body).digest('hex');
    await route.fulfill({ response, body });
  });
  await p.route('**/app.mjs', async route => {
    const response = await route.fetch();
    const observer = `import { Reader as Swipe648Reader } from './reader.mjs';
import { EditorRegistry as Swipe648Registry } from './app-session.mjs';
import { RecoveryJournal as Swipe648Journal } from './journal.mjs';
for (const method of ['save', 'saveLatest']) {
  const swipe648Save = Swipe648Journal.prototype[method];
  Swipe648Journal.prototype[method] = async function(...args) {
    const result = await swipe648Save.apply(this, args), hold = window.swipe648SaveHold;
    if (hold?.armed) { hold.entered = true; await new Promise(resolve => { hold.releases.push(resolve); }); throw Error('Fixture device close save refused'); }
    return result;
  };
}
const swipe648Show = Swipe648Reader.prototype.show;
Swipe648Reader.prototype.show = function(...args) { window.swipe648Reader = this; return swipe648Show.apply(this, args); };
const swipe648Open = Swipe648Registry.prototype.open;
Swipe648Registry.prototype.open = function(...args) { window.swipe648Registry = this; return swipe648Open.apply(this, args); };\n`;
    await route.fulfill({ response, body: observer + await response.text() });
  });
}

export async function composeSwipe648Protections(h) {
  const { check, page, open, press, until, picture, close, control, facts, engine, root, evidence } = h;
  const records = [];
  const shapes = ['phone-320', 'phone-375', 'phone-390', 'stacked'];
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const saveRecords = async () => { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, `item648-${engine}-protections.json`), JSON.stringify(records, null, 2)); };
  const opts = { observeSwipe648: true, ...(engine === 'webkit' ? { isMobile: false } : {}) };
  const snapshot = p => p.evaluate(() => {
    const p = window.swipe648Registry.current;
    return { open: document.querySelector('#reader').open, source: p.source.source_ref, text: document.querySelector('#source-body').textContent,
      mode: p.mode, draft: structuredClone(p.editors.reply.draft), editorKey: p.editors.reply.key,
      writing: document.querySelector('#writing-body').value, destination: document.querySelector('#who-chip').textContent,
      unavailable: Boolean(p.sourceUnavailable), unconfirmed: Boolean(p.availabilityUnconfirmed), checking: Boolean(p.availabilityChecking),
      readOnly: document.querySelector('#writing-body').readOnly, coarse: matchMedia('(pointer:coarse)').matches, viewportScale: visualViewport.scale, inputs: window.swipe648Inputs };
  });
  const setup = async (shape, theme, tag) => {
    const topic = `648-${engine}-${shape}-${theme}-${tag}`;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Swipe protections' }] });
    const id = (await control({ method: 'agent_message', operation_id: topic, topic_id: topic, join: true, source: 'topic', body: 'Swipe protections. Exact original words for the reader.\n\nAnother paragraph remains readable.' })).result.message_id;
    const other = (await control({ method: 'agent_message', operation_id: topic + '-other', topic_id: topic, body: 'Other source stays unchanged.' })).result.message_id;
    const p = await page(shape, theme, `/?topic=${topic}`, facts, undefined, opts);
    const commands = [];
    p.on('request', r => { if (r.url().endsWith('/api/command')) commands.push(r.postDataJSON()); });
    await open(p, id, 'Swipe protections.');
    await press(p, '#writing-body');
    const saved = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'draft.save');
    await p.keyboard.insertText('  Exact protected α writing\nsecond line.  ');
    await (await saved).finished();
    await until(p, () => { const e = window.swipe648Registry.current.editors.reply; return e.localVersion === e.ackVersion; }, 'the exact draft acknowledged');
    const before = await snapshot(p);
    return { p, topic, id, other, commands, before };
  };
  const point = async (p, selector = '#source-body') => {
    await until(p, () => document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'native input surface layout settled');
    const handle = await p.waitForFunction(selector => {
      const el = document.querySelector(selector), b = el?.getBoundingClientRect();
      if (!b || b.width <= 0 || b.height <= 0) return null;
      const left = Math.max(b.left, 0), right = Math.min(b.right, innerWidth), top = Math.max(b.top, 0), bottom = Math.min(b.bottom, innerHeight);
      for (const y of [top + Math.min(25, (bottom - top) / 2), (top + bottom) / 2]) for (const x of [left + Math.min(65, (right - left) / 3), (left + right) / 2]) {
        const target = document.elementFromPoint(x, y);
        if (el.contains(target) && (selector !== '#source-body' || !target.closest('button,a,.reader-end'))) return { x, y };
      }
      return null;
    }, selector, { polling: 'raf', timeout: 8000 });
    return handle.jsonValue();
  };
  // Completion follows delivered native input then the next rendered frame;
  // no elapsed-time sleep stands in for the browser having received it.
  const delivered = async (p, count, type) => {
    await until(p, ([n, t]) => window.swipe648Inputs.slice(n).some(e => e.type === t && e.trusted), `native ${type} delivered`, [count, type]);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const wheel = async (p, dx, dy = 0, selector = '#source-body', zoom = false) => {
    const at = await point(p, selector), n = await p.evaluate(() => window.swipe648Inputs.length);
    await p.mouse.move(at.x, at.y);
    if (zoom) await p.keyboard.down('Control');
    try { await p.mouse.wheel(dx, dy); await delivered(p, n, 'wheel'); }
    finally { if (zoom) await p.keyboard.up('Control'); }
  };
  const finger = async (p, dx = 100, dy = 0, { cancel = false, between = null, selector = '#source-body' } = {}) => {
    const at = await point(p, selector), n = await p.evaluate(() => window.swipe648TargetTerminals.length);
    const cdp = await p.ctx.newCDPSession(p);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
      if (between) await between();
      for (let step = 1; step <= 4; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + dx * step / 4, y: at.y + dy * step / 4 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      // A source redraw detaches the original target. Its trusted terminal
      // event still arrives there, but cannot bubble to document. Observe
      // that target itself, counting only events after this native contact.
      await until(p, n => window.swipe648TargetTerminals.slice(n).some(e => ['touchend', 'touchcancel'].includes(e.type) && e.trusted && e.ids.includes(0)), 'native touch completion or browser cancellation on original target', n);
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      records.push({ shape: p.shape, theme: p.scheme, touch: await p.evaluate(() => ({
        documentInputs: window.swipe648Inputs, targetTerminals: window.swipe648TargetTerminals
      })) });
      await saveRecords();
      await cdp.detach();
    }
  };
  const right = p => engine === 'chromium' && p.touch ? finger(p) : wheel(p, -100);
  const noFold = f => assert.equal(f.commands.filter(e => e.kind === 'message.fold').length, 0, 'protected gesture issues no fold command');
  const kept = async (f, label, { text = true } = {}) => {
    const now = await snapshot(f.p);
    assert.equal(now.open, true, `${label}: Reader stays open`);
    assert.equal(now.writing, f.before.writing, `${label}: exact writing kept`);
    assert.equal(now.destination, f.before.destination, `${label}: destination kept`);
    assert.equal(now.mode, f.before.mode, `${label}: reply/private-note mode kept`);
    if (text) assert.equal(now.text, f.before.text, `${label}: exact source words kept`);
    assert.equal(f.commands.some(e => ['message.send', 'submission.prepare', 'note.save'].includes(e.kind)), false, `${label}: no send/private note act`);
    const mine = (await control({ method: 'acts_as', reader: facts.actor, topic_id: f.topic })).acts;
    assert.equal(mine.items.some(row => [f.id, f.other].includes(row.message_id) && row.acts.folded), false, `${label}: Core folds neither message`);
    const foreign = await control({ method: 'acts_as', reader: facts.agent, topic_id: f.topic });
    assert.equal(foreign.acts.items.some(row => [f.id, f.other].includes(row.message_id) && row.acts.folded), false, `${label}: other actor unchanged`);
    assert.ok(!JSON.stringify(foreign).includes('Exact protected α writing'), `${label}: other actor sees no private writing`);
    return now;
  };
  const screen = async (f, label) => {
    // #7715: named realistic tolerances, no measured equality.
    const CONTAINMENT_TOLERANCE_PX = 2, PHONE_TARGET_TOLERANCE_PX = 1;
    const geometry = await f.p.evaluate(() => {
      const dialog = document.querySelector('#reader').getBoundingClientRect();
      const targets = [...document.querySelectorAll('#reader button, #reader input, #reader textarea, #reader select')]
        .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('#source-body'))
        .map(e => { const b = e.getBoundingClientRect(); return { id: e.id || e.textContent, w: b.width, h: b.height }; });
      return { left: dialog.left, right: dialog.right, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, targets };
    });
    records.push({ shape: f.p.shape, theme: f.p.scheme, label, geometry,
      layout: await f.p.evaluate(geometry648), state: await snapshot(f.p) }); await saveRecords();
    await picture(f.p, `item648-protection-${label}`);
    assert.ok(geometry.left >= -CONTAINMENT_TOLERANCE_PX && geometry.right <= geometry.width + CONTAINMENT_TOLERANCE_PX, `${label}: Reader contained within named ${CONTAINMENT_TOLERANCE_PX}px tolerance`);
    assert.ok(geometry.overflow <= CONTAINMENT_TOLERANCE_PX, `${label}: page overflow <= named ${CONTAINMENT_TOLERANCE_PX}px, got ${geometry.overflow}`);
    if (f.p.touch) for (const t of geometry.targets) assert.ok(Math.min(t.w, t.h) >= 44 - PHONE_TARGET_TOLERANCE_PX, `${label}: ${t.id} 44px phone floor with named ${PHONE_TARGET_TOLERANCE_PX}px tolerance, got ${t.w}×${t.h}`);
  };

  // Use a human-facing fictional display name for this matrix. Start09's
  // exact 3px outlier was the *background* folded cue after the unshrinking
  // technical name fixture-notebook-agent. Ordinary legacy folded cases keep
  // that original fixture and their separate base placement; no CSS or
  // containment tolerance is changed or waived here.
  await control({ method: 'actor_name', actor_id: facts.agent, name: 'Pipit' });
  try {
  for (const shape of shapes) for (const theme of ['light', 'dark']) {
    const input = engine === 'webkit' ? 'phone-width desktop wheel/native taps (laptop wheel at stacked)' : shape.startsWith('phone') ? 'native finger drag' : 'desktop wheel';
    await check(`item 648 protections ${shape} ${theme}: left short vertical zoom selection cancellation source-change; ${input}`, async () => {
      const f = await setup(shape, theme, 'negative'), { p } = f;
      await screen(f, 'negative-before');
      for (const [name, dx, dy] of [['left', -100, 0], ['short', 55, 0], ['vertical', 0, 100]]) {
        if (engine === 'chromium' && p.touch) await finger(p, dx, dy);
        else { await wheel(p, 0, 20); await wheel(p, -dx, dy); }
        noFold(f); await kept(f, name); await screen(f, `negative-${name}`); records.push({ shape, theme, negative: name, input });
      }
      // Native pointer selection tests the browser's actual selection, also
      // in touch-enabled contexts; this is not a WebKit finger-selection claim.
      const at = await point(p);
      await p.mouse.click(at.x, at.y, { clickCount: 2 });
      await until(p, () => !window.getSelection().isCollapsed, 'native selection on source words');
      await wheel(p, 0, 20); await wheel(p, -100); noFold(f); await kept(f, 'selection');
      await screen(f, 'negative-selection');
      await p.mouse.click(at.x, at.y);
      await until(p, () => window.getSelection().isCollapsed, 'native click releases selection');
      if (engine === 'chromium' && p.touch) await finger(p, 100, 0, { cancel: true });
      else { await wheel(p, 0, 20); await wheel(p, -40); await wheel(p, 0, 60); await wheel(p, -50); }
      noFold(f); await kept(f, 'cancellation/reset');
      await screen(f, 'negative-cancelled');
      await wheel(p, -100, 0, '#source-body', true); noFold(f); await kept(f, 'native Control-wheel zoom');
      await screen(f, 'negative-zoom');
      // The native Next press changes the source between native gesture parts.
      // Use the keyboard for the concurrent step: starting a second
      // touchscreen tap while a finger is down would replace that contact.
      const focusSource = async () => {
        for (let n = 0; n < 30 && !await p.locator('#source-body').evaluate(e => e === document.activeElement); n++) await p.keyboard.press('Shift+Tab');
        assert.equal(await p.locator('#source-body').evaluate(e => e === document.activeElement), true, 'native keys reach source before stepping');
      };
      await focusSource();
      let changedBefore;
      const change = async () => {
        await p.keyboard.press('Meta+ArrowUp');
        await until(p, id => window.swipe648Reader.source.source_ref.id === id && window.swipe648Registry.current.source.source_ref.id === id, 'native Cmd-Up changes to exact other source', f.other);
        changedBefore = await snapshot(p);
      };
      if (engine === 'chromium' && p.touch) await finger(p, 100, 0, { between: change });
      else { await wheel(p, 0, 20); await wheel(p, -40); await change(); await wheel(p, -50); }
      noFold(f);
      assert.equal((await snapshot(p)).source.id, f.other, 'source changed to the exact other message during gesture');
      // Navigation legitimately presents the other source's own writing.
      // Completing the old contact must change neither editor nor either To.
      await kept({ ...f, before: changedBefore }, 'new source after old gesture');
      const originalDraft = await p.evaluate(key => structuredClone(window.swipe648Registry.sessions.get(key).editor.draft), f.before.editorKey);
      assert.deepEqual(originalDraft, f.before.draft, 'old source exact draft and addressees survive source change');
      await screen(f, 'source-changed-after');
      await focusSource(); await p.keyboard.press('Meta+ArrowDown'); await until(p, id => window.swipe648Reader.source.source_ref.id === id, 'native Cmd-Down restores source', f.id);
      await kept(f, 'source change and return'); await screen(f, 'negative-after'); await close(p);
    });

    await check(`item 648 access ${shape} ${theme}: sourceUnavailable unconfirmed busy error Retry access destination-unavailable; ${input}`, async () => {
      const f = await setup(shape, theme, 'access'), { p } = f;
      let mode = 'busy', release;
      const gate = new Promise(resolve => { release = resolve; });
      let denyChanges = true;
      await p.route('**/api/view', async route => {
        const req = route.request().postDataJSON();
        if (req.name === 'changes' && req.args?.scope?.kind === 'topic' && denyChanges) {
          denyChanges = false;
          return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Fixture topic access refusal', retryable: false } } });
        }
        if (req.name === 'source' && req.args?.id === f.id) {
          const selected = mode;
          if (selected === 'busy') await gate;
          if (['busy', 'unavailable'].includes(selected)) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Fixture source access refusal', retryable: false } } });
          if (selected === 'error') return route.fulfill({ status: 503, json: { error: { code: 'DATABASE_BUSY', message: 'Fixture access check failed', retryable: true } } });
        }
        if (req.name === 'editor_state' && req.args?.source_ref?.id === f.id && mode === 'read-only') {
          const response = await route.fetch(), body = await response.json(); body.destination_available = false;
          return route.fulfill({ response, json: body });
        }
        return route.continue();
      });
      try {
        // A real fixture commit wakes the app's existing live change reader.
        await control({ method: 'agent_message', operation_id: f.topic + '-wake', topic_id: f.topic, body: 'Access schedule wake.' });

        await until(p, () => window.swipe648Registry.current.availabilityChecking && window.swipe648Registry.current.availabilityUnconfirmed, 'actual access check busy/unconfirmed');
        assert.equal(await p.locator('#retry-source').isDisabled(), true, 'Retry access waits for active check');
        await right(p); noFold(f); await kept(f, 'busy unconfirmed'); await screen(f, 'access-busy');
        release();
        await until(p, () => window.swipe648Registry.current.sourceUnavailable && !window.swipe648Registry.current.availabilityChecking, 'actual sourceUnavailable branch');
        assert.equal(await p.locator('#source-body').textContent(), '', 'unavailable source words removed');
        assert.equal(await p.locator('#send-reply').isDisabled(), true, 'unavailable source disables Send');
        assert.equal(await p.locator('#writing-body').evaluate(e => e.readOnly), false, 'unavailable source still allows safe local writing');
        await right(p); noFold(f); await kept(f, 'sourceUnavailable', { text: false }); await screen(f, 'access-unavailable');
        mode = 'error'; await press(p, '#retry-source');
        await until(p, () => !window.swipe648Registry.current.availabilityChecking && document.querySelector('#source-access-status').textContent.includes('Could not confirm source access'), 'access error offers Retry');
        await right(p); noFold(f); await kept(f, 'error unconfirmed', { text: false }); await screen(f, 'access-error');
        mode = 'read-only'; await press(p, '#retry-source');
        await until(p, () => !window.swipe648Registry.current.sourceUnavailable && !window.swipe648Registry.current.availabilityUnconfirmed && !window.swipe648Registry.current.availabilityChecking, 'Retry restores readable source');
        assert.equal(await p.locator('#send-reply').isDisabled(), true, 'unavailable destination disables Send');
        assert.equal(await p.locator('#writing-body').evaluate(e => e.readOnly), false, 'destination refusal keeps local writing available');
        await right(p); noFold(f); await kept(f, 'unavailable destination'); await screen(f, 'access-destination-unavailable');
        mode = 'available';
        // The paused-topic state deliberately admits no feed act. Source
        // retry does not grant topic access or fold a hidden card.
        assert.equal(await p.locator('#retry-source').isVisible(), false, 'Retry disappears after confirmed source access');
        await close(p);
      } finally { release(); }
    });

    await check(`item 648 read-only ${shape} ${theme}: native Close waits for device save, source swipe keeps exact protected writing; ${input}`, async () => {
      const f = await setup(shape, theme, 'read-only'), { p } = f;
      // Hold only completion of the genuine device save; the native Close
      // itself enters the registry's real isWritable=false branch. Refusing
      // this completion leaves the Reader open for the preserved writing.
      await p.evaluate(() => { window.swipe648SaveHold = { armed: true, releases: [], release() { this.armed = false; for (const resolve of this.releases.splice(0)) resolve(); } }; });
      try {
        await press(p, '#reader-close');
        await until(p, () => window.swipe648SaveHold.entered && document.querySelector('#writing-body').readOnly, 'real close-wait read-only writing');
        await press(p, '#writing-body'); await p.keyboard.insertText('MUST NOT CHANGE READ-ONLY WRITING');
        assert.equal(await p.locator('#writing-body').inputValue(), f.before.writing, 'native input cannot change the genuine read-only field');
        await screen(f, 'writing-read-only');
        const response = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold');
        await right(p); await (await response).finished();
        assert.equal(f.commands.filter(e => e.kind === 'message.fold').length, 1, 'read-only writing does not disable the readable source personal fold');
        const mine = (await control({ method: 'acts_as', reader: facts.actor, topic_id: f.topic })).acts;
        assert.equal(mine.items.find(row => row.message_id === f.id)?.acts.folded, true, 'only the readable source folds in Core');
        assert.equal(mine.items.find(row => row.message_id === f.other)?.acts.folded ?? false, false, 'other message unchanged');
        await p.evaluate(() => window.swipe648SaveHold.release());
        await until(p, () => !document.querySelector('#writing-body').readOnly && document.querySelector('#reader').open, 'refused close keeps Reader and writing');
        assert.equal(await p.locator('#writing-body').inputValue(), f.before.writing, 'exact writing remains after refusal');
        assert.equal(await p.locator('#who-chip').textContent(), f.before.destination, 'destination remains after refusal');
        const foreign = await control({ method: 'acts_as', reader: facts.agent, topic_id: f.topic });
        assert.equal(foreign.acts.items.find(row => row.message_id === f.id)?.acts.folded ?? false, false, 'other actor has no fold');
        assert.ok(!JSON.stringify(foreign).includes('Exact protected α writing'), 'private writing remains private');
        assert.equal(f.commands.some(e => ['message.send', 'submission.prepare', 'note.save'].includes(e.kind)), false, 'read-only gesture sends no writing');
        await screen(f, 'writing-read-only-recovered');
      } finally { await p.evaluate(() => window.swipe648SaveHold?.release?.()); }
      await close(p);
    });
  }

  // Apply the exact ledger break to the actual served source, then restore
  // it byte-for-byte. The same native/Core assertion runs under both hashes.
  await check('item 648 ledger binding-removal mutant and exact restored controls: phone-390 light and laptop dark', async () => {
    const ledger = JSON.parse(await readFile(path.join(root, 'tests/acts.json'), 'utf8')).acts.find(a => a.item === 648);
    assert.ok(ledger && ledger.break.length === 1, 'the actual item ledger break');
    const [file, from, to] = ledger.break[0], filename = path.join(root, file), original = await readFile(filename, 'utf8');
    assert.equal(original.split(from).length, 2, 'binding mutation applies exactly once');
    const mutant = original.replace(from, to), proof = { file, from, to, originalHash: digest(original), mutantHash: digest(mutant), cases: [] };
    assert.notEqual(proof.originalHash, proof.mutantHash, 'mutation actually changes source');
    const exercise = async (shape, theme, phase) => {
      const f = await setup(shape, theme, `binding-${phase}`), { p } = f;
      try {
        assert.equal(p.swipe648ReaderHash, phase === 'mutant' ? proof.mutantHash : proof.originalHash, 'browser received exact actual source bytes for this mutation phase');
        const response = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold');
        response.catch(() => {});
        await right(p);
        await picture(p, `item648-binding-${phase}`);
        // Delivered native events, no timeout is the mutant's failure.
        assert.equal(f.commands.filter(e => e.kind === 'message.fold').length, 1, 'eligible native right swipe records one fold command');
        await (await response).finished();
        await until(p, id => document.querySelector(`#messages [data-id="${id}"]`)?.dataset.folded === 'true', 'restored binding folds its card', f.id);
        const mine = (await control({ method: 'acts_as', reader: facts.actor, topic_id: f.topic })).acts;
        assert.equal(mine.items.find(row => row.message_id === f.id)?.acts.folded, true, 'Core records restored gesture');
        assert.equal(await p.locator('#writing-body').inputValue(), f.before.writing, 'restored gesture keeps exact writing');
        await picture(p, `item648-binding-${phase}`);
      } finally { await close(p); }
    };
    try {
      await writeFile(filename, mutant);
      await control({ method: 'server_stop' }); await control({ method: 'server_start' });
      assert.equal(digest(await readFile(filename)), proof.mutantHash, 'actual served mutant read back');
      for (const [shape, theme] of [['phone-390', 'light'], ['stacked', 'dark']]) {
        let failure;
        try { await exercise(shape, theme, 'mutant'); } catch (error) { failure = error; }
        assert.ok(failure?.code === 'ERR_ASSERTION' && failure.message.includes('eligible native right swipe records one fold command'), `mutant fails intended binding assertion, not setup: ${failure?.stack}`);
        proof.cases.push({ shape, theme, phase: 'mutant', failure: failure.stack });
      }
    } finally {
      await writeFile(filename, original);
      await control({ method: 'server_stop' }); await control({ method: 'server_start' });
      proof.restoredHash = digest(await readFile(filename)); proof.restored = proof.restoredHash === proof.originalHash;
      records.push({ mutation: proof }); await saveRecords();
    }
    assert.equal(proof.restored, true, 'actual source restored exactly');
    for (const [shape, theme] of [['phone-390', 'light'], ['stacked', 'dark']]) { await exercise(shape, theme, 'restored'); proof.cases.push({ shape, theme, phase: 'restored', passed: true }); }
    await saveRecords();
  });

  await check('item 648 geometry actual CSS mutants and restored controls: named 2px containment and 1px phone floor tolerances', async () => {
    const filename = path.join(root, 'web/aim.css'), original = await readFile(filename, 'utf8');
    const proof = { file: 'web/aim.css', originalHash: digest(original), phases: [] };
    const exercise = async (phase, expectedHash) => {
      const f = await setup('phone-390', 'dark', `geometry-${phase}`);
      try {
        assert.equal(f.p.swipe648CssHash, expectedHash, 'browser received exact CSS mutation phase');
        await screen(f, `geometry-${phase}`);
      } finally { await close(f.p); }
    };
    for (const [name, css, assertion] of [
      ['containment', '\n#reader{transform:translateX(12px)!important}\n', 'Reader contained within named 2px tolerance'],
      ['target', '\n#reader-close{height:22px!important;min-height:22px!important}\n', 'reader-close 44px phone floor with named 1px tolerance'],
    ]) {
      const mutant = original + css, mutantHash = digest(mutant);
      assert.notEqual(mutantHash, proof.originalHash, 'actual CSS mutation changes bytes');
      try {
        await writeFile(filename, mutant);
        assert.equal(digest(await readFile(filename)), mutantHash, 'actual CSS mutant read back');
        await control({ method: 'server_stop' }); await control({ method: 'server_start' });
        let failure;
        try { await exercise(name, mutantHash); } catch (error) { failure = error; }
        assert.ok(failure?.code === 'ERR_ASSERTION' && failure.message.includes(assertion), `geometry mutant fails intended measurement, not setup: ${failure?.stack}`);
        proof.phases.push({ name, mutantHash, failure: failure.stack });
      } finally {
        await writeFile(filename, original);
        await control({ method: 'server_stop' }); await control({ method: 'server_start' });
        proof.restoredHash = digest(await readFile(filename));
        records.push({ geometryMutation: structuredClone(proof) }); await saveRecords();
      }
      assert.equal(proof.restoredHash, proof.originalHash, 'CSS restored byte for byte');
      await exercise(`${name}-restored`, proof.originalHash);
      proof.phases.push({ name: `${name}-restored`, passed: true });
    }
    records.push({ geometryMutation: proof }); await saveRecords();
  });
  } finally {
    await control({ method: 'actor_name', actor_id: facts.agent, name: facts.agent });
  }
}
