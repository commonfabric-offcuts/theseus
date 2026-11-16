// The New line (unanswered.mjs) can be scrolled to the top of the window, its unread messages wholly above it,
// however little of the page follows it. Since item 465 the topic's Team is in the header, not after the messages,
// and on a short window the page ended with the oldest unread message still showing above the line. The room is
// the page's own: main's ::after (aim.css) is as tall as --line-room, which is what the window lacks below the
// line's top, and nothing at all while no line shows. It sits after everything in main, so nothing in the feed
// moves, and in the page's flow, so the rails reach the page's end as they do without it.
//
// It is measured again as soon as the line comes, goes or moves (the list's children change, heard before the
// next frame is drawn), and when the window or anything in main changes size. A change of size asks for one measure
// at the next frame, so the room it sets, which changes main's size, is heard as a change of its own rather than
// inside the observer that heard the first. A document with no such observers (a unit test's) gets no room.
export function keepLineRoom(main, list) {
  const doc = main?.ownerDocument, win = doc?.defaultView;
  if (!win?.requestAnimationFrame || !win.MutationObserver || !win.ResizeObserver) return;
  let frame = 0;
  const fit = () => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    const line = list.querySelector(':scope > .new-line');
    const room = line?.getClientRects().length ? Math.max(0, Math.ceil(line.getBoundingClientRect().top + win.innerHeight - contentEnd(main, win))) : 0;
    if (room !== (parseFloat(main.style.getPropertyValue('--line-room')) || 0)) main.style.setProperty('--line-room', `${room}px`);
  };
  const measure = () => { if (!frame) frame = win.requestAnimationFrame(fit); };
  new win.MutationObserver(fit).observe(list, { childList: true });
  new win.ResizeObserver(measure).observe(main);
  win.addEventListener('resize', fit);
  fit();
}

// Where main's own content ends, in the window's coordinates, with its padding below and without the room: the
// end of the last box in its flow (a sheet up over the page has left it), whatever main is stretched to.
function contentEnd(main, win) {
  let end = main.getBoundingClientRect().top + parseFloat(win.getComputedStyle(main).paddingTop);
  for (const child of main.children) {
    const style = win.getComputedStyle(child);
    if (!child.getClientRects().length || ['absolute', 'fixed'].includes(style.position) || child.matches('dialog[open]')) continue;
    end = Math.max(end, child.getBoundingClientRect().bottom + parseFloat(style.marginBottom));
  }
  return end + parseFloat(win.getComputedStyle(main).paddingBottom);
}
