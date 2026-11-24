// Shared setup-only constructors. No node:test import or behavior assertions.
// All adapters below are memory ports; native/browser and durable Core are separate.
import { escapeDocument, dispatch } from './escape_keeps_1172_dom.mjs';
import { OneLine, TopicStart, OutcomeStart, NotebookStart } from '../../web/quick-create.mjs';
import { NotebookCreate } from '../../web/notebook-create.mjs';
import { NotebookStarts } from '../../web/notebook-start.mjs';
import { PurposeLine } from '../../web/outcome-purpose.mjs';
import { TopicStatePanel } from '../../web/topic-state.mjs';
import { PipelinePage, titleLine } from '../../web/pipeline.mjs';
import { OutcomeTargets } from '../../web/targets.mjs';
import { WorkspaceLinks } from '../../web/workspace-links.mjs';
import { NotebookPage } from '../../web/notebook-page.mjs';
import { NotebookWriting } from '../../web/notebook-writing.mjs';
import { arrangeStacks, stackState, renameInput } from '../../web/reply-stacks.mjs';
import { StackFeed } from '../../web/stack-feed.mjs';
import { withReaderArchive } from './reader_archive.mjs';
import { parseDeck } from '../../web/deck.mjs';

export const BINDINGS = [
  ['topic-title-header','close'],['topic-title-settings','close'],['topic-note','save'],['topic-part','save'],
  ['dossier-name','close'],['outcome-purpose','save'],['notebook-title','close'],['pipeline-title','close'],
  ['stage-name','refuse'],['stage-done','save'],['stage-checks','save'],['pipeline-words','save'],
  ['held-title','close'],['aside-reason','close'],['pipeline-add-item','close'],['pipeline-add-stage','close'],
  ['target-writer','close'],['reach-reason','close'],['accept-reason','close'],
  ['link-edit','close'],['link-create','close'],
  ['rail-topic-plus','close'],['rail-topic-pencil','close'],['quick-outcome','close'],
  ['notebook-create','close'],['notebook-start-topic','close'],['notebook-start-dossier','close'],
  ['app-start-topic-owner','close'],['app-add-pipeline-owner','close'],
];
export const settle = async () => { for(let i=0;i<12;i++) await new Promise(setImmediate); };
export async function fieldFixture(id, { refused = false, hold = false } = {}) {
  const previous = new Map(['document','window','CSS'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const doc=escapeDocument(), root=doc.createElement('dialog');root.open=true;doc.body.append(root);
  globalThis.document=doc;globalThis.window=doc.defaultView;globalThis.CSS={escape:x=>String(x),supports:()=>true};
  const cleanup=[], sent=[], bootstrap={instance_id:'1172-memory',actor:'owner',authority:{authority_id:'fixture',authority_epoch:'one'}};
  let field, open=()=>field.focus(), closed=()=>doc.activeElement!==field;
  let release;
  const api={command:async request=>{sent.push(structuredClone(request));if(hold){hold=false;await new Promise(resolve=>{release=resolve;});}if(refused)throw Error('1172 save refused');
    const result=request.kind==='opening.save'?{opening_revision:1}:request.kind==='opening.publish'?{topic:{id:'made'}}:
      request.kind==='message.post'?{message_id:'made-message'}:request.kind==='memory.create'?{item_id:request.target.item_id,revision:1,owner_scope:request.target.owner_scope}:{id:request.args.id};
    return {instance_id:request.instance_id,operation_id:request.operation_id,kind:request.kind,recorded:true,status:'committed',result};},
    view:async name=>name==='conversation'?{conversation:{topic_id:'conversation'}}:{topic:{workspace_id:'w'}}};
  const record=(kind,args)=>{sent.push({kind,args:structuredClone(args)});if(refused)throw Error('1172 save refused');};
  const f={id,doc,root,sent,api,bootstrap,record,cleanup};
  Object.assign(f, await constructField(f));field=f.field;open=f.open??open;closed=f.closed??closed;
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&event.keyCode!==229)root.open=false;});
  return {...f,open,closed,release(){release?.();},secondEscape(){return dispatch(root,'keydown',{key:'Escape'});},type(value){field.value=value;dispatch(field,'input');},key(key,extra={}){return dispatch(field,'keydown',{key,...extra});},
    leave(relatedTarget=null){doc.activeElement=relatedTarget??doc.body;return dispatch(field,'blur',{relatedTarget});},
    async close(){for(const fn of cleanup.reverse())await fn();for(const [k,d]of previous)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];}};
}

