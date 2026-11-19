// Item 648's cases run only through native-compose, in its two engines.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { geometry648 } from './swipe_648_geometry.mjs';

export const EDGE_TOLERANCE_PX = 2;
export const RESTORE_TOLERANCE_PX = .5;
export function assertCue793(layout) {
  const { row, cue } = layout.folded793;
  assert.ok(cue.right <= Math.min(row.right, layout.width) + EDGE_TOLERANCE_PX,
    `Folded stays inside its row and screen with EDGE_TOLERANCE_PX=${EDGE_TOLERANCE_PX}: ${JSON.stringify({ row, cue })}`);
}
export function assertGeometry648(layout, { touch, sender } = {}) {
  assert.ok(layout.overflow <= EDGE_TOLERANCE_PX, `page overflow <= ${EDGE_TOLERANCE_PX}px, got ${layout.overflow}`);
  const PHONE_TARGET_TOLERANCE_PX = 1;
  if (touch) for (const t of layout.targets) assert.ok(Math.min(t.width, t.height) >= 44 - PHONE_TARGET_TOLERANCE_PX,
    `${t.id} 44px phone floor with named ${PHONE_TARGET_TOLERANCE_PX}px tolerance, got ${t.width}×${t.height}`);
  if (sender) {
    const { author, cue } = layout.folded793;
    assert.equal(author.text, sender, 'the full original technical sender remains in DOM text');
    assert.equal(author.textOverflow, 'ellipsis');
    assert.equal(author.overflowX, 'hidden');
    assert.equal(author.minWidth, '0px');
    assert.equal(author.flexShrink, '1');
    assert.equal(cue.text, 'Folded');
    assert.equal(cue.flexShrink, '0', 'Folded keeps its whole room');
    assert.equal(cue.whiteSpace, 'nowrap');
    assertCue793(layout);
  }
}

export function assertRestored793(before, after) {
  for (const [name, a, b] of [['page overflow', before.overflow, after.overflow],
    ['cue width', before.folded793.cue.width, after.folded793.cue.width]])
    assert.ok(Math.abs(a - b) <= RESTORE_TOLERANCE_PX, `${name} restored within RESTORE_TOLERANCE_PX=${RESTORE_TOLERANCE_PX}: ${a} -> ${b}`);
}

// Diagnose first; neither screenshot nor JSON errors may replace a geometry failure.
export async function inspect648({ measure, validate, layoutFile, picture, resultFile }) {
  let layout = null, primary = null;
  const captureErrors = [], say = error => error.stack ?? String(error);
  try { layout = await measure(); validate(layout); } catch (error) { primary = error; }
  for (const [name, capture] of [['layout', () => layoutFile(layout)], ['picture', picture]]) {
    try { await capture(); } catch (error) { captureErrors.push({ capture: name, error: say(error) }); }
  }
  try { await resultFile({ primaryError: primary && say(primary), captureErrors }); }
  catch (error) { captureErrors.push({ capture: 'result', error: say(error) }); }
  if (primary) {
    primary.layout = layout; primary.captureErrors = captureErrors;
    if (captureErrors.length) primary.stack += `\nSeparate capture errors: ${JSON.stringify(captureErrors)}`;
    throw primary;
  }
  if (captureErrors.length) throw new Error(`Geometry captures failed: ${JSON.stringify(captureErrors)}`);
  return layout;
}

