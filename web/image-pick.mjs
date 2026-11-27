// Images while writing (item 121): the #img list that picks one of the
// topic's recent images, the thumbnail on each image row, and whether the
// image button can say "Paste image".
import { shownTime } from './times.mjs';
import { keepTop, revealSelection } from './reveal.mjs';
import { glyph } from './glyphs.mjs';

const node = (doc, tag, text, className) => {
  const el = doc.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

// "#img" just before the cursor, at the start of a line or after a space, and
// what is typed after it to narrow the list: {start, filter}, or null.
export function imageQuery(value, caret) {
  const line = value.slice(value.lastIndexOf('\n', caret - 1) + 1, caret);
  const found = /(?:^|\s)#img(\S*)$/.exec(line);
  if (!found) return null;
  return { start: caret - found[1].length - 4, filter: found[1].toLowerCase() };
}

// Theseus reads one image at a time and refuses a second read while one is
// under way, so this page's image reads take turns: each starts when the one
// before it has finished. A read the person is waiting on (a picked image)
// goes ahead of thumbnails not yet started. A read that can wait (later: a
// topic card's thumbnail, card-images.mjs) waits behind every other read, so
// the composer's own thumbnails, the Reader's and the right rail's never
// queue behind a topic's cards.
const reads = [];
let reading = false;
export function readInTurn(read, { first = false, later = false } = {}) {
  return new Promise((resolve, reject) => {
    const job = { read, resolve, reject, later };
    const behind = later ? -1 : reads.findIndex(each => each.later);
    if (first) reads.unshift(job); else reads.splice(behind < 0 ? reads.length : behind, 0, job);
    nextRead();
  });
}
function nextRead() {
  if (reading || !reads.length) return;
  reading = true;
  const job = reads.shift();
  Promise.resolve().then(job.read).then(job.resolve, job.reject).finally(() => { reading = false; nextRead(); });
}

// The pictures thumbnails show now, by key: the address of each one's bytes
// and the images that show it. Only a picture read whole is kept, never a read
// that brought nothing (it failed, or the page moved on before it was sent).
// A picture is let go once none of its images is in the page any more, as the
// page itself says (isConnected), however they were taken out; an image made
// before its row goes in counts from when it has been in the page. While any
// picture is kept, the page says each time something leaves it (a
// MutationObserver), so a picture goes as its last image goes, not only when
// the next thumbnail is painted: a place whose access was withdrawn, or a
// run a move ended, keeps none of its bytes.
const pictures = new Map(), placed = new WeakSet();
let watcher = null;
function letGo() {
  for (const [key, picture] of pictures) {
    for (const image of picture.images) if (image.isConnected) placed.add(image); else if (placed.has(image)) picture.images.delete(image);
    if (!picture.images.size) { pictures.delete(key); URL.revokeObjectURL(picture.url); }
  }
  if (!pictures.size) { watcher?.disconnect(); watcher = null; }
}
function keep(key, blob) {
  pictures.set(key, { url: URL.createObjectURL(blob), images: new Set() });
  const doc = globalThis.document;
  if (watcher || typeof globalThis.MutationObserver !== 'function' || !doc) return;
  watcher = new globalThis.MutationObserver(() => letGo());
  watcher.observe(doc, { childList: true, subtree: true });
}
// Opening uses only the bytes already on this page, synchronously in the
// person's gesture. Nothing is read or written and no parent act also runs.
export function openThumbnail(image, event) {
  if (!image?.src || image.hidden || !image.isConnected) return false;
  event?.preventDefault(); event?.stopPropagation();
  window.open(image.src, '_blank', 'noopener');
  return true;
}

function inlineCardImage(row, image, name) {
  const doc = row.ownerDocument;
  const actions = node(doc, 'span', undefined, 'card-image-actions');
  const fold = node(doc, 'button', undefined, 'card-image-collapse');
  const open = node(doc, 'button', 'Open in new tab');
  const arrow = node(doc, 'span', '↗');
  arrow.setAttribute('aria-hidden', 'true');
  fold.append(glyph('fold', doc, 16), 'Fold');
  open.append(arrow);
  fold.type = open.type = 'button';
  image.dataset.cardImageControl = fold.dataset.cardImageControl = open.dataset.cardImageControl = '';
  actions.append(fold, open);
  image.after(actions);
  const intrinsicSize = () => {
    if (image.naturalHeight) image.style.setProperty('--inline-image-ratio', image.naturalWidth / image.naturalHeight);
  };
  if (image.complete) intrinsicSize();
  else image.addEventListener('load', intrinsicSize, { once: true });
  let expanded = false;
  const showSize = large => {
    expanded = large;
    row.toggleAttribute('data-image-expanded', large);
    actions.hidden = !large;
    image.setAttribute('role', large ? 'link' : 'button');
    image.title = large ? 'Open in a new tab' : `Expand ${name}`;
    image.setAttribute('aria-label', large ? `Open ${name} in a new tab` : image.title);
    image.alt = name;
  };
  const collapse = event => {
    event.preventDefault(); event.stopPropagation();
    showSize(false);
    image.focus({ preventScroll: true });
    revealSelection(image, { margin: 0, onlyOffscreen: true, viewport: doc.defaultView.visualViewport });
  };
  const activate = event => {
    if (expanded) { openThumbnail(image, event); return; }
    event.preventDefault(); event.stopPropagation();
    keepTop(image, () => showSize(true));
    image.focus({ preventScroll: true });
  };
  image.onclick = activate;
  image.onkeydown = event => {
    if (event.key === 'Escape' && expanded) collapse(event);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (event.repeat) { event.preventDefault(); event.stopPropagation(); }
      else if (event.key === ' ' && expanded) collapse(event);
      else activate(event);
    }
  };
  fold.onclick = collapse;
  open.onclick = event => openThumbnail(image, event);
  actions.onkeydown = event => { if (event.key === 'Escape') collapse(event); };
  showSize(false);
}

