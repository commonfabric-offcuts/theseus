import { TopicCloseActions, closesTopic } from './topic-close.mjs';
import { openTopicCloseJournal } from './topic-close-storage.mjs';
import { closingTopics } from './topic-close-projection.mjs';
// Captured once before the shell records a page run; these listeners belong
// to this document. Non-browser adapters may supply their own event target.
const nativeAdd = globalThis.EventTarget?.prototype?.addEventListener;
const documents = new WeakMap();
const bindingOf = bootstrap => ({ instanceId: bootstrap.instance_id, actor: bootstrap.actor,
  authority: { authority_id: bootstrap.authority?.authority_id, authority_epoch: bootstrap.authority?.authority_epoch } });
const ownerKey = binding => JSON.stringify(binding);

export async function topicCloseUI({ doc, shell, api, bootstrap, open, current }) {
  const binding = bindingOf(bootstrap), key = ownerKey(binding), win = doc.defaultView ?? globalThis.window;
  let ui = documents.get(doc);
  if (!ui || ui.key !== key) {
    ui?.dispose?.();
    const projection = closingTopics(doc); projection.configure(binding);
    ui = { key, doc, shell, binding, projection, dismissed: new Set(), error: null, journal: null, actions: null, owner: null, visible: 20 };
    const listeners = [];
    const on = (target, type, listener) => { if (!target?.addEventListener) return; if (nativeAdd) nativeAdd.call(target, type, listener); else target.addEventListener(type, listener); listeners.push([target, type, listener]); };
    ui.dispose = () => { ui.journal?.close(); for (const [target, type, listener] of listeners) target.removeEventListener?.(type, listener); };
    documents.set(doc, ui);
    ui.render = () => {
      if (documents.get(doc) !== ui) return;
      let host = doc.getElementById('topic-close-notice');
      if (!ui.error && ![...(ui.actions?.rows.values() ?? [])].some(row => !ui.dismissed.has(row.id))) { host?.remove(); return; }
      if (!host) { host = doc.createElement('section'); host.id = 'topic-close-notice'; host.className = 'notice'; host.setAttribute('aria-label', 'Recent topic changes'); host.setAttribute('role', 'status'); doc.getElementById('main')?.prepend(host); }
      const ordered = [...(ui.actions?.rows.values() ?? [])].sort((a, b) => Number(['pending','uncertain','undo_pending'].includes(b.phase)) - Number(['pending','uncertain','undo_pending'].includes(a.phase)) || b.at - a.at);
      const nodes = [], button = (text, act) => {
        const node = doc.createElement('button'); node.type = 'button'; node.textContent = text;
        node.onclick = () => Promise.resolve().then(act).catch(error => { ui.error = error.message; ui.render(); }); return node;
      };
      if (ui.error) { const line = doc.createElement('p'); line.textContent = ui.error; nodes.push(line); }
      for (const row of ordered.slice(0, ui.visible)) {
        if (ui.dismissed.has(row.id)) continue;
        const line = doc.createElement('p'), title = row.topic.title, archive = row.envelope.args.archived === true;
        const action = archive ? 'Archive' : 'Done', currentRuntime = ui.actions.current(row);
        line.dataset.topicCloseId = row.id;
        const state = !currentRuntime ? `${action} for “${title}” belongs to an earlier runtime; its result remains unconfirmed.` :
          row.phase === 'undone' ? `Restored “${title}”.` : row.phase === 'rejected' ? `Could not ${archive ? 'archive' : 'mark done'} “${title}”.` :
          row.phase === 'undo_pending' ? `Restoring “${title}”…` : row.phase === 'committed' ? `${archive ? 'Archived' : 'Marked done'} “${title}”.` :
          row.phase === 'uncertain' ? `${action} for “${title}” is kept; confirmation is unknown.` : `${archive ? 'Archiving' : 'Marking done'} “${title}”…`;
        line.append(state, row.error ? ` ${row.error}` : '');
        if (currentRuntime && ['pending', 'uncertain', 'undo_pending'].includes(row.phase)) line.append(' ', button('Retry', () => ui.actions.drive(row.id)));
        if (currentRuntime && !row.undo && !['rejected', 'undone'].includes(row.phase)) line.append(' ', button('Undo', () => ui.actions.undo(row.id)));
        line.append(' ', button('Open topic', () => ui.owner?.open({ kind: 'topic', id: row.topic.id }, row.topic.title)));
        if (['committed', 'rejected', 'undone'].includes(row.phase)) line.append(' ', button('Dismiss', () => { ui.dismissed.add(row.id); ui.render(); }));
        nodes.push(line);
      }
      if (ordered.length > ui.visible) nodes.push(button('More saved topic changes', () => { ui.visible += 20; ui.render(); }));
      host.replaceChildren(...nodes); host.hidden = !nodes.length;
    };
    ui.loading = (async () => {
      try {
        ui.journal = await openTopicCloseJournal(binding);
        ui.actions = new TopicCloseActions({ journal: ui.journal, binding,
          send: envelope => {
            if (documents.get(doc) !== ui || !ui.owner?.current()) throw Error('The current runtime cannot confirm this action.');
            return ui.owner.api.command(envelope);
          },
          changed: row => { projection.set(row); ui.render(); },
        });
        await ui.actions.load(); ui.journal.subscribe(id => ui.actions.sync(id).catch(error => { ui.error = error.message; ui.render(); })); ui.usable = true;
      } catch (error) { ui.storageError = `Saved topic changes could not be opened on this device. ${error.message}`; }
    })();
    on(win, 'online', () => { if (documents.get(doc) === ui) ui.actions?.resume().catch(error => { ui.error = error.message; ui.render(); }); });
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'visible' && documents.get(doc) === ui) ui.actions?.load().then(() => ui.actions.resume()).catch(error => { ui.error = error.message; ui.render(); }); });
    on(win, 'pagehide', event => { if (event.isTrusted) ui.journal?.close(); });
    on(doc, 'keydown', event => {
      if (documents.get(doc) !== ui || event.defaultPrevented || event.isComposing || event.key.toLowerCase() !== 'z' ||
          !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.target.closest?.('input, textarea, [contenteditable]')) return;
      const route = shell.route();
      if (route?.kind !== 'workspace') return;
      const row = [...(ui.actions?.rows.values() ?? [])].filter(row => ui.actions.current(row) && row.workspaceId === route.id && !row.undo && !['rejected', 'undone'].includes(row.phase)).sort((a, b) => b.at - a.at)[0];
      if (row) { event.preventDefault(); ui.actions.undo(row.id).catch(error => { ui.error = error.message; ui.render(); }); }
    });
  }
  const owner = { api, open, current }; ui.owner = owner;
  await ui.loading; ui.render();
  const depart = row => {
    const route = shell.route();
    if (ui.owner !== owner || !current()) return;
    shell.drawer?.close();
    if (route?.kind !== 'topic' || route.id !== row.topic.id) return;
    // The ordinary writing/build/navigation guard fences a later move or edit.
    Promise.resolve(open({ kind: 'workspace', id: row.workspaceId }, 'Outcome')).catch(error => { ui.error = `The topic change is kept. ${error.message}`; ui.render(); });
  };
  return {
    send(topic, envelope) {
      if (!closesTopic(envelope)) return api.command(envelope);
      if (!ui.actions || !ui.usable) return Promise.reject(Error(ui.storageError ?? ui.error ?? 'The topic change could not be kept on this device.'));
      let origin = null;
      const route = shell.route();
      if (current() && route?.kind === 'topic' && route.id === topic.id) {
        const existing = [...ui.actions.rows.values()].find(row => ui.actions.current(row) && row.topic.id === topic.id && ['pending','uncertain','undo_pending'].includes(row.phase) && JSON.stringify(row.envelope.args) === JSON.stringify(envelope.args));
        origin = existing?.origin ?? crypto.randomUUID();
        const history = win.history;
        history.replaceState({ ...history.state, aimTopicClose: origin }, '', win.location.href);
      }
      return ui.actions.act(topic, envelope, depart, origin).catch(error => { ui.error = error.message; ui.render(); throw error; });
    },
    start() {
      ui.render(); if (!ui.usable) return;
      const history = win.history, route = shell.route();
      if (!ui.started) {
        ui.started = true;
        for (const row of ui.actions?.rows.values() ?? []) if (ui.actions.current(row) && row.origin &&
            history.state?.aimTopicClose === row.origin && ['pending', 'uncertain', 'undo_pending'].includes(row.phase)) depart(row);
      } else if (route?.kind === 'topic' && history.state?.aimTopicClose) {
        // A later explicit visit/back is a new choice, including after reload.
        const state = { ...history.state }; delete state.aimTopicClose; history.replaceState(state, '', win.location.href);
      }
      ui.actions?.resume().catch(error => { ui.error = error.message; ui.render(); });
    },
  };
}
