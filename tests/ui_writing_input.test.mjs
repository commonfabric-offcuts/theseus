import test from 'node:test';
import assert from 'node:assert/strict';
import { WritingInput, typingField } from '../web/writing-input.mjs';

function fixture(value='zero\none two\nlast') {
  const events=[],handlers={},editor={draft:{body:value},localVersion:0,submissions:[],edit(patch){Object.assign(this.draft,patch);events.push('edit');}};
  let admitted=true;
  const field={value,selectionStart:12,selectionEnd:12,readOnly:false,
    addEventListener:(name,fn)=>handlers[name]=fn,
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length);},
    dispatchEvent(event){handlers[event.type]?.(event);},
    ownerDocument:{execCommand(command,_ui,text){assert.ok(['insertText','delete'].includes(command));field.setRangeText(command==='delete'?'':text,field.selectionStart,field.selectionEnd);handlers.input();return true;}}};
  const input=new WritingInput({field,mac:true,editor:()=>editor,admits:()=>admitted,beforeEdit:()=>events.push('before'),changed:()=>events.push('changed')});
  const key=(name,extra={})=>{const event={key:name,ctrlKey:true,prevented:false,preventDefault(){this.prevented=true;},...extra};const result=input.terminalKey(event);return {result,event};};
  return {field,editor,handlers,events,input,key,deny:()=>admitted=false};
}
for(const [key,start,end,body,caret] of [
  ['w',12,12,'zero\none \nlast',9],['u',12,12,'zero\n\nlast',5],['k',9,9,'zero\none \nlast',9],
  ['a',9,9,'zero\none two\nlast',5],['e',9,9,'zero\none two\nlast',12],
  ['w',9,12,'zero\n\nlast',5],['u',7,10,'zero\nwo\nlast',5],
]) test(`shared Ctrl-${key} preserves Reader line/selection behavior at ${start}:${end}`,()=>{
  const f=fixture();f.field.setSelectionRange(start,end);const {result,event}=f.key(key);
  assert.equal(result,true);assert.equal(event.prevented,true);assert.equal(f.field.value,body);
  assert.deepEqual([f.field.selectionStart,f.field.selectionEnd],[caret,caret]);
  if(!['a','e'].includes(key)){assert.equal(f.editor.draft.body,body);assert.deepEqual(f.events,['before','edit','changed']);}
  else assert.deepEqual(f.events,[]);
});
test('IME, competing modifiers and non-editing keys retain native routing',()=>{
  for(const extra of [{isComposing:true},{keyCode:229},{metaKey:true},{altKey:true},{shiftKey:true},{ctrlKey:false},{key:'Enter'},{key:'W'}]) {
    const f=fixture(),before=f.field.value,{result,event}=f.key('w',extra);
    assert.equal(result,false);assert.equal(event.prevented,false);assert.equal(f.field.value,before);assert.deepEqual(f.events,[]);
  }
});
test('the read-only union protects direct input and command insertion and restores the field',()=>{
  for(const block of [f=>f.deny(),f=>f.field.readOnly=true,f=>f.editor.adopting=true]) {
    const f=fixture(),before=f.editor.draft.body;block(f);
    assert.equal(f.input.readOnly(),true);assert.equal(f.key('w').result,false);
    f.input.insertText('bad');f.field.value='bad';f.handlers.input();
    assert.equal(f.field.value,before);assert.equal(f.editor.draft.body,before);assert.deepEqual(f.events,[]);
  }
});
test('1044 alternate-copy discovery keeps direct writing and command insertion admitted',()=>{const f=fixture('kept');f.editor.recoveryDiscovery=true;assert.equal(f.input.readOnly(),false);f.field.value='current';f.field.setSelectionRange(7,7);f.handlers.input();f.input.insertText(' writing');assert.equal(f.editor.draft.body,'current writing');});
test('ordinary input and insertion fallback share the same update path',()=>{
  const f=fixture('kept');f.field.value='typed';f.field.setSelectionRange(5,5);f.handlers.input();
  assert.equal(f.editor.draft.body,'typed');assert.deepEqual(f.editor.draft.caret,{start:5,end:5});
  f.field.ownerDocument.execCommand=()=>false;f.input.insertText(' tail');
  assert.equal(f.editor.draft.body,'typed tail');assert.deepEqual(f.editor.draft.caret,{start:10,end:10});
});

test('only a field that takes typed words is a typing field', () => {
  const input = type => ({ tagName: 'INPUT', type, isContentEditable: false });
  for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time'])
    assert.equal(typingField(input(type)), true, type);
  assert.equal(typingField({ tagName: 'TEXTAREA', isContentEditable: false }), true, 'textarea');
  assert.equal(typingField({ tagName: 'DIV', isContentEditable: true }), true, 'an editable element');
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'])
    assert.equal(typingField(input(type)), false, type);
  assert.equal(typingField({ tagName: 'SELECT', isContentEditable: false }), false, 'select');
  assert.equal(typingField({ tagName: 'BUTTON', isContentEditable: false }), false, 'button');
  assert.equal(typingField(null), false, 'nothing in focus');
});
