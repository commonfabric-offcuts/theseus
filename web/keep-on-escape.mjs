// Route Escape to the field's existing Return owner. That owner, including
// its asynchronous confirmation/refusal path, finishes the field on success.
// Empty titles/new lines are the explicit no-write exception. Notes opt into
// empty: 'save'. This adapter never sends or synthesizes a keyboard event.
export function keepOnEscape(event, { value, save, close, finish, empty = 'close' }) {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return true;
  event.preventDefault(); event.stopPropagation();
  if (event.repeat) return true;
  if (empty === 'close' && !String(value ?? '').trim()) close?.();
  else { const saved = save(); if (finish) Promise.resolve(saved).then(ok => { if (ok !== false) finish(); }); }
  return true;
}
