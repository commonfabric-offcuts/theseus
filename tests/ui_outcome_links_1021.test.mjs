import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, thingsIn } from '../web/things-rail.mjs';
import { WorkspaceLinks, linkURL, outcomeLinks } from '../web/workspace-links.mjs';

test('1021 existing preview section is named Links and keeps its saved fold identity', () => {
  assert.equal(SECTIONS.find(([key]) => key === 'previews')[1], 'Links');
  const found = thingsIn([{ id: 'm1', body: '[Current preview](https://box.ts.net/preview/one)', sent_ms: 1 }]);
  assert.equal(found.previews[0].url, 'https://box.ts.net/preview/one');
});

test('1021 custom outcome links deduplicate previews and apply shared title/removal overrides', () => {
  const previews = [{url:'HTTPS://Example.test:443',title:'Old'}, {url:'https://box.ts.net/preview',title:'Preview'}];
  const rows = outcomeLinks(previews,[{url:'https://example.test/',title:'Named',revision:2,removed:false},
    {url:'https://box.ts.net/preview',title:'Preview',revision:1,removed:true},
    {url:'https://new.test/',title:'New',revision:1,removed:false}]);
  assert.deepEqual(rows.map(row=>[row.url,row.title]),[['https://example.test/','Named'],['https://new.test/','New']]);
});
test('1021 link input keeps normal web addressing and refuses credentials, schemes and controls',()=>{
  assert.equal(linkURL('HTTPS://Example.test:443'),'https://example.test/');
  for(const value of ['javascript:alert(1)','file:///tmp/a','https://user:pass@example.test','https://example.test/a\nb','https://example.test/a b','https://example.test/\\a'])assert.throws(()=>linkURL(value));
});
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
function reader(view){
  const handles={workspaceId:'w1',bootstrap:{instance_id:'i1',limits:{workspace_links:500,page_max:100}},view};
  const links=Object.assign(Object.create(WorkspaceLinks.prototype),{rail:{handles}});return{handles,links};
}
const row=(seq,url='https://example.test/')=>({seq,url,title:'Title',revision:1,removed:false});
test('1021 bounded scoped pages retain all overlay rows and reject repeated or wrong-scope pages',async()=>{
  const calls=[];const f=reader(async(name,args)=>{calls.push([name,args]);return{instance_id:'i1',workspace_id:'w1',items:[row(args.cursor?1:2)],next_cursor:args.cursor?null:2,reader_may_write:true};});
  const answer=await f.links.read(f.handles);assert.equal(answer.items.length,2);assert.equal(calls[1][1].cursor,2);assert.equal(answer.reader_may_write,true);
  for(const bad of [{instance_id:'i2',workspace_id:'w1'},{instance_id:'i1',workspace_id:'w2'},{instance_id:'i1',workspace_id:'w1',next_cursor:2}]){
    const g=reader(async()=>({instance_id:'i1',workspace_id:'w1',items:[row(2)],next_cursor:null,...bad}));
    await assert.rejects(g.links.read(g.handles),/could not be confirmed/);
  }
});
test('1021 a late add answer cannot close or paint a later outcome form',async()=>{
  const wait=deferred(),handles={workspaceId:'w1'},effects=[];
  const links=Object.assign(Object.create(WorkspaceLinks.prototype),{rail:{handles,changed:()=>effects.push('paint')},serial:1,mayWrite:true,
    form:{hidden:false},url:{value:'https://example.test/',readOnly:false},title:{value:'Kept',readOnly:false},save:{disabled:false},
    write:()=>wait.promise,close:()=>effects.push('close'),message:()=>effects.push('notice')});
  const saving=links.submit();links.rail.handles={workspaceId:'w2'};links.serial++;links.title.value='New outcome writing';
  wait.resolve(row(1));await saving;
  assert.deepEqual(effects,[]);assert.equal(links.title.value,'New outcome writing');
});
test('1021 an empty title defaults only at submission, without editing the input',async()=>{
  let sent;const handles={workspaceId:'w1'},title={value:'',readOnly:false};
  const links=Object.assign(Object.create(WorkspaceLinks.prototype),{rail:{handles,changed(){}},serial:1,mayWrite:true,
    form:{hidden:false},url:{value:'https://example.test/work',readOnly:false},title,save:{disabled:false},
    write:async(_handles,row)=>{sent=row;},close(){this.serial++;},message(words){throw Error(words);}});
  await links.submit();assert.equal(sent.title,'example.test');assert.equal(title.value,'');
});
test('1021 Core-kept URL spelling survives a different browser URL normalization',async()=>{
  const url='https://example.test/a/../work';
  const f=reader(async()=>({instance_id:'i1',workspace_id:'w1',items:[row(1,url)],next_cursor:null,reader_may_write:true}));
  const answer=await f.links.read(f.handles);assert.equal(answer.items[0].url,url);
  const bad=reader(async()=>({instance_id:'i1',workspace_id:'w1',items:[row(1,'javascript:alert(1)')],next_cursor:null}));
  await assert.rejects(bad.links.read(bad.handles));
});
test('1021 browser-equivalent preview overlays deduplicate titles and retain removal',()=>{
  const previews=[{url:'https://example.test/work',title:'Derived'}],kept={url:'https://example.test/a/../work',title:'Kept title',revision:2,seq:4,ms:10};
  const named=outcomeLinks(previews,[{...kept,removed:false}]);
  assert.equal(named.length,1);assert.equal(named[0].title,'Kept title');assert.equal(named[0].url,kept.url);
  assert.deepEqual(outcomeLinks(previews,[{...kept,removed:true}]),[]);
  const aliases=[{...kept,removed:false},{url:previews[0].url,title:'Later removal',revision:1,seq:5,ms:20,removed:true}];
  assert.deepEqual(outcomeLinks(previews,aliases),[]);assert.deepEqual(outcomeLinks(previews,aliases.toReversed()),[]);
});
test('1021 Rename submits the exact Core-kept URL and captured row revision',async()=>{
  const record={url:'https://example.test/a/../work',title:'Old',revision:2};let sent;
  const handles={workspaceId:'w1'};const links=Object.assign(Object.create(WorkspaceLinks.prototype),{rail:{handles,changed(){}},serial:1,mayWrite:true,record,
    form:{hidden:false},url:{value:record.url,readOnly:true},title:{value:'Renamed',readOnly:false},save:{disabled:false},
    write:async(_handles,row)=>{sent=row;},close(){this.serial++;},message(words){throw Error(words);}});
  await links.submit();assert.deepEqual(sent,{url:record.url,title:'Renamed',revision:2});
});
test('1021 adding an equivalent address updates its kept identity, and stale removal still conflicts',async()=>{
  const kept={url:'https://example.test/a/../work',title:'Old',revision:3,seq:4,ms:10};let sent;
  const handles={workspaceId:'w1',bootstrap:{instance_id:'i1',authority:{authority_id:'a1',authority_epoch:'e1'}}};
  const links=Object.assign(Object.create(WorkspaceLinks.prototype),{records:[kept],commands:{send:async(_handles,envelope)=>{sent=envelope;return{result:{workspace_id:'w1',link:{...kept,title:envelope.args.title}}};}}});
  await links.write(handles,{url:'https://example.test/work',title:'New'});assert.equal(sent.args.url,kept.url);assert.equal(sent.expected.link_revision,3);
  await links.write(handles,{url:'https://example.test/work',title:'Old',revision:0},true);assert.equal(sent.args.url,kept.url);assert.equal(sent.expected.link_revision,0);assert.equal(sent.args.removed,true);
});
