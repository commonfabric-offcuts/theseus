import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLook783 } from './cover_783_oracle.mjs';
import { assertBuild783, assertFailure783 } from './cover_783_comparator.mjs';
export const good783 = { first:true, visible:true, background:'rgb(233, 229, 218)', folderBackground:'rgb(233, 229, 218)',
  shadow:'rgba(70, 60, 40, 0.16) 0px 1px 3px inset, rgba(255, 255, 255, 0.55) 0px -1px 0px inset',
  cover:{top:60,bottom:150,left:8,right:300,width:292,height:90},tab:{bottom:60},folder:{left:0,right:310},faces:[{top:151}],overflow:0 };
test('783 comparator accepts specific real oracle failures and restored pass',()=>{
  for(const phase of ['original','flat','wrong-order','wrong-background','outer-shadow']) {
    const at=structuredClone(good783);
    if(['original','wrong-order'].includes(phase))at.first=false;
    if(['flat','outer-shadow'].includes(phase))at.shadow='none';
    if(phase==='wrong-background')at.background='rgb(255, 255, 255)';
    const receipt=assertBuild783(at,phase);console.log(JSON.stringify({phase,receipt}));
  }
  assert.deepEqual(assertBuild783(good783,'restored'),{restored:true});
});
test('783 comparator rejects no throw, unrelated error, wrong oracle and wrong structured fields',()=>{
  assert.throws(()=>assertBuild783(good783,'original'));
  assert.throws(()=>assertFailure783(new Error('783 cover is first child'),'original',good783));
  let wrong;try{assertLook783({...good783,visible:false});}catch(e){wrong=e;}
  assert.throws(()=>assertFailure783(wrong,'original',good783));
  let intended;try{assertLook783({...good783,first:false});}catch(e){intended=e;}
  // Message formatting is deliberately irrelevant.
  intended.message += '\nNode diagnostic suffix may vary';
  assertFailure783(intended,'original',good783);
  for(const [key,value] of [['oracle783','783.inset-pair'],['actual',1],['expected',false],['operator','=='],['code','OTHER']]) {
    const old=intended[key];intended[key]=value;
    assert.throws(()=>assertFailure783(intended,'original',good783),key);intended[key]=old;
  }
  assert.throws(()=>assertBuild783({...good783,first:false},'restored'));
  assert.throws(()=>assertBuild783({...good783,first:false},'unknown'));
});

test('783 LF painted-line geometry uses named realistic tolerance and crossing controls',async()=>{
  const {assertLines783,page783,WORDS783,TOLERANCE783}=await import('./cover_783_oracle.mjs');
  const vm=await import('node:vm');const text=WORDS783.stands;
  const w={textContent:text,firstChild:{}};
  const context=vm.createContext({document:{querySelector:()=>({querySelector:()=>w}),createRange:()=>{
    let start=0;return {setStart:(_,n)=>start=n,setEnd:()=>{},getBoundingClientRect:()=>({top:60+text.slice(0,start).split('\n').length*20,height:20})};
  }},getComputedStyle:()=>({lineHeight:'20px'})});
  const at=JSON.parse(JSON.stringify(new vm.Script(page783.lines('sheet')).runInContext(context)));
  assertLines783(at);
  const boundary=structuredClone(at);boundary.rects[1].top+=TOLERANCE783.line;assertLines783(boundary);
  for(const mutate of [x=>x.rects[1].top+=3,x=>x.rects[1].top=x.rects[0].top,x=>x.rects[1].height+=3,x=>x.rects[1].height=0.5]) {
    const changed=structuredClone(at);mutate(changed);assert.throws(()=>assertLines783(changed));
  }
});
