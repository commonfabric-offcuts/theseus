// Real stack/cover renderer + app capture/restore. Geometry is modeled;
// native selection, gestures and layout acceptance belong to landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { arrangeStacks, stackState, drawn } from '../web/reply-stacks.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { configureCoverAnswers } from '../web/cover-answers.mjs';
import { QuestionStates, configureQuestionStates } from '../web/question-state.mjs';
const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const anchorSource = source.slice(source.indexOf('let roomy = null, anchorDepth'), source.indexOf('// The New line, just below the oldest message'));
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(s => this.querySelectorAll(s)))];
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(n => n.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  ownerDocument: { get() { return this.document; } },
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
Element.prototype.after = function(node) { this.parent.insertBefore(node, this.nextElementSibling); };

function fixture(placement = 'visible', stands = 'Initial cover words') {
  const doc = withReaderArchive(miniDocument()); let main, list, home;
  const events = new Map(), frames = new Map(), scrolls = [], messages = new Map(), cards = new Map(); let frame = 0;
  const listen = (kind, f) => { if (!events.has(kind)) events.set(kind, new Set()); events.get(kind).add(f); };
  const unlisten = (kind, f) => events.get(kind)?.delete(f);
  doc.addEventListener = listen; doc.removeEventListener = unlisten;
  const win = { scrollY: 300, addEventListener: (k,f) => listen('window:' + k,f), removeEventListener: (k,f) => unlisten('window:' + k,f),
    scrollBy: ({top}) => { win.scrollY += top; scrolls.push(top); } };
  const create = doc.createElement;
  doc.createElement = tag => {
    const n = create(tag), style = new Map(); n.y = 0; n.h = 40;
    n.style = { setProperty(k,v) { style.set(k,v); }, removeProperty(k) { style.delete(k); }, getPropertyValue:k=>style.get(k)??'', getPropertyPriority:()=>'' };
    n.getBoundingClientRect = () => ({ top:n.y-win.scrollY, bottom:n.y+n.h-win.scrollY, height:n.h, left:20, right:420, width:400 });
    n.getClientRects = () => n.isConnected && !n.hidden ? [n.getBoundingClientRect()] : [];
    n.compareDocumentPosition = other => [...main.descendants()].indexOf(other) > [...main.descendants()].indexOf(n) ? 4 : 0;
    return n;
  };
  main=doc.byId('main');list=doc.byId('messages');home=doc.byId('new-message-sheet');
  main.append(list);list.append(home);home.open=false;
  list.contains = node => node === list || [...list.descendants()].includes(node);
  const entries = () => list.querySelectorAll('[data-id]');
  let cover = { stands, waiting:[], payload:null, owner:'reader', by:'writer', at_ms:1795620000000, revision:1, writer:'writer', root_id:'m1' };
  for (let i=1;i<=3;i++) {
    const item={id:'m'+i, seq:i, topic_id:'isolated-1276', author_id:'other', author_kind:'agent', addressees:['reader'], body:'Message '+i,
      reply_to:i===1?null:'m1', acts:i===1?{cover,cover_revision:1}:{}, stack_position:{root_id:'m1',through:null,below:false,at:{messages:3,acts:1},cover,cover_revision:1}};
    const card=doc.createElement('button');card.className='message-card';card.dataset.id=item.id;card.dataset.seq=String(i);card.h=120;
    const author=doc.createElement('span');author.className='message-author';card.append(author);list.append(card);messages.set(item.id,item);cards.set(item.id,card);
  }
  const state=stackState(list);state.levels.set('m1','open');let height=80;
  const sheet=()=>list.querySelector('.dossier-cover');
  const draw=()=>{
    arrangeStacks(list,messages,{doc,viewer:'reader'});
    const s=sheet();if(s){s.y=placement==='above'?120:placement==='below'?1800:placement==='crossing'?250:320;s.h=height;}
    const shift=placement==='above'?height-80:placement==='crossing'?height-80:0;
    for(const [id,card] of cards)card.y=(id==='m1'?100:430+(Number(id.slice(1))-2)*180)+shift;
  };
  draw();
  doc.documentElement={scrollHeight:5000};doc.body={};doc.caretPositionFromPoint=()=>null;
  doc.querySelectorAll = selector => selector.startsWith('#messages') ? [...list.descendants()].filter(n=>n.dataset.id||n.classList.contains('dossier-cover')||n.classList.contains('stack-earlier')||n.dataset.line==='older') : list.querySelectorAll(selector);
  const Observer=class{observe(){}disconnect(){}takeRecords(){return[]}};
  const context=vm.createContext({window:win,document:doc,innerWidth:600,innerHeight:800,Node:{DOCUMENT_POSITION_FOLLOWING:4,TEXT_NODE:3},
    windowReadSerial:0,inline:null,registry:{},retired:null,topicUnavailable:false,authorityReviewPending:()=>false,
    entries,drawn,typingField:()=>false,views:{messages},bootstrap:{actor:'reader'},messageEntries:cards,topic:{id:'isolated-1276'},stackState,
    cardIn:n=>n,opened:n=>n,reveal(){},button:()=>doc.createElement('button'),$:id=>({main,messages:list,'new-message-sheet':home})[id],
    ResizeObserver:Observer,MutationObserver:Observer,requestAnimationFrame:f=>{frames.set(++frame,f);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(anchorSource+';globalThis.api={captureListAnchor,restoreListAnchor,keepListAnchor,watchListAnchor,state:()=>({anchorActing,anchorHold})};',context);
  const revise=(patch={},newHeight=height)=>{cover={...cover,...patch,revision:cover.revision+1,at_ms:cover.at_ms+1000};height=newHeight;
    messages.get('m1').acts={cover,cover_revision:cover.revision};
    for(const item of messages.values())item.stack_position={...item.stack_position,cover,cover_revision:cover.revision,at:{messages:3,acts:cover.revision}};draw();};
  return {doc,list,home,win,messages,cards,state,sheet,draw,revise,context,api:context.api,scrolls,events,frames,entries};
}

for (const placement of ['above','below','visible']) for (const height of [80,180,40]) test(`1276 actual renderer ${placement} revision height ${height} preserves source-selected place`,()=>{
  const f=fixture(placement),old=f.sheet(),card=f.cards.get('m2'),before=card.getBoundingClientRect().top,saved=f.api.captureListAnchor(),anchorTop=saved.tops.get(saved.anchor);
  assert.equal(saved.anchor,placement==='visible'?old:card,'actual firstInView selection');
  f.api.keepListAnchor(()=>f.revise({stands:'Altered cover words'},height));
  assert.equal(f.sheet(),old,'routine revision retains actual reading sheet');assert.equal(old.isConnected,true);
  assert.equal(f.sheet().querySelector('.cover-stands').textContent,'Altered cover words','new Core words are rendered');
  assert.equal(saved.anchor.getBoundingClientRect().top,anchorTop,'source-selected anchor holds');
  if(placement!=='visible'||height===80)assert.equal(card.getBoundingClientRect().top,before,'reading reply holds where its selected anchor permits');
});
test('1276 unchanged cover reading range, selected words and focus stay connected across metadata/other-row update',()=>{
  const f=fixture('crossing','**Exact** reading line'),sheet=f.sheet(),words=sheet.querySelector('.cover-stands'),text=[...words.descendants()].find(n=>n.nodeType===3);
  assert.ok(text);const row=words.parentElement,remove=row.remove.bind(row);let detachments=0;row.remove=()=>{detachments++;remove();};let lineY=301;const range={setStart(){},setEnd(){},getClientRects:()=>text.isConnected?[1]:[],getBoundingClientRect:()=>({top:lineY-f.win.scrollY})};
  f.doc.caretPositionFromPoint=()=>({offsetNode:text,offset:2});f.doc.createRange=()=>range;
  const selection={anchorNode:text,anchorOffset:2,focusNode:text,focusOffset:4};f.doc.selection=selection;f.doc.activeElement=words;
  const saved=f.api.captureListAnchor();assert.equal(saved.point.text,text);lineY+=60;
  f.revise({payload:{kind:'answer',text:'New payload',message_id:'m2',seq:2}},140);f.api.restoreListAnchor(saved);
  assert.equal(f.sheet(),sheet);assert.equal(f.sheet().querySelector('.cover-stands'),words);assert.equal(text.isConnected,true);
  assert.equal(range.getBoundingClientRect().top,1);assert.equal(f.doc.selection,selection);assert.equal(f.doc.activeElement,words);assert.equal(detachments,0,'unchanged selected row is never removed/reinserted');
});
test('1276 duplicate unchanged item rows keep distinct identities and removed rows retire',()=>{
  const f=fixture(),item={workspace_id:'w',number:4,title:'Actual item',state:'Build'};
  f.revise({items:[item,item]});const rows=f.sheet().querySelectorAll('.cover-item');assert.equal(rows.length,2);assert.notEqual(rows[0],rows[1]);
  f.revise({stands:'New words'});assert.deepEqual(f.sheet().querySelectorAll('.cover-item'),rows);
  f.revise({items:[]});assert.ok(rows.every(n=>!n.isConnected));assert.equal(f.sheet().querySelectorAll('.cover-item').length,0);
});
test('1276 changed cover words invalidate old character range while stable sheet holds',()=>{
  const f=fixture('crossing','**Old** reading line'),sheet=f.sheet(),text=[...sheet.querySelector('.cover-stands').descendants()].find(n=>n.nodeType===3);
  f.doc.caretPositionFromPoint=()=>({offsetNode:text,offset:1});f.doc.createRange=()=>({setStart(){},setEnd(){},getClientRects:()=>text.isConnected?[1]:[],getBoundingClientRect:()=>({top:1})});
  const saved=f.api.captureListAnchor();f.revise({stands:'Changed current words'},100);f.api.restoreListAnchor(saved);
  assert.equal(text.isConnected,false);assert.equal(f.sheet(),sheet);assert.equal(f.sheet().getBoundingClientRect().top,-50);assert.ok(f.scrolls.every(Number.isFinite));
});
test('1276 focused writing keeps field/caret through a growing cover',()=>{
  const f=fixture('above'),field=f.cards.get('m2');f.doc.activeElement=field;field.selectionStart=3;field.selectionEnd=8;
  f.context.inline={root:{contains:n=>n===field},field};f.context.registry={inline:{},isCurrent:()=>true};
  const top=field.getBoundingClientRect().top;f.api.keepListAnchor(()=>f.revise({stands:'Growing cover'},240));
  assert.equal(field.getBoundingClientRect().top,top);assert.equal(f.doc.activeElement,field);assert.deepEqual([field.selectionStart,field.selectionEnd],[3,8]);
});
test('1276 real cover removal and real message removal retain successor fallback',()=>{
  const f=fixture(),old=f.sheet(),saved=f.api.captureListAnchor(),top=old.getBoundingClientRect().top;
  f.messages.get('m1').acts={cover:null,cover_revision:2};
  for(const item of f.messages.values())item.stack_position={...item.stack_position,cover:null,cover_revision:2};f.draw();f.api.restoreListAnchor(saved);
  assert.equal(old.isConnected,false);assert.equal(f.sheet(),null);assert.equal(f.cards.get('m1').getBoundingClientRect().top,top);
  const g=fixture('below'),before=g.api.captureListAnchor(),successor=g.cards.get('m3'),edge=before.tops.get(before.anchor);
  g.cards.get('m2').remove();g.messages.delete('m2');g.cards.delete('m2');g.draw();g.api.restoreListAnchor(before);
  assert.equal(successor.getBoundingClientRect().top,edge,'removed message still hands off its old viewport position');
});
test('1276 changed viewer/dossier scope does not reuse the old sheet or its controls',()=>{
  const f=fixture(),old=f.sheet(),context={viewer:'different-reader',nameOf:x=>x,topicId:'isolated-1276',rootId:'different-root'};
  const next=coverSheet(f.doc,{stands:'New scope',owner:'reader',waiting:[]},context,old);
  assert.notEqual(next,old);assert.equal(next.querySelector('.cover-stands').textContent,'New scope');
});
for(const fence of ['retired','disconnected','hidden'])test('1276 '+fence+' snapshot performs no restoration',()=>{
  const f=fixture(),saved=f.api.captureListAnchor();f.revise({stands:'Current words'});
  if(fence==='retired')f.context.retired={};if(fence==='disconnected'){f.list.root=false;f.list.remove();}if(fence==='hidden')f.list.hidden=true;
  f.api.restoreListAnchor(saved);assert.equal(f.scrolls.length,0);
});
test('1276 deliberate action bypasses passive hold and does not reverse its destination',()=>{
  const f=fixture();f.api.watchListAnchor();for(const callback of f.events.get('wheel')??[])callback();
  f.win.scrollY+=100;const wanted=f.win.scrollY;f.api.keepListAnchor(()=>f.revise({stands:'Current words'}));
  assert.equal(f.win.scrollY,wanted);assert.equal(f.sheet().querySelector('.cover-stands').textContent,'Current words');
});

test('1276 unchanged answer controls retain focus/state and changed answer revision uses the fresh fence',async()=>{
  const calls=[];configureCoverAnswers(()=>({reactions:{answer:async(item,answer)=>{calls.push({item,answer});return{recorded:true};}},changed(){}}));
  try{
    const f=fixture(),wait={ask_id:'actual-ask',message_id:'actual-ask',actor_id:'reader',text:'Proceed?',go_ahead:true,answer_revision:1};
    f.revise({waiting:[wait]});const row=f.sheet().querySelector('.cover-wait'),button=row.querySelector('button');assert.ok(button);button.focus();
    f.revise({stands:'Revised stands only'});assert.equal(f.sheet().querySelector('.cover-wait'),row);assert.equal(f.doc.activeElement,button);assert.equal(button.isConnected,true);
    await button.onclick({stopPropagation(){}});assert.equal(calls[0].item.reactions.answer_revision,1);assert.equal(calls[0].item.id,'actual-ask');
    f.revise({waiting:[{...wait,answer_revision:2}]});const fresh=f.sheet().querySelector('.cover-wait').querySelector('button');
    assert.notEqual(fresh,button);assert.equal(button.isConnected,false);await fresh.onclick({stopPropagation(){}});assert.equal(calls[1].item.reactions.answer_revision,2);
  }finally{configureCoverAnswers(null);}
});
test('1276 terminal question removes its cached wait while retaining unrelated reading words',()=>{
  const states=new QuestionStates();configureQuestionStates(states);
  try{const f=fixture(),wait={ask_id:'closed-ask',actor_id:'reader',text:'Waiting?'};f.revise({waiting:[wait]});
    const words=f.sheet().querySelector('.cover-stands'),row=f.sheet().querySelector('.cover-wait');assert.ok(row);
    states.learn('closed-ask',{state:'resolved'});f.draw();assert.equal(f.sheet().querySelector('.cover-wait'),null);assert.equal(row.isConnected,false);assert.equal(f.sheet().querySelector('.cover-stands'),words);
  }finally{configureQuestionStates(null);}
});

test('1276 owner changes update owner-dependent rows without replacing the same dossier sheet or words',()=>{
  const f=fixture();f.revise({waiting:[{text:'Owner chooses'}]});
  const sheet=f.sheet(),words=sheet.querySelector('.cover-stands'),wait=sheet.querySelector('.cover-wait');
  f.api.keepListAnchor(()=>f.revise({owner:'new-owner'}));
  assert.equal(f.sheet(),sheet);assert.equal(sheet.querySelector('.cover-stands'),words);assert.equal(words.isConnected,true);
  assert.notEqual(sheet.querySelector('.cover-wait'),wait);assert.equal(wait.isConnected,false);
  assert.equal(sheet.querySelector('.topic-state').textContent,'Waits on new-owner');assert.equal(sheet.getBoundingClientRect().top,20);
});