const show = (image, picture, row, inlineName) => {
  picture.images.add(image); image.src = picture.url; image.hidden = false;
  image.tabIndex = 0; image.setAttribute('role', 'link');
  image.alt = image.title = 'Open image in a new tab';
  if (inlineName) inlineCardImage(row, image, inlineName);
};
// A thumbnail in the row, at its start unless place(image) puts it elsewhere:
// the image itself, made small (Theseus keeps no smaller copy), from the bytes
// load() gives (null for none). A row keeps its thumbnail while its key is the
// same, so a repaint of the row's words never reads it again; a picture still
// shown elsewhere is not read again either. Each image otherwise reads its
// own bytes, when its turn comes and only if it is still in the page; with
// later, behind every read that is not (readInTurn). One that brings none
// leaves its row, so the row's next paint reads the picture again.
export function paintThumb(row, key, load, place = image => row.prepend(image), { later = false, inlineName = null } = {}) {
  letGo();
  let image = row.querySelector(':scope > img.image-thumb');
  if (image?.dataset.key === key) { if (!inlineName) place(image); return; }
  if (image?.dataset.cardImageControl !== undefined) {
    row.querySelector(':scope > .card-image-actions')?.remove();
    row.removeAttribute('data-image-expanded');
  }
  image?.remove();
  image = node(row.ownerDocument, 'img', undefined, 'image-thumb'); image.alt = ''; image.dataset.key = key; image.hidden = true;
  image.onclick = event => openThumbnail(image, event);
  image.onkeydown = event => { if (event.key === 'Enter') openThumbnail(image, event); };
  place(image);
  if (pictures.has(key)) { show(image, pictures.get(key), row, inlineName); return; }
  const shown = image;
  readInTurn(() => (shown.isConnected ? load() : null), { later }).catch(() => null).then(blob => {
    if (!blob || !shown.isConnected) { shown.remove(); return; }
    letGo();
    if (!pictures.has(key)) keep(key, blob);
    placed.add(shown); show(shown, pictures.get(key), row, inlineName);
  });
}

// Whether the clipboard holds an image the page may read without asking: only
// where the browser has a clipboard-read permission to ask about (Chrome,
// Edge) and the person has already granted it. Nothing here ever asks for it,
// and Safari, Firefox and every browser on iPhone and iPad answer no, since
// they read the clipboard only inside a press and show their own Paste button.
export async function clipboardHoldsImage(nav = globalThis.navigator) {
  try {
    if (!nav?.clipboard?.read || !nav.permissions?.query) return false;
    if ((await nav.permissions.query({ name: 'clipboard-read' })).state !== 'granted') return false;
    return (await nav.clipboard.read()).some(item => item.types.some(type => type.startsWith('image/')));
  } catch { return false; }
}
// The image on the clipboard as a file, read on the person's press; null when
// there is none or the browser will not give it.
export async function clipboardImage(nav = globalThis.navigator) {
  try {
    for (const item of await nav.clipboard.read()) {
      const type = item.types.find(value => value.startsWith('image/'));
      if (type) { const blob = await item.getType(type); return new File([blob], '', { type: blob.type || type }); }
    }
  } catch { /* the browser declined */ }
  return null;
}

