// Test-only observations of unchanged source. No product handler is invoked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { card785, pill785, T785 } from './reading_785_oracle.mjs';

export const TRACE_LIMIT785 = 512;
export const SETTLEMENT_FRAMES785 = 12;
export const traceInit785 = String.raw`(()=>{
 const events=[],limit=512;let active=false,dropped=0,serial=0,arrival=null,scrollSerial=0,endSerial=-1,wheelStart=0;
 const node=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {id:e.dataset?.id??e.id??null,tag:e.tagName,connected:e.isConnected,top:r.top,bottom:r.bottom,left:r.left,right:r.right}};
 const record=(event,data={})=>{if(!active)return;if(events.length>=limit){dropped++;return}const t=performance.now();if(event==='native wheel dispatch'){wheelStart=scrollSerial;endSerial=-1;api.native={event,t,...data}}if(event==='restore enter'||event==='restore after scroll')api.compensation={event,t};events.push({event,seq:++serial,t,epoch:performance.timeOrigin+t,y:scrollY,...data})};
 const saved=a=>a?{anchor:node(a.anchor),savedY:a.y,savedTop:a.tops.get(a.anchor)??null,pointTop:a.point?.top??null,newest:a.newest}:null;
 const api=window.__trace785={node,saved,record,frontier:null,native:null,compensation:null,deliberate:null,
  scrollState(){return {scrollSerial,endSerial,wheelStart}},
  begin(label){events.length=0;dropped=0;serial=0;active=true;record('begin',{label})},
  arrival(id){arrival=id;record('arrival identity',{id})},
  read(){return {events:[...events],dropped,frontier:api.frontier}},
  stop(){record('stop');active=false;return api.read()}
 };
 for(const kind of ['scroll','scrollend'])addEventListener(kind,()=>{if(kind==='scroll')scrollSerial++;else endSerial=scrollSerial;record(kind,{target:'window',source:'unknown',knownNativeInput:api.native,latestCompensation:api.compensation,latestDeliberate:api.deliberate})},{passive:true});
 for(const kind of ['pointerdown','click','keydown','input','touchend','focusin'])addEventListener(kind,event=>{api.deliberate={kind,t:performance.now(),trusted:event.isTrusted};record('observed action context',api.deliberate)},{capture:true,passive:true});
 const main=()=>document.querySelector('#messages');
 new MutationObserver(()=>{if(!active)return;const e=arrival&&document.querySelector('#messages .message-card[data-id='+JSON.stringify(arrival)+']');record('DOM render',{arrival:node(e),reading:node(window.__reading785?.e),drawn:[...(main()?.querySelectorAll('.message-card')??[])].filter(e=>e.getClientRects().length).map(e=>e.dataset.id)})}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['style','hidden','class']});
 const fetch=window.fetch;
 window.fetch=function(input,init){
  let query=null;try{const b=JSON.parse(init?.body??'null');if(b?.name==='topic_messages')query={topic:b.args?.topic_id,direction:b.args?.direction??null,cursor:b.args?.cursor??null}}catch{}
  if(query)record('read start',query);
  const answer=fetch.call(this,input,init);
  if(query)answer.then(r=>r.clone().json()).then(a=>record('read answer',{...query,ids:(a.items??[]).map(e=>e.id),nextCursor:a.next_cursor??null}),()=>record('read failed',query));
  return answer;
 };
})()`;

