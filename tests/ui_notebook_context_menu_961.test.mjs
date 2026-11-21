import test from 'node:test';
import assert from 'node:assert/strict';
import { writingPort, painted867, card, text867 } from './fixtures/card_menu_867.mjs';
const event = (target, extra={}) => ({target,clientX:125,clientY:220,defaultPrevented:false,
  preventDefault(){this.defaultPrevented=true;},...extra});

test('961 secondary entry uses the targeted card owner and pointer; Delete saves that card only',async t=>{
  const {p,w,source}=await writingPort(t,card('First','keep',null)+card('Second','remove',null));
  painted867(t,p);p.doc.getSelection=()=>({isCollapsed:true});p.paint();p.picked=0;
  const row=p.list.children[1],e=event(row);p.contextMenu(e);
  const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu);assert.equal(e.defaultPrevented,true);
  assert.equal(menu.style.left,'125px');assert.equal(menu.style.top,'220px');
  menu.children.find(n=>n.textContent==='Delete').onclick({stopPropagation(){}});
  await w.flush();assert.equal(source().body,card('First','keep',null).trimEnd()+'\n');
});

test('961 the constructor binds page/menu/title entry to the same page descriptors',async t=>{
  const {p,w}=await text867(t,card());w.pageState={starred:false,reader_may_delete:false};p.readOnly=true;
  p.doc.getSelection=()=>({isCollapsed:true});
  const ordinary=p.more.onclick();const snapshot=n=>n.children.map(c=>[c.textContent,c.disabled,c.getAttribute('aria-checked')]);
  const expected=snapshot(ordinary.root);assert.ok(expected.some(([s])=>s.startsWith('Show as cards')));ordinary.close(false);
  for(const surface of [p.host,p.header.title,p.more]) {
    const e=event(surface);surface.listeners.contextmenu(e);assert.equal(e.defaultPrevented,true);
    const menu=p.doc.body.querySelector('[role="menu"]');assert.deepEqual(snapshot(menu),expected);
    p.openPageMenu()?.close(false);
  }
  p.openPageMenu();p.listening.abort();assert.equal(p.doc.body.querySelector('[role="menu"]'),null);
  const retired=event(p.host);p.host.listeners.contextmenu(retired);assert.equal(retired.defaultPrevented,false);
});

test('961 preserves selected text, images, fields, prior owners and both touch contextmenu forms',async t=>{
  const {p}=await text867(t,card());p.doc.getSelection=()=>({isCollapsed:true});let opened=0;
  p.openPageMenu=p.openCardMenu=()=>{opened++;return {};};
  const cases=[event(p.host,{defaultPrevented:true}),event(p.host,{pointerType:'touch'})];
  for(const tag of ['img','input','textarea','select'])cases.push(event(p.doc.createElement(tag)));
  const editing=p.doc.createElement('div');editing.setAttribute('contenteditable','true');const inside=p.doc.createElement('span');editing.append(inside);cases.push(event(inside));
  for(const e of cases)p.host.listeners.contextmenu(e);
  p.doc.getSelection=()=>({isCollapsed:false});const selected=event(p.host);p.host.listeners.contextmenu(selected);assert.equal(selected.defaultPrevented,false);
  p.doc.getSelection=()=>({isCollapsed:true});p.host.listeners.pointerdown({pointerType:'touch'});
  const legacyTouch=event(p.host);p.host.listeners.contextmenu(legacyTouch);assert.equal(legacyTouch.defaultPrevented,false);assert.equal(opened,0);
  p.host.listeners.pointerdown({pointerType:'mouse'});const mouse=event(p.host);p.host.listeners.contextmenu(mouse);assert.equal(mouse.defaultPrevented,true);assert.equal(opened,1,'a real mouse after touch remains supported');
});

test('961 distinguishes an existing selection from WebKit selection during secondary click',async t=>{
  const {p}=await text867(t,card());let collapsed=true,opened=0;
  p.doc.getSelection=()=>({isCollapsed:collapsed});p.openPageMenu=()=>{opened++;return {};};
  p.header.title.listeners.pointerdown({pointerType:'mouse',button:2});collapsed=false;
  const automatic=event(p.header.title);p.header.title.listeners.contextmenu(automatic);assert.equal(automatic.defaultPrevented,true);assert.equal(opened,1);
  p.header.title.listeners.pointerdown({pointerType:'mouse',button:0,ctrlKey:true});collapsed=true;
  const existing=event(p.header.title);p.header.title.listeners.contextmenu(existing);assert.equal(existing.defaultPrevented,false);assert.equal(opened,1);
});

test('961 consumes only the primary click following a handled Control-click menu',async t=>{
  const {p}=await text867(t,card());p.doc.getSelection=()=>({isCollapsed:true});p.openPageMenu=()=>({});
  const second=event(p.host,{ctrlKey:true});p.host.listeners.contextmenu(second);assert.equal(second.defaultPrevented,true);
  let stopped=false;const follow=event(p.host,{ctrlKey:true,stopImmediatePropagation(){stopped=true;}});p.host.listeners.click(follow);assert.equal(follow.defaultPrevented,true);assert.equal(stopped,true);
  p.host.listeners.contextmenu(event(p.host,{ctrlKey:true}));p.host.listeners.pointerdown({pointerType:'mouse',button:0});
  const later=event(p.host,{ctrlKey:true,stopImmediatePropagation(){assert.fail('later click stopped');}});p.host.listeners.click(later);assert.equal(later.defaultPrevented,false);
});
