// Each agent's own color: which color an agent gets, which cards carry it,
// and that every color keeps the card's words readable in both themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_PALETTE, agentColor, cardClass, paneClass } from '../web/author-colors.mjs';

test('the team\'s agents have fixed colors, and any other agent always gets the same one', () => {
  // aim-core is peach and warp cyan: aim-core's cyan card sat 4.1 (CIEDE2000)
  // from Fable's green and 3.2 from aim-lead's blue in light (warp, item 91).
  assert.deepEqual(['aim-lead', 'aim-ux', 'fable', 'aim-core', 'aim-spec', 'warp'].map(agentColor),
    ['blue', 'violet', 'green', 'peach', 'rose', 'cyan']);
  // FNV-1a over the UTF-8 bytes, worked out separately, picks between the
  // colors no team agent has, so no other agent is mistaken for one of them.
  assert.deepEqual(['aim-next-bot', 'codex', 'x', 'fixture-notebook-agent', 'weft', 'og', 'networking', 'aim-next-agent'].map(agentColor),
    ['indigo', 'indigo', 'olive', 'indigo', 'olive', 'olive', 'olive', 'indigo']);
  assert.equal(agentColor('codex'), agentColor('codex'));
  const used = new Set(Array.from({ length: 200 }, (_, n) => agentColor('agent-' + n)));
  assert.deepEqual([...used].sort(), ['indigo', 'olive'], 'other agents spread over both colors the team does not use');
  assert.equal(agentColor('constructor'), agentColor('constructor'));
  assert.ok(AGENT_PALETTE.includes(agentColor('toString')), 'a name on Object.prototype is just another id');
  for (const bad of ['', null, undefined, 3]) assert.throws(() => agentColor(bad), /agent id/);
});

test('an agent\'s card carries its color; the person\'s own and other people\'s cards do not', () => {
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent' }, 'tony'), 'message-card agent-card agent-green');
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
  // #fff is #ffffff.
  const full = hex => hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  return Object.fromEntries([...text.slice(at, text.indexOf('}', at)).matchAll(/--([\w-]+):(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])/g)].map(m => [m[1], full(m[2])]));
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

// Fable's cards keep the green the live app already paints them (Tony,
// #452: "your color as it stands"): the live --soft, #e8f1ec in light and
// #263d35 in dark, which is what a Fable card under the pointer and the
// Reader's page show there.
test('Fable keeps the green it has on the live app, in light and in dark', () => {
  const live = { light: tokens(css, ':root').soft, dark: tokens(css, '@media(prefers-color-scheme:dark){:root').soft };
  assert.deepEqual(live, { light: '#e8f1ec', dark: '#263d35' }, 'the live green is unchanged');
  assert.equal(agentColor('fable'), 'green');
  assert.equal(tokens(css, '.agent-green')['agent-card'], live.light, 'light: a Fable card is the live green');
  assert.equal(tokens(dark, '.agent-green')['agent-card'], live.dark, 'dark: a Fable card is the live green');
  assert.ok(AGENT_PALETTE.includes('orchid'), 'orchid stays a color an agent can be given');
});

test('an agent\'s card is colored across its whole face, never by an edge or bar', () => {
  const rules = [...css.matchAll(/[^{}]*agent[^{}]*\{[^{}]*\}/g)].map(m => m[0]);
  assert.ok(rules.length > AGENT_PALETTE.length * 2);
  for (const rule of rules) assert.doesNotMatch(rule, /border-left|border-inline-start|inset|::before|::after|border-color|border-width|outline/, rule);
});

// The picker's swatches are told apart from the picker by their outline, at
// 3:1 or better (WCAG 1.4.11), and the chosen one by a ring of its own.
test('each swatch in the picker is outlined at 3:1 or better against the picker, in light and in dark, and the chosen one is ringed', () => {
  const rule = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'aim.css sets ' + selector); return css.slice(at, css.indexOf('}', at)); };
  const themes = { light: tokens(css, ':root'), dark: tokens(css, '@media(prefers-color-scheme:dark){:root') };
  assert.match(rule('.color-picker'), /background:var\(--panel\)/);
  for (const selector of ['.color-picker .swatch', '.color-picker .swatch-default']) {
    const outline = rule(selector).match(/border:2px solid var\(--([\w-]+)\)/)?.[1];
    assert.ok(outline, selector + ' has an outline');
    for (const [theme, page] of Object.entries(themes))
      assert.ok(contrast(page[outline], page.panel) >= 3, `${theme} ${selector}: --${outline} on the picker ${contrast(page[outline], page.panel).toFixed(2)}`);
  }
  const chosen = rule('.color-picker .swatch[aria-pressed=true],.color-picker .swatch-default[aria-pressed=true]');
  assert.match(chosen, /box-shadow:0 0 0 2px var\(--ink\)/, 'the chosen swatch wears a ring outside its outline');
});

