import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { OnboardingPrompt, owns, copyPrompt, COPIED, COPY_FAILED, READ_FAILED } from '../web/onboarding.mjs';

const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture({read, copier} = {}) {
  globalThis.document = miniDocument(); document.body = document.createElement('body');
  const button = document.createElement('button'), reads = [], copies = [];
  let revision = 'current one';
  const view = new OnboardingPrompt({button, reader:'owner', read: async (name,args) => {
    reads.push({name,args}); return read ? read(name,args) : {...args,prompt:revision};
  }, copier: copier ?? (async text => { copies.push(await text); return true; })});
  view.dialog.showModal = () => { view.dialog.open = true; };
  view.dialog.close = () => { view.dialog.open = false; };
  view.text.select = () => { view.selected = true; };
  view.paint({id:'w1',owner_id:'owner'});
  return {view,button,reads,copies,set current(value){revision=value;}};
}

test('item 790 only the exact owner has the overflow and opening alone neither reads nor copies', async () => {
  const f=fixture(); f.view.open(); assert.equal(f.reads.length,0); assert.equal(f.copies.length,0);
  assert.equal(f.view.choices.children.map(x=>x.textContent).join(','),'Codex,Claude');
  let menuClosed=0;f.view.menu={close:()=>menuClosed++};
  for(const owner_id of ['coordinator','member',null]) {
    f.view.paint({id:'w1',owner_id}); assert.equal(f.button.hidden,true);
    f.view.open(); await f.view.copy('codex'); assert.equal(f.reads.length,0);
  }
  assert.equal(menuClosed,1,'a previously open menu disappears when its reader loses ownership');
  assert.equal(owns(null,'owner'),false);
});

test('item 790 each variant immediately copies newly read facts, announces success and shows the exact text', async () => {
  const f=fixture(); f.view.open();
  await f.view.choices.children[0].onclick();
  assert.deepEqual(f.reads[0],{name:'onboarding_prompt',args:{workspace_id:'w1',variant:'codex'}});
  assert.equal(f.view.text.value,f.copies[0]); assert.equal(f.view.state.textContent,COPIED); assert.equal(f.view.toast.hidden,false);
  f.current='changed after choosing';
  await f.view.choices.children[1].onclick();
  assert.equal(f.copies[1],'changed after choosing'); assert.equal(f.reads[1].args.variant,'claude');
  assert.equal(f.view.text.hidden,false);
});

test('item 790 clipboard refusal keeps readable selected text, truthfully offers retry and rereads current facts', async () => {
  let okay=false; const copied=[];
  const f=fixture({copier:async text => {copied.push(await text);return okay;}});f.view.open();
  await f.view.copy('claude'); assert.equal(f.view.state.textContent,COPY_FAILED);
  assert.equal(f.view.text.value,'current one'); assert.equal(f.view.text.hidden,false);assert.equal(f.view.selected,true);
  assert.equal(f.view.toast.hidden,true);assert.equal(f.view.retry.textContent,'Retry copy');
  f.current='new state on retry';okay=true;await f.view.retry.onclick();
  assert.equal(f.view.text.value,'new state on retry');assert.equal(f.view.state.textContent,COPIED);
  assert.deepEqual(copied,['current one','new state on retry']);
});

test('item 790 read refusal clears earlier text and never echoes transport or private context', async () => {
  let fail=false;
  const f=fixture({read:async (_name,args) => {if(fail)throw Error('token=SYNTHETIC790');return {...args,prompt:'safe'};}});f.view.open();
  await f.view.copy('codex');fail=true;await f.view.retry.onclick();
  assert.equal(f.view.state.textContent,READ_FAILED);assert.equal(f.view.text.value,'');assert.equal(f.view.text.hidden,true);
  assert.equal(f.view.toast.hidden,true);assert.equal(f.view.retry.textContent,'Try again');
});

