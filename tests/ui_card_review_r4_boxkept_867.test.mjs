import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, card, details, cardText, parseDeck, deckBody, cardDetails, menuPage, text867, NotebookPage, NotebookWriting, DeckPage, textCard, painted867, edit867, press867, choice867, clipboard } from './fixtures/card_menu_867.mjs';

// ===== BOXKEPT: claim "Box kept open after its card was deleted elsewhere: a lower card's ⋯ acts on the rewritten card" =====
// Appended to the tree's own tests/ui_card_menu_867.test.mjs; drives the real NotebookPage/DeckPage/NotebookWriting.
function editBox(p,at,written){
 const c=p.deck.cards[at],shown=p.written(c),field=p.doc.createElement('textarea');field.value=written??cardText({title:c.title,words:shown.words});
 p.editing={text:cardText(c),shown:cardText({title:c.title,words:shown.words}),near:at,depth:c.depth,fresh:false,field,details:shown.details,stacks:[],images:[],kept:''};p.doc.body.append(field);
}
function paintedBox(t,p){
 p.header.description??=p.doc.createElement('p');
 const old=globalThis.document;globalThis.document=p.doc;t.after(()=>{p.listening.abort();globalThis.document=old;});
 Object.assign(p,{talks:new Map(),room:null,keyed:false,opening:p.doc.createElement('div'),keyLines:[],editButton:p.doc.createElement('button'),mark(){},fit(){}});
 p.paint=()=>DeckPage.prototype.paint.call(p);return p;
}
function pressBox(p,at){
 const button=p.list.children[at].querySelector('.deck-menu');assert.ok(button,'painted overflow');button.listeners.click({target:button,stopPropagation(){}});
 const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu,'real shared menu');return menu;
}
function chooseBox(menu,key){const button=menu.querySelectorAll('button').find(n=>n.dataset.notebookAction===key||n.textContent===key);assert.ok(button);return button.onclick({preventDefault(){},stopPropagation(){}});}
const titlesOf=p=>p.deck.cards.map(c=>c.title);
const rowsOf=p=>p.list.children.map(r=>[r.classList.contains('deck-writing')?'holder':r.querySelector('.deck-title')?.textContent,r.dataset.index,Boolean(r.querySelector('.deck-menu'))]);
// The writer wired as notebook-page.mjs load() wires it (reconcile → mergeIncoming, localActive → boxChanged).
async function liveWriter(t,raw){
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
 return {p,w,api,calls,setRemote(body){source={...source,body,source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};}};
}
const C='c-33333333333333333333333333333333';
const page3=(withIds,topWords='t')=>card('Top',topWords,withIds?details(B):null)+card('Budget','words',withIds?details(A):null)+card('Below','b',withIds?details(C):null);

for(const withIds of [true,false])test(`BOXKEPT claim: unsaved Top edit, box on Budget, Budget deleted elsewhere, type, ⋯ on Below → Delete (ids ${withIds})`,async t=>{
 const {p,w,setRemote}=await liveWriter(t,page3(withIds));paintedBox(t,p);
 editBox(p,0,'Top\nt edited');p.paint();p.finish();
 assert.ok(w.dirty,'the Top edit waits on the save timer');assert.deepEqual(titlesOf(p),['Top','Budget','Below']);
 editBox(p,1);p.paint();
 setRemote(card('Top','t',withIds?details(B):null)+card('Below','b',withIds?details(C):null));
 const took=await w.refresh();p.sync();
 const holder=p.list.children.find(r=>r.classList.contains('deck-writing'));
 console.log(`BOXKEPT(ids ${withIds}) after refresh: took`,took,'conflict',Boolean(w.conflict),'dirty',w.dirty,'deck',JSON.stringify(titlesOf(p)),'editing kept',Boolean(p.editing),'rows',JSON.stringify(rowsOf(p)));
 assert.equal(w.conflict,null);assert.ok(p.editing);assert.ok(holder&&!holder.querySelector('.deck-menu'),'holder painted without a ⋯');
 p.editing.field.value='Budget\nchanged words';
 const below=p.list.children.findIndex(r=>r.querySelector('.deck-title')?.textContent==='Below');
 chooseBox(pressBox(p,below),'delete');
 console.log(`BOXKEPT(ids ${withIds}) after Delete on Below:`,JSON.stringify(titlesOf(p)),'| notice:',p.notice);
 assert.deepEqual(titlesOf(p),['Top','Budget'],'Delete must remove Below, the pressed card; the rewritten Budget stands');
});
test('BOXKEPT same path, Copy text on Below copies Below',async t=>{
 const copied=clipboard(t),{p,w,setRemote}=await liveWriter(t,page3(true));paintedBox(t,p);
 editBox(p,0,'Top\nt edited');p.paint();p.finish();assert.ok(w.dirty);
 editBox(p,1);p.paint();setRemote(card('Top','t',details(B))+card('Below','b',details(C)));await w.refresh();p.sync();
 assert.equal(w.conflict,null);assert.ok(p.editing);
 p.editing.field.value='Budget\nchanged words';
 const below=p.list.children.findIndex(r=>r.querySelector('.deck-title')?.textContent==='Below');
 await chooseBox(pressBox(p,below),'Copy text');
 console.log('BOXKEPT Copy text copied:',JSON.stringify(copied));
 assert.deepEqual(copied,['Below\n\nb']);
});
test('BOXKEPT control: same path but nothing typed into the kept box → ⋯ on Below acts on Below',async t=>{
 const {p,w,setRemote}=await liveWriter(t,page3(true));paintedBox(t,p);
 editBox(p,0,'Top\nt edited');p.paint();p.finish();assert.ok(w.dirty);
 editBox(p,1);p.paint();setRemote(card('Top','t',details(B))+card('Below','b',details(C)));await w.refresh();p.sync();
 assert.equal(w.conflict,null);assert.ok(p.editing);
 const below=p.list.children.findIndex(r=>r.querySelector('.deck-title')?.textContent==='Below');
 chooseBox(pressBox(p,below),'delete');
 console.log('BOXKEPT control (untyped) after Delete on Below:',JSON.stringify(titlesOf(p)));
 assert.deepEqual(titlesOf(p),['Top']);
});
test('BOXKEPT control: no unsaved edit → the box is discarded by sync, ⋯ on Below acts on Below',async t=>{
 const {p,w,setRemote}=await liveWriter(t,page3(true));paintedBox(t,p);
 editBox(p,1);p.paint();setRemote(card('Top','t',details(B))+card('Below','b',details(C)));await w.refresh();p.sync();
 console.log('BOXKEPT control (clean): conflict',Boolean(w.conflict),'editing kept',Boolean(p.editing),'rows',JSON.stringify(rowsOf(p)));
 assert.equal(p.editing,null);
 const below=p.list.children.findIndex(r=>r.querySelector('.deck-title')?.textContent==='Below');
 chooseBox(pressBox(p,below),'delete');assert.deepEqual(titlesOf(p),['Top']);
});
test('BOXKEPT control: box already changed when the deletion arrives → conflict, as designed',async t=>{
 const {p,w,setRemote}=await liveWriter(t,page3(true));paintedBox(t,p);
 editBox(p,1,'Budget\nchanged words');p.paint();p.save();assert.ok(w.hasLocal);
 setRemote(card('Top','t',details(B))+card('Below','b',details(C)));await w.refresh();p.sync();
 console.log('BOXKEPT control (changed box): conflict',Boolean(w.conflict),'deck',JSON.stringify(titlesOf(p)),'cardWritable',p.cardWritable());
 assert.ok(w.conflict);
});
