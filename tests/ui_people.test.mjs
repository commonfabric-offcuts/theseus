import test from 'node:test';
import assert from 'node:assert/strict';
import { PeoplePanel, fillNames, markReach, readDirectory, readMembers, listWords, paintAddress } from '../web/people.mjs';

class Element {
  constructor(tag) {
    Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, hidden: true, parentNode: null }, tag === 'input' ? { value: '' } : {});
    this.classList = { add: name => { this.className = [this.className, name].filter(Boolean).join(' '); } };
  }
  // A node has one parent, as in a browser: putting it somewhere takes it from where it was.
  append(...nodes) { for (const node of nodes) { if (node instanceof Element) { node.detach(); node.parentNode = this; } this.children.push(node); } }
  detach() { if (this.parentNode) { const list = this.parentNode.children; list.splice(list.indexOf(this), 1); this.parentNode = null; } }
  // As in a browser, a focused element taken out of the page loses the focus,
  // even when it is put back.
  replaceChildren(...nodes) {
    if (this.all().includes(globalThis.document.activeElement)) globalThis.document.activeElement = null;
    for (const node of this.children) if (node instanceof Element) node.parentNode = null;
    this.children = []; this.append(...nodes);
  }
  remove() { if (this.contains(globalThis.document.activeElement)) globalThis.document.activeElement = null; this.detach(); }
  insertBefore(node, before) {
    if (before === null) return this.append(node);
    node.detach(); node.parentNode = this; this.children.splice(this.children.indexOf(before), 0, node);
  }
  contains(node) { return node === this || this.all().includes(node); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { globalThis.document.activeElement = this; }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  find(predicate) { return this.all().find(predicate); }
  filter(predicate) { return this.all().filter(predicate); }
}
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
}
// A view answering from a sorted list of ids, a page at a time, as core does.
function pagedApi(view, ids, field, item = id => ({ [field]: id })) {
  const calls = [];
  return { calls, view: async (name, args) => {
    calls.push([name, args]);
    assert.equal(name, view);
    const rest = ids.filter(id => id > (args.cursor ?? '')), page = rest.slice(0, args.limit);
    return { instance_id: 'i1', items: page.map(item), next_cursor: rest.length > args.limit ? page.at(-1) : null };
  } };
}
const ids = n => Array.from({ length: n }, (_, k) => `a${String(k).padStart(4, '0')}`);

test('the directory reads every page up to its bound and says when there were more', async () => {
  const all = pagedApi('actors', ids(250), 'id');
  assert.deepEqual(await readDirectory(all, 'i1').then(({ items, more }) => [items.length, more, items[249].id]), [250, false, 'a0249']);
  assert.deepEqual(all.calls.map(([, args]) => args.cursor ?? null), [null, 'a0099', 'a0199']);
  const bounded = pagedApi('actors', ids(250), 'id');
  assert.deepEqual(await readDirectory(bounded, 'i1', { pages: 2 }).then(({ items, more }) => [items.length, more]), [200, true]);
  assert.equal(bounded.calls.length, 2);
  const exact = pagedApi('actors', ids(200), 'id');
  assert.deepEqual(await readDirectory(exact, 'i1', { pages: 2 }).then(({ items, more }) => [items.length, more]), [200, false]);
});

test('a directory or team answer from another instance, or a refusal, is not used', async () => {
  await assert.rejects(readDirectory({ view: async () => ({ instance_id: 'other', items: [{ id: 'x' }], next_cursor: null }) }, 'i1'), /another instance/);
  await assert.rejects(readMembers({ view: async () => ({ error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } }) }, 'i1', 'w1'), /No permission/);
});

test('a team is read whole, page after page, for its outcome', async () => {
  const api = pagedApi('workspace_members', ids(130), 'actor_id');
  const members = await readMembers(api, 'i1', 'w1');
  assert.equal(members.length, 130);
  assert.deepEqual(api.calls.map(([, args]) => [args.workspace_id, args.cursor ?? null]), [['w1', null], ['w1', 'a0099']]);
});

test('names become options valued by id, labelled by name and kind, each id once', t => {
  dom(t);
  const list = new Element('datalist');
  list.append(new Element('option'));
  fillNames(list, [{ id: 'fable', name: 'Fable', kind: 'agent' }, { id: 'tony', name: 'tony', kind: 'human' }, { id: 'fable', name: 'Again', kind: 'agent' }, { id: 'bare' }]);
  assert.deepEqual(list.children.map(option => [option.value, option.label ?? null]), [['fable', 'Fable · agent'], ['tony', 'human'], ['bare', null]]);
  fillNames(list, []);
  assert.deepEqual(list.children, []);
});

