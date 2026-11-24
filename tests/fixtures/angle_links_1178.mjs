// Real formatter and Deck/Notebook paint owners on memory DOM ports. Explicit
// bubbling below exercises registered handlers, not native input or hover.
import { documentPort, menuPage } from './card_text_867.mjs';
import { painted867 } from './card_menu_867.mjs';

export const reportedTarget = '/Users/commonfabric/Library/Mobile Documents/com~apple~CloudDocs/loom-files copy/Inbox/step-074ce9212c994e5e8937e2fddf6a3a45-shingles-dose-plan.md:28';
export const reportedLink = `[Saved dose plan](<${reportedTarget}>)`;

export function document1178() {
  const doc = documentPort(), make = doc.createElement;
  const edges = node => {
    Object.defineProperties(node, {
      parentNode: { get() { return this.parent ?? null; } },
      nextSibling: { get() { const kids = this.parent?.childNodes ?? []; return kids[kids.indexOf(this) + 1] ?? null; } },
      firstChild: { get() { return this.childNodes?.[0] ?? null; } },
      lastChild: { get() { return this.childNodes?.at(-1) ?? null; } },
    });
    node.remove ??= function () { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; };
    node.before = function (...nodes) { for (const n of nodes) this.parent?.insertBefore(n, this); };
    node.after = function (...nodes) { const next = this.nextSibling; for (const n of nodes) this.parent?.insertBefore(n, next); };
    return node;
  };
  doc.createTextNode = data => edges({ nodeType: 3, data: String(data), childNodes: [],
    get textContent() { return this.data; }, set textContent(value) { this.data = String(value); } });
  doc.createElement = tag => {
    const node = edges(make(tag)), append = node.append;
    node.ownerDocument = doc;
    node.append = (...nodes) => append.call(node, ...nodes.map(n => typeof n === 'string' ? doc.createTextNode(n) : n));
    node.replaceChild = (next, old) => { const at = node.children.indexOf(old); if (at < 0) throw Error('No child'); old.parent = null; node.children[at] = next; next.parent = node; };
    return node;
  };
  doc.createElementNS = (_, tag) => doc.createElement(tag);
  doc.getSelection = () => ({ isCollapsed: true });
  return doc;
}

export function bubble(target, type, extra = {}) {
  const event = { type, target, button: 0, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra };
  for (let node = target; node; node = node.parentNode ?? node.parent) {
    node.listeners?.[type]?.(event);
    if (event.stopped) break;
  }
  return event;
}

export function painted1178(t, body) {
  const doc = document1178(), p = menuPage(body, doc);
  painted867(t, p);
  p.mode = 'cards'; p.holdPage = () => () => {};
  p.paint();
  return p;
}
