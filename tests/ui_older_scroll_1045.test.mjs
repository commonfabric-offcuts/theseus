import test from 'node:test';
import assert from 'node:assert/strict';
import { OlderFeed } from '../web/older-feed.mjs';
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const handlers=new Map(),body={closest:()=>null},doc={body,documentElement:{}},win={scrollY:0,innerHeight:900,getComputedStyle:n=>({overflowY:n.overflow??'visible',overscrollBehaviorY:n.overscroll??'auto'}),addEventListener:(n,fn)=>handlers.set(n,fn),removeEventListener:n=>handlers.delete(n)};
 const feed={isConnected:true,hidden:false,top:150,getBoundingClientRect(){return{top:this.top,height:2500};}},reads=[];let allowed=true,resolve,reject;
 const owner=new OlderFeed({win,doc,feed,ready:()=>allowed,load:()=>{reads.push(1);return new Promise((a,b)=>{resolve=a;reject=b;});},failed:e=>reads.push(e)});
 return{owner,win,feed,reads,handlers,body,allow:v=>allowed=v,emit:(n,e={})=>handlers.get(n)?.({target:body,...e}),resolve:()=>resolve(),reject:()=>reject(Error('read refused'))};
}
test('1045 initial, repaint and downward input do not read; upward attempt at a short top reads once',async()=>{
 const f=fixture();await turn();assert.equal(f.reads.length,0);f.emit('wheel',{deltaY:200});await turn();assert.equal(f.reads.length,0);
 f.emit('wheel',{deltaY:-200});await turn();assert.equal(f.reads.length,1);f.resolve();await turn();assert.equal(f.reads.length,1);
});
test('1045 an upward page scroll crossing the top uses an earlier admitted input',async()=>{
 const f=fixture();f.feed.top=-500;f.win.scrollY=700;f.emit('scroll');f.emit('wheel',{deltaY:-600});await turn();assert.equal(f.reads.length,0);
 f.feed.top=10;f.win.scrollY=100;f.emit('scroll');await turn();assert.equal(f.reads.length,1);f.resolve();await turn();
});
test('1045 programmatic upward scroll without input does not read',async()=>{
 const f=fixture();f.win.scrollY=700;f.feed.top=-500;f.emit('scroll');f.win.scrollY=0;f.feed.top=150;f.emit('scroll');await turn();assert.equal(f.reads.length,0);
});
test('1045 overlapping attempts are dropped, no tail drains history, next attempt can retry',async()=>{
 const f=fixture();for(let i=0;i<12;i++)f.emit('wheel',{deltaY:-20});await turn();assert.equal(f.reads.length,1);f.resolve();await turn();assert.equal(f.reads.length,1);
 f.emit('wheel',{deltaY:-20});await turn();assert.equal(f.reads.length,2);f.reject();await turn();assert.equal(f.reads.at(-1).message,'read refused');
 f.emit('wheel',{deltaY:-20});await turn();assert.equal(f.reads.length,4);f.resolve();await turn();
});
for(const name of ['end','authority','unavailable','another flight'])test(`1045 ${name} admission loads nothing`,async()=>{
 const f=fixture();f.allow(false);f.emit('wheel',{deltaY:-200});await turn();assert.equal(f.reads.length,0);
});
test('1045 writing and nested scrollers keep their own upward input',async()=>{
 const f=fixture();f.emit('wheel',{deltaY:-200,target:{closest:()=>({})}});f.emit('wheel',{deltaY:-200,target:{closest:()=>null,scrollHeight:300,clientHeight:100,overflow:'auto'}});await turn();assert.equal(f.reads.length,0);
});
function scrollCard(f,{scrollTop=0,overscroll='auto',outside=false,outer=f.body}={}){
 const card={scrollHeight:300,clientHeight:100,scrollTop,overflow:'auto',overscroll,parentElement:outer,
  inFeed:!outside,matches:s=>s==='.message-card.scroll-in-place'};
 f.feed.contains=node=>node.inFeed===true;
 return{target:{closest:()=>null,parentElement:card},card};
}
test('55 an upward wheel can reach the older feed through a card at its top edge',async()=>{
 const f=fixture(),{target}=scrollCard(f);
 f.emit('wheel',{target,deltaY:-120});await turn();
 assert.equal(f.reads.length,1);f.resolve();await turn();
});
test('55 an upward wheel through a card can admit a read when the document reaches the feed top',async()=>{
 const f=fixture(),{target}=scrollCard(f);
 f.feed.top=-100;f.win.scrollY=260;f.emit('scroll');f.emit('wheel',{target,deltaY:-120});await turn();
 assert.equal(f.reads.length,0);
 f.feed.top=20;f.win.scrollY=140;f.emit('scroll');await turn();
 assert.equal(f.reads.length,1);f.resolve();await turn();
});
test('55 the card exception respects remaining scroll owners and applies only to ordinary wheel input',async()=>{
 const f=fixture(),scrollable={scrollHeight:400,clientHeight:200,overflow:'auto',parentElement:f.body};
 for(const target of [
   scrollCard(f,{scrollTop:.5}).target,
   scrollCard(f,{overscroll:'contain'}).target,
   scrollCard(f,{overscroll:'none'}).target,
   scrollCard(f,{outside:true}).target,
   scrollCard(f,{outer:scrollable}).target,
   {...scrollable,closest:()=>null,parentElement:scrollCard(f).card},
 ])f.emit('wheel',{target,deltaY:-120});
 const {target}=scrollCard(f);
 f.emit('wheel',{target,deltaY:-120,defaultPrevented:true});
 f.emit('wheel',{target,deltaY:-120,ctrlKey:true});
 f.emit('wheel',{target,deltaY:-120,shiftKey:true});
 f.emit('keydown',{target,key:'ArrowUp'});
 f.emit('touchstart',{target,touches:[{clientY:100}]});
 f.emit('touchmove',{target,touches:[{clientY:200}]});
 await turn();assert.equal(f.reads.length,0);
});
test('1045 a separate rail keeps its wheel; page keys on the body still work',async()=>{
 const f=fixture();f.feed.closest=()=>({contains:n=>n===f.body});f.emit('wheel',{deltaY:-200,target:{closest:()=>null}});await turn();assert.equal(f.reads.length,0);
 f.emit('keydown',{key:'Home'});await turn();assert.equal(f.reads.length,1);f.resolve();await turn();
});
test('1045 keyboard and touch at the top load without cancelling or assigning focus',async()=>{
 for(const kind of ['keyboard','touch']){const f=fixture();if(kind==='keyboard')f.emit('keydown',{key:'Home'});else{f.emit('touchstart',{touches:[{clientY:100}]});f.emit('touchmove',{touches:[{clientY:300}]});}await turn();assert.equal(f.reads.length,1,kind);f.resolve();await turn();}
});
test('1045 disposal removes every listener and drops a scheduled read',async()=>{
 const f=fixture();f.emit('wheel',{deltaY:-200});f.owner.dispose();await turn();assert.equal(f.reads.length,0);assert.equal(f.handlers.size,0);
});
test('1045 a touch crossing the top admits one page for that gesture, even after settlement',async()=>{
 const f=fixture();f.feed.top=-500;f.win.scrollY=700;f.emit('scroll');f.emit('touchstart',{touches:[{clientY:100}]});f.emit('touchmove',{touches:[{clientY:200}]});
 f.feed.top=50;f.win.scrollY=0;f.emit('scroll');await turn();assert.equal(f.reads.length,1);f.resolve();await turn();
 f.emit('touchmove',{touches:[{clientY:300}]});await turn();assert.equal(f.reads.length,1,'the admitted touch gesture is not a fresh attempt after settlement');
 f.emit('touchend',{touches:[]});f.emit('touchstart',{touches:[{clientY:100}]});f.emit('touchmove',{touches:[{clientY:200}]});await turn();assert.equal(f.reads.length,2);f.resolve();await turn();
});
test('1045 a completed touch can coast to the top; a cancelled touch cannot',async()=>{
 for(const end of ['touchend','touchcancel']){const f=fixture();f.feed.top=-500;f.win.scrollY=700;f.emit('scroll');f.emit('touchstart',{touches:[{clientY:100}]});f.emit('touchmove',{touches:[{clientY:200}]});f.emit(end,{touches:[]});f.feed.top=30;f.win.scrollY=0;f.emit('scroll');await turn();assert.equal(f.reads.length,end==='touchend'?1:0,end);if(f.reads.length)f.resolve();await turn();}
});
