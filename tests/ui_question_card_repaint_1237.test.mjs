import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { paintAuthor, carriesOf } from '../web/marks.mjs';
import { revisionOf, wasEdited } from '../web/message-edit-writing.mjs';
import { QuestionStates, configureQuestionStates, questionOf, questionPill } from '../web/question-state.mjs';
import { paintWithdrawal } from '../web/question-withdrawal.mjs';
import { paintRemoval } from '../web/message-removal.mjs';
import { clock } from '../web/times.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const start = app.indexOf('function paintCardAuthor(');
const end = app.indexOf('// Who the composers may whisper to', start);
assert.ok(start >= 0 && end > start, 'real card-author owner boundaries exist');
const code = app.slice(start, end);
const terminal = state => ({ state, by: 'asker', at_ms: 1795579200000,
  superseded_by: state === 'superseded' ? 'successor' : null, waiting_on: [], may_resolve: false, archived: false });

function fixture(t, state = 'superseded') {
  const doc = miniDocument(), priorDocument = globalThis.document, priorNow = clock.now;
  globalThis.document = doc; clock.now = () => 1795579200000;
  configureQuestionStates(new QuestionStates());
  t.after(() => { globalThis.document = priorDocument; clock.now = priorNow; configureQuestionStates(null); });
  const card = doc.createElement('article'), author = doc.createElement('span'), reactions = doc.createElement('span');
  author.className = 'message-author'; reactions.className = 'message-reactions'; reactions.textContent = 'Thumbs: person';
  card.append(author, reactions);
  Object.defineProperty(author, 'parentElement', { get: () => author.parent });
  const item = { id: 'ask', topic_id: 'topic', author_id: 'asker', sent_ms: 1795575600000, revision: 2,
    edited_ms: 1795575700000, attachments: [{ content_type: 'image/png' }], yours: { note: true, reply: true },
    question: terminal(state) };
  // Only unrelated page ports are stood in for. The cache and question
  // projection/pill construction are their actual imported owners.
  const ports = { document: doc, messageEntries: new Map([[item.id, card]]), cardScroll: null, revisionOf, messageChanges: null, toggleMessageChanges() {},
    paintAuthor, displayActor: id => id, marks: null, wasEdited, carriesOf, paintWithdrawal, paintRemoval,
    questionOf, questionPill, bootstrap: { actor: 'viewer' }, here: null,
    stackFeed: { paintStar(line) {
      if (!line.querySelector('.star-witness')) { const star = doc.createElement('span'); star.className = 'star-witness'; star.textContent = 'Star'; line.append(star); }
    } }, messageUpdateActivity: () => null, updateContext: () => ({}), visitNew: null, paintVisitNew() {} };
  const paint = new Function(...Object.keys(ports), code + '\nreturn paintCardAuthor;')(...Object.values(ports));
  return { doc, card, author, reactions, item, paint: () => paint(author, item) };
}

for (const state of ['superseded', 'resolved']) test(`1239 actual cached author composition: 32 ${state} paints omit terminal labels and keep content`, t => {
  const f = fixture(t, state); f.paint();
  const named = f.author.querySelector('.author-name'), time = f.author.querySelector('.message-time');
  const edit = f.author.querySelector('.message-edited'), carries = f.author.querySelector('.card-carries');
  const size = f.author.children.length;
  assert.ok(named && time && edit && carries, 'real base painter reached author/time/edit/carries');
  for (let i = 0; i < 32; i++) f.paint();
  const pills = f.author.querySelectorAll('.question-state');
  assert.equal(pills.length, 0, 'terminal facts add no card label');
  assert.equal(f.author.children.length, size, 'separator text does not accumulate either');
  assert.equal(f.author.querySelector('.author-name'), named, 'base-author cache was actually used');
  assert.equal(f.author.querySelector('.message-time'), time);
  assert.equal(f.author.querySelector('.message-edited'), edit);
  assert.equal(f.author.querySelector('.card-carries'), carries);
  assert.equal(f.author.querySelectorAll('.star-witness').length, 1);
  assert.equal(f.card.querySelector('.message-reactions'), f.reactions);
  assert.equal(f.reactions.text, 'Thumbs: person');
  assert.equal(f.author.querySelector('.message-edited'), edit);
  assert.equal(f.author.querySelector('.card-carries'), carries);
  assert.equal(f.author.querySelectorAll('.carry').length, 3);
  assert.equal(f.author.querySelectorAll('.star-witness').length, 1);
  assert.equal(f.card.querySelector('.message-reactions'), f.reactions);
  assert.equal(f.reactions.text, 'Thumbs: person');
  assert.doesNotMatch(f.author.text, /Resolved|Superseded/);
});

test('1239 terminal repaint keeps unrelated focused author content', t => {
  const f = fixture(t); f.paint();
  const mark = f.author.querySelector('.star-witness'); mark.focus();
  for (let i = 0; i < 32; i++) f.paint();
  assert.equal(f.author.querySelectorAll('.question-state').length, 0);
  assert.equal(f.author.querySelector('.star-witness'), mark);
  assert.equal(f.doc.activeElement, mark, 'modeled focus identity; native focus stays separate');
});

test('1239 archived and visible terminal facts both omit labels without growing the line', t => {
  const f = fixture(t); f.paint(); const size = f.author.children.length;
  for (let cycle = 0; cycle < 16; cycle++) {
    f.item.question = { ...f.item.question, archived: true };
    for (let i = 0; i < 3; i++) f.paint();
    assert.equal(f.author.querySelectorAll('.question-state').length, 0, 'archived presentation hides cached terminal facts');
    f.item.question = { ...f.item.question, archived: false }; f.paint();
    assert.equal(f.author.querySelectorAll('.question-state').length, 0);
    assert.equal(f.author.children.length, size, 'archive round trips leave no orphan separators');
  }
});

test('1239 terminal-label removal keeps Retracted and never restores stale question labels', t => {
  const f = fixture(t); f.paint();
  f.item.removal = { kind: 'retracted', by: 'asker', at_ms: 1795579201000 };
  for (let i = 0; i < 32; i++) f.paint();
  assert.equal(f.author.querySelectorAll('.question-state').length, 0);
  assert.equal(f.author.querySelectorAll('.message-retracted').length, 1);
  assert.equal(f.card.classList.contains('retracted-message'), true);
  delete f.item.removal; f.paint();
  assert.equal(f.author.querySelectorAll('.question-state').length, 0);
});

test('1239 base-author rebuild and changed terminal facts keep content without labels', t => {
  const f = fixture(t, 'resolved'); f.paint();
  f.item.author_id = 'renamed-author'; f.item.attachments.push({ content_type: 'image/webp' });
  f.paint();
  assert.equal(f.author.querySelector('.author-name').text, 'renamed-author');
  assert.equal(f.author.querySelector('.carry-image').getAttribute('aria-label'), 'Has 2 images');
  assert.equal(f.author.querySelectorAll('.question-state').length, 0);
  // Presentation-only archive state can change after closure; a fresh cache
  // also supplies a different terminal projection when switching sources.
  configureQuestionStates(null); f.item.question = terminal('superseded'); f.paint();
  assert.equal(f.author.querySelectorAll('.question-state').length, 0);
  assert.doesNotMatch(f.author.text, /Resolved|Superseded/);
});
