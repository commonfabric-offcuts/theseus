// How the native harnesses reach a control the Reader's composer keeps out of
// sight (docs/reader.md), the way a person does: a control in the who or +
// panel through its opener, a name on a phone through + Someone, a control
// of the writing while the reply is its one quiet line by pressing into the
// field first, an image's choices by pressing its thumbnail, and a message's
// act (Mark unread, Start a topic from this, Add to pipeline) through the
// Reader's ⋯. A harness's press calls reach first; it returns true when the
// act was done another way (the ⋯).

// Runs in the page: what to press first to bring selector into view, or null
// when it shows already, is missing, or is hidden for a reason of its own.
const WAY = `(selector => {
  for (const old of document.querySelectorAll('[data-reach-way]')) old.removeAttribute('data-reach-way');
  const el = document.querySelector(selector);
  if (!el || el.getClientRects().length) return null;
  // What to press is brought into view first, as a person scrolls to it.
  const mark = node => { if (!node) return null; node.scrollIntoView({ block: 'nearest' }); node.setAttribute('data-reach-way', ''); return { press: '[data-reach-way]' }; };
  // The ⋯ names the mark by what choosing it does: a message marked unread offers Mark read.
  if (el.classList.contains('menu-source')) return el.hidden ? null : el.id === 'mark-unread' ? { mark: true } : { menu: el.textContent.trim() };
  const panel = el.closest('.compose-panel'), composer = el.closest('.composer'), row = el.closest('.image-choice');
  // Hidden for a reason of its own: not offered now.
  const hiddenBy = el.closest('[hidden]');
  if (hiddenBy && hiddenBy !== panel) return null;
  if (!composer) return null;
  if (composer.dataset.compose === 'line') return mark(composer.querySelector('textarea'));
  if (panel?.hidden) return mark(document.querySelector('[aria-controls="' + panel.id + '"]'));
  // On a phone a name is chosen in the naming sheet, opened by + Someone.
  const sheet = el.closest('dialog.naming-sheet');
  if (sheet && !sheet.open) return mark(document.querySelector('[aria-controls="' + sheet.id + '"]'));
  if (row && !row.hasAttribute('data-open')) return mark(row.querySelector('.image-open'));
  return null;
})`;

export function reachWith({ evaluate, point, until }) {
  const reach = async (selector, depth = 0) => {
    // A press this step itself makes needs no reaching.
    if (selector.includes('data-reach-way')) return false;
    const way = await evaluate(`${WAY}(${JSON.stringify(selector)})`);
    // Once a panel it was kept in has opened, a person scrolls to the control
    // there, as to its opener: a panel at a page's foot can open past its edge.
    if (!way && depth > 0) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'nearest' })`);
    if (!way) return false;
    if (depth > 3) throw Error(`could not reach ${selector}`);
    if (way.press) { await point(way.press); return reach(selector, depth + 1); }
    await point('#reader-menu');
    // The hidden toggle can still show the previous mark while its receipt paints.
    // Reach the current act the visible menu offers, as a person does.
    const labels = way.mark ? ['Mark read', 'Mark unread'] : [way.menu], choices = JSON.stringify(labels);
    await until(() => evaluate(`Boolean([...document.querySelectorAll('[role=menu] [role=menuitem]')].find(item => ${choices}.includes(item.textContent)))`), `${labels.join(' or ')} in the ⋯`);
    await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find(item => ${choices}.includes(item.textContent)).setAttribute('data-reach-way', '')`);
    await point('[role=menu] [data-reach-way]');
    return true;
  };
  return reach;
}
