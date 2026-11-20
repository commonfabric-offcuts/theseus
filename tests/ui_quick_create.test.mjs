import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookStart, OneLine, OutcomeStart, TopicStart, lineFromButton, firstSentence } from '../web/quick-create.mjs';
import { PurposeLine } from '../web/outcome-purpose.mjs';

// Getting something in is one line (docs/openings.md): the requests each line
// sends, what it keeps when an answer never comes, and what it says when Core
// refuses. Below the browser; tests/form_rules_native.mjs and the openings,
// sources and navigation native checks press the real pages.

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, listeners: {}, hidden: false, parentNode: null, value: '', textContent: '' }); }
  append(...nodes) { for (const node of nodes) { if (node instanceof Element) { node.remove(); node.parentNode = this; } this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) if (node instanceof Element) node.parentNode = null; this.children = []; this.append(...nodes); }
  after(node) { const host = this.parentNode; node.remove(); node.parentNode = host; host.children.splice(host.children.indexOf(this) + 1, 0, node); }
  remove() { if (this.parentNode) { const list = this.parentNode.children; list.splice(list.indexOf(this), 1); this.parentNode = null; } }
  get isConnected() { return Boolean(this.root || this.parentNode?.isConnected); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  get classList() { const names = () => this.className.split(' ').filter(Boolean); return { toggle: (name, on) => { this.className = [...names().filter(n => n !== name), ...(on ? [name] : [])].join(' '); }, contains: name => names().includes(name) }; }
  focus() { globalThis.document.activeElement = this; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  get text() { return this.children.map(node => node instanceof Element ? node.textContent || node.text : String(node)).join(''); }
}
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => Object.assign(new Element(tag), { className: '' }), activeElement: null };
  t.after(() => { globalThis.document = previous; });
}
const key = (name, more = {}) => ({ key: name, isComposing: false, keyCode: 0, repeat: false, shiftKey: false, prevented: 0, stopped: 0,
  preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, ...more });
const settle = () => new Promise(setImmediate);
const bootstrap = { instance_id: 'i1', actor: 'tony', authority: { authority_id: 'a1', authority_epoch: 'e1' } };
// A Core answering each command in turn; answer(envelope) may throw (a lost answer) or return a receipt.
function core(answer) {
  const sent = [];
  return { sent, command: async envelope => { sent.push(structuredClone(envelope)); return answer(envelope, sent.length); },
    views: [], view: async (name, args) => { const reply = core.views.shift(); return typeof reply === 'function' ? reply(name, args) : reply; } };
}
const committed = (envelope, result) => ({ instance_id: envelope.instance_id, operation_id: envelope.operation_id, kind: envelope.kind, recorded: true, status: 'committed', result });
const refused = (envelope, code, message) => ({ instance_id: envelope.instance_id, operation_id: envelope.operation_id, kind: envelope.kind, recorded: true, status: 'rejected', error: { code, message } });

test('New outcome sends workspace.create with its title alone, once, and keeps the exact request when the answer is lost', async () => {
  let lose = true;
  const api = core(envelope => { if (lose) { lose = false; throw Error('offline'); } return committed(envelope, { workspace_id: envelope.args.id }); });
  const outcomes = new OutcomeStart({ api, bootstrap });
  await assert.rejects(outcomes.create('  '), /title/);
  assert.equal(api.sent.length, 0, 'a blank title sends nothing');
  await assert.rejects(outcomes.create('Plan the offsite'), /^Error: Not confirmed: offline\. Press Return to try once more\.$/);
  const id = await outcomes.create('Plan the offsite');
  assert.equal(api.sent.length, 2);
  assert.deepEqual(api.sent[1], api.sent[0], 'the next Return sends the very same request');
  const [request] = api.sent;
  assert.deepEqual([request.kind, request.target, request.expected], ['workspace.create', {}, { workspace_revision: 0, authority: bootstrap.authority }]);
  assert.deepEqual(request.args, { id, title: 'Plan the offsite', purpose: '', team: [] }, 'its title alone: no kind, no coordinator, no team');
  assert.match(id, /^w-[0-9a-f]{32}$/);
  await outcomes.create('Plan the offsite');
  assert.notEqual(api.sent[2].operation_id, request.operation_id, 'once made, the next one is a new outcome');
});

