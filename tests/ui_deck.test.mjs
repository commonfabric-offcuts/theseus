import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAct, cardStacks, cardText, deckBody, findCard, parseDeck, stackLine, textCard } from '../web/deck.mjs';

const PAGE = '# Talk\n\nThe key ideas.\n\n## Alpha\n\nfirst words\n\n## Beta\n\nsecond words\nmore\n\n## Gamma\n';
const titles = deck => deck.cards.map(card => card.title).join(',');
// The page after an act on it, made as the cards page makes it.
const after = (body, act) => { const done = applyAct(parseDeck(body), act); return done && deckBody(done.deck); };

test('a page read as cards and written back with nothing done to it is exactly the page', () => {
  for (const body of [PAGE, '', 'no cards here\n', '## Only', '## A\nwords right under\n## B\n\n\n', '\n\n## A\n\n```\n## not a card\n```\n\n## B ##\n',
    '## A\n\n~~~~md\n## inside\n~~~\n## still inside\n~~~~\n## B']) {
    assert.equal(deckBody(parseDeck(body)), body);
  }
});

test('the cards are the ## headings outside fenced blocks, each with the words under it', () => {
  const deck = parseDeck(PAGE);
  assert.equal(titles(deck), 'Alpha,Beta,Gamma');
  assert.equal(deck.opening, '# Talk\n\nThe key ideas.\n\n');
  assert.equal(cardText(deck.cards[1]), 'Beta\nsecond words\nmore');
  assert.equal(titles(parseDeck('## A\n```\n## code\n```\n### sub\n## B ##')), 'A,B');
  assert.equal(parseDeck('## A\n```\n## code\n```').cards[0].words, '```\n## code\n```');
});

test('a card moves one place, keeps its exact words, and moving back gives the page it came from', () => {
  const moved = after(PAGE, { kind: 'move', text: 'Gamma', step: -1, near: 2 });
  assert.equal(moved, '# Talk\n\nThe key ideas.\n\n## Alpha\n\nfirst words\n\n## Gamma\n\n## Beta\n\nsecond words\nmore\n');
  assert.equal(after(moved, { kind: 'move', text: 'Gamma', step: 1, near: 1 }), PAGE);
  assert.equal(after(PAGE, { kind: 'move', text: 'Alpha', step: -1, near: 0 }), null);
  assert.equal(after(PAGE, { kind: 'move', text: 'Gamma', step: 1, near: 2 }), null);
  // Cards that still stand together keep the space between them; a new neighbour gets a blank line.
  assert.equal(after('## A\nwords\n## B\n## C\n## D', { kind: 'move', text: 'D', step: -1, near: 3 }), '## A\nwords\n## B\n\n## D\n\n## C\n');
});

test('a merge keeps every word of both cards under the upper title, and its undo gives both cards back', () => {
  const done = applyAct(parseDeck(PAGE), { kind: 'merge', text: 'Beta\nsecond words\nmore', step: 1, near: 1 });
  assert.equal(done.at, 1);
  assert.equal(deckBody(done.deck), '# Talk\n\nThe key ideas.\n\n## Alpha\n\nfirst words\n\n## Beta\n\nsecond words\nmore\n\n### Gamma\n');
  assert.equal(deckBody(applyAct(parseDeck(deckBody(done.deck)), done.undo).deck), PAGE);
  const up = applyAct(parseDeck(PAGE), { kind: 'merge', text: 'Beta\nsecond words\nmore', step: -1, near: 1 });
  assert.equal(cardText(up.deck.cards[0]), 'Alpha\nfirst words\n\n### Beta\n\nsecond words\nmore');
  assert.equal(after(PAGE, { kind: 'merge', text: 'Alpha\nfirst words', step: -1, near: 0 }), null);
});

test('an edit writes only its own card, the first line its title; no text removes the card and undo restores it', () => {
  const edited = after(PAGE, { kind: 'edit', text: 'Alpha\nfirst words', to: '## Alpha, renamed\n\nnew words  \n', near: 0 });
  assert.equal(edited, PAGE.replace('## Alpha\n\nfirst words', '## Alpha, renamed\n\nnew words'));
  assert.equal(after(PAGE, { kind: 'edit', text: 'Alpha\nfirst words', to: 'Alpha\nfirst words', near: 0 }), null);
  const removed = applyAct(parseDeck(PAGE), { kind: 'edit', text: 'Gamma', to: '  \n', near: 2 });
  assert.equal(titles(removed.deck), 'Alpha,Beta');
  assert.equal(deckBody(applyAct(parseDeck(deckBody(removed.deck)), removed.undo).deck), PAGE);
});

