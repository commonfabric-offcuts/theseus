import assert from 'node:assert/strict';

// These same identity/content assertions run on native DOM and focused controls.
// No measured position or size assertion is made by this feature's cases.
export const route757 = row => `?pipeline=${row.workspace_id}&item=${row.number}`;
export const rows757 = cover => cover.items.map(row => ({ title: row.title, state: row.state, href: route757(row) }));
export function assertRows757(actual, cover) {
  assert.deepEqual(actual, rows757(cover), 'each actual item retains its own name, plain state and exact existing route');
}
export function assertSheet757(actual, cover) {
  assertRows757(actual.rows, cover);
  const order = [ ...(cover.stands ? ['cover-stands'] : []), ...(cover.payload ? ['cover-payload'] : []),
    ...cover.items.map(() => 'cover-item'), ...cover.waiting.map(() => 'cover-wait') ];
  assert.deepEqual(actual.order, order, 'manual stands/payload precede rows; waits/defaults follow');
  assert.equal(actual.stands, cover.stands);
  if (cover.payload) {
    assert.ok(actual.payload.includes(cover.payload.text), 'manual payload words stay exact');
    assert.equal(actual.cite, `#${cover.payload.seq}`, 'only the manual payload cites its actual delivered message');
    assert.ok(actual.citeHref.includes(cover.payload.message_id), 'payload citation keeps actual message identity');
    assert.equal(actual.acceptance, cover.payload.done ? 'done' : 'proposed', 'pipeline state never overwrites owner acceptance');
  }
  assert.deepEqual(actual.waits, cover.waiting.map(w => ({ text: w.text, default: `Default: ${w.default}.` })));
}

// Read-only browser expression. Native gestures are exclusively driver calls.
export function snapshot757(selector, sheet = true) {
  return `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    const row=x=>({title:x.querySelector('a')?.textContent,state:x.querySelector('.cover-item-state')?.textContent,href:x.querySelector('a')?.getAttribute('href')});
    return {drawn:Boolean(e.getClientRects().length),rows:[...e.querySelectorAll(${JSON.stringify(sheet ? ':scope > .cover-item' : ':scope > .cover-item')})].map(row),
      order:[...e.children].map(c=>c.classList.contains('cover-heading')?'cover-stands':[...c.classList].find(n=>/^cover-(stands|payload|item|wait)$/.test(n))).filter(Boolean),
      stands:e.querySelector('.cover-stands')?.textContent??null,payload:e.querySelector('.cover-payload .cover-words')?.textContent??null,
      cite:e.querySelector('.cover-payload .cover-src')?.textContent??null,citeHref:e.querySelector('.cover-payload .cover-src')?.getAttribute('href')??null,
      acceptance:e.querySelector('.pill-payload')?.dataset.state??null,
      waits:[...e.querySelectorAll('.cover-wait')].map(w=>({text:w.querySelector('.cover-words')?.textContent,default:w.querySelector('.cover-note')?.textContent}))}})()`;
}
