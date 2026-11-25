import test from 'node:test';
import assert from 'node:assert/strict';
import { dossierRows, dossierTitle, OutlineDossiers } from '../web/outline-dossiers.mjs';

const star = (n, id, name='') => ({star:n,topic_id:'t',dossier:{id,name,body:'**First words**\nMore'}});
test('outline dossiers preserve star order and real identity, and use the feed title rule', () => {
  const stars=[star(8,'a','Same title'),star(7,'b','Same title'),star(6,'a','Same title')];
  assert.deepEqual(dossierRows(stars).map(s=>s.dossier.id),['a','b']);
  assert.deepEqual(dossierRows([]),[]);
  assert.equal(dossierTitle(stars[0].dossier),'Same title');
  assert.equal(dossierTitle(star(1,'z').dossier),'First words');
  assert.equal(dossierTitle({name:'',body:'',attachments:[]}),'Untitled dossier');
});
const fixture = () => {
  const queue=[], calls=[];
  const subject=Object.create(OutlineDossiers.prototype);
  const handles={bootstrap:{instance_id:'instance'}};
  subject.epoch=1; subject.outline={handles,read:async(name,args,lane)=>{calls.push({name,args,lane}); return await queue.shift()();}};
  subject.paint=()=>{};
  const attrs={};
  const state={id:'t',box:{setAttribute:(k,v)=>attrs[k]=v},stars:[],extent:null,next:null,busy:null,loaded:false};
  const page=(items,next_cursor=null)=>()=>({instance_id:'instance',items,next_cursor});
  return {subject,state,queue,calls,page,attrs};
};
test('scoped reads page only the loaded extent; More and live refresh deduplicate across boundaries',async()=>{
  const f=fixture();
  f.queue.push(f.page([star(10,'a'),star(9,'b')],9)); await f.subject.load(f.state);
  f.queue.push(f.page([star(8,'a'),star(7,'c')],7)); await f.subject.load(f.state,true);
  assert.deepEqual(dossierRows(f.state.stars).map(s=>s.dossier.id),['a','b','c']);
  f.queue.push(f.page([star(11,'d'),star(10,'a')],10),f.page([star(9,'b'),star(7,'c')],7));
  await f.subject.load(f.state);
  assert.deepEqual(dossierRows(f.state.stars).map(s=>s.dossier.id),['d','a','b','c']);
  assert.deepEqual(f.calls.map(c=>c.args.cursor??null),[null,9,null,10]);
  assert.ok(f.calls.every(c=>c.name==='stars'&&c.args.topic_id==='t'&&c.args.limit===50&&c.lane==='foreground'));
  assert.equal(f.attrs['aria-busy'],'false');
});
test('a late answer after a page or actor change draws nothing and starts no queued read',async()=>{
  const f=fixture(); let release;
  f.queue.push(()=>new Promise(resolve=>release=resolve));
  const running=f.subject.load(f.state); await Promise.resolve();
  f.subject.load(f.state); // a commit noticed while the first read waits
  f.subject.epoch++;
  release(f.page([star(2,'private-old-actor')])()); await running;
  assert.deepEqual(f.state.stars,[]); assert.equal(f.calls.length,1);
});
test('a forbidden read clears titles, a transient error keeps them, and Retry recovers',async()=>{
  const f=fixture();f.state.stars=[star(1,'old')];
  f.queue.push(()=>{throw Object.assign(Error('busy'),{code:'DATABASE_BUSY'});});await f.subject.load(f.state);
  assert.equal(f.state.stars[0].dossier.id,'old');
  f.queue.push(()=>({instance_id:'instance',error:{code:'FORBIDDEN',message:'No permission'}}));await f.subject.load(f.state);
  assert.deepEqual(f.state.stars,[]);
  f.queue.push(f.page([star(2,'new')]));await f.subject.load(f.state);
  assert.equal(f.state.stars[0].dossier.id,'new');assert.equal(f.state.error,null);
});

for (const fails of [false, true]) test(`923 B2 refresh waits for a queued star read and returns its ${fails ? 'failure' : 'success'}`, async () => {
  const f = fixture(); let first, second, settled = false;
  f.subject.parents = () => [{ dataset: { topicId: 't' } }]; f.subject.sync = () => f.subject.parents();
  f.subject.states = new Map([['t', f.state]]);
  f.queue.push(() => new Promise(resolve => { first = resolve; }), () => new Promise((resolve, reject) => { second = fails ? reject : resolve; }));
  const busy = f.subject.load(f.state); await Promise.resolve();
  const refreshed = f.subject.refresh().then(value => { settled = true; return value; });
  first(f.page([star(1, 'old')])());
  await new Promise(setImmediate);
  assert.equal(f.calls.length, 2, 'a star change queues a newer read');
  assert.equal(settled, false, 'the dirty window cannot accept the stale read while the newer read is held');
  second(fails ? Error('Star read interrupted') : f.page([star(2, 'new')])());
  assert.deepEqual(await refreshed, [!fails]); await busy;
  assert.equal(f.state.stars[0].dossier.id, fails ? 'old' : 'new');
});

test('1005 navigation retains starred nodes and fences a late read before a fresh publication',async()=>{
  const f=fixture();f.subject.states=new Map([['t',f.state]]);f.state.stars=[star(1,'kept')];f.state.loaded=true;
  const box=f.state.box;let release;f.queue.push(()=>new Promise(done=>release=done));
  const old=f.subject.load(f.state);await Promise.resolve();f.subject.begin();
  assert.equal(f.state.box,box);assert.equal(f.state.stars[0].dossier.id,'kept');assert.equal(f.state.busy,null);
  release(f.page([star(2,'old-run')])());await old;assert.equal(f.state.stars[0].dossier.id,'kept');
  f.queue.push(f.page([star(3,'fresh')]));await f.subject.load(f.state);assert.equal(f.state.stars[0].dossier.id,'fresh');
});
