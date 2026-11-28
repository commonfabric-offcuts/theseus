import assert from 'node:assert/strict';
import test from 'node:test';
import { activateEditEcho, makeEditEcho } from '../web/edit-echo.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const target = { id: 'm1', seq: 17, topic_id: 't1', revision: 4 };
const currentEcho = { group_revision: 4, revision: 4 };
const historicalEcho = { group_revision: 2, revision: 3 };

function fixture() {
  const doc = miniDocument();
  const row = makeEditEcho(doc, 'echo-fixture', doc.createElement('button'));
  row.root = true;
  const [controls, panel] = row.children;
  panel.ownerDocument = doc;
  Object.defineProperty(panel, 'firstChild', { get: () => panel.children[0] });
  return { row, button: controls.children[1], panel };
}

function source(echo, diff, extra = {}) {
  return { source_ref: { kind: 'message', id: target.id }, topic_id: target.topic_id,
    revision: target.revision, body: 'Saturday.', edit_echo: { ...echo, diff }, ...extra };
}

test('an edit echo fetches one named historical diff when opened and renders its own bounded words', async () => {
  const { row, button, panel } = fixture(), reads = [];
  activateEditEcho(row, target, historicalEcho, false, async ref => {
    reads.push(ref);
    return source(historicalEcho, { cuts: [{ words: 'Monday' }],
      added: [{ start: 31, end: 40, words: 'Wednesday' }], to_revision: 3 });
  });
  assert.deepEqual(reads, []);
  await button.onclick();
  assert.deepEqual(reads, [{ kind: 'message', id: 'm1', edit_echo_revision: 3 }]);
  assert.equal(panel.querySelector('del').textContent, 'Monday');
  assert.equal(panel.querySelector('ins').textContent, 'Wednesday');
  await button.onclick();
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
  assert.equal(reads.length, 1);
});

test('a late diff cannot repopulate an edit row after a quick re-edit', async () => {
  const { row, button, panel } = fixture();
  let complete;
  activateEditEcho(row, target, currentEcho, true, () => new Promise(resolve => { complete = resolve; }));
  const old = button.onclick();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  activateEditEcho(row, { ...target, revision: 5 }, { ...currentEcho, revision: 5 }, true, async () => null);
  complete(source(currentEcho, { cuts: [{ words: 'Thursday' }], added: [], to_revision: 4 }));
  await old;
  assert.equal(panel.hidden, true);
  assert.equal(panel.querySelector('del'), null);
  assert.match(button.getAttribute('aria-label'), /revision 5$/);
});

test('a held, moved or mismatched source cannot paint differences into a row', async () => {
  for (const extra of [{ withheld: true }, { topic_id: 't2' }, { revision: 5 }]) {
    const { row, button, panel } = fixture();
    activateEditEcho(row, target, currentEcho, true, async () =>
      source(currentEcho, { cuts: [{ words: 'Private words' }], added: [], to_revision: 4 }, extra));
    await button.onclick();
    assert.equal(panel.querySelector('del'), null);
    assert.equal(panel.textContent, 'Changes for this revision are unavailable.');
  }
});
