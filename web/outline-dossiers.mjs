// The reader's starred dossiers under loaded topic rows (715). Each topic is
// read in bounded star pages; the existing guard owns every navigation.
import { messagePreview } from './message-preview.mjs';
import { routeHref } from './topic-navigation.mjs';
import { checkedView, readFailure } from './freshness.mjs';

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
  constructor(outline) {
    this.outline = outline; this.states = new Map(); this.epoch = 0;
    this.observer = new outline.doc.defaultView.MutationObserver(() => this.sync());
    this.observer.observe(outline.list, {childList:true, subtree:true, attributes:true, attributeFilter:['hidden','inert','open']});
    const rail = outline.host.closest('.rail');
    if (rail) this.observer.observe(rail, {attributes:true, attributeFilter:['class']});
  }
  begin() {
    this.epoch++;
    for (const state of this.states.values()) state.box.remove();
    this.states.clear();
  }
  parents() {
    return [...this.outline.list.querySelectorAll('a[data-topic-id]')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
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
        box.className = 'ol-dossiers'; box.dataset.parentTopicId = id;
        state = {id, parent, box, stars:[], next:null, extent:null, links:new Map(), loaded:false, busy:null, error:null};
        this.states.set(id, state);
      }
      const returned = state.visible === false;
      state.visible = true; state.parent = parent;
      // TopicRail retains its own ordering and rows. Restore this topic's
      // children after its row if that list has just drawn again.
      if (parent.nextElementSibling !== state.box) parent.after(state.box);
      if (returned || !state.loaded && !state.busy && !state.error) this.load(state);
    }
  }
  refresh() {
    this.sync();
    return Promise.all(this.parents().map(parent => this.load(this.states.get(parent.dataset.topicId))));
  }
  async load(state, more = false) {
    if (!state || !this.outline.handles) return true;
    if (state.busy) {
      if (!more) state.again = true;
      return state.busy;
    }
    if (more && state.next === null) return true;
    const epoch = this.epoch, handles = this.outline.handles;
    const mine = () => epoch === this.epoch && handles === this.outline.handles;
    state.box.setAttribute('aria-busy','true');
    // Defer the read to a microtask so busy is set before sync can run again.
    state.busy = Promise.resolve().then(async () => {
      try {
        let cursor = more ? state.next : null, stars = more ? [...state.stars] : [], next;
        do {
          const answer = checkedView(await this.outline.read('stars', {topic_id:state.id, limit:PAGE, ...(cursor === null ? {} : {cursor})}, 'foreground'), handles.bootstrap.instance_id);
          if (!mine()) return true;
          if (!Array.isArray(answer.items) || answer.items.some(s => s.topic_id !== state.id || !s.dossier?.id) ||
              !(answer.next_cursor === null || Number.isSafeInteger(answer.next_cursor) && (cursor === null || answer.next_cursor < cursor))) throw Error('The starred dossiers could not be confirmed.');
          stars.push(...answer.items); next = answer.next_cursor; cursor = next;
        } while (!more && next !== null && state.extent !== null && next > state.extent);
        if (!mine()) return true;
        state.stars = stars; state.next = next;
        state.extent = stars.at(-1)?.star ?? null;
        state.loaded = true; state.error = null;
        this.paint(state); return true;
      } catch(error) {
        if (!mine()) return true;
        state.error = readFailure(error);
        if (state.error.kind === 'forbidden' || state.error.kind === 'reconnect') state.stars = [];
        this.paint(state); return false;
      } finally {
        if (mine()) {
          state.busy = null; state.box.setAttribute('aria-busy','false');
          if (state.again) {state.again=false; if (state.visible !== false) this.load(state);}
        }
      }
    });
    return state.busy;
  }
  paint(state) {
    const doc = this.outline.doc, nodes = [], alive = new Set();
    for (const star of dossierRows(state.stars)) {
      const item = star.dossier, id = item.id, title = dossierTitle(item);
      let link = state.links.get(id);
      if (!link) {
        link = doc.createElement('a'); link.className = 'ol-dossier'; link.dataset.dossierId = id; link.tabIndex = -1;
        link.onclick = event => {
          if (!plain(event)) return;
          event.preventDefault();
          this.outline.open({kind:'topic',id:state.id,message:id}, link.title);
        };
        state.links.set(id, link);
      }
      const text = '★ ' + title;
      if (link.textContent !== text) link.textContent = text;
      link.title = title; link.setAttribute('aria-label', 'Starred dossier: ' + title);
      link.href = routeHref({kind:'topic',id:state.id,message:id});
      alive.add(id); nodes.push(link);
    }
    for (const [id, link] of state.links) if (!alive.has(id)) {
      if (link === doc.activeElement) state.parent.focus();
      state.links.delete(id);
    }
    if (state.error) {
      const notice = doc.createElement('span'); notice.className='muted'; notice.setAttribute('role','status');
      notice.textContent = state.error.kind === 'forbidden' ? 'Starred dossiers are unavailable.' : 'Starred dossiers could not be read.';
      const retry = doc.createElement('button'); retry.type='button'; retry.textContent='Retry starred dossiers'; retry.dataset.retry=''; retry.tabIndex=-1;
      retry.onclick=()=>this.load(state); nodes.push(notice,retry);
    } else if (state.next !== null) {
      const more = doc.createElement('button'); more.type='button'; more.textContent='More starred dossiers'; more.tabIndex=-1;
      more.onclick=()=>this.load(state,true); nodes.push(more);
    }
    // Keep each title's element (and its native focus) while its words change.
    for (let i=0;i<nodes.length;i++) if(state.box.children[i]!==nodes[i]) state.box.insertBefore(nodes[i],state.box.children[i]??null);
    for (const node of [...state.box.children]) if(!nodes.includes(node)) node.remove();
    state.box.dataset.loaded = String(state.loaded);
  }
}