test('item 790 closed, superseded and newly non-owner reads cannot copy or repaint', async () => {
  for(const invalidate of [f=>f.view.close(),f=>f.view.paint({id:'w1',owner_id:'member'})]) {
    const d=defer(),f=fixture({read:()=>d.promise});f.view.open();const pending=f.view.copy('codex');
    invalidate(f);d.resolve({workspace_id:'w1',variant:'codex',prompt:'stale'});await pending;
    assert.deepEqual(f.copies,[]);assert.equal(f.view.text.value,'');assert.equal(f.view.toast.hidden,true);
  }
  const d=defer(),f=fixture({read:(_n,args)=>args.variant==='codex'?d.promise:{...args,prompt:'new variant'}});f.view.open();
  const old=f.view.copy('codex');await f.view.copy('claude');d.resolve({workspace_id:'w1',variant:'codex',prompt:'old'});await old;
  assert.deepEqual(f.copies,['new variant']);assert.equal(f.view.text.value,'new variant');
});

test('item 790 native clipboard helper starts promised-data write synchronously and reports refusal accurately', async () => {
  const d=defer(),events=[];let data;
  class ClipboardItem {constructor(value){data=value;events.push('item');}}
  const copy=copyPrompt(d.promise,{clipboard:{write:async items=>{events.push('write');assert.equal(items.length,1);const blob=await data['text/plain'];assert.equal(await blob.text(),'fresh');}}},{ClipboardItem,Blob});
  assert.deepEqual(events,['item','write']);d.resolve('fresh');assert.equal(await copy,true);
  assert.equal(await copyPrompt(Promise.resolve('safe'),{clipboard:{writeText:async()=>{throw Error('denied');}}},{}),false);
  assert.equal(await copyPrompt(Promise.reject(Error('read denied')),{clipboard:{writeText:async()=>assert.fail('must not copy')}},{}),false);
  let actual;assert.equal(await copyPrompt(Promise.resolve('fallback'),{clipboard:{writeText:async text=>{actual=text;}}},{}),true);assert.equal(actual,'fallback');
});

test('item 790 native case enumeration retains six original literal reading cases plus one Chromium control for laptop and phone', async () => {
  const {readingChecks}=await import('./topic_reading_native.mjs');
  const names=[];await readingChecks({check:async(name,_body)=>{if(/^reading item 790/.test(name))names.push(name);},facts:{origin:'https://isolated.invalid'},observations:[]});
  assert.equal(names.length,7);assert.equal(new Set(names).size,7);
  for(const name of names.slice(1))assert.match(name,/^reading item 790 (laptop|phone):/);
  assert.equal(names[0],'reading item 790 clipboard-control: fixture-only raw Meta+V versus native paste editing command');
  console.log(JSON.stringify({item790NativeCases:names,chromium:names.length,runnerStarts:0}));
});

test('item 790 every generated browser expression parses, state/layout readers execute below browser', async () => {
  const {Script,runInNewContext}=await import('node:vm');
  const {expression790:X,centre790,hit790}=await import('./onboarding_790_expressions.mjs');
  for(const source of [...Object.values(X),centre790('#onboarding-codex'),hit790('#onboarding-codex',30,40)])new Script(source);
  const nodes={'#onboarding-sheet':{open:true,scrollWidth:358,clientWidth:358,getBoundingClientRect:()=>({left:16,right:374,top:20,bottom:800})},
    '#onboarding-state':{textContent:'Copied'},'#onboarding-text':{value:'exact text'},'#outcome-menu':{hidden:false}};
  const context={innerWidth:390,innerHeight:844,document:{body:{dataset:{ready:'true'}},querySelector:selector=>nodes[selector]??null}};
  assert.equal(runInNewContext(X.opened,context),true);assert.equal(runInNewContext(X.state,context),'Copied');
  assert.equal(runInNewContext(X.text,context),'exact text');assert.equal(runInNewContext(X.ownerMenu,context),true);
  assert.deepEqual(JSON.parse(JSON.stringify(runInNewContext(X.layout,context))),{left:16,right:374,top:20,bottom:800,width:390,height:844,overflow:0});
  nodes['#outcome-menu'].hidden=true;assert.equal(runInNewContext(X.ownerMenu,context),false);
});
