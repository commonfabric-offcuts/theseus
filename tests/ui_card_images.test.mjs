import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAct, boxText, cardImages, cardStacks, cardText, deckBody, imageLine, parseDeck } from '../web/deck.mjs';
import { NotebookImages } from '../web/notebook-images.mjs';

// Images in a Notebook card (item 321, docs/decks.md "Images in a card"): a line of a card's words that holds only
// ![name](attachment:ID) names one of the page's attachments, which the card shows under its words.

const after = (body, act) => { const done = applyAct(parseDeck(body), act); return done && deckBody(done.deck); };

test('a card shows each line that holds only an image of the page, and keeps every other line as words', () => {
  const words = 'Some words.\n![chart.png](attachment:m-1)\n  ![Pasted image.png](attachment:7f3a-b9)  \nA line with ![inline](attachment:m-2) is words.\n![no id](attachment:)\n![elsewhere](https://a.example/x.png)\n[chart.png](attachment:m-3)';
  const { words: kept, images } = cardImages(words);
  assert.deepEqual(images, [{ name: 'chart.png', id: 'm-1', line: '![chart.png](attachment:m-1)' }, { name: 'Pasted image.png', id: '7f3a-b9', line: '![Pasted image.png](attachment:7f3a-b9)' }]);
  assert.equal(kept, 'Some words.\nA line with ![inline](attachment:m-2) is words.\n![no id](attachment:)\n![elsewhere](https://a.example/x.png)\n[chart.png](attachment:m-3)');
  assert.deepEqual(cardImages('no images'), { words: 'no images', images: [] });
});

test('an image line inside a fenced block is words, as a heading there is', () => {
  for (const marker of ['```', '~~~~']) {
    const fenced = `${marker}\n![chart.png](attachment:m-1)\n${marker}`;
    assert.deepEqual(cardImages(`${fenced}\n![after.png](attachment:m-2)`), { words: fenced, images: [{ name: 'after.png', id: 'm-2', line: '![after.png](attachment:m-2)' }] });
    assert.deepEqual(cardImages(`${fenced}\n![after.png](attachment:m-2)`.replaceAll('\n', '\r\n')).images.map(image => image.id), ['m-2']);
  }
});

test('the line the deck writes for an image names its attachment, its name never ending the line early', () => {
  assert.equal(imageLine('chart.png', 'm-1'), '![chart.png](attachment:m-1)');
  assert.equal(imageLine('a [draft] chart\n.png', 'm-1'), '![a draft chart .png](attachment:m-1)');
  assert.equal(imageLine('  ', 'm-1'), '![Image](attachment:m-1)');
  for (const name of ['chart.png', 'a ] b', 'x\\y', '[[[']) {
    const line = imageLine(name, 'abc-123');
    assert.deepEqual(cardImages(line).images.map(image => image.id), ['abc-123'], line);
  }
  // An id the line cannot hold is refused, never written as words that name nothing.
  for (const id of ['', 'a b', 'a)b', 'x'.repeat(201)]) assert.throws(() => imageLine('chart.png', id), /No image line names/);
});

test('a card\'s images and reply stacks are told apart, and both go with the card through every act', () => {
  const stack = '[Reply stack](https://here.example/?topic=t&message=m9)';
  const page = `## A\n\nwords\n\n![one.png](attachment:m-1)\n${stack}\n\n## B\n\nmore\n![two.png](attachment:m-2)\n`;
  const deck = parseDeck(page), [a, b] = deck.cards;
  const { words, stacks } = cardStacks(a.words, address => (address.includes('m9') ? 'm9' : null));
  assert.deepEqual(stacks, ['m9']);
  assert.deepEqual(cardImages(words), { words: 'words', images: [{ name: 'one.png', id: 'm-1', line: '![one.png](attachment:m-1)' }] });
  // A move keeps both cards' words byte for byte, their images among them.
  const moved = after(page, { kind: 'move', text: cardText(b), step: -1, near: 1 });
  assert.deepEqual(parseDeck(moved).cards.map(card => cardImages(card.words).images.map(image => image.id)), [['m-2'], ['m-1']]);
  // A merge keeps every image of both cards in the upper card.
  const merged = after(page, { kind: 'merge', text: cardText(a), step: 1, near: 0 });
  assert.deepEqual(cardImages(parseDeck(merged).cards[0].words).images.map(image => image.id), ['m-1', 'm-2']);
  // A remove takes its images with it, and its undo puts them back.
  const removed = applyAct(deck, { kind: 'remove', text: cardText(b), near: 1 });
  assert.equal(deckBody(removed.deck).includes('m-2'), false);
  assert.ok(deckBody(applyAct(removed.deck, removed.undo).deck).includes('![two.png](attachment:m-2)'));
});

