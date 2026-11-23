import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, card, details, cardText, parseDeck, deckBody, cardDetails, menuPage, text867, NotebookPage, NotebookWriting, DeckPage, textCard, painted867, edit867, press867, choice867, clipboard } from './fixtures/card_menu_867.mjs';

// ===== r4 review (cards lens): attacks on openCardMenu's row resolution and index rebasing =====
function freshR4(p,after,near,written){
 const field=p.doc.createElement('textarea');field.value=written;
 p.editing={text:'',after,depth:0,near,fresh:true,field,stacks:[],images:[],details:[],kept:''};p.doc.body.append(field);
}
function pressMaybe(p,at){
 const row=p.list.children[at],button=row.querySelector('.deck-menu');if(!button)return {row,button:null,menu:null};
 button.listeners.click({target:button,stopPropagation(){}});
 return {row,button,menu:p.doc.body.querySelector('[role="menu"]')};
}
const titles=p=>p.deck.cards.map(c=>c.title);
// The app's own reconcile/localActive wired, as app.mjs wires them (notebook-page.mjs load()).
async function livePort(t,raw){
 const p=menuPage(raw);let source={instance_id:'i',source_ref:{kind:'memory',id:'page',revision:1},owner_scope:{kind:'workspace',id:'w'},title:'Page',body:raw,attachments:[],references:[]},journal=null;
 const bootstrap={instance_id:'i',actor:'owner',authority:{authority_id:'a',authority_epoch:'e'}};
 const calls=[],api={view:async()=>structuredClone(source),command:async e=>{
  calls.push(e);source={...source,...structuredClone(e.args),source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};
  return {instance_id:'i',operation_id:e.operation_id,kind:e.kind,status:'committed',recorded:true,result:{item_id:'page',revision:source.source_ref.revision,source_ref:source.source_ref}};
 }};
 const store={get:async()=>structuredClone(journal),put:async value=>{journal=structuredClone(value);}};
 const w=p.writing=new NotebookWriting({item:'page',bootstrap,api,store,delay:60000,reconcile:(b,m,th)=>p.mergeIncoming(b,m,th),localActive:()=>Boolean(p.editing&&p.boxChanged(p.editing))});
 await w.open();t.after(()=>w.close());p.cardsSeen=w.capture();p.save=()=>NotebookPage.prototype.save.call(p);p.mode='cards';
 p.text={value:'',readOnly:false,setSelectionRange(){}};p.header.title=p.doc.createElement('h1');p.textSeen=null;
 return {p,w,api,calls,source:()=>source,setRemote(body){source={...source,body,source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};}};
}

