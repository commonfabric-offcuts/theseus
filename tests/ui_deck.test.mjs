import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAct, cardStacks, cardText, deckBody, findCard, groupAct, groupEnd, parseDeck, placeNew, stackLine, textCard, writtenAt } from '../web/deck.mjs';

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

test('the cards are the headings of two to six #s outside fenced blocks, each with the words under it', () => {
  const deck = parseDeck(PAGE);
  assert.equal(titles(deck), 'Alpha,Beta,Gamma');
  assert.equal(deck.opening, '# Talk\n\nThe key ideas.\n\n');
  assert.equal(cardText(deck.cards[1]), 'Beta\nsecond words\nmore');
  assert.equal(titles(parseDeck('## A\n```\n## code\n```\n### sub\n## B ##')), 'A,sub,B');
  assert.deepEqual(parseDeck('# Page\n## A\n### sub\n#### deeper\n####### words\n## B').cards.map(card => card.depth), [0, 1, 2, 0]);
  assert.equal(parseDeck('## A\n```\n## code\n```').cards[0].words, '```\n## code\n```');
});

test('every fence newline arrangement keeps the next card and reply stack outside it', () => {
  const address = 'https://here.example/?topic=t&message=m1', stack = stackLine(address);
  for (const marker of ['```', '~~~~']) for (const first of ['', '\n']) for (const last of ['', '\n']) {
    const fenced = marker + first + 'say `hi` aloud' + last + marker;
    const body = '## First\n' + fenced + '\n\n## Second\nnext\n';
    assert.equal(titles(parseDeck(body)), 'First,Second', body);
    assert.equal(deckBody(parseDeck(body)), body);
    const crlf = body.replaceAll('\n', '\r\n');
    assert.equal(titles(parseDeck(crlf)), 'First,Second', crlf);
    assert.equal(deckBody(parseDeck(crlf)), crlf);
    assert.deepEqual(cardStacks(fenced + '\n' + stack, a => a === address ? 'm1' : null), { words: fenced, stacks: ['m1'] });
    assert.deepEqual(cardStacks((fenced + '\n' + stack).replaceAll('\n', '\r\n'), a => a === address ? 'm1' : null), { words: fenced.replaceAll('\n', '\r\n'), stacks: ['m1'] });
  }
  const body = '## First\n````md\n## Literal\n```\n## Still literal\nend````\n## Second\n';
  assert.equal(titles(parseDeck(body)), 'First,Second');
  assert.equal(deckBody(parseDeck(body)), body);
  const fenced = '```\n' + address + '\nend```';
  assert.deepEqual(cardStacks(fenced + '\n' + stack, a => a === address ? 'm1' : null), { words: fenced, stacks: ['m1'] });
  assert.equal(titles(parseDeck('## First\n```inline``` after\n## Second\n')), 'First,Second');
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
  assert.equal(deckBody(done.deck), '# Talk\n\nThe key ideas.\n\n## Alpha\n\nfirst words\n\n## Beta\n\nsecond words\nmore\n\n**Gamma**\n');
  assert.equal(deckBody(applyAct(parseDeck(deckBody(done.deck)), done.undo).deck), PAGE);
  const up = applyAct(parseDeck(PAGE), { kind: 'merge', text: 'Beta\nsecond words\nmore', step: -1, near: 1 });
  assert.equal(cardText(up.deck.cards[0]), 'Alpha\nfirst words\n\n**Beta**\n\nsecond words\nmore');
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

const GROUPS = '## P\n\np words\n\n### P1\n\none\n\n### P2\n\ntwo\n\n## Q\n\nq words\n';
const P = 'P\np words', P1 = 'P1\none', P2 = 'P2\ntwo', Q = 'Q\nq words';
// The page after an act and after the act that takes it back, which must be the page it came from.
const there = (body, act) => {
  const done = applyAct(parseDeck(body), act), page = deckBody(done.deck);
  assert.equal(deckBody(applyAct(parseDeck(page), done.undo).deck), body);
  return page;
};

test("a card's children are the deeper cards after it, and a move takes them past the card beside it, never out of their parent", () => {
  assert.equal(groupEnd(parseDeck(GROUPS).cards, 0), 3);
  assert.equal(groupEnd(parseDeck(GROUPS).cards, 1), 2);
  assert.equal(there(GROUPS, { kind: 'move', text: Q, step: -1, near: 3 }), '## Q\n\nq words\n\n## P\n\np words\n\n### P1\n\none\n\n### P2\n\ntwo\n');
  assert.equal(there(GROUPS, { kind: 'move', text: P1, step: 1, near: 1 }), '## P\n\np words\n\n### P2\n\ntwo\n\n### P1\n\none\n\n## Q\n\nq words\n');
  assert.equal(after(GROUPS, { kind: 'move', text: P1, step: -1, near: 1 }), null);
  assert.equal(after(GROUPS, { kind: 'move', text: P2, step: 1, near: 2 }), null);
});

test('Tab puts a card under the one above it and shift-Tab takes it out after its parent\'s children, each undone exactly', () => {
  assert.equal(there(GROUPS, { kind: 'indent', text: Q, near: 3 }), '## P\n\np words\n\n### P1\n\none\n\n### P2\n\ntwo\n\n### Q\n\nq words\n');
  assert.equal(there(GROUPS, { kind: 'indent', text: P2, near: 2 }), '## P\n\np words\n\n### P1\n\none\n\n#### P2\n\ntwo\n\n## Q\n\nq words\n');
  assert.equal(after(GROUPS, { kind: 'indent', text: P1, near: 1 }), null);
  assert.equal(after(GROUPS, { kind: 'indent', text: P, near: 0 }), null);
  assert.equal(there(GROUPS, { kind: 'outdent', text: P1, near: 1 }), '## P\n\np words\n\n### P2\n\ntwo\n\n## P1\n\none\n\n## Q\n\nq words\n');
  assert.equal(there(GROUPS, { kind: 'outdent', text: P2, near: 2 }), '## P\n\np words\n\n### P1\n\none\n\n## P2\n\ntwo\n\n## Q\n\nq words\n');
  assert.equal(after(GROUPS, { kind: 'outdent', text: Q, near: 3 }), null);
  // A card's own words, and its children's, stay exactly as they were; a heading goes no deeper than six #s.
  assert.equal(after('## A\n  odd  spacing\n## B\n### B1\nkept\n', { kind: 'indent', text: 'B', near: 1 }), '## A\n  odd  spacing\n### B\n#### B1\nkept\n');
  assert.equal(after('## A\n## B\n###### B1\n', { kind: 'indent', text: 'B', near: 1 }), null);
});

test('Tab, shift-Tab, cmd-Up and cmd-Down take a new card not yet made where they would take a made card standing there, and nowhere else', () => {
  const deck = parseDeck(GROUPS), indent = { kind: 'indent' }, outdent = { kind: 'outdent' }, up = { kind: 'move', step: -1 }, down = { kind: 'move', step: 1 };
  // After Q, at its depth: Tab puts it under Q, cmd-Up takes it past Q, after P's children, and shift-Tab and cmd-Down
  // have nowhere to go.
  assert.deepEqual(placeNew(deck, { after: Q, near: 3, depth: 0 }, indent), { after: Q, near: 3, depth: 1 });
  assert.deepEqual(placeNew(deck, { after: Q, near: 3, depth: 0 }, up), { after: P2, near: 2, depth: 0 });
  assert.equal(placeNew(deck, { after: Q, near: 3, depth: 0 }, outdent), null);
  assert.equal(placeNew(deck, { after: Q, near: 3, depth: 0 }, down), null);
  // Among P's children, after P1: Tab puts it under P1, and shift-Tab takes it out after P's children, never over P2.
  assert.deepEqual(placeNew(deck, { after: P1, near: 1, depth: 1 }, indent), { after: P1, near: 1, depth: 2 });
  const out = placeNew(deck, { after: P1, near: 1, depth: 1 }, outdent);
  assert.deepEqual(out, { after: P2, near: 2, depth: 0 });
  assert.equal(after(GROUPS, { kind: 'add', text: 'N', ...out }), '## P\n\np words\n\n### P1\n\none\n\n### P2\n\ntwo\n\n## N\n\n## Q\n\nq words\n');
  // cmd-Up and cmd-Down take it past the child beside it, and never out of P.
  assert.deepEqual(placeNew(deck, { after: P1, near: 1, depth: 1 }, up), { after: P, near: 0, depth: 1 });
  assert.deepEqual(placeNew(deck, { after: P1, near: 1, depth: 1 }, down), { after: P2, near: 2, depth: 1 });
  assert.equal(placeNew(deck, { after: P, near: 0, depth: 1 }, up), null);
  assert.equal(placeNew(deck, { after: P2, near: 2, depth: 1 }, down), null);
  // First, in an empty deck, past six #s, or after a card that is gone: nowhere to go.
  assert.equal(placeNew(deck, { after: null, near: -1, depth: 0 }, indent), null);
  assert.equal(placeNew(deck, { after: null, near: -1, depth: 0 }, up), null);
  assert.equal(placeNew(parseDeck(''), { after: null, near: -1, depth: 0 }, indent), null);
  assert.equal(placeNew(parseDeck('## A\n### B\n#### C\n##### D\n###### E\n'), { after: 'E', near: 4, depth: 4 }, indent), null);
  assert.equal(placeNew(deck, { after: 'gone', near: 1, depth: 0 }, indent), null);
});

test('a merge takes the lower card\'s children, a removed card takes its own, and each undo gives them back', () => {
  const merged = there(GROUPS, { kind: 'merge', text: P, step: 1, near: 0 });
  assert.equal(merged, '## P\n\np words\n\n**Q**\n\nq words\n\n### P1\n\none\n\n### P2\n\ntwo\n');
  const absorbed = '## A\n\n## B\n\n### B1\n';
  assert.equal(there(absorbed, { kind: 'merge', text: 'A', step: 1, near: 0 }), '## A\n\n**B**\n\n### B1\n');
  assert.equal(there(GROUPS, { kind: 'remove', text: P, near: 0 }), '## Q\n\nq words\n');
  assert.equal(there(GROUPS, { kind: 'remove', text: P1, near: 1 }), '## P\n\np words\n\n### P2\n\ntwo\n\n## Q\n\nq words\n');
});

test('a new card goes in at the depth it is given, and an edit keeps its card\'s depth', () => {
  const added = applyAct(parseDeck(GROUPS), { kind: 'add', after: P2, text: 'N', depth: 0, near: 2 });
  assert.deepEqual(added.deck.cards.map(card => `${card.title}${card.depth}`), ['P0', 'P11', 'P21', 'N0', 'Q0']);
  assert.equal(after(GROUPS, { kind: 'edit', text: P1, to: 'P1, renamed\none', near: 1 }), GROUPS.replace('### P1\n', '### P1, renamed\n'));
});

const FIVE = '## X\n\n## A\n\n## Y\n\n## B\n\n## Z\n';

test('several cards move as one: they gather under the top one, go past the card beside it, and one undo takes it all back', () => {
  const deck = parseDeck(FIVE), up = groupAct(deck, [3, 1], 'move', { step: -1, text: 'B', near: 3 });
  assert.equal(there(FIVE, up), '## A\n\n## B\n\n## X\n\n## Y\n\n## Z\n');
  assert.equal(applyAct(deck, up).at, 1);
  assert.equal(there(FIVE, groupAct(deck, [1, 3], 'move', { step: 1, text: 'A', near: 1 })), '## X\n\n## Y\n\n## A\n\n## B\n\n## Z\n');
  // Cards side by side already go as one block, never past each other.
  const side = '## X\n\n## A\n\n## B\n\n## Y\n';
  assert.equal(there(side, groupAct(parseDeck(side), [1, 2], 'move', { step: 1, text: 'A', near: 1 })), '## X\n\n## Y\n\n## A\n\n## B\n');
  // At the edge a move only gathers them, and then there is nothing to do.
  const edge = '## A\n\n## X\n\n## B\n', gathered = there(edge, groupAct(parseDeck(edge), [0, 2], 'move', { step: -1, text: 'A', near: 0 }));
  assert.equal(gathered, '## A\n\n## B\n\n## X\n');
  assert.equal(groupAct(parseDeck(gathered), [0, 1], 'move', { step: -1, text: 'A', near: 0 }), null);
  // A picked card under another picked card goes with that one.
  const nested = '## X\n\n## P\n\n### P1\n\n## Q\n';
  assert.equal(there(nested, groupAct(parseDeck(nested), [1, 2, 3], 'move', { step: -1, text: 'P', near: 1 })), '## P\n\n### P1\n\n## Q\n\n## X\n');
});

test('Tab on several cards puts them, side by side, under the card above the top one, and shift-Tab takes them out after its parent', () => {
  const page = '## X\n\n## A\n\n## B\n\n### B1\n\n## Y\n', deck = parseDeck(page), under = '## X\n\n### A\n\n### B\n\n#### B1\n\n## Y\n';
  assert.equal(there(page, groupAct(deck, [1, 2], 'indent', { text: 'A', near: 1 })), under);
  assert.equal(there(page, groupAct(deck, [1, 2, 3], 'indent', { text: 'B', near: 2 })), under);
  assert.equal(there(FIVE, groupAct(parseDeck(FIVE), [1, 3], 'indent', { text: 'A', near: 1 })), '## X\n\n### A\n\n### B\n\n## Y\n\n## Z\n');
  assert.equal(groupAct(deck, [0, 1], 'indent', { text: 'X', near: 0 }), null);
  const inside = '## P\n\n### A\n\n### B\n\n### C\n';
  assert.equal(there(inside, groupAct(parseDeck(inside), [1, 3], 'outdent', { text: 'A', near: 1 })), '## P\n\n### B\n\n## A\n\n## C\n');
  assert.equal(groupAct(parseDeck(FIVE), [1, 3], 'outdent', { text: 'A', near: 1 }), null);
});

test('removing several cards takes each with its children, and one undo gives them all back where they stood', () => {
  assert.equal(there(FIVE, groupAct(parseDeck(FIVE), [1, 3], 'remove', { text: 'A', near: 1 })), '## X\n\n## Y\n\n## Z\n');
  assert.equal(there(GROUPS, groupAct(parseDeck(GROUPS), [0, 2, 3], 'remove', { text: P, near: 0 })), '');
});

test('a place in a card\'s words as shown falls at the same words as written, past the markup', () => {
  const at = (written, shown, before) => writtenAt(written, shown, shown.indexOf(before) + before.length);
  assert.equal(at('hello world', 'hello world', 'hello'), 5);
  const bold = 'a **bold** word';
  assert.equal(bold.slice(0, at(bold, 'a bold word', 'a bo')), 'a **bo');
  assert.equal(bold.slice(0, at(bold, 'a bold word', 'a bold w')), 'a **bold** w');
  const link = 'see [the doc](https://example.com/a/b) now';
  assert.equal(link.slice(0, at(link, 'see the doc now', 'the do')), 'see [the do');
  assert.equal(link.slice(0, at(link, 'see the doc now', 'doc n')), 'see [the doc](https://example.com/a/b) n');
  // Paragraphs shown with nothing between them, and a quote's mark left out.
  const blocks = 'one two\n\n> three four';
  assert.equal(blocks.slice(0, at(blocks, 'one twothree four', 'twoth')), 'one two\n\n> th');
  // A character only the page shows is passed over.
  assert.equal(writtenAt('abc', 'a•bc', 3), 2);
  // Nothing before the place, and a place past the end.
  assert.equal(writtenAt('abc', 'abc', 0), 0);
  assert.equal(writtenAt('abc', 'abc', 9), 3);
});
