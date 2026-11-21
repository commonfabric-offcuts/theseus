import assert from 'node:assert/strict';

// Bind the mutation to the source actually served, including integrations that
// overwrite the constructor tabindex when the Reader moves in/out of a card.
export function tabRemovalMutation(source) {
  const placement = 'edge.tabIndex = embedded ? -1 : 0;';
  const constructor = 'edge.tabIndex = 0;';
  const old = source.includes(placement) ? placement : constructor;
  assert.equal(source.split(old).length, 2, 'one effective Tab assignment');
  const assignments = source.match(/edge\.tabIndex\s*=/g) ?? [];
  assert.equal(assignments.length, old === placement ? 2 : 1, 'no unaccounted Tab assignment can overwrite the mutant');
  return { name: 'tab-unreachable', old, new: 'edge.tabIndex = -1;',
    expected: /native Tab reaches the left composer edge/ };
}

// The bound is the actual finite DOM inventory, not a guessed focus-stop count.
// A repeated element ends traversal earlier; no focus is forced to the answer.
export async function tabToComposerEdge(p, a, side, engine) {
  const capacity = await p.evaluate(() => document.querySelectorAll('*').length + 1);
  assert.ok(Number.isSafeInteger(capacity) && capacity > 0, 'finite document inventory');
  const seen = new Set(), order = [];
  for (let step = 0; step <= capacity; step++) {
    await p.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const stop = await p.evaluate(a => {
      const el = document.activeElement, dialog = document.querySelector(a.dialog);
      window.item650FocusIds ??= new WeakMap(); window.item650NextFocusId ??= 0;
      if (!window.item650FocusIds.has(el)) window.item650FocusIds.set(el, ++window.item650NextFocusId);
      return { index: window.item650FocusIds.get(el), id: el.id, tag: el.tagName,
        side: el.parentElement === dialog ? el.dataset.edge : null, ring: el.matches(':focus-visible') };
    }, a);
    order.push(stop);
    if (stop.side === side) { assert.equal(stop.ring, true, 'Tab gives the edge visible keyboard focus'); return order; }
    if (seen.has(stop.index)) break;
    seen.add(stop.index);
  }
  assert.fail(`native Tab reaches the ${side} composer edge before its finite focus cycle repeats: ${JSON.stringify(order)}`);
}

// 650's close/reopen cases cannot use a helper that unconditionally taps twice:
// an already lit card opens on the first native tap. Shared pre-650 cases keep
// their separate train-49 owner.
export async function openComposerReader(p, id, until, words = 'Second agent') {
  const card = `#messages [data-id="${id}"]`;
  await until(p, s => Boolean(document.querySelector(s)), 'the message card', card);
  await p.locator(card).scrollIntoViewIfNeeded();
  if (p.touch) {
    await p.locator(card).tap();
    await until(p, s => document.querySelector('#reader').open || document.querySelector(s).classList.contains('lit'), 'card lit or Reader open', card);
    if (!await p.locator('#reader').evaluate(el => el.open)) await p.locator(card).tap();
  } else {
    const b = await p.locator(card).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height * 0.6);
    const cue = p.locator(`${card} .message-preview-cue`);
    if (await cue.count()) await cue.first().click(); else await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.6);
  }
  await until(p, text => document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith(text), 'Reader on the requested writing source', words);
  await until(p, () => document.getAnimations().filter(x => x.effect?.getTiming().iterations !== Infinity).every(x => x.playState !== 'running'), 'settled Reader');
}
