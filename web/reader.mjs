import { keyAction } from './editor.mjs';
import { ReaderLayout } from './layout.mjs';
import { imageBarrier, recoveryReadOnly } from './upload-state.mjs';
import { markReach, replaceChips } from './people.mjs';
import { readableTime } from './topic-state.mjs';
import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices } from './writing-helpers.mjs';
import { WritingInput } from './writing-input.mjs';

const STEP_WAITS = 'Another message is still opening. Your writing is kept; images and sending wait until it opens.';
const QUOTE_STOPS = 'button,a,input,select,summary,[role="separator"]';

const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const visible = el => el.getClientRects().length && !el.disabled && !el.hidden;

export class Reader {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.dialog = document.querySelector('#reader');
    this.field = document.querySelector('#writing-body');
    this.sourceBody = document.querySelector('#source-body');
    this.mode = 'reply';
    this.positions = new Map();
    this.hover = null;
    this.pointer = null;
    this.source = null;
    this.sessions = null;
    this.viewToken = 0;
    this.narrow = window.matchMedia('(max-width: 760px)');
    this.narrow.addEventListener('change', () => { if (this.dialog.open) this.applyLayout(); });
    this.bind();
  }
  $(id) { return this.dialog.querySelector(`#${id}`); }
  get editor() { return this.sessions?.[this.mode]; }
  admits(editor = this.editor, presentation = this.presentation) { return this.callbacks.admits?.(presentation, editor) ?? true; }
  // Typing, quoting and naming recipients: these go on while a step waits.
  writes(editor = this.editor, presentation = this.presentation) { return this.callbacks.writes?.(presentation, editor) ?? this.admits(editor, presentation); }

  bind() {
    this.$('reader-close').onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.escape(); });
    this.$('reader-parent').onclick = () => this.close('parent');
    this.$('reader-layout').onclick = () => {
      this.layout.setMode(this.layout.mode === 'wide' ? 'stacked' : 'wide');
      this.applyLayout();
    };
    this.bindDivider();
    this.$('toggle-note').onclick = () => this.switchMode();
    this.$('quote-selection').onpointerdown = event => event.preventDefault();
    this.$('quote-selection').onclick = () => this.quote();
    this.$('send-reply').onclick = () => this.mode === 'note' ? this.saveNote() : this.send(false);
    this.$('add-image').onclick = () => {
      if (!this.admits()) return;
      try {
        const uploads = this.callbacks.uploads?.(this.editor);
        if (!uploads) return;
        const token = uploads.reserve(this.presentation);
        this.imagePicker = { uploads, token }; this.$('image-file').value = '';
        this.paintStatus(); this.$('image-file').click();
      } catch (error) { this.notice(error.message); }
    };
    this.$('cancel-image').onclick = () => { this.cancelImagePicker(); this.$('add-image').focus(); };
    this.$('image-file').addEventListener('cancel', () => this.cancelImagePicker());
    this.$('image-file').onchange = async event => {
      const picker = this.imagePicker, file = event.target.files?.[0]; this.imagePicker = null;
      if (!picker) { if (file) this.notice('That image selection expired. Choose it again.'); return; }
      try { await picker.uploads.choose(picker.token, file); }
      catch (error) { this.notice(error.message); }
      finally { this.paintStatus(); }
    };
    this.$('previous-message').onclick = () => this.step(-1);
    this.$('next-message').onclick = () => this.step(1);
    this.$('add-recipient').onclick = () => this.addRecipient();
    this.$('recipient-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.addRecipient(); }
    });
    this.$('reply-destination').onchange = event => this.callbacks.destination(event.target.value);
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.writes(),
      beforeEdit:()=>this.disarm(),changed:editor=>{this.callbacks.edit(editor);this.paintStatus();}});
    this.field.addEventListener('paste', event => this.paste(event));
    // Clicking a passage lights it for Return, as moving over it does while
    // Return would quote. Shift-click extends the light, from a dragged
    // selection when there is one, and the browser's own selection is kept
    // from growing beside it, so what lights is what quotes.
    this.sourceBody.addEventListener('pointerdown', event => {
      this.sourceBody.focus({ preventScroll: true });
      if (event.pointerType !== 'touch' && event.button === 0 && this.source) this.light(event.target, event.shiftKey);
    });
    this.sourceBody.addEventListener('mousedown', event => { if (event.shiftKey && event.button === 0 && this.hover) event.preventDefault(); });
    this.dialog.addEventListener('focusin', () => { if (!this.returnQuotes()) this.disarm(); });
    this.sourceBody.addEventListener('pointermove', event => this.point(event));
    this.dialog.addEventListener('keydown', event => this.key(event));
  }

  async paste(event) {
    const items = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/'));
    if (!items.length) return; // Text-only paste belongs to the native editor.
    event.preventDefault();
    try {
      const editor = this.editor, presentation = this.presentation;
      const refusal = pasteImageError(editor, this.mode, this.writingReadOnly());
      if (refusal) throw Error(refusal);
      if (!this.admits(editor, presentation)) throw Error(STEP_WAITS);
      const uploads = this.callbacks.uploads?.(editor);
      if (!uploads) throw Error('Images are not available in this reply yet.');
      // Capture clipboard files and their original editor/cycle before any
      // asynchronous work. Every image uses the existing admission/byte owner.
      const files = items.map(item => item.getAsFile());
      if (files.some(file => !file)) throw Error('Could not read the pasted image. Try Add image to choose the file.');
      const choices = files.map(file => {
        try {
          return uploads.choose(uploads.reserve(presentation), namedPastedImage(file));
        } catch (error) { return Promise.reject(error); }
      });
      const errors = (await Promise.allSettled(choices)).filter(result => result.status === 'rejected');
      if (errors.length && this.editor === editor && this.presentation === presentation && this.mode === 'reply' && this.admits(editor, presentation)) {
        this.notice([...new Set(errors.map(result => result.reason.message))].join(' '));
      }
    } catch (error) { this.notice(error.message); }
    finally { this.paintStatus(); }
  }

  show(source, sessions, { opener, topics = [], canPrevious = false, canNext = false, presentation, mode = 'reply' } = {}) {
    ++this.viewToken;
    this.presentation = presentation;
    if (this.source) this.rememberPlace();
    this.source = source;
    this.sessions = sessions;
    if (this.layoutInstance !== sessions.reply.context.instanceId) {
      this.layoutInstance = sessions.reply.context.instanceId;
      let storage;
      try { storage = window.localStorage; } catch { /* no persisted preference */ }
      this.layout = new ReaderLayout(this.layoutInstance, storage);
    }
    this.mode = mode;
    this.notice('');
    this.$('source-update').hidden = true;
    this.opener = opener ?? this.opener ?? document.activeElement;
    this.disarm();
    this.$('reader-title').textContent = source.title || (source.source_ref.kind === 'memory' ? 'Notebook' : 'Message');
    this.paintOrigin(source);
    const destination = this.$('reply-destination');
    destination.replaceChildren();
    const choose = node('option', 'Choose a topic'); choose.value = ''; destination.append(choose);
    for (const topic of topics) { const option = node('option', topic.title); option.value = topic.id; destination.append(option); }
    destination.value = sessions.reply.context.topicId ?? '';
    this.$('reader-parent').disabled = !source.topic_id;
    this.$('reader-stepping').hidden = source.source_ref.kind !== 'message';
    this.$('previous-message').disabled = !canPrevious;
    this.$('next-message').disabled = !canNext;
    this.drawSource(source.body ?? '');
    this.drawAttachments(this.$('source-attachments'), source.attachments);
    this.drawEditor();
    this.paintPending();
    if (!this.dialog.open) this.dialog.showModal();
    this.applyLayout();
    this.sourceBody.scrollTop = this.positions.get(this.placeKey()) ?? 0;
    this.sourceBody.focus({ preventScroll: true });
  }

  get layoutShape() { return this.narrow.matches ? 'stacked' : this.layout.mode; }

  applyLayout() {
    const place = this.captureVisiblePlace();
    const shape = this.layoutShape, share = this.layout.share(shape);
    this.dialog.dataset.layout = shape;
    this.dialog.style.setProperty('--reading-share', `${1 - share}fr`);
    this.dialog.style.setProperty('--writing-share', `${share}fr`);
    this.$('reader-layout').textContent = shape === 'wide' ? 'Stacked' : 'Wide';
    this.$('reader-layout').setAttribute('aria-pressed', String(shape === 'wide'));
    this.$('reader-layout').setAttribute('aria-label', shape === 'wide' ? 'Use stacked reader layout' : 'Use wide reader layout');
    this.$('reader-layout').hidden = this.narrow.matches;
    this.$('reader-divider').setAttribute('aria-orientation', shape === 'wide' ? 'vertical' : 'horizontal');
    this.$('reader-divider').setAttribute('aria-valuenow', String(Math.round(share * 100)));
    this.$('reader-divider').setAttribute('aria-valuetext', `${Math.round(share * 100)} percent writing space`);
    this.restoreVisiblePlace(place);
    // Native selection paints the line box, while an inline background paints
    // the glyph box. Extend only the paint, using this source's actual metrics.
    const glyphHeight = this.sourceBody.firstElementChild?.getClientRects()[0]?.height;
    const lineHeight = parseFloat(getComputedStyle(this.sourceBody).lineHeight);
    if (glyphHeight > 0 && Number.isFinite(lineHeight)) {
      this.sourceBody.style.setProperty('--quote-overhang', `${Math.max(0, lineHeight - glyphHeight) / 2}px`);
    }
  }

  captureVisiblePlace() {
    const top = this.sourceBody.getBoundingClientRect().top;
    const span = [...this.sourceBody.children].find(part => part.getBoundingClientRect().bottom > top);
    return span ? { span, offset: span.getBoundingClientRect().top - top } : null;
  }

  restoreVisiblePlace(place) {
    if (place?.span.isConnected) this.sourceBody.scrollTop += place.span.getBoundingClientRect().top - this.sourceBody.getBoundingClientRect().top - place.offset;
  }

  bindDivider() {
    const divider = this.$('reader-divider');
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.layout) return;
      event.preventDefault(); divider.focus({ preventScroll: true });
      const main = this.dialog.querySelector('.reader-main').getBoundingClientRect();
      const header = this.dialog.querySelector('.reader-header').getBoundingClientRect();
      const grip = divider.getBoundingClientRect(), shape = this.layoutShape;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, shape,
        share: this.layout.share(shape), extent: shape === 'wide' ? main.width - grip.width : main.height - header.height - grip.height };
      divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove', event => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId || drag.extent <= 0) return;
      const delta = drag.shape === 'wide' ? drag.x - event.clientX : drag.y - event.clientY;
      if (!drag.moved && Math.abs(delta) < 4) return;
      drag.moved = true;
      this.layout.setShare(drag.share + delta / drag.extent, drag.shape);
      this.applyLayout();
    });
    const end = event => { if (this.drag?.id === event.pointerId) this.drag = null; };
    divider.addEventListener('pointerup', end);
    divider.addEventListener('pointercancel', end);
    divider.addEventListener('lostpointercapture', end);
    divider.addEventListener('dblclick', () => { this.layout.resetShare(this.layoutShape); this.applyLayout(); });
    divider.addEventListener('keydown', event => {
      const arrows = this.layoutShape === 'wide' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (!arrows.includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      const direction = event.key === arrows[0] ? 1 : -1;
      this.layout.setShare(this.layout.share(this.layoutShape) + direction * (event.shiftKey ? .1 : .02), this.layoutShape);
      this.applyLayout();
    });
  }

  drawSource(body) {
    this.sourceBody.replaceChildren();
    const segments = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(body)]
      : [...body.matchAll(/[^\n]+(?:\n+|$)|\n+/g)].map(match => ({ segment: match[0], index: match.index }));
    for (const part of segments) {
      const span = node('span', part.segment);
      span.dataset.start = String(part.index);
      span.dataset.end = String(part.index + part.segment.length);
      this.sourceBody.append(span);
    }
  }

  point(event) {
    if (event.pointerType === 'touch' || event.buttons || !this.source) return;
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

  light(target, extend) {
    const span = target.closest('[data-start]');
    if (!span || !this.sourceBody.contains(span)) return;
    if (extend) this.adoptSelection();
    const start = Number(span.dataset.start), end = Number(span.dataset.end);
    const anchor = extend && this.hover ? this.hover.anchor : { start, end };
    this.hover = { anchor, start: Math.min(anchor.start, start), end: Math.max(anchor.end, end) };
    for (const part of this.sourceBody.children) part.classList.toggle('hover-quote', Number(part.dataset.start) < this.hover.end && Number(part.dataset.end) > this.hover.start);
  }

  // A light extended after a drag grows from what was dragged: the passages
  // the browser's selection touches become its anchor, and the selection gives
  // way to it, since Return would otherwise quote the selection instead.
  adoptSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const from = this.sourceOffset(range.startContainer, range.startOffset), to = this.sourceOffset(range.endContainer, range.endOffset);
    if (from === null || to === null) return;
    const parts = [...this.sourceBody.children].filter(part => Number(part.dataset.start) < to && Number(part.dataset.end) > from);
    if (!parts.length) return;
    const anchor = { start: Number(parts[0].dataset.start), end: Number(parts.at(-1).dataset.end) };
    this.hover = { anchor, ...anchor };
    selection.removeAllRanges();
  }

  // Where a selection boundary falls in the source text: in a passage's text,
  // on a passage, or between passages; null outside the source.
  sourceOffset(container, offset) {
    if (container === this.sourceBody) return Number(this.sourceBody.children[offset]?.dataset.start ?? this.source.body.length);
    const span = container.parentElement === this.sourceBody ? container : container.parentElement;
    if (span?.parentElement !== this.sourceBody) return null;
    if (span !== container) return Number(span.dataset.start) + offset;
    return Number(offset ? span.dataset.end : span.dataset.start);
  }

  disarm() {
    this.hover = null;
    this.pointer = null;
    for (const span of this.sourceBody.querySelectorAll('.hover-quote')) span.classList.remove('hover-quote');
  }

  selectedPassage() {
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (this.sourceBody.contains(range.startContainer) && this.sourceBody.contains(range.endContainer)) return selection.toString();
    }
    return this.hover ? this.source.body.slice(this.hover.start, this.hover.end) : '';
  }

  quote() {
    if (this.presentation?.sourceUnavailable || this.presentation?.availabilityUnconfirmed) { this.notice('Source availability needs to be checked before quoting.'); return; }
    const excerpt = this.selectedPassage();
    if (!excerpt || !this.sessions) return;
    if (this.mode === 'note') this.switchMode('reply');
    const editor = this.sessions.reply;
    if (!this.writes(editor)) return;
    if (editor.adopting || recoveryReadOnly(editor)) { this.notice('Review saved image copies before changing this reply.'); return; }
    const prefix = editor.draft.body ? (editor.draft.body.endsWith('\n\n') ? '' : editor.draft.body.endsWith('\n') ? '\n' : '\n\n') : '';
    const addition = prefix + excerpt.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
    editor.draft.quotes.push({ source: structuredClone(this.source.source_ref), excerpt });
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
    this.insertText(addition);
    window.getSelection()?.removeAllRanges();
    this.disarm();
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
    const caret = this.editor.draft.caret;
    this.field.setSelectionRange(caret.start, caret.end);
  }

  drawEditor() {
    const note = this.mode === 'note';
    this.$('writing-title').textContent = note ? 'Private note' : 'Reply';
    this.$('writing-label').textContent = note ? 'Private note' : 'Reply';
    this.$('toggle-note').textContent = note ? 'Back to reply' : 'Private note';
    this.$('destination-label').hidden = note || this.source.source_ref.kind === 'message';
    this.$('reply-audience').hidden = note;
    this.$('pending-submissions').hidden = note;
    this.$('writing-hint').textContent = note ? 'Only you · ⌘ Return to save and close' : 'Return for a new line · ⌘ Return to send';
    this.$('send-reply').textContent = note ? 'Save note' : 'Send ⌘↵';
    this.field.placeholder = note ? 'Your private note…' : 'Write a reply…';
    this.field.value = this.editor.draft.body;
    this.paintImages();
    this.paintRecipients();
    this.paintStatus();
  }

  paintRecipients() {
    const editor = this.sessions.reply, presentation = this.presentation;
    replaceChips(this.$('recipient-chips'), this.$('recipient-input'), recipientChoices(editor.draft.addressees).map(({ name, removeLabel }) => {
      const chip = node('span', name, 'chip'); chip.dataset.name = name;
      const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', removeLabel);
      remove.onclick = () => {
        if (!this.writes(editor, presentation) || editor.adopting || recoveryReadOnly(editor)) return;
        editor.edit({ addressees: editor.draft.addressees.filter(item => item !== name) });
        this.callbacks.edit(editor); this.paintRecipients();
      };
      chip.append(remove); markReach(chip, name, this.callbacks.reach); return chip;
    }));
  }

  addRecipient() {
    const input = this.$('recipient-input');
    const name = input.value.trim().replace(/^@/, '');
    if (!name || !this.sessions) return;
    const editor = this.sessions.reply;
    if (!this.writes(editor) || editor.adopting || recoveryReadOnly(editor)) return;
    if (!editor.draft.addressees.includes(name)) {
      editor.edit({ addressees: [...editor.draft.addressees, name] });
      this.callbacks.edit(editor); this.paintRecipients();
    }
    input.value = '';
    input.focus();
  }

  drawAttachments(host, attachments = []) {
    host.replaceChildren();
    for (const attachment of attachments ?? []) host.append(node('span', attachment.name ?? attachment.id ?? 'Attached image', 'attachment-label'));
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
    const entries = imageChoices(uploads, active), ids = new Set(entries.map(e => e.id));
    for (const row of [...host.children]) if (!ids.has(row.dataset.selection)) row.remove();
    for (const e of entries) {
      let row = [...host.children].find(r => r.dataset.selection === e.id);
      if (!row) { row = node('div', undefined, 'image-choice'); row.dataset.selection = e.id; host.append(row); }
      if (row.dataset.view === e.view) continue;
      row.dataset.view = e.view; row.replaceChildren(node('span', e.text));
      const action = (label, act) => {
        const b = node('button', label); b.type = 'button';
        b.disabled = !active;
        b.onclick = async () => { if (!this.admits(editor, presentation)) return; b.disabled = true; try { await act(b); } catch (error) { if (this.admits(editor, presentation)) this.notice(error.message); } finally { if (b.isConnected) b.disabled = !this.admits(editor, presentation); this.paintStatus(); } };
        row.append(b);
      };
      for (const item of e.actions) action(item.label, async b => {
        await uploads[item.method](e.id);
        // Remove takes its own button away; focus lands on Add image only if it
        // was still there. Where the person has since put it, it stays.
        if (item.method === 'remove' && this.admits(editor, presentation) && [null, document.body, b].includes(document.activeElement)) this.$('add-image').focus();
      });
    }
  }

  paintStatus() {
    if (!this.editor) return;
    const editor = this.editor;
    const state = writingState(editor, { active: this.admits(editor), writable: this.writes(editor), note: this.mode === 'note', status: this.callbacks.status });
    this.$('save-state').textContent = state.message;
    this.$('send-reply').disabled = state.sendDisabled;
    const pinned = editor.sourceRef?.kind === 'memory' && editor.sourceRef.revision !== this.source.source_ref.revision;
    this.$('source-update').textContent = pinned ? `This writing refers to Notebook revision ${editor.sourceRef.revision}. You are reading revision ${this.source.source_ref.revision}.` : '';
    this.$('source-update').hidden = !pinned;
    const note = this.mode === 'note';
    this.$('add-image').hidden = note || Boolean(editor.imageReservation);
    this.$('add-image').disabled = state.addDisabled;
    this.$('cancel-image').hidden = note || !editor.imageReservation;
    this.field.readOnly = state.readOnly;
    this.$('recipient-input').disabled = this.field.readOnly;
    this.$('add-recipient').disabled = this.field.readOnly;
    this.$('quote-selection').disabled = Boolean(this.presentation?.sourceUnavailable || this.presentation?.availabilityUnconfirmed || this.sessions.reply.adopting || recoveryReadOnly(this.sessions.reply));
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
    if (p?.topicUpdatesPaused) status.textContent += blocked ? ' Topic updates are paused. Retry access checks only this source.' : 'This source is available. Topic updates remain paused.';
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

  paintOrigin(source) {
    const provenance = source.source_ref.kind === 'memory' ? `Notebook · revision ${source.source_ref.revision}` : 'Message';
    const sent = Number.isInteger(source.sent_ms) ? readableTime(source.sent_ms) : '';
    this.$('reader-origin').textContent = [source.author, provenance, sent].filter(Boolean).join(' · ');
  }
  hideUnavailableSource() {
    this.disarm(); this.sourceBody.replaceChildren(); this.$('source-attachments').replaceChildren();
    this.$('reader-origin').textContent = 'Source unavailable';
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

  notice(text) { this.$('reader-notice').textContent = text; this.$('reader-notice').hidden = !text; }

  // Save note, by its button or ⌘ Return, waits for a step as sending does.
  saveNote() {
    if (!this.admits()) { if (this.writes()) this.notice(STEP_WAITS); return; }
    this.callbacks.saveNote(this.editor);
  }

  async send(stay) {
    if (!this.admits(this.sessions?.reply)) { if (this.writes(this.sessions?.reply)) this.notice(STEP_WAITS); return; }
    this.disarm();
    const editor = this.sessions.reply;
    if (editor.submissions.some(item => item.status === 'preparing' && !item.detached)) {
      this.notice('The earlier reply is still being prepared. Your next reply is kept separately.'); return;
    }
    if (editor.authorityRecovery || editor.conflict || (!editor.draft.body.trim() && !editor.draft.attachments.length)) {
      this.notice(editor.authorityRecovery || editor.conflict ? 'Review the saved versions before sending.' : 'Write a reply before sending.'); return;
    }
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
    ++this.viewToken;
    this.dialog.close();
    this.disarm();
    // An opener the open itself hid (Read it, once the last mark clears)
    // hands focus to the page rather than dropping it to the body.
    const back = this.opener?.isConnected && this.opener.checkVisibility?.() !== false ? this.opener : document.getElementById('main');
    back?.focus({ preventScroll: true });
  }

  async step(direction) { this.rememberPlace(); await this.callbacks.step(direction); }
  escape() {
    if (this.hover || !window.getSelection()?.isCollapsed) { this.disarm(); window.getSelection()?.removeAllRanges(); return; }
    this.close();
  }

  writingReadOnly() { return this.input.readOnly(); }

  insertText(text) {
    this.input.insertText(text);
  }

  terminalKey(event) {
    return this.input.terminalKey(event);
  }

  key(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (event.key === 'Tab') {
      const stops = [...this.dialog.querySelectorAll('button,textarea,select,input,a[href],[tabindex="0"]')].filter(visible);
      if (event.shiftKey && target === stops[0]) { event.preventDefault(); stops.at(-1)?.focus(); }
      else if (!event.shiftKey && target === stops.at(-1)) { event.preventDefault(); stops[0]?.focus(); }
      return;
    }
    if (target === this.field && this.writingReadOnly()) return;
    if (target === this.field && this.terminalKey(event)) return;
    if (target !== this.field && target.closest(QUOTE_STOPS)) {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
      return;
    }
    const inEditor = target === this.field;
    if (!inEditor && event.metaKey && event.shiftKey && event.code === 'KeyC' && this.source?.source_ref.kind === 'message') {
      event.preventDefault(); navigator.clipboard.writeText(this.source.body).catch(() => this.notice('Could not copy. Select the text and use Copy.')); return;
    }
    if (!inEditor && event.metaKey && !event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); if (this.source.source_ref.kind === 'message') this.step(event.key === 'ArrowLeft' ? -1 : 1); return;
    }
    const reply = this.sessions.reply.draft;
    const action = keyAction(event, { context: this.mode === 'note' && event.metaKey ? 'note' : inEditor ? this.mode : 'reader',
      quoteArmed: !!this.selectedPassage(), writingEmpty: !reply.body.trim() && !reply.attachments.length });
    if (action === 'quote') { event.preventDefault(); this.quote(); }
    else if (action === 'send-return' || action === 'send-stay') { event.preventDefault(); this.send(action === 'send-stay'); }
    else if (action === 'save-note') { event.preventDefault(); this.saveNote(); }
    else if (action === 'return-gallery') { event.preventDefault(); this.close('gallery'); }
  }
}
