import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pencilInventory } from './pencil-inventory.mjs';
import { pencilPartition, selectedNativeCase, pencilMutantsEnabled } from './pencil-selection.mjs';
import { installPencilObservation } from './pencil-states.mjs';
import { Editor } from '../web/editor.mjs';
import { EditorSession } from '../web/session.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
const native = readFileSync(new URL('./reader_compose_native.mjs', import.meta.url), 'utf8');
test('item 673 final selector: four exact partitions preserve the complete native inventory', async () => {
  const full = await pencilInventory(native);
  assert.deepEqual(['normal','mutant','restored'].map(phase=>full.cases.filter(x=>x.phase===phase).length),[2368,120,120]);
  const all = new Set();
  for (const engine of ['chromium','webkit']) for (const surface of ['topic','conversation']) {
    const filter = `item 673 shard ${engine} ${surface}`, inventory = await pencilInventory(native,filter);
    assert.equal(pencilMutantsEnabled(filter),true);
    assert.deepEqual(['normal','mutant','restored'].map(phase=>inventory.cases.filter(x=>x.phase===phase).length),[592,30,30]);
    for (const row of inventory.cases) {
      assert.equal(row.engine,engine); assert.ok(row.name.includes(`item 673 ${surface} `));
      assert.equal(all.has(row.name),false,'partition intersections are empty'); all.add(row.name);
    }
  }
  assert.deepEqual([...all].sort(),full.cases.map(x=>x.name).sort(),'exact union, including actual mutant/restored phase identities');
  for (const bad of ['item 673 shard chromium','item 673 shard firefox topic','item 673 shard webkit topic|item 673','item 673 shard webkit topic ']) assert.throws(()=>pencilPartition(bad));
  for (const filter of ['', 'item 673', 'some other|case', 'item 673 shardlike', 'item 673 topic phone-320 light: Send']) {
    assert.equal(pencilPartition(filter),null);
    for (const name of ['item 673 topic phone-320 light: Send','some other native case']) {
      const full=`chromium ${name}`;
      assert.equal(selectedNativeCase(filter,'chromium',name,full),!filter||filter.split('|').some(p=>full.includes(p)));
    }
  }
  const phaseSource=native.slice(native.indexOf('const ENGINES ='),native.indexOf('const plannedPhases ='));
  for(const engine of ['chromium','webkit'])for(const surface of ['topic','conversation']) {
    const context=vm.createContext({partition:pencilPartition(`item 673 shard ${engine} ${surface}`),run:function run(){},runAnswering:function runAnswering(){},runPencil:function runPencil(){},runPencilMutants:function runPencilMutants(){},runSending:function runSending(){}});
    const route=vm.runInContext(phaseSource+'\n({engines:ENGINES,phases:PHASES.map(([fn])=>fn.name)})',context);
    assert.deepEqual(JSON.parse(JSON.stringify(route)),{engines:[engine],phases:['runPencil','runPencilMutants']},'actual harness phases launch only the declared engine and owned phases');
  }
  assert.equal(pencilMutantsEnabled('item 673 topic phone-320 light: Send'),false);
});
test('item 673 final observer: exact receiver arguments promise and errors survive observation', async () => {
  let notify; const win={},doc={body:{dataset:{ready:'true'}},documentElement:{}};
  const result = Promise.withResolvers(), receiver={}, args=[{},'exact']; let seen;
  const owner={send:function(...a){seen={receiver:this,args:a};return result.promise;}};
  installPencilObservation(win,doc,class {constructor(fn){notify=fn;} observe(){} disconnect(){}},()=>owner,()=>({}));
  assert.equal(owner.send.apply(receiver,args),result.promise);assert.equal(seen.receiver,receiver);assert.deepEqual(seen.args,args);
  assert.equal(win.pencilSendSettled,false);const failure=Error('transport continuation');result.reject(failure);
  await assert.rejects(result.promise,error=>error===failure);await Promise.resolve();assert.equal(win.pencilSendSettled,true);assert.equal(win.pencil.calls[0].status,'rejected');
  const sync=Error('synchronous refusal');const next={send(){throw sync;}};
  installPencilObservation(win,doc,class {observe(){} disconnect(){}},()=>next,()=>({}));assert.throws(()=>next.send(),error=>error===sync);
  assert.equal(win.pencil.calls[0].status,'threw');
});
test('item 673 final journal: real persist failures survive incidental saves and recover with exact operation identity', async () => {
  const rows=new Map(), commands=[], authority={authority_id:'fixture-a',authority_epoch:'fixture-e',continuity:'initial'};
  const api={command:async envelope=>{commands.push(structuredClone(envelope));return {recorded:true,status:'committed',instance_id:envelope.instance_id,operation_id:envelope.operation_id,kind:envelope.kind,result:{draft_id:envelope.target.draft_id,draft_revision:1,generation:envelope.args.generation}};}};
  const journal=new RecoveryJournal({put:async row=>rows.set(row.id,structuredClone(row)),get:async id=>rows.get(id)},'final-fixture-tab');
  const registry=new EditorRegistry({api,journal,bootstrap:{instance_id:'fixture',actor:'fixture-person',authority}});
  const editor=new Editor({instanceId:'fixture',actor:'fixture-person',kind:'reply',topicId:'t1',sourceRef:{kind:'topic',id:'t1'}},{id:'final-draft',revision:0,generation:'final-generation',body:'before'});
  const session=new EditorSession(editor,{api,journal,authority,runtime:registry.runtime,changed:()=>{}});registry.sessions.set(editor.key,session);
  editor.edit({body:'after Attention.'});
  const win={pencil:{inline:{editor},registry}},context=vm.createContext({window:win,structuredClone});
  const helper=native.slice(native.indexOf('async function holdPencilJournal('),native.indexOf('const choosePencilImage ='));
  const hold=vm.runInContext(helper+'\nholdPencilJournal',context);await hold({evaluate:fn=>fn()});
  for(let n=0;n<3;n++){await assert.rejects(registry.persistLocal(editor),/Fixture device journal refused/);assert.equal(registry.saveSign(editor).state,'attention');}
  assert.equal(commands.length,0,'no private save dispatched through refused journal');
  assert.equal(win.pencilJournalTrace.length,3);assert.ok(win.pencilJournalTrace.every(x=>x.body==='after Attention.'&&x.rowId===journal.id(editor.key)&&x.writer==='final-fixture-tab'));
  await win.releasePencilJournal();assert.equal(editor.journalError,null);assert.equal(registry.saveSign(editor).state,'saved');
  assert.equal(commands.length,1);assert.equal(commands[0].args.body,'after Attention.');
  assert.equal(session.attempts[0].envelope.operation_id,commands[0].operation_id);assert.equal(session.attempts[0].receipt.operation_id,commands[0].operation_id);
  assert.equal((await journal.own(editor.key)).snapshot.draft.body,'after Attention.');
});
test('item 673 final cursor: actual append helper requires whole before-text and document-end before inserting', async () => {
  const before='A wrapped first line\nAnd the last line.', field={value:before,selectionStart:5,selectionEnd:5};
  const context=vm.createContext({assert,document:{activeElement:field},press:async()=>{},pencilModel:async()=>({body:field.value})});
  const source=native.slice(native.indexOf('async function appendPencilWriting('),native.indexOf('async function holdPencilJournal('));
  const append=vm.runInContext(source+'\nappendPencilWriting',context);
  let inserted=0;
  const p={locator:()=>({evaluate:fn=>fn(field),inputValue:async()=>field.value}),keyboard:{press:async key=>{
    field.selectionStart=field.selectionEnd=key==='Meta+ArrowDown'?field.value.length:8;
  },insertText:async extra=>{inserted++;field.value=field.value.slice(0,field.selectionStart)+extra+field.value.slice(field.selectionEnd);}}};
  assert.equal(await append(p,before,' Local.'),before+' Local.');assert.equal(inserted,1);
  field.value=before;inserted=0;p.keyboard.press=async()=>{field.selectionStart=field.selectionEnd=8;};
  await assert.rejects(append(p,before,' Server.'),/exact before-text and native document-end caret/);assert.equal(inserted,0,'incorrect wrapped-line caret is refused before insertion');
});
test('item 673 final routes: entry exception wakes wait and all release and cleanup errors survive', async () => {
  const records=[],context=vm.createContext({setTimeout,clearTimeout,pencilCleanupEvidence:records,engine:'fixture'});
  const source=native.slice(native.indexOf('async function pencilRoute('),native.indexOf('// Cleanup must never'));
  const helpers=vm.runInContext(source+'\n({pencilRoute,pencilReached,pencilSettlePage})',context);
  let handler,released=0,closed=0;const p={route:async(_pattern,fn)=>handler=fn,unrouteAll:async options=>{assert.equal(options.behavior,'wait');closed++;}};
  const primary=Error('actual route failure');await helpers.pencilRoute(p,'fixture',async()=>{throw primary;});
  await handler({request:()=>({url:()=>'/api/command'}),abort:async()=>{throw Error('actual abort failure');}});
  await assert.rejects(helpers.pencilReached(p,new Promise(()=>{})),error=>error===primary);
  p.pencilReleases=[()=>{throw Error('actual release failure');},()=>released++];
  await assert.rejects(helpers.pencilSettlePage(p),/actual route failure/);
  assert.equal(released,1);assert.equal(closed,1);assert.equal(records[0].cleanup.length,3);
  assert.match(records[0].cleanup[0],/release failure/);assert.match(records[0].cleanup[1],/route failure/);assert.match(records[0].cleanup[2],/abort failure/);
});
