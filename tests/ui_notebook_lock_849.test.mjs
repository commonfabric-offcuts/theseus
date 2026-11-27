import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookSheet } from '../web/notebook-sheet.mjs';
import { deckBody } from '../web/deck.mjs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';

// Actual page, writer, store-lock and handlers; deterministic storage/DOM adapters.
// This does not prove native lock arbitration, keyboard, click, layout or focus.
function documentFor(t) {
  const doc = miniDocument(), saved = new Map(), listeners = new Map();
  const set = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const make = doc.createElement;
  doc.createElement = tag => {
    const n = make(tag); n.ownerDocument = doc; n.style = { setProperty(k,v) { this[k]=v; }, removeProperty(k) { delete this[k]; } };
    n.scrollTop = 0; n.scrollHeight = n.clientHeight = n.offsetHeight = 100;
    Object.defineProperty(n, 'parentElement', { get: () => n.parent });
    n.contains = other => n === other || [...n.descendants()].includes(other);
    n.matches = selector => matches(n, selector);
    n.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, width: 500 });
    n.getClientRects = () => [n.getBoundingClientRect()];
    n.before = other => n.parent?.insertBefore(other,n);
    n.after = (...others) => {const next=n.parent?.children[n.parent.children.indexOf(n)+1];for(const other of others)n.parent?.insertBefore(other,next);};
    n.setSelectionRange = (start,end) => { n.selectionStart=start; n.selectionEnd=end; };
    n.querySelectorAll = selector => {
      const own = /^:scope\s*>\s*(.+)$/.exec(selector), parts=(own?.[1]??selector).split(/\s*>\s*/);
      const admits=(el,simple)=>{
        const values=[...simple.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
        const plain=simple.replace(/\[([\w-]+)="[^"]*"\]/g,'[$1]');
        return matches(el,plain)&&values.every(([,key,value])=>key.startsWith('data-')?el.dataset[key.slice(5)]===value:el.getAttribute(key)===value);
      };
      let found=(own?n.children:[...n.descendants()]).filter(el=>admits(el,parts[0]));
      for(const part of parts.slice(1))found=found.flatMap(el=>el.children).filter(el=>admits(el,part));
      return found;
    };
    return n;
  };
  doc.createElementNS = (_ns,tag) => doc.createElement(tag);
  doc.body = doc.createElement('body'); doc.body.root = true; doc.activeElement=doc.body;
  doc.documentElement=doc.createElement('html'); doc.getElementById=id=>doc.byId(id);
  doc.querySelector=()=>null; doc.getSelection=()=>({isCollapsed:true});
  doc.addEventListener=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
  doc.defaultView={getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'}),addEventListener(){}};
  set('document',doc); set('location',new URL('https://fixture/?topic=t'));
  set('addEventListener',()=>{});set('removeEventListener',()=>{});set('scrollX',0);set('scrollY',0);set('scrollTo',()=>{});
  set('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  set('sessionStorage',{getItem:()=>null,setItem(){},removeItem(){}});set('localStorage',{getItem:()=>null,setItem(){}});
  const restore=()=>{for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];};
  return {doc,set,restore};
}
function device() {
  const held=new Set(), requested=[], records=new Map(), lifetimes=[];
  const request=result=>{const r={result:structuredClone(result)};queueMicrotask(()=>r.onsuccess?.());return r;};
  const db={close(){},transaction(){
    const tx={objectStore:name=>({
      get:key=>request(records.get(name+key)),
      put:(value,key)=>records.set(name+key,structuredClone(value)),
      delete:key=>records.delete(name+key),
      index:()=>({openKeyCursor:()=>request(null)}),
    })};
    queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.()));return tx;
  }};
  return {requested,held,lifetimes,navigator:{platform:'MacIntel',locks:{request(name,options,fn){
    requested.push({name,options});
    const lifetime=(async()=>{
      if(held.has(name))return fn(null);
      held.add(name);try{return await fn({name});}finally{held.delete(name);}
    })();lifetimes.push(lifetime);return lifetime;
  }}},indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess?.());return r;}},IDBKeyRange:{only:key=>key}};
}
async function fixture(t,mode='cards') {
  const {doc,set,restore}=documentFor(t), disk=device(), pages=[], commands=[];
  for(const k of ['navigator','indexedDB','IDBKeyRange'])set(k,disk[k]);
  const source={instance_id:'fixture-instance',source_ref:{kind:'memory',id:'page',revision:1},
    owner_scope:{kind:'workspace',id:'fixture-workspace'},title:'Shared page',
    body:'## First\n\nFirst words\n\n## Second\n\nSecond words\n',
    attachments:[],references:[],reader_may_write:true,reader_may_delete:true};
  const api={view:async name=>{
      if(name==='memory_items')return {relevant_versions:{notebook:source.source_ref.revision}};
      assert.ok(name==='memory_current'||name==='memory_status',name);
      return structuredClone(source);
    },
    command:async envelope=>{commands.push(envelope);throw Error('Unexpected command');}};
  const create=(mode,deleteUI)=>{
    const host=doc.createElement('section');doc.body.append(host);
    const page=new NotebookPage({doc,host,item:'page',mode,bootstrap:{instance_id:'fixture-instance',actor:'fixture-person',authority:{authority_id:'fixture-authority',authority_epoch:'fixture-epoch'}},
      api,read:api.view,send:api.command,deleteUI,header:Object.fromEntries(['eyebrow','title','description'].map(k=>[k,doc.createElement('div')])),
      place:async()=>({title:'Fixture',href:'/fixture'}),askIn:async()=>null,viewPreference:{get:()=>mode,set(){}}});
    pages.push(page);return page;
  };
  const make=async mode=>{const page=create(mode);assert.equal(await page.load(),true);return page;};
  t.after(async()=>{try{for(const p of pages)p.close();await Promise.all(pages.map(p=>p.writing?.serial));await Promise.all(disk.lifetimes);}finally{restore();}});
  const owner=await make('cards'),page=await make(mode);
  return {doc,owner,page,source,commands,disk,make,create};
}

