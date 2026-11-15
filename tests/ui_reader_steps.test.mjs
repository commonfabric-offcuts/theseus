// Where the Reader's ↑ and ↓ (and a phone's ↑ Previous · ↓ Next), a move and
// a join may step from a message or stack (docs/reply-stacks.md): only to one
// the page shows, or one it has not loaded at all, never to one it has loaded
// and does not show (a dossier below a closed More, agent coordination
// hidden). Every way the Reader comes to be open on a message is enumerated
// here as the page then stands, with the open message hidden where that way
// leaves it hidden, and every message of the topic is tried as the one open.
// The native checks (tests/stack_native.mjs) press the real buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gather, ordered, readerSteps, sideOf, drawnBelow, pageOf, positionOf, placeOf } from '../web/stack-order.mjs';

// The topic, oldest first: u is older than anything the page loaded, n newer;
// a, x, y, c with its reply c1, and k, agent coordination.
const SEQ = ['u', 'a', 'x', 'y', 'k', 'c', 'c1', 'c2', 'n'];
const message = (id, extra = {}) => ({ id, seq: SEQ.indexOf(id) + 1, author_id: 'agent-a', body: id, ...extra });
const aside = id => ({ stack_position: { root_id: id, below: true, through: 1, aside_revision: 1, at: { acts: 1, messages: 1 } } });
// Core's neighbours of a message in the topic: next the one after it, previous the one before.
const coreOf = id => {
  const at = SEQ.indexOf(id), ref = other => other ? { kind: 'message', id: other } : null;
  return { next: ref(SEQ[at + 1]), previous: ref(SEQ[at - 1]) };
};

// The page as a way of opening leaves it: which dossiers are put aside, which
// messages are opened for this view (peeked), whether More is open, whether
// agent coordination is hidden, and which messages are loaded.
function pageAs({ putAside = [], peeked = [], moreOpen = false, coordinationHidden = false, loaded = ['a', 'x', 'y', 'k', 'c', 'c1'] }) {
  const items = loaded.map(id => message(id, { ...(putAside.includes(id) ? aside(id) : {}), ...(id === 'c1' ? { reply_to: 'c' } : {}) }));
  const stacks = ordered(gather(items));
  // A message opened for this view holds the place Core held its dossier at then.
  const below = stack => drawnBelow(stack, item => (peeked.includes(item.id) ? placeOf(positionOf(stack)) : null));
  const view = { below, hidden: stack => (below(stack) && !moreOpen) || (coordinationHidden && stack.id === 'k') };
  // What the page shows and has, read from the view here, not from the code under test.
  const shown = new Set(stacks.filter(stack => !view.hidden(stack)).flatMap(stack => [stack.head, ...stack.replies]).map(item => item.id));
  return { stacks, view, page: pageOf(stacks, view), shown, loaded: new Set(loaded) };
}

// Each way the Reader opens, and the message it opens on, as the page then stands.
const WAYS = [
  { way: 'Read it on a message below a closed More (it opens there, unrevealed)', open: 'x', page: { putAside: ['x', 'y'] } },
  { way: 'a link to a message below More (revealed for this view)', open: 'x', page: { putAside: ['x', 'y'], peeked: ['x'] } },
  { way: 'search landing on a message below More (revealed for this view)', open: 'y', page: { putAside: ['x', 'y'], peeked: ['y'] } },
  { way: 'Starred landing on a message below More (revealed for this view)', open: 'x', page: { putAside: ['x', 'y'], peeked: ['x'] } },
  { way: 'landing from another pane on a message below a closed More, unrevealed', open: 'y', page: { putAside: ['x', 'y'] } },
  { way: 'landing from another pane with More open', open: 'y', page: { putAside: ['x', 'y'], moreOpen: true } },
  { way: 'a second device puts the open message below More', open: 'c', page: { putAside: ['y', 'c'] } },
  { way: 'a second device puts the open message below More, then a new message arrives', open: 'c', page: { putAside: ['y', 'c'], loaded: ['a', 'x', 'y', 'k', 'c', 'c1', 'n'] } },
  { way: 'a link to agent coordination hidden by Show agent coordination, before the page shows it again', open: 'k', page: { putAside: ['y'], coordinationHidden: true } },
  { way: 'the open message only loaded later, beyond what the page had', open: 'u', page: { putAside: ['x'] } },
];

