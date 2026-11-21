import { withReaderArchive } from './fixtures/reader_archive.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { arrangeStacks, stackState, fillFrom } from '../web/reply-stacks.mjs';
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]')).filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/[\"']/g, '')));
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

test('799 actual renderer draws the real head and reply once, keeps More frontier, transfers paged ownership', () => {
  const doc = miniDocument(); withReaderArchive(doc);
  const list = doc.createElement('div'), messages = new Map(), cards = new Map(); list.root = true;
  const position = { root_id: 'root', at: { acts: 1, messages: 1501 }, name: null };
  const root = { id: 'root', topic_id: 't', seq: 1, author_id: 'a', body: 'Actual first line\nSecond', dossierSource: true, acts: {}, stack_position: position };
  const reply = { id: 'reply', topic_id: 't', seq: 1501, author_id: 'b', body: 'Loaded reply', reply_to: 'root', acts: {}, stack_position: position };
  function add(item) {
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = String(item.seq);
    const author = doc.createElement('span'); author.className = 'message-author'; author.textContent = item.author_id;
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(author, body); list.append(card); messages.set(item.id, item); cards.set(item.id, card);
  }
  const own = { ...reply, id: 'own', seq: 1400, author_id: 'me' };
  add(own); add(reply); add(root);
  const draw = () => arrangeStacks(list, messages, { doc, viewer: 'me' });
  draw();
  const state = stackState(list);
  assert.equal(state.stacks[0].id, 'root');
  assert.equal(state.sections.get('root').dataset.headOpen, 'true', 'ordinary dossiers begin expanded (857)');
  assert.equal(cards.get('reply').parentElement.className, 'stack-replies');
  assert.equal(cards.get('root').querySelector('.stack-name').textContent, 'Actual first line');
  assert.deepEqual(state.stacks[0].replies.map(item => item.id), ['reply', 'own']);
  fillFrom(list); assert.equal(state.filling.below, 1400);
  // The actual page reaches the root: its one existing entry takes ownership.
  messages.set('root', { ...root, dossierSource: false }); draw();
  assert.equal(state.stacks[0].id, 'root');
  assert.deepEqual(state.stacks[0].replies.map(item => item.id), ['reply', 'own'], 'More preserves the existing loaded descendant order');
  assert.equal(state.filled.has('root') || state.apart.has('root'), false);
  assert.equal([...list.descendants()].filter(e => e.dataset.id === 'root').length, 1);
  assert.equal(cards.get('reply').parentElement.className, 'stack-replies');
});

for (const filtered of [false, true]) test(`954 separate rename handle stays out of reading order; Only-new=${filtered}`, () => {
  const doc = miniDocument(); withReaderArchive(doc);
  const list = doc.createElement('div'); list.root = true;
  const position = { root_id: 'root', at: { acts: 1, messages: 2 }, name: null };
  const root = { id: 'root', topic_id: 't', seq: 1, author_id: 'me', body: 'Dossier title', acts: {}, stack_position: position };
  const messages = new Map([['root', root]]), calls = [];
  if (filtered) messages.set('reply', { ...root, id: 'reply', seq: 2, body: 'Reply', reply_to: 'root' });
  for (const item of messages.values()) {
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = String(item.seq);
    const author = doc.createElement('span'); author.className = 'message-author';
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(author, body); list.append(card);
  }
  const state = stackState(list); state.only = filtered ? () => true : null;
  const draw = () => arrangeStacks(list, messages, { doc, viewer: 'me', on: {
    rename: stack => calls.push(['rename', stack.id]), star: stack => calls.push(['star', stack.id]),
  } });
  draw();
  const section = state.sections.get('root'), name = section.querySelector('.stack-name'), pen = section.querySelector('.stack-pen'), star = section.querySelector('.stack-star');
  const event = { preventDefault() {}, stopPropagation() {}, target: pen };
  name.parentElement.onclick(event); star.onclick(event);
  assert.deepEqual(calls, [['rename', 'root'], ['star', 'root']], 'pointer rename and the independent star retain their owners');
  assert.equal(name.getAttribute('role'), 'button'); assert.equal(pen.getAttribute('aria-hidden'), 'true');
  assert.equal(star.tabIndex, 0, 'the star remains in reading order');
  assert.equal(name.tabIndex, -1, 'the rename handle adds no Tab/arrow stop');
  root.body = 'Changed title'; draw();
  assert.equal(section.querySelector('.stack-name').tabIndex, -1, 'repaint keeps the skipped stop');
  assert.equal(section.querySelector('.stack-star'), star, 'repaint preserves the star node');
});
