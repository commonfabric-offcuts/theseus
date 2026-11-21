import test from 'node:test';
import assert from 'node:assert/strict';
import { retainTouchSendFocus } from '../web/compose-bar.mjs';

function fixture() {
  const handlers=new Map(),doc={},field={ownerDocument:doc,disabled:false,readOnly:false};doc.activeElement=field;
  const send={disabled:false,addEventListener:(type,fn)=>handlers.set(type,fn)};
  retainTouchSendFocus(send,field);
  const emit=(type,extra={})=>{const event={button:0,isPrimary:true,pointerType:'touch',prevented:false,preventDefault(){this.prevented=true;},...extra};handlers.get(type)?.(event);return event;};
  return {send,field,doc,emit};
}
test('a touch keeps pointerdown native and suppresses only compatibility mousedown focus transfer',()=>{
 const f=fixture();assert.equal(f.emit('pointerdown').prevented,false);assert.equal(f.emit('mousedown').prevented,true);assert.equal(f.emit('mousedown').prevented,false,'one compatibility mouse phase');
});
test('a laptop mouse press and a keyboard click take no focus precaution',()=>{
 const f=fixture();f.emit('pointerdown',{pointerType:'mouse'});assert.equal(f.emit('mousedown').prevented,false);assert.equal(f.emit('click').prevented,false);
});
test('cancelled touch and a later real mouse press cannot retain an earlier touch',()=>{
 const f=fixture();f.emit('pointerdown');f.emit('pointercancel');assert.equal(f.emit('mousedown').prevented,false);
 f.emit('pointerdown');f.emit('pointerdown',{pointerType:'mouse'});assert.equal(f.emit('mousedown').prevented,false);
});
for(const state of ['disabled-send','disabled-field','readonly','other-focus','secondary-pointer','other-button'])test('no focus precaution for '+state,()=>{
 const f=fixture();let event={};if(state==='disabled-send')f.send.disabled=true;if(state==='disabled-field')f.field.disabled=true;
 if(state==='readonly')f.field.readOnly=true;if(state==='other-focus')f.doc.activeElement={};if(state==='secondary-pointer')event.isPrimary=false;if(state==='other-button')event.button=2;
 f.emit('pointerdown',event);assert.equal(f.emit('mousedown').prevented,false);
});
test('field ownership and availability are checked again at the mouse phase',()=>{
 const f=fixture();f.emit('pointerdown');f.field.readOnly=true;assert.equal(f.emit('mousedown').prevented,false);
 f.field.readOnly=false;f.emit('pointerdown');f.doc.activeElement={};assert.equal(f.emit('mousedown').prevented,false);
});
