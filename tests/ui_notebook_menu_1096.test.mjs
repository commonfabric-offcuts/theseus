import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookMenuItems, NotebookPage } from '../web/notebook-page.mjs';
import { notebookReaderMenuItems, openNotebookMenu } from '../web/notebook-menu.mjs';
import { NotebookRailMenu } from '../web/notebook-rail-menu.mjs';
import { NotebookLinkStart, NotebookStarts } from '../web/notebook-start.mjs';
import { AGENT_PALETTE } from '../web/author-colors.mjs';
import { card, details, writingPort, cardDetails, parseDeck, documentPort } from './fixtures/card_text_867.mjs';

// Actual descriptors and command owners with scratch memory ports. These
// assert routing/save/recovery; native focus/touch/paint is a separate phase.
function page(options={}) {
 const calls=[],w={pageState:{starred:true,reader_may_delete:true},value:{draft:true}};
 const p={writing:w,readOnly:false,mode:'cards',undos:[{}],drafted:()=>true,
   pageAction:(...a)=>calls.push(a),markDraft:x=>calls.push(['draft',x]),switchView:x=>calls.push(['view',x]),
   startNew:x=>calls.push(['start',x]),copyLink:()=>calls.push('copy'),rename:()=>calls.push('rename'),
   addImage:{onclick:()=>calls.push('image')},edit:()=>calls.push('edit'),undo:()=>calls.push('undo'),start:()=>calls.push('new'),...options};
 return {p,calls,w,items:()=>notebookMenuItems(p)};
}
const by=(items,key)=>{const x=items.find(i=>i.key===key);assert.ok(x,'offers '+key);return x;};
test('1096 page palette separates state from acts and retains exact action owners',()=>{
 const {p,calls,items}=page();const list=items();
 assert.deepEqual(list.filter(x=>x.place==='mark').map(x=>x.key),['star','draft','copy']);
 assert.deepEqual(list.filter(x=>x.place==='view').map(x=>[x.label,x.checked]),[['Text',false],['Cards',true]]);
 assert.deepEqual(list.filter(x=>x.place==='start').map(x=>x.label),['Topic','Dossier']);
 assert.deepEqual(list.filter(x=>x.place==='danger').map(x=>x.label),['Delete page']);
 assert.deepEqual(list.filter(x=>x.place==='key').map(x=>x.key),['edit','undo','new']);
 for(const key of ['star','draft','text','start-topic','start-dossier','image','rename','edit','undo','new'])by(list,key).act();
 assert.deepEqual(calls,[['memory.star',{starred:false}],['draft',false],['view','text'],['start','topic'],['start','dossier'],'image','rename','edit','undo','new']);
 p.mode='text';assert.ok(!items().some(x=>x.place==='key'));
 p.inNotebookSheet=true;assert.ok(!items().some(x=>x.key==='rename'));
 assert.ok(notebookMenuItems(p,{rail:true}).some(x=>x.key==='rename'));
});
test('1096 stale page writer permission and deleted-page recovery are retained',()=>{
 const {p,w,calls,items}=page();const old=items();w.reading=true;
 for(const key of ['draft','image','rename','edit','undo','new'])by(old,key).act();assert.deepEqual(calls,[]);
 w.reading=false;p.readOnly=true;assert.equal(by(items(),'draft').disabled,true);
 w.deleted=true;assert.deepEqual(items().map(x=>x.label),['Undo delete']);by(items(),'restore').act();assert.deepEqual(calls,[['memory.delete',{deleted:false}]]);
 w.pageState.reader_may_delete=false;assert.deepEqual(items(),[]);
});
test('1096 Reader menu retains independent star/revision/edit/delete permissions',()=>{
 const calls=[],source={source_ref:{revision:8},starred:true,reader_may_write:true,reader_may_delete:true};
 const list=notebookReaderMenuItems(source,key=>calls.push(key));
 assert.deepEqual(list.map(x=>x.key),['star','copy','edit','revision','start-topic','start-dossier','rename','delete']);
 for(const x of list)x.act();assert.deepEqual(calls,list.map(x=>x.key));
 assert.match(by(list,'revision').label,/8/);assert.equal(by(list,'star').checked,true);
 const restricted=notebookReaderMenuItems({...source,reader_may_write:false,reader_may_delete:false},()=>{});
 assert.ok(!restricted.some(x=>['edit','rename','delete'].includes(x.key)));
});
test('1096 card swatches include No colour first and use real save-confirm path',async t=>{
 const {p,w,source}=await writingPort(t,card('One','kept',null));
 let list=p.cardMenuItems(p.cardRef(0),p.anchor);
 assert.deepEqual(list.filter(x=>x.place==='swatch').map(x=>x.color),[null,...AGENT_PALETTE]);
 assert.equal(by(list,'color-none').checked,true);assert.ok(!list.some(x=>x.label==='Set color'));
 await by(list,'color-blue').act();await w.flush();
 assert.equal(cardDetails(parseDeck(source().body).cards[0].words).color,'blue');
 list=p.cardMenuItems(p.cardRef(0),p.anchor);await by(list,'color-none').act();await w.flush();
 assert.equal(cardDetails(parseDeck(source().body).cards[0].words).color,null);
});
test('1096 unconfirmed swatch says so and stale card actions cannot change another card',async t=>{
 const {p,w,api,source}=await writingPort(t,card('One','kept',details()));
 p.source=source();p.room={agents:['a']};p.cardNotice=words=>{p.notice=words;};
 const old=p.cardMenuItems(p.cardRef(0),p.anchor);api.command=async()=>{throw Error('scratch transport lost');};
 await by(old,'color-rose').act();assert.match(p.notice,/not confirmed/);assert.equal(w.dirty,true);
 p.readOnly=true;const n=w.value.body;await by(old,'color-blue').act();by(old,'delete').act();assert.equal(w.value.body,n);
});
test('1096 card link is saved before Start new, and a disappeared card starts nothing',async t=>{
 const origin=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://fixture.invalid/')});t.after(()=>{if(origin)Object.defineProperty(globalThis,'location',origin);else delete globalThis.location;});
 const {p,w,source}=await writingPort(t,card('One','kept',null));p.source=source();p.pageNotice=p.doc.createElement('div');
 const calls=[];p.startNotebook=options=>calls.push(options);p.more=p.anchor;
 assert.equal(typeof p.startNew,'function','the page offers link-based Start new');
 await p.startNew('topic',p.cardRef(0));assert.equal(calls.length,1);assert.match(calls[0].link,/card=c-/);
 assert.match(source().body,/theseus-card/);assert.equal(w.dirty,false);
 const ref=p.cardRef(0);p.deck.cards=[];await p.startNew('dossier',ref);assert.equal(calls.length,1);
});
test('1096 image menu targets identity after reorder and rechecks permission after the picker',()=>{
 const calls=[],p=Object.assign(Object.create(NotebookPage.prototype),{cardWritable:()=>true,cardAt:()=>1,
   pick:i=>calls.push(['pick',i]),edit(){calls.push('edit');this.editing={field:{},fresh:false};},addToCard:(f,field)=>calls.push(['image',f,field]),cardNotice:words=>calls.push(words)});
 assert.equal(typeof p.imageIntoCard,'function','the page offers image placement into a named card');
 const file={name:'scratch.png'};p.imageIntoCard({id:'owned'},file);
 assert.deepEqual(calls.slice(0,2),[['pick',1],'edit']);assert.equal(calls[2][1][0],file);
 p.cardWritable=()=>false;p.imageIntoCard({id:'owned'},file);assert.match(calls.at(-1),/no longer/);assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='image').length,1);
});
const bootstrap={instance_id:'scratch',authority:{authority_id:'a',authority_epoch:'e'}};
const read=async(name,args)=>name==='topic'?{topic:{workspace_id:'w'}}:{conversation:{topic_id:'t'}};
const receipt=(e,result)=>({instance_id:e.instance_id,kind:e.kind,operation_id:e.operation_id,recorded:true,status:'committed',result});
test('1096 Topic opening carries only the page/card link and retries an exact lost opening',async()=>{
 const sent=[];let lost=true;const api={command:async e=>{sent.push(structuredClone(e));if(lost){lost=false;throw Error('lost');}return receipt(e,e.kind==='opening.save'?{opening_revision:1}:{topic:{id:'new-topic'}});}};
 const job=new NotebookLinkStart({api,bootstrap,read,kind:'topic',scope:{kind:'topic',id:'t'},link:'https://scratch/?cards=n&card=c'});
 await assert.rejects(job.start('Title'),/Not confirmed/);assert.deepEqual(await job.start('Title'),{kind:'topic',id:'new-topic'});
 assert.deepEqual(sent[0],sent[1]);assert.equal(sent[1].args.body,'https://scratch/?cards=n&card=c');assert.ok(!('source_message_id' in sent[1].args));
});
test('1096 Dossier retry retains exact writing/destination and refuses replacement until confirmed',async()=>{
 const sent=[];let lost=true;const api={command:async e=>{sent.push(structuredClone(e));if(lost){lost=false;throw Error('lost');}return receipt(e,{message_id:'opening'});}};
 const job=new NotebookLinkStart({api,bootstrap,read,kind:'dossier',scope:{kind:'workspace',id:'w'},link:'https://scratch/?page=n'});
 await assert.rejects(job.start('First words'),/Not confirmed/);await assert.rejects(job.start('Changed'),/earlier writing/);
 assert.deepEqual(await job.start('First words'),{kind:'topic',id:'t',message:'opening'});assert.deepEqual(sent[0],sent[1]);
 assert.equal(sent[0].args.body,'First words\n\nhttps://scratch/?page=n');assert.deepEqual(sent[0].target,{topic_id:'t'});assert.deepEqual(sent[0].args.addressees,[]);
});

