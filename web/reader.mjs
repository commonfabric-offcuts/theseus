import { messageUpdateActivity } from './cover-refresh.mjs';
import { messageFoldSwipe } from './message-fold-swipe.mjs';
import { keyAction, holdsWriting, written } from './editor.mjs';
import { showLine } from './lines.mjs';
import { ReaderLayout } from './layout.mjs';
import { imageBarrier, recoveryReadOnly } from './upload-state.mjs';
import { paintAddress } from './people.mjs';
import { timeNode } from './times.mjs';
import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices, sourceChange, paintSaveTime } from './writing-helpers.mjs';
import { paintImageRows, openImage } from './image-rows.mjs';
import { WritingInput, onMac, selectAllKey, copyKey } from './writing-input.mjs';
import { paintChanges } from './page-changes.mjs';
import { closeOnOutsideClick } from './dismiss.mjs';
import { drawPassages, sourcePosition, rangeOf } from './message-format.mjs';
import { pageImages } from './page-image.mjs';
import { paintChoice, clearChoice, chosen, naming, unnamed, sending, choiceOf, list } from './whisper-choice.mjs';
import { addressedTo } from './at-names.mjs';
import { ImagePick, clipboardHoldsImage, clipboardImage, readInTurn } from './image-pick.mjs';
import { ComposeBar } from './compose-bar.mjs';
import { copyText, COPY_REFUSED } from './message-menu.mjs';
import { revisionOf, wasEdited } from './message-edit-writing.mjs';
import { overhang } from './lit-field.mjs';
import { coverSheet, coverKey, payloadPill } from './dossier-cover.mjs';

const STEP_WAITS = 'Another message is still opening. Your writing is kept; images and sending wait until it opens.';
const CLOSING = 'This reply is closing, so the image was not added.';
const QUOTE_STOPS = 'button,a,input,select,summary,[role="separator"]';
// What offers Quote selection: the pill, the ⋯ and +. A press on one moves
// the focus and can let the selection go, so what it would quote is taken as
// it is pressed (Reader.hold); what the ⋯ or + then opens is where it is used.
const QUOTE_OFFERS = '#quote-selection,#reader-menu,#plus-button';
const KEPT = 'Your reply to the last one is kept.';
// A blocked image named where the save status sits, short enough for its one
// line: "Finish IMG_3307.heic first". Send says the whole sentence when pressed.
const BLOCKED = /^Finish or remove the image (.+) before sending\.$/;
const shortBarrier = barrier => { const named = BLOCKED.exec(barrier); return named ? `Finish ${named[1]} first` : barrier; };

const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const visible = el => el.getClientRects().length && !el.disabled && !el.hidden;
// The same message, shown again: its reply sent elsewhere (In), a saved
// version adopted, its access checked. Your place holds through it.
const sameSource = (a, b) => Boolean(a && b && a.kind === b.kind && a.id === b.id);
// What a quote names as its source: a message's quote says which revision of
// its words it was taken from (docs/message-edit.md), 1 for one never edited;
// a Notebook page's source names its revision already.
// Where words a Range covers are on screen, top and bottom: the boxes of the
// characters it holds. A range let go at the very start of the next passage
// holds none of it, and the empty box it gives there is no words.
const wordsBox = range => {
  let top = Infinity, bottom = -Infinity;
  for (const box of range.getClientRects()) if (box.width > 0) { top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom); }
  if (top <= bottom) return { top, bottom };
  const whole = range.getBoundingClientRect();
  return { top: whole.top, bottom: whole.bottom };
};
// revision: the revision the words quoted come from, when they were taken
// elsewhere than the Reader (a card on the topic page); else the one it shows.
const quoteSource = (source, revision = revisionOf(source)) => (source.source_ref.kind === 'message' ? { ...structuredClone(source.source_ref), revision } : structuredClone(source.source_ref));

// The Reader steps as the eye goes down the topic page (docs/reply-stacks.md):
// ↑ is the message above the one open, Previous, and ↓ the one below, Next,
// down a stack to its newer replies and on to the stack below. The page says
// which those are (its next and previous, in the page's own order); the up and
// down buttons, their words and the ⌘↑/⌘↓ keys all read this one rule.
const NEWEST_ON_TOP = true;
const neighborAt = where => (where === 'above') === NEWEST_ON_TOP ? 'next' : 'previous';
const STEPPING = { above: { glyph: '↑', key: 'ArrowUp' }, below: { glyph: '↓', key: 'ArrowDown' } };

