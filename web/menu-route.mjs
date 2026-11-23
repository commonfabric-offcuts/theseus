// Addresses may open UI, never execute a record-changing menu command.
export const UI_MENU_KEYS = new Set(['Move to topic…', 'Edit', 'Start a topic from this', 'Add to pipeline', 'Start a new dossier']);
export const dossierMenuRoute = key => key === 'rename' ? { act: 'rename' } : { act: UI_MENU_KEYS.has(key) ? 'ui' : 'menu', choice: key };
export function menuRouteValid(route) {
  if (!route.act) return !route.choice;
  if (route.act === 'topic-rename' || route.act === 'topic-settings') return route.kind === 'topic' && !route.message && !route.page && !route.at && !route.land && !route.choice;
  if (route.act === 'onboarding') return route.kind === 'workspace' && !route.page && !route.choice;
  if (route.kind !== 'topic' || !route.message || route.land !== true) return false;
  return route.act === 'rename' && !route.choice || route.act === 'ui' && UI_MENU_KEYS.has(route.choice) || route.act === 'menu' && typeof route.choice === 'string' && route.choice.length > 0 && route.choice.length <= 200;
}
export function menuRouteHash(route) {
  return route.act ? '#' + new URLSearchParams({ act: route.act, ...(route.choice ? { choice: route.choice } : {}) }) : '';
}
export function menuRouteRead(url) {
  const params = new URLSearchParams(url.hash.slice(1));
  if (!params.has('act')) return {};
  if ([...params.keys()].some(key => !['act', 'choice'].includes(key)) || params.getAll('act').length !== 1 || params.getAll('choice').length > 1) return { act: 'invalid' };
  return { act: params.get('act'), ...(params.has('choice') ? { choice: params.get('choice') } : {}) };
}
// Consume before opening any UI. A reload or Back to this entry cannot repeat it.
export function consumeMenuRoute(route, win = window) {
  const url = new URL(win.location.href), current = menuRouteRead(url);
  if (!route.act || current.act !== route.act || current.choice !== route.choice) return false;
  url.hash = ''; win.history.replaceState(win.history.state, '', url.href);
  return true;
}
