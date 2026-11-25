import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {keepPendingSendPlace} from '../web/pending-sends.mjs';

const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
function actual(name) {
  const a=source.indexOf('function '+name+'('), b=source.indexOf('\n}',a);
  assert.ok(a>=0&&b>a,name);return source.slice(a,b+2);
}
function fixture({y=0, height=1400, cardTop=730, before='', priority=''}={}) {
  let docTop=cardTop+y, active;
  const writes=[],scrolls=[],values=new Map(),priorities=new Map();
  const style={
    getPropertyValue:k=>values.get(k)??'',getPropertyPriority:k=>priorities.get(k)??'',
    setProperty(k,v,p=''){values.set(k,String(v));priorities.set(k,p);writes.push(['set',k,String(v),p]);},
    removeProperty(k){values.delete(k);priorities.delete(k);writes.push(['remove',k]);}
  };
  if(before)style.setProperty('padding-top',before,priority);
  const padding=side=>parseFloat(style.getPropertyValue(side))||0;
  const win={scrollY:y,innerHeight:900,addEventListener(){},removeEventListener(){},
    scrollBy({top}){scrolls.push(top);this.scrollY=Math.max(0,Math.min(Math.max(0,height+padding('padding-top')+padding('padding-bottom')-900),this.scrollY+top));}};
  const list={style,isConnected:true,hidden:false,contains:n=>n===card||n===link,
    compareDocumentPosition:()=>4,getBoundingClientRect:()=>({top:padding('padding-top')-win.scrollY})};
  const card={dataset:{id:'canonical',seq:'2',pendingSend:'A'},isConnected:true,
    getBoundingClientRect:()=>({top:docTop+padding('padding-top')-win.scrollY,bottom:docTop+padding('padding-top')-win.scrollY+100,height:100,left:0,width:600}),
    getClientRects:()=>[{}],contains:n=>n===card||n===link,
    closest:q=>q==='[data-pending-send]'?card:null,focus(){active=card;},
    compareDocumentPosition:()=>0};
  const link={closest:()=>card,focus(){active=link;}};
  const outside={tagName:'BUTTON',closest:()=>null,focus(){active=outside;}};
  const body={};
  const doc={body,get activeElement(){return active;},set activeElement(v){active=v;},defaultView:win,
    getSelection:()=>({isCollapsed:true}),addEventListener(){},removeEventListener(){},querySelectorAll:()=>[card],
    documentElement:{get scrollHeight(){return height+padding('padding-top')+padding('padding-bottom');}}};
  list.ownerDocument=doc;list.querySelectorAll=()=>card.dataset.pendingSend?[card]:[];
  const home={style,open:false,parentElement:list,contains:()=>false};
  const main={contains:()=>false,addEventListener(){},removeEventListener(){}};
  const observers=[];
  class Observer{constructor(cb){this.cb=cb;observers.push(this);}observe(){}unobserve(){}disconnect(){this.stopped=true;}takeRecords(){return [];}}
  const c=vm.createContext({document:doc,window:win,innerHeight:900,innerWidth:1512,
    $:id=>({messages:list,main,'new-message-sheet':home})[id],
    getComputedStyle:n=>({getPropertyValue:k=>n.style.getPropertyValue(k)}),Node:{DOCUMENT_POSITION_FOLLOWING:4},
    roomy:null,anchorHold:null,listActAnchor:null,retired:false,topicUnavailable:false,anchorDepth:0,anchorActing:false,anchorWatch:null,
    inline:null,registry:{},views:{},typingField:()=>false,actedListCard:()=>null,firstInView:()=>card,
    entries:()=>[card],drawn:()=>true,loadedAfter:()=>null,retainArrivalAnchor:()=>{},newAbove:new Set(),
    ResizeObserver:Observer,MutationObserver:Observer,stackState:()=>({waiting:new Set()}),
    rememberListAnchor:()=>{},arrivalLayoutChanged:()=>false,requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  for(const n of ['restorePendingSendPlace','holdRoom','captureListAnchor','restoreListAnchor','watchListAnchor'])
    vm.runInContext(actual(n),c,{filename:'actual-app:'+n});
  active=card;
  return {c,doc,win,list,card,link,outside,style,writes,scrolls,home,observers,
    move:n=>{docTop+=n;},top:()=>card.getBoundingClientRect().top,call:(name,...args)=>c[name](...args),
    release:()=>{c.roomy?.();c.roomy=null;}};
}
for(const owner of ['card','link','outside'])test('1275 send underflow settles without room and next list paint cannot recreate it: '+owner,()=>{
  const f=fixture();f[owner].focus();const focus=f.doc.activeElement;
  keepPendingSendPlace(f.list,()=>{f.move(-123.4921875);delete f.card.dataset.pendingSend;return {pendingReplacement:f.card};},
    {restore:(...a)=>f.call('restorePendingSendPlace',...a)});
  assert.equal(f.style.getPropertyValue('padding-top'),'');
  assert.equal(f.top(),606.5078125,'natural start wins over an unreachable old coordinate');
  assert.equal(f.doc.activeElement,focus);
  const saved=f.call('captureListAnchor');saved.baseline=true;
  f.call('restoreListAnchor',saved);
  assert.equal(f.style.getPropertyValue('padding-top'),'','later refresh must not recreate send room');
  assert.equal(f.top(),606.5078125);
});
test('1275 send overflow uses natural end without bottom room',()=>{
  const f=fixture({y:500,height:1400,cardTop:700});f.move(150);
  f.call('restorePendingSendPlace',f.card,700);
  assert.equal(f.style.getPropertyValue('padding-bottom'),'');assert.equal(f.win.scrollY,500);assert.equal(f.top(),850);
});
test('1275 send within natural range keeps exact top without room',()=>{
  const f=fixture({y:400,height:3000,cardTop:200});f.move(-123);
  f.call('restorePendingSendPlace',f.card,200);
  assert.equal(f.top(),200);assert.equal(f.win.scrollY,277);assert.equal(f.c.roomy,null);
});
test('1275 send replaces inner generic room before its final natural-range measurement',()=>{
  const f=fixture();f.move(-125);
  f.call('holdRoom',f.list,f.card,730);
  assert.equal(f.style.getPropertyValue('padding-top'),'125px');
  f.call('restorePendingSendPlace',f.card,730);
  assert.equal(f.style.getPropertyValue('padding-top'),'');assert.equal(f.top(),605);
});
for(const kind of ['textarea','selection'])test('1275 pending keeper leaves newer '+kind+' ownership alone',()=>{
  const f=fixture();
  const next={tagName:'TEXTAREA',closest:()=>null};f.doc.activeElement=kind==='textarea'?next:f.outside;
  if(kind==='selection')f.doc.getSelection=()=>({isCollapsed:false});
  keepPendingSendPlace(f.list,()=>f.move(-100),{restore:(...a)=>f.call('restorePendingSendPlace',...a)});
  assert.equal(f.scrolls.length,0);assert.equal(f.style.getPropertyValue('padding-top'),'');
});
test('1275 legitimate reading hold retains missing range and releases it',()=>{
  const f=fixture();f.move(-100);const delta=f.call('holdRoom',f.list,f.card,730);
  assert.equal(delta,0);assert.equal(f.top(),730);assert.equal(f.style.getPropertyValue('padding-top'),'100px');
  f.release();assert.equal(f.top(),630);assert.equal(f.style.getPropertyValue('padding-top'),'');
});
test('1275 legitimate acted card room restores existing inline value and priority',()=>{
  const f=fixture({before:'20px',priority:'important'});const before=f.top();f.move(-100);
  f.call('holdRoom',f.list,f.card,before,undefined,true);assert.equal(f.top(),before);
  f.release();assert.equal(f.style.getPropertyValue('padding-top'),'20px');assert.equal(f.style.getPropertyPriority('padding-top'),'important');
});
test('1275 stale cleanup cannot clear newer equal-valued room',()=>{
  const f=fixture();f.move(-100);f.call('holdRoom',f.list,f.card,730);const old=f.c.roomy;
  f.release();f.call('holdRoom',f.list,f.card,730);const newer=f.c.roomy,value=f.style.getPropertyValue('padding-top');
  old();assert.equal(f.style.getPropertyValue('padding-top'),value);assert.equal(f.c.roomy,newer);
});
test('1275 external style change is not overwritten by old room cleanup',()=>{
  const f=fixture();f.move(-100);f.call('holdRoom',f.list,f.card,730);
  f.style.setProperty('padding-top','77px','important');f.release();
  assert.equal(f.style.getPropertyValue('padding-top'),'77px');assert.equal(f.style.getPropertyPriority('padding-top'),'important');
});
test('1275 generic room restores preceding inline CSS value',()=>{
  const f=fixture({before:'20px',priority:'important'}),before=f.top();f.move(-100);
  f.call('holdRoom',f.list,f.card,before);f.release();
  assert.equal(f.style.getPropertyValue('padding-top'),'20px');assert.equal(f.style.getPropertyPriority('padding-top'),'important');
});
test('1275 stopping page anchor watcher releases room and observers',()=>{
  const f=fixture();f.move(-100);f.call('holdRoom',f.list,f.card,730);f.call('watchListAnchor');f.c.anchorWatch.stop();
  assert.equal(f.style.getPropertyValue('padding-top'),'');assert.equal(f.c.roomy,null);assert.ok(f.observers.every(o=>o.stopped));
});

test('1275 writing composer retains its separate hold-room value and releases it',()=>{
  const f=fixture();let value='',priority='';
  f.home.contains=n=>n===f.card;
  f.home.style={getPropertyValue:()=>value,getPropertyPriority:()=>priority,
    setProperty(_k,v,p=''){value=v;priority=p;},removeProperty(){value='';priority='';}};
  const position=()=>50+(parseFloat(value)||0);
  const delta=f.call('holdRoom',f.list,f.card,100,position);
  assert.equal(delta,0);assert.equal(value,'50px');assert.equal(f.style.getPropertyValue('padding-top'),'');
  f.release();assert.equal(value,'');
});
test('1275 acted card at natural bottom retains explicit action room',()=>{
  const f=fixture({y:500,height:1400,cardTop:700});f.move(150);
  const delta=f.call('holdRoom',f.list,f.card,700,undefined,true);f.win.scrollBy({top:delta});
  assert.equal(f.top(),700);assert.equal(f.style.getPropertyValue('padding-bottom'),'150px');
  f.release();assert.equal(f.style.getPropertyValue('padding-bottom'),'');
});

test('1275 zero-delta inner hold still enters send cleanup before generic recapture',()=>{
  const f=fixture(),before=f.top();f.link.focus();
  keepPendingSendPlace(f.list,()=>{
    f.move(-123.4921875);delete f.card.dataset.pendingSend;
    f.call('holdRoom',f.list,f.card,before);
    assert.equal(f.top(),before,'the inner generic hold makes the outer delta zero');
    return {pendingReplacement:f.card};
  },{restore:(...a)=>f.call('restorePendingSendPlace',...a)});
  assert.equal(f.style.getPropertyValue('padding-top'),'','zero motion does not extend send-room ownership');
  assert.equal(f.top(),606.5078125);assert.equal(f.doc.activeElement,f.link);
  const saved=f.call('captureListAnchor');saved.baseline=true;f.call('restoreListAnchor',saved);
  assert.equal(f.style.getPropertyValue('padding-top'),'');
});
test('1275 zero-delta default pending keeper does not issue a scroll',()=>{
  const f=fixture();keepPendingSendPlace(f.list,()=>{}, {scroll:()=>assert.fail('zero delta cannot scroll')});
  assert.equal(f.scrolls.length,0);assert.equal(f.doc.activeElement,f.card);
});
