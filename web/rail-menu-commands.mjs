import { stackActEnvelope } from './stack-feed.mjs';
import { sendEnd } from './outcome-end.mjs';
import { unstarDossier } from './dossier-unstar.mjs';

// A menu's explicit id commands. Unknown results retain the exact request for
// another explicit choice; the destination address never carries a command.
export class RailMenuCommands {
  constructor() { this.pending = new Map(); this.flights = new Map(); this.reads = new Map(); }
  retained(handles, kind, target) {
    const prefix = JSON.stringify([handles.bootstrap.instance_id, handles.bootstrap.actor, handles.bootstrap.authority, kind, target]);
    for (const [key, request] of this.pending) if (JSON.stringify(JSON.parse(key).slice(0, 5)) === prefix) return request;
    return null;
  }
  async readTopic(handles, topicId, current) {
    const target = { topic_id: topicId }, kind = 'topic.read_through';
    const key = JSON.stringify([handles.bootstrap.instance_id, handles.bootstrap.actor, handles.bootstrap.authority, topicId]);
    if (this.reads.has(key)) return this.reads.get(key);
    const task = (async () => {
      let request = this.retained(handles, kind, target);
      if (!request) {
        const answer = await handles.view('topic_messages', { topic_id: topicId, audience: 'all', direction: 'before', limit: 1 }, 'foreground');
        if (!current()) return false;
        if (answer.instance_id !== handles.bootstrap.instance_id || !Array.isArray(answer.items) || answer.items.length > 1 ||
            answer.items.some(item => item.topic_id !== topicId || !Number.isSafeInteger(item.seq) || item.seq < 0)) throw Error('The topic read boundary could not be confirmed.');
        if (!answer.items.length) return false;
        const { authority_id, authority_epoch } = handles.bootstrap.authority;
        request = { v: 1, instance_id: handles.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind, target,
          expected: { authority: { authority_id, authority_epoch } }, args: { seq: answer.items[0].seq } };
      }
      if (!current()) return false;
      await this.send(handles, request); return true;
    })();
    this.reads.set(key, task);
    try { return await task; } finally { this.reads.delete(key); }
  }
  async send(handles, envelope) {
    const key = JSON.stringify([handles.bootstrap.instance_id, handles.bootstrap.actor, handles.bootstrap.authority,
      envelope.kind, envelope.target, envelope.args]);
    if (this.flights.has(key)) return this.flights.get(key);
    const request = this.pending.get(key) ?? envelope; this.pending.set(key, request);
    const task = (async () => {
      let receipt;
      try { receipt = await handles.api.command(request); }
      catch { throw Error('Whether the action was saved is unknown. Choose it again to retry the same request.'); }
      if (receipt?.recorded === true || receipt?.status === 'committed') this.pending.delete(key);
      if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'The action was not confirmed. Choose it again to retry the same request.');
      return receipt;
    })();
    this.flights.set(key, task);
    try { return await task; } finally { this.flights.delete(key); }
  }
  end(handles, workspace, state) {
    const { authority_id, authority_epoch } = handles.bootstrap.authority;
    return sendEnd((kind, target, args, expected) => this.send(handles, {
      v: 1, instance_id: handles.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind, target, args,
      expected: { ...expected, authority: { authority_id, authority_epoch } },
    }), workspace.id, state, workspace.version);
  }
  message(handles, item, key, label) {
    if (key === 'star' && label === 'Unstar' && item.stack_position?.starred?.length) return unstarDossier(item, {
      instanceId: handles.bootstrap.instance_id, read: (name, args) => handles.view(name, args, 'foreground'),
      current: () => handles.current?.() !== false && handles.readable?.() !== false,
      send: member => this.send(handles, stackActEnvelope({ instanceId: handles.bootstrap.instance_id,
        authority: handles.bootstrap.authority, kind: 'message.star', item: member, args: { starred: false } })),
    });
    let kind, args;
    if (key === 'star') { kind = 'message.star'; args = { starred: label !== 'Unstar' }; }
    else if (key === 'fold') { kind = 'message.fold'; args = { folded: label !== 'Unfold' }; }
    else return false;
    const sent = this.send(handles, stackActEnvelope({ instanceId: handles.bootstrap.instance_id,
      authority: handles.bootstrap.authority, kind, item, args }));
    if (key === 'star' && args.starred && item.acts?.folded) return sent.then(() => {
      if (handles.current?.() === false || handles.readable?.() === false) throw Error('The star was saved, but the page changed before the message could be unfolded.');
      return this.message(handles, item, 'fold', 'Unfold');
    });
    return sent;
  }
}