async function constructField(f) {
  const {id,doc,root,sent,api,bootstrap,record,cleanup}=f;
  if(id.startsWith('rail-topic')||id==='app-start-topic-owner'||id==='quick-outcome') {
    const starter=id==='quick-outcome'?new OutcomeStart({api,bootstrap}):new TopicStart({api,bootstrap,workspace:'w',source:id==='app-start-topic-owner'?'source':null});
    const line=new OneLine({id:'1172-'+id,label:id,submit:async title=>{await (starter.create?.(title)??starter.start(title));line.root.remove();doc.body.focus();},cancel:()=>{line.root.remove();doc.body.focus();}});
    root.append(line.root);return {field:line.input,owner:line,closed:()=>!line.root.isConnected};
  }
  if(id==='notebook-create') {
    const host=doc.createElement('section'),heading=doc.createElement('h2');heading.className='rail-heading';host.append(heading);root.append(host);
    const owner=new NotebookCreate({host,scope:{kind:'workspace',id:'w'},api,bootstrap,open:async()=>{}});
    heading.after(owner.line.root);return {field:owner.line.input,owner,closed:()=>!owner.line.root.isConnected};
  }
  if(id.startsWith('notebook-start-')) {
    const anchor=doc.createElement('button');root.append(anchor);
    const owner=new NotebookStarts({api,bootstrap,read:api.view,open:async()=>{doc.body.focus();}});
    const line=owner.show({kind:id.endsWith('topic')?'topic':'dossier',source:{title:'Before',owner_scope:{kind:'workspace',id:'w'}},link:'https://1172.invalid/page',host:root,anchor});
    return {field:line.input,owner,closed:()=>!line.root.isConnected};
  }
  if(id==='outcome-purpose') {
    const description=doc.createElement('p');root.append(description);
    const owner=new PurposeLine({host:root,description,save:async words=>{record('workspace.update',{purpose:words});return {status:'committed'};}});
    owner.paint({id:'w',purpose:'Before'},true);return {field:owner.box,owner,open:()=>owner.edit(),closed:()=>owner.box.hidden};
  }
  if(id.startsWith('topic-')) {
    const header={host:doc.createElement('div'),title:doc.createElement('h1'),pencil:doc.createElement('button')};root.append(header.host,header.title,header.pencil);
    let topic={id:'t',version:1,title:'Before',state:'active',state_note:'Before',waiting_on:[],owner_id:'owner',creator_id:'owner',reader_may_say:true,archived:false};
    const result=args=>({topic_id:'t',version:++topic.version,title:args.title??topic.title,state:args.state??topic.state,note:args.note??topic.state_note,waiting_on:[],archived:false});
    const owner=new TopicStatePanel({host:root,reader:'owner',titleSurface:id.endsWith('header')?header:null,
      send:async(_topic,args)=>{record('topic.update',args);return {status:'committed',result:result(args)};},
      sendNote:async(_topic,note)=>{record('topic.responsibility',{note});return {status:'committed',result:{topic_id:'t',actor_id:'owner',version:2,note,responsibility_revision:2}};}});
    owner.paint(topic,[{actor_id:'owner',responsibility:'Before',responsibility_revision:1}]);
    const name=id==='topic-note'?'note':id==='topic-part'?'duty':'title',field=owner.fields[name].line;
    return {field,owner,open:()=>name==='title'?(id.endsWith('header')?owner.renameTitle():owner.renaming(true)):field.focus(),closed:()=>name==='title'?field.hidden:doc.activeElement!==field};
  }
  if(id==='dossier-name')return dossierField(f);
  if(id==='notebook-title') return notebookTitle(f);
  if(id.startsWith('stage-')||['pipeline-title','pipeline-words','held-title','aside-reason','pipeline-add-item','pipeline-add-stage','app-add-pipeline-owner'].includes(id)) return pipelineField(f);
  if(['target-writer','reach-reason','accept-reason'].includes(id))return targetField(f);
  if(id==='link-edit'||id==='link-create')return linkField(f);
  throw Error('Unconstructed binding '+id);
}

