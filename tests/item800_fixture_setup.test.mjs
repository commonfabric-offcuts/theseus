import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readingChecks } from './topic_reading_native.mjs';
import { betweenOthers } from '../web/fold.mjs';
import { foldCard, paintOwnNoteFold } from '../web/fold.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { gather, ordered, shown, rowsOf, rowFolded } from '../web/stack-order.mjs';
import { coordinationStack } from '../web/coordination-stacks.mjs';
import { agentTalk } from '../web/card-reading.mjs';
import { levelOf } from '../web/reply-stacks.mjs';

const names = ['phone-320','phone-375','phone','laptop'].flatMap(s=>['light','dark'].map(t=>`reading item 800 ${s} ${t}: own note stays whole through every fold route`));
const selected = name => name.startsWith('reading item 800 ');

test('item800 actual registrations enumerate eight unchanged names with every action suppressed', async()=>{
  const registered=[];
  const forbidden=()=>assert.fail('dry enumeration executed an action');
  await readingChecks({check:async name=>{if(selected(name))registered.push(name);},page:forbidden,control:forbidden,view:forbidden,shot:forbidden,until:forbidden,facts:{},observations:[]});
  assert.deepEqual(registered,names);
  console.log(JSON.stringify({enumerated:registered,actions:'suppressed',nativeCalls:0}));
});

