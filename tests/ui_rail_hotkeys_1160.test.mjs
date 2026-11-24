import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RailHotkeys,RailKeyChoices} from '../web/rail-hotkeys.mjs';
import {OutlineMenus} from '../web/outline-menus.mjs';
import {hotkeyFixture} from './fixtures/rail_hotkeys_1160.mjs';

test('1160 the shell installs one persistent shortcut owner and binds it to each ready page',t=>{
  const f=hotkeyFixture(t),followers=[],makers=[];
  const host={extend:fn=>makers.push(fn),follow:value=>followers.push(value),open(){},view(){}};
  const code=readFileSync(new URL('../web/rails.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export const shell','const shell');
  const names={host,listen:f.listen,OutlineRail:class{shown(){}},ThingsRail:class{},RailHotkeys,menuDoor(){},openMessageMenu(){},panes:{},arrowReach(){},feedKey(){},inMessages(){},messagesSideways(){},onStackControls(){},onNothing(){}};
  new Function(...Object.keys(names),code)(...Object.values(names));makers[0](f.doc,f.doc.defaultView);
  const owner=followers.find(value=>value instanceof RailHotkeys);
  assert.ok(owner,'the real rails module must install the shortcut owner');
  owner.ready(f.handles);owner.assign(f.rows[0],'1');
  owner.begin();assert.equal(owner.keydown({altKey:true,code:'Digit1'}),false,'a retired run cannot navigate');
  owner.ready(f.handles);assert.equal(owner.choices.values.length,1);
});

test('1160 a confirmed existing topic menu assigns a key and keeps its ordinary actions',async t=>{
  const f=hotkeyFixture(t),shown=[],row=f.rows[0];
  f.doc.defaultView.MutationObserver=undefined;
  const source={instance_id:f.bootstrap.instance_id,topic:{id:'t0',title:'Topic zero',state:'active',archived:false,creator_id:'fixture-reader',version:1}};
  const outline={list:f.root,doc:f.doc,handles:{...f.handles,view:async()=>source},message:f.doc.createElement('p')};
  const menus=new OutlineMenus(outline,{show:options=>{shown.push(options);return{close(){}};}});
  await menus.open(row);
  assert.ok(shown[0].items.some(item=>item.key==='copy'));
  const choice=shown[0].items.find(item=>item.key==='rail-hotkey-1');
  assert.ok(choice,'the real confirmed menu must expose its Key row');choice.act();
  assert.equal(f.hotkeys.choices.values[0].target.id,'t0');
});

test('1160 physical Option-Digit keys navigate through the actual current topic row from typing fields',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');
  f.rail.question=()=> 'current-question';
  const e=f.key();assert.equal(e.defaultPrevented,true);
  assert.deepEqual(f.opens,[['t0','Topic 0','current-question']]);
  assert.equal(f.opened.length,0,'loaded rows keep their existing navigation owner');
});

test('1160 reassignment moves a key across item kinds and removes the old keycap',t=>{
  const f=hotkeyFixture(t),health=f.link('?health','Health');
  f.hotkeys.assign(f.rows[0],'1');f.hotkeys.assign(health,'1');
  assert.equal(f.hotkeys.choices.values.length,1);assert.equal(f.hotkeys.choices.values[0].target.kind,'health');
  assert.equal(f.rows[0].querySelector('.rail-hotkeycap'),null);
  assert.equal(health.querySelector('.rail-hotkeycap').textContent,'1');
  assert.match(health.querySelector('.rail-hotkeycap').title,/Option\+1/);
  f.hotkeys.assign(health,'0');assert.equal(f.hotkeys.choices.values.length,1);assert.equal(health.getAttribute('aria-keyshortcuts'),'Alt+0');
});

test('1160 × clears an assignment without consuming the next typed key',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');
  f.hotkeys.menuItems(f.rows[0]).find(item=>item.railDigit===null).act();
  assert.equal(f.rows[0].querySelector('.rail-hotkeycap'),null);assert.equal(f.hotkeys.choices.values.length,0);
  assert.equal(f.key().defaultPrevented,false);assert.equal(f.opens.length,0);
});

test('1160 reload restores choices by instance and reader, without cross-account shortcuts',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'9');
  const copy=new RailKeyChoices(f.storage);copy.bind(f.bootstrap.instance_id,f.bootstrap.actor);
  assert.equal(copy.values[0].digit,'9');copy.bind('another-instance',f.bootstrap.actor);assert.deepEqual(copy.values,[]);
  copy.bind(f.bootstrap.instance_id,'another-reader');assert.deepEqual(copy.values,[]);
});

test('1160 a key for a currently absent row uses the guarded shell destination, never location directly',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');f.rows[0].remove();
  f.key();assert.deepEqual(f.opened,[[{kind:'topic',id:'t0'},'Topic 0']]);assert.equal(f.doc.defaultView.location.search,'?topic=t0');
});

