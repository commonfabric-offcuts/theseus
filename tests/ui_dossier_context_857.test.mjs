import { withReaderArchive } from './fixtures/reader_archive.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { arrangeStacks, stackState, setLevel, levelOf, foldedClick, drawn, headClick } from '../web/reply-stacks.mjs';
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]')).filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/[\"']/g, '')));
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };


import { gather, rowsOf, shown } from '../web/stack-order.mjs';
const message=(seq,reply_to=null,extra={})=>({id:'m'+seq,seq,topic_id:'t',author_id:'human',body:'Message '+seq,reply_to,acts:{},...extra});
const sample=()=>[message(1),message(2,'m1'),message(3,'m2'),message(4,'m1'),message(5,'m1')];
const visible=rows=>rows.filter(r=>r.kind==='reply').map(r=>[r.item.id,r.folded]);
function fixture(items=sample(), unreadIds=['m3']) {
 const doc=miniDocument();withReaderArchive(doc);
 const list=doc.createElement('div');list.root=true;
 const messages=new Map(items.map(x=>[x.id,x])),cards=new Map();let unread=new Set(unreadIds),acts=0;
 for(const item of items){const card=doc.createElement('button');card.className='message-card';card.dataset.id=item.id;card.dataset.seq=String(item.seq);
 const author=doc.createElement('span');author.className='message-author';author.textContent=item.author_id;
 const body=doc.createElement('span');body.className='message-preview';body.textContent=item.body;card.append(author,body);list.append(card);cards.set(item.id,card);}
 const draw=()=>arrangeStacks(list,messages,{doc,viewer:'reader',unread:x=>unread.has(x.id),on:{unfold:()=>{acts++;}}});
 const state=stackState(list);state.again=draw;
 return {doc,list,messages,cards,state,draw,read:()=>unread.clear(),acts:()=>acts};
}
test('857 a fresh ordinary dossier opens; quiet agents and explicit choices keep their levels',()=>{
 const state={levels:new Map(),coordination:new Set(['agent'])};
 assert.equal(levelOf(state,'human'),'open');assert.equal(levelOf(state,'agent'),'head');
 state.levels.set('human','folded');state.levels.set('agent','open');
 assert.equal(levelOf(state,'human'),'folded');assert.equal(levelOf(state,'agent'),'open');
 const f=fixture();f.draw();assert.equal(f.state.sections.get('m1').dataset.headOpen,'true');
 const head=f.cards.get('m1').querySelector('.stack-head');
 assert.equal(headClick(f.list,f.cards.get('m1'),{target:head}),true);
 assert.equal(levelOf(f.state,'m1'),'folded','a default-open head can collapse on its first click');
});
test('857 collapsed new reply brings only its hidden parent as a folded row and correct count',()=>{
 const [stack]=gather(sample()),kept=x=>x.id==='m3',opts={level:'folded',kept,unread:kept};
 const rows=rowsOf(stack,opts);
 assert.deepEqual(visible(rows),[['m2',true],['m3',false],['m5',false]]);
 assert.deepEqual(rows.filter(r=>r.kind==='fold').map(r=>[r.words,r.items.map(x=>x.id)]),[['1 more reply',['m4']]]);
 assert.equal(shown(stack,stack.replies[0],{...opts,newReply:kept}),true);
 assert.deepEqual(visible(rowsOf(stack,{level:'head',kept,unread:kept})),[]);
 assert.equal(rowsOf(stack,{...opts,peeked:x=>x.id==='m2'}).find(r=>r.item?.id==='m2').folded,false);
});
test('857 join parent wins; root and already-visible parent add no extra fold; no recursive ancestors',()=>{
 const items=sample();items[2].acts={joined:{into:'m4',by:'human'}};
 let [stack]=gather(items),kept=x=>x.id==='m3';
 assert.deepEqual(visible(rowsOf(stack,{kept,unread:kept})),[['m3',false],['m4',true],['m5',false]]);
 items[2].acts={};items[1].acts={starred:true};[stack]=gather(items);
 assert.deepEqual(visible(rowsOf(stack,{kept,unread:kept})),[['m2',false],['m3',false],['m5',false]]);
 [stack]=gather([message(1),message(2,'m1'),message(3,'m2'),message(4,'m3'),message(5,'m1')]);kept=x=>x.id==='m4';
 assert.deepEqual(visible(rowsOf(stack,{kept,unread:kept})),[['m3',true],['m4',false],['m5',false]]);
 kept=x=>x.id==='m5';assert.deepEqual(visible(rowsOf(stack,{kept,unread:kept})),[['m5',false]]);
});
test('857 actual context row survives reading, peeks without Core, and follows the current parent',()=>{
 const f=fixture();f.state.levels.set('m1','folded');f.draw();f.state.sections.get('m1').querySelector('.stack-unread-disclosure').onclick();
 assert.equal(f.cards.get('m2').hidden,false);assert.equal(f.cards.get('m2').dataset.folded,'true');assert.equal(drawn(f.list,'m2'),true);
 f.read();f.draw();assert.equal(f.cards.get('m2').hidden,false,'reading the child keeps its context');
 assert.equal(foldedClick(f.list,f.cards.get('m2'),{target:f.cards.get('m2')}),true);
 assert.equal(f.cards.get('m2').dataset.folded,'false');assert.equal(f.acts(),0);assert.deepEqual(f.messages.get('m2').acts,{});
 f.messages.set('m3',{...f.messages.get('m3'),acts:{joined:{into:'m4',by:'human'}}});f.draw();
 assert.equal(f.cards.get('m2').hidden,true);assert.equal(f.cards.get('m4').dataset.folded,'true');
 setLevel(f.state,f.state.stacks[0],'folded');f.draw();assert.equal(f.cards.get('m4').hidden,true,'new-view reset clears read context');
});
test('857 a read star alone creates no parent context',()=>{
 const items=sample();items[2].acts={starred:true};const f=fixture(items);f.read();f.state.levels.set('m1','folded');f.draw();
 assert.equal(f.cards.get('m2').hidden,true);f.messages.set('m3',{...f.messages.get('m3'),acts:{}});f.draw();assert.equal(f.cards.get('m2').hidden,true);
});