const people = list => list.map(actor_id => ({ actor_id }));
const chips = host => host.filter(node => node.className === 'chip').map(chip => chip.children[0].textContent);
const removable = host => host.filter(node => node.tag === 'button' && node.textContent === '×').map(node => node.attributes['aria-label']);
const field = host => host.find(node => node.tag === 'input');
const opener = host => host.find(node => node.tag === 'button' && node.textContent === '+ Add');
const row = host => host.find(node => node.className === 'people-add');
// The names offered to add, as tapped: each a chip button in the open row.
const offered = host => row(host).filter(node => node.tag === 'button').map(node => node.textContent);
const offer = (host, id) => row(host).find(node => node.tag === 'button' && node.dataset.id === id);
const enter = (host, more = {}) => field(host).onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {}, stopPropagation() {}, ...more });
const sameNodes = (a, b) => a.length === b.length && a.every((node, index) => node === b[index]);

const notice = host => { const node = host.find(node => node.className === 'notice'); return node.hidden ? null : node.textContent; };

test('a renamed agent is offered by its current name and both click and Return add its unchanged identity', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let candidates = [{ id: 'codex-worker', name: 'codex-worker' }];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => candidates,
    add: async id => { sent.push(id); return { status: 'committed' }; } });
  panel.paint([], true); panel.toggle(true);
  const button = panel.choices.children[0]; button.focus();
  candidates = [{ id: 'codex-worker', name: 'codex' }]; panel.paint();
  assert.equal(panel.choices.children[0], button, 'a rename keeps the pressed/focused button');
  assert.equal(document.activeElement, button);
  assert.equal(button.textContent, 'codex');
  await button.onclick();
  field(host).value = ' @CoDeX '; enter(host); await new Promise(setImmediate);
  assert.deepEqual(sent, ['codex-worker', 'codex-worker']);
});

test('duplicate display names are distinguished, Return refuses ambiguity, and an exact ID still resolves', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => [
    { id: 'one', name: 'Codex' }, { id: 'two', name: 'codex' }],
    add: async id => { sent.push(id); return { status: 'committed' }; } });
  panel.paint([], true); panel.toggle(true);
  assert.deepEqual(offered(host), ['Codex (one)', 'codex (two)']);
  field(host).value = 'codex'; enter(host); await new Promise(setImmediate);
  assert.deepEqual(sent, []);
  assert.match(notice(host), /More than one/);
  assert.equal(field(host).value, 'codex');
  field(host).value = 'two'; enter(host); await new Promise(setImmediate);
  assert.deepEqual(sent, ['two']);
});

test('member name changes keep the remove button and still remove the original identity', async t => {
  dom(t);
  const host = new Element('div'), removed = [];
  const panel = new PeoplePanel({ host, label: 'Add', remove: async id => { removed.push(id); return { status: 'committed' }; } });
  panel.paint([{ actor_id: 'codex-worker', name: 'codex-worker' }], true);
  const chip = panel.pills.get('codex-worker').chip, out = chip.out; out.focus();
  panel.paint([{ actor_id: 'codex-worker', name: 'codex' }], true);
  assert.equal(panel.pills.get('codex-worker').chip, chip);
  assert.equal(chip.out, out); assert.equal(document.activeElement, out);
  assert.equal(chip.children[0].textContent, 'codex');
  assert.equal(out.getAttribute('aria-label'), 'Remove codex');
  await out.onclick(); assert.deepEqual(removed, ['codex-worker']);
});

test('an exact actor ID wins over another actor display name', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => [
    { id: 'codex', name: 'Another agent' }, { id: 'codex-worker', name: 'codex' }],
    add: async id => { sent.push(id); return { status: 'committed' }; } });
  panel.paint([], true); panel.toggle(true);
  field(host).value = 'codex'; enter(host); await new Promise(setImmediate);
  await offer(host, 'codex-worker').onclick();
  assert.deepEqual(sent, ['codex', 'codex-worker'], 'typed ID and clicked choice each retain their identity');
});

