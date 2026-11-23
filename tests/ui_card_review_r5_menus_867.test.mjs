import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, card, details, cardText, parseDeck, deckBody, cardDetails, menuPage, text867, NotebookPage, NotebookWriting, DeckPage, textCard, painted867, edit867, press867, choice867, clipboard } from './fixtures/card_menu_867.mjs';

// ===== r5 review (menus lens): attacks on 'follow the pressed card object through the applied act' =====
// Appended to a copy of tests/ui_card_menu_867.test.mjs; every scenario presses a painted ⋯ and then runs
// Copy text, Delete and Set color through the real shared menu, reporting which card each acted on.
const CC='c-33333333333333333333333333333333',DD='c-44444444444444444444444444444444';
function freshAt(p,after,near,written,depth=0){
 const field=p.doc.createElement('textarea');field.value=written;
 p.editing={text:'',after,depth,near,fresh:true,field,stacks:[],images:[],details:[],kept:''};p.doc.body.append(field);
}
const titles=p=>p.deck.cards.map(c=>c.title);
const rowsOf=p=>p.list.children.map(r=>[r.classList.contains('deck-writing')?'HOLDER':r.querySelector('.deck-title')?.textContent,r.dataset.index??'-',Boolean(r.querySelector('.deck-menu'))]);
const rowOf=(p,title)=>p.list.children.findIndex(r=>!r.classList.contains('deck-writing')&&r.querySelector('.deck-title')?.textContent===title);
const holderRow=p=>p.list.children.findIndex(r=>r.classList.contains('deck-writing'));
// The writer wired as notebook-page.mjs load() wires it (reconcile → mergeIncoming, localActive → boxChanged).
async function liveR5(t,raw){
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
 painted867(t,p);
 return {p,w,api,calls,source:()=>source,setRemote(body){source={...source,body,source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};}};
}
// Press the ⋯ on a painted row and run one action; report which card it acted on.
async function act867(t,p,rowIndex,action){
 const copied=clipboard(t);
 const row=p.list.children[rowIndex],button=row?.querySelector('.deck-menu');
 if(!button)return {action,result:'no ⋯ on that row'};
 button.listeners.click({target:button,stopPropagation(){}});
 const menu=p.doc.body.querySelector('[role="menu"]');
 if(!menu)return {action,result:'no menu',deck:titles(p)};
 const key=({'Copy text':'copy-text','Delete':'delete','Set color':'color-rose'})[action];const item=menu.querySelectorAll('button').find(n=>n.dataset.notebookAction===key);
 const r=item.onclick({preventDefault(){},stopPropagation(){}});
 if(action==='Copy text'){await r;return {action,copied:copied[0]?.replace(/\n+/g,' / '),deck:titles(p)};}
 if(action==='Delete'){const u=p.undos.at(-1);return {action,removed:u?.kind==='add'?{title:textCard(u.text).title,at:u.near+1,rest:u.rest?.length??0}:u,deck:titles(p)};}
 await r;
 const colored=p.deck.cards.map((c,i)=>[i,c.title,cardDetails(c.words).color]).filter(x=>x[2]==='rose');
 return {action,colored,deck:titles(p)};
}
const ACTIONS=['Copy text','Delete','Set color'];
// Runs a scenario three times, once per action, and asserts the target each time.
function scenario(name,build,expect){
 for(const action of ACTIONS)test(`R5MENU ${name} :: ${action}`,async t=>{
  const {p,row,note}=await build(t);
  const painted=rowsOf(p);
  const out=await act867(t,p,row,action);
  console.log(JSON.stringify({name,action,painted,pressedRow:row,note,...out}));
  expect(action,out,p);
 });
}
const expectCard=(title,{index=null,words=null}={})=>(action,out,p)=>{
 if(action==='Copy text'){assert.ok(out.copied,'copied something');assert.equal(out.copied.split(' / ')[0],title,'Copy text copied '+title);if(words)assert.equal(out.copied.split(' / ')[1],words);}
 else if(action==='Delete'){assert.equal(out.removed?.title,title,'Delete removed '+title);if(index!==null)assert.equal(out.removed.at,index,'Delete removed the occurrence at '+index);}
 else {assert.equal(out.colored.length,1,'one card colored');assert.equal(out.colored[0][1],title,'Set color tinted '+title);if(index!==null)assert.equal(out.colored[0][0],index);}
};
const expectNoMenu=(action,out)=>{assert.equal(out.result,'no menu','no menu for a card the finish removed: '+JSON.stringify(out));};

