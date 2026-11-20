import { CardTextProjection, cardTextValue } from './notebook-card-text.mjs';
import { stripDetails } from './card-details.mjs';
import { pageLink } from './links.mjs';
import { openMessageMenu, copyText } from './message-menu.mjs';
import { DeckPage, UNDO_LIMIT } from './deck-page.mjs';
import { applyAct, deckBody, parseDeck, cardText, cardImages, imageLine, textCard, findCard } from './deck.mjs';
import { WritingInput } from './writing-input.mjs';
import { NotebookWriting, notebookStore, mergeCardContent } from './notebook-writing.mjs';
import { NotebookImages } from './notebook-images.mjs';
import { ImagePick, paintThumb, readInTurn } from './image-pick.mjs';
import { DRAFT_TIP } from './topic-navigation.mjs';
import { NotebookViews } from './notebook-view.mjs';

// The draft mark's words (docs/notebook-pages.md, "A draft page").
const DRAFT = { off: 'Mark as a draft: agents see its title and that it is a draft, never its words',
  on: DRAFT_TIP + '. Press to clear it', note: DRAFT_TIP };

function refuseUnavailableWriting(page) {
  if (!page.unavailable) return false;
  page.say(page.unavailable, 'attention');
  return true;
}

export function notebookMenuItems(page) {
    const w=page.writing,state=w?.pageState;
    if(!state)return [];
    if(w.deleted)return state.reader_may_delete?[{key:'restore',label:'Undo delete',glyph:'undo',act:()=>page.pageAction('memory.delete',{deleted:false})}]:[];
    // Read the current writer again when a menu action runs: permission or recovery
    // may have changed since this list opened. The ordinary buttons use the same owners.
    const canWrite=()=>page.writing===w&&!page.readOnly&&!w.readOnly&&!w.reading&&!w.deleted&&!w.closed&&!w.actionPending&&!w.actionRunning;
    const items=[
      ...(page.menuExtras?.('first')??[]),
      {key:'text',label:'Show as text',glyph:'text',checked:page.mode==='text',act:()=>page.switchView('text')},
      {key:'cards',label:'Show as cards',glyph:'stack',checked:page.mode==='cards',act:()=>page.switchView('cards')},
      {key:'draft',label:'Private Draft',glyph:'draft',checked:page.drafted(),disabled:!canWrite(),act:()=>{if(canWrite())page.markDraft(!page.drafted());}},
      ...(page.menuExtras?.('beforeImage')??[]),
      {key:'image',label:'Add image…',glyph:'image',disabled:!canWrite(),act:()=>{if(canWrite())page.addImage.onclick();}},
      ...(page.menuExtras?.('afterImage')??[]),
      {key:'star',label:state.starred?'Unstar':'Star',glyph:state.starred?'starred':'star',act:()=>page.pageAction('memory.star',{starred:!state.starred})}];
    if(!page.readOnly)items.push({key:'rename',label:'Rename',glyph:'pencil',act:()=>page.rename()});
    if(state.reader_may_delete)items.push({key:'delete',label:'Delete',glyph:'drop',act:()=>{
      if(page.doc.defaultView.confirm('Delete this Notebook page? Its history is kept and you can undo it.'))page.pageAction('memory.delete',{deleted:true});
    }});
    items.push({key:'copy',label:'Copy Link',glyph:'link',act:()=>page.copyLink()});
    return items;
  }

