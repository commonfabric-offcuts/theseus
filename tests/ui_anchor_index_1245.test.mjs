import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { arrangeStacks, stackState, drawn } from '../web/reply-stacks.mjs';
const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const between=(a,b)=>{const at=source.indexOf(a),end=source.indexOf(b,at);assert.ok(at>=0&&end>at);return source.slice(at,end);};
const capture=between('function captureListAnchor()', '// Called only around a product repaint');
const restore=between('function restoreListAnchor(saved)', 'function rememberListAnchor(');
const room=between('function holdRoom(', 'function inView(');
const record=between('function recordListArrivals(', '// Record geometry in document coordinates');
// Actual capture/restore/holdRoom and arrival classifier. Selection is an
// explicit preselected owner port; these counts cover capture, not firstInView.
function fixture(count=7,chosen=3){
 const nodes=[],reads=new Map(),scrolls=[],views={messages:new Map()},entries=new Map();let scrollY=300,retained=0;
 const win={get scrollY(){return scrollY;},scrollBy({top}){assert.ok(Number.isFinite(top));scrollY+=top;for(const n of nodes)n.top-=top;scrolls.push(top);}};
 const flags={retired:false,unavailable:false,authority:false,allowAll:false};
 const list={isConnected:true,hidden:false,contains:n=>nodes.includes(n),style:{setProperty(){},getPropertyValue:()=>'',getPropertyPriority:()=>'',removeProperty(){}},getBoundingClientRect:()=>({top:0})};
 const main={contains:n=>nodes.includes(n)},home={parentElement:list,open:false,contains:()=>false};
 const add=(id,top)=>{const n={dataset:{id,seq:String(nodes.length+1)},isConnected:true,hidden:false,top,h:80,children:[],contains:child=>n===child||n.children.includes(child),compareDocumentPosition:other=>nodes.indexOf(other)>nodes.indexOf(n)?4:0,getClientRects:()=>n.hidden?[]:[{}],getBoundingClientRect(){reads.set(n,(reads.get(n)??0)+1);if(!flags.allowAll&&n!==nodes[chosen])throw Error('NON_ANCHOR_CAPTURE_MEASUREMENT');return {top:n.top,bottom:n.top+n.h,height:n.h,left:20,width:400};}};nodes.push(n);entries.set(id,n);views.messages.set(id,{id,seq:Number(n.dataset.seq),topic_id:'topic',author_id:'other'});return n;};
 for(let i=0;i<count;i++)add('card-'+i,(i-chosen)*100+10);
 const doc={activeElement:null,documentElement:{scrollHeight:5000},caretPositionFromPoint:()=>null};
 const env={document:doc,window:win,innerWidth:800,innerHeight:800,Node:{DOCUMENT_POSITION_FOLLOWING:4,TEXT_NODE:3},inline:null,registry:{},typingField:()=>false,inView:()=>true,actedListCard:()=>null,firstInView:()=>nodes[chosen],entries:()=>nodes,drawn:(_,id)=>{const n=entries.get(id);return Boolean(n&&n.isConnected&&!n.hidden);},views,topic:{id:'topic'},bootstrap:{actor:'viewer'},messageEntries:entries,authorityReviewPending:()=>flags.authority,retainArrivalAnchor:()=>{retained++;},loadedAfter:()=>null,getComputedStyle:()=>({getPropertyValue:()=>0}),$:id=>({messages:list,main,'new-message-sheet':home})[id]};
 const api=new Function(...Object.keys(env),'let roomy=null,anchorHold=null,listActAnchor=null,retired=false,topicUnavailable=false;const newAbove=new Set();'+capture+record+restore+room+';return {captureListAnchor,restoreListAnchor,recordListArrivals,retire:()=>{retired=true;},unavailable:()=>{topicUnavailable=true;}};')(...Object.values(env));
 return {api,flags,nodes,reads,scrolls,views,entries,list,main,doc,win,add,chosen:()=>nodes[chosen],retained:()=>retained};
}
test('1245 capture saves one selected card measurement with a thousand ordered fallback identities',()=>{
 const f=fixture(1000,450),saved=f.api.captureListAnchor();assert.equal(f.reads.size,1);assert.equal(f.reads.get(f.chosen()),1);assert.equal(saved.tops.size,1);assert.equal(saved.tops.get(f.chosen()),10);
});
test('1245 following fallback lands at the removed anchor top instead of its old successor pixel',()=>{
 const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor(),top=saved.tops.get(saved.anchor);f.reads.clear();f.chosen().isConnected=false;
 const next=f.nodes[4];for(const n of f.nodes)n.top+=70;f.api.restoreListAnchor(saved);assert.equal(next.top,top);assert.deepEqual([...f.reads.keys()],[next]);
});
test('1245 replacement still holds the saved slot for the first card with a positive top',()=>{
 const f=fixture(4,0);f.flags.allowAll=true;const saved=f.api.captureListAnchor();assert.equal(saved.baseline,false);f.chosen().isConnected=false;f.reads.clear();f.api.restoreListAnchor(saved);assert.equal(f.nodes[1].top,10);assert.deepEqual([...f.reads.keys()],[f.nodes[1]]);
});
test('1245 no surviving follower places the nearest preceding card bottom at the anchor position',()=>{
 const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor(),top=saved.tops.get(saved.anchor);f.reads.clear();for(const n of f.nodes.slice(3))n.isConnected=false;
 const previous=f.nodes[2];for(const n of f.nodes)n.top+=70;f.api.restoreListAnchor(saved);assert.equal(previous.top+previous.h,top);assert.deepEqual([...f.reads.keys()],[previous]);
});
test('1245 fallback skips disconnected and no-longer-drawn following identities',()=>{
 const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor();f.chosen().isConnected=false;f.nodes[4].hidden=true;f.nodes[5].isConnected=false;f.reads.clear();f.api.restoreListAnchor(saved);assert.equal(f.nodes[6].top,10);assert.deepEqual([...f.reads.keys()],[f.nodes[6]]);
});
test('1245 retained original anchor and exact text point remain the restoration owners',()=>{
 const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor();f.reads.clear();f.chosen().top+=55;f.api.restoreListAnchor(saved);assert.equal(f.chosen().top,10);assert.equal(f.reads.get(f.chosen()),1);
 const g=fixture();g.flags.allowAll=true;let rangeTop=-5;const text={nodeType:3,isConnected:true,data:'same words',length:10};g.chosen().top=-20;g.chosen().children.push(text);g.doc.caretPositionFromPoint=()=>({offsetNode:text,offset:1});g.doc.createRange=()=>({setStart(){},setEnd(){},getClientRects:()=>[{}],getBoundingClientRect:()=>({top:rangeTop})});const point=g.api.captureListAnchor();assert.equal(g.reads.get(g.chosen()),1);assert.ok(point.point);rangeTop=35;g.api.restoreListAnchor(point);assert.equal(g.scrolls[0],40);
});
test('1245 stale source and deliberate scroll do not invoke replacement measurement or compensation',()=>{
 for(const fault of ['retired','hidden','disconnected','scroll']){const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor();f.reads.clear();if(fault==='retired')f.api.retire();if(fault==='hidden')f.list.hidden=true;if(fault==='disconnected')f.list.isConnected=false;if(fault==='scroll'){saved.arrivals=new Map([['actual',{}]]);f.win.scrollBy({top:25});f.scrolls.length=0;}f.api.restoreListAnchor(saved);assert.equal(f.reads.size,0,fault);assert.equal(f.scrolls.length,0,fault);}
});
test('1245 arrival classification uses the captured membership set without repeated array search',()=>{
 const f=fixture();f.flags.allowAll=true;const saved=f.api.captureListAnchor();saved.cards.includes=()=>{throw Error('QUADRATIC_CAPTURE_MEMBERSHIP');};const newEntry=f.add('arrival',-100);f.api.recordListArrivals(saved);assert.deepEqual([...saved.arrivals.keys()],[newEntry]);
});
test('1245 actual arranged drawn lookup performs no per-ID stack search and retains visibility fences',()=>{
 const r=renderer799(),items=[];for(let i=0;i<100;i++){items.push({id:'head-'+i,seq:i*2+1,author_id:'human',author_kind:'human'});items.push({id:'reply-'+i,seq:i*2+2,author_id:'human',author_kind:'human',reply_to:'head-'+i});}const state=r.add(items);state.stacks.find=()=>{throw Error('LINEAR_STACK_LOOKUP');};
 for(let i=0;i<100;i++){assert.equal(drawn(r.list,'head-'+i),true);assert.equal(drawn(r.list,'reply-'+i),true);}state.waiting.add('reply-1');assert.equal(drawn(r.list,'reply-1'),false);state.waiting.clear();state.below.add('head-1');assert.equal(drawn(r.list,'reply-1'),false);state.moreOpen=true;assert.equal(drawn(r.list,'reply-1'),true);state.moreOpen=false;state.below.clear();state.only=item=>item.id==='reply-1';assert.equal(drawn(r.list,'reply-1'),true);assert.equal(drawn(r.list,'head-1'),false);assert.equal(drawn(r.list,'unknown'),false);
 r.messages.delete('reply-1');r.list.querySelector('[data-id=reply-1]').remove();r.messages.set('reply-2',{...r.messages.get('reply-2'),author_id:'replacement'});
 arrangeStacks(r.list,r.messages,{doc:r.list.ownerDocument,viewer:'reader'});state.only=item=>item.author_id==='replacement';
 assert.equal(drawn(r.list,'reply-1'),false,'rearrange prunes a removed identity');assert.equal(drawn(r.list,'reply-2'),true,'rearrange indexes the actual replacement record');
});
test('1245 replacing stacks immediately prunes old index identities with first-match and unknown-ID behavior',()=>{
 const r=renderer799(),state=stackState(r.list),first={id:'head',head:{id:'head'},replies:[{id:'duplicate',wanted:true}]},second={id:'other',head:{id:'other'},replies:[{id:'duplicate',wanted:false}]};state.stacks=[first,second];state.only=item=>item.wanted===true;assert.equal(drawn(r.list,'duplicate'),true);state.stacks=[second];assert.equal(drawn(r.list,'duplicate'),false);state.stacks=[];assert.equal(drawn(r.list,'duplicate'),false);state.only=null;assert.equal(drawn(r.list,'unknown'),true);state.stacks=[first];state.only=item=>item.wanted===true;assert.equal(drawn(r.list,'duplicate'),true);
});
