import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { coverSheet, coverPills, waitWords } from '../web/dossier-cover.mjs';
import { configureCoverRefresh } from '../web/cover-refresh.mjs';
import { configureCoverAnswers } from '../web/cover-answers.mjs';

function fixture(t) {
  const doc = miniDocument(), create = doc.createElement, storage = new Map();
  doc.createElement = tag => {
    const node = create(tag); node.style = {};
    node.contains = other => { for (let at = other; at; at = at.parent) if (at === node) return true; return false; };
    return node;
  };
  doc.createTextNode = text => Object.assign(doc.createElement('text'), { nodeType: 3, data: text, textContent: text });
  const root = doc.createElement('div'); root.root = true;
  doc.querySelectorAll = selector => root.querySelectorAll(selector);
  doc.defaultView = { addEventListener() {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const sent = [], instance = 'cover853-' + crypto.randomUUID();
  configureCoverRefresh(() => ({ bootstrap: { instance_id: instance, actor: 'owner', authority: { authority_id: 'a', authority_epoch: 1 } },
    api: { command: async command => { sent.push(command); throw Error('synthetic interrupted transport'); } }, changed() {} }));
  t.after(() => configureCoverRefresh(null));
  const context = { viewer: 'owner', nameOf: id => id, topicId: 'topic', rootId: 'root' };
  const cover = { stands: null, payload: null, waiting: [], owner: 'owner', root_id: 'root', revision: 4, refresh_revision: 0, refresh: null };
  return { doc, root, context, cover, sent, storage };
}

test('sheets put the existing refresh beside the revision in the footer without a separate row', t => {
  const f = fixture(t);
  for (const extra of [
    { waiting: [{ text: 'Pick a date', options: [], default: null }] },
    { stands: 'Ready' },
    { payload: { text: 'The result', kind: 'answer' } },
    { stands: 'Ready', waiting: [{ text: 'Pick a date', default: 'Friday' }] },
  ]) {
    const sheet = coverSheet(f.doc, { ...f.cover, by: 'writer', at_ms: 1_700_000_000_000, ...extra }, f.context); f.root.append(sheet);
    const refresh = sheet.querySelector('.cover-refresh'); assert.ok(refresh);
    const footer = sheet.querySelector('.cover-footer');
    assert.equal(refresh.parent, footer.querySelector('.cover-footer-meta'));
    assert.equal(refresh.parent.children[0], footer.querySelector('.cover-revision-line'));
    assert.equal(refresh.parent.children[1], refresh);
    const lines = sheet.querySelectorAll('.cover-line');
    assert.equal(sheet.querySelectorAll('.cover-heading').length, extra.stands ? 1 : 0);
    assert.equal(sheet.children.length, lines.length + 1);
    assert.equal(sheet.children.at(-1), footer);
    assert.equal(refresh.querySelector('.cover-refresh-glyph').tag, 'button');
    assert.equal(refresh.querySelector('.cover-refresh-status').parent, refresh);
  }
});

test('853 waits render Markdown while preserving source links, explicit answers and Core words', t => {
  const f = fixture(t), text = '**Choose** _Friday_ or `Saturday` — [details](https://example.test/date)';
  const wait = { text, options: [], default: null, reason: 'No choices or default were supplied; waiting for your response.', message_id: 'source', actor_id: 'owner' };
  const value = { ...f.cover, waiting: [wait] }, before = JSON.stringify(value);
  const sheet = coverSheet(f.doc, value, f.context), words = sheet.querySelector('.cover-words');
  assert.equal(words.text, 'Choose Friday or Saturday — details');
  assert.equal(words.querySelectorAll('.md-block').length, 0, 'wait words stay inline beside their label');
  assert.equal(words.querySelector('strong').text, 'Choose');
  assert.equal(words.querySelector('code').text, 'Saturday');
  assert.equal(words.querySelector('a').href, 'https://example.test/date');
  assert.match(sheet.querySelector('.topic-state').href, /message=source/);
  assert.equal(sheet.querySelector('.cover-note').text, 'Waiting for your answer.');
  assert.equal(waitWords({ text: 'Legacy wait', default: null }), 'Waiting for an answer.');
  assert.equal(waitWords({ options: ['Friday', 'Saturday'], default: 'Friday', reason: 'Already booked' }), 'Options: Friday | Saturday · Default: Friday. · Already booked');
  assert.match(coverPills(f.doc, value, f.context).querySelector('.pill-waits').title, /Waiting for your answer\./);
  assert.equal(JSON.stringify(value), before);
});

test('853 moved refresh keeps an interrupted request and retries its exact envelope', async t => {
  const f = fixture(t), sheet = coverSheet(f.doc, { ...f.cover, stands: 'Ready' }, f.context); f.root.append(sheet);
  await sheet.querySelector('.cover-refresh-glyph').onclick({ stopPropagation() {} });
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].kind, 'stack.cover_refresh');
  assert.deepEqual(f.sent[0].target, { message_id: 'root' });
  assert.equal(f.sent[0].expected.cover_revision, 4);
  assert.equal(f.storage.size, 1);
  const refresh = sheet.querySelector('.cover-refresh');
  assert.equal(refresh.parent, sheet.querySelector('.cover-footer-meta'));
  assert.match(refresh.querySelector('.cover-refresh-status').text, /not confirmed/);
  await sheet.querySelector('.cover-refresh-glyph').onclick({ stopPropagation() {} });
  assert.deepEqual(f.sent[1], f.sent[0]);
});

