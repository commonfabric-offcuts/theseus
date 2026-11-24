// A1178 reference keeps its authored words and path title. Feedback lives in
// attributes, outside the text/source offsets used by messages and Notebook.
export function copyLocalFileOnClick(reference, path, doc) {
  let attempt = 0, timer;
  const win = doc.defaultView ?? globalThis;
  const later = win.setTimeout?.bind(win) ?? globalThis.setTimeout;
  const cancelLater = win.clearTimeout?.bind(win) ?? globalThis.clearTimeout;
  const clear = () => {
    if (timer !== undefined) cancelLater(timer);
    reference.removeAttribute('data-copy-status');
    reference.removeAttribute('aria-description');
  };
  reference.addEventListener('click', event => {
    event.stopPropagation();
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reference.isContentEditable) return;
    const selection = doc.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const current = ++attempt;
    clear();
    // Start within the gesture; no permission query, read or await precedes it.
    let writing;
    try { writing = (win.navigator ?? globalThis.navigator).clipboard.writeText(path); }
    catch { writing = Promise.reject(); }
    const finish = copied => {
      if (attempt !== current || reference.isConnected === false) return;
      const words = copied ? 'Copied' : 'Could not copy';
      reference.setAttribute('data-copy-status', words);
      reference.setAttribute('aria-description', words);
      timer = later(() => { if (attempt === current) clear(); }, 1500);
      timer?.unref?.();
    };
    Promise.resolve(writing).then(() => finish(true), () => finish(false));
  });
}