const allowed = (state, step) => step === null || state.shown.has(step.id) || !state.loaded.has(step.id);

test('from every way the Reader opens, with the open message hidden or not, ↑ and ↓ go only to a message shown or not loaded', () => {
  for (const { way, page } of WAYS) {
    const state = pageAs(page);
    for (const id of SEQ) {
      const steps = readerSteps({ kind: 'message', id }, coreOf(id), state.page);
      for (const where of ['next', 'previous']) {
        assert.ok(allowed(state, steps[where]), `${way}: ${where} from ${id} is ${steps[where]?.id}, loaded and not shown`);
      }
    }
  }
});

test('the ways that left the open message hidden step from where it sits to the nearest message shown, else only to one unloaded', () => {
  const steps = (way, id) => { const { page } = WAYS.find(each => each.way.startsWith(way)); return readerSteps({ kind: 'message', id }, coreOf(id), pageAs(page).page); };
  const ref = id => ({ kind: 'message', id });
  // Read it: x sits below a closed More with y, put aside too, over it. Above them, the last stack shown is a;
  // below x nothing shows, and Core's a below it is loaded: nothing.
  assert.deepEqual(steps('Read it', 'x'), { next: ref('a'), previous: null });
  // A second device put c aside: it sits below More, under a; under it c1, its own reply, and y, hidden with it.
  assert.deepEqual(steps('a second device puts the open message below More,', 'c'), { next: ref('a'), previous: null });
  assert.deepEqual(steps('a second device puts the open message below More, then', 'c'), { next: ref('a'), previous: null }, 'n arriving changes neither');
  // A link to k, agent coordination hidden by its chip: it sits between c1 and y, shown, and steps to them.
  assert.deepEqual(steps('a link to agent coordination', 'k'), { next: ref('c1'), previous: ref('x') });
  // n shown on top: below it down the page is k, over c put aside; above it nothing.
  assert.deepEqual(steps('a second device puts the open message below More, then', 'n'), { next: null, previous: ref('k') });
  // Revealed for this view, x is shown where it sits and steps down the page.
  assert.deepEqual(steps('a link', 'x'), { next: ref('k'), previous: ref('a') });
  // Beyond the bottom of what shows, u, older than anything loaded, stands in.
  assert.deepEqual(steps('Read it', 'a').previous, ref('u'));
});

test('a move or a join from every stack steps only among stacks on its side of More that the page shows', () => {
  for (const { way, page } of WAYS) {
    const state = pageAs(page);
    state.stacks.forEach((stack, index) => {
      const side = sideOf(state.stacks, index, state.view);
      for (const other of side.stacks) {
        if (other === stack) continue;
        assert.ok(state.shown.has(other.id), `${way}: ${stack.id} steps among ${other.id}, not shown`);
        assert.equal(state.view.below(other), state.view.below(stack), `${way}: ${stack.id} and ${other.id} on one side of More`);
      }
    });
  }
});

test('the Reader keeps a dossier\'s own order, folded replies included, beside one put aside', () => {
  const items = ['a', 'x', 'y', 'c', 'c1', 'c2'].map(id => message(id, { ...(id === 'y' ? aside(id) : {}), ...(id.startsWith('c') && id !== 'c' ? { reply_to: 'c' } : {}), ...(id === 'c1' ? { acts: { folded: true } } : {}) }));
  const stacks = ordered(gather(items)), view = { below: stack => drawnBelow(stack), hidden: stack => drawnBelow(stack) };
  assert.deepEqual(pageOf(stacks, view).order.map(item => item.id), ['c', 'c1', 'c2', 'x', 'a']);
  assert.deepEqual(readerSteps({ kind: 'message', id: 'x' }, { next: null, previous: null }, pageOf(stacks, view)), { next: { kind: 'message', id: 'c2' }, previous: { kind: 'message', id: 'a' } });
});

