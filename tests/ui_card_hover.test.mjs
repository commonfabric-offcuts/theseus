// A person's card under the pointer takes a neutral tint, never the green that
// is Fable's card at rest, in light and in dark, with its words readable and
// no edge or bar. Fable's own hover is the agent palette's, unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const full = hex => hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
const body = (text, selector) => {
  const at = text.indexOf(selector + '{');
  assert.ok(at >= 0, 'aim.css sets ' + selector);
  return text.slice(at + selector.length + 1, text.indexOf('}', at));
};
const values = text => Object.fromEntries([...text.matchAll(/(--[\w-]+|background):(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])/g)].map(m => [m[1], full(m[2])]));
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PERSON = '.message-card:not(.own-message):not(.agent-card):hover';
const themes = () => {
  const root = values(body(css, ':root')), darkAt = css.indexOf('@media(prefers-color-scheme:dark){:root{');
  const darkRoot = { ...root, ...values(body(css.slice(darkAt), '@media(prefers-color-scheme:dark){:root')) };
  const personDarkAt = css.indexOf('@media(prefers-color-scheme:dark){' + PERSON + '{');
  assert.ok(personDarkAt >= 0, 'aim.css sets the dark ' + PERSON);
  return {
    light: { root, hover: values(body(css, PERSON)), green: values(body(css, '.agent-green')) },
    // The light rule applies in dark too; the dark rule overrides only what it names.
    dark: { root: darkRoot, hover: { ...values(body(css, PERSON)), ...values(body(css.slice(personDarkAt + '@media(prefers-color-scheme:dark){'.length), PERSON)) },
      green: values(body(css.slice(css.indexOf('@media(prefers-color-scheme:dark){.agent-')), '.agent-green')) },
  };
};

test('a person\'s card under the pointer is a neutral tint, not Fable\'s green, and its words stay readable', () => {
  for (const [theme, { root, hover, green }] of Object.entries(themes())) {
    const tint = hover.background, rgb = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16));
    assert.ok(tint && tint !== root['--soft'] && tint !== green['--agent-card'], `${theme}: not the green of Fable's card (${tint})`);
    assert.ok(rgb[1] <= Math.max(rgb[0], rgb[2]) && Math.max(...rgb) - Math.min(...rgb) <= 10, `${theme}: neutral, not green (${tint})`);
    assert.ok(contrast(tint, root['--panel']) >= 1.08, `${theme}: the hover shows against the card at rest: ${contrast(tint, root['--panel']).toFixed(2)}`);
    const words = { ...root, ...hover };
    for (const name of ['--ink', '--muted', '--accent', '--alert'])
      assert.ok(contrast(words[name], tint) >= 4.5, `${theme}: ${name} on the hover ${contrast(words[name], tint).toFixed(2)}`);
  }
  assert.doesNotMatch(body(css, PERSON), /border-(left|inline-start)|box-shadow|outline/, 'no edge or bar');
});

test('Fable\'s card keeps its own hover', () => {
  const { light, dark } = themes();
  assert.deepEqual([light.green['--agent-hover'], dark.green['--agent-hover']], ['#dfece5', '#29403a']);
});

// Release 19's hover changed an agent card by only 1.5 to 2.3 (CIEDE2000), so
// the pointer's place was lost on most cards (warp, item 91b). Every card but
// your own now also shows a neutral ring, the quiet text color, on all four
// sides under a pointer that can hover: the signal your own card already
// uses, never a colored edge. Your own card keeps its own hover.
test('any card but your own shows a neutral ring on all four sides under the pointer', () => {
  const found = css.match(/@media\s*\(hover:\s*hover\)\s*\{\s*\.message-card:not\(\.own-message\):hover\s*\{([^{}]*)\}\s*\}/);
  assert.ok(found, 'aim.css rings a hovered card where the pointer can hover');
  assert.equal(found[1].trim(), 'border-color:var(--muted)', 'one color for the whole border, so every side alike');
  const { light, dark } = themes(), split = css.indexOf('@media(prefers-color-scheme:dark){.agent-');
  const agentWords = text => values(body(text, '.message-card.agent-card'));
  const agentHovers = text => [...text.matchAll(/--agent-hover:(#[0-9a-f]{6})/g)].map(m => m[1]);
  for (const [theme, { root, hover }, agents] of [['light', light, css.slice(0, split)], ['dark', dark, css.slice(split)]]) {
    const ring = { person: { ...root, ...hover }['--muted'], agent: { ...root, ...agentWords(agents) }['--muted'] };
    for (const [who, color] of Object.entries(ring)) {
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 20, `${theme} ${who}: the ring is neutral (${color})`);
      assert.ok(contrast(color, root['--line']) >= 2, `${theme} ${who}: the ring stands out from the border at rest`);
    }
    assert.ok(contrast(ring.person, hover.background) >= 3, `${theme}: the ring shows on a person's hover`);
    for (const fill of agentHovers(agents)) assert.ok(contrast(ring.agent, fill) >= 3, `${theme}: the ring shows on an agent's hover ${fill}`);
  }
});
