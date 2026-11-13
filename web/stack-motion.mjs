// Optional, page-owned presentation around the keyed dossier renderer. Core's
// acts and the renderer's final membership remain synchronous and authoritative.
import { entries } from './reply-stacks.mjs';
import { cardIn } from './fold.mjs';

const rect = node => node.getBoundingClientRect();
const visible = (node, win) => node?.isConnected && node.getClientRects().length && rect(node).bottom > 0 && rect(node).top < win.innerHeight;
export function arrivalIds(provenance, handled) {
  const ids = provenance?.live && !provenance.initial ? provenance.addedIds ?? [] : [];
  const fresh = ids.filter(id => !handled.has(id));
  for (const id of provenance?.addedIds ?? []) handled.add(id);
  return fresh;
}
// A region below the held words can grow. A region above them cannot animate
// after the synchronous anchor correction without moving them a second time.
export function belowAnchor(top, anchorBox) { return !anchorBox || top >= anchorBox.bottom - 1; }

// The v4 segments share one clock with the physical folder edge. A
// compositor-owned transform can advance ahead of a JS measurement in WebKit.
const CURVES = [[.25,.6,.3,1],[.2,.7,.25,1],[0,0,.58,1],[.42,0,.58,1]];
function curve(x, [x1,y1,x2,y2]) {
  const at = (t,a,b) => 3*(1-t)*(1-t)*t*a + 3*(1-t)*t*t*b + t*t*t;
  let lo=0, hi=1;
  for (let i=0;i<20;i++) { const t=(lo+hi)/2; if (at(t,x1,x2)<x) lo=t; else hi=t; }
  return at((lo+hi)/2,y1,y2);
}
export function arrivalPose(progress, above) {
  const p=Math.max(0,Math.min(1,progress));
  const stops=[[0,above,-.45,.985,0],[.26,above*.64,-.25,.993,.55],[.76,3,.06,1,1],[.89,-1,0,1,1],[1,0,0,1,1]];
  const i=Math.min(3,stops.findIndex((stop,j)=>j<4&&p<=stops[j+1][0]));
  const a=stops[i],b=stops[i+1],t=curve((p-a[0])/(b[0]-a[0]),CURVES[i]);
  const mix=j=>a[j]+(b[j]-a[j])*t;
  return {y:mix(1),angle:mix(2),scale:mix(3),opacity:mix(4)};
}

