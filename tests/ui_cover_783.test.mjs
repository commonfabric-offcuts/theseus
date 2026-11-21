import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { expression783, assertLook783, assertWords783, WORDS783, page783 } from './cover_783_oracle.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { names783, coverChecks783 } from './cover_783_native.mjs';
const good = {first:true,visible:true,background:'rgb(1, 2, 3)',folderBackground:'rgb(1, 2, 3)',shadow:'rgb(0, 0, 0) 0px 1px 3px inset, rgb(255, 255, 255) 0px -1px 0px inset',
  cover:{top:60,bottom:150,left:8,right:300,width:292,height:90},tab:{bottom:60},folder:{left:0,right:310},faces:[{top:151}],overflow:0,
  stands:WORDS783.stands,payload:'Payload · answer '+WORDS783.payload+' payload proposed',waits:['Waits on you '+WORDS783.wait+'Default: '+WORDS783.default+'.'],links:[{text:'#12',href:'/?topic=t&message=a'}]};
const clone = x=>structuredClone(x);
test('783 geometry tolerances catch wrong ordering, containment, overflow, face overlap and visibility',()=>{
  assertLook783(good);assertWords783(good);
  for(const mutate of [a=>a.first=false,a=>a.cover.top=58,a=>a.cover.left=-2,a=>a.cover.right=312,a=>a.faces[0].top=148,a=>a.overflow=2,a=>a.visible=false,
    a=>a.shadow=a.shadow.replace('3px','30px'),a=>a.background='rgb(99, 99, 99)',a=>a.shadow='none',a=>a.shadow=a.shadow.replaceAll('inset','')]) {
    const bad=clone(good);mutate(bad);assert.throws(()=>assertLook783(bad),{name:'AssertionError'});
  }
  const boundary=clone(good);boundary.cover.top=59;boundary.cover.left=-1;boundary.cover.right=311;boundary.faces[0].top=149;boundary.overflow=1;assertLook783(boundary);
  for(const k of ['stands','payload','waits','links']) {const a=clone(good);a[k]=k==='waits'||k==='links'?[]:'changed';assert.throws(()=>assertWords783(a));}
});
function pageModel() {
  const rect=(b)=>({getBoundingClientRect:()=>b,getClientRects:()=>[b]});
  const words={textContent:good.payload},stands={textContent:good.stands},wait={textContent:good.waits[0]},link={textContent:'#12',getAttribute:()=>good.links[0].href};
  const face=rect({top:151,bottom:190,height:39,width:280,left:8,right:288});
  const card={...rect({top:150,bottom:200,height:50}),dataset:{id:'a',starred:'false'},className:'message-card agent-card agent-blue',querySelector:s=>s==='.message-preview'?face:s==='.author-name'?{textContent:'Fixture author'}:s===':scope > .row-pills'?{previousElementSibling:{className:'message-author'},textContent:'payload proposed'}:null};
  const cover={...rect(good.cover),querySelector:s=>s==='.cover-stands'?stands:s==='.cover-payload .cover-words'?words:null,querySelectorAll:s=>s==='.cover-wait'?[wait]:s==='a'?[link]:[]};
  const folder={...rect(good.folder),dataset:{fold:'folded'},firstElementChild:cover,querySelector:s=>s.includes('dossier-cover')?cover:s==='.stack-head'?rect({bottom:60}):null,querySelectorAll:s=>s==='.message-card'?[card]:[]};
  const reader={...folder,...rect({bottom:50}),open:true};
  const cite={}; const document={activeElement:cite,documentElement:{scrollWidth:320},querySelector:s=>s==='cite'?cite:s==='toggle'?{dataset:{state:'folded'}}:s.includes('stack-name')?{textContent:'Literal dossier 783'}:s.includes('data-id="private"')?null:s.includes('data-id="lone"')?card:s==='#reader-cover'?reader:s==='#source-body'?rect({top:51}):s.startsWith('script')?{src:'/b/stamp/app.mjs'}:folder,querySelectorAll:()=>[card]};
  return {document,innerWidth:320,getComputedStyle:e=>({backgroundColor:good.background,boxShadow:good.shadow})};
}
test('783 exact generated expressions compile and execute below browser in deliberate page models',()=>{
  const context=vm.createContext(pageModel());
  for(const root of ['r','r-with-punctuation']) {
    const result=new vm.Script(expression783(root)).runInContext(context);
    const plain=JSON.parse(JSON.stringify(result));assertLook783(plain);assertWords783(plain);
    assert.equal(new vm.Script(expression783(root,'#reader-cover')).runInContext(context).visible,true);
  }
  for(const [name,args,want] of [['state',['toggle'],'folded'],['title',['s'],'Literal dossier 783'],['privateDrawn',['private'],false],['focused',['cite'],true],['readerOpen',[],true],['readerOrder',[],true],['build',['stamp'],true]])
    assert.equal(new vm.Script(page783[name](...args)).runInContext(context),want,name);
  assert.deepEqual(JSON.parse(JSON.stringify(new vm.Script(page783.colors()).runInContext(context))),{a:['agent-card','agent-blue']});
  assert.deepEqual(JSON.parse(JSON.stringify(new vm.Script(page783.lone('lone')).runInContext(context))),{after:'message-author',words:'payload proposed',sheet:false});
});
test('783 literal cover renderer preserves HTML-looking punctuation as text and cites the exact payload',()=>{
  const doc=miniDocument(),c=coverSheet(doc,{owner:'owner',stands:WORDS783.stands,waiting:[{text:WORDS783.wait,default:WORDS783.default}],payload:{text:WORDS783.payload,message_id:'answer',seq:12,kind:'answer'}},{viewer:'owner',nameOf:x=>x,topicId:'t'});
  assert.equal(c.children[0].text,WORDS783.stands);assert.equal(c.children[1].children[0].text,good.payload);assert.equal(c.children[2].text,good.waits[0]);
  assert.equal([...c.descendants()].filter(n=>n.tag==='literal').length,0);
});
test('783 dry enumeration invokes no actions and owns precisely nine literal-prefix cases',async()=>{
  const names=[];await coverChecks783({check:async(n)=>names.push(n)},{});assert.deepEqual(names,names783);assert.equal(names.length,9);assert.ok(names.every(n=>/^reading item 783/.test(n)));console.log(JSON.stringify({enumerated:names}));
});
test('783 all new page evaluations use the locally executed expression generators',async()=>{
  const s=await readFile(new URL('./cover_783_native.mjs',import.meta.url),'utf8');
  for(const line of s.split('\n').filter(l=>l.includes('p.evaluate('))) assert.match(line,/p\.evaluate\((page783\.|expression783\()/,line);
});
