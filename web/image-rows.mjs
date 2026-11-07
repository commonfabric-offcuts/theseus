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

// A press that goes down on a button and comes up where that button was when
// it went down presses it, even when the page has meanwhile moved the button
// from under it: a button coming in before it on a narrow screen, a row above
// it growing as that row's own upload finishes, or the Reader's reply field,
// which fills the height its image rows and the status under them leave,
// giving up or taking back room as they change height. The browser clicks only what is under both ends of a
// press, so such a press would otherwise click nothing, or, for a tap,
// whatever slid under the finger; that click belongs to this press and is
// dropped. A press dragged away from where it went down lets go without
// pressing, as any button's does.
let held = null, claimed = false;
function follow() {
  addEventListener('pointerdown', () => { held = null; claimed = false; }, true);
  addEventListener('pointercancel', () => { held = null; }, true);
  addEventListener('pointerup', event => {
    if (!held || event.pointerId !== held.pointerId) return;
    const press = held; held = null;
    if (!press.button.isConnected) return;
    const x = event.clientX, y = event.clientY, was = press.place;
    if (press.button.contains(document.elementFromPoint(x, y))) return;
    if (x < was.left || x > was.right || y < was.top || y > was.bottom) return;
    claimed = true; press.button.click();
  }, true);
  addEventListener('click', event => {
    if (claimed && event.detail > 0) { claimed = false; event.preventDefault(); event.stopPropagation(); }
  }, true);
}
let following = false;
export function holdsItsPress(button) {
  if (!following) { following = true; follow(); }
  button.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.button === 0) held = { button, pointerId: event.pointerId, place: button.getBoundingClientRect() };
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
