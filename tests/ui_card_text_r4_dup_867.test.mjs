// Retained review source SHA256 5086a99cf71bda0f9920a81401b1f3c6c44fa3600467c79a3f5077fad020323d; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, stripDetails } from './fixtures/card_text_867.mjs';
const ID = n => 'c-' + String(n).repeat(32);
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const dupes = rows => { const ids = rows.map(r => r.id).filter(Boolean); return ids.filter((id, i) => ids.indexOf(id) !== i); };
// Hold the next save in flight until released, as a slow round trip does.
function holdSaves(h) { const send = h.api.command; let release, arrive; const arrived = new Promise(r => arrive = r); h.api.command = async e => { arrive(); await new Promise(r => release = r); return send(e); }; return { arrived, release: () => { h.api.command = send; release(); } }; }

test('DUP1 five identical twins: edit twin 4, save in flight, edit twin 5, save confirms, insert another twin before twin 5', async t => {
  const raw = [1, 2, 3, 4, 5].map(n => card('Same', 'same', details(ID(n), n % 2 ? 'blue' : 'green'))).join('');
  const h = await text867(t, raw); let v = h.p.text.value;
  const nth = (s, n) => { let at = -1; for (let i = 0; i < n; i++) at = v.indexOf(s, at + 1); return at; };
  let x = nth('same\n', 4); h.input(x, x + 4, 'same!');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  v = h.p.text.value; x = nth('same\n', 5); h.input(x, x + 4, 'same!');
  hold.release(); await saving;
  console.log('DUP1 base after confirm ', show(metaOf(h.w.base.content.body)));
  console.log('DUP1 value before insert', show(metaOf(h.w.value.body)));
  v = h.p.text.value; const at = v.lastIndexOf('## Same');
  const rows = h.input(at, at, '## Same\n\nsame\n\n', 'insertFromPaste');
  console.log('DUP1 after insert       ', show(rows), dupes(rows).length ? 'DUPLICATE ' + dupes(rows).map(d => d.slice(2, 3)) : '');
  await h.w.flush();
  const saved = metaOf(h.w.base.content.body); console.log('DUP1 saved              ', show(saved));
  h.p.sync(); for (const id of new Set(dupes(saved))) console.log('DUP1 cardAt duplicate id', id.slice(2, 3), '->', h.p.cardAt({ id }), '(a link to it now selects nothing)');
  assert.deepEqual(dupes(saved), [], 'no two saved cards may carry the same id');
});

test('DUP2 three "### Notes" sections under three parents: type into Notes 2, save in flight, type into Notes 3, confirm, add a fourth "### Notes"', async t => {
  const section = (p, n) => '## ' + p + '\n\n' + p.toLowerCase() + ' words\n\n### Notes\n\n' + hidden(details(ID(n), 'rose')) + '\n\n';
  const raw = section('Alpha', 1) + section('Beta', 2) + section('Gamma', 3);
  const h = await text867(t, raw); let v = h.p.text.value;
  const notesAt = n => { let at = -1; for (let i = 0; i < n; i++) at = v.indexOf('### Notes\n\n', at + 1); return at + '### Notes\n\n'.length; };
  let x = notesAt(2); h.input(x, x, 'call the vendor');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  v = h.p.text.value; x = notesAt(3); h.input(x, x, 'ship it');
  hold.release(); await saving;
  console.log('DUP2 base after confirm ', show(metaOf(h.w.base.content.body)));
  v = h.p.text.value;
  const rows = h.input(v.length, v.length, '## Delta\n\ndelta words\n\n### Notes\n\n', 'insertFromPaste');
  console.log('DUP2 after new section  ', show(rows), dupes(rows).length ? 'DUPLICATE ' + dupes(rows).map(d => d.slice(2, 3)) : '');
  await h.w.flush();
  const saved = metaOf(h.w.base.content.body); console.log('DUP2 saved              ', show(saved));
  h.p.sync(); for (const id of new Set(dupes(saved))) console.log('DUP2 cardAt duplicate id', id.slice(2, 3), '->', h.p.cardAt({ id }));
  assert.deepEqual(dupes(saved), [], 'no two saved cards may carry the same id');
});

test('DUP3 same as DUP2 but the new "### Notes" is typed key by key', async t => {
  const section = (p, n) => '## ' + p + '\n\n' + p.toLowerCase() + ' words\n\n### Notes\n\n' + hidden(details(ID(n), 'rose')) + '\n\n';
  const raw = section('Alpha', 1) + section('Beta', 2) + section('Gamma', 3);
  const h = await text867(t, raw); let v = h.p.text.value;
  const notesAt = n => { let at = -1; for (let i = 0; i < n; i++) at = v.indexOf('### Notes\n\n', at + 1); return at + '### Notes\n\n'.length; };
  let x = notesAt(2); h.input(x, x, 'c');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  v = h.p.text.value; x = notesAt(3); h.input(x, x, 's');
  hold.release(); await saving;
  v = h.p.text.value; let rows; const typed = '## Delta\n\ndelta\n\n### Notes\n\n';
  for (const [i, ch] of [...typed].entries()) rows = h.input(v.length + i, v.length + i, ch, ch === '\n' ? 'insertLineBreak' : 'insertText');
  console.log('DUP3 after typing       ', show(rows), dupes(rows).length ? 'DUPLICATE ' + dupes(rows).map(d => d.slice(2, 3)) : '');
  assert.deepEqual(dupes(rows), []);
});

test('P1 note: a complete valid marker pasted into Text becomes metadata and the next sync removes it from the textarea', async t => {
  const h = await text867(t, card('One', 'one', details(A)));
  const at = h.p.text.value.indexOf('one') + 3;
  h.input(at, at, '\n\n' + hidden(details(B, 'rose')), 'insertFromPaste');
  const typed = h.p.text.value;
  let writes = 0, value = typed; Object.defineProperty(h.p.text, 'value', { configurable: true, get: () => value, set: v => { writes++; value = v; } });
  h.p.doc.activeElement = h.p.text; h.p.sync();
  console.log('P1 textarea rewritten by sync?', writes > 0, '| ids now', show(metaOf(h.w.value.body)), '| textarea still shows the pasted marker?', value.includes('theseus-card'));
});
