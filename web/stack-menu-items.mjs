// One descriptor list for a loaded stack and a dossier read from the rail.
// Unknown arrangement is offered; its actual owner checks again after a choice.
export const STARRED_FOLD_REASON = 'Starred messages stay in view; unstar it to fold.';
export function stackMenuItems(s, act) {
  const choice = (key, label, glyph, args = [], extra = {}) => ({ key, label, glyph, ...extra, act: () => act(key, ...args) });
  const items = [choice('star', s.starred ? 'Unstar' : 'Star for me', s.starred ? 'starred' : 'star', [!s.starred])];
  if (s.cover) items.push({ ...s.cover, key: 'cover-refresh' });
  if (s.head) items.push(choice('rename', 'Rename', 'pencil'));
  if (s.position) items.push(choice('aside', s.below ? 'Bring back' : 'Archive', s.below ? 'back' : 'archive', [!s.below], { keys: !s.below && !s.reader ? '⌘→' : '' }));
  if (s.trash) items.push(choice('trash', 'Move to trash', 'trash'));
  if (s.folded) items.push(choice('fold', 'Unfold', 'unfold', [false]));
  else items.push(choice('fold', s.starred ? `Fold — ${STARRED_FOLD_REASON}` : 'Fold', 'fold', [true], { disabled: Boolean(s.starred) }));
  if (s.reader || !s.found) return { first: items, last: [] };
  if (s.head && s.hasReplies) items.push(choice('level', s.open ? 'Show latest and unread replies' : 'Show all messages', s.open ? 'latest' : 'all', [s.open ? 'folded' : 'open']));
  if (s.joined) items.push(choice('split', 'Split back out', 'split'));
  if (s.splitSources) items.push(choice('split-sources', 'Split back out…', 'split'));
  const moves = [choice('move-up', 'Move its stack up', 'up', ['up'], { keys: '⌘↑' }),
    choice('move-down', 'Move its stack down', 'down', ['down'], { keys: '⌘↓' }),
    ...(s.hasReplies && s.foldable ? [choice('fold-stack', 'Fold its stack', 'chevron', ['fold'], { keys: '←' })] : []),
    ...(s.hasReplies && s.openable ? [choice('open-stack', 'Open its stack', 'chevdown', ['open'], { keys: '→' })] : []),
    choice('join-up', 'Join the stack above…', 'joinup', ['up'], { keys: '⇧⌘↑' }),
    choice('join-down', 'Join the stack below…', 'joindown', ['down'], { keys: '⇧⌘↓' }),
    ...(s.placed ? [choice('reset', 'Reset position', 'unpin')] : []),
    ...(s.undo ? [choice('undo', 'Undo', 'undo', [], { keys: '⌘Z' })] : [])];
  return { first: items, last: s.phone ? [choice('moves', 'Move or join…', 'move', [moves])] : moves };
}