test('only a reader who may change the people gets remove buttons and "+ Add", and fixed people keep no button', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add to team', fixed: () => ['tony'] });
  panel.paint(people(['fable', 'tony']), false);
  assert.equal(host.hidden, false);
  assert.deepEqual([chips(host), removable(host), opener(host), row(host).hidden], [['fable', 'tony'], [], undefined, true]);
  panel.paint(people(['fable', 'tony']), true);
  assert.deepEqual(removable(host), ['Remove fable']);
  assert.deepEqual([opener(host).title, opener(host).attributes['aria-expanded'], row(host).hidden], ['Add to team', 'false', true],
    'the people who can be added wait behind "+ Add"');
  assert.equal(host.find(node => node.tag === 'button' && node.textContent === 'Add'), undefined, 'there is no Add button');
  opener(host).onclick();
  assert.deepEqual([row(host).hidden, opener(host).attributes['aria-expanded'], document.activeElement], [false, 'true', field(host)]);
  panel.paint(people(['fable', 'tony']), false);
  assert.deepEqual([opener(host), row(host).hidden], [undefined, true], 'a reader who may no longer manage loses the open row too');
});

test('"+ Add" offers the people not yet in as names tapped once, narrowed by the filter, and Escape closes it', async t => {
  dom(t);
  const host = new Element('div'), sent = [], opened = [];
  let candidates = [{ id: 'fable', name: 'Fable' }, { id: 'tony', name: 'tony' }, { id: 'aim-core', name: 'AIM Core' }, null, { name: 'no id' }];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => candidates, opened: () => opened.push(1),
    add: async id => { sent.push(id); return { status: 'committed' }; } });
  panel.paint(people(['tony']), true);
  assert.equal(opened.length, 0, 'nothing is read before the row opens');
  opener(host).onclick();
  assert.equal(opened.length, 1, 'opening reads who can be added');
  assert.deepEqual(offered(host), ['Fable', 'AIM Core'], 'everyone not here, each once');
  assert.deepEqual([offer(host, 'fable').attributes['aria-pressed'], offer(host, 'fable').title], ['false', 'Fable']);
  field(host).value = 'core'; field(host).oninput();
  assert.deepEqual(offered(host), ['AIM Core'], 'the filter matches a name as well as an id');
  field(host).value = ' @AIM-core'; field(host).oninput();
  enter(host);
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['aim-core'], 'Return adds the person whose id was typed, in any case');
  assert.equal(field(host).value, '');
  panel.paint(people(['tony', 'aim-core']), true);
  offer(host, 'fable').focus();
  await offer(host, 'fable').onclick();
  panel.paint(people(['tony', 'aim-core', 'fable']), true);
  assert.deepEqual(sent, ['aim-core', 'fable'], 'one tap adds');
  assert.deepEqual([offered(host), row(host).find(node => node.className === 'muted')?.textContent], [[], 'Everyone is already here.']);
  assert.equal(document.activeElement, field(host), 'with no name left to tap, the filter has the focus');
  field(host).value = 'ally'; field(host).oninput();
  assert.equal(row(host).find(node => node.className === 'muted').textContent, 'No one by that name yet. Return adds it as typed.');
  enter(host);
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['aim-core', 'fable', 'ally'], 'a name nobody offers is added as typed');
  let stopped = 0;
  field(host).onkeydown({ key: 'Escape', isComposing: false, preventDefault() {}, stopPropagation: () => stopped++ });
  assert.deepEqual([row(host).hidden, opener(host).attributes['aria-expanded'], document.activeElement, stopped], [true, 'false', opener(host), 1],
    'Escape closes the row, not the page behind it, and the focus goes back to "+ Add"');
});