test('857 returning to the tab preserves default open but folds an explicit open off screen',async()=>{
 const {StackFeed}=await import('../web/stack-feed.mjs');
 const f=fixture();f.draw();
 const feed={list:f.list,state:f.state,undos:[],actsOf:()=>({}),entryFor:id=>f.cards.get(id),arrange:f.draw,focusOn(){}};
 StackFeed.prototype.cameBack.call(feed,()=>false);
 assert.equal(levelOf(f.state,'m1'),'open');
 assert.equal(f.state.levels.has('m1'),false,'coming back must not create a level choice');
 assert.equal(f.state.sections.get('m1').dataset.headOpen,'true');
 setLevel(f.state,f.state.stacks[0],'folded');f.draw();
 const menu=StackFeed.prototype.menuItems.call(feed,f.messages.get('m1'));
 const showAll=menu.first.find(x=>x.label==='Show all messages');assert.ok(showAll);showAll.act();
 assert.equal(f.state.levels.get('m1'),'open');
 f.state.unreadKept.add('m3');f.read();
 StackFeed.prototype.cameBack.call(feed,()=>true);
 assert.equal(f.state.levels.get('m1'),'open','an on-screen explicit open stays open');
 StackFeed.prototype.cameBack.call(feed,()=>false);
 assert.equal(f.state.levels.get('m1'),'folded','off-screen explicit open retains its old behavior');
 assert.equal(f.state.unreadKept.size,0,'off-screen read retention is released');
});