test('New outcome says a refusal in plain words, and a changed title after a lost answer is a new request', async () => {
  const api = core((envelope, n) => { if (n === 1) throw Error('offline'); return n === 2 ? refused(envelope, 'EMPTY_TITLE', 'An outcome needs a title') : committed(envelope, {}); });
  const outcomes = new OutcomeStart({ api, bootstrap });
  await assert.rejects(outcomes.create('First'), /Press Return to try once more/);
  await assert.rejects(outcomes.create('Second'), /^Error: An outcome needs a title$/);
  assert.notEqual(api.sent[1].operation_id, api.sent[0].operation_id, 'a different title is not the lost request');
  assert.equal(api.sent[1].args.title, 'Second');
  await outcomes.create('Second');
  assert.notEqual(api.sent[2].operation_id, api.sent[1].operation_id, 'a refused request is not sent again');
});

test('New topic saves the title with nothing written and publishes it, and a lost publish is sent again without saving again', async () => {
  let lose = true;
  const api = core(envelope => {
    if (envelope.kind === 'opening.save') return committed(envelope, { opening_id: envelope.target.opening_id, opening_revision: 1, state: 'open' });
    if (lose) { lose = false; throw Error('offline'); }
    return committed(envelope, { opening_id: envelope.target.opening_id, opening_revision: 2, topic: { id: 't-made', version: 1 }, message_id: null });
  });
  const starter = new TopicStart({ api, bootstrap, workspace: 'w1' });
  await assert.rejects(starter.start(' \n'), /title/);
  await assert.rejects(starter.start('Which weekend works'), /Press Return to try once more/);
  assert.equal(await starter.start('Which weekend works'), 't-made');
  assert.deepEqual(api.sent.map(e => e.kind), ['opening.save', 'opening.publish', 'opening.publish']);
  const [save, publish, again] = api.sent;
  assert.deepEqual(save.args, { workspace_id: 'w1', topic_id: save.args.topic_id, title: 'Which weekend works', participants: [], body: '', attachments: [] });
  assert.deepEqual([save.expected.opening_revision, publish.expected.opening_revision, publish.args], [0, 1, {}]);
  assert.deepEqual(again, publish, 'the lost publish is sent again whole');
});

test('A topic from a message names the message and its author, and a second start is shown the first and goes ahead on the next Return', async () => {
  const api = core((envelope, n) => {
    if (envelope.kind === 'opening.save') return committed(envelope, { opening_id: envelope.target.opening_id, opening_revision: 1, state: 'open' });
    if (n === 2) return refused(envelope, 'ALREADY_STARTED', 'A topic was already started from this message');
    return committed(envelope, { topic: { id: envelope.args.seen.length ? 't-second' : 't-x', version: 1 }, message_id: 'm-quoted' });
  });
  core.views = [{ instance_id: 'i1', items: [{ id: 't-first', title: 'Release name' }, { id: 't-other', title: 'A very long title', title_truncated: true }] }];
  const starter = new TopicStart({ api, bootstrap, workspace: 'w1', source: 'm-1', participants: ['fable'] });
  const refusal = await starter.start('Release name').catch(error => error);
  assert.equal(refusal.message, '2 topics were already started from this message. Continue there, or press Return to start this one anyway.');
  assert.deepEqual(refusal.links, [{ id: 't-first', href: '?topic=t-first', title: 'Release name' }, { id: 't-other', href: '?topic=t-other', title: 'A very long title…' }]);
  assert.equal(await starter.start('Release name'), 't-second');
  const [save, first, second] = api.sent;
  assert.deepEqual([save.args.source_message_id, save.args.participants, save.args.body], ['m-1', ['fable'], '']);
  assert.deepEqual([first.args, second.args], [{ seen: [] }, { seen: ['t-first', 't-other'] }]);
  assert.notEqual(second.operation_id, first.operation_id, 'the next Return is a new publish');
  assert.equal(api.sent.filter(e => e.kind === 'opening.save').length, 1, 'the title is saved once');
});

