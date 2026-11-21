import test from 'node:test';
import assert from 'node:assert/strict';
import { openingWords } from '../web/things-rail.mjs';

// The right rail shows a Notebook page's own first words under its title (968).
test('968 a page that opens with its own title shows the words after it', () => {
  assert.equal(openingWords('# Train window\n\nThe train leaves at nine.', 'Train window'), 'The train leaves at nine.');
  assert.equal(openingWords('Train window: the train leaves at nine.', 'train window'), 'the train leaves at nine.');
});

test('968 an empty page shows only its title', () => {
  assert.equal(openingWords('', 'Train window'), '');
  assert.equal(openingWords(null, 'Train window'), '');
  assert.equal(openingWords('   \n\n', 'Train window'), '');
});

test('968 a page that does not open with its title keeps its words, without the marks', () => {
  assert.equal(openingWords('**Bold** start, then *more*.\n> and a quote', 'Train window'), 'Bold start, then more. and a quote');
});

test('968 the words stop at 220 characters', () => {
  assert.equal(openingWords('x'.repeat(300), 't').length, 220);
});
