// The composer's shape, shared by the Reader's reply and the topic's new
// message (docs/reader.md): one quiet line while reading, the who chip and
// the field while writing, and the who and + panels opened from them. On a
// phone a panel takes the keyboard's place at the keyboard's height; on a
// laptop it is a popover over the bottom of the message. The writing, its
// sessions and its sending stay with the surface that owns them; this only
// shows them.
import { showLine } from './lines.mjs';

const PHONE = '(max-width: 760px)';
const TYPING = 'textarea, input:not([type]), input[type=text], input[type=search]';
// The keyboard is taken as up when the visible height falls by more than this
// while a text field has focus: smaller changes are the browser's own bars.
const KEYBOARD_MIN = 120;

// A reply docked in the page needs the page to move, not the full Reader's
// internal scroll box. Only an opening/focus or a shrinking keyboard viewport
// asks for this; scrolling the page away never pulls the person back.
export function revealCardReply(field, win = globalThis.window) {
  if (!field?.closest?.('#reader[data-card-reply], .card-reply-composer')) return;
  const box = field.closest('.field-box');
  if (!box?.getClientRects().length) return;
  const rect = box.getBoundingClientRect(), vv = win.visualViewport;
  const top = vv?.offsetTop ?? 0, bottom = top + (vv?.height ?? win.innerHeight);
  if (rect.top < top || rect.bottom > bottom) win.scrollBy({ top: rect.bottom - bottom, behavior: 'instant' });
}

// The keyboard, read from the visual viewport (web/ has one reader of it):
// --vv-height and --vv-top follow what is visible, so a phone's dialog sits
// above the keyboard rather than under it, and --keyboard holds the last
// keyboard height seen, the height a panel takes in its place. One reader for
// the whole page, started as this module loads, so a move in place, which
// ends only what the page added since it began (in-place-navigation.mjs,
// docs/rails.md), never takes it away.
function trackKeyboard(win, doc) {
  const vv = win.visualViewport;
  if (!vv || !doc) return;
  const root = doc.documentElement;
  let full = 0, width = 0, last = vv.height;
  const read = event => {
    const typing = doc.activeElement?.matches?.(TYPING) && !doc.activeElement.readOnly;
    if (vv.width !== width) { width = vv.width; full = 0; }
    if (!typing || vv.height > full) full = vv.height;
    else if (full - vv.height > KEYBOARD_MIN) root.style.setProperty('--keyboard', `${Math.round(full - vv.height)}px`);
    root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    // Less shows (the keyboard came up): the composer the field is typed in
    // scrolls itself, and only itself, to bring the field, with Send on its
    // row, back into view above its scroll padding (aim.css). A composer that
    // does not scroll (side by side, or wider than a phone) takes no
    // scrollTop, so nothing moves, and nothing around it is ever scrolled:
    // the Reader, which clips, stays where it is.
    const field = typing && vv.height < last ? doc.activeElement.closest('.composer .field-box') : null;
    if (field && !field.closest('#reader[data-card-reply], .card-reply-composer')) {
      const composer = field.closest('.composer'), port = composer.getBoundingClientRect().top + composer.clientTop + composer.clientHeight;
      composer.scrollTop += Math.max(0, field.getBoundingClientRect().bottom + (parseFloat(win.getComputedStyle(composer).scrollPaddingBottom) || 0) - port);
    }
    if (typing && (event?.type === 'focusin' || vv.height < last)) revealCardReply(doc.activeElement, win);
    last = vv.height;
  };
  vv.addEventListener('resize', read);
  vv.addEventListener('scroll', read);
  doc.addEventListener('focusin', read);
  doc.addEventListener('focusout', read);
  read();
}
trackKeyboard(globalThis, globalThis.document);

const waits = name => `${name} is typed in To but not named yet. Return names them; clear it to send without them.`;

const FOCUSABLE = 'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex="0"]';
const shown = el => el.getClientRects().length > 0;