// Conditional breakpoints return false. They observe live lexical state without
// replacing module bytes or pausing to inspect arbitrary objects.
export function sourceProbes785(source) {
 const specs = [
  ['capture', '  return { list, anchor, cards, held, tops, point, control, edge, last, present, y: window.scrollY,', `({anchor:window.__trace785.node(anchor),savedTop:tops.get(anchor)??null,pointTop:point?.top??null})`],
  ['restore enter', '  if (!saved || retired || !saved.list.isConnected || saved.list.hidden) return;', `({saved:window.__trace785.saved(saved),acting:anchorActing,depth:anchorDepth})`],
  ['restore after scroll', '  if (saved.newest && hold?.isConnected) for (const entry of entries(list)) {', `({saved:window.__trace785.saved(saved),hold:window.__trace785.node(hold)})`],
  ['remember', '  paintNewAbove();', `({saved:window.__trace785.saved(listAnchor)})`],
  ['paint', 'function paintViews(kind) {', `({kind})`],
  ['frontier', "  const view = stackFeed ? shownView(stackFeed.state) : null, aside = stackFeed?.state.belowCount;", `({olderCursor:views.olderCursor,loaded:[...views.messages.keys()],line:views.line?{id:views.line.id,seq:views.line.seq}:null,oldestUnread:views.oldestUnread?{id:views.oldestUnread.id,seq:views.oldestUnread.seq}:null})`],
 ];
 return specs.map(([event,target,data])=>{
  assert.equal(source.split(target).length,2,`unique unchanged source probe ${event}`);
  const lineNumber=source.slice(0,source.indexOf(target)).split('\n').length-1;
  const project=event==='frontier'?`window.__trace785.frontier=${data}`:data;
  return {event,target,lineNumber,condition:`(()=>{if(window.__trace785)window.__trace785.record(${JSON.stringify(event)},${project});return false})()`};
 });
}
export async function installTrace785(p) {
 const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 await p.send('Debugger.enable');
 const bindings=[];
 for(const probe of sourceProbes785(source)) {
  const answer=await p.send('Debugger.setBreakpointByUrl',{urlRegex:'/app\\.mjs$',lineNumber:probe.lineNumber,condition:probe.condition});
  bindings.push({event:probe.event,lineNumber:probe.lineNumber,target:probe.target,breakpointId:answer.breakpointId});
 }
 return {appSha256:createHash('sha256').update(source).digest('hex'),bindings,qualification:'Conditional CDP probes and DOM observers may perturb timing; no source replacement or native selection claim.'};
}
export const traceBegin785=label=>`window.__trace785.begin(${JSON.stringify(label)})`;
export const traceMark785=(event,data={})=>`window.__trace785?.record(${JSON.stringify(event)},${JSON.stringify(data)})`;
export const traceReceipt785=(operation,id,status)=>`(()=>{window.__trace785?.arrival(${JSON.stringify(id)});window.__trace785?.record('Core receipt observed',${JSON.stringify({operation,id,status})})})()`;
export const traceRead785='window.__trace785?.read()??null';
export const frontier785=`(()=>({frontier:window.__trace785?.frontier??null,drawn:[...document.querySelectorAll('#messages .message-card')].filter(e=>e.getClientRects().length).map(e=>e.dataset.id),controls:['#more-messages','button.new-line-older[data-line=older]'].map(selector=>{const e=document.querySelector(selector);return {selector,exists:!!e,hidden:e?.hidden??null,available:!!e?.getClientRects().length,disabled:e?.disabled??null}})}))()`;
export const landing785=id=>`(()=>{const e=document.querySelector(${JSON.stringify(card785(id))}),r=e?.getBoundingClientRect(),a=document.activeElement;return {t:performance.now(),y:scrollY,arrival:window.__trace785?.node(e),active:{id:a?.id??null,tag:a?.tagName??null,message:a?.closest('[data-id]')?.dataset.id??null,pill:a?.classList.contains('new-above')??false},accepts:!!r&&r.top>=-${T785.arrivalSightPx}&&r.top<innerHeight&&e.contains(a),legacyVisible:!!r&&r.top>=0,retires:!!e?.isConnected&&!!r&&r.top>=-${T785.arrivalSightPx}&&r.top<innerHeight&&r.bottom>0&&e.contains(a),pill:${pill785}}})()`;
// Fixed frames, no state-dependent poll and no timer extension.
export const settlement785=id=>`(async()=>{const frames=[];for(let frame=0;frame<${SETTLEMENT_FRAMES785};frame++){await new Promise(requestAnimationFrame);const state=${landing785(id)};frames.push({frame,...state});window.__trace785?.record('settlement frame',{frame,arrival:state.arrival,active:state.active,offer:!!state.pill,accepts:state.accepts,retires:state.retires})}return frames})()`;

// Same twelve-frame ceiling as post-arrival settlement. No command ack or
// four-frame delay is treated as scroll completion. The fallback is explicit.
export const wheelSettlement785 = `(async()=>{const frames=[],trace=window.__trace785;let quiet=0,last=trace.scrollState().scrollSerial,y=scrollY;for(let frame=0;frame<12;frame++){await new Promise(requestAnimationFrame);const state=trace.scrollState(),still=state.scrollSerial===last&&Math.abs(scrollY-y)<=${T785.anchorDriftPx};quiet=still?quiet+1:0;last=state.scrollSerial;y=scrollY;frames.push({frame,t:performance.now(),y,quiet,...state})}const state=trace.scrollState(),reason=state.endSerial>=state.wheelStart&&state.endSerial===state.scrollSerial?'observed scrollend':quiet>=4?'bounded quiet-frame fallback':null;const result={completed:!!reason,reason,quiet,frames,limits:{frames:12,quietFrames:4,movementPx:${T785.anchorDriftPx}}};trace.record('wheel settlement',result);return result})()`;
