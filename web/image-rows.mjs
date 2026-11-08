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

// A pointer press on such a button is the button's own, from the moment it
// goes down to the moment it comes up, whatever the page does meanwhile: a
// button coming in before it on a narrow screen, a row above it growing as
// that row's own upload finishes, or the Reader's reply field, which fills
// the height its image rows and the status under them leave, giving up or
// taking back room as they change height. Left to the browser, such a press
// goes to whatever is under the pointer as it comes up, and on a phone the
// whole of a tap (its mousedown, which moves focus, its mouseup and its click)
// is sent only then; so the button never leaves its press to the browser,
// moved or not. It keeps what the browser sends for every press of its own
// from reaching anything: a finger's lift (its touchend, which the button
// gets wherever it now is, even taken out of the page) is cancelled, so the
// browser sends the tap nowhere, and a mouse's click is dropped. Then, as the
// press comes up on the button or where the button was when it went down, it
// presses the button as a key would: focus on it, then its click. One way
// for every press, so a press the page moved does just what one it left in
// place does. A press dragged away from where it went down lets go without
// pressing, as any button's does.
let held = null, ended = null;
function follow() {
  addEventListener('pointerdown', () => { held = null; ended = null; }, true);
  addEventListener('pointercancel', () => { held = null; }, true);
  addEventListener('pointerup', event => {
    if (!held || event.pointerId !== held.pointerId) return;
    const { button, place: was } = held, x = event.clientX, y = event.clientY;
    held = null; ended = button;
    if (!button.isConnected) return;
    if (!button.contains(document.elementFromPoint(x, y)) && (x < was.left || x > was.right || y < was.top || y > was.bottom)) return;
    button.focus({ preventScroll: true }); button.click();
  }, true);
  addEventListener('click', event => {
    if (ended && event.detail > 0) { ended = null; event.preventDefault(); event.stopPropagation(); }
  }, true);
}
let following = false;
export function holdsItsPress(button) {
  if (!following) { following = true; follow(); }
  button.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.button === 0) held = { button, pointerId: event.pointerId, place: button.getBoundingClientRect() };
  });
  button.addEventListener('touchend', event => { if (ended === button) event.preventDefault(); }, { passive: false });
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
