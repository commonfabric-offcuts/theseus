import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expression783, assertLook783, assertWords783, assertLines783, WORDS783, selector783, page783 } from './cover_783_oracle.mjs';
import { assertBuild783 } from './cover_783_comparator.mjs';
import { inputLF783, updateLF783 } from './cover_783_lf.mjs';
export const names783 = [
  ...['laptop','phone','phone-375','phone-320'].flatMap(d=>['light','dark'].map(t=>`reading item 783 cover states ${d} ${t}`)),
  'reading item 783 coherent Builds and applied source mutants',
];
export const PRIVATE783 = 'Not admitted to this viewer.';
export function fixture783({seed, control, facts}) {
  const act = async (topic, kind, id, args, sender = 'aim-core') => {
    const r = await control({ method: 'stack_act', sender, kind, message_id: id, operation_id: topic + '-' + kind + '-' + id, args });
    assert.equal(r.status, 'committed', JSON.stringify(r)); return r;
  };
  return async (topic, agentRoot = false) => {
    const ids = await seed(topic, [
      ['primer', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Fixture team ready.' }],
      ['primerux', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Second fixture member ready.' }],
      ['root', { sender: agentRoot ? 'aim-core' : 'person', body: 'First original message. Literal chronology stays.' }],
      ['older', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'Earlier reply, already read.', read: true }],
      ['human', { sender: 'person', reply_to: 'root', body: 'A human is part of this dossier.' }],
      ['answer', { sender: 'aim-core', reply_to: 'root', addressees: [facts.actor], body: 'Payload message: the exact answer is here.' }],
      ['lone', { sender: 'aim-core', addressees: [facts.actor], body: 'Singleton with its cover pills.' }],
      ['private', { sender: 'fixture-other-person', join: true, whisper: true, addressees: ['aim-ux'], body: PRIVATE783 }],
    ]);
    // Both private actors are real synthetic members; the viewer is outside the pair.
    await act(topic, 'stack.name', ids.root, { name: 'Literal dossier 783' });
    await act(topic, 'stack.cover', ids.root, inputLF783(ids.answer));
    await act(topic, 'stack.cover', ids.lone, { payload: { text: 'Singleton payload', message_id: ids.lone } });
    await act(topic, 'message.star', ids.older, { starred: true }, facts.actor);
    for (const actor of ['fixture-other-person', 'aim-ux']) {
      const privateSource = await control({method:'agent_view', actor, name:'source', args:{source_ref:{kind:'message',id:ids.private}}});
      assert.equal(privateSource.body, PRIVATE783, '783 committed known private body');
      assert.equal(privateSource.whisper, true, '783 stays private');
      const pairFeed = await control({method:'agent_view', actor, name:'topic_messages', args:{topic_id:topic,audience:'all',direction:'before',limit:50}});
      const privateMessage = pairFeed.items.find(m=>m.id===ids.private);
      assert.equal(privateMessage?.author_id, 'fixture-other-person', '783 actual human private author');
      assert.equal(privateMessage.body, PRIVATE783, '783 admitted pair feed body');
      assert.deepEqual(privateMessage.addressees, ['aim-ux'], '783 pair-only addressing');
      assert.equal(privateSource.private_to, 'aim-ux', '783 private recipient');
    }
    for (const actor of [facts.actor, 'aim-core']) {
      const denied = await control({method:'agent_view', actor, name:'source', args:{source_ref:{kind:'message',id:ids.private}}});
      assert.ok(denied.error, '783 non-pair source refused');
      const feed = await control({method:'agent_view', actor, name:'topic_messages', args:{topic_id:topic,audience:'all',direction:'before',limit:50}});
      assert.ok(!JSON.stringify(feed).includes(PRIVATE783), '783 non-pair body never returned');
      assert.ok(!feed.items.some(m=>m.id===ids.private), '783 non-pair feed excludes whisper');
    }
    const messages = (await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:topic,audience:'all',direction:'before',limit:50}})).items;
    assert.ok(messages.some(m=>m.id===ids.human && m.author_id===facts.actor), '783 committed human participation');
    return ids;
  };
}
export async function coverChecks783({ check, until, view, control, shot, facts, observations, engine }, { seed, open, centre, press, closeReader, readerOn }) {
  const make = fixture783({seed, control, facts});
  const records = async topic => {
    const messages = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 50 })).items;
    const acts = (await view('message_acts', { topic_id: topic })).items;
    return { messages: messages.map(m=>({ id:m.id, seq:m.seq, body:m.body, author:m.author_id, reply:m.reply_to })),
      stars: acts.map(a=>({id:a.message_id,starred:a.acts.starred})), positions: await view('stack_positions', { topic_id: topic, message_ids: messages.map(m=>m.id) }) };
  };
  const look = (p, ids) => p.evaluate(expression783(ids.root));
  const theme = (p, value) => p.send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value }] });
  for (const device of ['laptop','phone','phone-375','phone-320']) for (const color of ['light','dark']) {
    await check(`reading item 783 cover states ${device} ${color}`, async () => {
      for (const agentRoot of [false,true]) {
        const topic = `cover783-${device}-${color}-${agentRoot?'agent':'human'}`, ids = await make(topic, agentRoot), before = await records(topic);
        assert.ok(!before.messages.some(m=>m.id===ids.private), '783 private message never admitted');
        assert.ok(!JSON.stringify(before).includes(PRIVATE783), '783 known private body absent');
        assert.ok(before.messages.some(m=>m.id===ids.human&&m.author===facts.actor), '783 actual human participation');
        const input = device === 'laptop' ? 'laptop' : 'phone';
        let p;
        try {
          p = await open(topic, device, topic, ids.root, 'window.holdReads=true');
          await theme(p, color);
          const s=selector783(ids.root), toggle=s+' > .stack-toggle';
          const state=()=>p.evaluate(page783.state(toggle));
          const start=await state();
          assert.ok(['folded','open'].includes(start), '783 human dossier is not quiet agent-only head');
          const colors = await p.evaluate(page783.colors());
          const seen=[];
          // Two transitions return to the actual starting state and prove repeatability.
          for (let n=0;n<3;n++) {
            const current=await state(); seen.push(current);
            await centre(p, s+' > .dossier-cover');
            const at=await look(p,ids); observations.push({name:'783 state',engine,topic,device,color,current,at});
            assert.equal(at.fold,current); assertLook783(at); assertWords783(at);
            assertLines783(await p.evaluate(page783.lines(s+' > .dossier-cover')));
            assert.equal(await p.evaluate(page783.title(s)), 'Literal dossier 783');
            assert.equal(await p.evaluate(page783.privateDrawn(ids.private)),false);
            await shot(p,`${topic}-${current}-${n}`);
            if(n<2) {
              await centre(p,toggle); await press(p,input,toggle);
              await until(async()=>await state()!==current,'783 visible toggle changes actual dossier state');
            }
          }
          assert.deepEqual(new Set(seen),new Set(['folded','open']),'783 both real toggle states exercised');
          if(input==='laptop') {
            assert.equal(await p.evaluate(page783.focused(toggle)),true,'783 pointer leaves native keyboard focus on toggle');
            const was=await state();await p.key('Enter');
            await until(async()=>await state()!==was,'783 Return toggles focused dossier control');
            await p.key('Enter');await until(async()=>await state()===was,'783 second Return restores dossier state');
            assertLook783(await look(p,ids));
          }
          const cite=s+' > .dossier-cover .cover-src';
          await centre(p,cite);
          if(input==='laptop') {
            // Natural Tab traversal starts where the previous visible toggle press left focus.
            let reached=false;
            for(let n=0;n<180;n++) {
              await p.key('Tab');
              if(await p.evaluate(page783.focused(cite))){reached=true;break;}
            }
            assert.equal(reached,true,'783 keyboard reaches the cover citation');
            await p.key('Enter');
          } else await press(p,input,cite);
          await until(async()=>(await readerOn(p))?.startsWith('Payload message:'),'783 cover citation opens exact message');
          await centre(p,'#reader-cover > summary'); await press(p,input,'#reader-cover > summary');
          await until(()=>p.evaluate(page783.readerOpen()),'783 normal summary opens Reader cover');
          const reader=await p.evaluate(expression783(ids.root,'#reader-cover'));
          assertWords783(reader);
          assertLines783(await p.evaluate(page783.lines('#reader-cover')));
          assert.ok(reader.visible,'783 Reader sheet visible');
          const readerOrder=await p.evaluate(page783.readerOrder());
          assert.equal(readerOrder,true,'783 Reader cover above source message');
          await shot(p,topic+'-reader'); observations.push({name:'783 Reader',engine,topic,reader});
          // Live Core update while Reader is open, then both actual feed folds, then restore.
          const updated=await updateLF783(control,topic,ids,facts.actor);
          await until(async()=>(await p.evaluate(expression783(ids.root,'#reader-cover')))?.stands===updated.words.stands,'783 Reader follows LF update');
          assertWords783(await p.evaluate(expression783(ids.root,'#reader-cover')),updated.words);
          assertLines783(await p.evaluate(page783.lines('#reader-cover')),updated.words.stands);
          await shot(p,topic+'-reader-updated');
          await closeReader(p,input);
          await until(async()=>(await look(p,ids))?.stands===updated.words.stands,'783 feed follows LF update');
          for(let n=0;n<2;n++) {
            await centre(p,s+' > .dossier-cover');const changed=await look(p,ids);
            assertLook783(changed);assertWords783(changed,updated.words);
            assertLines783(await p.evaluate(page783.lines(s+' > .dossier-cover')),updated.words.stands);
            await shot(p,topic+'-updated-'+n);
            const current=await state();await centre(p,toggle);await press(p,input,toggle);
            await until(async()=>await state()!==current,'783 updated cover fold transition');
          }
          await updateLF783(control,topic,ids,facts.actor,'restore');
          await until(async()=>(await look(p,ids))?.stands===WORDS783.stands,'783 feed LF restoration arrives');
          assertWords783(await look(p,ids));
          const lone=await p.evaluate(page783.lone(ids.lone));
          assert.equal(lone.after,'message-author'); assert.equal(lone.words,'payload proposed'); assert.equal(lone.sheet,false);
          const afterColors=await p.evaluate(page783.colors());
          assert.deepEqual(afterColors,colors,'783 author colors preserved across controls');
          assert.deepEqual(await records(topic),before,'783 chronology, order, words, stars and admission preserved');
          assert.deepEqual(p.errors,[]);
        } catch (error) {
          if(p) {
            observations.push({name:'783 failure state',topic,error:error.stack,at:await look(p,ids).catch(e=>({captureError:String(e)}))});
            await shot(p,topic+'-failure').catch(e=>observations.push({name:'783 failure screenshot unavailable',error:String(e)}));
          }
          throw error;
        } finally { if(p) await p.close(); }
      }
    });
  }
  await check(names783.at(-1),async()=>{
    const topic='cover783-build-controls',ids=await make(topic,false);
    for(const phase of ['original','flat','wrong-order','wrong-background','outer-shadow','restored']) {
      const receipt=await control({method:'item_783_runtime',phase});
      observations.push({name:'783 coherent Build',...receipt});
      if(['original','flat'].includes(phase)) {
        const manifest=JSON.parse(await readFile(new URL(`./fixtures/item_783_${phase}.json`,import.meta.url),'utf8'));
        assert.deepEqual(receipt.hashes,manifest.files);
      }
      let p;
      try {
        p=await open(topic+'-'+phase,'laptop',topic,ids.root,'window.holdReads=true');
        assert.equal(await p.evaluate(page783.build(receipt.stamp)),true,'783 coherent immutable source binding');
        const at=await look(p,ids);assertWords783(at); await centre(p,selector783(ids.root)+' > .dossier-cover');
        await shot(p,topic+'-'+phase);
        const comparison=assertBuild783(at,phase);
        observations.push({name:'783 actual oracle comparison',phase,comparison});
        observations.push({name:'783 comparison result',phase,at,caught:phase!=='restored'});assert.deepEqual(p.errors,[]);
      } catch (error) {
        if(p) {
          observations.push({name:'783 failure state',phase,error:error.stack,at:await look(p,ids).catch(e=>({captureError:String(e)}))});
          await shot(p,topic+'-'+phase+'-failure').catch(e=>observations.push({name:'783 failure screenshot unavailable',error:String(e)}));
        }
        throw error;
      } finally {
        if(p)await p.close();
        const restored=await control({method:'item_783_runtime',phase:'restored'});
        assert.equal(restored.restored,true);assert.deepEqual(restored.hashes,receipt.candidate_hashes);
        observations.push({name:'783 byte restoration',...restored});
      }
    }
  });
}
