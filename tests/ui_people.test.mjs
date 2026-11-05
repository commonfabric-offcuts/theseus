import test from 'node:test';
import assert from 'node:assert/strict';
import { PeoplePanel, fillNames, markReach, readDirectory, readMembers } from '../web/people.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, hidden: true }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
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
const chips = host => host.filter(node => node.className === 'chip').map(chip => chip.textContent);
const removable = host => host.filter(node => node.tag === 'button' && node.textContent === '×').map(node => node.attributes['aria-label']);
const field = host => host.find(node => node.tag === 'input');

const notice = host => { const node = host.find(node => node.className === 'notice'); return node.hidden ? null : node.textContent; };

test('only a reader who may change the people gets remove buttons and the field, and fixed people keep no button', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add to team', names: 'directory-names', fixed: () => ['tony'] });
  panel.paint(people(['fable', 'tony']), false);
  assert.equal(host.hidden, false);
  assert.deepEqual([chips(host), removable(host), host.find(node => node.className === 'people-add').hidden], [['fable', 'tony'], [], true]);
  panel.paint(people(['fable', 'tony']), true);
  assert.deepEqual(removable(host), ['Remove fable']);
  assert.equal(host.find(node => node.className === 'people-add').hidden, false);
  assert.deepEqual([field(host).attributes.list, field(host).attributes['aria-label']], ['directory-names', 'Add to team']);
});

test('a repaint keeps the very field the person is typing in, with what they typed', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n' });
  panel.paint(people(['tony']), true);
  const typing = field(host);
  typing.value = 'fab';
  panel.paint(people(['tony', 'ally']), true);
  panel.paint(people(['ally']), true);
  assert.equal(field(host), typing, 'the same input element stays in place');
  assert.equal(typing.value, 'fab');
  assert.deepEqual(host.children.map(node => node.className), ['chips', 'people-add', 'notice'], 'the host keeps its three parts');
});

test('a repaint while a remove button holds focus keeps focus on that person, or on the field once they are gone', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n' });
  const out = id => host.find(node => node.attributes['aria-label'] === `Remove ${id}`);
  panel.paint(people(['ally', 'tony']), true);
  out('tony').focus();
  panel.paint(people(['ally', 'fable', 'tony']), true);
  assert.equal(document.activeElement, out('tony'), 'the new button for the same person has focus');
  panel.paint(people(['ally', 'fable']), true);
  assert.equal(document.activeElement, field(host), 'with them gone, the field has it');
  document.activeElement = null;
  panel.paint(people(['ally']), true);
  assert.equal(document.activeElement, null, 'a repaint does not take focus it did not hold');
});

test('Enter or Add sends the typed name once; a refusal or failure is said beside the field', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let answer = { status: 'committed' }, release;
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n', add: async id => { sent.push(['add', id]); await new Promise(resolve => { release = resolve; }); return answer; },
    remove: async id => { sent.push(['remove', id]); return answer; } });
  panel.paint(people(['tony']), true);
  const type = text => { field(host).value = text; };
  const add = () => host.find(node => node.textContent === 'Add');
  type('  @fable ');
  let prevented = 0;
  field(host).onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault: () => prevented++ });
  assert.equal(add().disabled, true, 'Add waits while the change is sent');
  assert.notEqual(field(host).disabled, true, 'the field stays usable, so it keeps focus');
  add().onclick();
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, prevented], [[['add', 'fable']], 1]);
  assert.equal(notice(host), null);
  assert.equal(field(host).value, '', 'an added name leaves the field');

  answer = { status: 'refused', error: { message: 'Unknown recipient' } };
  type('nobody');
  add().onclick();
  release();
  await new Promise(setImmediate);
  assert.deepEqual([field(host).value, notice(host)], ['nobody', 'Unknown recipient'], 'a refused name stays in the field to correct');

  answer = { status: 'committed' };
  type('ally');
  add().onclick();
  release();
  await new Promise(setImmediate);
  assert.equal(notice(host), null, 'a later success clears the refusal');

  type('   ');
  add().onclick();
  field(host).onkeydown({ key: 'Enter', isComposing: true, repeat: false, preventDefault: () => prevented++ });
  assert.equal(sent.length, 3, 'an empty name or a composing Enter sends nothing');

  answer = { status: 'refused', error: { message: 'No permission for this topic' } };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1), ['remove', 'tony']);
  assert.equal(notice(host), 'No permission for this topic');

  answer = { status: 'unknown' };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.match(notice(host), /not confirmed/);

  assert.equal(document.activeElement, field(host), 'after a removal the field holds focus, not the page');
  panel.remove = async () => { throw Error('offline'); };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.equal(notice(host), 'offline');
  assert.equal(add().disabled, false);
});

test('a name typed while an add is out stays in the field when that add commits', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let release;
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n',
    add: async id => { sent.push(id); await new Promise(resolve => { release = resolve; }); return { status: 'committed' }; } });
  panel.paint(people(['tony']), true);
  field(host).value = 'fable';
  field(host).onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {} });
  field(host).value = 'ally';
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, field(host).value], [['fable'], 'ally'], 'the next name the person typed is kept');
  field(host).onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {} });
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, field(host).value], [['fable', 'ally'], ''], 'a field still holding what was sent is cleared');
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
  let finish;
  const offered = chip('stranger');
  markReach(offered, 'stranger', name => ({ reachable: false, add: () => { added.push(name); return new Promise(resolve => { finish = resolve; }); } }));
  assert.equal(offered.className, 'chip unreachable');
  assert.equal(offered.find(node => node.className === 'reach').textContent, ' · not in this topic');
  assert.equal(offered.title, 'A message to stranger is refused until they are in this topic.', 'a manager is not sent to someone else');
  const button = offered.find(node => node.tag === 'button');
  assert.match(button.textContent, /Add to topic \(gets all its messages\)/);
  const clicked = button.onclick();
  assert.equal(button.disabled, true);
  finish({ status: 'committed' }); await clicked;
  assert.deepEqual([added, button.disabled], [['stranger'], false]);
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
  assert.deepEqual([note.textContent, offer.disabled], [' · offline', false], 'a failure is caught and said');
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
