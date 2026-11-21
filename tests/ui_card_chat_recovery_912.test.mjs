import test from 'node:test';
import assert from 'node:assert/strict';
import { documentPort, card } from './fixtures/card_text_867.mjs';
import { DeckPage } from '../web/deck-page.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookWriting } from '../web/notebook-writing.mjs';
import { NotebookSheet } from '../web/notebook-sheet.mjs';

const available = {topicId:'fixture-topic',agents:['fixture-agent']};
const empty = {topicId:'fixture-topic',agents:[]};
const held = () => {let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};};

// Actual page/writer/header/menu/commit owners. Only DOM, Core view and device
// journal ports are in memory; no IndexedDB, HTTP, store process or native UI.
async function fixture(t, ask, {plain=false}={}) {
  const doc=documentPort(), saved=new Map(), reads=[], asks=[];
  const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  const make=doc.createElement;
  doc.createElement=tag=>{const n=make(tag);n.ownerDocument=doc;
    n.style.removeProperty=k=>delete n.style[k];
    n.before=other=>n.parent?.insertBefore(other,n);
    n.after=(...others)=>{const next=n.parent?.children[n.parent.children.indexOf(n)+1];for(const other of others)n.parent?.insertBefore(other,next);};
    return n;
  };
  doc.getSelection=()=>({isCollapsed:true});
  doc.defaultView={getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'})};
  set('document',doc);set('location',new URL('https://fixture.invalid/'));
  set('sessionStorage',{getItem:()=>null,setItem(){}});set('localStorage',{getItem:()=>null,setItem(){}});
  set('matchMedia',()=>({matches:true,addEventListener(){}}));
  const source={instance_id:'fixture-instance',source_ref:{kind:'memory',id:'page',revision:1},owner_scope:{kind:'topic',id:'fixture-topic'},
    title:'Notebook',body:card(),attachments:[],references:[],reader_may_write:true,reader_may_delete:true};
  const read=async(name,args)=>{
    reads.push({name,args});
    if(name==='memory_items')return {relevant_versions:{notebook:1}};
    assert.ok(['memory_current','memory_status'].includes(name),name);
    return structuredClone(source);
  };
  const store={get:async()=>null,put:async()=>{},close(){}};
  const bootstrap={instance_id:'fixture-instance',actor:'fixture-reader',authority:{authority_id:'fixture-authority',authority_epoch:'fixture-epoch'}};
  const api={view:read,command:async()=>{throw Error('No command expected');}};
  const host=doc.createElement('section');doc.body.append(host);
  const options={doc,host,item:'page',mode:'cards',bootstrap,api,read,send:api.command,
    header:Object.fromEntries(['title','description','eyebrow'].map(k=>[k,doc.createElement('div')])),
    place:async()=>({title:'Fixture topic',href:'/?topic=fixture-topic'}),
    askIn:scope=>{asks.push(structuredClone(scope));return ask(asks.length);},
    viewPreference:{get:()=> 'cards',set(){}}};
  const page=plain?new DeckPage(options):new NotebookPage(options);
  if(!plain){
    // Inject the device journal at the existing writing boundary. load itself,
    // sync, header, images, status and card painting all remain the real owners.
    page.store=store;page.started=true;
    page.writing=new NotebookWriting({item:'page',bootstrap,api,store,changed:()=>page.writingChanged()});
    await page.writing.open();
  }
  t.after(async()=>{try{if(plain)page.listening.abort();else{page.close();await page.writing.serial;}}finally{
    for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  }});
  const sheet=Object.assign(Object.create(NotebookSheet.prototype),{current:page,showing:true});
  const chat=()=>{
    const row=page.list.querySelector('.deck-card'),button=row.querySelector('.deck-menu');
    assert.ok(button,'actual card overflow');button.listeners.click({target:button,stopPropagation(){}});
    const menu=doc.body.querySelector('[role="menu"]'),choice=menu.children.find(n=>(n.querySelector('.menu-description')?.children[0]?.textContent??n.textContent)==='Chat about this…');
    assert.ok(choice,'existing Chat menu choice');const disabled=choice.disabled;
    menu.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
    assert.equal(page.list.querySelector('.deck-ask'),null,'927 standalone glyph stays absent');
    return disabled;
  };
  return {page,source,reads,asks,chat,commit:()=>sheet.followed(page),sheet};
}

for(const trigger of ['full page','sheet'])test(`912 failed first read heals on the next ${trigger} commit`,async t=>{
  const f=await fixture(t,n=>n===1?Promise.reject(Error('participant read failed')):Promise.resolve(available));
  assert.equal(await f.page.load(),true);assert.equal(f.chat(),true);assert.equal(f.asks.length,1);
  const words=f.page.writing.value.body;
  assert.equal(await (trigger==='sheet'?f.commit():f.page.load()),true);
  assert.equal(f.chat(),false,'Chat heals without reopening');assert.deepEqual(f.page.room,available);
  assert.equal(f.page.writing.value.body,words);assert.equal(f.page.writing.error,null);assert.equal(f.asks.length,2);
});

test('912 an agent joining an empty topic heals on a followed commit',async t=>{
  const f=await fixture(t,n=>Promise.resolve(n===1?empty:available));
  await f.page.load();assert.equal(f.chat(),true);await f.commit();assert.equal(f.chat(),false);assert.equal(f.asks.length,2);
});

test('912 an empty room stays disabled and each followed commit may check again quietly',async t=>{
  const f=await fixture(t,()=>Promise.resolve(empty));
  await f.page.load();const before=f.page.status.textContent;
  await f.commit();await f.commit();assert.equal(f.chat(),true);assert.equal(f.asks.length,3);
  assert.equal(f.page.status.textContent,before);assert.equal(f.page.writing.error,null);
});

test('912 null first room heals on the next header paint',async t=>{
  const f=await fixture(t,n=>Promise.resolve(n===1?null:available));
  await f.page.load();assert.equal(f.chat(),true);await f.page.paintHeader();assert.equal(f.chat(),false);
});

test('912 a synchronous failed read stays quiet and can recover',async t=>{
  const f=await fixture(t,n=>{if(n===1)throw Error('sync participant failure');return Promise.resolve(available);});
  assert.equal(await f.page.load(),true);assert.equal(f.chat(),true);
  await f.commit();assert.equal(f.chat(),false);assert.equal(f.page.writing.error,null);
});

test('912 available rooms do not add participant reads on ordinary commits',async t=>{
  const f=await fixture(t,()=>Promise.resolve(available));await f.page.load();await f.commit();await f.commit();
  assert.equal(f.chat(),false);assert.equal(f.asks.length,1);
});

test('912 a failed header reread preserves the available room',async t=>{
  const f=await fixture(t,n=>n===1?Promise.resolve(available):Promise.reject(Error('later failure')));
  await f.page.load();await f.page.paintHeader();assert.equal(f.chat(),false);assert.deepEqual(f.page.room,available);
});

test('912 simultaneous header reads share one participant read',async t=>{
  const gate=held(),f=await fixture(t,n=>n===1?Promise.resolve(null):gate.promise);
  await f.page.load();const a=f.page.paintHeader(),b=f.page.paintHeader();
  await Promise.resolve();await Promise.resolve();assert.equal(f.asks.length,2,'one read while unavailable');
  gate.resolve(available);await Promise.all([a,b]);assert.equal(f.chat(),false);
});

for(const stale of ['closed','scope changed'])test(`912 a late room answer is ignored after the page is ${stale}`,async t=>{
  const gate=held(),f=await fixture(t,n=>n===1?Promise.resolve(null):gate.promise);
  await f.page.load();const waiting=f.page.paintHeader();await Promise.resolve();await Promise.resolve();
  assert.equal(f.asks.length,2);
  if(stale==='closed')f.page.close();else f.page.source={...f.page.source,owner_scope:{kind:'topic',id:'other-topic'}};
  gate.resolve(available);await waiting;assert.equal(f.page.room,null,'late answer cannot supply this page');
});

test('912 a hidden sheet does not retry its room on a commit',async t=>{
  const f=await fixture(t,()=>Promise.resolve(null));await f.page.load();f.sheet.showing=false;
  await f.commit();assert.equal(f.asks.length,1);assert.equal(f.chat(),true);
});

test('912 the shared DeckPage also heals when its Notebook version is unchanged',async t=>{
  const f=await fixture(t,n=>n===1?Promise.resolve(null):Promise.resolve(available),{plain:true});
  await f.page.load();await f.page.load();f.page.room=null;
  const before=f.reads.filter(x=>x.name==='memory_current').length;
  await f.page.load();assert.equal(f.chat(),false);assert.equal(f.reads.filter(x=>x.name==='memory_current').length,before);
});