async function notebookTitle({doc,root,sent,bootstrap,cleanup,record}) {
  let source={instance_id:bootstrap.instance_id,source_ref:{kind:'memory',id:'page',revision:1},owner_scope:{kind:'workspace',id:'w'},title:'Before',body:'Opening\n\n## First\n\nWords\n',attachments:[],references:[]},journal=null;
  const api={view:async()=>structuredClone(source),command:async request=>{
    record(request.kind,request.args);source={...source,...structuredClone(request.args),source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};
    return {instance_id:bootstrap.instance_id,operation_id:request.operation_id,kind:request.kind,status:'committed',recorded:true,result:{item_id:'page',revision:source.source_ref.revision,source_ref:source.source_ref}};
  }};
  const writing=new NotebookWriting({item:'page',bootstrap,api,store:{get:async()=>structuredClone(journal),put:async value=>{journal=structuredClone(value);}},delay:60000});
  await writing.open();cleanup.push(()=>writing.close());
  const header={title:doc.createElement('h1'),description:doc.createElement('p')};root.append(header.title,header.description);
  const owner=new NotebookPage({doc,host:root,item:'page',mode:'text',bootstrap,viewPreference:{get:()=> 'text',set(){}},header});
  Object.assign(owner,{writing,deck:parseDeck(source.body),base:{revision:1,body:source.body},paint(){},keepNamed(){}});owner.sync(true);
  cleanup.push(()=>{owner.listening.abort();owner.disclosure?.close();owner.stopCaret?.();});
  return {field:owner.titleBox,owner,writing,open:()=>owner.rename(),closed:()=>owner.titleBox.hidden};
}

function pipelineField(f) {
  const {id,doc,root,record}=f,stage={stage_id:'build',name:'Before',done_when:'Before',gate:{checks:[],owner:false,words:'Before'},rounds:'none',scope:'piece'};
  const pipeline={enabled:true,title:'Before',version:1,sized:false,owner:'owner',you_own:true,stages:[stage],section_words:{candidates:'Candidates',later:'Later'}};
  const item={number:1,title:'Before',description:'Before',version:1,section:'now'};
  const header={title:doc.createElement('h1'),description:doc.createElement('p'),eyebrow:doc.createElement('p')};root.append(header.title);
  const owner=new PipelinePage({host:root,header,reader:'owner',instanceId:'1172-memory',workspace:'w',item:id==='pipeline-words'?1:null,read:async()=>null,
    send:async(kind,target,args)=>{record(kind,args);return {status:'committed',recorded:true,result:{number:2}};}});
  owner.answer={pipeline,sections:{now:[item],candidates:[],next:[],later:[]}};owner.record={item,pipeline};owner.paint=()=>{};owner.load=async()=>true;
  let field,host;
  if(id.startsWith('stage-'))field=owner.stageField(stage,id.slice(6),{'aria-label':id});
  else if(id==='pipeline-title'){owner.titleInPlace(pipeline);field=owner.titleField;}
  else if(id==='pipeline-words'){host=owner.detailsPanel(item,pipeline,true);field=host.querySelector('textarea');}
  else if(id==='held-title'){
    const key='add:candidates',entry={id:1,text:'Before',said:{words:'Earlier refusal',again:true},make:title=>owner.change('pipeline.item_add',{workspace_id:'w'},{title})};
    owner.held.set(key,[entry]);host=owner.heldLines(key,'Held item','Title')[0];field=host.querySelector('input');
  } else if(id==='aside-reason'){
    owner.asiding=1;host=owner.asideLine(item,{id:'piece',items:[1]});field=host.querySelector('input');
  } else if(id==='pipeline-add-item'){
    host=owner.addLine(pipeline,'candidates')[0];field=host.querySelector('input');
  } else if(id==='pipeline-add-stage'){
    host=owner.stageLines(pipeline);field=host.querySelector('[data-role="add-title"]');
  } else {
    // This is the same titleLine owner used by app.openPipelineAdd. Full app
    // Reader/bootstrap binding is a separately named native obligation.
    host=titleLine({key:'message-add',value:'Before',label:'Title of the new pipeline item',submit:title=>record('pipeline.item_add',{title,sources:[{message_id:'source'}]}),cancel:()=>host.remove()});field=host.querySelector('input');
  }
  if(host)root.append(host);else if(!field.parent)root.append(field);
  return {field,owner,closed:()=>!field.isConnected||doc.activeElement!==field};
}

