import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { arrangeStacks, stackState } from '../web/reply-stacks.mjs';
import { CardReplies } from '../web/card-replies.mjs';
import { Editor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import * as foldModule from '../web/fold.mjs';
const { foldCard, show } = foldModule;
import { gather, shown, rowsOf, rowFolded } from '../web/stack-order.mjs';

Object.defineProperty(Element.prototype,'ownerDocument',{get(){return this.document;}});
const item = (seq, extra = {}) => ({id:'m'+seq,seq,author_id:'agent',body:'Exact words '+seq,addressees:['other'],...extra});
test('item 800 automatic wrapper keeps own note whole through retained close and delayed metadata removal', () => {
  const doc=miniDocument();doc.createTextNode=text=>text;const card=doc.createElement('article'),m=item(1,{yours:{note:true}}),fold=foldCard(card,m,doc);
  assert.equal(card.hidden,false,'own note overrides initial automatic fold');
  assert.equal(fold.children[0].hidden,true,'no substitute folded line');
  show(fold,false); assert.equal(card.hidden,false,'explicit close cannot hide own note');
  foldModule.paintOwnNoteFold(fold,{...m,yours:{note:false}}); assert.equal(card.hidden,true,'clearing restores retained close');
  foldModule.paintOwnNoteFold(fold,m); assert.equal(card.hidden,false,'delayed note addition opens the same card');
  show(fold,true); foldModule.paintOwnNoteFold(fold,{...m,yours:{note:false}}); assert.equal(card.hidden,false,'ordinary explicit opening retained');
});
test('item 800 note flag strictly reader scoped and underlying fold acts remain unchanged', () => {
  for(const flag of [undefined,false,'true',1])assert.equal(rowFolded(item(1,{yours:{note:flag},acts:{folded:true}})),true);
  const m=item(1,{yours:{note:true},acts:{folded:true,fold_revision:7}});
  assert.equal(rowFolded(m),false,'stored public-command fold cannot override own-note display');
  assert.deepEqual(m.acts,{folded:true,fold_revision:7});
  assert.equal(rowFolded({...m,yours:{note:false}}),true,'second reader without note folds normally');
});
test('item 800 own-note replies escape closed, latest and earlier dossier hiding without latching keep state', () => {
  const root=item(1),note=item(2,{reply_to:root.id,yours:{note:true}}),last=item(10,{reply_to:root.id});
  const stack=gather([root,note,...Array.from({length:7},(_,i)=>item(i+3,{reply_to:root.id})),last])[0];
  for(const level of ['head','folded','open']){
    assert.equal(shown(stack,note,{level}),true,level+': own note stays in dossier');
    const rows=rowsOf(stack,{level});
    assert.ok(rows.some(r=>r.kind==='reply'&&r.item===note&&!r.folded),'own note gets its real reply');
    assert.ok(!rows.some(r=>r.items?.includes(note)),'no folded/earlier summary claims the note');
  }
  note.yours={note:false};
  assert.equal(shown(stack,note,{level:'folded'}),false,'removal restores ordinary hidden reply');
});

// DOM data checks only; native runs hold geometry and input.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]')).filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/["']/g, '')));
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
Element.prototype.after = function(node) { this.parent.insertBefore(node, this.nextElementSibling); };


function dossier({quiet=false}={}) {
  const doc=withReaderArchive(miniDocument()),list=doc.createElement('div'); list.root=true;
  const messages=new Map(),cards=new Map();
  for(let n=1;n<=11;n++) {
    const m=item(n,{topic_id:'note-800',reply_to:n===1?null:'m1',acts:{folded:true},yours:{note:n<=2}});
    const c=doc.createElement('article');c.className='message-card';c.dataset.id=m.id;c.dataset.seq=String(n);
    const author=doc.createElement('span');author.className='message-author';
    const body=doc.createElement('span');body.className='message-preview';body.textContent=m.body;c.append(author,body);
    cards.set(m.id,c);messages.set(m.id,m);list.append(c);
  }
  const state=stackState(list),draw=()=>arrangeStacks(list,messages,{doc,viewer:'reader',quiet:()=>quiet});
  return {state,messages,cards,draw,section:()=>state.sections.get('m1')};
}
test('item 800 actual dossier painter preserves whole heads/replies and restores retained earlier rows',()=>{
  const f=dossier();
  for(const level of ['folded','open']) {
    f.state.levels.set('m1',level);f.draw();
    assert.equal(f.section().dataset.headOpen,'true');
    assert.equal(f.cards.get('m2').hidden,false);
    assert.notEqual(f.cards.get('m1').dataset.folded,'true');
    assert.notEqual(f.cards.get('m2').dataset.folded,'true');
    assert.notEqual(f.cards.get('m2').dataset.earlier,'true');
  }
  const boundary=f.state.held.get('m1');
  f.messages.get('m1').yours={note:false};f.messages.get('m2').yours={note:false};f.draw();
  assert.equal(f.state.held.get('m1'),boundary,'note removal does not recount the newest seven');
  assert.equal(f.section().dataset.headOpen,'false');assert.equal(f.cards.get('m2').hidden,true);
  f.state.earlier.add('m1');f.draw();
  assert.equal(f.cards.get('m2').dataset.folded,'true','stored fold resumes after clearing note');
});
test('item 800 actual closed quiet dossier exposes note cards without changing its level',()=>{
  const f=dossier({quiet:true});f.state.levels.set('m1','head');f.draw();
  assert.equal(f.section().dataset.fold,'head');assert.equal(f.section().dataset.compact,'false');
  assert.equal(f.section().dataset.coordinationRevealed,'true','the quiet filter cannot hide the note corner');
  assert.equal(f.section().dataset.headOpen,'true');assert.equal(f.cards.get('m2').hidden,false);
  f.messages.get('m1').yours={note:false};f.messages.get('m2').yours={note:false};f.draw();
  assert.equal(f.section().dataset.compact,'true');assert.equal(f.section().dataset.headOpen,'false');
  assert.equal(f.section().dataset.coordinationRevealed,'false','clearing does not latch the quiet reveal');
  assert.equal(f.cards.get('m2').hidden,true);
});

test('item 800 a restored reply composer precedes the actual note corner on a replaced card',()=>{
  const doc=miniDocument(),card=doc.createElement('article'),corner=doc.createElement('span'),root=doc.createElement('div');
  card.root=true;corner.className='note-corner';card.append(corner);
  const row={card:doc.createElement('article'),ui:{root}},owner={rows:new Map([['m1',row]]),closed:new Set(),queue:new Map(),drain(){}};
  CardReplies.prototype.sync.call(owner,[{id:'m1',yours:{reply:true}}],()=>card);
  assert.deepEqual(card.children,[root,corner],'reply content cannot displace the corner from the bottom');
});

async function reopenNote(change = () => {}) {
  const ref={kind:'message',id:'m1'},context={instanceId:'fixture',actor:'reader',sourceRef:ref,topicId:'t1'};
  const note=new Editor({...context,kind:'note'},{id:'note1',revision:2,body:''}),reply=new Editor(context,{id:'draft1',revision:1,generation:'g1',body:'Exact reply stays.'});
  const remote={id:'note1',revision:3,body:'Later private note.\nKeep  exact.',source_ref:ref};
  let saved=0;const session={unsettledSave:()=>null,persist:async()=>{saved++;}};
  change({note,reply,remote,session});
  const state={instance_id:'fixture',source_ref:ref,destination:{topic_id:'t1'},source_available:true,destination_available:true,draft:null,note:remote,submissions:{instance_id:'fixture',items:[],next_cursor:null}};
  const owner=Object.assign(Object.create(EditorRegistry.prototype),{generation:0,bootstrap:{instance_id:'fixture',actor:'reader'},runtime:{current:{authority_id:'fixture',authority_epoch:'epoch',continuity:'initial'}},cards:new Map(),
    cleanup:{foreground:()=>({read:fn=>fn({}),release(){}})},api:{view:async name=>name==='source'?{instance_id:'fixture',source_ref:ref,body:'Source.'}:state},
    activity(){},keepBeforeStep:async()=>{},setPending(){},register:async c=>c.kind==='note'?note:reply,sessionFor:()=>session,changed(){},present:async()=>{}});
  const p=await owner.open(ref,{topicId:'t1',mode:'note'});
  assert.equal(p.editors.reply.draft.body,'Exact reply stays.');
  return {note,remote,saved};
}
test('item 800 actual Reader open refreshes a saved empty note from the newer exact-source read',async()=>{
  const {note,remote,saved}=await reopenNote();assert.equal(note.draft.body,remote.body);assert.equal(note.draft.revision,3);assert.equal(saved,1);
});
for(const [name,change] of [
  ['unsaved writing',({note})=>note.edit({body:'Unsaved local words.'})],
  ['existing saved writing',({note})=>{note.draft.body='Saved local words.';}],
  ['unsettled save',({session})=>{session.unsettledSave=()=>({operation:'same-retry'});}],
  ['conflict',({note})=>{note.conflict={attempted:{body:'Kept copy'}};}],
  ['authority recovery',({note})=>{note.authorityRecovery={reason:'old authority'};}],
  ['failed device save',({note})=>{note.journalError='device full';}],
  ['older answer',({remote})=>{remote.revision=1;}],
  ['different saved note',({remote})=>{remote.id='different';}],
]) test('item 800 note refresh preserves '+name,async()=>{
  let expected;const {note,saved}=await reopenNote(args=>{change(args);expected=structuredClone(args.note.draft);});
  assert.deepEqual(note.draft,expected);assert.equal(saved,0);
});
