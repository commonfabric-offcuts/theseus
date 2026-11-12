import { DeckPage } from './deck-page.mjs';
import { applyAct, deckBody, parseDeck, cardText, textCard, findCard } from './deck.mjs';
import { WritingInput } from './writing-input.mjs';
import { NotebookWriting, notebookStore, mergeCardContent } from './notebook-writing.mjs';
import { NotebookImages } from './notebook-images.mjs';
import { ImagePick, paintThumb, readInTurn } from './image-pick.mjs';

// DeckPage supplies the existing card gestures and geometry. This surface
// supplies one body and one saving stream, shared with the Text view.
export class NotebookPage extends DeckPage {
  constructor(options) {
    super(options);
    Object.assign(this, { api: options.api, bootstrap: options.bootstrap, mode: options.mode ?? 'cards' });
    this.views = this.node('div', 'notebook-views'); this.views.setAttribute('role', 'group'); this.views.setAttribute('aria-label', 'Notebook view');
    this.viewButtons = ['text', 'cards'].map(mode => {
      const b=this.node('button','',mode === 'text' ? 'Text' : 'Cards'); b.type='button'; b.onclick=()=>this.switchView(mode); this.views.append(b); return b;
    });
    this.textPanel=this.node('div','notebook-text-panel');
    // A page in the composer has its own ids, beside the full page's (notebook-sheet.mjs).
    const textId='notebook-text'+(options.idSuffix??'');
    const label=this.node('label','sr-only','Notebook writing'); label.htmlFor=textId;
    this.text=this.node('textarea','notebook-text'); this.text.id=textId; this.text.rows=18; this.text.setAttribute('autocomplete','off');
    this.textInput=new WritingInput({field:this.text});
    this.text.addEventListener('input',()=>{
      if(!this.writing || !this.textSeen)return;
      const body=this.text.value,seen=this.textSeen;
      this.writing.edit({body},seen,'text');
      this.textSeen={revision:seen.revision,content:{...seen.content,body}};
    });
    this.text.addEventListener('focus',()=>{if(this.writing)this.writing.active=true;});
    this.text.addEventListener('blur',()=>{if(this.writing)this.writing.active=false;});
    this.textPanel.append(label,this.text);
    this.conflictPanel=this.node('section','notebook-conflict'); this.conflictPanel.hidden=true;
    this.imagePanel=this.node('div','notebook-images'); this.imageRows=this.node('div','notebook-image-rows'); this.imageNodes=new Map();
    this.addImage=this.node('button','','Add image');this.addImage.type='button';
    this.imageFile=this.node('input');this.imageFile.type='file';this.imageFile.accept='image/png,image/jpeg,image/gif,image/webp';this.imageFile.hidden=true;
    this.addImage.onclick=()=>{this.imageFile.value='';this.imageFile.click();};
    this.imageFile.onchange=()=>{if(this.imageFile.files?.[0])this.captureImage(this.imageFile.files[0]);};
    this.imagePanel.append(this.imageRows,this.addImage,this.imageFile);
    this.status.before(this.views); this.status.after(this.conflictPanel,this.imagePanel,this.textPanel);
    this.drawView();
  }
  async load() {
    if (!this.started) {
      this.started=true;
      try {
        this.store=await notebookStore({instance_id:this.bootstrap.instance_id,actor_id:this.bootstrap.actor,item_id:this.item});
      } catch(error) {
        // Another tab owns writing, or storage is unavailable: still let this
        // page be read, without pretending its writing could be saved safely.
        this.unavailable=error.message;
        this.store={get:async()=>null,put:async()=>{},close:()=>{}};
      }
      this.writing=new NotebookWriting({item:this.item,bootstrap:this.bootstrap,api:this.api,store:this.store,changed:()=>this.writingChanged(),
        reconcile:(base,mine,theirs)=>this.mergeIncoming(base,mine,theirs),localActive:()=>Boolean(this.editing&&this.editing.field.value!==this.editing.startedValue)});
      if(this.unavailable)this.writing.readOnly=true;
      await this.writing.open();
      globalThis.addEventListener('pagehide',()=>{this.writing.close();this.writing.serial.finally(()=>this.store.close());},{signal:this.listening.signal});
      globalThis.addEventListener('pageshow',event=>{if(event.persisted)globalThis.location.reload();},{signal:this.listening.signal});
    } else {
      if(this.writing.running){
        if(!this.refreshOwed){this.refreshOwed=true;this.writing.running.finally(()=>{this.refreshOwed=false;if(!this.writing.closed)this.load().catch(error=>{this.writing.error=error.message;this.writingChanged();});});}
        return true;
      }
      if(this.writing.pending&&!this.writing.running)await this.writing.flush();
      if(!this.writing.base)await this.writing.refresh();
      else {
        const notebook=(await this.read('memory_items',{owner_scope:this.writing.base.source.owner_scope,limit:1})).relevant_versions.notebook;
        if(notebook!==this.notebook && await this.writing.refresh())this.notebook=notebook;
      }
      this.sync();
    }
    if(!this.writing.base)return false;
    if(!this.images){
      this.sync(true); await this.paintHeader();
      this.images=new NotebookImages(this.writing);this.images.resume();
      this.textImages=this.imagePicker(this.text,this.textInput,this.textPanel);
    }
    await this.loadTalks(); this.writingChanged(); return Boolean(this.writing.base);
  }
  // Let go without a pagehide (an in-place move, another page in the composer, notebook-sheet.mjs): writing closes
  // as on pagehide, and the page's keys and listeners go with it.
  close() {
    this.listening.abort();
    if(this.writing&&!this.writing.closed){this.writing.close();this.writing.serial.finally(()=>this.store.close());}
  }
  mergeIncoming(base,mine,theirs) {
    if(this.mode!=='cards')return null;
    const e=this.editing;
    if(e&&!e.fresh&&e.field.value!==e.startedValue) {
      const before=parseDeck(base.body),after=parseDeck(theirs.body);
      let at=findCard(before,e.text,e.near);
      if(at<0)at=findCard(before,cardText(textCard(this.editorWords(e))),e.near);
      if(at<0)at=e.near;
      if(!before.cards[at]||findCard(after,cardText(before.cards[at]),at)<0)return null;
    }
    const merged=mergeCardContent(base,mine,theirs);
    if(merged&&e&&!mergeCardContent({...mine,body:this.previewBody()},{...mine,body:deckBody(this.deck)},merged))return null;
    return merged;
  }
  editorWords(e) {
    const written=e.field.value;
    return e.stacks?.length&&/\S/.test(written)?`${written.trimEnd()}\n\n${e.stacks.join('\n')}`:written;
  }
  sync(force=false) {
    const w=this.writing;
    if(!w?.base)return;
    this.source=w.base.source; this.base={revision:w.base.revision,body:w.base.content.body}; this.readOnly=w.readOnly;
    this.header.title.textContent=w.value.title;
    const drawKept=force || !this.cardsSeen || !this.textSeen;
    if((!w.conflict || drawKept) && (drawKept || deckBody(this.deck)!==w.value.body)) {
      const e=this.editing;
      const unpreview=e?mergeCardContent({...w.value,body:this.previewBody()},{...w.value,body:deckBody(this.deck)},w.value):null;
      const deck=parseDeck(unpreview?.body??w.value.body);
      if(e&&!e.fresh&&findCard(deck,e.text,e.near)<0&&!w.hasLocal)this.finish({discard:true});
      this.deck=deck; this.acts=[];
      this.picked=Math.min(this.picked,Math.max(0,this.deck.cards.length-1));
      this.paint();
    }
    if(this.text.value!==w.value.body&&(!w.conflict || drawKept)) {
      const focused=this.doc.activeElement===this.text,selection=[this.text.selectionStart,this.text.selectionEnd];
      this.text.value=w.value.body;
      if(focused)this.text.setSelectionRange(...selection.map(at=>Math.min(at,this.text.value.length)));
    }
    if(!w.conflict || drawKept) {
      this.textSeen={revision:w.base.revision,content:{...structuredClone(w.value),body:this.text.value}};
      this.cardsSeen={revision:w.base.revision,content:{...structuredClone(w.value),body:this.previewBody()}};
    }
    this.text.readOnly=this.readOnly;
  }
  // Include the unfinished card without altering its textarea or native undo
  // history. Done later applies this same edit to the visible deck once.
  previewBody() {
    const e=this.editing;
    if(!e)return deckBody(this.deck);
    const written=e.field.value, to=e.stacks?.length&&/\S/.test(written)?`${written.trimEnd()}\n\n${e.stacks.join('\n')}`:written;
    const act=e.fresh?{kind:'add',after:e.after,text:to,depth:e.depth,near:e.near}:{kind:'edit',text:e.text,to,near:e.near};
    const done=applyAct(this.deck,act);
    return done?deckBody(done.deck):deckBody(this.deck);
  }
  save() {
    if(!this.writing || !this.cardsSeen)return;
    const acts=this.acts;this.acts=[];
    const body=this.previewBody(),seen=this.cardsSeen;
    this.writing.edit({body},seen,'cards',acts);
    this.cardsSeen={revision:seen.revision,content:{...seen.content,body}};
  }
  open(editing) {
    this.cardImages?.close();this.cardImages?.list?.remove();
    super.open(editing);
    if(!this.editing)return;
    this.writing.active=true;
    this.editing.startedValue=this.editing.field.value;
    this.editing.field.addEventListener('input',()=>this.save());
    this.cardImages=this.imagePicker(this.editing.field,this.editing.input,this.list);
  }
  finish({discard=false} = {}) {
    this.cardImages?.close();this.cardImages?.list?.remove();this.cardImages=null;
    if(discard){this.editing=null;this.paint();this.show(true);}
    else super.finish();
    if(this.writing)this.writing.active=false;
  }
  moveWriting(act) { super.moveWriting(act); this.save(); }
  paint() { if(this.mode!=='text')super.paint(); }
  key(event) {
    const picker=this.mode==='text'?this.textImages:this.cardImages;
    if(event.target===picker?.field&&picker.key(event))return;
    if(this.mode==='text') {
      if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.target!==this.text)return;
      if(this.textInput.writingKey(event))return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();this.writing?.flush();}
      return;
    }
    super.key(event);
  }
  switchView(mode) {
    if(mode===this.mode)return;
    if(this.editing)this.finish();
    this.textImages?.close();this.cardImages?.close();
    this.mode=mode; this.sync(true); this.drawView();
    if(mode==='text')this.text.focus(); else this.paint();
  }
  drawView() {
    const text=this.mode==='text';
    this.textPanel.hidden=!text;
    for(const node of [this.list,this.bar,this.keys,this.opening])node.hidden=text || (node===this.opening&&!/\S/.test(this.deck.opening));
    this.viewButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String((i===0)===text)));
  }
  writingChanged() {
    const w=this.writing;
    if(!w)return;
    this.readOnly=w.readOnly; this.text.readOnly=w.readOnly;
    if(this.editing)this.editing.field.readOnly=w.readOnly;
    this.host.classList.toggle('deck-read-only',w.readOnly);
    const changed=w.conflict;
    this.conflictPanel.hidden=!changed;
    if(changed && this.conflictRevision!==changed.revision) {
      this.conflictRevision=changed.revision;
      const title=this.node('h2','','This page changed elsewhere');
      const words=this.node('p','','Your writing is kept. Review the saved version before choosing which to continue with.');
      const latest=this.node('pre','notebook-latest',changed.content.body);
      const mine=this.node('button','','Save my version'), saved=this.node('button','','Use saved version');
      mine.type=saved.type='button';
      mine.onclick=async()=>{await w.resolve(true);this.sync();};
      saved.onclick=async()=>{this.finish({discard:true});this.textImages?.close();await w.resolve(false);this.sync(true);};
      mine.hidden=!w.hasLocal;
      this.conflictPanel.replaceChildren(title,words,latest,mine,saved);
    }
    if(!changed)this.conflictRevision=null;
    this.paintImages();
    if(this.unavailable)this.say(this.unavailable,'attention');
    else if(w.journalError)this.say('Device copy unavailable: '+w.journalError+'. Keep this page open.','attention',()=>w.flush());
    else if(this.imageError)this.say(this.imageError,'attention');
    else if(w.readOnly)this.say(w.error??'Writing is paused. Your words are kept on this device.','attention',()=>w.retry());
    else if(w.error)this.say(w.error,'attention',()=>w.flush());
    else if(changed)this.say('Your writing is kept on this device. Review the changed page.','attention');
    else if(w.images.some(i=>!i.removed&&i.error))this.say('An image needs attention. Your words are kept.','attention');
    else if(w.images.some(i=>!i.removed&&!i.associated))this.say('Uploading image…','saving');
    else if(w.journalPending)this.say('Keeping your writing on this device…','saving');
    else if(w.busy)this.say('Saving…','saving');
    else if(w.dirty)this.say('Saved on this device · saving to Theseus…','saving');
    else if(w.base)this.say('Saved to Theseus','saved');
    if(w.readOnly&&!this.unavailable) {
      const discard=this.node('button','','Discard my writing');discard.type='button';
      discard.onclick=async()=>{if(await w.discard()){this.finish({discard:true});this.sync(true);}};
      this.status.append(discard);
    }
  }
  async captureImage(file) {
    try {this.imageError=null;await this.images.capture(file);}
    catch(error){this.imageError=error.message;this.writingChanged();}
  }
  imagePicker(field,input,host) {
    field.id ||= 'notebook-card-writing';
    const picker=new ImagePick({field,host,admits:()=>Boolean(this.room?.topicId&&!this.readOnly),
      load:()=>this.read('topic_images',{topic_id:this.room.topicId,limit:24}),
      thumb:async item=>(await this.api.media(this.bootstrap.instance_id,item.attachment,item.source_ref)).blob,
      choose:async item=>{
        input.deleteSelection();
        try {
          const media=await readInTurn(()=>this.api.media(this.bootstrap.instance_id,item.attachment,item.source_ref),{first:true});
          await this.captureImage(new File([media.blob],item.attachment.name,{type:item.attachment.content_type}));
        } catch(error){this.imageError=error.message;this.writingChanged();}
      }});
    field.addEventListener('input',()=>picker.update());
    field.addEventListener('paste',event=>{
      const file=[...(event.clipboardData?.files??[])].find(file=>file.type.startsWith('image/'));
      if(file&&!this.readOnly){event.preventDefault();this.captureImage(file);}
    });
    return picker;
  }
  paintImages() {
    const w=this.writing;if(!w?.value||!this.imageRows)return;
    this.addImage.disabled=w.readOnly;
    const attached=w.value.attachments.map(ref=>{
      const own=w.images.find(i=>i.ready?.media_id===ref.id),d=own?.ready;
      const descriptor=d?{...d,id:d.media_id}:w.base?.source.attachments.find(a=>a.id===ref.id);
      return {id:own?.id??ref.id,name:descriptor?.name??'Image',descriptor,own};
    });
    const pending=w.images.filter(i=>!i.removed&&!i.associated).map(own=>({id:own.id,name:own.name,own}));
    const rows=[];
    for(const item of [...attached,...pending]) {
      let row=this.imageNodes.get(item.id);
      if(!row){
        row=this.node('div','notebook-image');this.imageNodes.set(item.id,row);
        row.words=this.node('span');row.removeButton=this.node('button','','Remove');row.retryButton=this.node('button','','Retry image');
        row.removeButton.type=row.retryButton.type='button';
        row.removeButton.onclick=()=>this.images.remove(row.item.id).catch(error=>{this.imageError=error.message;this.writingChanged();});
        row.retryButton.onclick=()=>this.images.run(row.item.own);
        row.append(row.words,row.removeButton,row.retryButton);
      }
      row.item=item;
      row.words.textContent=item.name+(item.own&&!item.own.ready?' · '+(item.own.error??'Uploading…'):'');
      row.removeButton.disabled=row.retryButton.disabled=w.readOnly;
      row.retryButton.hidden=!item.own?.error;
      const descriptor=item.descriptor;
      if(item.own?.bytes||descriptor?.inline)paintThumb(row,item.id,async()=>(item.own?.bytes?new Blob([item.own.bytes],{type:item.own.type}):null)??(await this.api.media(this.bootstrap.instance_id,descriptor,item.own?undefined:w.base.source.source_ref)).blob);
      rows.push(row);
    }
    // Keep existing controls mounted while a press is in flight. Autosaves
    // and thumbnail completion must not swallow the corresponding click.
    rows.forEach((row,i)=>{if(this.imageRows.children[i]!==row)this.imageRows.insertBefore(row,this.imageRows.children[i]??null);});
    for(const row of [...this.imageRows.children])if(!rows.includes(row))row.remove();
    for(const [id]of this.imageNodes)if(!rows.includes(this.imageNodes.get(id)))this.imageNodes.delete(id);
  }
}