test('a repaint that offers the same names keeps their buttons, so a tap across a commit still adds', t => {
  dom(t);
  const host = new Element('div');
  let candidates = [{ id: 'fable' }, { id: 'ally' }];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => candidates, add: async () => ({ status: 'committed' }) });
  panel.paint(people(['tony']), true);
  opener(host).onclick();
  const pressed = offer(host, 'fable');
  panel.paint(people(['tony']), true);
  panel.paint();
  assert.equal(offer(host, 'fable'), pressed, 'the very button a press went down on');
  panel.busy = true; panel.paint();
  assert.deepEqual([offer(host, 'fable'), pressed.disabled], [pressed, true], 'busy only disables it');
  panel.busy = false; panel.paint();
  assert.equal(pressed.disabled, false);
  // A commit that changes who else can be added keeps the names still offered.
  candidates = [{ id: 'fable' }, { id: 'ally' }, { id: 'aim-core' }];
  panel.paint();
  assert.deepEqual([offer(host, 'fable'), offered(host)], [pressed, ['fable', 'ally', 'aim-core']], 'a name still offered keeps its button');
  candidates = [{ id: 'aim-core' }, { id: 'fable', name: 'Fable' }];
  panel.paint();
  assert.deepEqual([offer(host, 'fable'), pressed.title, offered(host)], [pressed, 'Fable', ['aim-core', 'Fable']],
    'in its new place, with its new name, and whoever is no longer offered is gone');
  field(host).value = 'nobody'; field(host).oninput();
  assert.deepEqual([offered(host), row(host).find(node => node.className === 'muted')?.textContent], [[], 'No one by that name yet. Return adds it as typed.']);
  field(host).value = ''; field(host).oninput();
  assert.deepEqual([offered(host), row(host).find(node => node.className === 'muted')], [['aim-core', 'Fable'], undefined], 'the note goes when names are offered again');
});

// What Return adds is what the person typed: the person with that id, or the
// words themselves, never someone else the filter happens to leave.
test('Return in "+ Add" adds the typed id, never the one name the filter leaves, and an empty Return adds nobody', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  const panel = new PeoplePanel({ host, label: 'Add', candidates: () => [{ id: 'jordan', name: 'Jordan' }, { id: 'tony', name: 'Tony' }],
    add: async id => { sent.push(id); return { status: 'committed' }; } });
  panel.paint(people(['tony']), true);
  opener(host).onclick();
  enter(host);
  await new Promise(setImmediate);
  assert.deepEqual(sent, [], 'nobody typed or tapped anyone');
  field(host).value = 'dan'; field(host).oninput();
  assert.deepEqual(offered(host), ['Jordan'], 'Jordan is the one name the filter leaves');
  enter(host);
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['dan'], 'the id typed, not Jordan');
  field(host).value = 'Jordan'; field(host).oninput();
  enter(host);
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['dan', 'jordan'], 'an id typed in another case is that person');
});

test('a repaint keeps the very field the person is typing in, with what they typed', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add' });
  panel.paint(people(['tony']), true);
  opener(host).onclick();
  const typing = field(host);
  typing.value = 'fab';
  panel.paint(people(['tony', 'ally']), true);
  panel.paint(people(['ally']), true);
  assert.equal(field(host), typing, 'the same input element stays in place');
  assert.equal(typing.value, 'fab');
  assert.equal(row(host).hidden, false, 'the row stays open');
  assert.deepEqual(host.children.map(node => node.className), ['chips', 'people-add', 'notice'], 'the host keeps its three parts');
});

test('a repaint while a remove button holds focus keeps focus on that person, or on "+ Add" once they are gone', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add' });
  const out = id => host.find(node => node.attributes['aria-label'] === `Remove ${id}`);
  panel.paint(people(['ally', 'tony']), true);
  out('tony').focus();
  panel.paint(people(['ally', 'fable', 'tony']), true);
  assert.equal(document.activeElement, out('tony'), 'the new button for the same person has focus');
  const add = opener(host);
  panel.paint(people(['ally', 'fable']), true);
  assert.equal(document.activeElement, add, 'with them gone, "+ Add" has it');
  assert.equal(opener(host), add, '"+ Add" is the same button after every repaint');
  assert.deepEqual(host.children[0].children.at(-1), add, 'and it comes after the people');
  panel.paint(people(['ally', 'fable', 'tony']), true);
  assert.equal(document.activeElement, add, 'a repaint that adds people leaves "+ Add" its focus');
  document.activeElement = null;
  panel.paint(people(['ally']), true);
  assert.equal(document.activeElement, null, 'a repaint does not take focus it did not hold');
});

