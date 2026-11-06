// Each agent's own color: which color an agent gets, which cards carry it,
// and that every color keeps the card's words readable in both themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_PALETTE, agentColor, cardClass } from '../web/author-colors.mjs';

test('the team\'s agents have fixed colors, and any other agent always gets the same one', () => {
  assert.deepEqual(['aim-lead', 'aim-ux', 'fable', 'aim-core', 'aim-spec', 'warp'].map(agentColor),
    ['blue', 'violet', 'orchid', 'cyan', 'rose', 'peach']);
  // FNV-1a over the UTF-8 bytes, worked out separately.
  assert.deepEqual(['aim-next-bot', 'codex', 'x', 'fixture-notebook-agent'].map(agentColor), ['blue', 'rose', 'olive', 'rose']);
  assert.equal(agentColor('codex'), agentColor('codex'));
  const used = new Set(Array.from({ length: 200 }, (_, n) => agentColor('agent-' + n)));
  assert.deepEqual([...used].sort(), [...AGENT_PALETTE].sort(), 'other agents spread over the whole palette');
  assert.equal(agentColor('constructor'), agentColor('constructor'));
  assert.ok(AGENT_PALETTE.includes(agentColor('toString')), 'a name on Object.prototype is just another id');
  for (const bad of ['', null, undefined, 3]) assert.throws(() => agentColor(bad), /agent id/);
});

test('an agent\'s card carries its color; the person\'s own and other people\'s cards do not', () => {
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent' }, 'tony'), 'message-card agent-card agent-orchid');
  assert.equal(cardClass({ author_id: 'tony', author_kind: 'human' }, 'tony'), 'message-card own-message', 'your own message keeps its black');
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent' }, 'fable'), 'message-card own-message', 'an agent reading its own message sees it as its own');
  assert.equal(cardClass({ author_id: 'dan', author_kind: 'human' }, 'tony'), 'message-card');
  assert.equal(cardClass({ author_id: 'fable' }, 'tony'), 'message-card', 'a server that does not say the kind colors nothing');
});

// The colors as aim.css sets them, read the way a browser would for each theme.
const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const dark = css.slice(css.indexOf('@media(prefers-color-scheme:dark){.agent-'));
const tokens = (text, selector) => {
  const at = text.indexOf(selector + '{');
  assert.ok(at >= 0, 'aim.css sets ' + selector);
  return Object.fromEntries([...text.slice(at, text.indexOf('}', at)).matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
};
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every agent color keeps the card\'s words at 4.5:1 or better, in light and in dark', () => {
  const themes = {
    light: { ...tokens(css, ':root'), ...tokens(css, '.message-card.agent-card') },
    dark: { ...tokens(css, '@media(prefers-color-scheme:dark){:root'), ...tokens(dark, '.message-card.agent-card') },
  };
  assert.equal(themes.light.muted, '#56616a', 'light cards darken the quiet text');
  assert.equal(themes.dark.accent, '#79c7ab', 'dark cards lighten the excerpt cue');
  const seen = { light: new Set(), dark: new Set() };
  for (const name of AGENT_PALETTE) for (const [theme, text] of [['light', css], ['dark', dark]]) {
    const color = tokens(text, '.agent-' + name), page = themes[theme];
    for (const surface of ['agent-card', 'agent-hover']) for (const words of ['ink', 'muted', 'accent'])
      assert.ok(contrast(page[words], color[surface]) >= 4.5, `${theme} ${name}: ${words} on ${surface} ${contrast(page[words], color[surface]).toFixed(2)}`);
    assert.ok(contrast(page.ink, color['agent-tag']) >= 4.5, `${theme} ${name}: the name on its tag`);
    assert.ok(contrast(color['agent-tag'], color['agent-card']) >= 1.15, `${theme} ${name}: the name's tint shows on its card`);
    assert.notEqual(color['agent-card'], page.panel, `${theme} ${name}: the card is tinted`);
    seen[theme].add(color['agent-card']);
  }
  assert.equal(seen.light.size, AGENT_PALETTE.length, 'every agent color is its own in light');
  assert.equal(seen.dark.size, AGENT_PALETTE.length, 'and in dark');
});

test('an agent\'s card is colored across its whole face, never by an edge or bar', () => {
  const rules = [...css.matchAll(/[^{}]*agent[^{}]*\{[^{}]*\}/g)].map(m => m[0]);
  assert.ok(rules.length > AGENT_PALETTE.length * 2);
  for (const rule of rules) assert.doesNotMatch(rule, /border-left|border-inline-start|inset|::before|::after|border-color|border-width|outline/, rule);
});
