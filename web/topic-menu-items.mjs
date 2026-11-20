import { managesTopic } from './topic-state.mjs';

// Both doors use these descriptors; command and UI owners are supplied by the page.
export function topicMenuItems(topic, { actor, act }) {
  if (!topic || topic.kind === 'conversation') return [];
  const item = (key, label, glyph) => ({ key, label, glyph, act: () => act(key) });
  const manages = managesTopic(topic, actor);
  return [
    ...(topic.reader_may_say ? [item('state', topic.state === 'done' ? 'Back to Active' : 'Mark Done', topic.state === 'done' ? 'back' : 'kept')] : []),
    ...(manages ? [item('archive', topic.archived ? 'Bring back' : 'Archive', topic.archived ? 'back' : 'archive')] : []),
    item('read', 'Mark all read', 'read'),
    ...(manages ? [item('rename', 'Rename', 'pencil')] : []),
    item('settings', 'Topic settings…', 'topic'), item('copy', 'Copy Link', 'link'),
    item('up', 'Move up', 'up'), item('down', 'Move down', 'down'),
  ];
}