test('a repaint that would show what is there already leaves the chips and their buttons in place, so a press across it still clicks', t => {
  dom(t);
  const host = new Element('div');
  const kept = new Element('button');
  let color = 'agent-1', light = null, fixed = [];
  const panel = new PeoplePanel({ host, label: 'Add', fixed: () => fixed, named: person => person.actor_id === 'fable' ? kept : null,
    pill: person => person.actor_id === 'fable' ? color : '', light: person => person.actor_id === 'fable' ? light : null });
  const chips = () => [...host.children[0].children];
  const out = id => host.find(node => node.attributes['aria-label'] === `Remove ${id}`);
  panel.paint(people(['fable', 'tony']), true);
  const first = chips(), button = out('fable');
  panel.paint(people(['fable', 'tony']), true);
  panel.paint();
  assert.ok(sameNodes(chips(), first), 'the same chips, not new ones');
  assert.equal(out('fable'), button, 'the very button a press went down on');
  // Each thing a chip shows repaints it when it changes.
  // Each thing a chip shows repaints that chip when it changes, and only that one.
  const changes = [() => { color = 'agent-2'; }, () => { light = 'not woken'; }, () => { fixed = ['fable']; }];
  for (const change of changes) {
    const before = chips(), tony = out('tony');
    change(); panel.paint();
    assert.ok(!sameNodes(chips(), before), String(change));
    assert.deepEqual([chips()[1], out('tony')], [before[1], tony], `tony's chip and button stay: ${change}`);
  }
  const still = chips(), tony = out('tony');
  panel.busy = true; panel.paint();
  assert.deepEqual([sameNodes(chips(), still), out('tony'), tony.disabled], [true, tony, true], 'a busy panel disables its buttons in place');
  panel.busy = false; panel.paint();
  assert.equal(tony.disabled, false);
  assert.equal(out('fable'), undefined, 'a fixed person has no button');
  let before = chips(); panel.paint(people(['tony', 'fable']), true);
  assert.ok(!sameNodes(chips(), before), 'a new order repaints');
  before = chips(); panel.paint(people(['tony', 'fable']), false);
  assert.equal(out('tony'), undefined, 'a reader who may not manage sees no button');
  before = chips(); panel.paint(people(['tony']), false);
  assert.ok(!sameNodes(chips(), before), 'someone leaving repaints');
});

test('a repaint while a person\'s name control holds focus gives it to that person\'s name again', t => {
  dom(t);
  const host = new Element('div');
  // A name may be a control: a new one each paint, or the same one put back.
  const kept = new Element('button');
  const named = person => person.actor_id === 'ally' ? kept : Object.assign(new Element('button'), { name: person.actor_id });
  const panel = new PeoplePanel({ host, label: 'Add', named });
  const name = id => panel.namers.get(id);
  panel.paint(people(['ally', 'fable', 'tony']), false);
  const first = name('fable');
  first.focus();
  panel.paint(people(['ally', 'fable', 'tony']), false);
  assert.notEqual(name('fable'), first);
  assert.equal(document.activeElement, name('fable'), 'the new name for the same person has the focus');
  kept.focus();
  panel.paint(people(['ally', 'fable']), false);
  assert.equal(document.activeElement, kept, 'a name put back takes the focus back');
  document.activeElement = null;
  panel.paint(people(['ally', 'fable']), false);
  assert.equal(document.activeElement, null, 'a repaint does not take focus it did not hold');
});

test('Return sends the typed name once; a refusal or failure is said beside the filter', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let answer = { status: 'committed' }, release;
  const panel = new PeoplePanel({ host, label: 'Add', add: async id => { sent.push(['add', id]); await new Promise(resolve => { release = resolve; }); return answer; },
    remove: async id => { sent.push(['remove', id]); return answer; } });
  panel.paint(people(['tony']), true);
  opener(host).onclick();
  const type = text => { field(host).value = text; };
  type('  @fable ');
  let prevented = 0;
  enter(host, { preventDefault: () => prevented++ });
  assert.notEqual(field(host).disabled, true, 'the filter stays usable, so it keeps focus');
  enter(host);
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, prevented], [[['add', 'fable']], 1], 'a second Return while the add is out sends nothing');
  assert.equal(notice(host), null);
  assert.equal(field(host).value, '', 'an added name leaves the filter');

  answer = { status: 'refused', error: { message: 'Unknown recipient' } };
  type('nobody');
  enter(host);
  release();
  await new Promise(setImmediate);
  assert.deepEqual([field(host).value, notice(host)], ['nobody', 'Unknown recipient'], 'a refused name stays in the filter to correct');

  answer = { status: 'committed' };
  type('ally');
  enter(host);
  release();
  await new Promise(setImmediate);
  assert.equal(notice(host), null, 'a later success clears the refusal');

  type('   ');
  enter(host);
  enter(host, { isComposing: true });
  enter(host, { repeat: true });
  assert.equal(sent.length, 3, 'an empty name, a composing Enter or a held Return sends nothing');

  answer = { status: 'refused', error: { message: 'No permission for this topic' } };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1), ['remove', 'tony']);
  assert.equal(notice(host), 'No permission for this topic');

  answer = { status: 'unknown' };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.match(notice(host), /not confirmed/);

  assert.equal(document.activeElement, opener(host), 'after a removal "+ Add" holds focus, not the page');
  panel.remove = async () => { throw Error('offline'); };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.equal(notice(host), 'offline');
});

