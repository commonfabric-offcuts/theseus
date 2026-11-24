import test from 'node:test';
import assert from 'node:assert/strict';
import { writingPort, painted867, clipboard, card } from './fixtures/card_menu_867.mjs';
import { applyAct, deckBody, parseDeck } from '../web/deck.mjs';

console.log('1157 runtime '+JSON.stringify({version:process.version,execPath:process.execPath,pid:process.pid,ppid:process.ppid,cwd:process.cwd(),argv:process.argv,execArgv:process.execArgv}));

const event = () => ({preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
async function fixture(t, raw=card('Parent','**Visible** words',null)) {
  const f=await writingPort(t,raw);painted867(t,f.p);f.p.mode='cards';f.p.paint();return f;
}
const control=(p,name,at=0)=>p.list.children[at].querySelector('.notebook-card-'+name);
const copying=t=>clipboard(t);

test('1157 controls appear on displayed Notebook cards',async t=>{
  const {p}=await fixture(t);
  assert.equal(Boolean(control(p,'copy')),true,'1157 Copy card text control exists');
  assert.ok(control(p,'add'),'1157 Add child card control exists');
  assert.equal(control(p,'copy').getAttribute('aria-label'),'Copy card text');
  assert.equal(control(p,'add').getAttribute('aria-label'),'Add child card');
  assert.equal(p.list.children[0].querySelector('.deck-menu').getAttribute('aria-label'),'This card','existing card menu stays');
});

test('1157 Copy uses the card text owner and shows a check only after success',async t=>{
  const saved=copying(t),raw=card('Parent','**Visible** words',null)+'### Child\n\nPrivate child words\n';
  const {p,w,calls}=await fixture(t,raw),before=w.value.body,button=control(p,'copy');
  await button.onclick(event());
  assert.deepEqual(saved,['Parent\n\nVisible words']);
  assert.equal(button.dataset.copied,'true');
  assert.equal(button.getAttribute('aria-label'),'Card text copied');
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'','controls add no author text to selection');
  assert.equal(w.value.body,before);assert.equal(calls.length,0,'Copy creates no Core edit or card ID');
});

test('1157 refused Copy keeps its glyph and the existing useful error',async t=>{
  copying(t);navigator.clipboard.writeText=async()=>{throw Error('denied');};
  const {p,calls}=await fixture(t),button=control(p,'copy');
  await button.onclick(event());
  assert.notEqual(button.dataset.copied,'true');assert.equal(button.getAttribute('aria-label'),'Copy card text');
  assert.match(p.notice,/Could not copy/);assert.match(p.notice,/Parent/);
  assert.equal(button.disabled,false);assert.equal(calls.length,0);
});

test('1157 a pending Copy is single and a closed page ignores its late success',async t=>{
  copying(t);let resolve,copies=0;
  navigator.clipboard.writeText=()=>{copies++;return new Promise(done=>{resolve=done;});};
  const {p}=await fixture(t),button=control(p,'copy');
  const first=button.onclick(event());await button.onclick(event());
  assert.equal(copies,1);assert.equal(button.disabled,true);
  p.listening.abort();resolve();await first;
  assert.notEqual(button.dataset.copied,'true');
});

test('1157 a replaced row does not receive a late Copy check',async t=>{
  copying(t);let resolve;
  navigator.clipboard.writeText=()=>new Promise(done=>{resolve=done;});
  const {p}=await fixture(t),old=control(p,'copy'),pending=old.onclick(event());
  p.paint();const current=control(p,'copy');assert.notEqual(current,old);
  resolve();await pending;
  assert.notEqual(old.dataset.copied,'true');assert.notEqual(current.dataset.copied,'true');
  assert.equal(current.getAttribute('aria-label'),'Copy card text');
});

test('1157 Add child opens after descendants and saves through the existing add act',async t=>{
  const raw='## Parent\n\nkept\n\n### Child\n\n#### Grandchild\n\n## Peer\n';
  const {p,w,source}=await fixture(t,raw);let opened,kept=0;
  p.folded.add('Parent');p.keepFolds=()=>{kept++;};
  // An editor port records placement; native focus is covered by the browser cell.
  p.open=editing=>{opened=editing;p.editing=editing;};
  assert.equal(control(p,'add').onclick(event()),true);
  assert.equal(opened.fresh,true);assert.equal(opened.depth,1);assert.equal(opened.near,2);
  assert.equal(opened.after,'Grandchild');assert.equal(opened.at,0);
  assert.equal(p.folded.has('Parent'),false);assert.equal(kept,1);
  assert.equal(w.value.body,raw,'opening an empty editor creates no durable card');
  const act={kind:'add',after:opened.after,near:opened.near,depth:opened.depth,text:'New child'};
  const result=applyAct(p.deck,act);assert.ok(result);
  const body=deckBody(result.deck);w.edit({body},w.capture(),'cards',[act]);await w.flush();
  assert.deepEqual(parseDeck(source().body).cards.map(c=>[c.title,c.depth]),
    [['Parent',0],['Child',1],['Grandchild',2],['New child',1],['Peer',0]]);
});

test('1157 Add child re-resolves its parent after finishing earlier writing',async t=>{
  const {p}=await fixture(t);const ref=p.cardRef(0);let opens=0,finishes=0;
  p.editing={};p.finish=()=>{finishes++;p.editing=null;p.deck=parseDeck('## Different card\n');};
  p.open=()=>{opens++;};
  assert.equal(p.addChildCard(ref),false);assert.equal(finishes,1);assert.equal(opens,0);
  assert.equal(p.deck.cards[0].title,'Different card');
});

test('1157 Add child checks current write authority rather than the old button state',async t=>{
  const {p,w}=await fixture(t),button=control(p,'add');let opens=0;p.open=()=>{opens++;};
  for(const key of ['readOnly','closed','deleted','actionPending','actionRunning','conflict']) {
    const old=w[key];w[key]=true;assert.equal(button.onclick(event()),false,key);w[key]=old;
  }
  p.readOnly=true;assert.equal(button.onclick(event()),false);p.readOnly=false;
  p.unavailable='Page unavailable';assert.equal(button.onclick(event()),false);
  assert.equal(opens,0);
});

test('1157 deepest and read-only cards cannot add while read-only Copy remains available',async t=>{
  copying(t);const {p}=await fixture(t,'###### Deepest\n\nWords\n');
  const button=control(p,'add');assert.equal(button.disabled,true);assert.match(button.title,/deepest/);
  let opens=0;p.open=()=>{opens++;};assert.equal(p.addChildCard(p.cardRef(0)),false);
  p.readOnly=true;p.paint();assert.equal(control(p,'add').disabled,true);
  const copy=control(p,'copy');assert.notEqual(copy.disabled,true);await copy.onclick(event());
  assert.equal(copy.dataset.copied,'true');assert.equal(opens,0);
});

test('1157 controls keep their activation keys and mouse press out of card editing',async t=>{
  const {p}=await fixture(t);
  for(const name of ['copy','add']) {
    const button=control(p,name),mouse=event();button.listeners.mousedown(mouse);assert.equal(mouse.prevented,true);
    const pointer=event();button.listeners.pointerdown(pointer);assert.equal(pointer.stopped,true);
    for(const key of ['Enter',' '])for(const type of ['keydown','keyup']) {
      const e={...event(),key,repeat:false};button.listeners[type](e);assert.equal(e.stopped,true);assert.notEqual(e.prevented,true);
      const repeat={...event(),key,repeat:true};button.listeners[type](repeat);assert.equal(repeat.prevented,true);
    }
  }
  assert.equal(p.editing,undefined);
});
