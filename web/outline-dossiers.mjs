// The reader's starred dossiers under loaded topic rows (715). Each topic is
// read in bounded star pages; the existing guard owns every navigation.
import { messagePreview } from './message-preview.mjs';
import { routeHref, paintUnread, landsOnUnread, UNREAD_TIP } from './topic-navigation.mjs';
import { bindingOf, checkedView, readFailure } from './freshness.mjs';
import { paintRemoval } from './message-removal.mjs';
import { answeredSince, attemptOf, heard, sessionRefused, unreached } from './api.mjs';

const PAGE = 50;
export const dossierTitle = item => item.name || messagePreview({ ...item, preview: true }) || 'Untitled dossier';
export function dossierRows(stars) {
  const seen = new Set();
  return stars.filter(star => {
    const id = star.dossier.id;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
}
const plain = e => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export class OutlineDossiers {
  constructor(outline, {pages = false} = {}) {
    this.pageStars = pages;
    this.outline = outline; this.states = new Map(); this.epoch = 0;
    this.observer = new outline.doc.defaultView.MutationObserver(records => {
      // Painting these children cannot change which topic parents are drawn.
      // Their own mutation echo used to synchronously read every parent again.
      if (records.some(record => !record.target.closest?.('.ol-dossiers'))) this.sync();
    });
    this.observer.observe(outline.list, {childList:true, subtree:true, attributes:true, attributeFilter:['hidden','inert','open']});
    const rail = outline.host.closest('.rail');
    if (rail) this.observer.observe(rail, {attributes:true, attributeFilter:['class']});
  }
  begin() {
    this.clearRecoveries();
    this.epoch++;
    // Retire reads, retaining drawn stars and their links through a move.
    // The next run refreshes them; a late old reply cannot publish or clear it.
    for (const state of this.states.values()) {
      state.busy = null; state.again = false; state.box.setAttribute('aria-busy','false');
    }
  }
  reset() {
    this.clearRecoveries();
    this.epoch++;
    for (const state of this.states.values()) state.box.remove();
    this.states.clear();
  }
  clearRecoveries() {
    this.recoveries?.clear(); this.unhear?.(); this.unhear = null;
  }
  cancelRecovery(state) {
    this.recoveries?.delete(state);
    if (!this.recoveries?.size) { this.unhear?.(); this.unhear = null; }
  }
  waitForContact(state, error, more, current, token) {
    if (!unreached(error) || !['retry', 'reconnect'].includes(readFailure(error).kind)) return;
    this.recoveries ??= new Map();
    this.recoveries.set(state, { error, more, current, token });
    this.unhear ??= heard(() => this.recoverAfterContact());
    this.recoverAfterContact();
  }
  recoverAfterContact() {
    if (this.recoveryScheduled) return;
    this.recoveryScheduled = true;
    // Coalesce contact bursts and let a read's finally release its busy owner.
    Promise.resolve().then(() => {
      this.recoveryScheduled = false;
      for (const [state, pending] of this.recoveries ?? []) {
        if (!pending.current()) { this.cancelRecovery(state); continue; }
        if (!answeredSince(pending.error)) continue;
        // Renewal validates the instance/person before replacing the active
        // token. An answer elsewhere cannot validate a refused old session.
        if (sessionRefused(attemptOf(pending.error)) && this.outline.handles.api?.token === pending.token) continue;
        this.cancelRecovery(state);
        this.load(state, pending.more, pending.current);
      }
    });
  }
  parents() {
    const parents=[...this.outline.list.querySelectorAll('a[data-topic-id]')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
    return [...new Map(parents.map(parent => [parent.dataset.topicId, parent])).values()];
  }
  sync() {
    if (!this.outline.handles) return;
    const parents = this.parents(), ids = new Set(parents.map(el => el.dataset.topicId));
    for (const [id, state] of this.states) {
      if (!ids.has(id)) { state.box.remove(); state.visible = false; continue; }
    }
    for (const parent of parents) {
      const id = parent.dataset.topicId;
      let state = this.states.get(id);
      if (!state) {
        const box = this.outline.doc.createElement('div');
        box.className = 'ol-dossiers' + (this.pageStars?' ol-pages':''); box.dataset.parentTopicId = id;
        state = {id, parent, box, stars:[], next:null, extent:null, links:new Map(), loaded:false, busy:null, error:null};
        this.states.set(id, state);
      }
      const returned = state.visible === false;
      state.visible = true; state.parent = parent;
      // TopicRail retains its own ordering and rows. Restore this topic's
      // children after its row if that list has just drawn again.
      const after=this.pageStars&&parent.nextElementSibling?.matches('.ol-dossiers:not(.ol-pages)')?parent.nextElementSibling:parent;
      if (after.nextElementSibling !== state.box) after.after(state.box);
      if (returned || !state.loaded && !state.busy && !state.error) this.load(state);
    }
    return parents;
  }
  refresh(alreadyReading = null, topicIds = null) {
    const parents = this.sync() ?? [];
    return Promise.all(parents.filter(parent => !topicIds || topicIds.has(parent.dataset.topicId)).map(parent => {
      const state = this.states.get(parent.dataset.topicId);
      // A sync read begun during this refresh window is already fresh enough.
      // One that predates the window may have missed its change and must queue.
      return state?.busy && alreadyReading && !alreadyReading.has(state.busy) ? state.busy : this.load(state);
    }));
  }
  async load(state, more = false, recovering = null) {
    if (!state || !this.outline.handles) return true;
    if (state.busy) {
      if (!more) state.again = true;
      return state.busy;
    }
    if (more && state.next === null) return true;
    this.cancelRecovery(state);
    const epoch = this.epoch, handles = this.outline.handles;
    const binding = JSON.stringify(bindingOf(handles.bootstrap)), token = handles.api?.token;
    const owned = () => epoch === this.epoch && handles === this.outline.handles &&
      binding === JSON.stringify(bindingOf(handles.bootstrap));
    const mine = () => owned() && (!recovering || recovering());
    const recoveryCurrent = () => owned() && this.states?.get(state.id) === state && state.visible !== false &&
      state.box.isConnected !== false && state.parent?.isConnected !== false &&
      state.parent?.getClientRects?.().length !== 0 &&
      this.outline.doc?.visibilityState !== 'hidden' && handles.topicReadAllowed?.() !== false;
    state.box.setAttribute('aria-busy','true');
    // Defer the read to a microtask so busy is set before sync can run again.
    state.busy = Promise.resolve().then(async () => {
      let accepted = false;
      try {
        let cursor = more ? state.next : null, stars = more ? [...state.stars] : [], next;
        do {
          const answer = checkedView(await this.outline.read(this.pageStars?'memory_stars':'stars', {topic_id:state.id, limit:PAGE, ...(cursor === null ? {} : {cursor})}, 'foreground'), handles.bootstrap.instance_id);
          if (!mine()) return true;
          if (!Array.isArray(answer.items) || answer.items.some(s => s.topic_id !== state.id || (this.pageStars?!s.item_id:!s.dossier?.id)) ||
              !(answer.next_cursor === null || Number.isSafeInteger(answer.next_cursor) && (cursor === null || answer.next_cursor < cursor))) throw Error('The starred dossiers could not be confirmed.');
          stars.push(...answer.items); next = answer.next_cursor; cursor = next;
        } while (!more && next !== null && state.extent !== null && next > state.extent);
        if (!mine()) return true;
        state.stars = stars; state.next = next;
        state.extent = stars.at(-1)?.star ?? null;
        state.loaded = true; state.error = null;
        this.paint(state); accepted = true;
      } catch(error) {
        if (!mine()) return true;
        state.error = readFailure(error);
        if (state.error.kind === 'forbidden' || state.error.kind === 'reconnect') state.stars = [];
        this.paint(state);
        this.waitForContact(state, error, more, recoveryCurrent, token);
      } finally {
        if (mine()) {
          state.busy = null; state.box.setAttribute('aria-busy','false');
        }
      }
      // The waiting refresh must include this newer read's result. Otherwise
      // its change cursor could advance while a stale answer is still shown.
      if (mine() && state.again) {
        state.again = false;
        if (state.visible !== false) return this.load(state);
      }
      return accepted;
    });
    return state.busy;
  }
  paint(state) {
    const doc = this.outline.doc, nodes = [], alive = new Set();
    const focusedRetry = state.box.querySelector?.('[data-retry]') === doc.activeElement;
    for (const star of this.pageStars?state.stars:dossierRows(state.stars)) {
      const item = star.dossier, id = this.pageStars?star.item_id:item.id, title = this.pageStars?(star.title||'Notebook page'):dossierTitle(item);
      const target=this.pageStars?{kind:star.owner_scope?.kind??'topic',id:star.owner_scope?.id??state.id,page:id}:{kind:'topic',id:state.id,message:id,land:true};
      let link = state.links.get(id);
      if (!link) {
        link = doc.createElement('a'); link.className = 'ol-dossier'; if(this.pageStars){link.classList.add('ol-page');link.dataset.pageId=id;}else link.dataset.dossierId = id; link.tabIndex = -1;
        link.onclick = event => {
          if (!plain(event)) return;
          event.preventDefault();
          this.outline.open(landsOnUnread(event.target, event) && link.unreadTarget ? link.unreadTarget : link.pageTarget, link.title);
        };
        state.links.set(id, link);
      }
      link.pageTarget=target;
      if(this.pageStars)link.notebookScope=star.owner_scope??{kind:'topic',id:state.id};
      let words = link.querySelector('.ol-dossier-words');
      if (!words) {
        words = doc.createElement('span'); words.className = 'ol-dossier-words';
        link.replaceChildren('★ ', words);
      }
      words.replaceChildren(title);
      link.unreadTarget = null;
      let counted = '';
      if (!this.pageStars) {
        const badge = paintUnread(words, item);
        if (badge) {
          counted = `, ${item.unread} unread`;
          if (item.oldest_unread?.id) {
            badge.dataset.lands = 'unread'; badge.title = UNREAD_TIP;
            link.unreadTarget = {...target, message:item.oldest_unread.id};
            counted += '. Return shows the oldest unread message';
          }
        }
      }
      words.classList.toggle('retracted-words', item?.removal?.kind === 'retracted');
      paintRemoval(link, item, doc);
      link.title = title; link.setAttribute('aria-label', (this.pageStars?'Starred page: ':'Starred dossier: ') + title + counted);
      link.href = routeHref(target);
      alive.add(id); nodes.push(link);
    }
    for (const [id, link] of state.links) if (!alive.has(id)) {
      if (link === doc.activeElement) state.parent.focus();
      state.links.delete(id);
    }
    const noun=this.pageStars?'pages':'dossiers';
    if (state.error) {
      const notice = doc.createElement('span'); notice.className='muted'; notice.setAttribute('role','status');
      notice.textContent = state.error.kind === 'forbidden' ? `Starred ${noun} are unavailable.` : `Starred ${noun} could not be read.`;
      const retry = state.box.querySelector?.('[data-retry]') ?? doc.createElement('button'); retry.type='button'; retry.textContent='Retry starred '+noun; retry.dataset.retry=''; retry.tabIndex=-1;
      retry.onclick=()=>this.load(state); nodes.push(notice,retry);
    } else if (state.next !== null) {
      const more = doc.createElement('button'); more.type='button'; more.textContent='More starred '+noun; more.tabIndex=-1;
      more.onclick=()=>this.load(state,true); nodes.push(more);
    }
    // Keep each title's element (and its native focus) while its words change.
    if (focusedRetry && !state.error) state.parent?.focus();
    for (let i=0;i<nodes.length;i++) if(state.box.children[i]!==nodes[i]) state.box.insertBefore(nodes[i],state.box.children[i]??null);
    for (const node of [...state.box.children]) if(!nodes.includes(node)) node.remove();
    state.box.dataset.loaded = String(state.loaded);
  }
}
