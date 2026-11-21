import assert from 'node:assert/strict';

// Event and geometry ports for the actual persistent viewport reader.
let serial=0;
export async function viewport991(options,run){
 const saved=new Map(),set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const frames=new Map(),vvEvents=new Map(),docEvents=new Map(),moves=[],css=new Map();let frame=0;
 const state={boxTop:600,boxBottom:750,sendBottom:794,width:390,visible:true,connected:true,scrollY:0,composerScroll:0,...options};
 const rect=(top,bottom)=>({top,bottom,height:bottom-top}),shown=()=>state.visible?[rect(state.boxTop,state.boxBottom)]:[];
 const doc={activeElement:null,documentElement:{style:{setProperty:(k,v)=>css.set(k,v)}},body:{},addEventListener:(k,v)=>docEvents.set(k,v),removeEventListener:k=>docEvents.delete(k)};
 const composer={parentElement:doc.body,ownerDocument:doc,clientTop:0,clientHeight:300,scrollHeight:900,
  get scrollTop(){return state.composerScroll;},set scrollTop(n){const d=n-state.composerScroll;scroll('composer',d);},
  getBoundingClientRect:()=>rect(100,400),getClientRects:shown,
  closest:s=>s.includes('card-reply')?(state.internal?null:composer):s.includes('.composer')?composer:null,
  querySelector:s=>s.includes('compose-send')?send:s.includes('plus-button')?plus:s.includes('field-box')?box:s.includes('textarea')?field:null,
  scrollBy:({top})=>scroll('composer',top)};
 const box={parentElement:composer,ownerDocument:doc,getBoundingClientRect:()=>rect(state.boxTop,state.boxBottom),getClientRects:shown,closest:s=>s.includes('.composer')?composer:null};
 const send={getBoundingClientRect:()=>rect(state.sendBottom-40,state.sendBottom),getClientRects:shown},plus={getBoundingClientRect:()=>rect(state.sendBottom-40,state.sendBottom),getClientRects:shown};
 const field={tagName:'TEXTAREA',ownerDocument:doc,parentElement:box,value:'Keep this writing.',readOnly:false,selectionStart:3,selectionEnd:7,
  get isConnected(){return state.connected;},getClientRects:shown,getBoundingClientRect:()=>rect(state.boxTop,state.boxBottom),
  matches:()=>true,closest:s=>s.includes('#reader')||s.includes('card-reply')?(state.internal?null:composer):s.includes('field-box')?box:s.includes('.composer')?composer:null};
 function scroll(who,by){if(!by)return;moves.push({who,by});state.boxTop-=by;state.boxBottom-=by;state.sendBottom-=by;if(who==='window')state.scrollY+=by;else state.composerScroll+=by;}
 const vv={width:state.width,height:844,offsetTop:0,scale:1,addEventListener:(k,v)=>vvEvents.set(k,v),removeEventListener:k=>vvEvents.delete(k)};
 try{
  set('document',doc);set('visualViewport',vv);set('innerHeight',844);set('innerWidth',state.width);set('scrollBy',({top})=>scroll('window',top));set('scrollY',0);
  set('matchMedia',()=>({matches:state.width<=760}));set('getComputedStyle',n=>({overflowY:n===composer&&state.internal?'auto':'visible',position:'static',scrollPaddingBottom:'8px'}));
  set('requestAnimationFrame',fn=>{frames.set(++frame,fn);return frame;});set('cancelAnimationFrame',id=>frames.delete(id));doc.defaultView=globalThis;
  await import(`../../web/compose-bar.mjs?991=${++serial}`);
  const emit=(type,change={})=>{Object.assign(vv,change);vvEvents.get(type)?.({type});};
  const focus=()=>{doc.activeElement=field;docEvents.get('focusin')?.({type:'focusin',target:field});};
  const input=()=>docEvents.get('input')?.({type:'input',target:field});
  const pump=()=>{for(let n=0;frames.size&&n<8;n++){const batch=[...frames];frames.clear();for(const[,fn]of batch)fn();}assert.equal(frames.size,0,'settling terminates');};
  await run({state,doc,field,box,composer,vv,moves,frames,css,emit,focus,input,pump});
 }finally{for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
}

