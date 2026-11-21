import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');

// Source contract only: no computed-style, rendering or native focus claim.
test('877 outcome topic cards override only their background inside dark mode', () => {
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.outcome-topic-card\s*\{\s*background:\s*#000;?\s*\}\s*\}/);
});

test('877 light cards and their border, text, hover and focus retain the existing rules', () => {
  assert.match(css, /\.outcome-topic-card\{[^}]*border:1px solid var\(--stack-sheet-edge\);border-radius:\.75rem;background:var\(--soft\);box-shadow:var\(--stack-cover-inset\);color:var\(--ink\)/);
  assert.match(css, /\.outcome-topic-card:hover\{border-color:var\(--accent\)\}/);
  assert.match(css, /\.outcome-topic-card:focus-visible\{outline:2px solid var\(--focus\);outline-offset:2px\}/);
});
