// A dossier head's Unstar uses the same message.star owner as a reply's.
// Named reads are bounded; each member's current revision fences its change.
export async function unstarDossier(item, { instanceId, read, send, current = () => true }) {
  const ids = item.stack_position?.starred ?? [];
  for (let at = 0; at < ids.length; at += 100) {
    const batch = ids.slice(at, at + 100), page = await read('topic_messages', { topic_id: item.topic_id, message_ids: batch });
    if (!current()) throw Error('The page changed before the stars could be removed.');
    if (page.instance_id !== instanceId || !Array.isArray(page.items) || page.items.length !== batch.length ||
        new Set(page.items.map(member => member.id)).size !== batch.length || page.items.some(member => !batch.includes(member.id) ||
          member.topic_id !== item.topic_id || member.stack_position?.root_id !== item.id)) throw Error('The dossier changed. Open its menu again.');
    for (const member of page.items) {
      if (!current()) throw Error('The page changed before the stars could be removed.');
      if (member.acts?.starred) await send(member);
    }
  }
}
