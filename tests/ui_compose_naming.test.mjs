// A name typed in the naming field is never dropped and never named by
// anything but the person finishing with naming (docs/reader.md, "Naming
// someone"): Return, the sheet's Done, ←, Escape and the system's back on a
// phone, and the who panel's Done or Escape. A press anywhere else (Send
// among them), + or moving to another message names no one: the name stays
// typed with the writing it was typed for, and Send waits on it, saying why
// for as long as that is true. The browser's own gestures are checked in
// tests/reader_compose_native.mjs; this holds the rule itself, in
// web/compose-bar.mjs, with a stand-in page, and where Escape is heard.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ComposeBar } from '../web/compose-bar.mjs';
import { showLine } from '../web/lines.mjs';

class Node {
  constructor(tag, doc) { Object.assign(this, { tag, doc, children: [], parent: null, listeners: {}, dataset: {}, attributes: {}, hidden: false, value: '', style: {} }); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } return this; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  // An event as the browser sends it: the document's capturing listeners,
  // then each node up from the target, then the document's own.
  dispatch(name, event = {}) {
    const full = { type: name, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
    const doc = this.doc.listeners[name] ?? [];
    for (const [fn] of doc.filter(([, capture]) => capture)) if (!full.stopped) fn(full);
    for (let at = this; at && !full.stopped; at = at.parent) for (const fn of at.listeners[name] ?? []) fn(full);
    for (const [fn] of doc.filter(([, capture]) => !capture)) if (!full.stopped) fn(full);
    return full;
  }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  // The open dialog it is in; no stand-in node is a tile.
  closest(selector) {
    if (selector !== 'dialog[open]') return null;
    for (let at = this; at; at = at.parent) if (at.tag === 'dialog' && at.open) return at;
    return null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  toggleAttribute(name, on) { if (on) this.attributes[name] = ''; else delete this.attributes[name]; return on; }
  focus() { this.doc.activeElement = this; this.dispatch('focusin'); }
  click() { this.dispatch('click'); }
  blur() { this.doc.activeElement = this.doc.body; }
  get ownerDocument() { return this.doc; }
  querySelector(selector) { return selector === '[data-done]' ? this.children.find(child => 'done' in child.dataset) ?? null : null; }
  querySelectorAll() { return []; }
  // Nothing is shown inside a hidden node or a closed dialog.
  getClientRects() { for (let at = this; at; at = at.parent) if (at.hidden || (at.tag === 'dialog' && !at.open)) return []; return [1]; }
  matches() { return false; }
}

function page({ phone = false, add = () => true, host = null } = {}) {
  const doc = { activeElement: null, documentElement: { style: { setProperty() {} } }, listeners: {},
    addEventListener(name, fn, capture = false) { if (!this.listeners[name]?.some(([f, c]) => f === fn && c === capture)) (this.listeners[name] ??= []).push([fn, capture]); },
    removeEventListener(name, fn, capture = false) { this.listeners[name] = (this.listeners[name] ?? []).filter(([f, c]) => f !== fn || c !== capture); },
    // The modal dialogs open on the page, wherever they are.
    querySelectorAll(selector) {
      assert.equal(selector, 'dialog:modal');
      const found = [], walk = node => { if (node.tag === 'dialog' && node.open && node.modal) found.push(node); node.children.forEach(walk); };
      walk(this.body); return found;
    } };
  const make = (tag, props = {}) => Object.assign(new Node(tag, doc), props);
  doc.body = make('body');
  const winListeners = [];
  const win = { matchMedia: () => ({ matches: phone, addEventListener() {} }), addEventListener: (name, fn) => winListeners.push([name, fn]),
    getComputedStyle: () => ({ getPropertyValue: () => 'none' }) };
  const root = make('form'), field = make('textarea');
  const whoDone = make('button', { dataset: { done: '' } }), plusDone = make('button', { dataset: { done: '' } });
  const who = make('div', { id: 'who-panel', hidden: true }), plus = make('div', { id: 'plus-panel', hidden: true });
  const whoChip = make('button'), plusButton = make('button'), opener = make('button'), send = make('button');
  const back = make('button'), done = make('button'), name = make('input');
  const sheet = make('dialog', { open: false }), notice = make('p', { hidden: true, textContent: '' });
  sheet.showModal = () => { sheet.open = true; sheet.modal = true; };
  sheet.close = () => { if (!sheet.open) return; sheet.open = false; sheet.modal = false; sheet.dispatch('close'); };
  sheet.append(back, done, name);
  who.append(whoDone, opener, sheet);
  plus.append(plusDone);
  root.append(notice, whoChip, plusButton, field, send, who, plus);
  // host: the dialog the composer sits in (the Reader, the popped New
  // message sheet), or none, as at the topic page's end.
  const dialog = host && make('dialog', { open: true, modal: true });
  if (dialog) { dialog.append(root); doc.body.append(dialog); } else doc.body.append(root);
  const named = [];
  // The browser tells a size watch when what it watches changes size, as it
  // does when it stops being shown (resized).
  const watches = [];
  globalThis.ResizeObserver = class { constructor(fn) { watches.push(fn); } observe() {} };
  const resized = () => { for (const fn of watches) fn([]); };
  // named: who the writing names, as the surface's names() answers.
  const bar = new ComposeBar({ root, field, panels: { who, plus }, openers: { who: whoChip, plus: plusButton }, win, notice,
    naming: { opener, sheet, field: name, back: [back, done], names: () => named, add: value => { const took = add(value); if (took) named.push(value); return took; } } });
  // A press anywhere is seen by the window first, as the page's capturing listener is.
  const press = target => { for (const [kind, fn] of winListeners) if (kind === 'click') fn({ target }); target.dispatch('click'); };
  return { bar, root, field, who, plus, whoChip, plusButton, whoDone, plusDone, opener, back, done, name, sheet, named, press, doc, send, notice, dialog, make, resized };
}
// The person presses Escape with focus on target.
const escapeAt = (f, target) => { target.focus(); return target.dispatch('keydown', { key: 'Escape', isComposing: false }); };
// What the composer's notice says, as a person reads it.
const said = f => f.notice.hidden ? '' : f.notice.textContent;
const WAITS = name => `${name} is typed in To but not named yet. Return names them; clear it to send without them.`;
// The person types in To, as the browser tells it.
const typeTo = (f, value) => { f.name.value = value; f.name.dispatch('input'); };

// Each way out, as the person makes it.
const PHONE_WAYS = {
  Done: f => f.press(f.done),
  '←': f => f.press(f.back),
  Escape: f => f.sheet.dispatch('keydown', { key: 'Escape', isComposing: false }),
  "the system's back": f => f.sheet.dispatch('cancel'),
};
const PANEL_WAYS = {
  'the who panel\'s Done': f => f.press(f.whoDone),
  Escape: f => f.who.dispatch('keydown', { key: 'Escape', isComposing: false }),
  // Escape pressed with focus outside the panel: the bar hears it on the document.
  'Escape from outside it': f => escapeAt(f, f.send),
};
// Each way the who panel goes for another act: that act is the press's, or the move's.
const ELSEWHERE = {
  'a press on the message': f => f.press(f.field.parent.parent),
  '+': f => f.press(f.plusButton),
  'a press on Send': f => f.press(f.send),
  'the reply folding to its line': f => f.bar.fold(),
};

for (const [way, leave] of Object.entries(PHONE_WAYS)) test(`a phone: a name typed in the naming sheet is named by ${way}, which comes back to + Someone`, () => {
  const f = page({ phone: true });
  f.press(f.whoChip); f.press(f.opener);
  assert.equal(f.sheet.open, true, 'the sheet is open');
  f.name.value = ' @warp ';
  leave(f);
  assert.deepEqual([f.named, f.name.value, f.sheet.open, f.who.hidden], [['warp'], '', false, false], 'warp is named, the field is empty, and the who panel is still there');
});

for (const [way, leave] of Object.entries(PANEL_WAYS)) test(`a laptop: a name typed in the To row's field is named when the who panel closes by ${way}`, () => {
  const f = page();
  f.press(f.whoChip);
  assert.equal(f.who.hidden, false, 'the who panel is open');
  f.name.value = 'aim-ux';
  leave(f);
  assert.deepEqual([f.named, f.name.value, f.who.hidden], [['aim-ux'], '', true]);
});

for (const [way, leave] of Object.entries(ELSEWHERE)) test(`a laptop: ${way} closes the who panel and names no one, and the name stays typed in To`, () => {
  const f = page();
  f.press(f.whoChip);
  f.name.value = 'warp';
  leave(f);
  assert.deepEqual([f.named, f.name.value, f.who.hidden], [[], 'warp', true]);
});

test('a phone: the reply folding while the sheet is open names no one, and the name stays typed in the sheet', () => {
  const f = page({ phone: true });
  f.press(f.whoChip); f.press(f.opener);
  f.name.value = 'fable';
  f.bar.fold();
  assert.deepEqual([f.named, f.name.value, f.sheet.open, f.who.hidden], [[], 'fable', false, true]);
});

// The surface changes the writing (another message's reply) and tells the
// bar (writes); the who panel goes as the reply folds. Either may come first.
for (const order of ['told, then folded', 'folded, then told']) test(`a name typed for one writing is never named in another, and comes back with its own: ${order}`, () => {
  let shown = 'newer';
  const f = page({ add: name => { f.into.push([shown, name]); return true; } });
  f.into = [];
  f.bar.writes('newer');
  f.press(f.whoChip);
  f.name.value = 'warp';
  shown = 'older';
  if (order === 'told, then folded') { f.bar.writes('older'); f.bar.fold(); } else { f.bar.fold(); f.bar.writes('older'); }
  assert.deepEqual([f.into, f.name.value], [[], ''], 'the older reply names no one, and its To is empty');
  f.press(f.whoChip);
  f.name.value = 'aim-ux';
  f.name.dispatch('keydown', { key: 'Enter', isComposing: false, repeat: false });
  assert.deepEqual(f.into, [['older', 'aim-ux']], 'a name typed for the older reply is its own');
  shown = 'newer'; f.bar.writes('newer');
  assert.equal(f.name.value, 'warp', 'back on the newer reply, its To holds warp as it was typed');
  f.press(f.whoDone);
  assert.deepEqual(f.into, [['older', 'aim-ux'], ['newer', 'warp']], 'and naming it names it there');
});

test('Send waits on a name typed in To and not named: it says so and opens To on that name; with To cleared nothing waits', () => {
  const f = page();
  assert.deepEqual([f.bar.holdSend(), said(f)], [false, ''], 'nothing typed, nothing waits, nothing said');
  f.press(f.whoChip);
  f.name.value = '@warp';
  f.press(f.send);
  assert.deepEqual([f.named, f.who.hidden], [[], true], 'the press on Send names no one');
  assert.deepEqual([f.bar.holdSend(), said(f)], [true, WAITS('warp')]);
  assert.deepEqual([f.who.hidden, f.doc.activeElement === f.name, f.name.value, f.named], [false, true, '@warp', []], 'To is open on the name, still not named');
  typeTo(f, ' ');
  assert.deepEqual([f.bar.holdSend(), said(f)], [false, ''], 'cleared, nothing waits, and nothing says it does');
});

// Each way a name Send waited on stops being typed in To and not named. The
// sentence beside the chip goes then, so it never says someone is not named
// beside a chip and Send that reach them.
const NO_LONGER = {
  'Return names them': f => f.name.dispatch('keydown', { key: 'Enter', isComposing: false, repeat: false }),
  'the who panel\'s Done names them': f => f.press(f.whoDone),
  'Escape names them': f => escapeAt(f, f.send),
  'a tap on them names them (the surface repaints To, and tells the bar)': f => { f.named.push('warp'); f.bar.settle(); },
  'To is cleared': f => typeTo(f, ''),
  'another name is typed in its place': f => typeTo(f, 'aim-ux'),
  'another writing is shown': f => f.bar.writes('another'),
};
for (const [way, leave] of Object.entries(NO_LONGER)) test(`what Send says about a name typed in To goes as soon as it is no longer true: ${way}`, () => {
  const f = page();
  f.bar.writes('this');
  f.press(f.whoChip);
  f.name.value = 'warp';
  f.press(f.send);
  assert.deepEqual([f.bar.holdSend(), said(f)], [true, WAITS('warp')], 'Send waits, and says why');
  leave(f);
  assert.equal(said(f), '', `${way}: nothing says warp is not named`);
});

test('what Send says stays while it is true, and a notice said since is the surface\'s own and stays', () => {
  const f = page();
  f.press(f.whoChip);
  f.name.value = 'warp';
  f.bar.holdSend();
  f.press(f.field.parent.parent);
  typeTo(f, 'warp ');
  f.bar.settle();
  assert.deepEqual([f.named, said(f)], [[], WAITS('warp')], 'a press elsewhere and the same name typed again leave it true, and said');
  showLine(f.notice, 'Write a reply before sending.');
  typeTo(f, '');
  assert.equal(said(f), 'Write a reply before sending.', 'clearing To leaves a notice said since');
});

test('Send does not wait on a name typed in To that the writing already names, and says nothing', () => {
  const f = page();
  f.named.push('warp');
  f.press(f.whoChip);
  f.name.value = 'warp';
  f.press(f.send);
  assert.deepEqual([f.bar.holdSend(), said(f), f.who.hidden], [false, '', true]);
});

// Escape while a panel is open puts it away wherever the focus is, and the
// bar hears it itself, so it holds on every surface the composer sits in: the
// topic page's end, where no dialog is open to pass the key on, and the
// Reader and the popped New message sheet, whose own Escape then never comes
// (the browser sends no cancel for a key whose keydown was taken).
for (const host of [false, true]) for (const at of ['+', 'Send', 'the page']) test(`${host ? 'in a dialog (the Reader, the popped sheet)' : 'at the topic page\'s end, in no dialog'}: Escape with focus on ${at} puts the open who panel away and names what was typed in To; with no panel open the bar leaves Escape alone`, () => {
  const f = page({ host });
  f.press(f.whoChip);
  f.name.value = 'warp';
  const target = { '+': f.plusButton, Send: f.send, 'the page': f.doc.body }[at];
  const event = escapeAt(f, target);
  assert.deepEqual([f.named, f.name.value, f.who.hidden, f.doc.activeElement === f.whoChip, event.defaultPrevented], [['warp'], '', true, true, true],
    'warp is named, To is empty, the panel is away, focus is back on the who chip, and the key was the panel\'s');
  assert.deepEqual(f.doc.listeners.keydown ?? [], [], 'with the panel away the bar no longer listens');
  assert.equal(escapeAt(f, target).defaultPrevented, undefined, 'the next Escape is the surface\'s');
});

test('Escape the focus\'s own control already took, or one in another dialog, leaves the open panel as it is', () => {
  const f = page();
  f.press(f.whoChip);
  f.name.value = 'warp';
  assert.equal(f.send.dispatch('keydown', { key: 'Escape', isComposing: false, defaultPrevented: true }).defaultPrevented, true);
  const other = f.make('dialog', { open: true }), inside = f.make('button');
  other.append(inside); f.doc.body.append(other);
  assert.equal(escapeAt(f, inside).defaultPrevented, undefined, 'another dialog\'s Escape is its own');
  assert.equal(f.send.dispatch('keydown', { key: 'Escape', isComposing: true }).defaultPrevented, undefined, 'an IME\'s Escape is its own');
  assert.deepEqual([f.named, f.name.value, f.who.hidden], [[], 'warp', false]);
});

// Shift+Tab past the naming sheet's first control leaves the focus on the
// page, outside the sheet: an Escape then is still the sheet's (its cancel),
// which comes back to + Someone with the who panel open.
test('a phone: with the naming sheet open and the focus fallen to the page, Escape is the sheet\'s and comes back to + Someone', () => {
  const f = page({ phone: true, host: true });
  f.press(f.whoChip); f.press(f.opener);
  f.name.value = 'warp';
  assert.equal(escapeAt(f, f.doc.body).defaultPrevented, undefined, 'the bar leaves it to the sheet');
  assert.deepEqual([f.sheet.open, f.who.hidden], [true, false], 'nothing is put away by the key itself');
  f.sheet.dispatch('cancel');
  assert.deepEqual([f.named, f.sheet.open, f.who.hidden, f.doc.activeElement === f.opener], [['warp'], false, false, true], 'the sheet\'s cancel names warp and comes back to + Someone');
});

test('Escape with focus on the page while a modal dialog the composer is not in is open over it is that dialog\'s', () => {
  const f = page({ host: true });
  f.press(f.whoChip);
  const guide = f.make('dialog', { open: true, modal: true });
  f.doc.body.append(guide);
  assert.equal(escapeAt(f, f.doc.body).defaultPrevented, undefined);
  assert.equal(f.who.hidden, false, 'the who panel stays');
});

test('a close request with no key (a phone\'s back) on the dialog the composer is in puts the open panel away and the dialog stays; with no panel open it is the dialog\'s', () => {
  const f = page({ host: true });
  const heard = [];
  f.dialog.addEventListener('cancel', () => heard.push('dialog'));
  f.press(f.whoChip);
  f.name.value = 'warp';
  assert.equal(f.dialog.dispatch('cancel').defaultPrevented, true, 'the dialog stays');
  assert.deepEqual([heard, f.named, f.who.hidden], [[], ['warp'], true], 'the panel took it, naming warp, and the dialog never heard it');
  assert.equal(f.dialog.dispatch('cancel').defaultPrevented, undefined, 'with no panel open the close request goes on');
  assert.deepEqual(heard, ['dialog']);
});

test('a phone: Send waiting on a typed name opens the sheet on it', () => {
  const f = page({ phone: true });
  f.press(f.whoChip); f.press(f.opener);
  f.name.value = 'warp';
  f.bar.fold();
  assert.ok(f.bar.holdSend());
  assert.deepEqual([f.who.hidden, f.sheet.open, f.doc.activeElement === f.name, f.named], [false, true, true, []]);
});

test('Return names what was typed and keeps naming open; a held Return or an IME\'s Return names nothing', () => {
  const f = page({ phone: true });
  f.press(f.whoChip); f.press(f.opener);
  f.name.value = 'warp';
  assert.equal(f.name.dispatch('keydown', { key: 'Enter', isComposing: true }).defaultPrevented, undefined, 'composing text is the IME\'s');
  f.name.dispatch('keydown', { key: 'Enter', isComposing: false, repeat: true });
  assert.deepEqual(f.named, [], 'a held Return names nothing');
  const event = f.name.dispatch('keydown', { key: 'Enter', isComposing: false, repeat: false });
  assert.deepEqual([f.named, f.name.value, f.sheet.open, event.defaultPrevented], [['warp'], '', true, true]);
});

test('nothing typed names no one, and only the who panel, which holds the field, takes what it holds', () => {
  const f = page();
  f.press(f.whoChip);
  f.name.value = '  ';
  f.press(f.whoDone);
  assert.deepEqual(f.named, [], 'blank names no one');
  f.press(f.plusButton);
  f.name.value = 'warp';
  f.press(f.plusDone);
  assert.deepEqual([f.named, f.name.value], [[], 'warp'], 'closing + leaves the name field alone');
});

test('a name the writing cannot take now stays in the field, not dropped', () => {
  const f = page({ phone: true, add: () => false });
  f.press(f.whoChip); f.press(f.opener);
  f.name.value = 'warp';
  f.press(f.done);
  assert.deepEqual([f.named, f.name.value, f.sheet.open], [[], 'warp', false]);
});

// A surface that closes or hides with a panel of its composer open (the
// Reader closing by ⌘⇧Return, the topic page giving way to another view)
// takes the panel with it: the panel is put away, naming no one, and the
// composer no one sees hears no more keys, so Escape is what is shown now's.
// The browser says the size changed as the composer stops showing; a key
// that comes before it is heard as the same.
const HIDES = {
  'the dialog it is in closes': { host: true, hide: f => { f.dialog.open = false; f.dialog.modal = false; } },
  'it is hidden at the topic page\'s end': { host: false, hide: f => { f.root.hidden = true; } },
};
for (const [way, { host, hide }] of Object.entries(HIDES)) for (const told of [true, false]) test(`when ${way} with the who panel open, the panel goes, naming no one, and Escape after it is not the composer's (${told ? 'the browser says the size changed' : 'the key comes first'})`, () => {
  const f = page({ host });
  f.press(f.whoChip);
  f.name.value = 'warp';
  f.doc.activeElement = f.doc.body;
  hide(f);
  if (told) {
    f.resized();
    assert.deepEqual([f.who.hidden, f.whoChip.getAttribute('aria-expanded'), f.named, f.name.value], [true, 'false', [], 'warp'], 'the panel went with the composer; warp waits in To');
  }
  for (const target of [f.doc.body, f.send]) assert.equal(escapeAt(f, target).defaultPrevented, undefined, 'Escape goes on to what is shown');
  assert.deepEqual([f.who.hidden, f.named, f.name.value], [true, [], 'warp'], 'the panel is away and named no one');
});

test('a composer still shown keeps its panel as its size changes', () => {
  const f = page();
  f.press(f.whoChip);
  f.resized();
  assert.equal(f.who.hidden, false);
});
