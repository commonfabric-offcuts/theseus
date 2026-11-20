// Renderer and handler contracts; no native gesture, focus or geometry claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { arrangeStacks, entries, reveal, stackState, setLevel } from '../web/reply-stacks.mjs';
import { opened } from '../web/fold.mjs';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
import { StackFeed } from '../web/stack-feed.mjs';

// Same renderer capabilities as ui_dossier_renderer_799; these only model DOM data.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]')).filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/["']/g, '')));
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
Element.prototype.after = function(node) { this.parent.insertBefore(node, this.nextElementSibling); };

function fixture(count = 14, { folded = false } = {}) {
  const doc = miniDocument(); withReaderArchive(doc);
  const list = doc.createElement('div'); list.id = 'messages'; list.root = true;
  const messages = new Map(), cards = new Map(), unread = new Set(['m1', 'm2']);
  function add(seq) {
    const item = { id: 'm' + seq, seq, topic_id: 'isolated-topic', author_id: 'fixture-person',
      body: 'Message ' + seq, reply_to: seq === 1 ? null : 'm1', acts: seq === 1 && folded ? { folded: true } : {} };
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = String(seq);
    const author = doc.createElement('span'); author.className = 'message-author'; author.textContent = item.author_id;
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(author, body); list.append(card); messages.set(item.id, item); cards.set(item.id, card);
    card.scrollIntoView = () => {};
  }
  for (let seq = 1; seq <= count; seq++) add(seq);
  const state = stackState(list);
  const draw = () => arrangeStacks(list, messages, { doc, viewer: 'fixture-reader', unread: item => unread.has(item.id) });
  state.again = draw; draw();
  return { doc, list, messages, cards, state, draw, add,
    section: () => state.sections.get('m1'),
    earlier: () => state.sections.get('m1').querySelector('.stack-earlier'),
    visible: () => [...cards].filter(([id, card]) => id !== 'm1' && !card.hidden).map(([id]) => id),
    land: (id = 'm1', options = { full: true }) => reveal(cards.get(id), options) };
}
const newest = Array.from({ length: 7 }, (_, n) => 'm' + (n + 8));

test('875 full first-message landing keeps the earlier row closed and shows the first message whole', () => {
  const f = fixture(); f.land();
  assert.equal(f.state.earlier.has('m1'), false, 'a first-message landing must not expand earlier replies');
  assert.equal(f.section().dataset.headOpen, 'true', 'the landed first message must show whole');
  assert.equal(f.cards.get('m1').dataset.earlier, undefined);
  assert.deepEqual(f.visible(), newest);
  assert.equal(f.earlier().querySelector('.stack-earlier-words').textContent, '6 earlier replies');
  assert.equal(f.earlier().querySelector('.stack-fresh').textContent, ' · 1 new', 'the visible first message is not counted as hidden new');
  assert.equal(f.earlier().title, 'Show all 6 as rows, for this visit');
  f.draw(); f.land(); assert.deepEqual(f.visible(), newest, 'a repeated landing and redraw do not expand the row');
});

const app = await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
const landingSource = app.slice(app.indexOf('function landOn(id,'), app.indexOf('// The header New act'));
test('875 actual starred rail handler and app landing draw newest seven and the earlier-replies row', async () => {
  const f = fixture(); let result, requested;
  const stackFeed = Object.assign(Object.create(StackFeed.prototype), { list: f.list });
  const context = vm.createContext({ entries, reveal, opened, stackFeed, $: () => f.list, releaseTopArrivals() {},
    anchorHold: null, rememberListAnchor() {}, listAccessEpoch: 1, registry: { generation: 1, disposed: false },
    retired: false, topicUnavailable: false, views: { messages: f.messages }, shell: { drawer: { isOpen: () => false } } });
  vm.runInContext(landingSource, context);
  const rail = { pageStars: false, outline: { doc: f.doc, open(target) {
    requested = target; result = context.landOnMessage(target.message);
  } } };
  const state = { id: 'isolated-topic', stars: [{ dossier: { id: 'm1', name: 'Named dossier' } }],
    box: f.doc.createElement('div'), links: new Map(), next: null, loaded: true };
  OutlineDossiers.prototype.paint.call(rail, state);
  state.links.get('m1').onclick({ button: 0, preventDefault() {} }); await result;
  assert.deepEqual(requested, { kind: 'topic', id: 'isolated-topic', message: 'm1', land: true });
  assert.deepEqual(f.visible(), newest, 'the actual rail-to-landing path must retain the seven-message window');
  assert.equal(f.section().dataset.headOpen, 'true');
  assert.equal(f.earlier().querySelector('.stack-earlier-words').textContent, '6 earlier replies');
});

