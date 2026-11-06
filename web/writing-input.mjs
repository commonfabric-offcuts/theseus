import { recoveryReadOnly } from './upload-state.mjs';

// Whether the page runs on a Mac, where ⌘ is the command key and Ctrl-A moves
// to the start of a line; elsewhere Ctrl is the command key.
export const onMac = (nav = globalThis.navigator) => /mac|iphone|ipad|ipod/i.test(nav?.userAgentData?.platform || nav?.platform || '');

// Textarea interaction only. Editor and EditorSession own writing and its acts;
// the surface keeps context-level send, quote, note and focus routing.
export class WritingInput {
  constructor({field,editor,admits,readOnly=()=>false,beforeEdit=()=>{},changed=()=>{},mac=onMac()}) {
    Object.assign(this,{field,currentEditor:editor,admits,surfaceReadOnly:readOnly,beforeEdit,changed,mac});
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
  deleteSelection() {
    if(this.readOnly()||this.field.selectionStart===this.field.selectionEnd)return;
    // Chrome's delete command keeps native Undo without the stray line-break
    // placeholder that insertText('') leaves when the text then ends in a
    // newline; after Undo that placeholder shifts every later selection by one.
    if(!this.field.ownerDocument.execCommand('delete'))this.insertText('');
  }
}
