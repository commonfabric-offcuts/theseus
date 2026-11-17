// Item 648: real input, real app guards, HTTP permission/failure seams.
// Observers delegate unchanged and never invoke an application action.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function observe648(p) {
  await p.addInitScript(() => {
    window.swipe648Inputs = [];
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'wheel']) document.addEventListener(type, e => {
      window.swipe648Inputs.push({ type, trusted: e.isTrusted, target: e.target.id, ctrl: e.ctrlKey });
    }, { capture: true, passive: true });
  });
  await p.route('**/app.mjs', async route => {
    const response = await route.fetch();
    const observer = `import { Reader as Swipe648Reader } from './reader.mjs';
import { EditorRegistry as Swipe648Registry } from './app-session.mjs';
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
      writing: document.querySelector('#writing-body').value, destination: document.querySelector('#who-chip').textContent,
      unavailable: Boolean(p.sourceUnavailable), unconfirmed: Boolean(p.availabilityUnconfirmed), checking: Boolean(p.availabilityChecking),
      readOnly: document.querySelector('#writing-body').readOnly, inputs: window.swipe648Inputs };
  });
  const setup = async (shape, theme, tag) => {
    const topic = `648-${engine}-${shape}-${theme}-${tag}`;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Swipe protections' }] });
    const id = (await control({ method: 'agent_message', operation_id: topic, topic_id: topic, join: true, source: 'topic', body: 'Swipe protections. Exact original words for the reader.\n\nAnother paragraph remains readable.' })).result.message_id;
    const other = (await control({ method: 'agent_message', operation_id: topic + '-other', topic_id: topic, body: 'Other source stays unchanged.' })).result.message_id;
    const p = await page(shape, theme, `/?topic=${topic}`, facts, opts);
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
    const b = await p.locator(selector).boundingBox(); assert.ok(b && b.width > 0 && b.height > 0, `visible input surface ${selector}`);
    return { x: b.x + Math.min(65, b.width / 3), y: b.y + Math.min(25, b.height / 2) };
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
    const at = await point(p, selector), n = await p.evaluate(() => window.swipe648Inputs.length);
    const cdp = await p.ctx.newCDPSession(p);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
      if (between) await between();
      for (let step = 1; step <= 4; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + dx * step / 4, y: at.y + dy * step / 4 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      // Browser scrolling can cancel the page's touch path before end.
      await until(p, n => window.swipe648Inputs.slice(n).some(e => ['touchend', 'touchcancel'].includes(e.type) && e.trusted), 'native touch completion or browser cancellation', n);
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally { await cdp.detach(); }
  };
  const right = p => engine === 'chromium' && p.touch ? finger(p) : wheel(p, -100);
  const noFold = f => assert.equal(f.commands.filter(e => e.kind === 'message.fold').length, 0, 'protected gesture issues no fold command');
  const kept = async (f, label, { text = true } = {}) => {
    const now = await snapshot(f.p);
    assert.equal(now.open, true, `${label}: Reader stays open`);
    assert.equal(now.writing, f.before.writing, `${label}: exact writing kept`);
    assert.equal(now.destination, f.before.destination, `${label}: destination kept`);
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
    assert.ok(geometry.left >= -CONTAINMENT_TOLERANCE_PX && geometry.right <= geometry.width + CONTAINMENT_TOLERANCE_PX, `${label}: Reader contained within named ${CONTAINMENT_TOLERANCE_PX}px tolerance`);
    assert.ok(geometry.overflow <= CONTAINMENT_TOLERANCE_PX, `${label}: page overflow <= named ${CONTAINMENT_TOLERANCE_PX}px, got ${geometry.overflow}`);
    if (f.p.touch) for (const t of geometry.targets) assert.ok(Math.min(t.w, t.h) >= 44 - PHONE_TARGET_TOLERANCE_PX, `${label}: ${t.id} 44px phone floor with named ${PHONE_TARGET_TOLERANCE_PX}px tolerance, got ${t.w}×${t.h}`);
    records.push({ shape: f.p.shape, theme: f.p.scheme, label, geometry, state: await snapshot(f.p) }); await saveRecords();
    await picture(f.p, `item648-protection-${label}`);
  };

  for (const shape of shapes) for (const theme of ['light', 'dark']) {
    const input = engine === 'webkit' ? 'phone-width desktop wheel/native taps (laptop wheel at stacked)' : shape.startsWith('phone') ? 'native finger drag' : 'desktop wheel';
    await check(`item 648 protections ${shape} ${theme}: left short vertical zoom selection cancellation source-change; ${input}`, async () => {
      const f = await setup(shape, theme, 'negative'), { p } = f;
      await screen(f, 'negative-before');
      for (const [name, dx, dy] of [['left', -100, 0], ['short', 55, 0], ['vertical', 0, 100]]) {
        if (engine === 'chromium' && p.touch) await finger(p, dx, dy);
        else { await wheel(p, 0, 20); await wheel(p, -dx, dy); }
        noFold(f); await kept(f, name); records.push({ shape, theme, negative: name, input });
      }
      // Native pointer selection tests the browser's actual selection, also
      // in touch-enabled contexts; this is not a WebKit finger-selection claim.
      const at = await point(p);
      await p.mouse.click(at.x, at.y, { clickCount: 2 });
      await until(p, () => !window.getSelection().isCollapsed, 'native selection on source words');
      await wheel(p, 0, 20); await wheel(p, -100); noFold(f); await kept(f, 'selection');
      await p.mouse.click(at.x, at.y);
      await until(p, () => window.getSelection().isCollapsed, 'native click releases selection');
      if (engine === 'chromium' && p.touch) await finger(p, 100, 0, { cancel: true });
      else { await wheel(p, 0, 20); await wheel(p, -40); await wheel(p, 0, 60); await wheel(p, -50); }
      noFold(f); await kept(f, 'cancellation/reset');
      await wheel(p, -100, 0, '#source-body', true); noFold(f); await kept(f, 'native Control-wheel zoom');
      // The native Next press changes the source between native gesture parts.
      const change = async () => { await press(p, '#next-message'); await until(p, id => window.swipe648Reader.source.source_ref.id !== id, 'native Next changes source', f.id); };
      if (engine === 'chromium' && p.touch) await finger(p, 100, 0, { between: change });
      else { await wheel(p, 0, 20); await wheel(p, -40); await change(); await wheel(p, -50); }
      noFold(f);
      await press(p, '#previous-message'); await until(p, id => window.swipe648Reader.source.source_ref.id === id, 'native Previous restores source', f.id);
      await kept(f, 'source change and return'); await screen(f, 'negative-after'); await close(p);
    });

    await check(`item 648 access ${shape} ${theme}: sourceUnavailable unconfirmed busy error Retry access read-only; ${input}`, async () => {
      const f = await setup(shape, theme, 'access'), { p } = f;
      let mode = 'busy', release, entered;
      const gate = new Promise(resolve => { release = resolve; });
      const sourceEntered = new Promise(resolve => { entered = resolve; });
      let denyChanges = true;
      await p.route('**/api/view', async route => {
        const req = route.request().postDataJSON();
        if (req.name === 'changes' && req.args?.scope?.kind === 'topic' && denyChanges) {
          denyChanges = false;
          return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Fixture topic access refusal', retryable: false } } });
        }
        if (req.name === 'source' && req.args?.id === f.id) {
          const selected = mode;
          if (selected === 'busy') { entered(); await gate; }
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
        assert.equal(await p.locator('#writing-body').evaluate(e => e.readOnly), true, 'real unavailable writing is read-only');
        await right(p); noFold(f); await kept(f, 'sourceUnavailable', { text: false }); await screen(f, 'access-unavailable');
        mode = 'error'; await press(p, '#retry-source');
        await until(p, () => !window.swipe648Registry.current.availabilityChecking && document.querySelector('#source-access-status').textContent.includes('Could not confirm source access'), 'access error offers Retry');
        await right(p); noFold(f); await kept(f, 'error unconfirmed', { text: false }); await screen(f, 'access-error');
        mode = 'read-only'; await press(p, '#retry-source');
        await until(p, () => !window.swipe648Registry.current.sourceUnavailable && !window.swipe648Registry.current.availabilityUnconfirmed && !window.swipe648Registry.current.availabilityChecking, 'Retry restores readable source');
        assert.equal(await p.locator('#writing-body').evaluate(e => e.readOnly), true, 'readable source has genuinely read-only destination');
        await press(p, '#writing-body'); await p.keyboard.insertText('MUST NOT ENTER READ-ONLY WRITING');
        await right(p); noFold(f); await kept(f, 'read-only destination'); await screen(f, 'access-read-only');
        mode = 'available';
        // The paused-topic state deliberately admits no feed act. Source
        // retry does not grant topic access or fold a hidden card.
        assert.equal(await p.locator('#retry-source').isVisible(), false, 'Retry disappears after confirmed source access');
        await close(p);
      } finally { release(); }
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
        const response = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold');
        response.catch(() => {});
        await right(p);
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
      await writeFile(filename, mutant); assert.equal(digest(await readFile(filename)), proof.mutantHash, 'actual served mutant read back');
      for (const [shape, theme] of [['phone-390', 'light'], ['stacked', 'dark']]) {
        let failure;
        try { await exercise(shape, theme, 'mutant'); } catch (error) { failure = error; }
        assert.ok(failure?.code === 'ERR_ASSERTION' && failure.message.includes('eligible native right swipe records one fold command'), `mutant fails intended binding assertion, not setup: ${failure?.stack}`);
        proof.cases.push({ shape, theme, phase: 'mutant', failure: failure.stack });
      }
    } finally {
      await writeFile(filename, original); proof.restoredHash = digest(await readFile(filename)); proof.restored = proof.restoredHash === proof.originalHash;
      records.push({ mutation: proof }); await saveRecords();
    }
    assert.equal(proof.restored, true, 'actual source restored exactly');
    for (const [shape, theme] of [['phone-390', 'light'], ['stacked', 'dark']]) { await exercise(shape, theme, 'restored'); proof.cases.push({ shape, theme, phase: 'restored', passed: true }); }
    await saveRecords();
  });
}