// --- S1/S2: a remote insertion above and below the written card ---
async function remoteInsert(t,where,boxChanged){
 const {p,w,setRemote}=await liveR5(t,card('Budget','budget words',details(A))+card('Other','other words',details(B)));
 edit867(p,0);p.paint();
 if(boxChanged){p.editing.field.value='Budget\nbudget words typed';p.save();}
 setRemote(where==='above'?card('Incoming','incoming words',details(CC))+card('Budget','budget words',details(A))+card('Other','other words',details(B))
  :card('Budget','budget words',details(A))+card('Incoming','incoming words',details(CC))+card('Other','other words',details(B)));
 const took=await w.refresh();p.sync();
 return {p,w,took,conflict:Boolean(w.conflict)};
}
for(const where of ['above','below'])for(const boxChanged of [false,true]){
 scenario(`remote insertion ${where} the written card (box changed=${boxChanged}): the holder's own ⋯`,async t=>{const s=await remoteInsert(t,where,boxChanged);assert.equal(s.conflict,false,'fixture: merged, no conflict');return {p:s.p,row:holderRow(s.p),note:'holder'};},expectCard('Budget',{words:boxChanged?'budget words typed':'budget words'}));
 scenario(`remote insertion ${where} the written card (box changed=${boxChanged}): ⋯ on Incoming`,async t=>{const s=await remoteInsert(t,where,boxChanged);assert.equal(s.conflict,false);return {p:s.p,row:rowOf(s.p,'Incoming')};},expectCard('Incoming'));
 scenario(`remote insertion ${where} the written card (box changed=${boxChanged}): ⋯ on Other`,async t=>{const s=await remoteInsert(t,where,boxChanged);assert.equal(s.conflict,false);return {p:s.p,row:rowOf(s.p,'Other')};},expectCard('Other'));
}
// --- S3: remote deletion of the anchor while a fresh card is written (Return and Option-Return) ---
async function freshAnchorGone(t,how,ids){
 const d=i=>ids?details([A,B,CC,DD][i]):null;
 const {p,w,setRemote}=await liveR5(t,card('Zero','zero words',d(0))+card('One','one words',d(1))+card('Two','two words',d(2))+card('Three','three words',d(3)));
 // Return on One: after One, near 1. Option-Return on Two: above Two = after One, near 1 as well, but reached through start(true).
 p.picked=how==='Return'?1:2;p.keyed=false;
 DeckPage.prototype.start.call(p,how!=='Return');
 assert.ok(p.editing?.fresh);assert.equal(p.editing.after,cardText(p.deck.cards[1]));
 p.editing.field.value='New\nnew words';p.paint();p.save();
 setRemote(card('Zero','zero words',d(0))+card('Two','two words',d(2))+card('Three','three words',d(3)));
 await w.refresh();p.sync();
 return {p,w,conflict:Boolean(w.conflict)};
}
for(const how of ['Return','Option-Return'])for(const ids of [true,false])for(const target of ['Zero','Two','Three'])
 scenario(`fresh card by ${how} after One, One deleted elsewhere (ids=${ids}): ⋯ on ${target}`,async t=>{const s=await freshAnchorGone(t,how,ids);assert.equal(s.conflict,false,'fixture: no conflict');assert.ok(s.p.editing?.fresh,'fixture: the fresh box is kept');return {p:s.p,row:rowOf(s.p,target)};},expectCard(target));