test('A publish whose answer was lost and is then found closed opens the topic it started', async () => {
  const api = core((envelope, n) => {
    if (envelope.kind === 'opening.save') return committed(envelope, { opening_revision: 1 });
    if (n === 2) throw Error('offline');
    return refused(envelope, 'OPENING_CLOSED', 'This opening was already published');
  });
  const starter = new TopicStart({ api, bootstrap, workspace: 'w1' });
  core.views = [{ opening: { state: 'published', topic_id: 't-landed' } }];
  await assert.rejects(starter.start('Late'), /Press Return/);
  // The retry is the same request; Core says it is closed (another operation got there), so the line reads where it went.
  assert.equal(await starter.start('Late'), 't-landed');
});

test('The line: Return submits what is typed, once; Escape cancels and goes no further; a refusal is said with its links and the words stay', async t => {
  dom(t);
  const submitted = [], opened = [];
  let answer = () => {};
  const line = new OneLine({ id: 'new-topic-title', label: 'Title', placeholder: 'New topic title', submit: async text => { submitted.push(text); return answer(); }, cancel: () => submitted.push('cancelled'), open: link => opened.push(link.id) });
  const down = line.input.listeners.keydown;
  assert.deepEqual([line.input.id, line.input.attributes['aria-label'], line.input.type], ['new-topic-title', 'Title', 'text']);
  line.input.value = 'Which weekend';
  down(key('Enter', { isComposing: true })); down(key('Enter', { keyCode: 229 }));
  assert.deepEqual(submitted, [], 'Return while composing is part of the typing');
  let release;
  answer = () => new Promise(resolve => { release = resolve; });
  const enter = key('Enter'); down(enter);
  down(key('Enter'));
  assert.deepEqual([submitted, enter.prevented, enter.stopped], [['Which weekend'], 1, 1], 'a second Return while the first is out sends nothing');
  assert.equal(line.input.attributes['aria-busy'], 'true');
  release(); await settle();
  assert.equal(line.input.attributes['aria-busy'], undefined);
  answer = () => { throw Object.assign(Error('A topic was already started from this message.'), { links: [{ id: 't-first', href: '?topic=t-first', title: 'Release name' }] }); };
  down(key('Enter')); await settle();
  assert.deepEqual([line.state.hidden, line.state.text], [false, 'A topic was already started from this message. Release name']);
  assert.equal(line.input.value, 'Which weekend', 'the typed title stays');
  assert.equal(document.activeElement, line.input);
  const link = line.state.children.find(node => node.tag === 'a');
  let prevented = 0;
  link.onclick({ button: 0, preventDefault: () => prevented++ });
  link.onclick({ button: 0, metaKey: true, preventDefault: () => prevented++ });
  assert.deepEqual([opened, prevented], [['t-first'], 1], 'a plain click opens the topic in place; a modified click is the browser\'s');
  line.input.listeners.input();
  assert.equal(line.state.hidden, true, 'typing again clears what was said');
  const escape = key('Escape'); down(escape);
  assert.deepEqual([submitted.at(-1), escape.stopped, escape.prevented], ['cancelled', 1, 1], 'Escape closes the line, not what holds it');
  down(key('Enter', { repeat: true }));
  assert.equal(submitted.filter(text => text !== 'cancelled').length, 2, 'a held Return sends nothing more');
});

