// Native observation policy only; these inert boxes do not claim real geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {misglyphed,misdrawn,misplaced,approved} from './menu_glyphs.mjs';

const check=row=>[...misglyphed([row]),...misdrawn([row]),...misplaced([row])];
const target={left:0,right:44,top:0,bottom:44,width:44,height:44};
function mark() {
  return {menu:'This message',kind:'mark',key:'aside',label:'Archive',keys:'⌘→',text:'',ariaLabel:'Archive ⌘→',title:'Archive ⌘→',
    pressed:'false',checked:'false',coarse:true,glyphs:['archive'],hidden:'true',seen:true,colour:'rgb(1, 2, 3)',ink:'rgb(1, 2, 3)',
    glyph:{left:13,right:31,top:13,bottom:31,width:18,height:18},row:target,words:null,drawing:approved('archive'),draws:true,sources:{archive:approved('archive')}};
}
function key() {
  return {menu:'This message',kind:'key',key:'move-up',label:'Move its stack up',keys:'⌘↑',text:'⌘↑',ariaLabel:'Move its stack up',title:'Move its stack up',coarse:true,glyphs:[],row:target};
}
test('1091 native glyph policy checks icon-only marks, offered states and actual centred drawing',()=>{
  assert.deepEqual(check(mark()),[]);
  for(const change of [{glyphs:[]},{drawing:approved('pencil')},{pressed:'true'},{ariaLabel:'Archive'},
    {glyph:{left:0,right:18,top:0,bottom:18,width:18,height:18}},{row:{...target,height:20}}])assert.ok(check({...mark(),...change}).length,JSON.stringify(change));
});
test('1091 native glyph policy permits only named real key/start captions with44px coarse targets',()=>{
  assert.deepEqual(check(key()),[]);
  const start={...key(),kind:'start',key:'Start a new dossier',label:'Start a new dossier',ariaLabel:'Start a new dossier',title:'Start a new dossier',text:'Dossier'};
  assert.deepEqual(check(start),[]);
  for(const change of [{key:'Retract'},{glyphs:['up']},{ariaLabel:''},{title:'other'},{text:''},{row:{...target,height:20}}])assert.ok(check({...key(),...change}).length,JSON.stringify(change));
  assert.ok(check({...start,label:'Start a topic from this',ariaLabel:'Start a topic from this',title:'Start a topic from this'}).length,'one start cannot masquerade as the other');
  assert.ok(check({...key(),menu:'This page'}).length,'the message exception cannot remove a Notebook glyph');
});
