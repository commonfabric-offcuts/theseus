import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { StackFeed } from '../web/stack-feed.mjs';
import { stackCover } from '../web/stack-order.mjs';
import { Reader } from '../web/reader.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Execute the actual app callback with its lexical inputs, without starting
// the application, a server, a browser or a substitute callback.
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const callback = app.slice(app.indexOf('function readerDossierCover(source) {'), app.indexOf('\nfunction paintReaderTitle()', app.indexOf('function readerDossierCover(source) {')));
assert.ok(callback.startsWith('function readerDossierCover(source) {'));
function fixture(t) {
  const doc = miniDocument(), previous = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = previous; });
  const cover = { stands: '  Separate  café investigation — caller’s exact words  ', waiting: [], payload: null, owner: 'owner' };
  const stack = { id: 'root', head: { id: 'root', topic_id: 'topic', acts: { cover } }, replies: [] };
  const feed = { state: { stacks: [stack] }, dossierCover: StackFeed.prototype.dossierCover };
  const scope = { stackFeed: feed, topicUnavailable: false, topic: { id: 'topic' } };
  const dossierCover = runInNewContext(callback + '\nreaderDossierCover', scope);
  const host = doc.byId('reader-cover'), line = doc.byId('reader-cover-line'); host.append(line);
  const reader = Object.assign(Object.create(Reader.prototype), { $: id => doc.byId(id), callbacks: { dossierCover, actor: () => 'owner' } });
  const source = { source_ref: { kind: 'message', id: 'root' }, topic_id: 'topic' };
  return { doc, cover, stack, feed, scope, host, line, reader, source, dossierCover };
}

test('item 760 actual app → feed → stack → Reader → sheet keeps singleton authored reason exactly', t => {
  const f = fixture(t);
  assert.equal(stackCover(f.stack), null, 'ordinary model default excludes a singleton');
  assert.equal(f.feed.dossierCover('root'), null, 'ordinary feed default stays unchanged');
  f.reader.paintCover(f.source);
  assert.equal(f.host.hidden, false, 'the actual app callback requests the singleton cover');
  assert.equal(f.reader.coverDossier, 'root');
  assert.equal(f.line.querySelector('.cover-label').textContent, 'Cover');
  assert.equal(f.line.querySelector('.reader-cover-words').textContent, f.cover.stands);
  assert.equal(f.host.querySelector('.cover-stands').text, f.cover.stands);
  assert.equal(f.host.querySelectorAll('.cover-stands').length, 1);
  assert.equal(f.host.querySelectorAll('.cover-wait,.cover-payload').length, 0);
  f.host.open = true;
  f.reader.paintCover(f.source);
  assert.equal(f.host.open, true, 'unchanged paint keeps an opened sheet');
  f.cover.stands = '  Later exact words  ';
  f.reader.paintCover(f.source);
  assert.equal(f.host.open, true);
  assert.equal(f.host.querySelector('.cover-stands').text, f.cover.stands);
  f.stack.head.acts.cover = null;
  f.reader.paintCover(f.source);
  assert.equal(f.host.hidden, true);
  assert.equal(f.host.open, false);
});

test('item 760 complete Reader chain keeps reply and current joined-root cover semantics', t => {
  const f = fixture(t);
  f.stack.replies.push({ id: 'reply' });
  assert.equal(f.feed.dossierCover('reply').cover, f.cover);
  f.source.source_ref.id = 'reply';
  f.reader.paintCover(f.source);
  assert.equal(f.reader.coverDossier, 'root');
  assert.equal(f.host.querySelector('.cover-stands').text, f.cover.stands);
  // The first loaded message is now a reply of a different current root.
  f.stack.head.reply_to = 'joined-root';
  f.stack.head.stack_position = { root_id: 'joined-root', at: { acts: 1 }, cover: { ...f.cover, stands: 'Current joined cover' } };
  f.reader.paintCover(f.source);
  assert.equal(f.reader.coverDossier, 'joined-root');
  assert.equal(f.host.querySelector('.cover-stands').text, 'Current joined cover');
  f.stack.head.stack_position.cover = null;
  f.reader.paintCover(f.source);
  assert.equal(f.host.hidden, true, 'no stale local cover is used for the new root');
});

test('item 760 app Reader cover stays scoped to readable current topic and message sources', t => {
  const f = fixture(t);
  for (const source of [{ ...f.source, topic_id: 'other' }, { ...f.source, source_ref: { kind: 'memory', id: 'root' } },
    { ...f.source, source_ref: { kind: 'message', id: 'not-loaded' } }]) assert.equal(f.dossierCover(source), null);
  f.scope.topicUnavailable = true;
  assert.equal(f.dossierCover(f.source), null);
});

import { assertCoverBounds, COVER_EDGE_TOLERANCE_PX, COVER_SIZE_TOLERANCE_PX } from './reader_cover_760.mjs';
test('item 760 native geometry assertion instrument accepts rounding and rejects overflow and invisible rectangles', () => {
  const viewport = { width: 320, height: 640 };
  const rect = { left: -1, right: 321, top: -1, bottom: 641, width: 322, height: 642 };
  assert.equal(COVER_EDGE_TOLERANCE_PX, 1.5);
  assert.equal(COVER_SIZE_TOLERANCE_PX, 0.5);
  assert.doesNotThrow(() => assertCoverBounds(rect, viewport, 'rounding control'));
  for (const change of [{ left: -10 }, { right: 330 }, { top: -10 }, { bottom: 650 }, { width: 0 }, { height: 0 }, { right: NaN }]) {
    assert.throws(() => assertCoverBounds({ ...rect, ...change }, viewport, 'negative observation'), assert.AssertionError);
  }
});
