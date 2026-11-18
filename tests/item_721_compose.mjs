import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// All dimensions in CSS pixels. One pixel permits independent browser layout
// rounding; a missing row or the 120px source-cap mutant exceeds it by far.
export const ITEM721_TOLERANCE = Object.freeze({ edgePx: 1, scrollPx: 1, targetPx: 1 });
const LONG = Array.from({ length: 45 }, (_, i) => `Source paragraph ${i + 1}: keep these complete words above the reply, including the last paragraph.`).join('\n\n');
const SHORT = 'Source words stay here. A second sentence can be quoted explicitly.';
const WRITING = 'Exact reply writing. Select these words.';

export async function item721Compose(h) {
  const { page: createPage, press, until, picture, close, control, facts, engine, measured, contexts, evidence } = h;
  await mkdir(evidence, { recursive: true });
  let receiptSerial = 0;
  const trails = new WeakMap();
  const page = async (...args) => {
    const p = await createPage(...args), trail = { engine, item: 721, kind: 'request-render-trail', shape: args[0], scheme: args[1], requests: [], responses: [], failed: [] };
    trails.set(p, { trail });
    p.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) trail.requests.push({ url: request.url(), method: request.method(), body: new URL(request.url()).pathname === '/api/command' ? request.postDataJSON() : undefined }); });
    p.on('requestfailed', request => { trail.failed.push({ url: request.url(), error: request.failure() }); });
    p.on('response', response => {
      if (!new URL(response.url()).pathname.startsWith('/api/')) return;
      const record = { url: response.url(), status: response.status() }; trail.responses.push(record);
      const endpoint = new URL(response.url()).pathname;
      if (!['/api/command', '/api/media/upload'].includes(endpoint) && response.status() < 400) return;
      // A receipt may see headers while a body is still pending. Say that
      // truthfully; diagnostics must never wait indefinitely on a failed act.
      record.bodyState = 'pending';
      response.text().then(body => { record.body = body; record.bodyState = 'complete'; }, error => { record.readError = String(error); record.bodyState = 'failed'; });
    });
    await p.evaluate(async () => {
      window.__item721Trail = [];
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (value?.kind === 'upload-bytes-v1') window.__item721Trail.push({ kind: 'image-byte-store', binarySize: value.data?.byteLength, blob: value.blob instanceof Blob });
        return put.call(this, value, ...args);
      };
      // Observe the actual durable-byte boundary, preserving the exact return
      // or rejection. Uploads.capture's recovery path may handle the rejection;
      // that must not erase its diagnostic cause before a Ready assertion.
      const { RecoveryJournal } = await import('/journal.mjs');
      const capture = RecoveryJournal.prototype.capture;
      RecoveryJournal.prototype.capture = function (...args) {
        window.__item721Trail.push({ kind: 'image-capture-start', size: args[2].blob.size, type: args[2].blob.type, blobClass: args[2].blob.constructor.name });
        return capture.apply(this, args).then(result => {
          window.__item721Trail.push({ kind: 'image-capture-committed' }); return result;
        }, error => {
          window.__item721Trail.push({ kind: 'image-capture-rejected', name: error.name, message: error.message }); throw error;
        });
      };
      const record = kind => {
        const reader = document.querySelector('#reader');
        window.__item721Trail.push({ kind, open: reader.open, modal: reader.matches(':modal'), dock: reader.hasAttribute('data-card-reply'),
          sourceParagraphs: reader.parentElement.querySelector(':scope > .message-preview')?.querySelectorAll(':scope > .md-block').length,
          images: document.querySelector('#writing-attachments').textContent, notice: document.querySelector('#reader-notice').textContent });
      };
      new MutationObserver(() => record('render')).observe(document.querySelector('#reader'), { subtree: true, childList: true, characterData: true, attributes: true });
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
        window.__item721Trail.push({ kind: type, trusted: event.isTrusted, pointerType: event.pointerType, x: event.clientX, y: event.clientY,
          target: { tag: event.target.tagName, id: event.target.id, classes: event.target.getAttribute('class'), card: event.target.closest('.message-card')?.dataset.id,
            preview: !!event.target.closest('.message-preview'), act: event.target.closest('[data-act]')?.dataset.act }, selected: getSelection().toString() });
      }, true);
      record('initial');
    });
    return p;
  };
  const receipt = async p => {
    const { trail } = trails.get(p);
    const retained = structuredClone({ ...trail, renders: await p.evaluate(() => window.__item721Trail) });
    measured.push(retained);
    await writeFile(path.join(evidence, `item721-${engine}-trail-${++receiptSerial}.json`), JSON.stringify(retained, null, 2));
  };
  let failureSerial = 0;
  const preserveFailure = async (error, phase) => {
    const pages = [...contexts].flatMap(context => context.pages());
    const receipts = await Promise.allSettled(pages.filter(p => trails.has(p)).map(receipt));
    const captures = await Promise.allSettled(pages.map(p => picture(p, `item-721-failure-${++failureSerial}-${phase}`)));
    const failed = [...receipts, ...captures].filter(result => result.status === 'rejected').map(result => result.reason);
    if (failed.length) throw new AggregateError([error, ...failed], 'Original native failure and diagnostic capture failures');
    throw error;
  };
  const check = (name, action) => h.check(name, async () => {
    try { await action(); } catch (error) { await preserveFailure(error, 'case'); }
  });
  const mutants = JSON.parse(await readFile(new URL('./fixtures/item_721_mutants.json', import.meta.url), 'utf8'));
  let serial = 0;
  const card = id => `#messages .message-card[data-id="${id}"]`;
  const entry = id => `#messages [data-id="${id}"]`;
  let sourcePhase = 'restored';
  const opened = p => until(p, () => document.querySelector('#reader').open, 'the real Reader opens');
  const shut = p => until(p, () => !document.querySelector('#reader').open, 'the reply closes after keeping writing');
  const snapshot = (p, id, expected = LONG) => p.evaluate(([id, tolerance, long]) => {
    const r = document.querySelector('#reader'), c = document.querySelector(`#messages .message-card[data-id="${id}"]`),
      source = c.querySelector(':scope > .message-preview'), field = document.querySelector('#writing-body');
    const visible = el => !!el?.getClientRects().length && getComputedStyle(el).display !== 'none';
    const box = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
    const s = getComputedStyle(source), parentStyle = getComputedStyle(c), sourceBox = box(source), replyBox = box(r);
    const paragraphs = [...source.querySelectorAll(':scope > .md-block')].map(block => block.textContent);
    const complete = JSON.stringify(paragraphs) === JSON.stringify(long.split('\n\n'));
    return { dock: r.parentElement === c && r.hasAttribute('data-card-reply') && c.getAttribute('role') === 'group' && !r.matches(':modal'),
      readers: document.querySelectorAll('#reader').length, writingFields: document.querySelectorAll('#writing-body').length,
      body: field.value, title: visible(document.querySelector('#reader-title')) && !!document.querySelector('#reader-title').textContent,
      close: visible(document.querySelector('#reader-close')), addressing: visible(document.querySelector('#who-chip')),
      whole: complete && s.maxHeight === 'none' && s.overflowY === 'visible' && parentStyle.maxHeight === 'none' && parentStyle.overflowY === 'visible' && source.scrollHeight - source.clientHeight <= tolerance.scrollPx && replyBox.top >= sourceBox.bottom - tolerance.edgePx,
      select: s.userSelect || s.webkitUserSelect, source: source.textContent, paragraphs, sourceBox, replyBox,
      overflow: document.documentElement.scrollWidth - innerWidth, sourceScroll: source.scrollHeight - source.clientHeight,
      writingSelection: { start: field.selectionStart, end: field.selectionEnd }, active: document.activeElement?.id,
      open: r.open, modal: r.matches(':modal'), parent: r.parentElement.id, notice: document.querySelector('#source-access-status').textContent,
      disabled: document.querySelector('#send-reply').disabled };
  }, [id, ITEM721_TOLERANCE, expected]);
  const seed = async (label, body = LONG, coordination = false) => {
    const topic = `item721-${engine}-${++serial}-${label}`;
    if (label === 'unavailable') {
      const owned = await control({ method: 'agent_topic', operation_id: topic, title: 'Source access', body });
      const messages = await control({ method: 'agent_view', name: 'topic_messages', args: { topic_id: owned.topic_id } });
      return { topic: owned.topic_id, id: messages.items[0].id, body };
    }
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Reply in this card' }] });
    if (coordination) await control({ method: 'topic_state', operation_id: topic + '-recipient', topic_id: topic, participants: ['aim-core'], args: { state: 'active', note: '' } });
    const message = await control({ method: 'agent_message', operation_id: topic + '-source', topic_id: topic, join: true, source: 'topic', body,
      addressees: coordination ? ['aim-core'] : [facts.actor] });
    if (coordination) await control({ method: 'agent_message', operation_id: topic + '-coordination-reply', topic_id: topic, sender: 'aim-core', reply_to: message.result.message_id, body: 'The second agent replies in this dossier.', addressees: [facts.agent] });
    return { topic, id: message.result.message_id, body };
  };
  async function light(p, id) {
    const selector = card(id);
    await until(p, s => !!document.querySelector(s)?.getClientRects().length, 'source card drawn', selector);
    const target = p.locator(selector + ' > .message-preview > .md-block').first();
    const folded = await p.evaluate(s => document.querySelector(s).dataset.folded === 'true', selector);
    const at = folded ? p.locator(selector + ' > .message-folded') : target;
    await at.scrollIntoViewIfNeeded();
    const b = await at.boundingBox();
    assert.ok(b && b.width && b.height, 'native Reply source target has a box');
    const x = b.x + Math.min(30, b.width / 2), y = b.y + Math.min(10, b.height / 2);
    // Close returns focus to the source and can leave that SAME card lit.
    // Its second tap opens Reader; only a first lighting tap belongs here.
    const lit = await p.evaluate(s => document.querySelector(s).classList.contains('lit'), selector);
    if (p.touch && !lit) await p.touchscreen.tap(x, y);
    else if (!p.touch) { await p.mouse.move(x + 3, y + 2); await p.mouse.move(x, y); }
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
    if (!['baseline', 'dock'].includes(sourcePhase)) await until(p, id => document.querySelector('#reader').parentElement.dataset.id === id, 'the requested source owns the actual reply bar', id);
  }
  async function coordinationOpen(p, id) {
    const toggle = `#messages .reply-stack[data-stack="${id}"] > .stack-toggle`;
    for (let n = 0; n < 3 && await p.locator(toggle).getAttribute('data-state') !== 'open'; n++) await press(p, toggle);
    assert.equal(await p.locator(toggle).getAttribute('data-state'), 'open', 'actual coordination dossier opened for Reply');
  }
  async function write(p, text = WRITING) {
    await p.locator('#writing-body').scrollIntoViewIfNeeded();
    await press(p, '#writing-body'); await p.keyboard.insertText(text);
    await until(p, text => document.querySelector('#writing-body').value === text, 'exact native writing', text);
  }
  async function dragWords(p, target) {
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    const points = await target.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node = walker.nextNode();
      const point = offset => {
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
        const r = range.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { x, y, onWords: el.contains(document.elementFromPoint(x, y)) };
      };
      return { start: point(1), end: point(20) };
    });
    assert.ok(points.start.onWords && points.end.onWords, 'both native drag endpoints hit actual rendered source characters');
    await p.mouse.move(points.start.x, points.start.y); await p.mouse.down();
    await p.mouse.move(points.end.x, points.end.y, { steps: 12 }); await p.mouse.up();
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await receipt(p);
    return p.evaluate(() => getSelection().toString());
  }
  const dragSource = (p, id) => dragWords(p, p.locator(card(id) + ' > .message-preview > .md-block').first());
  async function runtime(phase, action) {
    const receipt = await control({ method: 'item_721_runtime', phase });
    sourcePhase = phase;
    measured.push({ engine, item: 721, kind: 'source-runtime', ...receipt });
    try { return await action(receipt); }
    catch (error) { await preserveFailure(error, phase); }
    finally {
      const endings = await Promise.allSettled([...contexts].map(context => context.close()));
      contexts.clear();
      const restored = await control({ method: 'item_721_runtime', phase: 'restored' });
      sourcePhase = 'restored';
      assert.equal(restored.restored, true);
      assert.deepEqual(restored.hashes, receipt.candidate_hashes, 'exact candidate source restoration');
      measured.push({ engine, item: 721, kind: 'source-restore', ...restored });
      await control({ method: 'read_fault_clear' });
      const failed = endings.filter(result => result.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Owned native contexts failed to close after exact source restoration');
    }
  }
  const oracle = (key, observed) => {
    if (key === 'dock') assert.equal(observed.dock, true, 'item 721 dock oracle');
    if (key === 'whole') assert.equal(observed.whole, true, 'item 721 whole oracle');
    if (key === 'change') assert.ok(observed.whole && observed.dock && observed.body === WRITING && observed.framesWhole, 'item 721 change oracle');
    if (key === 'image') assert.ok(observed.imageReceipt.status === 'committed' && observed.imageReceipt.result.sha256 === observed.imageHash && observed.imageReady, 'item 721 image oracle');
    if (key === 'selection') assert.ok(observed.selected.length > 0 && !observed.open, 'item 721 selection oracle: a source drag selects words and never opens Reader');
    if (key === 'title') assert.ok(observed.title && observed.close, 'item 721 title oracle');
    if (key === 'addressing') assert.equal(observed.addressing, true, 'item 721 addressing oracle');
    if (key === 'writing') assert.ok(observed.dock && observed.body === WRITING, 'item 721 writing oracle');
    if (key === 'escape') assert.equal(observed.open, false, 'item 721 escape oracle');
    if (key === 'hidden' || key === 'unavailable') assert.ok(observed.modal && !observed.dock && observed.body === WRITING, `item 721 ${key} oracle`);
  };
  async function observe(key, shape, scheme, suffix = '') {
    const data = await seed(key, ['whole', 'change'].includes(key) ? LONG : SHORT, key === 'hidden');
    const p = await page(shape, scheme, '/?topic=' + data.topic);
    await until(p, s => !!document.querySelector(s), 'isolated source', card(data.id));
    if (key === 'selection') {
      const selected = await dragSource(p, data.id);
      if (suffix === '-mutant') await until(p, () => document.querySelector('#reader').matches(':modal'), 'applied drag-owner mutant actually opens Reader');
      const observed = { ...await snapshot(p, data.id), selected };
      await picture(p, `item-721-${key}${suffix}`); return observed;
    }
    if (key === 'hidden') {
      // A coordination dossier is compact until its real title is pressed.
      const toggle = `#messages .reply-stack[data-stack="${data.id}"] > .stack-toggle`;
      await press(p, toggle);
      await until(p, s => document.querySelector(s).dataset.state === 'folded', 'compact coordination dossier shows latest replies', toggle);
      await press(p, toggle);
      await until(p, s => document.querySelector(s).dataset.state === 'open', 'coordination source is open for native Reply', toggle);
    }
    await reply(p, data.id);
    if (['writing', 'escape', 'hidden', 'unavailable', 'change', 'image'].includes(key)) await write(p);
    let imageEvidence = {};
    if (key === 'image') {
      const image = await readFile(new URL('./fixtures/media/screen.png', import.meta.url));
      await press(p, '#plus-button');
      const chooser = p.waitForEvent('filechooser'); await press(p, '#add-image');
      const published = p.waitForResponse(response => response.url().endsWith('/api/media/upload'));
      await (await chooser).setFiles({ name: 'item721.png', mimeType: 'image/png', buffer: image });
      const imageReceipt = await (await published).json();
      await until(p, () => ['item721.png · Ready', 'item721.png · Could not attach'].includes(document.querySelector('#writing-attachments .image-choice .image-open span')?.textContent), 'actual image publication result is rendered');
      imageEvidence = { imageReceipt, imageHash: createHash('sha256').update(image).digest('hex'), imageReady: await p.locator('#writing-attachments .image-choice .image-open span').textContent() === 'item721.png · Ready' };
      await receipt(p);
    }
    let framesWhole = true;
    if (key === 'change') {
      const start = await p.evaluate(() => window.__item721Trail.length);
      const changed = await control({ method: 'agent_edit', operation_id: data.topic + '-edit', message_id: data.id, sender: facts.agent, body: LONG + '\n\nChanged source words.' });
      assert.equal(changed.status, 'committed', 'actual Core source edit applied');
      await until(p, s => document.querySelector(s).textContent.includes('Changed source words.'), 'the whole revised source has arrived', card(data.id) + ' > .message-preview');
      framesWhole = await p.evaluate(start => window.__item721Trail.slice(start).filter(row => row.kind === 'render' && row.dock).every(row => row.sourceParagraphs >= 45), start);
    }
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
    const observed = { ...await snapshot(p, data.id, key === 'change' ? LONG + '\n\nChanged source words.' : LONG), framesWhole, ...imageEvidence };
    if (observed.open && !['hidden', 'unavailable'].includes(key)) await p.locator('#reader-close').scrollIntoViewIfNeeded();
    await picture(p, `item-721-${key}${suffix}`);
    measured.push({ engine, shape, scheme, item: 721, key, suffix, observed });
    return observed;
  }

  // Immutable approved bytes are the red before the corrected control. The
  // photographed original failures and all per-file source hashes stay kept.
  await check('item 721 approved938 drag red then corrected source control', async () => {
    await runtime('approved', async () => {
      const observed = await observe('selection', 'stacked', 'light', '-approved-red');
      assert.throws(() => oracle('selection', observed), /item 721 selection oracle/, 'approved938 fails the actual source drag contract');
    });
    await runtime('restored', async () => oracle('selection', await observe('selection', 'stacked', 'light', '-corrected')));
  });
  await check('item 721 corrected source: exact source and whole dock', async () => {
    await runtime('restored', async () => {
      const observed = await observe('whole', 'stacked', 'light', '-approved-first');
      oracle('dock', observed); oracle('whole', observed);
    });
  });
  for (const key of ['dock', 'whole', 'selection', 'title', 'addressing', 'writing', 'escape', 'hidden', 'unavailable', 'change', 'image']) {
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
    // The standing ledger selects this candidate-only contract, so an outer
    // source mutation must fail the actual oracle, not mutation application.
    await check(`item 721 contract ${key}: candidate behavioral assertion`, async () => {
      await runtime('restored', async () => oracle(key, await observe(key, 'stacked', 'light', '-contract')));
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
      await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.keyboard.insertText('New line.');
      const exact = WRITING + '\nNew line.';
      assert.equal(await p.locator('#writing-body').inputValue(), exact, 'Return remains a writing newline');
      const chosenInCard = await dragSource(p, data.id);
      assert.ok(chosenInCard.length > 0, 'source words can be selected while writing in the card');
      const afterDrag = await snapshot(p, data.id);
      assert.equal(afterDrag.dock, true, 'a source drag never expands the in-card Reader');
      assert.equal(afterDrag.body, exact, 'a source drag preserves the same writing');
      await picture(p, 'item-721-source-selected-with-reply');
      await p.locator('#reader-close').scrollIntoViewIfNeeded();
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
      const second = await control({ method: 'agent_message', operation_id: data.topic + '-second', topic_id: data.topic, source: 'topic', body: SHORT, addressees: [facts.actor] });
      await reply(p, second.result.message_id);
      assert.equal((await snapshot(p, second.result.message_id)).readers, 1);
      await reply(p, data.id);
      assert.equal(await p.locator('#writing-body').inputValue(), exact);
      measured.push({ engine, shape, scheme, item: 721, state: 'normal', before, after: await snapshot(p, data.id), tolerance: ITEM721_TOLERANCE });
      await picture(p, 'item-721-retained-after-arrival');
      const changedBody = LONG + '\n\nChanged source words.';
      const changeStart = await p.evaluate(() => window.__item721Trail.length);
      const changed = await control({ method: 'agent_edit', operation_id: data.topic + '-edit', message_id: data.id, sender: facts.agent, body: changedBody });
      assert.equal(changed.status, 'committed', 'real Core source revision changed');
      await until(p, s => document.querySelector(s).textContent.includes('Changed source words.'), 'changed source rendered on its card', card(data.id) + ' > .message-preview');
      assert.equal((await snapshot(p, data.id)).dock, true, 'source revision keeps the existing bar in its card');
      assert.equal((await snapshot(p, data.id, changedBody)).whole, true, 'the revised source remains whole above the reply');
      assert.equal(await p.evaluate(start => window.__item721Trail.slice(start).filter(row => row.kind === 'render' && row.dock).every(row => row.sourceParagraphs >= 45), changeStart), true, 'no rendered edit state replaces the whole source with its excerpt');
      assert.equal(await p.locator('#writing-body').inputValue(), exact, 'source revision retains exact writing');
      await picture(p, 'item-721-source-changed');
      await press(p, '#reader-close'); await shut(p);
      await light(p, data.id); await p.keyboard.press('Enter'); await opened(p);
      assert.equal(await p.evaluate(() => document.querySelector('#reader').matches(':modal')), true, 'explicit Return keeps the full Reader route');
      await picture(p, 'item-721-explicit-reader');
      const chooseReader = async () => {
        let selected;
        if (p.touch) {
          // The phone driver has no native touch-selection handles. Exercise
          // the Reader's established Select All key through actual input.
          await press(p, '#source-body > [data-start]');
          await p.keyboard.press(modifier + '+a');
          selected = await p.evaluate(() => getSelection().toString());
        } else selected = await dragWords(p, p.locator('#source-body > [data-start]').first());
        assert.ok(selected.length > 0, 'ordinary Reader still permits native source selection');
        return selected;
      };
      const copiedWords = await chooseReader();
      await p.keyboard.press(modifier + '+c');
      const beforeCopy = await p.locator('#writing-body').inputValue();
      await press(p, '#writing-body'); await p.keyboard.press(modifier + '+ArrowDown');
      assert.equal(await p.evaluate(() => document.querySelector('#writing-body').selectionStart), beforeCopy.length, 'native keys reach the end of the retained writing');
      await p.keyboard.insertText('\nCopy: '); await p.keyboard.press(modifier + '+v');
      const copied = beforeCopy + '\nCopy: ' + copiedWords;
      await until(p, text => document.querySelector('#writing-body').value === text, 'ordinary native Copy and Paste preserve exact source words', copied);
      await picture(p, 'item-721-explicit-copy');
      const quotedWords = await chooseReader();
      await until(p, () => !document.querySelector('#quote-selection').hidden, 'ordinary Quote selection remains offered');
      await press(p, '#quote-selection');
      await until(p, text => document.querySelector('#writing-body').value === text, 'ordinary explicit Quote preserves exact writing and source words', copied + '\n\n> ' + quotedWords + '\n\n');
      await picture(p, 'item-721-explicit-quote');
      const withQuote = await p.locator('#writing-body').inputValue();
      await press(p, '#reader-close'); await shut(p);
      await light(p, data.id);
      await press(p, card(data.id) + ' > .message-preview > .md-block'); await opened(p);
      assert.equal(await p.evaluate(() => document.querySelector('#reader').matches(':modal')), true, 'a stationary explicit source click retains the full Reader route');
      assert.equal(await p.locator('#writing-body').inputValue(), withQuote, 'explicit click preserves the same ordinary copied and quoted writing');
      await picture(p, 'item-721-explicit-click');
      await receipt(p);
      await close(p);
    });
    for (const state of ['empty', 'image-choice', 'send-image', 'busy', 'error', 'refused', 'read-only', 'recovery']) {
      await check(`item 721 ${state} ${shape} ${scheme}: actual control and HTTP boundary`, async () => {
        const data = await seed('state-' + state, SHORT, state === 'send-image');
        const p = await page(shape, scheme, '/?topic=' + data.topic), commands = [], responses = [];
        p.on('request', request => { if (request.url().endsWith('/api/command')) commands.push(request.postDataJSON()); });
        p.on('response', async response => { if (response.url().endsWith('/api/command')) responses.push({ request: response.request().postDataJSON(), status: response.status() }); });
        if (state === 'read-only' || state === 'recovery') {
          // An unsupported saved image copy is real fixture data in the actual
          // scoped IDB, not a DOM flag or a call to a presentation handler.
          const installed = await p.evaluate(async ([instance, actor, source, topic]) => {
            const { editorKey } = await import('/editor.mjs');
            const context = { instanceId: instance, actor, sourceRef: { kind: 'message', id: source }, topicId: topic, kind: 'reply' };
            const key = editorKey(context), writer = 'item721-unsupported-copy';
            const row = { id: JSON.stringify([key, writer]), editorKey: key, writerId: writer, scope: JSON.stringify([instance, actor]), active: 1,
              stamp: 'item721-opaque-exact-version', snapshot: { format: 2, context, unsupportedImageFormat: true } };
            return new Promise((resolve, reject) => {
              const opening = indexedDB.open('aim-next-pending', 2);
              opening.onerror = () => reject(opening.error);
              opening.onsuccess = () => {
                const db = opening.result, tx = db.transaction('editors', 'readwrite');
                const store = tx.objectStore('editors');
                store.put(row);
                let readback; store.get(row.id).onsuccess = event => { readback = event.target.result; };
                tx.oncomplete = () => { db.close(); resolve(readback?.stamp === row.stamp && readback?.editorKey === key); };
                tx.onerror = () => { db.close(); reject(tx.error); };
              };
            });
          }, [facts.instance_id, facts.actor, data.id, data.topic]);
          assert.equal(installed, true, 'scoped unsupported saved image copy was actually written and read back');
        }
        if (state === 'send-image') await coordinationOpen(p, data.id);
        await reply(p, data.id);
        oracle('dock', await snapshot(p, data.id));
        if (state === 'read-only' || state === 'recovery') {
          await until(p, () => document.querySelector('#writing-body').readOnly, 'actual recovery owner makes untouched writing read-only');
          await press(p, '#writing-body'); await p.keyboard.insertText('must not enter read-only writing');
          assert.equal(await p.locator('#writing-body').inputValue(), '');
          assert.equal(commands.some(c => ['submission.prepare', 'message.send'].includes(c.kind)), false);
          await picture(p, 'item-721-read-only');
          if (state === 'recovery') {
            await press(p, '#review-versions');
            const continueCopy = p.getByRole('button', { name: 'Continue without this copy', exact: true });
            if (p.touch) await continueCopy.tap(); else await continueCopy.click();
            await until(p, () => !document.querySelector('#writing-body').readOnly, 'explicit review resolves this exact image-copy barrier');
            await press(p, '#review-close');
            await until(p, () => !document.querySelector('#version-review').open, 'native review close');
            await write(p, 'Writing after explicit recovery choice');
            oracle('dock', await snapshot(p, data.id));
          }
        } else if (state === 'empty') {
          assert.equal(await p.locator('#send-reply').isDisabled(), true, 'empty reply button is natively disabled');
          await press(p, '#writing-body'); await p.keyboard.press('Meta+Enter');
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
            await press(p, '#send-reply', true); // aria-disabled explains the barrier but remains a native button
            await until(p, () => document.querySelector('#writing-attachments .image-choice')?.hasAttribute('data-open'), 'blocked send opens actual image choices');
            assert.equal(commands.some(c => ['submission.prepare', 'message.send'].includes(c.kind)), false);
            assert.equal(await p.locator('#writing-body').inputValue(), WRITING);
            await picture(p, 'item-721-image-choice');
            await press(p, '#writing-attachments [data-method="remove"]');
            await until(p, () => !document.querySelector('#writing-attachments .image-choice'), 'native Remove resolves image choice');
          } else {
            await until(p, () => document.querySelector('#writing-attachments .image-choice .image-open span')?.textContent === 'item721.png · Ready', 'real image publication is ready', undefined, 20000);
            await picture(p, 'item-721-image-ready');
            await press(p, '#agent-coordination-show button');
            await until(p, () => document.querySelector('#reader').matches(':modal'), 'hidden source moves the SAME ready image and writing to full Reader');
            assert.equal(await p.locator('#writing-body').inputValue(), WRITING);
            assert.equal(await p.locator('#writing-attachments .image-choice .image-open span').textContent(), 'item721.png · Ready');
            await picture(p, 'item-721-image-hidden-fallback');
            await press(p, '#reader-close'); await shut(p);
            await press(p, '#agent-coordination-show button');
            await coordinationOpen(p, data.id);
            await reply(p, data.id);
            await until(p, () => document.querySelector('#writing-attachments .image-choice .image-open span')?.textContent === 'item721.png · Ready', 'same image owner retained on reopening');
            assert.equal(await p.locator('#writing-body').inputValue(), WRITING);
            await press(p, '#who-chip'); await press(p, '#who-panel [data-intent="whisper"]'); await press(p, '#who-done');
            const sent = p.waitForResponse(response => response.url().endsWith('/api/command') && response.request().postDataJSON()?.kind === 'message.send');
            await press(p, '#writing-body'); await p.keyboard.press('Meta+Shift+Enter');
            const receipt = await (await sent).json(); assert.equal(receipt.status, 'committed', JSON.stringify(receipt.error));
            const source = await control({ method: 'agent_view', name: 'source', args: { kind: 'message', id: receipt.result.message_id } });
            assert.equal(source.body, WRITING); assert.equal(source.reply_to, data.id); assert.equal(source.topic_id, data.topic);
            assert.equal(source.attachments.length, 1); assert.equal(source.attachments[0].name, image.name);
            assert.equal(source.attachments[0].sha256, createHash('sha256').update(image.buffer).digest('hex'), 'exact native-chosen image published');
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
            if (state === 'refused') {
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
            const prepared = await reached; assert.equal(prepared.status, state === 'refused' ? 'rejected' : 'committed', 'real preparation receipt from Core');
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
              await until(p, () => !!document.querySelector('#pending-submissions button')?.getClientRects().length, 'recovery Review remains available', undefined, 20000);
              assert.equal(commands.some(c => c.kind === 'message.send'), false, 'an unknown or refused preparation answer cannot publish on its own');
            }
          } finally { release(); }
        }
        await picture(p, 'item-721-state-' + state);
        await receipt(p);
        measured.push({ engine, shape, scheme, item: 721, state, commands, responses, observed: await snapshot(p, data.id) });
        await close(p);
      });
    }

  }
}
