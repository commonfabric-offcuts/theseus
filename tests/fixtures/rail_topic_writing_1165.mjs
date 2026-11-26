import { miniDocument } from './mini_dom.mjs';

// Setup only: no node:test, assertions, Core records or semantic body imports.
// Both the modeled tests and the once-only live-source setup driver use this.
export function railTopicWritingFixture({ OutlineRail, Shell, InlineComposer, TopicNavigation, routeHref }, { answer = null, arrival = () => false, beforeLeave = null } = {}) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const el = make(tag); el.ownerDocument = doc; el.style = {};
    el.after = node => el.parent.insertBefore(node, el.parent.children[el.parent.children.indexOf(el) + 1] ?? null);
    el.before = node => el.parent.insertBefore(node, el);
    el.click = () => el.onclick?.({ button: 0 });
    el.getBoundingClientRect = () => ({ height: 0 });
    el.setSelectionRange = (start, end) => { el.selection = [start, end]; };
    return el;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.defaultView = { getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px' }) };
  doc.getElementById = id => doc.body.querySelector('#' + id);
  const win = { location: { href: 'http://1165.invalid/?topic=old' }, history: {
    state: null, replaceState(state, title, href) { this.state = state; win.location.href = new URL(href, win.location.href).href; },
  } };
  globalThis.document = doc; globalThis.window = win;
  const host = doc.createElement('aside'), row = doc.createElement('div'), newTopic = doc.createElement('button');
  row.append(newTopic); host.append(row); doc.body.append(host);
  const field = doc.createElement('textarea'), root = doc.createElement('div'), sheet = doc.createElement('dialog'), newMessage = doc.createElement('button');
  root.append(field); sheet.append(root); sheet.id = 'new-message-sheet'; sheet.open = false;
  sheet.showModal = () => { sheet.open = true; };
  newMessage.id = 'new-message'; doc.body.append(newMessage, sheet);
  const inline = Object.assign(Object.create(InlineComposer.prototype), { root, field, sheet, callbacks: {}, kind: 'message', bar: { fit() {} }, defaultKind: () => 'message' });
  newMessage.onclick = () => inline.pop();
  const shell = new Shell({ doc, win, build: null, reads: { depart() {}, stay() {} } });
  shell.drawer = { close() {} };
  const bootstrap = { instance_id: '1165-modeled', actor: 'reader', authority: { authority_id: 'fixture', authority_epoch: 'one' } };
  const commands = [], opened = [], arrivals = [];
  let navigationChoice = 0;
  const api = { command: async request => {
    commands.push(structuredClone(request));
    if (answer) return answer(request, commands.length);
    return receipt(request, request.kind === 'opening.save' ? { opening_revision: 1 } : { topic: { id: 'made' } });
  } };
  const presentation = { surface: 'inline', initialized: true, topic: { id: 'made' }, destinationAvailable: true, editors: { reply: { unavailable: false } } };
  const registry = { inline: presentation, isCurrent: p => p === registry.inline };
  const navigation = new TopicNavigation({ current: { kind: 'topic', id: 'old' }, beforeLeave,
    navigateTarget: route => {
      opened.push(structuredClone(route));
      win.location.href = new URL(routeHref(route), win.location.href).href;
      arrivals.push(arrival({ route, topic: { id: route.id }, registry, shell, field, current: () => true, win }));
    } });
  const rail = Object.assign(Object.create(OutlineRail.prototype), { doc, run: 1,
    handles: { api, bootstrap, navigationCurrent: () => { const choice = navigationChoice; return () => choice === navigationChoice; } },
    open: (route, title) => { navigationChoice++; return navigation.openTarget(route, title); } });
  const outcome = { id: 'outcome', item: { title: 'Fixture outcome' }, row, newTopic };
  rail.topicLine(outcome);
  const input = () => host.querySelector('input');
  const press = key => input().listeners.keydown({ key, preventDefault() {}, stopPropagation() {} });
  return { doc, win, rail, outcome, input, press, commands, opened, arrivals, shell, inline, field, sheet, registry, presentation,
    openLine() { newTopic.onclick(); return input(); },
    choose(route) { navigationChoice++; return navigation.openTarget(route, 'Later choice'); },
    restore() { globalThis.document = previousDocument; globalThis.window = previousWindow; },
  };
}

export const receipt = (request, result) => ({ instance_id: request.instance_id, operation_id: request.operation_id,
  kind: request.kind, recorded: true, status: 'committed', result });
export const refused = (request, code = 'FORBIDDEN') => ({ instance_id: request.instance_id, operation_id: request.operation_id,
  kind: request.kind, recorded: true, status: 'rejected', error: { code, message: 'Creation was refused.' } });
