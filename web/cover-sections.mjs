// Viewer/device preferences only. Core's cover words and revision are untouched.
import { parseBlocks, formatNodes } from './message-format.mjs';

const documents = new WeakMap();
const PREFIX = 'theseus:cover-sections:1:';
function readClosed(doc, key) {
  try {
    const value = JSON.parse(doc.defaultView?.localStorage.getItem(key) ?? 'null');
    return new Set(Array.isArray(value) ? value.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function sync(doc, key, closed) {
  for (const node of doc.querySelectorAll?.('.cover-section') ?? []) {
    if (node.dataset.coverFoldScope === key) node.open = !closed.has(node.dataset.coverFoldSection);
  }
}
function preferences(doc) {
  if (documents.has(doc)) return documents.get(doc);
  const kept = new Map(); documents.set(doc, kept);
  doc.defaultView?.addEventListener('storage', event => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    for (const key of kept.keys()) if (event.key === null || event.key === key) {
      const closed = readClosed(doc, key); kept.set(key, closed); sync(doc, key, closed);
    }
  });
  return kept;
}

// Group the existing painter's nodes, keeping their source maps/links/marks.
// A heading owns through the next heading of the same or higher level (14897).
export function coverSectionNodes(text, { doc, viewer, topicId, rootId }) {
  const nodes = formatNodes(text, { doc });
  const blocks = parseBlocks(text);
  if (!blocks.some(block => block.kind === 'heading')) return nodes;
  const key = viewer && rootId ? PREFIX + JSON.stringify([viewer, topicId ?? null, rootId]) : null;
  const kept = preferences(doc);
  if (key && !kept.has(key)) kept.set(key, readClosed(doc, key));
  const closed = key ? kept.get(key) : new Set();
  const output = [], parents = [], occurrences = new Map();
  const append = node => parents.length ? parents.at(-1).body.append(node) : output.push(node);
  for (const [index, node] of nodes.entries()) {
    // With no display rules, formatNodes paints these blocks one-for-one.
    // A heading's first readable position is after its Markdown prefix; it
    // is not the block boundary and cannot be used to look up its level.
    const heading = blocks[index]?.kind === 'heading' ? blocks[index] : null;
    if (!heading) { append(node); continue; }
    while (parents.length && parents.at(-1).level >= heading.level) parents.pop();
    const name = JSON.stringify([heading.level, text.slice(heading.start, heading.end)]);
    const occurrence = occurrences.get(name) ?? 0; occurrences.set(name, occurrence + 1);
    const sectionId = JSON.stringify([name, occurrence]);
    const section = doc.createElement('details'); section.className = 'cover-section';
    const summary = doc.createElement('summary'); summary.className = 'cover-section-heading'; summary.append(node);
    const body = doc.createElement('div'); body.className = 'cover-section-body';
    section.append(summary, body); section.open = !closed.has(sectionId);
    if (key) {
      section.dataset.coverFoldScope = key; section.dataset.coverFoldSection = sectionId;
      section.addEventListener('toggle', () => {
        const current = kept.get(key);
        if (section.open === !current.has(sectionId)) return;
        if (section.open) current.delete(sectionId); else current.add(sectionId);
        try {
          if (current.size) doc.defaultView?.localStorage.setItem(key, JSON.stringify([...current]));
          else doc.defaultView?.localStorage.removeItem(key);
        } catch { /* A refused preference write keeps the in-document choice. */ }
        sync(doc, key, current);
      });
    }
    append(section); parents.push({ level: heading.level, body });
  }
  return output;
}
