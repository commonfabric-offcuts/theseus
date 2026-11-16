// An outcome archived or completed, and brought back (item 404; docs/targets.md, "Archived and completed"): the words
// the surfaces share, the one command a press sends, and the topic header's line with Bring back for the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './targets-dom.mjs';
import { ACTS, BRING_BACK_TITLE, bringBackName, endedRowWords, keptLine, paintKeptLine, sendEnd } from '../web/outcome-end.mjs';

const NOV_15 = new Date(2026, 10, 15, 21, 40).getTime();
const drain = () => new Promise(resolve => setImmediate(resolve));

test('the words: a row under Archived (N) has no dot, a topic\'s line says it is kept to read, and each control has its name', () => {
  assert.equal(endedRowWords({ state: 'archived', ms: NOV_15 }), 'Archived Nov 15');
  assert.equal(endedRowWords({ state: 'completed', ms: NOV_15 }), 'Completed Nov 15');
  assert.equal(keptLine('archived', NOV_15), 'This outcome is archived; its topics are kept to read');
  assert.equal(keptLine('completed', NOV_15), 'This outcome was completed Nov 15; its topics are kept to read');
  assert.deepEqual([ACTS.completed.word, ACTS.completed.busy, ACTS.archived.word, ACTS.archived.busy], ['Complete', 'Completing…', 'Archive', 'Archiving…']);
  assert.equal(bringBackName('Garden shed'), 'Bring back Garden shed');
  assert.equal(bringBackName(''), BRING_BACK_TITLE);
});

test('a press sends outcome.end_set with the page\'s revision, and Core\'s refusal comes back as its own words', async () => {
  const sent = [];
  const send = async (kind, target, args, expected) => { sent.push([kind, target, args, expected]); return { status: 'committed', result: { state: 'open', changed: true } }; };
  assert.deepEqual(await sendEnd(send, 'w1', 'open', 12), { state: 'open', changed: true });
  assert.deepEqual(sent, [['outcome.end_set', { workspace_id: 'w1' }, { state: 'open' }, { workspace_revision: 12 }]]);
  await assert.rejects(sendEnd(async () => ({ status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Someone changed it first.' } }), 'w1', 'archived', 3),
    /^Error: Someone changed it first\.$/);
});

test('a topic\'s header line shows while its outcome is archived or completed, with Bring back for the owner only; refused, it says why and stays', async t => {
  const dom = installDocument(t);
  const host = dom.host();
  paintKeptLine(host, { lead: { kind: 'archived', by: 'tony', ms: NOV_15 } });
  assert.deepEqual([host.hidden, host.textContent], [false, 'This outcome is archived; its topics are kept to read'], 'no Bring back for anyone but the owner');
  for (const lead of [{ kind: 'reached', by: 'tony', ms: NOV_15 }, { kind: 'asks', count: 1 }, null]) {
    paintKeptLine(host, { lead }, () => {});
    assert.deepEqual([host.hidden, host.textContent], [true, ''], 'nothing while it is open or reached');
  }
  let fail = true, pressed = 0;
  paintKeptLine(host, { lead: { kind: 'completed', by: 'tony', ms: NOV_15 } }, async () => { pressed += 1; if (fail) throw Error('Not saved; nothing changed.'); });
  const button = host.querySelector('[data-key="bring-back"]');
  assert.equal(host.textContent, 'This outcome was completed Nov 15; its topics are kept to read Bring back');
  assert.equal(button.getAttribute('aria-label'), BRING_BACK_TITLE);
  button.click(); button.click(); await drain();
  assert.equal(pressed, 1, 'a second press while it is in flight sends nothing');
  assert.equal(host.querySelector('.notice').textContent, ' Not saved; nothing changed.');
  assert.equal(button.textContent, 'Bring back');
  fail = false; button.click(); await drain();
  assert.equal(host.querySelector('.notice'), null, 'the old refusal goes with the next press');
});
