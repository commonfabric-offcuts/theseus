// Item 467: an explicit choice belongs to this reader in this tab's session.
// sessionStorage alone can be copied into a new window by its opener. A
// nonce in the browsing context's name keeps that copied storage from turning
// coordination on in the new tab. The name retains any existing prefix; only
// an explicit flip allocates a nonce or writes this module's own storage key.
const MARK = ';theseus-coordination-tab=';
const tokenOf = view => String(view?.name ?? '').split(MARK)[1] || null;
export class CoordinationChoice {
  constructor({ instanceId, viewer, view = globalThis.window }) {
    Object.assign(this, { instanceId, viewer, view });
    this.on = false;
    try { this.on = Boolean(tokenOf(view)) && view.sessionStorage.getItem(this.key()) === 'true'; } catch { /* Off if this tab cannot read its choice. */ }
  }
  key() { return JSON.stringify(['theseus-coordination', this.instanceId, this.viewer, tokenOf(this.view)]); }
  set(on) {
    this.on = Boolean(on);
    try {
      if (!tokenOf(this.view)) this.view.name = String(this.view.name ?? '') + MARK + this.view.crypto.randomUUID();
      this.view.sessionStorage.setItem(this.key(), String(this.on));
    } catch {
      // Keep the explicit choice for this visit; a reload starts Off rather
      // than restoring an older value after a failed save.
      try { this.view.sessionStorage.removeItem(this.key()); } catch { /* unavailable */ }
    }
  }
}
