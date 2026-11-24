import assert from 'node:assert/strict';
import { CardReplies } from '../../web/card-replies.mjs';
import { noWriting } from '../../web/editor.mjs';
import { miniDocument, matches } from './mini_dom.mjs';

let serial = 0;

// Actual CardReplies open/paint/close and the persistent viewport reader.
// Layout, page scroll and event delivery are explicit ports, not native input.
export async function replyScroll1173(run) {
  const saved = new Map(), frames = new Map(), documentEvents = new Map(), viewportEvents = new Map();
  const trace = [], focusOptions = [], kept = [], css = new Map();
  const state = { boxTop: 600, boxBottom: 750, sendBottom: 794, pageTop: 0, composerTop: 0 };
  let frameId = 0;
  const set = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  };
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag);
    node.ownerDocument = doc;
    Object.defineProperty(node, 'parentElement', { get: () => node.parent });
    node.matches = selector => matches(node, selector);
    node.hasAttribute = name => node.getAttribute(name) !== null;
    node.style = { setProperty() {}, removeProperty() {} };
    return node;
  };
  const html = doc.createElement('html'), body = doc.createElement('body');
  html.root = true; html.append(body); doc.documentElement = html; doc.body = body;
  html.style.setProperty = (key, value) => css.set(key, value);
  const dossier = doc.createElement('section'), replies = doc.createElement('div'), card = doc.createElement('article');
  dossier.className = 'reply-stack'; replies.className = 'stack-replies'; card.dataset.id = 'message';
  body.append(dossier); dossier.append(replies); replies.append(card);
  const root = doc.createElement('div'), box = doc.createElement('div'), field = doc.createElement('textarea');
  root.className = 'composer card-reply-composer'; box.className = 'field-box';
  card.append(root); root.append(box); box.append(field);
  const send = doc.createElement('button'), plus = doc.createElement('button'), taller = doc.createElement('button');
  send.className = 'compose-send'; plus.className = 'plus-button'; root.append(send, plus, taller);
  const editor = { draft: { ...noWriting(), body: 'Exact inline draft.\nSecond line.' }, submissions: [] };
  const p = { hidden: true, source: { source_ref: { kind: 'message', id: 'message' } }, editors: { reply: editor } };
  root.hidden = true; field.value = editor.draft.body; field.readOnly = false;
  field.selectionStart = 3; field.selectionEnd = 11;
  const rect = (top, bottom) => ({ top, bottom, height: bottom - top });
  const visible = () => root.hidden ? [] : [rect(state.boxTop, state.boxBottom)];
  box.getBoundingClientRect = field.getBoundingClientRect = () => rect(state.boxTop, state.boxBottom);
  box.getClientRects = field.getClientRects = root.getClientRects = visible;
  root.getBoundingClientRect = () => rect(100, 400); root.clientHeight = 300; root.scrollHeight = 900;
  for (const button of [send, plus]) {
    button.getClientRects = visible;
    button.getBoundingClientRect = () => rect(state.sendBottom - 40, state.sendBottom);
  }
  function pageMove(owner, by) {
    if (!by) return;
    const before = state.pageTop;
    state.pageTop += by; state.boxTop -= by; state.boxBottom -= by; state.sendBottom -= by;
    trace.push({ owner, before, after: state.pageTop, by,
      ...(owner === 'person' ? {} : { stack: new Error('application page scroll').stack }) });
  }
  Object.defineProperty(html, 'scrollTop', { get: () => state.pageTop, set: top => pageMove('scrollTop', top - state.pageTop) });
  doc.scrollingElement = html;
  const listen = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const documentEvent = (type, extra = {}) => {
    const event = { type, target: dossier, ...extra };
    for (const fn of documentEvents.get(type) ?? []) fn(event);
  };
  doc.addEventListener = (type, fn) => listen(documentEvents, type, fn);
  doc.removeEventListener = (type, fn) => documentEvents.get(type)?.delete(fn);
  field.focus = options => { focusOptions.push(options); doc.activeElement = field; documentEvent('focusin', { target: field }); };
  card.focus = options => { focusOptions.push(options); doc.activeElement = card; documentEvent('focusout', { target: field }); };
  const vv = { width: 390, height: 844, offsetTop: 0, scale: 1,
    addEventListener: (type, fn) => listen(viewportEvents, type, fn) };
  const owner = Object.assign(Object.create(CardReplies.prototype), {
    rows: new Map(), closed: new Set(), changed() {},
    registry: { current: null, pendingOpen: null, disposed: false, doubt: () => ({ label: '' }),
      async hideCard(value) { kept.push(JSON.parse(JSON.stringify(value.editors.reply.draft))); value.hidden = true; return true; } }
  });
  const row = { card, p, sourceHeight: 240, paintHeight() {}, ui: { root, field,
    $: () => taller, bar: { expand() {}, close() {} }, paintStatus() {}, drawEditor() { field.value = editor.draft.body; } } };
  owner.rows.set('message', row);
  try {
    set('window', globalThis); set('document', doc); set('visualViewport', vv);
    set('innerWidth', 390); set('innerHeight', 844); set('scrollY', 0);
    set('scrollBy', ({ top }) => pageMove('scrollBy', top));
    set('matchMedia', () => ({ matches: true }));
    set('getComputedStyle', () => ({ position: 'static', overflowY: 'visible', scrollPaddingBottom: '8px' }));
    set('requestAnimationFrame', fn => { frames.set(++frameId, fn); return frameId; });
    set('cancelAnimationFrame', id => frames.delete(id)); doc.defaultView = globalThis;
    await import(`../../web/compose-bar.mjs?1173=${++serial}`);
    const step = () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); };
    const pump = () => { for (let n = 0; frames.size && n < 8; n++) step(); assert.equal(frames.size, 0, 'bounded viewport work settles'); };
    const emit = (type, changes = {}) => {
      Object.assign(vv, changes);
      for (const fn of viewportEvents.get(type) ?? []) fn({ type });
    };
    await run({ owner, row, p, editor, field, root, card, dossier, doc, vv, state, trace, focusOptions, kept, css, frames,
      open: () => owner.open('message', card), close: () => owner.close('message'),
      gesture: type => documentEvent(type), userScroll: top => pageMove('person', top - state.pageTop),
      input: () => documentEvent('input', { target: field }), emit, step, pump,
      applications: () => trace.filter(write => write.owner !== 'person') });
  } finally {
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
    }
  }
}
