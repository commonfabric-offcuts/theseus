import { currentImages } from './upload-state.mjs';
import { paintState, paintWork } from './topic-state.mjs';

const validId = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\x00-\x1f]/.test(id);
const afterId = (id,previous) => {
  const a=[...id],b=[...previous];
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i].codePointAt(0)>b[i].codePointAt(0);
  return a.length>b.length;
};
const badRoute = () => { throw Error('This destination link is incomplete or ambiguous. Open Outcomes to choose a place.'); };
export function routeKey(route) {
  const fields = {root:[],topic:['id'],workspace:['id'],create:['intent'],opening:['workspace','opening','topic']}[route?.kind];
  if (!fields || Object.keys(route).length !== fields.length + 1 || !fields.every(key=>validId(route[key]))) badRoute();
  return JSON.stringify([route.kind,...fields.map(key=>route[key])]);
}
export function routeHref(route) {
  routeKey(route);
  const params = route.kind === 'root' ? null : route.kind === 'topic' ? {topic:route.id} :
    route.kind === 'workspace' ? {workspace:route.id} : route.kind === 'create' ? {new:'outcome',intent:route.intent} :
      {workspace:route.workspace,opening:route.opening,opening_topic:route.topic};
  return params ? '?' + new URLSearchParams(params) : '/';
}
export function parseRoute(url) {
  const p=url.searchParams, keys=[...p.keys()];
  if (new Set(keys).size !== keys.length) badRoute();
  let route;
  if (!keys.length) route={kind:'root'};
  else if (keys.length===1 && p.has('topic')) route={kind:'topic',id:p.get('topic')};
  else if (keys.length===1 && p.has('workspace')) route={kind:'workspace',id:p.get('workspace')};
  else if (keys.length===2 && p.get('new')==='outcome' && p.has('intent')) route={kind:'create',intent:p.get('intent')};
  else if (keys.length===3 && ['workspace','opening','opening_topic'].every(k=>p.has(k))) route={kind:'opening',workspace:p.get('workspace'),opening:p.get('opening'),topic:p.get('opening_topic')};
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
  precedes(a,b) { return afterId(b,a); }
}

// Only workspace navigation data lives here. Existing sessions own all writing.
export class TopicPages {
  constructor(instanceId, workspaceId, current) {
    Object.assign(this, { instanceId, workspaceId, current });
    this.loaded = new Map(); this.next = null; this.started = false;
  }
  // The open topic's row shows what the page knows of it, with the counts the
  // list read for it: the topic view itself carries no unread count.
  get items() {
    const items = [...this.loaded.values()].map(item => item.id === this.current?.id ? { ...item, ...this.current } : item);
    return !this.current || this.loaded.has(this.current.id) ? items : [this.current, ...items];
  }
  accept(answer, cursor = null) {
    if (cursor !== null && (!this.started || cursor !== this.next)) return false;
    const fail = () => { throw Error('The topic list could not be confirmed. Retry topics.'); };
    if (answer?.instance_id !== this.instanceId || !Array.isArray(answer.items) ||
        !(answer.next_cursor === null || typeof answer.next_cursor === 'string' && answer.next_cursor)) fail();
    let previous = cursor ?? ''; const ids = new Set();
    for (const item of answer.items) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id <= previous || ids.has(item.id) ||
          item.workspace_id !== this.workspaceId || typeof item.title !== 'string') fail();
      previous = item.id; ids.add(item.id);
    }
    if (answer.next_cursor !== null && (!answer.items.length || answer.next_cursor !== previous)) fail();
    if (cursor === null) this.loaded.clear();
    for (const item of answer.items) this.loaded.set(item.id, structuredClone(item));
    this.next = answer.next_cursor; this.started = true; return true;
  }
  empty() { return new TopicPages(this.instanceId, this.workspaceId, this.current); }
  precedes(a, b) { return a < b; }
}

export const PAGE = 20;
// A reload reads again everything the reader has loaded, the pages More added
// included: from the start, in pages as large as the view allows, until it
// passes the last row they had. The list changes once, when all have arrived,
// so a reload never folds the list back to its first page.
export async function reread(pages, read, pageMax = PAGE) {
  const fresh = pages.empty(), last = [...pages.loaded.keys()].pop() ?? null;
  const limit = Math.min(pageMax, Math.max(PAGE, pages.loaded.size));
  let cursor = null;
  do {
    fresh.accept(await read({ limit, ...(cursor === null ? {} : { cursor }) }), cursor);
    cursor = fresh.next;
  } while (cursor !== null && last !== null && fresh.precedes(cursor, last));
  Object.assign(pages, { loaded: fresh.loaded, next: fresh.next, started: true });
}

