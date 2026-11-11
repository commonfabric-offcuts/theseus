// Moving between an outcome's Conversation and its topics without the page
// loading again (pipeline item 272; docs/rails.md). The outline on the left
// stays the same element, with its folds and its scroll; only the middle and
// the right rail change. The address changes with each move, so back,
// forward, reload and a copied link work as they did.
//
// How: each page is one run of app.mjs, which keeps its state in its module.
// A move in place ends that run as the browser ends a page that unloads (its
// own pagehide listeners run, which stop its live feed, its saves and its
// recovery locks, and every listener it added is removed), puts the page's
// parts back as index.html drew them, and starts a fresh run of app.mjs (a
// module of its own, by a new address), which reads and draws the new place
// exactly as a full load would: its live updates, its read tracking and its
// New line are a new page's. What a person leaves goes through the page's own
// guard first (TopicNavigation.openTarget), so writing not yet saved still
// stops the move, as it stopped a load.
import { parseRoute, routeHref, routeKey } from './topic-navigation.mjs';
import { railDrawer } from './rail-drawer.mjs';
import { depart, stay } from './api.mjs';

// The pages a move in place leaves and reaches: an outcome's Conversation and
// its topics. Every other page (the outcome's own page, its pipeline, its
// Notebook page, Health, the Outcomes home) loads as before.
export const FEEDS = new Set(['topic', 'conversation']);
export const isFeed = route => Boolean(route && FEEDS.has(route.kind));
export const movesInPlace = (from, to) => isFeed(from) && isFeed(to);

// The history entries this page makes carry their place in its own history
// (aimPlace), so a back or forward the page refuses goes back to where it was
// by exactly the number of entries it moved.
export class Places {
  constructor(history) {
    this.history = history;
    const kept = history.state?.aimPlace;
    this.index = Number.isSafeInteger(kept) ? kept : 0;
    this.restoring = null;
    if (!Number.isSafeInteger(kept)) history.replaceState({ ...(history.state ?? {}), aimPlace: this.index }, '');
  }
  push(href) { this.index += 1; this.history.pushState({ aimPlace: this.index }, '', href); }
  // A popstate: { ignore } for the page's own way back from a refused move,
  // { load } for an entry the page did not make, else how far it moved.
  popped(state) {
    const to = state?.aimPlace;
    if (this.restoring !== null && to === this.restoring) { this.restoring = null; return { ignore: true }; }
    if (!Number.isSafeInteger(to)) return { load: true };
    const from = this.index; this.index = to;
    return { from, to };
  }
  // Leaving was refused: go back to the entry the person was on.
  refuse({ from, to }) { this.restoring = from; this.index = from; this.history.go(from - to); }
}

// Every listener a page's run adds while it is the page, so the move can take
// them away as an unload would: those on the window, the document, a media
// query or anything else that is not an element, and those on an element in
// the page. What the shell keeps (the outline, the right rail, the drawer's
// backdrop) is not the page's, and an element not yet in the page goes with
// whatever holds it. The shell adds its own through listen, past this record.
// A listener a module keeps for the whole page is added as that module loads,
// before any run begins, so no run's record holds it (docs/rails.md).
const nativeAdd = globalThis.EventTarget?.prototype.addEventListener;
const nativeRemove = globalThis.EventTarget?.prototype.removeEventListener;
export const listen = (target, type, listener, options) => nativeAdd.call(target, type, listener, options);
export class Scope {
  constructor() { this.listeners = []; }
  add(target, type, listener, options) { this.listeners.push([target, type, listener, options]); }
  // Its pagehide listeners hear the page go, as on an unload, and then every
  // listener it added goes.
  end(win) {
    const event = typeof PageTransitionEvent === 'function' ? new PageTransitionEvent('pagehide', { persisted: false }) : new Event('pagehide');
    for (const [target, type, listener] of this.listeners) {
      if (target !== win || type !== 'pagehide') continue;
      try { typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event); } catch { /* the page is going */ }
    }
    for (const [target, type, listener, options] of this.listeners) nativeRemove.call(target, type, listener, options);
    this.listeners = [];
  }
}