// Each swatch shows its color as the agent's name tag wears it, the strongest
// the palette paints for that hue, on the picker's own background, with the
// color's name under it in words that keep 4.5:1 (WCAG AA), in light and dark.
test('each swatch shows its name tag\'s color on the picker\'s background, with its name in readable words', () => {
  const rule = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'aim.css sets ' + selector); return css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.color-picker .swatch'), /background:var\(--panel\)/, 'the swatch is the picker\'s own background');
  assert.match(rule('.color-picker .swatch:hover'), /background:var\(--panel\)/, 'and stays it under the pointer');
  assert.match(rule('.color-picker .swatch-tag'), /background:var\(--agent-tag\)/, 'its color is the name tag\'s');
  assert.match(rule('.color-picker .swatch-tag'), /height:1\.6rem/, 'large enough to see');
  const words = rule('.color-picker .swatch-name').match(/color:var\(--([\w-]+)\)/)?.[1];
  assert.ok(words, 'the name has a color');
  for (const page of [tokens(css, ':root'), tokens(css, '@media(prefers-color-scheme:dark){:root')])
    assert.ok(contrast(page[words], page.panel) >= 4.5, `--${words} on the picker ${contrast(page[words], page.panel).toFixed(2)}`);
  for (const name of AGENT_PALETTE) for (const text of [css, dark]) {
    const tag = tokens(text, '.agent-' + name)['agent-tag'];
    assert.ok(tag, name + ' has a name tag color');
  }
});

