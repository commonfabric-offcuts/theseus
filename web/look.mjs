// The look of the surfaces on this device (designer prototype), as small switches at the rail's foot. Each is kept
// in localStorage (with no storage it holds for the page) and set as a data attribute on <html>:
// - Bookends | Paper (data-look; look.css): Bookends, the default, or Paper.
// - Quiet | Vivid (data-agent-colors; agent-colors.css): how strongly agents' cards and names are tinted.
const root = document.documentElement;
const get = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const put = (key, v) => { try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch (_) {} };
const SWITCHES = [
  { key: 'theseus-look', attr: 'look', label: 'Look', choices: [
    ['', 'Bookends', 'Black rail and Notebook, the conversation lit between them'], ['paper', 'Paper', 'The Notebook is paper']] },
  { key: 'theseus-agent-colors', attr: 'agentColors', label: 'Agent colors', choices: [
    ['', 'Quiet', 'Agents in deep, even tints that sit low on the page'], ['vivid', 'Vivid', 'Agents in lighter, more colorful tints']] },
];
for (const s of SWITCHES) { const saved = get(s.key); s.value = s.choices.some(([v]) => v === saved) ? saved : ''; }
const apply = s => { if (s.value) root.dataset[s.attr] = s.value; else delete root.dataset[s.attr]; };
SWITCHES.forEach(apply);
const paint = s => s.el?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === s.value)));
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
      for (const [value, label, tip] of s.choices) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.title = tip; button.dataset.value = value;
        button.addEventListener('click', () => { s.value = value; put(s.key, value); apply(s); paint(s); });
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
