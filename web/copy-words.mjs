import { COPY_REFUSED, copyText, sayOn } from './message-menu.mjs';
import { clipboardNodes, hasTextDisplayRules } from './message-format.mjs';
import { stripDetails } from './card-details.mjs';
import { deckBody, parseDeck } from './deck.mjs';
import { fenceEnd, fenceOpen } from './fences.mjs';

const attachment = /!?\[[^\]\r\n]*\]\(<?attachment:[A-Za-z0-9._-]{1,200}>?\)/g;
const inlineCode = /`+[^`]*`+/g;

function withoutAttachments(markdown) {
  if (!markdown.includes('attachment:')) return markdown;
  const lines = markdown.split('\n');
  let fence = null;
  return lines.flatMap((line, index) => {
    if (fence) {
      if (fenceEnd(line, fence) >= 0) fence = null;
      return [line];
    }
    const opening = fenceOpen(line, lines[index + 1] ?? '');
    if (opening) {
      if (opening.end < 0) fence = opening;
      return [line];
    }
    const code = [...line.matchAll(inlineCode)];
    const words = line.replace(attachment, (token, at) =>
      code.some(span => at >= span.index && at < span.index + span[0].length) ? token : '');
    return !words.trim() && words !== line ? [] : [words];
  }).join('\n');
}

export const hasClipboardWords = markdown => Boolean(withoutAttachments(markdown ?? '').trim());

export function clipboardWords(markdown, doc = globalThis.document, options) {
  const plain = withoutAttachments(markdown ?? '');
  const rendered = doc.createElement('div');
  rendered.append(...clipboardNodes(plain, { ...options, doc }));
  return { plain, html: pasteHTML(rendered) };
}

function pasteHTML(rendered) {
  for (const link of rendered.querySelectorAll('a[href]')) link.setAttribute('href', link.href);
  const doc = rendered.ownerDocument;
  const walker = doc?.createTreeWalker?.(rendered, 4), breaks = [];
  for (let node; walker && (node = walker.nextNode());) {
    if (node.data.includes('\n') && !node.parentElement.closest('pre')) breaks.push(node);
  }
  for (const node of breaks) {
    const lines = node.data.split(/\r?\n/);
    node.replaceWith(...lines.flatMap((line, index) => index ? [doc.createElement('br'), line] : [line]));
  }
  return rendered.innerHTML;
}

export function clipboardSelection(host, projected, doc = globalThis.document) {
  if (!host) return null;
  const selection = doc?.getSelection?.();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  return (hasTextDisplayRules(host) ? projected() : selection.toString()) || null;
}

export function notebookClipboard(body, mode, selected, doc = globalThis.document) {
  const words = stripDetails(body ?? '');
  if (mode !== 'cards') return clipboardWords(words, doc);
  const deck = parseDeck(words), parts = [];
  if (!selected?.size && deck.opening.trim()) parts.push(deck.opening);
  deck.cards.forEach((card, index) => {
    if (!selected?.size || selected.has(index)) parts.push(deckBody({ opening: '', cards: [card] }));
  });
  const entries = parts.map(part => clipboardWords(part.replace(/\s+$/, ''), doc));
  return { plain: entries.map(entry => entry.plain).join('\n\n'), html: entries.map(entry => entry.html).join('<hr>') };
}

export async function writeClipboardWords(contents, doc, current = () => true) {
  const win = doc?.defaultView, nav = win?.navigator ?? globalThis.navigator;
  const ready = Promise.resolve(contents()).then(words => {
    if (!current() || !words.plain.trim()) throw Error(COPY_REFUSED);
    return words;
  });
  // Promise-valued blobs preserve the press's activation while the full
  // authorized source arrives. Only build HTML for a clipboard that accepts it.
  try {
    const Item = win?.ClipboardItem;
    if (Item && nav?.clipboard?.write) {
      const blob = (type, value) => {
        const pending = ready.then(words => new Blob([value(words)], { type }));
        pending.catch(() => {}); // A constructor can refuse before consuming its promises.
        return pending;
      };
      await nav.clipboard.write([new Item({
        'text/plain': blob('text/plain', words => words.plain),
        'text/html': blob('text/html', words => typeof words.html === 'function' ? words.html() : words.html),
      })]);
      return true;
    }
  } catch { /* The plain clipboard path also works when the browser refuses rich copy. */ }
  const { plain } = await ready;
  return current() && copyText(plain, nav);
}

export function copyWordsChoice({ selection, cards = false, empty = false, contents, say, status, current = () => true, doc = globalThis.document }) {
  const mac = /Mac|iPhone|iPad/.test(doc?.defaultView?.navigator?.platform ?? '');
  return {
    key: 'Copy text',
    label: selection ? 'Copy selected text' : cards ? 'Copy selected cards' : 'Copy text',
    glyph: 'copy',
    keys: selection ? (mac ? '⌘C' : 'Ctrl+C') : undefined,
    disabled: empty,
    tooltip: empty ? 'No text to copy' : undefined,
    act: async () => {
      if (!current()) return;
      let copied = false;
      try {
        copied = selection ? await copyText(selection, doc?.defaultView?.navigator) : await writeClipboardWords(contents, doc, current);
      } catch { /* A refused source read also leaves the clipboard untouched. */ }
      if (!current()) return;
      if (!copied) { status(COPY_REFUSED); return; }
      const words = selection ? 'Selection copied' : cards ? 'Cards copied' : 'Text copied';
      if (say?.getClientRects().length) sayOn(say, words, doc);
      else status(words + '.');
    },
  };
}