test('a name typed while an add is out stays in the filter when that add commits', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let release;
  const panel = new PeoplePanel({ host, label: 'Add',
    add: async id => { sent.push(id); await new Promise(resolve => { release = resolve; }); return { status: 'committed' }; } });
  panel.paint(people(['tony']), true);
  opener(host).onclick();
  field(host).value = 'fable';
  enter(host);
  field(host).value = 'ally';
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, field(host).value], [['fable'], 'ally'], 'the next name the person typed is kept');
  enter(host);
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, field(host).value], [['fable', 'ally'], ''], 'a filter still holding what was sent is cleared');
});

test('Address is the topic\'s people as names tapped once, lit while named; anyone else named has a ×; a repaint keeps the focus on the same name', t => {
  dom(t);
  const host = new Element('div'), field = new Element('input'), toggled = [], removed = [];
  let named = ['fable', 'stranger'];
  const paint = (people = ['fable', 'tony', 'fable']) => paintAddress(host, field, { people, named, reach: () => ({ reachable: true }),
    toggle: (name, on) => toggled.push([name, on]), remove: name => removed.push(name) });
  paint();
  const chip = name => host.children.find(node => node.dataset.name === name);
  assert.deepEqual(host.children.map(node => [node.tag, node.dataset.name, node.attributes['aria-pressed'] ?? null]),
    [['button', 'fable', 'true'], ['button', 'tony', 'false'], ['span', 'stranger', null]], 'each of the topic\'s people once, then anyone else named');
  assert.deepEqual([chip('fable').className, chip('tony').textContent], ['choice-chip', 'tony']);
  chip('tony').onclick(); chip('fable').onclick();
  assert.deepEqual(toggled, [['tony', true], ['fable', false]], 'a tap names them, a second takes them off');
  chip('stranger').find(node => node.attributes['aria-label'] === 'Remove stranger').onclick();
  assert.deepEqual(removed, ['stranger']);
  // A repaint keeps the focus where it was: the same name, or the same button on the same chip.
  chip('tony').focus(); named = ['fable', 'tony', 'stranger']; paint();
  assert.deepEqual([document.activeElement, chip('tony').attributes['aria-pressed']], [chip('tony'), 'true']);
  chip('stranger').children.find(node => node.tag === 'button').focus(); paint();
  assert.equal(document.activeElement, chip('stranger').children.find(node => node.tag === 'button'), 'the × on the new chip');
  named = ['fable']; paint();
  assert.equal(document.activeElement, field, 'with that person gone, the field has the focus');
  document.activeElement = null; paint();
  assert.equal(document.activeElement, null, 'a repaint takes no focus it did not hold');
  named = []; paint([]);
  assert.deepEqual(host.children, [], 'nobody in the topic and nobody named: no chips');
});

test('recipient choices and named summaries repaint current names without changing their identity or held controls', t => {
  dom(t);
  const host = new Element('div'), field = new Element('input'), summary = { host: new Element('div'), opener: new Element('button') };
  const toggled = [], removed = []; let current = 'codex';
  const nameOf = id => id === 'codex-worker' ? current : id;
  const paint = people => paintAddress(host, field, { people, named: ['codex-worker'], nameOf, summary,
    reach: () => ({ reachable: true }), toggle: (id, on) => toggled.push([id, on]), remove: id => removed.push(id) });
  paint(['codex-worker']);
  const choice = host.children[0], compact = summary.host.children[0], out = compact.out;
  assert.equal(choice.textContent, 'codex');
  assert.equal(out.getAttribute('aria-label'), 'Remove codex');
  out.focus(); current = 'Codex renamed'; paint(['codex-worker']);
  assert.equal(host.children[0], choice); assert.equal(summary.host.children[0].out, out);
  assert.equal(document.activeElement, out); assert.equal(choice.textContent, current);
  assert.equal(out.getAttribute('aria-label'), `Remove ${current}`);
  choice.onclick(); out.onclick();
  assert.deepEqual(toggled, [['codex-worker', false]]); assert.deepEqual(removed, ['codex-worker']);
  paint([]);
  const outside = host.children[0], outsideOut = outside.out;
  assert.equal(outside.nameNode.textContent, current);
  outsideOut.focus(); current = 'codex'; paint([]);
  assert.equal(host.children[0], outside); assert.equal(document.activeElement, outsideOut);
  assert.equal(outside.nameNode.textContent, current); outsideOut.onclick();
  assert.deepEqual(removed, ['codex-worker', 'codex-worker']);
});