// The list #img opens under the writing. load() gives the images to offer
// ({items: [{source_ref, author_id, sent_ms, attachment}]}, from the
// topic_images view), thumb(item) a thumbnail's bytes, and choose(item) adds
// the picked image to the writing. The field keeps focus throughout: ↑ ↓ move
// through the list, Return or Tab picks, Escape closes it; a tap or click on
// the row's words picks it; its thumbnail opens the image in a new tab.
export class ImagePick {
  constructor({ field, host, load, thumb, choose, admits = () => true }) {
    Object.assign(this, { field, host, load, thumb, choose, admits });
    this.list = null; this.query = null; this.items = null; this.active = 0; this.reading = null;
    field.addEventListener('blur', event => { if (!this.list?.contains(event.relatedTarget)) this.close(); });
    field.addEventListener('click', () => this.update());
    field.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) this.update(); });
  }
  get open() { return Boolean(this.list && !this.list.hidden); }
  // The list, made the first time #img is typed, just after the writing.
  ensureList() {
    if (this.list) return this.list;
    this.doc = this.field.ownerDocument;
    const list = this.list = node(this.doc, 'div', undefined, 'image-pick');
    list.id = this.field.id + '-images'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Images to add');
    list.hidden = true;
    // A press on the list must not take focus from the writing. Only the
    // mouse event is held back: holding back a touch's pointerdown would, in
    // Safari, hold back the tap's click too, and nothing would be picked.
    list.addEventListener('mousedown', event => event.preventDefault());
    this.host.after(list);
    return list;
  }
  // After the writing or its cursor changes: open, narrow or close the list.
  update() {
    const query = this.admits() && this.field.selectionStart === this.field.selectionEnd ? imageQuery(this.field.value, this.field.selectionStart) : null;
    if (!query) { this.close(); return; }
    const opening = !this.query;
    this.query = query;
    if (opening) { this.ensureList(); this.items = null; this.active = 0; this.fetch(); }
    this.paint();
  }
  async fetch() {
    const reading = this.reading = Promise.resolve().then(this.load);
    let answer, failed = null;
    try { answer = await reading; } catch (error) { failed = error; }
    if (reading !== this.reading || !this.query) return;
    this.items = failed || answer?.error ? { error: failed?.message ?? answer.error.message } : answer.items;
    this.paint();
    // The whole list in view once it has its rows, however low the writing sits.
    this.list.scrollIntoView?.({ block: 'nearest' });
  }
  shown() {
    if (!Array.isArray(this.items)) return [];
    const filter = this.query?.filter ?? '';
    return this.items.filter(item => !filter || item.attachment.name.toLowerCase().includes(filter));
  }
  paint() {
    if (!this.query) return;
    const shown = this.shown();
    this.active = Math.max(0, Math.min(this.active, shown.length - 1));
    const rows = [];
    if (this.items === null) rows.push(node(this.doc, 'p', 'Finding images…', 'muted'));
    else if (this.items.error) rows.push(node(this.doc, 'p', `Could not list images: ${this.items.error}`, 'muted'));
    else if (!shown.length) rows.push(node(this.doc, 'p', this.items.length ? `No image named “${this.query.filter}”` : 'No images in this topic yet. Paste one, or use Add image.', 'muted'));
    for (const [index, item] of shown.entries()) {
      const option = node(this.doc, 'button', undefined, 'image-option'); option.type = 'button';
      option.id = `${this.list.id}-${index}`; option.setAttribute('role', 'option'); option.tabIndex = -1;
      option.setAttribute('aria-selected', String(index === this.active));
      const words = node(this.doc, 'span', undefined, 'image-option-words');
      words.append(node(this.doc, 'span', item.attachment.name, 'image-option-name'),
        node(this.doc, 'span', [item.author_id, Number.isSafeInteger(item.sent_ms) ? shownTime(item.sent_ms) : ''].filter(Boolean).join(' · '), 'muted'));
      option.append(words);
      paintThumb(option, item.attachment.id, () => this.thumb(item));
      option.onclick = () => this.pick(item);
      rows.push(option);
    }
    this.list.replaceChildren(...rows);
    this.list.hidden = false;
    this.field.setAttribute('aria-controls', this.list.id); this.field.setAttribute('aria-expanded', 'true');
    if (shown.length) this.field.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`);
    else this.field.removeAttribute('aria-activedescendant');
    // The option the keys are on, with room beyond it (reveal.mjs).
    revealSelection(this.list.querySelector('[aria-selected=true]'));
  }
  close() {
    if (!this.query && !this.open) return;
    this.query = null; this.reading = null; this.items = null;
    this.list.replaceChildren(); this.list.hidden = true;
    this.field.removeAttribute('aria-activedescendant'); this.field.setAttribute('aria-expanded', 'false');
  }
  // The list's keys while it is open; whether it took the key.
  key(event) {
    if (!this.open || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
    const shown = this.shown();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return true; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown.length) {
      event.preventDefault();
      this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; this.paint(); return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && shown.length) {
      event.preventDefault(); event.stopPropagation(); this.pick(shown[this.active]); return true;
    }
    return false;
  }
  // The #img words come out of the writing as one edit Undo takes back, and
  // the image goes in as a pasted one does.
  pick(item) {
    const query = this.query;
    if (!query || !this.admits()) return;
    this.close();
    this.field.focus();
    this.field.setSelectionRange(query.start, this.field.selectionEnd);
    return this.choose(item);
  }
}