// A page's writing as NotebookImages reads it, with the limits Core gives the page.
function page({ attachments = [], images = [], limits = {} } = {}) {
  const w = { closed: false, readOnly: false, images, value: { attachments: attachments.map(({ id }) => ({ id })) }, base: { source: { attachments } },
    bootstrap: { instance_id: 'i1', authority: { authority_id: 'a', authority_epoch: 'e' }, limits: { image_bytes: 1000, media_name_utf8_bytes: 100, attachment_count: 3, attachment_bytes: 2500, ...limits } },
    notify() {}, persist: async () => {}, capture() { return { content: structuredClone(this.value), revision: 1 }; }, edit(patch) { Object.assign(this.value, structuredClone(patch)); },
    api: { command: async () => { throw Error('no network in this check'); }, upload: async () => { throw Error('no network in this check'); } } };
  return w;
}
const file = (name, type, size) => new File([new Uint8Array(size)], name, { type });

test('a file is taken or refused at once, before its bytes are read, in words that say what was not added and why', () => {
  const images = new NotebookImages(page({ attachments: [{ id: 'm-1', size_bytes: 600 }] }));
  const taken = images.admit(file('chart.png', 'image/png', 1000));
  assert.match(taken.media, /^[0-9a-f-]{36}$/); assert.equal(taken.name, 'chart.png');
  assert.equal(images.admit(file('', 'image/jpeg', 10)).name, 'Pasted image.jpeg');
  assert.throws(() => images.admit(file('notes.pdf', 'application/pdf', 10)), { message: 'notes.pdf was not added: it is not a PNG, JPEG, GIF or WebP image.' });
  assert.throws(() => images.admit(file('drawing.svg', 'image/svg+xml', 10)), { message: 'drawing.svg was not added: it is not a PNG, JPEG, GIF or WebP image.' });
  assert.throws(() => images.admit(file('empty.png', 'image/png', 0)), /empty.png was not added/);
  // An image at the limit is taken; one byte past it is not.
  const big = new NotebookImages(page({ limits: { image_bytes: 16777216, attachment_bytes: 67108864 } }));
  assert.ok(big.admit({ name: 'large.png', type: 'image/png', size: 16777216 }).media);
  assert.throws(() => big.admit({ name: 'huge.png', type: 'image/png', size: 16777217 }), { message: 'huge.png was not added: an image may be at most 16 MB.' });
});

test('the page\'s limits count its attachments, its images still uploading and those still being read in', async () => {
  const w = page({ attachments: [{ id: 'm-1', size_bytes: 100 }] }), images = new NotebookImages(w);
  let release;
  const slow = { name: 'slow.png', type: 'image/png', size: 100, arrayBuffer: () => new Promise(done => { release = done; }) };
  const admitted = images.admit(slow), reading = images.capture(slow, admitted);
  // Read in, not yet held as an entry: it is held by its media id, from its file, and counts toward the limit.
  assert.equal(images.held(admitted.media).file, slow);
  assert.ok(images.admit(file('third.png', 'image/png', 100)), 'the third of three is taken');
  w.images.push({ id: 'x', media: 'pending', size: 100, removed: false, ready: null });
  assert.throws(() => images.admit(file('fourth.png', 'image/png', 100)), { message: 'fourth.png was not added: a page holds at most 3 images, 0 MB in all.' });
  w.images.pop();
  // Removed while it is read in, it is never taken in.
  await images.remove(admitted.media);
  release(new ArrayBuffer(100));
  assert.equal(await reading, null);
  assert.equal(w.images.length, 0); assert.equal(images.held(admitted.media), null);
  // Bytes past the page's total are refused too.
  w.bootstrap.limits.attachment_bytes = 1000;
  assert.throws(() => images.admit(file('wide.png', 'image/png', 1000)), /wide.png was not added: a page holds at most 3 images/);
  assert.ok(images.admit(file('fits.png', 'image/png', 900)));
});

