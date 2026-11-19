import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { configureCoverRefresh } from '../web/cover-refresh.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { openLinksWith } from '../web/links.mjs';

// Actual dossier renderer, menu and request owner. No native layout/input claim.
function fixture(t, { partial = false, cover = null } = {}) {
  const r = renderer799('owner'), doc = r.list.ownerDocument, storage = new Map(), sent = [];
  const opened = [], make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag);
    node.click = () => node.listeners.click?.({ button: 0, stopPropagation() {}, preventDefault() {} });
    return node;
  };
  openLinksWith((route, title, link) => opened.push({ route, href: link.href }));
  t.after(() => openLinksWith(null));
  doc.querySelectorAll = selector => r.list.querySelectorAll(selector);
  doc.defaultView = { localStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const bootstrap = { instance_id: 'ask-cover840-' + crypto.randomUUID(), actor: 'owner',
    authority: { authority_id: 'authority', authority_epoch: 1 } };
  const response = { run: async () => { throw Error('interrupted'); } };
  configureCoverRefresh(() => ({ bootstrap, api: { command: async envelope => {
    sent.push(envelope); return response.run(envelope);
  } }, changed() {} }));
  t.after(() => configureCoverRefresh(null));
  const id = partial ? 'reply' : 'root';
  const state = r.add([{ id, seq: 1, author_id: 'owner', topic_id: 'topic', reply_to: partial ? 'root' : null, acts: { cover, cover_revision: cover ? 1 : 0 },
    stack_position: { root_id: 'root', cover, below: false, at: { acts: 1, messages: 1 } } }]);
  const section = () => state.sections.get(id), tools = () => section().querySelector('.stack-tools');
  const feed = { list: r.list, state, doc, undos: [], actsOf: () => ({}),
    entryFor: key => [...r.list.descendants()].find(node => node.dataset.id === key) };
  const menu = phone => StackFeed.prototype.menuItems.call(feed, r.messages.get(id), { phone });
  return { ...r, doc, state, tools, section, menu, storage, sent, response, bootstrap, id, opened };
}
const press = { stopPropagation() {} };
const cover = { root_id: 'root', revision: 1, stands: 'Facts checked', waiting: [], payload: null,
  owner: 'owner', refresh: null, refresh_revision: 0 };

test('840 bare original has a cover-plus control before the existing title tools and no cover sheet', t => {
  const f = fixture(t), tools = f.tools(), control = tools.querySelector('.cover-refresh-glyph');
  assert.ok(control, 'bare original offers Ask for a cover');
  assert.equal(control.getAttribute('aria-label'), 'Ask for a cover');
  assert.equal(control.title, 'Ask for a cover');
  assert.equal(tools.children[0].dataset.tool, 'cover');
  assert.deepEqual(tools.children.slice(1).map(node => node.dataset.tool), ['reply', 'aside', 'menu']);
  assert.equal(f.section().dataset.askCover, 'true');
  assert.equal(f.section().querySelector('.dossier-cover'), null);
  assert.equal(control.querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
  assert.equal(control.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(control.querySelector('path').getAttribute('d'), 'M13 4H4v16h15V11 M7 9h4 M7 13h8 M7 17h6 M18 2v6 M15 5h6');
});

test('840 existing cover and unloaded original offer no first-cover control or menu act', t => {
  for (const options of [{ cover }, { partial: true }]) {
    const f = fixture(t, options);
    assert.ok(f.tools().querySelector('[data-tool=cover]') === null);
    assert.equal(f.menu(false).first.some(item => item.label === 'Ask for a cover'), false);
  }
});

test('840 title and phone menu share exact interrupted retry, pending dots and canonical request link', async t => {
  const f = fixture(t);
  const button = f.tools().querySelector('.cover-refresh-glyph'); assert.ok(button);
  const sending = button.onclick(press);
  assert.equal(f.tools().querySelector('.cover-refresh-glyph').dataset.pending, 'true', 'busy shares the persistent activity rule');
  await sending;
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].kind, 'stack.cover_refresh');
  assert.deepEqual(f.sent[0].target, { message_id: 'root' });
  assert.equal(f.sent[0].expected.cover_revision, 0);
  assert.deepEqual(f.sent[0].expected.authority, f.bootstrap.authority);
  assert.deepEqual(f.sent[0].args, {}); assert.equal(f.storage.size, 1);
  assert.match(f.tools().querySelector('.cover-refresh-status').text, /not confirmed/);
  for (const phone of [false, true]) {
    const item = f.menu(phone).first.find(row => row.label === 'Ask for a cover'); assert.ok(item);
    assert.equal(item.glyph, 'coverplus');
  }
  f.response.run = async envelope => ({ instance_id: envelope.instance_id, operation_id: envelope.operation_id,
    kind: envelope.kind, status: 'committed', recorded: true,
    result: { refresh_revision: 1, refresh: { state: 'pending', operation_id: envelope.operation_id,
      observed_revision: 0, recipient: 'writer', request_message_id: 'request' } } });
  await f.menu(true).first.find(row => row.label === 'Ask for a cover').act();
  assert.deepEqual(f.sent[1], f.sent[0]); assert.equal(f.storage.size, 0);
  const link = f.tools().querySelector('.cover-refresh-glyph');
  assert.equal(link.tag, 'a'); assert.match(link.href, /message=request/);
  assert.match(link.getAttribute('aria-label'), /Asked writer to write a cover/);
  assert.equal(link.title, link.getAttribute('aria-label'));
  assert.equal(f.tools().querySelector('.cover-refresh-status').text, '');
  assert.ok(!f.tools().text.includes('Asked writer'), 'no visible progress sentence');
  const count = f.sent.length, openRequest = f.menu(false).first.find(row => row.label === 'Open the cover request');
  assert.ok(openRequest, 'pending menu opens its request'); await openRequest.act();
  assert.equal(f.sent.length, count, 'opening a pending request never sends another one');
});