test('875 an explicit landing on an earlier reply still opens the row and that reply whole', () => {
  const f = fixture(); f.land('m3');
  assert.equal(f.state.earlier.has('m1'), true); assert.equal(f.state.whole.has('m3'), true);
  assert.equal(f.earlier(), null);
  assert.deepEqual(f.visible(), Array.from({ length: 13 }, (_, n) => 'm' + (n + 2)));
  assert.notEqual(f.cards.get('m3').dataset.earlier, 'true');
  assert.equal(f.cards.get('m2').dataset.earlier, 'true', 'other earlier replies stay compact');
  f.land(); assert.equal(f.state.earlier.has('m1'), true, 'a first-message landing keeps a row already opened');
});

test('875 landing on a recent reply or the head without full leaves the earlier row alone', () => {
  for (const id of newest) {
    const f = fixture(); f.land(id);
    assert.equal(f.state.earlier.size, 0); assert.equal(f.state.whole.size, 0);
    assert.equal(f.section().dataset.headOpen, 'false'); assert.deepEqual(f.visible(), newest);
    assert.equal(f.earlier().querySelector('.stack-earlier-words').textContent, '7 earlier messages');
  }
  const f = fixture(); f.land('m1', {});
  assert.equal(f.section().dataset.headOpen, 'false'); assert.equal(f.state.whole.size, 0);
});

test('875 pressing the remaining earlier row opens it and targets the first hidden reply', () => {
  const f = fixture(); f.land();
  const button = f.earlier(); assert.ok(button, 'full first-message landing retains the earlier row');
  f.doc.activeElement = button; button.onclick({ pointerType: 'mouse' });
  assert.equal(f.state.earlier.has('m1'), true); assert.equal(f.earlier(), null);
  assert.equal(f.doc.activeElement, f.cards.get('m2'), 'the handler targets the first hidden reply, not the visible head');
  assert.equal(f.section().dataset.headOpen, 'true');
  assert.deepEqual(f.visible(), Array.from({ length: 13 }, (_, n) => 'm' + (n + 2)));
});

test('875 one hidden reply uses singular words and an eight-message dossier keeps no empty row', () => {
  const nine = fixture(9); nine.land();
  assert.equal(nine.earlier()?.querySelector('.stack-earlier-words').textContent, '1 earlier reply');
  assert.equal(nine.earlier().title, 'Show it as rows, for this visit');
  for (const count of [7, 8]) {
    const f = fixture(count); f.land(); assert.equal(f.earlier(), null);
    assert.equal(f.section().dataset.headOpen, 'true');
    assert.equal(f.visible().length, count - 1);
  }
});

test('875 a new arrival retains the held boundary; explicit level reset and a fresh visit reset full display', () => {
  const f = fixture(); f.land(); f.add(15); f.draw();
  assert.deepEqual(f.visible(), [...newest, 'm15'], 'arrival hides none of the seven being read');
  assert.equal(f.earlier()?.querySelector('.stack-earlier-words').textContent, '6 earlier replies');
  setLevel(f.state, f.state.stacks[0], 'folded'); f.draw();
  setLevel(f.state, f.state.stacks[0], 'open'); f.draw();
  assert.equal(f.state.whole.size, 0); assert.equal(f.section().dataset.headOpen, 'false');
  assert.equal(f.earlier().querySelector('.stack-earlier-words').textContent, '8 earlier messages');
  const fresh = fixture(); assert.equal(fresh.section().dataset.headOpen, 'false'); fresh.land();
  assert.deepEqual(fresh.visible(), newest, 'a restored full landing on a new visit retains the seven-message window');
});

test('875 full landing peeks a saved folded first message without changing its act', () => {
  const f = fixture(14, { folded: true }); f.land();
  assert.equal(f.section().dataset.headOpen, 'true'); assert.equal(f.cards.get('m1').dataset.folded, 'false');
  assert.deepEqual(f.messages.get('m1').acts, { folded: true });
  assert.deepEqual(f.visible(), newest);
});