// Option-Return above the first card (after null) while a card is inserted at the top elsewhere. Through the
// writer this is a conflict (two insertions at the top), so the deck is replaced directly, as round 4's A5 did.
test('R5MENU (fixture) Option-Return above the first card + a remote insertion at the top is a conflict through the writer',async t=>{
 const {p,w,setRemote}=await liveR5(t,card('One','one words',details(A))+card('Two','two words',details(B)));
 p.picked=0;DeckPage.prototype.start.call(p,true);assert.equal(p.editing.after,null);
 p.editing.field.value='New\nnew words';p.paint();p.save();
 setRemote(card('Zero','zero words',details(CC))+card('One','one words',details(A))+card('Two','two words',details(B)));
 await w.refresh();p.sync();console.log(JSON.stringify({name:'Option-Return top + remote top insertion',conflict:Boolean(w.conflict),deck:titles(p)}));
});
for(const target of ['Zero','One','Two'])scenario(`Option-Return above the first card, a card inserted at the top elsewhere (deck replaced): ⋯ on ${target}`,async t=>{
 const p=painted867(t,menuPage(card('One','one words',details(A))+card('Two','two words',details(B))));
 freshAt(p,null,-1,'New\nnew words');p.deck=parseDeck(card('Zero','zero words',details(CC))+card('One','one words',details(A))+card('Two','two words',details(B)));p.paint();
 return {p,row:rowOf(p,target)};
},expectCard(target));
// The fallback add for a deleted editor with id-less twins below: the pressed twin must stay the pressed one.
for(const pressed of [2,3])scenario(`written id-less card deleted elsewhere (deck replaced), box typed; id-less twins below: ⋯ on Same@${pressed-1} (row ${pressed})`,async t=>{
 const p=painted867(t,menuPage(card('Top','top words',null)+card('Budget','budget words',null)+card('Same','same words',null)+card('Same','same words',null)));
 edit867(p,1,'Budget\nbudget words typed');p.deck=parseDeck(card('Top','top words',null)+card('Same','same words',null)+card('Same','same words',null));p.paint();
 assert.equal(holderRow(p),1,'the kept box stands where its card stood');return {p,row:pressed,note:'rows: Top, HOLDER(-1), Same@1, Same@2; after the goes-beside-it add the twins stand at 2 and 3'};
},expectCard('Same',{index:pressed}));
// The holder's own ⋯ on an id-less card whose box changed: the edited card, not a card found by its old words.
scenario(`id-less written card, box changed: the holder's own ⋯`,async t=>{
 const p=painted867(t,menuPage(card('Budget','budget words',null)+card('Other','other words',null)));
 edit867(p,0,'Budget\nbudget words typed');p.paint();return {p,row:0};
},expectCard('Budget',{index:0,words:'budget words typed'}));
scenario(`id-less written card renamed in its box: the holder's own ⋯`,async t=>{
 const p=painted867(t,menuPage(card('Budget','budget words',null)+card('Other','other words',null)));
 edit867(p,0,'Renamed\nbudget words');p.paint();return {p,row:0};
},expectCard('Renamed',{index:0}));

// --- S4: the written card itself deleted remotely ---
async function editorGone(t,{earlierEdit,typeAfter,ids}){
 const d=i=>ids?details([A,B,CC][i]):null;
 const {p,w,setRemote}=await liveR5(t,card('Top','top words',d(0))+card('Budget','budget words',d(1))+card('Below','below words',d(2)));
 if(earlierEdit){edit867(p,0,'Top\ntop words edited');p.paint();p.finish();assert.ok(w.dirty,'the Top edit waits on the save timer');}
 edit867(p,1);p.paint();
 setRemote(card('Top','top words',d(0))+card('Below','below words',d(2)));
 await w.refresh();p.sync();
 if(typeAfter&&p.editing){p.editing.field.value='Budget\nbudget words typed';p.save();}
 return {p,w,conflict:Boolean(w.conflict),kept:Boolean(p.editing)};
}
for(const ids of [true,false])for(const target of ['Top','Below']){
 scenario(`written card deleted elsewhere, earlier unsaved edit, box kept at -1, typed (ids=${ids}): ⋯ on ${target}`,async t=>{const s=await editorGone(t,{earlierEdit:true,typeAfter:true,ids});assert.equal(s.conflict,false);assert.ok(s.kept,'fixture: the box is kept');return {p:s.p,row:rowOf(s.p,target),note:'at<0 goes-beside-it path'};},expectCard(target));
 scenario(`written card deleted elsewhere, earlier unsaved edit, box kept at -1, nothing typed (ids=${ids}): ⋯ on ${target}`,async t=>{const s=await editorGone(t,{earlierEdit:true,typeAfter:false,ids});assert.equal(s.conflict,false);assert.ok(s.kept);return {p:s.p,row:rowOf(s.p,target)};},expectCard(target));
 scenario(`written card deleted elsewhere, no unsaved edit, box discarded (ids=${ids}): ⋯ on ${target}`,async t=>{const s=await editorGone(t,{earlierEdit:false,typeAfter:false,ids});assert.equal(s.conflict,false);assert.equal(s.kept,false,'fixture: sync discards the box');return {p:s.p,row:rowOf(s.p,target)};},expectCard(target));
}
test('R5MENU written card deleted elsewhere, earlier unsaved edit, typed: the rewritten Budget stands beside and keeps its words',async t=>{
 const s=await editorGone(t,{earlierEdit:true,typeAfter:true,ids:true});
 const out=await act867(t,s.p,rowOf(s.p,'Below'),'Delete');console.log(JSON.stringify({name:'goes-beside-it landing',...out,cards:s.p.deck.cards.map(c=>[c.title,cardDetails(c.words).words])}));
 assert.deepEqual(titles(s.p),['Top','Budget']);assert.equal(cardDetails(s.p.deck.cards[1].words).words,'budget words typed');assert.match(s.p.notice,/card of its own beside it/);
});

