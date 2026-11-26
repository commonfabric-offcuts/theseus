import { StackFeed } from '../../web/stack-feed.mjs';
import { renderer799 } from './renderer799.mjs';
import { cardIn } from '../../web/fold.mjs';

// Actual renderer/feed/menu code, inert geometry; no native input claims.
export function joinFixture({ unloaded = false, phone = false } = {}) {
  const r = renderer799('reader'), doc = r.list.ownerDocument;
  doc.body = doc.byId('body'); doc.body.append(r.list); r.list.id = 'messages';
  const listeners = [];
  doc.addEventListener = (type, fn) => listeners.push({ type, fn });
  doc.removeEventListener = (type, fn) => { const i = listeners.findIndex(x => x.type === type && x.fn === fn); if (i >= 0) listeners.splice(i, 1); };
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.defaultView = { innerWidth: phone ? 375 : 1280, innerHeight: 900, matchMedia: () => ({ matches: phone }) };
  const create = doc.createElement;
  doc.createElement = tag => { const node = create(tag); node.nodeType = 1;
    node.getBoundingClientRect = () => ({ top: 40, left: 50, right: 100, bottom: 80 });
    Object.defineProperties(node, { offsetWidth: { value: 280 }, offsetHeight: { value: 120 } }); return node; };
  doc.getElementById = id => ['new-message', 'reader-aside'].includes(id) ? { querySelector: () => ({ cloneNode: () => doc.createElementNS('', 'svg') }) } : null;
  const position = (id, order) => ({ root_id: id, order_key: order, order_tie: order, name: { text: id + ' dossier' }, name_revision: 1,
    placed: order, place_revision: 2, join_revision: 3, through: null, below: false, cover: { stands: id + ' cover' }, at: { acts: 8, messages: 8 } });
  const item = (id, seq, root, order) => ({ id, seq, topic_id: 'topic', author_id: 'reader', body: id + ' words',
    acts: { join_revision: 3, name: { text: root + ' dossier' }, cover: { stands: root + ' cover' } }, stack_position: position(root, order) });
  const source = item(unloaded ? 'branch' : 'source', 2, 'source', 20);
  if (unloaded) source.reply_to = 'source';
  r.add([item('above', 3, 'above', 30), source, item('below', 1, 'below', 10)]);
  const calls = [], focuses = [], notices = [], authority = { authority_id: 'authority', authority_epoch: 'epoch' };
  const feed = Object.create(StackFeed.prototype);
  Object.assign(feed, { list: r.list, doc, messages: () => r.messages, instanceId: 'instance', viewer: 'reader', authority: () => authority,
    pending: new Map(), doubts: new Map(), undos: [], standIns: new Map(), drawn: new Map(), made: new WeakMap(), makes: 0,
    chain: Promise.resolve(), notices: new Map(), reads: 0, noticeShown: '', clock: () => 8, acted() {}, listen() {}, reread() {}, redrawn() {},
    line: () => null, press: { after: (_, fn) => fn() }, say: words => notices.push(words), status: words => notices.push(String(words)),
    arrange: () => r.add([]), focusOn: id => { focuses.push(id); cardIn(feed.entryFor(id))?.focus(); },
    commandOf: async envelope => { calls.push(envelope); return { status: 'committed', result: { into: envelope.args.into, join_revision: 3 + calls.length } }; },
    refreshPositions: async () => {} });
  const selected = unloaded ? 'branch' : 'source';
  const opened = [], originalJoin = feed.join.bind(feed);
  feed.join = (...args) => { const menu = originalJoin(...args); if (menu) opened.push(menu); return menu; };
  const entry = () => feed.entryFor(selected);
  const key = (way = 'up', extra = {}) => { const at = cardIn(entry()); at.nodeType = 1; at.focus();
    return feed.key({ key: way === 'up' ? 'ArrowUp' : 'ArrowDown', metaKey: true, shiftKey: true, target: at, preventDefault() {}, ...extra }); };
  const menu = () => doc.body.querySelector('.message-menu-list');
  const click = button => button.onclick({ stopPropagation() {} });
  const confirm = () => { const button = menu()?.querySelectorAll('button').find(b => b.text.startsWith('Join “'));
    if (!button) throw Error('No explicit named Join choice'); return click(button); };
  const close = () => opened.forEach(menu => menu.close(false));
  return { ...r, doc, feed, calls, focuses, notices, authority, selected, entry, key, menu, click, confirm, listeners, opened, close };
}
