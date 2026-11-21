// The look of the surfaces on this device (designer prototype), as small switches at the rail's foot. Each is kept
// in localStorage (with no storage it holds for the page) and set as a data attribute on <html>:
// - Bookends | Paper (data-look; look.css): Bookends, the default, or Paper.
// - Quiet | Vivid (data-agent-colors; agent-colors.css): how strongly agents' cards and names are tinted.
// - Light on | Light off (data-pointer-light; pointer-light.mjs, 1010): pointer passages, independent of keyboard outlines.
// - The middle column's colour (data-bench; look.css, 1001): Slate, the default, Graphite or Umber, each drawn for
//   the look and theme in use. The switch names the look, then shows its three colours as swatches.
const root = document.documentElement;
const get = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const put = (key, v) => { try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch (_) {} };
const SWITCHES = [
  { key: 'theseus-look', attr: 'look', label: 'Look', choices: [
    ['', 'Bookends', 'Black rail and Notebook, the conversation lit between them'], ['paper', 'Paper', 'The Notebook is paper']] },
  { key: 'theseus-agent-colors', attr: 'agentColors', label: 'Agent colors', choices: [
    ['', 'Quiet', 'Agents in deep, even tints that sit low on the page'], ['vivid', 'Vivid', 'Agents in lighter, more colorful tints']] },
  { key: 'theseus-pointer-light', attr: 'pointerLight', label: 'Passage lighting under the pointer', choices: [
    ['', 'Light on', 'Light passages under the pointer'], ['off', 'Light off', 'Keep pointer passage lighting off; keyboard outlines stay on']] },
  { key: 'theseus-bench', attr: 'bench', label: 'Middle colour', swatches: true, choices: [
    ['', 'Slate', 'Slate: the cool grey-green the middle column has always had'], ['graphite', 'Graphite', 'Graphite: a plain neutral grey'],
    ['umber', 'Umber', 'Umber: a warm brown-grey']] },
];
for (const s of SWITCHES) { const saved = get(s.key); s.value = s.choices.some(([v]) => v === saved) ? saved : ''; }
const apply = s => { if (s.value) root.dataset[s.attr] = s.value; else delete root.dataset[s.attr]; };
SWITCHES.forEach(apply);
const paint = s => {
  s.el?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === s.value)));
  // The middle colour's switch names the look its colours belong to.
  const name = s.el?.querySelector('.look-switch-name');
  if (name) name.textContent = root.dataset.look === 'paper' ? 'Paper' : 'Bookends';
};
// Dim follows the switch directly below it (980), including a later font or
// label-size change. The shared width survives the footer's in-place copies.
const dimWidth = el => {
  const width = el.getBoundingClientRect().width;
  if (width > 0) root.style.setProperty('--rail-dim-width', `${width}px`);
};
const dimSize = new ResizeObserver(entries => entries.forEach(({ target }) => dimWidth(target)));
// The page swaps its rail foot in place (in-place-navigation.mjs) and may carry copies of the switches: only this
// module's own switches, in the foot on the page now, stay.
function mount() {
  const foot = document.querySelector('.rail-foot');
  for (const s of SWITCHES) {
    for (const copy of document.querySelectorAll(`.look-switch[data-switch="${s.attr}"]`)) if (copy !== s.el) copy.remove();
    if (!foot || s.el?.parentElement === foot) continue;
    if (!s.el) {
      s.el = document.createElement('span');
      s.el.className = 'look-switch'; s.el.dataset.switch = s.attr; s.el.setAttribute('role', 'group'); s.el.setAttribute('aria-label', s.label);
      if (s.swatches) { const name = document.createElement('span'); name.className = 'look-switch-name'; name.setAttribute('aria-hidden', 'true'); s.el.append(name); }
      for (const [value, label, tip] of s.choices) {
        const button = document.createElement('button');
        button.type = 'button'; button.title = tip; button.dataset.value = value;
        if (s.swatches) { button.className = 'look-swatch'; button.setAttribute('aria-label', label); } else button.textContent = label;
        button.addEventListener('click', () => { s.value = value; put(s.key, value); apply(s); SWITCHES.forEach(paint); });
        s.el.append(button);
      }
      if (s.attr === 'agentColors') dimSize.observe(s.el);
    }
    paint(s); foot.append(s.el);
    if (s.attr === 'agentColors') dimWidth(s.el);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
new MutationObserver(mount).observe(root, { childList: true, subtree: true });
