// Retained review source SHA256 d16d38f9bb1cccc96afe0788f81de44e66363f8d4f37c602c979fe76e52c32aa; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { card, details, A, C, metaOf, parseDeck, writingPort, documentPort, NotebookPage } from './fixtures/card_text_867.mjs';
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
async function one(t, raw, mode = 'cards') {
  const f = await writingPort(t, raw), doc = documentPort(), make = doc.createElement;
  doc.createElement = tag => { const n = make(tag); n.before = x => n.parent?.insertBefore(x, n); n.after = (...xs) => { const next = n.parent?.children[n.parent.children.indexOf(n) + 1]; for (const x of xs) n.parent?.insertBefore(x, next); }; return n; };
  const p = new NotebookPage({ doc, host: doc.body, item: 'page', mode, bootstrap: {}, viewPreference: { get: () => mode, set() {} }, header: { title: doc.createElement('h1'), description: doc.createElement('p') } });
  Object.assign(p, { writing: f.w, deck: parseDeck(raw), base: { revision: 1, body: raw }, paint() {}, keepNamed() {}, show() {} });
  p.anchor = doc.createElement('button'); doc.body.append(p.anchor); p.sync(true);
 const input=(start,end,insert,inputType='insertText')=>{
  p.text.setSelectionRange(start,end);
  const event={inputType,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  p.text.listeners.beforeinput(event);
  if(!event.defaultPrevented){p.text.value=p.text.value.slice(0,start)+insert+p.text.value.slice(end);p.text.setSelectionRange(start+insert.length,start+insert.length);p.text.listeners.input({inputType});}
  return metaOf(f.w.value.body);
 };
  return { ...f, p, input, doc };
}
test('M14-mid offline Set color on a MIDDLE card, Text keystroke elsewhere, native Undo', async t => {
  const h = await one(t, card('One', 'one', details(A)) + card('Two', 'two', null) + card('Three', 'three', details(C)));
  h.api.command = async () => { throw Error('offline'); };
  const picker = h.p.cardColors(h.p.cardRef(1), h.p.anchor); t.after(() => picker.close(false));
  await picker.root.querySelectorAll('.swatch')[0].onclick();
  const minted = metaOf(h.w.value.body)[1]; assert.ok(minted.id);
  h.p.switchView('text');
  const pr = h.p.textProjection; console.log('M14-mid text === base.text?', h.p.text.value === pr.base.text);
  const at = h.p.text.value.indexOf('one') + 3; h.input(at, at, '!');
  const rows = h.input(at, at + 1, '', 'historyUndo');
  console.log('M14-mid undone', show(rows));
  assert.deepEqual(rows.map(r => [r.id, r.color]), [[A, 'blue'], [minted.id, 'green'], [C, 'blue']]);
});