// --- S5: identical twins with children ---
const twins=(ids,kids=true)=>card('Same','same words',ids?details(A):null)+(kids?'### kid a\n\nka words\n\n':'')+card('Same','same words',ids?details(B):null)+(kids?'### kid b\n\nkb words\n\n':'');
for(const ids of [true,false]){
 // The box on twin A, edited (not cleared): press twin B, kid b, kid a.
 for(const [target,index] of [['Same',2],['kid b',3],['kid a',1]])scenario(`twins with children, twin A box edited (ids=${ids}): ⋯ on ${target}@${index}`,async t=>{
  const p=painted867(t,menuPage(twins(ids)));edit867(p,0,'Same\nsame words edited');p.paint();return {p,row:index};
 },expectCard(target,{index}));
 // The box on twin B edited: press twin A, kid a, kid b.
 for(const [target,index] of [['Same',0],['kid a',1],['kid b',3]])scenario(`twins with children, twin B box edited (ids=${ids}): ⋯ on ${target}@${index}`,async t=>{
  const p=painted867(t,menuPage(twins(ids)));edit867(p,2,'Same\nsame words edited');p.paint();return {p,row:index};
 },expectCard(target,{index}));
 // A fresh card after twin A's group (Return on Same A): press twin B and kid b; after finish they stand one lower.
 for(const [target,index,after] of [['Same',2,3],['kid b',3,4]])scenario(`twins with children, fresh card after twin A's group (ids=${ids}): ⋯ on ${target}@${index}`,async t=>{
  // Return on twin A: after its last child (kid a), near 1, at its depth (start()).
  const p=painted867(t,menuPage(twins(ids)));freshAt(p,cardText(p.deck.cards[1]),1,'New\nnew words',0);p.paint();return {p,row:p.list.children.findIndex(r=>!r.classList.contains('deck-writing')&&r.dataset.index===String(index))};
 },expectCard(target,{index:after}));
 // Twin A cleared: twin B's ⋯ (goes to 0), kid b's ⋯ (goes to 1); kid a's ⋯ opens nothing.
 scenario(`twins with children, twin A cleared (ids=${ids}): ⋯ on twin B`,async t=>{const p=painted867(t,menuPage(twins(ids)));edit867(p,0,'');p.paint();return {p,row:2};},expectCard('Same',{index:0}));
 scenario(`twins with children, twin A cleared (ids=${ids}): ⋯ on kid b`,async t=>{const p=painted867(t,menuPage(twins(ids)));edit867(p,0,'');p.paint();return {p,row:3};},expectCard('kid b',{index:1}));
 scenario(`twins with children, twin A cleared (ids=${ids}): ⋯ on kid a (removed with its parent)`,async t=>{const p=painted867(t,menuPage(twins(ids)));edit867(p,0,'');p.paint();return {p,row:1};},expectNoMenu);
}
// --- S6: the holder's own ⋯ after sync moved it (a remote move below another card) ---
for(const ids of [true,false])for(const boxChanged of [false,true])scenario(`the written card moved below another card elsewhere (ids=${ids}, box changed=${boxChanged}): the holder's own ⋯`,async t=>{
 const {p,w,setRemote}=await liveR5(t,card('Budget','budget words',ids?details(A):null)+card('Other','other words',ids?details(B):null));
 edit867(p,0);p.paint();if(boxChanged){p.editing.field.value='Budget\nbudget words typed';p.save();}
 setRemote(card('Other','other words',ids?details(B):null)+card('Budget','budget words',ids?details(A):null));
 await w.refresh();p.sync();assert.equal(w.conflict,null,'fixture: merged');assert.ok(p.editing);assert.equal(holderRow(p),1,'the holder followed its card down');
 return {p,row:holderRow(p)};
},expectCard('Budget',{index:1,words:boxChanged?'budget words typed':'budget words'}));
// --- S7: expanded headings ---
// The holder's writing adds a deeper and a sibling heading; the target below is an id-less twin of the added sibling.
for(const [target,index] of [['Same',2],['Below',3]])scenario(`editor adds '### Deeper' and '## Same' headings; ⋯ on ${target} below it`,async t=>{
 const p=painted867(t,menuPage(card('Editing','editing words',details(A))+card('Same','same words',null)+card('Below','below words',null)));
 edit867(p,0,'Changed\nnew\n\n### Deeper\nd\n\n## Same\nsame words');p.paint();return {p,row:index-1};
},expectCard(target,{index:index+1}));
scenario(`editor adds headings; the holder's own ⋯`,async t=>{
 const p=painted867(t,menuPage(card('Editing','editing words',details(A))+card('Below','below words',null)));
 edit867(p,0,'Changed\nnew\n\n### Deeper\nd\n\n## Added\nmore');p.paint();return {p,row:0};
},expectCard('Changed',{index:0,words:'new'}));
// The written card's heading level changed elsewhere (## Budget → ### Budget under Parent). With the box unchanged
// the revision merges; with the box changed, both sides changed the same card and the writer reports a conflict.
async function levelChanged(t,boxChanged){
 const {p,w,setRemote}=await liveR5(t,card('Parent','parent words',details(A))+card('Budget','budget words',details(B))+card('Other','other words',details(CC)));
 edit867(p,1);p.paint();if(boxChanged){p.editing.field.value='Budget\nbudget words typed';p.save();}
 setRemote(card('Parent','parent words',details(A))+card('Budget','budget words',details(B)).replace('## Budget','### Budget')+card('Other','other words',details(CC)));
 await w.refresh();p.sync();return {p,w};
}
scenario(`the written card's heading level changed elsewhere (box unchanged): the holder's own ⋯`,async t=>{
 const {p,w}=await levelChanged(t,false);assert.equal(w.conflict,null,'fixture: merged');assert.ok(p.editing);assert.equal(p.editing.depth,1,'the box took the card\'s new depth');
 return {p,row:holderRow(p)};
},expectCard('Budget',{index:1,words:'budget words'}));
scenario(`the written card's heading level changed elsewhere (box unchanged): ⋯ on Other`,async t=>{
 const {p,w}=await levelChanged(t,false);assert.equal(w.conflict,null);return {p,row:rowOf(p,'Other')};
},expectCard('Other',{index:2}));
test(`R5MENU (fixture) the written card's heading level changed elsewhere while its box changed is a conflict; the menu under it`,async t=>{
 const {p,w}=await levelChanged(t,true);assert.ok(w.conflict,'both sides changed Budget');
 const out=[];const row=holderRow(p);const o=await act867(t,p,row,'Copy text');out.push(o);
 const d=await act867(t,p,holderRow(p),'Delete');out.push({...d,writable:p.cardWritable()});
 console.log(JSON.stringify({name:'level changed + box changed (conflict)',painted:rowsOf(p),out,deck:titles(p)}));
 assert.equal(o.copied.split(' / ')[0],'Budget');assert.equal(p.cardWritable(),false,'destructive items are disabled under a conflict');
});
// --- S8: a ⋯ press whose card the cleared box's finish removes ---
scenario(`cleared parent box: ⋯ on the card after its group`,async t=>{
 const p=painted867(t,menuPage(card('Parent','parent words',details(A))+'### kid\n\nkid words\n\n'+card('Next','next words',details(B))));
 edit867(p,0,'');p.paint();return {p,row:2};
},expectCard('Next',{index:0}));
scenario(`cleared parent box: ⋯ on its child`,async t=>{
 const p=painted867(t,menuPage(card('Parent','parent words',details(A))+'### kid\n\nkid words\n\n'+card('Next','next words',details(B))));
 edit867(p,0,'');p.paint();return {p,row:1};
},expectNoMenu);
scenario(`cleared box: the holder's own ⋯`,async t=>{
 const p=painted867(t,menuPage(card('Cleared','cleared words',details(A))+card('Next','next words',details(B))));
 edit867(p,0,'');p.paint();return {p,row:0};
},expectNoMenu);
// --- S9: the box opens a fence that swallows the pressed card; an id-less twin stands beyond a closing line ---
for(const ids of [false,true])test(`R5MENU open fence in the box swallows the pressed card; a twin beyond a closing line (ids=${ids})`,async t=>{
 const p=painted867(t,menuPage(card('Editing','editing words',details(A))+card('Same','same words',ids?details(B):null)+card('Closer','```\n\nmore',null)+card('Same','same words',ids?details(CC):null)));
 edit867(p,0,'Editing\n```js\nunclosed');p.paint();
 const out=await act867(t,p,1,'Delete');
 console.log(JSON.stringify({name:'open fence swallow',ids,...out,bodies:p.deck.cards.map(c=>c.title)}));
 // The pressed card is no longer a card; the menu must not act on the other twin.
 if(out.action==='Delete'&&out.removed)assert.fail('the menu acted on another card: '+JSON.stringify(out));
});
// --- S10: a menu left open across a remote shift (round-4 note A8, rerun) ---
test('R5MENU (note) a menu left open across a remote shift of id-less twins',async t=>{
 const p=painted867(t,menuPage(card('Same','same words',null)+card('Same','same words',null)));p.paint();
 const menu=press867(p,1);
 p.deck=parseDeck(card('Incoming','x',null)+card('Same','same words',null)+card('Same','same words',null));p.paint();
 choice867(menu,'delete');console.log(JSON.stringify({name:'A8 rerun',deck:titles(p),undoNear:p.undos.at(-1)?.near}));
});
// --- S11: a fresh card whose writing holds a second heading; the ⋯ on the card below it ---
for(const [target,index] of [['Below',1],['Same',2]])scenario(`fresh card after Top whose writing adds '## Same'; ⋯ on ${target}@${index}`,async t=>{
 const p=painted867(t,menuPage(card('Top','top words',details(A))+card('Below','below words',null)+card('Same','same words',null)));
 freshAt(p,cardText(p.deck.cards[0]),0,'New\nnew words\n\n## Same\nsame words',0);p.paint();
 return {p,row:p.list.children.findIndex(r=>!r.classList.contains('deck-writing')&&r.dataset.index===String(index)),note:'after finish: Top, New, Same(added), Below, Same'};
},expectCard(target,{index:index+2}));

