// Hovering your own message: it stays black, exactly as live, and only its
// border changes; no colored edge or bar, and its words stay readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const rule = selector => {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, 'aim.css sets ' + selector);
  return Object.fromEntries([...css.slice(at + selector.length + 2, css.indexOf('}', at)).matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
};
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('your own message stays black on hover, exactly as live: only its border changes, with no colored edge', () => {
  const rest = rule('.message-card.own-message'), hover = rule('.message-card.own-message:hover');
  const full = color => { assert.match(color, /^#([0-9a-f]{3}){1,2}$/); return color.length === 4 ? '#' + [...color.slice(1)].map(c => c + c).join('') : color; };
  assert.equal(full(rest.background), '#000000', 'at rest your own message is black');
  assert.equal(full(hover.background), '#000000', 'and it stays black under the pointer');
  assert.notEqual(hover['border-color'], rest['border-color'], 'the border is what changes');
  for (const words of ['--ink', '--muted', '--accent'])
    assert.ok(contrast(rest[words], '#000000') >= 4.5, `${words} readable on black: ${contrast(rest[words], '#000000').toFixed(2)}`);
  for (const property of Object.keys(hover)) assert.doesNotMatch(property, /border-(left|inline-start)|box-shadow|outline/, 'no edge or bar');
});
