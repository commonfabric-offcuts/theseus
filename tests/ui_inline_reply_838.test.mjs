import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as compose from '../web/compose-bar.mjs';
import { Reader } from '../web/reader.mjs';
const { revealCardReply } = compose;

function viewport(top, bottom, vv = null, docked = true) {
  const moves = [], box = { getBoundingClientRect: () => ({ top, bottom }), getClientRects: () => [{}], closest: () => docked };
  const field = { closest: selector => selector === '#reader[data-card-reply], .card-reply-composer' ? docked : box };
  const win = { innerHeight: 800, visualViewport: vv, scrollBy: move => moves.push(move) };
  return { field, win, moves };
}
test('838 Reply brings an offscreen field bottom to the visible bottom, leaving a visible field alone', () => {
  for (const [top, bottom, expected] of [[900, 1000, 200], [700, 790, null], [-100, -20, -820]]) {
    const f = viewport(top, bottom); revealCardReply(f.field, f.win);
    assert.deepEqual(f.moves, expected === null ? [] : [{ top: expected, behavior: 'instant' }]);
  }
});
test('838 keyboard visibility uses visual viewport offset and height; full Reader does not move the page', () => {
  const vv = { offsetTop: 65, height: 335 };
  const f = viewport(470, 550, vv); revealCardReply(f.field, f.win);
  assert.deepEqual(f.moves, [{ top: 150, behavior: 'instant' }]);
  const full = viewport(470, 550, vv, false); revealCardReply(full.field, full.win);
  assert.deepEqual(full.moves, []);
});
test('838 Reader Reply focuses existing writing and then reveals its field', () => {
  const f = viewport(900, 1000), ref = { kind: 'message', id: 'm' }, events = [];
  Object.assign(f.field, { value: 'Kept writing', focus: options => events.push(options), setSelectionRange: (...args) => events.push(args) });
  const r = Object.assign(Object.create(Reader.prototype), { card: {}, sessions: {}, source: { source_ref: ref }, mode: 'reply', field: f.field });
  const previous = globalThis.window; globalThis.window = f.win;
  try { assert.equal(r.reply(ref), true); } finally { globalThis.window = previous; }
  assert.deepEqual(events, [{ preventScroll: true }, [12, 12]]);
  assert.deepEqual(f.moves, [{ top: 200, behavior: 'instant' }]);
});
test('838 keyboard resize reveals the field but ordinary visual viewport scroll leaves it alone', () => {
  const code = readFileSync(new URL('../web/compose-bar.mjs', import.meta.url), 'utf8');
  const track = new Function('revealCardReply', 'TYPING', 'KEYBOARD_MIN',
    `${code.slice(code.indexOf('function trackKeyboard('), code.indexOf('trackKeyboard(globalThis'))}; return trackKeyboard;`)(revealCardReply, 'textarea', 120);
  const listeners = {}, f = viewport(600, 700), vv = f.win.visualViewport = { height: 800, width: 390, offsetTop: 0,
    addEventListener: (event, fn) => { listeners[event] = fn; } };
  f.field.matches = () => true;
  const doc = { activeElement: f.field, documentElement: { style: { setProperty() {} } }, addEventListener() {} };
  track(f.win, doc);
  vv.height = 400; listeners.resize({ type: 'resize' });
  assert.deepEqual(f.moves, [{ top: 300, behavior: 'instant' }]);
  listeners.scroll({ type: 'scroll' });
  assert.equal(f.moves.length, 1, 'scrolling away is not corrected back to the reply');
});

function placement(full = false) {
  const props = new Map(), preview = { clientHeight: 1000, scrollTop: 0 };
  const card = { dataset: full ? { full: 'shown' } : {}, clientHeight: 300, scrollHeight: 1060, scrollTop: 100,
    getBoundingClientRect: () => ({ height: 302 }), querySelector: () => preview,
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) },
    setAttribute() {}, removeAttribute() {}, append() {} };
  const dialog = { dataset: {}, open: false, setAttribute() {}, removeAttribute() {} };
  const reader = Object.assign(Object.create(Reader.prototype), { card: null, dialog, home: { parent: { insertBefore() {} } } });
  return { reader, card, props, preview };
}
test('838 docking holds the normal source height and transfers its scroll; undocking restores the scroll owner', () => {
  const f = placement(); f.reader.placeReply(f.card);
  assert.equal(f.props.get('--reply-message-height'), '240px');
  assert.equal(f.props.get('--reply-card-height'), '302px');
  assert.equal(f.preview.scrollTop, 100); assert.equal(f.card.scrollTop, 0);
  f.preview.scrollTop = 180; f.reader.placeReply(null);
  assert.equal(f.card.scrollTop, 180); assert.equal(f.preview.scrollTop, 0); assert.equal(f.props.size, 0);
});
test('838 docking preserves an explicitly expanded source', () => {
  const f = placement(true); f.reader.placeReply(f.card);
  assert.equal(f.props.size, 0); assert.equal(f.card.dataset.full, 'shown');
});
test('907 the actual Reply entry opens that card without expanding its source', async () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8'), calls = [];
  const card = { isConnected: true, getClientRects: () => [{}] }, p = { source: { source_ref: { kind: 'message', id: 'm' } } };
  const reply = new Function('registry', 'stackFeed', 'messageEntries', 'opened', 'marks', 'clearVisitNew', 'cardReplies', 'openedHere', 'releaseTopArrivals',
    // The page's own request counters (module lets in app.mjs) are supplied here, as the other owners are.
    `let cardReplyRequest = 0, opening = 0; ${app.slice(app.indexOf('async function replyInCard('), app.indexOf('// Every page of the person'))}; return replyInCard;`)(
    { isCurrent: value => value === p }, { land() { assert.fail('a visible card stays in its dossier'); } }, new Map([['m', card]]), value => value,
    { capture: id => id, read: id => calls.push(['read', id]) }, () => {}, { open: async (...args) => { calls.push(args); return p; } }, () => {}, () => {});
  assert.equal(await reply('m', card), p); assert.deepEqual(calls, [['m', card], ['read', 'm']]);
});