test('ATTACK A1 holder ⋯ after a remote insertion BELOW the written card deletes the written card',async t=>{
 const {p,w,api,source}=await text867(t,card('Budget','words',details(A)));painted867(t,p);p.mode='cards';edit867(p,0);p.paint();
 api.view=async()=>({...source(),body:card('Budget','words',details(A))+card('Incoming','other',details(B)),source_ref:{...source().source_ref,revision:2}});
 await w.refresh();p.sync();assert.ok(p.list.children[0].classList.contains('deck-writing'));
 choice867(press867(p,0),'delete');assert.deepEqual(titles(p),['Incoming']);
});
test('ATTACK A1b ⋯ of the remotely inserted card below the holder deletes that card and finishes the box',async t=>{
 const {p,w,api,source}=await text867(t,card('Budget','words',details(A)));painted867(t,p);p.mode='cards';edit867(p,0);p.paint();
 api.view=async()=>({...source(),body:card('Budget','words',details(A))+card('Incoming','other',details(B)),source_ref:{...source().source_ref,revision:2}});
 await w.refresh();p.sync();choice867(press867(p,1),'delete');assert.deepEqual(titles(p),['Budget']);assert.equal(p.editing,null);
});
test('ATTACK A2 holder ⋯ after a remote deletion of the card ABOVE deletes the written card',async t=>{
 const C='c-33333333333333333333333333333333';
 const {p,w,api,source}=await text867(t,card('Above','a',details(B))+card('Budget','words',details(A))+card('Below','b',details(C)));painted867(t,p);p.mode='cards';edit867(p,1);p.paint();
 assert.equal(p.list.children[1].dataset.index,'1');
 api.view=async()=>({...source(),body:card('Budget','words',details(A))+card('Below','b',details(C)),source_ref:{...source().source_ref,revision:2}});
 await w.refresh();p.sync();assert.ok(p.list.children[0].classList.contains('deck-writing'));assert.equal(p.list.children[0].dataset.index,'0');
 choice867(press867(p,0),'delete');assert.deepEqual(titles(p),['Below']);
});
test('ATTACK A2b ⋯ of the card below the holder after a remote deletion above deletes that card',async t=>{
 const C='c-33333333333333333333333333333333';
 const {p,w,api,source}=await text867(t,card('Above','a',details(B))+card('Budget','words',details(A))+card('Below','b',details(C)));painted867(t,p);p.mode='cards';edit867(p,1);p.paint();
 api.view=async()=>({...source(),body:card('Budget','words',details(A))+card('Below','b',details(C)),source_ref:{...source().source_ref,revision:2}});
 await w.refresh();p.sync();choice867(press867(p,1),'delete');assert.deepEqual(titles(p),['Budget']);
});
for(const how of ['deck replaced','DeckPage.rebase'])test('ATTACK A3 written card gone from the deck while its box holds changes: ⋯ on the card below ('+how+')',t=>{
 const C='c-33333333333333333333333333333333';
 const p=painted867(t,menuPage(card('Top','t',details(B))+card('Budget','words',details(A))+card('Below','b',details(C))));
 edit867(p,1,'Budget\nchanged words');
 if(how==='deck replaced'){p.deck=parseDeck(card('Top','t',details(B))+card('Below','b',details(C)));p.paint();}
 else DeckPage.prototype.rebase.call(p,{revision:2,body:card('Top','t',details(B))+card('Below','b',details(C))});
 const holder=p.list.children[1];assert.ok(holder.classList.contains('deck-writing'));assert.equal(holder.dataset.index,'-1');assert.equal(holder.querySelector('.deck-menu'),null,'no ⋯ on a holder whose card is gone');
 const below=p.list.children[2];assert.equal(below.dataset.index,'1');
 const {menu}=pressMaybe(p,2);assert.ok(menu,'the menu opened');
 choice867(menu,'delete');
 assert.deepEqual(titles(p),['Top','Budget'],'Delete must remove Below, the pressed card; the rewritten Budget stands beside it');
});
test('ATTACK A4 a fresh card (Return after One) being written: ⋯ on each other card deletes that card',t=>{
 for(const [press,expect] of [[0,['New','Two','Three']],[2,['One','New','Three']],[3,['One','New','Two']]]){
  const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)+card('Three','three',null)));
  freshR4(p,cardText(p.deck.cards[0]),0,'New');p.paint();
  assert.ok(p.list.children[1].classList.contains('deck-writing'));assert.equal(p.list.children[1].dataset.index,'1');assert.equal(p.list.children[2].dataset.index,'1');
  choice867(press867(p,press),'delete');assert.deepEqual(titles(p),expect,'pressed row '+press);
 }
});
test('ATTACK A4b a fresh card above One (Option-Return on the first card): ⋯ on One deletes One',t=>{
 const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)));
 freshR4(p,null,-1,'New');p.paint();assert.ok(p.list.children[0].classList.contains('deck-writing'));
 choice867(press867(p,1),'delete');assert.deepEqual(titles(p),['New','Two']);
});
test('ATTACK A4c an empty fresh card being written: ⋯ on the card after it deletes that card',t=>{
 const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)+card('Three','three',null)));
 freshR4(p,cardText(p.deck.cards[0]),0,'');p.paint();
 choice867(press867(p,2),'delete');assert.deepEqual(titles(p),['One','Three']);
});
test('ATTACK A4d round-3 twin probe: Option-Return above the second Todo (with a child), ⋯ on that Todo',t=>{
 const p=painted867(t,menuPage(card('Todo','',null)+card('Todo','',null)+'### Only under the second\n\nkid\n\n'));
 p.picked=1;freshR4(p,cardText(p.deck.cards[0]),0,'New idea');p.paint();
 choice867(press867(p,2),'delete');assert.deepEqual(titles(p),['Todo','New idea']);
});
test('ATTACK A5 a fresh card whose anchor card was removed from the deck: ⋯ on the first card',t=>{
 const p=painted867(t,menuPage(card('One','one',null)+card('Two','two',null)+card('Three','three',null)));
 freshR4(p,cardText(p.deck.cards[0]),0,'New');
 p.deck=parseDeck(card('Two','two',null)+card('Three','three',null));p.paint();
 const rows=p.list.children.map(r=>[r.classList.contains('deck-writing')?'holder':r.querySelector('.deck-title')?.textContent,r.dataset.index]);
 console.log('A5 painted rows',JSON.stringify(rows));
 choice867(press867(p,0),'delete');
 console.log('A5 after Delete on Two',JSON.stringify(titles(p)));
 assert.deepEqual(titles(p),['New','Three'],'Delete must remove Two, the pressed card');
});
test('ATTACK A5b the same through the writer: another writer deletes the card a new card follows',async t=>{
 const {p,w,setRemote}=await livePort(t,card('One','one',null)+card('Two','two',null)+card('Three','three',null));painted867(t,p);
 freshR4(p,cardText(p.deck.cards[0]),0,'New');p.paint();p.save();
 assert.ok(w.hasLocal);
 setRemote(card('Two','two',null)+card('Three','three',null));
 const took=await w.refresh();console.log('A5b refresh',took,'conflict',Boolean(w.conflict),'value cards',parseDeck(w.value.body).cards.map(c=>c.title));
 p.sync();
 const rows=p.list.children.map(r=>[r.classList.contains('deck-writing')?'holder':r.querySelector('.deck-title')?.textContent,r.dataset.index]);
 console.log('A5b painted rows',JSON.stringify(rows),'deck',JSON.stringify(titles(p)),'editing fresh',p.editing?.fresh);
 if(w.conflict){console.log('A5b CONFLICT: the deck is not replaced; state unreachable this way');return;}
 const first=p.list.children.findIndex(r=>!r.classList.contains('deck-writing'));
 choice867(press867(p,first),'delete');
 console.log('A5b after Delete on the first painted card',JSON.stringify(titles(p)));
 assert.deepEqual(titles(p),['New','Three']);
});
test('ATTACK A3b the same through the writer: another writer deletes the card being written (box changed)',async t=>{
 const C='c-33333333333333333333333333333333';
 const {p,w,setRemote}=await livePort(t,card('Top','t',details(B))+card('Budget','words',details(A))+card('Below','b',details(C)));painted867(t,p);
 edit867(p,1,'Budget\nchanged words');p.paint();p.save();assert.ok(w.hasLocal);
 setRemote(card('Top','t',details(B))+card('Below','b',details(C)));
 const took=await w.refresh();p.sync();
 console.log('A3b refresh',took,'conflict',Boolean(w.conflict),'deck',JSON.stringify(titles(p)),'holder index',p.list.children.find(r=>r.classList.contains('deck-writing'))?.dataset.index);
});
test('ATTACK A6 identical twins with children: a cleared or extended twin box and the other twin\'s ⋯',t=>{
 const raw=card('Same','same',details(A))+'### kid a\n\nka\n\n'+card('Same','same',details(B))+'### kid b\n\nkb\n\n';
 // (a) clear twin A, press twin B
 let p=painted867(t,menuPage(raw));edit867(p,0,'');p.paint();choice867(press867(p,2),'delete');assert.deepEqual(titles(p),[]);
 // (b) clear twin A, press kid b
 p=painted867(t,menuPage(raw));edit867(p,0,'');p.paint();choice867(press867(p,3),'delete');assert.deepEqual(titles(p),['Same']);assert.equal(cardDetails(p.deck.cards[0].words).id,B);
 // (c) clear twin B, press twin A / kid a; press kid b opens nothing (it goes with its parent)
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();choice867(press867(p,0),'delete');assert.deepEqual(titles(p),[]);
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();choice867(press867(p,1),'delete');assert.deepEqual(titles(p),['Same']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);
 p=painted867(t,menuPage(raw));edit867(p,2,'');p.paint();const {menu}=pressMaybe(p,3);assert.equal(menu,null);assert.deepEqual(titles(p),['Same','kid a']);
 // (d) twin A grows a heading (count +1), press twin B
 p=painted867(t,menuPage(raw));edit867(p,0,'Same\nsame\n\n### extra\nmore');p.paint();choice867(press867(p,2),'delete');assert.deepEqual(titles(p),['Same','extra','kid a']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);
});
test('ATTACK A7 the holder\'s own ⋯ when its writing adds a heading deletes the written card only',t=>{
 const p=painted867(t,menuPage(card('Budget','words',details(A))+card('Other','o',details(B))));
 edit867(p,0,'Budget\nwords\n\n## Added\nmore');p.paint();choice867(press867(p,0),'delete');assert.deepEqual(titles(p),['Added','Other']);
});
test('ATTACK A9 the holder\'s own ⋯ with the box cleared opens no menu and removes the card',t=>{
 const p=painted867(t,menuPage(card('Budget','words',details(A))+card('Other','o',details(B))));
 edit867(p,0,'');p.paint();const {menu}=pressMaybe(p,0);assert.equal(menu,null);assert.deepEqual(titles(p),['Other']);
});
test('ATTACK A8 (note) a menu left open across a remote shift of id-less twins',t=>{
 const p=painted867(t,menuPage(card('Same','same',null)+card('Same','same',null)));p.paint();
 const menu=press867(p,1);
 p.deck=parseDeck(card('Incoming','x',null)+card('Same','same',null)+card('Same','same',null));p.paint();
 choice867(menu,'delete');console.log('A8 after Delete',JSON.stringify(titles(p)),'undo near',p.undos.at(-1)?.near);
});

