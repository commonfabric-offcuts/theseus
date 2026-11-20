import { openMessageMenu, copyText } from './message-menu.mjs';
import { outcomeMenuItems } from './outcome-menu-items.mjs';
import { routeHref } from './topic-navigation.mjs';
import { dossierMenuRoute } from './menu-route.mjs';
import { RailMenuCommands } from './rail-menu-commands.mjs';

// Shared doors for rail menus. A hold owns only its subsequent synthetic click;
// moving, scrolling or lifting before the threshold leaves navigation alone.
export function menuDoor(root, locate, open, { doc = root.ownerDocument, clock = globalThis, context = true } = {}) {
  let hold = null, timer = null, suppress = null;
  const cancel = () => { if (timer !== null) clock.clearTimeout(timer); timer = null; hold = null; };
  const show = (event, row, at) => { event.preventDefault(); event.stopPropagation(); cancel(); open(row, at); };
  if (context) root.addEventListener('contextmenu', event => {
    const row = locate(event.target);
    if (!row || doc.getSelection?.()?.isCollapsed === false) return;
    if (suppress === row) { event.preventDefault(); event.stopPropagation(); return; }
    show(event, row, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
  });
  root.addEventListener('keydown', event => {
    if (!(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) || event.ctrlKey || event.altKey || event.metaKey) return;
    const row = locate(event.target); if (row) show(event, row, null);
  });
  root.addEventListener('pointerdown', event => {
    cancel(); suppress = null;
    if (event.pointerType !== 'touch' || event.isPrimary === false) return;
    const row = locate(event.target); if (!row) return;
    hold = { row, x: event.clientX, y: event.clientY };
    timer = clock.setTimeout(() => {
      const pending = hold; cancel();
      if (!pending || pending.row.isConnected === false || doc.getSelection?.()?.isCollapsed === false) return;
      suppress = pending.row; open(pending.row, { x: pending.x, y: pending.y });
    }, 500);
  });
  root.addEventListener('pointermove', event => { if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) cancel(); });
  for (const kind of ['pointerup', 'pointercancel', 'scroll']) root.addEventListener(kind, cancel, true);
  root.addEventListener('click', event => {
    if (suppress && suppress.contains(event.target)) { event.preventDefault(); event.stopPropagation(); suppress = null; }
  }, true);
  return () => { cancel(); suppress = null; };
}

