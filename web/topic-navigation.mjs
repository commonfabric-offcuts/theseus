import { currentImages } from './upload-state.mjs';
import { paintState, paintWork } from './topic-state.mjs';

const validId = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\x00-\x1f]/.test(id);
const afterId = (id,previous) => {
  const a=[...id],b=[...previous];
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i].codePointAt(0)>b[i].codePointAt(0);
  return a.length>b.length;
};
const badRoute = () => { throw Error('This destination link is incomplete or ambiguous. Open Outcomes to choose a place.'); };
// An opening may name the message its topic answers ('from'); a topic, the
// message to open in the Reader when it opens ('message', docs/links.md).
const OPTIONAL = {opening:['from'],topic:['message']};
export function routeKey(route) {
  const fields = {root:[],topic:['id'],workspace:['id'],conversation:['id'],pipeline:['id'],item:['id','item'],create:['intent'],opening:['workspace','opening','topic']}[route?.kind];
  const optional = (OPTIONAL[route?.kind] ?? []).filter(key=>key in route);
  if (!fields || Object.keys(route).length !== fields.length + optional.length + 1 || ![...fields,...optional].every(key=>validId(route[key]))) badRoute();
  return JSON.stringify([route.kind,...fields.map(key=>route[key]),...optional.map(key=>[key,route[key]])]);
}
export function routeHref(route) {
  routeKey(route);
  const params = route.kind === 'root' ? null : route.kind === 'topic' ? {topic:route.id,...(route.message?{message:route.message}:{})} : route.kind === 'conversation' ? {conversation:route.id} :
    route.kind === 'workspace' ? {workspace:route.id} : route.kind === 'pipeline' ? {pipeline:route.id} :
    route.kind === 'item' ? {pipeline:route.id,item:route.item} : route.kind === 'create' ? {new:'outcome',intent:route.intent} :
      {workspace:route.workspace,opening:route.opening,opening_topic:route.topic,...(route.from?{opening_from:route.from}:{})};
  return params ? '?' + new URLSearchParams(params) : '/';
}
// A new opening in an outcome whose topic answers one message.
export const startFrom = (workspace, message) => ({kind:'opening',workspace,opening:crypto.randomUUID(),topic:crypto.randomUUID(),from:message});
export function parseRoute(url) {
  const p=url.searchParams, keys=[...p.keys()];
  if (new Set(keys).size !== keys.length) badRoute();
  let route;
  if (!keys.length) route={kind:'root'};
  else if (keys.length===1 && p.has('topic')) route={kind:'topic',id:p.get('topic')};
  else if (keys.length===2 && p.has('topic') && p.has('message')) route={kind:'topic',id:p.get('topic'),message:p.get('message')};
  else if (keys.length===1 && p.has('workspace')) route={kind:'workspace',id:p.get('workspace')};
  else if (keys.length===1 && p.has('conversation')) route={kind:'conversation',id:p.get('conversation')};
  // An outcome's pipeline, and one item's record in it (docs/pipeline.md).
  else if (keys.length===1 && p.has('pipeline')) route={kind:'pipeline',id:p.get('pipeline')};
  else if (keys.length===2 && p.has('pipeline') && /^[1-9][0-9]{0,8}$/.test(p.get('item') ?? '')) route={kind:'item',id:p.get('pipeline'),item:p.get('item')};
  else if (keys.length===2 && p.get('new')==='outcome' && p.has('intent')) route={kind:'create',intent:p.get('intent')};
  else if ([3,4].includes(keys.length) && ['workspace','opening','opening_topic'].every(k=>p.has(k)) && (keys.length===3 || p.has('opening_from'))) {
    route={kind:'opening',workspace:p.get('workspace'),opening:p.get('opening'),topic:p.get('opening_topic'),...(p.has('opening_from')?{from:p.get('opening_from')}:{})};
  }
  else badRoute();
  routeKey(route);return route;
}

