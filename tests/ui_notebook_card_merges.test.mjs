import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCardContent} from '../web/notebook-writing.mjs';
import {parseDeck,deckBody,applyAct,cardText} from '../web/deck.mjs';
test('24 pairs of card gestures and changes to different cards merge',()=>{
const page = body => ({ title: 'Page', body, attachments: [], references: [] });
const shapes = {
  blank: '## Plan\n\nShip it.\n\n## Notes\n\nDan reviews.\n\n## Risks\n\nNone yet.\n\n## Later\n\nMaybe.\n',
  tight: '## Plan\nShip it.\n## Notes\nDan reviews.\n## Risks\nNone yet.\n## Later\nMaybe.\n',
};
const words = { Plan: 'Ship it.', Notes: 'Dan reviews.', Risks: 'None yet.', Later: 'Maybe.' };
const act = (body, a) => { const deck = parseDeck(body), at = deck.cards.findIndex(c => c.title === a.card);
  const done = applyAct(deck, { text: cardText(deck.cards[at]), ...a.act, near: at, ...(a.after ? { after: cardText(deck.cards.find(c => c.title === a.after)) } : {}) });
  if (!done) throw Error('act did nothing: ' + JSON.stringify(a)); return deckBody(done.deck); };
const cases = [
  ['move Plan down past Notes; agent edits Risks', { card: 'Plan', act: { kind: 'move', step: 1 } }, 'Risks'],
  ['move Notes up past Plan; agent edits Plan', { card: 'Notes', act: { kind: 'move', step: -1 } }, 'Plan'],
  ['move Plan down past Notes; agent edits Notes', { card: 'Plan', act: { kind: 'move', step: 1 } }, 'Notes'],
  ['Tab Notes under Plan; agent edits Plan', { card: 'Notes', act: { kind: 'indent' } }, 'Plan'],
  ['Tab Notes under Plan; agent edits Risks', { card: 'Notes', act: { kind: 'indent' } }, 'Risks'],
  ['remove Notes; agent edits Plan', { card: 'Notes', act: { kind: 'remove' } }, 'Plan'],
  ['remove Notes; agent edits Risks', { card: 'Notes', act: { kind: 'remove' } }, 'Risks'],
  ['remove Later (the last card); agent edits Risks', { card: 'Later', act: { kind: 'remove' } }, 'Risks'],
  ['new card after Plan; agent edits Plan', { card: 'Plan', act: { kind: 'add', text: 'New\nFresh.', depth: 0 }, after: 'Plan' }, 'Plan'],
  ['new card after Plan; agent edits Notes', { card: 'Plan', act: { kind: 'add', text: 'New\nFresh.', depth: 0 }, after: 'Plan' }, 'Notes'],
  ['merge Plan with Notes; agent edits Risks', { card: 'Plan', act: { kind: 'merge', step: 1 } }, 'Risks'],
  ['edit Plan; agent edits Notes', { card: 'Plan', act: { kind: 'edit', to: 'Plan\nShip it Friday.' } }, 'Notes'],
];
let bad = 0;
for (const [shape, base] of Object.entries(shapes)) for (const [name, a, agentCard] of cases) {
  const mine = act(base, a);
  const theirs = base.replace(words[agentCard], 'AGENT ' + words[agentCard]);
  const merged = mergeCardContent(page(base), page(mine), page(theirs));
  const ok = merged !== null && merged.body.includes('AGENT ' + words[agentCard]) && sameCards(merged.body, mine, agentCard);
  assert.ok(ok, shape+' '+name+': '+JSON.stringify(merged));
}
// The merged page equals the person's page with the agent's words in place.
function sameCards(body, mine, agentCard) {
  return parseDeck(body).cards.map(c => cardText(c).replace('AGENT ', '')).join('|') === parseDeck(mine).cards.map(cardText).join('|');
}
});
