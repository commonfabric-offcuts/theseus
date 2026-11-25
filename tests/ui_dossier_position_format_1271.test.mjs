import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../web/api.mjs';
import { SessionRenewal } from '../web/session-renewal.mjs';
import { TopicViews } from '../web/topic-views.mjs';

const FORMAT = 'root-table-v1', clone = value => JSON.parse(JSON.stringify(value));
const cap = offered => ({ instance_id:'i1', actor:'reader', ...(offered ? {read_formats:{dossier_positions:[FORMAT]}} : {}) });
function position(root='root', revision=1) {
  return {root_id:root, through:null, below:false, at:{messages:10,acts:revision}, name:null,name_revision:0,join_revision:revision,
    cover:{root_id:root,revision,stands:'Current '+root+' words',waiting:[],payload:null},cover_revision:revision,
    cover_read_seq:[revision,0,10],cover_refresh_revision:0};
}
function wire({root='root', revision=1, named=false, rootLoaded=true}={}) {
  const rows = rootLoaded ? [{id:root,topic_id:'t',acts:{cover_ref:root,cover_revision:revision},stack_position_ref:root},
    {id:'reply',topic_id:'t',acts:{cover:null,cover_revision:0},stack_position_ref:root}] :
    [{id:'reply',topic_id:'t',acts:{cover:null,cover_revision:0},stack_position_ref:root}];
  return {instance_id:'i1',topic_id:'t',position_format:FORMAT,positions:{[root]:position(root,revision)},
    items:named ? rows.map(row=>({message_id:row.id,stack_position_ref:row.stack_position_ref})) : rows};
}
function legacy(source) {
  const read=clone(source), table=read.positions;
  delete read.positions;delete read.position_format;
  for(const row of read.items){row.stack_position=clone(table[row.stack_position_ref]);delete row.stack_position_ref;
    if(row.acts?.cover_ref){row.acts.cover=clone(row.stack_position.cover);delete row.acts.cover_ref;}}
  return read;
}
function fixture({offered=true, answer=wire()}={}) {
  const calls=[];
  const fetcher=async(path,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body,options});
    return {ok:true,json:async()=>clone(path==='/api/bootstrap'?cap(offered):typeof answer==='function'?answer(body):answer)};};
  const api=new Api('old',fetcher);
  return {api,calls,fetcher};
}
for(const named of [false,true])test('1271 negotiated '+(named?'named positions':'message page')+' expands exact projections before consumers',async()=>{
  const packed=wire({named}),f=fixture({answer:packed}),args={topic_id:'t',message_ids:['root','reply']};
  await f.api.bootstrap();const answer=await f.api.view(named?'stack_positions':'topic_messages',args);
  assert.equal(f.calls.at(-1).body.args.position_format,FORMAT);
  assert.deepEqual(answer,legacy(packed));assert.deepEqual(args,{topic_id:'t',message_ids:['root','reply']});
  assert.equal(packed.items[0].stack_position_ref,'root','decoding does not mutate the received fixture');
});
test('1271 the table supplies a root absent from loaded message rows',async()=>{
  const packed=wire({rootLoaded:false}),f=fixture({answer:packed});await f.api.bootstrap();
  const answer=await f.api.view('topic_messages',{topic_id:'t'});
  assert.deepEqual(answer,legacy(packed));assert.equal(answer.items[0].stack_position.root_id,'root');
});
for(const named of [false,true])for(const rootLoaded of [false,true])test(
  '1271 items-only cover expands '+(named?'named positions':'message page')+' with '+(rootLoaded?'root and reply':'reply only'),async()=>{
    const packed=wire({named,rootLoaded});
    packed.positions.root.cover={root_id:'root',revision:0,stands:null,waiting:[],payload:null,by:null,at_ms:null,
      items:[1,2,3].map(number=>({workspace_id:'w1',number,title:'Current linked improvement '+number,
        state:'Now',piece_id:null,sources:[number===2?'reply':'root']}))};
    packed.positions.root.cover_revision=0;
    if(rootLoaded&&!named)packed.items[0].acts.cover_revision=0;
    const expected=legacy(packed),f=fixture({answer:packed});await f.api.bootstrap();
    const args={topic_id:'t',message_ids:rootLoaded?['root','reply']:['reply']};
    const answer=await f.api.view(named?'stack_positions':'topic_messages',args);
    assert.equal(f.calls.at(-1).body.args.position_format,FORMAT);
    assert.deepEqual(answer,expected);
    const cover=answer.items[0].stack_position.cover;
    assert.equal(cover.stands,null);assert.equal(cover.payload,null);
    assert.deepEqual(cover.items.map(row=>row.number),[1,2,3]);
    cover.items[0].title='Local item mutation';
    assert.equal(packed.positions.root.cover.items[0].title,'Current linked improvement 1');
    if(rootLoaded){
      assert.equal(answer.items[1].stack_position.cover.items[0].title,'Current linked improvement 1');
      if(!named)assert.equal(answer.items[0].acts.cover.items[0].title,'Current linked improvement 1');
    }
});
test('1271 distinct historical message acts survive the root reference',async()=>{
  const packed=wire();packed.items[1].acts={cover:{root_id:'reply',revision:7,stands:'Historical joined cover'},cover_revision:7};
  const f=fixture({answer:packed});await f.api.bootstrap();const answer=await f.api.view('topic_messages',{topic_id:'t'});
  assert.deepEqual(answer,legacy(packed));assert.equal(answer.items[1].acts.cover.root_id,'reply');
});
test('1271 expanded rows keep legacy independent object mutation semantics',async()=>{
  const packed=wire(),f=fixture({answer:packed});await f.api.bootstrap();const answer=await f.api.view('topic_messages',{topic_id:'t'});
  assert.deepEqual(answer,legacy(packed));answer.items[0].stack_position.cover.stands='Local mutation';
  assert.equal(answer.items[1].stack_position.cover.stands,'Current root words');
  assert.equal(answer.items[0].acts.cover.stands,'Current root words');
});
for(const offered of [false,true])test('1271 complete legacy fallback remains readable with capability '+offered,async()=>{
  const old=legacy(wire()),f=fixture({offered,answer:old});await f.api.bootstrap();
  assert.deepEqual(await f.api.view('topic_messages',{topic_id:'t'}),old);
  assert.equal('position_format'in f.calls.at(-1).body.args,offered);
});
test('1271 unrelated reads and explicit callers keep their original arguments/options',async()=>{
  const f=fixture({answer:{instance_id:'i1',items:[]}});await f.api.bootstrap();const options={readClass:'background'};
  await f.api.view('topic',{topic_id:'t'},options);assert.deepEqual(f.calls.at(-1).body,{name:'topic',args:{topic_id:'t'}});
  assert.equal(f.calls.at(-1).options.headers['X-AIM-Read-Class'],'background');
  await f.api.view('stack_positions',{topic_id:'t',position_format:'explicit-version'});
  assert.equal(f.calls.at(-1).body.args.position_format,'explicit-version');
});
const invalid={
  'unknown version':x=>x.position_format='root-table-v2',
  'missing table':x=>delete x.positions,
  'missing referenced root':x=>delete x.positions.root,
  'wrong position root':x=>x.positions.root.root_id='different',
  'wrong cover root':x=>x.positions.root.cover.root_id='different',
  'empty row reference':x=>x.items[0].stack_position_ref='',
  'row without identity':x=>delete x.items[0].id,
  'unused table root':x=>x.positions.unused=position('unused'),
  'full and referenced position':x=>x.items[0].stack_position=position(),
  'mismatched cover reference':x=>x.items[0].acts.cover_ref='different',
  'full and referenced cover':x=>x.items[0].acts.cover=position().cover,
  'cover reference on a reply':x=>x.items[1].acts={cover_ref:'root'},
  'missing full cover':x=>delete x.positions.root.cover,
  'reference without format marker':x=>delete x.position_format,
};
for(const [name,mutate]of Object.entries(invalid))test('1271 rejects '+name+' instead of using prior read data',async()=>{
  const packed=wire();mutate(packed);const f=fixture({answer:packed});await f.api.bootstrap();
  await assert.rejects(f.api.view('topic_messages',{topic_id:'t'}),/dossier positions could not be confirmed/);
});
test('1271 a later join/split root is response-local and reaches actual TopicViews learning',async()=>{
  let next=wire({rootLoaded:false}),f=fixture({answer:()=>next});await f.api.bootstrap();
  const views=new TopicViews({instanceId:'i1',topicId:'t',reader:'reader'});views.messages.set('reply',{id:'reply',stack_position:position('root',1)});
  const old=await f.api.view('topic_messages',{topic_id:'t'});views.learnPositions(old.items.map(row=>({message_id:row.id,stack_position:row.stack_position})));
  next=wire({root:'new-root',revision:5,rootLoaded:false});const fresh=await f.api.view('topic_messages',{topic_id:'t'});
  views.learnPositions(fresh.items.map(row=>({message_id:row.id,stack_position:row.stack_position})));
  assert.equal(views.messages.get('reply').stack_position.root_id,'new-root');
  assert.equal(old.items[0].stack_position.root_id,'root');assert.equal(fresh.items[0].stack_position.cover_revision,5);
});
test('1271 a missing new root cannot be completed from a previous response',async()=>{
  let next=wire(),f=fixture({answer:()=>next});await f.api.bootstrap();await f.api.view('topic_messages',{topic_id:'t'});
  next=wire();delete next.positions.root;
  await assert.rejects(f.api.view('topic_messages',{topic_id:'t'}),/dossier positions could not be confirmed/);
});
test('1271 empty compact page and Core refusals retain their complete meaning',async()=>{
  let next={instance_id:'i1',position_format:FORMAT,positions:{},items:[]},f=fixture({answer:()=>next});await f.api.bootstrap();
  assert.deepEqual(await f.api.view('topic_messages',{topic_id:'t'}),{instance_id:'i1',items:[]});
  next={instance_id:'i1',error:{code:'FORBIDDEN',message:'No access'}};
  assert.deepEqual(await f.api.view('topic_messages',{topic_id:'t'}),next);
});
for(const offered of [false,true])test('1271 same-person session renewal adopts capability '+offered+' including downgrade',async()=>{
  const calls=[];let current=cap(true);
  const fetcher=async(path,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push(body);
    return {ok:true,json:async()=>clone(path==='/api/bootstrap'?current:legacy(wire()))};};
  const api=new Api('old',fetcher);const initial=await api.bootstrap();await api.view('topic_messages',{topic_id:'t'});
  assert.equal(calls.at(-1).args.position_format,FORMAT);
  current=cap(offered);const renewal=new SessionRenewal({api,bootstrap:initial,makeApi:token=>new Api(token,fetcher),
    fetcher:async()=>({ok:true,text:async()=>'<meta name="aim-next-session" content="new">'})});
  assert.equal(await renewal.renew(),'renewed');await api.view('topic_messages',{topic_id:'t'});
  assert.equal('position_format'in calls.at(-1).args,offered);
});
test('1271 a refused different-person renewal cannot change the current format',async()=>{
  const f=fixture({answer:legacy(wire())}),initial=await f.api.bootstrap();
  const renewal=new SessionRenewal({api:f.api,bootstrap:initial,makeApi:()=>({bootstrap:async()=>({...cap(false),actor:'someone-else'})}),
    fetcher:async()=>({ok:true,text:async()=>'<meta name="aim-next-session" content="new">'})});
  assert.equal(await renewal.renew(),null);assert.equal(f.api.token,'old');await f.api.view('topic_messages',{topic_id:'t'});
  assert.equal(f.calls.at(-1).body.args.position_format,FORMAT);
});
test('1271 an older bootstrap result cannot overwrite a later capability decision',async()=>{
  const waiting=[],calls=[];
  const api=new Api('old',async(path,options)=>path==='/api/bootstrap'?{ok:true,json:()=>new Promise(resolve=>waiting.push(resolve))}:
    {ok:true,json:async()=>{calls.push(JSON.parse(options.body));return legacy(wire());}});
  const first=api.bootstrap();await new Promise(resolve=>setImmediate(resolve));
  const second=api.bootstrap();await new Promise(resolve=>setImmediate(resolve));
  waiting[1](cap(false));await second;waiting[0](cap(true));await first;
  await api.view('topic_messages',{topic_id:'t'});assert.equal('position_format'in calls.at(-1).args,false);
});
