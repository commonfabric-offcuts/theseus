import assert from 'node:assert/strict';
export const TOLERANCE783 = Object.freeze({ order: 1, overflow: 1, visible: 0.5, line: 2 });
export const WORDS783 = Object.freeze({ stands: 'Discussed: <literal>\nDecisions: none\nNext: & "unchanged"', payload: 'Answer: keep #words, not a parsed title.', wait: 'Wait for a real answer?', default: 'keep the exact default' });
// Explicit identity belongs to the assertion site, never Node's diagnostic text.
function equal783(identity, actual, expected, message) {
  try { assert.equal(actual, expected, message); }
  catch (error) { if (error instanceof assert.AssertionError) error.oracle783 = identity; throw error; }
}
export const selector783 = root => `#messages .reply-stack[data-stack="${root}"]`;
// This exact expression executes in local page models and in both native engines.
export function expression783(root, scope = null) {
  return `(()=>{const s=document.querySelector(${JSON.stringify(scope ?? selector783(root))});if(!s)return null;
    const c=s.querySelector(':scope > .dossier-cover')??s.querySelector('.dossier-cover');if(!c)return null;
    const box=e=>{const b=e?.getBoundingClientRect();return b?{top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}:null},
      tab=s.querySelector('.stack-head'), cs=getComputedStyle(c), shown=e=>!!e&&e.getClientRects().length>0&&e.getBoundingClientRect().height>0.5,
      messages=[...s.querySelectorAll('.message-card')].filter(e=>shown(e)&&e.dataset.headOpen!=='false'),
      faces=messages.map(e=>e.querySelector('.message-preview')).filter(shown);
    return {first:s.firstElementChild===c,cover:box(c),tab:box(tab),folder:box(s),faces:faces.map(box),
      background:cs.backgroundColor,folderBackground:getComputedStyle(s).backgroundColor,shadow:cs.boxShadow,
      visible:shown(c),stands:c.querySelector('.cover-stands')?.textContent,payload:c.querySelector('.cover-payload .cover-words')?.textContent,
      waits:[...c.querySelectorAll('.cover-wait')].map(e=>e.textContent),links:[...c.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.getAttribute('href')})),
      cards:[...s.querySelectorAll('.message-card')].map(e=>({id:e.dataset.id,author:e.querySelector('.author-name')?.textContent,color:getComputedStyle(e).backgroundColor,star:e.dataset.starred})),
      fold:s.dataset.fold,overflow:document.documentElement.scrollWidth-innerWidth}})()`;
}
export function assertLook783(at, { folder = true } = {}) {
  assert.ok(at?.visible, '783 cover visible');
  if (folder) {
    equal783('783.first-child', at.first, true, '783 cover is first child');
    equal783('783.folder-background', at.background, at.folderBackground, '783 same folder background');
    assert.ok(at.tab && at.cover.top >= at.tab.bottom - TOLERANCE783.order, '783 cover below name');
    assert.ok(at.cover.left >= at.folder.left - TOLERANCE783.order && at.cover.right <= at.folder.right + TOLERANCE783.order, '783 cover within folder');
    // Computed shadows serialize rgb() commas too; split only between shadows.
    const shadows = at.shadow.split(/,(?![^()]*\))/).map(s=>s.trim());
    equal783('783.inset-pair', shadows.length, 2, '783 approved pair of inset shadows');
    assert.ok(shadows.every(s=>s.includes('inset')), '783 no outer raised shadow');
    const lengths=shadows.map(s=>s.replace(/rgba?\([^)]*\)/g,'').match(/-?[\d.]+px/g)?.map(v=>parseFloat(v)));
    assert.ok(lengths.every((v,i)=>v && v.length>=3 && v.length<=4 && v.slice(0,3).every((n,j)=>n===[[0,1,3],[0,-1,0]][i][j]) && (v[3]??0)===0), '783 subtle approved inset geometry');
  }
  assert.ok(at.faces.every(face=>face.top >= at.cover.bottom - TOLERANCE783.order), '783 cover above message words');
  assert.ok(at.overflow <= TOLERANCE783.overflow, '783 no horizontal overflow');
}
export function assertWords783(at, words = WORDS783) {
  assert.equal(at.stands, words.stands, '783 literal stands');
  assert.equal(at.payload, 'Payload · answer ' + words.payload + ' payload proposed', '783 literal payload');
  assert.deepEqual(at.waits, ['Waits on you ' + words.wait + 'Default: ' + words.default + '.'], '783 literal wait/default');
  assert.equal(at.links.length, 1, '783 one payload citation');
}
export function assertLines783(at, stands=WORDS783.stands) {
  assert.equal(at.text,stands,'783 line source words');
  assert.equal(at.rects.length,stands.split('\n').length,'783 supplied line count');
  for(const [i,r] of at.rects.entries()) {
    assert.ok(r.height>TOLERANCE783.visible,'783 line visible (visible=0.5px)');
    assert.ok(Math.abs(r.height-at.rects[0].height)<=TOLERANCE783.line,'783 single painted line (line=2px)');
    if(i)assert.ok(Math.abs(r.top-at.rects[i-1].top-at.lineHeight)<=TOLERANCE783.line,'783 distinct consecutive lines (line=2px)');
  }
}
export const page783 = {
  lines: scope => `(()=>{const s=document.querySelector(${JSON.stringify(scope)}),w=s.querySelector('.cover-stands .cover-words'),t=w.firstChild;
    const text=w.textContent,rects=[];let offset=0;
    for(const line of text.split('\\n')){const r=document.createRange();r.setStart(t,offset);r.setEnd(t,offset+line.length);const b=r.getBoundingClientRect();rects.push({top:b.top,height:b.height});offset+=line.length+1;}
    return {text,rects,lineHeight:parseFloat(getComputedStyle(w).lineHeight)}})()`,
  state: toggle => `document.querySelector(${JSON.stringify(toggle)})?.dataset.state`,
  title: s => `document.querySelector(${JSON.stringify(s+' .stack-name')}).textContent`,
  privateDrawn: id => `!!document.querySelector('#messages [data-id="${id}"]')`,
  colors: () => `Object.fromEntries([...document.querySelectorAll('#messages .message-card')].map(e=>[e.dataset.id,e.className.match(/agent-[a-z]+/g)??[]]))`,
  focused: cite => `document.activeElement===document.querySelector(${JSON.stringify(cite)})`,
  readerOpen: () => 'document.querySelector("#reader-cover").open',
  readerOrder: () => `(()=>{const c=document.querySelector('#reader-cover'),m=document.querySelector('#source-body');return c.getBoundingClientRect().bottom<=m.getBoundingClientRect().top+${TOLERANCE783.order}})()`,
  lone: id => `(()=>{const c=document.querySelector('#messages .message-card[data-id="${id}"]'),r=c.querySelector(':scope > .row-pills');return {after:r?.previousElementSibling?.className,words:r?.textContent,sheet:!!c.querySelector('.dossier-cover')}})()`,
  build: stamp => `document.querySelector('script[type="module"][src]').src.includes('/b/${stamp}/')`,
};
