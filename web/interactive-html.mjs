// The application never parses a fence as HTML. Only the opaque sandbox does.
import { fenceOpen, fenceEnd } from './fences.mjs';

export const HTML_BYTES = 131072;
const channels = new WeakMap();
const protocol = 'theseus-html-1';
const unsupported = "This page's browser cannot isolate this block's network, so it is shown as text.";

function sourceFallback(doc, source, reason) {
  const wrap = doc.createElement('span'), note = doc.createElement('span'), code = doc.createElement('span');
  wrap.className = 'html-source'; note.className = 'html-refusal'; note.setAttribute('role', 'note');
  note.textContent = reason; code.className = 'md-block md-pre'; code.textContent = source;
  wrap.append(note, code); return wrap;
}

function channel(win) {
  if (channels.has(win)) return channels.get(win);
  const frames = new WeakMap();
  win.addEventListener('message', event => {
    const entry = event.source && frames.get(event.source), value = event.data;
    if (!entry || !entry.frame.isConnected || event.origin !== 'null' || !value ||
        value.protocol !== protocol || value.nonce !== entry.nonce) return;
    if (value.kind === 'refused') {
      entry.block.replaceChildren(sourceFallback(entry.doc, entry.original, unsupported));
    } else if (value.kind === 'height' && Number.isFinite(value.height)) {
      entry.frame.style.height = `${Math.max(48, Math.min(4096, value.height))}px`;
    } else if (value.kind === 'link' && typeof value.href === 'string' && value.href.length <= 4096 &&
               win.navigator?.userActivation?.isActive) {
      try {
        const url = new URL(value.href);
        if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password)
          win.open(url.href, '_blank', 'noopener,noreferrer');
      } catch { /* An untrusted frame's malformed address has no effect. */ }
    }
  });
  channels.set(win, frames);
  return frames;
}

export function interactiveHTML(source, doc = globalThis.document, original = '```html\n' + source + '\n```') {
  if (new TextEncoder().encode(source).length > HTML_BYTES) {
    return sourceFallback(doc, original, 'This HTML block is too large to display. Its source is kept.');
  }
  const frame = doc.createElement('iframe');
  // Keep the Reader's passage/source-position owner through asynchronous refusal.
  const block = doc.createElement('span'); block.className = 'html-block'; block.append(frame);
  frame.className = 'html-frame'; frame.title = 'Interactive HTML';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = '/interactive-html';
  const win = doc.defaultView;
  // A DOM-only renderer has no browsing context. There is no alternate transport.
  if (win) {
    const bytes = win.crypto.getRandomValues(new Uint8Array(24));
    const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const frames = channel(win);
    frame.onload = () => {
      if (!frame.isConnected || !frame.contentWindow) return;
      frames.set(frame.contentWindow, { frame, block, nonce, doc, original });
      frame.contentWindow.postMessage({ protocol, kind: 'init', nonce, html: source }, '*');
    };
  }
  return block;
}

// Cover text is literal. Consume every kind of fence so an html-looking line
// inside a different fence never becomes a document. Keep untouched CRLFs.
export function literalHTMLNodes(text, doc = globalThis.document) {
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0]);
  const nodes = []; let at = 0;
  const words = line => line[0].replace(/\r?\n$/, '');
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceOpen(words(lines[i]), lines[i + 1] ? words(lines[i + 1]) : '');
    if (!fence || fence.end >= 0) continue;
    let j = i + 1, end = -1;
    for (; j < lines.length; j++) if ((end = fenceEnd(words(lines[j]), fence)) >= 0) break;
    if (end >= 0 && fence.lang.toLowerCase() === 'html') {
      const start = lines[i].index, finish = lines[j].index + words(lines[j]).length;
      if (at < start) nodes.push(doc.createTextNode(text.slice(at, start)));
      const payload = text.slice(lines[i].index + lines[i][0].length, lines[j].index + end).replace(/\r?\n$/, '');
      nodes.push(interactiveHTML(payload, doc, text.slice(start, finish))); at = finish;
    }
    i = j;
  }
  if (at < text.length || !nodes.length) nodes.push(doc.createTextNode(text.slice(at)));
  return nodes;
}
