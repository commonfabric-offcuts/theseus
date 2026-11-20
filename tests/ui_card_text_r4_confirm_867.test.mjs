// Retained review source SHA256 158f09dc1b7066615995230d1356f2cb9a90c948c4da257078f39769b92cb4a2; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detailLines } from '../web/card-details.mjs';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, cardDetails, stripDetails, CardTextProjection, writingPort, documentPort, NotebookPage, deckBody } from './fixtures/card_text_867.mjs';
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.aliases.map(a => a.slice(2, 3)).join('')}/${r.color ?? '-'}`).join('  ');
const typeAt = (h, at, s) => { let rows; for (let i = 0; i < s.length; i++) rows = h.input(at + i, at + i, s[i]); return rows; };
const backspace = (h, end, n) => { let rows; for (let i = 0; i < n; i++) rows = h.input(end - i - 1, end - i, '', 'deleteContentBackward'); return rows; };

// A single page with both views, driven through its real textarea listeners and real Cards handlers.
async function one(t, raw, mode = 'cards') {
  const f = await writingPort(t, raw), doc = documentPort(), make = doc.createElement;
  doc.createElement = tag => { const n = make(tag); n.before = x => n.parent?.insertBefore(x, n); n.after = (...xs) => { const next = n.parent?.children[n.parent.children.indexOf(n) + 1]; for (const x of xs) n.parent?.insertBefore(x, next); }; return n; };
  const p = new NotebookPage({ doc, host: doc.body, item: 'page', mode, bootstrap: {}, viewPreference: { get: () => mode, set() {} }, header: { title: doc.createElement('h1'), description: doc.createElement('p') } });
  Object.assign(p, { writing: f.w, deck: parseDeck(raw), base: { revision: 1, body: raw }, paint() {}, keepNamed() {}, show() {} });
  p.anchor = doc.createElement('button'); doc.body.append(p.anchor);
  p.sync(true);
 const input=(start,end,insert,inputType='insertText')=>{
  p.text.setSelectionRange(start,end);
  const event={inputType,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  p.text.listeners.beforeinput(event);
  if(!event.defaultPrevented){p.text.value=p.text.value.slice(0,start)+insert+p.text.value.slice(end);p.text.setSelectionRange(start+insert.length,start+insert.length);p.text.listeners.input({inputType});}
  return metaOf(f.w.value.body);
 };
  return { ...f, p, input, doc };
}

test('R4-C1 twins: edit twin 2, save confirms, edit twin 1, save, then make both identical again', async t => {
  const h = await text867(t, card('Top', 'top', details(C)) + card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  let v = h.p.text.value, x = v.lastIndexOf('same'); let rows = h.input(x, x + 4, 'two');
  console.log('R4-C1 a', show(rows)); assert.deepEqual(rows.map(r => r.id), [C, A, B]);
  await h.w.flush();
  v = h.p.text.value; x = v.indexOf('same'); rows = h.input(x, x + 4, 'one');
  console.log('R4-C1 b', show(rows)); assert.deepEqual(rows.map(r => r.id), [C, A, B]);
  await h.w.flush();
  v = h.p.text.value; x = v.indexOf('one'); rows = h.input(x, x + 3, 'same');
  v = h.p.text.value; x = v.indexOf('two'); rows = h.input(x, x + 3, 'same');
  console.log('R4-C1 c', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[C, 'blue'], [A, 'blue'], [B, 'rose']]);
  await h.w.flush(); assert.deepEqual(metaOf(h.w.base.content.body).map(r => r.id), [C, A, B]);
});

test('R4-C2 twins: save confirms, then delete the FIRST twin (its own range)', async t => {
  const h = await text867(t, card('Top', 'top', details(C)) + card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  const x = h.p.text.value.indexOf('top'); h.input(x + 3, x + 3, '!'); await h.w.flush(); h.p.sync();
  const v = h.p.text.value, first = v.indexOf('## Same'), second = v.indexOf('## Same', first + 1);
  const rows = h.input(first, second, '', 'deleteContentBackward');
  console.log('R4-C2', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[C, 'blue'], [B, 'rose']]);
});

test('R4-C3 twins: save confirms, then delete the SECOND twin', async t => {
  const h = await text867(t, card('Top', 'top', details(C)) + card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  const x = h.p.text.value.indexOf('top'); h.input(x + 3, x + 3, '!'); await h.w.flush();
  const v = h.p.text.value, first = v.indexOf('## Same'), second = v.indexOf('## Same', first + 1);
  const rows = h.input(second, v.length, '', 'deleteContentBackward');
  console.log('R4-C3', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[C, 'blue'], [A, 'blue']]);
});

test('R4-C4 title-only twins: type into the second after a confirmed save (sync ran)', async t => {
  const h = await text867(t, card('Top', 'top', details(C)) + card('Idea', '', details(A, 'blue')) + card('Idea', '', details(B, 'rose')));
  const x = h.p.text.value.indexOf('top'); h.input(x + 3, x + 3, '.'); await h.w.flush(); h.p.sync();
  const at = h.p.text.value.lastIndexOf('## Idea') + '## Idea\n\n'.length;
  const rows = h.input(at, at, 't');
  console.log('R4-C4', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[C, 'blue'], [A, 'blue'], [B, 'rose']]);
});

test('R4-C5 a save confirms in the middle of retyping a heading key by key', async t => {
  const h = await text867(t, card('Plan', 'plan words', details(A)) + card('Budget', 'budget words', details(B, 'rose')));
  const s = h.p.text.value.indexOf('## Budget'), e = s + '## Budget'.length;
  backspace(h, e, '## Budget'.length); await h.w.flush();
  typeAt(h, s, '## Co'); await h.w.flush();
  const rows = typeAt(h, s + 5, 'sts');
  console.log('R4-C5', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']]);
  await h.w.flush(); assert.deepEqual(metaOf(h.w.base.content.body).map(r => r.id), [A, B]);
});

test('R4-C6 a save confirms between two keystrokes of a word edit on a twin, then the SAVE lands while another keystroke is in flight', async t => {
  const h = await text867(t, card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')));
  const send = h.api.command; let release; h.api.command = async e => { await new Promise(r => release = r); return send(e); };
  const at = h.p.text.value.indexOf('same'); h.input(at + 4, at + 4, '!');
  const saving = h.w.flush(); await new Promise(r => setTimeout(r, 2));
  h.input(at + 5, at + 5, '?');
  release(); await saving; h.api.command = send;
  const rows = h.input(at + 6, at + 6, '.');
  console.log('R4-C6', show(rows)); assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']]);
  await h.w.flush(); await h.w.flush(); assert.deepEqual(metaOf(h.w.base.content.body).map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']]);
});

// Offline Set color in Cards, then Text typing: elsewhere and in the colored card itself.
for (const where of ['elsewhere', 'same card']) test('R4-O1 offline Set color, switch to Text, type ' + where + ', then the save confirms', async t => {
  const h = await one(t, card('One', 'one', details(A)) + card('Two', 'two', null));
  const send = h.api.command; h.api.command = async () => { throw Error('offline'); };
  const picker = h.p.cardColors(h.p.cardRef(1), h.p.anchor); t.after(() => picker.close(false));
  await picker.root.querySelectorAll('.swatch')[0].onclick();
  const minted = metaOf(h.w.value.body)[1];
  console.log('R4-O1 ' + where + ' after Set color value', show(metaOf(h.w.value.body)), '| base', show(metaOf(h.w.base.content.body)));
  assert.ok(minted.id); assert.equal(minted.color, 'green');
  h.p.switchView('text');
  const at = h.p.text.value.indexOf(where === 'elsewhere' ? 'one' : 'two') + 3;
  const rows = h.input(at, at, '!');
  console.log('R4-O1 ' + where + ' after keystroke', show(rows));
  assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green']], 'the offline color and its id survive a Text keystroke ' + where);
  h.api.command = send; await h.w.flush(); await h.w.flush();
  assert.deepEqual(metaOf(h.w.base.content.body).map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green']]);
});

for (const where of ['elsewhere', 'restored card']) test('R4-O2 confirmed Cards delete, Cards Undo (offline), switch to Text, type ' + where, async t => {
  const h = await one(t, card('One', 'one', details(A)) + card('Two', 'two', details(B, 'rose')));
  h.p.picked = 1;
  h.p.key({ key: 'Backspace', metaKey: true, target: h.p.list, preventDefault() {}, stopPropagation() {} });
  await h.w.flush();
  assert.deepEqual(metaOf(h.w.base.content.body).map(r => r.id), [A]);
  const send = h.api.command; h.api.command = async () => { throw Error('offline'); };
  h.p.key({ key: 'z', metaKey: true, target: h.p.list, preventDefault() {}, stopPropagation() {} });
  await h.w.flush();
  console.log('R4-O2 ' + where + ' after undo value', show(metaOf(h.w.value.body)), '| base', show(metaOf(h.w.base.content.body)));
  assert.deepEqual(metaOf(h.w.value.body).map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']]);
  h.p.switchView('text');
  const at = h.p.text.value.indexOf(where === 'elsewhere' ? 'one' : 'two') + 3;
  const rows = h.input(at, at, '!');
  console.log('R4-O2 ' + where + ' after keystroke', show(rows));
  assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']], 'the restored card keeps its id and color through a Text keystroke ' + where);
  h.api.command = send; await h.w.flush(); await h.w.flush();
  assert.deepEqual(metaOf(h.w.base.content.body).map(r => [r.id, r.color]), [[A, 'blue'], [B, 'rose']]);
});

test('R4-O3 offline Set color on an id-less card, then Text rename of that card', async t => {
  const h = await one(t, card('One', 'one', details(A)) + card('Two', 'two', null));
  const send = h.api.command; h.api.command = async () => { throw Error('offline'); };
  const picker = h.p.cardColors(h.p.cardRef(1), h.p.anchor); t.after(() => picker.close(false));
  await picker.root.querySelectorAll('.swatch')[0].onclick();
  const minted = metaOf(h.w.value.body)[1];
  h.p.switchView('text');
  const s = h.p.text.value.indexOf('## Two');
  const rows = h.input(s, s + 6, '## Deux');
  console.log('R4-O3 rename', show(rows));
  assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green']]);
  h.api.command = send; await h.w.flush(); await h.w.flush();
  assert.deepEqual(metaOf(h.w.base.content.body).map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green']]);
});

test('R4-O4 online: Set color save in flight, Text keystroke in the colored card before it confirms', async t => {
  const h = await one(t, card('One', 'one', details(A)) + card('Two', 'two', null));
  const send = h.api.command; let release; h.api.command = async e => { await new Promise(r => release = r); return send(e); };
  const picker = h.p.cardColors(h.p.cardRef(1), h.p.anchor); t.after(() => picker.close(false));
  const acted = picker.root.querySelectorAll('.swatch')[0].onclick();
  await new Promise(r => setTimeout(r, 5));
  const minted = metaOf(h.w.value.body)[1]; assert.ok(minted.id);
  h.p.switchView('text');
  const at = h.p.text.value.indexOf('two') + 3;
  const rows = h.input(at, at, '!');
  console.log('R4-O4 keystroke in flight', show(rows));
  release(); await acted; h.api.command = send; await h.w.flush(); await h.w.flush();
  console.log('R4-O4 saved', show(metaOf(h.w.base.content.body)));
  assert.deepEqual(metaOf(h.w.base.content.body).map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green']]);
});

// Decision12781: the same selection deletes B whole and merges C by removing its heading.
test('R6-E1 exact selection deletes empty B, saves C as A alias, and owned Undo restores the separate cards', async t => {
  const raw = card('First', 'one', details(A)) + card('Empty', '', details(B)) + card('Third', 'two', details(C));
  const h = await text867(t, raw);
  const v = h.p.text.value, s = v.indexOf('## Empty'), e = v.indexOf('## Third') + '## Third\n\n'.length;
  const rows = h.input(s, e, '', 'deleteContentBackward');
  console.log('R4-E1', show(rows), JSON.stringify(h.p.text.value));
  assert.deepEqual(rows.map(r => [r.id,r.aliases,r.color,r.words]), [[A,[C],'blue','one\n\ntwo']]);
  assert.equal(h.w.value.body.includes(B),false,'B is absent from the local body');
  await h.w.flush();
  const saved = h.source().body;
  assert.deepEqual(metaOf(saved).map(r => [r.id,r.aliases,r.color,r.words]), [[A,[C],'blue','one\n\ntwo']]);
  assert.deepEqual(detailLines(saved).map(r => [r.id,r.aliases,r.color]), [[A,[C],'blue']],'the saved marker writes C as an alias, not another primary');
  assert.equal(saved.includes(B),false,'saving does not resurrect B');
  const undone = h.input(s,s,'','historyUndo');
  assert.equal(h.w.value.body,raw,'Undo restores the full pre-selection raw snapshot');
  assert.deepEqual(undone.map(r => [r.id,r.aliases]), [[A,[]],[B,[]],[C,[]]]);
  await h.w.flush();
  assert.equal(h.source().body,raw,'the restored separate cards persist after Undo');
});
test('R4-E2 merge-loop: removing only the next heading of a card with EMPTY words then the following (worded) card: alias only for the directly merged', async t => {
  const h = await text867(t, card('First', 'one', details(A)) + card('Second', 'two', details(B)) + card('Third', 'three', details(C)));
  const v = h.p.text.value, s = v.indexOf('## Second'), e = s + '## Second\n'.length;
  let rows = h.input(s, e, '', 'deleteContentBackward');
  console.log('R4-E2 a', show(rows)); assert.deepEqual(rows.map(r => r.ids), [[A, B], [C]]);
  const v2 = h.p.text.value, s2 = v2.indexOf('## Third'), e2 = s2 + '## Third\n'.length;
  rows = h.input(s2, e2, '', 'deleteContentBackward');
  console.log('R4-E2 b', show(rows)); assert.deepEqual(rows.map(r => r.ids), [[A, B, C]]);
});
