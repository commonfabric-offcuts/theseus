// Item 467: an explicit choice belongs to this reader in this tab's session.
// A fresh session starts Off. A duplicated tab inherits the same session's
// choice (Warp11470). Only an explicit flip writes this module's own key.
export class CoordinationChoice {
  constructor({ instanceId, viewer, view = globalThis.window }) {
    Object.assign(this, { instanceId, viewer, view });
    this.on = false;
    try { this.on = view.sessionStorage.getItem(this.key()) === 'true'; } catch { /* Off if this tab cannot read its choice. */ }
  }
  key() { return JSON.stringify(['theseus-coordination', this.instanceId, this.viewer]); }
  set(on) {
    this.on = Boolean(on);
    try {
      this.view.sessionStorage.setItem(this.key(), String(this.on));
    } catch {
      // Keep the explicit choice for this visit; a reload starts Off rather
      // than restoring an older value after a failed save.
      try { this.view.sessionStorage.removeItem(this.key()); } catch { /* unavailable */ }
    }
  }
}