export class WorkspacePages {
  constructor(instanceId) { this.instanceId=instanceId;this.loaded=new Map();this.next=null;this.started=false; }
  get items() { return [...this.loaded.values()]; }
  accept(answer,cursor=null) {
    if (cursor!==null && (!this.started || cursor!==this.next)) return false;
    const fail=()=>{throw Error('The outcome list could not be confirmed. Retry outcomes.');};
    if (answer?.instance_id!==this.instanceId || !Array.isArray(answer.items) ||
      !(answer.next_cursor===null || validId(answer.next_cursor))) fail();
    let previous=cursor??'';
    for(const item of answer.items) {
      if (!validId(item?.id) || !afterId(item.id,previous) || !validId(item.owner_id) || typeof item.title!=='string' ||
        new TextEncoder().encode(item.title).length>1024 || typeof item.title_truncated!=='boolean' || !Number.isInteger(item.version) || item.version<1) fail();
      previous=item.id;
    }
    if (answer.next_cursor!==null && (!answer.items.length || answer.next_cursor!==previous)) fail();
    if (cursor===null) this.loaded.clear();
    for(const item of answer.items) this.loaded.set(item.id,structuredClone(item));
    this.next=answer.next_cursor;this.started=true;return true;
  }
  empty() { return new WorkspacePages(this.instanceId); }
  last() { return [...this.loaded.keys()].pop() ?? null; }
  precedes(a,b) { return afterId(b,a); }
}

// An outcome's topics come in three lists (docs/topic-list.md): the ones that
// are neither done nor archived, the done ones and the archived ones, each
// latest activity first. A topic's place is its position, DONE:ACTIVITY_MS:ID.
export const TOPIC_LISTS = { active: {}, done: { done: true }, archived: { archived: true } };
const listOf = item => item.archived === true ? 'archived' : item.state === 'done' ? 'done' : 'active';
const doneFlag = item => item.state === 'done' ? 1 : 0;
export const topicPosition = item => `${doneFlag(item)}:${item.activity_ms}:${item.id}`;
function position(cursor) {
  const first = cursor.indexOf(':'), second = cursor.indexOf(':', first + 1);
  return [Number(cursor.slice(0, first)), Number(cursor.slice(first + 1, second)), cursor.slice(second + 1)];
}
// Negative when a comes before b in a list: the topics not done first, then
// later activity, then, at the same time, the larger id (compared as the server
// does, by code point).
function compare([doneA, activityA, idA], [doneB, activityB, idB]) {
  return doneA - doneB || activityB - activityA || (idA === idB ? 0 : afterId(idA, idB) ? -1 : 1);
}
const key = item => [doneFlag(item), Number.isSafeInteger(item.activity_ms) ? item.activity_ms : 0, item.id];

// Only workspace navigation data lives here. Existing sessions own all writing.
export class TopicPages {
  constructor(instanceId, workspaceId, current, list = 'active') {
    if (!Object.hasOwn(TOPIC_LISTS, list)) throw Error('Unknown topic list.');
    Object.assign(this, { instanceId, workspaceId, current, list });
    this.loaded = new Map(); this.next = null; this.started = false; this.groups = null;
  }
  // The open topic's row shows what the page knows of it, with the counts the
  // list read for it: the topic view itself carries no unread count. It is in
  // the list where what the page knows of it puts it, in its place there.
  get items() {
    const current = this.current, here = current && listOf(current) === this.list;
    const items = [...this.loaded.values()].filter(item => item.id !== current?.id || here)
      .map(item => item.id === current?.id ? { ...item, ...current } : item);
    if (here && !this.loaded.has(current.id)) items.push(current);
    return items.sort((a, b) => compare(key(a), key(b)));
  }
  accept(answer, cursor = null) {
    if (cursor !== null && (!this.started || cursor !== this.next)) return false;
    const fail = () => { throw Error('The topic list could not be confirmed. Retry topics.'); };
    if (answer?.instance_id !== this.instanceId || !Array.isArray(answer.items) ||
        !(answer.next_cursor === null || typeof answer.next_cursor === 'string' && answer.next_cursor)) fail();
    const groups = answer.groups;
    if (groups !== undefined && !['done', 'archived'].every(name => Number.isSafeInteger(groups?.[name]) && groups[name] >= 0)) fail();
    let previous = cursor === null ? null : position(cursor); const ids = new Set();
    for (const item of answer.items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || item.workspace_id !== this.workspaceId ||
          typeof item.title !== 'string' || !Number.isSafeInteger(item.activity_ms) || item.activity_ms < 0 || listOf(item) !== this.list ||
          previous !== null && compare(previous, key(item)) >= 0) fail();
      previous = key(item); ids.add(item.id);
    }
    if (answer.next_cursor !== null && (!answer.items.length || answer.next_cursor !== topicPosition(answer.items.at(-1)))) fail();
    if (cursor === null) this.loaded.clear();
    for (const item of answer.items) this.loaded.set(item.id, structuredClone(item));
    this.next = answer.next_cursor; this.started = true;
    if (groups !== undefined) this.groups = { done: groups.done, archived: groups.archived };
    return true;
  }
  empty() { return new TopicPages(this.instanceId, this.workspaceId, this.current, this.list); }
  last() { const item = [...this.loaded.values()].pop(); return item ? topicPosition(item) : null; }
  precedes(a, b) { return compare(position(a), position(b)) < 0; }
}

