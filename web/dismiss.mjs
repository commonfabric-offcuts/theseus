// A modal pop-up closes when the person clicks or taps outside it, on its
// backdrop (docs/links.md, "Clicking outside a pop-up"). close is the same
// close its × and Escape use, so whatever that close keeps, waits for or
// refuses, an outside click keeps, waits for or refuses too.
//
// Only a press that starts and ends outside counts: a drag or selection that
// starts in the pop-up and is let go outside is not a click outside, nor is a
// press that starts outside and ends inside. A press that closes a smaller
// pop-up open inside it (an element with role="dialog") closes only that one.
// win is the page's window, where the press is seen first.
const outside = (dialog, event) => {
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom;
};

export function closeOnOutsideClick(dialog, close, win = globalThis) {
  let pressed = false;
  // Seen on the way down, before a smaller pop-up's own outside press removes it.
  win.addEventListener('pointerdown', event => {
    pressed = dialog.open && event.target === dialog && event.button === 0 && event.isPrimary !== false &&
      outside(dialog, event) && !dialog.querySelector('[role="dialog"]:not([hidden])');
  }, true);
  dialog.addEventListener('click', event => {
    const started = pressed; pressed = false;
    if (started && dialog.open && event.target === dialog && outside(dialog, event)) close();
  });
}
