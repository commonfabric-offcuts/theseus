import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pressDepartureDrawer, DEPARTURE_CONTROL_TOLERANCE_PX } from './reader_departure_native.mjs';

// Execute the actual page expressions and FELL listener. This is a deterministic
// geometry/event control, not browser evidence: scroll completion and redraws
// are driven by frames; the transport dispatches the observed pointerdown.
function fixture({drift=0,jitter=0,covered=false,miss=false}={}) {
  const state={y:-129.8125,frames:0,scrolls:0,moves:0,commands:[],pendingScroll:false};
  const listeners=new Map();
  class Element {
    constructor(id){this.id=id;this.tagName=id==='rail-open'?'BUTTON':'SECTION';this.className='';}
    contains(e){return e===this;}
    getBoundingClientRect(){return {x:16,y:state.y,top:state.y,bottom:state.y+44,left:16,right:120.25,width:104.25,height:44};}
    scrollIntoView(){state.scrolls++;state.pendingScroll=true;}
  }
  const control=new Element('rail-open'),neighbour=new Element('topic-people');
  const document={body:{dataset:{ready:'true'}},documentElement:{hasAttribute:()=>false},
    querySelector:s=>{if(s==='#rail-open')return control;if(s==='#retry-topics[aria-disabled]')return null;throw Error(s);},
    elementFromPoint:(x,y)=>!covered&&x>=16&&x<120.25&&y>=state.y&&y<state.y+44?control:neighbour};
  const context=vm.createContext({document,Element,innerHeight:844,innerWidth:390,
    requestAnimationFrame:callback=>{
      state.frames++;
      if(state.pendingScroll){state.y=19.1875;state.pendingScroll=false;}
      state.y+=drift+(state.frames%2?jitter:-jitter);callback();
    },
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}});
  vm.runInContext('window=globalThis',context);
  const p={evaluate:async expression=>vm.runInContext(expression,context),send:async(method,params)=>{
    assert.equal(method,'Input.dispatchMouseEvent');state.commands.push(params);
    if(params.type==='mouseMoved') {state.moves++;state.y+=70;}
    if(params.type==='mousePressed') listeners.get('pointerdown')?.({target:miss?neighbour:document.elementFromPoint(params.x,params.y)});
  }};
  const until=async(probe,what)=>{for(let n=0;n<30;n++){const value=await probe();if(value)return value;}throw Error('Timed out: '+what);};
  return {p,state,until};
}
test('departure second drawer reveals y=-129.8125, settles, and re-aims after scroll/hover with named 1 CSS px tolerance',async()=>{
  const f=fixture({jitter:.25});await pressDepartureDrawer(f.p,f.until);
  assert.ok(f.state.scrolls>0);assert.ok(f.state.frames>=8,'frame settlement both before and after hover');
  assert.deepEqual(f.state.commands.map(c=>c.type),['mouseMoved','mousePressed','mouseReleased']);
  const down=f.state.commands[1];
  assert.ok(Math.abs(down.y-(f.state.y+22))<=DEPARTURE_CONTROL_TOLERANCE_PX,'press uses the post-hover position within named tolerance');
  assert.ok(down.y-f.state.commands[0].y>60,'the press does not reuse the earlier aim');
});
test('departure control drifting 8 CSS px per frame cannot pass the named 1 CSS px tolerance',async()=>{
  const f=fixture({drift:8});await assert.rejects(pressDepartureDrawer(f.p,f.until),/Timed out: departure drawer/);
  assert.equal(f.state.commands.length,0,'no gesture at a moving target');
});
test('departure a covered actual control fails before native down',async()=>{
  const f=fixture({covered:true});await assert.rejects(pressDepartureDrawer(f.p,f.until),/native drawer press hits its actual control/);
  assert.equal(f.state.commands.some(c=>c.type==='mousePressed'),false);
});
test('departure wrong actual pointerdown retains the hit assertion and releases the button',async()=>{
  const f=fixture({miss:true});await assert.rejects(pressDepartureDrawer(f.p,f.until),/actual native drawer pointerdown stays on its control/);
  assert.equal(f.state.commands.at(-1).type,'mouseReleased');
});
