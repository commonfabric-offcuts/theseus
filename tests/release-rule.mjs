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
export class ReleaseRule {
  constructor({ failed = () => {} } = {}) {
    Object.assign(this, { onFailed: failed, excused: [], failed: [], unsettled: new Map() });
    this.cancelled = new Set(); this.delivered = new Set(); this.loaders = new Map(); this.replaced = new Set();
    this.documentLoader = null;
  }

  // Why the page gave this request up, or null while it has not.
  abandoned(id) {
    if (this.delivered.has(id)) return null;
    if (this.cancelled.has(id)) return 'cancelled';
    return this.replaced.has(this.loaders.get(id)) ? 'document replaced' : null;
  }

  settle(id, failure, reason = this.abandoned(id)) {
    this.unsettled.delete(id);
    if (reason) this.excused.push({ ...failure, reason });
    else { this.failed.push(failure); this.onFailed(failure); }
  }

  // Every CDP event of the page's session.
  observe({ method, params }) {
    if (method === 'Network.requestWillBeSent' && params.loaderId) this.loaders.set(params.requestId, params.loaderId);
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      if (this.documentLoader !== null && this.documentLoader !== params.frame.loaderId) this.replaced.add(this.documentLoader);
      this.documentLoader = params.frame.loaderId;
      for (const [id, failure] of this.unsettled) if (this.abandoned(id)) this.settle(id, failure);
    }
    if (['Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'].includes(method)) {
      const id = params.requestId;
      if (method === 'Network.loadingFailed' && params.canceled === true) this.cancelled.add(id); else this.delivered.add(id);
      const failure = this.unsettled.get(id);
      if (failure) this.settle(id, failure);
    }
  }

  // A release of a paused request failed with `message`.
  refused(failure, message) {
    const id = failure.networkId;
    if (!id || !/Invalid InterceptionId/.test(message ?? '')) { this.failed.push(failure); this.onFailed(failure); }
    else if (this.delivered.has(id) || this.abandoned(id)) this.settle(id, failure);
    else this.unsettled.set(id, failure);
  }
}