for(const topRemote of ['t','t edited'])test('ATTACK A3c reachable (remote Top words '+JSON.stringify(topRemote)+'): '+(topRemote==='t'?'an unsaved edit keeps the deleted card box open':'an acknowledged edit closes the unchanged deleted card box')+'; ⋯ still targets the card below',async t=>{
 const C='c-33333333333333333333333333333333';
 const {p,w,setRemote}=await livePort(t,card('Top','t',details(B))+card('Budget','words',details(A))+card('Below','b',details(C)));painted867(t,p);
 edit867(p,0,'Top\nt edited');p.paint();p.finish();assert.ok(w.dirty,'the Top edit waits on the save timer');assert.deepEqual(titles(p),['Top','Budget','Below']);
 edit867(p,1);p.paint();
 setRemote(card('Top',topRemote,details(B))+card('Below','b',details(C)));
 const took=await w.refresh();p.sync();
 const holder=p.list.children.find(r=>r.classList.contains('deck-writing'));
 console.log('A3c refresh',took,'conflict',Boolean(w.conflict),'deck',JSON.stringify(titles(p)),'editing kept',Boolean(p.editing),'holder index',holder?.dataset.index,'holder has ⋯',Boolean(holder?.querySelector('.deck-menu')));
 assert.equal(w.conflict,null);
 if(topRemote==='t'){
  assert.ok(p.editing);assert.equal(holder.dataset.index,'-1');
  p.editing.field.value='Budget\nchanged words';
 }else{
  // The incoming revision acknowledges Top's exact edit. With no unsaved
  // writing left, sync closes Budget's untouched box after its deletion.
  assert.equal(w.hasLocal,false);assert.equal(p.editing,null);assert.equal(holder,undefined);
  assert.deepEqual(titles(p),['Top','Below']);
 }
 const below=p.list.children.findIndex(r=>r.querySelector('.deck-title')?.textContent==='Below');
 choice867(press867(p,below),'delete');
 console.log('A3c after Delete on Below',JSON.stringify(titles(p)),'notice',p.notice);
 assert.deepEqual(titles(p),topRemote==='t'?['Top','Budget']:['Top'],'Delete must remove Below, the pressed card');
});
test('ATTACK P8b (Text lens, found in passing) Undo back to the untouched CRLF page: is a revision owed?',async t=>{
 const raw=('# Page\n\nopening\n\n'+card('Old','no id yet',null)+card('First','first',details(A))).replaceAll('\n','\r\n');
 const {p,w,input}=await text867(t,raw);const before=p.text.value,at=before.indexOf('no id yet')+9;
 input(at,at,'!');input(at,at+1,'','historyUndo');assert.equal(p.text.value,before);
 console.log('P8b dirty after Undo',w.dirty,'value===raw',w.value.body===raw);console.log(JSON.stringify(w.value.body));
 assert.equal(w.dirty,false,'Undo back to the opened text must owe no revision');
});