// A tap on a phone leaves no blue wash over the picker, the agent's card whose
// name opened it, or a participant's name; the focus ring still shows.
test('the picker and the names that open it paint no tap highlight, and keep their focus ring', () => {
  const at = css.indexOf('-webkit-tap-highlight-color:transparent');
  assert.ok(at >= 0, 'aim.css turns the tap highlight off');
  const selectors = css.slice(css.lastIndexOf('}', at) + 1, css.lastIndexOf('{', at)).replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim());
  assert.deepEqual(selectors, ['.color-picker button', '.message-card.agent-card', '.chip .chip-name']);
  assert.match(css, /button:focus-visible[^{]*\{outline:2px solid var\(--focus\)/, 'every button keeps its focus ring');
  assert.doesNotMatch(css, /\.color-picker[^{}]*:focus[^{}]*\{[^}]*outline:\s*(none|0)/, 'the picker never hides it');
});

// The Reader's page: an agent's message is read on its card's color under the
// pointer, the card just pressed, in the color the reader sees that agent in;
// the person's own message, another person's and a Notebook page on a neutral
// page, never the green that is Fable's card. Every word on it keeps 4.5:1.
test('the Reader shows an agent\'s message on its color, and anything else on the neutral page', () => {
  const message = (author, author_kind) => ({ source_ref: { kind: 'message', id: 'm' }, author, author_kind });
  assert.equal(paneClass(message('fixture-notebook-agent', 'agent'), 'tony'), 'reading-pane agent-pane agent-indigo');
  assert.equal(paneClass(message('fable', 'agent'), 'tony', () => 'rose'), 'reading-pane agent-pane agent-rose', 'the reader\'s choice for the agent');
  assert.equal(paneClass(message('tony', 'human'), 'tony'), 'reading-pane', 'your own message');
  assert.equal(paneClass(message('fable', 'agent'), 'fable'), 'reading-pane', 'an agent reading its own message');
  assert.equal(paneClass(message('dan', 'human'), 'tony'), 'reading-pane', 'another person');
  assert.equal(paneClass(message('fable'), 'tony'), 'reading-pane', 'a source that does not say the kind');
  assert.equal(paneClass({ source_ref: { kind: 'memory', id: 'n', revision: 1 }, author: 'fable', author_kind: 'agent' }, 'tony'), 'reading-pane', 'a Notebook page');
  assert.equal(paneClass(null, 'tony'), 'reading-pane');
});

test('every word on the Reader\'s page keeps 4.5:1, on the neutral page and on every agent\'s color, and the page is never Fable\'s green', () => {
  const block = (text, selector) => { const at = text.indexOf(selector + ' {'); assert.ok(at >= 0, 'aim.css sets ' + selector); return text.slice(at, text.indexOf('}', at)); };
  const hex = (text, property) => { const m = text.match(new RegExp(property + ':\\s*(#[0-9a-f]{6})')); assert.ok(m, property + ' in ' + text); return m[1]; };
  const lightAt = css.indexOf('@media (prefers-color-scheme: light) {\n  .source-actions .muted'), darkAt = css.indexOf('@media (prefers-color-scheme: dark) {\n  .reading-pane');
  assert.ok(lightAt >= 0 && darkAt >= 0, 'aim.css sets the Reader\'s page for light and dark');
  assert.equal(block(css, '.reading-pane.agent-pane').includes('background: var(--agent-hover)'), true, 'an agent\'s page is its hover color');
  const themes = {
    light: { page: tokens(css, ':root'), neutral: hex(block(css, '.reading-pane'), 'background'),
      hint: { neutral: hex(block(css.slice(lightAt), '.source-actions .muted'), 'color'), agent: hex(block(css.slice(lightAt), '.reading-pane.agent-pane .source-actions .muted'), 'color') }, colors: css },
    dark: { page: tokens(css, '@media(prefers-color-scheme:dark){:root'), neutral: hex(block(css.slice(darkAt), '.reading-pane'), 'background'), colors: dark },
  };
  themes.dark.hint = { neutral: themes.dark.page.muted, agent: themes.dark.page.muted };
  for (const [theme, { page, neutral, hint, colors }] of Object.entries(themes)) {
    assert.notEqual(neutral, page.soft, `${theme}: the neutral page is not Fable's green`);
    assert.notEqual(neutral, tokens(colors, '.agent-green')['agent-card'], `${theme}: nor Fable's card`);
    const rgb = [1, 3, 5].map(i => parseInt(neutral.slice(i, i + 2), 16));
    assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 10, `${theme}: neutral (${neutral})`);
    for (const [name, words] of [['ink', page.ink], ['hint', hint.neutral]])
      assert.ok(contrast(words, neutral) >= 4.5, `${theme} neutral: ${name} ${contrast(words, neutral).toFixed(2)}`);
    for (const color of AGENT_PALETTE) {
      const surface = tokens(colors, '.agent-' + color)['agent-hover'];
      for (const [name, words] of [['ink', page.ink], ['hint', hint.agent]])
        assert.ok(contrast(words, surface) >= 4.5, `${theme} ${color}: ${name} ${contrast(words, surface).toFixed(2)}`);
    }
  }
});

// No colored edge anywhere on the page (Tony: "please no left edge card
// highlights"): a left or inline-start border is either none or the shared
// line every other side has, and no inset shadow draws a bar.
test('nothing on the page wears a colored left edge or bar', () => {
  const edges = [...css.matchAll(/border-(?:left|inline-start)(?:-color|-width)?\s*:\s*([^;}]+)/g)].map(m => [m[0], m[1].trim()]);
  assert.ok(edges.length > 0, 'the rule finds the left borders aim.css sets');
  for (const [declaration, value] of edges) assert.ok(['0', '1px solid var(--line)'].includes(value), declaration);
  assert.doesNotMatch(css, /box-shadow:\s*inset/, 'no inset shadow draws a bar');
});
