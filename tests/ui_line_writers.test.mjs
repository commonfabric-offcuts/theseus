// Every writer of the page's lines (its status line, the Reader's notice, the
// composer's notice, the navigation line) hands a failure to the line as the
// error itself, so the line, not its writer, works out whether what it says
// is about reaching Theseus (web/lines.mjs). A writer that turned the error
// into words first (error.message) would hide its type and code from that
// rule, and a connection line it wrote would outlive the reconnection.
// A failure can also lose them before any writer sees it: a catch that throws
// words of its own, or writes them, in place of what it caught. So in every
// module of the page, a catch that writes a line or makes a new error hands on
// what it caught: as itself, or as the cause of its own words.
// The checks enumerate the writers and the catches from the source, so a new
// one is covered the moment it is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const FILES = ['web/app.mjs', 'web/reader.mjs', 'web/inline-composer.mjs'];
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
// status(…), failed(…) and showLine(…) called bare; notice(…) on any receiver
// or bare (an attachment's notice callback); fail(…) on the composer.
const WRITER = /(?<![\w$.])(status|failed|showLine|notice)\(|\.(notice|fail)\(/g;

// Where the bracket opened at `open` closes; strings, templates and comments may hold brackets.
function closing(text, open) {
  const pair = { '(': ')', '{': '}', '[': ']' }[text[open]];
  let depth = 0, quote = null;
  for (let at = open; at < text.length; at++) {
    const ch = text[at];
    if (quote) { if (ch === '\\') at++; else if (ch === quote) quote = null; continue; }
    if (ch === '/' && text[at + 1] === '/') { at = text.indexOf('\n', at); if (at < 0) break; continue; }
    if (ch === '/' && text[at + 1] === '*') { at = text.indexOf('*/', at) + 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    else if (ch === text[open]) depth++;
    else if (ch === pair && --depth === 0) return at;
  }
  throw Error('unbalanced bracket at ' + open);
}
// The text between a call's parentheses.
const argumentsAt = (text, open) => text.slice(open + 1, closing(text, open));
// The top-level parts of a list of arguments or of an array's elements.
function split(text) {
  const parts = []; let from = 0;
  for (let at = 0; at < text.length; at++) {
    const ch = text[at];
    if ('([{'.includes(ch)) at = closing(text, at);
    else if (ch === '\'' || ch === '"' || ch === '`') { const quote = ch; for (at++; at < text.length && text[at] !== quote; at++) if (text[at] === '\\') at++; }
    else if (ch === ',') { parts.push(text.slice(from, at)); from = at + 1; }
  }
  parts.push(text.slice(from));
  return parts.map(part => part.trim()).filter(Boolean);
}

// Every call of a line writer in text, with its line number and arguments;
// a method's own definition (`notice(what) {` at the start of a line) is not a call.
export function writers(text) {
  const found = [];
  for (const match of text.matchAll(WRITER)) {
    const open = match.index + match[0].length - 1, args = argumentsAt(text, open);
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const definition = /^\s*$/.test(text.slice(lineStart, match.index)) && /^\s*\{/.test(text.slice(open + args.length + 2));
    if (!definition) found.push({ at: match.index, line: text.slice(0, match.index).split('\n').length, call: match[0] + args + ')', args });
  }
  return found;
}
const wordsOfAnError = call => /\.message\b/.test(call.args);

// Every catch in text: a catch block, or the handler given to .catch(…) or as
// .then(…)'s second argument; with where it is and the name it gives what it
// caught (null when it gives none). A handler named rather than written out
// (.catch(failed)) is handed what was caught, so it is no catch here.
export function catches(text) {
  const found = [];
  for (const match of text.matchAll(/\bcatch\s*(?:\(\s*([\w$]+)\s*\))?\s*\{/g)) {
    if (/[.\w$]$/.test(text.slice(0, match.index))) continue;
    const open = match.index + match[0].length - 1;
    found.push({ start: open, end: closing(text, open), binding: match[1] ?? null });
  }
  for (const match of text.matchAll(/\.(catch|then)\(/g)) {
    const open = match.index + match[0].length - 1, args = split(argumentsAt(text, open));
    const handler = match[1] === 'catch' ? args[0] : args[1];
    if (!handler) continue;
    const head = handler.match(/^(?:async\s*)?(?:\(\s*([\w$]*)\s*\)|([\w$]+))\s*=>/) ?? handler.match(/^(?:async\s+)?function\s*[\w$]*\s*\(\s*([\w$]*)\s*\)/);
    if (!head) continue;
    const start = text.indexOf(handler, open);
    found.push({ start, end: start + handler.length, binding: head[1] || head[2] || null });
  }
  return found;
}
// The innermost catch holding the text at `at`.
const within = (all, at) => all.filter(c => c.start <= at && at < c.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? null;
const ERROR = /(?<![\w$.])(?:new\s+)?(?:Attempt)?Error\(/g, MADE = /^(?:new\s+)?(?:Attempt)?Error\(/;
// An error made in a catch names the failure it stands for as its cause: what
// was caught, or, when its words are about another failure, that one.
const carries = args => /[{,]\s*cause\s*(?::|[,}])/.test(args);
// A writer hands on what was caught: as itself, alone or in a list, or as the
// cause of an error of its own words; or it clears its line ('').
function handsOn(args, binding) {
  const parts = split(args);
  if (parts.length === 1 && /^(['"`])\1$/.test(parts[0])) return true;
  return parts.flatMap(part => part.startsWith('[') ? split(part.slice(1, -1)) : [part])
    .some(part => part === binding || MADE.test(part) && carries(part));
}
// Each write or new error in a catch that does not hand on what it caught.
export function dropped(text) {
  const all = catches(text), out = [];
  for (const call of writers(text)) {
    const c = within(all, call.at);
    if (c && !handsOn(call.args, c.binding)) out.push(`${call.line}: ${call.call}`);
  }
  for (const match of text.matchAll(ERROR)) {
    const open = match.index + match[0].length - 1, args = argumentsAt(text, open), c = within(all, match.index);
    if (c && !carries(args)) out.push(`${text.slice(0, match.index).split('\n').length}: ${match[0]}${args})`);
  }
  return out;
}

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

test('the scan finds a catch that writes or throws words of its own in place of what it caught, and passes one that hands it on', () => {
  const caught = dropped([
    "try { await read(); } catch { reader.notice('Connection interrupted; whether the mark was saved is unknown.'); }",
    "try { receipt = await send(); } catch { throw Error('Connection interrupted; this page may still show as changed.'); }",
    "colors.load().catch(() => { throw Error('The agent colors could not be read. Try again.'); });",
    "try { x(); } catch (error) { const failure = readFailure(error); inline.notice(['Could not confirm topic access.', failure]); }",
    "try { x(); } catch (error) { status(Error('Could not.')); }",
    "p.then(ok, () => notice('Could not copy.'));",
  ].join('\n'));
  assert.deepEqual(caught.map(entry => Number(entry.split(':')[0])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 5, 6]);
  const passed = dropped([
    "try { x(); } catch (error) { reader.notice(error); }",
    "try { x(); } catch (error) { reader.notice([`What changed since ${since} could not be read.`, error]); }",
    "try { x(); } catch (error) { throw Error('Connection interrupted.', { cause: error }); }",
    "try { x(); } catch (cause) { throw new AttemptError('Lost.', 0, null, { cause }); }",
    "try { x(); } catch (error) { reader.notice(Error('Whether the mark was saved is unknown.', { cause: error })); }",
    "p.catch(failed); p.catch(() => false); p.then(() => true, () => false);",
    "try { x(); } catch { notice(''); }",
    "try { x(); } catch (error) { try { y(); } catch (inner) { notice(inner); } throw error; }",
    "status(error); throw Error('Outside any catch.');",
    "try { x(); } catch (error) { throw Error('Words about another failure.', { cause: kept.reason }); }",
  ].join('\n'));
  assert.deepEqual(passed, []);
});

test('in every module of the page, a catch that writes a line or makes a new error hands on what it caught', () => {
  const modules = readdirSync(new URL('../web/', import.meta.url)).filter(name => name.endsWith('.mjs')).map(name => 'web/' + name);
  assert.ok(modules.length >= 50 && modules.includes('web/page-reads.mjs') && modules.includes('web/api.mjs'), `the scan reads the page's modules (${modules.length})`);
  const all = modules.flatMap(file => catches(source(file)).map(c => ({ file, ...c })));
  assert.ok(all.length >= 100, `the scan finds the catches (${all.length})`);
  assert.deepEqual(modules.flatMap(file => dropped(source(file)).map(entry => `${file}:${entry}`)), []);
});
