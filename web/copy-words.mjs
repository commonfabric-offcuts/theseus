import { COPY_REFUSED, copyText, sayOn } from './message-menu.mjs';
import { clipboardList, clipboardNodes, hasTextDisplayRules } from './message-format.mjs';
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

function semanticSelection(root, doc) {
  // Theseus uses spans for the card's blocks. A document or mail composer
  // needs ordinary block elements to render the same selection.
  const blocks = [...root.querySelectorAll('.md-p, .md-heading, .md-rule, .md-pre, .md-quote, .md-list')].reverse();
  for (const block of blocks) {
    const has = name => block.classList.contains(name);
    if (has('md-list')) {
      const rows = [...block.querySelectorAll(':scope > .md-item')].map(row => {
        const mark = row.querySelector(':scope > .md-marker')?.textContent ?? '';
        const words = row.querySelector(':scope > .md-item-words') ?? row;
        return {
          marker: mark, depth: Number(row.style.getPropertyValue('--md-depth')) || 0,
          contents: [...words.childNodes], task: /^[☐☑]$/.test(mark) ? mark : null,
        };
      });
      const ordered = rows.findIndex(row => /^\d/.test(row.marker));
      if (ordered > 0 && !rows[0].marker) {
        const first = Number.parseInt(rows[ordered].marker, 10) - ordered;
        for (let index = 0; index < ordered; index++) rows[index].marker = String(first + index);
      }
      block.replaceWith(clipboardList(rows, doc));
      continue;
    }
    const heading = /\bmd-h([1-6])\b/.exec(block.className);
    const tag = heading ? 'h' + heading[1] : has('md-quote') ? 'blockquote' : has('md-rule') ? 'hr' : has('md-pre') ? 'pre' : 'p';
    const replacement = doc.createElement(tag);
    if (tag === 'pre') {
      const code = doc.createElement('code');
      code.append(...block.childNodes);
      replacement.append(code);
    } else replacement.append(...block.childNodes);
    block.replaceWith(replacement);
  }
}

export function clipboardSelection(host, projected, doc = globalThis.document) {
  if (!host) return null;
  const selection = doc.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  const plain = hasTextDisplayRules(host) ? projected() : selection.toString();
  if (!plain) return null;
  const rendered = doc.createElement('div');
  let fragment = range.cloneContents();
  const common = range.commonAncestorContainer;
  for (let parent = common.nodeType === 1 ? common : common.parentElement; parent && parent !== host; parent = parent.parentElement) {
    if (!parent.matches('a, b, strong, em, i, code, s, del, .md-list, .md-quote')) continue;
    const wrapper = parent.cloneNode(false);
    wrapper.append(fragment);
    fragment = wrapper;
  }
  rendered.append(fragment);
  for (const control of rendered.querySelectorAll('button, input, iframe, img, .message-attachments, .fence-copy-unavailable, .source-end-line')) control.remove();
  semanticSelection(rendered, doc);
  return { plain, html: pasteHTML(rendered) };
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

export function copyWordsChoice({ selection, cards = false, empty = false, contents, say, status, current = () => true, doc = globalThis.document }) {
  const mac = /Mac|iPhone|iPad/.test(doc?.defaultView?.navigator.platform ?? '');
  return {
    key: 'Copy text',
    label: selection ? 'Copy selected text' : cards ? 'Copy selected cards' : 'Copy text',
    glyph: 'copy',
    keys: selection ? (mac ? '⌘C' : 'Ctrl+C') : undefined,
    disabled: empty,
    tooltip: empty ? 'No text to copy' : undefined,
    act: async () => {
      if (!current()) return;
      const nav = doc.defaultView?.navigator;
      try {
        const ready = Promise.resolve(selection ?? contents()).then(words => {
          if (!current() || !words.plain.trim()) throw Error(COPY_REFUSED);
          return words;
        });
        // Promise-valued blobs let the explicit gesture own the clipboard
        // write even when the authorized full source still has to arrive.
        try {
          const Item = doc.defaultView?.ClipboardItem;
          if (!Item || !nav?.clipboard?.write) await ready;
          else {
            const blob = (type, key) => {
              const pending = ready.then(words => new Blob([words[key]], { type }));
              pending.catch(() => {}); // An unsupported constructor may refuse before it consumes the promises.
              return pending;
            };
            await nav.clipboard.write([new Item({ 'text/plain': blob('text/plain', 'plain'), 'text/html': blob('text/html', 'html') })]);
            if (current()) confirm();
            return;
          }
        } catch { /* The existing plain clipboard path also works in older browsers. */ }
        const { plain } = await ready;
        if (!current()) return;
        if (!await copyText(plain, nav)) throw Error(COPY_REFUSED);
        if (current()) confirm();
      } catch {
        if (current()) status(COPY_REFUSED);
      }
      function confirm() {
        const words = selection ? 'Selection copied' : cards ? 'Cards copied' : 'Text copied';
        if (say?.getClientRects().length) sayOn(say, words, doc);
        else status(words + '.');
      }
    },
  };
}
