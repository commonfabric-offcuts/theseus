import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningDraft } from '../web/opening.mjs';
import { OpeningView } from '../web/opening-view.mjs';
import { parseRoute, routeHref, routeKey, startFrom } from '../web/topic-navigation.mjs';
import { dom } from './fixtures/ui_dom.mjs';

// A topic started from a message (docs/sources.md): the page says what it
// answers, lists the topics already started from it, and Send names them as seen.
const copy=structuredClone;
const authority={authority_id:'authority',authority_epoch:'epoch',continuity:'initial'};
const bootstrap={instance_id:'fixture',actor:'person',authority,limits:{topic_participants:3,image_bytes:1024,attachment_count:2,media_name_utf8_bytes:64,body_utf8_bytes:4096,page_max:2}};
let serial=0;

// A small Core for the part of docs/sources.md this page uses.
function core() {
  const openings=new Map(),topics=[],operations=new Map();
  const receipt=(e,status,recorded,result=null,error=null)=>({instance_id:'fixture',operation_id:e.operation_id,kind:e.kind,status,recorded,result,affected:[],...(error?{error}:{})});
  const run={
    'opening.save':e=>{
      const id=e.target.opening_id,o=openings.get(id),a=e.args;
      if(!o&&topics.some(t=>t.id===a.topic_id))throw Object.assign(Error('Topic identity in use'),{code:'REVISION_CONFLICT'});
      if(o&&'source_message_id' in a&&a.source_message_id!==o.source_message_id)throw Object.assign(Error('keeps'),{code:'INVALID_ARGUMENT'});
      openings.set(id,{id,workspace_id:a.workspace_id,topic_id:a.topic_id,revision:(o?.revision??0)+1,state:'open',title:a.title,participants:copy(a.participants),
        body:a.body,attachments:copy(a.attachments),publish_operation_id:null,message_id:null,source_message_id:o?o.source_message_id:a.source_message_id??null});
      return {opening_id:id,opening_revision:(o?.revision??0)+1,state:'open'};
    },
    'opening.publish':e=>{
      const o=openings.get(e.target.opening_id),seen=e.args.seen??[];
      const unseen=topics.filter(t=>t.source===o.source_message_id&&o.source_message_id&&!seen.includes(t.id));
      if(unseen.length)throw Object.assign(Error('A topic was already started from this message: '+unseen.map(t=>t.id).join(', ')),{code:'ALREADY_STARTED'});
      topics.push({id:o.topic_id,title:o.title,source:o.source_message_id,creator:'person'});
      Object.assign(o,{state:'published',revision:o.revision+1,publish_operation_id:e.operation_id,message_id:'m-new'});
      return {opening_id:o.id,opening_revision:o.revision,topic:{id:o.topic_id,version:1},message_id:'m-new',delivery:{queued:0,unavailable_subscribers:[]}};
    },
  };
  const command=e=>{
    if(operations.has(e.operation_id))return copy(operations.get(e.operation_id));
    let answer;
    try{answer=receipt(e,'committed',true,run[e.kind](e));}
    catch(error){if(error.code==='INVALID_ARGUMENT')return receipt(e,'rejected',false,null,{code:error.code,message:error.message});
      answer=receipt(e,'rejected',true,null,{code:error.code,message:error.message,retryable:false});}
    operations.set(e.operation_id,answer);return copy(answer);
  };
  const view=(name,args)=>{
    if(name==='opening'){const o=openings.get(args.opening_id);return o?{instance_id:'fixture',opening:copy(o),publish_receipt:null}:{instance_id:'fixture',error:{code:'FORBIDDEN',message:'none'}};}
    if(name==='source')return {instance_id:'fixture',source_ref:{kind:'message',id:args.source_ref.id},author:'warp',body:'Where do we continue\nthe naming question?',topic_id:'t-old'};
    if(name==='source_topics'){
      const all=topics.filter(t=>t.source===args.message_id&&t.id>(args.cursor??'')).sort((a,b)=>a.id<b.id?-1:1),items=all.slice(0,args.limit);
      return {instance_id:'fixture',message_id:args.message_id,next_cursor:all.length>args.limit?items.at(-1).id:null,
        items:items.map(t=>({id:t.id,workspace_id:'w1',title:t.title,title_truncated:false,creator_id:t.creator,state:'active',archived:false,message_count:1,latest_seq:1}))};
    }
    throw Error('Unexpected view '+name);
  };
  return {openings,topics,command,view};
}
function harness() {
  const c=core(),calls=[];
  const api={async command(e){calls.push(copy(e));return c.command(copy(e));},async view(name,args){calls.push({view:name,args:copy(args)});return c.view(name,args);}};
  const store={rows:new Map(),async get(id){return copy(this.rows.get(id)??null);},async put(row){this.rows.set(row.opening,copy(row));},async remove(id){this.rows.delete(id);}};
  const timers={setTimeout:()=>0,clearTimeout:()=>{}};
  const draft=(options={})=>new OpeningDraft({api,bootstrap,store,workspace:'w1',opening:'o1',topic:'t-mine',timers,id:()=>`id-${++serial}`,...options});
  return {core:c,calls,draft,commands:kind=>calls.filter(x=>x.kind===kind)};
}

