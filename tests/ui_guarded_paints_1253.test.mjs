import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HealthLight, CHECKING_WORDS, UNREAD_WORDS, LIT_WORDS } from '../web/health-light.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8'),outline=readFileSync(new URL('../web/outline-rail.mjs',import.meta.url),'utf8');
const from=app.indexOf('function paintStarredStatus()'),until=app.indexOf('// The fallback is a real canonical dossier route',from);assert.ok(from>=0&&until>from);const starredCode=app.slice(from,until);
const a=outline.indexOf('  paint() {'),b=outline.indexOf('  // On a phone:',a);assert.ok(a>=0&&b>a);const outlineCode='function paint()'+outline.slice(a+'  paint()'.length,b);
// Count requested setters, not style recalculation, exact pixels or native focus.
function target(text=''){
 let words=text,hidden=false;const writes=[],attrs=new Map(),classes=new Set();
 return {writes,get textContent(){return words;},set textContent(v){writes.push(['text',v]);words=v;},get hidden(){return hidden;},set hidden(v){writes.push(['hidden',v]);hidden=v;},
 getAttribute:k=>attrs.get(k)??null,setAttribute(k,v){writes.push(['attribute',k,String(v)]);attrs.set(k,String(v));},removeAttribute(k){writes.push(['remove',k]);attrs.delete(k);},
 classList:{contains:k=>classes.has(k),toggle(k,on){writes.push(['class',k,on]);if(on)classes.add(k);else classes.delete(k);}},reset(){writes.length=0;}};
}
function health(){const link=target('Health'),state={feed:'live',reads:0};const owner=new HealthLight({link,feed:()=>state.feed,read:async()=>{state.reads++;return {red:[],commit_seq:1};}});return {link,state,owner};}
function setHealth(f,kind){f.owner.best=kind==='checking'?null:{seq:1,red:kind==='lit'?['runner']:[]};f.owner.known=1;f.owner.floor=1;f.state.feed=kind==='unread'?'down':'live';}
test('1253 actual Health paint repeats every standing state without text/class/aria setter calls',()=>{
 const f=health();for(const kind of ['checking','quiet','lit','unread']){setHealth(f,kind);f.owner.paint();f.link.reset();for(let i=0;i<100;i++)f.owner.paint();assert.deepEqual(f.link.writes,[],kind);}
});
test('1253 Health state and accessible labels still change, including externally altered DOM',()=>{
 const f=health();for(const [kind,words,label,red] of [['checking',CHECKING_WORDS,null,false],['lit',LIT_WORDS,'Health: something needs attention',true],['unread',UNREAD_WORDS,'Health: it could not be checked, so something may need attention',true],['quiet','Health',null,false]]){setHealth(f,kind);f.owner.paint();assert.equal(f.link.textContent,words);assert.equal(f.link.getAttribute('aria-label'),label);assert.equal(f.link.classList.contains('red'),red);}
 f.link.textContent='wrong';f.link.setAttribute('aria-label','wrong');f.link.classList.toggle('red',true);f.owner.paint();assert.equal(f.link.textContent,'Health');assert.equal(f.link.getAttribute('aria-label'),null);assert.equal(f.link.classList.contains('red'),false);
});
test('1253 actual Health feed takes newer facts without duplicate paints or reads',()=>{
 const f=health();f.owner.heard({kind:'commit',seq:1,health:{seq:1,red:[]}});f.link.reset();for(let seq=2;seq<100;seq++)f.owner.heard({kind:'commit',seq,health:{seq,red:[]}});assert.deepEqual(f.link.writes,[]);assert.equal(f.state.reads,0);f.owner.heard({kind:'commit',seq:100,health:{seq:100,red:['runner']}});assert.equal(f.link.textContent,LIT_WORDS);f.state.feed='down';f.owner.heard({kind:'state',state:'down'});assert.equal(f.link.textContent,UNREAD_WORDS);
});
function rail(){
 const r=renderer799(),doc=r.list.ownerDocument,node=()=>doc.createElement('span'),topics=target(),item={id:'outcome',title:'Outcome',unread:0,provisional:true},flags={open:true};
 const row={li:node(),topics,disclosure:node(),own:node(),name:node(),title:node(),standing:node(),fold:{dispose(){},soon(){}}};
 const controls={handles:{route:{kind:'topic'}},doc,list:r.list,outcomes:new Map([[item.id,row]]),pages:{items:[item],started:true,next:null},filter:null,shownItems:()=>[item],outcome:()=>row,isOpen:()=>flags.open,phoneQuestionControl(){},nameTarget:()=>({kind:'workspace',id:item.id}),newCount:node(),waitingCount:node(),onlyNew:node(),onlyWaiting:node(),host:node(),empty:node(),message:node(),retry:node(),more:node(),paintHeader(){},dossiers:{sync(){}},notebookStars:{sync(){}},publishTopics(){},dimming:{paintRows(){}}};
 const ports={arrangeItems:x=>x,book:{ids:()=>[]},scopeOf:()=>null,shownUnder:()=>true,outcomeColors:{forDisplay:()=>null},count:n=>n??0,waitingIn:()=>0,rowCount:()=>0,routeHref:()=>'',arrange(){},totals:()=>({fresh:0,waiting:0})};
 const paint=new Function(...Object.keys(ports),outlineCode+';return paint;')(...Object.values(ports));
 const run=()=>{row.said=JSON.stringify([item.title,item.title_truncated,0,item.light,flags.open]);return paint.call(controls);};return {row,topics,flags,controls,run};
}
test('1253 actual outline owner preserves topics hidden without repeated identical assignments',()=>{
 const f=rail();f.run();f.topics.reset();for(let i=0;i<100;i++)f.run();assert.deepEqual(f.topics.writes,[]);f.flags.open=false;f.run();assert.equal(f.topics.hidden,true);assert.deepEqual(f.topics.writes,[['hidden',true]]);f.topics.reset();for(let i=0;i<50;i++)f.run();assert.deepEqual(f.topics.writes,[]);
});
test('1253 outline still corrects external visibility and stops when no page is bound',()=>{
 const f=rail();f.run();f.topics.hidden=true;f.topics.reset();f.run();assert.equal(f.topics.hidden,false);f.controls.handles=null;f.topics.reset();f.run();assert.deepEqual(f.topics.writes,[]);
});
function starred(){const line=target(),words=target(),retry=target(),views={starredPending:true,starredError:null,resets:0,resetStars(){this.resets++;}},flags={authority:false},calls=[];const ports={$:id=>({'starred-status':line,'starred-status-words':words,'starred-retry':retry})[id],views,topicUnavailable:false,authorityReviewPending:()=>flags.authority,freshness:{request:v=>calls.push(v)}};const api=new Function(...Object.keys(ports),starredCode+';return {paintStarredStatus,unavailable:v=>{topicUnavailable=v;}};')(...Object.values(ports));return {line,words,retry,views,flags,calls,api,reset:()=>[line,words,retry].forEach(x=>x.reset())};}
test('1253 actual starred status repeats loading/error/settled states without DOM setter requests',()=>{
 const f=starred();for(const error of [null,Error('failure')]){f.views.starredError=error;f.api.paintStarredStatus();f.reset();for(let i=0;i<100;i++)f.api.paintStarredStatus();assert.deepEqual([...f.line.writes,...f.words.writes,...f.retry.writes],[]);}f.views.starredPending=false;f.api.paintStarredStatus();f.reset();f.api.paintStarredStatus();assert.deepEqual([...f.line.writes,...f.words.writes,...f.retry.writes],[]);
});
test('1253 starred error/retry/access states remain truthful and retry uses its existing owner',()=>{
 const f=starred();f.api.paintStarredStatus();assert.equal(f.words.textContent,'Loading starred dossiers…');assert.equal(f.line.hidden,false);assert.equal(f.line.classList.contains('sr-only'),true);assert.equal(f.retry.hidden,true);f.views.starredError=Error('failure');f.api.paintStarredStatus();assert.equal(f.words.textContent,'Could not finish loading starred dossiers. ');assert.equal(f.retry.hidden,false);f.retry.onclick();assert.equal(f.views.resets,1);assert.deepEqual(f.calls,[{retry:true}]);f.flags.authority=true;f.api.paintStarredStatus();assert.equal(f.line.hidden,true);f.flags.authority=false;f.api.unavailable(true);f.api.paintStarredStatus();assert.equal(f.line.hidden,true);f.api.unavailable(false);f.api.paintStarredStatus();assert.equal(f.line.hidden,false);
});
