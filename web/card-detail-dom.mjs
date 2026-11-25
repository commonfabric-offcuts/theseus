// Presentation only. Callers still derive current facts and action bindings.
export function detailText(node, words) {
  if (node.textContent !== words) node.textContent = words;
  return node;
}

// Element-only rows: leave retained children connected and in place.
export function detailChildren(host, desired) {
  const wanted = new Set(desired);
  for (const child of [...host.children]) if (!wanted.has(child)) child.remove();
  let index = 0;
  for (const child of desired) {
    const next = host.children[index++] ?? null;
    if (child !== next) host.insertBefore(child, next);
  }
}
