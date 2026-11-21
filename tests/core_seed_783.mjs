// Execute the native seed and complete fixture against real Core, without HTTP/browser.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readingSeed} from './topic_reading_native.mjs';
import {assertLF783, updateLF783} from './cover_783_lf.mjs';
import {rendererFixture783,checkRenderers783} from './cover_783_renderers.mjs';
import {WORDS783} from './cover_783_oracle.mjs';
import {fixture783, names783} from './cover_783_native.mjs';
assert.ok(process.env.PYTHONPYCACHEPREFIX,'distinct cache required');
const child=spawn('/usr/bin/python3',['-X','pycache_prefix='+process.env.PYTHONPYCACHEPREFIX,'tests/fixtures/ui_http.py','--core-only-783','--freshness','--agent-colors','--other-person']);
let serial=0, stderr='';const pending=new Map();
child.stderr.on('data',b=>stderr+=b);
createInterface({input:child.stdout}).on('line',line=>{
  const r=JSON.parse(line),p=pending.get(r.id);pending.delete(r.id);
  if(r.failure)p.reject(Error(r.failure));else p.resolve(r.answer);
});
const exited=new Promise(resolve=>child.on('exit',code=>{for(const p of pending.values())p.reject(Error('fixture exit '+code+': '+stderr));resolve(code);}));
const control=data=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({...data,id})+'\n');});
try {
  const facts=await control({method:'core_ready_783'});assert.equal(facts.cache_prefix,process.env.PYTHONPYCACHEPREFIX);assert.equal(facts.python_version,'3.9');console.log(JSON.stringify({ready:facts}));
  const make=fixture783({seed:readingSeed(control),control,facts});
  for(const name of names783) for(const agentRoot of (name.includes('cover states')?[false,true]:[false])) {
    const topic=name.includes('cover states')?'cover783-'+name.split('cover states ')[1].replace(' ','-')+'-'+(agentRoot?'agent':'human'):'cover783-build-controls';
    const ids=await make(topic,agentRoot);
    const read=async(name,args)=>control({method:'agent_view',actor:facts.actor,name,args});
    const messages=(await read('topic_messages',{topic_id:topic,audience:'all',direction:'before',limit:50})).items;
    for(const key of ['primer','primerux','root','older','human','answer','lone'])assert.ok(messages.some(m=>m.id===ids[key]),key+' committed');
    const acts=await read('message_acts',{topic_id:topic});
    const positions=await read('stack_positions',{topic_id:topic,message_ids:messages.map(m=>m.id)});
    const byId=Object.fromEntries(messages.map(m=>[m.id,m]));
    const root=byId[ids.root];
    assert.equal(root.author_id,agentRoot?'aim-core':facts.actor);
    assert.equal(root.acts.name.text,'Literal dossier 783');
    assert.equal(root.acts.cover.stands,WORDS783.stands,'783 committed stands LF');
    assert.deepEqual(root.acts.cover.waiting,[{text:WORDS783.wait,default:WORDS783.default}]);
    assert.equal(root.acts.cover.payload.message_id,ids.answer);
    assert.equal(root.acts.cover.payload.text,WORDS783.payload);
    assert.equal(byId[ids.lone].acts.cover.payload.text,'Singleton payload');
    assert.equal(byId[ids.older].acts.starred,true);
    assert.equal(byId[ids.older].unread,false);
    assert.equal(byId[ids.answer].unread,true);
    for(const key of ['older','human','answer']) {
      assert.equal(byId[ids[key]].reply_to,ids.root);
      assert.equal(positions.items.find(m=>m.message_id===ids[key]).stack_position.root_id,ids.root);
    }
    assertLF783(root.acts.cover);
    const held=await read('dossier_cover',{message_id:ids.answer});
    assert.ok(!held.error && held.cover && held.root_id===ids.root,'783 source view success: '+JSON.stringify(held));
    assert.deepEqual(held.cover,root.acts.cover,'783 command and source-view cover binding');
    const f=rendererFixture783(['root','older','human','answer','lone'].map(k=>byId[ids[k]]),facts.actor);
    const drawings=[];
    for(const fold of ['folded','open','folded']) {f.state.levels.set(ids.root,fold);f.paint();drawings.push(checkRenderers783(f,ids.root,held.cover));}
    const update=await updateLF783(control,topic,ids,facts.actor);
    f.messages.get(ids.root).acts={...root.acts,cover:update.held.cover,cover_revision:update.held.cover_revision};
    // The message's actual newly read position carries the same updated cover.
    const newer=await read('topic_messages',{topic_id:topic,audience:'all',direction:'before',limit:50});
    for(const m of newer.items)if(f.messages.has(m.id))f.messages.set(m.id,m);
    f.paint();drawings.push(checkRenderers783(f,ids.root,update.held.cover,update.words));
    const restore=await updateLF783(control,topic,ids,facts.actor,'restore');
    const restored=await read('topic_messages',{topic_id:topic,audience:'all',direction:'before',limit:50});
    for(const m of restored.items)if(f.messages.has(m.id))f.messages.set(m.id,m);
    f.paint();drawings.push(checkRenderers783(f,ids.root,restore.held.cover));
    for(const drawing of drawings)assert.equal(drawing.first,true,'783 actual renderer cover first in every fold/update');
    assert.equal(f.list.querySelectorAll('.row-pills').length,0,'803 keeps singleton covers in one folder sheet');
    const lone=f.state.sections.get(ids.lone);
    assert.equal(lone.querySelectorAll(':scope > .dossier-cover').length,1);
    assert.ok(lone.children.indexOf(lone.querySelector('.dossier-cover')) < lone.children.findIndex(n=>n.dataset.id===ids.lone),'783 singleton sheet precedes its message');
    console.log(JSON.stringify({held,update,restore,drawings,name,topic,agentRoot,ids,messages,acts,positions,passed:true}));
  }
} finally {
  child.stdin.end();const code=await exited;
  console.log(JSON.stringify({fixtureExitCode:code,fixtureErrors:stderr,controls:serial}));
  assert.equal(code,0);assert.equal(stderr,'');
}
