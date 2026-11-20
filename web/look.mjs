// The look of the surfaces on this device (designer prototype; look.css): Bookends, the default, or Paper.
// "Bookends | Paper" at the rail's foot says which is on; it is kept in localStorage, and with no storage it
// holds for the page.
const KEY = 'theseus-look';
const root = document.documentElement;
const get = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
const put = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (_) {} };
const LOOKS = [['', 'Bookends', 'Black rail and Notebook, the conversation lit between them'], ['paper', 'Paper', 'The Notebook is paper']];
let look = LOOKS.some(([v]) => v === get()) ? get() : '';
const apply = () => { if (look) root.dataset.look = look; else delete root.dataset.look; };
apply();
// The page swaps its rail foot in place (in-place-navigation.mjs) and may carry a copy of the switch: only this
// module's own switch, in the foot on the page now, stays.
let mine = null;
const paint = () => mine?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.look === look)));
function mount() {
  for (const copy of document.querySelectorAll('.look-switch')) if (copy !== mine) copy.remove();
  const foot = document.querySelector('.rail-foot');
  if (!foot || mine?.parentElement === foot) return;
  if (!mine) {
    mine = document.createElement('span');
    mine.className = 'look-switch'; mine.setAttribute('role', 'group'); mine.setAttribute('aria-label', 'Look');
    for (const [value, label, tip] of LOOKS) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.title = tip; button.dataset.look = value;
      button.addEventListener('click', () => { look = value; put(value); apply(); paint(); });
      mine.append(button);
    }
  }
  paint(); foot.append(mine);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
new MutationObserver(mount).observe(root, { childList: true, subtree: true });