test('A rail button opens its line under its heading; a second press or Escape closes it and gives the focus back', t => {
  dom(t);
  const rail = Object.assign(new Element('nav'), { root: true }), heading = new Element('div'), button = new Element('button'), after = new Element('ul');
  heading.append(button); rail.append(heading, after);
  const line = new OneLine({ id: 'new-outcome-title', label: 'Title', submit: async () => {} });
  const close = lineFromButton({ button, after: heading, line });
  assert.equal(button.attributes['aria-expanded'], 'false');
  button.onclick();
  assert.deepEqual([rail.children.indexOf(line.root), button.attributes['aria-expanded'], document.activeElement], [1, 'true', line.input], 'the line sits right under the heading, focused');
  button.onclick();
  assert.deepEqual([line.root.isConnected, button.attributes['aria-expanded'], document.activeElement], [false, 'false', button]);
  button.onclick();
  line.input.listeners.keydown(key('Escape'));
  assert.deepEqual([line.root.isConnected, document.activeElement], [false, button], 'Escape closes it the same way');
  button.onclick(); close();
  assert.equal(line.root.isConnected, false, 'the caller closes it once it has made what was typed');
});

test('A message\'s first sentence is the title offered for a topic from it', () => {
  assert.equal(firstSentence('Should the release go out on Friday? Everyone has checked it.'), 'Should the release go out on Friday?');
  assert.equal(firstSentence('> quoted line\n> goes on. Then more'), 'quoted line goes on.');
  assert.equal(firstSentence('  no stop at all  '), 'no stop at all');
  assert.equal(firstSentence('v1.2 is out. Next'), 'v1.2 is out.', 'a dot inside a word is not the end');
  assert.equal(firstSentence(null), '');
  const long = firstSentence('word '.repeat(60) + 'end.');
  assert.ok(long.length <= 120 && long.endsWith('…') && !long.includes('  '), long);
});

test('The purpose is set in place by whoever organises the outcome: Return saves, Shift+Return is a new line, Escape puts it back', async t => {
  dom(t);
  const host = new Element('div'), description = new Element('p'), saved = [];
  let answer = { status: 'committed' };
  const line = new PurposeLine({ host, description, save: async (words, workspace) => { saved.push([words, workspace.id]); return answer; } });
  const box = host.children.find(node => node.tag === 'textarea'), action = host.children.find(node => node.tag === 'button'), state = host.children.find(node => node.tag === 'p');
  line.paint({ id: 'w1', purpose: '' }, false);
  assert.deepEqual([host.hidden, description.textContent, description.hidden], [true, 'Choose a topic, or start a new one.', false], 'someone who does not organise it reads it only');
  line.edit();
  assert.equal(box.hidden, true, 'and cannot open the box');
  line.paint({ id: 'w1', purpose: '' }, true);
  assert.deepEqual([host.hidden, description.hidden, action.textContent], [false, true, 'Add a purpose']);
  action.onclick();
  assert.deepEqual([box.hidden, action.hidden, document.activeElement], [false, true, box]);
  box.value = 'Ship the forms piece';
  box.onkeydown(key('Enter', { shiftKey: true }));
  assert.equal(saved.length, 0, 'Shift+Return writes a new line');
  box.onkeydown(key('Enter', { isComposing: true }));
  assert.equal(saved.length, 0);
  answer = { status: 'rejected', error: { message: 'No permission for this workspace' } };
  box.onkeydown(key('Enter')); await settle();
  assert.deepEqual([saved, state.textContent, box.hidden, box.value], [[['Ship the forms piece', 'w1']], 'No permission for this workspace', false, 'Ship the forms piece'], 'a refusal is said and the words stay');
  answer = { status: 'committed' };
  box.onkeydown(key('Enter')); await settle();
  assert.deepEqual([box.hidden, description.textContent, description.hidden, action.textContent, state.textContent], [true, 'Ship the forms piece', false, 'Edit purpose', 'Saved']);
  assert.equal(document.activeElement, action, 'the focus goes back to the quiet word');
  action.onclick(); box.value = 'Something else';
  const escape = key('Escape'); box.onkeydown(escape);
  assert.deepEqual([box.hidden, box.value, escape.stopped, saved.length], [true, 'Ship the forms piece', 1, 2], 'Escape puts back what was saved and sends nothing');
  action.onclick(); box.onkeydown(key('Enter'));
  assert.deepEqual([saved.length, box.hidden], [2, true], 'Return with nothing changed only closes it');
  line.paint({ id: 'w1', purpose: 'Changed elsewhere' }, true);
  assert.equal(box.value, 'Changed elsewhere', 'a closed box follows a change made elsewhere');
});

