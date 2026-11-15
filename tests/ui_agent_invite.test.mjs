import test from 'node:test';
import assert from 'node:assert/strict';
import { Invitation, HARNESSES } from '../web/agent-invite.mjs';

// Inviting an agent from the Team panel (item 324, docs/agents.md): the
// request the page sends, what it keeps when an answer never came or the
// sign-in file was not written, and what it says when it is refused. Below
// the browser; tests/team_invite_native.mjs presses the real page.

const bootstrap = { instance_id: 'i1', actor: 'tony', authority: { authority_id: 'a1', authority_epoch: 'e1' } };
const workspace = { id: 'w1', version: 4 };
function core(answer) {
  const sent = [];
  return { sent, command: async envelope => { sent.push(structuredClone(envelope)); return answer(envelope, sent.length); } };
}
const result = envelope => ({ workspace_id: 'w1', title: 'Building', version: 5, harness: envelope.args.harness,
  agent: { id: 'release-scribe', name: envelope.args.name, kind: 'agent' } });
const receipt = (envelope, more) => ({ instance_id: envelope.instance_id, operation_id: envelope.operation_id, kind: envelope.kind, ...more });
const invited = (envelope, prompt = 'You are Release scribe…') => receipt(envelope, { recorded: true, status: 'committed', result: result(envelope),
  sign_in: { written: true, path: '/i/release-scribe.profile.json', prompt } });

test('the two programs an agent runs in are Claude Code and Codex, Claude Code first', () => {
  assert.deepEqual(HARNESSES, [['claude-code', 'Claude Code'], ['codex', 'Codex']]);
});

test('an invitation sends workspace.agent_invite with the name and program as typed, fenced on the outcome as read, and gives back the prompt', async () => {
  const api = core(envelope => invited(envelope));
  const done = await new Invitation({ api, bootstrap }).send(workspace, 'Release scribe', 'codex');
  assert.deepEqual(done, { agent: { id: 'release-scribe', name: 'Release scribe', kind: 'agent' }, harness: 'codex', prompt: 'You are Release scribe…' });
  assert.equal(api.sent.length, 1);
  const [request] = api.sent;
  assert.deepEqual([request.kind, request.target, request.expected, request.args],
    ['workspace.agent_invite', { workspace_id: 'w1' }, { workspace_revision: 4, authority: bootstrap.authority }, { name: 'Release scribe', harness: 'codex' }]);
});

test('a blank name sends nothing', async () => {
  const api = core(envelope => invited(envelope));
  await assert.rejects(new Invitation({ api, bootstrap }).send(workspace, '   ', 'codex'), /Type the agent’s name/);
  assert.equal(api.sent.length, 0);
});

test('an answer that never came keeps the exact request for the next Return, and a changed name is a new request', async () => {
  let lose = 2;
  const api = core(envelope => { if (lose-- > 0) throw Error('offline'); return invited(envelope); });
  const invitation = new Invitation({ api, bootstrap });
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'codex'), error => error.again && /^Not confirmed: offline\. Press Return to try once more\.$/.test(error.message));
  await assert.rejects(invitation.send({ ...workspace, version: 9 }, 'Release scribe', 'codex'), /Not confirmed/);
  assert.deepEqual(api.sent[1], api.sent[0], 'the same request, its operation and its revision, even after the page read a newer outcome');
  await invitation.send(workspace, 'Release scribe', 'codex');
  assert.deepEqual(api.sent[2], api.sent[0]);
  await invitation.send(workspace, 'Night watch', 'codex');
  assert.notEqual(api.sent[3].operation_id, api.sent[0].operation_id, 'after it settled, the next invitation is its own');
  const switched = core(envelope => { throw Error('offline'); });
  const other = new Invitation({ api: switched, bootstrap });
  await assert.rejects(other.send(workspace, 'Release scribe', 'codex'));
  await assert.rejects(other.send(workspace, 'Release scribe', 'claude-code'));
  assert.notEqual(switched.sent[1].operation_id, switched.sent[0].operation_id, 'another program is another request');
});

test('a sign-in file not written keeps the request, and Try again sends it exactly once more', async () => {
  let written = false;
  const api = core(envelope => written ? invited(envelope) : receipt(envelope, { recorded: true, status: 'committed', result: result(envelope),
    sign_in: { written: false, path: '/i/release-scribe.profile.json', message: 'Release scribe is on the team, but its sign-in file could not be written in /i. Try again: the same invitation writes it, and nothing else is repeated.' } }));
  const invitation = new Invitation({ api, bootstrap });
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'claude-code'), error =>
    error.retry === true && error.again === true && error.agent.id === 'release-scribe' && error.message.startsWith('Release scribe is on the team, but its sign-in file could not be written'));
  written = true;
  const done = await invitation.again();
  assert.equal(done.prompt, 'You are Release scribe…');
  assert.deepEqual(api.sent[1], api.sent[0]);
  await assert.rejects(invitation.again(), /Nothing is waiting/, 'once written, nothing is kept');
});

test('a refusal says Core\'s words, and the next Return is a new request; an adapter\'s refusal is final too', async () => {
  const taken = 'There is already someone called Release scribe here. Choose another name, such as Release scribe 2.';
  const api = core((envelope, n) => n === 1 ? receipt(envelope, { recorded: true, status: 'rejected', error: { code: 'NAME_TAKEN', message: taken, retryable: false } })
    : n === 2 ? receipt(envelope, { recorded: false, status: 'rejected', error: { code: 'SIGN_IN_TAKEN', message: 'A sign-in file…', retryable: false } })
      : receipt(envelope, { recorded: true, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Only the outcome\'s owner or its coordinator can invite an agent to it.', retryable: false } }));
  const invitation = new Invitation({ api, bootstrap });
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'codex'), error => error.code === 'NAME_TAKEN' && error.message === taken && !error.again);
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'codex'), error => error.code === 'SIGN_IN_TAKEN' && !error.again);
  assert.notEqual(api.sent[1].operation_id, api.sent[0].operation_id);
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'codex'), error => error.code === 'FORBIDDEN');
  assert.equal(invitation.pending, null);
});

test('someone else changing the team at the same moment sends it once more, as a new request at the revision Core names', async () => {
  const api = core((envelope, n) => n === 1 ? receipt(envelope, { recorded: true, status: 'rejected',
    error: { code: 'REVISION_CONFLICT', message: 'Writing changed', retryable: false, current_versions: { workspace_revision: 6 } } }) : invited(envelope));
  await new Invitation({ api, bootstrap }).send(workspace, 'Release scribe', 'codex');
  assert.deepEqual(api.sent.map(request => request.expected.workspace_revision), [4, 6]);
  assert.notEqual(api.sent[1].operation_id, api.sent[0].operation_id);
});

test('a busy or unconfirmed answer keeps the request', async () => {
  const api = core((envelope, n) => n === 1 ? receipt(envelope, { recorded: false, status: 'retryable', error: { code: 'DATABASE_BUSY', message: 'This attempt is busy', retryable: true } }) : invited(envelope));
  const invitation = new Invitation({ api, bootstrap });
  await assert.rejects(invitation.send(workspace, 'Release scribe', 'codex'), error => error.again && error.message === 'This attempt is busy. Press Return to try once more.');
  await invitation.send(workspace, 'Release scribe', 'codex');
  assert.deepEqual(api.sent[1], api.sent[0]);
});
