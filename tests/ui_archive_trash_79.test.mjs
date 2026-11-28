import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveTrash } from '../web/archive-trash.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const entry = (id, name = '') => ({ message_id: id, name, excerpt: `Note ${id}\nMore words` });
const page = (items = [], next_cursor = null) => ({ items, next_cursor });

function fold(read) {
  const doc = miniDocument();
  doc.body = doc.createElement('body');
  const calls = [], trash = new ArchiveTrash({ doc, read: cursor => { calls.push(cursor); return read(cursor); },
    afterRead: async () => {} });
  doc.body.append(trash.root);
  const toggle = open => { trash.root.open = open; return trash.root.ontoggle(); };
  return { trash, doc, calls, toggle, titles: () => trash.list.children.map(row => row.querySelector('.archive-trash-title').textContent) };
}

test('79 opens one page, continues an empty page, and retries the same cursor', async () => {
  let fail = true;
  const f = fold(async cursor => {
    if (cursor === null) return page([], 10);
    if (fail) { fail = false; throw Error('temporary refusal'); }
    return page([entry('a', 'Named dossier'), entry('b')]);
  });
  f.trash.show(true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.trash.count.textContent, '');
  await f.toggle(true);
  await f.toggle(true);
  assert.deepEqual(f.calls, [null]);
  assert.equal(f.trash.notice.textContent, '');
  assert.equal(f.trash.more.hidden, false);
  assert.equal(f.trash.count.textContent, '');
  await f.trash.more.onclick();
  assert.equal(f.trash.notice.textContent, 'Could not load Trash.');
  assert.equal(f.trash.more.textContent, 'Retry Trash');
  f.trash.more.focus();
  await f.trash.more.onclick();
  assert.deepEqual(f.calls, [null, 10, 10]);
  assert.deepEqual(f.titles(), ['Named dossier', 'Note b']);
  assert.equal(f.trash.count.textContent, '2');
  assert.equal(f.trash.more.hidden, true);
  assert.equal(f.doc.activeElement, f.trash.summary);
});

test('79 clearing a folded or unavailable panel fences earlier pages', async () => {
  const reads = [];
  const f = fold(() => new Promise(resolve => reads.push(resolve)));
  f.trash.show(true);
  const first = f.toggle(true);
  f.toggle(false);
  const second = f.toggle(true);
  reads[0](page([entry('old')]));
  await first;
  assert.deepEqual(f.titles(), []);
  assert.equal(f.trash.notice.textContent, 'Loading Trash…');
  f.trash.show(false);
  reads[1](page([entry('denied')]));
  await second;
  assert.deepEqual(f.titles(), []);
  assert.equal(f.trash.root.open, false);
  f.trash.show(true);
  const third = f.toggle(true);
  reads[2](page());
  await third;
  assert.deepEqual(f.calls, [null, null, null]);
  assert.equal(f.trash.notice.textContent, 'Trash is empty.');
  assert.equal(f.trash.count.textContent, '0');
});

test('79 terminal removal cannot return in a late page and denial clears prior rows', async () => {
  let resolve;
  const f = fold(async cursor => cursor === null ? page([entry('old')], 10) : new Promise(done => { resolve = done; }));
  f.trash.show(true);
  await f.toggle(true);
  const more = f.trash.load();
  f.trash.learnRemoval('old', { kind: 'unsent' });
  resolve(page([entry('old'), { ...entry('withheld'), withheld: true }, entry('other')], 5));
  await more;
  assert.deepEqual(f.titles(), ['Note other']);
  f.trash.read = async () => { throw Object.assign(Error('denied'), { details: { error: { code: 'FORBIDDEN' } } }); };
  await f.trash.load();
  assert.deepEqual(f.titles(), []);
  assert.equal(f.trash.more.textContent, 'Retry Trash');
});

test('79 retraction keeps its row and act label on the open and reloaded fold', async () => {
  const removal = { kind: 'retracted', by: 'owner', at_ms: 123 };
  let held = null;
  const f = fold(async () => page([{ ...entry('a'), removal: held }, { ...entry('b', 'Dossier name'), removal: held }]));
  f.trash.show(true);
  await f.toggle(true);
  const first = f.trash.rows.get('a');
  held = removal;
  f.trash.learnRemoval('a', removal);
  f.trash.learnRemoval('b', removal);
  const check = (row, strikes) => {
    assert.equal(row.querySelector('.archive-trash-title').classList.contains('retracted-words'), strikes);
    const label = row.querySelector('.message-retracted');
    assert.equal(label.classList.contains('retracted-words'), false);
    assert.match(label.text, /Retracted/);
    assert.equal(label.querySelector('time').dataset.ms, '123');
    assert.equal(f.trash.count.textContent, '2');
  };
  check(first, true);
  check(f.trash.rows.get('b'), false);
  assert.equal(f.trash.rows.get('a'), first);
  f.toggle(false);
  await f.toggle(true);
  check(f.trash.rows.get('a'), true);
  check(f.trash.rows.get('b'), false);
});