export async function composeSwipe648({ check, page, open, press, until, picture, close, control, facts, engine, evidence }) {
  const states = ['reading', 'writing', 'private-note', 'busy', 'refused', 'starred', 'folded', 'horizontal-code', 'horizontal-table', 'source-control', 'empty'];
  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const theme of ['light', 'dark']) for (const state of states) {
    await check(`item 648 ${shape} ${theme} ${state}: a right swipe folds only the composer's message and keeps exact writing`, async () => {
      // Keep the original already-folded technical-name fixture distinct.
      // The other states use a fictional display name, as the protection
      // matrix does, without changing product layout or tolerances.
      await control({ method: 'actor_name', actor_id: facts.agent, name: state === 'folded' ? facts.agent : 'Pipit' });
      const topic = `swipe648-${engine}-${shape}-${theme}-${state}`;
      await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Swipe in the composer' }] });
      const body = state === 'horizontal-code' ? 'Swipe fixture.\n\n```\n' + 'wide code '.repeat(100) + '\n```'
        : state === 'horizontal-table' ? 'Swipe fixture.\n\n| Heading | ' + 'LongHeading'.repeat(30) + ' |\n| --- | --- |\n| Words | More words |'
        : state === 'source-control' ? 'Swipe fixture. Exact original words are kept. The reader can read this paragraph before opening the linked reference.\n\n[Read the reference](https://example.invalid/reference)'
        : 'Swipe fixture. Exact original words, kept for their reader.\n\nA second paragraph to read.';
      const id = (await control({ method: 'agent_message', operation_id: topic, topic_id: topic, join: true, source: 'topic', body })).result.message_id;
      const other = (await control({ method: 'agent_message', operation_id: topic + '-other', topic_id: topic, body: 'Other message, left alone.' })).result.message_id;
      if (state === 'starred') await control({ method: 'stack_act', sender: facts.actor, kind: state === 'starred' ? 'message.star' : 'message.fold', message_id: id, operation_id: topic + '-initial', args: state === 'starred' ? { starred: true } : { folded: true } });
      const p = await page(shape, theme, `/?topic=${topic}`, facts, undefined, engine === 'webkit' ? { isMobile: false } : {});
      const sent = [];
      p.on('request', request => { if (request.url().endsWith('/api/command')) sent.push(request.postDataJSON()); });
      if (state === 'empty') {
        await press(p, '#new-message');
        await until(p, () => document.querySelector('#new-message-sheet').open, 'the empty New message composer');
      } else await open(p, id, 'Swipe fixture.');
      if (state === 'folded') {
        await press(p, '#reader-menu');
        const savedFold = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold');
        await press(p, '[role=menuitem]:text-is("Fold message")');
        await (await savedFold).finished();
        await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'setup: the message already folded', id);
      }
      if (state === 'private-note') {
        await press(p, '#plus-button');
        await until(p, () => !document.querySelector('#plus-panel').hidden, 'the + panel');
        await press(p, '#toggle-note');
        await until(p, () => document.querySelector('#note-chip').getClientRects().length > 0, 'the private note');
      }
      const field = state === 'empty' ? '#inline-writing-body' : '#writing-body';
      if (['writing', 'private-note', 'busy', 'refused', 'empty'].includes(state)) {
        await press(p, field);
        const saved = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === (state === 'private-note' ? 'note.save' : 'draft.save'));
        await p.keyboard.insertText('  Exact α writing\nwith a second line.  ');
        await (await saved).finished();
        await until(p, () => ![...document.querySelectorAll('[data-save="saving"]')].some(e => e.getClientRects().length), 'the writing saved');
      }
      const writing = await p.locator(field).inputValue();
      const audience = state === 'empty' ? '#inline-who-chip' : '#who-chip';
      const destination = await p.locator(audience).textContent();
      let release, foldAttempts = 0;
      const gate = new Promise(resolve => { release = resolve; });
      if (state === 'busy' || state === 'refused') await p.route('**/api/command', async route => {
        if (route.request().postDataJSON()?.kind !== 'message.fold') return route.continue();
        await gate;
        if (state === 'refused' && ++foldAttempts === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STALE_REVISION', message: 'The message changed. Try folding it again.', retryable: false } }) });
        return route.continue();
      });
      const screen = async phase => {
        await mkdir(path.join(evidence, engine), { recursive: true });
        const file = kind => path.join(evidence, engine, `${shape}-${theme}-item648-${state}-${kind}-${phase}.json`);
        return inspect648({
          measure: () => p.evaluate(geometry648, state === 'folded' ? id : null),
          validate: layout => assertGeometry648(layout, { touch: p.touch, sender: state === 'folded' ? facts.agent : null }),
          layoutFile: layout => writeFile(file('layout'), JSON.stringify(layout, null, 2)),
          picture: () => picture(p, `item648-${state}-${phase}`),
          resultFile: result => writeFile(file('result'), JSON.stringify(result, null, 2)),
        });
      };
      const before793 = await screen('before');
      if (state === 'folded') {
        const card = `#messages .message-card[data-id="${id}"]`;
        assert.ok((await p.locator(card).ariaSnapshot()).includes(facts.agent), 'the complete sender remains in the accessible name');
        const cue = `${card} > .message-folded > .folded-cue`;
        const originalStyle = await p.locator(cue).getAttribute('style');
        let negative;
        try {
          const applied = await p.locator(cue).evaluate((el, width) => {
            el.style.width = `${width}px`;
            return el.style.width;
          }, before793.width + 16);
          assert.equal(applied, `${before793.width + 16}px`, 'actual painted cue-width mutant applied');
          try { await screen('cue-mutant'); } catch (error) { negative = error; }
          assert.ok(negative, 'widened painted cue must fail');
          assert.match(negative.message, /page overflow|Folded stays inside/);
          assert.deepEqual(negative.captureErrors, [], 'negative captures completed independently');
          assert.ok(negative.layout.folded793.cue.width > before793.width + EDGE_TOLERANCE_PX,
            `actual painted cue widening exceeds EDGE_TOLERANCE_PX=${EDGE_TOLERANCE_PX}`);
          assert.throws(() => assertCue793(negative.layout), /EDGE_TOLERANCE_PX/,
            'the actual painted mutant fails row containment independently of page overflow');
          assert.throws(() => assertRestored793(before793, negative.layout), /RESTORE_TOLERANCE_PX/,
            'the applied mutant also exceeds the restoration tolerance');
        } finally {
          await p.locator(cue).evaluate((el, style) => {
            if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
          }, originalStyle);
        }
        assert.equal(await p.locator(cue).getAttribute('style'), originalStyle, 'exact cue style restored');
        assertRestored793(before793, await screen('restored'));
      }
      const target = state === 'empty' ? field : state === 'horizontal-code' ? '#source-body .md-pre'
        : state === 'horizontal-table' ? '#source-body .md-table' : state === 'source-control' ? '#source-body a' : '#source-body';
      if (state === 'source-control') {
        await p.locator(target).scrollIntoViewIfNeeded();
        await screen('control-ready');
      }
      const box = await p.locator(target).boundingBox();
      const x = box.x + Math.min(box.width / 3, 70), y = box.y + Math.min(box.height / 2, 40);
      await p.mouse.move(x, y);
      sent.length = 0; // Only acts made by the gesture, after setup saves have answered.
      // Chromium phones use a native finger drag. WebKit uses a native wheel in a
      // touch-enabled desktop context at the phone width; it cannot drive a finger drag.
      const swipe = async () => {
        if (engine === 'chromium' && p.touch) {
          const cdp = await p.ctx.newCDPSession(p);
          try {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let step = 1; step <= 4; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 25 * step, y }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } finally { await cdp.detach(); }
        } else await p.mouse.wheel(-100, 0);
      };
      const foldRequest = ['reading', 'writing', 'private-note', 'busy', 'refused'].includes(state)
        ? p.waitForRequest(r => r.url().endsWith('/api/command') && r.postDataJSON()?.kind === 'message.fold', { timeout: 8000 }) : null;
      try {
        const foldedResponse = foldRequest ? p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold') : null;
        foldedResponse?.catch(() => {});
        await swipe();
        if (foldRequest) {
          await foldRequest;
          await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'the message folded optimistically', id);
          if (state === 'busy' || state === 'refused') await screen('pending');
          release();
          await (await foldedResponse).finished();
          if (state === 'refused') await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded !== 'true', 'refusal restores the message', id);
          else await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'the fold remains drawn', id);
        } else await until(p, () => document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the gesture has settled');
        if (state === 'refused') {
          await screen('rollback');
          const recovered = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.fold');
          // A native vertical wheel starts a new gesture; no timed gap/sleep.
          if (!(engine === 'chromium' && p.touch)) await p.mouse.wheel(0, 60);
          await swipe();
          await (await recovered).finished();
          await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'a new native swipe recovers the refused fold', id);
        }
        assert.equal(await p.locator('#reader').evaluate(e => e.open), state !== 'empty', 'the Reader stays open throughout its fold');
        const folds = sent.filter(e => e.kind === 'message.fold');
        assert.equal(folds.length, state === 'refused' ? 2 : foldRequest ? 1 : 0, 'only eligible swipes issue one fold each, including refused recovery');
        if (folds.length) assert.deepEqual([folds[0].target.message_id, folds[0].args], [id, { folded: true }], 'only the message under the gesture folds');
        assert.equal(await p.locator(field).inputValue(), writing, 'exact writing is kept');
        assert.equal(await p.locator(audience).textContent(), destination, 'the destination is kept');
        if (state !== 'empty') assert.equal(await p.locator('#note-chip').isVisible(), state === 'private-note', 'reply/private-note mode is kept');
        assert.equal(sent.some(e => ['message.send', 'submission.prepare', 'note.save'].includes(e.kind)), false, 'nothing sent or saved as a private note');
        const acts = (await control({ method: 'acts_as', reader: facts.actor, topic_id: topic })).acts;
        const folded = acts.items.find(row => row.message_id === id)?.acts.folded ?? false;
        assert.equal(folded, Boolean(foldRequest || state === 'folded'), 'Core holds exactly the expected fold');
        assert.equal(sent.some(e => e.kind === 'message.fold' && e.target.message_id === other), false, 'the other message is untouched');
        const foreign = await control({ method: 'acts_as', reader: facts.agent, topic_id: topic });
        assert.equal(foreign.acts.items.find(row => row.message_id === id)?.acts.folded ?? false, false, 'another actor has no fold');
        assert.ok(!JSON.stringify(foreign).includes('Exact α writing'), 'private writing is never another actor\'s acts');
        await screen('after');
        if (state !== 'empty') {
          await press(p, '#reader-close');
          await until(p, () => !document.querySelector('#reader').open, 'the Reader closed with writing kept');
          await screen('feed');
        }
        await close(p);
      } finally { release(); if (foldRequest) await foldRequest.catch(() => {}); }
    });
  }
  await control({ method: 'actor_name', actor_id: facts.agent, name: facts.agent });
}
