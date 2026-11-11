import { recoveryReadOnly } from './upload-state.mjs';
import { lineMove } from './line-move.mjs';

// Whether the page runs on a Mac, where ⌘ is the command key and Ctrl-A moves
// to the start of a line; elsewhere Ctrl is the command key.
export const onMac = (nav = globalThis.navigator) => /mac|iphone|ipad|ipod/i.test(nav?.userAgentData?.platform || nav?.platform || '');
// Select All: ⌘A on a Mac, Ctrl-A elsewhere, with no other modifier. A is the
// key the layout names A; on a layout with no Latin letters, it is the key in
// A's place, as the browser's own shortcut takes it.
const latinLetter = key => /^[a-z]$/i.test(key ?? '');
export const selectAllKey = (event, mac) => (latinLetter(event.key) ? event.key.toLowerCase() === 'a' : event.code === 'KeyA') && !event.altKey && !event.shiftKey &&
  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

// A field the person types words into: a textarea, an editable element, or an
// input that takes typed text. A checkbox, radio, button, range, colour or
// file control is not, nor is a select: those are pressed, not typed in.
const TYPED_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);
export const typingField = node => Boolean(node && (node.tagName === 'TEXTAREA' || node.isContentEditable || node.tagName === 'INPUT' && TYPED_INPUTS.has(node.type)));

// Textarea interaction only. Editor and EditorSession own writing and its acts;
// the surface keeps context-level send, quote, note and focus routing. A
// surface without an Editor, as the cards page's box is, gives none, and its
// field alone holds what is written.
export class WritingInput {
  constructor({field,editor=null,admits=()=>true,readOnly=()=>false,beforeEdit=()=>{},changed=()=>{},mac=onMac()}) {
    Object.assign(this,{field,currentEditor:editor??(()=>null),editorless:!editor,admits,surfaceReadOnly:readOnly,beforeEdit,changed,mac});
    // Each line move as the field's Undo has it: Undo of a move puts the
    // cursor back where it was (the browser would select both blocks), Redo
    // where the move left it. Any other edit ends what Redo could bring back.
    this.moves={done:[],at:0};
    field.addEventListener('input',event=>{
      const moves=this.moves,back=event.inputType==='historyUndo'&&moves.done[moves.at-1],again=event.inputType==='historyRedo'&&moves.done[moves.at];
      if(back&&field.value===back.before){moves.at--;field.setSelectionRange(back.start,back.end);}
      else if(again&&field.value===again.after){moves.at++;field.setSelectionRange(again.movedStart,again.movedEnd);}
      else if(!this.moving&&!['historyUndo','historyRedo'].includes(event.inputType))moves.done.length=moves.at;
    });
    if(!editor)return;
    field.addEventListener('input',()=>{
      const current=this.currentEditor();
      if(this.readOnly()) { if(current)field.value=current.draft.body;return; }
      this.beforeEdit();current.edit({body:field.value,caret:this.caret()});this.changed(current);
    });
    field.addEventListener('select',()=>{
      const current=this.currentEditor();
      if(current&&this.admits())current.draft.caret=this.caret();
    });
  }
  caret() { return {start:this.field.selectionStart,end:this.field.selectionEnd}; }
  readOnly() {
    const editor=this.currentEditor();
    if(this.editorless)return Boolean(!this.admits()||this.field.readOnly||this.surfaceReadOnly());
    return Boolean(!editor||!this.admits()||this.field.readOnly||editor.adopting||recoveryReadOnly(editor)||this.surfaceReadOnly());
  }
  insertText(text) {
    if(this.readOnly())return;
    // Native insertion keeps the browser's Undo history, including deletions.
    if(!this.field.ownerDocument.execCommand('insertText',false,text)) {
      this.field.setRangeText(text,this.field.selectionStart,this.field.selectionEnd,'end');
      this.field.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }
  terminalKey(event) {
    if(this.readOnly()||event.isComposing||event.keyCode===229)return false;
    if(!event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!['w','u','k','a','e'].includes(event.key))return false;
    // Off a Mac, Ctrl-A is Select All, which the field does natively: its own text, nothing else.
    if(event.key==='a'&&!this.mac)return false;
    const value=this.field.value,start=this.field.selectionStart,end=this.field.selectionEnd;
    const lineStart=value.lastIndexOf('\n',start-1)+1;
    const at=value.indexOf('\n',end),lineEnd=at<0?value.length:at;
    event.preventDefault();
    if(event.key==='a'||event.key==='e') {
      const point=event.key==='a'?lineStart:lineEnd;this.field.setSelectionRange(point,point);return true;
    }
    const from=event.key==='u'?lineStart:event.key==='w'?start-(value.slice(lineStart,start).match(/\S+\s*$|\s+$/)?.[0].length??0):start;
    const to=event.key==='k'?lineEnd:end;
    this.field.setSelectionRange(from,to);this.deleteSelection();return true;
  }
  // ⌥↑ and ⌥↓ (Alt elsewhere): the line, list item or paragraph the cursor is
  // on, or those selected, moved past its neighbour (line-move.mjs), as one
  // edit the field's Undo takes back. Where nothing can move, the key is the
  // browser's. A phone's keyboard has no such key; a hardware keyboard on a
  // tablet sends it as any other does.
  moveKey(event) {
    if(!event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||event.isComposing||event.keyCode===229||event.defaultPrevented)return false;
    if(!['ArrowUp','ArrowDown'].includes(event.key)||this.readOnly())return false;
    const field=this.field,value=field.value,start=field.selectionStart,end=field.selectionEnd;
    const move=lineMove(value,start,end,event.key==='ArrowDown'?1:-1);
    if(!move)return false;
    event.preventDefault();
    field.setSelectionRange(move.from,move.to);
    this.moving=true;
    try{this.insertText(move.text);}finally{this.moving=false;}
    if(field.value===value){field.setSelectionRange(start,end);return true;}
    field.setSelectionRange(move.start,move.end);
    const current=this.currentEditor();if(current&&this.admits())current.draft.caret=this.caret();
    const moves=this.moves;moves.done.length=moves.at;
    moves.done.push({before:value,after:field.value,start,end,movedStart:move.start,movedEnd:move.end});moves.at=moves.done.length;
    return true;
  }
  // Every key the writing itself answers before the surface's own keys.
  writingKey(event) { return this.terminalKey(event)||this.moveKey(event); }
  deleteSelection() {
    if(this.readOnly()||this.field.selectionStart===this.field.selectionEnd)return;
    // Chrome's delete command keeps native Undo without the stray line-break
    // placeholder that insertText('') leaves when the text then ends in a
    // newline; after Undo that placeholder shifts every later selection by one.
    if(!this.field.ownerDocument.execCommand('delete'))this.insertText('');
  }
}