test('concurrent Notebook loads share the whole first open',async t=>{
  const f=await fixture(t);
  f.owner.close();await f.disk.lifetimes[0];
  const storage=Promise.withResolvers(), header=Promise.withResolvers(), headerEntered=Promise.withResolvers();
  let opens=0, registrations=0, headers=0;
  const page=f.create('cards',{
    beforeOpen(){opens++;return storage.promise;},
    register(){registrations++;},changed(){},release(){},retains(){return false;}
  });
  const paintHeader=page.paintHeader.bind(page);
  page.paintHeader=async()=>{headers++;headerEntered.resolve();await header.promise;return paintHeader();};
  const first=page.load();
  const second=page.load();
  const results=Promise.allSettled([first,second]);
  assert.equal(page.writing,undefined);
  storage.resolve();
  await headerEntered.promise;
  const third=page.load();
  const late=Promise.allSettled([third]);
  header.resolve();
  const opened={status:'fulfilled',value:true};
  assert.deepEqual(await results,[opened,opened]);
  assert.deepEqual(await late,[opened]);
  assert.deepEqual({opens,registrations,headers,locks:f.disk.requested.length},{opens:1,registrations:1,headers:1,locks:3});
  assert.equal(page.writing.value.body,f.source.body);
  assert.equal(page.readOnly,false);
});

