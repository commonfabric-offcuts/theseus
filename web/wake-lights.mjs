import { readableTime } from './topic-state.mjs';

// What an agent's name says when its wakes are not getting through, from the
// wakes view: an agent whose wakes stopped because it did not answer them, or,
// while no runner is sending wakes, that they are paused. Off for everyone
// else. A read that fails keeps what the names said, and is never a reason to
// read the page again: the next commit reads the wakes with everything else.
export class WakeLights {
  constructor({ read }) { this.read = read; this.quiet = new Map(); }

  async load() {
    try {
      const answer = await this.read();
      if (Array.isArray(answer?.quiet)) this.quiet = new Map(answer.quiet.map(item => [item.actor_id, item]));
    } catch {}
    return true;
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