test('853 CSS declares one sheet grid, a keyboard-reachable hover control and a touch-visible default', () => {
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const reader = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.ok(/\.reply-stack>\.dossier-cover\{display:grid/.test(css), 'feed sheet uses the grid');
  assert.ok(/#reader-cover>\.dossier-cover\{display:grid/.test(reader), 'Reader sheet uses the same grid');
  assert.ok(/\.dossier-cover\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/.test(css), 'content and corner share columns');
  assert.match(css, /\.cover-footer-meta\{[^}]*display:flex[^}]*align-items:center/, 'revision and refresh share a line');
  assert.ok(/@media\(hover:hover\) and \(pointer:fine\)/.test(css), 'only a fine hover pointer hides the idle control');
  assert.match(css, /\.dossier-cover:is\(:hover,:focus-within\) \.cover-footer-meta>\.cover-refresh\{opacity:1;pointer-events:auto\}/, 'hover and keyboard focus reveal the control');
  assert.doesNotMatch(css, /\.cover-footer-meta>\.cover-refresh\{[^}]*(?:visibility:hidden|display:none)/, 'the keyboard stop remains');
  const sheet = css.match(/(?:^|\n)\.dossier-cover\{([^}]+)\}/)?.[1];
  assert.ok(sheet, '913 uses the shared sheet rule for feed and Reader');
  assert.match(sheet, /max-height:100vh/, 'viewport fallback keeps long cards bounded');
  assert.match(sheet, /max-height:100dvh/, 'the current mobile viewport bounds the card');
  assert.match(sheet, /overflow-y:auto/, 'long content scrolls inside its card');
  assert.doesNotMatch(reader.match(/#reader-cover>\.dossier-cover\{([^}]+)\}/)?.[1] ?? '', /max-height:none|overflow-y:visible/);
});

test('853 the no-options/no-default note replaces all redundant explanations with the named default', () => {
  for (const wait of [{ default: null }, { options: [], default: null }, { options: [], default: null, reason: 'No choices or default were supplied; waiting for your response.' }])
    assert.equal(waitWords(wait), 'Waiting for an answer.');
  assert.equal(waitWords({ options: ['Go', 'Wait'], default: null, reason: 'A choice is needed' }), 'Options: Go | Wait · No default promised · A choice is needed');
});

test('853 existing answer controls keep their ask identity and answer revision', async t => {
  const f = fixture(t), answers = [];
  configureCoverAnswers(() => ({ reactions: { answer: async (message, answer) => answers.push({ message, answer }) }, changed() {} }));
  t.after(() => configureCoverAnswers(null));
  const wait = { text: 'Proceed?', actor_id: 'owner', ask_id: 'ask853', answer_revision: 7, go_ahead: true, options: ['Go', 'Wait'], default: null };
  const sheet = coverSheet(f.doc, { ...f.cover, waiting: [wait] }, f.context);
  const choices = sheet.querySelectorAll('.cover-answer'); assert.equal(choices.length, 2);
  await choices[0].onclick({ stopPropagation() {} });
  assert.equal(answers[0].message.id, 'ask853'); assert.equal(answers[0].message.reactions.answer_revision, 7); assert.equal(answers[0].answer, 'yes');
  assert.equal(choices.some(choice => choice.disabled), false);
});

function activityRule() {
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const hover = css.match(/@media\(hover:hover\) and \(pointer:fine\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(hover, 'the override belongs to the existing fine-pointer media query');
  const rule = hover.match(/\.cover-footer-meta>\.cover-refresh:has\(([^{}]+)\)\{([^{}]+)\}/);
  return { hover, rule };
}

test('869 pending dots stay shown and pressable without hover through the existing request link', t => {
  const f = fixture(t), sheet = coverSheet(f.doc, { ...f.cover, stands: 'Ready', refresh_revision: 1,
    refresh: { state: 'pending', recipient: 'writer', request_message_id: 'request869', observed_revision: 4 } }, f.context);
  const dots = sheet.querySelector('.cover-refresh-glyph');
  assert.equal(dots.dataset.pending, 'true'); assert.equal(dots.tag, 'a'); assert.match(dots.href, /message=request869/);
  assert.equal(sheet.querySelectorAll('.cover-refresh').length, 1);
  const { rule } = activityRule();
  assert.ok(rule, 'pending activity needs a visible override after hover ends');
  assert.match(rule[1], /\.cover-refresh-glyph\[data-pending=true\]/);
  assert.match(rule[2], /opacity:1/); assert.match(rule[2], /pointer-events:auto/);
});

test('869 busy activity and a request error share the persistent corner control', async t => {
  const f = fixture(t), sheet = coverSheet(f.doc, { ...f.cover, stands: 'Ready' }, f.context); f.root.append(sheet);
  const sending = sheet.querySelector('.cover-refresh-glyph').onclick({ stopPropagation() {} });
  assert.equal(sheet.querySelector('.cover-refresh-glyph').dataset.pending, 'true');
  await sending;
  assert.match(sheet.querySelector('.cover-refresh-status').text, /not confirmed/);
  assert.equal(sheet.querySelectorAll('.cover-refresh').length, 1);
  const { rule } = activityRule();
  assert.ok(rule, 'errors need a visible override after hover ends');
  assert.match(rule[1], /\.cover-refresh-status:not\(:empty\)/);
  assert.match(rule[2], /opacity:1/); assert.match(rule[2], /pointer-events:auto/);
});

test('869 an idle refresh still waits for hover or focus on a fine pointer', t => {
  const f = fixture(t), sheet = coverSheet(f.doc, { ...f.cover, stands: 'Ready' }, f.context);
  assert.notEqual(sheet.querySelector('.cover-refresh-glyph').dataset.pending, 'true');
  assert.equal(sheet.querySelector('.cover-refresh-status').text, '');
  const { hover } = activityRule();
  assert.match(hover, /\.cover-footer-meta>\.cover-refresh\{opacity:0;pointer-events:none\}/);
  assert.match(hover, /\.dossier-cover:is\(:hover,:focus-within\) \.cover-footer-meta>\.cover-refresh\{opacity:1;pointer-events:auto\}/);
});