function targetField({id,doc,root,record}) {
  const hosts={target:doc.createElement('section'),loop:doc.createElement('section'),problems:doc.createElement('section')};root.append(...Object.values(hosts));
  const view={instance_id:'1172-memory',workspace_id:'w',workspace_title:'Outcome',owner:'owner',you_own:true,you_steer:true,target:null,
    kind:{kind:'reach',you_change:false},word:null,reached:null,end:null,reach:{offered:true,unmet:[]},groups:[],counts:{passing:0,failing:0,measured:0,holding:0,not_run:0,waiting:0,total:0},loop:null,problems:null,releases:[],relevant_versions:{checks:1,workspace:1}};
  const owner=new OutcomeTargets({hosts,workspace:'w',reader:'owner',read:async()=>view,send:async(kind,_target,args)=>{record(kind,args);return {status:'committed'};}});
  owner.view=view;owner.paint=()=>{};owner.load=async()=>true;
  let host,field;
  if(id==='target-writer') {
    owner.writer={text:'Before',original:'Original',topics:[],topic:null,busy:false,error:''};host=owner.writing(view);field=host.querySelector('textarea');
  } else if(id==='reach-reason') {
    owner.reaching={words:'Before',anyway:false,busy:false,error:''};host=owner.reachBox(view);field=host.querySelector('textarea');
  } else {
    host=owner.acceptForm(view,{check_id:'check'},{run_id:'run'});field=host.querySelector('textarea');field.value='Before';owner.accepting.get('check').words='Before';
  }
  hosts.target.append(host);
  return {field,owner,closed:()=>id==='target-writer'?!owner.writer:id==='reach-reason'?!owner.reaching:!owner.accepting.has('check')||owner.folds.chosen.get('accept:check')===false};
}

function linkField({id,doc,root,bootstrap,record}) {
  const details=doc.createElement('details'),summary=doc.createElement('summary'),body=doc.createElement('div');details.append(summary,body);root.append(details);
  const rail={doc,win:doc.defaultView,sections:new Map([['previews',{details,summary,body}]]),host:root,
    handles:{workspaceId:'w',bootstrap},changed(){},close(){}};
  const owner=new WorkspaceLinks(rail);owner.mayWrite=true;
  owner.write=async(_handles,row)=>{record('workspace.link_set',row);return row;};
  owner.edit(id==='link-edit'?{seq:1,url:'https://1172.invalid/link',title:'Before',revision:1,removed:false}:null,owner.pencil);
  const field=id==='link-edit'?owner.title:owner.url;
  return {field,owner,closed:()=>owner.form.hidden};
}

function dossierField({doc,root,record}) {
  withReaderArchive(doc);
  const list=doc.createElement('div');list.id='messages';root.append(list);
  const messages=new Map();
  for(let i=1;i<=2;i++){
    const item={id:'m'+i,seq:i,author_id:'owner',topic_id:'t',body:'Before',reply_to:i===1?null:'m1',acts:{name:i===1?{text:'Before'}:null}};
    messages.set(item.id,item);const card=doc.createElement('button');card.className='message-card';card.dataset.id=item.id;card.dataset.seq=String(i);
    const author=doc.createElement('span');author.className='message-author';card.append(author);list.append(card);
  }
  const state=stackState(list),on={renamed:(stack,text,how)=>feed.rename(stack,text,how),cancelled:()=>{draw();doc.body.focus();},renameFinished:()=>{draw();doc.body.focus();}};
  const draw=()=>arrangeStacks(list,messages,{doc,viewer:'owner',on});
  const feed=Object.assign(Object.create(StackFeed.prototype),{doc,list,messages:()=>messages,actsOf:id=>messages.get(id).acts,
    arrange:draw,focusOn(){},say(){},remember(){},act:async(kind,item,args)=>{record(kind,args);return {message_id:item.id};}});
  state.renaming='m1';draw();const field=renameInput(list,'m1');
  return {field,owner:feed,closed:()=>!field.isConnected};
}
