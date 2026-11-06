// Changing an agent's color for yourself: what the page keeps of the choices
// Core holds, the picker that changes one, and the cards that wear it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentColors } from '../web/colors.mjs';
import { openColorPicker } from '../web/color-picker.mjs';
import { AGENT_PALETTE, cardClass } from '../web/author-colors.mjs';

test('a card wears the color the reader chose for its agent; the reader\'s own and people\'s cards never do', () => {
  const chosen = id => ({ fable: 'rose' })[id] ?? 'blue';
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent' }, 'tony', chosen), 'message-card agent-card agent-rose');
  assert.equal(cardClass({ author_id: 'warp', author_kind: 'agent' }, 'tony', chosen), 'message-card agent-card agent-blue');
  assert.equal(cardClass({ author_id: 'tony', author_kind: 'human' }, 'tony', () => 'rose'), 'message-card own-message', 'your black is fixed');
  assert.equal(cardClass({ author_id: 'dan', author_kind: 'human' }, 'tony', () => 'rose'), 'message-card', 'a person is never tinted');
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent' }, 'tony'), 'message-card agent-card agent-green', 'with no choice, the agent\'s own');
});

function store(pages, receipts = []) {
  const calls = [], listeners = {};
  const api = {
    view: async (name, args, options) => { calls.push({ name, args, readClass: options?.readClass }); const next = pages.shift(); if (next instanceof Error) throw next; return next; },
    command: async envelope => { calls.push(envelope); return receipts.shift(); },
  };
  const doc = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const colors = new AgentColors({ api, instanceId: 'i', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }), id: () => 'op-1', doc, win: { addEventListener: (name, fn) => listeners[name] = fn } });
  return { colors, calls, listeners };
}
const page = (items, next = null, palette = AGENT_PALETTE) => ({ instance_id: 'i', palette, items, next_cursor: next });

test('the page reads every page of the reader\'s choices, and again when it is shown or focused', async () => {
  const { colors, calls, listeners } = store([
    page([{ actor_id: 'aim-core', color: 'orchid', color_revision: 1 }], 'aim-core'),
    page([{ actor_id: 'fable', color: null, color_revision: 2 }]),
    page([{ actor_id: 'aim-core', color: null, color_revision: 4 }, { actor_id: 'fable', color: 'peach', color_revision: 3 }]),
  ]);
  let painted = 0; colors.listen(() => painted++);
  await colors.load();
  assert.deepEqual(calls.map(c => c.args), [{ limit: 100 }, { limit: 100, cursor: 'aim-core' }]);
  assert.deepEqual([colors.color('aim-core'), colors.color('fable'), colors.color('warp')], ['orchid', 'green', 'peach'], 'a reset choice is the agent\'s own');
  assert.deepEqual([colors.chosen('aim-core'), colors.chosen('fable')], ['orchid', null]);
  assert.equal(painted, 1);
  listeners.focus(); await colors.loading;
  assert.equal(colors.color('fable'), 'peach', 'a choice made on another device is there when the page is focused');
  assert.equal(colors.color('aim-core'), 'cyan', 'a choice reset elsewhere is the agent\'s own again');
});

test('a read the person waits on is a foreground read; a read on focus is background, unless a foreground one is asked meanwhile', async () => {
  const { colors, calls, listeners } = store([page([]), page([]), page([]), page([])]);
  await colors.load('foreground');
  listeners.focus(); await colors.loading;
  assert.deepEqual(calls.map(c => c.readClass), ['foreground', 'background']);
  listeners.focus(); const asked = colors.load('foreground'); await asked;
  assert.deepEqual(calls.map(c => c.readClass).slice(2), ['background', 'foreground'], 'asked while a background read ran: it reads again, in the foreground');
  assert.throws(() => colors.load('soon'), /foreground or background/);
});

test('a read that cannot be confirmed keeps what the page had, and a color the page cannot draw is refused', async () => {
  for (const bad of [new Error('offline'), { instance_id: 'other', palette: AGENT_PALETTE, items: [], next_cursor: null },
    page([], null, [...AGENT_PALETTE, 'chartreuse']), page([{ actor_id: 'fable', color: 'red', color_revision: 1 }]),
    page([{ actor_id: 'fable', color: 'rose' }])]) {
    const { colors } = store([page([{ actor_id: 'fable', color: 'rose', color_revision: 1 }]), bad]);
    await colors.load();
    await assert.rejects(colors.load());
    assert.equal(colors.color('fable'), 'rose', JSON.stringify(bad?.message ?? bad));
  }
});

