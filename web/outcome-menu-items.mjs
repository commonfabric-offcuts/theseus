// The outcome title and siderail ask this one list for their menu.
export function outcomeMenuItems(workspace, { actor, act }) {
  if (!workspace) return [];
  const choice = (key, label, glyph, extra = {}) => ({ key, label, glyph, ...extra, act: () => act(key) });
  const ended = Boolean(workspace.end), owner = workspace.owner_id === actor;
  return [
    ...(!ended ? [choice('new-topic', 'New topic', 'topic')] : []),
    choice('copy', 'Copy Link', 'link'),
    ...(!workspace.provisional && !ended ? [choice('up', 'Move up', 'up', { keys: '⌘↑' }), choice('down', 'Move down', 'down', { keys: '⌘↓' })] : []),
    ...(owner ? ended ? [choice('open', 'Bring back', 'back')] : [choice('completed', 'Complete…', 'kept'), choice('archived', 'Archive…', 'archive')] : []),
    ...(owner ? [choice('onboarding', 'Onboarding prompt…', 'quote')] : []),
  ];
}
