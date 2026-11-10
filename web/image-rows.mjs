// The rows of a reply's chosen images, painted in place, for the Reader and
// the inline composer. A row repaints when its upload finishes; a press whose
// button that repaint replaced or moved between its down and its up clicks
// nothing, so Remove sometimes did nothing. A button a repaint keeps (Remove
// always is) stays the same element, in place, and a repaint changes only its
// words, its handler and whether it can be pressed.
//
// choices: imageChoices(). enabled: whether its buttons can be pressed.
// press(action, choice, button): the surface's own act, run once per press;
// the button stays disabled until it settles, whatever repaints meanwhile.
// preview(id): the image's bytes for the row's thumbnail (image-pick.mjs
// paintThumb), or none. A row shows one image for as long as it is there, so
// its thumbnail is made with the row and let go with it. It comes right after
// the words, before the buttons, and shows first (aim.css), so the words stay
// the row's first part and Remove its last; and it holds its place before it
// loads, so its loading moves nothing in the row or below it. A row under
// 30rem wide (a phone) shows none (aim.css).
import { paintThumb } from './image-pick.mjs';

const busy = new WeakSet();

// The page can move such a button while a press is held on it: a button
// coming in before it on a narrow screen, a row above it growing as that row's
// own upload finishes, or the Reader's reply field, which fills the height its
// image rows and the status under them leave, giving up or taking back room as
// they change height. Whether a press was a press stays the browser's own
// decision, and its click is the one thing that presses the button; moving the
// button changes only where the browser sends that click, so only that is set
// right here, by what the press went down on.
// - A mouse or pen press is captured: its mouseup and click come to the button
//   wherever it now is. Moved off where the button is and where it was, the
//   press goes back to the browser's own aim, so a press dragged away lets go,
//   as any button's does.
// - A finger's tap is sent once the finger lifts, and only if the browser took
//   it for a tap, to whatever is then under the point it went down on, so a
//   button the page moved can be under it either way. The tap's mousedown,
//   mouseup and click belong to what the finger went down on (the browser's
//   own target, already aimed for a finger's size). Those of a finger that
//   went down on one of these buttons that land elsewhere go to that button:
//   the mousedown focuses it, as a tap on it does, and the click presses it.
//   Those of a finger that went down on anything else (the reply field, to
//   place the caret, or another button) that land on one of these buttons
//   reach nothing, so the page never presses a button it slid under a finger.
//   A scroll, a long press, or the next press sends no tap, and the finger's
//   press is forgotten. The button says it holds its press
//   (data-holds-press), so a page's own touch guard (protectTouchBounds)
//   leaves its taps to the browser too.
// These listeners are the whole page's, added once as this module loads, so
// a move in place, which ends only what the page added since it began
// (in-place-navigation.mjs), never takes them away.
const elsewhere = {};
let finger = null;
if (typeof addEventListener === 'function') {
  addEventListener('pointerdown', event => {
    finger = event.pointerType === 'touch' && event.isPrimary ? event.target.closest('[data-holds-press]') ?? elsewhere : null;
  }, true);
  addEventListener('pointercancel', () => { finger = null; }, true);
  for (const type of ['mousedown', 'mouseup', 'click']) addEventListener(type, event => {
    const down = finger;
    if (!down || event.detail === 0) return;
    if (type === 'click') finger = null;
    const landed = event.target.closest('[data-holds-press]');
    if (landed === down || (down === elsewhere && !landed)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (down === elsewhere || !down.isConnected) return;
    if (type === 'mousedown') down.focus({ preventScroll: true });
    if (type === 'click') down.click();
  }, true);
}
export function holdsItsPress(button) {
  button.dataset.holdsPress = '';
  button.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return;
    const was = button.getBoundingClientRect(), on = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    button.setPointerCapture(event.pointerId);
    const away = e => { if (!on(was, e) && !on(button.getBoundingClientRect(), e)) button.releasePointerCapture(e.pointerId); };
    button.addEventListener('pointermove', away);
    button.addEventListener('lostpointercapture', () => button.removeEventListener('pointermove', away), { once: true });
  });
}

export function paintImageRows(host, choices, enabled, press, preview = null) {
  const ids = new Set(choices.map(choice => choice.id));
  for (const row of [...host.children]) if (!ids.has(row.dataset.selection)) row.remove();
  for (const choice of choices) {
    let row = [...host.children].find(r => r.dataset.selection === choice.id);
    if (!row) {
      // The row's first part is a button holding its words: in a composer's
      // strip (docs/reader.md) it lies over the thumbnail, and a press on it
      // opens the image's choices in place (openImage).
      row = document.createElement('div'); row.className = 'image-choice'; row.dataset.selection = choice.id;
      const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'image-open';
      opener.setAttribute('aria-expanded', 'false'); opener.onclick = () => openImage(row, !row.hasAttribute('data-open'));
      opener.append(document.createElement('span')); row.append(opener); host.append(row);
      if (preview) paintThumb(row, choice.id, () => preview(choice.id), image => row.firstElementChild.after(image));
    }
    // Repainted when its state or its choices change.
    const methods = JSON.stringify(choice.actions.map(action => action.method));
    if (row.dataset.view === choice.view && row.dataset.methods === methods) continue;
    row.dataset.view = choice.view; row.dataset.methods = methods;
    const words = row.firstElementChild.firstElementChild; words.textContent = choice.text;
    // A mark sits on an image that still needs a choice: more than Remove.
    row.toggleAttribute('data-needs', choice.actions.length > 1);
    const labels = new Set(choice.actions.map(action => action.label));
    const kept = new Map();
    // After its words, a row holds its thumbnail, then its buttons (data-action).
    for (const button of [...row.children].slice(1).filter(part => part.dataset.action !== undefined)) {
      if (labels.has(button.dataset.action)) kept.set(button.dataset.action, button); else button.remove();
    }
    let before = row.querySelector(':scope > img.image-thumb') ?? row.firstElementChild;
    for (const action of choice.actions) {
      let button = kept.get(action.label);
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        button.textContent = action.label; button.dataset.action = action.label; button.dataset.method = action.method; holdsItsPress(button);
        // In a strip Remove is the thumbnail's ×, so its name says which image.
        if (action.method === 'remove') button.setAttribute('aria-label', `Remove ${choice.text.split(' · ')[0]}`);
      }
      button.onclick = async () => {
        if (busy.has(button)) return;
        busy.add(button); button.disabled = true;
        try { await press(action, choice, button); } finally { busy.delete(button); }
      };
      if (!busy.has(button)) button.disabled = !enabled;
      // Buttons keep one order, so a kept one is already in place and only a
      // new one is inserted; moving a held button would lose its press.
      if (before.nextElementSibling !== button) before.after(button);
      before = button;
    }
  }
}

// Opens or closes one image's choices; one is open at a time.
export function openImage(row, open = true) {
  if (open) for (const other of row.parentElement?.children ?? []) if (other !== row) openImage(other, false);
  row.toggleAttribute('data-open', open);
  row.firstElementChild?.setAttribute('aria-expanded', String(open));
}
