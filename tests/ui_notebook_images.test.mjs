import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookImages } from '../web/notebook-images.mjs';

const copy=structuredClone;
function fixture() {
  let snapshot;
  const calls=[];
  const w={closed:false,readOnly:false,images:[],value:{attachments:[]},base:{source:{attachments:[]}},
    bootstrap:{instance_id:'i1',authority:{authority_id:'a',authority_epoch:'e'},limits:{image_bytes:1000,media_name_utf8_bytes:100,attachment_count:8,attachment_bytes:8000}},
    notify:()=>{},persist:async()=>{snapshot=copy({images:w.images,value:w.value});},edit:patch=>{Object.assign(w.value,copy(patch));w.persist();},
    api:{command:async e=>{calls.push(copy(e));assert.deepEqual(snapshot.images[0].begin,e);return{instance_id:'i1',operation_id:e.operation_id,kind:e.kind,status:'committed',recorded:true,result:{media_id:e.target.media_id,media_revision:1,state:'pending'}};},
      upload:async(e,blob)=>{calls.push(copy(e));assert.deepEqual(snapshot.images[0].publish,e);assert.equal(blob.size,3);const a=w.images[0].begin.args;return{instance_id:'i1',operation_id:e.operation_id,kind:e.kind,status:'committed',recorded:true,result:{media_id:e.target.media_id,media_revision:2,state:'ready',name:a.name,content_type:a.content_type,size_bytes:a.size_bytes,sha256:a.sha256,inline:true}};}}};
  return{w,calls,read:()=>copy(snapshot),file:new File(['png'],'test.png',{type:'image/png'})};
}

test('a page image retains bytes and exact intent before publication, then becomes an attachment',async()=>{
  const f=fixture(), images=new NotebookImages(f.w),e=await images.capture(f.file);await images.running.get(e.id);
  assert.equal(e.ready.state,'ready');assert.deepEqual(f.w.value.attachments,[{id:e.ready.media_id}]);assert.equal(e.bytes,null);
  assert.equal(e.associated,true);assert.equal(f.calls.length,2);
});

test('a lost publication retries the same media intent, and removal before its answer prevents attachment',async()=>{
  const f=fixture(),images=new NotebookImages(f.w),publish=f.w.api.upload;
  f.w.api.upload=async(e,blob)=>{await publish(e,blob);throw Error('Lost answer');};
  const e=await images.capture(f.file);await images.running.get(e.id);const envelope=copy(e.publish);
  assert.equal(f.w.value.attachments.length,0);assert.ok(e.bytes);assert.match(e.error,/Lost answer/);
  f.w.api.upload=async(request,blob)=>{const r=await publish(request,blob);await images.remove(e.id);return r;};
  await images.run(e);assert.deepEqual(f.calls.at(-1),envelope);assert.equal(f.w.value.attachments.length,0);assert.equal(e.removed,true);
});

test('recovery attaches a confirmed image exactly once, never resurrecting an image later removed elsewhere',async()=>{
  const f=fixture(),images=new NotebookImages(f.w),e=await images.capture(f.file);await images.running.get(e.id);
  e.associated=false;f.w.value.attachments=[];images.resume();assert.deepEqual(f.w.value.attachments,[{id:e.ready.media_id}]);
  f.w.value.attachments=[];images.resume();assert.deepEqual(f.w.value.attachments,[],'association already recorded; another writer’s removal wins');
});

test('an image receipt for another request leaves the image pending and unattached',async()=>{
  const f=fixture(),images=new NotebookImages(f.w),publish=f.w.api.upload;
  f.w.api.upload=async(e,b)=>({...await publish(e,b),operation_id:'different'});
  const e=await images.capture(f.file);await images.running.get(e.id);
  assert.equal(e.ready,null);assert.equal(f.w.value.attachments.length,0);assert.match(e.error,/does not match/);assert.ok(e.bytes);
});

test('an image whose device copy failed stays in memory and cannot upload before a durable retry',async()=>{
  const f=fixture(),images=new NotebookImages(f.w),persist=f.w.persist;
  f.w.persist=async()=>{throw Error('Disk full');};
  const e=await images.capture(f.file);
  assert.equal(f.calls.length,0);assert.ok(e.bytes);assert.match(e.error,/Device copy unavailable/);
  await images.run(e);assert.equal(f.calls.length,0);
  f.w.persist=persist;await images.run(e);assert.equal(f.w.value.attachments.length,1);
});

test('closing the page while a selected file is being read cannot start an upload afterwards',async()=>{
  const f=fixture(),images=new NotebookImages(f.w);let release;
  const file={name:'late.png',type:'image/png',size:3,arrayBuffer:()=>new Promise(done=>{release=done;})};
  const capture=images.capture(file);f.w.closed=true;release(new ArrayBuffer(3));
  await assert.rejects(capture,/no longer open/);assert.equal(f.calls.length,0);assert.deepEqual(f.w.images,[]);
});

test('a published image whose local confirmation failed can resume attachment without republishing',async()=>{
  const f=fixture(),images=new NotebookImages(f.w),persist=f.w.persist;
  let fail=true;f.w.persist=async()=>{if(fail&&f.w.images[0]?.ready)throw Error('Disk full after publish');return persist();};
  const e=await images.capture(f.file);await images.running.get(e.id);
  assert.ok(e.ready);assert.equal(e.associated,false);assert.equal(f.w.value.attachments.length,0);
  fail=false;await images.run(e);assert.equal(f.w.value.attachments.length,1);assert.equal(f.calls.length,2);
});