test('a link names the message its topic answers, and an opening without one keeps its old link', () => {
  const route=startFrom('w1','m-1');
  assert.equal(route.from,'m-1');assert.equal(route.kind,'opening');
  assert.deepEqual(parseRoute(new URL('https://x'+routeHref(route))),route);
  assert.notEqual(routeKey(route),routeKey({...route,from:'m-2'}),'two sources are two destinations');
  const plain={kind:'opening',workspace:'w1',opening:'o',topic:'t'};
  assert.deepEqual(parseRoute(new URL('https://x'+routeHref(plain))),plain,'an opening without a source keeps its old link');
  assert.throws(()=>parseRoute(new URL('https://x/?workspace=w1&opening=o&opening_topic=t&other=1')),/incomplete or ambiguous/);
  assert.throws(()=>routeKey({...plain,from:''}),/incomplete or ambiguous/);
});

test('every save carries the source, and Send names each topic already started from it that the page read', async () => {
  const h=harness();
  h.core.topics.push({id:'t-a',title:'First answer',source:'m-1',creator:'aim-ux'},{id:'t-b',title:'Second',source:'m-1',creator:'aim-spec'},
    {id:'t-c',title:'Third',source:'m-1',creator:'warp'},{id:'t-other',title:'Elsewhere',source:'m-2',creator:'warp'});
  const d=h.draft({source:'m-1'});
  await d.load();await d.loadSource();
  assert.deepEqual(d.started.map(t=>t.id),['t-a','t-b','t-c'],'every page is read');
  assert.deepEqual(d.sourceMessage,{author:'warp',body:'Where do we continue\nthe naming question?',topic_id:'t-old'});
  d.edit({title:'Naming',body:'Here'});
  assert.equal(await d.send(),'published');
  assert.equal(h.commands('opening.save')[0].args.source_message_id,'m-1');
  assert.deepEqual(h.commands('opening.publish')[0].args,{seen:['t-a','t-b','t-c']});
  assert.equal(h.core.topics.at(-1).source,'m-1');
});

test('a topic started meanwhile refuses Send, the list is read again, and the next Send goes ahead', async () => {
  const h=harness(),d=h.draft({source:'m-1'});
  await d.load();await d.loadSource();assert.deepEqual(d.started,[]);
  d.edit({title:'Mine',body:'Words'});
  // Someone else's topic from the same message lands before this Send.
  h.core.topics.push({id:'t-race',title:'Theirs',source:'m-1',creator:'aim-ux'});
  assert.equal(await d.send(),'refused');
  assert.deepEqual(h.commands('opening.publish')[0].args,{seen:[]});
  assert.match(d.refusal,/t-race/);assert.equal(d.phase,'editing');
  assert.deepEqual(d.started.map(t=>t.id),['t-race'],'the refusal brings the new topic into view');
  assert.equal(await d.send(),'published');
  assert.deepEqual(h.commands('opening.publish')[1].args,{seen:['t-race']});
});