// DeckPage supplies the existing card gestures and geometry. This surface
// supplies one body and one saving stream, shared with the Text view.
export class NotebookPage extends DeckPage {
  constructor(options) {
    super(options);
    this.viewPreference = options.viewPreference ?? new NotebookViews(options.bootstrap ?? {});
    Object.assign(this, { api: options.api, bootstrap: options.bootstrap, mode: options.mode ?? this.viewPreference.get(options.item) });
    this.viewPreference.set(options.item, this.mode);
    // Told after each change to the writing, so a page in the composer reads a revision that reaches it (notebook-sheet.mjs).
    this.revisionShown = options.revisionShown ?? (() => {});
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
    this.textProjection=new CardTextProjection();
    this.text.addEventListener('beforeinput',event=>{
      if(event.inputType==='historyUndo'||event.inputType==='historyRedo') {
        event.preventDefault();this.textHistory(event.inputType==='historyUndo'?-1:1);return;
      }
      this.textChange={start:this.text.selectionStart,end:this.text.selectionEnd,inputType:event.inputType};
    });
    this.text.addEventListener('input',event=>{
      this.textChange={...this.textChange,inputType:event.inputType,
        selection:[this.text.selectionStart,this.text.selectionEnd]};
      this.textEdited();
    });
    // The system clipboard receives the visible textarea selection. Only this
    // opening remembers its raw cut fragment, for one matching paste.
    this.text.addEventListener('cut',()=>{
      if(this.readOnly||!this.textSeen)return;
      this.textEdited();
      this.textProjection.rememberCut(this.text.selectionStart,this.text.selectionEnd);
    });
    this.text.addEventListener('focus',()=>{if(this.writing)this.writing.active=true;});
    this.text.addEventListener('blur',()=>{if(this.writing)this.writing.active=false;});
    this.textPanel.append(label,this.text);
    this.conflictPanel=this.node('section','notebook-conflict'); this.conflictPanel.hidden=true;
    this.imagePanel=this.node('div','notebook-images'); this.imageRows=this.node('div','notebook-image-rows'); this.imageNodes=new Map();
    this.addImage=this.node('button','','Add image');this.addImage.type='button';
    this.imageFile=this.node('input');this.imageFile.type='file';this.imageFile.accept='image/png,image/jpeg,image/gif,image/webp';this.imageFile.hidden=true;
    this.addImage.onclick=()=>{if(this.readOnly||this.writing?.reading)return;this.imageFile.value='';this.imageFile.click();};
    this.imageFile.onchange=()=>{if(this.imageFile.files?.[0])this.captureImage(this.imageFile.files[0]);};
    this.imagePanel.append(this.imageRows,this.addImage,this.imageFile);
    // The draft mark: a toggle beside Text / Cards for someone Core lets write the page, a quiet mark for someone
    // who reads it, shown while the page is a draft. The composer takes both with the views (notebook-sheet.mjs).
    this.draft=this.node('span','notebook-draft');
    this.draftButton=this.node('button','notebook-draft-toggle','Draft');this.draftButton.type='button';this.draftButton.hidden=true;
    this.draftButton.onclick=()=>{this.markDraft(!this.drafted());};
    this.draftNote=this.node('span','notebook-draft-note','Draft');this.draftNote.title=DRAFT.note;this.draftNote.hidden=true;
    this.draft.append(this.draftButton,this.draftNote);
    this.more=this.node('button','notebook-menu quiet','⋯');this.more.type='button';
    this.more.setAttribute('aria-label','This page');this.more.title='This page';this.more.setAttribute('aria-haspopup','menu');
    this.more.onclick=()=>openMessageMenu({anchor:this.more,items:this.menuItems(),label:'This page',sheet:true,doc:this.doc});
    this.titleBox=this.node('input','notebook-rename');this.titleBox.setAttribute('aria-label','Page title');this.titleBox.hidden=true;
    this.titleBox.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.endRename(false);}
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();this.endRename(true);}
    });
    this.pageNotice=this.node('div','notebook-page-notice');this.pageNotice.setAttribute('role','status');
    const tools=this.node('div','notebook-tools'); tools.append(this.views,this.draft,this.more);
    this.status.before(this.pageNotice);
    this.status.before(tools); this.status.after(this.conflictPanel,this.imagePanel,this.textPanel);
    // An image file dropped on the card being written goes into it, as one pasted there does (item 321); a drag of
    // anything but files is left to the box.
    const dropping=event=>Boolean(this.editing&&!this.readOnly&&this.images&&event.target.closest?.('.deck-writing')&&[...(event.dataTransfer?.types??[])].includes('Files'));
    const lit=on=>this.list.querySelector('.deck-writing')?.classList.toggle('deck-dropping',on);
    for(const kind of ['dragenter','dragover'])this.list.addEventListener(kind,event=>{if(!dropping(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';lit(true);});
    this.list.addEventListener('dragleave',event=>{if(!event.relatedTarget||!this.list.querySelector('.deck-writing')?.contains(event.relatedTarget))lit(false);});
    this.list.addEventListener('drop',event=>{if(!dropping(event))return;event.preventDefault();lit(false);this.addToCard([...event.dataTransfer.files],this.editing.field);});
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
        reconcile:(base,mine,theirs)=>this.mergeIncoming(base,mine,theirs),localActive:()=>Boolean(this.editing&&this.boxChanged(this.editing))});
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
      await this.writing.readStatus();
      if(!this.writing.base)await this.writing.refresh();
      else {
        const notebook=(await this.read('memory_items',{owner_scope:this.writing.base.source.owner_scope,limit:1})).relevant_versions.notebook;
        if(notebook!==this.notebook && await this.writing.refresh())this.notebook=notebook;
      }
      this.sync();
    }
    if(!this.writing.base)return false;
    if(this.writing.deleted){this.writingChanged();return true;}
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
    this.textProjection?.close();
    if(this.writing&&!this.writing.closed){this.writing.close();this.writing.serial.finally(()=>this.store.close());}
  }
  mergeIncoming(base,mine,theirs) {
    if(this.mode!=='cards')return null;
    const e=this.editing;
    if(e&&!e.fresh&&this.boxChanged(e)) {
      const before=parseDeck(base.body),after=parseDeck(theirs.body);
      let at=findCard(before,e.text,e.near);
      if(at<0)at=findCard(before,cardText(textCard(this.boxText(e))),e.near);
      if(at<0)at=e.near;
      if(!before.cards[at]||findCard(after,cardText(before.cards[at]),at)<0)return null;
    }
    const merged=mergeCardContent(base,mine,theirs);
    if(merged&&e&&!mergeCardContent({...mine,body:this.previewBody()},{...mine,body:deckBody(this.deck)},merged))return null;
    return merged;
  }
  sync(force=false) {
    const w=this.writing;
    if(!w?.base)return;
    // Words already in a box whose input has not reached the writing yet go to it first: a read's answer can be
    // taken between one input listener and the next, and the page drawn from the writing then keeps them.
    if(this.editing)this.save();
    this.textEdited();
    this.source=w.base.source; this.base={revision:w.base.revision,body:w.base.content.body}; this.readOnly=w.readOnly||w.reading;
    if(!this.renameSeen)this.header.title.textContent=w.value.title;
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
    const textBody=cardTextValue(stripDetails(w.value.body));
    if(this.text.value!==textBody&&(!w.conflict || drawKept)) {
      const focused=this.doc.activeElement===this.text,selection=[this.text.selectionStart,this.text.selectionEnd];
      this.text.value=textBody;
      if(focused)this.text.setSelectionRange(...selection.map(at=>Math.min(at,this.text.value.length)));
    }
    if(!w.conflict || drawKept) {
      (this.textProjection??=new CardTextProjection()).show(w.value.body,w.base.content.body);
      this.textSeen={revision:w.base.revision,content:structuredClone(w.value)};
      this.cardsSeen={revision:w.base.revision,content:{...structuredClone(w.value),body:this.previewBody()}};
    }
    this.text.readOnly=this.readOnly;
  }
  // Include the unfinished card without altering its textarea or native undo
  // history. Done later applies this same edit to the visible deck once.
  previewBody() {
    const e=this.editing;
    if(!e)return deckBody(this.deck);
    const to=this.boxText(e);
    const act=e.fresh?{kind:'add',after:e.after,text:to,depth:e.depth,near:e.near}:{kind:'edit',text:e.text,to,near:e.near};
    const done=applyAct(this.deck,act);
    return done?deckBody(done.deck):deckBody(this.deck);
  }
  textEdited() {
    if(!this.writing || !this.textSeen)return;
    const seen=this.textSeen;
    const projection=this.textProjection??=new CardTextProjection();
    if(projection.body===undefined)projection.show(seen.content.body,this.writing.base.content.body);
    projection.confirm(this.writing.base.content.body);
    const body=projection.edit(this.text.value,this.textChange);this.textChange=null;
    if(this.text.value!==projection.text) {
      this.text.value=projection.text;
      this.text.setSelectionRange(...projection.selection);
    }
    this.textSeen={revision:seen.revision,content:{...seen.content,body}};
    const edited=this.writing.edit({body},seen,'text');
    if(edited)this.keepNamed(body);
  }
  textHistory(direction) {
    if(this.readOnly||!this.writing||!this.textSeen)return;
    this.textEdited();
    const state=this.textProjection.undo(direction);this.textChange=null;
    if(!state)return;
    this.text.value=this.textProjection.text;
    this.text.setSelectionRange(...state.selection);
    const seen=this.textSeen,body=state.body;
    this.textSeen={revision:seen.revision,content:{...seen.content,body}};
    const edited=this.writing.edit({body},seen,'text');
    if(edited)this.keepNamed(body);
  }
  save() {
    if(!this.writing || !this.cardsSeen)return;
    const acts=this.acts;this.acts=[];
    const body=this.previewBody(),seen=this.cardsSeen;
    const edited=this.writing.edit({body},seen,'cards',acts);
    this.cardsSeen={revision:seen.revision,content:{...seen.content,body}};
    if(edited)this.keepNamed(body);
  }
  // A card line naming an image × took off the page this visit, back in the page's words (Undo, or the line written
  // again), puts the image back on the page (NotebookImages.restore), so no card names an image the page lost. Only
  // words the person changed count: a view's words not yet redrawn are no edit and bring nothing back.
  keepNamed(body) {
    if(!this.images?.released.size)return;
    for(const id of this.namedImages(body))if(this.images.released.has(id))
      this.images.restore(id).catch(error=>{this.imageError=error.message;this.writingChanged();});
  }
  open(editing) {
    this.cardImages?.close();this.cardImages?.list?.remove();
    // A refusal said for the card before goes as another opens.
    if(this.imageError){this.imageError=null;this.writingChanged();}
    super.open(editing);
    if(!this.editing)return;
    this.writing.active=true;
    this.editing.field.addEventListener('input',()=>this.save());
    this.cardImages=this.imagePicker(this.editing.field,this.editing.input,this.list);
  }
  finish({discard=false,target=null} = {}) {
    this.cardImages?.close();this.cardImages?.list?.remove();this.cardImages=null;
    if(this.imageError&&this.editing){this.imageError=null;this.writingChanged();}
    let at=-1;
    if(discard){this.editing=null;this.paint();this.show(true);}
    else at=super.finish({target});
    if(this.writing)this.writing.active=false;
    return at;
  }
  moveWriting(act) { super.moveWriting(act); this.save(); }
  drafted() { return this.writing?.value?.draft === true; }
  // Marking the page a draft, or clearing the mark, is an act of its own: saved as a revision as the words are,
  // and taken back by Undo (or, in the Text view, by the toggle itself).
  markDraft(on, undoing=false) {
    const w=this.writing, seen=this.mode==='text'?this.textSeen:this.cardsSeen;
    if(!w||!seen||this.readOnly||this.drafted()===on)return false;
    if(this.asking){if(this.asking.sending)return false;this.endAsk(true);}
    if(!w.edit({draft:on},seen,this.mode))return false;
    for(const shown of [this.textSeen,this.cardsSeen])if(shown)shown.content={...shown.content,draft:on};
    if(!undoing)this.undos=[...this.undos,{kind:'draft',draft:!on}].slice(-UNDO_LIMIT);
    return true;
  }
  // Keys and clicks share these card editing entry points. A page held in another
  // tab stays readable, but an attempted edit repeats the opening's explanation.
  act(...args) { if (refuseUnavailableWriting(this)) return false; return super.act(...args); }
  edit(...args) { if (!refuseUnavailableWriting(this)) return super.edit(...args); }
  start(...args) { if (!refuseUnavailableWriting(this)) return super.start(...args); }
  // The composer's Note uses the Cards + act and the same revision/journal
  // stream. The job remembers only its already-applied act, never a second
  // save envelope: an uncertain answer retries NotebookWriting's exact one.
  async appendNote(job) {
    const w = this.writing;
    if (job.applied && w?.refusalCode) await w.retry();
    if (!job.applied) {
      if (!w || this.unavailable || !await w.refresh()) throw Error(this.unavailable || w?.error || 'This Notebook page is no longer available.');
      const scope = w.base?.source.owner_scope;
      if (!this.cardWritable() || scope?.kind !== job.scope.kind || scope?.id !== job.scope.id) throw Error('This Notebook page is no longer available for writing.');
      if (this.asking?.sending) throw Error('Finish sending the card’s question before adding a Note.');
      if (this.editing) this.finish();
      this.switchView('cards'); this.sync();
      const attachments = [...new Map([...w.value.attachments, ...job.attachments].map(ref => [ref.id, { id: ref.id }])).values()];
      w.edit({ attachments }, w.capture(), 'cards');
      const last = this.deck.cards.length - 1;
      if (!this.act({ kind: 'add', after: last < 0 ? null : cardText(this.deck.cards[last]), text: job.cardWords, depth: 0, near: last })) throw Error('The card could not be added. Your writing is kept.');
      job.applied = true;
      job.card = this.ensureCardId(this.cardRef(this.picked));
    }
    await this.saveCardChange();
    if (!job.card || w.pending || w.dirty || w.conflict || w.error || w.journalError || w.deleted || w.closed) throw Error(w.error || w.journalError || 'The added card is not confirmed yet. Your writing is kept.');
  }
  undo() {
    if (refuseUnavailableWriting(this)) return;
    const last=this.undos.at(-1);
    if(last?.kind!=='draft'||this.editing||this.asking||this.readOnly)return super.undo();
    this.undos=this.undos.slice(0,-1);
    if(!this.markDraft(last.draft,true))this.say('Nothing taken back: the draft mark changed since.','attention');
  }
  paintDraft() {
    const on=this.drafted(), writer=Boolean(this.writing?.base)&&!this.readOnly;
    this.draftButton.hidden=!writer; this.draftNote.hidden=writer||!on||!this.writing?.base;
    this.draftButton.setAttribute('aria-pressed',String(on));
    this.draftButton.title=on?DRAFT.on:DRAFT.off;
    this.host.classList.toggle('notebook-drafted',on);
    // The cards' asks come and go with the mark.
    if(this.paintedDraft!==undefined&&this.paintedDraft!==on)this.paint();
    this.paintedDraft=on;
  }
  paint() { if(this.mode!=='text')super.paint(); this.surfaceChanged?.(); }
  say(words, state = null, again = null) {
    if (this.presentStatus) this.presentStatus(words, state, again);
    else super.say(words, state, again);
  }
  key(event) {
    if (this.keyScope && !this.keyScope(event.target)) return;
    const picker=this.mode==='text'?this.textImages:this.cardImages;
    if(event.target===picker?.field&&picker.key(event))return;
    if(this.mode==='text') {
      if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.target!==this.text)return;
      const letter=event.key.toLowerCase();
      if(!event.altKey&&(event.metaKey||event.ctrlKey)&&
          (letter==='z'||(letter==='y'&&event.ctrlKey&&!event.shiftKey))) {
        event.preventDefault();this.textHistory(letter==='y'||event.shiftKey?1:-1);return;
      }
      const selection=[this.text.selectionStart,this.text.selectionEnd],position=this.textProjection?.position;
      if(this.textInput.writingKey(event)) {
        // WritingInput sets a moved line's final caret after its input event.
        // The Text snapshot owns that actual caret, as it owns the raw body.
        if(this.textProjection?.position===position+1) {
          const entry=this.textProjection.history[position];
          entry.before.selection=selection;entry.after.selection=[this.text.selectionStart,this.text.selectionEnd];
        }
        return;
      }
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();this.writing?.flush();}
      return;
    }
    super.key(event);
  }
  switchView(mode) {
    if(mode===this.mode)return;
    if(this.mode==='text')this.textEdited();
    if(this.editing)this.finish();
    this.textImages?.close();this.cardImages?.close();
    this.textProjection?.close();this.textChange=null;
    if(this.textInput)this.textInput.moves={done:[],at:0};
    this.mode=mode; this.sync(true); this.drawView();
    this.viewPreference.set(this.item, mode);
    if(mode==='text')this.text.focus(); else this.paint();
  }
  drawView() {
    const text=this.mode==='text';
    this.textPanel.hidden=!text;
    for(const node of [this.list,this.bar,this.keys,this.opening])node.hidden=text || (node===this.opening&&!/\S/.test(this.deck.opening));
    this.viewButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String((i===0)===text)));
    this.surfaceChanged?.();
  }
  writingChanged() {
    const w=this.writing;
    if(!w)return;
    const putBack = this.holdPage();
    // A permission refusal can remove the writing controls above a card. Keep
    // the page's extent while those controls are away, so its bottom cannot
    // pull the person up as they finish the retained writing.
    if (this.editing && !this.readOnly && (w.readOnly || w.reading) && !this.host.closest('dialog[open]')) this.host.style.minHeight = `${this.host.getBoundingClientRect().height}px`;
    if (!w.readOnly && !w.reading) this.host.style.removeProperty('min-height');
    // A person Core does not let write the page reads it: no writing controls, and nothing to pause.
    this.readOnly=w.readOnly||w.reading||w.deleted||Boolean(w.actionPending); this.text.readOnly=this.readOnly;
    this.paintPageState();
    if(this.editing)this.editing.field.readOnly=this.readOnly;
    this.host.classList.toggle('deck-read-only',this.readOnly);
    this.paintDraft();
    const changed=w.conflict;
    this.conflictPanel.hidden=!changed;
    if(changed && this.conflictRevision!==changed.revision) {
      this.conflictRevision=changed.revision;
      const title=this.node('h2','','This page changed elsewhere');
      const words=this.node('p','','Your writing is kept. Review the saved version before choosing which to continue with.');
      const latest=this.node('pre','notebook-latest',changed.content.title+'\n\n'+stripDetails(changed.content.body));
      const mine=this.node('button','','Save my version'), saved=this.node('button','','Use saved version');
      mine.type=saved.type='button';
      mine.onclick=async()=>{await w.resolve(true);this.sync();};
      saved.onclick=async()=>{this.finish({discard:true});this.textImages?.close();await w.resolve(false);this.sync(true);};
      mine.hidden=!w.hasLocal;
      this.conflictPanel.replaceChildren(title,words,latest,mine,saved);
    }
    if(!changed)this.conflictRevision=null;
    this.paintImages();
    // A card's image as it now stands: shown from this device while it uploads, then from Core.
    for(const figure of this.list.querySelectorAll('.deck-image'))this.picture(figure,cardImages(figure.dataset.cardImage).images[0]);
    if(this.unavailable)this.say(this.unavailable,'attention');
    else if(w.journalError)this.say('Device copy unavailable: '+w.journalError+'. Keep this page open.','attention',()=>w.flush());
    else if(this.imageError)this.say(this.imageError,'attention');
    else if(w.readOnly)this.say(w.error??'Writing is paused. Your words are kept on this device.','attention',()=>w.retry());
    else if(w.error)this.say(w.error,'attention',()=>w.flush());
    else if(changed)this.say('Your writing is kept on this device. Review the changed page.','attention');
    else if(w.images.some(i=>!i.removed&&i.error))this.say('An image needs attention. Your words are kept.','attention');
    else if(w.images.some(i=>!i.removed&&!i.associated))this.say('Uploading image…','saving');
    // Someone who may not write the page, with none of their writing on its way, reads it: the device keeps nothing for them.
    else if(w.reading&&!w.dirty&&!w.busy)this.say('To read');
    else if(w.journalPending)this.say('Keeping your writing on this device…','saving');
    else if(w.busy)this.say('Saving…','saving');
    else if(w.dirty)this.say('Saved on this device · saving to Theseus…','saving');
    else if(w.base)this.say('Saved to Theseus','saved');
    if(w.readOnly&&!this.unavailable) {
      const discard=this.node('button','','Discard my writing');discard.type='button';
      discard.onclick=async()=>{if(await w.discard()){this.finish({discard:true});this.sync(true);}};
      this.status.append(discard);
    }
    this.paintPageState();
    this.revisionShown();
    putBack();
  }
  menuItems() { return notebookMenuItems(this); }

  async copyLink() {
    const w=this.writing,source=w?.base?.source;
    if(!source||w.closed)return;
    const serial=this.copySerial=(this.copySerial??0)+1;
    const link=pageLink(source.owner_scope,source.source_ref.id);
    const copied=await copyText(link);
    if(this.writing!==w||w.closed||this.copySerial!==serial)return;
    this.copyNotice?.remove();
    this.copyNotice=this.node('p','',copied?'Link copied.':`Could not copy. Select this link and use Copy: ${link}`);
    // Do not replace a deletion, failed action or recovery control with this receipt.
    this.pageNotice.append(this.copyNotice);
  }
  rename() {
    if(this.readOnly||!this.writing?.value)return;
    this.renameSeen=this.writing.capture();this.titleBox.value=this.renameSeen.content.title;
    this.header.title.replaceChildren(this.titleBox);this.titleBox.hidden=false;this.titleBox.focus({preventScroll:true});this.titleBox.select();
  }
  async endRename(save) {
    if(!this.renameSeen)return;
    const seen=this.renameSeen;this.renameSeen=null;
    if(save)this.writing.edit({title:this.titleBox.value},seen,this.mode);
    this.titleBox.hidden=true;this.more.focus({preventScroll:true});
    this.sync();if(save){await this.writing.flush();this.sync();}
  }
  async pageAction(kind,args) {
    if(!kind&&!this.writing?.actionPending)return;
    // Capture the actual visible writing before settling the same writer stream.
    if(this.editing)this.save();this.textEdited();
    if(this.writing?.actionPending)await this.writing.retryAction();
    else await this.writing?.action(kind,args);
    if(!this.writing?.actionPending)await this.load();
    this.writingChanged();
  }
  paintPageState() {
    const w=this.writing;if(!w)return;
    this.more.disabled=Boolean(w.actionRunning||w.actionPending);this.more.hidden=!w.pageState;
    this.pageNotice.replaceChildren();
    if(w.deleted) {
      this.pageNotice.append(this.node('p','','This Notebook page was deleted. Its history and your unfinished writing are kept.'));
      if(w.pageState.reader_may_delete){const undo=this.node('button','','Undo delete');undo.type='button';undo.onclick=()=>this.pageAction('memory.delete',{deleted:false});this.pageNotice.append(undo);}
    }
    if(w.actionError){this.pageNotice.append(this.node('p','',w.actionError));if(w.actionPending){const retry=this.node('button','','Retry page action');retry.type='button';retry.onclick=()=>this.pageAction();this.pageNotice.append(retry);}}
    if(w.actionRunning)this.pageNotice.append(this.node('p','','Saving page action…'));
    for(const node of [this.textPanel,this.list,this.bar,this.keys,this.opening,this.imagePanel,this.views,this.draft,this.conflictPanel]) {
      if(w.deleted)node.hidden=true;
    }
    if(!w.deleted){this.views.hidden=false;this.draft.hidden=false;this.drawView();this.imagePanel.hidden=false;this.paintDraft();}
    if(w.deleted)this.titleBox.hidden=true;
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
          const file=new File([media.blob],item.attachment.name,{type:item.attachment.content_type});
          // Picked while writing a card, the image goes into that card.
          if(field!==this.text&&this.editing?.field===field)this.addToCard([file],field);
          else await this.captureImage(file);
        } catch(error){this.imageError=error.message;this.writingChanged();}
      }});
    field.addEventListener('input',()=>picker.update());
    field.addEventListener('paste',event=>{
      const files=[...(event.clipboardData?.files??[])];
      if(!files.length||this.readOnly)return;
      // Into a card being written, every file pasted is taken or refused with a line saying why (item 321).
      if(field!==this.text){event.preventDefault();this.addToCard(files,field);return;}
      const file=files.find(file=>file.type.startsWith('image/'));
      if(file){event.preventDefault();this.captureImage(file);}
    });
    return picker;
  }
  // Files pasted, dropped or picked into the card being written (item 321): each is taken or refused at once, before
  // its bytes are read, the first refusal saying what was not added and why. One taken is named in the card at once,
  // under its words, and shows from this device's copy while it uploads to the page as one of its attachments.
  addToCard(files, field) {
    const e=this.editing;
    if(!e||e.field!==field||this.readOnly||!this.images)return;
    this.imageError=null;
    const added=[];
    for(const file of files) {
      let admitted;
      try {admitted=this.images.admit(file);} catch(error) {this.imageError=error.message;break;}
      added.push(imageLine(admitted.name,admitted.media));
      this.images.capture(file,admitted).catch(error=>{this.imageError=error.message;this.writingChanged();});
    }
    if(added.length){e.images=[...(e.images??[]),...added];this.paint();this.save();}
    this.writingChanged();
  }
  // A card's image: from this device while it is the person's own and not yet in Core, else read through the page
  // as it stands, so only someone who may read the page sees it (docs/decks.md, "Images in a card"). Its name stays
  // with it, for screen readers, and shows while nothing else does: before it loads, while it uploads or fails, or
  // when the page holds no such image.
  picture(figure, image) {
    const w=this.writing, name=image.name||'Image';
    if(!w?.base)return super.picture(figure,image);
    const own=this.images?.held(image.id), attached=w.base.source.attachments.find(a=>a.id===image.id);
    const local=own?.bytes?new Blob([own.bytes],{type:own.type}):own?.file??null;
    let state='',kind='';
    if(own&&!own.ready)[state,kind]=own.error?[` · ${own.error}`,'failed']:[' · Uploading…','uploading'];
    else if(!own&&!attached)[state,kind]=[' · not on this page','missing'];
    if(kind)figure.dataset.state=kind;else delete figure.dataset.state;
    let caption=figure.querySelector(':scope > .deck-image-name');
    if(!caption){caption=this.node('figcaption','deck-image-name');figure.prepend(caption);}
    caption.textContent=name+state;
    if(local||own?.ready?.inline||(!own&&attached?.inline))paintThumb(figure,'card:'+image.id,async()=>local??(own?.ready
      ?(await this.api.media(this.bootstrap.instance_id,{...own.ready,id:own.ready.media_id})).blob
      :(await this.api.media(this.bootstrap.instance_id,attached,w.base.source.source_ref)).blob),img=>caption.before(img));
  }
  // × on an image in a card box: it leaves the card, and the page, unless another card still shows it; Undo, or its
  // line written again, puts it back (keepNamed).
  unpicture(editing, image) {
    super.unpicture(editing,image);
    if(this.editing!==editing||this.readOnly)return;
    this.save();
    if(!this.namedImages(this.previewBody()).has(image.id))this.images.remove(image.id,{keep:true}).catch(error=>{this.imageError=error.message;this.writingChanged();});
  }
  // The images the page's cards show, by id.
  namedImages(body) {
    const ids=new Set();
    for(const card of parseDeck(body).cards)for(const image of cardImages(card.words).images)ids.add(image.id);
    return ids;
  }
  paintImages() {
    const w=this.writing;if(!w?.value||!this.imageRows)return;
    this.addImage.disabled=w.readOnly; this.addImage.hidden=w.reading;
    // An image a card shows is the card's: it is listed here only while it needs the person (Retry).
    const named=this.namedImages(w.value.body);
    const attached=w.value.attachments.filter(ref=>!named.has(ref.id)).map(ref=>{
      const own=w.images.find(i=>i.ready?.media_id===ref.id),d=own?.ready;
      const descriptor=d?{...d,id:d.media_id}:w.base?.source.attachments.find(a=>a.id===ref.id);
      return {id:own?.id??ref.id,name:descriptor?.name??'Image',descriptor,own};
    });
    const pending=w.images.filter(i=>!i.removed&&!i.associated&&(i.error||!named.has(i.media))).map(own=>({id:own.id,name:own.name,own}));
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
      row.removeButton.hidden=w.reading;
      row.retryButton.hidden=!item.own?.error||w.reading;
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
