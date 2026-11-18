// Cheap style/placement contract. Real layout and every hit point are measured
// by the native item 649 B1/B2 matrices, not simulated by this check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const stacks = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
const rule = selector => {
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector);
  assert.ok(match, selector + ' has a rule');
  return Object.fromEntries(match[2].split(';').filter(Boolean).map(p => p.split(':').map(s => s.trim())));
};
test('item 649 B1: a static dossier root owns its corner in normal card flow without moving the folder tab', () => {
  assert.equal(rule('.note-corner').position, 'static', 'B1: corner participates in its own card flow');
  assert.match(stacks, /\.stack-head-card\{position:static\}/, 'folder tab retains its containing block');
  assert.match(stacks, /\.stack-head-card>\.stack-head,\.reply-stack>\.stack-rename\)\{position:absolute/);
});
test('item 649 B2: a whole 44px target occupies flow before the ordinary overlap allowance, with no padding workaround', () => {
  const corner = rule('.note-corner');
  assert.equal(corner.position, 'static', 'B2: target cannot extend backward over words or forward into the next sheet');
  assert.equal(corner.display, 'flex');
  assert.equal(corner.width, '2.75rem'); assert.equal(corner.height, '2.75rem');
  assert.equal(corner['margin-left'], 'auto');
  assert.ok(!corner.bottom && !corner.top && !corner['margin-bottom'], 'no negative placement into reserved overlap');
  assert.ok(!css.includes('.message-card:has(>.note-corner){padding-bottom:'), 'card system owns padding');
  assert.match(stacks, /padding-bottom:calc\(1rem \+ var\(--stack-overlap\)\)/, 'existing overlap allowance remains');
});