test('closing during Notebook open releases the device lock without drawing the old page',async t=>{
  const f=await fixture(t);
  f.owner.close();await f.disk.lifetimes[0];
  const storage=Promise.withResolvers();
  let registrations=0;
  const page=f.create('cards',{
    beforeOpen:()=>storage.promise,register(){registrations++;},changed(){},release(){},retains(){return false;}
  });
  const first=page.load(), second=page.load();
  const results=Promise.allSettled([first,second]);
  page.close();
  storage.resolve();
  const closed={status:'fulfilled',value:false};
  assert.deepEqual(await results,[closed,closed]);
  assert.equal(registrations,0);
  assert.equal(page.list.children.length,0);
  const fresh=await f.make('cards');
  assert.equal(fresh.readOnly,false);
});

test('closing after the device lock is acquired releases it when the store opens',async t=>{
  const f=await fixture(t);
  f.owner.close();await f.disk.lifetimes[0];
  const storage=Promise.withResolvers(), requested=Promise.withResolvers();
  const open=f.disk.indexedDB.open;
  f.disk.indexedDB.open=()=>{
    const request=open(), held={result:request.result};
    request.onsuccess=()=>{requested.resolve();storage.promise.then(()=>held.onsuccess());};
    return held;
  };
  const page=f.create('cards'), opening=page.load();
  await requested.promise;
  assert.equal(f.disk.held.size,1);
  page.close();
  f.disk.indexedDB.open=open;
  storage.resolve();
  assert.equal(await opening,false);
  await f.disk.lifetimes[2];
  assert.equal(f.disk.held.size,0);
  assert.equal(page.writing,undefined);
  assert.equal((await f.make('cards')).readOnly,false);
});

test('a commit during first paint refreshes the Notebook sheet after opening',async t=>{
  const f=await fixture(t);
  f.owner.close();await f.disk.lifetimes[0];
  const page=f.create('cards'), sheet={current:page,showing:true};
  const header=Promise.withResolvers(), headerEntered=Promise.withResolvers();
  const paintHeader=page.paintHeader.bind(page);
  page.paintHeader=async()=>{headerEntered.resolve();await header.promise;return paintHeader();};
  const opening=page.load();
  await headerEntered.promise;
  assert.equal(page.writing.base.revision,1);
  f.source.source_ref.revision=2;
  f.source.body=f.source.body.replace('Second words','Incoming words');
  const following=NotebookSheet.prototype.followed.call(sheet,page);
  header.resolve();
  assert.deepEqual(await Promise.all([opening,following]),[true,true]);
  assert.equal(page.writing.base.revision,2);
  assert.equal(deckBody(page.deck),f.source.body);
  assert.equal(f.disk.requested.length,3,'follow refreshes the shared writer');
});

test('returning to a Notebook sheet during its first open uses the same writer',async t=>{
  const f=await fixture(t);
  f.owner.close();await f.disk.lifetimes[0];
  const hold=Promise.withResolvers();
  const page=f.create('cards',{
    beforeOpen:()=>hold.promise,register(){},changed(){},release(){},retains(){return false;}
  });
  const first=page.load(), sheet={current:null,leaving:new Map(),keepWriting(){}};
  NotebookSheet.prototype.letGo.call(sheet,page);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  const retained=sheet.leaving.get(page.item);
  if(retained!==page){
    hold.resolve();await first;
    assert.equal(retained,page);
  }
  const again=NotebookSheet.prototype.obtain.call(sheet,page.item).page;
  hold.resolve();
  assert.equal(again,page);
  assert.deepEqual(await Promise.all([first,again.load()]),[true,true]);
  assert.equal(page.readOnly,false);
  assert.equal(f.disk.requested.length,3);
});
const key=(page,key,extra={})=>{const event={key,target:page.list,preventDefault(){this.defaultPrevented=true;},...extra};page.key(event);return event;};
const notice=page=>{assert.match(page.status.text,/another tab/);assert.equal(page.status.children[0].dataset.save,'attention');};
const unchanged=f=>{
  assert.equal(deckBody(f.page.deck),f.page.base.body);assert.deepEqual(f.page.writing.value,f.owner.writing.value);
  assert.equal(f.page.editing,null);assert.equal(f.page.acts.length,0);assert.equal(f.commands.length,0);
};