// What the shell keeps across moves, by selector: the outline, the right
// rail and the drawer's backdrop. The two holders (the layout and the rail)
// stay the same elements and are refilled inside. The logo block is put back
// as it now reads (its name and Health line do not blink), without anything a
// run put in it.
const HOLDERS = ['.workspace-layout', '#rail'];
export const KEPT = ['#outline', '#things', '#things-backdrop', '#rail-backdrop'];
const BRAND = '.brand';
// A part of the page a kept part holds for it (the page's topic list in the
// outline, outline-rail.mjs) is still the run's: its ids and its listeners.
const PAGE_PART = '[data-page-part]';
const selectorOf = node => node.nodeType === 1 ? [...HOLDERS, ...KEPT, BRAND].find(selector => node.matches(selector)) ?? null : null;
// Puts host's children in the order the pristine copy has them: a kept part
// is the live element itself; anything else is a fresh copy of the pristine
// one. What a run added that index.html does not have (a menu on the body,
// say) goes.
function restore(host, pristine) {
  const doc = host.ownerDocument, children = [];
  for (const child of pristine.childNodes) {
    const selector = selectorOf(child), live = selector ? doc.querySelector(selector) : null;
    if (!live) { children.push(child.cloneNode(true)); continue; }
    if (selector === BRAND) {
      const brand = live.cloneNode(true);
      for (const added of brand.querySelectorAll('.guide-open')) added.remove();
      children.push(brand); continue;
    }
    if (HOLDERS.includes(selector)) restore(live, child);
    children.push(live);
  }
  // What stays is never taken out of the page, so it keeps its focus, and the
  // rail that holds it its scroll: the rest goes, and the fresh parts go in around it.
  const wanted = new Set(children);
  for (const child of [...host.childNodes]) if (!wanted.has(child)) child.remove();
  let at = host.firstChild;
  for (const node of children) { if (node === at) at = at.nextSibling; else host.insertBefore(node, at); }
}
// Every element with an id among what goes, by id: the run that goes keeps
// finding its own (app.mjs $), so work it had under way lands there and never
// on the new page.
export function retiredIds(doc) {
  const found = new Map(), kept = KEPT.join(',');
  for (const node of doc.body.querySelectorAll('[id]')) if (!node.matches(HOLDERS.join(',')) && (!node.closest(kept) || node.closest(PAGE_PART))) found.set(node.id, node);
  return found;
}

// What the rails read goes one read at a time, after the one before it has
// settled, so the rails never crowd the page's own reads out of their lanes.
// busy(true) when a read is waiting or out, busy(false) when none is.
export function oneAtATime(busy = () => {}) {
  let last = Promise.resolve(), pending = 0;
  const done = () => { pending -= 1; if (!pending) busy(false); };
  return job => {
    pending += 1; if (pending === 1) busy(true);
    const run = last.then(job, job); last = run.catch(() => {});
    run.then(done, done);
    return run;
  };
}

// A read a run asked for that reached its turn after a newer run became the
// page: it is never sent, and whoever asked drops it.
export class Superseded extends Error {
  constructor() { super('The page moved on before this was read.'); this.name = 'Superseded'; }
}

