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
  // Every other agent is olive, which no team agent has. Indigo's light card
  // is 2.3 (CIEDE2000) from aim-ux's violet, so an agent outside the team in
  // indigo looked like aim-ux; olive is the free color farthest from the team
  // (warp, item 91b).
  const used = new Set(['aim-next-bot', 'codex', 'x', 'fixture-notebook-agent', 'weft', 'og', 'networking', 'aim-next-agent',
    ...Array.from({ length: 200 }, (_, n) => 'agent-' + n)].map(agentColor));
  assert.deepEqual([...used], ['olive'], 'every agent outside the team is olive');
  // Indigo stays a color a person can choose for an agent.
  assert.ok(AGENT_PALETTE.includes('indigo'), 'indigo stays a color a person can choose');
  // Two purples, not three: orchid sat 2.4 (CIEDE2000) from violet.
  assert.deepEqual(AGENT_PALETTE, ['green', 'blue', 'indigo', 'violet', 'rose', 'peach', 'cyan', 'olive']);
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

// CIELAB (D65) lightness and chroma, the measure warp used for each tint.
const lab = hex => {
  const lin = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [x, y, z] = [[0.4124564, 0.3575761, 0.1804375, 0.95047], [0.2126729, 0.7151522, 0.0721750, 1], [0.0193339, 0.1191920, 0.9503041, 1.08883]]
    .map(([r, g, b, white]) => (r * lin[0] + g * lin[1] + b * lin[2]) / white);
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const a = 500 * (f(x) - f(y)), b = 200 * (f(y) - f(z));
  return { L: 116 * f(y) - 16, a, b, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
};

// CIEDE2000 (Sharma, Wu and Dalal 2005), the distance warp measured every tint by.
const deltaE = (one, two) => {
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const [p, q] = [lab(one), lab(two)];
  const mean = (Math.hypot(p.a, p.b) + Math.hypot(q.a, q.b)) / 2;
  const g = 0.5 * (1 - Math.sqrt(mean ** 7 / (mean ** 7 + 25 ** 7)));
  const prime = ({ L, a, b }) => { const A = (1 + g) * a, C = Math.hypot(A, b); return { L, C, h: C ? (deg(Math.atan2(b, A)) + 360) % 360 : 0 }; };
  const [s, t] = [prime(p), prime(q)];
  let dh = t.h - s.h; if (s.C * t.C === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(s.C * t.C) * Math.sin(rad(dh / 2)), L = (s.L + t.L) / 2, C = (s.C + t.C) / 2;
  const h = s.C * t.C === 0 ? s.h + t.h : Math.abs(s.h - t.h) <= 180 ? (s.h + t.h) / 2 : (s.h + t.h + (s.h + t.h < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(rad(h - 30)) + 0.24 * Math.cos(rad(2 * h)) + 0.32 * Math.cos(rad(3 * h + 6)) - 0.2 * Math.cos(rad(4 * h - 63));
  const SL = 1 + 0.015 * (L - 50) ** 2 / Math.sqrt(20 + (L - 50) ** 2), SC = 1 + 0.045 * C, SH = 1 + 0.015 * C * T;
  const RT = -Math.sin(rad(60 * Math.exp(-(((h - 275) / 25) ** 2)))) * 2 * Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7));
  const [dL, dC, dHs] = [(t.L - s.L) / SL, (t.C - s.C) / SC, dH / SH];
  return Math.sqrt(dL ** 2 + dC ** 2 + dHs ** 2 + RT * dC * dHs);
};

test('the CIEDE2000 instrument agrees with the published test pairs', () => {
  // Black on white is 100 and pure red to pure green 86.6, as published
  // calculators give; the same color is 0; and warp's 2.3 for the light
  // indigo and violet cards of release 19.
  assert.equal(deltaE('#000000', '#ffffff').toFixed(1), '100.0');
  assert.equal(deltaE('#ff0000', '#00ff00').toFixed(1), '86.6');
  assert.equal(deltaE('#e8f1ec', '#e8f1ec'), 0);
  assert.ok(Math.abs(deltaE('#ececf9', '#f2edf8') - 2.3) < 0.05, 'base indigo and violet light cards, as warp measured them');
});

// Light cards were too pale for their hue to show (CIELAB chroma 3.8 to 6.7),
// so most light pairs sat under 5 apart while every dark pair was at least
// 7.9 (warp, item 91b). Each light card but Fable's green is at chroma about
// 8 at the lightness and hue it had; its hover is one step deeper, as before.
test('the team\'s light cards are far enough apart to tell at a glance, and an agent outside the team is never taken for one', () => {
  const team = { fable: 'green', 'aim-lead': 'blue', 'aim-ux': 'violet', 'aim-core': 'peach', 'aim-spec': 'rose', warp: 'cyan' };
  const card = name => tokens(css, '.agent-' + name)['agent-card'];
  for (const name of AGENT_PALETTE.filter(name => name !== 'green')) {
    const color = tokens(css, '.agent-' + name);
    assert.ok(lab(color['agent-card']).C >= 7.2, `light ${name}: card chroma ${lab(color['agent-card']).C.toFixed(1)}`);
    assert.ok(Math.abs(lab(color['agent-card']).H - lab(color['agent-tag']).H) <= 8, `light ${name}: card and name tag are one hue`);
    assert.ok(lab(color['agent-hover']).L < lab(color['agent-card']).L && deltaE(color['agent-card'], color['agent-hover']) >= 2,
      `light ${name}: hover one step deeper (${deltaE(color['agent-card'], color['agent-hover']).toFixed(2)})`);
    assert.ok(contrast('#56616a', color['agent-card']) >= 5.4, `light ${name}: quiet words ${contrast('#56616a', color['agent-card']).toFixed(2)} on the card`);
  }
  const names = Object.keys(team);
  for (const [i, one] of names.entries()) for (const two of names.slice(i + 1))
    assert.ok(deltaE(card(team[one]), card(team[two])) >= 5, `light ${one} and ${two}: ${deltaE(card(team[one]), card(team[two])).toFixed(2)}`);
  for (const one of names) assert.ok(deltaE(card(agentColor('someone-else')), card(team[one])) >= 4.5,
    `light: an agent outside the team and ${one}: ${deltaE(card(agentColor('someone-else')), card(team[one])).toFixed(2)}`);
});

// Peach on a dark card read brown and heavy at chroma 11.9 (#3c2b20); its
// card and hover are a quieter peach, and its name's tag keeps the hue.
test('the dark peach card is a quiet peach, not brown', () => {
  const peach = tokens(dark, '.agent-peach');
  for (const surface of ['agent-card', 'agent-hover'])
    assert.ok(lab(peach[surface]).C <= 8, `dark peach ${surface} chroma ${lab(peach[surface]).C.toFixed(1)}`);
  assert.ok(lab(peach['agent-tag']).C <= 12, `dark peach tag chroma ${lab(peach['agent-tag']).C.toFixed(1)}`);
  assert.ok(lab(peach['agent-card']).C >= 5, 'still a tint, not grey');
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
});

test('an agent\'s card is colored across its whole face, never by an edge or bar', () => {
  const rules = [...css.matchAll(/[^{}]*agent[^{}]*\{[^{}]*\}/g)].map(m => m[0]);
  assert.ok(rules.length > AGENT_PALETTE.length * 2);
  for (const rule of rules) assert.doesNotMatch(rule, /border-left|border-inline-start|inset|::before|::after|border-color|border-width|outline/, rule);
});

// The picker (warp, item 91b): every swatch and Default wore the same heavy
// grey frame, so the current choice showed only as a thicker one, and before
// any choice the ringed Default read as a confirm button. Each choice that is
// not current has a light frame (--line); the current one keeps the ink frame
// and ring, at 3:1 or better against the picker (WCAG 1.4.11), and a check
// before its name that is for the eye only (aria-pressed says it).
test('the picker frames each choice lightly, and the current one alone in ink with a check before its name', () => {
  const rule = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'aim.css sets ' + selector); return css.slice(at, css.indexOf('}', at)); };
  const themes = { light: tokens(css, ':root'), dark: tokens(css, '@media(prefers-color-scheme:dark){:root') };
  assert.match(rule('.color-picker'), /background:var\(--panel\)/);
  for (const selector of ['.color-picker .swatch', '.color-picker .swatch-default'])
    assert.match(rule(selector), /border:1px solid var\(--line\)/, selector + ' has a light frame');
  assert.doesNotMatch(css, /\.color-picker[^{}]*\{[^}]*border:2px solid/, 'no choice wears the heavy frame');
  const chosen = rule('.color-picker .swatch[aria-pressed=true],.color-picker .swatch-default[aria-pressed=true]');
  assert.match(chosen, /border-color:var\(--ink\)/, 'the current choice is framed in ink');
  assert.match(chosen, /box-shadow:0 0 0 2px var\(--ink\)/, 'and ringed outside its frame');
  for (const [theme, page] of Object.entries(themes))
    assert.ok(contrast(page.ink, page.panel) >= 3, `${theme}: the current choice's ink shows on the picker`);
  const check = rule('.color-picker .swatch[aria-pressed=true] .swatch-name::before,.color-picker .swatch-default[aria-pressed=true]::before');
  assert.match(check, /content:"\\2713\\00a0" \/ ""/, 'a check before the name, silent to a screen reader');
  // A browser without alternative text for generated content (Safari before
  // 17.4, Firefox before 128) drops that whole declaration: a plain one just
  // before it keeps the check there, and a browser with it takes the silent one.
  const plain = check.indexOf('content:"\\2713\\00a0";'), silent = check.indexOf('content:"\\2713\\00a0" / ""');
  assert.ok(plain >= 0 && plain < silent, 'a plain check declared just before the silent one: ' + check);
  assert.doesNotMatch(css, /\.color-picker[^{}]*:not\(\[aria-pressed=true\]\)[^{}]*::before/, 'nothing else wears a check');
  for (const selector of ['.color-picker .swatch:hover', '.color-picker .swatch-default:hover']) {
    assert.match(rule(selector), /border-color:var\(--muted\)/, selector + ': the pointer deepens the frame, short of the ink that marks the current choice');
    assert.ok(css.indexOf(selector + '{') < css.indexOf(chosen), selector + ': comes before the current choice\'s rule, so the pointer never takes its ink away');
  }
});

// Default is one more choice, as wide as its words: a bar across the picker
// read as a confirm button before any choice (warp, item 91b). It sits in the
// picker's own flow, after the swatches, so only a width rule could stretch it.
test('Default is only as wide as its words, never a bar across the picker', () => {
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, selector]) => /\.color-picker\s+(button|\.swatch-default|>\s*\*)|\.color-picker\s*>\s*button/.test(selector) && !/:hover|\[aria-pressed|::before/.test(selector));
  assert.ok(rules.some(([selector]) => selector.includes('.swatch-default')), 'aim.css styles Default');
  for (const [, selector, body] of rules) {
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      if (/^(width|inline-size)$/.test(property))
        assert.match(value.trim(), /^(auto|max-content|fit-content|min-content)$/, `${selector.trim()} ${property}:${value}: as wide as its words`);
      assert.doesNotMatch(property, /^(min-width|min-inline-size|flex|flex-grow|grid-column|justify-self|align-self)$/, `${selector.trim()} ${property}:${value} could stretch Default`);
    }
  }
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
  assert.equal(paneClass(message('fixture-notebook-agent', 'agent'), 'tony'), 'reading-pane agent-pane agent-olive');
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
