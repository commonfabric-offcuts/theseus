import test from 'node:test';
import assert from 'node:assert/strict';
import { routeHref, parseRoute } from '../web/topic-navigation.mjs';
import { imageAddress, verifiedImage, ImageArchive, writeImage } from '../web/image-rail-menu.mjs';
const image={topic_id:'t1',source_ref:{kind:'message',id:'m1'},attachment:{id:'img1',name:'one.png',inline:true,content_type:'image/png',sha256:'abc'}};
const saved = (e, revision = 4) => ({status:'committed',recorded:true,operation_id:e.operation_id,result:{message_id:e.target.message_id,topic_id:'t1',aside_revision:revision,through:e.args.through,...(e.args.clear_new?{cleared_new:{through:e.args.through,deliveries:1,marks:0}}:{})}});
function setup(){
 const sent=[], reads=[];const item={id:'m1',topic_id:'t1',seq:50,attachments:[image.attachment],stack_position:{root_id:'root',through:null,aside_revision:3,order_key:18,below:false,at:{messages:50},starred:[]}};
 const h={bootstrap:{instance_id:'i1',actor:'a',authority:{authority_id:'au',authority_epoch:'ep'}},view:async(name,args)=>{reads.push([name,args]);return name==='source'?{instance_id:'i1',source_ref:image.source_ref,topic_id:'t1',attachments:[image.attachment]}:{instance_id:'i1',items:[item]};},inTurn:f=>f(),api:{media:async()=>({blob:new Blob(['png'],{type:'image/png'})}),command:async e=>{sent.push(e);return saved(e);}}};return{h,item,sent,reads};
}
test('998 stable image route round trips without commands and uses share origin',()=>{
 const route={kind:'image',id:'img1',message:'m1'};assert.deepEqual(parseRoute(new URL(routeHref(route),'https://host')),route);
 assert.equal(imageAddress(image,'https://tail.ts.net'),'https://tail.ts.net/?image=img1&message=m1');
 for(const query of ['?image=img1','?image=img1&message=m1&message=m2','?image=img1&message=m1#act=menu&choice=Archive'])assert.throws(()=>parseRoute(new URL(query,'https://host')));
});
test('998 reads the exact authorized source and delegates byte verification; rejects a missing image and stale response',async()=>{
 const {h}=setup();assert.equal((await verifiedImage(h,image,()=>true)).blob.type,'image/png');
 const read=h.view;h.view=async()=>({instance_id:'i1',source_ref:image.source_ref,attachments:[]});await assert.rejects(verifiedImage(h,image,()=>true));
 h.view=read;let current=true;h.api.media=async()=>{current=false;return{blob:new Blob(['x'])};};await assert.rejects(verifiedImage(h,image,()=>current),/changed/);
});
test('998 clipboard write begins in the gesture with a promised PNG; refusal is an error',async()=>{
 let resolve,called=false;const blob=new Promise(r=>resolve=r), nav={clipboard:{write:items=>{called=true;return items[0].data['image/png'];}}};
 class Item{constructor(data){this.data=data;}}
 const task=writeImage(()=>blob,{nav,Item});assert.equal(called,true);resolve(new Blob(['x'],{type:'image/png'}));await task;
 await assert.rejects(writeImage(()=>Promise.resolve(new Blob()),{nav:{clipboard:{write:()=>Promise.reject(Error('denied'))}},Item}),/denied/);
});
test('998 archive uses actual dossier root, existing revision fence and confirmed-revision Undo',async()=>{
 const {h,sent}=setup(), owner=new ImageArchive(),plan=await owner.prepare(h,image,()=>true);
 const undo=await owner.perform(h,plan,()=>true);assert.equal(sent[0].kind,'stack.aside');assert.deepEqual(sent[0].target,{message_id:'root'});assert.equal(sent[0].expected.aside_revision,3);assert.deepEqual(sent[0].args,{through:50,clear_new:true});
 await undo();assert.equal(sent[1].expected.aside_revision,4);assert.deepEqual(sent[1].args,{through:null,key:18});assert.notEqual(sent[0].operation_id,sent[1].operation_id);
});
test('998 unknown archive retries exact operation despite a fresh archived projection; navigation sends nothing',async()=>{
 const {h,item,sent}=setup(),owner=new ImageArchive();let tries=0;
 h.api.command=async e=>{sent.push(e);if(++tries===1)throw Error('lost');return saved(e);};
 let plan=await owner.prepare(h,image,()=>true);await assert.rejects(owner.perform(h,plan,()=>true),/unknown/);
 item.stack_position.below=true;item.stack_position.through=50;item.stack_position.aside_revision=4;
 plan=await owner.prepare(h,image,()=>true);assert.match(plan.label,/Retry Archive/);await owner.perform(h,plan,()=>true);assert.deepEqual(sent[0],sent[1]);
 await assert.rejects(owner.perform(h,plan,()=>false),/changed/);assert.equal(sent.length,2);
});
test('998 a starred dossier can be archived and a later Undo revision refusal is surfaced',async()=>{
 const {h,item}=setup(),owner=new ImageArchive();item.stack_position.starred=['m1'];const plan=await owner.prepare(h,image,()=>true);assert.equal(plan.label,'Archive its message');
 const undo=await owner.perform(h,plan,()=>true);
 h.api.command=async()=>({status:'refused',recorded:true,error:{message:'changed elsewhere'}});await assert.rejects(undo(),/changed elsewhere/);
});