export const PAGE = 20;
// A reload reads again everything the reader has loaded, the pages More added
// included: from the start, in pages as large as the view allows, until it
// passes the last row they had. The list changes once, when all have arrived,
// so a reload never folds the list back to its first page.
export async function reread(pages, read, pageMax = PAGE) {
  const fresh = pages.empty(), last = pages.last();
  const limit = Math.min(pageMax, Math.max(PAGE, pages.loaded.size));
  let cursor = null;
  do {
    fresh.accept(await read({ limit, ...(cursor === null ? {} : { cursor }) }), cursor);
    cursor = fresh.next;
  } while (cursor !== null && last !== null && fresh.precedes(cursor, last));
  Object.assign(pages, { loaded: fresh.loaded, next: fresh.next, groups: fresh.groups ?? pages.groups, started: true });
}

export class TopicNavigation {
  // review(): the Review buttons, as registry.inDoubt answers them now
  // (docs/replies-in-doubt.md). A page that shows them passes the function
  // that draws them, so what the guard names is what the page shows.
  constructor({ registry, topicId, current = topicId ? {kind:'topic',id:topicId} : {kind:'root'}, navigate, navigateTarget, beforeLeave, review = () => registry.inDoubt }) {
    Object.assign(this, { registry, topicId, current, navigate, navigateTarget, beforeLeave, review }); this.serial = 0;
  }
  open(topicId, title = topicId) { return this.openTarget({kind:'topic',id:topicId},title); }
  async openTarget(destination, title = destination.kind) {
    const destinationKey=routeKey(destination);
    const request = ++this.serial;
    const previousChoice = this.departureChoice; this.departureChoice = null;
    if (destinationKey === routeKey(this.current)) return false;
    if(this.beforeLeave){await this.beforeLeave(destinationKey,title);if(request!==this.serial)return false;}
    const navigate = () => this.navigateTarget ? this.navigateTarget(structuredClone(destination)) :
      destination.kind==='topic' ? this.navigate(destination.id) : badRoute();
    const registry = this.registry;
    // Root/outcome browsing has no writing owners. Creation supplies its own
    // registered owners before admitting any editable surface.
    if (!registry) { navigate();return true; }
    const inline = registry.inline, current = registry.current;
    const snapshots = [...registry.sessions.values()].map(owner => ({ owner, editor: owner.editor, version: owner.editor.localVersion,
      sendIds: JSON.stringify(owner.editor.submissions.map(item => item.id)), needsSave: owner.editor.dirty }));
    const editors = snapshots.map(s => s.editor);
    const same = () => !registry.disposed && registry.inline === inline && registry.current === current &&
      registry.sessions.size === snapshots.length &&
      snapshots.every(s => registry.sessions.get(s.editor.key) === s.owner && s.owner?.editor === s.editor && s.editor.localVersion === s.version &&
        JSON.stringify(s.editor.submissions.map(item => item.id)) === s.sendIds);
    const sendGuard = () => {
      if (registry.hasInFlightSend) throw Error('Wait for the send to finish before changing topics.');
    };
    // The replies in doubt, each writing's named by its Review button's words.
    const pendingSnapshot = () => this.review().map(({ session, editor, items, unread, label }) => ({
      session, editor, label, identity: JSON.stringify([unread, ...items.map(item => [item.id, item.status ?? item.send_status, item.detached,
        item.prepareOperationId ?? item.prepare_operation_id, item.sendOperationId ?? item.send_operation_id, item.authority])]),
    }));
    const samePending = (a, b) => a.length === b.length && a.every((entry, index) =>
      entry.session === b[index].session && entry.editor === b[index].editor && entry.identity === b[index].identity);
    const imagesAttached = () => editors.every(editor => currentImages(editor).every(image =>
      image.ready_descriptor && image.association?.cycle_id === editor.clientCycleId &&
      editor.draft.attachments.some(ref => ref.id === image.association.media_id)));
    let nextChoice = null;
    try {
      sendGuard();
      if (!imagesAttached()) throw Error('Stayed here: finish, retry, or remove the selected image before changing topics.');
      const results = await Promise.allSettled(snapshots.map(s => s.needsSave ? registry.flush(s.editor) : null));
      if (request !== this.serial) return false;
      if (!same()) throw Error('Writing changed while saving. Stayed here; choose the topic again when ready.');
      for (let n = 0; n < snapshots.length; ++n) {
        const { editor, needsSave, version } = snapshots[n], result = results[n];
        if (result.status === 'rejected' || needsSave && (editor.unavailable || editor.authorityRecovery || editor.conflict ||
            editor.dirty || editor.ackVersion < version || result.value && (result.value.recorded !== true || result.value.status !== 'committed'))) {
          throw Error('Your writing is not confirmed saved to Theseus. Stayed here; check the saved-writing status and retry the topic when it is saved.');
        }
      }
      await registry.keepEditorsLocal(editors);
      if (request !== this.serial) return false;
      sendGuard();
      if (!same() || !imagesAttached() || registry.hasUnprotectedWriting) throw Error('Keep this page open until your writing and selected images are safely saved, then choose the topic again.');
      const pending = pendingSnapshot();
      if (pending.length && !(previousChoice?.destinationKey === destinationKey && previousChoice.same() && samePending(previousChoice.pending, pending))) {
        nextChoice = { destinationKey, same, pending };
        throw Error(`Not every reply here is confirmed sent; each is kept. Use ${pending.map(entry => `“${entry.label}”`).join(' or ')} to check, or choose “${title}” again to leave without resolving it.`);
      }
      navigate(); return true;
    } catch (error) {
      // Preserve through the same registry even after a refused or offline save.
      const kept = await Promise.allSettled([registry.keepEditorsLocal(editors)]);
      if (request !== this.serial) return false;
      if (kept.some(r => r.status === 'rejected')) { this.departureChoice = null; throw Error('Keep this page open: some writing or image bytes could not be saved on this device.'); }
      // Arm only as the rejection reaches the app's visible notice. A second
      // click while preservation is pending has not seen an informed choice.
      this.departureChoice = nextChoice;
      throw error;
    }
  }
}