export class ComposeBar {
  // root: the composer; field: its textarea; panels: { who, plus } with the
  // control that opens each (openers) and the Done inside each; taller: the
  // phone's taller-field toggle; naming: the who panel's naming sheet and
  // its name field ({ opener, sheet, field, back, add, names }, below);
  // notice: the line the surface says what last happened in. changed(state,
  // panel) is told after each change. holds(): takes where what the field
  // shares its room with is scrolled, and gives back what puts it there again
  // (fit).
  constructor({ root, field, panels, openers, taller = null, naming = null, notice = null, win = globalThis.window, changed = () => {}, holds = () => () => {} }) {
    Object.assign(this, { root, field, panels, openers, taller, naming, notice, win, changed, holds });
    this.doc = root.ownerDocument;
    this.phone = win.matchMedia(PHONE);
    this.state = 'line'; this.panel = null;
    // What is typed in To for each writing not shown now (writes).
    this.typed = new Map(); this.writing = undefined;
    // Escape and a close request, heard while a panel is open (heard).
    this.hear = event => this.heard(event);
    // What Send last said while it waited on a name (holdSend), until it is no longer true.
    this.waiting = '';
    root.dataset.compose = 'line';
    root.addEventListener('focusin', event => {
      // The field takes the keyboard back from a panel.
      if (event.target === field && this.panel) this.close();
      // Only the writing opens the composer. A control the quiet line shows
      // (a review chip, 👍) keeps its place while it is pressed: opening the
      // composer on its focus would move it from under the press.
      if (event.target === field || Object.values(panels).some(panel => panel.contains(event.target))) this.expand();
    });
    field.addEventListener('input', () => this.fit());
    for (const [name, opener] of Object.entries(openers)) {
      opener.setAttribute('aria-controls', panels[name].id);
      opener.setAttribute('aria-expanded', 'false');
      opener.addEventListener('click', () => this.panel === name ? this.close({ focus: 'field' }) : this.open(name));
    }
    for (const panel of Object.values(panels)) {
      panel.querySelector('[data-done]')?.addEventListener('click', () => this.putAway({ focus: 'field' }));
      // A tile does its one thing and puts the panel away: Add image, the
      // note, Quote. Focus goes back to the writing, except on a phone,
      // where that would bring the keyboard up over what the tile opened.
      panel.addEventListener('click', event => {
        if (!event.target.closest?.('.tile') || this.panels[this.panel] !== panel) return;
        const inside = panel.contains(this.doc.activeElement);
        this.close();
        if (inside) { if (this.onPhone) this.doc.activeElement.blur(); else this.field.focus({ preventScroll: true }); }
      });
      panel.addEventListener('keydown', this.hear);
    }
    // A press outside the open panel and its opener puts it away; focus stays
    // where the press put it. It is read at the click, not the press, so a
    // finger scrolling the message keeps the panel, as it keeps the keyboard,
    // and the control pressed is the one that acts, wherever closing the panel
    // moves the composer. That control's act is the press's, so it names no
    // one: a name typed in To stays typed (putAway).
    this.outsideClick = event => {
      if (!this.panel) return;
      const panel = this.panels[this.panel], opener = this.openers[this.panel];
      if (!panel.contains(event.target) && !opener.contains(event.target)) this.close();
    };
    this.win.addEventListener('click', this.outsideClick, true);
    taller?.addEventListener('click', () => {
      const tall = !this.root.hasAttribute('data-tall');
      this.root.toggleAttribute('data-tall', tall); taller.setAttribute('aria-pressed', String(tall));
      this.fit(); this.field.focus({ preventScroll: true });
    });
    this.widthChanged = () => this.fit();
    this.phone.addEventListener('change', this.widthChanged);
    // Whatever stops showing the composer (the Reader closing, the topic page
    // giving way to another view) puts its open panel away (unseen).
    this.observer = new ResizeObserver(() => { if (!this.disposed) this.unseen(); });
    this.observer.observe(root);
    if (naming) this.wireNaming(naming);
  }

  dispose() {
    this.disposed = true; this.close();
    this.win.removeEventListener('click', this.outsideClick, true);
    this.phone.removeEventListener('change', this.widthChanged); this.observer.disconnect();
  }