test('857 the actual menu and seven-message window agree with default open',async()=>{
 const {StackFeed}=await import('../web/stack-feed.mjs');
 const f=fixture(Array.from({length:10},(_,i)=>message(i+1,i?'m1':null)));f.draw();
 assert.equal(f.state.sections.get('m1').dataset.headOpen,'false','earlier root stays represented by its tab');
 assert.equal(f.state.sections.get('m1').querySelector('.stack-earlier-words')?.textContent,'3 earlier messages');
 const feed={list:f.list,state:f.state,undos:[],actsOf:()=>({}),entryFor:id=>f.cards.get(id),arrange:f.draw,focusOn(){}};
 for(const phone of [false,true]){
   f.state.levels.clear();f.draw();
   const menu=StackFeed.prototype.menuItems.call(feed,f.messages.get('m1'),{phone});
   const action=menu.first.find(x=>x.label==='Show latest and unread replies');assert.ok(action);action.act();assert.equal(levelOf(f.state,'m1'),'folded');
 }
});
test('857 absent parents do not invent context and peeks leave saved folds unchanged',()=>{
 const [missing]=gather([message(1),message(2,'missing',{stack_position:{root_id:'m1'}}),message(3,'m1')]);
 assert.deepEqual(visible(rowsOf(missing,{kept:()=>true,unread:()=>true})),[['m2',false],['m3',false]]);
 const items=sample();items[1].acts={folded:true};const f=fixture(items);f.state.levels.set('m1','folded');f.draw();f.state.sections.get('m1').querySelector('.stack-unread-disclosure').onclick();
 foldedClick(f.list,f.cards.get('m2'),{target:f.cards.get('m2')});assert.deepEqual(f.messages.get('m2').acts,{folded:true});assert.equal(f.acts(),0);
});

test('857 ordinary saved folds and already-visible parents retain their existing behavior',()=>{
 const [stack]=gather(sample()),kept=x=>['m2','m3'].includes(x.id),unread=x=>x.id==='m3';
 assert.deepEqual(visible(rowsOf(stack,{kept,unread})),[['m2',false],['m3',false],['m5',false]]);
 const f=fixture();f.read();f.messages.get('m5').acts={folded:true};f.state.levels.set('m1','folded');f.draw();
 assert.equal(foldedClick(f.list,f.cards.get('m5'),{target:f.cards.get('m5')}),true);assert.equal(f.acts(),1,'saved fold still goes through its existing owner');
});

test('857 explicit recollapse hides the context of the read latest reply',()=>{
 const items=sample();items[4].reply_to='m2';
 const f=fixture(items,['m5']);f.state.levels.set('m1','folded');f.draw();assert.equal(f.cards.get('m2').hidden,true);
 f.state.sections.get('m1').querySelector('.stack-unread-disclosure').onclick();
 assert.equal(f.cards.get('m2').hidden,false);
 f.read();f.draw();assert.equal(f.cards.get('m2').hidden,false);
 setLevel(f.state,f.state.stacks[0],'folded');f.draw();assert.equal(f.cards.get('m5').hidden,false);assert.equal(f.cards.get('m2').hidden,true);assert.equal(f.state.contextRows.has('m2'),false);
});

test('a closed dossier keeps its starred reply, active writing and saved latest fold', () => {
  const items = sample();
  items[1].acts = { starred: true };
  items[4].acts = { folded: true };
  const f = fixture(items);
  f.state.levels.set('m1', 'folded');
  f.cards.get('m4').setAttribute('data-card-reply', 'true');
  f.draw();
  assert.equal(f.cards.get('m2').hidden, false);
  assert.equal(f.cards.get('m3').hidden, true);
  assert.equal(f.cards.get('m4').hidden, false);
  assert.equal(f.cards.get('m5').hidden, false);
  assert.equal(f.cards.get('m5').dataset.folded, 'true');
  assert.equal(f.state.sections.get('m1').querySelector('.stack-unread-disclosure').textContent, '1 new');
});
