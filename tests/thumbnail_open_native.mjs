// Item 651. Native clicks/taps/Return, using production renderers and the real
// isolated HTTP page. Component states use imageChoices' actual branches;
// full-page cases cover feed, dossier, rail, picking, and Notebook consumers.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function thumbnailChecks({ check, page, press, until, picture, close, control, facts, root, engine, evidence }) {
  const hash = text => createHash('sha256').update(text).digest('hex');
  const shapes = ['phone-320', 'phone-375', 'phone-390', 'stacked'];
  const png = await readFile(path.join(root, 'tests/fixtures/media/screen.png'));
  const topic = `thumb-651-${engine}`;
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Thumbnail images' }] });
  const message = (await control({ method: 'agent_message', operation_id: topic, topic_id: topic, join: true, source: 'topic',
    divergence_reason: 'Independent native thumbnail source.',
    body: 'The picture stays with these words.', attachments: [{ name: 'landscape.png', image: 'screen.png' }] })).result.message_id;
  const reply = (await control({ method: 'agent_message', operation_id: topic + '-reply', topic_id: topic, reply_to: message,
    reply_without_quote: 'Synthetic thumbnail fixture reply.', body: 'A second picture in the dossier.',
    attachments: [{ name: 'detail.png', image: 'screen.png' }] })).result.message_id;
  await control({ method: 'stack_act', sender: facts.agent, kind: 'stack.name', message_id: message, operation_id: topic + '-name', args: { name: 'Picture dossier' } });
  const note = topic + '-note';
  await control({ method: 'outcome_reference', operation_id: note, item_id: note, title: 'Picture Notebook', body: `## Picture\nWords stay as written.\n![landscape.png](attachment:${note}-media-0)`, attachments: [{ name: 'landscape.png', image: 'screen.png' }] });

  const ready = async (p, selector) => {
    await p.locator(selector).first().evaluate(image => image.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
    await until(p, s => { const i = document.querySelector(s); return i && !i.hidden && i.complete && i.naturalWidth > 0; }, 'the thumbnail decoded', selector, 15000);
  };
  const expand = async (p, selector) => {
    const tabs = p.ctx.pages().length;
    await press(p, selector);
    await until(p, s => document.querySelector(s)?.parentElement.hasAttribute('data-image-expanded'),
      'the thumbnail expands in its card', selector);
    assert.equal(p.ctx.pages().length, tabs, 'the first press keeps the image in the card');
  };
  const openImage = async (p, selector, key = false) => {
    const src = await p.locator(selector).first().evaluate(el => (el.matches('img') ? el : el.parentElement.querySelector('img.image-thumb')).src);
    const TOUCH_PX_TOLERANCE = .5;
    const box = await p.locator(selector).first().boundingBox();
    if (p.touch) assert.ok(box && box.width >= 44 - TOUCH_PX_TOLERANCE && box.height >= 44 - TOUCH_PX_TOLERANCE, 'the thumbnail target is at least 44px, within TOUCH_PX_TOLERANCE');
    const before = p.url(), tabs = p.ctx.pages().length;
    const popup = p.ctx.waitForEvent('page', { timeout: 5000 });
    // Handle rejection immediately while a native action is pending.
    const received = popup.then(value => ({ value }), error => ({ error }));
    if (key) {
      await p.locator(selector).first().focus();
      await p.keyboard.press('Enter');
    } else if (selector.endsWith('.image-open')) {
      // Remove overlaps the square's upper right on a phone. A finger can
      // reach the thumbnail at its lower left; aim there, as a person does.
      const box = await p.locator(selector).first().boundingBox();
      assert.ok(box, 'the thumbnail opener is drawn');
      const x = box.x + 6, y = box.y + box.height - 6;
      assert.equal(await p.evaluate(({ x, y, selector }) => document.elementFromPoint(x, y)?.closest(selector) !== null, { x, y, selector }), true, 'the native press is on the thumbnail opener');
      if (p.touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y);
    } else await press(p, selector);
    const outcome = await received;
    assert.ok(outcome.value, `thumbnail opens a new tab: ${outcome.error?.message ?? ''}`);
    const tab = outcome.value;
    await tab.waitForLoadState('domcontentloaded');
    assert.equal(tab.url(), src, 'the tab opens exactly the displayed image');
    // Image documents inherit connect-src, which deliberately admits no blob
    // fetch. Compare the decoded pixels without weakening the page's CSP.
    const pixelsMatch = await tab.evaluate(async png => {
      const actual = document.images[0]; await actual.decode();
      const expected = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
      const pixels = image => {
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth ?? image.width; canvas.height = image.naturalHeight ?? image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = pixels(actual), b = pixels(expected); expected.close();
      return a.length === b.length && a.every((value, index) => value === b[index]);
    }, png.toString('base64'));
    assert.equal(pixelsMatch, true, 'the opened image shows the exact verified pixels');
    assert.ok(!(await tab.content()).includes('Exact writing'), 'no writing or private note is copied into the image tab');
    assert.equal(p.url(), before, 'the original destination stays put');
    assert.equal(p.ctx.pages().length, tabs + 1, 'one gesture opens exactly one tab');
    assert.equal(await tab.evaluate(() => window.opener === null), true, 'the image has no opener');
    await tab.close();
  };

  const runCases = async (phase = '') => {
  for (const shape of shapes) for (const scheme of ['light', 'dark']) {
    const label = `${phase ? phase + ' ' : ''}${shape} ${scheme}`;
    await check(`item 651 ${label}: topic and dossier thumbnails open their exact image, never the Reader`, async () => {
      const p = await page(shape, scheme, `/?topic=${topic}`);
      const selector = `.message-card[data-id="${reply}"] .image-thumb`;
      await ready(p, selector);
      await picture(p, 'item-651-dossier-before-press');
      await expand(p, selector);
      await openImage(p, selector);
      assert.equal(await p.locator('#reader').evaluate(d => d.open), false, 'the thumbnail does not open the Reader');
      await openImage(p, selector, true);
      assert.equal(await p.locator('#reader').evaluate(d => d.open), false, 'Return on the thumbnail does not open the Reader');
      await close(p);
    });
    for (const [surface, route, scope] of [
      ['Notebook cards', `/?cards=${note}`, '.deck-image'],
      ['Notebook read', `/?workspace=w1&page=${note}&revision=1`, '.page-image'],
      ['Notebook Reader', `/?topic=${topic}&page=${note}&revision=1`, '#source-body .page-image'],
    ]) await check(`item 651 ${label}: ${surface} thumbnail opens without editing or changing words`, async () => {
      const p = await page(shape, scheme, route), selector = `${scope} .image-thumb`;
      await ready(p, selector);
      const words = await p.locator(scope).first().textContent();
      await picture(p, 'item-651-' + surface.replaceAll(' ', '-'));
      if (surface === 'Notebook cards') await expand(p, selector);
      await openImage(p, selector);
      assert.equal(await p.locator(scope).first().textContent(), words, 'the picture caption and words stay exact');
      assert.equal(await p.locator('.deck-writing').count(), 0, 'opening the image does not edit its card');
      await close(p);
    });

    await check(`item 651 ${label}: rail thumbnail opens its image and keeps the topic`, async () => {
      const p = await page(shape, scheme, `/?topic=${topic}`);
      if (p.touch) await press(p, '#things-open');
      const summary = '.things-sec[data-key=images] > summary';
      await p.locator(summary).waitFor({ state: 'visible' });
      if (!await p.locator('.things-sec[data-key=images]').evaluate(d => d.open)) await press(p, summary);
      const selector = '.things-thumbs .image-thumb';
      await ready(p, selector);
      await picture(p, 'item-651-rail');
      await openImage(p, selector);
      assert.equal(await p.locator('#reader').evaluate(d => d.open), false, 'opening an image does not follow its message link');
      await close(p);
    });
    for (const surface of ['Reader', 'New message']) await check(`item 651 ${label}: ${surface} chosen thumbnail keeps exact writing and destination`, async () => {
      const reader = surface === 'Reader';
      const p = await page(shape, scheme, reader ? `/?topic=${topic}&message=${reply}` : `/?topic=${topic}`);
      if (!reader) await press(p, '#new-message');
      const field = reader ? '#writing-body' : '#inline-writing-body';
      await p.locator(field).fill('Exact writing — keep this destination.');
      const chip = reader ? '#who-chip' : '#inline-who-chip';
      const destination = await p.locator(chip).textContent();
      await press(p, reader ? '#plus-button' : '#inline-plus-button');
      const chooser = p.waitForEvent('filechooser');
      await press(p, reader ? '#add-image' : '#inline-add-image');
      await (await chooser).setFiles({ name: 'landscape.png', mimeType: 'image/png', buffer: png });
      const strip = reader ? '#writing-attachments' : '#inline-attachments';
      await ready(p, strip + ' .image-thumb');
      await picture(p, 'item-651-' + surface.replaceAll(' ', '-'));
      await openImage(p, strip + ' .image-open');
      assert.equal(await p.locator(field).inputValue(), 'Exact writing — keep this destination.');
      assert.equal(await p.locator(chip).textContent(), destination, 'the exact destination stays');
      await close(p);
    });
    await check(`item 651 ${label}: picker thumbnail opens without choosing, text still chooses`, async () => {
      const p = await page(shape, scheme, `/?topic=${topic}`);
      await press(p, '#new-message');
      const field = '#inline-writing-body';
      await p.locator(field).fill('Keep this #img');
      const selector = '.image-option .image-thumb';
      await ready(p, selector);
      await picture(p, 'item-651-picker');
      await openImage(p, selector);
      assert.equal(await p.locator(field).inputValue(), 'Keep this #img', 'the thumbnail does not pick or remove the query');
      assert.equal(await p.locator('#inline-attachments .image-choice').count(), 0, 'the thumbnail adds nothing');
      await press(p, '.image-option-words');
      await until(p, () => document.querySelector('#inline-writing-body').value === 'Keep this ' && document.querySelectorAll('#inline-attachments .image-choice').length === 1, 'the words still choose the image');
      await close(p);
    });

    // The same production row renderer receives every imageChoices branch.
    // This isolates thumbnail activation from upload transport, without
    // invoking a handler or pretending these states are a server receipt.
    for (const state of ['ready', 'uploading', 'device-refused', 'confirmation', 'retry', 'download', 'read-only', 'empty', 'read-refused', 'read-error']) {
      await check(`item 651 ${label}: composer ${state} thumbnail preserves writing and recovery`, async () => {
        const p = await page(shape, scheme);
        await p.evaluate(async ({ state, png }) => {
          const { paintImageRows } = await import('/image-rows.mjs');
          const { imageChoices } = await import('/writing-helpers.mjs');
          const host = document.createElement('section'); host.id = 'thumbnail-case';
          host.style.cssText = 'position:fixed;inset:90px 8px auto;z-index:9999;padding:12px;background:var(--panel);border:1px solid var(--line)';
          const writing = document.createElement('textarea'); writing.value = 'Exact writing — private to this isolated case.';
          writing.id = 'thumbnail-writing';
          const strip = document.createElement('div'); strip.className = 'image-strip'; strip.id = 'thumbnail-strip';
          host.append(strip, writing); document.body.append(host);
          window.thumbnailActions = [];
          const e = { selection_id: 'thumb-state', file: { name: 'landscape.png' }, version: 1, choice: 0,
            bytes_state: state === 'device-refused' ? 'memory-only' : 'durable', origin: state === 'confirmation' ? 'retained-ref' : 'capture',
            attempts: state === 'retry' ? [{ phase: 'failed', retry_allowed: true }] : state === 'ready' ? [{ phase: 'confirmed' }] : [], ready_descriptor: {} };
          const uploads = { current: () => state === 'empty' ? [] : [e], running: new Set(state === 'uploading' ? [e.selection_id] : []), status: () => state };
          const choices = imageChoices(uploads, state !== 'read-only');
          window.thumbnailChoices = choices;
          paintImageRows(strip, choices, state !== 'read-only', action => thumbnailActions.push(action.method),
            () => state === 'read-refused' ? null : state === 'read-error' ? Promise.reject(Error('isolated read error')) : new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
        }, { state, png: png.toString('base64') });
        const selector = '#thumbnail-strip .image-thumb';
        if (['empty', 'read-refused', 'read-error'].includes(state)) {
          await until(p, () => !document.querySelector('#thumbnail-strip .image-thumb'), 'no image available to open');
          assert.equal(p.ctx.pages().length, 1, 'no image read opens a tab');
          await picture(p, 'item-651-composer-' + state);
        } else {
          await ready(p, selector);
          await picture(p, 'item-651-composer-' + state);
          // The row's transparent opener lies above its thumbnail until its
          // choices open. Press the actual surface the person sees there.
          await openImage(p, '#thumbnail-strip .image-open');
          assert.equal(await p.locator('#thumbnail-writing').inputValue(), 'Exact writing — private to this isolated case.');
          assert.deepEqual(await p.evaluate(() => thumbnailActions), [], 'opening never removes, retries, downloads or sends');
          await until(p, () => document.querySelector('#thumbnail-strip .image-choice').hasAttribute('data-open'), 'the existing choices remain available');
          const methods = await p.evaluate(() => [...document.querySelectorAll('#thumbnail-strip [data-method]')].map(b => ({ method: b.dataset.method, disabled: b.disabled, visible: b.getClientRects().length > 0 })));
          assert.ok(methods.every(m => m.visible && m.disabled === (state === 'read-only')), 'every existing recovery action keeps its enabled state');
          if (state !== 'read-only') {
            const method = methods[0].method;
            await press(p, `#thumbnail-strip [data-method="${method}"]`);
            assert.deepEqual(await p.evaluate(() => thumbnailActions), [method], 'the existing recovery or Remove control acts once');
          }
        }
        assert.deepEqual(p.errors, [], 'no page errors');
        await close(p);
      });
    }
  }
  };
  const inputs = {};
  for (const name of ['web/aim.css', 'web/image-pick.mjs', 'web/image-rows.mjs', 'web/message-menu.mjs', 'web/card-images.mjs', 'tests/reader_compose_native.mjs', 'tests/thumbnail_open_native.mjs']) inputs[name] = hash(await readFile(path.join(root, name)));
  const mutations = [];
  await runCases();
  const breaks = [
    { name: 'no-new-tab', file: 'web/image-pick.mjs', from: "window.open(image.src, '_blank', 'noopener');", to: 'void image.src;', expected: /thumbnail opens a new tab/, target: 'card' },
    { name: 'strip-not-forwarded', file: 'web/image-rows.mjs', from: "openThumbnail(row.querySelector(':scope > img.image-thumb'), event);", to: 'void event;', expected: /thumbnail opens a new tab/, target: 'strip' },
    { name: 'no-keyboard-open', file: 'web/image-pick.mjs',
      from: "event.key === 'Enter' || event.key === ' '",
      to: "event.key === ' '", expected: /thumbnail opens a new tab/, target: 'key' },
    { name: 'first-touch-intercepted-mutant', file: 'web/message-menu.mjs',
      from: "if (event.target.closest?.('[data-card-image-control]')) return;",
      to: "if (this.touch && event.target.closest?.('[data-card-image-control]')) { event.preventDefault(); event.stopPropagation(); return; }",
      expected: /thumbnail expands in its card/, target: 'card' },
    { name: 'thumbnail-edits-card', file: 'web/image-pick.mjs', from: 'event?.preventDefault(); event?.stopPropagation();', to: 'event?.preventDefault();', expected: /the thumbnail does not edit its card/, target: 'parent' },
  ];
  for (const mutation of breaks) await check(`item 651 applied mutant ${mutation.name} and restored source`, async () => {
    const file = path.join(root, mutation.file), original = await readFile(file, 'utf8');
    assert.equal(original.split(mutation.from).length, 2, 'one actual source mutation site');
    const changed = original.replace(mutation.from, mutation.to);
    let failure = null, p;
    try {
      await writeFile(file, changed);
      assert.equal(await readFile(file, 'utf8'), changed, 'the mutation was actually written');
      await control({ method: 'server_stop' }); await control({ method: 'server_start' });
      p = await page('phone-320', 'light', mutation.target === 'parent' ? `/?cards=${note}` : `/?topic=${topic}`);
      const served = await p.request.get(facts.origin + '/' + mutation.file.slice(4));
      assert.equal(hash(await served.body()), hash(changed), 'the browser server snapshots the applied mutation');
      try {
        if (mutation.target === 'strip') {
          await press(p, '#new-message'); await p.locator('#inline-writing-body').fill('Mutant writing kept.');
          await press(p, '#inline-plus-button');
          const chooser = p.waitForEvent('filechooser'); await press(p, '#inline-add-image');
          await (await chooser).setFiles({ name: 'landscape.png', mimeType: 'image/png', buffer: png });
          await ready(p, '#inline-attachments .image-thumb');
          await openImage(p, '#inline-attachments .image-open');
        } else if (mutation.target === 'parent') {
          const selector = '.deck-image .image-thumb'; await ready(p, selector);
          await expand(p, selector); await openImage(p, selector);
          assert.equal(await p.locator('.deck-writing').count(), 0, 'the thumbnail does not edit its card');
        } else {
          const selector = `.message-card[data-id="${reply}"] .image-thumb`; await ready(p, selector);
          await expand(p, selector);
          await openImage(p, selector, mutation.target === 'key');
        }
      } catch (error) { failure = error; }
      assert.ok(failure, 'the applied mutation must fail its behavioral check');
      assert.match(failure.message, mutation.expected, 'the mutation fails at its intended assertion');
      assert.deepEqual(p.errors, [], 'no page error is accepted as a caught mutation');
      mutations.push({ name: mutation.name, file: mutation.file, original: hash(original), applied: hash(changed), caught: true, failure: failure.message });
      console.log(`CAUGHT item 651 ${engine} ${mutation.name}: ${failure.message.split('\n')[0]}`);
    } finally {
      try { if (p) await close(p); } finally {
        await writeFile(file, original);
        assert.equal(await readFile(file, 'utf8'), original, 'original source restored exactly');
        await control({ method: 'server_stop' }); await control({ method: 'server_start' });
      }
    }
  });
  // Fixing or mutating any thumbnail state reruns every state of the element.
  await runCases('restored');
  for (const [name, digest] of Object.entries(inputs)) assert.equal(hash(await readFile(path.join(root, name))), digest, 'source restored: ' + name);
  await writeFile(path.join(evidence, engine, 'item-651-source-and-mutants.json'), JSON.stringify({ engine, inputs, mutations, restored: true }, null, 2));

}
