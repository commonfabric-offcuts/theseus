// Sent to the browser verbatim so the native cases and the instrument's unit
// controls exercise the same sampler and the same every-frame predicate.
export function startCardScrollProbe() {
  const ports = () => [scrollY, document.querySelector('.notebook-sheet-pages')?.scrollTop ?? 0, document.querySelector('#new-message-sheet')?.scrollTop ?? 0,
    document.querySelector('.notebook-sheet-page:not([hidden])')?.scrollTop ?? 0];
  const trail = {start: ports(), frames: [], running: true};
  const read = () => {
    if (!trail.running) return;
    trail.frames.push(ports());
    requestAnimationFrame(read);
  };
  read();
  return trail;
}

export function cardScrollHeld(trail) {
  return trail.frames.length > 0 && trail.frames.every(at => at.length === trail.start.length && at.every((y, i) => Math.abs(y - trail.start[i]) <= 1));
}
