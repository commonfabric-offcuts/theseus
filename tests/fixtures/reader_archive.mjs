// Supply the real page's Reader archive drawing to DOM-only fixtures.
// It is read from index.html, not duplicated or supplied by the product glyph function.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const source = html.match(/<button id="reader-aside"[\s\S]*?<svg([^>]*)>([\s\S]*?)<\/svg>/);
if (!source) throw Error('Reader archive SVG is missing');
const attributes = text => [...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]);
export function readerArchive(doc) {
  const make = () => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of attributes(source[1])) svg.setAttribute(name, value);
    for (const [, attrs] of source[2].matchAll(/<path([^>]*)\/>/g)) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      for (const [name, value] of attributes(attrs)) path.setAttribute(name, value);
      svg.append(path);
    }
    svg.cloneNode = make;
    return svg;
  };
  return make();
}
export function withReaderArchive(doc) {
  const get = doc.getElementById?.bind(doc), drawing = readerArchive(doc);
  doc.getElementById = id => id === 'reader-aside' ? { querySelector: selector => selector === 'svg' ? drawing : null } : get?.(id) ?? null;
  return doc;
}