// The topic list: the topics neither done nor archived, then a "Done (N)" line
// and an "Archived (N)" line that each open to list theirs. Whether each line
// is open is kept per person on this browser; a closed one is not read.
export class TopicRail {
  // key: the line under the topics that says what the work ring means, shown
  // while a row in view wears one.
  constructor({ pages, host, more, retry, message, read, open, denied, updated, reader = null, pageMax = PAGE, done = null, archived = null, storage = null, area = host, key = null }) {
    Object.assign(this, { pages, host, more, retry, message, read, open, isDenied: denied, updated, reader, pageMax, storage, area, key });
    this.denied = false; this.loading = null; this.queued = null; this.queuedAsked = false; this.failedMore = false; this.serial = 0;
    this.lists = [{ name: 'active', pages, host, more }];
    const kept = this.kept();
    for (const [name, parts] of [['done', done], ['archived', archived]]) {
      if (!parts) continue;
      const list = { name, pages: new TopicPages(pages.instanceId, pages.workspaceId, pages.current, name), ...parts };
      this.lists.push(list);
      list.details.open = kept[name] === true;
      list.more.onclick = () => this.load(list);
      // Opening a line reads its list, unless a read of it is under way; a
      // list read before reads again with the others. The person asked for
      // it, so it shows at once, under the pointer that opened it too.
      list.details.addEventListener('toggle', () => {
        this.keep(name, list.details.open);
        if (list.details.open && !list.reading) this.load(list.pages.started ? false : list, true);
      });
    }
    more.onclick = () => this.load(true); retry.onclick = () => this.load(this.failedMore, true);
    // The lists keep still under the pointer: a change found while it is over
    // them changes what rows say, and moves rows once it leaves. A row with
    // keyboard focus keeps it: rows move around it, and it leaves its list
    // only once focus moves on.
    this.pointed = false; this.owed = false;
    area.addEventListener('pointerenter', () => { this.pointed = true; });
    area.addEventListener('pointerleave', () => { this.pointed = false; if (this.owed) this.paint(); });
    area.addEventListener('focusin', () => { if (this.owed) this.paint(); });
    area.addEventListener('focusout', event => { if (this.owed && !area.contains(event.relatedTarget)) this.paint(); });
    // Mobile browsers can retarget a gap tap to a nearby link. Only accept a
    // synthesized click when the raw touch ended inside that link's bounds.
    for (const list of this.lists) list.host.addEventListener('touchend', event => {
      const link = event.target.closest('a[data-topic-id]'), touch = event.changedTouches?.[0];
      if (!link || !touch) return;
      const box = link.getBoundingClientRect();
      if (touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom) event.preventDefault();
    }, { passive: false });
    this.links = new Map();
    this.paint();
  }
  // Which folded lines this person keeps open, on this browser.
  get storageKey() { return `aim-next.topic-lists.${this.pages.instanceId}.${this.reader}`; }
  kept() {
    try { const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? '{}'); return value && typeof value === 'object' ? value : {}; }
    catch { return {}; }
  }
  keep(name, open) {
    try { this.storage?.setItem(this.storageKey, JSON.stringify({ ...this.kept(), [name]: open })); } catch { /* kept for this page only */ }
  }
  // How many topics the done and archived lines hold, from the latest list read.
  get groups() { return this.lists.map(list => list.pages).filter(pages => pages.groups).sort((a, b) => b.readAt - a.readAt)[0]?.groups ?? null; }
  // Whether the outcome has no topics at all, as far as the lists read say.
  get empty() {
    return this.pages.started && this.lists.every(list => list.pages.items.length === 0) && !(this.groups?.done || this.groups?.archived);
  }
  title(id) { for (const list of this.lists) { const item = list.pages.items.find(item => item.id === id); if (item) return item.title; } return id; }
  updateCurrent(topic) { for (const list of this.lists) list.pages.current = structuredClone(topic); this.paint(); }
  row(item) {
    let link = this.links.get(item.id);
    if (!link) {
      link = document.createElement('a'); link.className = 'nav-item'; link.dataset.topicId = item.id;
      link.href = '?topic=' + encodeURIComponent(item.id);
      link.onclick = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); return this.open(item.id, this.title(item.id));
      };
      this.links.set(item.id, link);
    }
    // A row drawn again with what it already shows is left alone, so the
    // pointer's hover and a click under way stay on what they were on.
    const shows = JSON.stringify([item.title, item.unread, item.addressed, item.state, item.waiting_on, item.asks, item.state_note, item.work]);
    if (drawn.get(link) !== shows) {
      drawn.set(link, shows);
      link.textContent = item.title;
      paintUnread(link, item);
      paintState(link, item, this.reader);
      paintWork(link, item, this.reader);
    }
    if (item.id === this.pages.current?.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    return link;
  }
  // asked: the person asked for this change (More, Retry, opening a line), so
  // it shows at once, under the pointer too.
  paint(asked = false) {
    // A topic two lists hold, because one was read before it moved, is shown
    // where the list read last puts it.
    const owner = new Map();
    for (const list of this.lists) for (const item of list.pages.items) {
      const held = owner.get(item.id);
      if (!held || list.pages.readAt > held.pages.readAt) owner.set(item.id, list);
    }
    const rows = this.lists.map(list => list.pages.items.filter(item => owner.get(item.id) === list).map(item => this.row(item)));
    const hold = this.pointed && !asked, focused = document.activeElement;
    this.owed = hold;
    if (!hold) {
      // The focused row stays in the list that holds it, where it is, until focus moves on.
      const kept = this.lists.find(list => [...list.host.children].includes(focused));
      this.lists.forEach((list, index) => {
        let nodes = rows[index];
        if (kept && list !== kept) nodes = nodes.filter(node => node !== focused);
        if (list === kept && !nodes.includes(focused)) {
          this.owed = true;
          nodes = [...nodes]; nodes.splice(Math.min([...list.host.children].indexOf(focused), nodes.length), 0, focused);
        }
        arrange(list.host, nodes, focused);
      });
      for (const [id, link] of this.links) if (!owner.has(id) && link !== focused) { link.remove(); this.links.delete(id); }
    }
    for (const list of this.lists) list.more.hidden = this.denied || list.pages.next === null;
    const groups = this.groups;
    for (const list of this.lists.slice(1)) {
      // A closed line keeps the rows it read before, some since moved on; once
      // the counts are known only the open topic, put here by what the page
      // knows of it, adds to them. The line never counts fewer than it holds,
      // so counts read before the open topic moved here never say "(0)".
      const items = list.pages.items, held = groups && !list.details.open ? items.filter(item => item.id === this.pages.current?.id).length : items.length;
      const count = Math.max(groups ? groups[list.name] : 0, held);
      list.details.hidden = this.denied || count === 0;
      list.label.textContent = `${list.name === 'done' ? 'Done' : 'Archived'} (${count})`;
    }
    this.host.hidden = this.denied;
    // The key shows while a row the person can see (in the topic list, or a line they opened) wears the ring.
    if (this.key) this.key.hidden = this.denied || !this.lists.some(list => (list === this.lists[0] || list.details.open) &&
      list.pages.items.some(item => owner.get(item.id) === list && item.work?.observed === true));
  }
  // A More asked for while a read runs shares it. A reload never joins a read
  // already sent: it may have been asked for after a commit that read cannot
  // show, so it runs once more after it; any number of reloads asked meanwhile
  // make that one. A reload reads every list that is open. A line just opened
  // reads its list from the start, as a reload does. Settles true when the
  // lists were read, false when they were not. more is true for the first
  // list's More, or the list whose More or line was pressed.
  load(more = false, asked = more !== false) {
    const target = more === true ? this.lists[0] : more || null, first = target !== null && !target.pages.started;
    if (this.loading) {
      if (target && !first) return this.loading;
      // The read made after it shows at once if any that wait on it was asked for.
      this.queuedAsked ||= asked;
      this.queued ??= this.loading.then(() => { const again = this.queuedAsked; this.queued = null; this.queuedAsked = false; return this.load(false, again); });
      return this.queued;
    }
    const cursor = target && !first ? target.pages.next : null;
    if (target && !first && cursor === null) return Promise.resolve(true);
    const previousIds = new Set(this.lists.flatMap(list => list.pages.items.map(item => item.id)));
    // Keep busy controls focusable; repeated activation shares this read.
    for (const control of [this.retry, ...this.lists.map(list => list.more)]) control.setAttribute('aria-disabled', 'true');
    const reading = list => args => this.read({ workspace_id: this.pages.workspaceId, ...TOPIC_LISTS[list.name], ...args });
    const read = list => (target && !first ? reading(list)({ limit: PAGE, cursor }).then(answer => { list.pages.accept(answer, cursor); })
      : reread(list.pages, reading(list), this.pageMax)).then(() => { list.pages.readAt = ++this.serial; });
    const lists = target ? [target] : this.lists.filter(list => list === this.lists[0] || list.details.open);
    for (const list of lists) list.reading = true;
    this.loading = Promise.all(lists.map(read))
      .then(() => {
        const focused = document.activeElement;
        this.denied = false;
        this.message.hidden = true; this.retry.hidden = true; this.paint(asked);
        const pressed = this.lists.find(list => list.more === focused);
        if ((pressed || focused === this.retry) && focused.hidden) {
          const links = [...(pressed ?? this.lists[0]).host.children];
          (links.find(link => !previousIds.has(link.dataset.topicId)) ?? links.find(link => link.dataset.topicId === this.pages.current?.id) ?? links[0])?.focus();
        }
        return true;
      }).catch(error => {
        const focused = document.activeElement;
        if (this.isDenied(error)) { this.denied = true; this.paint(asked); }
        this.failedMore = target && !first && !this.denied ? target : false;
        this.message.textContent = this.denied ? 'Workspace topics are unavailable. Retry to check access.' : error.message + ' Retry topics.';
        this.message.hidden = false; this.retry.hidden = false;
        if (this.lists.some(list => list.more === focused) && focused.hidden) this.retry.focus();
        return false;
      }).finally(() => {
        this.loading = null;
        for (const list of lists) list.reading = false;
        for (const control of [this.retry, ...this.lists.map(list => list.more)]) control.removeAttribute('aria-disabled');
        this.updated?.();
      });
    return this.loading;
  }
}

