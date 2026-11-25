import { parseRoute, routeHref, routeKey } from './topic-navigation.mjs';

export const RAIL_DIGITS = Object.freeze(['1','2','3','4','5','6','7','8','9','0']);
const owners = new WeakMap();
export const railHotkeysFor = doc => owners.get(doc);
const allowed = new Set(['root','health','workspace','conversation','topic','pipeline','measurements','tool','cards','item']);
const targetKey = target => {
  if (!allowed.has(target?.kind) || target.act || target.choice) throw Error('Not a rail destination');
  return routeKey(target);
};
const labelText = value => typeof value === 'string' ? [...value].slice(0,200).join('') : '';

// Device preference only. Failed writes remain in memory and are merged with
// the next valid read rather than silently losing a choice on the next press.
export class RailKeyChoices {
  constructor(storage = null) { this.storage = storage; this.key = null; this.values = []; this.pending = []; this.kept = true; }
  bind(instance, actor) {
    const key = JSON.stringify([instance,actor]);
    if (this.key === 'aim-next.rail-hotkeys.' + key) return;
    this.key = 'aim-next.rail-hotkeys.' + key; this.pending = []; this.values = []; this.refresh();
  }
  apply(target, digit, label) {
    const id = targetKey(target);
    this.values = this.values.filter(item => item.id !== id && (!digit || item.digit !== digit));
    if (digit) this.values.push({ id, target: structuredClone(target), digit, label: labelText(label) });
  }
  refresh() {
    if (!this.key) return;
    try {
      const raw = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
      const values = [], digits = new Set(), ids = new Set();
      for (const item of raw?.version === 1 && Array.isArray(raw.items) ? raw.items.slice(0,10) : []) {
        try {
          const id = targetKey(item.target);
          if (!RAIL_DIGITS.includes(item.digit) || digits.has(item.digit) || ids.has(id) || !labelText(item.label)) continue;
          values.push({ id, target: structuredClone(item.target), digit: item.digit, label: labelText(item.label) });
          digits.add(item.digit); ids.add(id);
        } catch { /* malformed preference is not a navigation instruction */ }
      }
      this.values = values;
    } catch { /* denied/corrupt storage leaves the last in-memory choices */ }
    for (const change of this.pending) this.apply(...change);
  }
  assign(target, digit, label) {
    if (!this.key || digit !== null && !RAIL_DIGITS.includes(digit)) return false;
    targetKey(target); this.refresh(); this.apply(target,digit,label); this.pending.push([target,digit,label]);
    try {
      if (!this.storage) throw Error('Storage unavailable');
      this.storage.setItem(this.key,JSON.stringify({ version:1, items:this.values.map(({target,digit,label})=>({target,digit,label})) }));
      this.pending = []; this.kept = true;
    } catch { this.kept = false; }
    return true;
  }
}

