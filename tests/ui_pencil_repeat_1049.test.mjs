// Explicit synthetic Mac-tail models. These do not establish an OS input-method result.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as keys from '../web/pencil-keys.mjs';
function fixture({start=2,end=6}={}) {
 const listen=()=>{const rows=[];return{rows,addEventListener:(n,fn,c)=>rows.push([n,fn,Boolean(c)]),removeEventListener:(n,fn,c)=>{const at=rows.findIndex(r=>r[0]===n&&r[1]===fn&&r[2]===Boolean(c));if(at>=0)rows.splice(at,1);},emit(n,e={}){const event={target:this,...e};for(const capture of [true,false])for(const [name,fn,c]of [...rows])if(name===n&&c===capture)fn(event);}};};
 const doc=listen();doc.body={};doc.querySelector=()=>null;
 let now=0,blurs=0,focuses=0;const field=Object.assign(listen(),{value:'ab🙂keep-end',selectionStart:start,selectionEnd:end,selectionDirection:'backward',readOnly:false,closest(){return this;},focus(){focuses++;doc.activeElement=this;},blur(){blurs++;doc.activeElement=doc.body;this.emit('blur');},setSelectionRange(start,end,direction){Object.assign(this,{selectionStart:start,selectionEnd:end,selectionDirection:direction});}});doc.activeElement=field;
 const composer={field,root:{ownerDocument:doc,isConnected:true,hidden:false,contains:n=>n===field},sheet:{open:true,classList:{contains:()=>false}},editor:{id:'first'},presentation:{id:'first'},callbacks:{notebook:{mayWrite:true}},kind:'message',noteTarget:'kept-page',admits:()=>true,pageBusy:()=>false,chooseKind(kind){this.kind=kind;return true;},send(){throw Error('not a Send case');}};
 if(keys.PencilInput)composer.pencilInput=new keys.PencilInput(composer,{now:()=>now});
 const seen=[];field.addEventListener('input',()=>seen.push({value:field.value,start:field.selectionStart,end:field.selectionEnd}));
 const press=(code='KeyN',extra={})=>{const e={key:code==='KeyN'?'Dead':'µ',code,keyCode:229,isComposing:true,altKey:true,target:field,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};return{used:keys.pencilKey(e,composer),event:e};};
 const before=()=>({value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection});
 const put=(glyph,type='insertCompositionText')=>{const start=field.selectionStart,end=field.selectionEnd;field.value=field.value.slice(0,start)+glyph+field.value.slice(end);field.setSelectionRange(start+glyph.length,start+glyph.length,'none');field.emit('input',{data:glyph,inputType:type});};
 return{doc,field,composer,seen,press,before,put,time:n=>now=n,counts:()=>({blurs,focuses})};
}
for(const [code,glyph]of [['KeyN','\u02dc'],['KeyN','~'],['KeyN','\u0303'],['KeyM','µ']])for(const selection of [false,true])test(`1049 synthetic second-press ${code}/${glyph.codePointAt(0).toString(16)} selected=${selection} restores exact writing before writer`,()=>{
 const f=fixture(selection?{}:{start:4,end:4}),before=f.before();f.press(code);f.field.emit('compositionstart',{data:''});f.field.emit('compositionupdate',{data:glyph});f.field.emit('compositionend',{data:glyph});f.put(glyph);
 assert.deepEqual(f.before(),before);assert.equal(f.composer.kind,code==='KeyN'?'note-card':'message');assert.equal(f.composer.noteTarget,'kept-page');assert.equal(f.seen.at(-1).value,before.value);
});
test('1049 owned chord drops pending input state in the same turn and restores selection',()=>{const f=fixture(),before=f.before();f.press();assert.equal(f.counts().blurs,1);assert.equal(f.counts().focuses>=1,true);assert.deepEqual(f.before(),before);assert.equal(f.doc.activeElement,f.field);});
test('1049 an owned provisional input and its later final commit are both corrected',()=>{const f=fixture(),before=f.before();f.press();f.field.emit('compositionstart',{data:''});f.put('~');assert.deepEqual(f.before(),before);f.time(5000);f.field.emit('compositionend',{data:'~'});f.put('~');assert.deepEqual(f.before(),before);assert.ok(f.seen.every(x=>x.value===before.value));});
test('1049 repeated chords and chords after ordinary typing retain all valid writing',()=>{const f=fixture({start:4,end:4});for(let i=0;i<50;i++){const before=f.before();f.press(i%2?'KeyM':'KeyN');f.put(i%2?'µ':'~','insertText');assert.deepEqual(f.before(),before);}f.field.emit('keydown',{key:'x',code:'KeyX'});f.put('x','insertText');const before=f.before();f.press();f.put('\u02dc');assert.deepEqual(f.before(),before);});
for(const [label,type,data,key]of [['typed tilde','insertText','~','Backquote'],['typed micro','insertText','µ','KeyM'],['paste','insertFromPaste','µ',null],['other composition','insertCompositionText','保持',null],['undo','historyUndo','~',null]])test('1049 keeps ordinary '+label,()=>{const f=fixture({start:4,end:4});f.press();if(key)f.field.emit('keydown',{key,code:key});const value=f.field.value;f.put(data,type);assert.equal(f.field.value,value.slice(0,4)+data+value.slice(4));});
for(const kind of ['expired','editor','presentation','external-blur','pointer','disposed','read-only','changed-body'])test('1049 declines a stale or unowned tail: '+kind,()=>{
 const f=fixture({start:4,end:4});f.press();if(kind==='expired')f.time(501);if(kind==='editor')f.composer.editor={};if(kind==='presentation')f.composer.presentation={};if(kind==='external-blur')f.field.blur();if(kind==='pointer')f.doc.emit('pointerdown');if(kind==='disposed')f.composer.pencilInput?.dispose();if(kind==='read-only')f.field.readOnly=true;if(kind==='changed-body')f.field.value+='new';
 const before=f.field.value;f.put('~');assert.equal(f.field.value,before.slice(0,4)+'~'+before.slice(4));
});
test('1049 another text owner is never blurred or armed',()=>{const f=fixture(),other={closest(){return this;}};f.doc.activeElement=other;const before=f.before();assert.equal(f.press('KeyN',{target:other}).used,false);assert.equal(f.counts().blurs,0);assert.deepEqual(f.before(),before);});
test('1049 held pencil mode still consumes its own residue without changing mode',()=>{const f=fixture(),before=f.before();f.composer.pageBusy=()=>true;assert.equal(f.press().used,true);f.put('~');assert.deepEqual(f.before(),before);assert.equal(f.composer.kind,'message');});
test('1049 disposal removes every owned listener and saved tail',()=>{const f=fixture();assert.ok(f.composer.pencilInput);f.press();f.composer.pencilInput.dispose();assert.equal(f.doc.rows.length,0);assert.equal(f.field.rows.length,1,'only the ordinary writer remains');});
test('1049 a benign composition commit during blur keeps its valid words and still switches mode',()=>{
 const f=fixture({start:4,end:4}),blur=f.field.blur.bind(f.field);f.field.blur=()=>{blur();f.put('保持','insertCompositionText');};
 f.press();assert.equal(f.composer.kind,'note-card');assert.equal(f.field.value,'ab🙂保持keep-end');assert.equal(f.doc.activeElement,f.field);
});
test('1049 a source/focus handoff during blur is not reclaimed by the old chord',()=>{
 const f=fixture(),other={},blur=f.field.blur.bind(f.field),before=f.before();f.field.blur=()=>{blur();f.composer.editor={id:'new'};f.doc.activeElement=other;};
 assert.equal(f.press().used,true);assert.equal(f.composer.kind,'message');assert.equal(f.doc.activeElement,other);assert.equal(f.counts().focuses,0);assert.deepEqual(f.before(),before);
});
test('1049 a global nontext first chord arms after the sheet receives focus',()=>{
 const f=fixture(),outside={closest:()=>null},before=f.before();f.doc.activeElement=outside;f.composer.sheet.open=false;f.composer.pop=()=>{f.composer.sheet.open=true;f.field.focus();f.field.setSelectionRange(99,99,'none');};
 assert.equal(f.press('KeyN',{target:outside}).used,true);f.put('~');assert.deepEqual(f.before(),before);assert.equal(f.composer.kind,'note-card');
});