test('an image taken in keeps the media id it was named by, so the card that names it shows it once Core has it', async () => {
  const w = page(), images = new NotebookImages(w), sent = [];
  w.api.command = async e => { sent.push(e); return { instance_id: 'i1', operation_id: e.operation_id, kind: e.kind, status: 'committed', recorded: true, result: { media_id: e.target.media_id, media_revision: 1, state: 'pending' } }; };
  w.api.upload = async e => { sent.push(e); const a = sent[0].args; return { instance_id: 'i1', operation_id: e.operation_id, kind: e.kind, status: 'committed', recorded: true, result: { media_id: e.target.media_id, media_revision: 2, state: 'ready', name: a.name, content_type: a.content_type, size_bytes: a.size_bytes, sha256: a.sha256, inline: true } }; };
  const admitted = images.admit(file('chart.png', 'image/png', 3));
  const entry = await images.capture(file('chart.png', 'image/png', 3), admitted);
  assert.equal(entry.media, admitted.media);
  assert.equal(images.held(admitted.media), entry, 'held from its bytes while it uploads');
  await images.running.get(entry.id);
  assert.deepEqual(sent.map(e => e.target.media_id), [admitted.media, admitted.media]);
  assert.deepEqual(w.value.attachments, [{ id: admitted.media }]);
  assert.equal(images.held(admitted.media), entry, 'held from its receipt once ready');
  assert.equal(images.held('another'), null);
  // × takes it off the page.
  await images.remove(admitted.media);
  assert.deepEqual(w.value.attachments, []); assert.equal(images.held(admitted.media), null);
});

test('a card box writes its images under its words; a new card holding only images is made, named for the first, and nothing else empty is', () => {
  const chart = '![chart.png](attachment:m-1)', photo = '![photo.jpg](attachment:m-2)', stack = '[Reply stack](https://here.example/?topic=t&message=m9)';
  assert.equal(boxText({ written: 'Plan\nShip it.\n\n', images: [chart, photo], stacks: [stack] }), `Plan\nShip it.\n\n${chart}\n${photo}\n${stack}`);
  assert.equal(boxText({ written: 'Plan', fresh: true }), 'Plan');
  // A new card with no words: made with its images, named for the first of them.
  assert.equal(boxText({ written: '', images: [chart, photo], fresh: true }), `chart\n\n${chart}\n${photo}`);
  assert.equal(boxText({ written: ' \n', images: ['![.png](attachment:m-3)'], fresh: true }), 'Image\n\n![.png](attachment:m-3)');
  assert.deepEqual(parseDeck(`## A\n\nwords\n\n## ${boxText({ written: '', images: [chart], fresh: true })}`).cards.map(card => [card.title, cardImages(card.words).images.map(image => image.id)]),
    [['A', []], ['chart', ['m-1']]]);
  // A card cleared of its text is removed, its images with it; a new card with nothing in it, or only a stack, is never made.
  assert.equal(boxText({ written: '  ', images: [chart], stacks: [stack] }), '  ');
  assert.equal(boxText({ written: '', fresh: true }), '');
  assert.equal(boxText({ written: '', stacks: [stack], fresh: true }), '');
});

// A page whose uploads answer as Core does.
function uploading(w) {
  const sent = [];
  w.api.command = async e => { sent.push(e); return { instance_id: 'i1', operation_id: e.operation_id, kind: e.kind, status: 'committed', recorded: true, result: { media_id: e.target.media_id, media_revision: 1, state: 'pending' } }; };
  w.api.upload = async e => { sent.push(e); const a = sent.find(s => s.kind === 'media.begin' && s.target.media_id === e.target.media_id).args; return { instance_id: 'i1', operation_id: e.operation_id, kind: e.kind, status: 'committed', recorded: true, result: { media_id: e.target.media_id, media_revision: 2, state: 'ready', name: a.name, content_type: a.content_type, size_bytes: a.size_bytes, sha256: a.sha256, inline: true } }; };
  return sent;
}