export class Reader {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.dialog = document.querySelector('#reader');
    this.field = document.querySelector('#writing-body');
    this.sourceBody = document.querySelector('#source-body');
    this.mac = onMac();
    this.mode = 'reply';
    this.positions = new Map();
    this.hover = null;
    this.held = null;
    this.pointer = null;
    this.source = null;
    this.sessions = null;
    this.viewToken = 0;
    this.narrow = window.matchMedia('(max-width: 760px)');
    this.narrow.addEventListener('change', () => { this.placeEnd(); if (this.dialog.open) this.applyLayout(); });
    this.bind();
  }
  // Capture the source where the gesture began. A step, close or access change
  // during the gesture cannot fold another source or touch private writing.
  bindSwipe() {
    messageFoldSwipe(this.sourceBody, () => {
      const source = this.source;
      const available = () => this.dialog.open && this.source === source && source?.source_ref?.kind === 'message'
        && !this.presentation?.sourceUnavailable && !this.presentation?.availabilityUnconfirmed;
      return available() ? () => { if (available()) this.callbacks.foldMessage?.(source); } : null;
    });
  }
  $(id) { return this.dialog.querySelector(`#${id}`); }
  get editor() { return this.sessions?.[this.mode]; }
  admits(editor = this.editor, presentation = this.presentation) { return this.callbacks.admits?.(presentation, editor) ?? true; }
  // Typing, quoting and naming recipients: these go on while a step waits.
  writes(editor = this.editor, presentation = this.presentation) { return this.callbacks.writes?.(presentation, editor) ?? this.admits(editor, presentation); }

  bind() {
    // Naming someone on a phone: the who panel's named chips and + Someone,
    // then the naming sheet (docs/reader.md).
    this.naming = { opener: this.$('recipient-open'), sheet: this.$('recipient-sheet'), field: this.$('recipient-input'),
      back: [this.$('recipient-back'), this.$('recipient-done')], named: this.$('recipient-named'), add: name => this.addName(name), names: () => this.own() };
    this.compose = new ComposeBar({ root: this.$('reader-composer'), field: this.field, notice: this.$('reader-notice'),
      panels: { who: this.$('who-panel'), plus: this.$('plus-panel') }, openers: { who: this.$('who-chip'), plus: this.$('plus-button') },
      // + asks the clipboard as it opens, so its first tile says Paste image when it can.
      taller: this.$('taller-field'), naming: this.naming, changed: (_state, panel) => { if (panel === 'plus') this.checkClipboard(); this.paintLine(); },
      // The reply measuring itself as it is typed in leaves the message where it was (ComposeBar.fit).
      holds: () => { const top = this.sourceBody.scrollTop; return () => this.moveTo(top); } });
    this.$('note-chip').onclick = () => this.switchMode('reply');
    // A mouse's press on Quote keeps the selection; a finger's is not held
    // back, since WebKit then sends no click (what + was pressed on is held).
    this.$('plus-quote').onpointerdown = event => { if (event.pointerType === 'mouse') event.preventDefault(); };
    this.$('plus-quote').onclick = () => { this.compose.close(); this.quote(); };
    // A quote pill shows while words are selected or a passage is pressed lit.
    document.addEventListener('selectionchange', () => { if (this.dialog.open) this.paintQuote(); });
    // A tap on the message on a phone puts the keyboard away and folds the
    // reply to its line, its writing kept. A press that selects words, a
    // long-press, a link or a control is not such a tap.
    this.sourceBody.addEventListener('pointerdown', event => { this.pressedBy = event.pointerType; }, true);
    this.sourceBody.addEventListener('click', event => {
      if (this.pressedBy !== 'touch' || event.target.closest?.('a,button') || window.getSelection()?.isCollapsed === false) return;
      this.compose?.fold();
    });
    // The words just quoted keep showing while the message's room
    // changes: the reply growing with the quote, the keyboard coming up, the
    // lines wrapping anew. A scroll of the message the Reader did not make is
    // the person's, however made (a wheel, a finger, the keys, a drag of its
    // scrollbar), and from then the message is theirs to place (scrolled).
    new ResizeObserver(() => { if (this.dialog.open) this.alignKept(); }).observe(this.sourceBody);
    for (const forget of ['wheel', 'touchmove', 'keydown']) this.sourceBody.addEventListener(forget, () => { this.kept = null; }, { passive: true });
    this.sourceBody.addEventListener('scroll', () => this.scrolled(), { passive: true });
    // ↑ Previous · ↓ Next at the end of the message, where a thumb reaches on a
    // phone (placeEnd); they are the header's arrows, by another way. Their words are
    // drawn by aim.css, so the message's text stays the message's alone.
    this.endLine = node('p', undefined, 'reader-end');
    this.endLine.setAttribute('aria-label', 'Other messages');
    for (const where of ['above', 'below']) {
      const header = this.$(`${neighborAt(where)}-message`), above = where === 'above';
      const end = node('button', undefined, 'end-step'); end.type = 'button';
      end.dataset.words = `${STEPPING[where].glyph} ${above ? 'Previous' : 'Next'}`;
      end.setAttribute('aria-label', above ? 'Previous message' : 'Next message');
      end.onclick = () => header.click();
      new MutationObserver(() => { end.disabled = header.disabled; }).observe(header, { attributes: true, attributeFilter: ['disabled'] });
      this.endLine.append(end);
    }
    this.$('reader-close').onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.escape(); });
    // A click outside closes as × does: the writing, quotes and images are kept.
    closeOnOutsideClick(this.dialog, () => this.close(), window);
    this.$('reader-parent').onclick = () => this.close('parent');
    this.bindDivider();
    this.bindSwipe();
    this.$('toggle-note').onclick = () => this.switchMode();
    // What a press on the pill, the ⋯ or + would quote is taken as it
    // presses (hold), or as its key is pressed: each press takes it afresh.
    this.dialog.addEventListener('pointerdown', event => {
      const offer = event.target.closest?.(QUOTE_OFFERS);
      if (offer) this.hold(offer.id);
    }, true);
    this.dialog.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.(QUOTE_OFFERS)) this.hold(event.target.id);
    }, true);
    // A mouse's press on the pill is kept from taking the selection and focus.
    // A finger's cannot be, since WebKit then sends no click, and in Chrome it
    // lets go of the selection before the click: the pill quotes what was held
    // as it was pressed, and stays until the click or the finger slides off.
    const pill = this.$('quote-selection');
    pill.onpointerdown = event => { if (event.pointerType === 'mouse') event.preventDefault(); };
    const letGo = () => { if (this.held?.by === 'quote-selection') this.held = null; this.paintQuote(); };
    pill.addEventListener('pointercancel', letGo);
    pill.addEventListener('pointerleave', event => { if (event.buttons) letGo(); });
    pill.onclick = () => this.quote();
    this.$('send-reply').onclick = () => this.mode === 'note' ? this.saveNote() : this.send(false);
    // Add image, or Paste image when the clipboard is known to hold one
    // (image-pick.mjs); Choose file beside it then still opens the picker.
    this.$('add-image').onclick = async () => {
      if (!this.admits()) return;
      if (this.pasteReady) {
        const file = await clipboardImage();
        if (file) { await this.addImages([namedPastedImage(file)]); return; }
        this.pasteReady = false; this.paintStatus();
      }
      this.chooseFile();
    };
    this.$('choose-image').onclick = () => { if (this.admits()) this.chooseFile(); };
    this.field.addEventListener('focus', () => this.checkClipboard());
    window.addEventListener('focus', () => { if (this.dialog.open) this.checkClipboard(); });
    this.$('cancel-image').onclick = () => { this.cancelImagePicker(); this.$('add-image').focus(); };
    this.$('image-file').addEventListener('cancel', () => this.cancelImagePicker());
    this.$('image-file').onchange = async event => {
      const picker = this.imagePicker, file = event.target.files?.[0]; this.imagePicker = null;
      if (!picker) { if (file) this.notice('That image selection expired. Choose it again.'); return; }
      try { await picker.uploads.choose(picker.token, file); }
      catch (error) { this.notice(error); }
      finally { this.paintStatus(); }
    };
    for (const where of ['above', 'below']) {
      const neighbor = neighborAt(where), button = this.$(`${neighbor}-message`);
      const words = `${where === 'above' ? 'Previous' : 'Next'} message (${where})`;
      button.textContent = STEPPING[where].glyph; button.setAttribute('aria-label', words); button.title = words;
      button.onclick = () => this.stepTo(where);
      this.$('reader-stepping').append(button);
    }
    // A tap on the other destination's chip moves the reply there; the chips
    // then show where it went, or stay put if it could not move.
    this.$('reply-destination').onclick = event => {
      const chip = event.target.closest?.('button[data-destination]');
      if (!chip || chip.getAttribute('aria-pressed') === 'true') return;
      Promise.resolve(this.callbacks.destination(chip.dataset.destination)).finally(() => this.paintDestination());
    };
    // Writing can take the author a reply is offered to, so the choice is redrawn with it.
    // A notice says what last happened; writing on is the next thing, so it goes.
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.writes(),
      beforeEdit:()=>this.disarm(),changed:editor=>{if(!this.quoting)this.notice('');this.callbacks.edit(editor);this.paintStatus();this.paintChoice();this.images?.update();}});
    this.field.addEventListener('paste', event => this.paste(event));
    // #img lists the topic's recent images under the writing (image-pick.mjs).
    this.images = new ImagePick({ field: this.field, host: this.field,
      admits: () => this.mode === 'reply' && this.writes() && !this.writingReadOnly() && Boolean(this.callbacks.images),
      load: () => this.callbacks.images(this.editor), thumb: item => this.callbacks.imageBytes(item),
      choose: item => this.pickImage(item) });
    this.field.addEventListener('keydown', event => this.images.key(event));
    // Clicking a passage lights it for Return, as moving over it does while
    // Return would quote. Shift-click extends the light, from a dragged
    // selection when there is one, and the browser's own selection is kept
    // from growing beside it, so what lights is what quotes.
    this.sourceBody.addEventListener('pointerdown', event => {
      // A link is only a link: pressing it lights no passage to quote.
      if (event.target.closest?.('a,button,.reader-end')) return;
      this.sourceBody.focus({ preventScroll: true });
      if (event.pointerType !== 'touch' && event.button === 0 && this.source) this.light(event.target, event.shiftKey, true);
    });
    this.sourceBody.addEventListener('mousedown', event => { if (event.shiftKey && event.button === 0 && this.hover) event.preventDefault(); });
    // The message wears its focus ring only when a keyboard user Tabs onto it,
    // not when the Reader puts focus there itself (see aim.css).
    // WebKit can drop the Reader's selected words when Tab moves focus from
    // the article to a control. Keep the range for this one keyboard move.
    let tabSelection = null;
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      this.tabbing = true;
      const selection = window.getSelection();
      tabSelection = null;
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (this.sourceBody.contains(range.commonAncestorContainer)) {
        const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
        tabSelection = { range: range.cloneRange(), backwards };
      }
    }, true);
    this.dialog.addEventListener('pointerdown', () => { this.tabbing = false; tabSelection = null; }, true);
    this.sourceBody.addEventListener('focusout', () => this.sourceBody.removeAttribute('data-tabbed'));
    this.dialog.addEventListener('focusin', event => {
      const saved = tabSelection, selection = window.getSelection();
      tabSelection = null;
      if (this.tabbing && saved && !saved.range.collapsed && this.sourceBody.contains(saved.range.commonAncestorContainer) &&
          !event.target.closest('textarea,input,select,[contenteditable]') && selection?.isCollapsed) {
        const range = saved.range;
        if (saved.backwards) selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
        else selection.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
      }
      if (event.target === this.sourceBody) this.sourceBody.toggleAttribute('data-tabbed', Boolean(this.tabbing));
      this.tabbing = false;
      if (!this.returnQuotes()) this.disarm();
    });
    this.sourceBody.addEventListener('pointermove', event => this.point(event));
    this.dialog.addEventListener('keydown', event => this.key(event));
  }

  async paste(event) {
    const items = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/'));
    if (!items.length) return; // Text-only paste belongs to the native editor.
    event.preventDefault();
    // Capture clipboard files before any asynchronous work.
    return this.addImages(items.map(item => item.getAsFile()));
  }

  // An image picked from the #img list: the #img words, which the list has
  // selected, come out as one edit, and the image's verified bytes go in as a
  // pasted image does, a copy of its own in this reply.
  async pickImage(item) {
    const editor = this.editor, presentation = this.presentation;
    this.input.deleteSelection();
    let file = null;
    try {
      const blob = await readInTurn(() => this.callbacks.imageBytes(item), { first: true });
      file = new File([blob], item.attachment.name, { type: blob.type });
    } catch (error) { if (this.editor === editor && this.presentation === presentation) this.notice([`${item.attachment.name}:`, error]); return; }
    if (this.editor === editor && this.presentation === presentation) return this.addImages([file]);
  }

  // Images pasted, picked or read from the clipboard, each through the same
  // admission and byte owner as Add image.
  async addImages(files) {
    try {
      const editor = this.editor, presentation = this.presentation;
      const refusal = pasteImageError(editor, this.mode, this.writingReadOnly());
      if (refusal) throw Error(refusal);
      if (!this.admits(editor, presentation)) throw Error(this.callbacks.closing?.(presentation) ? CLOSING : STEP_WAITS);
      const uploads = this.callbacks.uploads?.(editor);
      if (!uploads) throw Error('Images are not available in this reply yet.');
      if (files.some(file => !file)) throw Error('Could not read the pasted image. Try Add image to choose the file.');
      const choices = files.map(file => {
        try {
          return uploads.choose(uploads.reserve(presentation), namedPastedImage(file));
        } catch (error) { return Promise.reject(error); }
      });
      const errors = (await Promise.allSettled(choices)).filter(result => result.status === 'rejected');
      if (errors.length && this.editor === editor && this.presentation === presentation && this.mode === 'reply' && this.admits(editor, presentation)) {
        this.notice(errors.map(result => result.reason));
      }
    } catch (error) { this.notice(error); }
    finally { this.paintStatus(); }
  }

  show(source, sessions, { opener, topics = [], canPrevious = false, canNext = false, presentation, mode = 'reply' } = {}) {
    ++this.viewToken;
    this.presentation = presentation;
    // Moving on to another message from one whose reply holds writing says it
    // is kept. The same message shown again is no move: the composer, its
    // panel, the focus and the place in the message stay as they are.
    const same = this.dialog.open && sameSource(this.source?.source_ref, source.source_ref);
    const left = this.dialog.open && this.sessions && !same && holdsWriting(this.sessions.reply.draft);
    if (this.source) this.rememberPlace();
    this.source = source;
    this.sessions = sessions;
    // A name typed in To stays with the reply to the message it was typed for.
    this.compose?.writes(this.placeKey());
    if (this.layoutInstance !== sessions.reply.context.instanceId) {
      this.layoutInstance = sessions.reply.context.instanceId;
      let storage;
      try { storage = window.localStorage; } catch { /* no persisted preference */ }
      this.layout = new ReaderLayout(this.layoutInstance, storage);
    }
    this.mode = mode;
    this.notice('');
    this.$('source-update').hidden = true;
    this.$('source-changes').hidden = true;
    // Whether the opener wore the keys' ring as the Reader opened, to wear it
    // again when the focus goes back (a row of the outline a press or the keys
    // chose, item 462), however the Reader is closed: read at each opening, so
    // the same message opened by the keys and then by the mouse wears none the
    // second time; kept while the Reader steps from message to message.
    const next = opener ?? this.opener ?? document.activeElement;
    if (next !== this.opener || !this.dialog.open) this.openerRinged = Boolean(next?.matches?.(':focus-visible'));
    this.opener = next;
    this.disarm();
    this.topics = topics;
    // The cover's sheet is opened by a press, for the message it was pressed on: any other message, or this one
    // opened again, starts at the cover's one line (paintCover).
    if (!same) this.$('reader-cover').open = false;
    this.paintTitle(source, topics);
    this.paintOrigin(source);
    // Where the reply goes: the topic's name, or, for a message in an ordinary
    // topic, a choice of this topic or the outcome's conversation
    // (outcome-conversation.mjs), whose chips stay, so the one pressed keeps the focus.
    const destination = this.$('reply-destination');
    const here = topics.find(topic => topic.id === sessions.reply.context.topicId) ?? topics[0];
    this.offered = Boolean(this.callbacks.destinations?.(destination, source, sessions.reply.context.topicId));
    if (!this.offered) destination.replaceChildren(node('span', here?.title ?? '', 'destination-title'));
    this.$('reader-parent').disabled = !source.topic_id;
    this.$('reader-stepping').hidden = source.source_ref.kind !== 'message';
    this.$('previous-message').disabled = !canPrevious;
    this.$('next-message').disabled = !canNext;
    this.drawSource(source.body ?? '');
    this.drawAttachments(this.$('source-attachments'), source.attachments);
    this.drawEditor();
    this.paintPending();
    if (!this.dialog.open) this.dialog.showModal();
    // A message opens to be read: the reply is its one line until written in.
    if (!same) { this.kept = null; this.held = null; this.compose?.fold(); }
    if (left) this.notice(KEPT);
    this.applyLayout();
    this.moveTo(this.positions.get(this.placeKey()) ?? 0);
    if (mode === 'note') this.field.focus({ preventScroll: true });
    else if (!same) this.sourceBody.focus({ preventScroll: true });
  }

  // What changed in the Notebook page shown since the revision the reader
  // last read (since), above the page as it now stands.
  showChanges(since, before, after) {
    this.$('source-changes-title').textContent = `What changed since you read revision ${since}`;
    paintChanges(this.$('source-changes-body'), before, after);
    this.$('source-changes').open = true; this.$('source-changes').hidden = false;
  }

  get layoutShape() { return this.narrow.matches ? 'stacked' : this.layout.mode; }
  // Wide or Stacked, from the ⋯ menu; a phone is always stacked, so it has no choice.
  get layoutChoice() { return this.narrow.matches || !this.layout ? null : this.layout.mode === 'wide' ? 'Stacked layout' : 'Wide layout'; }
  toggleLayout() {
    this.layout.setMode(this.layout.mode === 'wide' ? 'stacked' : 'wide');
    this.applyLayout();
  }

  applyLayout() {
    const place = this.captureVisiblePlace();
    const shape = this.layoutShape, share = this.layout.share('wide');
    this.dialog.dataset.layout = shape;
    // In hundredths of the room, so when one pane keeps a floor (aim.css) the other
    // still takes all that is left: shares that sum to under 1fr would leave a gap.
    this.dialog.style.setProperty('--reading-share', `${(1 - share) * 100}fr`);
    this.dialog.style.setProperty('--writing-share', `${share * 100}fr`);
    this.$('reader-divider').setAttribute('aria-valuenow', String(Math.round(share * 100)));
    this.$('reader-divider').setAttribute('aria-valuetext', `${Math.round(share * 100)} percent writing space`);
    this.restoreVisiblePlace(place);
    this.compose?.fit();
    // Native selection paints the line box, while an inline background paints
    // the glyph box. Extend only the paint, using this source's actual metrics,
    // to whole pixels: a selection paints every pixel its line box touches, at
    // whatever fraction of a pixel the line starts.
    const glyphHeight = (this.sourceBody.querySelector(':scope > span:not(.md-block)') ?? this.sourceBody.firstElementChild)?.getClientRects()[0]?.height;
    const lineHeight = parseFloat(getComputedStyle(this.sourceBody).lineHeight);
    if (glyphHeight > 0 && Number.isFinite(lineHeight)) {
      this.sourceBody.style.setProperty('--quote-overhang', `${overhang(glyphHeight, lineHeight)}px`);
    }
  }

  captureVisiblePlace() {
    const top = this.sourceBody.getBoundingClientRect().top;
    const span = [...this.sourceBody.children].find(part => part.getBoundingClientRect().bottom > top);
    return span ? { span, offset: span.getBoundingClientRect().top - top } : null;
  }

  restoreVisiblePlace(place) {
    if (place?.span.isConnected) this.moveTo(this.sourceBody.scrollTop + place.span.getBoundingClientRect().top - this.sourceBody.getBoundingClientRect().top - place.offset);
  }

  bindDivider() {
    const divider = this.$('reader-divider');
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.layout) return;
      event.preventDefault(); divider.focus({ preventScroll: true });
      const main = this.dialog.querySelector('.reader-main').getBoundingClientRect();
      const grip = divider.getBoundingClientRect();
      this.drag = { id: event.pointerId, x: event.clientX, share: this.layout.share('wide'), extent: main.width - grip.width };
      divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove', event => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId || drag.extent <= 0) return;
      const delta = drag.x - event.clientX;
      if (!drag.moved && Math.abs(delta) < 4) return;
      drag.moved = true;
      this.layout.setShare(drag.share + delta / drag.extent, 'wide');
      this.applyLayout();
    });
    const end = event => { if (this.drag?.id === event.pointerId) this.drag = null; };
    divider.addEventListener('pointerup', end);
    divider.addEventListener('pointercancel', end);
    divider.addEventListener('lostpointercapture', end);
    divider.addEventListener('dblclick', () => { this.layout.resetShare('wide'); this.applyLayout(); });
    divider.addEventListener('keydown', event => {
      const arrows = ['ArrowLeft', 'ArrowRight'];
      if (!arrows.includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      const direction = event.key === arrows[0] ? 1 : -1;
      this.layout.setShare(this.layout.share('wide') + direction * (event.shiftKey ? .1 : .02), 'wide');
      this.applyLayout();
    });
  }

  // The source as passages, its Markdown shown as written to be read (message-format.mjs). A Notebook page's image
  // lines show their images, read through the page (page-image.mjs, docs/decks.md "Images in a card"). A message's
  // words its agent author changed after this person read them show struck through where they stood (item 614).
  drawSource(body) {
    const source = this.source, page = source?.source_ref?.kind === 'memory' && this.callbacks.pageImage;
    drawPassages(this.sourceBody, body, document, { copyFences: true, struck: source?.source_ref?.kind === 'message' ? source.struck?.cuts : null,
      images: page ? pageImages(source, attachment => this.callbacks.pageImage(attachment, source.source_ref)) : null });
    this.placeEnd();
  }

  // The end line is there only on a phone, where the header's arrows are out
  // of a thumb's reach; elsewhere the message's passages are all it holds.
  placeEnd() {
    if (this.narrow.matches && this.source?.source_ref?.kind === 'message') this.sourceBody.append(this.endLine);
    else this.endLine?.remove();
  }

  point(event) {
    if (event.pointerType === 'touch' || event.buttons || !this.source || event.target.closest?.('a,button')) return;
    // Nothing lights to promise a quote that Return would not make.
    if (!this.returnQuotes()) return;
    const current = { x: event.clientX, y: event.clientY };
    if (this.pointer && Math.hypot(current.x - this.pointer.x, current.y - this.pointer.y) < 2) return;
    this.pointer = current;
    this.light(event.target, event.shiftKey);
  }

  // Return quotes from anywhere in the reader except the writing and its
  // controls, where it makes a new line or presses the control; key() decides
  // by the same rule.
  returnQuotes(at = document.activeElement) {
    return !!at && this.dialog.contains(at) && at !== this.field && !at.closest(QUOTE_STOPS);
  }

  light(target, extend, pressed = false) {
    const span = target.closest('[data-start]');
    if (!span || !this.sourceBody.contains(span)) return;
    if (extend) this.adoptSelection();
    const start = Number(span.dataset.start), end = Number(span.dataset.end);
    const anchor = extend && this.hover ? this.hover.anchor : { start, end };
    this.hover = { anchor, start: Math.min(anchor.start, start), end: Math.max(anchor.end, end), pressed: pressed || Boolean(extend && this.hover?.pressed) };
    for (const part of this.sourceBody.children) part.classList.toggle('hover-quote', Number(part.dataset.start) < this.hover.end && Number(part.dataset.end) > this.hover.start);
    this.paintQuote();
  }

  // Something to quote: words selected in the message, or a passage pressed
  // lit. A passage lit only by the pointer passing over it shows no pill;
  // Return still quotes it.
  get chosen() {
    const p = this.presentation;
    if (!this.source || p?.sourceUnavailable || p?.availabilityUnconfirmed) return false;
    const selection = window.getSelection();
    const selected = selection?.rangeCount && !selection.isCollapsed && this.sourceBody.contains(selection.getRangeAt(0).commonAncestorContainer);
    return Boolean(selected || this.hover?.pressed);
  }
  // Quote selection, in the ⋯ and in +: what is chosen now, or what was
  // chosen as the ⋯ or + was pressed.
  get quotable() { return this.chosen || Boolean(this.held && this.source); }
  // Takes what a press on an offer of Quote (by: its id) would quote, before
  // the press moves the focus or lets the selection go; nothing when nothing is chosen.
  hold(by) {
    this.held = this.chosen ? { excerpt: this.selectedPassage(), place: this.quotedPlace(), by } : null;
    this.paintQuote();
  }
  paintQuote() {
    if (!this.compose) return;
    this.$('quote-selection').hidden = !this.chosen && this.held?.by !== 'quote-selection';
    this.$('plus-quote').disabled = !this.quotable;
  }

  // A light extended after a drag grows from what was dragged: the passages
  // the browser's selection touches become its anchor, and the selection gives
  // way to it, since Return would otherwise quote the selection instead.
  adoptSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const from = this.sourceOffset(range.startContainer, range.startOffset), to = this.sourceOffset(range.endContainer, range.endOffset, true);
    if (from === null || to === null) return;
    const parts = [...this.sourceBody.children].filter(part => Number(part.dataset.start) < to && Number(part.dataset.end) > from);
    if (!parts.length) return;
    const anchor = { start: Number(parts[0].dataset.start), end: Number(parts.at(-1).dataset.end) };
    this.hover = { anchor, ...anchor };
    selection.removeAllRanges();
  }

  // Where a selection boundary falls in the source text; null outside the
  // source. Each node the passages drew knows the characters of the source it
  // shows (message-format.mjs, sourcePosition), so a selection over formatted
  // words, a list or a table quotes the author's own Markdown for it, a mark
  // it covers whole among it. A link showing other words than the source's
  // (a topic's name, a [named](link)) is taken whole: from its start, or to
  // its end when end is set.
  sourceOffset(container, offset, end = false) {
    if (container === this.sourceBody) return Number(this.sourceBody.children[offset]?.dataset.start ?? this.source.body.length);
    let span = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    while (span && span.parentElement !== this.sourceBody) span = span.parentElement;
    if (!span) return null;
    return sourcePosition(container, offset, end) ?? Number(end ? span.dataset.end : span.dataset.start);
  }

  disarm() {
    this.hover = null;
    this.pointer = null;
    for (const span of this.sourceBody.querySelectorAll('.hover-quote')) span.classList.remove('hover-quote');
    this.paintQuote();
  }

  // Quoting keeps your place: what showed of the words quoted stays where it
  // was on screen, so what is answered shows while it is answered. Only where
  // the reply or the keyboard comes to cover it does the message move, the
  // least that shows it just above them (as much of it as the room holds);
  // words quoted from out of sight come into sight the same least way. Kept
  // so as the message's room changes, until the person scrolls the message.
  keepAbove(place) { this.kept = place ?? null; this.alignKept(); }
  // The message moved by the Reader itself; what it was moved to is known, so
  // the scroll it makes is not taken for the person's (scrolled).
  moveTo(top) { this.sourceBody.scrollTop = top; this.lastTop = this.sourceBody.scrollTop; }
  // A scroll the Reader did not make is the person's, and lets go of the
  // words kept in sight. The browser's own pull of a message scrolled to its
  // end, as its room grows there (the reply growing shorter), is not one.
  scrolled() {
    const body = this.sourceBody, now = body.scrollTop, before = this.lastTop;
    this.lastTop = now;
    if (now === before || now < before && now >= body.scrollHeight - body.clientHeight - 1) return;
    this.kept = null;
  }
  room() {
    const box = this.sourceBody.getBoundingClientRect(), style = getComputedStyle(this.sourceBody);
    return { top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom) };
  }
  alignKept() {
    if (!this.kept?.passage.isConnected) { this.kept = null; return; }
    // Lines wrapped anew (a phone turned, Wide and Stacked changed) put the
    // words elsewhere in their passage: they are measured again, whole.
    const width = this.sourceBody.clientWidth;
    if (width !== this.kept.width) {
      const words = this.kept.words(), at = this.kept.passage.getBoundingClientRect().top;
      Object.assign(this.kept, { top: words.top - at, bottom: words.bottom - at, width });
    }
    const room = this.room(), at = this.kept.passage.getBoundingClientRect().top, top = at + this.kept.top, bottom = at + this.kept.bottom;
    if (bottom > room.bottom && top > room.top) this.moveTo(this.sourceBody.scrollTop + Math.min(bottom - room.bottom, top - room.top));
    else if (top < room.top && bottom < room.bottom) this.moveTo(this.sourceBody.scrollTop + Math.max(top - room.top, bottom - room.bottom));
  }

  // The source's own words a selection covers, never what the page shows for
  // them: a link showing a topic's name is quoted as the words it stands for.
  selectedPassage() {
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (this.sourceBody.contains(range.startContainer) && this.sourceBody.contains(range.endContainer)) {
        const from = this.sourceOffset(range.startContainer, range.startOffset), to = this.sourceOffset(range.endContainer, range.endOffset, true);
        return this.source.body.slice(from, to);
      }
    }
    return this.hover ? this.source.body.slice(this.hover.start, this.hover.end) : '';
  }

  // given: words chosen on the message's card (quoteFrom), quoted as they are,
  // and named as of revision, the revision of the message the card shows.
  quote(given = '', revision = undefined) {
    if (this.presentation?.sourceUnavailable || this.presentation?.availabilityUnconfirmed) { this.notice('Source availability needs to be checked before quoting.'); return; }
    const held = this.held; this.held = null;
    const excerpt = given || this.selectedPassage() || held?.excerpt;
    if (!excerpt || !this.sessions) return;
    const place = this.quotedPlace() ?? held?.place;
    // A quote is writing on, so the last notice goes as it starts; what the
    // quote itself does (leaving a note cancels a step that waits) is said
    // after, and its own writing does not take that away.
    this.notice('');
    this.quoting = true;
    try { this.quoteInto(excerpt, place, given ? revision : undefined); } finally { this.quoting = false; }
  }

  quoteInto(excerpt, place, revision = undefined) {
    if (this.mode === 'note') this.switchMode('reply');
    const editor = this.sessions.reply;
    if (!this.writes(editor)) return;
    if (editor.adopting || recoveryReadOnly(editor)) { this.notice('Review saved image copies before changing this reply.'); return; }
    // Quoting on a laptop opens room to reply; a phone has only its stacked layout.
    if (!this.narrow.matches && this.layout.mode !== 'wide') {
      this.layout.setMode('wide'); this.applyLayout();
    }
    const prefix = editor.draft.body ? (editor.draft.body.endsWith('\n\n') ? '' : editor.draft.body.endsWith('\n') ? '\n' : '\n\n') : '';
    const addition = prefix + excerpt.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
    // The quote is writing like any other, so it goes through the editor's
    // edit, which brings in the author a reply is offered to.
    editor.edit({ quotes: [...editor.draft.quotes, { source: quoteSource(this.source, revision), excerpt }] });
    // The message's selection is let go before the field takes focus: once
    // the field is focused the document's selection is its caret, and
    // clearing it then leaves no caret drawn until the window is refocused.
    window.getSelection()?.removeAllRanges();
    this.field.focus({ preventScroll: true });
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
    this.insertText(addition);
    // The cursor sits after the quote and its blank line, ready to type, and
    // the field shows it however tall the writing has grown: an engine may
    // leave the caret drawn before a trailing newline, or short of the
    // field's bottom padding.
    const end = this.field.value.length;
    this.compose?.fit();
    this.field.setSelectionRange(end, end);
    this.field.scrollTop = this.field.scrollHeight;
    this.disarm();
    this.keepAbove(place);
  }

  // Words chosen on the message's card in the topic (message-menu.mjs): a
  // passage lit there, or words selected, {start, end, text, revision}. Return
  // there quotes them as Return here would, the same words, kept in sight as
  // any quote is; false when the Reader shows another message. The quote names
  // the revision the card shows, whose words they are, though the Reader may
  // have read a newer one; there, the words at those places are others, and
  // nothing is selected for them.
  quoteFrom(ref, { start, end, text, revision }) {
    const at = this.source?.source_ref;
    if (!this.sessions || at?.kind !== ref.kind || at.id !== ref.id || !text) return false;
    const same = this.source.body?.slice(start, end) === text;
    const range = same ? rangeOf(this.sourceBody, start, end) : null, selection = window.getSelection();
    selection?.removeAllRanges();
    if (range) selection?.addRange(range);
    this.quote(text, revision);
    return true;
  }

  // Where the words a quote takes are, as it takes them: the words selected,
  // or the passages lit, and of them what shows (all of them when none
  // does), held as heights from the top of the passage they end in, which
  // scrolls with them. A passage can be taller than the screen: a log in a
  // code block, a long table.
  quotedPlace() {
    if (!this.compose) return null;
    const selection = window.getSelection(), lit = [...this.sourceBody.querySelectorAll('.hover-quote')];
    let passage = null, words = null;
    let measure = null;
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0).cloneRange();
      // The passage holding the last word selected: a drag let go at the
      // very start of the next passage holds none of that one.
      const to = this.sourceOffset(range.endContainer, range.endOffset, true);
      passage = to === null ? null : [...this.sourceBody.children].find(part => Number(part.dataset.start) < to && to <= Number(part.dataset.end)) ?? null;
      measure = () => wordsBox(range);
    }
    if (!passage && lit.length) {
      const first = lit[0], last = lit.at(-1);
      passage = last;
      measure = () => ({ top: first.getBoundingClientRect().top, bottom: last.getBoundingClientRect().bottom });
    }
    if (!passage) return null;
    words = measure();
    const room = this.room(), at = passage.getBoundingClientRect().top;
    const top = Math.max(words.top, room.top), bottom = Math.min(words.bottom, room.bottom), shows = top < bottom;
    // The words themselves are kept too, to be measured again once the lines wrap anew (alignKept).
    return { passage, top: (shows ? top : words.top) - at, bottom: (shows ? bottom : words.bottom) - at, words: measure, width: this.sourceBody.clientWidth };
  }

  // The reply, with the cursor after what is already written: Reply, or Return,
  // on a lit message on the topic page (message-menu.mjs). Nothing is quoted.
  reply(ref) {
    const at = this.source?.source_ref;
    if (!this.sessions || at?.kind !== ref.kind || at.id !== ref.id) return false;
    if (this.mode === 'note') this.switchMode('reply');
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
    return true;
  }

  caret() { return this.input.caret(); }
  placeKey() { return JSON.stringify(this.source?.source_ref); }
  rememberPlace() { this.positions.set(this.placeKey(), this.sourceBody.scrollTop); }

  switchMode(next = this.mode === 'reply' ? 'note' : 'reply') {
    if (!this.sessions) return;
    this.cancelImagePicker();
    if (this.editor && !recoveryReadOnly(this.editor) && !this.editor.adopting) { this.editor.draft.caret = this.caret(); this.callbacks.edit(this.editor); }
    this.mode = next;
    ++this.viewToken;
    this.callbacks.mode?.(next);
    this.disarm();
    this.drawEditor();
    this.field.focus();
    const caret = this.editor.draft.caret ?? { start: this.field.value.length, end: this.field.value.length };
    this.field.setSelectionRange(caret.start, caret.end);
  }

  paintDestination() {
    const at = this.sessions?.reply?.context?.topicId;
    for (const chip of this.$('reply-destination').querySelectorAll('button[data-destination]')) chip.setAttribute('aria-pressed', String(chip.dataset.destination === at));
  }

  drawEditor() {
    const note = this.mode === 'note';
    this.images?.close();
    this.$('writing-label').textContent = note ? 'Private note' : 'Reply';
    this.paintNoteToggle();
    this.$('destination-label').hidden = note || (this.source.source_ref.kind === 'message' && !this.offered);
    this.callbacks.audiencePainted?.(note ? null : this.sessions?.reply?.context?.topicId ?? null);
    this.$('reply-audience').hidden = note;
    this.$('pending-submissions').hidden = note;
    this.$('writing-hint').textContent = note ? 'Only you · saved as you write · ⌘ Return when done' : 'Return for a new line · ⌘ Return to send';
    this.$('who-chip').hidden = note; this.$('note-chip').hidden = !note;
    this.field.classList.toggle('noting', note);
    // The note saves as it is written; Done only finishes, so it is not a second save.
    if (note) this.$('send-reply').textContent = 'Done';
    else { const word = node('span', 'Send', 'send-word'), keys = node('span', '⌘↵'); keys.setAttribute('aria-hidden', 'true'); this.$('send-reply').replaceChildren(word, ' ', keys); }
    this.$('send-reply').classList.toggle('primary', !note);
    this.field.value = this.editor.draft.body;
    this.paintImages();
    this.paintRecipients();
    this.paintChoice();
    this.paintStatus();
    this.compose?.fit();
  }

  // The reply's one line while reading: who it answers, in the words Send
  // will act on ("Reply to fable…", or "Whisper to fable…" answering a whisper), or "Draft" with the
  // writing's start when there is some; 👍 sits at its end while there is none.
  paintLine() {
    const editor = this.sessions?.reply, root = this.$('reader-composer');
    if (!editor || !this.editor || !root) return;
    const note = this.mode === 'note', names = this.names(editor);
    const { choice } = choiceOf(editor.draft, names, this.kindOf, this.answering());
    const who = list(names.map(id => this.callbacks.actorLabel?.(id) ?? id)), place = this.place(editor), at = place ? ` in ${place.name}` : '';
    this.field.placeholder = note ? 'Write a private note only you can see…' : !who ? `Reply${at}…`
      : choice === 'whisper' ? `Whisper to ${who}${at}…` : choice === 'ask' ? `Ask ${who}${at}…` : `Reply to ${who}${at}…`;
    const writing = written(this.editor.draft);
    if (writing) root.dataset.hasWriting = ''; else delete root.dataset.hasWriting;
    this.$('draft-tag').hidden = !writing || this.compose?.state !== 'line';
  }

  // The note's button says what a press does: write one, see the one you
  // have, or go back to the reply. Beside the reply it wears the note's
  // yellow while the message has a note, and its plain look once it has none.
  paintNoteToggle() {
    const toggle = this.$('toggle-note'), writing = this.mode === 'note';
    const has = !writing && Boolean(this.sessions?.note?.draft.body.trim());
    toggle.textContent = writing ? 'Back to reply' : has ? 'Show note' : 'Add note';
    toggle.title = writing ? 'Back to your reply' : has ? 'Your private note on this message, which only you can see' : 'A private note on this message that only you can see';
    toggle.toggleAttribute('data-has-note', has);
  }

  paintRecipients() {
    const editor = this.sessions.reply, presentation = this.presentation;
    // The author a reply answers is offered first, lit with whoever the
    // writing names. Taking someone off declines any offer of them, and writes
    // only when the writing already names them: typing takes the offer without
    // redrawing these chips, so the press, not the drawing, decides which.
    const named = recipientChoices(this.own(editor)).map(({ name }) => name);
    const off = name => this.removeName(name, editor, presentation);
    paintAddress(this.$('recipient-chips'), this.$('recipient-input'), { people: this.callbacks.addressable?.() ?? [], named: [...new Set(named)],
      nameOf: this.callbacks.actorLabel,
      reach: this.callbacks.reach, remove: off, toggle: (name, on) => on ? this.addName(name) : off(name),
      summary: this.naming && { host: this.naming.named, opener: this.naming.opener } });
    this.callbacks.recipientsPainted?.(this.own(editor), editor.context.topicId);
    // Who is named may have changed: what Send said goes if no longer true.
    this.compose?.settle();
  }

  // Names someone in the reply (a name typed in the name field, compose-bar.mjs
  // takeName, or tapped once); false when the reply cannot change now.
  addName(name) {
    const editor = this.sessions?.reply;
    if (!editor || !this.writes(editor) || editor.adopting || recoveryReadOnly(editor)) return false;
    if (!editor.draft.addressees.includes(name) && !(editor.offeredAddressees ?? []).includes(name)) {
      editor.edit({ addressees: [...editor.draft.addressees, name], ...naming(editor.draft, this.own(editor), this.kindOf, this.answering()) });
      this.callbacks.edit(editor); this.paintRecipients(); this.paintChoice();
    }
    return true;
  }

  // Takes someone off the reply. Removing someone declines any offer of them,
  // and writes only when the writing already names them.
  removeName(name, editor = this.sessions?.reply, presentation = this.presentation) {
    if (!editor || !this.writes(editor, presentation) || editor.adopting || recoveryReadOnly(editor)) return;
    editor.declineAddressee(name);
    if (editor.draft.addressees.includes(name)) {
      const rest = editor.draft.addressees.filter(item => item !== name);
      // A message to nobody neither asks, tells nor whispers.
      editor.edit({ addressees: rest, ...(rest.length ? {} : unnamed) });
      this.callbacks.edit(editor);
    }
    this.paintRecipients(); this.paintChoice();
  }

  // Whom the reply's chips name: the author it is offered to, then whoever it names.
  own(editor = this.sessions?.reply) { return editor ? [...(editor.offeredAddressees ?? []), ...editor.draft.addressees] : []; }
  // Who the reply goes to: the members its leading @names name, else whom its
  // chips name (at-names.mjs, the rule Core records it by).
  names(editor = this.sessions?.reply) { return editor ? addressedTo(editor.draft.body, this.members(editor), this.own(editor)) : []; }
  // Who the writing's destination can be sent to by name (app.mjs whisperPeople).
  members(editor = this.sessions?.reply) { return this.callbacks.people?.().members?.(editor?.context?.topicId) ?? []; }
  get kindOf() { return name => this.callbacks.people?.().kindOf(name); }
  // What decides the reply's default (whisper-choice.mjs defaultChoice): a reply to a whisper starts as one.
  answering() { return { answeringWhisper: Boolean(this.source?.whisper) }; }
  // Where the reply is posted when that is not the message's own topic, or
  // null: { name: "the conversation", note: what going there means }. The who
  // chip, its sentence, the field and the line under the chip say it.
  place(editor = this.sessions?.reply) {
    const to = editor?.context?.topicId, from = this.source?.topic_id;
    return to && from && to !== from ? this.callbacks.place?.(to) ?? { name: 'another topic', note: '' } : null;
  }

  // Whisper, Tell or Ask (whisper-choice.mjs), and who will see it, above Send.
  // A reply starts as a Tell, and a reply to a whisper as a whisper; a private note has no choice.
  // Writing posted elsewhere says where under the chip, and what that means.
  paintChoice() {
    const editor = this.sessions?.reply, row = this.$('intent-row'), place = this.mode === 'note' ? null : this.place(editor), note = this.$('destination-note');
    note.textContent = place?.note ?? ''; note.hidden = !place?.note;
    if (!editor || this.mode === 'note') { clearChoice(row, this.field, this.$('send-reply'), this.$('who-sentence'), this.$('writing-to')); this.paintLine(); return; }
    paintChoice(row, { draft: editor.draft, names: this.names(editor), kindOf: this.kindOf, everyone: this.callbacks.people?.().everyone ?? [],
      nameOf: this.callbacks.actorLabel,
      send: this.$('send-reply'), field: this.field, chip: this.$('who-chip'), lineHost: this.$('who-sentence'), readOnly: Boolean(this.field?.readOnly), ...this.answering(),
      place: place?.name ?? null, to: this.$('writing-to'), onChoose: choice => this.choose(choice) });
    this.paintLine();
  }

  choose(choice) {
    const editor = this.sessions?.reply;
    if (!editor || !this.writes(editor) || editor.adopting || recoveryReadOnly(editor)) { this.paintChoice(); return; }
    editor.edit(chosen(choice));
    this.callbacks.edit(editor); this.paintChoice();
  }

  drawAttachments(host, attachments = []) {
    host.replaceChildren();
    for (const attachment of attachments ?? []) host.append(node('span', attachment.name ?? attachment.id ?? 'Attached image', 'attachment-label'));
  }

  chooseFile() {
    try {
      const uploads = this.callbacks.uploads?.(this.editor);
      if (!uploads) return;
      const token = uploads.reserve(this.presentation);
      this.imagePicker = { uploads, token }; this.$('image-file').value = '';
      this.paintStatus(); this.$('image-file').click();
    } catch (error) { this.notice(error); }
  }

  // Whether the image button can say Paste image: asked when the writing or
  // the window takes focus, or + opens, never by prompting (image-pick.mjs).
  async checkClipboard() {
    const ready = await clipboardHoldsImage();
    if (ready !== Boolean(this.pasteReady)) { this.pasteReady = ready; this.paintStatus(); }
  }

  cancelImagePicker() {
    const picker = this.imagePicker; this.imagePicker = null;
    picker?.uploads.cancel(picker.token); this.$('image-file').value = '';
    this.paintStatus();
  }

  paintImages() {
    const host = this.$('writing-attachments'), editor = this.editor;
    const uploads = editor?.context.kind === 'reply' ? this.callbacks.uploads?.(editor) : null;
    if (!uploads) { this.drawAttachments(host, editor?.draft.attachments); return; }
    const presentation = this.presentation, active = this.admits(editor, presentation);
    paintImageRows(host, imageChoices(uploads, active), active, async (item, e, b) => {
      try {
        if (!this.admits(editor, presentation)) return;
        await uploads[item.method](e.id);
        // Remove takes its own button away; focus lands in the field only if
        // it was still there. Where the person has since put it, it stays.
        if (item.method === 'remove' && this.admits(editor, presentation) && [null, document.body, b].includes(document.activeElement)) this.field.focus();
      } catch (error) { if (this.admits(editor, presentation)) this.notice(error); }
      finally { if (b.isConnected) b.disabled = !this.admits(editor, presentation); this.paintStatus(); }
    }, id => uploads.preview(id));
  }

  paintStatus() {
    if (!this.editor) return;
    const editor = this.editor;
    const state = writingState(editor, { active: this.admits(editor), writable: this.writes(editor), note: this.mode === 'note', status: this.callbacks.status, sign: this.callbacks.sign });
    const barrier = this.mode === 'note' ? null : imageBarrier(editor), send = this.$('send-reply');
    this.$('save-state').textContent = barrier ? shortBarrier(barrier) : state.message; this.$('save-state').dataset.save = state.sign;
    if (barrier) this.$('save-state').dataset.blocked = ''; else delete this.$('save-state').dataset.blocked;
    if (this.callbacks.savedAt) paintSaveTime(this.$('save-state'), state.sign ? this.callbacks.savedAt(editor) : null);
    // A blocked image dims Send rather than disabling it: a press says why
    // and opens that image's choices (send).
    send.disabled = state.sendDisabled && !barrier;
    send.ariaDisabled = barrier ? 'true' : null;
    const change = sourceChange(editor, this.source.source_ref);
    this.$('source-update').textContent = change;
    this.$('source-update').hidden = !change;
    const note = this.mode === 'note';
    this.$('add-image').hidden = note || Boolean(editor.imageReservation);
    this.$('add-image').disabled = state.addDisabled;
    this.$('add-image').textContent = this.pasteReady ? 'Paste image' : 'Add image';
    this.$('choose-image').hidden = this.$('add-image').hidden || !this.pasteReady;
    this.$('choose-image').disabled = state.addDisabled;
    this.$('cancel-image').hidden = note || !editor.imageReservation;
    this.field.readOnly = state.readOnly;
    this.$('recipient-input').disabled = this.field.readOnly;
    this.paintChoice();
    this.$('quote-selection').disabled = Boolean(this.presentation?.sourceUnavailable || this.presentation?.availabilityUnconfirmed || this.sessions.reply.adopting || recoveryReadOnly(this.sessions.reply));
    this.paintQuote();
    this.paintImages();
    this.paintOffer();
    this.paintAccess();
  }

  paintAccess() {
    const status = this.$('source-access-status'), retry = this.$('retry-source'), p = this.presentation;
    if (!status || !retry) return;
    const blocked = p?.sourceUnavailable || p?.availabilityUnconfirmed;
    retry.hidden = !blocked;
    retry.disabled = Boolean(p?.availabilityChecking || this.sessions.reply.authorityRecovery);
    retry.onclick = () => this.callbacks.retrySource?.();
    status.textContent = p?.accessMessage || (p?.sourceUnavailable ? 'The source is unavailable. Your private writing is kept.'
      : p?.availabilityUnconfirmed ? 'Source access is unconfirmed. Your private writing is kept.' : '');
    if (p?.topicUpdatesPaused) status.textContent = [status.textContent, blocked ? 'Topic updates are paused. Retry access checks only this source.' : 'This source is available. Topic updates remain paused.'].filter(Boolean).join(' ');
    status.hidden = !status.textContent;
  }

  paintOffer() {
    const host = this.$('revision-offer'), control = this.$('open-revision');
    if (!host || !control) return; // renderer-only fixtures may omit this increment
    const offer = this.callbacks.revisionOffer?.(this.presentation);
    host.hidden = !offer;
    if (offer) { control.textContent = `Open revision ${offer.revision}`; control.onclick = () => offer.open(); }
    else control.onclick = null;
  }

  // A message's heading names the dossier a reply there goes into (item 561),
  // as its tab does (callbacks.dossierName), or else its topic; a press on it
  // goes back to that dossier, as the arrow beside it does. Painted again when
  // the name changes, it keeps its button, so a focus on it stays.
  paintTitle(source, topics = this.topics ?? []) {
    this.paintCover(source);
    const title = this.$('reader-title');
    const topic = source.source_ref.kind === 'message' && source.topic_id ? topics.find(item => item.id === source.topic_id) : null;
    if (!topic?.title) { title.textContent = source.title || (source.source_ref.kind === 'memory' ? 'Notebook' : 'Message'); return; }
    const dossier = this.callbacks.dossierName?.(source), words = dossier || topic.title;
    let open = title.firstElementChild;
    if (!open?.matches('.reader-topic') || title.childNodes.length !== 1) {
      open = node('button', words, 'reader-topic'); open.type = 'button'; open.title = 'Open this topic';
      title.replaceChildren(open);
    } else if (open.textContent !== words) open.textContent = words;
    open.title = dossier ? 'Open this dossier' : 'Open this topic';
    open.onclick = () => this.close('parent');
  }

  // The cover of the dossier the message is in (item 624, dossier-cover.mjs),
  // as the page's stacks hold it (callbacks.dossierCover): one quiet line at the
  // top of the message, where it stands and its payload's pill, that opens to
  // the whole sheet. None for a message no dossier with a cover holds. On a
  // phone it gives way while the reply is written (aim.css), so the message
  // keeps its lines. Painted with the title, so it follows the cover while the
  // Reader is open; a sheet opened stays open as its cover changes, and closes
  // when the message's dossier is another or its cover goes (show() closes it
  // for each message opened).
  paintCover(source) {
    const found = source?.source_ref?.kind === 'message' ? this.callbacks.dossierCover?.(source) ?? null : null;
    const host = this.$('reader-cover'), line = this.$('reader-cover-line');
    const dossier = found?.rootId ?? null;
    if (dossier !== (this.coverDossier ?? null)) { host.open = false; this.coverDossier = dossier; }
    const context = found ? { viewer: this.callbacks.actor?.() ?? null, nameOf: id => this.callbacks.actorName?.(id) ?? id, topicId: found.topicId } : null;
    // Drawn again only when what it says changes; a Reader that never showed one has nothing to take away.
    const key = found ? coverKey(found.cover, context) : '';
    if ((this.coverShown ?? '') === key) return;
    this.coverShown = key;
    host.hidden = !found;
    for (const node of [...host.children]) if (node !== line) node.remove();
    if (!found) { line.replaceChildren(); return; }
    const { cover } = found, shown = { ...context, owner: cover.owner };
    const words = document.createElement('span'); words.className = 'reader-cover-words';
    words.textContent = cover.stands || cover.payload?.text || `${cover.waiting.length === 1 ? 'Something waits' : `${cover.waiting.length} things wait`} on ${cover.owner === shown.viewer ? 'you' : shown.nameOf(cover.owner)}`;
    const label = document.createElement('span'); label.className = 'cover-label'; label.textContent = 'Cover';
    line.replaceChildren(label, ' ', words, ...(cover.payload ? [' ', payloadPill(document, cover.payload, shown)] : []));
    host.append(coverSheet(document, cover, context));
  }

  paintOrigin(source) {
    const provenance = source.source_ref.kind === 'memory' ? `Notebook · revision ${source.source_ref.revision}${source.draft === true ? ' · draft' : ''}`
      : source.whisper ? `Whisper to ${source.private_to === this.callbacks.actor?.() ? 'you' : source.private_to}` : '';
    this.sourceBody.classList.toggle('whispering', Boolean(source.whisper));
    const sent = Number.isSafeInteger(source.sent_ms) ? [' · ', timeNode(source.sent_ms, document)] : [];
    // A message whose words were changed after it was sent says so (docs/message-edit.md).
    const edited = source.source_ref.kind === 'message' && wasEdited(source) ? [' · Edited'] : [];
    const author = this.callbacks?.actorName?.(source.author) ?? source.author;
    const originText = node('span', undefined, 'reader-origin-text');
    originText.append([author, provenance].filter(Boolean).join(' · '), ...sent, ...edited);
    this.$('reader-origin').replaceChildren(originText);
    if (source.source_ref.kind === 'message') {
      const update = messageUpdateActivity(document, source, { viewer: this.callbacks.actor?.(), nameOf: id => this.callbacks.actorName?.(id) ?? id, topicId: source.topic_id });
      if (update) this.$('reader-origin').append(update);
    }
    this.paintTone(source);
  }
  // The page the source is read on: an agent's message wears its color, as
  // its card does under the pointer (callbacks.paneClass); anything else is
  // the neutral page.
  paintTone(source) {
    const pane = this.sourceBody?.closest?.('.reading-pane');
    if (pane) pane.className = (source && this.callbacks.paneClass?.(source)) || 'reading-pane';
  }
  hideUnavailableSource() {
    this.disarm(); this.sourceBody.replaceChildren(); this.$('source-attachments').replaceChildren();
    this.$('reader-title').textContent = 'Source unavailable';
    this.$('reader-origin').textContent = 'Source unavailable'; this.paintTone(null); this.sourceBody.classList.remove('whispering');
    this.paintStatus();
  }

  paintPending() {
    const host = this.$('pending-submissions');
    if (this.callbacks.renderPending) { this.callbacks.renderPending(host, this.sessions.reply); this.paintStatus(); return; }
    host.replaceChildren();
    const names = { preparing: 'Preparing — writing kept here', prepared: 'Confirmation unknown', confirmed: 'Sent to AIM', refused: 'Not sent — writing kept' };
    for (const item of this.sessions.reply.submissions) {
      const card = node('details', undefined, 'pending-card');
      card.open = item.status !== 'confirmed';
      card.append(node('summary', names[item.status] ?? 'Confirmation unknown'));
      card.append(node('pre', item.snapshot.body));
      if (item.receipt?.error?.message) card.append(node('p', item.receipt.error.message, 'muted'));
      if (['preparing', 'prepared'].includes(item.status)) {
        const retry = node('button', 'Check confirmation'); retry.type = 'button';
        retry.onclick = async () => { retry.disabled = true; try { await this.callbacks.reconcile(this.sessions.reply, item); } finally { if (retry.isConnected) retry.disabled = false; } };
        card.append(retry);
      }
      if (item.status === 'refused' && this.callbacks.recover) {
        const recover = node('button', 'Recover writing'); recover.type = 'button';
        recover.onclick = () => this.callbacks.recover(this.sessions.reply, item);
        card.append(recover);
      }
      host.append(card);
    }
    this.paintStatus();
  }

  // The message shown, edited elsewhere (docs/message-edit.md): its new words
  // drawn where it is read, the place in it held, the reply left as it is.
  redrawSource() {
    if (!this.source) return;
    const place = this.captureVisiblePlace();
    this.disarm(); this.kept = null;
    this.drawSource(this.source.body ?? '');
    this.paintOrigin(this.source);
    this.restoreVisiblePlace(place);
  }

  // The edit mode (docs/message-edit.md, message-edit.mjs): the message's
  // words give way to a field holding them, with Save and Cancel; the reply
  // beside it stays as it is. editing: { field, save(), leave() }. While it
  // is on the Reader does not step to another message.
  startEdit(editing) {
    this.editing = editing;
    this.disarm();
    this.sourceBody.hidden = true;
    this.endLine?.remove();
    this.$('message-edit').hidden = false;
    this.dialog.dataset.editing = 'true';
    this.stepsBefore = ['previous-message', 'next-message'].map(id => this.$(id).disabled);
    for (const id of ['previous-message', 'next-message']) this.$(id).disabled = true;
    editing.field.focus();
    editing.field.setSelectionRange(editing.field.value.length, editing.field.value.length);
  }
  stopEdit() {
    if (!this.editing) return;
    this.editing = null;
    this.sourceBody.hidden = false;
    this.$('message-edit').hidden = true; this.$('message-edit').replaceChildren();
    delete this.dialog.dataset.editing;
    ['previous-message', 'next-message'].forEach((id, n) => { this.$(id).disabled = this.stepsBefore?.[n] ?? this.$(id).disabled; });
    this.placeEnd();
  }

  // A failure goes to the notice as the error itself (lines.mjs).
  notice(what) { showLine(this.$('reader-notice'), what); }

  // Done, by its button or ⌘ Return, waits for a step as sending does. The
  // note saves as it is written; Done confirms the save. A saved note leaves
  // the Reader open and goes back to the reply as it was, where the note's
  // button shows the note is there. A note not saved stays in front, its
  // writing kept, and says so; a step or close that began meanwhile goes on
  // undisturbed.
  async saveNote() {
    if (!this.admits()) { if (this.writes()) this.notice(STEP_WAITS); return; }
    const editor = this.editor, presentation = this.presentation;
    const saved = await this.callbacks.saveNote(editor);
    // true saved, false not saved; null leaves nothing to say: the note is
    // no longer in front, or why it failed has already been said.
    if (typeof saved !== 'boolean' || this.mode !== 'note' || this.editor !== editor || this.presentation !== presentation || !this.dialog.open || !this.admits(editor, presentation)) return;
    if (saved) { this.notice(''); this.switchMode('reply'); }
    else this.notice('Not saved yet. Your note is kept here; press Done to try again.');
  }

  async send(stay) {
    if (!this.admits(this.sessions?.reply)) { if (this.writes(this.sessions?.reply)) this.notice(STEP_WAITS); return; }
    this.disarm();
    const editor = this.sessions.reply;
    // A blocked image: the whole sentence, and that image's choices open.
    const barrier = imageBarrier(editor);
    if (barrier) {
      this.notice(barrier);
      const name = BLOCKED.exec(barrier)?.[1];
      const row = name && [...this.$('writing-attachments').children].find(item => item.querySelector('.image-open span')?.textContent.startsWith(`${name} · `));
      if (row) { openImage(row); row.querySelector('.image-open').focus({ preventScroll: true }); }
      return;
    }
    if (editor.submissions.some(item => item.status === 'preparing' && !item.detached)) {
      this.notice('The earlier reply is still being prepared. Your next reply is kept separately.'); return;
    }
    if (editor.authorityRecovery || editor.conflict || (!editor.draft.body.trim() && !editor.draft.attachments.length)) {
      this.notice(editor.authorityRecovery || editor.conflict ? 'Review the saved versions before sending.' : 'Write a reply before sending.'); return;
    }
    // A name typed in To and not named: Send waits, and says so (compose-bar.mjs).
    if (this.compose.holdSend()) return;
    // The writing goes as the choice shows: a whisper, or a tell or ask that says so, to
    // whom the line said; Core records a leading @name's members itself (addressing.py).
    editor.edit(sending(editor.draft, this.names(editor), this.kindOf, this.answering()));
    const draft = editor.draft;
    try {
      // The controller freezes A synchronously. Reflect that deliberate act
      // before awaiting its journal or network; later receipts only paint status.
      const sending = this.callbacks.send(editor, { stay });
      if (this.editor === editor && editor.draft !== draft) { this.drawEditor(); this.field.focus(); }
      await sending;
    } catch (error) { this.callbacks.error?.(error); }
  }

  async close(reason = 'close') {
    const token = this.viewToken;
    this.rememberPlace();
    if (this.editor) this.editor.draft.caret = this.caret();
    if (await this.callbacks.close(this.sessions, reason) === false) return;
    if (this.viewToken !== token || !this.dialog.open) return;
    this.finishClose();
  }

  finishClose() {
    // An edit under way is left as Escape leaves it: its writing stays on the device.
    this.editing?.leave({ closing: true });
    ++this.viewToken;
    this.held = null;
    // The naming sheet is a modal of its own: it goes with the Reader.
    if (this.naming?.sheet.open) this.naming.sheet.close();
    this.dialog.close();
    this.disarm();
    // An opener the open itself hid (Read it, once the last mark clears)
    // hands focus to the page rather than dropping it to the body.
    const back = this.opener?.isConnected && this.opener.checkVisibility?.() !== false ? this.opener : document.getElementById('main');
    // The dialog closing has already given the opener the focus, with no
    // ring after a press, and a browser rings no element that has it already.
    if (back === this.opener && this.openerRinged) {
      if (document.activeElement === back) back.blur();
      back.focus({ preventScroll: true, focusVisible: true });
    } else back?.focus({ preventScroll: true });
  }

  async step(direction) { this.rememberPlace(); await this.callbacks.step(direction); }
  // Steps to the message above or below the open one, as the page shows them.
  stepTo(where) { if (this.editing) return; return this.step(neighborAt(where) === 'next' ? 1 : -1); }
  // Escape with no panel of the reply open (compose-bar.mjs heard takes it
  // while one is).
  escape() {
    // Escape leaves the edit mode and keeps its writing (docs/message-edit.md).
    if (this.editing) { this.editing.leave(); return; }
    if (this.hover || !window.getSelection()?.isCollapsed) { this.disarm(); window.getSelection()?.removeAllRanges(); return; }
    this.close();
  }

  writingReadOnly() { return this.input.readOnly(); }

  insertText(text) {
    this.input.insertText(text);
  }

  terminalKey(event) {
    return this.input.writingKey(event);
  }

  key(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (event.key === 'Tab') {
      // WebKit can leave native Tab on an expanded cover's summary even
      // though its controls are visible and the event was not cancelled.
      // Keep this boundary in the Reader's keyboard order in either engine;
      // use actual eligible stops so a disabled or removed stop is skipped.
      const coverStops = [...this.dialog.querySelectorAll('summary,button,textarea,select,input,a[href],[tabindex]')]
        .filter(el => visible(el) && (el.tabIndex >= 0 || el.matches('summary:not([tabindex])')));
      // A source tap focuses the article after the cover. Backward Tab must
      // enter its preceding stop too, before the inside-cover order can help.
      if (event.shiftKey && target === this.sourceBody) {
        const previous = coverStops[coverStops.indexOf(target) - 1];
        if (previous?.closest('#reader-cover')) {
          event.preventDefault();
          previous.focus();
          return;
        }
      }
      if (target.closest?.('#reader-cover')) {
        const index = coverStops.indexOf(target);
        if (index >= 0) {
          event.preventDefault();
          coverStops[(index + (event.shiftKey ? -1 : 1) + coverStops.length) % coverStops.length]?.focus();
          return;
        }
      }
      const stops = [...this.dialog.querySelectorAll('button,textarea,select,input,a[href],[tabindex="0"]')].filter(visible);
      if (event.shiftKey && target === stops[0]) { event.preventDefault(); stops.at(-1)?.focus(); }
      else if (!event.shiftKey && target === stops.at(-1)) { event.preventDefault(); stops[0]?.focus(); }
      return;
    }
    // While a message is edited, ⌘↑ and ⌘↓ step nowhere, and in its field
    // ⌘ Return saves the edit; every other key there is the field's own.
    if (this.editing) {
      if (event.metaKey && Object.values(STEPPING).some(step => step.key === event.key)) { event.preventDefault(); return; }
      if (target === this.editing.field) {
        if (keyAction(event, { context: 'edit' }) === 'save-edit') { event.preventDefault(); this.editing.save(); }
        return;
      }
    }
    // Select All outside a text field takes the message's text, never the
    // Reader's buttons and labels; in a field the browser selects its own text.
    if (selectAllKey(event, this.mac) && !target.closest('input,textarea,select')) {
      event.preventDefault();
      const range = document.createRange(), selection = window.getSelection();
      range.selectNodeContents(this.sourceBody); selection.removeAllRanges(); selection.addRange(range);
      return;
    }
    if (target === this.field && this.writingReadOnly()) return;
    if (target === this.field && this.terminalKey(event)) return;
    if (target !== this.field && target.closest(QUOTE_STOPS)) {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
      return;
    }
    const inEditor = target === this.field;
    // ⌘C with a passage lit and no words selected copies the passage's words,
    // as Return would quote them, as on the topic page (message-menu.mjs).
    if (!inEditor && copyKey(event, this.mac) && this.hover && window.getSelection()?.isCollapsed !== false && this.source) {
      event.preventDefault(); copyText(this.selectedPassage().trimEnd()).then(copied => { if (!copied) this.notice(COPY_REFUSED); }); return;
    }
    if (!inEditor && event.metaKey && event.shiftKey && event.code === 'KeyC' && this.source?.source_ref.kind === 'message') {
      event.preventDefault(); copyText(this.source.body).then(copied => { if (!copied) this.notice(COPY_REFUSED); }); return;
    }
    const where = Object.keys(STEPPING).find(at => STEPPING[at].key === event.key);
    if (!inEditor && event.metaKey && !event.shiftKey && where) {
      event.preventDefault(); if (this.source.source_ref.kind === 'message') this.stepTo(where); return;
    }
    const reply = this.sessions.reply.draft;
    const action = keyAction(event, { context: this.mode === 'note' && event.metaKey ? 'note' : inEditor ? this.mode : 'reader',
      quoteArmed: !!this.selectedPassage(), writingEmpty: !written(reply) });
    if (action === 'quote') { event.preventDefault(); this.quote(); }
    else if (action === 'send-return' || action === 'send-stay') { event.preventDefault(); this.send(action === 'send-stay'); }
    else if (action === 'save-note') { event.preventDefault(); this.saveNote(); }
    else if (action === 'return-gallery') { event.preventDefault(); this.close('gallery'); }
  }
}
