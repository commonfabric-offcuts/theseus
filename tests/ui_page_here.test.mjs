// On an outcome's own page a Notebook page opens in place: its words, what
// changed since the person last read it, and Close back to its row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PageHere } from '../web/page-here.mjs';

function fixture({ since = null, refuse = null, words = null } = {}) {
  class Node {
    constructor(tag, text = '') { this.tagName = tag; this.children = []; this.text = text; this.className = ''; this.hidden = false; this.isConnected = true; this.attributes = {}; this.dataset = {};
      this.classList = { add: name => { this.className += ' ' + name; } }; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, fn) { this.handlers = { ...this.handlers, [name]: fn }; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); }
    setAttribute(k, v) { this.attributes[k] = v; }
    focus() { doc.activeElement = this; }
    get textContent() { return this.tagName === '#text' ? this.text : this.children.map(child => child.textContent).join('') || this.text; }
    set textContent(value) { this.text = value; this.children = []; }
  }
  const doc = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), activeElement: null };
  const host = new Node('section'); host.hidden = true;
  const reads = [], gates = [];
  const bodies = { 1: 'Ship on Friday.', 2: 'Ship on Friday.', 3: words ?? 'Ship on Monday.' };
  const read = ref => { reads.push(ref.revision); const gate = gates.shift(); const answer = { source_ref: ref, title: 'Release plan', body: bodies[ref.revision] };
    return gate ? gate.then(() => answer) : Promise.resolve(answer); };
  const recorded = [];
  const here = new PageHere({ host, read, doc, reads: { opened: async source => { recorded.push(source.source_ref.revision); if (refuse) throw Error(refuse); return since; } } });
  const row = new Node('button');
  const text = kind => host.children.filter(child => child.tagName === kind).map(child => child.textContent);
  return { host, here, row, reads, recorded, gates, doc, text, Node };
}
const ref = { kind: 'memory', id: 'p1', revision: 3 };

test('a page opens in place with its words, and is read', async () => {
  const f = fixture();
  await f.here.open(ref, f.row);
  assert.equal(f.host.hidden, false);
  assert.deepEqual(f.text('h2'), ['Release plan']);
  assert.equal(f.host.children.find(child => child.className.split(' ').includes('page-here-body')).textContent, 'Ship on Monday.');
  assert.equal(f.host.children.find(child => child.className === 'muted').textContent, 'Notebook · revision 3');
  assert.deepEqual(f.recorded, [3]); assert.deepEqual(f.reads, [3], 'never read before: nothing older is read');
  assert.equal(f.host.children.some(child => child.className === 'source-changes'), false);
  assert.equal(f.doc.activeElement, f.host.children[0], 'the focus goes to the page');
});

test('a page read at an older revision shows what changed since, above its words', async () => {
  const f = fixture({ since: 1 });
  await f.here.open(ref, f.row);
  assert.deepEqual(f.reads, [3, 1]);
  const at = f.host.children.findIndex(child => child.className === 'source-changes');
  assert.ok(at >= 0 && at < f.host.children.findIndex(child => child.className.split(' ').includes('page-here-body')));
  const changes = f.host.children[at];
  assert.equal(changes.open, true);
  assert.equal(changes.children[0].textContent, 'What changed since you read revision 1');
  assert.match(changes.textContent, /Friday.*Monday/);
});

test('a read Core did not record is said, and Close gives the focus back to the row', async () => {
  const f = fixture({ refuse: 'Reading this page was not recorded. It may still show as changed.' });
  await f.here.open(ref, f.row);
  assert.deepEqual(f.host.children.filter(child => child.className === 'notice' && !child.hidden).map(child => child.textContent),
    ['Reading this page was not recorded. It may still show as changed.']);
  f.host.children.find(child => child.tagName === 'button').onclick();
  assert.equal(f.host.hidden, true); assert.equal(f.doc.activeElement, f.row);
});

test('a page opened while another still opens replaces it; the first draws nothing', async () => {
  const f = fixture({ since: 1 });
  let release; f.gates.push(new Promise(resolve => { release = resolve; }));
  const first = f.here.open({ ...ref, revision: 2 }, f.row), second = f.here.open(ref, f.row);
  await second; release(); await first;
  assert.deepEqual(f.text('h2'), ['Release plan']);
  assert.equal(f.host.children.find(child => child.className.split(' ').includes('page-here-body')).textContent, 'Ship on Monday.');
  assert.deepEqual(f.recorded, [3], 'only the page shown is read');
});

test('a page opened while the one before still reads what changed in it shows only its own changes', async () => {
  const f = fixture({ since: 1 });
  let release; f.gates.push(null, new Promise(resolve => { release = resolve; }));
  const first = f.here.open(ref, f.row);
  await new Promise(setImmediate);
  assert.deepEqual(f.reads, [3, 1], 'the first page waits on its earlier revision');
  await f.here.open({ kind: 'memory', id: 'p2', revision: 2 }, f.row);
  release(); await first;
  const panels = f.host.children.filter(child => child.className === 'source-changes');
  assert.equal(panels.length, 1, 'one panel: the page shown');
  assert.doesNotMatch(panels[0].textContent, /Monday/, 'and none of the first page\'s changes');
  assert.equal(f.host.children.find(child => child.className.split(' ').includes('page-here-body')).textContent, 'Ship on Friday.');
});

test('a Notebook page shows its web addresses as links, and its other words are kept as they are', async () => {
  const f = fixture({ words: 'Plan: https://docs.example/plan, then <ship>.' });
  await f.here.open(ref, f.row);
  const body = f.host.children.find(child => child.className.split(' ').includes('page-here-body'));
  assert.equal(body.textContent, 'Plan: https://docs.example/plan, then <ship>.');
  assert.deepEqual(body.children[0].children.map(child => [child.tagName, child.textContent]),
    [['#text', 'Plan: '], ['a', 'https://docs.example/plan'], ['#text', ', then <ship>.']]);
  const link = body.children[0].children[1];
  assert.deepEqual([link.href, link.target, link.rel], ['https://docs.example/plan', '_blank', 'noopener noreferrer']);
});