test('an opening without a source sends none and names nothing seen; one resumed from Core keeps Core\'s source', async () => {
  const h=harness(),plain=h.draft();
  await plain.load();await plain.loadSource();plain.edit({title:'Plain',body:'x'});
  assert.equal(await plain.send(),'published');
  assert.equal('source_message_id' in h.commands('opening.save')[0].args,false);
  assert.deepEqual(h.commands('opening.publish')[0].args,{});
  assert.equal(h.calls.some(c=>c.view==='source_topics'),false,'nothing to list');
  const k=harness();
  k.core.command({v:1,instance_id:'fixture',operation_id:'seed',kind:'opening.save',target:{opening_id:'o1'},expected:{opening_revision:0},
    args:{workspace_id:'w1',topic_id:'t-mine',title:'Resumed',participants:[],body:'b',attachments:[],source_message_id:'m-9'}});
  const resumed=k.draft();await resumed.load();
  assert.equal(resumed.source,'m-9','the unfinished list links no source; Core has it');
  resumed.edit({body:'more'});await resumed.save();
  assert.equal(k.commands('opening.save')[0].args.source_message_id,'m-9');
});

test('writing moved off a link whose topic is taken still answers the same message', async () => {
  const h=harness();h.core.topics.push({id:'t-mine',title:'Taken',source:null,creator:'warp'});
  const d=h.draft({source:'m-1'});await d.load();d.edit({title:'Plan',body:'Words'});await d.save();
  assert.equal(d.phase,'taken');
  const route=await d.relocate();
  assert.equal(route.from,'m-1');assert.notEqual(route.opening,'o1');
  const moved=h.draft({opening:route.opening,topic:route.topic,source:route.from});
  assert.equal(await moved.load(),'editing');await moved.save();
  assert.equal(h.core.openings.get(route.opening).source_message_id,'m-1');
});

test('the opening page says what it answers and links each topic already started from it before anything is written', async t => {
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const h=harness();h.core.topics.push({id:'t-a',title:'First answer',source:'m-1',creator:'aim-ux'});
  const d=h.draft({source:'m-1'}),opened=[];
  const view=new OpeningView({host:document.createElement('main'),draft:d,workspace:{id:'w1',title:'Outcome'},open:(route,title)=>opened.push([route,title])});
  assert.equal(view.answers.hidden,false,'a topic with a source says so from the start');
  await d.load();await d.loadSource();
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  const shown=texts(view.answers);
  const quote=view.answers.children.find(x=>x.tagName==='blockquote');
  assert.equal(quote.text,'warp: Where do we continue the naming question?',shown.join('|'));
  assert.ok(shown.includes('A topic was already started from this message'));
  const list=view.answers.children.find(x=>x.tagName==='ul');
  assert.equal(list?.children.length,1,'one topic started, one link to it');
  const link=list.children[0].children[0];
  assert.equal(link.textContent,'First answer');assert.equal(link.href,'?topic=t-a');
  link.onclick({button:0,preventDefault(){}});
  assert.deepEqual(opened,[[{kind:'topic',id:'t-a'},'First answer']]);
  assert.ok(view.host.children.indexOf(view.answers)<view.host.children.findIndex(x=>x.tagName==='label'),'it comes before the title');
  const none=harness(),plain=none.draft(),plainView=new OpeningView({host:document.createElement('main'),draft:plain,workspace:{id:'w1',title:'Outcome'},open:()=>{}});
  await plain.load();assert.equal(plainView.answers.hidden,true);
});

test('the message a new topic answers shows its web addresses as links, and one its excerpt cuts as words', async t => {
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const h=harness(),d=h.draft({source:'m-1'});
  const view=new OpeningView({host:document.createElement('main'),draft:d,workspace:{id:'w1',title:'Outcome'},open:()=>{}});
  await d.load();await d.loadSource();
  const quote=()=>view.answers.children.find(x=>x.tagName==='blockquote');
  const links=()=>quote().children.filter(x=>x.tagName==='a').map(a=>[a.textContent,a.href,a.target]);
  d.sourceMessage={...d.sourceMessage,body:'The plan is at https://docs.example/plan. Read it.'};view.paintAnswers();
  assert.equal(quote().text,'warp: The plan is at https://docs.example/plan. Read it.');
  assert.deepEqual(links(),[['https://docs.example/plan','https://docs.example/plan','_blank']]);
  // Cut at 239 characters inside the address: the address is left as words.
  const long='w'.repeat(220)+' https://docs.example/a-very-long-path-that-runs-past-the-cut';
  d.sourceMessage={...d.sourceMessage,body:long};view.paintAnswers();
  assert.equal(quote().text,'warp: '+long.slice(0,239)+'…');
  assert.deepEqual(links(),[],'a cut address is not a link to the wrong place');
});