test('choosing sends the palette name on the revision last read, and a stale one reads the choices again', async () => {
  const { colors, calls } = store([page([{ actor_id: 'fable', color: 'rose', color_revision: 4 }]), page([{ actor_id: 'fable', color: 'cyan', color_revision: 5 }])],
    [{ status: 'committed', result: { actor_id: 'fable', color: 'olive', color_revision: 5 } },
     { status: 'rejected', error: { code: 'REVISION_CONFLICT', current_versions: { color_revision: 6 } } }]);
  await colors.load(); calls.length = 0;
  const receipt = await colors.choose('fable', 'olive');
  assert.equal(receipt.status, 'committed');
  assert.deepEqual(calls[0], { v: 1, instance_id: 'i', operation_id: 'op-1', kind: 'color.set', target: { actor_id: 'fable' },
    expected: { authority: { authority_id: 'a', authority_epoch: 'e' }, color_revision: 4 }, args: { color: 'olive' } });
  assert.equal(colors.color('fable'), 'olive');
  await colors.choose('fable', null);
  assert.deepEqual(calls[1].expected.color_revision, 5);
  assert.equal(calls[1].args.color, null, 'the agent\'s own is chosen with null');
  assert.equal(colors.color('fable'), 'cyan', 'refused as stale: the page shows what was chosen elsewhere');
  assert.equal(calls.at(-1).readClass, 'foreground', 'read while the person waits on the picker');
});

test('a choice whose answer was lost is sent again as the same request, so it is not called a change made elsewhere', async () => {
  // Core recorded the first press; its answer never arrived. Core answers the
  // same operation with its recorded receipt, and a new one as stale.
  const recorded = new Map(), sent = [];
  let serial = 0, lose = true;
  const api = {
    view: async () => page([{ actor_id: 'fable', color: 'rose', color_revision: 4 }]),
    command: async envelope => {
      sent.push(envelope.operation_id);
      if (recorded.has(envelope.operation_id)) return recorded.get(envelope.operation_id);
      if (recorded.size) return { status: 'rejected', recorded: true, operation_id: envelope.operation_id, error: { code: 'REVISION_CONFLICT', message: 'This color changed since it was read; nothing was changed' } };
      const receipt = { status: 'committed', recorded: true, operation_id: envelope.operation_id, result: { actor_id: 'fable', color: 'olive', color_revision: 5 } };
      recorded.set(envelope.operation_id, receipt);
      if (lose) { lose = false; throw Error('connection lost'); }
      return receipt;
    },
  };
  const colors = new AgentColors({ api, instanceId: 'i', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }), id: () => 'op-' + ++serial, doc: null, win: null });
  await colors.load();
  await assert.rejects(colors.choose('fable', 'olive'), /connection lost/);
  const again = await colors.choose('fable', 'olive');
  assert.equal(again.status, 'committed', 'the press again is answered with what Core recorded');
  assert.deepEqual(sent, ['op-1', 'op-1'], 'the same operation both times');
  assert.equal(colors.color('fable'), 'olive');
  await colors.choose('fable', 'cyan');
  assert.equal(sent.at(-1), 'op-2', 'a new choice is a new operation');
});

test('after a lost answer, another color is its own request, and a recorded refusal frees the press for a new one', async () => {
  const sent = [];
  let serial = 0, answers = [], epoch = 'e', last = null;
  const api = {
    view: async () => page([{ actor_id: 'fable', color: 'rose', color_revision: 4 }]),
    command: async envelope => { last = envelope; sent.push([envelope.operation_id, envelope.args.color]); const next = answers.shift(); if (next instanceof Error) throw next; return { ...next, operation_id: envelope.operation_id }; },
  };
  const colors = new AgentColors({ api, instanceId: 'i', authority: () => ({ authority_id: 'a', authority_epoch: epoch }), id: () => 'op-' + ++serial, doc: null, win: null });
  await colors.load();
  answers = [Error('connection lost'), { status: 'rejected', recorded: true, error: { code: 'INVALID_ARGS', message: 'Not a color' } }, { status: 'rejected', recorded: true, error: { code: 'INVALID_ARGS', message: 'Not a color' } }];
  await assert.rejects(colors.choose('fable', 'olive'));
  await colors.choose('fable', 'cyan');
  await colors.choose('fable', 'cyan');
  assert.deepEqual(sent, [['op-1', 'olive'], ['op-2', 'cyan'], ['op-3', 'cyan']],
    'cyan is not olive sent again; once Core recorded an answer, a press again is a new request');
  // A request made under an authority that has since changed could only be refused.
  answers = [Error('connection lost'), { status: 'committed', recorded: true, result: { actor_id: 'fable', color: 'teal', color_revision: 5 } }];
  await assert.rejects(colors.choose('fable', 'teal'));
  epoch = 'e2';
  await colors.choose('fable', 'teal');
  assert.deepEqual(sent.slice(-2), [['op-4', 'teal'], ['op-5', 'teal']], 'under a new authority the press again is a new request');
  assert.equal(last.expected.authority.authority_epoch, 'e2');
});

