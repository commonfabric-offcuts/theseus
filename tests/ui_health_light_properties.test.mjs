// Randomized checks of the Health link (docs/health.md, web/health-light.mjs):
// whatever order commits, feed messages, reads, failures, drops and returns
// come in, the link shows only an answer tied to its commit, never an older
// one than it has, never one from before the feed's last return as current,
// and, once everything has arrived, what is red at the latest commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthLight, standing } from '../web/health-light.mjs';

class ClassList { constructor() { this.names = new Set(); } toggle(name, on) { if (on) this.names.add(name); else this.names.delete(name); } contains(name) { return this.names.has(name); } }
const link = () => ({ classList: new ClassList(), textContent: 'Health', attributes: {}, getAttribute(key) { return this.attributes[key] ?? null; }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } });
const tick = () => new Promise(resolve => setImmediate(resolve));

// A small deterministic generator, so a failing seed can be run again.
function generator(seed) {
  let state = seed >>> 0 || 1;
  const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
  return { next, pick: items => items[Math.floor(next() * items.length)], chance: p => next() < p };
}
const KEYS = ['runner', 'failing:a', 'parked:b'];

async function run(seed, { feedSaysHealth, namesCommit }) {
  const rng = generator(seed);
  // The server: what is red at each commit.
  const truth = [[]];
  let seq = 0, sent = -1, feed = 'live', connected = true, firstAfterReturn = true;
  const node = link();
  const reads = []; // {resolve, reject, served: null | seq}
  const light = new HealthLight({ link: node, feed: () => feed, read: () => new Promise((resolve, reject) => reads.push({ resolve, reject, served: null })) });
  let floorTruth = -1, shownSeq = -1, received = -1;
  const say = () => standing(light.facts());
  const check = where => {
    const said = say();
    if (said === 'lit' || said === 'quiet') {
      const best = light.best;
      // Which commit the shown answer was served at: every answer carries that commit's own list.
      const served = truth.indexOf(best.red);
      assert.ok(served >= 0, `${where}: the shown answer is one the server gave`);
      assert.ok(namesCommit || feedSaysHealth ? served === best.seq : served >= best.seq, `${where}: it is tied to its commit (${served} for ${best.seq})`);
      assert.ok(served >= shownSeq, `${where}: never an older answer than one shown (${served} < ${shownSeq})`);
      assert.ok(served >= floorTruth, `${where}: never an answer from before the feed's return as current (${served} < ${floorTruth})`);
      assert.equal(said === 'lit', best.red.length > 0);
      shownSeq = served;
    }
    if (light.best && namesCommit) assert.ok(light.best.seq >= received, `${where}: the answer kept is the newest received`);
  };
  const message = () => {
    const event = { seq, ...(feedSaysHealth ? { health: { red: truth[seq], seq } } : {}) };
    if (firstAfterReturn) { firstAfterReturn = false; floorTruth = seq; light.heard({ kind: 'state', state: 'live', ...event }); }
    if (seq !== sent) light.heard({ kind: 'commit', ...event });
    sent = seq;
  };
  light.load();
  for (let step = 0; step < 120; step++) {
    const action = rng.pick(['commit', 'commit', 'deliver', 'deliver', 'serve', 'answer', 'answer', 'fail', 'drop', 'return', 'visible']);
    if (action === 'commit') {
      seq += 1;
      truth[seq] = KEYS.filter(() => rng.chance(0.3));
    } else if (action === 'deliver' && connected && seq !== sent) {
      message();
    } else if (action === 'serve') {
      const waiting = reads.filter(read => read.served === null);
      if (waiting.length) rng.pick(waiting).served = seq;
    } else if ((action === 'answer' || action === 'fail') && reads.some(read => read.served !== null)) {
      const served = reads.filter(read => read.served !== null);
      const read = rng.pick(served);
      reads.splice(reads.indexOf(read), 1);
      if (action === 'fail') read.reject(new Error('503 SERVER_BUSY'));
      else {
        received = Math.max(received, read.served);
        read.resolve(namesCommit ? { red: truth[read.served], commit_seq: read.served } : { red: truth[read.served] });
      }
    } else if (action === 'drop' && connected) {
      connected = false; feed = 'down'; light.heard({ kind: 'state', state: 'down' });
    } else if (action === 'return' && !connected) {
      connected = true; feed = 'live'; firstAfterReturn = true; message();
    } else if (action === 'visible') {
      light.load();
    }
    if (feedSaysHealth && sent >= 0) received = Math.max(received, sent);
    await tick();
    check(`seed ${seed} step ${step} (${action})`);
  }
  // Everything arrives: the feed is up, its last number is sent, every read is answered.
  if (!connected) { connected = true; feed = 'live'; firstAfterReturn = true; message(); }
  for (let round = 0; round < 50 && (seq !== sent || reads.length); round++) {
    if (seq !== sent) message();
    for (const read of reads.splice(0)) read.resolve(namesCommit ? { red: truth[seq], commit_seq: seq } : { red: truth[seq] });
    await tick();
  }
  await tick();
  check(`seed ${seed} at rest`);
  assert.equal(reads.length, 0, `seed ${seed}: nothing is left unread`);
  assert.equal(say(), truth[seq].length ? 'lit' : 'quiet', `seed ${seed}: at rest it says what is red at the latest commit`);
  assert.equal(light.best.seq, seq);
}

for (const [mode, options] of [['a current server, whose feed says what is red', { feedSaysHealth: true, namesCommit: true }],
  ['a server whose feed does not say, whose reads name their commit', { feedSaysHealth: false, namesCommit: true }],
  ['an older server, whose reads do not name their commit', { feedSaysHealth: false, namesCommit: false }]]) {
  test(`whatever order things come in, the link shows only answers tied to their commit: ${mode}`, async () => {
    for (let seed = 1; seed <= 300; seed++) await run(seed, options);
  });
}
