// Only the four allocated engine/surface shards extend the existing literal filters.
export function pencilPartition(filter) {
  const match = /^item 673 shard (chromium|webkit) (topic|conversation)$/.exec(filter);
  if ((filter === 'item 673 shard' || filter.startsWith('item 673 shard ')) && !match) throw Error('Invalid item 673 shard selector');
  return match ? { engine: match[1], surface: match[2], selector: filter } : null;
}
export function selectedNativeCase(filter, engine, name, full) {
  const part = pencilPartition(filter);
  return part ? engine === part.engine && name.startsWith(`item 673 ${part.surface} `)
    : !filter || filter.split('|').some(piece => full.includes(piece));
}
export function pencilMutantsEnabled(filter) { return filter === 'item 673' || Boolean(pencilPartition(filter)); }