test('a read answered before a choice, landing after it, does not undo the choice', async () => {
  let answer; const late = new Promise(resolve => answer = resolve);
  const { colors, listeners } = store([page([{ actor_id: 'fable', color: 'rose', color_revision: 1 }]), late],
    [{ status: 'committed', result: { actor_id: 'fable', color: 'olive', color_revision: 2 } },
     { status: 'committed', result: { actor_id: 'warp', color: 'cyan', color_revision: 1 } }]);
  await colors.load();
  listeners.focus(); const reading = colors.loading;
  await colors.choose('fable', 'olive');
  await colors.choose('warp', 'cyan');
  // The read was answered before either choice was made.
  answer(page([{ actor_id: 'fable', color: 'rose', color_revision: 1 }, { actor_id: 'aim-core', color: 'violet', color_revision: 3 }]));
  await reading;
  assert.deepEqual([colors.color('fable'), colors.chosen('fable')], ['olive', 'olive'], 'the older revision does not replace the newer');
  assert.equal(colors.color('warp'), 'cyan', 'a first choice the read had not seen is kept: Core never forgets a choice, it holds null for the agent\'s own');
  assert.equal(colors.color('aim-core'), 'violet', 'what the read did bring is taken');
});

test('a read whose next page does not move past the last is refused, and asks for no more', async () => {
  for (const [first, next] of [['fable', 'fable'], ['fable', 'aim-core'], ['', null]]) {
    const pages = [page([{ actor_id: 'fable', color: 'rose', color_revision: 1 }]),
      page([], first), page([], next), page([{ actor_id: 'fable', color: 'olive', color_revision: 2 }])];
    const { colors, calls } = store(pages);
    await colors.load(); calls.length = 0;
    if (first === '') { await assert.rejects(colors.load(), /could not be confirmed/); assert.equal(calls.length, 1); continue; }
    await assert.rejects(colors.load(), /could not be confirmed/, `${first} then ${next}`);
    assert.equal(calls.length, 2, 'it stopped at the page that did not move on');
    assert.equal(colors.color('fable'), 'rose', 'and keeps what it had');
  }
});