// The Reader and the composer repaint Address after every commit in the topic.
// A press held on a name while that runs must still click, so a name whose
// chip would look the same keeps it.
test('a repaint of Address keeps each person\'s chip, so a tap held across a commit\'s repaint still names them', t => {
  dom(t);
  const host = new Element('div'), field = new Element('input'), toggled = [], removed = [];
  let named = ['stranger'], reach = { reachable: false, add: () => {}, scope: 't1' }, remove = name => removed.push(['first', name]);
  const paint = (people = ['fable', 'tony']) => paintAddress(host, field, { people, named, reach: () => reach,
    toggle: (name, on) => toggled.push([name, on]), remove: name => remove(name) });
  paint();
  const first = [...host.children];
  paint();
  assert.ok(sameNodes(host.children, first), 'same buttons after a repaint that changes nothing');
  named = ['fable', 'stranger']; paint();
  assert.ok(sameNodes(host.children, first), 'naming someone keeps every chip');
  assert.deepEqual(host.children.map(node => node.attributes['aria-pressed'] ?? null), ['true', 'false', null]);
  first[0].onclick(); first[1].onclick();
  assert.deepEqual(toggled, [['fable', false], ['tony', true]], 'a kept chip acts on who is named now');
  paint(['tony', 'fable']);
  assert.ok(sameNodes(host.children, [first[1], first[0], first[2]]), 'a new order moves the same chips');
  remove = name => removed.push(['now', name]);
  paint(['tony', 'fable']);
  first[2].find(node => node.attributes['aria-label'] === 'Remove stranger').onclick();
  assert.deepEqual(removed, [['now', 'stranger']], 'a kept × removes through the newest callback');
  first[2].find(node => node.tag === 'button' && node.textContent.startsWith('Add to topic')).focus();
  reach = { reachable: true }; paint(['tony', 'fable']);
  assert.notEqual(host.children[2], first[2], 'a chip whose reach changed is drawn afresh');
  assert.equal(host.children[2].find(node => node.textContent.startsWith('Add to topic')), undefined, 'with no add offered now');
  assert.equal(document.activeElement, field, 'the focus its offer held goes to the field');
});

