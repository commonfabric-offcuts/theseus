import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderer799 } from './fixtures/renderer799.mjs';
import { DossierHeads } from '../web/stack-order.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { fillFrom } from '../web/reply-stacks.mjs';
// Generated only by anonymous public commands, never a private snapshot.
let input = process.env.ITEM799_LINEAGE;
if (!input) {
  const owned = realpathSync(mkdtempSync(resolve(tmpdir(),'item799-lineage-')));
  after(()=>rmSync(owned,{recursive:true}));
  const cache=resolve(owned,'pycache-anonymous-control');
  const run=spawnSync('/usr/bin/python3',['-X','pycache_prefix='+cache,'tests/item799_lineage.py','control',process.cwd(),owned],{encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
  input=resolve(owned,'anonymous-control.json');
}
const data = JSON.parse(readFileSync(input, 'utf8'));
assert.match(data.label,/anonymous public-command/);
async function draw(page, r = renderer799()) {
  const loaded = new Map(page.items.map(item => [item.id,item]));
  const heads = new DossierHeads({ topicId:'t', read:async (name,args) => {
    assert.equal(name,'topic_messages'); assert.equal(args.topic_id,'t');
    const items = args.message_ids.map(id=>page.heads_read.items.find(item=>item.id===id));
    assert.ok(items.every(Boolean), 'actual admitted named Core head exists');
    return {items};
  }});
  heads.sync(loaded); await new Promise(done=>setImmediate(done));
  assert.ok([...heads.records.values()].every(row=>row.state==='available'));
  return r.add([...heads.messages(loaded).values()]);
}
function assertHeads(state) {
  const all=state.stacks.flatMap(stack=>[stack.head,...stack.replies]);
  assert.equal(all.length,new Set(all.map(item=>item.id)).size,'no repeated roots or branches');
  for(const stack of state.stacks) {
    assert.equal(stack.id,stack.dossier,'actual original heads each anonymous dossier');
    assert.equal(state.below.has(stack.id), stack.head.stack_position.below);
  }
}
test('799 anonymous actual30 reply-star and original-star heads, retained join/move, split and explicit unstar', async()=>{
  for(const [name,page] of Object.entries(data.phases)) {
    const state=await draw(page); assertHeads(state);
    const root = name==='after_join'||name==='after_join_unstar'||name==='after_remote_reply' ? data.destination : data.root;
    const stack=state.stacks.find(stack=>stack.dossier===root);
    assert.ok(stack, name+': canonical dossier exists');
    const archived = ['before_remote_star', 'after_remote_star', 'after_join', 'after_join_unstar'].includes(name);
    assert.equal(state.below.has(root), archived, name + ': stars preserve archive membership, visible replies can return it');
    const backlog=state.stacks.find(stack=>stack.dossier===data.backlog_root);
    assert.ok(backlog?.head.acts.starred,'star on unloaded original admitted and shown on actual head');
    assert.equal(state.below.has(data.backlog_root),false);
  }
});
test('799 remote star refresh and stale positions cannot reverse it while supplemental heads remain separate',async()=>{
  const before=data.phases.before_remote_star, after=data.phases.after_remote_star;
  const views=new TopicViews({instanceId:before.instance_id,topicId:'t',reader:'reader'});
  views.messagesPage(before,{initial:true});
  const frontier=[views.olderCursor,views.newest,[...views.runs]];
  assert.equal((await draw(before)).below.has(data.root),true);
  await views.readActs(after.acts_read.version, async(name,args)=>{
    if(name==='message_acts')return after.acts_read;
    assert.equal(name,'stack_positions');
    return {...after.positions_read,items:after.positions_read.items.filter(row=>args.message_ids.includes(row.message_id))};
  },()=>true);
  assert.equal(views.learnPositions(before.positions_read.items),false,'late old page positions rejected');
  assert.equal((await draw({...after,items:[...views.messages.values()]})).below.has(data.root),true);
  assert.deepEqual([views.olderCursor,views.newest,[...views.runs]],frontier);
});
test('799 anonymous actual initial30 and each More retain exact frontier and unique admitted root/cards',async()=>{
  const views=new TopicViews({instanceId:data.pages[0].instance_id,topicId:'t',reader:'reader'}),r=renderer799();
  for(const [index,page] of data.pages.entries()) {
    if(index)fillFrom(r.list);
    const cursor=views.olderCursor;
    views.messagesPage(page,{initial:!index,cursor});
    const packet={...page,items:[...views.messages.values()],heads_read:{items:data.heads}};
    // Updating an existing card is how the loaded page takes source ownership.
    for(const item of packet.items)if(r.messages.has(item.id))r.messages.set(item.id,item);
    const state=await draw(packet,r);
    assert.equal(views.olderCursor,page.next_cursor);
    const all=state.stacks.flatMap(stack=>[stack.head,...stack.replies]);
    assert.equal(all.length,new Set(all.map(item=>item.id)).size);
    for(const stack of state.stacks.filter(stack=>!state.apart.has(stack.id)))assert.equal(stack.id,stack.dossier);
    for(const stack of state.stacks)assert.equal(state.below.has(stack.id),stack.head.stack_position.below);
    assert.equal([...r.list.descendants()].filter(e=>e.dataset.id).length,r.messages.size);
  }
});