export class Shell {
  // reads: { depart, stay }, the page asking Theseus nothing more while it
  // loads another, and again once it stays (api.mjs).
  constructor({ doc = globalThis.document, win = globalThis.window, load = place => import(`./app.mjs?place=${place}`), reads = { depart, stay } } = {}) {
    Object.assign(this, { doc, win, load, reads });
    // The run's guards on leaving (guard), and whether the page holds its
    // reads for a load it asked for (leave) until it goes or stays.
    this.guards = []; this.leaving = false;
    this.page = null; this.scope = null; this.moving = false; this.runs = 1; this.installed = false; this.popping = null;
    this.handles = null; this.listeners = new Set(); this.at = null; this.feed = false; this.makers = [];
    // What was asked while no run was up to take it (a back, a forward, a
    // place chosen): the run on its way takes it up as soon as it is up.
    this.owed = null; this.begun = null; this.placeOfRun = 0; this.up = null;
    // While the rails have a read waiting or out, the page says so (data-rails-reading), for whoever waits for them to be quiet.
    this.inTurn = oneAtATime(busy => this.doc?.documentElement?.toggleAttribute('data-rails-reading', busy));
  }
  // make(doc, win): builds what the shell keeps (rails.mjs), once, when it installs.
  extend(make) { this.makers.push(make); }
  // Once, before the first run starts: the outline's place in the rail, the
  // right rail's beside the page, the record of listeners, history, and the
  // drawer, which the shell keeps across moves.
  install() {
    if (this.installed || !this.doc?.body || !nativeAdd) return;
    this.installed = true;
    const doc = this.doc, rail = doc.getElementById('rail'), main = doc.getElementById('main');
    if (rail && !doc.getElementById('outline')) {
      const outline = doc.createElement('section');
      outline.id = 'outline'; outline.className = 'outline'; outline.setAttribute('aria-label', 'Outcomes and their topics');
      // Last in the rail, so the page finds its own parts first by id (app.mjs $).
      rail.append(outline);
    }
    if (main && !doc.getElementById('things')) {
      const things = doc.createElement('aside');
      things.id = 'things'; things.className = 'things'; things.setAttribute('aria-labelledby', 'things-heading');
      const backdrop = doc.createElement('div');
      backdrop.id = 'things-backdrop'; backdrop.className = 'things-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
      main.after(things, backdrop);
    }
    this.title = doc.title;
    this.pristine = doc.body.cloneNode(true);
    const shell = this, kept = KEPT.join(',');
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const page = !(this instanceof Node) || (this.isConnected && (!this.closest?.(kept) || Boolean(this.closest(PAGE_PART))));
      if (shell.scope && listener && page) shell.scope.add(this, type, listener, options);
      return nativeAdd.call(this, type, listener, options);
    };
    this.places = new Places(this.win.history);
    listen(this.win, 'popstate', event => this.popstate(event));
    this.heed();
    this.drawer = railDrawer(doc, this.win, listen);
    for (const make of this.makers) make(doc, this.win);
  }
  // A run of app.mjs starts: from here, what it adds is its own. The place it
  // reads is the address as it starts; the rails forget the place before it.
  // page: { open(target, title), retire(ids) }.
  begin(page) {
    this.install();
    this.scope = new Scope();
    this.page = page; this.handles = null; this.guards = [];
    const route = this.begun = this.route();
    this.placeOfRun = this.places?.index ?? 0;
    this.at = route ? routeKey(route) : null;
    this.feed = isFeed(route);
    // The rails' look is the page's from its first paint (rails.css).
    this.doc?.documentElement?.toggleAttribute('data-rails', this.feed);
    for (const listener of this.listeners) listener.begin?.(this.feed, route);
    return page;
  }
  // The run could not start (app.mjs says why, with a reload): what was
  // asked while it started goes as it would with no feed page up.
  failed(page) {
    if (page !== this.page || this.handles) return;
    this.feed = false;
    const owed = this.owed; this.owed = null;
    if (owed?.pop) this.leave();
    else if (owed) { this.leave(routeHref(owed.go ?? owed.open)); owed.resolve?.(false); }
  }
  // The run's page is up. handles: what the shell keeps (the outline, the
  // right rail) reads and opens through, for as long as this run is the page.
  // A read the run asked for that reaches its turn once a newer run is the
  // page is never sent (Superseded).
  ready(handles) {
    if (!this.page) return;
    // The address names the run's place, as the page may have put it (a
    // message's link, say); one a back has moved on since is owed, below.
    const route = this.owed ? this.begun : this.route();
    this.at = route ? routeKey(route) : null;
    const mine = {}, current = () => this.handles === mine;
    const own = job => this.inTurn(() => { if (!current()) throw new Superseded(); return job(); });
    Object.assign(mine, handles, { route, current, inTurn: own, view: (name, args, readClass) => own(() => handles.view(name, args, readClass)) });
    this.handles = mine; this.read = handles.view;
    for (const listener of this.listeners) listener.ready?.(mine);
    const waiting = this.up; this.up = null; waiting?.resolve();
    // What was asked meanwhile, once the run has finished starting.
    const owed = this.owed; this.owed = null;
    if (owed) Promise.resolve().then(() => this.settle(owed));
  }
  // A read for what the shell keeps for itself (the outline's own topic
  // lists, an outcome's Conversation): asked while no run is up, it waits for
  // one; it goes through the newest run's reads when its turn comes.
  async view(name, args, readClass) {
    if (!this.handles) {
      if (!this.up) { let resolve; const promise = new Promise(done => { resolve = done; }); this.up = { promise, resolve }; }
      await this.up.promise;
    }
    return this.inTurn(() => this.read(name, args, readClass));
  }
  // The run names its own place anew as it starts (a message's link becomes
  // its topic's, a Conversation's topic its Conversation): the address
  // follows, unless a back or forward has moved it on meanwhile, which the
  // run takes up once it is up.
  rename(route, hash = '') {
    const now = this.route();
    if (this.begun && now && routeKey(now) !== routeKey(this.begun)) return;
    this.win.history.replaceState(this.win.history.state, '', routeHref(route) + hash);
    this.begun = route;
  }
  // The page has read its topic again (a message, a state): what the rails show of it may have moved on.
  topicChanged() { if (this.handles) for (const listener of this.listeners) listener.topicChanged?.(); }
  // listener: { begin(feed, route), ready(handles), topicChanged() }; each hears every run.
  follow(listener) {
    this.listeners.add(listener);
    if (this.handles) listener.ready?.(this.handles);
    return () => this.listeners.delete(listener);
  }
  route() { try { return parseRoute(new URL(this.win.location.href)); } catch { return null; } }
  // Whether a feed's run is on its way: a move under way, or a run not up yet.
  get between() { return this.installed && this.feed && (this.moving || (!this.handles && Boolean(this.page))); }
  // The page's guard said the person may go: true when the move is made in
  // place, false when the caller loads the destination as before. Asked
  // before the run is up, the move waits for it.
  go(target) {
    const from = this.route(), popped = this.popping;
    this.popping = null;
    if (!this.installed || !this.page || this.moving || !movesInPlace(from, target)) return false;
    if (!this.handles) { this.owe({ go: target }); return true; }
    if (!popped) this.places.push(routeHref(target));
    this.move();
    return true;
  }
  // A place chosen from what the shell keeps (the outline, the right rail):
  // through the page's own guard, as a link on the page goes. Chosen while a
  // run is on its way, it waits for that run; with no feed page, it loads.
  open(target, title) {
    if (this.page && this.handles && !this.moving) return Promise.resolve(this.page.open(target, title));
    if (!this.between) { this.leave(routeHref(target)); return Promise.resolve(false); }
    return new Promise(resolve => this.owe({ open: target, title, resolve }));
  }
  // The run's guard on leaving: while holds() is true (writing not yet
  // safe), the browser asks the person before the page goes (beforeunload).
  guard(holds) {
    this.guards.push(holds);
    this.win.addEventListener('beforeunload', event => { if (holds()) { event.preventDefault(); event.returnValue = ''; } });
  }
  // The page loads another, href, or itself again with none: every load the
  // page decides goes this way. From the moment it asks, it starts no read
  // (api.mjs depart), so nothing is started in the moment before the browser
  // begins the load; the page it loads reads afresh. While a guard holds, the
  // browser will ask the person, who may stay: then the page reads on as
  // before, so it does not hold its reads. A load stopped after it was asked
  // for leaves the page up, and the page reads again as soon as it is seen to
  // stay (heed).
  leave(href = null) {
    if (!this.guards.some(holds => holds())) { this.reads.depart(); this.leaving = true; }
    if (href === null) this.win.location.reload(); else this.win.location.assign(href);
  }
  // What says the page stays after asking for a load: a key or a press of the
  // person's on it (the person stopped the load, or chose to stay when asked),
  // or a back or forward it hears (popstate). A key held down from before is
  // none. The page asks for a load when a write is answered, not on a press,
  // so a fresh press in the moment before the browser begins the load would be
  // a coincidence; and Safari on iOS never says the load began (beforeunload).
  heed() {
    const pressed = event => { if (!event.repeat) this.stayed(); };
    listen(this.win, 'pointerdown', pressed, true); listen(this.win, 'keydown', pressed, true);
  }
  stayed() { if (!this.leaving) return; this.leaving = false; this.reads.stay(); }
  // The newest ask while no run is up stands for every one before it.
  owe(ask) { this.owed?.resolve?.(false); this.owed = ask; }
  // The run is up: what was asked meanwhile is done now, through its guard.
  async settle(owed) {
    if (owed.go) { this.go(owed.go); return; }
    if (owed.open) { owed.resolve(await this.page.open(owed.open, owed.title)); return; }
    // A back or forward: the address may have moved on from the run's place.
    const to = this.route();
    if (!to || routeKey(to) === this.at) return;
    if (!isFeed(to)) { this.leave(); return; }
    await this.arrive(to, { from: this.placeOfRun, to: this.places.index });
  }
  // Back and forward: an entry this page made is reached in place, through
  // the page's guard; one the guard refuses puts the address back. Any other
  // entry loads, as it did before. One that comes while a run is on its way
  // waits for that run, so a quick second back is a move like the first.
  async popstate(event) {
    this.stayed();
    const said = this.places.popped(event.state), to = this.route();
    if (said.ignore) return;
    if (said.load || !isFeed(to) || !this.installed || !this.feed) { this.leave(); return; }
    if (this.between) { this.owe({ pop: true }); return; }
    if (to && this.at === routeKey(to)) return;
    await this.arrive(to, said);
  }
  async arrive(to, said) {
    const page = this.page;
    this.popping = said;
    try { await page.open(to, 'the page you went back to'); } finally { this.popping = null; }
    // The page stayed: its guard refused (it says why), so the address goes back too.
    if (this.page === page && !this.moving) this.places.refuse(said);
  }
  // The run that was the page goes as an unload ends it; the page's parts
  // are put back as index.html drew them; a fresh run reads the new place.
  move() {
    this.moving = true;
    const page = this.page, scope = this.scope;
    this.page = null; this.handles = null;
    // The place the address now names, so a back before the next run is up is measured from it.
    const route = this.route();
    this.at = route ? routeKey(route) : null;
    const ids = retiredIds(this.doc);
    try { page.retire(ids); } catch { /* the page is going */ }
    scope.end(this.win);
    // Between runs nothing is the page: a listener a stray piece of the old
    // run adds now is its own and goes at once.
    this.scope = { add: (target, type, listener, options) => queueMicrotask(() => nativeRemove.call(target, type, listener, options)) };
    const body = this.doc.body;
    for (const name of Object.keys(body.dataset)) if (!(name in this.pristine.dataset)) delete body.dataset[name];
    body.className = this.pristine.className;
    this.doc.title = this.title;
    restore(body, this.pristine);
    this.drawer.close();
    this.win.scrollTo(0, 0);
    this.load(++this.runs).then(() => { this.moving = false; }, () => this.leave());
  }
}

export const shell = new Shell();