test('1096 resumed Start line keeps exact writing and uses its current source opening',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'document'),doc=documentPort();
 Object.defineProperty(globalThis,'document',{configurable:true,value:doc});t.after(()=>old?Object.defineProperty(globalThis,'document',old):delete globalThis.document);
 const commands=[],opened=[],api={command:async request=>{commands.push(structuredClone(request));return receipt(request,{message_id:'opened'});}};
 const starts=new NotebookStarts({api,bootstrap,read,open:(...args)=>opened.push(args)});
 const host=doc.createElement('div'),anchor=doc.createElement('button');host.ownerDocument=doc;doc.body.append(host,anchor);
 const source={title:'Source',owner_scope:{kind:'topic',id:'t'}},link='https://scratch/?page=n';
 const first=starts.show({kind:'dossier',source,link,host,anchor,current:()=>false});first.input.value='Kept exact writing';first.cancel();
 const resumed=starts.show({kind:'dossier',source,link,host,anchor,current:()=>true});assert.ok(resumed===first);assert.equal(resumed.input.value,'Kept exact writing');
 await resumed.go();assert.equal(commands.length,1);assert.equal(commands[0].args.body,'Kept exact writing\n\n'+link);assert.equal(opened.length,1);assert.equal(opened[0][0].message,'opened');
});
