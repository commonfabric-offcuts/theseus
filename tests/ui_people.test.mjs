import test from 'node:test';
import assert from 'node:assert/strict';
import { PeoplePanel, fillNames, readDirectory, readMembers } from '../web/people.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, hidden: true }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
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

test('only a reader who may change the people gets remove buttons and the field, and fixed people keep no button', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add to team', names: 'directory-names', fixed: () => ['tony'] });
  panel.paint(people(['fable', 'tony']), false);
  assert.equal(host.hidden, false);
  assert.deepEqual([chips(host), removable(host), field(host)], [['fable', 'tony'], [], undefined]);
  panel.paint(people(['fable', 'tony']), true);
  assert.deepEqual(removable(host), ['Remove fable']);
  assert.deepEqual([field(host).attributes.list, field(host).attributes['aria-label']], ['directory-names', 'Add to team']);
});

test('Enter or Add sends the typed name once; a refusal or failure is said beside the field', async t => {
  dom(t);
  const host = new Element('div'), sent = [];
  let answer = { status: 'committed' }, release;
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n', add: async id => { sent.push(['add', id]); await new Promise(resolve => { release = resolve; }); return answer; },
    remove: async id => { sent.push(['remove', id]); return answer; } });
  panel.paint(people(['tony']), true);
  const type = text => { field(host).value = text; field(host).oninput(); };
  type('  @fable ');
  let prevented = 0;
  field(host).onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault: () => prevented++ });
  assert.equal(field(host).disabled, true, 'the field waits while the change is sent');
  host.find(node => node.textContent === 'Add').onclick();
  release();
  await new Promise(setImmediate);
  assert.deepEqual([sent, prevented], [[['add', 'fable']], 1]);
  assert.equal(host.find(node => node.className === 'notice'), undefined);
  assert.equal(field(host).value, '', 'an added name leaves the field');

  answer = { status: 'refused', error: { message: 'Unknown recipient' } };
  type('nobody');
  host.find(node => node.textContent === 'Add').onclick();
  release();
  await new Promise(setImmediate);
  assert.deepEqual([field(host).value, host.find(node => node.className === 'notice').textContent], ['nobody', 'Unknown recipient'],
    'a refused name stays in the field to correct');

  type('   ');
  host.find(node => node.textContent === 'Add').onclick();
  field(host).onkeydown({ key: 'Enter', isComposing: true, repeat: false, preventDefault: () => prevented++ });
  assert.equal(sent.length, 2, 'an empty name or a composing Enter sends nothing');

  answer = { status: 'refused', error: { message: 'No permission for this topic' } };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1), ['remove', 'tony']);
  assert.equal(host.find(node => node.className === 'notice').textContent, 'No permission for this topic');

  answer = { status: 'unknown' };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.match(host.find(node => node.className === 'notice').textContent, /not confirmed/);

  panel.remove = async () => { throw Error('offline'); };
  host.find(node => node.tag === 'button' && node.textContent === '×').onclick();
  await new Promise(setImmediate);
  assert.equal(host.find(node => node.className === 'notice').textContent, 'offline');
  assert.equal(field(host).disabled, false);
});