test('998 unknown Undo survives reopening and retries the same operation before a new archive',async()=>{
 const {h,item,sent}=setup(),owner=new ImageArchive();const undo=await owner.perform(h,await owner.prepare(h,image,()=>true),()=>true);
 let tries=0;h.api.command=async e=>{sent.push(e);if(++tries===1)throw Error('lost');return saved(e,5);};
 await assert.rejects(undo(),/unknown/);item.stack_position.aside_revision=5;
 const retry=await owner.prepare(h,image,()=>true);assert.equal(retry.label,'Retry Undo message action');assert.equal(await owner.perform(h,retry,()=>true),null);assert.deepEqual(sent[1],sent[2]);
 assert.equal((await owner.prepare(h,image,()=>true)).label,'Archive its message');
});
test('998 a final recorded archive refusal permits a fresh plan, never an unknown retry',async()=>{
 const {h,item}=setup(),owner=new ImageArchive();h.api.command=async()=>({status:'refused',recorded:true,error:{message:'changed elsewhere'}});
 await assert.rejects(owner.perform(h,await owner.prepare(h,image,()=>true),()=>true),/changed elsewhere/);
 item.stack_position.aside_revision=8;const plan=await owner.prepare(h,image,()=>true);assert.equal(plan.label,'Archive its message');assert.equal(plan.request.expected.aside_revision,8);
});

test('1119 image Archive retains one reading capture across uncertainty and Undo never reads again',async()=>{
 const {h,sent}=setup(),owner=new ImageArchive();let captures=0,reads=0,attempts=0;
 h.captureArchiveReading=(root,through,topic)=>{assert.deepEqual([root,through,topic],['root',50,'t1']);captures++;return()=>{reads++;};};
 h.api.command=async e=>{sent.push(e);if(++attempts===1)throw Error('lost');return saved(e);};
 const plan=await owner.prepare(h,image,()=>true);await assert.rejects(owner.perform(h,plan,()=>true));
 assert.equal(reads,0);const undo=await owner.perform(h,await owner.prepare(h,image,()=>true),()=>true);
 assert.equal(captures,1);assert.equal(reads,1);assert.deepEqual(sent[0],sent[1]);
 await undo();assert.equal(reads,1);assert.equal('clear_new' in sent[2].args,false);
});

test('1119 image Archive with an unconfirmed reading receipt retains the operation without reading',async()=>{
 const {h,sent}=setup(),owner=new ImageArchive();let reads=0;
 h.captureArchiveReading=()=>()=>{reads++;};h.api.command=async e=>{sent.push(e);return{status:'committed',recorded:true,operation_id:e.operation_id,result:{aside_revision:4}};};
 await assert.rejects(owner.perform(h,await owner.prepare(h,image,()=>true),()=>true),/not confirmed/);
 const retry=await owner.prepare(h,image,()=>true);assert.match(retry.label,/Retry Archive/);
 assert.equal(retry.request.operation_id,sent[0].operation_id);assert.equal(reads,0);
});
