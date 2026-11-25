// Viewer/device preferences only. Core's cover words and revision are untouched.
import { parseBlocks, formatNodes, inlineNodes } from './message-format.mjs';

const documents = new WeakMap();
const PREFIX = 'theseus:cover-sections:1:';
function readChoices(doc, key) {
  try {
    const value = JSON.parse(doc.defaultView?.localStorage.getItem(key) ?? 'null');
    const choices = new Map();
    for (const entry of Array.isArray(value) ? value : []) {
      if (typeof entry === 'string') choices.set(entry, false); // 1006 closed choices.
      else if (entry && typeof entry.section === 'string' && entry.open === true) choices.set(entry.section, true);
    }
    return choices;
  } catch { return new Map(); }
}
function show(section, open) {
  if (!open && section.children[1]?.contains?.(section.ownerDocument?.activeElement)) section.children[0].focus({ preventScroll: true });
  section.open = open;
}
function sync(doc, key, choices) {
  for (const node of doc.querySelectorAll?.('.cover-section') ?? []) {
    if (node.dataset.coverFoldScope === key) show(node, choices.get(node.dataset.coverFoldSection) ?? node.dataset.coverFoldDefault === 'true');
  }
}
function preferences(doc) {
  if (documents.has(doc)) return documents.get(doc);
  const kept = new Map(); documents.set(doc, kept);
  doc.defaultView?.addEventListener('storage', event => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    for (const key of kept.keys()) if (event.key === null || event.key === key) {
      const choices = readChoices(doc, key); kept.set(key, choices); sync(doc, key, choices);
    }
  });
  return kept;
}

// Authored sections and generated items share exactly one preference owner.
export function coverDisclosure(heading, { doc, viewer, topicId, rootId, sectionId, initiallyOpen = true }) {
  const key = viewer && rootId ? PREFIX + JSON.stringify([viewer, topicId ?? null, rootId]) : null;
  const kept = preferences(doc);
  if (key && !kept.has(key)) kept.set(key, readChoices(doc, key));
  const section = doc.createElement('details'); section.className = 'cover-section';
  const summary = doc.createElement('summary'); summary.className = 'cover-section-heading'; summary.append(heading);
  const body = doc.createElement('div'); body.className = 'cover-section-body';
  section.append(summary, body); section.dataset.coverFoldDefault = String(initiallyOpen);
  section.open = (key ? kept.get(key).get(sectionId) : undefined) ?? initiallyOpen;
  if (key) {
    section.dataset.coverFoldScope = key; section.dataset.coverFoldSection = sectionId;
    section.addEventListener('toggle', () => {
      const current = kept.get(key);
      if (section.open === (current.get(sectionId) ?? initiallyOpen)) return;
      current.set(sectionId, section.open);
      try {
        doc.defaultView?.localStorage.setItem(key, JSON.stringify([...current].map(([id, open]) => open ? { section: id, open: true } : id)));
      } catch { /* A refused preference write keeps the in-document choice. */ }
      sync(doc, key, current);
    });
  }
  return { section, summary, body };
}

// Group the existing painter's nodes, keeping their source maps/links/marks.
// A heading owns through the next heading of the same or higher level (14897).
export function coverSectionNodes(text, { doc, viewer, topicId, rootId }) {
  const nodes = formatNodes(text, { doc });
  const blocks = parseBlocks(text);
  if (!blocks.some(block => block.kind === 'heading')) return nodes;
  const output = [], parents = [], occurrences = new Map();
  const append = node => parents.length ? parents.at(-1).body.append(node) : output.push(node);
  for (const [index, node] of nodes.entries()) {
    const heading = blocks[index]?.kind === 'heading' ? blocks[index] : null;
    if (!heading) { append(node); continue; }
    while (parents.length && parents.at(-1).level >= heading.level) parents.pop();
    const marker = /[ \t]+\{folded\}$/.exec(heading.words.text);
    let label = node, source = text.slice(heading.start, heading.end);
    if (marker && marker.index > 0) {
      // Reuse mapped inline words from the parser. Never shift the remaining
      // source or retain a parent source span that includes the annotation.
      label = doc.createElement('span'); label.className = node.className;
      label.append(...inlineNodes(heading.words.slice(0, marker.index), { doc }));
      source = text.slice(heading.start, heading.words.at(marker.index)) + text.slice(heading.words.end(), heading.end);
    }
    const name = JSON.stringify([heading.level, source]);
    const occurrence = occurrences.get(name) ?? 0; occurrences.set(name, occurrence + 1);
    const sectionId = JSON.stringify([name, occurrence]);
    const { section, body } = coverDisclosure(label, { doc, viewer, topicId, rootId, sectionId, initiallyOpen: !(marker && marker.index > 0) });
    append(section); parents.push({ level: heading.level, body });
  }
  return output;
}
