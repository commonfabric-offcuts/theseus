// A message shown by one line in the feed (item 447, web/message-preview.mjs): the author's own words, never a
// quoted line read as theirs and never cut at a colon. The native reading checks (tests/stack_native.mjs, "reading
// stacks a folded message's row shows its author's own words …") read the row on the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { messagePreview } from '../web/message-preview.mjs';

// Tony's reply that item 447 was raised on: a quoted line, a bare quote line, a blank line, then his own words.
const TONY = '> - Release 69, 1:06 AM: moving messages/dossiers below More...\n>\n\nbank this - not a request but lets discuss:\n\nWhat if a dossier put aside said why?';

test('a reply that begins with a quote shows the author\'s own words after it, colon and all, and nothing of the quote', () => {
  const line = messagePreview({ body: TONY, attachments: [] });
  assert.equal(line, 'bank this - not a request but lets discuss:');
  assert.doesNotMatch(line, /Release 69/);
});

test('a message that is only a quote shows the quoted words inside quote marks, so they read as a quote', () => {
  assert.equal(messagePreview({ body: '> - Release 69, 1:06 AM: moving messages/dossiers below More...\n>' }), '“Release 69, 1:06 AM: moving messages/dossiers below More...”');
  // Inside the quote the same rule reads it: the quoted author's own words before a quote they quoted.
  assert.equal(messagePreview({ body: '> > A quote in a quote\n>\n> and the words around it' }), '“and the words around it”');
  assert.equal(messagePreview({ body: '> > Only a quote in a quote' }), '“Only a quote in a quote”');
  // Own words anywhere after the quote win over it, so the marks never wrap the author's words.
  assert.equal(messagePreview({ body: '> quoted\n\nMine.' }), 'Mine.');
});

test('the author\'s first line is never cut at a colon, a full stop or a semicolon', () => {
  assert.equal(messagePreview({ body: 'Here is the plan: fold the shipped list by release. Then the rail; then the rest.\nSecond line.' }),
    'Here is the plan: fold the shipped list by release. Then the rail; then the rest.');
  assert.equal(messagePreview({ body: 'Reply two, to fold.\nIts second line.' }), 'Reply two, to fold.');
  // Addressing names are the author's words too.
  assert.equal(messagePreview({ body: '@fable, @warp: Fold the shipped list by release.' }), '@fable, @warp: Fold the shipped list by release.');
});

test('the marks that begin a line, a list\'s dash or number, a task\'s box or a heading\'s #s, and emphasis marks are not words', () => {
  assert.equal(messagePreview({ body: '- Make the rail one line shorter: then the rest\n- Second point' }), 'Make the rail one line shorter: then the rest');
  assert.equal(messagePreview({ body: '\n\n1. **Fold** the shipped list' }), 'Fold the shipped list');
  assert.equal(messagePreview({ body: '- [ ] A task to do' }), 'A task to do');
  assert.equal(messagePreview({ body: '## Plan for Friday ##\nThe words.' }), 'Plan for Friday');
  assert.equal(messagePreview({ body: '---\n\nAfter a rule.' }), 'After a rule.');
  assert.equal(messagePreview({ body: '```js\nconst a = 1;\n```' }), 'const a = 1;');
  // A dash inside the line is the author's.
  assert.equal(messagePreview({ body: 'bank this - not a request' }), 'bank this - not a request');
});

test('an empty message shows nothing, and one with only attachments says what is attached', () => {
  assert.equal(messagePreview({ body: '', attachments: [] }), '');
  assert.equal(messagePreview({ body: '  \n> \n', attachments: [] }), '');
  assert.equal(messagePreview({}), '');
  assert.equal(messagePreview({ body: '', attachments: [{ id: 'a1', name: 'cabin.png' }, { id: 'a2', name: 'map.pdf' }] }), 'Attached: cabin.png, map.pdf');
  assert.equal(messagePreview({ body: '', attachments: [{ id: 'a1' }] }), 'Attached: a file');
  // Words come before what is attached.
  assert.equal(messagePreview({ body: 'The photo.', attachments: [{ id: 'a1', name: 'cabin.png' }] }), 'The photo.');
});

test('a long line is left for the page\'s ellipsis, and only past 200 characters ends at a word, never longer than a stack\'s name may be', () => {
  const long = 'word '.repeat(30).trim();
  assert.equal(messagePreview({ body: long }), long, 'a line of 149 characters is whole');
  const longer = messagePreview({ body: 'word '.repeat(60) });
  assert.ok(longer.length <= 200 && longer.endsWith('word…'), longer);
  // Spaces fold to one, as a typed name's do, so a name saved unchanged is the same line.
  assert.equal(messagePreview({ body: 'Two\t spaces  here ' }), 'Two spaces here');
});