export class TopicNavigation {
  constructor({ registry, topicId, current = topicId ? {kind:'topic',id:topicId} : {kind:'root'}, navigate, navigateTarget, beforeLeave }) {
    Object.assign(this, { registry, topicId, current, navigate, navigateTarget, beforeLeave }); this.serial = 0;
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
      if (registry.hasInFlightSend) throw Error('Wait for the send to finish before changing topics. Open the pending reply’s Review button to Check confirmation.');
    };
    const pendingSnapshot = () => registry.unconfirmedSends.map(({ session, editor, item }) => ({
      session, editor, item, identity: JSON.stringify([item.id, item.status, item.prepareOperationId, item.sendOperationId, item.authority]),
    }));
    const samePending = (a, b) => a.length === b.length && a.every((entry, index) => {
      const other = b[index];
      return entry.session === other.session && entry.editor === other.editor && entry.item === other.item && entry.identity === other.identity;
    });
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
        throw Error(`A send is unconfirmed; its pending copy is kept on this device. Choose “${title}” again to leave without resolving it. Use the pending reply’s Review button to Check confirmation; after returning, use Review versions for a local copy.`);
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

export class TopicRail {
  constructor({ pages, host, more, retry, message, read, open, denied, updated, reader = null, pageMax = PAGE }) {
    Object.assign(this, { pages, host, more, retry, message, read, open, isDenied: denied, updated, reader, pageMax });
    this.denied = false; this.loading = null; this.queued = null; this.failedMore = false;
    more.onclick = () => this.load(true); retry.onclick = () => this.load(this.failedMore);
    // Mobile browsers can retarget a gap tap to a nearby link. Only accept a
    // synthesized click when the raw touch ended inside that link's bounds.
    host.addEventListener('touchend', event => {
      const link = event.target.closest('a[data-topic-id]'), touch = event.changedTouches?.[0];
      if (!link || !touch) return;
      const box = link.getBoundingClientRect();
      if (touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom) event.preventDefault();
    }, { passive: false });
    this.paint();
  }
  updateCurrent(topic) { this.pages.current = structuredClone(topic); this.paint(); }
  paint() {
    const items = this.pages.items, ids = new Set(items.map(item => item.id));
    for (const link of [...this.host.children]) if (!ids.has(link.dataset.topicId)) link.remove();
    items.forEach((item, index) => {
      let link = [...this.host.children].find(link => link.dataset.topicId === item.id);
      if (!link) {
        link = document.createElement('a'); link.className = 'nav-item'; link.dataset.topicId = item.id;
        link.href = '?topic=' + encodeURIComponent(item.id);
        link.onclick = event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); return this.open(item.id);
        };
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
      // Moving a focused link can blur it. Leave unchanged rows in place.
      if (this.host.children[index] !== link) this.host.insertBefore(link, this.host.children[index] ?? null);
    });
    this.host.hidden = this.denied;
    this.more.hidden = this.denied || this.pages.next === null;
  }
  // A More asked for while a read runs shares it. A reload never joins a read
  // already sent: it may have been asked for after a commit that read cannot
  // show, so it runs once more after it; any number of reloads asked meanwhile
  // make that one. Settles true when the list was read, false when it was not.
  load(more = false) {
    if (this.loading) {
      if (more) return this.loading;
      this.queued ??= this.loading.then(() => { this.queued = null; return this.load(); });
      return this.queued;
    }
    const cursor = more ? this.pages.next : null;
    if (more && cursor === null) return Promise.resolve(true);
    const previousIds = new Set(this.pages.items.map(item => item.id));
    // Keep busy controls focusable; repeated activation shares this read.
    this.more.setAttribute('aria-disabled', 'true'); this.retry.setAttribute('aria-disabled', 'true');
    const read = args => this.read({ workspace_id: this.pages.workspaceId, ...args });
    this.loading = (more ? read({ limit: PAGE, cursor }).then(answer => { this.pages.accept(answer, cursor); }) : reread(this.pages, read, this.pageMax))
      .then(() => {
        const focused = document.activeElement;
        this.denied = false;
        this.message.hidden = true; this.retry.hidden = true; this.paint();
        if ((focused === this.more || focused === this.retry) && focused.hidden) {
          const links = [...this.host.children];
          (links.find(link => !previousIds.has(link.dataset.topicId)) ?? links.find(link => link.dataset.topicId === this.pages.current?.id) ?? links[0])?.focus();
        }
        return true;
      }).catch(error => {
        const focused = document.activeElement;
        if (this.isDenied(error)) { this.denied = true; this.host.hidden = true; this.more.hidden = true; }
        this.failedMore = more && !this.denied;
        this.message.textContent = this.denied ? 'Workspace topics are unavailable. Retry to check access.' : error.message + ' Retry topics.';
        this.message.hidden = false; this.retry.hidden = false;
        if (focused === this.more && this.more.hidden) this.retry.focus();
        return false;
      }).finally(() => { this.loading = null; this.more.removeAttribute('aria-disabled'); this.retry.removeAttribute('aria-disabled'); this.updated?.(); });
    return this.loading;
  }
}

// A count of what waits unread in a topic or outcome, marked when part of it
// was sent to the reader by name. The caller has just set the row's text, so
// the row holds no earlier count; a row without unread messages gets none.
const drawn = new WeakMap();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function paintUnread(host, item) {
  if (!(Number.isSafeInteger(item.unread) && item.unread > 0)) return;
  const addressed = Number.isSafeInteger(item.addressed) && item.addressed > 0 ? item.addressed : 0;
  const badge = document.createElement('span'), spoken = document.createElement('span');
  badge.className = addressed ? 'unread-count addressed' : 'unread-count';
  badge.textContent = String(item.unread); badge.setAttribute('aria-hidden', 'true');
  spoken.className = 'sr-only';
  spoken.textContent = `, ${item.unread} unread` + (addressed ? `, ${addressed} sent to you by name` : '');
  // The title's last character (a whole grapheme) and the count never part, so a title that
  // wraps keeps its count on its last line; the rest still wraps anywhere, so
  // a long unbroken ending cannot push the row wider.
  const title = host.lastChild, words = title?.nodeType === 3 ? title.data.trimEnd() : '';
  if (!words) { host.append(badge, spoken); return; }
  const last = Array.from(graphemes.segment(words)).at(-1).segment, together = document.createElement('span');
  together.className = 'together'; title.data = words.slice(0, words.length - last.length);
  together.append(last, badge, spoken); host.append(together);
}