test('an image × took off the page goes back on it when Undo brings back its line: uploaded, still uploading, still read in, or only in Core', async () => {
  // Uploaded this visit: attached again, once, with no second upload.
  let w = page(), images = new NotebookImages(w), sent = uploading(w);
  const chart = images.admit(file('chart.png', 'image/png', 3)), entry = await images.capture(file('chart.png', 'image/png', 3), chart);
  await images.running.get(entry.id);
  await images.remove(chart.media, { keep: true });
  assert.deepEqual(w.value.attachments, []);
  assert.equal(await images.restore(chart.media), entry);
  assert.deepEqual(w.value.attachments, [{ id: chart.media }]); assert.equal(images.held(chart.media), entry);
  assert.equal(sent.length, 2, 'nothing uploads again');
  assert.equal(await images.restore(chart.media), null, 'put back once');
  assert.deepEqual(w.value.attachments, [{ id: chart.media }]);

  // Still uploading when × was pressed: its upload goes on from its bytes, under an entry of its own, and it is attached.
  w = page(); images = new NotebookImages(w); sent = uploading(w);
  let release, started; const publish = w.api.upload, reached = new Promise(done => { started = done; });
  w.api.upload = (e, blob) => new Promise(done => { release = () => done(publish(e, blob)); started(); });
  const photo = images.admit(file('photo.png', 'image/png', 3)), held = await images.capture(file('photo.png', 'image/png', 3), photo);
  await reached;
  await images.remove(photo.media, { keep: true });
  assert.equal(held.removed, true); assert.equal(held.bytes, null);
  const back = images.restore(photo.media);
  assert.equal(images.held(photo.media)?.bytes?.byteLength, 3, 'held again from its bytes while it uploads');
  release(); const again = await back; await images.running.get(again.id);
  assert.notEqual(again.id, held.id); assert.deepEqual(w.images, [again]);
  assert.deepEqual(w.value.attachments, [{ id: photo.media }]); assert.equal(again.ready.media_id, photo.media);
  assert.deepEqual(sent.map(e => e.kind), ['media.begin', 'media.publish'], 'one begin, one publish: the upload goes on as it was');

  // Still being read in: taken after all. Read in and dropped: taken again from its file.
  w = page(); images = new NotebookImages(w); uploading(w);
  let read; const slow = { name: 'slow.png', type: 'image/png', size: 3, arrayBuffer: () => new Promise(done => { read = done; }) };
  const reading = images.capture(slow, images.admit(slow)), [arriving] = images.arriving.keys();
  await images.remove(arriving, { keep: true }); await images.restore(arriving);
  read(new ArrayBuffer(3)); const taken = await reading; await images.running.get(taken.id);
  assert.deepEqual(w.value.attachments, [{ id: arriving }]);
  const late = { name: 'late.png', type: 'image/png', size: 3, arrayBuffer: async () => new ArrayBuffer(3) }, admitted = images.admit(late);
  const dropped = images.capture(late, admitted); await images.remove(admitted.media, { keep: true });
  assert.equal(await dropped, null);
  const retaken = await images.restore(admitted.media); await images.running.get(retaken.id);
  assert.equal(retaken.media, admitted.media); assert.deepEqual(w.value.attachments.map(a => a.id), [arriving, admitted.media]);

  // Only in Core, someone else's: attached again by its id.
  w = page({ attachments: [{ id: 'theirs', name: 'theirs.png', size_bytes: 3 }] }); images = new NotebookImages(w);
  await images.remove('theirs', { keep: true });
  assert.deepEqual(w.value.attachments, []);
  await images.restore('theirs');
  assert.deepEqual(w.value.attachments, [{ id: 'theirs' }]);
});

test('an image is put back only when × took it off: never one removed from the page\'s list, or one this page never held', async () => {
  const w = page({ attachments: [{ id: 'listed', name: 'listed.png', size_bytes: 3 }, { id: 'kept', name: 'kept.png', size_bytes: 3 }] }), images = new NotebookImages(w);
  await images.remove('listed');
  assert.equal(await images.restore('listed'), null);
  assert.equal(await images.restore('elsewhere'), null);
  assert.deepEqual(w.value.attachments, [{ id: 'kept' }]);
  assert.equal(images.released.size, 0);
});