test('a Notebook create retries the same identity and scope after an uncertain answer', async () => {
  const { NotebookStart } = await import('../web/quick-create.mjs');
  const scope = { kind: 'workspace', id: 'w1' };
  let lost = true;
  const api = core(e => { if (lost) { lost = false; throw Error('offline'); } return committed(e, { item_id: e.target.item_id, revision: 1, owner_scope: e.target.owner_scope }); });
  const start = new NotebookStart({ api, bootstrap, scope });
  await assert.rejects(start.create(' '), /title/);
  await assert.rejects(start.create('Working notes'), /Not confirmed/);
  await assert.rejects(start.create('Different notes'), /Working notes/);
  assert.equal(api.sent.length, 1, 'editing a name cannot abandon an uncertain creation');
  const id = await start.create('Working notes');
  assert.deepEqual(api.sent[1], api.sent[0]);
  assert.deepEqual(api.sent[0].target, { item_id: id, owner_scope: scope });
  assert.deepEqual(api.sent[0].args, { title: 'Working notes', body: '', attachments: [], references: [] });
  assert.deepEqual(api.sent[0].expected, { item_revision: 0, authority: bootstrap.authority });
  assert.equal(api.sent[0].kind, 'memory.create');
});

test('a Notebook creation with a mismatched result is still uncertain, not a second page', async () => {
  const { NotebookStart } = await import('../web/quick-create.mjs');
  const api = core(e => committed(e, {item_id:'wrong', revision:1, owner_scope:e.target.owner_scope}));
  const start = new NotebookStart({api, bootstrap, scope:{kind:'topic',id:'t1'}});
  await assert.rejects(start.create('Notes'), /could not be confirmed/);
  await assert.rejects(start.create('Notes'), /could not be confirmed/);
  assert.deepEqual(api.sent[1], api.sent[0]);
});

test('894 NotebookStart creates initial writing through its existing command and retries the exact body', async () => {
  let lose = true;
  const api = core(e => { if (lose) { lose = false; throw Error('offline'); } return committed(e, { item_id: e.target.item_id, revision: 1, owner_scope: e.target.owner_scope }); });
  const start = new NotebookStart({ api, bootstrap, scope: { kind: 'topic', id: 't1' } });
  await assert.rejects(start.create('First', '## First\n\nWords\n'), /Not confirmed/);
  assert.equal(api.sent[0].args.body, '## First\n\nWords\n');
  await assert.rejects(start.create('First', 'Changed words'), /First confirm/);
  assert.equal(api.sent.length, 1);
  await start.create('First', '## First\n\nWords\n');
  assert.deepEqual(api.sent[1], api.sent[0]);
  assert.deepEqual(api.sent[0].args.attachments, []);
  assert.deepEqual(api.sent[0].args.references, []);
});

test('894 NotebookStart cannot replace an uncertain body while keeping the title', async () => {
  const api = core(() => { throw Error('offline'); });
  const start = new NotebookStart({ api, bootstrap, scope: { kind: 'topic', id: 't1' } });
  await assert.rejects(start.create('Page', 'Original'), /Not confirmed/);
  await assert.rejects(start.create('Page', 'Edited'), /First confirm/);
  assert.equal(api.sent.length, 1);
});
