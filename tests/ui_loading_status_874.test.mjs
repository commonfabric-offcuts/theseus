import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const source = name => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
const app = source('app.mjs');
const code = app.slice(app.indexOf('function paintStarredStatus()'), app.indexOf('// The page\'s reply stacks and what the person does'));
function fixture() {
  const doc = miniDocument(), calls = [], nodes = new Map();
  const node = (tag, words, name) => { const n = doc.createElement(tag); n.textContent = words ?? ''; n.className = name ?? ''; return n; };
  for (const id of ['starred-status', 'starred-status-words', 'starred-retry', 'messages']) nodes.set(id, node('div'));
  nodes.get('starred-status').append(nodes.get('starred-status-words'), nodes.get('starred-retry'));
  const card = node('article'); nodes.get('messages').append(card);
  const views = { starredPending: true, starredError: null, resetStars: () => calls.push('retry-stars') };
  const record = { state: 'loading' };
  const env = { $: id => nodes.get(id), node, views, topicUnavailable: false, authorityReviewPending: () => false,
    freshness: { request: args => calls.push(args) }, stackFeed: { state: { stacks: [{ id: 'fixture-reply', dossier: 'fixture-root', head: { stack_position: { name: { text: 'Fixture' } } } }] } },
    dossierHeads: { records: new Map([['fixture-root', record]]) }, messageEntries: new Map([['fixture-reply', card]]), cardIn: entry => entry,
    topic: { id: 'fixture-topic' }, routeHref: route => JSON.stringify(route), run: act => act(), openSource: ref => calls.push(ref),
    refreshDossierHeads: id => calls.push(['retry-head', id]), stackMessages: () => calls.push('arrange') };
  const make = overrides => new Function(...Object.keys({ ...env, ...overrides }), code + '\nreturn { paintStarredStatus, paintDossierSourceStatus };')(...Object.values({ ...env, ...overrides }));
  return { nodes, card, views, record, calls, make, ...make({}) };
}
test('starred loading stays in its status region but out of flow; error and Retry stay visible', () => {
  const f = fixture(), line = f.nodes.get('starred-status'), words = f.nodes.get('starred-status-words'), retry = f.nodes.get('starred-retry');
  f.paintStarredStatus(); assert.equal(line.hidden, false); assert.ok(line.classList.contains('sr-only'));
  assert.equal(words.textContent, 'Loading starred dossiers…'); assert.equal(retry.hidden, true);
  f.views.starredError = new Error('fixture'); f.paintStarredStatus();
  assert.equal(line.classList.contains('sr-only'), false); assert.match(words.textContent, /Could not finish/); assert.equal(retry.hidden, false);
  retry.onclick(); assert.deepEqual(f.calls, ['retry-stars', { retry: true }]);
  f.views.starredError = null; f.paintStarredStatus(); assert.ok(line.classList.contains('sr-only'));
  f.views.starredPending = false; f.paintStarredStatus(); assert.equal(line.hidden, true);
  f.views.starredPending = true;
  for (const overrides of [{ topicUnavailable: true }, { authorityReviewPending: () => true }]) {
    f.make(overrides).paintStarredStatus(); assert.equal(line.hidden, true);
  }
  assert.match(source('index.html'), /id="starred-status"[^>]*role="status"/);
});
test('dossier loading is a silent status; error/refusal keep the canonical link and error Retry', () => {
  const f = fixture(); f.paintDossierSourceStatus();
  let line = f.card.children[0]; assert.ok(line.classList.contains('sr-only')); assert.equal(line.getAttribute('role'), 'status');
  assert.equal(line.text, 'Loading first message… '); assert.equal(line.querySelector('a'), null);
  for (const state of ['error', 'refused', 'missing']) {
    f.record.state = state; f.paintDossierSourceStatus(); assert.equal(f.card.children.length, 1);
    line = f.card.children[0]; assert.equal(line.classList.contains('sr-only'), false);
    assert.match(line.text, state === 'error' ? /Could not load/ : /unavailable/);
    const link = line.querySelector('a'); assert.deepEqual(JSON.parse(link.href), { kind: 'topic', id: 'fixture-topic', message: 'fixture-root' });
    link.onclick({ preventDefault() {}, stopPropagation() {} }); assert.deepEqual(f.calls.at(-1), { kind: 'message', id: 'fixture-root' });
    assert.equal(Boolean(line.querySelector('button')), state === 'error');
    if (state === 'error') { line.querySelector('button').onclick({ stopPropagation() {} }); assert.deepEqual(f.calls.slice(-2), [['retry-head', 'fixture-root'], 'arrange']); }
  }
  f.record.state = 'loading'; f.paintDossierSourceStatus(); assert.ok(f.card.children[0].classList.contains('sr-only'));
  f.record.state = 'available'; f.paintDossierSourceStatus(); assert.equal(f.card.children.length, 0);
});
test('loading is out of flow and cannot activate the folded-card height expansion', () => {
  const css = source('aim.css'), stacks = source('stack-look.css');
  assert.match(css, /\.sr-only\{[^}]*position:absolute;[^}]*overflow:hidden;[^}]*clip:rect\(0,0,0,0\)/);
  assert.match(stacks, /:has\(>\.dossier-source-status:not\(\.sr-only\)\)\{height:auto/);
  assert.doesNotMatch(stacks, /:has\(>\.dossier-source-status\)\{height:auto/);
});
