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
  async open(topicId) {
    if (topicId === this.topicId) return false;
    const request = ++this.serial, registry = this.registry;
    const inline = registry.inline, current = registry.current;
    const presentations = [...new Set([inline, current].filter(Boolean))];
    const editors = [...new Set(presentations.flatMap(p => Object.values(p.editors)))];
    const snapshots = editors.map(editor => ({ editor, version: editor.localVersion, owner: registry.sessions.get(editor.key), needsSave: editor.dirty }));
    const same = () => !registry.disposed && registry.inline === inline && registry.current === current &&
      snapshots.every(s => registry.sessions.get(s.editor.key) === s.owner && s.owner?.editor === s.editor && s.editor.localVersion === s.version);
    try {
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
      await Promise.all(presentations.map(p => registry.keepLocal(p)));
      if (request !== this.serial) return false;
      if (!same() || registry.hasUnprotectedWriting) throw Error('Keep this page open until your writing and selected images are safely saved, then choose the topic again.');
      this.navigate(topicId); return true;
    } catch (error) {
      // Preserve through the same registry even after a refused or offline save.
      const kept = await Promise.allSettled(presentations.map(p => registry.keepLocal(p)));
      if (request !== this.serial) return false;
      if (kept.some(r => r.status === 'rejected')) throw Error('Keep this page open: some writing or image bytes could not be saved on this device.');
      throw error;
    }
  }
}
