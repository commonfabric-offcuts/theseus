// No page has a header bar or a Refresh button, and nothing the page says
// asks the person to Refresh: each message that did now reads again on its
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

test('no words in any page module ask the person to Refresh; the one status about refreshing stays', () => {
  const said = sources.flatMap(([name, text]) => quoted(text).filter(words => /\brefresh/i.test(words)).map(words => `${name}: ${words}`));
  assert.deepEqual(said, ['freshness.mjs: Refreshing this topic after a history change.']);
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

test('the page has no header bar and no Refresh button; the logo block tops the rail', () => {
  const html = source('index.html');
  assert.doesNotMatch(html, /<header class="app-header"/);
  assert.doesNotMatch(html, /id="refresh"/);
  const rail = html.match(/<nav\b[^>]*\bclass="rail"[^>]*>\s*([\s\S]*?)<\/nav>/)[1];
  assert.match(rail, /^<div class="brand">\s*<a class="wordmark" href="\/" aria-label="Theseus Outcomes">Theseus<span class="presence-dot" aria-hidden="true"><\/span><\/a>\s*<span id="instance-label">[^<]*<\/span>\s*<a id="health-link" class="health-link" href="\?health">Health · checking<\/a>\s*<button id="notify"[^>]*>Turn on notifications<\/button>\s*<\/div>/,
    'the wordmark with its presence dot, the workspace name, the Health link and Turn on notifications, first in the rail');
  const after = rail.slice(rail.indexOf('</div>') + 6);
  assert.match(after, /^\s*<div id="app-status"[^>]*><\/div>\s*<div id="wakes-status"[^>]*><\/div>\s*<div id="updates-status"/, 'the notices directly under it');
  assert.equal(html.match(/class="brand"/g).length, 1, 'one logo block');
  const lookups = sources.filter(([, text]) => /\$\(\s*['"]refresh['"]\s*\)|getElementById\(\s*['"]refresh['"]\s*\)/.test(text)).map(([name]) => name);
  assert.deepEqual(lookups, [], 'no module looks for a Refresh button');
  const css = readFileSync(new URL('aim.css', web), 'utf8');
  assert.doesNotMatch(css, /\.app-header/, 'no header rules');
  assert.match(css, /\.workspace-layout\{[^}]*min-height:100dvh/, 'the layout fills the window, with no header to subtract');
});
