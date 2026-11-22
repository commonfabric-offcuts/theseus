import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { WorkspaceLinks } from '../web/workspace-links.mjs';

// Actual registered owners on a small DOM; no native input/layout claim.
function events(node) {
  const listeners = new Map();
  node.addEventListener = (type, fn, capture = false) => listeners.set(type, [...listeners.get(type) ?? [], { fn, capture: capture === true }]);
  node.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item.fn !== fn));
  node.emit = (type, event, capture = false) => {
    for (const item of [...listeners.get(type) ?? []]) if (item.capture === capture) { item.fn(event); if (event.immediate) break; }
  };
  return node;
}
function event(target, extra = {}) {
  return { target, defaultPrevented: false, stopped: false, immediate: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediate = this.stopped = true; }, ...extra };
}
function fixture() {
  const doc = events(miniDocument()), make = doc.createElement;
  doc.createElement = tag => {
    const el = events(make(tag)); el.style = {}; el.ownerDocument = doc;
    el.contains = node => node === el || [...el.descendants()].includes(node);
    el.after = (...nodes) => { const parent = el.parent; for (const node of nodes) node.remove(); parent.children.splice(parent.children.indexOf(el) + 1, 0, ...nodes); for (const node of nodes) node.parent = parent; };
    el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 80, bottom: 60, width: 80, height: 60 });
    return el;
  };
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.body = doc.createElement('body'); doc.body.root = true; doc.getSelection = () => ({ isCollapsed: true });
  withReaderArchive(doc);
  // The borrowed pencil is an inert fixture node; no glyph/paint claim here.
  const get = doc.getElementById, pencil = () => { const svg = doc.createElement('svg'); svg.cloneNode = pencil; return svg; };
  doc.getElementById = id => id === 'new-message' ? { querySelector: () => pencil() } : get(id);
  const win = doc.defaultView = { matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ zIndex: '5' }), navigator: { clipboard: { writeText: async () => {} } } };
  const details = doc.createElement('details'), summary = doc.createElement('summary'), body = doc.createElement('div');
  details.append(summary, body); doc.body.append(details); const part = { details, summary, body };
  const handles = { workspaceId: 'w1' }, rail = { doc, win, handles, sections: new Map([['previews', part]]), host: details,
    message: doc.createElement('p'), changed() {}, close() { this.closed = true; } };
  const links = new WorkspaceLinks(rail), record = { seq: 1, url: 'https://example.test/work', title: 'Old title', revision: 1, removed: false };
  const paint = rows => { body.replaceChildren(links.section([], { items: rows, reader_may_write: true }).node()); return body.querySelector('a[data-outcome-link]'); };
  const anchor = paint([record]);
  const press = async label => { const button = links.openMenu.root.children.find(node => node.textContent === label); assert.ok(button, label); button.onclick(event(button)); await new Promise(resolve => setImmediate(resolve)); };
  return { doc, win, rail, part, links, record, anchor, paint, press, cleanup: () => links.openMenu?.close(false) };
}

test('1021 registered door clears held suppression at a new document gesture or consumed release', t => {
  for (const clear of ['pointerdown', 'pointercancel', 'keydown', 'release']) {
    const f = fixture(); t.after(f.cleanup);
    let tick; const set = globalThis.setTimeout, cancel = globalThis.clearTimeout;
    try {
      globalThis.setTimeout = fn => { tick = fn; return 1; }; globalThis.clearTimeout = () => {};
      const down = event(f.anchor, { pointerType: 'touch', clientX: 2, clientY: 3 });
      f.doc.emit('pointerdown', down, true); f.part.body.emit('pointerdown', down); tick();
      f.doc.emit('pointerup', event(f.anchor), true);
      if (clear === 'release') f.doc.emit('click', event(f.links.openMenu.root.children[0]), true);
      else f.doc.emit(clear, event(f.doc.body, { pointerType: 'mouse', key: 'ArrowDown' }), true);
      const click = event(f.anchor); f.part.body.emit('click', click, true);
      assert.equal(click.defaultPrevented, false, clear);
    } finally { globalThis.setTimeout = set; globalThis.clearTimeout = cancel; }
  }
});

