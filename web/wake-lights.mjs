import { readableTime } from './topic-state.mjs';

// How the agent runner ended, in words, when wakes are not going out.
const ENDED = { killed: 'was killed', lease_lost: 'lost its lease', failed: 'failed', stopped_unrecorded: 'stopped' };
const PAUSED = { operator_pause: 'was paused by an operator', cleanup_failed: 'paused because a cleanup failed',
  route_binding_changed: 'paused because a route changed', storage_failure: 'paused after a storage fault' };

// What an agent's name says when its wakes are not getting through, from the
// wakes view: an agent whose wakes stopped because it did not answer them, or,
// while no runner is sending wakes, that they are paused. Off for everyone
// else. While no runner sends wakes and Core gives this reader a notice (it
// owns an outcome and work waits), the page also says why and since when. A
// read that fails keeps what was said, and is never a reason to read the page
// again: the next commit reads the wakes with everything else.
export class WakeLights {
  constructor({ read, painted = () => {} }) { this.read = read; this.painted = painted; this.quiet = new Map(); this.down = null; }

  async load() {
    try {
      const answer = await this.read();
      if (Array.isArray(answer?.quiet)) {
        this.quiet = new Map(answer.quiet.map(item => [item.actor_id, item]));
        const waiting = answer.notice?.waiting_agents;
        this.down = answer.runner?.live === false && Number.isInteger(waiting) && waiting > 0 ? { runner: answer.runner, waiting } : null;
      }
    } catch {}
    this.painted();
    return true;
  }

  notice() {
    if (!this.down) return null;
    const { runner, waiting } = this.down;
    const at = Number.isInteger(runner.since_ms) ? ` at ${readableTime(runner.since_ms)}` : '';
    const why = runner.state === 'exited' ? `the agent runner ${ENDED[runner.reason] ?? 'ended'}${at}`
      : runner.state === 'stopped' ? `the agent runner was stopped${at}`
      : runner.state === 'unrenewed' ? `the agent runner stopped answering${at}`
      : runner.state === 'paused' ? `the agent runner ${PAUSED[runner.reason] ?? 'is paused'}`
      : 'no agent runner has run here';
    return `Wakes are not going out: ${why}. ${waiting} ${waiting === 1 ? 'agent has' : 'agents have'} work waiting.`;
  }

  words(actorId) {
    const item = this.quiet.get(actorId);
    if (!item || !Number.isInteger(item.waiting)) return null;
    const waiting = `${item.waiting} waiting`;
    if (item.why === 'wakes_paused') return `wakes paused · ${waiting}`;
    if (item.why === 'not_answering' && Number.isInteger(item.since_ms)) return `not answering since ${readableTime(item.since_ms)} · ${waiting}`;
    return null;
  }
}