export class StackMotion {
  constructor({ list, anchor = () => null, reading = () => {}, win = list.ownerDocument.defaultView }) {
    Object.assign(this, { list, anchor, reading, win, doc: list.ownerDocument });
    this.handled = new Set(); this.next = []; this.active = new Set(); this.paused = false; this.disposed = false; this.awaitingAttention = false; this.staged = null;
    this.off = [];
    const on = (host, name, fn, options) => { host.addEventListener(name, fn, options); this.off.push(() => host.removeEventListener(name, fn, options)); };
    on(this.doc, 'pointerdown', e => { if (e.isPrimary && e.button === 0) { this.awaitingAttention = false; this.pause(); } }, true);
    on(this.doc, 'keydown', () => { this.awaitingAttention = false; }, true);
    for (const name of ['pointerup', 'pointercancel', 'contextmenu']) on(this.doc, name, () => this.resume(), true);
    on(win, 'blur', () => this.resume());
    on(win, 'resize', () => this.finish());
    on(this.doc, 'load', event => { for (const effect of [...this.active]) if (effect.faces.some(face => face.card.contains(event.target))) effect.finish(); }, true);
    on(this.doc, 'visibilitychange', () => { if (this.doc.visibilityState !== 'visible') { this.awaitingAttention = true; this.finish(); } });
    on(win, 'pagehide', () => this.dispose());
    this.reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    on(this.reduced, 'change', () => this.finish());
  }
  arrivals(provenance) { this.next = arrivalIds(provenance, this.handled); }
  // The app stages before inserting loose entries: their temporary placement
  // must not masquerade as a dossier reorder or replace the held anchor.
  stage(provenance) { this.staged = null; this.arrivals(provenance); this.staged = this.capture(); }
  capture() {
    if (this.staged) { const before = this.staged; this.staged = null; return before; }
    if (this.next.length) this.finish(); // A burst supersedes the previous landing, never queues it.
    const faces = new Map();
    for (const entry of entries(this.list)) {
      const card = cardIn(entry), section = entry.closest('.reply-stack');
      if (!section || !visible(entry, this.win) || !visible(card, this.win)) continue;
      const style = this.win.getComputedStyle(card);
      // During a reversal the semantic fold may already be true while the
      // original header still paints. Measure the header that is visible.
      const header = [card.querySelector(':scope > .message-folded .folded-author'), card.querySelector(':scope > .message-author')].find(node => node?.getClientRects().length);
      const headerInset = header ? rect(header).top - rect(card).top - (parseFloat(style.borderTopWidth) || 0) : parseFloat(style.paddingTop);
      faces.set(entry.dataset.id, { entry, card, section, box: rect(card), folded: card.dataset.folded === 'true',
        headerInset, scrollTop: card.scrollTop, pad: parseFloat(style.paddingTop), displays: new Map([...card.children].map(child => [child, this.win.getComputedStyle(child).display])) });
    }
    const sections = new Map([...this.list.querySelectorAll('.reply-stack')].filter(node => visible(node, this.win))
      .map(node => [node, { top: rect(node).top, floor: rect(node.querySelector('.stack-replies')).height }]));
    const anchor = this.anchor();
    return { faces, sections, anchor, anchorBox: anchor?.isConnected ? rect(anchor) : null, added: this.next.splice(0) };
  }
  allowed() { return !this.disposed && !this.paused && !this.awaitingAttention && !this.reduced.matches && this.doc.visibilityState === 'visible' && !this.list.closest('.only-new'); }
  painted(before) {
    if (!before || this.disposed) return;
    // Repaints of receipts/read state leave the same motion running. A changed
    // act, membership or visibility supersedes it and releases its own styles.
    for (const effect of [...this.active]) if (effect.faces.some(({ entry, card, parent, folded }) =>
      !entry.isConnected || entry.parentElement !== parent || !visible(entry, this.win) || (card.dataset.folded === 'true') !== folded)) effect.finish();
    if (!this.allowed()) return;
    const current = new Map(entries(this.list).map(entry => [entry.dataset.id, entry]));
    const batches = new Map(), staticSections = new Set();
    for (const id of before.added) {
      const entry = current.get(id), section = entry?.closest('.reply-stack'), old = before.sections.get(section);
      // A visible batch must have one floor. If a later new face is off
      // screen, use natural layout for the whole dossier rather than leave
      // that static face hanging outside an animated earlier floor.
      if (old && entry.parentElement?.className === 'stack-replies' && entry.getClientRects().length && !visible(entry, this.win)) staticSections.add(section);
      if (!old || entry.parentElement?.className !== 'stack-replies' || !visible(entry, this.win) || Math.abs(rect(section).top - old.top) > 1 ||
          !belowAnchor(rect(entry).top, before.anchorBox)) continue;
      if (!batches.has(section)) batches.set(section, []);
      batches.get(section).push(entry);
    }
    for (const [section, incoming] of batches) if (!staticSections.has(section)) this.deal(section, incoming, before.sections.get(section).floor);
    for (const [id, old] of before.faces) {
      const entry = current.get(id), card = entry && cardIn(entry), folded = card?.dataset.folded === 'true';
      if (!entry || !card || entry.parentElement?.className !== 'stack-replies' || !visible(entry, this.win) || folded === old.folded ||
          entry.closest('.reply-stack') !== old.section || old.scrollTop > 0 || !belowAnchor(rect(entry).top, before.anchor === entry ? null : before.anchorBox)) continue;
      for (const effect of [...this.active]) if (effect.faces.some(face => face.card === card)) effect.finish();
      this.fold(entry, old, folded);
    }
  }
  // Every temporary property is restored to exactly what its owner supplied.
  effect(incoming, kind) {
    const cleanups = [], animations = [], faces = incoming.map(entry => ({ entry, card: cardIn(entry), parent: entry.parentElement, folded: cardIn(entry).dataset.folded === 'true' }));
    let done = false, frame = null;
    const effect = { faces, animations, kind, tick: null, last: null, elapsed: 0,
      style(node, key, value) { const old = node.style.getPropertyValue(key), priority = node.style.getPropertyPriority(key); node.style.setProperty(key, value); cleanups.push(() => old ? node.style.setProperty(key, old, priority) : node.style.removeProperty(key)); },
      cleanup(fn) { cleanups.push(fn); },
      loop: (now = this.win.performance.now()) => {
        this.win.cancelAnimationFrame(frame); frame = null;
        if (done || this.paused) return;
        if (effect.last !== null) effect.elapsed += Math.max(0, now-effect.last);
        effect.last = now;
        if (effect.tick?.(effect.elapsed)) { effect.finish(); return; }
        frame = this.win.requestAnimationFrame(effect.loop);
      },
      finish: () => {
        if (done) return; done = true;
        this.win.cancelAnimationFrame(frame);
        for (const animation of animations) animation.cancel();
        for (const undo of cleanups.reverse()) undo();
        for (const { entry, card } of faces) { delete card.dataset.stackMotion; delete entry.dataset.stackMotion; this.reading(entry, false); }
        this.active.delete(effect);
      },
    };
    for (const { entry, card } of faces) { entry.dataset.stackMotion = kind; card.dataset.stackMotion = kind; this.reading(entry, true); }
    this.active.add(effect);
    return effect;
  }
  run(effect, node, keyframes, options) {
    const animation = node.animate(keyframes, { ...options, fill: 'both' });
    effect.animations.push(animation);
    animation.finished.then(() => { if (effect.animations.every(a => a.playState === 'finished')) effect.finish(); }, () => {});
    return animation;
  }
  duration(name) { return Number(this.win.getComputedStyle(this.list).getPropertyValue(name).trim()); }
  deal(section, incoming, floor) {
    const replies = section.querySelector('.stack-replies'), effect = this.effect(incoming, 'arrival');
    effect.style(replies, 'height', floor + 'px');
    const faces = incoming.map(entry => {
      const opacity = Number(this.win.getComputedStyle(entry).opacity);
      const above = -Math.max(rect(entry).height + 24, Math.min(480, Math.max(220, rect(entry).top - rect(section).top + 28)));
      effect.style(entry, 'transition-property', 'none');
      effect.style(entry, 'transform', 'none'); effect.style(entry, 'opacity', String(opacity));
      return {entry,opacity,above};
    });
    const duration = this.duration('--stack-arrival-ms');
    effect.tick = elapsed => {
      const progress = duration > 0 ? Math.min(1,elapsed/duration) : 1;
      for (const {entry,opacity,above} of faces) {
        const pose=arrivalPose(progress,above);
        entry.style.transform=`translateY(${pose.y}px) rotate(${pose.angle}deg) scale(${pose.scale})`;
        entry.style.opacity=String(pose.opacity*opacity);
      }
      const edge = Math.max(floor, ...incoming.map(entry => rect(entry).bottom - rect(replies).top));
      replies.style.height = edge + 'px';
      return progress === 1;
    };
    this.watchSize(effect);
    effect.loop();
  }

