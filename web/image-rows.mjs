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
const busy = new WeakSet();

// The page can move such a button while a press is held on it: a button
// coming in before it on a narrow screen, a row above it growing as that row's
// own upload finishes, or the Reader's reply field, which fills the height its
// image rows and the status under them leave, giving up or taking back room as
// they change height. Whether a press was a press stays the browser's own
// decision, and its click is the one thing that presses the button; moving the
// button changes only where the browser sends that click, so only that is set
// right here, by the button the press went down on.
// - A mouse or pen press is captured: its mouseup and click come to the button
//   wherever it now is. Moved off where the button is and where it was, the
//   press goes back to the browser's own aim, so a press dragged away lets go,
//   as any button's does.
// - A finger's tap is sent once the finger lifts, and only if the browser took
//   it for a tap, to whatever is then under the point it went down on. The
//   tap's mousedown, mouseup and click that land elsewhere belong to the
//   button the finger went down on: the mousedown focuses it, as a tap on it
//   does, and the click presses it. A scroll, a long press, or the next press
//   sends no tap, and the finger's press is forgotten. The button says it
//   holds its press (data-holds-press), so a page's own touch guard
//   (protectTouchBounds) leaves its taps to the browser too.
let finger = null;
function follow() {
  addEventListener('pointerdown', () => { finger = null; }, true);
  addEventListener('pointercancel', () => { finger = null; }, true);
  for (const type of ['mousedown', 'mouseup', 'click']) addEventListener(type, event => {
    const button = finger;
    if (!button || event.detail === 0) return;
    if (type === 'click') finger = null;
    if (button.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!button.isConnected) return;
    if (type === 'mousedown') button.focus({ preventScroll: true });
    if (type === 'click') button.click();
  }, true);
}
let following = false;
export function holdsItsPress(button) {
  if (!following) { following = true; follow(); }
  button.dataset.holdsPress = '';
  button.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.pointerType === 'touch') { finger = button; return; }
    const was = button.getBoundingClientRect(), on = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    button.setPointerCapture(event.pointerId);
    const away = e => { if (!on(was, e) && !on(button.getBoundingClientRect(), e)) button.releasePointerCapture(e.pointerId); };
    button.addEventListener('pointermove', away);
    button.addEventListener('lostpointercapture', () => button.removeEventListener('pointermove', away), { once: true });
  });
}

export function paintImageRows(host, choices, enabled, press) {
  const ids = new Set(choices.map(choice => choice.id));
  for (const row of [...host.children]) if (!ids.has(row.dataset.selection)) row.remove();
  for (const choice of choices) {
    let row = [...host.children].find(r => r.dataset.selection === choice.id);
    if (!row) {
      row = document.createElement('div'); row.className = 'image-choice'; row.dataset.selection = choice.id;
      row.append(document.createElement('span')); host.append(row);
    }
    if (row.dataset.view === choice.view) continue;
    row.dataset.view = choice.view;
    const words = row.firstElementChild; words.textContent = choice.text;
    const labels = new Set(choice.actions.map(action => action.label));
    const kept = new Map();
    for (const button of [...row.children].slice(1)) {
      if (labels.has(button.dataset.action)) kept.set(button.dataset.action, button); else button.remove();
    }
    let before = words;
    for (const action of choice.actions) {
      let button = kept.get(action.label);
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        button.textContent = action.label; button.dataset.action = action.label; holdsItsPress(button);
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