export class OutlineMenus {
  constructor(outline, { show = openMessageMenu, copy = copyText } = {}) {
    Object.assign(this, { outline, show, copy }); this.serial = 0; this.commands = new RailMenuCommands();
    this.cancelDoor = menuDoor(outline.list, target => this.row(target), (row, at) => this.open(row, at));
    outline.doc.addEventListener('pointerdown', event => {
      if (this.pending && !this.pending.contains(event.target)) { ++this.serial; this.pending = null; }
    }, true);
    outline.doc.addEventListener('keydown', event => { if (this.pending && event.key === 'Escape') { ++this.serial; this.pending = null; } }, true);
  }
  row(target) {
    if (!this.outline.handles || target.closest?.('[inert], input, textarea, select, [contenteditable]')) return null;
    const row = target.closest?.('a.ol-name, a.ol-dossier[data-dossier-id]');
    return row && this.outline.list.contains(row) ? row : null;
  }
  reset() { ++this.serial; this.pending = null; this.cancelDoor(); this.menu?.close(false); this.menu = null; }
  notice(words) { this.outline.message.textContent = words; this.outline.message.hidden = false; }
  async open(row, at = null) {
    const outline = this.outline, handles = outline.handles, serial = ++this.serial;
    if (!handles || row.isConnected === false || handles.readable?.() === false) return;
    this.menu?.close(false); this.menu = null; this.pending = row;
    const workspaceId = row.dataset.workspaceId, target = row.pageTarget;
    const current = () => serial === this.serial && outline.handles === handles && handles.readable?.() !== false && row.isConnected !== false &&
      (workspaceId ? row.dataset.workspaceId === workspaceId : row.pageTarget === target);
    try {
      let items;
      if (workspaceId) {
        const answer = await handles.view('workspace', { workspace_id: workspaceId }, 'foreground');
        if (!current()) return;
        if (answer.instance_id !== handles.bootstrap.instance_id || answer.workspace?.id !== workspaceId) throw Error('The outcome could not be confirmed.');
        items = outcomeMenuItems(answer.workspace, { actor: handles.bootstrap.actor,
          act: key => this.perform(handles, () => this.outcomeAction(answer.workspace, key, row, handles)) });
      } else {
        if (target?.kind !== 'topic' || target.message !== row.dataset.dossierId) return;
        const answer = await handles.view('topic_messages', { topic_id: target.id, message_ids: [target.message] }, 'foreground');
        if (!current()) return;
        const item = answer.items?.[0];
        if (answer.instance_id !== handles.bootstrap.instance_id || answer.items?.length !== 1 || item.id !== target.message ||
            item.topic_id !== target.id || item.stack_position?.root_id !== target.message) throw Error('The dossier could not be confirmed.');
        items = handles.dossierMenu(item, row, (key, label) => this.perform(handles, () => this.dossierAction(item, key, label, row, handles)));
      }
      if (current()) this.menu = this.show({ anchor: row, at, items, label: workspaceId ? 'This outcome' : 'This message',
        sheet: true, doc: outline.doc, win: outline.doc.defaultView });
    } catch (error) { if (current()) this.notice(`The menu could not be opened: ${error.message}`); }
    finally { if (serial === this.serial) this.pending = null; }
  }
  async outcomeAction(workspace, key, row, handles) {
    if (this.outline.handles !== handles) { this.notice('The page changed. Open the menu again.'); return; }
    if (key === 'copy') {
      const link = new URL(routeHref({ kind: 'workspace', id: workspace.id }), this.outline.doc.defaultView.location.href).href;
      const copied = await this.copy(link);
      if (this.outline.handles === handles) this.notice(copied ? 'Link copied.' : `The link could not be copied here. Select it to copy it: ${link}`); return;
    }
    if (key === 'new-topic') { this.outline.outcomes.get(workspace.id)?.newTopic.click(); return; }
    if (key === 'up' || key === 'down') { this.outline.moveOutcome(workspace.id, key === 'up' ? -1 : 1); return; }
    if (key === 'onboarding') return this.outline.open({ kind: 'workspace', id: workspace.id, act: 'onboarding' }, workspace.title);
    await this.commands.end(handles, workspace, key);
    if (this.outline.handles === handles) { this.notice('Outcome updated.'); this.outline.reload(); }
  }
  async dossierAction(item, key, label, row, handles) {
    if (key === 'Copy Link') {
      const link = new URL(routeHref({ kind: 'topic', id: item.topic_id, message: item.id }), this.outline.doc.defaultView.location.href).href;
      const copied = await this.copy(link);
      if (this.outline.handles === handles) this.notice(copied ? 'Link copied.' : `The link could not be copied here. Select it to copy it: ${link}`); return;
    }
    if (handles.route?.kind === 'topic' && handles.route.id === item.topic_id && handles.dossierMenuChoice &&
        await handles.dossierMenuChoice(item.id, key, label, row) !== false) return;
    if (['star', 'fold'].includes(key)) {
      await this.commands.message(handles, item, key, label);
      if (this.outline.handles === handles) { this.notice('Saved.'); handles.menuChanged?.(); this.outline.dossiers.refresh(); } return;
    }
    if (key === 'Mark read' || key === 'Mark unread') return handles.markMenu(item, key === 'Mark unread');
    return this.outline.open({ kind: 'topic', id: item.topic_id, message: item.id, land: true, ...dossierMenuRoute(key) }, row.title);
  }
  async perform(handles, act) {
    if (this.outline.handles !== handles || handles.readable?.() === false) { this.notice('The page changed. Open the menu again.'); return; }
    try {
      if (await act() === false && this.outline.handles === handles) this.notice('The action was not performed because the destination did not open.');
    } catch (error) { if (this.outline.handles === handles) this.notice(`The action could not be performed: ${error.message}`); }
  }
}
