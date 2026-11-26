import { consumeMenuRoute } from './menu-route.mjs';
import { routeKey } from './topic-navigation.mjs';

// A confirmed rail creation asks for writing through an ordinary UI fragment,
// so a new web build may load the topic too. The page admits it only after the
// real topic and inline owner are ready; a later choice keeps its own focus.
export function writeTopicOnArrival({ route, topic, registry, shell, field, current, win = window }) {
  if (route.kind !== 'topic' || route.act !== 'topic-write' || !current() || shell.owed || shell.queuedBeforeReady) return false;
  const presentation = registry?.inline, editor = presentation?.editors?.reply;
  if (!editor || topic?.id !== route.id || presentation?.topic?.id !== route.id || !registry.isCurrent(presentation) ||
      !presentation.destinationAvailable || presentation.availabilityUnconfirmed || editor?.unavailable) return false;
  const here = shell.route();
  if (!here || routeKey(here) !== routeKey(route) || !consumeMenuRoute(route, win)) return false;
  shell.drawer?.close();
  field.focus();
  return true;
}