for(const mode of ['cards','text'])test('849 '+mode+' opening explains the actual denied tab lock and leaves the page readable',async t=>{
  const f=await fixture(t,mode);notice(f.page);
  assert.equal(f.page.readOnly,true);assert.equal(f.page.text.readOnly,true);assert.equal(f.page.text.value,f.source.body);
  assert.equal(f.disk.requested.length,2);assert.equal(f.disk.requested[0].name,f.disk.requested[1].name);
  assert.deepEqual(f.disk.requested[1].options,{ifAvailable:true});
  assert.match(f.page.status.text,/Close the page in the other tab, then reload this one, or keep reading here/);
  unchanged(f);
});

for(const [name,keyName,extra] of [
  ['move up','ArrowUp',{metaKey:true}],['move down','ArrowDown',{metaKey:true}],
  ['indent','Tab',{}],['outdent','Tab',{shiftKey:true}],['merge','ArrowUp',{metaKey:true,shiftKey:true}],
  ['remove','Backspace',{metaKey:true}],['edit','Enter',{metaKey:true}],['new card','Enter',{}],['undo','z',{metaKey:true}],
])test('849 denied '+name+' key repeats the lock notice without changing the page',async t=>{
  const f=await fixture(t);f.page.picked=1;const prior=f.page.status.children[0];
  key(f.page,keyName,extra);notice(f.page);assert.ok(f.page.status.children[0]!==prior,'refused edit must repeat the notice');unchanged(f);
});

for(const label of ['Edit','New card','Undo'])test('849 denied '+label+' button repeats the lock notice without changing the page',async t=>{
  const f=await fixture(t);const prior=f.page.status.children[0];
  f.page.bar.children.find(n=>n.text===label).onclick();notice(f.page);
  assert.ok(f.page.status.children[0]!==prior,'refused click must repeat the notice');unchanged(f);
});

test('849 clicking a card repeats the lock notice and modifier-click still selects for reading',async t=>{
  const f=await fixture(t),row=f.page.list.querySelectorAll('.deck-card')[1],target=row.querySelector('.deck-title');
  const prior=f.page.status.children[0];row.listeners.click({target});notice(f.page);
  assert.ok(f.page.status.children[0]!==prior);assert.equal(f.page.picked,1);unchanged(f);
  const repeated=f.page.status.children[0],first=f.page.list.querySelectorAll('.deck-card')[0];
  first.listeners.click({target:first.querySelector('.deck-title'),metaKey:true});
  assert.deepEqual([...f.page.selected].sort(),[0,1]);assert.ok(f.page.status.children[0]===repeated);unchanged(f);
});

test('849 reading keys still move the picked card without repeating a writing refusal',async t=>{
  const f=await fixture(t),prior=f.page.status.children[0];assert.equal(f.page.picked,0);
  key(f.page,'ArrowDown');assert.equal(f.page.picked,1);assert.ok(f.page.status.children[0]===prior);unchanged(f);
  f.page.switchView('text');notice(f.page);assert.equal(f.page.text.readOnly,true);
});

test('849 closing the lock owner and reopening allows writing, while the old reader stays read-only',async t=>{
  const f=await fixture(t);f.owner.close();await f.disk.lifetimes[0];
  const fresh=await f.make('cards');assert.equal(fresh.unavailable,undefined);assert.equal(fresh.readOnly,false);
  const before=deckBody(fresh.deck);key(fresh,'ArrowDown',{metaKey:true});assert.notEqual(deckBody(fresh.deck),before);
  assert.equal(fresh.deck.cards[0].title,'Second');assert.equal(f.page.readOnly,true);notice(f.page);
  key(fresh,'z',{metaKey:true});assert.equal(deckBody(fresh.deck),before);
  fresh.editButton.onclick();assert.ok(fresh.editing);assert.equal(f.commands.length,0);
});