test('1160 a non-feed page uses the shell instead of a hidden outline’s retired topic handler',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');
  const outline=f.doc.createElement('section');outline.id='outline';outline.hidden=true;f.root.append(outline);outline.append(f.rows[0]);
  f.hotkeys.begin();let ready=false;f.hotkeys.bind(f.bootstrap,()=>ready);
  assert.equal(f.key().defaultPrevented,false,'bootstrap alone must not navigate before the page is ready');
  ready=true;
  f.key();assert.equal(f.opens.length,0);assert.deepEqual(f.opened,[[{kind:'topic',id:'t0'},'Topic 0']]);
});

test('1160 unrelated modifiers, composition, prevented keys and unassigned keys retain their existing behavior',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');
  for(const extra of [{altKey:false},{metaKey:true},{ctrlKey:true},{shiftKey:true},{isComposing:true},{code:'Numpad1'},{code:'Digit2'},{defaultPrevented:true}]) {
    const e=f.key(extra);assert.equal(f.opens.length,0,JSON.stringify(extra));assert.equal(Boolean(e.stopped),false);
  }
  f.key();f.key({repeat:true});assert.equal(f.opens.length,1,'holding the number must not repeat navigation');
});

test('1160 an inert modal background cannot navigate from a shortcut',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');f.root.setAttribute('inert','');
  assert.equal(f.key().defaultPrevented,false);assert.equal(f.opens.length,0);
});

test('1160 Notebook pages and same-origin Health routes are assignable, arbitrary URLs are not',t=>{
  const f=hotkeyFixture(t),page=f.link('?workspace=w1&page=n1160','Notebook page'),bad=f.link('https://elsewhere.invalid/?health','External');
  f.hotkeys.assign(page,'3');assert.deepEqual(f.hotkeys.choices.values[0].target,{kind:'workspace',id:'w1',page:'n1160'});
  assert.deepEqual(f.hotkeys.menuItems(bad),[]);assert.equal(f.hotkeys.describe(f.link('javascript:alert(1)','Bad')),null);
});

test('1160 corrupt or forged local preferences cannot introduce unsafe destinations or duplicate assignments',t=>{
  const f=hotkeyFixture(t),key=f.hotkeys.choices.key;
  f.kept.set(key,JSON.stringify({version:1,items:[{digit:'1',target:{kind:'topic',id:'good'},label:'Good'},{digit:'1',target:{kind:'health'},label:'Duplicate'},{digit:'2',target:{kind:'evil',url:'javascript:bad'},label:'Forged'}]}));
  f.emit(f.doc.defaultView,'storage',{key});assert.equal(f.hotkeys.choices.values.length,1);assert.equal(f.hotkeys.choices.values[0].target.id,'good');
});

test('1160 denied writes retain both the reassignment and a later clear in memory',t=>{
  const f=hotkeyFixture(t,{storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});
  f.hotkeys.assign(f.rows[0],'1');f.hotkeys.assign(f.rows[1],'1');
  assert.equal(f.hotkeys.choices.kept,false);assert.equal(f.hotkeys.choices.values.length,1);assert.equal(f.hotkeys.choices.values[0].target.id,'t1');
  f.hotkeys.assign(f.rows[1],null);f.hotkeys.choices.refresh();assert.deepEqual(f.hotkeys.choices.values,[]);
});

test('1160 a stale menu read cannot assign to a different page run',async t=>{
  const f=hotkeyFixture(t);let current=true;
  const choice=f.hotkeys.menuItems(f.rows[0],()=>current)[0];current=false;choice.act();
  assert.deepEqual(f.hotkeys.choices.values,[]);
});

test('1160 the Key row retains its menu buttons and exposes reassignment, clear and horizontal keys',t=>{
  const f=hotkeyFixture(t);f.hotkeys.assign(f.rows[0],'1');
  const items=f.hotkeys.menuItems(f.rows[1]),root=f.doc.createElement('div');f.root.append(root);
  for(const item of items){const button=f.doc.createElement('button');button.textContent=item.label;root.append(button);}
  f.hotkeys.decorateMenu({root,anchor:f.rows[1]},items);
  const chips=root.querySelector('.rail-hotkey-chips');assert.ok(chips);assert.equal(chips.children.length,11);
  assert.equal(chips.children[0].textContent,'1');assert.equal(chips.children[0].classList.contains('taken'),true);
  assert.match(chips.children[0].title,/Topic 0.*move it here/);
  assert.equal(chips.children[10].textContent,'×');assert.equal(chips.children[10].getAttribute('aria-checked'),'true');
  chips.children[0].focus();chips.listeners.keydown({key:'ArrowRight',preventDefault(){},stopPropagation(){}});
  assert.equal(f.doc.activeElement,chips.children[1]);
});
