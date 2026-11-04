import { currentImages } from './upload-state.mjs';

// Only workspace navigation data lives here. Existing sessions own all writing.
export class TopicPages {
  constructor(instanceId, workspaceId, current) {
    Object.assign(this, { instanceId, workspaceId, current });
    this.loaded = new Map(); this.next = null; this.started = false;
  }
  get items() {
    const items = [...this.loaded.values()].map(item => item.id === this.current.id ? this.current : item);
    return this.loaded.has(this.current.id) ? items : [this.current, ...items];
  }
  accept(answer, cursor = null) {
    if (cursor !== null && (!this.started || cursor !== this.next)) return false;
    const fail = () => { throw Error('The topic list could not be confirmed. Retry topics.'); };
    if (answer?.instance_id !== this.instanceId || !Array.isArray(answer.items) ||
        !(answer.next_cursor === null || typeof answer.next_cursor === 'string' && answer.next_cursor)) fail();
    let previous = cursor ?? ''; const ids = new Set();
    for (const item of answer.items) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id <= previous || ids.has(item.id) ||
          item.workspace_id !== this.workspaceId || typeof item.title !== 'string') fail();
      previous = item.id; ids.add(item.id);
    }
    if (answer.next_cursor !== null && (!answer.items.length || answer.next_cursor !== previous)) fail();
    if (cursor === null) this.loaded.clear();
    for (const item of answer.items) this.loaded.set(item.id, structuredClone(item));
    this.next = answer.next_cursor; this.started = true; return true;
  }
}

export class TopicNavigation {
  constructor({ registry, topicId, navigate }) { Object.assign(this, { registry, topicId, navigate }); this.serial = 0; }
  async open(topicId, title = topicId) {
    const request = ++this.serial;
    const previousChoice = this.departureChoice; this.departureChoice = null;
    if (topicId === this.topicId) return false;
    const registry = this.registry;
    const inline = registry.inline, current = registry.current;
    const snapshots = [...registry.sessions.values()].map(owner => ({ owner, editor: owner.editor, version: owner.editor.localVersion,
      sendIds: JSON.stringify(owner.editor.submissions.map(item => item.id)), needsSave: owner.editor.dirty }));
    const editors = snapshots.map(s => s.editor);
    const same = () => !registry.disposed && registry.inline === inline && registry.current === current &&
      registry.sessions.size === snapshots.length &&
      snapshots.every(s => registry.sessions.get(s.editor.key) === s.owner && s.owner?.editor === s.editor && s.editor.localVersion === s.version &&
        JSON.stringify(s.editor.submissions.map(item => item.id)) === s.sendIds);
    const sendGuard = () => {
      if (registry.hasInFlightSend) throw Error('Wait for the send to finish before changing topics. Open the pending reply’s Review button to Check confirmation.');
    };
    const pendingSnapshot = () => registry.unconfirmedSends.map(({ session, editor, item }) => ({
      session, editor, item, identity: JSON.stringify([item.id, item.status, item.prepareOperationId, item.sendOperationId, item.authority]),
    }));
    const samePending = (a, b) => a.length === b.length && a.every((entry, index) => {
      const other = b[index];
      return entry.session === other.session && entry.editor === other.editor && entry.item === other.item && entry.identity === other.identity;
    });
    const imagesAttached = () => editors.every(editor => currentImages(editor).every(image =>
      image.ready_descriptor && image.association?.cycle_id === editor.clientCycleId &&
      editor.draft.attachments.some(ref => ref.id === image.association.media_id)));
    let nextChoice = null;
    try {
      sendGuard();
      if (!imagesAttached()) throw Error('Stayed here: finish, retry, or remove the selected image before changing topics.');
      const results = await Promise.allSettled(snapshots.map(s => s.needsSave ? registry.flush(s.editor) : null));
      if (request !== this.serial) return false;
      if (!same()) throw Error('Writing changed while saving. Stayed here; choose the topic again when ready.');
      for (let n = 0; n < snapshots.length; ++n) {
        const { editor, needsSave, version } = snapshots[n], result = results[n];
        if (result.status === 'rejected' || needsSave && (editor.unavailable || editor.authorityRecovery || editor.conflict ||
            editor.dirty || editor.ackVersion < version || result.value && (result.value.recorded !== true || result.value.status !== 'committed'))) {
          throw Error('Your writing is not confirmed saved to Theseus. Stayed here; check the saved-writing status and retry the topic when it is saved.');
        }
      }
      await registry.keepEditorsLocal(editors);
      if (request !== this.serial) return false;
      sendGuard();
      if (!same() || !imagesAttached() || registry.hasUnprotectedWriting) throw Error('Keep this page open until your writing and selected images are safely saved, then choose the topic again.');
      const pending = pendingSnapshot();
      if (pending.length && !(previousChoice?.topicId === topicId && previousChoice.same() && samePending(previousChoice.pending, pending))) {
        nextChoice = { topicId, same, pending };
        throw Error(`A send is unconfirmed; its pending copy is kept on this device. Choose “${title}” again to leave without resolving it. Use the pending reply’s Review button to Check confirmation; after returning, use Review versions for a local copy.`);
      }
      this.navigate(topicId); return true;
    } catch (error) {
      // Preserve through the same registry even after a refused or offline save.
      const kept = await Promise.allSettled([registry.keepEditorsLocal(editors)]);
      if (request !== this.serial) return false;
      if (kept.some(r => r.status === 'rejected')) { this.departureChoice = null; throw Error('Keep this page open: some writing or image bytes could not be saved on this device.'); }
      // Arm only as the rejection reaches the app's visible notice. A second
      // click while preservation is pending has not seen an informed choice.
      this.departureChoice = nextChoice;
      throw error;
    }
  }
}

