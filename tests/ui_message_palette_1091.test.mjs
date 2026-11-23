// Actual renderer decisions and acts; boxes are inert, not native layout evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openMessageMenu} from '../web/message-menu.mjs';
import {Element,miniDocument} from './fixtures/mini_dom.mjs';

function page() {
  const doc=miniDocument(),listeners=[];doc.body=doc.byId('body');
  doc.addEventListener=(type,fn)=>listeners.push({type,fn});
  doc.removeEventListener=(type,fn)=>{const at=listeners.findIndex(x=>x.type===type&&x.fn===fn);if(at>=0)listeners.splice(at,1);};
  const make=doc.createElement;
  doc.createElement=tag=>{
    const node=Object.assign(make(tag),{style:{},offsetWidth:280,offsetHeight:380});let own=node.textContent;
    const replace=node.replaceChildren.bind(node);
    node.replaceChildren=(...children)=>{own='';replace(...children);};
    Object.defineProperty(node,'textContent',{get(){return own+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');},
      set(value){for(const child of this.children)if(typeof child==='object')child.parent=null;this.children=[];own=String(value);}});
    Object.defineProperty(node,'text',{get(){return this.textContent;}});return node;
  };
  // Borrowed glyph storage only; native evidence checks the actual page drawings.
  doc.getElementById=id=>['new-message','reader-aside'].includes(id)?{querySelector:()=>({cloneNode:()=>doc.createElementNS('http://www.w3.org/2000/svg','svg')})}:null;
  Element.prototype.contains??=function(node){for(;node;node=node.parent)if(node===this)return true;return false;};
  Element.prototype.getBoundingClientRect??=function(){return {top:40,left:500,right:540,bottom:80};};
  const anchor=doc.createElement('button');doc.body.append(anchor);
  return {doc,anchor,win:{innerWidth:1360,innerHeight:900},listeners};
}
const item=(key,label=key,glyph='link',more={})=>({key,label,glyph,act(){},...more});
const offered=()=>[
  item('star','Star for me','star'),item('rename','Rename','pencil'),item('aside','Archive','archive',{keys:'⌘→'}),
  item('fold','Fold','fold'),item('Move to topic…'),item('Copy Link'),item('Ask for update','Ask for update','refresh'),
  item('Mark unread','Mark unread','unread'),item('Start a topic from this','Start a topic from this','topic'),
  item('Start a new dossier','Start a new dossier','pencil'),item('Break out paragraphs · Off','Break out paragraphs · Off','layout'),
  item('move-up','Move its stack up','up',{keys:'⌘↑'}),item('join-down','Join the stack below','joindown',{keys:'⇧⌘↓'}),
];
const buttons=root=>root.querySelectorAll('button');
const names=root=>buttons(root).map(b=>b.getAttribute('aria-label')??b.textContent);
const press=button=>button.onclick({stopPropagation(){}});
const key=(root,k)=>root.listeners.keydown({key:k,preventDefault(){},stopPropagation(){}});
function opening(t,options={}) {
  const f=page(),menu=openMessageMenu({...f,items:offered(),label:'This message',...options});
  t.after(()=>menu?.close(false));return {...f,menu};
}

test('1091 agent reply palette has marks, ordered rows, paired starts and grouped actionable keys',t=>{
  const {menu,doc}=opening(t),root=menu.root;
  assert.equal(root.classList.contains('menu-palette'),true);
  assert.deepEqual(names(root.querySelector('.palette-marks')),['Star for me','Mark unread','Archive ⌘→','Copy link']);
  assert.deepEqual(names(root.querySelector('.palette-rows')),['Ask for update','Start a topic from this','Start a new dossier','Move to topic…']);
  assert.deepEqual(names(root.querySelector('.palette-keys')),['Fold','Move its stack up','Join the stack below']);
  assert.equal(doc.activeElement.getAttribute('aria-label'),'Ask for update');
  assert.equal(names(root).some(name=>/Rename|Break out paragraphs/.test(name)),false);
});
test('1091 own question withdraw is ordinary, offered Unsend/Retract/Delete alone is destructive',t=>{
  for(const danger of ['Unsend','Retract','Delete']) {
    const {menu}=opening(t,{items:[...offered(),item('Edit','Edit','pencil'),item('Withdraw question','Withdraw question','drop'),item(danger,danger,'undo')]});
    const root=menu.root,red=root.querySelectorAll('.palette-danger');
    assert.deepEqual(red.map(b=>b.getAttribute('aria-label')),[danger]);
    const withdraw=root.querySelector('.palette-rows').querySelectorAll('button').find(b=>b.textContent==='Withdraw question');
    assert.ok(withdraw);assert.equal(withdraw.querySelector('svg').getAttribute('data-glyph'),'waits');
    assert.equal(withdraw.classList.contains('palette-danger'),false);menu.close(false);
  }
});
test('1091 both Start new buttons keep separate exact acts; a single offered start stays a normal row',t=>{
  for(const choice of ['Start a topic from this','Start a new dossier']) {
    const calls=[],items=offered().map(i=>({...i,act:()=>calls.push(i.key)}));
    const {menu,anchor,doc,listeners}=opening(t,{items}),pair=menu.root.querySelector('.palette-pair');
    assert.ok(pair);assert.equal(pair.getAttribute('role'),'group');
    assert.deepEqual(pair.querySelectorAll('button').map(b=>b.textContent),['Topic','Dossier']);
    const button=pair.querySelectorAll('button').find(b=>b.getAttribute('aria-label')===choice);press(button);
    assert.deepEqual(calls,[choice]);assert.equal(menu.root.isConnected,false);assert.equal(doc.activeElement,anchor);assert.equal(listeners.length,0);
  }
  const {menu}=opening(t,{items:offered().filter(i=>i.key!=='Start a new dossier')});
  assert.equal(menu.root.querySelector('.palette-pair'),null);
  assert.ok(menu.root.querySelector('.palette-rows').querySelectorAll('button').some(b=>b.textContent==='Start a topic from this'));
});
test('1091 all arrows and Home/End cover rendered buttons; focusKey also targets a footer act',t=>{
  const calls=[],items=offered().map(i=>({...i,act:()=>calls.push(i.key)}));items.push(item('undo','Undo','undo',{keys:'⌘Z',disabled:true}));
  const {menu,doc}=opening(t,{items}),order=buttons(menu.root).filter(b=>!b.disabled);
  assert.equal(doc.activeElement.getAttribute('aria-label'),'Ask for update');
  key(menu.root,'Home');assert.equal(doc.activeElement,order[0]);
  for(let n=1;n<order.length;n++){key(menu.root,n%2?'ArrowRight':'ArrowDown');assert.equal(doc.activeElement,order[n]);}
  key(menu.root,'End');assert.equal(doc.activeElement,order.at(-1));
  key(menu.root,'ArrowRight');assert.equal(doc.activeElement,order[0]);
  key(menu.root,'ArrowLeft');assert.equal(doc.activeElement,order.at(-1));
  key(menu.root,'ArrowUp');assert.equal(doc.activeElement,order.at(-2));assert.deepEqual(calls,[]);menu.close(false);
  const second=opening(t,{items,focusKey:'move-up'});assert.equal(second.doc.activeElement.getAttribute('aria-label'),'Move its stack up');
  press(second.doc.activeElement);assert.deepEqual(calls,['move-up']);
});
test('1091 dossier marks show offered state; remote read pair keeps only its first action; Reader extras stay',t=>{
  const calls=[],items=[item('star','Unstar','starred'),item('aside','Bring back','back',{keys:'⌘→'}),
    item('Mark read','Mark read','read',{act:()=>calls.push('read')}),item('Mark unread','Mark unread','unread',{act:()=>calls.push('unread')}),
    item('Copy Link'),item('level','Show all messages','all'),item('Wide layout','Wide layout','layout'),item('Quote selection','Quote selection','quote')];
  const {menu}=opening(t,{items}),marks=menu.root.querySelector('.palette-marks');
  assert.ok(marks);assert.deepEqual(buttons(marks).map(b=>b.getAttribute('aria-pressed')),['true','true','true',null]);
  assert.deepEqual(names(menu.root.querySelector('.palette-rows')),['Wide layout','Quote selection']);
  assert.equal(menu.root.querySelector('.palette-keys').text.includes('all'),true);
  press(buttons(marks).find(b=>b.getAttribute('aria-label')==='Mark read'));assert.deepEqual(calls,['read']);
});
test('1091 other-label menus retain flat item order, glyphs, checkbox and requested focus for Notebook wrappers',t=>{
  for(const label of ['This page','This card','This topic','Archived dossier']) {
    const items=[item('rename','Rename','pencil'),item('editing','Editing','pencil',{checked:true})];
    const {menu,doc}=opening(t,{items,label,focusKey:'editing'});
    assert.equal(menu.root.classList.contains('menu-palette'),false);assert.deepEqual(menu.root.children.map(b=>b.textContent),['Rename','Editing']);
    assert.equal(menu.root.children[1].getAttribute('aria-checked'),'true');assert.equal(doc.activeElement,menu.root.children[1]);menu.close(false);
  }
});
