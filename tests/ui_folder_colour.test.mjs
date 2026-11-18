// Item 477: a dossier an agent began wears that agent's colour across its
// folder and its title bar (web/stack-look.css, .reply-stack[data-color=agent]).
// The colours are read from the stylesheets as a browser reads them, for every
// palette colour in light and dark: the folder's words keep 4.5:1 or better on
// it and under the pointer, and the folder stays a step from its cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_PALETTE } from '../web/author-colors.mjs';

const aim = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const look = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
const full = hex => hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
// The declarations of the first rule for selector in text, from offset on.
const rule = (text, selector, from = 0) => {
  const at = text.indexOf(selector + '{', from);
  assert.ok(at >= 0, `the stylesheet sets ${selector}`);
  const body = text.slice(at + selector.length + 1, text.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):([^;]+)/g)].map(m => [m[1], m[2].trim()]));
};
const rgb = hex => [1, 3, 5].map(i => parseInt(full(hex).slice(i, i + 2), 16));
const luminance = c => c.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// A value as the browser computes it, given the agent's own colours: a hex, a var(), or a color-mix in srgb of two.
const resolve = (value, vars) => {
  value = value.trim();
  if (/^#[0-9a-f]{3,6}$/.test(value)) return rgb(value);
  const named = value.match(/^var\(--([\w-]+)\)$/);
  if (named) { assert.ok(named[1] in vars, `${named[1]} is known`); return resolve(vars[named[1]], vars); }
  const mix = value.match(/^color-mix\(in srgb,(.+?) (\d+)%,(.+)\)$/);
  assert.ok(mix, `a colour the check reads: ${value}`);
  const [a, b, t] = [resolve(mix[1], vars), resolve(mix[3], vars), Number(mix[2]) / 100];
  return a.map((v, i) => Math.round(v * t + b[i] * (1 - t)));
};

const darkAim = aim.slice(aim.indexOf('@media(prefers-color-scheme:dark){.agent-'));
const darkLook = look.indexOf('@media(prefers-color-scheme:dark){.reply-stack[data-color=agent]');
const themes = {
  light: { folder: rule(look, '.reply-stack[data-color=agent]:not(.only-new *)'), agents: aim, cards: rule(aim, '.message-card.agent-card') },
  dark: { folder: rule(look, '.reply-stack[data-color=agent]:not(.only-new *)', darkLook), agents: darkAim },
};

test('a coloured folder keeps its words, meta, star and New at 4.5:1 or better on it and under the pointer, for every agent colour, in light and dark', () => {
  assert.ok(darkLook > 0, 'stack-look.css sets the coloured folder for dark');
  for (const [theme, { folder, agents }] of Object.entries(themes)) for (const name of AGENT_PALETTE) {
    const vars = { ...rule(agents, '.agent-' + name), ...folder };
    for (const surface of ['stack-folder', 'stack-folder-deep']) for (const words of ['stack-folder-ink', 'stack-meta-ink', 'stack-star', 'stack-new']) {
      const ratio = contrast(resolve(vars[words], vars), resolve(vars[surface], vars));
      assert.ok(ratio >= 4.5, `${theme} ${name}: ${words} on ${surface} is ${ratio.toFixed(2)}`);
    }
    // The folder is a step from the agent's cards, so its sheets read on it, and it is not the neutral folder.
    const step = contrast(resolve(vars['stack-folder'], vars), resolve(vars['agent-card'], vars));
    assert.ok(step >= 1.07, `${theme} ${name}: the folder stands ${step.toFixed(3)} from its cards`);
  }
});

test('the coloured folder covers a whole face: it sets the folder\'s own colours, never an edge, a bar or a shadow', () => {
  for (const { folder } of Object.values(themes)) {
    assert.deepEqual(Object.keys(folder).sort(), ['stack-folder', 'stack-folder-deep', 'stack-folder-ink', 'stack-meta-ink', 'stack-new', 'stack-star']);
    assert.ok(Object.values(folder).every(value => !/border|shadow|inset/.test(value)));
  }
  // Nowhere does the stack look draw a coloured left edge.
  assert.doesNotMatch(look, /border-left(-color)?:[^;}]*(--agent|--accent|--stack-ring)/);
  assert.doesNotMatch(look, /box-shadow:inset\s+\d/);
});