test('beyond either end of what the page shows only an unloaded message stands in, never one loaded and shown elsewhere', () => {
  // a, x and c, oldest first, with c placed below a by the reader: down the page x, a, c. In Core, below c is x,
  // loaded and shown at the top of the page, and above x is c, at its bottom: neither stands in at an end.
  const items = [message('a'), message('x'), message('c', { acts: { placed: 0.5 } })];
  const stacks = ordered(gather(items)), page = pageOf(stacks, { below: () => false, hidden: () => false });
  const ref = id => ({ kind: 'message', id });
  assert.deepEqual(page.order.map(item => item.id), ['x', 'a', 'c']);
  assert.deepEqual(readerSteps(ref('c'), { next: null, previous: ref('x') }, page), { next: ref('a'), previous: null }, 'below c, the bottom, nothing: not back up to x');
  assert.deepEqual(readerSteps(ref('x'), { next: ref('c'), previous: ref('a') }, page), { next: null, previous: ref('a') }, 'above x, the top, nothing: not down to c');
  assert.deepEqual(readerSteps(ref('x'), { next: ref('n'), previous: ref('a') }, page).next, ref('n'), 'one the page has not loaded does stand in');
});

test('an unloaded neighbour the page knows is not on show is refused: its dossier held hidden here, or Core placing it below a closed More', () => {
  // The page loaded f0, f1 and r1, a reply to r, which is older than anything loaded. r1 heads its own stack, put
  // below More, so the page holds r's dossier hidden. Below f0, the bottom of what shows, Core's neighbour is r.
  const ref = id => ({ kind: 'message', id });
  const items = [message('a'), message('x'), message('c1', { reply_to: 'r', ...aside('r') })];
  const stacks = ordered(gather(items));
  const view = (moreOpen = false) => ({ below: stack => drawnBelow(stack), hidden: stack => drawnBelow(stack) && !moreOpen, asideShown: moreOpen });
  assert.deepEqual(readerSteps(ref('a'), { next: ref('x'), previous: ref('r') }, pageOf(stacks, view())).previous, null,
    'below a, Core\'s r is the root of the dossier the page holds below a closed More');
  assert.deepEqual(readerSteps(ref('a'), { next: ref('x'), previous: ref('r') }, pageOf(stacks, view(true))).previous, ref('c1'),
    'with More open, below a is c1, r\'s dossier drawn below More');
  // An unloaded message Core places below More, in a dossier the page has none of.
  const loneStacks = ordered(gather([message('a'), message('x')]));
  const below = { kind: 'message', id: 'u', position: { root_id: 'u', below: true } };
  assert.equal(readerSteps(ref('a'), { next: ref('x'), previous: below }, pageOf(loneStacks, view())).previous, null,
    'Core puts u below More, and More is closed');
  assert.deepEqual(readerSteps(ref('a'), { next: ref('x'), previous: below }, pageOf(loneStacks, view(true))).previous, ref('u'),
    'with More open, u stands in, as a plain source ref');
  assert.deepEqual(readerSteps(ref('a'), { next: ref('x'), previous: { ...below, position: { root_id: 'u', below: false } } }, pageOf(loneStacks, view())).previous, ref('u'),
    'one Core does not put below More stands in');
  // Opened on a hidden message (Read it), Core's unloaded neighbours are refused the same way.
  assert.equal(readerSteps(ref('c1'), { next: null, previous: ref('r') }, pageOf(stacks, view())).previous, null,
    'from c1, below a closed More, r is its own hidden dossier\'s root');
});

