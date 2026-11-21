import test from 'node:test';
import assert from 'node:assert/strict';
import { pencilKey } from '../web/pencil-keys.mjs';

function fixture() {
  const calls = [], outside = { closest: () => null };
  const field = { closest: () => field, selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward',
    focus() { doc.activeElement = field; }, setSelectionRange(start, end, direction) { Object.assign(field, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); } };
  const pills = { message: { closest: () => null }, 'note-card': { closest: () => null } };
  const doc = { activeElement: field, querySelector: () => null };
  const composer = { root: { ownerDocument: doc, hidden: false, isConnected: true, contains: node => node === field || Object.values(pills).includes(node) },
    sheet: { open: false, classList: { contains: () => false } }, field, callbacks: { notebook: { mayWrite: true } },
    kinds: ['message', 'note-card'], $: name => pills[name.replace('kind-', '')],
    admits: () => true, pageBusy: () => false, kind: 'message', noteTarget: 'kept-page',
    pop() { calls.push('pop'); composer.sheet.open = true; composer.noteTarget = ''; field.setSelectionRange(99, 99, 'none'); },
    chooseKind(kind) { calls.push(kind); composer.kind = kind; return true; }, send() { calls.push('send'); } };
  function press(extra = {}) {
    const event = { key: 'Enter', code: 'Enter', target: doc.activeElement, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    return { used: pencilKey(event, composer), event };
  }
  return { calls, composer, field, pills, doc, outside, press };
}

for(const shape of [{key:'Dead',code:'KeyN',keyCode:229},{key:'µ',code:'KeyM',keyCode:77,isComposing:true}])test('1032 modal owned '+JSON.stringify(shape),()=>{
 const f=fixture();f.composer.sheet.open=true;f.composer.kind=shape.code==='KeyN'?'message':'note-card';
 const {used,event}=f.press({...shape,altKey:true});assert.equal(used,true);assert.equal(event.defaultPrevented,true);
 assert.equal(f.composer.kind,shape.code==='KeyN'?'note-card':'message');assert.deepEqual([f.field.selectionStart,f.field.selectionEnd],[2,5]);
});
for(const shape of [{key:'a',code:'KeyA',keyCode:229},{key:'Dead',code:'KeyN',keyCode:229},{key:'µ',code:'KeyM',keyCode:77}])test('1032 unrelated composition '+JSON.stringify(shape),()=>{
 const f=fixture();const {used,event}=f.press({...shape,isComposing:true});assert.equal(used,false);assert.equal(event.defaultPrevented,undefined);assert.deepEqual(f.calls,[]);
});
test('1032 held modal chord consumes without changing mode',()=>{const f=fixture();f.composer.sheet.open=true;f.composer.admits=()=>false;const {used,event}=f.press({altKey:true,key:'Dead',code:'KeyN',keyCode:229});assert.equal(used,true);assert.equal(event.defaultPrevented,true);assert.deepEqual(f.calls,[]);});

for(const shape of [{key:'Dead',code:'KeyN',keyCode:229},{key:'µ',code:'KeyM',keyCode:77,isComposing:true}])test('1032 another text owner keeps its composing '+shape.code,()=>{
 const f=fixture(), other={closest(){return this;}};f.doc.activeElement=other;
 const {used,event}=f.press({...shape,altKey:true,target:other});assert.equal(used,false);assert.equal(event.defaultPrevented,undefined);assert.deepEqual(f.calls,[]);
});

test('1032 Dead229 outside text opens the sheet before its dead key can follow focus',()=>{
 const f=fixture();f.doc.activeElement=f.outside;
 const {used,event}=f.press({key:'Dead',code:'KeyN',keyCode:229,altKey:true});assert.equal(used,true);assert.equal(event.defaultPrevented,true);assert.equal(f.composer.sheet.open,true);assert.equal(f.composer.kind,'note-card');
});
