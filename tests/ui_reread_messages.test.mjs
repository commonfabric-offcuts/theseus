// No page has a header bar or a Refresh button, and nothing the page says
// asks the person to Refresh (apart from item 738's exact cover rewrite words): each message that did now reads again on its
// own and says what it found (topic state, people and openings have their own
// checks beside their modules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../web/', import.meta.url);
const sources = readdirSync(web).filter(name => name.endsWith('.mjs') || name.endsWith('.html')).map(name => [name, readFileSync(new URL(name, web), 'utf8')]);
const source = name => sources.find(([file]) => file === name)[1];
// Every quoted string on a line of a module: '…', "…" and `…`, escapes kept
// inside; a line comment's apostrophe pairs with nothing on its line.
const quoted = text => text.split('\n').flatMap(line => [...line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)].map(match => match[2]));

test('only the approved cover rewrite strings may say refresh; other pages reread themselves', () => {
  const said = sources.flatMap(([name, text]) => quoted(text).filter(words => /\brefresh/i.test(words)).map(words => `${name}: ${words}`));
  // Item 738 explicitly adds a cover rewrite act. No module-wide exemption:
  // every permitted instruction, import, selector and storage identifier is exact.
  assert.deepEqual(said, [
    "app.mjs: ./cover-refresh.mjs",
    "cover-refresh.mjs: aim-next-cover-refresh:${JSON.stringify([binding.instance_id, binding.actor, root])}",
    "cover-refresh.mjs: The saved refresh request could not be read safely.",
    "cover-refresh.mjs: The cover request is not confirmed. Press refresh to retry the same request.",
    "cover-refresh.mjs: cover-refresh",
    "cover-refresh.mjs: [data-cover-refresh]",
    "cover-refresh.mjs: Awaiting ${context.nameOf(refresh.recipient)}’s new cover. Open the request",
    "cover-refresh.mjs: Ask the writer to refresh this cover",
    "cover-refresh.mjs: cover-refresh-glyph",
    "cover-refresh.mjs: refresh",
    "cover-refresh.mjs: This saved refresh belongs to an earlier instance binding. It is kept for reconciliation.",
    "cover-refresh.mjs: ${why.why ?? NOT_TAKEN[why.kind] ?? 'The connection was interrupted'}. The request is not confirmed; press refresh to retry it.",
    "cover-refresh.mjs: The cover request could not be confirmed. Press refresh to retry the same request.",
    "cover-refresh.mjs: The cover refresh was refused; the cover is kept.",
    "cover-refresh.mjs: ${receipt.error?.message ?? 'The request is not confirmed'}. Press refresh to retry it.",
    "cover-refresh.mjs: cover-refresh-status",
    "dossier-cover.mjs: ./cover-refresh.mjs",
    "freshness.mjs: Refreshing this topic after a history change.",
    "message-menu.mjs: a, .fold-line, .cover-refresh-glyph"
  ]);
  assert.doesNotMatch(source('index.html').replace(/<[^>]*>/g, ' '), /\brefresh/i, 'no Refresh in the page\'s own text');
  // The words that took Refresh's place are there.
  for (const [name, words] of [['app.mjs', 'Automatic updates need the updated server. Reload this page to see newer messages.'],
    ['freshness.mjs', 'Automatic updates need the updated server. Reload this page to see newer messages.'],
    ['people.mjs', 'The change was not confirmed. Here now: '], ['people.mjs', 'The change was not confirmed, and reading who is here again failed too.'],
    ['topic-state.mjs', 'The change was not confirmed. It stands as: '], ['topic-state.mjs', 'The change was not confirmed, and reading where the topic stands again failed too.'],
    ['opening.mjs', ' It now reads: '], ['creation.mjs', 'This outcome form is being started in another tab. It opens here when that tab closes.'],
    ['creation-view.mjs', 'Open in another tab — read-only until that tab closes'], ['creation-view.mjs', 'Try saving again'], ['app.mjs', 'Reload this page']]) {
    assert.ok(source(name).includes(words), `${name} says: ${words}`);
  }
});

test('the page has no header bar and no Refresh button; the logo block tops the rail, and the rail\'s foot ends it', () => {
  const html = source('index.html');
  assert.doesNotMatch(html, /<header class="app-header"/);
  assert.doesNotMatch(html, /id="refresh"/);
  const rail = html.match(/<nav\b[^>]*\bclass="rail"[^>]*>\s*([\s\S]*?)<\/nav>/)[1];
  assert.match(rail, /^<div class="brand">\s*<a class="wordmark" href="\/" aria-label="Theseus Outcomes">Theseus<span class="presence-dot" aria-hidden="true"><\/span><\/a>\s*<button id="notify"[^>]*>Turn on notifications<\/button>\s*<\/div>/,
    'the wordmark with its presence dot and Turn on notifications, first in the rail');
  // Item 628: who you are on which instance and the Health link (the guide's ? goes between them, interaction-guide.mjs) end the rail, after its last section.
  assert.match(rail, /<section id="skills-navigation"[\s\S]*?<\/section>\s*<div class="rail-foot">\s*<span id="instance-label">[^<]*<\/span>\s*<a id="health-link" class="health-link" href="\?health">Health · checking<\/a>\s*<\/div>\s*$/,
    'the workspace name, then the Health link, last in the rail, after Skills and tools');
  assert.equal(html.match(/id="instance-label"|id="health-link"/g).length, 2, 'each once');
  const after = rail.slice(rail.indexOf('</div>') + 6);
  assert.match(after, /^\s*<div id="page-notices" class="page-notices">\s*<div id="app-status"[^>]*><\/div>\s*<div id="wakes-status"[^>]*><\/div>\s*<div id="updates-status"[^]*?<\/div>\s*<div id="topic-navigation-status"[^>]*><\/div>\s*<\/div>\s*<a id="outcomes-home"/,
    'the notices directly under it, one group (item 547), then "← Outcomes"');
  assert.equal(html.match(/class="brand"/g).length, 1, 'one logo block');
  const lookups = sources.filter(([, text]) => /\$\(\s*['"]refresh['"]\s*\)|getElementById\(\s*['"]refresh['"]\s*\)/.test(text)).map(([name]) => name);
  assert.deepEqual(lookups, [], 'no module looks for a Refresh button');
  const css = readFileSync(new URL('aim.css', web), 'utf8');
  assert.doesNotMatch(css, /\.app-header/, 'no header rules');
  assert.match(css, /\.workspace-layout\{[^}]*min-height:100dvh/, 'the layout fills the window, with no header to subtract');
});
