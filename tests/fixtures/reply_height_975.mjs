import { ComposeBar } from '../../web/compose-bar.mjs';

// Measurement ports for the existing 975 cap/threshold contracts. The mutable
// field.scrollHeight is the fixture's natural-content input, shared by its
// hidden measuring sibling; it is not browser layout or timing evidence.
export function fixture({ wanted = 60, tall = false, fit = 'auto', normal = 100 } = {}) {
  const attrs = new Set(tall ? ['data-tall'] : []), changes = [];
  const root = { hasAttribute: n => attrs.has(n), toggleAttribute(n, yes) { yes ? attrs.add(n) : attrs.delete(n); } };
  const field = { style: {}, scrollTop: 37, scrollHeight: wanted - 2, selectionStart: 3, selectionEnd: 11,
    value: '', className: '', placeholder: '', getBoundingClientRect: () => ({ width: 160 }) };
  const parent = { append(node) { node.parentNode = this; } };
  field.parentNode = parent;
  field.ownerDocument = { createElement: tag => ({ tagName: tag.toUpperCase(), style: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    remove() { this.parentNode = null; }, get scrollHeight() { return field.scrollHeight; } }) };
  const bar = Object.assign(Object.create(ComposeBar.prototype), { root, field,
    holds: () => { changes.push('hold'); return () => changes.push('restore'); },
    win: { getComputedStyle: () => ({ getPropertyValue: () => fit, borderTopWidth:'1px', borderBottomWidth:'1px', maxHeight: `${root.hasAttribute('data-tall') ? 200 : normal}px` }) } });
  return { bar, root, field, changes, attrs, setNormal: value => { normal = value; } };
}
