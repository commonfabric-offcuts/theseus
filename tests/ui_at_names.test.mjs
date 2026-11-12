// Who writing from the page goes to when it starts with @names (item 329,
// docs/reader.md "Naming who a message is to"): the rule in
// web/at-names.mjs, from the same cases Core's copy is held to
// (tests/fixtures/at_names.json, tests/test_at_names.py), and the words the
// composer says it with (web/whisper-choice.mjs toWords). The composers'
// own painting is pressed in tests/topic_reading_native.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { leadingNames, addressedTo } from '../web/at-names.mjs';
import { toWords } from '../web/whisper-choice.mjs';

const table = JSON.parse(readFileSync(new URL('./fixtures/at_names.json', import.meta.url), 'utf8'));

test('the leading @names that name members, as Core reads them', () => {
  for (const [body, named] of table.cases) assert.deepEqual(leadingNames(body, table.members), named, JSON.stringify(body));
});

test('the members a message goes to replace the default, and anything else keeps it', () => {
  const members = [{ id: 'auditor' }, { id: 'fable' }];
  assert.deepEqual(addressedTo('@auditor can you reply here?', members, ['fable']), ['auditor']);
  assert.deepEqual(addressedTo('@AUDITOR @fable', members, []), ['auditor', 'fable']);
  assert.deepEqual(addressedTo('@nobody can you?', members, ['fable']), ['fable']);
  assert.deepEqual(addressedTo('Thanks', members, ['fable']), ['fable']);
  assert.deepEqual(addressedTo('Thanks', members, []), []);
  // Nobody to match against: the default stands.
  assert.deepEqual(addressedTo('@auditor hi', [], ['fable']), ['fable']);
  assert.deepEqual(addressedTo(undefined, members, ['fable']), ['fable']);
});

test('the composer says who it goes to, and everyone when nobody is named', () => {
  assert.equal(toWords(['auditor']), 'To auditor');
  assert.equal(toWords(['auditor', 'fable']), 'To auditor and fable');
  assert.equal(toWords([]), 'To everyone here');
  assert.equal(toWords([], 'the conversation'), 'To everyone in the conversation');
});
