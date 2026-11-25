import assert from 'node:assert/strict';
export const T785 = Object.freeze({anchorDriftPx:1,lineDriftPx:1,pillTopPx:1,columnCentrePx:1,viewportClipPx:1,arrivalSightPx:1,opacity:0.001,deliberatePx:20});
export const card785 = id => `#messages .message-card[data-id=${JSON.stringify(id)}]`;
export const rect785 = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}})()`;
// Retain the real DOM Range rather than a character chosen again after layout.
export const capture785 = `(()=>{const candidates=[...document.querySelectorAll('#messages .message-card')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().bottom>0),e=candidates[0];if(!e)throw Error('no real reading card');
 const b=e.getBoundingClientRect(),x=Math.max(1,Math.min(innerWidth-1,b.left+b.width/2)),c=document.caretPositionFromPoint?.(x,1),r=c?null:document.caretRangeFromPoint?.(x,1),text=c?.offsetNode??r?.startContainer,offset=c?.offset??r?.startOffset;
 let range=null;if(b.top<0&&text?.nodeType===3&&e.contains(text)){range=document.createRange();range.setStart(text,offset);range.setEnd(text,Math.min(text.length,offset+1));if(!range.getClientRects().length)range=null}
 window.__reading785={e,range,text:range?text:null,offset:range?offset:null,words:range?text.data:null};return {id:e.dataset.id,top:range?range.getBoundingClientRect().top:b.top,cardTop:b.top,words:range?text.data:null,offset:range?offset:null,y:scrollY}})()`;
export const read785 = `(()=>{const a=window.__reading785;if(!a)return null;return {id:a.e.dataset.id,connected:a.e.isConnected,top:a.range?a.range.getBoundingClientRect().top:a.e.getBoundingClientRect().top,cardTop:a.e.getBoundingClientRect().top,words:a.text?.data??null,offset:a.offset,y:scrollY}})()`;
export const pill785 = String.raw`(()=>{const e=document.querySelector('.new-above');if(!e||e.hidden)return null;const r=e.getBoundingClientRect(),m=document.querySelector('#messages').getBoundingClientRect(),s=getComputedStyle(e),colour=s.backgroundColor,rgba=colour.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,centre:(r.left+r.right)/2,columnCentre:(m.left+m.right)/2,inlineLeft:parseFloat(e.style.left),supports:CSS.supports('left','anchor(--message-column center)'),opacity:Number(s.opacity),alpha:rgba?Number(rgba[1]):colour==='transparent'?0:1,shadow:s.boxShadow,transform:s.transform,text:e.textContent,hit:e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)),viewport:innerWidth,coarse:matchMedia('(pointer:coarse)').matches}})()`;
export const frames785 = `new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))`;
export function held785(before, after) {
 assert.equal(after?.connected,true,'real reading anchor remains connected');
 assert.equal(after.id,before.id,'same real reading anchor identity');
 assert.equal(after.words,before.words,'same exact reading text');
 assert.equal(after.offset,before.offset,'same reading character offset');
 assert.ok(Math.abs(after.top-before.top)<=T785.anchorDriftPx,`reading anchor drift <= ${T785.anchorDriftPx}px: ${JSON.stringify({before,after})}`);
}
export function solid785(p,{fallback=false}={}) {
 assert.ok(p,'New above is offered');
 assert.ok(Math.abs(p.top-12)<=T785.pillTopPx,'pill top is 12px within pillTopPx=1');
 assert.ok(p.left>=-T785.viewportClipPx&&p.right<=p.viewport+T785.viewportClipPx,'whole pill fits viewport within viewportClipPx=1');
 if (!fallback&&p.supports) assert.ok(Math.abs(p.centre-p.columnCentre)<=T785.columnCentrePx,'pill centred on message column within columnCentrePx=1');
 else assert.ok(Math.abs(p.left-p.inlineLeft)<=T785.columnCentrePx,'unsupported CSS retains old inline left edge');
 assert.ok(Math.abs(p.opacity-1)<=T785.opacity&&Math.abs(p.alpha-1)<=T785.opacity,'pill surface is opaque');
 assert.notEqual(p.shadow,'none','pill has shadow');
 assert.ok(p.hit,'pill owns its centre hit test');
 assert.ok(p.height>=(p.coarse?44:36)-T785.viewportClipPx,'pill target retains minimum height within viewportClipPx=1');
 assert.match(p.text,/^New above · [1-9]\d* ↑$/,'the offer names a positive retained-arrival count');
}
export const allExpressions785 = () => [capture785,read785,pill785,frames785,rect785(card785('id"\\\n'))];
// Every generated page expression used by the item lives here for preflight.
export const expressions785 = {
 wheelAim: `(()=>{const b=document.querySelector('#messages').getBoundingClientRect();return {x:Math.max(2,b.left-8),y:innerHeight*.7}})()`,
 ready: 'window.fetchesOut===0', y:'scrollY', top:'scrollY===0', viewportHeight:'innerHeight',
 activePill:`document.activeElement?.classList.contains('new-above')`,
 exists:id=>`Boolean(document.querySelector(${JSON.stringify(card785(id))}))`,
 lands:id=>`(()=>{const e=document.querySelector(${JSON.stringify(card785(id))}),r=e.getBoundingClientRect();return r.top>=-${T785.arrivalSightPx}&&r.top<innerHeight&&e.contains(document.activeElement)})()`,
 binding:`({module:document.querySelector('script[type="module"][src]').getAttribute('src'),css:[...document.querySelectorAll('link[rel="stylesheet"]')].map(e=>e.getAttribute('href')),support:CSS.supports('left','anchor(--message-column center)'),agent:navigator.userAgent})`,
 resize:(id,height)=>`(()=>{const e=document.querySelector(${JSON.stringify(card785(id))});e.style.marginTop=${JSON.stringify(height+'px')}})()`,
 edited:id=>`document.querySelector(${JSON.stringify(card785(id))})?.textContent.includes('Edited above reading')`,
 touchAim:`(()=>{const r=document.querySelector('#messages').getBoundingClientRect();return {x:Math.max(2,r.left-8),y:innerHeight*.7}})()`,
 hasRail:`(()=>{const e=document.querySelector('#rail-open');return !!e&&e.getClientRects().length>0})()`,
 link:`[...document.querySelectorAll('a[href]')].find(a=>a.getClientRects().length&&a.getAttribute('href').includes('topic=t1'))?.getAttribute('href')??null`,
 navigated:`new URL(location.href).searchParams.get('topic')==='t1'&&document.body.dataset.ready==='true'`,
 absent:id=>`document.querySelector(${JSON.stringify(card785(id))})===null`,
 gate:`window.gateReading785=true`, waiting:`window.reading785Pending>0`, release:`window.releaseReading785?.()`,
};
export const staleInit785 = topic => `(()=>{const original=window.fetch,held=[];window.reading785Pending=0;window.releaseReading785=()=>{window.gateReading785=false;for(const give of held.splice(0))give()};window.fetch=function(input,init){let b;try{b=JSON.parse(init?.body??'null')}catch{}const result=original.call(this,input,init);if(window.gateReading785&&b?.name==='topic_messages'&&b?.args?.topic_id===${JSON.stringify(topic)})return result.then(answer=>new Promise(give=>{held.push(()=>give(answer));window.reading785Pending++}));return result}})()`;
Object.assign(expressions785,{
 activeIdentity:`({id:document.activeElement?.id,message:document.activeElement?.closest('[data-id]')?.dataset.id??null})`,
 sheetOpen:`document.querySelector('#new-message-sheet').open`,
 writingReady:`document.activeElement?.id==='inline-writing-body'`,
 receipt:`window.sendReceipts.at(-1)??null`,
 sentCard:body=>`[...document.querySelectorAll('#messages .message-card')].find(e=>e.textContent.includes(${JSON.stringify(body)}))?.dataset.id??null`,
 readerOpen:`document.querySelector('#reader').open`,
 retainedWriting:`document.querySelector('#inline-writing-body').value`,
 drawnIds:`[...document.querySelectorAll('#messages .message-card')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)`,
 olderControl:`['#more-messages','button.new-line-older[data-line=older]'].find(s=>document.querySelector(s)?.getClientRects().length>0)??null`,
});