test('840 pending from Core survives repaint without a cover, then yields to the first real cover', t => {
  const f = fixture(t), item = f.messages.get('root');
  item.acts = { cover: null, cover_revision: 0, cover_refresh_revision: 1,
    cover_refresh: { state: 'pending', recipient: 'writer', request_message_id: 'kept-request', observed_revision: 0 } };
  f.state.again();
  const pending = f.tools().querySelector('.cover-refresh-glyph'); assert.ok(pending);
  assert.equal(pending.tag, 'a'); assert.match(pending.href, /message=kept-request/);
  assert.equal(f.section().querySelector('.dossier-cover'), null);
  pending.focus(); f.state.again(); assert.equal(f.doc.activeElement, pending, 'unchanged projection keeps the existing focused control');
  item.acts = { cover, cover_revision: 1, cover_refresh_revision: 2,
    cover_refresh: { state: 'completed', recipient: 'writer', request_message_id: 'kept-request' } };
  f.state.again();
  assert.equal(f.tools().querySelector('[data-tool=cover]'), null);
  assert.equal(f.section().dataset.askCover, 'false');
  assert.ok(f.section().querySelector('.dossier-cover'));
  assert.ok(f.section().querySelector('.dossier-cover').querySelector('.cover-refresh-glyph'));
});

test('840 authority changes preserve the unconfirmed first-cover request and send nothing new', async t => {
  const f = fixture(t), button = f.tools().querySelector('.cover-refresh-glyph'); assert.ok(button);
  await button.onclick(press); const kept = [...f.storage.values()][0];
  f.bootstrap.authority = { authority_id: 'authority', authority_epoch: 2 };
  await f.tools().querySelector('.cover-refresh-glyph').onclick(press);
  assert.equal(f.sent.length, 1); assert.equal([...f.storage.values()][0], kept);
  assert.match(f.tools().querySelector('.cover-refresh-status').text, /earlier instance binding/);
});

test('840 CSS reserves the fourth title glyph only when drawn, with the same visibility owner', () => {
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  assert.match(css, /\.reply-stack\[data-ask-cover=true\]\{--stack-cover-tools:1\}/);
  assert.match(css, /--stack-tools-w:calc\(\(var\(--stack-base-tools\) \+ var\(--stack-cover-tools\)\) \* var\(--stack-tool-size\)/);
  assert.match(css, /--stack-base-tools:3/);
  assert.match(css, /@media\(max-width:760px\)\{\s*\.reply-stack\{--stack-base-tools:1\}/);
  assert.match(css, /opacity:var\(--stack-tools-shown\)/);
  assert.match(css, /\.stack-cover-request>\.cover-refresh-glyph/);
  assert.match(css, /\.stack-cover-request:has\(\.cover-refresh-status:not\(:empty\)\)\{clip-path:none\}/, 'a refusal can extend below the title controls without being clipped away');
});

test('840 pending and busy title activity has independent visibility while sibling tools retain their rest rule', t => {
  const f = fixture(t), item = f.messages.get('root');
  item.acts = { cover: null, cover_revision: 0, cover_refresh_revision: 1,
    cover_refresh: { state: 'pending', recipient: 'writer', request_message_id: 'kept-request', observed_revision: 0 } };
  f.state.again();
  assert.equal(f.tools().querySelector('.cover-refresh-glyph').dataset.pending, 'true');
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const row = css.match(/^\.reply-stack>\.stack-tools\{([^}]+)\}/m)?.[1];
  assert.ok(row); assert.doesNotMatch(row, /opacity:|clip-path:/, 'the row cannot hide its pending child');
  assert.match(css, /\.reply-stack>\.stack-tools>\*\{opacity:var\(--stack-tools-shown\);clip-path:inset/);
  assert.match(css, /\.reply-stack\{[^}]*--stack-tools-shown:0;/);
  assert.match(css, /\.stack-cover-request:has\(\.cover-refresh-glyph\[data-pending=true\]\)\{opacity:1;clip-path:none\}/);
  assert.match(css, /\.reply-stack:has\(>\.stack-tools \.cover-refresh-glyph\[data-pending=true\]\)\{--stack-tools-held:1\}/);
});

test('840 pending menu opens the dots canonical request through the shared link owner', async t => {
  const f = fixture(t), item = f.messages.get('root');
  item.acts = { cover: null, cover_revision: 0, cover_refresh_revision: 1,
    cover_refresh: { state: 'pending', recipient: 'writer', request_message_id: 'kept-request', observed_revision: 0 } };
  f.state.again();
  const dots = f.tools().querySelector('.cover-refresh-glyph');
  for (const phone of [false, true]) {
    const menu = f.menu(phone).first;
    assert.equal(menu.some(row => row.label === 'Ask for a cover'), false);
    const open = menu.find(row => row.label === 'Open the cover request'); assert.ok(open);
    assert.equal(open.glyph, 'link'); await open.act();
    assert.deepEqual(f.opened.at(-1), { route: { kind: 'topic', id: 'topic', message: 'kept-request' }, href: dots.href });
  }
  assert.equal(f.sent.length, 0);
});
