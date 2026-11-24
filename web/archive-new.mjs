// Archive's confirmed reading follows the existing message, mark and visit
// owners. Capture only this page's observed members; Core settles the whole
// visible dossier. A later arrival, edit, mark or page run keeps its own state.
export function archiveReadConfirmed(receipt, envelope, topicId = null) {
  const result = receipt?.result, cleared = result?.cleared_new;
  return receipt?.status === 'committed' && receipt.recorded === true && receipt.operation_id === envelope.operation_id &&
    result?.message_id === envelope.target.message_id && (!topicId || result.topic_id === topicId) &&
    result.through === envelope.args.through && cleared?.through === envelope.args.through &&
    Number.isSafeInteger(cleared.deliveries) && cleared.deliveries >= 0 && Number.isSafeInteger(cleared.marks) && cleared.marks >= 0;
}

export function captureArchivedNew({ root, through, messages, viewer, marks, visit, revisionOf, current, changed }) {
  const memberOf = item => item?.stack_position?.root_id ?? item?.id;
  const captured = [...messages().values()]
    .filter(item => memberOf(item) === root && item.author_id !== viewer &&
      Number.isSafeInteger(item.seq) && item.seq <= through)
    .map(item => ({ id: item.id, seq: item.seq, revision: revisionOf(item), mark: marks?.capture(item.id) ?? null }));
  let applied = false;
  return () => {
    if (applied) return false;
    applied = true;
    if (!current()) return false;
    let did = false, marked = false;
    for (const before of captured) {
      const item = messages().get(before.id);
      if (!item || memberOf(item) !== root || item.seq !== before.seq || revisionOf(item) !== before.revision) continue;
      if (item.unread === true) { item.unread = false; did = true; }
      if (visit?.clear(item.id)) did = true;
      // Core cleared marks existing in its transaction. Only advance the
      // captured revision here: a later known odd revision must survive.
      if (before.mark) marked = marks.learn(item.id, before.mark.revision + 1,
        { topicId: item.topic_id, seq: item.seq }, true) || marked;
    }
    if (marked) marks.emit();
    if (did || marked) changed();
    return did || marked;
  };
}