  // Naming someone on a phone is two steps (docs/reader.md). The who panel
  // shows who is named and opener (+ Someone), however big the team; opener
  // opens sheet, a modal dialog over the whole visible screen with its title,
  // the topic's people and the name field (field), which takes the keyboard.
  // Done or ← (back), Escape, or the system's back puts it away, to opener in
  // the who panel, with the writing and the message's place as they were. On
  // a laptop the sheet's people and field sit in the who panel's To row and
  // opener is not shown (aim.css), so it never opens there. names() says who
  // the writing names now.
  wireNaming({ opener, sheet, field, back }) {
    const away = () => { this.takeName(); if (sheet.open) sheet.close(); };
    field.addEventListener('input', () => this.settle());
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) this.takeName();
    });
    opener.setAttribute('aria-expanded', 'false');
    opener.addEventListener('click', () => {
      if (sheet.open) return;
      sheet.showModal(); opener.setAttribute('aria-expanded', 'true');
      field.focus({ preventScroll: true });
    });
    for (const button of back) button.addEventListener('click', away);
    // Escape in the open sheet is the sheet's alone: the who panel and the
    // Reader stay. On a laptop the sheet is never open and its field sits in
    // the To row, so Escape there is the panel's.
    sheet.addEventListener('keydown', event => {
      if (!sheet.open || event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); away();
    });
    sheet.addEventListener('cancel', event => { event.preventDefault(); away(); });
    sheet.addEventListener('close', () => {
      opener.setAttribute('aria-expanded', 'false');
      if (this.panel) opener.focus({ preventScroll: true });
    });
  }

  // A name typed in the name field (or picked from its suggestions) is named
  // only by an act of finishing with naming, which does nothing else, so what
  // it changes shows in the chip at once: Return, the sheet's Done, ←, Escape
  // and the system's back, and the who panel's Done and Escape (putAway). A
  // panel that goes for another act (a press on Send or anywhere else, +,
  // another message) names no one: the name stays typed in To with its
  // writing (writes), and Send waits on it (holdSend). A name the writing
  // cannot take now (add says false) stays in the field.
  takeName() {
    const name = this.typedName;
    if (!name || !this.naming.add(name)) return;
    this.naming.field.value = '';
    this.settle();
  }

  // What is typed in To, or ''.
  get typedName() { return this.naming?.field.value.trim().replace(/^@/, '') ?? ''; }
  // What is typed in To and not named yet, or ''.
  get unnamedTyped() { const name = this.typedName; return name && !this.naming.names().includes(name) ? name : ''; }

  // The person puts the open panel away (Done, Escape): a name typed in its To is named.
  putAway({ focus = null } = {}) {
    if (this.panel && this.panels[this.panel].contains(this.naming?.field)) this.takeName();
    this.close({ focus });
  }

  // Escape while a panel is open puts it away, wherever the focus is, on any
  // surface the composer sits in: the Reader, the popped New message sheet,
  // or its place in the topic page's feed, where no dialog is open to pass a key on. The bar
  // hears it in the panel (before the page's own keys) and, while a panel is
  // open, on the document, so no surface passes Escape on. A close request
  // with no key (a phone's back) on a dialog the composer is in does the
  // same, and that dialog stays. Whatever the focus is in has its Escape
  // first (the naming sheet's, a list or menu that takes it), and an Escape
  // or close request meant for a dialog the composer is not in is left to it.
  heard(event) {
    if (!this.panel || event.defaultPrevented || this.unseen()) return;
    if (event.type === 'cancel') { if (!event.target.contains?.(this.root)) return; }
    else if (event.key !== 'Escape' || event.isComposing || !this.inReach(event.target)) return;
    event.preventDefault(); event.stopPropagation();
    this.putAway({ focus: 'opener' });
  }

  // A panel goes with its composer: once nothing shows the composer, its open
  // panel is put away, naming no one (takeName), and it hears no more keys, so
  // a surface that closed or hid with a panel open never takes Escape from
  // what is shown now. Told as the composer's size changes (constructor) and
  // checked again as a key arrives (heard). Returns whether it put one away.
  unseen() {
    if (!this.panel || shown(this.root)) return false;
    this.close();
    return true;
  }

  // Whether a key from target is the composer's to hear: the open dialog that
  // holds the focus, if any, holds the composer too, and so does every modal
  // one, so a modal over it (the naming sheet, the guide) keeps its Escape
  // even when the focus has left it for the page.
  inReach(target) {
    const dialogs = [target?.closest?.('dialog[open]'), ...this.doc.querySelectorAll('dialog:modal')];
    return dialogs.every(dialog => !dialog || dialog.contains(this.root));
  }

  // The writing shown is now key's (the message a reply answers, the topic a
  // new message goes to), told by the surface each time it shows writing.
  // What was typed in To goes with the writing it was typed for, and comes
  // back when that writing is shown again, so it is never named in another.
  writes(key) {
    const field = this.naming?.field;
    if (field && key !== this.writing) {
      if (field.value) this.typed.set(this.writing, field.value);
      field.value = this.typed.get(key) ?? ''; this.typed.delete(key);
    }
    this.writing = key;
    this.settle();
  }

  // Send waits while a name is typed in To and not named: sending with them
  // or without them would each reach people the chip did not say. To opens on
  // that name, so Return names them or the person clears it, and the notice
  // says so until it is no longer true (settle). Returns whether Send waits.
  holdSend() {
    const name = this.unnamedTyped;
    if (!name) return false;
    this.waiting = waits(name);
    showLine(this.notice, this.waiting);
    this.open('who');
    if (this.onPhone) this.naming.opener.click(); else this.naming.field.focus({ preventScroll: true });
    return true;
  }

  // What Send said goes as soon as it is no longer true: the name is named
  // (Return, a way out that names, a tap on them: the surface tells this as it
  // repaints To), cleared or changed in To, or other writing is shown. A
  // notice said since is the surface's, and stays.
  settle() {
    const said = this.waiting, name = this.unnamedTyped;
    if (!said || (name && said === waits(name))) return;
    this.waiting = '';
    if (!this.notice.hidden && this.notice.textContent === said) showLine(this.notice, '');
  }

  get onPhone() { return this.phone.matches; }

  expand() {
    if (this.state === 'writing') return;
    this.state = 'writing'; this.root.dataset.compose = 'writing';
    this.fit(); this.changed(this.state, this.panel);
  }

  // Back to the one quiet line. The writing stays as it is.
  fold() {
    if (this.panel) this.close();
    if (this.root.contains(this.doc.activeElement)) this.doc.activeElement.blur();
    if (this.state === 'line') return;
    this.state = 'line'; this.root.dataset.compose = 'line';
    this.fit(); this.changed(this.state, this.panel);
  }

  open(name) {
    if (this.panel && this.panel !== name) this.close();
    const panel = this.panels[name], opener = this.openers[name];
    // On a phone the panel takes the keyboard's place: focus moves from the
    // field into the panel below, which lets the keyboard go.
    this.panel = name; panel.hidden = false;
    this.doc.addEventListener('keydown', this.hear);
    this.doc.addEventListener('cancel', this.hear, true);
    opener.setAttribute('aria-expanded', 'true');
    this.root.dataset.panel = name;
    this.expand();
    const first = panel.querySelector('[aria-pressed="true"]:not([disabled])') ?? [...panel.querySelectorAll(FOCUSABLE)].find(el => shown(el) && !el.matches('[data-done]'));
    (first ?? panel.querySelector('[data-done]'))?.focus({ preventScroll: true });
    this.changed(this.state, this.panel);
  }

  // focus: 'field' (Done), 'opener' (Escape) or nothing (a press elsewhere).
  // Closing names no one (takeName).
  close({ focus = null } = {}) {
    const name = this.panel;
    if (!name) return;
    this.panel = null;
    this.doc.removeEventListener('keydown', this.hear);
    this.doc.removeEventListener('cancel', this.hear, true);
    // The naming sheet goes with the who panel it was opened from; what is
    // typed in it stays typed (takeName).
    if (this.naming?.sheet.open) this.naming.sheet.close();
    this.panels[name].hidden = true;
    this.openers[name].setAttribute('aria-expanded', 'false');
    delete this.root.dataset.panel;
    if (focus === 'field') this.field.focus({ preventScroll: true });
    else if (focus === 'opener') this.openers[name].focus({ preventScroll: true });
    this.changed(this.state, this.panel);
  }

  // The field grows with its writing up to its max-height (aim.css: three
  // lines on a phone, four on a laptop so the message keeps its room, more
  // when made taller), then
  // scrolls. Where the field's height is the layout's (the one quiet line,
  // the wide column), aim.css says --fit: none and the height is left alone.
  // The field is measured at no height, which for that moment gives its room
  // to what shares it (the Reader's message): a message scrolled to its end
  // would be pulled down by it at each key, so it is put back as it was.
  fit() {
    const field = this.field, style = this.win.getComputedStyle(field);
    if (style.getPropertyValue('--fit').trim() === 'none') { field.style.height = ''; return; }
    const keep = field.scrollTop, back = this.holds();
    field.style.height = '0px';
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const max = parseFloat(style.maxHeight), wanted = field.scrollHeight + borders;
    field.style.height = `${Number.isFinite(max) ? Math.min(wanted, max) : wanted}px`;
    field.scrollTop = keep;
    back();
  }
}
