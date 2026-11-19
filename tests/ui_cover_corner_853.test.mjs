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
  doc.defaultView = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const sent = [], instance = 'cover853-' + crypto.randomUUID();
  configureCoverRefresh(() => ({ bootstrap: { instance_id: instance, actor: 'owner', authority: { authority_id: 'a', authority_epoch: 1 } },
    api: { command: async command => { sent.push(command); throw Error('synthetic interrupted transport'); } }, changed() {} }));
  t.after(() => configureCoverRefresh(null));
  const context = { viewer: 'owner', nameOf: id => id, topicId: 'topic', rootId: 'root' };
  const cover = { stands: null, payload: null, waiting: [], owner: 'owner', root_id: 'root', revision: 4, refresh_revision: 0, refresh: null };
  return { doc, root, context, cover, sent, storage };
}

test('853 sheets put the existing refresh beside the final content row, without an empty heading', t => {
  const f = fixture(t);
  for (const extra of [
    { waiting: [{ text: 'Pick a date', options: [], default: null }] },
    { stands: 'Ready' },
    { payload: { text: 'The result', kind: 'answer' } },
    { stands: 'Ready', waiting: [{ text: 'Pick a date', default: 'Friday' }] },
  ]) {
    const sheet = coverSheet(f.doc, { ...f.cover, ...extra }, f.context); f.root.append(sheet);
    const refresh = sheet.querySelector('.cover-refresh'); assert.ok(refresh);
    assert.ok(refresh.parent === sheet, 'refresh belongs to the sheet, not its heading');
    const lines = sheet.querySelectorAll('.cover-line');
    assert.equal(sheet.querySelectorAll('.cover-heading').length, extra.stands ? 1 : 0);
    assert.equal(refresh.style.gridRow, String(lines.length), 'same row as the final actual content');
    assert.equal(sheet.children.length, lines.length + 1);
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
  assert.equal(words.querySelector('strong').text, 'Choose');
  assert.equal(words.querySelector('code').text, 'Saturday');
  assert.equal(words.querySelector('a').href, 'https://example.test/date');
  assert.match(sheet.querySelector('.topic-state').href, /message=source/);
  assert.equal(sheet.querySelector('.cover-note').text, 'Waiting for your answer.');
  assert.equal(waitWords({ text: 'Legacy wait', default: null }), 'Waiting for your answer.');
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
  assert.ok(refresh.parent === sheet); assert.match(refresh.querySelector('.cover-refresh-status').text, /not confirmed/);
  await sheet.querySelector('.cover-refresh-glyph').onclick({ stopPropagation() {} });
  assert.deepEqual(f.sent[1], f.sent[0]);
});

test('853 CSS declares one sheet grid, a keyboard-reachable hover control and a touch-visible default', () => {
  const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
  const reader = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.ok(/\.reply-stack>\.dossier-cover\{display:grid/.test(css), 'feed sheet uses the grid');
  assert.ok(/#reader-cover>\.dossier-cover\{display:grid/.test(reader), 'Reader sheet uses the same grid');
  assert.ok(/\.dossier-cover\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/.test(css), 'content and corner share columns');
  assert.ok(/\.dossier-cover>\.cover-refresh\{[^}]*grid-column:2[^}]*align-self:end/.test(css), 'corner aligns to the final row bottom');
  assert.ok(/@media\(hover:hover\) and \(pointer:fine\)/.test(css), 'only a fine hover pointer hides the idle control');
  assert.ok(/\.dossier-cover:is\(:hover,:focus-within\)>\.cover-refresh\{opacity:1;pointer-events:auto\}/.test(css), 'hover and keyboard focus reveal the control');
  assert.ok(!/\.dossier-cover>\.cover-refresh\{[^}]*(?:visibility:hidden|display:none)/.test(css), 'the keyboard stop remains');
});

test('853 the no-options/no-default note replaces all redundant explanations with the named default', () => {
  for (const wait of [{ default: null }, { options: [], default: null }, { options: [], default: null, reason: 'No choices or default were supplied; waiting for your response.' }])
    assert.equal(waitWords(wait), 'Waiting for your answer.');
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
