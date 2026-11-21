// Retained review source SHA256 186c7cded8579da862be838f3fa958445ff3f8619b86886e611abbaf0d7df69d; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, stripDetails } from './fixtures/card_text_867.mjs';
let seed = 777; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = a => a[rnd(a.length)];
const bits = [' ', '  ', '\t', '\n', '\n\n', 'x', 'ab', '## H', '```', '`', '<!-- theseus-card: ', '{"id":null,"aliases":[],"color":null}', ' -->', '~~~', '#'];
const pages = [
  () => card('One', 'one', details(A)) + card('Two', 'two', details(B, 'rose')) + card('Three', 'three', null),
  () => 'Opening\n\n' + card('One', 'one  \nhard', details(A)) + card('', '', details(B, 'rose')) + card('Code', '```js\nx\n```', details(C)),
  () => ('## One\n\n' + hidden(details(A)) + '\n\none\n\n' + card('Two', 'two', details(B, 'rose'))).replaceAll('\n', '\r\n'),
  () => card('Same', 'same', details(A)) + card('Same', 'same', details(B, 'rose')) + card('Fence', '```\nunclosed', null),
];
function watch(p){let writes=0,value=p.text.value;Object.defineProperty(p.text,'value',{configurable:true,get:()=>value,set:v=>{writes++;value=v;}});return ()=>writes;}

test('R4-S1 page-level: after random real keystrokes (with saves and syncs), sync() never rewrites the textarea; visible body == textarea', async t => {
  let edits = 0, syncs = 0;
  for (let r = 0; r < 60; r++) {
    const h = await text867(t, pick(pages)()); h.p.doc.activeElement = h.p.text;
    for (let s = 0; s < 10; s++) {
      const text = h.p.text.value, at = rnd(text.length + 1), del = rnd(3) ? 0 : rnd(Math.min(8, text.length - at + 1)), ins = rnd(5) ? pick(bits) : '';
      if (!ins && !del) continue;
      const type = ins === '\n' ? 'insertLineBreak' : del && !ins ? 'deleteContentBackward' : 'insertText';
      h.input(at, at + del, ins, type); edits++;
      assert.equal(stripDetails(h.w.value.body).replace(/\r\n/g, '\n'), h.p.text.value, 'visible body == textarea after edit ' + JSON.stringify({ at, del, ins, text }));
      if (rnd(3) === 0) await h.w.flush();
      if (rnd(2) === 0) { const writes = watch(h.p); h.p.sync(); syncs++; assert.equal(writes(), 0, 'sync rewrote the textarea ' + JSON.stringify({ body: h.w.value.body, text: h.p.text.value })); }
    }
    await h.w.flush();
    assert.equal(stripDetails(h.w.base.content.body).replace(/\r\n/g, '\n'), h.p.text.value, 'saved visible == textarea');
  }
  console.log('R4-S1 edits', edits, 'syncs', syncs);
});
