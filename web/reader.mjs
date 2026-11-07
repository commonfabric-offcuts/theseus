import { keyAction } from './editor.mjs';
import { ReaderLayout } from './layout.mjs';
import { imageBarrier, recoveryReadOnly } from './upload-state.mjs';
import { paintAddress } from './people.mjs';
import { timeNode } from './times.mjs';
import { recipientChoices, writingState, pasteImageError, namedPastedImage, imageChoices, sourceChange } from './writing-helpers.mjs';
import { WritingInput, onMac, selectAllKey } from './writing-input.mjs';
import { paintChanges } from './page-changes.mjs';
import { wordNodes, webLinks } from './links.mjs';
import { closeOnOutsideClick } from './dismiss.mjs';
import { paintChoice, clearChoice, chosen, naming, unnamed, sending } from './whisper-choice.mjs';

const STEP_WAITS = 'Another message is still opening. Your writing is kept; images and sending wait until it opens.';
const CLOSING = 'This reply is closing, so the image was not added.';
const QUOTE_STOPS = 'button,a,input,select,summary,[role="separator"]';

const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const visible = el => el.getClientRects().length && !el.disabled && !el.hidden;

// The topic page shows its newest message on top, so the message above the
// one open is the next (newer) one and the one below is the previous
// (older). The up and down buttons, their words and the ⌘↑/⌘↓ keys all read
// this one rule: a page that put its newest message at the bottom flips
// them together here.
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
    // A click outside closes as × does: the writing, quotes and images are kept.
    closeOnOutsideClick(this.dialog, () => this.close(), window);
    this.$('reader-parent').onclick = () => this.close('parent');
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
    for (const where of ['above', 'below']) {
      const neighbor = neighborAt(where), button = this.$(`${neighbor}-message`);
      const words = `${neighbor === 'next' ? 'Newer' : 'Older'} message (${where})`;
      button.textContent = STEPPING[where].glyph; button.setAttribute('aria-label', words); button.title = words;
      button.onclick = () => this.stepTo(where);
      this.$('reader-stepping').append(button);
    }
    this.$('recipient-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.addRecipient(); }
    });
    // A tap on the other destination's chip moves the reply there; the chips
    // then show where it went, or stay put if it could not move.
    this.$('reply-destination').onclick = event => {
      const chip = event.target.closest?.('button[data-destination]');
      if (!chip || chip.getAttribute('aria-pressed') === 'true') return;
      Promise.resolve(this.callbacks.destination(chip.dataset.destination)).finally(() => this.paintDestination());
    };
    // Writing can take the author a reply is offered to, so the choice is redrawn with it.
    this.input=new WritingInput({field:this.field,editor:()=>this.editor,admits:()=>this.writes(),
      beforeEdit:()=>this.disarm(),changed:editor=>{this.callbacks.edit(editor);this.paintStatus();this.paintChoice();}});
    this.field.addEventListener('paste', event => this.paste(event));
    // Clicking a passage lights it for Return, as moving over it does while
    // Return would quote. Shift-click extends the light, from a dragged
    // selection when there is one, and the browser's own selection is kept
    // from growing beside it, so what lights is what quotes.
    this.sourceBody.addEventListener('pointerdown', event => {
      // A link is only a link: pressing it lights no passage to quote.
      if (event.target.closest?.('a')) return;
      this.sourceBody.focus({ preventScroll: true });
      if (event.pointerType !== 'touch' && event.button === 0 && this.source) this.light(event.target, event.shiftKey);
    });
    this.sourceBody.addEventListener('mousedown', event => { if (event.shiftKey && event.button === 0 && this.hover) event.preventDefault(); });
    // The message wears its focus ring only when a keyboard user Tabs onto it,
    // not when the Reader puts focus there itself (see aim.css).
    this.dialog.addEventListener('keydown', event => { if (event.key === 'Tab') this.tabbing = true; }, true);
    this.dialog.addEventListener('pointerdown', () => { this.tabbing = false; }, true);
    this.sourceBody.addEventListener('focusout', () => this.sourceBody.removeAttribute('data-tabbed'));
    this.dialog.addEventListener('focusin', event => {
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
    try {
      const editor = this.editor, presentation = this.presentation;
      const refusal = pasteImageError(editor, this.mode, this.writingReadOnly());
      if (refusal) throw Error(refusal);
      if (!this.admits(editor, presentation)) throw Error(this.callbacks.closing?.(presentation) ? CLOSING : STEP_WAITS);
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
    this.$('source-changes').hidden = true;
    this.opener = opener ?? this.opener ?? document.activeElement;
    this.disarm();
    this.topics = topics;
    this.paintTitle(source);
    this.paintOrigin(source);
    // Where the reply goes: the topic's name, or, for a message in an ordinary
    // topic, a choice of this topic or the outcome's conversation (outcome-conversation.mjs).
    const destination = this.$('reply-destination');
    const here = topics.find(topic => topic.id === sessions.reply.context.topicId) ?? topics[0];
    destination.replaceChildren(node('span', here?.title ?? '', 'destination-title'));
    this.offered = Boolean(this.callbacks.destinations?.(destination, source, sessions.reply.context.topicId));
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
    const shape = this.layoutShape, share = this.layout.share(shape);
    this.dialog.dataset.layout = shape;
    // In hundredths of the room, so when one pane keeps a floor (aim.css) the other
    // still takes all that is left: shares that sum to under 1fr would leave a gap.
    this.dialog.style.setProperty('--reading-share', `${(1 - share) * 100}fr`);
    this.dialog.style.setProperty('--writing-share', `${share * 100}fr`);
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
    // A link is never cut between passages: the passages one spans join.
    const links = webLinks(body), parts = [];
    for (const { segment, index } of segments) {
      const last = parts.at(-1);
      if (last && links.some(link => link.start < index && link.end > index)) last.segment += segment;
      else parts.push({ segment, index });
    }
    for (const part of parts) {
      const span = node('span');
      span.append(...wordNodes(part.segment, { doc: document }));
      span.dataset.start = String(part.index);
      span.dataset.end = String(part.index + part.segment.length);
      this.sourceBody.append(span);
    }
  }

  point(event) {
    if (event.pointerType === 'touch' || event.buttons || !this.source || event.target.closest?.('a')) return;
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
    const from = this.sourceOffset(range.startContainer, range.startOffset), to = this.sourceOffset(range.endContainer, range.endOffset, true);
    if (from === null || to === null) return;
    const parts = [...this.sourceBody.children].filter(part => Number(part.dataset.start) < to && Number(part.dataset.end) > from);
    if (!parts.length) return;
    const anchor = { start: Number(parts[0].dataset.start), end: Number(parts.at(-1).dataset.end) };
    this.hover = { anchor, ...anchor };
    selection.removeAllRanges();
  }

  // Where a selection boundary falls in the source text: in a passage's text
  // (a link's among it), on a passage, or between passages; null outside the source.
  // A boundary inside a link showing a topic's name falls at the start of the
  // words it stands for, or at their end when end is set, so the link is whole.
  sourceOffset(container, offset, end = false) {
    if (container === this.sourceBody) return Number(this.sourceBody.children[offset]?.dataset.start ?? this.source.body.length);
    let span = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    while (span && span.parentElement !== this.sourceBody) span = span.parentElement;
    if (!span) return null;
    const before = document.createRange();
    before.setStart(span, 0); before.setEnd(container, offset);
    let length = before.toString().length;
    // A link showing a topic's name counts as the words it stands for: wholly
    // before the boundary, by their length; holding it, from its start or end.
    for (const link of span.querySelectorAll('a[data-words]')) {
      const words = Number(link.dataset.words), whole = document.createRange();
      whole.selectNodeContents(link);
      if (before.compareBoundaryPoints(Range.END_TO_END, whole) >= 0) length += words - link.textContent.length;
      else if (before.compareBoundaryPoints(Range.START_TO_END, whole) > 0) {
        const into = document.createRange(); into.setStart(whole.startContainer, whole.startOffset); into.setEnd(container, offset);
        length += (end ? words : 0) - into.toString().length;
      }
    }
    return Number(span.dataset.start) + length;
  }

  disarm() {
    this.hover = null;
    this.pointer = null;
    for (const span of this.sourceBody.querySelectorAll('.hover-quote')) span.classList.remove('hover-quote');
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
    // The quote is writing like any other, so it goes through the editor's
    // edit, which brings in the author a reply is offered to.
    editor.edit({ quotes: [...editor.draft.quotes, { source: structuredClone(this.source.source_ref), excerpt }] });
    // The message's selection is let go before the field takes focus: once
    // the field is focused the document's selection is its caret, and
    // clearing it then leaves no caret drawn until the window is refocused.
    window.getSelection()?.removeAllRanges();
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
    this.insertText(addition);
    // The cursor sits after the quote and its blank line, ready to type, and
    // the field shows it however tall the writing has grown: an engine may
    // leave the caret drawn before a trailing newline, or short of the
    // field's bottom padding.
    const end = this.field.value.length;
    this.field.setSelectionRange(end, end);
    this.field.scrollTop = this.field.scrollHeight;
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

  paintDestination() {
    const at = this.sessions?.reply?.context?.topicId;
    for (const chip of this.$('reply-destination').querySelectorAll('button[data-destination]')) chip.setAttribute('aria-pressed', String(chip.dataset.destination === at));
  }

  drawEditor() {
    const note = this.mode === 'note';
    this.$('writing-label').textContent = note ? 'Private note' : 'Reply';
    this.paintNoteToggle();
    this.$('destination-label').hidden = note || (this.source.source_ref.kind === 'message' && !this.offered);
    this.callbacks.audiencePainted?.(note ? null : this.sessions?.reply?.context?.topicId ?? null);
    this.$('reply-audience').hidden = note;
    this.$('pending-submissions').hidden = note;
    this.$('writing-hint').textContent = note ? 'Only you · saved as you write · ⌘ Return when done' : 'Return for a new line · ⌘ Return to send';
    // The note saves as it is written; Done only finishes, so it is not a second save.
    if (note) this.$('send-reply').textContent = 'Done';
    else { const word = node('span', 'Send', 'send-word'), keys = node('span', '⌘↵'); keys.setAttribute('aria-hidden', 'true'); this.$('send-reply').replaceChildren(word, ' ', keys); }
    this.$('send-reply').classList.toggle('primary', !note);
    this.field.placeholder = note ? 'Write a private note only you can see…' : 'Write a reply…';
    this.field.value = this.editor.draft.body;
    this.paintImages();
    this.paintRecipients();
    this.paintChoice();
    this.paintStatus();
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
    const named = recipientChoices(this.names(editor)).map(({ name }) => name);
    const off = name => this.removeName(name, editor, presentation);
    paintAddress(this.$('recipient-chips'), this.$('recipient-input'), { people: this.callbacks.addressable?.() ?? [], named: [...new Set(named)],
      reach: this.callbacks.reach, remove: off, toggle: (name, on) => on ? this.addName(name) : off(name) });
    this.callbacks.recipientsPainted?.(this.names(editor), editor.context.topicId);
  }

  // The small field beside the topic's people names anyone else; Return adds them.
  addRecipient() {
    const input = this.$('recipient-input');
    const name = input.value.trim().replace(/^@/, '');
    if (!name || !this.addName(name)) return;
    input.value = '';
    input.focus();
  }

  // Names someone in the reply (the field's Return, or a name tapped once);
  // false when the reply cannot change now.
  addName(name) {
    const editor = this.sessions?.reply;
    if (!editor || !this.writes(editor) || editor.adopting || recoveryReadOnly(editor)) return false;
    if (!editor.draft.addressees.includes(name) && !(editor.offeredAddressees ?? []).includes(name)) {
      editor.edit({ addressees: [...editor.draft.addressees, name], ...naming(editor.draft, this.names(editor), this.kindOf, { conversation: this.toConversation(editor) }) });
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

  // Who the reply goes to: the author it is offered to, then whoever it names.
  names(editor = this.sessions?.reply) { return editor ? [...(editor.offeredAddressees ?? []), ...editor.draft.addressees] : []; }
  get kindOf() { return name => this.callbacks.people?.().kindOf(name); }
  // Writing that goes to an outcome's conversation starts as a Tell (I3).
  toConversation(editor = this.sessions?.reply) { return Boolean(this.callbacks.toConversation?.(editor?.context?.topicId)); }

  // Whisper, Tell or Ask (whisper-choice.mjs), and who will see it, above Send.
  // A reply to one agent starts as a whisper; a private note has no choice.
  paintChoice() {
    const editor = this.sessions?.reply, row = this.$('intent-row');
    if (!editor || this.mode === 'note') { clearChoice(row, this.field, this.$('send-reply')); return; }
    paintChoice(row, { draft: editor.draft, names: this.names(editor), kindOf: this.kindOf, everyone: this.callbacks.people?.().everyone ?? [],
      send: this.$('send-reply'), field: this.field, readOnly: Boolean(this.field?.readOnly), answeringWhisper: Boolean(this.source?.whisper),
      conversation: this.toConversation(editor), onChoose: choice => this.choose(choice) });
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
    const state = writingState(editor, { active: this.admits(editor), writable: this.writes(editor), note: this.mode === 'note', status: this.callbacks.status, sign: this.callbacks.sign });
    this.$('save-state').textContent = state.message; this.$('save-state').dataset.save = state.sign;
    this.$('send-reply').disabled = state.sendDisabled;
    const change = sourceChange(editor, this.source.source_ref);
    this.$('source-update').textContent = change;
    this.$('source-update').hidden = !change;
    const note = this.mode === 'note';
    this.$('add-image').hidden = note || Boolean(editor.imageReservation);
    this.$('add-image').disabled = state.addDisabled;
    this.$('cancel-image').hidden = note || !editor.imageReservation;
    this.field.readOnly = state.readOnly;
    this.$('recipient-input').disabled = this.field.readOnly;
    this.paintChoice();
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

  // A message's heading is its topic's name, and a press on it goes back to
  // that topic, as the arrow beside it does.
  paintTitle(source, topics = this.topics ?? []) {
    const title = this.$('reader-title');
    const topic = source.source_ref.kind === 'message' && source.topic_id ? topics.find(item => item.id === source.topic_id) : null;
    if (!topic?.title) { title.textContent = source.title || (source.source_ref.kind === 'memory' ? 'Notebook' : 'Message'); return; }
    const open = node('button', topic.title, 'reader-topic'); open.type = 'button'; open.title = 'Open this topic';
    open.onclick = () => this.close('parent');
    title.replaceChildren(open);
  }

  paintOrigin(source) {
    const provenance = source.source_ref.kind === 'memory' ? `Notebook · revision ${source.source_ref.revision}`
      : source.whisper ? `Whisper to ${source.private_to === this.callbacks.actor?.() ? 'you' : source.private_to}` : '';
    this.sourceBody.classList.toggle('whispering', Boolean(source.whisper));
    const sent = Number.isSafeInteger(source.sent_ms) ? [' · ', timeNode(source.sent_ms, document)] : [];
    this.$('reader-origin').replaceChildren([source.author, provenance].filter(Boolean).join(' · '), ...sent);
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

  notice(text) { this.$('reader-notice').textContent = text; this.$('reader-notice').hidden = !text; }

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
    if (editor.submissions.some(item => item.status === 'preparing' && !item.detached)) {
      this.notice('The earlier reply is still being prepared. Your next reply is kept separately.'); return;
    }
    if (editor.authorityRecovery || editor.conflict || (!editor.draft.body.trim() && !editor.draft.attachments.length)) {
      this.notice(editor.authorityRecovery || editor.conflict ? 'Review the saved versions before sending.' : 'Write a reply before sending.'); return;
    }
    // The writing goes as the choice shows: a whisper, or a tell or ask that says so.
    editor.edit(sending(editor.draft, this.names(editor), this.kindOf, { conversation: this.toConversation(editor) }));
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
  // Steps to the message above or below the open one, as the page shows them.
  stepTo(where) { return this.step(neighborAt(where) === 'next' ? 1 : -1); }
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
    if (!inEditor && event.metaKey && event.shiftKey && event.code === 'KeyC' && this.source?.source_ref.kind === 'message') {
      event.preventDefault(); navigator.clipboard.writeText(this.source.body).catch(() => this.notice('Could not copy. Select the text and use Copy.')); return;
    }
    const where = Object.keys(STEPPING).find(at => STEPPING[at].key === event.key);
    if (!inEditor && event.metaKey && !event.shiftKey && where) {
      event.preventDefault(); if (this.source.source_ref.kind === 'message') this.stepTo(where); return;
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
