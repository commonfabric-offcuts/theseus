// A few plain words said where a press was (item 635): why an act did
// nothing, set just under the control pressed or the dossier's title bar it
// acted on, over the page, so nothing on the page moves for it. It is read
// out as it shows (role=status). It goes at the person's next press or key,
// and when another note is said; never on a timer. It takes no press itself
// (aim.css: pointer-events none), so a press where it shows lands on what is
// under it. One note at a time, per document.
const shown = new WeakMap();
// The room kept from the window's edges (the page's phone gutter), and from
// what it is said beside.
const EDGE = 16, GAP = 6;

// Takes the document's note away, if one shows.
export function clearNote(doc) {
  const note = shown.get(doc);
  if (!note) return;
  shown.delete(doc);
  note.end();
}

// Says words under anchor, or over it where the window has no room below. A
// note in an open dialog (the Reader) is the dialog's, so it shows over it;
// otherwise it is the page's and scrolls with what it is said beside. False,
// and nothing shown, when no part of anchor is in the window.
export function noteAt(anchor, words, doc = anchor?.ownerDocument) {
  if (!doc) return false;
  clearNote(doc);
  const view = doc.defaultView, at = anchor?.isConnected && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
  if (!at || at.bottom <= 0 || at.top >= view.innerHeight) return false;
  const note = doc.createElement('p');
  note.className = 'press-note'; note.setAttribute('role', 'status'); note.textContent = words;
  (anchor.closest('dialog[open]') ?? doc.body).append(note);
  // Where its box's origin lands, wherever its containing block is, so it is placed in the window's terms.
  note.style.left = '0px'; note.style.top = '0px';
  const origin = note.getBoundingClientRect();
  const width = note.offsetWidth, height = note.offsetHeight;
  const left = Math.max(EDGE, Math.min(at.left, view.innerWidth - EDGE - width));
  const below = at.bottom + GAP + height <= view.innerHeight - EDGE || at.top - GAP - height < EDGE;
  note.style.left = `${left - origin.left}px`;
  note.style.top = `${(below ? at.bottom + GAP : at.top - GAP - height) - origin.top}px`;
  const gone = () => clearNote(doc);
  note.end = () => {
    note.remove();
    doc.removeEventListener('pointerdown', gone, true);
    doc.removeEventListener('keydown', gone, true);
  };
  doc.addEventListener('pointerdown', gone, true);
  doc.addEventListener('keydown', gone, true);
  shown.set(doc, note);
  return true;
}
