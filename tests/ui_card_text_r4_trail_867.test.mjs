// Retained review source SHA256 b032c60867271bde4d76e184400c9767815a8bdc2f99b6179cd6d83bd4b3bda8; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, cardDetails, stripDetails, CardTextProjection } from './fixtures/card_text_867.mjs';
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.aliases.map(a => a.slice(2, 3)).join('')}/${r.color ?? '-'}`).join('  ');
const norm = s => s.replace(/\r\n?/g, '\n');
// Count textarea value writes through the real sync().
function watch(p){let writes=0,value=p.text.value;Object.defineProperty(p.text,'value',{configurable:true,get:()=>value,set:v=>{writes++;value=v;}});return ()=>writes;}

test('R4-T1 hard break (two spaces + Return) at end of identified card, save confirms, sync, keep typing', async t => {
  const h = await text867(t, card('Plan', 'line one', details(A)) + card('Budget', 'budget', details(B, 'rose')));
  const at = h.p.text.value.indexOf('line one') + 8;
  h.input(at, at, ' '); h.input(at + 1, at + 1, ' '); h.input(at + 2, at + 2, '\n', 'insertLineBreak');
  const typed = h.p.text.value;
  assert.equal(stripDetails(h.w.value.body), typed, 'body visible == textarea after hard break');
  await h.w.flush();
  assert.equal(h.w.base.content.body, h.w.value.body);
  assert.equal(stripDetails(h.w.base.content.body), typed, 'saved visible == textarea');
  h.p.doc.activeElement = h.p.text; const writes = watch(h.p);
  h.p.text.selectionStart = h.p.text.selectionEnd = at + 3;
  h.p.sync();
  assert.equal(writes(), 0, 'sync must not touch the textarea when only hidden lines differ');
  assert.equal(h.p.text.value, typed);
  for (const [i, ch] of [...'line two'].entries()) h.input(at + 3 + i, at + 3 + i, ch);
  assert.equal(stripDetails(h.w.value.body), h.p.text.value);
  await h.w.flush();
  const rows = metaOf(h.w.base.content.body);
  assert.deepEqual(rows.map(r=>[r.id,r.color]), [[A,'blue'],[B,'rose']]);
  assert.equal(stripDetails(h.w.base.content.body), h.p.text.value);
  console.log('R4-T1 body', JSON.stringify(h.w.base.content.body));
});

for (const tail of ['  ', ' \t', '\n   ', '  \n  \n', '\n\n\n']) test('R4-T2 odd trailing whitespace before the next heading: ' + JSON.stringify(tail), async t => {
  const h = await text867(t, card('Plan', 'plan words', details(A)) + card('Budget', 'budget', details(B, 'rose')) + card('Last', 'last', details(C)));
  const at = h.p.text.value.indexOf('plan words') + 10;
  for (const [i, ch] of [...tail].entries()) h.input(at + i, at + i, ch, ch === '\n' ? 'insertLineBreak' : 'insertText');
  // and at the very end of the page (last card)
  const end = h.p.text.value.length;
  for (const [i, ch] of [...tail].entries()) h.input(end + i, end + i, ch, ch === '\n' ? 'insertLineBreak' : 'insertText');
  assert.equal(stripDetails(h.w.value.body), h.p.text.value, 'visible roundtrip');
  await h.w.flush();
  h.p.doc.activeElement = h.p.text; const writes = watch(h.p); h.p.sync();
  assert.equal(writes(), 0, 'sync leaves the textarea');
  assert.deepEqual(metaOf(h.w.base.content.body).map(r=>r.id), [A,B,C]);
});

test('R4-T3 CRLF page: type a trailing space then a hard break, save, sync; CRLF of untouched cards kept', async t => {
  const raw = ('Opening\n\n' + card('One', 'one', details(A)) + card('Two', 'two', details(B, 'rose')) + card('Three', 'three', null)).replaceAll('\n', '\r\n');
  const h = await text867(t, raw);
  assert.equal(h.calls.length, 0);
  const at = h.p.text.value.indexOf('two') + 3;
  h.input(at, at, ' '); h.input(at + 1, at + 1, ' '); h.input(at + 2, at + 2, '\n', 'insertLineBreak'); h.input(at + 3, at + 3, 'x');
  const body = h.w.value.body;
  console.log('R4-T3 body', JSON.stringify(body));
  assert.equal(norm(stripDetails(body)), h.p.text.value, 'visible roundtrip (normalized)');
  assert.ok(body.includes('## One\r\n'), 'untouched card keeps CRLF');
  assert.deepEqual(metaOf(body).map(r=>[r.id,r.color]), [[A,'blue'],[B,'rose'],[null,null]]);
  await h.w.flush();
  h.p.doc.activeElement = h.p.text; const writes = watch(h.p); h.p.sync();
  assert.equal(writes(), 0, 'sync leaves the textarea on a mixed-ending body');
  // one more keystroke after the confirmed save
  const y = h.p.text.value.indexOf('one') + 3; h.input(y, y, '!');
  assert.equal(norm(stripDetails(h.w.value.body)), h.p.text.value);
  assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]), [[A,'blue'],[B,'rose'],[null,null]]);
});

test('R4-T4 CRLF with the hidden line under the title and trailing spaces typed', async t => {
  const raw = ('## One\n\n' + hidden(details(A)) + '\n\none\n\n' + card('Two', 'two', details(B, 'rose'))).replaceAll('\n', '\r\n');
  const h = await text867(t, raw);
  const at = h.p.text.value.indexOf('one') + 3;
  h.input(at, at, ' '); h.input(at + 1, at + 1, ' ');
  assert.equal(norm(stripDetails(h.w.value.body)), h.p.text.value);
  console.log('R4-T4 body', JSON.stringify(h.w.value.body));
  await h.w.flush();
  const y = h.p.text.value.indexOf('two') + 3; h.input(y, y, ' ');
  assert.equal(norm(stripDetails(h.w.value.body)), h.p.text.value);
  assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]), [[A,'blue'],[B,'rose']]);
});

test('R4-T5 projection module: stripDetails(edit(text)) == text for many whitespace tails and placements', () => {
  const tails = ['', '\n', '\n\n', ' ', '  ', '  \n', ' \n\n', '\t\n', '\n \n', '\n\n  \n\n', ' ', 'x  '];
  const bodies = [
    tail => '## Plan\n\nplan words' + tail + '\n\n' + hidden(details(A)) + '\n\n## Budget\n\nbudget\n',
    tail => '## Plan\n\nplan words\n\n' + hidden(details(A)) + '\n\n## Budget\n\nbudget' + tail,
    tail => '## Plan\n\n' + hidden(details(A)) + '\n\nplan words' + tail + '\n\n## Budget\n\nbudget\n',
    tail => '## Code\n\n```js\nconst x = 1;' + tail + '\n```\n\n' + hidden(details(A)) + '\n',
    tail => '## Code\n\n' + hidden(details(A)) + '\n\n```js\nconst x = 1;' + tail,
    tail => '## Title' + '\n\n' + hidden(details(A)) + '\n\n',
    tail => ('## Plan\r\n\r\nplan words' + tail + '\r\n\r\n' + hidden(details(A)) + '\r\n\r\n## Budget\r\n\r\nbudget\r\n'),
  ];
  let n = 0;
  for (const make of bodies) for (const base of tails) for (const typed of tails) {
    const body = make(base.replaceAll('\n', make('').includes('\r\n') ? '\r\n' : '\n'));
    const p = new CardTextProjection(); const shown = p.show(body);
    // type `typed` right after the words of the first card (or after the title for the title-only body)
    const anchor = shown.includes('plan words') ? shown.indexOf('plan words') + 10 : shown.includes('const x = 1;') ? shown.indexOf('const x = 1;') + 12 : shown.indexOf('## Title') + 8;
    let text = shown;
    for (const [i, ch] of [...typed].entries()) {
      const at = anchor + i; text = text.slice(0, at) + ch + text.slice(at);
      const out = p.edit(text, { start: at, end: at, inputType: 'insertText' });
      n++;
      assert.equal(norm(stripDetails(out)), text, `roundtrip ${JSON.stringify({ body, typed, i })}\nout=${JSON.stringify(out)}`);
      assert.deepEqual(metaOf(out).map(r => r.id).filter(Boolean), [A], `id kept ${JSON.stringify({ body, typed, i })}`);
    }
  }
  console.log('R4-T5 checked', n, 'edits');
});
