import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// All dimensions in CSS pixels. One pixel permits independent browser layout
// rounding; a missing row or the 120px source-cap mutant exceeds it by far.
export const ITEM721_TOLERANCE = Object.freeze({ edgePx: 1, scrollPx: 1, targetPx: 1 });
const LONG = Array.from({ length: 45 }, (_, i) => `Source paragraph ${i + 1}: keep these complete words above the reply, including the last paragraph.`).join('\n\n');
const SHORT = 'Source words stay here. A second sentence can be quoted explicitly.';
const WRITING = 'Exact reply writing. Select these words.';

export async function item721Compose(h) {
  const { check, page, press, until, picture, close, control, facts, engine, measured, contexts } = h;
  const mutants = JSON.parse(await readFile(new URL('./fixtures/item_721_mutants.json', import.meta.url), 'utf8'));
  let serial = 0;
  const card = id => `#messages .message-card[data-id="${id}"]`;
  const entry = id => `#messages [data-id="${id}"]`;
  const opened = p => until(p, () => document.querySelector('#reader').open, 'the real Reader opens');
  const shut = p => until(p, () => !document.querySelector('#reader').open, 'the reply closes after keeping writing');
  const snapshot = (p, id) => p.evaluate(([id, tolerance]) => {
    const r = document.querySelector('#reader'), c = document.querySelector(`#messages .message-card[data-id="${id}"]`),
      source = c.querySelector(':scope > .message-preview'), field = document.querySelector('#writing-body');
    const visible = el => !!el?.getClientRects().length && getComputedStyle(el).display !== 'none';
    const box = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
    const s = getComputedStyle(source), sourceBox = box(source), replyBox = box(r);
    return { dock: r.parentElement === c && r.hasAttribute('data-card-reply') && c.getAttribute('role') === 'group' && !r.matches(':modal'),
      readers: document.querySelectorAll('#reader').length, writingFields: document.querySelectorAll('#writing-body').length,
      body: field.value, title: visible(document.querySelector('#reader-title')) && !!document.querySelector('#reader-title').textContent,
      close: visible(document.querySelector('#reader-close')), addressing: visible(document.querySelector('#who-chip')),
      whole: source.textContent === LONG && s.maxHeight === 'none' && s.overflowY === 'visible' && replyBox.top >= sourceBox.bottom - tolerance.edgePx,
      select: s.userSelect || s.webkitUserSelect, source: source.textContent, sourceBox, replyBox,
      overflow: document.documentElement.scrollWidth - innerWidth, sourceScroll: source.scrollHeight - source.clientHeight,
      writingSelection: { start: field.selectionStart, end: field.selectionEnd }, active: document.activeElement?.id,
      open: r.open, modal: r.matches(':modal'), parent: r.parentElement.id, notice: document.querySelector('#source-access-status').textContent,
      disabled: document.querySelector('#send-reply').disabled };
  }, [id, ITEM721_TOLERANCE]);
  const seed = async (label, body = LONG, coordination = false) => {
    const topic = `item721-${engine}-${++serial}-${label}`;
    if (label === 'unavailable') {
      const owned = await control({ method: 'agent_topic', operation_id: topic, title: 'Source access', body });
      const messages = await control({ method: 'agent_view', name: 'topic_messages', args: { topic_id: owned.topic_id } });
      return { topic: owned.topic_id, id: messages.items[0].id, body };
    }
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Reply in this card' }] });
    const message = await control({ method: 'agent_message', operation_id: topic + '-source', topic_id: topic, join: true, source: 'topic', body,
      addressees: coordination ? ['aim-core'] : [facts.actor] });
    return { topic, id: message.result.message_id, body };
  };
  async function light(p, id) {
    const selector = card(id);
    await until(p, s => !!document.querySelector(s)?.getClientRects().length, 'source card drawn', selector);
    const target = p.locator(selector + ' > .message-preview');
    const folded = await p.evaluate(s => document.querySelector(s).dataset.folded === 'true', selector);
    const at = folded ? p.locator(selector + ' > .message-folded') : target;
    await at.scrollIntoViewIfNeeded();
    const b = await at.boundingBox();
    assert.ok(b && b.width && b.height, 'native Reply source target has a box');
    const x = b.x + Math.min(30, b.width / 2), y = b.y + Math.min(10, b.height / 2);
    if (p.touch) await p.touchscreen.tap(x, y);
    else { await p.mouse.move(x + 3, y + 2); await p.mouse.move(x, y); }
    await until(p, () => !!document.querySelector('.message-bar:not([hidden]) [data-act="reply"]')?.getClientRects().length, 'hover or tap offers actual Reply');
  }
  async function reply(p, id, keys = false) {
    await light(p, id);
    if (keys) {
      // Focus is acquired by actual Tab, never by invoking the menu handler.
      for (let n = 0; n < 24 && !await p.evaluate(() => document.activeElement?.matches('.message-bar [data-act="reply"]')); n++) await p.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
      assert.equal(await p.evaluate(() => document.activeElement?.matches('.message-bar [data-act="reply"]')), true, 'Tab reaches Reply');
      await p.keyboard.press('Enter');
    } else await press(p, '.message-bar [data-act="reply"]');
    await opened(p);
  }
  async function write(p, text = WRITING) {
    await p.locator('#writing-body').scrollIntoViewIfNeeded();
    await press(p, '#writing-body'); await p.keyboard.insertText(text);
    await until(p, text => document.querySelector('#writing-body').value === text, 'exact native writing', text);
  }
  async function dragSource(p, id) {
    const target = p.locator(card(id) + ' > .message-preview');
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    await p.mouse.move(b.x + 3, b.y + 9); await p.mouse.down();
    await p.mouse.move(b.x + Math.min(180, b.width - 3), b.y + 9, { steps: 12 }); await p.mouse.up();
    return p.evaluate(() => getSelection().toString());
  }
  async function runtime(phase, action) {
    const receipt = await control({ method: 'item_721_runtime', phase });
    measured.push({ engine, item: 721, kind: 'source-runtime', ...receipt });
    try { return await action(receipt); }
    finally {
      for (const context of contexts) await context.close();
      contexts.clear();
      await control({ method: 'read_fault_clear' });
      const restored = await control({ method: 'item_721_runtime', phase: 'restored' });
      assert.equal(restored.restored, true);
      assert.deepEqual(restored.hashes, receipt.candidate_hashes, 'exact candidate source restoration');
      measured.push({ engine, item: 721, kind: 'source-restore', ...restored });
    }
  }
  const oracle = (key, observed) => {
    if (key === 'dock') assert.equal(observed.dock, true, 'item 721 dock oracle');
    if (key === 'whole') assert.equal(observed.whole, true, 'item 721 whole oracle');
    if (key === 'selection') assert.ok(observed.select === 'none' && observed.selected === '' && !observed.open, 'item 721 selection oracle');
    if (key === 'title') assert.ok(observed.title && observed.close, 'item 721 title oracle');
    if (key === 'addressing') assert.equal(observed.addressing, true, 'item 721 addressing oracle');
    if (key === 'writing') assert.ok(observed.dock && observed.body === WRITING, 'item 721 writing oracle');
    if (key === 'escape') assert.equal(observed.open, false, 'item 721 escape oracle');
    if (key === 'hidden' || key === 'unavailable') assert.ok(observed.modal && !observed.dock && observed.body === WRITING, `item 721 ${key} oracle`);
  };
  async function observe(key, shape, scheme, suffix = '') {
    const data = await seed(key, key === 'whole' ? LONG : SHORT, key === 'hidden');
    const p = await page(shape, scheme, '/?topic=' + data.topic);
    await until(p, s => !!document.querySelector(s), 'isolated source', card(data.id));
    if (key === 'selection') {
      const selected = await dragSource(p, data.id);
      const observed = { ...await snapshot(p, data.id), selected };
      await picture(p, `item-721-${key}${suffix}`); return observed;
    }
    if (key === 'hidden') {
      // A coordination dossier is compact until its real title is pressed.
      const toggle = `#messages .reply-stack[data-stack="${data.id}"] > .stack-toggle`;
      await press(p, toggle);
    }
    await reply(p, data.id);
    if (['writing', 'escape', 'hidden', 'unavailable'].includes(key)) await write(p);
    if (key === 'writing' && suffix === '-mutant') await until(p, () => document.querySelector('#reader').matches(':modal'), 'writing click mutant actually opens full Reader');
    if (key === 'escape') { await p.keyboard.press('Escape'); if (suffix !== '-mutant') await shut(p); }
    if (key === 'hidden') {
      await press(p, '#agent-coordination-show button');
      await until(p, () => document.querySelector('#agent-coordination-show button').getAttribute('aria-pressed') === 'false', 'coordination source really hidden');
    }
    if (key === 'unavailable') {
      const revoked = await control({ method: 'item_721_participation', operation_id: data.topic + '-revoke', topic_id: data.topic, present: false });
      assert.equal(revoked.status, 'committed', 'actual Core participation revocation applied');
      await until(p, () => document.querySelector('#source-access-status').textContent.includes('source is unavailable'), 'real HTTP source refusal reaches Reader', undefined, 20000);
    }
    const observed = await snapshot(p, data.id);
    if (observed.open && !['hidden', 'unavailable'].includes(key)) await p.locator('#reader-close').scrollIntoViewIfNeeded();
    await picture(p, `item-721-${key}${suffix}`);
    measured.push({ engine, shape, scheme, item: 721, key, suffix, observed });
    return observed;
  }

  // Candidate bytes are observed first. The red controls below cannot replace
  // or silently repair the approved product before its own first observation.
  await check('item 721 approved source first: exact source and whole dock', async () => {
    await runtime('restored', async () => oracle('dock', await observe('dock', 'stacked', 'light', '-approved-first')));
  });
  for (const key of ['dock', 'whole', 'selection', 'title', 'addressing', 'writing', 'escape', 'hidden', 'unavailable']) {
    await check(`item 721 ${key}: applied source mutant is red then exact restored control`, async () => {
      assert.ok(mutants.some(row => row.key === key));
      await runtime(key, async () => {
        const observed = await observe(key, 'stacked', 'light', '-mutant');
        assert.throws(() => oracle(key, observed), error => error.code === 'ERR_ASSERTION' && error.message.includes(`item 721 ${key} oracle`), 'the named behavioral assertion kills the applied source mutant');
      });
      await control({ method: 'read_fault_clear' });
      await runtime('restored', async () => oracle(key, await observe(key, 'stacked', 'light', '-restored')));
      await control({ method: 'read_fault_clear' });
    });
  }
  for (const shape of ['phone-320', 'phone-375', 'phone-390', 'stacked']) for (const scheme of ['light', 'dark']) {
    await check(`item 721 original and held controls ${shape} ${scheme}`, async () => {
      await runtime('baseline', async () => {
        const observed = await observe('dock', shape, scheme, '-baseline');
        assert.equal(observed.modal, true, 'actual old source opens the full Reader');
        assert.throws(() => oracle('dock', observed), /item 721 dock oracle/);
      });
      await runtime('held', async () => {
        const observed = await observe('whole', shape, scheme, '-held');
        assert.throws(() => oracle('whole', observed), /item 721 whole oracle/);
      });
    });
    await check(`item 721 normal open close whole excerpt folded selection writing retention ${shape} ${scheme}`, async () => {
      const data = await seed('normal');
      const p = await page(shape, scheme, '/?topic=' + data.topic);
      await light(p, data.id); await picture(p, 'item-721-before');
      await press(p, '.message-bar [data-act="reply"]'); await opened(p);
      const before = await snapshot(p, data.id);
      for (const key of ['dock', 'whole', 'title', 'addressing']) oracle(key, before);
      assert.equal(before.readers, 1); assert.equal(before.writingFields, 1);
      assert.ok(before.overflow <= ITEM721_TOLERANCE.edgePx, 'page has no horizontal overflow beyond 1 CSS px');
      await write(p);
      const modifier = await p.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
      await p.keyboard.press(modifier + '+A');
      let writing = await snapshot(p, data.id);
      assert.deepEqual(writing.writingSelection, { start: 0, end: WRITING.length }, 'native writing selection remains available');
      oracle('writing', writing);
      await picture(p, 'item-721-writing-selected');
      await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.insertText('New line.');
      const exact = WRITING + '\nNew line.';
      assert.equal(await p.locator('#writing-body').inputValue(), exact, 'Return remains a writing newline');
      await press(p, '#reader-close'); await shut(p);
      assert.equal(await p.evaluate(() => document.querySelector('#reader').parentElement.id), '', 'closed Reader returns to original body home');
      await reply(p, data.id, shape === 'stacked');
      assert.equal(await p.locator('#writing-body').inputValue(), exact, 'same source reopens exact writing');
      await p.keyboard.press('Escape'); await shut(p);
      const selected = await dragSource(p, data.id);
      oracle('selection', { ...await snapshot(p, data.id), selected });
      await picture(p, 'item-721-source-selection');
      // Fold through the actual message menu, then use hover/touch Reply on its
      // row: the page reveals it for this visit without saving an unfold act.
      await light(p, data.id); await press(p, '.message-bar [data-act="fold"]');
      await until(p, s => document.querySelector(s).dataset.folded === 'true', 'source saved folded', card(data.id));
      const commands = [];
      p.on('request', request => { if (request.url().endsWith('/api/command')) commands.push(request.postDataJSON()); });
      await reply(p, data.id);
      oracle('whole', await snapshot(p, data.id));
      assert.equal(commands.some(c => c.kind === 'message.fold'), false, 'Reply itself does not save an unfold');
      assert.equal(await p.locator('#writing-body').inputValue(), exact);
      await picture(p, 'item-721-folded-revealed');
      // Another source uses the single existing Reader, retaining this writing.
      const second = await control({ method: 'agent_message', operation_id: data.topic + '-second', topic_id: data.topic, body: SHORT, addressees: [facts.actor] });
      await reply(p, second.result.message_id);
      assert.equal((await snapshot(p, second.result.message_id)).readers, 1);
      await reply(p, data.id);
      assert.equal(await p.locator('#writing-body').inputValue(), exact);
      measured.push({ engine, shape, scheme, item: 721, state: 'normal', before, after: await snapshot(p, data.id), tolerance: ITEM721_TOLERANCE });
      await picture(p, 'item-721-retained-after-arrival');
      await press(p, '#reader-close'); await shut(p);
      await light(p, data.id); await p.keyboard.press('Enter'); await opened(p);
      assert.equal(await p.evaluate(() => document.querySelector('#reader').matches(':modal')), true, 'explicit Return keeps the full Reader route');
      await picture(p, 'item-721-explicit-reader');
      await close(p);
    });
    for (const state of ['empty', 'image-choice', 'send-image', 'busy', 'error', 'refused']) {
      await check(`item 721 ${state} ${shape} ${scheme}: actual control and HTTP boundary`, async () => {
        const data = await seed('state-' + state, SHORT);
        const p = await page(shape, scheme, '/?topic=' + data.topic), commands = [], responses = [];
        p.on('request', request => { if (request.url().endsWith('/api/command')) commands.push(request.postDataJSON()); });
        p.on('response', async response => { if (response.url().endsWith('/api/command')) responses.push({ request: response.request().postDataJSON(), status: response.status() }); });
        await reply(p, data.id);
        if (state === 'empty') {
          await press(p, '#send-reply');
          await until(p, () => document.querySelector('#reader-notice').textContent === 'Write a reply before sending.', 'empty reply notice');
          assert.equal(commands.some(c => ['submission.prepare', 'message.send'].includes(c.kind)), false);
        } else if (state === 'image-choice' || state === 'send-image') {
          await write(p);
          await press(p, '#plus-button');
          const chooser = p.waitForEvent('filechooser'); await press(p, '#add-image');
          const image = state === 'image-choice' ? { name: 'item721.heic', mimeType: 'image/heic', buffer: Buffer.from('This unsupported image requires a real choice') }
            : { name: 'item721.png', mimeType: 'image/png', buffer: await readFile(new URL('./fixtures/media/screen.png', import.meta.url)) };
          await (await chooser).setFiles(image);
          if (state === 'image-choice') {
            await until(p, () => document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-needs'), 'real image choice', undefined, 20000);
            await press(p, '#send-reply');
            await until(p, () => document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-open'), 'blocked send opens actual image choices');
            assert.equal(commands.some(c => ['submission.prepare', 'message.send'].includes(c.kind)), false);
            assert.equal(await p.locator('#writing-body').inputValue(), WRITING);
            await picture(p, 'item-721-image-choice');
            await press(p, '#writing-attachments [data-method="remove"]');
            await until(p, () => !document.querySelector('#writing-attachments .image-choice'), 'native Remove resolves image choice');
          } else {
            await until(p, () => document.querySelector('#writing-attachments .image-choice') && !document.querySelector('#writing-attachments .image-choice').hasAttribute('data-needs') && document.querySelector('#save-state').textContent.includes('Saved'), 'image saved through existing owner', undefined, 20000);
            await press(p, '#who-chip'); await press(p, '#who-panel [data-intent="whisper"]'); await press(p, '#who-done');
            const sent = p.waitForResponse(response => response.url().endsWith('/api/command') && response.request().postDataJSON()?.kind === 'message.send');
            await press(p, '#writing-body'); await p.keyboard.press('Meta+Shift+Enter');
            const receipt = await (await sent).json(); assert.equal(receipt.status, 'committed', JSON.stringify(receipt.error));
            const source = await control({ method: 'agent_view', name: 'source', args: { kind: 'message', id: receipt.result.message_id } });
            assert.equal(source.body, WRITING); assert.equal(source.reply_to, data.id); assert.equal(source.topic_id, data.topic);
            assert.equal(source.attachments.length, 1); assert.equal(source.attachments[0].name, image.name);
            assert.deepEqual(source.addressees, [facts.agent]); assert.equal(source.private_to, facts.agent);
            assert.equal(commands.filter(c => c.kind === 'message.send').length, 1);
            measured.push({ engine, shape, scheme, item: 721, state, receipt, source });
          }
        } else {
          await write(p);
          let release, entered;
          const gate = new Promise(resolve => { release = resolve; });
          const reached = new Promise(resolve => { entered = resolve; });
          let held = false;
          await p.route('**/api/command', async route => {
            const request = route.request().postDataJSON();
            if (request.kind !== 'submission.prepare' || held) return route.continue();
            held = true;
            if (state === 'refused' || state === 'read-only') {
              const changed = await control({ method: 'private_writing', kind: 'reply', message_id: data.id, topic_id: data.topic, operation_id: data.topic + '-other-tab', body: 'Other tab kept this version' });
              assert.equal(changed.status, 'committed', 'actual competing Core draft mutation applied');
            }
            const response = await route.fetch();
            const original = await response.json();
            entered(original); await gate;
            if (state === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Lost response after preparation committed', retryable: true } }) });
            return route.fulfill({ response });
          });
          try {
            await press(p, '#writing-body'); await p.keyboard.press('Meta+Shift+Enter');
            const prepared = await reached; assert.equal(prepared.status, ['refused', 'read-only'].includes(state) ? 'rejected' : 'committed', 'real preparation receipt from Core');
            {
              await write(p, 'New B while preparation answer waits');
              if (state === 'busy') {
                await p.keyboard.press('Meta+Shift+Enter');
                await until(p, () => document.querySelector('#reader-notice').textContent.includes('earlier reply is still being prepared'), 'busy preparation keeps B separate');
                assert.equal(commands.filter(c => c.kind === 'submission.prepare').length, 1);
                await picture(p, 'item-721-busy');
              }
            }
            release();
            if (state === 'busy') {
              await until(p, () => document.querySelector('#reader-notice').textContent.includes('Sent') || document.querySelector('#save-state').textContent.includes('Saved'), 'publication and B save settle', undefined, 20000);
              assert.equal(await p.locator('#writing-body').inputValue(), 'New B while preparation answer waits');
            } else {
              if (state === 'read-only') {
                await until(p, () => document.querySelector('#writing-body').readOnly, 'conflicting saved version makes writing read-only');
                const kept = await p.locator('#writing-body').inputValue();
                await press(p, '#writing-body'); await p.keyboard.insertText('must not enter read-only writing');
                assert.equal(await p.locator('#writing-body').inputValue(), kept);
              }
              await until(p, () => !!document.querySelector('#pending-submissions button')?.getClientRects().length, 'recovery Review remains available', undefined, 20000);
              assert.equal(commands.some(c => c.kind === 'message.send'), false, 'an unknown or refused preparation answer cannot publish on its own');
            }
          } finally { release(); }
        }
        await picture(p, 'item-721-state-' + state);
        measured.push({ engine, shape, scheme, item: 721, state, commands, responses, observed: await snapshot(p, data.id) });
        await close(p);
      });
    }

  }
}
