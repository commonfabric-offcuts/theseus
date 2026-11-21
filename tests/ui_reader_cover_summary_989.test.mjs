import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

function fixture(t, stands = '') {
  const doc = miniDocument(), create = doc.createElement;
  // This fixture needs the browser's descendant textContent getter. Keep the
  // shared mini DOM's historical own-text convention local to its old checks.
  doc.createElement = tag => {
    const n = create(tag); let own = n.textContent;
    Object.defineProperty(n, 'textContent', { get: () => own + n.children.map(c => typeof c === 'string' ? c : c.textContent).join(''),
      set: value => { n.replaceChildren(); own = String(value ?? ''); } });
    const replace = n.replaceChildren.bind(n);
    n.replaceChildren = (...nodes) => { own = ''; replace(...nodes); };
    n.style = { setProperty() {} };
    return n;
  };
  const previous = globalThis.document; globalThis.document = doc;
  t.after(() => { globalThis.document = previous; });
  const state = { cover: { stands, owner: 'reader', waiting: [], payload: null }, root: 'root' };
  const host = doc.byId('reader-cover'), line = doc.byId('reader-cover-line'); host.append(line);
  const reader = Object.assign(Object.create(Reader.prototype), { $: id => doc.byId(id), callbacks: {
    actor: () => 'reader', actorName: id => id, dossierCover: () => ({ cover: state.cover, rootId: state.root, topicId: 'topic' }),
  } });
  const source = { source_ref: { kind: 'message', id: 'root' } };
  const draw = () => reader.paintCover(source), words = () => line.querySelector('.reader-cover-words');
  return { state, host, line, reader, source, draw, words };
}

test('989 actual Reader summary reads bold/code/link label as plain words, with no link stop', t => {
  const raw = '**Ready** with `exact bytes` and [the result](https://example.test/result)', f = fixture(t, raw);
  f.draw();
  assert.equal(f.words().textContent, 'Ready with exact bytes and the result');
  assert.equal(f.words().children.length, 0, 'collapsed words contain no formatted controls');
  assert.equal(f.line.querySelectorAll('a').length, 0);
  assert.equal(f.host.querySelector('.cover-stands').querySelector('strong').textContent, 'Ready');
  assert.equal(f.host.querySelector('.cover-stands').querySelector('a').href, 'https://example.test/result');
  assert.equal(f.state.cover.stands, raw, 'authored Core words stay exact');
});

test('989 nested emphasis and an emphasized link label use their visible words', t => {
  const f = fixture(t, '***Ready*** and [**the** `result`](https://example.test/result)'); f.draw();
  assert.equal(f.words().textContent, 'Ready and the result');
});

test('989 escaped marks and marks inside code stay literal as the painter reads them', t => {
  const f = fixture(t, String.raw`Keep \*literal\* and \`ticks\` with ` + '`**code words**`'); f.draw();
  assert.equal(f.words().textContent, 'Keep *literal* and `ticks` with **code words**');
});

test('989 plain LF, Unicode, angle brackets and unsafe HTML remain plain exact text', t => {
  const f = fixture(t);
  for (const raw of ['  Plain  café\nSecond line  ', 'Keep <literal> & words', '<script>bad()</script>']) {
    f.state.cover.stands = raw; f.draw(); assert.equal(f.words().textContent, raw);
    assert.equal(f.line.querySelectorAll('script,iframe,a').length, 0);
  }
});

test('989 payload then wait fallbacks keep their precedence and payload pill', t => {
  const f = fixture(t);
  f.state.cover.payload = { text: '**Payload** [label](https://example.test/)', kind: 'answer', message_id: 'm' };
  f.draw(); assert.equal(f.words().textContent, 'Payload label');
  assert.equal(f.line.querySelectorAll('.pill-payload').length, 1);
  f.state.cover.stands = '`Standing` wins'; f.draw(); assert.equal(f.words().textContent, 'Standing wins');
  f.state.cover.stands = ''; f.state.cover.payload = null; f.state.cover.waiting = [{ text: 'Answer', actor_id: 'reader' }];
  f.draw(); assert.equal(f.words().textContent, 'Something waits on you');
  f.state.cover.waiting[0].actor_id = '**Casey**'; f.draw();
  assert.equal(f.words().textContent, 'Something waits on **Casey**', 'generated actor labels keep their literal names');
});

test('989 repaint follows revision while keeping opened sheet, changing root closes it', t => {
  const f = fixture(t, '**First**'); f.draw(); const before = f.words(); f.host.open = true;
  f.draw(); assert.equal(f.words(), before); assert.equal(f.host.open, true);
  f.state.cover.stands = '[Second](https://example.test/)'; f.draw();
  assert.equal(f.words().textContent, 'Second'); assert.equal(f.host.open, true);
  f.state.root = 'other'; f.draw(); assert.equal(f.host.open, false);
  f.reader.callbacks.dossierCover = () => null; f.draw(); assert.equal(f.host.hidden, true); assert.equal(f.line.children.length, 0);
});