test('1021 capture Escape closes its own sheet while later document observers see keyboard intent', t => {
  const f = fixture(); t.after(f.cleanup); f.links.menu(f.anchor); f.doc.activeElement = f.anchor;
  let observed = false; f.doc.addEventListener('keydown', () => { observed = true; }, true);
  const key = event(f.anchor, { key: 'Escape' }); f.doc.emit('keydown', key, true);
  assert.equal(f.links.openMenu.root.isConnected, false); assert.equal(f.doc.activeElement, f.anchor);
  assert.equal(key.defaultPrevented, true); assert.equal(key.stopped, true); assert.equal(key.immediate, false);
  assert.equal(observed, true); assert.notEqual(f.rail.closed, true);
});

test('1021 Rename over Add retains the current exact draft for reopening', t => {
  const f = fixture(); t.after(f.cleanup); f.links.edit(null, f.links.pencil);
  f.links.url.value = 'https://draft.test/?ids[]=1'; f.links.title.value = 'Unsent current title';
  f.links.edit(f.record, f.anchor); f.links.close(false); f.links.edit(null, f.links.pencil);
  assert.equal(f.links.url.value, 'https://draft.test/?ids[]=1'); assert.equal(f.links.title.value, 'Unsent current title');
});

test('1021 busy Add keeps its response and exact writing when menu Rename is attempted', async t => {
  const f = fixture(); t.after(f.cleanup); let reject;
  f.links.edit(null, f.links.pencil); f.links.url.value = 'https://pending.test/'; f.links.title.value = 'Pending Add';
  f.links.write = () => new Promise((_resolve, failed) => { reject = failed; });
  const serial = f.links.serial, pending = f.links.submit();
  try {
    f.links.edit(f.record, f.anchor);
    assert.equal(f.links.record, null); assert.equal(f.links.serial, serial);
    assert.equal(f.links.url.value, 'https://pending.test/'); assert.equal(f.links.title.value, 'Pending Add');
  } finally { reject(Error('INVALID_ARGUMENT: Add refused')); await pending; }
  assert.equal(f.links.notice.hidden, false); assert.match(f.links.notice.textContent, /Add refused/);
  assert.equal(f.links.busy, false); assert.equal(f.links.title.readOnly, false);
});

for (const choice of ['Open', 'Rename', 'Remove']) test('1021 '+choice+' resolves the repainted current tile at act time', async t => {
  const f = fixture(); t.after(f.cleanup); const clicked = [], writes = [];
  f.anchor.click = () => clicked.push('detached'); f.links.menu(f.anchor);
  const latest = { ...f.record, title: 'Changed by teammate', revision: 4 }, fresh = f.paint([latest]); fresh.click = () => clicked.push('current');
  f.links.write = async (_handles, row, removed) => { writes.push({ row, removed }); };
  await f.press(choice);
  if (choice === 'Open') assert.deepEqual(clicked, ['current']);
  if (choice === 'Rename') { assert.equal(f.links.title.value, latest.title); assert.equal(f.links.record.revision, 4); assert.equal(f.links.opener, fresh); }
  if (choice === 'Remove') { assert.equal(writes[0].row.revision, 4); assert.equal(writes[0].removed, true); }
});

for (const failure of ['REVISION_CONFLICT', 'TOO_MANY_LINKS', 'Copy failure']) test('1021 menu '+failure+' uses the Links-owned status across repaint', async t => {
  const f = fixture(); t.after(f.cleanup); f.links.write = async () => { throw Error(failure); };
  if (failure === 'Copy failure') f.win.navigator.clipboard.writeText = async () => { throw Error('denied'); };
  f.links.menu(f.anchor); await f.press(failure === 'Copy failure' ? 'Copy link' : 'Remove');
  f.paint([{ ...f.record, title: 'Live repaint', revision: 2 }]); f.rail.message.hidden = true;
  assert.equal(f.links.feedback.hidden, false); assert.match(f.links.feedback.textContent, failure === 'Copy failure' ? /could not copy/i : new RegExp(failure));
});

test('1021 a tile removed while its sheet is open cannot perform an old Remove', async t => {
  const f = fixture(); t.after(f.cleanup); let writes = 0; f.links.write = async () => { writes++; };
  f.links.menu(f.anchor); f.paint([]); await f.press('Remove'); assert.equal(writes, 0);
});
