// What a character is to the reading of a message's words, as CommonMark
// 0.31.2 says ("Characters and lines"): whitespace, punctuation, or part of a
// word. The marks a line reads (message-format.mjs) and where an address or a
// topic's id may start (links.mjs) both ask here, so a word is one thing.

// Unicode whitespace: the Zs category, tab, line feed, form feed and carriage return.
const SPACE = /^[\p{Zs}\t\n\f\r]$/u;
// Unicode punctuation: the P (punctuation) and S (symbol) categories.
const PUNCTUATION = /^[\p{P}\p{S}]$/u;
const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

// The edges of the words count as whitespace, so undefined is a space.
export const isSpace = char => char === undefined || SPACE.test(char);
export const isPunctuation = char => char !== undefined && PUNCTUATION.test(char);
// A letter, digit or any other character that runs on a word: neither space nor punctuation.
export const isWord = char => !isSpace(char) && !isPunctuation(char);
// What a backslash escapes: ASCII punctuation, and nothing else.
export const isEscapable = char => ASCII_PUNCTUATION.has(char);

// The whole character (code point) just before index k of text, or undefined at its start.
export function charBefore(text, k) {
  if (k <= 0) return undefined;
  const low = text.charCodeAt(k - 1);
  return k >= 2 && low >= 0xdc00 && low <= 0xdfff && text.charCodeAt(k - 2) >= 0xd800 && text.charCodeAt(k - 2) <= 0xdbff ? text.slice(k - 2, k) : text[k - 1];
}
// The whole character starting at index k of text, or undefined at its end.
export function charAt(text, k) {
  if (k >= text.length) return undefined;
  return String.fromCodePoint(text.codePointAt(k));
}
