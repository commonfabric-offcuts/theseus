// The native harness's rule for a refused release of a paused request.
//
// A paused request the page itself gives up takes its interception with it,
// and releasing it is refused with "Invalid InterceptionId". That refusal is
// the page's own act, not a page error, but only once the page shows it gave
// that very request up: it reports the request cancelled, or the main-frame
// document that sent it has been replaced by a navigation (Chrome then reports
// nothing more for it), before any response reached the page. Every other
// refused release is a failure. A refusal that nothing has explained yet waits
// in `unsettled` for the page's next report on it.
//
// Chrome can pause a request's response while the main-frame document is being
// replaced, after it has stopped naming that request to the Network domain:
// the pause carries no networkId. Such a request is known only by its pause,
// so the rule notes the main-frame document current when the main frame's
// request paused, and excuses its refusal once that document is replaced.
export class ReleaseRule {
  constructor({ failed = () => {} } = {}) {
    Object.assign(this, { onFailed: failed, excused: [], failed: [], unsettled: new Map() });
    this.cancelled = new Set(); this.delivered = new Set(); this.loaders = new Map(); this.replaced = new Set();
    this.documentLoader = null; this.mainFrame = null; this.pausedUnder = new Map(); this.pending = new Set();
  }

  // Why the page gave this request up, or null while it has not.
  abandoned(id) {
    if (this.delivered.has(id)) return null;
    if (this.cancelled.has(id)) return 'cancelled';
    return this.replaced.has(this.loaders.get(id)) ? 'document replaced' : null;
  }

  // Why the page gave up the request a refused release was for, or null while it has not.
  // One with no networkId is known by its pause alone: the document it paused under.
  why(failure) {
    if (failure.networkId) {
      if (this.delivered.has(failure.networkId)) return null;
      const reason = this.abandoned(failure.networkId);
      if (reason) return reason;
      // A pause can precede Network's request report during replacement.
      // Use its captured main document only until Network names its loader.
      if (this.loaders.has(failure.networkId)) return null;
    }
    return this.replaced.has(this.pausedUnder.get(failure.requestId)) ? 'document replaced' : null;
  }

  settle(key, failure, reason = this.why(failure)) {
    this.unsettled.delete(key);
    if (reason) this.excused.push({ ...failure, reason });
    else { this.failed.push(failure); this.onFailed(failure); }
  }

  // Every CDP event of the page's session.
  observe({ method, params }) {
    if (method === 'Network.requestWillBeSent' && params.loaderId) {
      this.loaders.set(params.requestId, params.loaderId);
      for (const [key, failure] of this.unsettled) if (this.why(failure)) this.settle(key, failure);
    }
    // A navigation's own request belongs to the document it brings, not the one it replaces.
    if (method === 'Fetch.requestPaused' && params.frameId === this.mainFrame && params.resourceType !== 'Document') {
      this.pausedUnder.set(params.requestId, this.documentLoader);
    }
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      if (this.documentLoader !== null && this.documentLoader !== params.frame.loaderId) this.replaced.add(this.documentLoader);
      this.documentLoader = params.frame.loaderId; this.mainFrame = params.frame.id;
      for (const [key, failure] of this.unsettled) if (this.why(failure)) this.settle(key, failure);
    }
    if (['Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'].includes(method)) {
      const id = params.requestId;
      if (method === 'Network.loadingFailed' && params.canceled === true) this.cancelled.add(id); else this.delivered.add(id);
      for (const [key, failure] of this.unsettled) if (failure.networkId === id) this.settle(key, failure);
    }
  }

  // Own the command until its answer, including its refusal classification.
  // Only a failed release command goes through this rule, never a body read
  // or an interception callback error.
  async release(event, act) {
    const task = (async () => {
      try { await act(); return true; }
      catch (error) {
        this.refused({message:error.message,requestId:event.requestId,networkId:event.networkId,
          url:event.request.url,responseStatusCode:event.responseStatusCode},error.cdp?.message);
        return false;
      }
    })();
    this.pending.add(task);
    try { return await task; } finally { this.pending.delete(task); }
  }

  // A release of a paused request failed with `message`.
  // `failure` names the pause's requestId and, when Chrome gave one, its networkId.
  refused(failure, message) {
    const key = failure.requestId || failure.networkId;
    const owned = failure.networkId || this.pausedUnder.has(failure.requestId);
    if (!key || !owned || !/Invalid InterceptionId/.test(message ?? '')) { this.failed.push(failure); this.onFailed(failure); }
    else if ((failure.networkId && this.delivered.has(failure.networkId)) || this.why(failure)) this.settle(key, failure);
    else this.unsettled.set(key, failure);
  }
}
