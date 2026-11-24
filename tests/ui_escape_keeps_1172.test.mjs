import test from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, fieldFixture, settle } from './fixtures/escape_keeps_1172.mjs';

const onlyRed = process.env.ESCAPE1172_PHASE === 'red';
const changed = id => id === 'link-create' ? 'https://1172.invalid/changed' : 'Changed1172';
for (const [id, empty] of BINDINGS.filter(([id]) => !onlyRed || id === 'rail-topic-plus')) {
  test(`1172 ${id}: Escape saves or creates through its Return owner and keeps the container`, async t => {
    const f=await fieldFixture(id);t.after(()=>f.close());f.open();f.type(changed(id));
    const e=f.key('Escape');await settle();
    assert.ok(f.sent.length>0, `${id}: the field must reach its save/create owner`);
    assert.ok(JSON.stringify(f.sent).includes(changed(id)), `${id}: exact typed words reach that owner`);
    assert.equal(e.defaultPrevented,true);assert.equal(e.stopped,true);
    assert.equal(f.root.open,true,'the same Escape cannot close the container');
    assert.equal(f.closed(),true,'successful Escape finishes this field');
    f.secondEscape();assert.equal(f.root.open,false,'the next Escape belongs to the container');
  });
  if (!onlyRed) test(`1172 ${id}: empty Escape ${empty==='save'?'saves the deliberate empty value':empty==='refuse'?'retains the named required-value refusal':'closes without a write'}`, async t => {
    const f=await fieldFixture(id);t.after(()=>f.close());f.open();f.type('');f.key('Escape');await settle();
    if(empty==='save')assert.ok(f.sent.length>0,`${id}: deliberate empty value is saved`);
    else assert.equal(f.sent.length,0,`${id}: empty value launches no command`);
    assert.equal(f.root.open,true);
    assert.equal(f.closed(),empty!=='refuse');
  });
  if (!onlyRed) test(`1172 ${id}: both IME signals leave Return and Escape to composition`, async t => {
    const f=await fieldFixture(id);t.after(()=>f.close());f.open();f.type(changed(id));
    for(const key of ['Enter','Escape'])for(const signal of [{isComposing:true},{keyCode:229}])f.key(key,signal);
    await settle();assert.equal(f.sent.length,0);assert.equal(f.root.open,true);assert.equal(f.closed(),false);
  });
  if (!onlyRed) test(`1172 ${id}: a held Escape launches no command and stays in the field`, async t=>{
    const f=await fieldFixture(id);t.after(()=>f.close());f.open();f.type(changed(id));
    const e=f.key('Escape',{repeat:true});await settle();
    assert.equal(f.sent.length,0);assert.equal(f.closed(),false);assert.equal(f.root.open,true);assert.equal(e.defaultPrevented,true);
  });
}
if(!onlyRed)test('1172 rail topic: a pending Escape keeps the same request and a second press cannot create twice',async t=>{
  const f=await fieldFixture('rail-topic-plus',{hold:true});t.after(()=>f.close());f.open();f.type('Pending1172');
  f.key('Escape');await settle();assert.equal(f.sent.length,1);assert.equal(f.closed(),false);
  f.key('Escape');await settle();assert.equal(f.sent.length,1);assert.equal(f.root.open,true);
  f.release();await settle();assert.deepEqual(f.sent.map(x=>x.kind),['opening.save','opening.publish']);assert.equal(f.closed(),true);
});
for(const id of (onlyRed ? [] : ['topic-title-header','topic-note','outcome-purpose','stage-name','pipeline-title','target-writer','link-edit','dossier-name'])) {
  test(`1172 ${id}: refusal keeps exact writing and the field open`,async t=>{
    const f=await fieldFixture(id,{refused:true});t.after(()=>f.close());f.open();f.type(changed(id));f.key('Escape');await settle();
    assert.equal(f.field.value,changed(id));assert.equal(f.closed(),false);assert.equal(f.root.open,true);
  });
}
for(const id of (onlyRed ? [] : ['outcome-purpose','notebook-title','target-writer','reach-reason','link-edit'])) {
  test(`1172 ${id}: leaving the eligible field reaches the same save owner`,async t=>{
    const f=await fieldFixture(id);t.after(()=>f.close());f.open();f.type(changed(id));f.leave();await settle();
    assert.ok(f.sent.length>0);assert.ok(JSON.stringify(f.sent).includes(changed(id)));
  });
}
