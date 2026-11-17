// Item 648's cases run only through native-compose, in its two engines.
import assert from 'node:assert/strict';

export async function composeSwipe648({ check, page, open, press, until, picture, close, control, facts, engine }) {
  const states = ['reading', 'writing', 'private-note', 'busy', 'refused', 'starred', 'folded', 'horizontal-code', 'empty'];
  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const theme of ['light', 'dark']) for (const state of states) {
    await check(`item 648 ${shape} ${theme} ${state}: a right swipe folds only the composer's message and keeps exact writing`, async () => {
      const topic = `swipe648-${engine}-${shape}-${theme}-${state}`;
      await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Swipe in the composer' }] });
      const body = state === 'horizontal-code' ? 'Swipe fixture.\n\n```\n' + 'wide code '.repeat(100) + '\n```' : 'Swipe fixture. Exact original words, kept for their reader.\n\nA second paragraph to read.';
      const id = (await control({ method: 'agent_message', operation_id: topic, topic_id: topic, join: true, source: 'topic', body })).result.message_id;
      const other = (await control({ method: 'agent_message', operation_id: topic + '-other', topic_id: topic, body: 'Other message, left alone.' })).result.message_id;
      if (state === 'starred') await control({ method: 'stack_act', sender: facts.actor, kind: state === 'starred' ? 'message.star' : 'message.fold', message_id: id, operation_id: topic + '-initial', args: state === 'starred' ? { starred: true } : { folded: true } });
      const p = await page(shape, theme, `/?topic=${topic}`, facts, engine === 'webkit' ? { isMobile: false } : {});
      const sent = [];
      p.on('request', request => { if (request.url().endsWith('/api/command')) sent.push(request.postDataJSON()); });
      if (state === 'empty') {
        await press(p, '#new-message');
        await until(p, () => document.querySelector('#new-message-sheet').open, 'the empty New message composer');
      } else await open(p, id, 'Swipe fixture.');
      if (state === 'folded') {
        await press(p, '#reader-menu');
        await press(p, '[role=menuitem]:text-is("Fold message")');
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
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      if (state === 'busy' || state === 'refused') await p.route('**/api/command', async route => {
        if (route.request().postDataJSON()?.kind !== 'message.fold') return route.continue();
        await gate;
        if (state === 'refused') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STALE_REVISION', message: 'The message changed. Try folding it again.', retryable: false } }) });
        return route.continue();
      });
      // Named tolerance: screenshots and containment allow 2 CSS pixels for engine rounding.
      const EDGE_TOLERANCE_PX = 2;
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(over <= EDGE_TOLERANCE_PX, `page overflow <= ${EDGE_TOLERANCE_PX}px, got ${over}`);
      await picture(p, `item648-${state}-before`);
      const target = state === 'empty' ? field : state === 'horizontal-code' ? '#source-body .md-pre' : '#source-body';
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
        await swipe();
        if (foldRequest) {
          await foldRequest;
          await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'the message folded optimistically', id);
          if (state === 'busy' || state === 'refused') await picture(p, `item648-${state}-pending`);
          release();
          await (await foldedResponse).finished();
          if (state === 'refused') await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded !== 'true', 'refusal restores the message', id);
          else await until(p, id => document.querySelector(`#messages .message-card[data-id="${id}"]`)?.dataset.folded === 'true', 'the fold remains drawn', id);
        } else await until(p, () => document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).every(a => a.playState !== 'running'), 'the gesture has settled');
        const folds = sent.filter(e => e.kind === 'message.fold');
        assert.equal(folds.length, foldRequest ? 1 : 0, 'only the eligible right swipe issues one fold');
        if (folds.length) assert.deepEqual([folds[0].target.message_id, folds[0].args], [id, { folded: true }], 'only the message under the gesture folds');
        assert.equal(await p.locator(field).inputValue(), writing, 'exact writing is kept');
        assert.equal(await p.locator(audience).textContent(), destination, 'the destination is kept');
        assert.equal(sent.some(e => ['message.send', 'submission.prepare', 'note.save'].includes(e.kind)), false, 'nothing sent or saved as a private note');
        const acts = (await control({ method: 'acts_as', reader: facts.actor, topic_id: topic })).acts;
        const folded = acts.items.find(row => row.message_id === id)?.acts.folded ?? false;
        assert.equal(folded, Boolean((foldRequest && state !== 'refused') || state === 'folded'), 'Core holds exactly the expected fold');
        assert.equal(sent.some(e => e.kind === 'message.fold' && e.target.message_id === other), false, 'the other message is untouched');
        const foreign = await control({ method: 'acts_as', reader: facts.agent, topic_id: topic });
        assert.equal(foreign.acts.items.find(row => row.message_id === id)?.acts.folded ?? false, false, 'another actor has no fold');
        assert.ok(!JSON.stringify(foreign).includes('Exact α writing'), 'private writing is never another actor\'s acts');
        await picture(p, `item648-${state}-after`);
        await close(p);
      } finally { release(); if (foldRequest) await foldRequest.catch(() => {}); }
    });
  }
}