// --- A8NOTE probe: the remote shift arrives through the real sync(), not a bare deck assignment ---
const child=(title,words)=>'### '+title+'\n\n'+words+'\n\n';
for(const marked of [false,true])test(`A8NOTE real sync; twins ${marked?'marked by children':'identical, childless'}`,async t=>{
 const twin=(c)=>card('Same','same words',null)+(marked?child('Kid '+c,'kid '+c):'');
 const {p,w,setRemote}=await liveR5(t,twin('a')+twin('b'));p.paint();
 const secondSame=p.deck.cards.flatMap((c,i)=>c.title==='Same'?[i]:[]).at(-1);
 const rowIndex=p.list.children.findIndex(r=>r.dataset.index===String(secondSame));
 const anchor=p.list.children[rowIndex].querySelector(".deck-menu");const menu=press867(p,rowIndex);
 setRemote(card('Incoming','x',null)+twin('a')+twin('b'));
 const took=await w.refresh();p.sync();
 const menuStillOpen=p.doc.body.querySelector('[role="menu"]')===menu;
 const before=deckBody(p.deck);
 choice867(menu,'delete');
 const after=deckBody(p.deck);const undoNear=p.undos.at(-1)?.near;
 p.undo();const undone=deckBody(p.deck);
 console.log(JSON.stringify({name:'A8NOTE',marked,took,menuStillOpen,anchorConnected:anchor.isConnected,
  pressedIndexBefore:secondSame,titlesAfterDelete:parseDeck(after).cards.map(c=>c.title),undoNear,
  bodyAfterDeleteEqualsDeletingPressed:after===deckBody(parseDeck(card('Incoming','x',null)+twin('a'))),
  bodyAfterDeleteEqualsDeletingOther:after===deckBody(parseDeck(card('Incoming','x',null)+twin('b'))),
  undoRestoresBase:undone===before}));
});
