// A native mode's built-in mutants (tests/reader_native.mjs) each name the
// case they break by its index, and the words its failure must carry as a
// pattern: a mutant counts as caught only when that case fails with words the
// pattern matches. When an assertion's words are reworded and the pattern is
// not, the mutant is still caught but counted as missed, and the mode is red
// every run. Each pattern is held here to the words its case can say: one of
// the case's own assertion messages, with what a template fills in taken from
// the case's own strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TESTS = path.dirname(new URL(import.meta.url).pathname);

// The string and template literals in a piece of source, in order. A template
// is its parts with what each ${…} fills in left as the gaps between them.
export function literals(source) {
  const found = [];
  let at = 0;
  const quoted = quote => {
    let text = '';
    for (at++; at < source.length && source[at] !== quote; at++) {
      if (source[at] === '\\') { at++; text += source[at] === 'n' ? '\n' : source[at]; } else text += source[at];
    }
    at++;
    return text;
  };
  const template = () => {
    const parts = [''];
    for (at++; at < source.length && source[at] !== '`'; at++) {
      if (source[at] === '\\') { at++; parts[parts.length - 1] += source[at]; continue; }
      if (source[at] === '$' && source[at + 1] === '{') {
        at += 2;
        for (let depth = 1; at < source.length; at++) {
          const c = source[at];
          if (c === "'" || c === '"') { found.push({ parts: [quoted(c)] }); at--; continue; }
          if (c === '`') { found.push(template()); at--; continue; }
          if (c === '{') depth++;
          if (c === '}' && --depth === 0) break;
        }
        parts.push('');
        continue;
      }
      parts[parts.length - 1] += source[at];
    }
    at++;
    return { parts };
  };
  while (at < source.length) {
    const c = source[at];
    if (c === '/' && source[at + 1] === '/') { at = source.indexOf('\n', at); if (at < 0) break; continue; }
    if (c === "'" || c === '"') found.push({ parts: [quoted(c)] });
    else if (c === '`') found.push(template());
    else at++;
  }
  return found;
}

// The words a case can say: each literal, a template's gaps filled with each
// of the case's plain strings in turn.
function sayings(body) {
  const all = literals(body), plain = all.filter(each => each.parts.length === 1).map(each => each.parts[0]);
  return all.flatMap(each => (each.parts.length === 1 ? [each.parts[0]] : ['', ...plain].map(fill => each.parts.join(fill))));
}

// A case with the helpers it calls, and the helpers they call: the
// statements before the first case that define a name the case calls.
function withHelpers(body, preamble) {
  const helpers = new Map();
  for (const statement of preamble.split(/\n(?=  (?:const|let|async function|function) )/)) {
    const name = /^  (?:const|let|async function|function) (\w+)/.exec(statement)?.[1];
    if (name) helpers.set(name, statement);
  }
  const reached = new Set();
  let text = body;
  for (let more = true; more;) {
    more = false;
    for (const [name, statement] of helpers) {
      if (reached.has(name) || !new RegExp(`\\b${name}\\(`).test(text)) continue;
      reached.add(name); text += '\n' + statement; more = true;
    }
  }
  return text;
}

// Each mode's cases in order, as check() pushes them, and its mutants.
function table(source) {
  const [preamble, ...bodies] = source.split(/\n  await check\(/);
  const cases = bodies.map(body => withHelpers(body.split('\n  const selectedCases')[0], preamble));
  const mutants = [];
  for (const block of source.split('const definitions = ').slice(1)) {
    const region = block.split('for (const mutant of')[0];
    const named = (region.match(/\{ name: '/g) ?? []).length;
    const each = [...region.matchAll(/\{ name: '([^']+)', file: '[^']+', index: (\d+),[\s\S]*?expected: \/((?:\\.|[^/\\\n])+)\/([a-z]*) \}/g)];
    assert.equal(each.length, named, 'every mutant in the table is read here');
    mutants.push(...each.map(([, name, index, pattern, flags]) => ({ name, index: Number(index), expected: new RegExp(pattern, flags) })));
  }
  return { cases, mutants };
}

const modes = readdirSync(TESTS).filter(name => name.endsWith('_native.mjs'))
  .map(name => ({ name, ...table(readFileSync(path.join(TESTS, name), 'utf8')) })).filter(mode => mode.mutants.length);

test('every built-in mutant expects words its case says', () => {
  assert.ok(modes.some(mode => mode.name === 'reader_native.mjs'), 'reader_native.mjs has mutants');
  for (const { name, cases, mutants } of modes) {
    for (const mutant of mutants) {
      const body = cases[mutant.index];
      assert.ok(body, `${name}: ${mutant.name} names case ${mutant.index}, which is there`);
      assert.ok(sayings(body).some(words => mutant.expected.test(words)), `${name}: ${mutant.name} expects ${mutant.expected}, which no assertion in its case says`);
    }
  }
});

test('the reading of a case: a pattern its case does not say is missed, one it says through a template is found', () => {
  const source = "const definitions = [\n      { name: 'm', file: 'web/x.mjs', index: 0, from: 'a', to: 'b', expected: /up is the newer message/ },\n    ];\n    for (const mutant of definitions) {}";
  const cases = `\n  await check('one', async () => {\n    assert.ok(x, 'up is the message above');\n    for (const label of ['wide']) assert.ok(y, \`\${label}: "\${'z'.repeat(2)}" moves nothing\`);\n  });\n  const selectedCases = [];\n`;
  const { cases: read, mutants } = table(cases + source);
  assert.equal(read.length, 1);
  assert.equal(mutants.length, 1);
  assert.equal(sayings(read[0]).some(words => mutants[0].expected.test(words)), false, 'the old words are not said');
  assert.ok(sayings(read[0]).some(words => /up is the message above/.test(words)), 'the new words are');
  assert.ok(sayings(read[0]).some(words => /^: "" moves nothing$/.test(words)), 'a template is read with its gaps');
  assert.ok(sayings(read[0]).some(words => /^wide: "wide" moves nothing$/.test(words)), 'and filled with the case\'s own strings');
});