export class RailHotkeys {
  constructor({ root, open, storage = null, doc = root.ownerDocument, listen = (at,...args)=>at.addEventListener(...args) }) {
    Object.assign(this,{root,open,doc}); this.choices = new RailKeyChoices(storage); this.handles = null;
    owners.set(doc,this);
    listen(doc,'keydown',event=>this.keydown(event),true);
    listen(doc.defaultView,'storage',event=>{
      if (event.key === this.choices.key || event.key === null) { this.choices.refresh(); this.paint(); }
    });
    const Observer = doc.defaultView.MutationObserver;
    if (Observer) {
      this.observer = new Observer(()=>{
        if (this.queued) return; this.queued = true;
        queueMicrotask(()=>{ this.queued = false; this.paint(); });
      });
      this.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['href','data-topic-id','data-workspace-id','data-page-id','data-dossier-id']});
    }
  }
  begin() { this.handles = null; this.bound=false; this.current=null; this.menu?.close(false); }
  // Some pages, including Health, have no outline ready handoff. Bootstrap
  // still names their reader; the current callback keeps startup/retired
  // runs inactive until that page's own ready point and departure guards.
  bind(bootstrap,current=null) {
    if (!bootstrap?.instance_id || !bootstrap.actor) return;
    if (current) this.current=current;
    this.current??=()=>true;this.bound=true;
    this.choices.bind(bootstrap.instance_id,bootstrap.actor);
    this.choices.refresh(); this.paint();
  }
  ready(handles) { this.handles=handles; this.bind(handles.bootstrap); }
  rows() { return [...this.root.querySelectorAll('a[href]')]; }
  describe(row) {
    if (!row || !this.root.contains(row)) return null;
    try {
      const url = new URL(row.href,this.doc.defaultView.location.href);
      if (url.origin !== this.doc.defaultView.location.origin || url.pathname !== '/') return null;
      let target = row.pageTarget ?? parseRoute(url);
      // Topic questions evolve; the identity is the topic, while an actual
      // loaded row's click still owns its current question destination.
      if (row.dataset.topicId) target = {kind:'topic',id:row.dataset.topicId};
      else if (row.dataset.workspaceId) target = {kind:'workspace',id:row.dataset.workspaceId};
      const id = targetKey(target), copy = row.cloneNode(true);
      for (const part of copy.querySelectorAll('.rail-hotkeycap, .sr-only, .unread-count, .topic-state, .topic-work, .standing')) part.remove();
      const label = labelText(copy.textContent.replace(/\s+/g,' ').trim());
      return label ? { id,target,label } : null;
    } catch { return null; }
  }
  assign(row,digit) {
    const item = this.describe(row); if (!item || !this.bound || !this.current()) return;
    this.choices.assign(item.target,digit,item.label); this.paint();
  }
  keydown(event) {
    if (event.defaultPrevented || event.isComposing || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || !this.bound || !this.current() || this.handles?.readable?.()===false || this.root.closest('[inert]')) return false;
    const digit = /^Digit([0-9])$/.exec(event.code ?? '')?.[1];
    const item = this.choices.values.find(item=>item.digit===digit);
    if (!item) return false;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return true;
    const row = this.rows().find(row=>this.describe(row)?.id===item.id);
    // Health and other non-feed pages retain a hidden outline whose old
    // TopicRail no longer has a page run. Do not invoke that retired action.
    if (row && !row.closest('#outline')?.hidden) row.click();
    else this.open(structuredClone(item.target),item.label);
    return true;
  }
  paint() {
    if (!this.choices.key) return;
    for (const row of this.rows()) {
      const item = this.describe(row), mine = item && this.choices.values.find(value=>value.id===item.id);
      let cap = row.querySelector('.rail-hotkeycap');
      if (!mine) { cap?.remove(); if(row.classList.contains('rail-has-hotkey'))row.classList.remove('rail-has-hotkey'); if(row.hasAttribute('aria-keyshortcuts'))row.removeAttribute('aria-keyshortcuts'); continue; }
      if (!cap) {
        cap=this.doc.createElement('span'); cap.className='rail-hotkeycap'; cap.setAttribute('aria-hidden','true');
        const line=row.querySelector('.ol-name-line'); if(line)line.append(cap);else row.prepend(cap);
      }
      if (cap.textContent!==mine.digit) cap.textContent=mine.digit;
      const label=`⌥${mine.digit} (Option+${mine.digit}) opens ${item.label}`;
      if(cap.title!==label)cap.title=label;
      if(!row.classList.contains('rail-has-hotkey'))row.classList.add('rail-has-hotkey');
      if(row.getAttribute('aria-keyshortcuts')!=='Alt+'+mine.digit)row.setAttribute('aria-keyshortcuts','Alt+'+mine.digit);
    }
    const keys = this.root.querySelector('.ol-keys');
    if (keys) {
      let guide=keys.querySelector('.rail-hotkey-guide');
      const words='Option + number: '+(RAIL_DIGITS.flatMap(digit=>this.choices.values.filter(item=>item.digit===digit).map(item=>`${digit} — ${item.label}`)).join('; ') || 'assign a number in an item’s context menu.');
      if (!guide) { guide=this.doc.createElement('p'); guide.className='rail-hotkey-guide'; keys.append(guide); }
      if (guide.textContent!==words) guide.textContent=words;
    }
  }
  menuItems(row,current=()=>true) {
    const item=this.describe(row); if (!item || !this.bound || !this.current()) return [];
    const mine=this.choices.values.find(value=>value.id===item.id);
    return [...RAIL_DIGITS,null].map(digit=>{
      const owner=digit&&this.choices.values.find(value=>value.digit===digit), label=digit?`Option+${digit}`:'No key';
      return {key:'rail-hotkey-'+(digit??'clear'),label,glyph:'all',checked:digit?mine?.digit===digit:!mine,
        railDigit:digit,railTaken:Boolean(owner&&owner.id!==item.id),
        railTip:owner&&owner.id!==item.id?`${label} is on ${owner.label}; choose to move it here`:label,
        act:()=>{if(current()&&row.isConnected!==false)this.assign(row,digit);} };
    });
  }
  decorateMenu(menu,items,at=null) {
    if (!menu?.root) return;
    const root=menu.root, all=[...root.querySelectorAll('button')];
    const choices=items.filter(item=>Object.hasOwn(item,'railDigit')).map(item=>({item,button:all.find(button=>button.dataset.notebookAction===item.key || button.textContent.trim()===item.label)})).filter(choice=>choice.button);
    if (!choices.length) return;
    const group=this.doc.createElement('div'); group.className='rail-hotkey-row'; group.setAttribute('role','group'); group.setAttribute('aria-label','Key · Option plus number');
    const label=this.doc.createElement('div'); label.className='rail-hotkey-label'; label.textContent='Key';
    const modifier=this.doc.createElement('span'); modifier.textContent=this.choices.kept?'⌥ Option':'⌥ Option · this page only'; label.append(modifier);
    const chips=this.doc.createElement('div'); chips.className='rail-hotkey-chips';
    const first=choices[0].button; first.parentElement.insertBefore(group,first); group.append(label,chips);
    for (const {item,button} of choices) {
      button.replaceChildren(item.railDigit??'×'); button.title=item.railTip; button.classList.toggle('taken',item.railTaken);
      button.setAttribute('aria-label',item.label); button.setAttribute('role','menuitemradio'); button.setAttribute('aria-checked',String(item.checked)); chips.append(button);
    }
    chips.addEventListener('keydown',event=>{
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons=choices.map(choice=>choice.button), index=buttons.indexOf(this.doc.activeElement);
      buttons[(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus({preventScroll:true});
    });
    if (!root.classList.contains('menu-sheet')) {
      const box=menu.anchor.getBoundingClientRect(), win=this.doc.defaultView, width=root.offsetWidth, height=root.offsetHeight;
      root.style.left=Math.max(8,Math.min(at?.x??box.right-width,win.innerWidth-width-8))+'px';
      root.style.top=Math.max(8,Math.min(at?.y??box.bottom+4,win.innerHeight-height-8))+'px';
    }
  }
}
