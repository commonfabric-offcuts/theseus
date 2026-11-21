import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionQuery, mentionChoices, MentionPick } from '../web/mention-pick.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { addressedTo } from '../web/at-names.mjs';

test('a token at the caret opens anywhere outside a word, email or URL', () => {
  for (const prefix of ['', 'Hello ', 'one\n', '(', '[', '{', 'Hello,']) {
    const value=prefix+'@Al';
    assert.deepEqual(mentionQuery(value,value.length),{start:prefix.length,end:value.length,filter:'al'});
  }
  for (const value of ['mail@al','a.b@al','é@al','https://host/@al','@@al','@al done','@al/']) assert.equal(mentionQuery(value,value.length),null,value);
  assert.equal(mentionQuery('@alice',2,4),null,'selected text is not a completion');
  assert.deepEqual(mentionQuery('Keep @alZZ after',8),{start:5,end:10,filter:'al'});
});

test('enabled members match by name or ID, duplicate names retain distinct IDs', () => {
  const members=[{id:'alpha',name:'Shared'},{id:'beta',name:'Shared'},{id:'alpha'}, {id:'off',name:'Shared',enabled:false}];
  assert.deepEqual(mentionChoices(members,'shared').map(x=>x.id),['alpha','beta']);
  assert.deepEqual(mentionChoices(members,'LP').map(x=>x.id),[],'query supplies lowercase');
  assert.deepEqual(mentionChoices(members,'lp').map(x=>x.id),[],'999 matches prefixes, not interior letters');
  assert.deepEqual(mentionChoices(members,'missing'),[]);
});

function fixture() {
  const doc=miniDocument(),field=doc.createElement('textarea'),host=doc.createElement('div');host.append(field);
  field.id='writing';field.ownerDocument=doc;field.after=node=>host.append(node);
  field.setSelectionRange=(start,end)=>{field.selectionStart=start;field.selectionEnd=end;};
  field.removeEventListener=(type,handler)=>{if(field.listeners[type]===handler)delete field.listeners[type];};
  const state={admitted:true,members:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}],edits:[]};
  const picker=new MentionPick({field,members:()=>state.members,admits:()=>state.admitted,insert:text=>{
    const start=field.selectionStart;field.value=field.value.slice(0,start)+text+field.value.slice(field.selectionEnd);
    field.setSelectionRange(start+text.length,start+text.length);state.edits.push(field.value);picker.update();
  }});
  const type=(value,caret=value.length)=>{field.value=value;field.setSelectionRange(caret,caret);picker.update();};
  const key=(key,extra={})=>{const event={key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};return {event,handled:picker.key(event)};};
  return {field,doc,host,state,picker,type,key};
}

test('keys select, Return replaces only the token, and completion keeps the field focused', () => {
  const f=fixture();f.type('Before @zz after',8);
  assert.equal(f.picker.open,true);assert.equal(f.key('ArrowDown').handled,true);
  assert.equal(f.field.getAttribute('aria-activedescendant'),'writing-mentions-1');
  const picked=f.key('Enter');assert.ok(picked.handled&&picked.event.prevented&&picked.event.stopped);
  assert.equal(f.field.value,'Before @beta after');assert.deepEqual(f.state.edits,['Before @beta after']);
  assert.equal(f.doc.activeElement,f.field);assert.equal(f.picker.open,false);
  assert.equal(f.field.getAttribute('aria-activedescendant'),null);
});

test('Escape changes no writing; no-match Return and modified/IME keys remain native', () => {
  const f=fixture();f.type('Keep @a');assert.equal(f.key('Escape').handled,true);assert.equal(f.field.value,'Keep @a');
  for(const extra of [{isComposing:true},{keyCode:229},{metaKey:true},{ctrlKey:true},{altKey:true},{shiftKey:true}]) {
    f.type('@a');assert.equal(f.key('Enter',extra).handled,false);assert.equal(f.field.value,'@a');
  }
  f.type('@unknown');assert.equal(f.key('Enter').handled,false);assert.deepEqual(f.state.edits,[]);
});