test('item800 actual public fixture refusal and eight actual scenario setups/renderer shapes below browser', async()=>{
  const cache=process.env.ITEM800_CACHE??await mkdtemp(join(tmpdir(),'item800-python-'));
  const fixture=spawn('/usr/bin/python3',['-I','-X',`pycache_prefix=${cache}`,'tests/fixtures/item800_setup_core.py',cache],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:fixture.stdout}); const it=lines[Symbol.asyncIterator]();
  const exit=once(fixture,'exit');let stderr='';fixture.stderr.on('data',d=>stderr+=d);
  const next=async()=>{const row=await it.next();assert.equal(row.done,false,stderr);return JSON.parse(row.value);};
  let serial=0;
  const raw=async data=>{const id=++serial;fixture.stdin.write(JSON.stringify({...data,id})+'\n');const r=await next();assert.equal(r.id,id);return r;};
  const control=async data=>{const r=await raw(data);if(r.failure)throw Error(r.failure);return r.answer;};
  const view=(name,args,actor='fixture-person')=>control({method:'agent_view',actor,name,args});
  try{
    const ready=await next();assert.equal(ready.ready,true);assert.deepEqual(ready.python.slice(0,2),[3,9]);assert.equal(ready.effectiveCache,cache);console.log(JSON.stringify(ready));
    await control({method:'navigation_topics',topics:[{id:'negative800',title:'Original missing recipient'}]});
    const request={method:'agent_message',operation_id:'original800-send',topic_id:'negative800',source:'topic',sender:'aim-core',join:true,addressees:['aim-ux'],body:'Original admission negative.',divergence_reason:'Isolate the missing-recipient negative.'};
    const denied=await raw(request);assert.match(denied.failure,/REPLY_PATH_UNAVAILABLE/);
    const refused=await view('operation',{operation_id:request.operation_id},'aim-core');
    assert.equal(refused.recorded,true);assert.equal(refused.status,'rejected');assert.equal(refused.error.code,'REPLY_PATH_UNAVAILABLE');
    const membership=await view('topic',{topic_id:'negative800'});
    assert.ok(membership.participants.some(p=>p.actor_id==='aim-core'));
    assert.ok(!membership.participants.some(p=>p.actor_id==='aim-ux'));
    assert.equal((await view('topic_messages',{topic_id:'negative800'})).items.length,1);
    console.log(JSON.stringify({originalPublicNegative:{receipt:refused,participants:membership.participants}}));
    let completed=0;
    const observations=[];
    const stop=Error('below-browser stop before first native page');
    let currentTopic;
    await readingChecks({
      check:async(name,run)=>{
        if(!selected(name))return;
        const first=observations.length;
        await assert.rejects(run, error=>error===stop);
        const phase=observations.slice(first).find(o=>o.name===name&&o.phases);
        assert.deepEqual(phase.phases,['real-Core-setup-and-committed-readback']);
        assert.equal(phase.captureErrors.length,0);
        const admitted=observations.slice(first).find(o=>o.name===name&&o.phase==='fixture-admission-readback');
        assert.equal(admitted.joined.status,'committed');assert.equal(admitted.admitted.status,'committed');
        console.log(JSON.stringify(admitted));
        const shape=observations.slice(first).find(o=>o.name===name&&o.phase==='fixture-shape-readback');
        assert.equal(shape.addressed.status,'committed');console.log(JSON.stringify(shape));
        const feed=await view('topic_messages',{topic_id:currentTopic});
        const byBody=body=>{const m=feed.items.find(m=>(m.body===body||m.body==='Reply without a quote:\n\n> Exercise the actual private-note corner on this reply.\n\n'+body));assert.ok(m,body);return m;};
        const auto=byBody('Between other readers, keep these exact words.'),root=byBody('Dossier original, keep this author and body.'),covered=byBody('Earlier covered reply, keep its own corner.'),quietRoot=byBody('Quiet dossier original keeps its actual note corner.'),quietReply=byBody('Quiet dossier reply keeps its actual note corner.');
        assert.equal(betweenOthers(auto,'fixture-person','human'),true,'automatic wrapper must actually be between other readers');
        assert.equal(auto.reply_to,null,'automatic message is a standalone root');
        const stacks=gather(feed.items,{viewer:'fixture-person'}),main=stacks.find(s=>s.id===root.id),quiet=stacks.find(s=>s.id===quietRoot.id);
        assert.equal(main.replies.length,9);assert.deepEqual(main.replies.map(m=>m.body),['Earlier covered reply, keep its own corner.',...Array.from({length:8},(_,i)=>'Later ordinary reply '+i)].map(body=>'Reply without a quote:\n\n> Exercise the actual private-note corner on this reply.\n\n'+body));
        assert.deepEqual(quiet.replies.map(m=>m.id),[quietReply.id]);
        const kinds=new Map((await view('topic',{topic_id:currentTopic})).participants.map(p=>[p.actor_id,p.kind]));
        const isQuiet=m=>agentTalk(m,'fixture-person','human',id=>kinds.get(id));
        assert.equal(coordinationStack(main,isQuiet),false);assert.equal(coordinationStack(quiet,isQuiet),true);
        const state={levels:new Map(),coordination:new Set([quiet.id])};
        assert.equal(levelOf(state,main.id),'open');assert.equal(levelOf(state,quiet.id),'head');
        for(const [stack,m] of [[main,covered],[quiet,quietReply]]){
          for(const level of ['head','folded','open']){assert.equal(shown(stack,m,{level}),true);assert.ok(rowsOf(stack,{level}).some(r=>r.item===m&&!r.folded));}
        }
        for(const m of [auto,root,covered,quietRoot,quietReply]){
          assert.equal(m.yours.note,true);assert.equal(m.acts.folded,true);assert.equal(rowFolded(m),false);assert.equal(m.author_id,'aim-core');
          assert.equal(JSON.stringify(m).includes('Own private words'),false);
          const theirs=await view('topic_messages',{topic_id:currentTopic},'aim-core');
          assert.equal(theirs.items.find(i=>i.id===m.id).yours.note,false);
          const editor=await view('editor_state',{topic_id:currentTopic,source_ref:{kind:'message',id:m.id}},'aim-core');assert.equal(editor.note,null);
        }
        const topology=ordered(stacks).map(s=>({head:s.head.body,replies:s.replies.map(m=>m.body)}));
        // Real automatic wrapper with admitted Core metadata; no browser input,
        // layout or fabricated flags. Clear the actual private note and re-read.
        if(!Object.getOwnPropertyDescriptor(Element.prototype,'ownerDocument'))Object.defineProperty(Element.prototype,'ownerDocument',{get(){return this.document;}});
        const doc=miniDocument();doc.createTextNode=t=>t;
        const card=doc.createElement('article'),wrapper=foldCard(card,auto,doc);
        assert.equal(card.hidden,false);assert.equal(wrapper.children[0].hidden,true);
        for(const m of [auto,root,covered,quietRoot,quietReply]){
          const cleared=await control({method:'private_writing',operation_id:currentTopic+'-proof-clear-'+m.id,topic_id:currentTopic,message_id:m.id,kind:'note',body:''});
          assert.equal(cleared.status,'committed');
        }
        const after=await view('topic_messages',{topic_id:currentTopic});
        for(const m of [auto,root,covered,quietRoot,quietReply]){
          const cleared=after.items.find(i=>i.id===m.id);assert.equal(cleared.yours.note,false);assert.equal(cleared.acts.folded,true);assert.equal(rowFolded(cleared),true);
          const editor=await view('editor_state',{topic_id:currentTopic,source_ref:{kind:'message',id:m.id}});
          assert.equal(editor.note.body,'');assert.equal(editor.draft.body,'Unsent reply — same destination.\nKeep  this.');
          assert.deepEqual(editor.source_ref,{kind:'message',id:m.id});assert.equal(editor.destination.topic_id,currentTopic);
        }
        paintOwnNoteFold(wrapper,after.items.find(m=>m.id===auto.id));assert.equal(card.hidden,true);assert.equal(wrapper.children[0].hidden,false);
        const restored=gather(after.items,{viewer:'fixture-person'});
        assert.equal(shown(restored.find(s=>s.id===root.id),after.items.find(m=>m.id===covered.id),{level:'folded'}),false);
        assert.equal(shown(restored.find(s=>s.id===quietRoot.id),after.items.find(m=>m.id===quietReply.id),{level:'head'}),false);
        console.log(JSON.stringify({name,setup:'complete',native:'UNRUN',topology,auto:{id:auto.id,reply_to:auto.reply_to,reply_to_author:auto.reply_to_author},dossierLevels:{main:'open',quiet:'head'},participants:(await view('topic',{topic_id:currentTopic})).participants}));
        completed++;
      },
      page:async()=>{throw stop;},
      control:async data=>{if(data.method==='navigation_topics')currentTopic=data.topics[0].id;return control(data);},view,
      until:()=>assert.fail('native until must be unrun'),shot:()=>assert.fail('native screenshot must be unrun'),facts:{actor:'fixture-person',origin:'http://unrun.invalid'},observations
    });
    assert.equal(completed,8);
    console.log(JSON.stringify({completedSetups:completed,nativePages:0,nativeInputs:0,screenshots:0,nativePhases:'UNRUN'}));
  }finally{
    fixture.stdin.end();const cleanup=await next();assert.deepEqual(cleanup,{cleanup:'owned temporary Core fixture removed',removed:true});
    const [code,signal]=await exit;assert.equal(code,0,stderr);assert.equal(signal,null);assert.equal(stderr,'');console.log(JSON.stringify({cleanup,exitCode:code,signal,stderr}));lines.close();
    if(!process.env.ITEM800_CACHE)await rm(cache,{recursive:true,force:true});
  }
});