// Just enough of a page for the picker.
class El {
  constructor(doc, tag) { Object.assign(this, { doc, tag, children: [], parent: null, attributes: {}, handlers: {}, style: {}, hidden: false, textContent: '', className: '' }); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  setAttribute(k, v) { this.attributes[k] = String(v); } getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  closest() { return null; }
  focus() { this.doc.activeElement = this; }
  getBoundingClientRect() { return { left: 40, bottom: 100 }; }
  get isConnected() { let at = this; while (at.parent) at = at.parent; return at === this.doc.body; }
  get offsetWidth() { return 200; }
  get offsetHeight() { return 150; }
  all() { return [this, ...this.children.flatMap(c => c.all?.() ?? [])]; }
}
function picker({ chosen = null, receipts = [] } = {}) {
  const doc = { activeElement: null, handlers: {}, createElement: tag => new El(doc, tag),
    addEventListener(name, fn) { this.handlers[name] = fn; }, removeEventListener(name, fn) { if (this.handlers[name] === fn) delete this.handlers[name]; } };
  doc.body = new El(doc, 'body');
  const anchor = new El(doc, 'button'); doc.body.append(anchor);
  const choices = [];
  const choose = async color => { choices.push(color); const next = receipts.shift() ?? { status: 'committed' }; if (next instanceof Error) throw next; return next; };
  const open = () => openColorPicker({ anchor, agent: 'fable', palette: AGENT_PALETTE, chosen, own: 'green', choose, doc, win: { innerWidth: 1000 } });
  const p = open();
  const buttons = () => p.root.all().filter(n => n.tag === 'button');
  const key = (key, extra = {}) => { const event = { key, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; p.root.handlers.keydown(event); return event; };
  return { doc, anchor, p, open, buttons, key, choices };
}

test('the picker is a labelled popover of the palette and the agent\'s own color, with the current one pressed and focused', () => {
  const { doc, p, buttons, anchor } = picker({ chosen: 'rose' });
  assert.equal(p.root.getAttribute('role'), 'dialog');
  assert.equal(p.root.getAttribute('aria-label'), 'Color for fable');
  assert.equal(p.root.parent, doc.body);
  assert.deepEqual(buttons().map(b => b.getAttribute('aria-label') ?? b.textContent), [...AGENT_PALETTE, 'Default (green)']);
  assert.deepEqual(buttons().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.title), ['rose']);
  assert.equal(doc.activeElement.title, 'rose', 'the current color has the focus');
  assert.deepEqual(p.root.style, { position: 'fixed', top: '104px', left: '40px' }, 'just below its name');
  // A name near the bottom of the window: the picker opens above it.
  const low = new El(doc, 'button'); low.getBoundingClientRect = () => ({ left: 900, top: 700, bottom: 720 }); doc.body.append(low);
  const lifted = openColorPicker({ anchor: low, agent: 'warp', palette: AGENT_PALETTE, chosen: null, own: 'peach', choose: async () => ({}), doc, win: { innerWidth: 1000, innerHeight: 760 } });
  assert.deepEqual(lifted.root.style, { position: 'fixed', top: '546px', left: '792px' }, 'above its name, and inside the window');
  assert.notEqual(anchor, doc.activeElement);
});

test('the picker is reached and left by keyboard: arrows and Tab go round it, Escape gives the focus back', () => {
  const { doc, key, buttons, anchor, p } = picker();
  assert.equal(doc.activeElement.textContent, 'Default (green)', 'no choice: the agent\'s own is pressed and has the focus');
  assert.equal(buttons().at(-1).getAttribute('aria-pressed'), 'true');
  assert.ok(key('ArrowRight').prevented); assert.equal(doc.activeElement.title, 'green', 'the arrows go round');
  key('ArrowDown'); assert.equal(doc.activeElement.title, 'blue');
  key('ArrowLeft'); key('ArrowLeft'); assert.equal(doc.activeElement.textContent, 'Default (green)', 'round to the agent\'s own');
  assert.equal(key('Tab').prevented, true, 'Tab from the last goes round to the first');
  assert.equal(doc.activeElement.title, 'green');
  assert.equal(key('Tab').prevented, false, 'Tab inside moves as the browser moves it');
  key('End'); assert.equal(doc.activeElement, buttons().at(-1));
  assert.ok(key('Escape').prevented);
  assert.equal(p.root.parent, null, 'Escape closes it');
  assert.equal(doc.activeElement, anchor, 'and the focus goes back to the name');
});

test('a press outside closes the picker; a press inside does not; the name again closes it', () => {
  const { doc, p, buttons, anchor, open } = picker();
  doc.handlers.pointerdown({ target: buttons()[2] });
  assert.equal(p.root.parent, doc.body, 'inside: still open');
  doc.handlers.pointerdown({ target: doc.body });
  assert.equal(p.root.parent, null, 'outside: closed');
  assert.equal(doc.handlers.pointerdown, undefined, 'and it stops listening');
  assert.notEqual(doc.activeElement, anchor, 'a press elsewhere keeps the focus where it went');
  const again = open();
  doc.handlers.pointerdown({ target: anchor });
  assert.equal(again.root.parent, doc.body, 'pressing the name is not outside');
  assert.equal(open(), null, 'the name again closes it');
  assert.equal(again.root.parent, null);
});

test('closing gives the focus to what the opener named, such as the card a name sits in', () => {
  const doc = { activeElement: null, handlers: {}, createElement: tag => new El(doc, tag),
    addEventListener(name, fn) { this.handlers[name] = fn; }, removeEventListener() {} };
  doc.body = new El(doc, 'body');
  const card = new El(doc, 'button'), name = new El(doc, 'span'); doc.body.append(card); card.append(name);
  const p = openColorPicker({ anchor: name, back: card, agent: 'warp', palette: AGENT_PALETTE, chosen: null, own: 'peach', choose: async () => ({}), doc, win: {} });
  p.root.handlers.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(doc.activeElement, card);
});

test('choosing sends the color and closes; a refusal is said and the picker stays', async () => {
  const { p, buttons, choices, doc, anchor } = picker({ receipts: [{ status: 'rejected', error: { message: 'This color changed since it was read; nothing was changed' } }] });
  await buttons().find(b => b.title === 'violet').onclick();
  assert.deepEqual(choices, ['violet']);
  assert.equal(p.root.parent, doc.body, 'refused: still open');
  const notice = p.root.all().find(n => n.getAttribute('role') === 'status');
  assert.deepEqual([notice.hidden, notice.textContent], [false, 'This color changed since it was read; nothing was changed']);
  await buttons().at(-1).onclick();
  assert.deepEqual(choices, ['violet', null], 'the agent\'s own is chosen with null');
  assert.equal(p.root.parent, null, 'committed: closed');
  assert.equal(doc.activeElement, anchor);
});

test('a lost answer says the choice may be saved and that a press again sends the same request', async () => {
  const { p, buttons, choices, doc } = picker({ receipts: [Error('connection lost')] });
  await buttons().find(b => b.title === 'violet').onclick();
  const notice = p.root.all().find(n => n.getAttribute('role') === 'status');
  assert.deepEqual([notice.hidden, notice.textContent], [false, 'Connection interrupted; whether the color was saved is unknown. Press again to send the same request.']);
  assert.equal(p.root.parent, doc.body, 'still open, for the press again');
  await buttons().find(b => b.title === 'violet').onclick();
  assert.deepEqual(choices, ['violet', 'violet']);
  assert.equal(p.root.parent, null);
});
