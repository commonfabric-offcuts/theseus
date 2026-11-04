import { keyAction } from './editor.mjs';
import { ReaderLayout } from './layout.mjs';
import { imageBarrier, recoveryReadOnly } from './upload-state.mjs';

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
    this.$('send-reply').onclick = () => this.mode === 'note' ? this.callbacks.saveNote(this.editor) : this.send(false);
    this.$('add-image').onclick = () => {
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
    this.field.addEventListener('input', () => {
      this.disarm();
      this.editor.edit({ body: this.field.value, caret: this.caret() });
      this.callbacks.edit(this.editor);
      this.paintStatus();
    });
    this.field.addEventListener('select', () => { if (this.editor) this.editor.draft.caret = this.caret(); });
    this.sourceBody.addEventListener('pointerdown', () => this.sourceBody.focus({ preventScroll: true }));
    this.sourceBody.addEventListener('pointermove', event => this.point(event));
    this.dialog.addEventListener('keydown', event => this.key(event));
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
    const provenance = source.source_ref.kind === 'memory' ? `Notebook · revision ${source.source_ref.revision}` : 'Message';
    this.$('reader-origin').textContent = [source.author, provenance].filter(Boolean).join(' · ');
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
    const current = { x: event.clientX, y: event.clientY };
    if (this.pointer && Math.hypot(current.x - this.pointer.x, current.y - this.pointer.y) < 2) return;
    this.pointer = current;
    const span = event.target.closest('[data-start]');
    if (!span || !this.sourceBody.contains(span)) return;
    const start = Number(span.dataset.start), end = Number(span.dataset.end);
    const anchor = event.shiftKey && this.hover ? this.hover.anchor : { start, end };
    this.hover = { anchor, start: Math.min(anchor.start, start), end: Math.max(anchor.end, end) };
    for (const part of this.sourceBody.children) part.classList.toggle('hover-quote', Number(part.dataset.start) < this.hover.end && Number(part.dataset.end) > this.hover.start);
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
    const excerpt = this.selectedPassage();
    if (!excerpt || !this.sessions) return;
    if (this.mode === 'note') this.switchMode('reply');
    const editor = this.sessions.reply;
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

  caret() { return { start: this.field.selectionStart, end: this.field.selectionEnd }; }
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
    const chips = this.$('recipient-chips');
    chips.replaceChildren();
    for (const name of this.sessions.reply.draft.addressees) {
      const chip = node('span', name, 'chip');
      const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${name}`);
      remove.onclick = () => {
        const editor = this.sessions.reply;
        if (editor.adopting || recoveryReadOnly(editor)) return;
        editor.edit({ addressees: editor.draft.addressees.filter(item => item !== name) });
        this.callbacks.edit(editor); this.paintRecipients();
      };
      chip.append(remove); chips.append(chip);
    }
  }

  addRecipient() {
    const input = this.$('recipient-input');
    const name = input.value.trim().replace(/^@/, '');
    if (!name || !this.sessions) return;
    const editor = this.sessions.reply;
    if (editor.adopting || recoveryReadOnly(editor)) return;
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
    const entries = uploads.current(), ids = new Set(entries.map(e => e.selection_id));
    for (const row of [...host.children]) if (!ids.has(row.dataset.selection)) row.remove();
    for (const e of entries) {
      let row = [...host.children].find(r => r.dataset.selection === e.selection_id);
      if (!row) { row = node('div', undefined, 'image-choice'); row.dataset.selection = e.selection_id; host.append(row); }
      const a = e.attempts[e.choice], state = uploads.status(e.selection_id);
      const view = JSON.stringify([state, e.version, a?.phase, a?.retry_allowed, uploads.running.has(e.selection_id)]);
      if (row.dataset.view === view) continue;
      row.dataset.view = view; row.replaceChildren(node('span', `${e.file?.name ?? e.ready_descriptor?.name ?? 'Attachment'} · ${state}`));
      const action = (label, act) => {
        const b = node('button', label); b.type = 'button';
        b.onclick = async () => { b.disabled = true; try { await act(); } catch (error) { this.notice(error.message); } finally { if (b.isConnected) b.disabled = false; this.paintStatus(); } };
        row.append(b);
      };
      if (!uploads.running.has(e.selection_id)) {
        if (e.bytes_state === 'memory-only') action('Retry device save', () => uploads.retry(e.selection_id));
        else if (e.origin === 'retained-ref' || a && !['captured', 'prepared'].includes(a.phase)) action('Check confirmation', () => uploads.check(e.selection_id));
        if (a && (a.retry_allowed || ['captured', 'prepared', 'begun'].includes(a.phase))) action(a.phase === 'begun' || a.phase === 'captured' || a.phase === 'prepared' ? 'Continue upload' : 'Retry upload', () => uploads.retry(e.selection_id));
        if ((!a || a.publish_response?.error?.code === 'MEDIA_INVALID') && e.bytes_state === 'durable' && !e.local_error) action('Attach as download', () => uploads.asDownload(e.selection_id));
      }
      action('Remove', async () => { await uploads.remove(e.selection_id); this.$('add-image').focus(); });
    }
  }

  paintStatus() {
    if (!this.editor) return;
    const editor = this.editor;
    const barrier = imageBarrier(editor);
    this.$('save-state').textContent = this.callbacks.status ? this.callbacks.status(editor) : editor.journalError ? 'Recovery copy unavailable — keep this page open'
      : editor.conflict ? 'Not saved — another version needs review'
      : editor.dirty ? 'Not yet saved to AIM' : 'Saved to AIM';
    const preparing = this.sessions.reply.submissions.some(item => item.status === 'preparing' && !item.detached);
    this.$('send-reply').disabled = Boolean(barrier || editor.adopting || editor.unavailable || editor.authorityRecovery || editor.conflict ||
      (this.mode === 'reply' && (preparing || !editor.context.topicId || (!editor.draft.body.trim() && !editor.draft.attachments.length))));
    const pinned = editor.sourceRef?.kind === 'memory' && editor.sourceRef.revision !== this.source.source_ref.revision;
    this.$('source-update').textContent = pinned ? `This writing refers to Notebook revision ${editor.sourceRef.revision}. You are reading revision ${this.source.source_ref.revision}.` : '';
    this.$('source-update').hidden = !pinned;
    const note = this.mode === 'note';
    this.$('add-image').hidden = note || Boolean(editor.imageReservation);
    this.$('add-image').disabled = Boolean(editor.adopting || editor.recoveryDiscovery || editor.unavailable || editor.authorityRecovery ||
      editor.uploadState?.entries.some(e => e.selected && e.owner.id === editor.clientCycleId && e.origin === 'retained-ref' && !e.ready_descriptor));
    this.$('cancel-image').hidden = note || !editor.imageReservation;
    this.field.readOnly = Boolean(editor.adopting || recoveryReadOnly(editor));
    this.$('recipient-input').disabled = this.field.readOnly;
    this.$('add-recipient').disabled = this.field.readOnly;
    this.$('quote-selection').disabled = Boolean(this.sessions.reply.adopting || recoveryReadOnly(this.sessions.reply));
    if (barrier) this.$('save-state').textContent = barrier;
    this.paintImages();
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

  async send(stay) {
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
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
  }

  async step(direction) { this.rememberPlace(); await this.callbacks.step(direction); }
  escape() {
    if (this.hover || !window.getSelection()?.isCollapsed) { this.disarm(); window.getSelection()?.removeAllRanges(); return; }
    this.close();
  }

  insertText(text) {
    // execCommand keeps a native undo item for textarea text edits. The actual
    // keyboard/undo contract is checked in the native-browser lane.
    if (!document.execCommand('insertText', false, text)) {
      this.field.setRangeText(text, this.field.selectionStart, this.field.selectionEnd, 'end');
      this.field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  terminalKey(event) {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['w', 'u', 'k', 'a', 'e'].includes(event.key)) return false;
    const value = this.field.value, start = this.field.selectionStart, end = this.field.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const at = value.indexOf('\n', end), lineEnd = at < 0 ? value.length : at;
    event.preventDefault();
    if (event.key === 'a' || event.key === 'e') {
      const point = event.key === 'a' ? lineStart : lineEnd; this.field.setSelectionRange(point, point); return true;
    }
    const from = event.key === 'u' ? lineStart : event.key === 'w' ? start - (value.slice(lineStart, start).match(/\S+\s*$|\s+$/)?.[0].length ?? 0) : start;
    const to = event.key === 'k' ? lineEnd : end;
    this.field.setSelectionRange(from, to); this.insertText(''); return true;
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
    if (target === this.field && this.terminalKey(event)) return;
    if (target !== this.field && target.closest('button,a,input,select,summary,[role="separator"]')) {
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
    else if (action === 'save-note') { event.preventDefault(); this.callbacks.saveNote(this.editor); }
    else if (action === 'return-gallery') { event.preventDefault(); this.close('gallery'); }
  }
}