test('click choice validates current membership and editability before inserting', () => {
  for(const block of [f=>f.state.admitted=false,f=>f.field.disabled=true,f=>f.state.members=[]]) {
    const f=fixture();f.type('Ask @');const row=f.picker.list.children[0];block(f);row.onclick();
    assert.equal(f.field.value,'Ask @');assert.deepEqual(f.state.edits,[]);assert.equal(f.picker.open,false);
  }
  const f=fixture();f.type('Ask @');f.picker.list.children[0].onclick();assert.equal(f.field.value,'Ask @alpha ');
});

test('composition, context closure and disposal dismiss without stealing other picker ARIA', () => {
  const f=fixture();f.type('@a');f.field.listeners.compositionstart();assert.equal(f.picker.open,false);
  f.type('@b');assert.equal(f.picker.open,false);f.field.listeners.compositionend();assert.equal(f.picker.open,true);
  f.field.setAttribute('aria-controls','images');f.field.setAttribute('aria-activedescendant','image-1');
  f.picker.close();assert.equal(f.field.getAttribute('aria-activedescendant'),'image-1');
  f.type('@a');f.picker.dispose();assert.equal(f.picker.list.parent,null);assert.deepEqual(f.field.listeners,{});
});

test('leading completion retains recipient precedence; a middle mention leaves explicit recipients alone', () => {
  const f=fixture();f.type('Ask @b');f.picker.pick('beta');
  assert.deepEqual(addressedTo(f.field.value,f.state.members,['alpha']),['alpha']);
  f.type('@b');f.picker.pick('beta');assert.deepEqual(addressedTo(f.field.value,f.state.members,['alpha']),['beta']);
});

test('999 ID and display-name prefixes match case-insensitively, with no interior matches',()=>{
  const members=[{id:'alpha',name:'Guide'},{id:'beta',name:'ALbert'},{id:'al-off',enabled:false},{id:'alpha',name:'Other'}];
  assert.deepEqual(mentionChoices(members,'AL').map(p=>p.id),['alpha','beta']);
  assert.deepEqual(mentionChoices(members,'gu').map(p=>p.id),['alpha']);
  assert.deepEqual(mentionChoices(members,'uid'),[]);
  assert.deepEqual(mentionChoices(members,'lp'),[]);
});

test('999 Tab and Return complete the highlighted name once, preserving the suffix and focus',()=>{
  for(const key of ['Tab','Enter']){
    const f=fixture();f.type('Before @zz after',8);f.key('ArrowDown');
    const picked=f.key(key);assert.equal(picked.handled,true,key);
    assert.equal(picked.event.prevented,true);assert.equal(picked.event.stopped,true);
    assert.equal(f.field.value,'Before @beta after');assert.deepEqual(f.state.edits,['Before @beta after']);
    assert.equal(f.doc.activeElement,f.field);assert.equal(f.picker.open,false);
    assert.equal(f.field.getAttribute('aria-activedescendant'),null);
    const plain=fixture();plain.type('Ask @a');plain.key(key);assert.equal(plain.field.value,'Ask @alpha ');
  }
});

test('999 no match closes the list and matching edits reopen it without changing writing',()=>{
  const f=fixture();f.type('Ask @a');assert.equal(f.picker.open,true);
  f.type('Ask @az');assert.equal(f.picker.open,false);assert.equal(f.field.getAttribute('aria-expanded'),'false');
  assert.equal(f.key('Tab').handled,false);assert.equal(f.key('Enter').handled,false);
  assert.equal(f.field.value,'Ask @az');assert.deepEqual(f.state.edits,[]);
  f.type('Ask @AL');assert.equal(f.picker.open,true);f.key('Tab');assert.equal(f.field.value,'Ask @alpha ');
});

test('999 closed, modified and composing Tab retains the native key',()=>{
  for(const extra of [{shiftKey:true},{metaKey:true},{ctrlKey:true},{altKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true}]){
    const f=fixture();f.type('Ask @a');assert.equal(f.key('Tab',extra).handled,false);assert.deepEqual(f.state.edits,[]);
  }
  const f=fixture();f.type('Ask @a');f.key('Escape');assert.equal(f.key('Tab').handled,false);assert.equal(f.field.value,'Ask @a');
});