test('a new card goes after the picked one, and an empty one is never written', () => {
  const added = applyAct(parseDeck(PAGE), { kind: 'add', after: 'Alpha\nfirst words', text: 'Delta\nfourth', near: 0 });
  assert.equal(added.at, 1);
  assert.equal(titles(added.deck), 'Alpha,Delta,Beta,Gamma');
  assert.equal(titles(applyAct(parseDeck(''), { kind: 'add', after: null, text: 'First', near: -1 }).deck), 'First');
  assert.equal(deckBody(applyAct(parseDeck('notes\n'), { kind: 'add', after: null, text: 'First', near: -1 }).deck), 'notes\n\n## First\n');
  assert.equal(applyAct(parseDeck(PAGE), { kind: 'add', after: null, text: ' \n ', near: -1 }), null);
  assert.equal(deckBody(applyAct(parseDeck(deckBody(added.deck)), added.undo).deck), PAGE);
});

test('an act made again on a newer revision finds its card by its words, nearest where it stood', () => {
  const newer = '# Talk\n\nThe key ideas.\n\n## Gamma\n\n## Alpha\n\nfirst words\n\n## Beta\n\nsecond words\nmore\n\n## Epsilon\n';
  assert.equal(findCard(parseDeck(newer), 'Gamma', 2), 0);
  assert.equal(titles(applyAct(parseDeck(newer), { kind: 'move', text: 'Gamma', step: 1, near: 2 }).deck), 'Alpha,Gamma,Beta,Epsilon');
  assert.equal(applyAct(parseDeck(newer), { kind: 'edit', text: 'Missing', to: 'x', near: 0 }), null);
  const twins = parseDeck('## Same\n\n## Other\n\n## Same\n');
  assert.equal(findCard(twins, 'Same', 2), 2);
  assert.equal(findCard(twins, 'Same', 0), 0);
});

test("a person's text: the first line that is not blank is the title", () => {
  assert.deepEqual(textCard('\n\n  Title  \n\nwords\n  more\n\n'), { title: 'Title', words: 'words\n  more', written: true });
  assert.deepEqual(textCard('### Heading\nx'), { title: 'Heading', words: 'x', written: true });
  assert.deepEqual(textCard('#1 priority'), { title: '#1 priority', words: '', written: true });
});

test("a card's reply stacks are the lines holding only a link to one of them, outside a fenced block", () => {
  const stackOf = address => (address.startsWith('https://here.example/?topic=') ? address.slice(-2) : null);
  const words = `first words\n${stackLine('https://here.example/?topic=t&message=m1')}\n\n### Merged in\n\nhttps://here.example/?topic=t&message=m2\n` +
    'see https://here.example/?topic=t&message=m3 here\n[elsewhere](https://else.example/x)\n```\nhttps://here.example/?topic=t&message=m4\n```';
  const found = cardStacks(words, stackOf);
  assert.deepEqual(found.stacks, ['m1', 'm2']);
  assert.equal(found.words, 'first words\n\n### Merged in\n\nsee https://here.example/?topic=t&message=m3 here\n[elsewhere](https://else.example/x)\n```\nhttps://here.example/?topic=t&message=m4\n```');
  assert.deepEqual(cardStacks('no stacks', stackOf), { words: 'no stacks', stacks: [] });
  // A merge keeps both cards' stacks, and a card read back with nothing done to it keeps its lines exactly.
  const page = `## A\n\nwords\n\n${stackLine('https://here.example/?topic=t&message=m1')}\n\n## B\n\n${stackLine('https://here.example/?topic=t&message=m2')}\n`;
  assert.equal(deckBody(parseDeck(page)), page);
  assert.deepEqual(cardStacks(parseDeck(after(page, { kind: 'merge', text: cardText(parseDeck(page).cards[0]), step: 1, near: 0 })).cards[0].words, stackOf).stacks, ['m1', 'm2']);
});
