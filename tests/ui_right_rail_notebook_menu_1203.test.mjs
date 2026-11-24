import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsRail } from '../web/things-rail.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';

// Exercise the real rail renderer and registered menu door. Native gestures
// remain the browser check's responsibility.
function fixture() {
  const { list } = renderer799(), doc = Object.assign(new EventTarget(), list.ownerDocument);
  const make = doc.createElement;
  doc.createElement = tag => { const node = make(tag); node.document = doc; return node; };
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.defaultView = { innerWidth: 1400, innerHeight: 900, location: { href: 'https://fixture.invalid/' } };
  doc.defaultView.MutationObserver = class { observe() {} disconnect() {} };
  doc.addEventListener = () => {}; doc.getSelection = () => ({ isCollapsed: true });
  const archiveById = doc.getElementById?.bind(doc), pencil = doc.createElement('button'), drawing = doc.createElement('svg');
  drawing.cloneNode = () => doc.createElement('svg'); pencil.append(drawing);
  doc.getElementById = id => id === 'new-message' ? pencil : archiveById?.(id) ?? null;
  doc.querySelector = () => null;
  const host = doc.createElement('aside'), backdropNode = doc.createElement('div');
  // listen() deliberately calls the native EventTarget method for shell-owned ports.
  const backdrop = Object.assign(new EventTarget(), backdropNode);
  doc.body.append(host, backdrop);
  const rail = new ThingsRail({ host, backdrop, doc, win: doc.defaultView });
  rail.close = () => {};
  const shown = [], reads = [], actions = [], navigated = [];
  const source = { instance_id: 'fixture', source_ref: { kind: 'memory', id: 'page-two', revision: 3 },
    owner_scope: { kind: 'topic', id: 'topic-one' }, reader_may_write: true };
  const handles = { bootstrap: { instance_id: 'fixture', actor: 'reader' }, readable: () => true,
    view: async (name, args, lane) => { reads.push({ name, args, lane }); return source; },
    notebookMenu: (value, row, choose) => {
      assert.equal(value, source); assert.equal(row.dataset.pageId, 'page-two');
      return [{ key: 'copy', label: 'Copy link', glyph: 'link', act: () => choose('copy', 'Copy link') },
        { key: 'rename', label: 'Rename', glyph: 'pencil', act: () => choose('rename', 'Rename') }];
    },
    notebookMenuAction: (value, key, label, row) => actions.push({ value, key, label, row }),
    open: (...args) => navigated.push(args),
  };
  rail.handles = handles;
  const part = rail.sections.get('notebook');
  const rendered = rail.notebookSection([
    { id: 'page-one', title: 'First', body: 'First words' },
    { id: 'page-two', title: 'Second', body: 'Second words' },
  ], { topicId: 'topic-one', notebookNext: null }).node();
  part.body.append(rendered);
  const row = rendered.querySelectorAll('a')[1];
  if (rail.notebookMenus) rail.notebookMenus.show = options => { shown.push(options); return { close() {} }; };
  const event = (target = row, extra = {}) => ({ target, clientX: 31, clientY: 47,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
  const context = async e => {
    assert.equal(typeof part.body.listeners.contextmenu, 'function', 'Notebook previews need a context-menu entry');
    part.body.listeners.contextmenu(e); await new Promise(resolve => setImmediate(resolve));
  };
  return { doc, rail, part, row, source, handles, shown, reads, actions, navigated, event, context };
}

test('1203 preview right-click reuses the targeted page menu without opening the page', async () => {
  const f = fixture(), e = f.event(f.row.querySelector('.things-opening'));
  await f.context(e);
  assert.equal(e.defaultPrevented, true); assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].label, 'This page'); assert.equal(f.shown[0].anchor, f.row);
  assert.deepEqual(f.shown[0].at, { x: 31, y: 47 });
  assert.deepEqual(f.shown[0].items.map(i => [i.key, i.label]), [['copy', 'Copy link'], ['rename', 'Rename']]);
  assert.deepEqual(f.reads, [{ name: 'memory_current', args: { item_id: 'page-two' }, lane: 'foreground' }]);
  assert.deepEqual(f.navigated, []);
  await f.shown[0].items[1].act();
  assert.deepEqual(f.actions, [{ value: f.source, key: 'rename', label: 'Rename', row: f.row }]);
});

test('1203 normal preview click retains its existing page navigation', () => {
  const f = fixture(), e = f.event(f.row, { button: 0 }); f.row.onclick(e);
  assert.equal(e.defaultPrevented, true); assert.equal(f.navigated.length, 1);
  assert.deepEqual(f.navigated[0][0], { kind: 'topic', id: 'topic-one', page: 'page-two' });
  assert.deepEqual(f.reads, []);
});

test('1203 selected text retains its browser menu and reads no page', async () => {
  const f = fixture(); f.doc.getSelection = () => ({ isCollapsed: false }); const e = f.event();
  await f.context(e); assert.notEqual(e.defaultPrevented, true); assert.deepEqual(f.reads, []); assert.deepEqual(f.shown, []);
});

for (const mismatch of ['instance', 'page', 'scope']) test('1203 refuses a mismatched ' + mismatch + ' before offering actions', async () => {
  const f = fixture();
  if (mismatch === 'instance') f.source.instance_id = 'another-instance';
  if (mismatch === 'page') f.source.source_ref.id = 'another-page';
  if (mismatch === 'scope') f.source.owner_scope.id = 'another-topic';
  await f.context(f.event()); assert.deepEqual(f.shown, []);
  assert.match(f.rail.message.textContent, /Notebook page could not be confirmed/);
});

test('1203 a returned page read cannot open a menu after navigation', async () => {
  const f = fixture(); let release;
  f.handles.view = () => new Promise(resolve => { release = resolve; });
  const pending = f.context(f.event());
  f.rail.begin(false, { kind: 'root' }); release?.(f.source); await pending;
  assert.deepEqual(f.shown, []); assert.deepEqual(f.actions, []);
});
