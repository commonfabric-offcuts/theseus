// Deterministic controller/Reader contracts only. These do not prove native
// selection, gestures, geometry, focus, scrolling, menus or a phone keyboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/dossier-selection-quote.mjs',import.meta.url),'utf8');
const readerSource=readFileSync(new URL('../web/reader.mjs',import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const load=s=>vm.runInNewContext(s.replace(/^import .*;\n/gm,'').replace('export class','class')+'\nDossierSelectionQuote',{
  cardIn:e=>e.card??e,drawnText:w=>w.body,drawnRevision:w=>w.revision,sourcePosition:(n,o)=>n.base+o,
});
function fixture(text=source){
  const words={body:'Amber birds',revision:2},a={base:0},b={base:0};
  words.contains=n=>n===a||n===b;
  const card={dataset:{id:'reply'},closest:()=>({}),querySelector:()=>words};
  const entry={dataset:{id:'reply'},card};
  const range={startContainer:a,startOffset:0,endContainer:b,endOffset:11,collapsed:false,cloneRange(){return {...this};}};
  const selection={rangeCount:1,isCollapsed:false,getRangeAt:()=>range};
  const c=Object.create(load(text).prototype);
  Object.assign(c,{host:{isConnected:true,closest:()=>null,contains:e=>e===entry},phone:{matches:true},doc:{visibilityState:'visible',querySelector:()=>null,getSelection:()=>selection},
    entryOf:()=>entry,selected:()=>({start:0,end:11,text:words.body}),eligible:()=>true,visibleWords:()=>true});
  const chosen={id:'reply',entry,card,words,body:words.body,range,excerpt:{start:0,end:11,text:words.body,revision:2}};
  return {c,chosen,range,selection,entry,card,words};
}
const exactMutation=(text,old,replacement)=>{assert.equal(text.split(old).length-1,1,'exact unique source mutant applied');const changed=text.replace(old,replacement);assert.notEqual(changed,text);return changed;};
function redRestore(name,old,replacement,check){
  const mutant=exactMutation(source,old,replacement);
  // Red first: the same semantic assertion must reject the exact product mutant.
  let failure;try{check(mutant);}catch(e){if(!(e instanceof assert.AssertionError))throw e;failure=e;}
  assert.ok(failure,'product mutant must be caught: '+name);
  const at=source.indexOf(old),restored=mutant.slice(0,at)+old+mutant.slice(at+replacement.length);assert.equal(restored,source);check(restored);
  console.log(JSON.stringify({name:'item 674 '+name,native:false,applied:1,red:failure.stack,control:sha(source),mutant:sha(mutant),restored:sha(restored)}));
}
const guards=[
  ['current entry authority','this.eligible(id, entry) &&','true &&', f=>{f.c.eligible=()=>false;}],
  ['detached entry','this.host.contains(entry) &&','true &&',f=>{f.c.host.contains=()=>false;}],
  ['same card identity','cardIn(entry) === card &&','true &&',f=>{f.entry.card={};}],
  ['same drawn words','card.querySelector(\':scope > .message-preview\') === words &&','true &&',f=>{f.card.querySelector=()=>({});}],
  ['dossier membership','Boolean(card.closest(\'.reply-stack\'))','true',f=>{f.card.closest=()=>null;}],
  ['entry id','entry.dataset.id === id &&','true &&',f=>{f.entry.dataset.id='other';}],
  ['card id','card.dataset.id === id &&','true &&',f=>{f.card.dataset.id='other';}],
  ['noncollapsed range','!range.collapsed &&','true &&',f=>{f.range.collapsed=true;}],
  ['displayed source bytes','drawnText(words) === body &&','true &&',f=>{f.words.body='Changed words';}],
  ['displayed revision','drawnRevision(words) === excerpt.revision &&','true &&',f=>{f.words.revision=3;}],
  ['exact excerpt bytes','body.slice(excerpt.start, excerpt.end) === excerpt.text &&','true &&',f=>{f.chosen.excerpt.text='Wrong words';}],
  ['source start offset','sourcePosition(range.startContainer, range.startOffset) === excerpt.start &&','true &&',f=>{f.range.startOffset=1;}],
  ['source end offset','sourcePosition(range.endContainer, range.endOffset, true) === excerpt.end &&','true &&',f=>{f.range.endOffset=10;}],
];
for(const [name,old,replacement,alter] of guards)test('item 674 '+name+' refuses a stale capture, mutant red then exact restore',()=>{
  redRestore(name,old,replacement,s=>{const f=fixture(s);assert.equal(f.c.valid(f.chosen),true);alter(f);assert.equal(f.c.valid(f.chosen),false,name);});
});
for(const state of ['opening','fine pointer','hidden document','detached host','hidden host','modal'])test('item 674 availability '+state,()=>{
  const {c}=fixture();assert.equal(c.available(),true);
  if(state==='opening')c.opening=true;
  if(state==='fine pointer')c.phone.matches=false;
  if(state==='hidden document')c.doc.visibilityState='hidden';
  if(state==='detached host')c.host.isConnected=false;
  if(state==='hidden host')c.host.closest=()=>({});
  if(state==='modal')c.doc.querySelector=()=>({});
  assert.equal(c.available(),false);
});
for(const state of ['empty','collapsed','multiple ranges','cross message','blank','unknown revision','unavailable'])test('item 674 capture '+state+' offers no fallback',()=>{
  const f=fixture();assert.ok(f.c.capture());
  if(state==='empty')f.selection.rangeCount=0;
  if(state==='collapsed')f.selection.isCollapsed=true;
  if(state==='multiple ranges')f.selection.rangeCount=2;
  if(state==='cross message')f.range.endContainer={base:0};
  if(state==='blank')f.c.selected=()=>({text:' '});
  if(state==='unknown revision')f.words.revision=undefined;
  if(state==='unavailable')f.c.eligible=()=>false;
  assert.equal(f.c.capture(),null);
});
function geometry(text=source){
  const c=Object.create(load(text).prototype),card={},node={parentElement:null};
  const outer={hidden:false,inert:false,parentElement:null,getAttribute:()=>null,matches:()=>false,
    getBoundingClientRect:()=>({left:0,top:0}),clientLeft:0,clientTop:0,clientWidth:100,clientHeight:100};
  node.parentElement=outer;
  const style={display:'block',visibility:'visible',opacity:'1',overflowX:'hidden',overflowY:'hidden'};
  const box={left:1,top:1,right:20,bottom:20,width:19,height:19};
  c.win={getComputedStyle:()=>style};c.viewport=()=>({left:0,top:0,right:100,bottom:100});
  c.doc={createTreeWalker:()=>{let done=false;return {nextNode:()=>done?null:(done=true,node)};},createRange:()=>({selectNodeContents(){},toString:()=> 'Amber birds',getClientRects:()=>[box]})};
  const words={querySelectorAll:()=>[],closest:()=>card},range={intersectsNode:()=>true};
  return {c,words,range,outer,style,box};
}
for(const state of ['deleted control','hidden','inert','aria hidden','transparent','display none','visibility hidden','clipped right','clipped bottom','no boxes'])test('item 674 selected word visibility '+state,()=>{
  const f=geometry();assert.equal(f.c.visibleWords(f.range,f.words),true);
  if(state==='deleted control')f.words.querySelectorAll=()=>[{}];
  if(state==='hidden')f.outer.hidden=true;
  if(state==='inert')f.outer.inert=true;
  if(state==='aria hidden')f.outer.getAttribute=()=> 'true';
  if(state==='transparent')f.style.opacity='0';
  if(state==='display none')f.style.display='none';
  if(state==='visibility hidden')f.style.visibility='hidden';
  if(state==='clipped right')f.box.right=102;
  if(state==='clipped bottom')f.box.bottom=102;
  if(state==='no boxes')f.box.width=0;
  assert.equal(f.c.visibleWords(f.range,f.words),false);
});
test('item 674 clipping guard mutant fails before its exact restored control',()=>redRestore('clipped quote',
  'boxes.some(box => box.left < clip.left - 1 || box.right > clip.right + 1 ||\n          box.top < clip.top - 1 || box.bottom > clip.bottom + 1)',
  'false',s=>{const f=geometry(s);f.box.right=102;assert.equal(f.c.visibleWords(f.range,f.words),false,'clipped words are not quotable');}));

const quoteMethod=readerSource.match(/^  quoteInto\([^\n]*\) \{\n[\s\S]*?^  \}\n/m)[0];
for(const state of ['normal','read only','adopting','recovery'])test('item 674 existing Reader '+state+' keeps exact quote destination writing images To whisper and private owner',()=>{
  const draft={body:'Existing writing',quotes:[{source:{kind:'message',id:'older',revision:1},excerpt:'Earlier'}],attachments:[{media_id:'isolated-image'}],addressees:['aim-ux'],whisper:true};
  const before=structuredClone(draft),editor={draft,adopting:state==='adopting',edit:p=>Object.assign(draft,p)};
  const reader={mode:'reply',sessions:{reply:editor,note:{body:'Private note'}},writes:()=>state!=='read only',narrow:{matches:true},layout:{mode:'stacked'},
    field:{value:draft.body,scrollHeight:100,focus(){},setSelectionRange(){}},insertText(text){this.field.value+=text;},compose:{fit(){}},disarm(){},keepAbove(){},notice:s=>reader.noticeText=s};
  const quote=vm.runInNewContext('({'+quoteMethod+'}).quoteInto',{window:{getSelection:()=>({removeAllRanges(){}})},recoveryReadOnly:()=>state==='recovery',quoteSource:(_,revision)=>({kind:'message',id:'selected-reply',revision})});
  quote.call(reader,'Amber birds',null,7);
  assert.deepEqual(draft.attachments,before.attachments);assert.deepEqual(draft.addressees,before.addressees);assert.equal(draft.whisper,true);assert.equal(reader.sessions.note.body,'Private note');assert.equal(reader.layout.mode,'stacked');
  if(state==='normal'){
    assert.equal(reader.field.value,'Existing writing\n\n> Amber birds\n\n');
    assert.deepEqual(JSON.parse(JSON.stringify(draft.quotes)),[...before.quotes,{source:{kind:'message',id:'selected-reply',revision:7},excerpt:'Amber birds'}]);
  }else{assert.equal(reader.field.value,before.body);assert.deepEqual(draft,before);}
});

test('item 674 a changed native selection releases repaint quarantine, even when the same phrase is selected again',()=>{
  const f=fixture();f.c.invalid={...f.range};
  assert.equal(f.c.capture(),null,'the invalidated selection stays blocked');
  f.selection.isCollapsed=true;
  assert.equal(f.c.capture(),null,'collapsing offers nothing');
  f.selection.isCollapsed=false;
  assert.ok(f.c.capture(),'a deliberate new selection of the same words is eligible again');
});

test('item 674 original repaint quarantine fails reselect then final source restores it',()=>redRestore('reselection quarantine',
  'if (selection?.rangeCount !== 1 || selection.isCollapsed) { this.invalid = null; return null; }',
  'if (selection?.rangeCount !== 1 || selection.isCollapsed) return null;',s=>{
    const f=fixture(s);f.c.invalid={...f.range};assert.equal(f.c.capture(),null);
    f.selection.isCollapsed=true;assert.equal(f.c.capture(),null);f.selection.isCollapsed=false;
    assert.ok(f.c.capture(),'new selection is admitted after an actual collapse');
  }));
const stackSource=readFileSync(new URL('../web/stack-feed.mjs',import.meta.url),'utf8');
const swipeMethod=stackSource.match(/^  swiped\(event\) \{\n[\s\S]*?^  \}\n/m)[0];
function swipeCheck(method){
  const swipe=vm.runInNewContext('({'+method+'}).swiped');
  for(const selected of [true,false]){
    const acts=[],controller={swipe:{x:0,y:10,target:'reply'},doc:{getSelection:()=>({isCollapsed:!selected})},swipeAct:(...args)=>acts.push(args)};
    let prevented=false;
    swipe.call(controller,{changedTouches:[{clientX:110,clientY:10}],altKey:false,preventDefault(){prevented=true;}});
    assert.equal(acts.length,selected?0:1,'selection takes priority, ordinary swipe retains its owner');assert.equal(controller.swipe,null);
    assert.equal(prevented,!selected,'only the qualifying swipe is consumed');
  }
}
test('item 674 swipe selection priority mutant red then restored ordinary swipe contract',()=>{
  const guard='this.doc.getSelection()?.isCollapsed === false || ',mutant=exactMutation(swipeMethod,guard,'');
  assert.throws(()=>swipeCheck(mutant),/selection takes priority/);swipeCheck(swipeMethod);
  console.log(JSON.stringify({name:'item 674 swipe priority',native:false,applied:1,mutant:sha(mutant),restored:sha(swipeMethod),caught:true}));
});

test('item 674 Quote retains its validated words when native focus on the pill collapses selection',()=>{
  const f=fixture(),pill={hidden:false,style:{},offsetWidth:100,offsetHeight:44};
  f.c.pill=pill;f.c.current=f.chosen;f.c.doc.activeElement=pill;
  f.selection.rangeCount=0;f.selection.isCollapsed=true;
  f.c.viewport=()=>({left:0,top:0,right:390,bottom:844});
  f.range.getBoundingClientRect=()=>({left:20,right:100,top:100,bottom:120});
  f.c.update();assert.equal(pill.hidden,false,'keyboard focus keeps the validated offer');
  assert.equal(f.c.current?.excerpt.text,'Amber birds');
  f.words.revision=3;f.c.update();assert.equal(pill.hidden,true,'a changed source still invalidates the focused offer');
});