export class TopicRail {
  constructor({ pages, host, more, retry, message, read, open, denied }) {
    Object.assign(this, { pages, host, more, retry, message, read, open, isDenied: denied });
    this.denied = false; this.loading = null; this.failedMore = false;
    more.onclick = () => this.load(true); retry.onclick = () => this.load(this.failedMore);
    // Mobile browsers can retarget a gap tap to a nearby link. Only accept a
    // synthesized click when the raw touch ended inside that link's bounds.
    host.addEventListener('touchend', event => {
      const link = event.target.closest('a[data-topic-id]'), touch = event.changedTouches?.[0];
      if (!link || !touch) return;
      const box = link.getBoundingClientRect();
      if (touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom) event.preventDefault();
    }, { passive: false });
    this.paint();
  }
  updateCurrent(topic) { this.pages.current = structuredClone(topic); this.paint(); }
  paint() {
    const items = this.pages.items, ids = new Set(items.map(item => item.id));
    for (const link of [...this.host.children]) if (!ids.has(link.dataset.topicId)) link.remove();
    items.forEach((item, index) => {
      let link = [...this.host.children].find(link => link.dataset.topicId === item.id);
      if (!link) {
        link = document.createElement('a'); link.className = 'nav-item'; link.dataset.topicId = item.id;
        link.href = '?topic=' + encodeURIComponent(item.id);
        link.onclick = event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); return this.open(item.id);
        };
      }
      link.textContent = item.title;
      if (item.id === this.pages.current.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      // Moving a focused link can blur it. Leave unchanged rows in place.
      if (this.host.children[index] !== link) this.host.insertBefore(link, this.host.children[index] ?? null);
    });
    this.host.hidden = this.denied;
    this.more.hidden = this.denied || this.pages.next === null;
  }
  load(more = false) {
    if (this.loading) return this.loading;
    const cursor = more ? this.pages.next : null;
    if (more && cursor === null) return Promise.resolve();
    const previousIds = new Set(this.pages.items.map(item => item.id));
    // Keep busy controls focusable; repeated activation shares this read.
    this.more.setAttribute('aria-disabled', 'true'); this.retry.setAttribute('aria-disabled', 'true');
    this.loading = this.read({ workspace_id: this.pages.workspaceId, limit: 20, ...(cursor === null ? {} : { cursor }) })
      .then(answer => {
        const focused = document.activeElement;
        this.pages.accept(answer, cursor); this.denied = false;
        this.message.hidden = true; this.retry.hidden = true; this.paint();
        if ((focused === this.more || focused === this.retry) && focused.hidden) {
          const links = [...this.host.children];
          (links.find(link => !previousIds.has(link.dataset.topicId)) ?? links.find(link => link.dataset.topicId === this.pages.current.id))?.focus();
        }
      }).catch(error => {
        const focused = document.activeElement;
        if (this.isDenied(error)) { this.denied = true; this.host.hidden = true; this.more.hidden = true; }
        this.failedMore = more && !this.denied;
        this.message.textContent = this.denied ? 'Workspace topics are unavailable. Retry to check access.' : error.message + ' Retry topics.';
        this.message.hidden = false; this.retry.hidden = false;
        if (focused === this.more && this.more.hidden) this.retry.focus();
      }).finally(() => { this.loading = null; this.more.removeAttribute('aria-disabled'); this.retry.removeAttribute('aria-disabled'); });
    return this.loading;
  }
}