  fold(entry, old, folded) {
    const card = cardIn(entry), target = rect(card).height, style = this.win.getComputedStyle(card), naturalPad = parseFloat(style.paddingTop);
    const rowAuthor = card.querySelector(':scope > .message-folded .folded-author');
    const compactPad = folded && rowAuthor ? rect(rowAuthor).top - rect(card).top - (parseFloat(style.borderTopWidth) || 0) : old.headerInset;
    const effect = this.effect([entry], folded ? 'fold' : 'unfold');
    if (folded) {
      // Paint the existing original header/body through the shrinking clip.
      // They cannot receive focus or actions; the semantic folded state won.
      for (const [child, display] of old.displays) if (!child.classList.contains('message-folded')) {
        effect.style(child, 'display', display);
        const inert = child.inert, hidden = child.getAttribute('aria-hidden'); child.inert = true; child.setAttribute('aria-hidden', 'true');
        effect.cleanup(() => { child.inert = inert; hidden === null ? child.removeAttribute('aria-hidden') : child.setAttribute('aria-hidden', hidden); });
      }
    }
    // Restore each axis separately: a CardScroll overflow-y declaration
    // need not have an inline overflow shorthand to save and restore.
    effect.style(card, 'overflow-x', 'clip'); effect.style(card, 'overflow-y', 'clip'); effect.style(card, 'min-height', '0');
    effect.style(card, 'height', old.box.height + 'px');
    effect.style(card, 'padding-top', (folded ? old.pad : compactPad) + 'px');
    this.run(effect, card, [{ height: old.box.height + 'px', paddingTop: (folded ? old.pad : compactPad) + 'px' },
      { height: target + 'px', paddingTop: (folded ? compactPad : naturalPad) + 'px' }],
    { duration: this.duration('--stack-fold-ms'), easing: this.win.getComputedStyle(this.list).getPropertyValue('--stack-motion-ease').trim() });
    this.watchSize(effect);
  }
  watchSize(effect) {
    const sizes = new Map();
    const observer = new this.win.ResizeObserver(records => {
      for (const record of records) {
        const size = [record.contentRect.width, record.contentRect.height].join(':');
        if (sizes.has(record.target) && sizes.get(record.target) !== size) { effect.finish(); return; }
        sizes.set(record.target, size);
      }
    });
    const changes = new this.win.MutationObserver(() => effect.finish());
    for (const { entry, card } of effect.faces) {
      // Transforms do not change the arrival's layout size. Fold owns its
      // height, so observe its content/header rather than its animated box.
      if (effect.kind === 'arrival') observer.observe(entry);
      const author = card.querySelector(':scope > .message-author'); if (author) observer.observe(author);
      const body = card.querySelector(':scope > .message-preview');
      if (body) { observer.observe(body); changes.observe(body, {childList:true,characterData:true,subtree:true}); }
    }
    effect.cleanup(() => { observer.disconnect(); changes.disconnect(); });
  }
  pause() { this.paused = true; for (const effect of this.active) for (const animation of effect.animations) { const time=animation.currentTime; animation.pause(); animation.currentTime=time; } }
  resume() { if (!this.paused) return; this.paused = false; for (const effect of this.active) { for (const animation of effect.animations) animation.play(); effect.last=null; if (effect.tick) effect.loop(); } }
  finish() { for (const effect of [...this.active]) effect.finish(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.finish(); for (const off of this.off) off(); this.off = []; this.next = []; this.staged = null; this.handled.clear(); }
}
