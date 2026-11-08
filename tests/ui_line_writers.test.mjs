// Every writer of the page's lines (its status line, the Reader's notice, the
// composer's notice, the navigation line) hands a failure to the line as the
// error itself, so the line, not its writer, works out whether what it says
// is about reaching Theseus (web/lines.mjs). A writer that turned the error
// into words first (error.message) would hide its type and code from that
// rule, and a connection line it wrote would outlive the reconnection.
// The check enumerates the writers from the source, so a new one is covered
// the moment it is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['web/app.mjs', 'web/reader.mjs', 'web/inline-composer.mjs'];
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
// status(…), failed(…) and showLine(…) called bare; notice(…) on any receiver
// or bare (an attachment's notice callback); fail(…) on the composer.
const WRITER = /(?<![\w$.])(status|failed|showLine|notice)\(|\.(notice|fail)\(/g;

// The text between a call's parentheses; strings and templates may hold parentheses.
function argumentsAt(text, open) {
  let depth = 0, quote = null;
  for (let at = open; at < text.length; at++) {
    const ch = text[at];
    if (quote) { if (ch === '\\') at++; else if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return text.slice(open + 1, at);
  }
  throw Error('unbalanced call at ' + open);
}

// Every call of a line writer in text, with its line number and arguments;
// a method's own definition (`notice(what) {` at the start of a line) is not a call.
export function writers(text) {
  const found = [];
  for (const match of text.matchAll(WRITER)) {
    const open = match.index + match[0].length - 1, args = argumentsAt(text, open);
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const definition = /^\s*$/.test(text.slice(lineStart, match.index)) && /^\s*\{/.test(text.slice(open + args.length + 2));
    if (!definition) found.push({ line: text.slice(0, match.index).split('\n').length, call: match[0] + args + ')', args });
  }
  return found;
}
const wordsOfAnError = call => /\.message\b/.test(call.args);

test('the scan finds a writer that hands a line an error\'s words, and passes one that hands it the error', () => {
  const caught = writers([
    "status(error.message);",
    "reader.notice('Could not read. ' + error.message);",
    "writingSurface(p).notice(`What changed ${since} (${error.message})`);",
    "inline.fail(error.message);",
    "notice(error.message);",
  ].join('\n')).filter(wordsOfAnError).map(call => call.line);
  assert.deepEqual(caught, [1, 2, 3, 4, 5]);
  const passed = writers([
    "status(error);",
    "reader.notice([`What changed since ${since} (in words)`, error]);",
    "  notice(what, p = this.presentation) {",
    "    showLine(this.$('notice'), what);",
    "  }",
  ].join('\n'));
  assert.deepEqual(passed.filter(wordsOfAnError), []);
  assert.deepEqual(passed.map(call => call.line), [1, 2, 4], 'a method definition is not a call');
});

test('every writer of the page\'s lines hands a failure over as the error itself', () => {
  const all = FILES.flatMap(file => writers(source(file)).map(call => ({ file, ...call })));
  assert.deepEqual(all.filter(wordsOfAnError).map(call => `${call.file}:${call.line} ${call.call}`), []);
  // The writers this redraw routed, so the scan cannot pass by finding nothing.
  const calls = all.map(call => `${call.file}: ${call.call}`);
  for (const expected of ['web/app.mjs: status(error)', 'web/app.mjs: .notice(error)', 'web/app.mjs: .fail(error)', 'web/app.mjs: notice(error)',
    'web/app.mjs: showLine(notice,error)', 'web/reader.mjs: .notice(error)', 'web/inline-composer.mjs: .notice(error, p, editor)']) {
    assert.ok(calls.includes(expected), `the scan finds ${expected}`);
  }
  assert.ok(all.length >= 40, `the scan finds the writers (${all.length})`);
});

test('the lines themselves are written only through showLine', () => {
  // The element of each line, named as the page names it.
  const line = String.raw`(?:\$\('(?:app-status|reader-notice|topic-navigation-status)'\)|this\.\$\('(?:reader-)?notice'\))`;
  // A line held in a name (const notice = $('topic-navigation-status')) is that line too.
  const writes = text => {
    const names = [...text.matchAll(new RegExp(String.raw`(?:const|let)\s+(\w+)\s*=\s*` + line, 'g'))].map(match => match[1]);
    const element = `(?:${[line, ...names.map(name => String.raw`\b${name}`)].join('|')})`;
    return [...text.matchAll(new RegExp(element + String.raw`\.(?:textContent|hidden)\s*=(?!=)|` + element + String.raw`\.(?:append|replaceChildren)\(`, 'g'))].map(match => match[0]);
  };
  assert.deepEqual(writes("$('app-status').textContent = 'x'; this.$('notice').hidden = true;"), ["$('app-status').textContent =", "this.$('notice').hidden ="], 'the scan sees a direct write');
  assert.deepEqual(writes("const notice=$('topic-navigation-status');notice.hidden=true;"), ['notice.hidden='], 'and one through a name');
  assert.deepEqual(writes("$('reader-notice').textContent === said"), [], 'a comparison is not a write');
  const found = FILES.flatMap(file => writes(source(file)).map(write => `${file}: ${write}`));
  assert.deepEqual(found, []);
});