test('Only new steps along the New items it draws, a put-aside one included, and never onto one it hides', () => {
  // a, b and c are New items; x is settled. b is put below More. Only new draws a, b and c, More's button gone.
  const ref = id => ({ kind: 'message', id });
  const fresh = new Set(['a', 'b', 'c']);
  const items = ['a', 'x', 'b', 'c'].map(id => ({ id, seq: ['a', 'x', 'b', 'c'].indexOf(id) + 1, author_id: 'tony', body: id, ...(id === 'b' ? aside('b') : {}) }));
  const stacks = ordered(gather(items));
  const only = item => fresh.has(item.id);
  const view = { below: stack => drawnBelow(stack), hidden: () => false, only, asideShown: true };
  const page = pageOf(stacks, view);
  assert.deepEqual(page.order.map(item => item.id), ['c', 'a', 'b'], 'the New items as drawn, b after More\'s place');
  assert.deepEqual(readerSteps(ref('a'), { next: ref('x'), previous: null }, page), { next: ref('c'), previous: ref('b') },
    'from a, ↑ is c over the hidden x, ↓ is b put aside and drawn');
  assert.equal(readerSteps(ref('c'), { next: null, previous: ref('x') }, page).previous?.id, 'a', 'never x, which Only new hides');
  // Beyond what the page loaded, ↓ goes on only to a message the page knows as New.
  fresh.add('n0');
  assert.equal(readerSteps(ref('b'), { next: null, previous: ref('old') }, page).previous, null, 'never old, not known as New');
  assert.deepEqual(readerSteps(ref('b'), { next: null, previous: ref('n0') }, page).previous, ref('n0'), 'n0, known as New');
  // Opened by a link on x, which Only new does not draw: from where x sits, over nothing it hides.
  assert.deepEqual(readerSteps(ref('x'), { next: ref('b'), previous: ref('a') }, page), { next: ref('c'), previous: ref('a') },
    'from x, ↑ is c, the New item drawn above where x sits; ↓ is a, the next one drawn below it');
});

test('another topic\'s message steps as Core has it: this page\'s Only new and More are not its view', () => {
  const ref = id => ({ kind: 'message', id });
  const stacks = ordered(gather([message('a'), message('x', aside('x'))]));
  const page = pageOf(stacks, { below: stack => drawnBelow(stack), hidden: () => false, only: () => false, asideShown: true });
  const below = { kind: 'message', id: 'o2', position: { root_id: 'o2', below: true } };
  assert.deepEqual(readerSteps(ref('o1'), { next: below, previous: ref('o0') }, page), { next: null, previous: null }, 'held to this page, Only new refuses both');
  assert.deepEqual(readerSteps(ref('o1'), { next: below, previous: ref('o0') }, null), { next: ref('o2'), previous: ref('o0') });
});

// A dossier a link, search or Starred drew where it sits (here) is drawn there
// while Core holds it at the place it held then, read again as often as the
// page reads it; a later Move below More or Bring back, made on any device, is
// another place, and the dossier is drawn as Core then holds it.
test('a dossier drawn where it sits for a link stays there only while Core holds it at the same place', () => {
  const at = (revision, below = true, acts = 1, messages = 1) => ({ root_id: 'b', below, through: below ? 4 : null, aside_revision: revision, at: { acts, messages } });
  const stackAt = (position, acts = {}) => ordered(gather([message('b', { acts, stack_position: position }), message('b1', { reply_to: 'b', stack_position: position })]))[0];
  const linked = placeOf(at(1)), here = item => (item.id === 'b1' ? linked : null);
  assert.equal(drawnBelow(stackAt(at(1))), true, 'put aside, with nothing drawn where it sits: below More');
  assert.equal(drawnBelow(stackAt(at(1)), here), false, 'the link draws it where it sits');
  assert.equal(drawnBelow(stackAt(at(1, true, 7, 3)), here), false, 'acts on other messages and new messages read since leave it where the link drew it');
  assert.equal(drawnBelow(stackAt(at(2, false, 8)), here), false, 'brought back on another device: above More');
  assert.equal(drawnBelow(stackAt(at(3, true, 9)), here), true, 'moved below More again on another device: below More, the link\'s place gone by');
  // Joined into a dossier the page has not loaded, it heads its stack here and reads that dossier's position (item 470).
  assert.equal(drawnBelow(stackAt({ ...at(1), root_id: 'a' }, { joined: { into: 'a', by: 'agent-a', at_ms: 1 } }), here), true, 'joined into another dossier put aside: below More, as that dossier is');
});
