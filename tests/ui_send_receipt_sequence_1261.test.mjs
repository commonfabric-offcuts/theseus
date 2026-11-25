import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { checkedView } from '../web/freshness.mjs';

// Execute the unchanged actual app owner with explicit API/DOM ports. This
// proves calls, receipt compatibility and current-page fences, not native UI.
const app = await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
const start = app.indexOf('function placeSubmittedWriting(editor, item) {');
const end = app.indexOf('\nfunction paintReview()', start);
assert.ok(start > 0 && end > start);
const owner = app.slice(start, end);
function fixture(seq, {loaded = false, source = {}, block = null} = {}) {
  const calls = [], messages = new Map(), entries = new Map(), notices = [];
  let release = 0, paint = 0, unblock;
  const gate = new Promise(done => { unblock = done; });
  const item = {id:'submission',presentPending:true,topicId:'t',status:'confirmed',
    receipt:{instance_id:'i',kind:'message.send',status:'committed',recorded:true,operation_id:'original-send',
      result:{message_id:'m',submission_id:'submission',...(seq === undefined ? {} : {seq})}}};
  if (loaded) { messages.set('m', {id:'m'}); entries.set('m', {isConnected:true}); }
  const context = {
    topic:{id:'t'},listAccessEpoch:1,retired:false,topicUnavailable:false,authorityReviewPending:()=>false,
    registry:{generation:1,disposed:false,cleanup:{foreground:()=>({read:work=>work({}),release:()=>release++})}},
    api:{view:async(name,args)=>{ calls.push({name,args}); if (name === block) await gate;
      return name === 'source' ? {instance_id:'i',source_ref:{kind:'message',id:'m'},topic_id:'t',seq:7,...source} : {instance_id:'i',items:[{id:'m',seq:args.cursor-1}]}; }},
    bootstrap:{instance_id:'i'},checkedView,messageEntries:entries,
    views:{messages,messagesPage:(page,options)=>{ assert.equal(options.anchored,true); messages.set('m',page.items[0]); entries.set('m',{isConnected:true}); }},
    pendingSendCard:()=>null,document:{activeElement:null},paintSubmittedWriting:()=>paint++,status:error=>notices.push(error.message),
  };
  vm.createContext(context);
  vm.runInContext('const submittedPlacements = new Map();\n'+owner+'\nglobalThis.place=placeSubmittedWriting;',context);
  return {context,item,calls,notices,unblock,place:()=>context.place({},item),released:()=>release,painted:()=>paint};
}

test('1261 usable committed receipt seq avoids only source and still reads the canonical topic page', async () => {
  const f = fixture(42), receipt = structuredClone(f.item.receipt);
  assert.equal(await f.place(),true);
  assert.deepEqual(f.calls.map(x=>x.name),['topic_messages']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{topic_id:'t',audience:'all',direction:'before',cursor:43,limit:30});
  assert.equal(f.released(),1); assert.equal(f.painted(),1); assert.deepEqual(f.item.receipt,receipt);
});

for (const seq of [undefined, null, 0, -1, '42', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test('1261 old or unusable receipt seq '+String(seq)+' retains the exact source fallback', async () => {
    const f=fixture(seq); assert.equal(await f.place(),true);
    assert.deepEqual(f.calls.map(x=>x.name),['source','topic_messages']);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{kind:'message',id:'m'});
    assert.equal(f.calls[1].args.cursor,8); assert.equal(f.released(),1);
  });
}

for (const seq of [undefined, 42]) test('1261 loaded canonical card requires no placement reads, seq '+seq, async () => {
  const f=fixture(seq,{loaded:true}); assert.equal(await f.place(),true); assert.deepEqual(f.calls,[]); assert.equal(f.released(),0);
});

for (const source of [{source_ref:{kind:'message',id:'wrong'}},{topic_id:'wrong'}]) {
  test('1261 old receipt source identity mismatch cannot place an unrelated card '+JSON.stringify(source), async () => {
    const f=fixture(undefined,{source}); assert.equal(await f.place(),false);
    assert.deepEqual(f.calls.map(x=>x.name),['source']); assert.equal(f.released(),1); assert.equal(f.painted(),0);
  });
}

for (const block of ['source','topic_messages']) test('1261 authority/navigation change fences the late '+block+' answer', async () => {
  const f=fixture(block === 'source' ? undefined : 42,{block}); const running=f.place();
  f.context.registry.generation++; f.unblock(); assert.equal(await running,false);
  assert.deepEqual(f.calls.map(x=>x.name),[block]); assert.equal(f.released(),1); assert.equal(f.painted(),0);
});