test('a recipient outside the topic is marked, with an offer to add them only for a reader who may', async t => {
  dom(t);
  const chip = name => { const node = new Element('span'); node.className = 'chip'; node.classList = { add: c => { node.className += ' ' + c; } }; node.textContent = name; return node; };
  const reachable = chip('fable');
  markReach(reachable, 'fable', () => ({ reachable: true }));
  assert.deepEqual([reachable.className, reachable.children], ['chip', []]);
  const unknown = chip('fable');
  markReach(unknown, 'fable', () => null);
  markReach(unknown, 'fable', undefined);
  assert.deepEqual([unknown.className, unknown.children], ['chip', []], 'an unknown reach is not called a refusal');

  const added = [];
  const finishes = [];
  const offered = chip('stranger');
  markReach(offered, 'stranger', name => ({ reachable: false, add: () => { added.push(name); return new Promise(resolve => { finishes.push(resolve); }); } }));
  assert.equal(offered.className, 'chip unreachable');
  assert.equal(offered.find(node => node.className === 'reach').textContent, ' · not in this topic');
  assert.equal(offered.title, 'A message to stranger is refused until they are in this topic.', 'a manager is not sent to someone else');
  const button = offered.find(node => node.tag === 'button');
  assert.match(button.textContent, /Add to topic \(gets all its messages\)/);
  const clicked = button.onclick();
  assert.equal(button.attributes['aria-disabled'], 'true', 'the button says the add is out');
  assert.notEqual(button.disabled, true, 'it is not disabled, which would drop the focus it holds');
  button.onclick();
  for (const finish of finishes) finish({ status: 'committed' });
  await clicked;
  assert.deepEqual([added, button.attributes['aria-disabled']], [['stranger'], undefined], 'a second press while the add is out sends nothing');
  const said = offered.find(node => node.className === 'reach-notice');
  assert.deepEqual([said.hidden, said.attributes.role], [true, 'status']);

  let reply;
  const refusing = chip('stranger');
  markReach(refusing, 'stranger', () => ({ reachable: false, add: () => reply() }));
  const offer = refusing.find(node => node.tag === 'button'), note = refusing.find(node => node.className === 'reach-notice');
  reply = async () => ({ status: 'refused', error: { message: 'No permission for this topic' } });
  await offer.onclick();
  assert.deepEqual([note.hidden, note.textContent], [false, ' · No permission for this topic'], 'a refusal is said on the chip, not behind the reader');
  reply = async () => { throw Error('offline'); };
  await offer.onclick();
  assert.deepEqual([note.textContent, offer.attributes['aria-disabled']], [' · offline', undefined], 'a failure is caught and said');
  reply = async () => ({ status: 'unknown' });
  await offer.onclick();
  assert.equal(note.textContent, ' · Adding stranger was not confirmed.');
  reply = async () => ({ status: 'committed' });
  await offer.onclick();
  assert.deepEqual([note.hidden, note.textContent], [true, '']);

  const off = chip('ghost');
  markReach(off, 'ghost', () => ({ reachable: false, disabled: true }));
  assert.equal(off.className, 'chip unreachable');
  assert.equal(off.find(node => node.className === 'reach').textContent, ' · switched off');
  assert.equal(off.find(node => node.tag === 'button'), undefined, 'no one is offered an add that would not let them receive');
  assert.match(off.title, /ghost is switched off/);

  const refused = chip('stranger');
  markReach(refused, 'stranger', () => ({ reachable: false, add: null }));
  assert.equal(refused.find(node => node.tag === 'button'), undefined);
  assert.equal(refused.title, "A message to stranger is refused until they are in this topic. Its creator or the outcome's owner can add them.");
});

// With no Refresh button, a change whose answer never came reads who is here
// once, at that moment, and says what it found. The change is never sent again.
test('a change that is not confirmed reads who is here once and says so; a failed read says that too', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let reads = 0, read = async () => { reads++; return people(['tony', 'fable', 'aim-core']); };
  const panel = new PeoplePanel({ host, label: 'Add', read: () => read(), add: async id => { sent.push(id); return { status: 'unknown' }; },
    remove: async id => { sent.push(id); return { status: 'unknown' }; } });
  panel.paint(people(['tony', 'ally']), true);
  host.find(node => node.attributes['aria-label'] === 'Remove ally').onclick(); await new Promise(setImmediate);
  assert.equal(notice(host), 'The change was not confirmed. Here now: tony, fable and aim-core.');
  assert.deepEqual(chips(host), ['tony', 'fable', 'aim-core'], 'the panel shows who it read');
  assert.deepEqual([sent, reads], [['ally'], 1], 'read once; the change is not sent again');
  read = async () => { reads++; throw Error('offline'); };
  host.find(node => node.attributes['aria-label'] === 'Remove fable').onclick(); await new Promise(setImmediate);
  assert.equal(notice(host), 'The change was not confirmed, and reading who is here again failed too.');
  assert.deepEqual(chips(host), ['tony', 'fable', 'aim-core'], 'it keeps what it last showed');
  assert.deepEqual([sent.length, reads], [2, 2]);
  const bare = new PeoplePanel({ host: new Element('div'), label: 'Add', add: async () => ({}), remove: async () => ({ status: 'unknown' }) });
  bare.paint(people(['tony', 'ally']), true);
  bare.host.find(node => node.attributes['aria-label'] === 'Remove ally').onclick(); await new Promise(setImmediate);
  assert.equal(notice(bare.host), 'The change was not confirmed, and reading who is here again failed too.', 'a panel with no read never says Refresh');
  assert.deepEqual([listWords(['tony']), listWords(['tony', 'fable']), listWords([])], ['tony', 'tony and fable', 'nobody']);
});