// Puts exactly nodes in host, in their order, moving only what is out of place,
// and never fixed: moving a node takes it out of the page for a moment, which
// takes away its focus, so the others move around it instead.
export function arrange(host, nodes, fixed = null) {
  const wanted = new Set(nodes);
  for (const child of [...host.children]) if (!wanted.has(child)) child.remove();
  nodes.forEach((node, index) => {
    if (node === fixed && [...host.children].includes(fixed)) {
      // What sits where the fixed node belongs belongs after it: send it to the end until the fixed node is in place.
      while (host.children[index] !== fixed) host.insertBefore(host.children[index], null);
    } else if (host.children[index] !== node) host.insertBefore(node, host.children[index] ?? null);
  });
}

// A count of what waits unread in a topic or outcome, marked when part of it
// was sent to the reader by name. The caller has just set the row's text, so
// the row holds no earlier count; a row without unread messages gets none.
const drawn = new WeakMap();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function paintUnread(host, item) {
  if (!(Number.isSafeInteger(item.unread) && item.unread > 0)) return;
  const addressed = Number.isSafeInteger(item.addressed) && item.addressed > 0 ? item.addressed : 0;
  paintCount(host, item.unread, addressed ? 'unread-count addressed' : 'unread-count',
    `, ${item.unread} unread` + (addressed ? `, ${addressed} sent to you by name` : ''));
}
// The revisions of a Notebook page since the reader last read it: 0 for a
// page they have not read, or have read as it now stands.
export function changedSince(item) {
  return Number.isSafeInteger(item.read_revision) && item.read_revision > 0 && Number.isSafeInteger(item.revision) &&
    item.revision > item.read_revision ? item.revision - item.read_revision : 0;
}
// A Notebook page read before and revised since wears the count of its new
// revisions as a topic wears its unread count, until the reader opens it.
export function paintChanged(host, item) {
  const since = changedSince(item);
  if (since) paintCount(host, since, 'unread-count changed', `, changed since you read it, ${since} new revision${since === 1 ? '' : 's'}`);
}
function paintCount(host, count, className, said) {
  const badge = document.createElement('span'), spoken = document.createElement('span');
  badge.className = className;
  badge.textContent = String(count); badge.setAttribute('aria-hidden', 'true');
  spoken.className = 'sr-only';
  spoken.textContent = said;
  // The title's last character (a whole grapheme) and the count never part, so a title that
  // wraps keeps its count on its last line; the rest still wraps anywhere, so
  // a long unbroken ending cannot push the row wider.
  const title = host.lastChild, words = title?.nodeType === 3 ? title.data.trimEnd() : '';
  if (!words) { host.append(badge, spoken); return; }
  const last = Array.from(graphemes.segment(words)).at(-1).segment, together = document.createElement('span');
  together.className = 'together'; title.data = words.slice(0, words.length - last.length);
  together.append(last, badge, spoken); host.append(together);
}
