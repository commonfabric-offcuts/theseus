import * as uploadState931 from '../web/upload-state.mjs';
// Exercises actual app/inline-adapter functions below the native browser. Only
// imports and auto-start are replaced; no product function body is copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readerArchive } from './fixtures/reader_archive.mjs';
import * as writing from '../web/writing-helpers.mjs';
import { readFailure, checkedView, bindingOf, Freshness } from '../web/freshness.mjs';
import { currentImages } from '../web/upload-state.mjs';
import { WRITING_FIELDS, noWriting, Editor } from '../web/editor.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { WritingInput, typingField } from '../web/writing-input.mjs';
import { ReadThrough } from '../web/read-through.mjs';
import { Live, liveOffered, reloader } from '../web/live.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { replyLine, paintReplyLine } from '../web/replies.mjs';
import { placeNewLine } from '../web/unanswered.mjs';
import { revealSelection } from '../web/reveal.mjs';
import { cardClass, paintCardColor, agentColor, AGENT_PALETTE } from '../web/author-colors.mjs';
import { AgentColors } from '../web/colors.mjs';
import { openColorPicker } from '../web/color-picker.mjs';
import * as times from '../web/times.mjs';
// Every shown time is read on one fixed day, noon on Thursday 5 November 2026, wherever and whenever the check runs.
const TODAY = new Date(2026, 10, 5, 12, 0).getTime();
times.clock.now = () => TODAY;
import { PageReads } from '../web/page-reads.mjs';
import { PageHere } from '../web/page-here.mjs';
import { hasTitle } from '../web/creation.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Reader as RealReader } from '../web/reader.mjs';
import { configureCoverAnswers } from '../web/cover-answers.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { MessageEdit as RealMessageEdit } from '../web/message-edit.mjs';
import { MessageEditWriting as RealMessageEditWriting } from '../web/message-edit-writing.mjs';
import { entries } from '../web/reply-stacks.mjs';
// A message's entry in the list, on its own or in its reply stack (reply-stacks.mjs).
const entryIn = (f, id) => entries(f.get('messages')).find(entry => entry.dataset.id === id);
// A singleton's folder still contains one message. Helpers which inspect
// messages, multi-message stacks and lines read through that wrapper.
const singleEntry = node => node.dataset.single === 'true' ? node.children.find(child => child.dataset.id) : node;
const listed = f => f.get('messages').children.filter(child => child !== f.get('new-message-sheet')).map(singleEntry);
import { SessionRenewal } from '../web/session-renewal.mjs';
import { phoneCheck } from '../web/phone-check.mjs';
import { Api as RealApi, AttemptError, Deadline, notAnswering, unreached } from '../web/api.mjs';
import * as apiExports from '../web/api.mjs';
import { showLine, lineText } from '../web/lines.mjs';
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// The page's own scope. Each name app.mjs imports, and each name the modules loaded here import in turn, that the scope does
// not already hold (a fake below, a test's override, or a module imported natively above) comes from its module's own source:
// each module once, its dependencies first, with its imports and exports taken off. A module the page newly imports is wired
// here as the browser wires it, so the app's wiring stays covered without a line added for it.
const IMPORTS = /^import (\{[^}]*\}|\* as [\w$]+) from '\.\/([^']+)';$/gm;
const webSource = file => readFileSync(new URL('../web/' + file, import.meta.url), 'utf8');
function loadPageScope(context, root) {
  const wanted = new Map(), order = [];
  const want = file => {
    for (const [, clause, from] of webSource(file).matchAll(IMPORTS)) {
      const entries = clause.startsWith('* as ') ? [['*', clause.slice(5)]]
        : clause.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(entry => {
          const [name, alias = name] = entry.split(/\s+as\s+/); return [name, alias];
        });
      for (const [name, alias] of entries) {
        if (alias in context) continue;
        if (!wanted.has(from)) { wanted.set(from, new Map()); want(from); order.push(from); }
        wanted.get(from).set(alias, name);
      }
    }
  };
  want(root);
  for (const file of order) {
    const source = webSource(file);
    // ES module imports are lexical bindings. Capture them before app.mjs
    // introduces a same-named local (for example its own paintMarks), so an
    // imported card renderer still calls topic-navigation's paintMarks.
    const imports = [...source.matchAll(IMPORTS)].flatMap(([, clause]) => clause.startsWith('* as ')
      ? [clause.slice(5)] : clause.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(entry => entry.split(/\s+as\s+/).at(-1)));
    const body = (imports.length ? `const { ${imports.join(', ')} } = globalThis;\n` : '')
      + source.replace(/^import [^;]*;\n/gm, '').replace(/^export (?=(const|let|class|function|async function) )/gm, '');
    const exports = [...webSource(file).matchAll(/^export (?:const|let|class|function|async function) ([\w$]+)/gm)].map(match => match[1]);
    const names = [...wanted.get(file)].map(([alias, name]) => name === '*' ? alias + ': Object.freeze({ ' + exports.join(', ') + ' })' : alias === name ? name : alias + ': ' + name);
    vm.runInContext('Object.assign(globalThis, (() => {\n' + body + '\nreturn { ' + names.join(', ') + ' }; })())', context, { filename: file });
  }
}
// overrides: names the app imports, replaced in its scope for one test.
function fixture(href = 'https://fixture/?topic=t1', overrides = {}) {
  const elements = new Map(), events = [], calls = [], paints = [], observers = [], days = [];
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; this.isConnected = true;
      this.style = {
        setProperty(name, value) { this[name] = String(value); },
        removeProperty(name) { const previous = this[name] ?? ''; delete this[name]; return previous; },
      }; this.scrollTop = 0; this.scrollHeight = 600; this.clientHeight = 600; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    // The real selection-quote owner clones the Reader's pill. Clone its
    // content and reflected attributes, without copying event listeners.
    cloneNode(deep = false) {
      const clone = new Element(this.id);
      for (const name of ['tagName', 'namespaceURI', 'className', 'textContent', 'title', 'type', 'hidden', 'disabled', 'value']) {
        if (name in this) clone[name] = this[name];
      }
      clone.dataset = { ...this.dataset }; clone.style = { ...this.style };
      if (deep) clone.append(...this.children.map(child => child instanceof Element ? child.cloneNode(true)
        : typeof child === 'object' ? { data: child.data, textContent: child.textContent, children: [] } : child));
      return clone;
    }
    get classList() {
      const names = () => String(this.className ?? '').split(' ').filter(Boolean), set = list => { this.className = list.join(' '); };
      return { add: name => { if (!names().includes(name)) set([...names(), name]); }, remove: name => set(names().filter(n => n !== name)),
        contains: name => names().includes(name), toggle: (name, on = !names().includes(name)) => { set(on ? [...names().filter(n => n !== name), name] : names().filter(n => n !== name)); return on; } };
    }
    append(...items) { for (const item of items) { if (typeof item === 'object') { item.remove?.(); item.parent = this; } this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    prepend(...items) { for (const item of items) item.remove(); this.children.unshift(...items); for (const item of items) item.parent = this; }
    after(...items) { const host = this.parent; if (!host) return; for (const item of items) item.remove(); host.children.splice(host.children.indexOf(this) + 1, 0, ...items); for (const item of items) item.parent = host; }
    get parentNode() { return this.parent ?? null; }
    // An element the page names by id sits in the page (the saving sign's words, the instance's label), unless it was placed.
    get parentElement() { return this.parent ?? (this.id && this.id !== 'body' ? document.body : null); }
    get ownerDocument() { return this.owner ?? document; }
    set ownerDocument(value) { this.owner = value; }
    get firstElementChild() { return this.children[0]; }
    get firstChild() { return this.children[0] ?? null; }
    // What a panel's in-place repaint (web/repaint.mjs) walks; this fixture keeps no attribute list to carry.
    get nodeType() { return 1; }
    get childNodes() { return this.children; }
    get lastChild() { return this.children[this.children.length - 1] ?? null; }
    get lastElementChild() { return this.children[this.children.length - 1] ?? null; }
    getAttributeNames() { return []; }
    hasAttribute(name) { return name in this; }
    toggleAttribute(name, force = !this.hasAttribute(name)) { if (force) this.setAttribute(name, ''); else this.removeAttribute(name); return force; }
    // Tags, data attributes and :scope chains find descendants. Named page
    // elements keep the fixture's existing id lookup.
    querySelector(selector) {
      if (selector.startsWith(':scope') || selector.startsWith('[data-')) return this.querySelectorAll(selector)[0] ?? null;
      // 151's star painter finds its nested words in this link; an absent
      // descendant must not fabricate a document-level fixture element.
      if (selector === '.ol-dossier-words') {
        for (const child of this.children) {
          if (child.classList?.contains('ol-dossier-words')) return child;
          const inner = child.querySelector?.(selector); if (inner) return inner;
        }
        return null;
      }
      if (!/^[a-z][a-z0-9]*$/.test(selector)) return get(selector.slice(1));
      for (const child of this.children) { if (child.tagName?.toLowerCase() === selector) return child; const inner = child.querySelector?.(selector); if (inner) return inner; }
      return null;
    }
    // The rail's sideways strips are a phone layout this fixture does not draw.
    querySelectorAll(selector = '') {
      if (selector.startsWith('[data-')) {
        const found = [], walk = host => { for (const child of host.children) if (child instanceof Element) { if (isStep(child, selector)) found.push(child); walk(child); } };
        walk(this); return found;
      }
      // A list's entries, read as the reply stacks read them (':scope > [data-id], :scope > .reply-stack > [data-id]', reply-stacks.mjs), in the page's order.
      if (selector.startsWith(':scope')) {
        const chains = selector.split(',').map(chain => chain.split('>').slice(1).map(step => step.trim()));
        const found = [], walk = host => { for (const child of host.children) if (child instanceof Element) { if (chains.some(chain => inChain(child, chain, this))) found.push(child); walk(child); } };
        walk(this); return found;
      }
      return selector.includes('#topics') ? [] : [...elements.values()].filter(el => el.id?.startsWith('inline-') && el.id !== 'inline-composer');
    }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    getAttribute(name) { return this[name] ?? null; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    scrollBy(options) { this.scrollTop += options.top; events.push(['scroll', this.id, options]); }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    compareDocumentPosition(other) {
      if (other === this) return 0;
      let root = this; while (root.parent) root = root.parent;
      const order = [], walk = node => { order.push(node); for (const child of node.children ?? []) walk(child); }; walk(root);
      const at = order.indexOf(other); return at < 0 ? 1 : at > order.indexOf(this) ? 4 : 2;
    }
    closest(selector) { for (let at = this; at; at = at.parent) if (selector.startsWith('.') && isStep(at, selector)) return at; return null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    // Where it is on screen: wholly in view, unless a check places it (box).
    getBoundingClientRect() {
      const box = this.box ?? { top: 80, bottom: 120, height: 40, left: 0, right: 300, width: 300 };
      let offset = context.window.scrollY ?? 0;
      for (let at = this.parentElement; at; at = at.parentElement) offset += at.scrollTop;
      return { ...box, top: box.top - offset, bottom: box.bottom - offset };
    }
    // Shown unless it or what holds it is hidden.
    getClientRects() { for (let at = this; at; at = at.parent) if (at.hidden) return []; return [this.getBoundingClientRect()]; }
    replaceWith(next) { if (this.parent) { this.parent.insertBefore(next, this); this.remove(); } }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  // One step of a selector: a tag or classes, optionally with a data
  // attribute's presence or exact quoted/bare value.
  const isStep = (el, step) => {
    const data = step.match(/\[data-([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]$/);
    if (data) {
      const actual = el.dataset[data[1].replace(/-(.)/g, (_, c) => c.toUpperCase())], expected = data[2] ?? data[3] ?? data[4];
      if (actual === undefined || (expected !== undefined && String(actual) !== expected)) return false;
      step = step.slice(0, -data[0].length);
    }
    const [tag, ...classes] = step.split('.'), names = String(el.className ?? '').split(' ');
    return (tag === '' || el.tagName === tag.toUpperCase()) && classes.every(name => names.includes(name));
  };
  // Whether el is reached from root through these child steps.
  const inChain = (el, chain, root) => { let at = el; for (let i = chain.length - 1; i >= 0; i--, at = at.parent) if (!at || !isStep(at, chain[i])) return false; return at === root; };
  const document = { body: get('body'), documentElement: get('html'), activeElement: null, visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, getElementById: get,
    createElement: tag => Object.assign(new Element(), { tagName: String(tag).toUpperCase() }),
    // The bars' glyphs (glyphs.mjs) are svg elements.
    createElementNS: (ns, tag) => Object.assign(new Element(), { tagName: String(tag), namespaceURI: ns }), createTextNode: data => ({ nodeType: 3, data, textContent: data, children: [] }), querySelectorAll: s => s === '[data-unreached]' ? [...elements.values()].filter(el => 'unreached' in el.dataset) : [], querySelector: s => s.startsWith('meta') ? { content: 'fixture-session' } : get(s.slice(1)),
    addEventListener(name, fn, options) { events.push(['document-handler', name, fn, options]); },
    removeEventListener(name, fn) { const at = events.findIndex(([kind, n, f]) => kind === 'document-handler' && n === name && f === fn); if (at >= 0) events.splice(at, 1); },
    // The page's window, as a test may replace it, with the size watch the message bar keeps (message-menu.mjs).
    get defaultView() { return { ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, ...context.window }; } };
  get('reader-aside').append(readerArchive(document));
  const bootstrap = { instance_id: 'fixture', actor: 'fixture-person', actor_kind: 'human', authority: { id: 'a', epoch: 'e' } };
  const topic = { id: 't1', title: 'Fixture', workspace_id: 'w1' };
  const api = { bootstrap: async () => bootstrap, view: async (name, args) => {
    calls.push({ name, args });
    if (name === 'topic') return { instance_id: 'fixture', topic, participants: [] };
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { title: 'Workspace' } };
    if (name === 'workspace_counts') return { instance_id: 'fixture', items: args.workspace_ids.map(id => ({ id, unread: 0, addressed: 0, build: { unread: 0, addressed: 0 }, cover_waiting: 0, light: null })) };
    if (name === 'marks') return { instance_id: 'fixture', topic_id: args.topic_id, items: [], next_cursor: null };
    if (name === 'colors') return { instance_id: 'fixture', palette: [...AGENT_PALETTE], items: [], next_cursor: null };
    if (name === 'source' && args.source_ref?.kind === 'message' && views.messages.has(args.source_ref.id)) {
      return { instance_id: 'fixture', source_ref: args.source_ref, topic_id: topic.id, attachments: [], ...views.messages.get(args.source_ref.id) };
    }
    // An outcome to keep with no target and no checks yet, as Core answers for one (docs/targets.md).
    if (name === 'outcome_checks') return { instance_id: 'fixture', workspace_id: args.workspace_id, workspace_title: 'Workspace', owner: 'owner', coordinator: 'agent-a',
      you_own: false, you_steer: false, target: null, kind: { kind: 'keep', started_by: 'owner', started_ms: null, you_change: false }, word: null, failing_check: null,
      reached: null, reach: null, rounds: 'runs', counts: { passing: 0, failing: 0, measured: 0, holding: 0, not_run: 0, waiting: 0, total: 0 }, groups: [], loop: null,
      problems: null, releases: [], relevant_versions: { checks: 0, workspace: 1 } };
    // An outcome that homes and uses no skill or tool, as Core answers for one (docs/skills-and-tools.md).
    if (name === 'tools') return { instance_id: 'fixture', workspace_id: args.workspace_id, own: [], used: [], offer: [], reader_may_use: false };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  }, command: async envelope => { calls.push({ kind: envelope.kind, envelope }); return { recorded: true }; } };
  const editor = { key: 'inline', dirty: true, submissions: [], draft: { body: 'kept', addressees: [], attachments: [], caret: { start: 0, end: 0 } }, context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'topic', id: 't1' } } };
  const p = { surface: 'inline', initialized: true, topic, mode: 'reply', editors: { reply: editor } };
  const uploads = { current: () => [], running: new Map(), status: () => 'Ready' };
  const registry = { cards: new Map(), inline: p, current: null, sessions: new Map([[editor.key, { editor, underWay: () => false }]]), disposed: false,
    get interactive() { return this.current ?? this.inline; },
    isCurrent(p) { return !!p && this.interactive === p; }, isSourceCurrent(p) { return !!p && this.current?.source === p.source; },
    cancelSave(e) { events.push(['cancel', e.key]); }, schedule(e) { events.push(['schedule', e.key]); }, resumeHeld() { events.push(['resume-held']); return Promise.resolve(); },
    // The registry's own answers to when the writing was saved and which topic version its sends reached.
    savedTimes: new Map(), savedTime: EditorRegistry.prototype.savedTime, localTopicVersion: EditorRegistry.prototype.localTopicVersion,
    validateState(state, ref, topicId) { assert.equal(state.source_ref.id, ref.id); assert.equal(state.destination.topic_id, topicId); },
    pending() { return { items: [], next_cursor: null }; }, cancelOpen() { return false; },
    recoveryCandidates: async () => ({ items: [], nextCursor: null }), neighbors: async () => null,
    // Which replies are in doubt, and the Review buttons, are the registry's own answers, read over this fake's registered writings and pages.
    doubt(editor) { return EditorRegistry.prototype.doubt.call({ pages: { get: () => this.pending(editor) }, sessions: this.sessions, asides: this.asides }, editor); },
    asidesOf(editor) { return EditorRegistry.prototype.asidesOf.call({ pages: { get: () => this.pending(editor) }, sessions: this.sessions }, editor); },
    get keptAside() { return Object.getOwnPropertyDescriptor(EditorRegistry.prototype, 'keptAside').get.call(this); },
    get inDoubt() { return Object.getOwnPropertyDescriptor(EditorRegistry.prototype, 'inDoubt').get.call(this); },
    sessionFor() { return { uploads }; }, status() { return 'Saved'; }, saveSign() { return { state: 'saved', text: 'Saved' }; },
    cleanup: { foregroundListeners: new Set(), resumeListeners: new Set(), foreground() { return { read: action => action({}), release() { events.push(['release']); } }; },
      list: action => action({ readClass: 'foreground' }) },
    runtime: { current: bootstrap.authority },
  };
  const reader = { keepReplyVisible: RealReader.prototype.keepReplyVisible, narrow: { addEventListener() {} }, layoutChoice: null, notice: what => { showLine(get('reader-notice'), what); events.push(['reader-notice', lineText(what)]); }, paintOffer() {}, paintStatus() {}, hideUnavailableSource() {}, drawSource() {}, drawAttachments() {}, paintOrigin: source => events.push(['origin', source]), paintTitle: source => events.push(['title', source.title]) };
  const views = { scope: {}, messages: new Map(), retain() {}, messagesPage() { paints.push('messages'); }, memoryPage() { paints.push('memory'); }, readUnread: async () => true, readState: async () => true, placeAfresh() {}, sighted() {}, opened() {}, refreshKeys: () => [], refresh: async () => {}, keys: () => [], runOf: () => 1, showAlone: () => false, aloneItem: () => null };
  Object.assign(views, { instanceId: bootstrap.instance_id, topicId: topic.id, starRoots: new Set(), starSerial: 0,
    resetStars: TopicViews.prototype.resetStars, readStarred: TopicViews.prototype.readStarred, paint() {}, invalidate() {} });
  const fresh = { enabled: true, invalidate: (...args) => events.push(['invalidate', ...args]), request: async () => events.push(['request']), setVisible: () => events.push(['freshness-enabled']), schedule() {} };
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter(each => each !== target); }
  }
  const scope = { ...apiExports, ...writing, ...times, SessionRenewal, showLine, lineText, watchDays: options => { days.push(options); return () => {}; }, replyLine, paintReplyLine, placeNewLine, cardClass, paintCardColor, agentColor, AgentColors, openColorPicker, PageReads, PageHere, WritingInput, typingField, ReadThrough, Live, liveOffered, reloader, hasTitle, IntersectionObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } }, innerHeight: 600, innerWidth: 1000, Node: { DOCUMENT_POSITION_FOLLOWING: 4, TEXT_NODE: 3 }, requestAnimationFrame: callback => setImmediate(callback), cancelAnimationFrame: clearImmediate, crypto, setImmediate, readFailure, checkedView, bindingOf, currentImages, WRITING_FIELDS, noWriting, document, URL, URLSearchParams, TextEncoder, structuredClone, console,
    // The window's own location and history are the page's, as in a browser (the shell reads them there).
    window: { innerHeight: 600, scrollY: 0,
      getComputedStyle: el => ({ overflowY: 'visible', position: 'static', scrollPaddingTop: '0px', scrollPaddingBottom: '0px', ...el.style, getPropertyValue: () => '' }),
      scrollBy(options) { scope.window.scrollY += options.top; events.push(['scroll', 'window', options]); },
      addEventListener(name,fn) { events.push(['window-handler',name,fn]); }, matchMedia: () => ({ matches: false, addEventListener() {} }), get location() { return scope.location; }, get history() { return scope.history; } }, location: { href,assign:url=>events.push(['navigate',url]),reload:()=>events.push(['reload']) },
    // A page that loads another asks Theseus nothing more until it stays (api.mjs depart, stay); here each fixture's page says
    // so in its events, and the module every fixture shares goes on answering.
    depart: () => events.push(['depart']), stay: () => events.push(['stay']),
    Api: class { constructor() { return api; } }, openJournal: async () => { events.push(['journal']); return {}; },
    EditorRegistry: class { constructor(options) { events.push(['registry']); registry.options = options; return registry; } },
    Reader: class { constructor(callbacks) { reader.callbacks = callbacks; return reader; } },
    TopicViews: class { constructor({ paint, invalidate }) { Object.assign(views, { paint, invalidate }); return views; } }, Freshness: class { constructor(options) { fresh.options = options; return fresh; } },
    initialViews: async () => ({}), actorBaseline: async () => null, readableUploads() {}, uploadWork() {}, recoveryReadOnly: () => false, refusedCopyAtDraft() {}, refusedAtDraft() {}, PRIOR_PUBLICATION_NOTICE: '',
    openIntentJournal: async () => { events.push(['intent-journal']); throw Error('No browser intent storage in this fixture'); },
    openOpeningStore: async () => { events.push(['opening-store']); return { close() {} }; },
    OpeningDraft: class { constructor(o) { events.push(['opening-draft', { workspace: o.workspace, opening: o.opening, topic: o.topic }]); this.editable = false; }
      load() { events.push(['opening-load']); return Promise.resolve('editing'); } loadSource() { return Promise.resolve(); } leave() {} follow() { events.push(['opening-follow']); return Promise.resolve(true); } cancelSave() {} },
    OpeningView: class { constructor() { this.title = { focus() {} }; } run(action) { return Promise.resolve().then(action); } loadMembers() { return Promise.resolve(); } },
    UnfinishedOpenings: class { constructor(o) { events.push(['unfinished', o.workspace]); this.o = o; } load() { return this.o.read({ workspace_id: this.o.workspace, limit: 20 }); } } };
  const context = vm.createContext(Object.assign(scope, overrides));
  loadPageScope(context, 'app.mjs');
  let source = webSource('app.mjs').replace(/^import [^;]*;\n/gm, '');
  assert.equal(source.match(/^begin\(\);$/gm)?.length, 1); source = source.replace(/^begin\(\);$/m, '');
  vm.runInContext(source + `\nglobalThis.wiring = { initialize, begin, toggleMark, readPage, sourceAttachments, initializeInlineComposer, openSource, present, retrySource, checkAvailability, checkInlineAvailability, changed, paintViews, showVersions, discover, openSent, offerAuthor, run, updateStatus, readerDossierName, enableFreshness, loadOlderMessages,
    inject(value) { ({api,bootstrap,registry,reader,inline,topic,views,freshness}=value); marks = value.marks ?? marks; if ('outcomeMembers' in value) outcomeMembers = value.outcomeMembers; if ('topicUnavailable' in value) topicUnavailable = value.topicUnavailable; if ('stackFeed' in value) stackFeed = value.stackFeed; if ('here' in value) here = value.here; },
    useLive(value) { live = value; },
    inline(callbacks, options) { return new InlineComposer(callbacks, options); },
    get() { return {registry,inline,freshness,candidates,attention,outcomeRail,topicRail,outcomeScope,marks,commitReload,topicNavigation}; } };`, context);
  const inline = context.wiring.inline({ admits: p => registry.isCurrent(p), status: () => 'Saved', uploads: () => uploads,
    edit: editor => events.push(['inline-edit',editor.key]),
    needsReview: () => false, renderPending: (host, e) => { if (e.submissions.length) host.replaceChildren(new Element('inline-review')); } });
  // Initialize the real adapter; empty upload list is a deliberate fixture.
  inline.show(p);
  context.wiring.inject({ api, bootstrap, registry, reader, inline, topic, views, freshness: fresh,
    marks: new context.Marks({ api, instanceId: 'fixture', authority: () => bootstrap.authority, doc: null, win: null }) });
  const state = (ref = editor.context.sourceRef) => ({ instance_id: 'fixture', source_ref: ref, destination: { topic_id: 't1' }, source_available: true, destination_available: true });
  return { ...context.wiring, runObservation: source => vm.runInContext(source, context), makeInline:context.wiring.inline, owners: context.wiring.get, registry, reader, inline, topic, editor, p, api, fresh, get, events, calls, paints, state, bootstrap, views, document, observers, days };
}

// Outcome cards are a projection of the shell's real outline owner. Mount
// that owner beside the actual app initializer for the checks which follow
// its reads; the generic inline fixture otherwise mounts no shell rail.
function mountOutcomeOutline(f) {
  f.get('new-message').append(f.document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  f.get('topic-navigation').append(f.get('topics'), f.get('topics-status'), f.get('retry-topics'));
  return f.runObservation(`(() => {
    const outline = new OutlineRail({ host: document.getElementById('outline'),
      read: (name, args, readClass) => shell.view(name, args, readClass),
      open: (target, title) => shell.open(target, title) });
    shell.follow(outline);
    return outline;
  })()`);
}
const outcomeCards = f => walk(f.get('topic-navigation')).filter(node => node.classList?.contains('outcome-topic-card'));
const outcomeCardTitles = f => outcomeCards(f).map(card => card.children[0].textContent);

for (const [kind, query, workspace] of [['root', '/', null], ['workspace', '/?workspace=w1', 'w1']]) {
  test(`901 actual ${kind} initializer supplies shell handles and routes through the shared move callback`, async () => {
    const f = fixture('https://fixture' + query);
    const view = f.api.view;
    f.api.view = (name, args) => name === 'workspace' ? Promise.resolve({ instance_id: 'fixture', workspace: { id: 'w1', title: 'Workspace' } }) : view(name, args);
    f.runObservation(`globalThis.moves901 = []; shell.go = (target, still) => {
      moves901.push({ target, safe: still() }); return true;
    };`);
    await f.initialize(); await drain();
    assert.equal(f.runObservation('shell.handles?.workspaceId'), workspace);
    assert.equal(f.runObservation('shell.handles?.route.kind'), kind);
    assert.equal(f.get('rail').hidden, kind === 'root', 'the existing root/outcome presentation is kept');
    await f.runObservation("openDestination({ kind: 'topic', id: 't2' }, 'Next')");
    assert.deepEqual(JSON.parse(f.runObservation('JSON.stringify(moves901)')), [{ target: { kind: 'topic', id: 't2' }, safe: true }]);
    assert.equal(f.events.some(([event]) => event === 'navigate' || event === 'reload'), false);
    f.runObservation('shell.go = () => false');
    await f.runObservation("openDestination({ kind: 'pipeline', id: 'w1' }, 'Pipeline')");
    assert.deepEqual(f.events.filter(([event]) => event === 'navigate'), [['navigate', '?pipeline=w1']], 'unsupported moves retain the shared document-load fallback');
  });
}

// Item 859 put Team in the shared header. This fixture does not parse HTML;
// read that shipped placement as well as the app's live middle-page order.
const assertOutcomeTeamHeader = f => {
  const html = webSource('index.html'), header = html.match(/<header class="topic-header">([\s\S]*?)<\/header>/);
  assert.ok(header, 'the shared topic header exists');
  assert.match(header[1], /<section id="outcome-team" class="topic-people"[^>]*>[\s\S]*?id="team-people"[\s\S]*?<\/section>/);
  assert.ok(header.index < html.indexOf('id="outcome-page"'), 'Team in the header precedes the outcome middle');
  assert.equal(f.get('outcome-team').hidden, false, 'the outcome Team is shown');
  assert.equal(f.get('outcome-page').contains(f.get('outcome-team')), false, 'initialization keeps Team in the header');
};

test('876 inline fixture selects exact descendant data values and walks past text children', () => {
  const f = fixture(), host = f.document.createElement('div'), nested = f.document.createElement('div');
  const buttons = ['reply', 'aside', 'menu', ''].map(tool => Object.assign(f.document.createElement('button'), { dataset: { tool } }));
  const absent = f.document.createElement('button');
  host.append('before', buttons[0], nested); nested.append('between', ...buttons.slice(1), absent);
  assert.equal(walk(host).length, 6, 'text children do not become element descendants');
  assert.deepEqual(walk(host).map(node => node === nested ? 'nested' : buttons.indexOf(node)), [0, 'nested', 1, 2, 3, -1]);
  for (const [index, tool] of ['reply', 'aside', 'menu', ''].entries()) {
    for (const selector of [`[data-tool="${tool}"]`, `[data-tool='${tool}']`, ...(tool ? [`[data-tool=${tool}]`] : [])]) {
      assert.equal(host.querySelector(selector) === buttons[index], true, `${selector} finds its actual descendant`);
      assert.equal(host.querySelectorAll(selector).length, 1, `${selector} matches exactly one value`);
    }
  }
  assert.equal(nested.querySelector('[data-tool=reply]'), null, 'lookup stays inside its host');
  assert.equal(host.querySelector('[data-tool=missing]'), null, 'a missing value creates no fake global-id node');
  assert.equal(host.querySelectorAll('[data-tool]').length, 4, 'presence includes empty and excludes absent');
  assert.equal(host.querySelector(':scope > [data-tool=menu]'), null, 'direct-child scope excludes nested tools');
  assert.equal(host.querySelector(':scope > div > [data-tool=menu]') === buttons[2], true);
});

test('the inline fixture reveals an offscreen card through real window and scroller geometry', () => {
  const geometryTolerance = .5;
  for (const scroller of [false, true]) {
    const f = fixture(), host = f.get('messages'), card = f.document.createElement('article');
    host.append(card); card.box = { top: 950, bottom: 990, height: 40 };
    host.box = { top: 0, bottom: 600, height: 600 };
    const area = scroller ? host : f.document.documentElement;
    area.style = { scrollPaddingTop: '20px', scrollPaddingBottom: '40px' };
    if (scroller) { host.style.overflowY = 'auto'; host.scrollHeight = 1200; }
    revealSelection(card); card.focus();
    assert.equal(f.document.activeElement, card, 'the actual reveal leaves its landing card focusable');
    const scrolls = f.events.filter(event => event[0] === 'scroll');
    assert.equal(scrolls.length, 1);
    assert.equal(scrolls[0][1], scroller ? 'messages' : 'window');
    assert.equal(scrolls[0][2].behavior, 'instant');
    assert.ok(Math.abs(card.getBoundingClientRect().bottom - 506) <= geometryTolerance, `the padded viewport reveals the card with its buffer within ${geometryTolerance}px`);
  }
});

test('inline Ctrl-W uses the shared writing input path and preserves readonly writing', () => {
  const f=fixture(), field=f.get('inline-writing-body');
  f.editor.edit=patch=>Object.assign(f.editor.draft,patch);
  field.ownerDocument={execCommand:(command,_ui,text)=>{
    field.value=field.value.slice(0,field.selectionStart)+(command==='delete'?'':text)+field.value.slice(field.selectionEnd);
    field.handlers.input();return true;
  }};
  field.value=f.editor.draft.body='First line\nkeep remove';field.setSelectionRange(field.value.length,field.value.length);
  const event={key:'w',ctrlKey:true,prevented:false,preventDefault(){this.prevented=true;}};
  field.handlers.keydown(event);
  assert.equal(event.prevented,true,'inline Ctrl-W must invoke the writing command');
  assert.equal(field.value,'First line\nkeep ');assert.equal(f.editor.draft.body,field.value);
  f.editor.adopting=true;const kept=f.editor.draft.body;
  field.value='unadmitted change';field.handlers.input();
  assert.equal(field.value,kept);assert.equal(f.editor.draft.body,kept);
});

// A commit from the live feed, and everything the page reads after it.
const commit = async (live, seq) => { live.emit({ kind: 'commit', seq }); await drain(); };

test('outcome detail keeps transient choices, hides denied content, and recovers on the next commit', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream();
  mountOutcomeOutline(f);
  f.inject({ api:f.api, bootstrap:f.bootstrap }); f.useLive(live);
  let failure = null;
  f.api.view = async name => {
    if(name==='workspace') {
      if(failure) throw failure;
      return {instance_id:'fixture',workspace:{id:'w1',title:'Real outcome',purpose:'Purpose'}};
    }
    return {instance_id:'fixture',items:name==='workspace_topics'?[{...f.topic,activity_ms:1,list_position:1}]:[],next_cursor:null};
  };
  await f.initialize(); await drain();
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('topics').hidden,true,'the retired page topic list is hidden');
  assert.deepEqual(outcomeCardTitles(f),['Fixture'],'the shared outline supplies the visible card');
  failure = Object.assign(Error('Temporarily offline'),{code:'DATABASE_BUSY'});
  await commit(live, 2);
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.deepEqual(outcomeCardTitles(f),['Fixture'],'a transient failure preserves readable cards');
  failure = Object.assign(Error('Access denied'),{code:'FORBIDDEN'});
  await commit(live, 3);
  assert.equal(f.get('topic-navigation').hidden,true,'confirmed denial removes stale topic choices');
  assert.deepEqual(outcomeCards(f),[],'the outline publishes no cards while the outcome is denied');
  assert.equal(f.get('topic-title').textContent,'Outcome unavailable');
  assert.equal(f.get('topic-description').textContent,'');
  assert.equal(f.get('app-status').hidden,false);
  failure = null;await commit(live, 4);
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('app-status').hidden,true);
  assert.deepEqual(outcomeCardTitles(f),['Fixture'],'the recovered outline supplies the card again');
});

// Back from a refusal, the outcome's page comes back whole: its topics show
// once the commit's reads have painted what stands above them, so a topic does
// not move down under a pointer as each read lands.
test('an outcome page back from a refusal shows its topics only once what stands above them is painted again', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream();
  mountOutcomeOutline(f);
  f.inject({ api:f.api, bootstrap:f.bootstrap }); f.useLive(live);
  let denied = false;
  const held = new Map();
  let seq = 1, out = 0;
  f.api.view = async name => {
    out++;
    try {
      if (held.has(name)) await held.get(name).promise;
      if (name === 'workspace') {
        if (denied) throw Object.assign(Error('Access denied'), { code: 'FORBIDDEN' });
        return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome', purpose: 'Purpose' } };
      }
      return { instance_id: 'fixture', items: name === 'workspace_topics' ? [{ ...f.topic, activity_ms: 1, list_position: 1 }] : [], next_cursor: null };
    } finally { out--; }
  };
  // Every read the commit made has landed but the held one, and the page has done with what they brought.
  const settled = async () => { do await drain(); while (out > held.size); await drain(); };
  await f.initialize();
  const shown = () => ({ topics: !f.get('topic-navigation').hidden, standing: !f.get('outcome-standing').hidden });
  assert.deepEqual(shown(), { topics: true, standing: true });
  // Each read above the topics in turn: where it stands, and the list other outcomes' questions are read from.
  for (const name of ['outcome_light', 'workspaces']) {
    denied = true; await commit(live, ++seq);
    assert.deepEqual(shown(), { topics: false, standing: false }, 'a refused outcome hides its topics and where it stands');
    denied = false; const gate = defer(); held.set(name, gate);
    await commit(live, ++seq); await settled();
    assert.equal(shown().topics, false, `the outcome is back but its ${name} read is still out, yet the topics show and would move down when it lands`);
    held.delete(name); gate.resolve(); await drain();
    assert.deepEqual(shown(), { topics: true, standing: true }, `once the ${name} read lands, the page is back whole`);
  }
});
test('inline startup failure disables ownerless input but paints lists, enables freshness and keeps one registry on a commit', async () => {
  const f = fixture(), live = stream(); f.registry.inline = null; f.useLive(live);
  f.registry.initializeInline = async () => { throw Object.assign(Error('Read deadline expired'), { code: 'READ_TIMEOUT' }); };
  await f.initialize();
  assert.deepEqual(f.paints, ['messages','memory']); assert.equal(f.get('body').dataset.ready, 'true');
  assert.ok(f.events.some(e => e[0] === 'freshness-enabled'));
  assert.equal(f.get('inline-composer').hidden, false); assert.equal(f.get('inline-writing-body').disabled, true);
  assert.match(f.get('inline-notice').textContent, /Read deadline/); assert.equal(f.registry.inline, null);
  assert.equal(f.get('inline-send').disabled, true); assert.equal(f.get('inline-retry').hidden, false);
  await commit(live, 2);
  assert.equal(f.events.filter(e => e[0] === 'registry').length, 1); assert.equal(f.events.filter(e => e[0] === 'journal').length, 1);
  assert.equal(f.calls.some(c => c.kind), false);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.get('inline-retry').onclick();
  assert.equal(f.get('inline-writing-body').disabled, false); assert.equal(f.get('inline-writing-body').value, 'kept');
  assert.equal(f.get('inline-retry').hidden, true);
  assert.equal(f.events.filter(e => e[0] === 'registry').length, 1); assert.equal(f.events.filter(e => e[0] === 'journal').length, 1);
});
test('the rail\'s reads begin after the primary composer is initialized, and a topic page reads no list of outcomes and no outcome Notebook',async()=>{
  const f=fixture(),order=[],read=f.api.view;
  f.api.view=async(name,args)=>{order.push(name==='memory_items'?name+':'+args.owner_scope?.kind:name);return read(name,args);};
  f.registry.initializeInline=async()=>{order.push('composer');f.registry.inline=f.p;return f.p;};
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(order.includes('workspace_topics'));
  assert.ok(order.indexOf('composer')<order.indexOf('workspace_topics'));
  assert.equal(order.includes('workspaces'),false,'inside an outcome the rail shows only that outcome');
  // Item 464: the side rail lists no Notebook; the right rail reads the outcome's when it shows it (things-rail.mjs).
  assert.equal(order.includes('memory_items:workspace'),false,'the page reads no outcome Notebook for the side rail');
  assert.deepEqual(f.get('outcome-references-list').children,[],'and lists none');
});
test('a recheck replaces only the rechecked rows the page lists, at once, and only for an editor the registry still holds',async()=>{
  const f=fixture(),applied=[],validation=new Promise(()=>{});let holds=true;
  f.registry.initializeInline=async()=>{f.registry.inline=f.p;return f.p;};
  f.registry.recoveryCandidates=async()=>({items:[],nextCursor:null});
  f.registry.applyRecheck=(editor,ids,page)=>{applied.push([editor.key,ids,page.items.map(row=>row.id)]);return holds?validation:null;};
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  const listeners=[...f.registry.cleanup.resumeListeners];assert.equal(listeners.length,1);
  const {candidates}=f.owners(),row=id=>({id,stamp:id});
  candidates.set(f.editor.key,{items:[row('a'),row('r2'),row('u2'),row('r3')],nextCursor:'c3'});
  // The patch lands inside the listener call, before the image validation that follows it settles.
  // r2 moved to m2 when another tab recovered it.
  listeners[0]({editor:f.editor},['r2','r3'],{items:[{...row('r3'),stamp:'released'},row('m2')],nextCursor:null});
  assert.deepEqual(applied,[['inline',['r2','r3'],['r3','m2']]]);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('a'),row('u2'),{...row('r3'),stamp:'released'},row('m2')],nextCursor:'c3'},
    'retired rows leave, rechecked rows are replaced, a moved copy is added, and other rows and the next page stay');
  holds=false;
  listeners[0]({editor:f.editor},['a'],{items:[],nextCursor:null});
  assert.equal(candidates.get(f.editor.key).items.length,4,'an editor the registry no longer holds is left as it is');
});
// The Reader's data-discovered says the showing's discovery has finished (app.mjs present). Choosing Reply or Note keeps the
// showing, so its discovery still counts; a discovery for a source no longer shown, or overtaken by showing it again, never marks it.
test('the Reader marks discovery finished for the source it shows, through a Reply or Note choice, and never for one it left',async()=>{
  const f=fixture(),asked=[];
  f.registry.recoveryCandidates=()=>{const d=defer();asked.push(d);return d.promise;};
  f.registry.neighbors=async()=>null;f.registry.activity=()=>{};
  Object.assign(f.reader,{show(){},paintMark(){}});
  const presentation=id=>({surface:'reader',source:{source_ref:{kind:'message',id},topic_id:'t1',seq:1},editors:{reply:f.editor},mode:'reply'});
  const shown=async p=>{f.registry.current=p;await f.present(p);};
  const mark=()=>f.get('reader').dataset.discovered;
  const first=presentation('m1');await shown(first);
  assert.equal(mark(),undefined,'not before its discovery finishes');
  f.reader.presentation=EditorRegistry.prototype.setMode.call(f.registry,'note');
  assert.notEqual(f.reader.presentation,first);assert.equal(f.reader.presentation.source,first.source);
  asked.shift().resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),'true','a Reply or Note choice keeps the source, so its finished discovery marks it');
  const second=presentation('m2');await shown(second);
  assert.equal(mark(),undefined,'a newly shown source starts unmarked');
  const third=presentation('m3');await shown(third);
  asked.shift().resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),undefined,'a discovery for a source no longer shown does not mark the one shown');
  asked.shift().resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),'true');
  // The same source shown again: only its newer discovery marks it.
  await shown(third);
  assert.equal(mark(),undefined,'shown again, the source starts unmarked');
  await shown(third);
  asked.shift().resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),undefined,'an overtaken discovery does not mark the source');
  asked.shift().resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),'true');
});
test('the Reader marks discovery finished only when every editor\'s lookup has finished, a failed one included',async()=>{
  const f=fixture(),asked=new Map();
  f.registry.recoveryCandidates=editor=>{const d=defer();asked.set(editor.key,d);return d.promise;};
  f.registry.neighbors=async()=>null;f.registry.activity=()=>{};
  Object.assign(f.reader,{show(){},paintMark(){},notice(){}});
  const note={...f.editor,key:`${f.editor.key}-note`,kind:'note'};
  const p={surface:'reader',source:{source_ref:{kind:'message',id:'m1'},topic_id:'t1',seq:1},editors:{reply:f.editor,note},mode:'reply'};
  f.registry.current=p;await f.present(p);
  const mark=()=>f.get('reader').dataset.discovered;
  asked.get(f.editor.key).resolve({items:[],nextCursor:null});await drain();
  assert.equal(mark(),undefined,'the Reply lookup alone does not finish the showing\'s discovery');
  asked.get(note.key).reject(Error('journal read failed'));await drain();
  assert.equal(mark(),'true','the Note lookup failing still finishes it');
});
test('More versions adds its page to the listed copies, and a fresh discovery replaces them',async()=>{
  const f=fixture(),{candidates}=f.owners(),row=id=>({id,stamp:id}),asked=[];
  f.get('version-review').showModal=function(){this.open=true;};
  // As the registry does: a page from a cursor continues the list.
  f.registry.recoveryCandidates=async(editor,options,shown)=>{
    asked.push(options.cursor);
    const page=options.cursor==='c1'?{items:[row('b')],nextCursor:null}:{items:[row(options.cursor===null?'a':'c')],nextCursor:options.cursor===null?'c1':null};
    shown(page,Boolean(options.cursor));return page;
  };
  await f.showVersions(f.editor,f.get('opener'),f.p);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('a')],nextCursor:'c1'});
  const find=(element,text)=>element.textContent===text?element:element.children.map(child=>find(child,text)).find(Boolean);
  await find(f.get('review-content'),'More versions').onclick();
  assert.deepEqual(asked,[null,'c1']);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('a'),row('b')],nextCursor:null},'the first page stays listed after More versions');
  await f.discover(f.p,f.editor);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('c')],nextCursor:null},'a fresh discovery replaces the list');
});
test('a refused More versions page is reported in the review, keeps the list, and leaves More versions usable',async()=>{
  const f=fixture(),{candidates}=f.owners(),row=id=>({id,stamp:id});let refuse=true;
  f.get('version-review').showModal=function(){this.open=true;};
  f.registry.recoveryCandidates=async(editor,options,shown)=>{
    if(options.cursor&&refuse)throw Error('These saved versions changed. Review versions again.');
    const page=options.cursor?{items:[row('b')],nextCursor:null}:{items:[row('a')],nextCursor:'c1'};
    shown(page,Boolean(options.cursor));return page;
  };
  await f.showVersions(f.editor,f.get('opener'),f.p);
  f.get('review-retry').hidden=true;
  const find=(element,text)=>element.textContent===text?element:element.children.map(child=>find(child,text)).find(Boolean);
  const more=find(f.get('review-content'),'More versions');
  await more.onclick();
  assert.equal(f.get('review-status').textContent,'These saved versions changed. Review versions again.');
  assert.equal(f.get('review-status').hidden,false);assert.equal(f.get('review-retry').hidden,false);
  assert.equal(more.disabled,false,'More versions can be tried again');
  assert.ok(find(f.get('review-content'),'More versions'),'the button stays in the list');
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('a')],nextCursor:'c1'},'the listed copies are unchanged');
  refuse=false;await more.onclick();
  assert.equal(find(f.get('review-content'),'More versions'),undefined,'a page with no further cursor removes the button');
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))),{items:[row('a'),row('b')],nextCursor:null});
});
test('a More versions page the registry applied is drawn even when its settle fails, and its button is spent',async()=>{
  const f=fixture(),{candidates}=f.owners(),asked=[],row=id=>({id,stamp:id,availability:'open-in-another-tab'});
  f.get('version-review').showModal=function(){this.open=true;};
  f.registry.recoveryCandidates=async(editor,options,shown)=>{
    asked.push(options.cursor);
    const page=options.cursor==='c1'?{items:[row('b')],nextCursor:'c2'}:{items:[row(options.cursor?'c':'a')],nextCursor:options.cursor?null:'c1'};
    shown(page,Boolean(options.cursor));
    if(options.cursor==='c1')throw Error('editor_state read failed');
    return page;
  };
  await f.showVersions(f.editor,f.get('opener'),f.p);
  f.get('review-retry').hidden=true;
  const all=(element,text)=>[...(element.textContent===text?[element]:[]),...element.children.flatMap(child=>all(child,text))];
  const first=all(f.get('review-content'),'More versions')[0];
  await first.onclick();
  assert.equal(f.get('review-status').textContent,'editor_state read failed');assert.equal(f.get('review-retry').hidden,false);
  assert.equal(all(f.get('review-content'),'Open in another tab').length,2,'the applied page is drawn');
  const more=all(f.get('review-content'),'More versions');
  assert.equal(more.length,1,'the spent button is replaced by the next page\'s');assert.notEqual(more[0],first);
  await more[0].onclick();
  assert.deepEqual(asked,[null,'c1','c2'],'the next page continues from the applied page\'s cursor');
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.get(f.editor.key))).items.map(item=>item.id),['a','b','c']);
});
test('a More versions page that fails after its review was replaced leaves the new review alone',async()=>{
  const f=fixture(),row=id=>({id,stamp:id,availability:'open-in-another-tab'});let fail;
  f.get('version-review').showModal=function(){this.open=true;};
  f.registry.recoveryCandidates=async(editor,options,shown)=>{
    if(options.cursor)return new Promise((_resolve,reject)=>{fail=reject;});
    const page={items:[row('a')],nextCursor:'c1'};shown(page,false);return page;
  };
  await f.showVersions(f.editor,f.get('opener'),f.p);
  const find=(element,text)=>element.textContent===text?element:element.children.map(child=>find(child,text)).find(Boolean);
  const pending=find(f.get('review-content'),'More versions').onclick();
  await f.showVersions(f.editor,f.get('opener'),f.p);
  f.get('review-retry').hidden=true;
  fail(Error('old page failed'));await pending;
  assert.equal(f.get('review-status').textContent,'','the new review shows no error from the old one');
  assert.equal(f.get('review-retry').hidden,true);
});
// recovery.authority is set only once both the runtime and the saved version
// were read; whether the review then is ready or blocked, that read stands.
test('a runtime review shows the saved version it read, ready or blocked, and calls it unavailable only when unread',async()=>{
  const authority={authority_id:'a2',authority_epoch:'e2'},saved={id:'d1',revision:3,body:'Saved in the new runtime'};
  const all=(element,text)=>[...(element.textContent===text?[element]:[]),...element.children.flatMap(child=>all(child,text))];
  const unavailable='Saved version unavailable. Retry to read it; your writing is kept.';
  for (const [phase,read,remote,shown] of [['blocked',true,saved,saved.body],['ready',true,saved,saved.body],['ready',true,null,'No saved version here'],
      ['blocked',true,null,'No saved version here'],['parked',false,null,unavailable],['loading',false,null,unavailable],['error',false,null,unavailable]]) {
    const f=fixture();f.get('version-review').showModal=function(){this.open=true;};
    f.registry.recoveryCandidates=async()=>({items:[],nextCursor:null});
    f.editor.authorityRecovery={phase,authority:read?authority:null,remote,message:`Review ${phase}`};
    await f.showVersions(f.editor,f.get('opener'),f.p);
    assert.equal(all(f.get('review-content'),shown).length,1,`${phase} ${read?'read':'unread'} shows ${shown}`);
    if (shown!==unavailable) assert.equal(all(f.get('review-content'),unavailable).length,0,`${phase} after a read never says unavailable`);
  }
});
test('the first page of a review is drawn when the registry applied it and its settle then failed',async()=>{
  const f=fixture(),row=id=>({id,stamp:id,availability:'open-in-another-tab'});
  f.get('version-review').showModal=function(){this.open=true;};
  f.registry.recoveryCandidates=async(editor,options,shown)=>{shown({items:[row('a')],nextCursor:'c1'},false);throw Error('editor_state read failed');};
  await f.showVersions(f.editor,f.get('opener'),f.p);
  const all=(element,text)=>[...(element.textContent===text?[element]:[]),...element.children.flatMap(child=>all(child,text))];
  assert.equal(f.get('review-status').textContent,'editor_state read failed');
  assert.equal(all(f.get('review-content'),'Open in another tab').length,1,'the applied page is drawn');
  assert.equal(all(f.get('review-content'),'More versions').length,1,'with its More versions');
  assert.equal(f.get('review-retry').hidden,false);
});
test('actual home wordmark, Outcomes and topic links preserve dirty writing before same-tab departure',async()=>{
  const f=fixture(),read=f.api.view;
  f.registry.initializeInline=async()=>{f.registry.inline=f.p;return f.p;};
  f.registry.keepEditorsLocal=async()=>{};
  Object.assign(f.editor,{localVersion:1,ackVersion:0});Object.defineProperty(f.editor,'dirty',{get:()=>f.editor.ackVersion<f.editor.localVersion});
  f.registry.flush=async()=>({recorded:false,status:'unknown'});
  f.api.view=async(name,args)=>name==='workspace_topics'?{instance_id:'fixture',items:[{id:'t2',title:'Second',workspace_id:'w1',activity_ms:1,list_position:1}],next_cursor:null}:read(name,args);
  await f.initialize();await drain();
  const row=()=>f.get('topics').children.find(child=>child.dataset?.topicId==='t2');
  for(const control of [f.get('outcomes-home'),f.get('wordmark'),row()]){
    assert.ok(control);let prevented=false;await control.onclick({button:0,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(f.events.some(e=>e[0]==='navigate'),false);assert.equal(f.editor.draft.body,'kept');
    assert.match(f.get('topic-navigation-status').textContent,/not confirmed saved/);
    await control.onclick({button:0,metaKey:true,preventDefault(){throw Error('modified link intercepted');}});
  }
  f.registry.flush=async()=>{f.editor.ackVersion=1;return {recorded:true,status:'committed'};};
  await row().onclick({button:0,preventDefault(){}});
  assert.deepEqual(f.events.filter(e=>e[0]==='navigate'),[['navigate','?topic=t2']]);
});
test('outcome reloads are sequenced so an older denial cannot repaint a newer result',async()=>{
  const f=fixture('https://fixture/?workspace=w1'),held=defer(),live=stream();let count=0;
  f.inject({api:f.api,bootstrap:f.bootstrap});f.useLive(live);
  f.api.view=async name=>{
    if(name==='workspace'){count++;if(count===2)return held.promise;return {instance_id:'fixture',workspace:{id:'w1',title:count===1?'Initial':'New title',purpose:''}};}
    return {instance_id:'fixture',items:[],next_cursor:null};
  };
  await f.initialize();live.emit({kind:'commit',seq:2});live.emit({kind:'commit',seq:3});await drain();
  held.resolve({instance_id:'fixture',error:{code:'FORBIDDEN',message:'Old denial'}});await drain();
  assert.equal(count,3,'the second commit reads again after the first');
  assert.equal(f.get('topic-title').textContent,'New title');assert.equal(f.get('topic-navigation').hidden,false);assert.equal(f.get('app-status').hidden,true);
});

test('failed inline-origin open is global; failed Reader step remains in its Reader notice', async () => {
  const f = fixture(); f.registry.open = async () => { throw Error('Source could not open'); };
  await f.openSource({ kind: 'message', id: 'm1' });
  assert.equal(f.get('app-status').textContent, 'Source could not open');
  assert.equal(f.get('app-status').hidden, false);
  f.registry.current = { source: {}, editors: {}, mode: 'reply' };
  await f.openSource({ kind: 'message', id: 'm2' });
  assert.ok(f.events.some(e => e[0] === 'reader-notice' && e[1] === 'Source could not open'));
  assert.equal(f.get('app-status').hidden, true);
});

test('Reader Retry updates source access without touching inline flags/save, also when closed mid-read', async () => {
  for (const close of [false, true]) {
    const f = fixture(), read = defer();
    const source = { source_ref: { kind: 'message', id: 'm1' }, body: 'Original source' };
    const modal = { source, sourceUnavailable: false, availabilityUnconfirmed: true, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
    f.registry.current = modal;
    f.api.view = async (name, args) => { f.calls.push({ name, args }); if (name === 'source') { await read.promise; return { ...source, instance_id: 'fixture' }; } return f.state(args.source_ref); };
    const running = f.retrySource();
    if (close) f.registry.current = null;
    read.resolve(); await running;
    assert.equal(f.p.availabilityUnconfirmed, undefined); assert.equal(f.p.availabilityChecking, undefined);
    assert.equal(f.events.some(e => e[0] === 'cancel' && e[1] === 'inline'), false);
    assert.equal(f.calls.some(c => c.args?.source_ref?.kind === 'topic'), false);
    if (!close) { assert.equal(modal.availabilityUnconfirmed, false); assert.equal(modal.editors.reply.unavailable, false); }
  }
});

test('a source that comes back on Retry gets its whole origin line and its title again, time included', async () => {
  const f = fixture();
  const source = { source_ref: { kind: 'memory', id: 'n1', revision: 2 }, title: 'Release plan', author: 'tony', body: '', sent_ms: 1762350240000 };
  const modal = { source: { ...source, title: 'Source unavailable' }, sourceUnavailable: true, availabilityUnconfirmed: false, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
  f.registry.current = modal;
  f.api.view = async (name, args) => name === 'source' ? { ...source, body: 'Back again', instance_id: 'fixture' } : f.state(args.source_ref);
  await f.retrySource();
  const painted = f.events.filter(e => e[0] === 'origin');
  assert.equal(painted.length, 1);
  assert.deepEqual([painted[0][1].author, painted[0][1].sent_ms, modal.sourceUnavailable], ['tony', 1762350240000, false]);
  assert.deepEqual(f.events.filter(e => e[0] === 'title'), [['title', 'Release plan']], 'the Notebook title comes back with the text');
  assert.equal(modal.source.title, 'Release plan');
  f.events.length = 0;
  await f.retrySource();
  assert.equal(f.events.some(e => e[0] === 'origin' || e[0] === 'title'), false, 'a source that never went away keeps its line');
});

// A source check that ends while another open is under way is still over:
// coming back to the source, Retry access works.
test('a source check that ends while another source is open leaves Retry access usable on coming back', async () => {
  const f = fixture(), gate = defer();
  const source = { source_ref: { kind: 'message', id: 'm1' }, author: 'tony', body: '', attachments: [] };
  const first = { source: { ...source }, sourceUnavailable: true, availabilityUnconfirmed: false, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
  const other = { source: { source_ref: { kind: 'message', id: 'm2' } }, editors: { reply: {}, note: {} } };
  f.registry.current = first;
  let reads = 0;
  f.api.view = async (name, args) => { if (name === 'source') { reads++; await gate.promise; return { ...source, body: 'Back', instance_id: 'fixture' }; } return f.state(args.source_ref); };
  const checking = f.retrySource();
  assert.equal(first.availabilityChecking, true);
  f.registry.current = other;
  gate.resolve(); await checking;
  assert.equal(first.availabilityChecking, false, 'the check is over');
  f.registry.current = first;
  await f.retrySource();
  assert.equal(reads, 2, 'Retry access reads the source again');
});

// Writing begun while access was being checked keeps the focus; with nothing
// else holding it, the focus goes to the source or to Retry access.
test('a finished access check moves the focus only when nothing else holds it', async () => {
  for (const [held, refused, expected] of [['writing-body', false, 'writing-body'], ['writing-body', true, 'writing-body'], [null, false, 'source-body'], [null, true, 'retry-source'], ['retry-source', false, 'source-body']]) {
    const f = fixture();
    const source = { source_ref: { kind: 'message', id: 'm1' }, author: 'tony', body: '', attachments: [] };
    f.registry.current = { source: { ...source }, sourceUnavailable: true, availabilityUnconfirmed: false, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
    f.api.view = async (name, args) => {
      if (name !== 'source') return f.state(args.source_ref);
      f.document.activeElement = held === null ? null : f.get(held);
      if (refused) throw Object.assign(Error('Forbidden'), { code: 'FORBIDDEN' });
      return { ...source, body: 'Back', instance_id: 'fixture' };
    };
    await f.retrySource();
    assert.equal(f.document.activeElement?.id, expected, JSON.stringify({ held, refused }));
  }
});

// After access returns the Reader clears its paused note.1045 retains the cursor
// and removes the old button; actual native scrolling is checked separately.
test('a topic painted again after access returns clears the paused note and retains its older cursor', async () => {
  const f = fixture();
  await f.initialize(); await drain();
  const p = { source: { source_ref: { kind: 'message', id: 'm1' } }, topicUpdatesPaused: true, editors: { reply: {}, note: {} } };
  f.registry.current = p;
  let painted = 0; f.reader.paintStatus = () => { painted++; };
  f.views.topic = { ...f.topic }; f.views.participants = []; f.views.olderCursor = 'older';
  f.paintViews('topic');
  assert.equal(p.topicUpdatesPaused, false);
  assert.equal(painted, 1, 'the Reader repaints what it says');
  assert.equal(f.views.olderCursor, 'older');
  // Nothing older to read remains an exhausted cursor.
  f.views.olderCursor = null; p.topicUpdatesPaused = false;
  f.paintViews('topic');
  assert.equal(f.views.olderCursor, null);
  assert.equal(painted, 1, 'a Reader that was not paused is left alone');
});

// A restarted server refuses the page's session; the page takes the new one
// in place and goes on (docs/scoped-updates.md).
const restartable = renewals => {
  // reopen: the real one lets its socket go and says the feed is down until a new one answers.
  const live = { ...stream(), wakes: 0, reopens: 0, token: null, start() {}, wake() { this.wakes++; }, reopen() { this.reopens++; this.emit({ kind: 'state', state: 'down' }); } };
  const answers = [];
  const f = fixture('https://fixture/?topic=t1', {
    Live: class { constructor({ token }) { live.token = token; return live; } },
    // 'renewed' gives the page's reads a new session, as the real renewal does.
    SessionRenewal: class { constructor(options) { renewals.push(options); this.api = options.api; }
      // The server answering with its session is an answer, as session-renewal.mjs records it.
      renew() { const answer = answers.shift() ?? null; if (answer) apiExports.answered(); if (answer === 'renewed') this.api.token = 'session-' + renewals.length + '-' + answers.length; return Promise.resolve(answer); } } });
  f.bootstrap.transport = { ...f.bootstrap.transport, live: { version: 2, path: '/api/live', protocol: 'theseus-live.v1' } };
  return { f, live, answers };
};

test('a live feed refused for its session renews it in place: the feed opens again, waiting saves go out, and the lost connection\'s message clears', async () => {
  const renewals = [], { f, live, answers } = restartable(renewals);
  await f.initialize(); await drain();
  assert.equal(renewals.length, 1);
  assert.equal(live.token, 'fixture-session');
  const lost = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
  await f.run(async () => { throw new AttemptError(lost); });
  assert.equal(f.get('app-status').textContent, lost);
  // The server is not back yet: nothing changes.
  f.events.length = 0; live.emit({ kind: 'refused' }); await drain();
  assert.deepEqual([live.reopens, f.events.filter(e => e[0] === 'schedule').length, f.get('app-status').textContent], [0, 0, lost]);
  // Back, with a new session.
  answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.equal(live.reopens, 1, 'the feed opens again at once, under the new session');
  assert.deepEqual(f.events.filter(e => e[0] === 'schedule'), [['schedule', 'inline']], 'the waiting save goes out');
  assert.equal(f.get('app-status').hidden, true);
  // Back with the same session (it was not a restart): nothing to resume.
  f.events.length = 0; answers.push('current'); live.emit({ kind: 'refused' }); await drain();
  assert.deepEqual([live.reopens, f.events.filter(e => e[0] === 'schedule').length], [1, 0]);
  // Access a check could not confirm while the session was refused is checked again.
  f.registry.current = { source: { source_ref: { kind: 'message', id: 'm1' } }, availabilityUnconfirmed: true, editors: { reply: {}, note: {} } };
  f.events.length = 0; answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.deepEqual(f.events.filter(e => e[0] === 'invalidate' && e[1] === 'availability').length, 1);
  f.registry.current.availabilityUnconfirmed = false;
  f.events.length = 0; answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.equal(f.events.some(e => e[0] === 'invalidate' && e[1] === 'availability'), false, 'confirmed access is not checked again');
});

// Held replies go on whenever the page reaches Theseus with the session it
// holds: a new one, the one it has, or its live feed up again; not while
// Theseus is away.
test('reaching Theseus again resumes held replies, and nothing does while the server is away', async () => {
  const renewals = [], { f, live, answers } = restartable(renewals);
  await f.initialize(); await drain();
  const resumed = () => f.events.filter(e => e[0] === 'resume-held').length;
  live.emit({ kind: 'refused' }); live.emit({ kind: 'state', state: 'down' }); await drain();
  assert.equal(resumed(), 0, 'not while the server is away');
  answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.equal(resumed(), 1);
  answers.push('current'); f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.equal(resumed(), 2);
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(resumed(), 3, 'the live feed back up');
});

// Reconnect pressed while Theseus is not answering says so; the page then
// reconnects by itself, and the line saying it is not answering goes with it.
// A line about anything else stays.
test('the not-answering line from Reconnect clears when the page reconnects by itself', async () => {
  const renewals = [], { f, live, answers } = restartable(renewals);
  await f.initialize(); await drain();
  f.updateStatus({ kind: 'reconnect' }); await drain();
  await f.get('updates-retry').onclick(); await drain();
  assert.match(f.get('app-status').textContent, /not answering yet/);
  answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.equal(f.get('app-status').hidden, true, f.get('app-status').textContent);
  // Up again by its live feed alone (the session was the server's): the same.
  f.updateStatus({ kind: 'reconnect' }); await drain();
  await f.get('updates-retry').onclick(); await drain();
  assert.match(f.get('app-status').textContent, /not answering yet/);
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(f.get('app-status').hidden, true, f.get('app-status').textContent);
  // A line about something else that took its place stays.
  f.updateStatus({ kind: 'reconnect' }); await drain();
  await f.get('updates-retry').onclick(); await drain();
  await f.run(async () => { throw new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } }); });
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(f.get('app-status').textContent, 'This topic is closed.');
});

// Whoever writes a line, a failure to reach Theseus goes to it as the error
// itself, and the line goes once the page reaches Theseus: a message that could
// not open (on the page's status line, or in the Reader when the Reader asked),
// and a composer read. A message Core refused to open stays.
test('a line that says only that Theseus could not be reached goes once the page reaches it, wherever it was written', async () => {
  const renewals = [], { f, live, answers } = restartable(renewals);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize(); await drain();
  const lost = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
  const lines = () => ['app-status', 'reader-notice', 'inline-notice'].map(id => f.get(id).hidden ? '' : f.get(id).textContent);
  const fail = () => {
    f.registry.open = async () => { throw new AttemptError(lost); };
    f.registry.recoveryCandidates = async () => { throw new AttemptError(lost); };
  };
  const writeAll = async () => {
    f.registry.current = { source: {}, editors: {}, mode: 'reply' };
    await f.openSource({ kind: 'message', id: 'm2' });
    f.registry.current = null;
    await f.openSource({ kind: 'message', id: 'm1' });
    await f.discover(f.p, f.editor);
  };
  fail(); await writeAll();
  assert.deepEqual(lines(), [lost, lost, lost], 'each line says the connection was interrupted');
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.deepEqual(lines(), ['', '', ''], 'the live feed back up');
  await writeAll();
  answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.deepEqual(lines(), ['', '', ''], 'a renewed session');
  f.registry.open = async () => { throw new AttemptError('Source could not open', 404, { error: { code: 'NOT_FOUND', message: 'Source could not open' } }); };
  await f.openSource({ kind: 'message', id: 'm1' });
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(f.get('app-status').textContent, 'Source could not open', 'a refusal Core answered stays');
});

// Item 547: the Reader's Mark unread that Theseus answered busy, or for a session
// a restart dropped, says what it answered, never a lost connection.
test('the Reader\'s mark that Theseus answered without taking says what it answered, never a lost connection', async () => {
  const renewals = [], { f } = restartable(renewals);
  await f.initialize(); await drain();
  const said = id => f.get(id).hidden ? '' : f.get(id).textContent;
  const answers = {
    busy: [503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } }, 'The mark was not saved: Theseus was busy. Press again to send the same request.'],
    unconfirmed: [500, { error: { code: 'REQUEST_UNCONFIRMED', message: 'The request could not be confirmed; reconcile its operation.' } }, 'Not known whether the mark was saved: Theseus could not confirm it. Press again to send the same request.'],
  };
  for (const [name, [status, body, words]] of Object.entries(answers)) {
    const api = new RealApi('fixture-session', async () => new Response(JSON.stringify(body), { status }));
    f.registry.current = { source: { source_ref: { kind: 'message', id: 'm5' }, topic_id: 't1', seq: 5 }, mark: { marked: false, mark_revision: 0 }, editors: { reply: {}, note: {} } };
    f.owners().marks.learn('m5', 0, { topicId: 't1', seq: 5 });
    const command = f.api.command;
    f.api.command = envelope => api.command(envelope);
    await f.toggleMark(); await drain();
    f.api.command = command;
    assert.equal(said('reader-notice'), words, `${name}: the Reader says what Theseus answered`);
  }
});

// However a failure to reach Theseus was put into words on its way to a line
// (a Notebook page's read, a mark, an attachment, the composer), the line goes
// once Theseus answers, and what the page could not do for want of it
// is done again. Theseus is down behind Tailscale Serve, which answers 502
// with an empty body, or nothing answers; the real Api says what came back.
test('a line a caller put into words goes once the page reaches Theseus, and a page read or a composer that met no Theseus is done again', async () => {
  const down = {
    proxy: new RealApi('fixture-session', async () => new Response('', { status: 502 })),
    nothing: new RealApi('fixture-session', async () => { throw new TypeError('Failed to fetch'); }),
  };
  const theseus = new RealApi('fixture-session', async () => new Response(JSON.stringify({ recorded: false, error: { code: 'CONFLICT', message: 'Core refused this.' } }), { status: 409 }));
  for (const [name, api] of Object.entries(down)) {
    const renewals = [], { f, live, answers } = restartable(renewals);
    await f.initialize(); await drain();
    const said = id => f.get(id).hidden ? '' : f.get(id).textContent;
    // Theseus comes back, by its live feed or a renewed session, and is away again before the next case.
    const back = async how => { if (how === 'renewed') answers.push('renewed'), live.emit({ kind: 'refused' }); else live.emit({ kind: 'state', state: 'live' }); await drain(); await drain(); live.emit({ kind: 'state', state: 'down' }); await drain(); };
    const command = f.api.command, view = f.api.view;
    for (const how of ['live', 'renewed']) {
      // A mark pressed in the Reader.
      f.registry.current = { source: { source_ref: { kind: 'message', id: 'm5' }, topic_id: 't1', seq: 5 }, mark: { marked: false, mark_revision: 0 }, editors: { reply: {}, note: {} } };
      f.owners().marks.learn('m5', 0, { topicId: 't1', seq: 5 });
      f.api.command = envelope => api.command(envelope);
      await f.toggleMark(); await drain();
      assert.match(said('reader-notice'), /whether the mark was saved is unknown/, `${name}: the mark says so`);
      f.api.command = command;
      await back(how);
      assert.equal(said('reader-notice'), '', `${name}, ${how}: the reader notice still says what the restart did`);
      // An attachment opened in the Reader.
      const shown = { source: { source_ref: { kind: 'message', id: 'm6' }, topic_id: 't1', attachments: [{ id: 'a1', name: 'photo.png' }] }, editors: { reply: {}, note: {} } };
      f.registry.current = shown; f.get('source-attachments').replaceChildren();
      f.api.media = (...args) => api.media(...args);
      f.sourceAttachments(shown);
      await f.get('source-attachments').children[0].children[0].onclick(); await drain();
      assert.match(said('reader-notice'), /^photo\.png: /, `${name}: the attachment says so`);
      await back(how);
      assert.equal(said('reader-notice'), '', `${name}, ${how}: the attachment's line still says what the restart did`);
      // A Notebook page that came forward: read again once Theseus is back, and what changed since is shown.
      const page = { source: { source_ref: { kind: 'memory', id: 'n1', revision: 3 }, body: 'Now' }, editors: { reply: {}, note: {} } };
      f.registry.current = page;
      const reads = [], changes = [];
      f.reader.showChanges = (since, before, after) => changes.push([since, before, after]);
      f.api.command = envelope => { reads.push(envelope.kind); return api.command(envelope); };
      await f.readPage(page); await drain();
      assert.match(said('reader-notice'), /this page may still show as changed/, `${name}: the page read says so`);
      f.api.command = async envelope => { reads.push(envelope.kind); return { recorded: true, status: 'committed', operation_id: envelope.operation_id, result: { previous_revision: 2 } }; };
      f.api.view = async (viewName, args) => viewName === 'source' ? { instance_id: 'fixture', body: 'Before' } : view(viewName, args);
      await back(how);
      assert.equal(said('reader-notice'), '', `${name}, ${how}: the page read's notice still says what the restart did`);
      assert.deepEqual([reads, changes], [['memory.read', 'memory.read'], [[2, 'Before', 'Now']]], `${name}, ${how}: the page is read again once Theseus is back`);
      // Read, but what changed since could not be read: the same.
      reads.length = 0; changes.length = 0;
      f.api.view = (viewName, args) => viewName === 'source' ? api.view(viewName, args) : view(viewName, args);
      await f.readPage(page); await drain();
      assert.match(said('reader-notice'), /^What changed since revision 2 could not be read\. /, `${name}: what changed since says so`);
      f.api.view = async (viewName, args) => viewName === 'source' ? { instance_id: 'fixture', body: 'Before' } : view(viewName, args);
      await back(how);
      assert.equal(said('reader-notice'), '', `${name}, ${how}: what changed since still says what the restart did`);
      assert.deepEqual([reads, changes], [['memory.read', 'memory.read'], [[2, 'Before', 'Now']]], `${name}, ${how}: what changed since is read again once Theseus is back`);
      f.api.command = command; f.api.view = view; delete f.api.media;
      // The composer's access, checked again by Retry access.
      f.registry.current = null; f.registry.inline = f.p; f.owners().inline.show(f.p);
      f.api.view = (viewName, args) => api.view(viewName, args);
      await f.get('inline-retry').onclick(); await drain();
      assert.match(said('inline-notice'), /^Could not confirm topic access\. Your writing is kept\. /, `${name}: the composer's access says so`);
      f.api.view = view;
      await back(how);
      assert.equal(said('inline-notice'), '', `${name}, ${how}: the composer's access line still says what the restart did`);
      // An image picked from #img whose bytes could not be read: its name and why.
      f.api.media = (...args) => api.media(...args);
      await f.owners().inline.pickImage({ attachment: { id: 'a2', name: 'board.png' }, source_ref: { kind: 'message', id: 'm7' } }); await drain();
      assert.match(said('inline-notice'), /^board\.png: /, `${name}: the picked image says so`);
      delete f.api.media;
      await back(how);
      assert.equal(said('inline-notice'), '', `${name}, ${how}: the picked image's line still says what the restart did`);
      // The topic's composer.
      let tries = 0;
      f.registry.inline = null;
      f.registry.initializeInline = async () => { if (++tries === 1) await api.view('topic', {}); f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
      await f.initializeInlineComposer(); await drain();
      assert.match(said('inline-notice'), /^New message is unavailable\./, `${name}: the composer says so`);
      await back(how);
      assert.deepEqual([said('inline-notice'), tries], ['', 2], `${name}, ${how}: the composer is loaded again once Theseus is back`);
    }
    // Theseus answered: the line stays, and nothing is done again.
    f.registry.current = { source: { source_ref: { kind: 'memory', id: 'n2', revision: 3 }, body: 'Now' }, editors: { reply: {}, note: {} } };
    let reads = 0;
    f.api.command = envelope => { reads++; return theseus.command(envelope); };
    await f.readPage(f.registry.current); await drain();
    await back('live');
    assert.deepEqual([said('reader-notice'), reads], ['Core refused this. It may still show as changed.', 1], `${name}: a refusal Theseus answered stays, and is not read again`);
    f.api.command = command;
  }
});

// The reviewer's cases (rounds 4 and 5). The live feed is back and quiet. A
// read still out when it came back that then runs out on a stalled connection
// leaves no line while the page is connected, and the feed is left alone; if
// the feed then goes down with nothing answered since, the line says so. A
// read or request begun after the feed's last answer that gets none is a
// reason to doubt the feed: the page opens it again and says what happened
// until anything answers, a request as much as the feed. What a failure held
// up is done again once Theseus has answered since its attempt began: at once
// for one still out when the feed came back; for one begun after, at the next
// answer of any kind, never only at a reconnection.
test('a connection line shows only while the page is not connected and nothing has answered since; what it held up goes at the next answer', async () => {
  const timedOut = 'Reader request timed out. Your writing is kept.', lost = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
  const renewals = [], { f, live } = restartable(renewals);
  await f.initialize(); await drain();
  const said = id => f.get(id).hidden ? '' : f.get(id).textContent;
  const feed = async up => { live.emit({ kind: 'state', state: up ? 'live' : 'down' }); await drain(); await drain(); };
  const nothing = new RealApi('fixture-session', async () => { throw new TypeError('Failed to fetch'); });
  const theseus = new RealApi('fixture-session', async () => new Response(JSON.stringify({ instance_id: 'fixture', items: [] }), { status: 200 }));
  // A Reader read the page bounds, on a connection that stays stalled until the page aborts it; the gate says when its time is up.
  let gate;
  const stalled = new RealApi('fixture-session', (path, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })));
  f.registry.open = () => { const deadline = new Deadline(0, timedOut), request = stalled.view('source', {}, { signal: deadline.signal }); return gate.promise.then(() => deadline.bound(request)); };
  const open = async (current, id) => { gate = defer(); f.registry.current = current; const opened = f.openSource({ kind: 'message', id }); await drain(); gate.resolve(); await opened; await drain(); };
  const inReader = { source: {}, editors: {}, mode: 'reply' };
  // Still out when the feed came back: no line while connected, and the feed is left alone.
  const still = async (current, id) => { gate = defer(); f.registry.current = current; const opened = f.openSource({ kind: 'message', id }); await drain(); await feed(true); gate.resolve(); await opened; await drain(); };
  await still(inReader, 'm2');
  assert.deepEqual([said('reader-notice'), live.reopens], ['', 0], `the Reader's next message, out when the feed came back, ran out while it was up, yet reader-notice says: ${said('reader-notice')}`);
  await feed(false); await still(null, 'm1');
  assert.deepEqual([said('app-status'), live.reopens], ['', 0], `a tapped message, out when the feed came back, ran out while it was up, yet app-status says: ${said('app-status')}`);
  await feed(false);
  assert.deepEqual([said('app-status'), 'unreached' in f.get('app-status').dataset], [timedOut, true], 'the feed went down with nothing answered since the failure: the line says so');
  await feed(true);
  assert.equal(said('app-status'), '', 'the feed came up: an answer');
  // Begun after the feed's last answer, and no answer: the feed is opened again and the line says so.
  await open(inReader, 'm2');
  assert.deepEqual([said('reader-notice'), live.reopens], [timedOut, 1], 'a read begun while the feed was up and quiet ran out: the page doubts the feed');
  await feed(true);
  assert.equal(said('reader-notice'), '', 'the feed opened again answered');
  // One doubt opens the feed once: on the socket opened again, which has named
  // no new commit, a request with no answer leaves it as it is, so a feed is
  // never opened again in a loop.
  await f.run(() => nothing.view('topic', {})); await drain();
  assert.deepEqual([said('app-status'), live.reopens], ['', 1], 'the feed opened again is not opened again before it names a commit');
  live.emit({ kind: 'commit', seq: 1 }); await drain();
  await f.run(() => nothing.view('topic', {})); await drain();
  assert.deepEqual([said('app-status'), live.reopens], [lost, 2], 'a request that got no answer while the feed was up and quiet, after a new commit');
  await feed(true); await feed(false);
  assert.deepEqual([said('app-status'), said('reader-notice')], ['', ''], 'answered since: nothing comes back when the feed goes down later');
  // Down: each failure says so, and goes at the first answer, which is no reconnection.
  await f.run(() => nothing.view('topic', {})); await drain();
  assert.deepEqual([said('app-status'), 'unreached' in f.get('app-status').dataset], [lost, true], 'a request that got no answer while the feed was down');
  await open(inReader, 'm2');
  assert.equal(said('reader-notice'), timedOut, 'a read that ran out while the feed was down');
  await theseus.view('attention', {}); await drain();
  assert.deepEqual([said('app-status'), said('reader-notice')], ['', ''], 'Theseus answered a request');
  // A refusal Theseus gave is an answer, and its line stays.
  await f.run(() => new RealApi('fixture-session', async () => new Response(JSON.stringify({ recorded: false, error: { code: 'CONFLICT', message: 'This topic is closed.' } }), { status: 409 })).view('topic', {})); await drain();
  await feed(true); await feed(false);
  assert.equal(said('app-status'), 'This topic is closed.', 'a refusal Theseus answered stays');
  // A Notebook page's read, owed when it meets no Theseus.
  const page = { source: { source_ref: { kind: 'memory', id: 'n1', revision: 3 }, body: 'Now' }, editors: { reply: {}, note: {} } };
  f.registry.current = page;
  const reads = [], command = f.api.command;
  gate = defer();
  const gated = new RealApi('fixture-session', async () => { await gate.promise; throw new TypeError('Failed to fetch'); });
  // Past ten reads Theseus answers, so a page that read again in a loop stops and is counted.
  f.api.command = envelope => { reads.push(envelope.kind); return reads.length > 10 ? Promise.resolve({ recorded: true, status: 'committed', operation_id: envelope.operation_id, result: { previous_revision: 3 } }) : gated.command(envelope); };
  const reading = f.readPage(page); await drain();
  await feed(true); gate.resolve(); await reading; await drain(); await drain();
  assert.equal(reads.length, 2, `a page read still out when the live feed came back, that failed after, is read again at once (reads: ${reads.length})`);
  await drain(); await drain();
  assert.equal(reads.length, 2, 'the read made again, begun after, waits for Theseus to answer again');
  await theseus.view('attention', {}); await drain(); await drain();
  assert.equal(reads.length, 3, 'a request Theseus answered, with the live feed up and quiet and no reconnection');
  await drain(); await drain();
  assert.equal(reads.length, 3, 'that read failed too, and waits');
  live.emit({ kind: 'commit', seq: 7 }); await drain(); await drain();
  assert.equal(reads.length, 4, 'a commit the live feed named is an answer too');
  f.api.command = command;
  await feed(false);
});

// The app with the real Api for its own requests, the real Live and the real
// SessionRenewal. The fixture's server answers through the real Api unless a
// case answers the page's requests itself (held.server); each socket the feed
// opens and each read of the page's address (the renewal) are the case's to
// settle.
const realPage = (href = 'https://fixture/?topic=t1', overrides = {}) => {
  const sockets = [], pages = [], held = { live: null, server: null };
  const f = fixture(href, { ...overrides,
    Api: class extends RealApi { constructor(token) { super(token, async (path, init) => {
      if (held.server) return held.server(path, init);
      const body = init.body ? JSON.parse(init.body) : null;
      const answer = path === '/api/bootstrap' ? await f.api.bootstrap() : path === '/api/view' ? await f.api.view(body.name, body.args) : await f.api.command(body);
      return new Response(JSON.stringify(answer), { status: 200 });
    }); held.api = this; } },
    Live: class extends Live { constructor(options) {
      super({ ...options, origin: 'https://fixture', timers: { setTimeout: () => 0, clearTimeout() {} },
        socket: (url, protocols) => { const socket = { protocols, closed: false, close() { this.closed = true; } }; sockets.push(socket); return socket; } });
      held.live = this;
    } },
    SessionRenewal: class extends SessionRenewal { constructor(options) {
      super({ ...options, fetcher: () => { const page = defer(); pages.push(page); return page.promise; },
        makeApi: token => new RealApi(token, async () => new Response(JSON.stringify(f.bootstrap), { status: 200 })) });
    } } });
  f.bootstrap.transport = { ...f.bootstrap.transport, live: { version: 2, path: '/api/live', protocol: 'theseus-live.v1' } };
  const said = id => f.get(id).hidden ? '' : f.get(id).textContent;
  const socket = () => sockets.at(-1);
  // The newest socket gives its first number, or a commit: Theseus answering over the feed.
  const number = seq => { socket().onmessage({ data: JSON.stringify({ seq }) }); };
  return { f, sockets, pages, held, said, socket, number };
};
const sessionRefusal = () => new Response(JSON.stringify({ recorded: false, error: { code: 'SESSION_REQUIRED', message: 'Open this instance to establish a session.' } }), { status: 401 });
const pageWith = token => new Response('<meta name="aim-next-session" content="' + token + '">', { status: 200 });

// The reviewer's case (RVX-5): Retry access reads the source, which is
// answered, and then the source's state, which never is: the network dropped
// between the two. The page gives up on that read once the foreground deadline
// passes. It began after the last answer and got none, so the feed that reads
// live is doubted: it is opened again, and until it answers the page is not
// connected.
test('Retry access, its first read answered and its second never: the feed that reads live is opened again', async () => {
  const { f, sockets, held, number } = realPage();
  await f.initialize(); await drain();
  number(1); await drain();
  const source = { source_ref: { kind: 'message', id: 'm1' }, body: 'Original source' };
  const modal = { source, sourceUnavailable: false, availabilityUnconfirmed: true, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
  f.registry.current = modal;
  f.registry.cleanup = new RecoveryCleanup({ api: held.api, changed: () => {}, bootstrap: { transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } }, journal: {}, runtime: { readTimeoutMs: 80 } });
  held.server = async (path, init) => {
    if (JSON.parse(init.body).name === 'source') return new Response(JSON.stringify({ ...source, instance_id: 'fixture' }), { status: 200 });
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  const before = sockets.length;
  await f.retrySource(); await drain();
  assert.deepEqual([sockets.length - before, held.live.state], [1, 'down'], `the source state read began after the last answer and got none, yet the feed was left reading live (access line ${JSON.stringify(modal.accessMessage)})`);
});

// The reviewer's case (round 5, RV5-A): the feed reads live after its last
// message, a request gets no answer (on a network drop, Chrome rejects the
// fetch before the WebSocket closes), then the socket closes and nothing
// answers. The page is not connected and nothing has answered since the
// failure, so the line says so, from the failure on and after the close.
test('a request that gets no answer while the feed still reads live says so, and keeps saying so after the socket closes with nothing answered', async () => {
  const { f, sockets, pages, said, socket, number } = realPage();
  await f.initialize(); await drain();
  number(1); await drain();
  const lost = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
  f.registry.open = () => new RealApi('fixture-session', async () => { throw new TypeError('Failed to fetch'); }).view('source', {});
  f.registry.current = null;
  await f.openSource({ kind: 'message', id: 'm1' }); await drain();
  assert.equal(said('app-status'), lost, `not connected now, nothing answered since the failure (the feed's last message came before it), yet the line says ${JSON.stringify(said('app-status'))}`);
  assert.deepEqual([sockets.length, sockets[0].closed], [2, true], 'the feed that read live is opened again');
  socket().onclose(); await drain();
  pages.forEach(page => page.resolve(new Response('', { status: 502 }))); await drain();
  assert.deepEqual([said('app-status'), 'unreached' in f.get('app-status').dataset], [lost, true], 'the socket closed and nothing answered: still so');
});

// A line hidden only because the page was connected is not dropped: when the
// feed goes down with nothing answered since its failure, it shows again; a
// line something answered after never comes back.
test('a connection line hidden while the feed was up shows again when it goes down with nothing answered since, and never after an answer', async () => {
  const { f, sockets, held, said, socket, number } = realPage();
  await f.initialize(); await drain();
  number(1); await drain();
  const lost = 'Connection interrupted. Confirmation is unknown; your writing is kept.';
  // A request still out when the feed named a commit (and the reads the commit
  // asked for were answered), which then gets no answer.
  const gate = defer();
  f.registry.open = () => new RealApi('fixture-session', async () => { await gate.promise; throw new TypeError('Failed to fetch'); }).view('source', {});
  f.registry.current = null;
  const opening = f.openSource({ kind: 'message', id: 'm1' }); await drain();
  number(2); await drain();
  gate.resolve(); await opening; await drain();
  assert.deepEqual([said('app-status'), sockets.length], ['', 1], 'something answered while it was out and the feed is up: no line, and the feed is left alone');
  socket().onclose(); await drain();
  assert.deepEqual([said('app-status'), 'unreached' in f.get('app-status').dataset], [lost, true], 'the feed went down and nothing has answered since that failure');
  // Up again: the line goes, and does not come back when the feed goes down again.
  held.live.start();
  number(2); await drain();
  assert.equal(said('app-status'), '', 'the feed came up again: an answer after the failure');
  socket().onclose(); await drain();
  assert.equal(said('app-status'), '', 'answered after it: the line never comes back');
});

// The reviewer's case (round 5, RV5-C and RV5-B): a laptop sleeps through a
// deploy. The socket stays half-open and reads live; a tapped message is
// refused for the page's session. The refusal proves the server restarted: the
// line says so, the page renews its session at once and opens its feed again;
// once renewed, the feed runs under the new session and messages arrive again.
test('a refusal of the page\'s session while the feed reads live says so, renews the session and reopens the feed under the new one', async () => {
  const { f, sockets, pages, held, said, socket, number } = realPage();
  await f.initialize(); await drain();
  number(1); await drain();
  const refused = 'Open this instance to establish a session.';
  held.server = async () => sessionRefusal();
  f.registry.open = () => held.api.view('source', {});
  f.registry.current = null;
  await f.openSource({ kind: 'message', id: 'm1' }); await drain();
  assert.deepEqual([said('app-status'), pages.length], [refused, 1], `the open was refused for the page's session, yet the status line says ${JSON.stringify(said('app-status'))} and the renewal was asked ${pages.length} times`);
  assert.deepEqual([sockets.length, sockets[0].closed, held.live.state], [2, true, 'down'], 'the socket opened under the refused session is let go, and the feed opened again');
  // The new socket is refused too (the old session): the renewal under way is the one.
  socket().onclose(); await drain();
  assert.equal(pages.length, 1, 'renewals asked while one is under way share it');
  // The server hands out its new session: the line goes, and the feed opens under it.
  const before = sockets.length;
  held.server = null;
  pages[0].resolve(pageWith('restarted-session')); await drain(); await drain();
  assert.equal(said('app-status'), '', 'the server answered with its session');
  assert.deepEqual([held.api.token, sockets.length > before, socket().protocols], ['restarted-session', true, ['theseus-live.v1', 'bearer.restarted-session']],
    `renewed after a restart, yet the feed opened no socket under the new session (sockets ${before} -> ${sockets.length})`);
  number(2); await drain();
  assert.equal(held.live.state, 'live', 'messages arrive again');
});

// Renewed while the feed still reads live (here the updates were refused for
// the session): the socket opened under the old session is replaced.
test('a renewed session replaces a socket that still reads live with one under the new session', async () => {
  const { f, sockets, pages, held, socket, number } = realPage();
  await f.initialize(); await drain();
  number(1); await drain();
  f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.deepEqual([pages.length, sockets.length], [1, 1]);
  pages[0].resolve(pageWith('restarted-session')); await drain(); await drain();
  assert.deepEqual([sockets.length, sockets[0].closed, held.live.state, socket().protocols], [2, true, 'down', ['theseus-live.v1', 'bearer.restarted-session']],
    `renewed after a restart, yet the page keeps the socket opened under the refused session (sockets 1 -> ${sockets.length}, state ${held.live.state})`);
  number(1); await drain();
  assert.equal(held.live.state, 'live');
});

// The phone check is a page of its own (docs/device-evidence.md), and Theseus
// can restart while a phone is part way through it. Send to Theseus refused for
// the page's session renews it, as any page does, so the next tap goes out
// under the new session and the steps already recorded are sent, not lost to a
// reload.
test('on the phone check page a send refused for the page\'s session renews it, and Send to Theseus again goes through', async () => {
  const shown = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(shown)] : [];
  const win = { matchMedia: () => ({ matches: false }), innerWidth: 390, innerHeight: 664, screen: {}, navigator: { maxTouchPoints: 5 }, location: { origin: 'https://fixture', protocol: 'https:', hostname: 'fixture' }, getComputedStyle: () => ({}) };
  let page = null;
  const { f, pages, held } = realPage('https://fixture/?phone-check=t1', {
    phoneCheck: options => { page.api = options.api; return phoneCheck({ ...options, doc: page.f.document, win, notifications: undefined, operationId: 'phone-check-op' }); } });
  page = { f };
  await f.initialize(); await drain();
  assert.equal(f.document.body.dataset.ready, 'true');
  const post = shown(f.document.body).find(node => node.id === 'check-post'), outcome = shown(f.document.body).find(node => node.id === 'check-outcome');
  // Theseus restarted: it refuses the old session and answers only the new one.
  const sent = [];
  held.server = async (path, init) => {
    if (init.headers.Authorization !== 'Bearer restarted-session') return sessionRefusal();
    const body = JSON.parse(init.body); sent.push(body);
    if (path === '/api/view') return new Response(JSON.stringify({ instance_id: 'fixture', body: sent[0].args.body }), { status: 200 });
    return new Response(JSON.stringify({ status: 'committed', result: { message_id: 'm-phone' } }), { status: 200 });
  };
  await post.onclick(); await drain();
  assert.match(outcome.textContent, /Tap Send to Theseus to try again\.$/);
  assert.equal(pages.length, 1, `Send to Theseus was refused for the page's session, yet the page asked for the server's new session ${pages.length} times`);
  pages[0].resolve(pageWith('restarted-session')); await drain(); await drain();
  assert.equal(page.api.token, 'restarted-session', 'the Api the phone check sends with holds the new session');
  await post.onclick(); await drain();
  assert.deepEqual([outcome.textContent, sent.map(body => body.kind ?? body.name), sent[0]?.operation_id],
    ['Sent, and read back from Theseus exactly. Thank you.', ['message.post', 'source'], 'phone-check-op'], 'the second tap goes out under the new session');
});

// A small seeded random source, so a failing interleaving can be run again by its seed.
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Whether the page's status line shows a connection failure is a function of
// what the page knows now, after any interleaving: it shows while the page is
// not connected (its live feed is down) and nothing has answered since that
// failure (a request Theseus answered, the live feed coming up or naming a
// commit, a session handed out again). Nothing else: the feed having read live
// after the failure is no answer. The feed is down from the moment the page
// doubts it (an attempt that got no answer with nothing answered since it
// began) or renews its session, until a socket answers. One doubt opens the
// feed once: until the feed names a new commit or its socket ends, a later
// attempt with no answer leaves it as it is. The app's own code
// (run, the status line, reconnect, its live wiring) with the real Api,
// Deadline, Live and SessionRenewal; the expected line is worked out from the
// steps alone.
test('property: after every step of any interleaving of requests, the live feed and renewals, a connection line shows exactly while the page is not connected and nothing has answered since its failure', async () => {
  const timedOut = 'Reader request timed out. Your writing is kept.';
  const endings = {
    success: () => new Response(JSON.stringify({ instance_id: 'fixture', items: [] }), { status: 200 }),
    refusal: () => new Response(JSON.stringify({ recorded: false, error: { code: 'CONFLICT', message: 'This topic is closed.' } }), { status: 409 }),
    nothing: () => { throw new TypeError('Failed to fetch'); },
    proxy: () => new Response('', { status: 502 }),
    session: () => new Response(JSON.stringify({ recorded: false, error: { code: 'SESSION_REQUIRED', message: 'Open this instance to establish a session.' } }), { status: 401 }),
  };
  const words = { refusal: 'This topic is closed.', nothing: 'Connection interrupted. Confirmation is unknown; your writing is kept.',
    proxy: 'AIM returned an unreadable response. Confirmation is unknown.', session: 'Open this instance to establish a session.', ranOut: timedOut };
  // Leave one of the document's four foreground places for renewal/bootstrap.
  // Held reads still overlap; an arbitrary queued read cannot finish before
  // the earlier gates which this same sequential driver alone can release.
  const SEEDS = 40, STEPS = 60, MAX_HELD_READS = 3;
  let checked = 0, shown = 0, hidden = 0, doubted = 0, renewed = 0, peakHeld = 0;
  const seen = new Set();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const random = seeded(seed), pick = list => list[Math.floor(random() * list.length)];
    const sockets = [], held = { live: null, page: null };
    const f = fixture('https://fixture/?topic=t1', {
      Live: class extends Live { constructor(options) {
        super({ ...options, origin: 'https://fixture', socket: () => { const socket = { close() {} }; sockets.push(socket); return socket; }, timers: { setTimeout: () => 0, clearTimeout() {} } });
        held.live = this;
      } },
      SessionRenewal: class extends SessionRenewal { constructor(options) {
        super({ ...options, fetcher: async () => held.page(), makeApi: token => new RealApi(token, async () => new Response(JSON.stringify(f.bootstrap), { status: 200 })) });
      } } });
    f.bootstrap.transport = { ...f.bootstrap.transport, live: { version: 2, path: '/api/live', protocol: 'theseus-live.v1' } };
    await f.initialize(); await drain();
    const live = held.live, said = () => f.get('app-status').hidden ? '' : f.get('app-status').textContent;
    // The model: each fact stamped with its step.
    const model = { answered: 0, live: false, text: said(), at: null, token: 'fixture-session', doubted: false };
    const expected = () => model.at === null ? model.text : (!model.live && model.at > model.answered ? model.text : '');
    const pending = [], history = [];
    let seq = 0;
    for (let step = 1; step <= STEPS; step++) {
      const kinds = [...(pending.length < MAX_HELD_READS ? ['start', 'start'] : []), 'renew', ...(pending.length ? ['end', 'end', 'end'] : []), ...(live.state === 'live' ? ['message', 'down'] : ['up', 'up'])];
      const kind = pick(kinds);
      let did = kind;
      if (kind === 'start') {
        const entry = { gate: defer(), bounded: random() < 0.3, began: step };
        if (entry.bounded) {
          const deadline = new Deadline(0, timedOut);
          const request = new RealApi('fixture-session', (path, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))).view('source', {}, { signal: deadline.signal });
          entry.done = f.run(() => entry.gate.promise.then(() => deadline.bound(request)));
        } else entry.done = f.run(() => new RealApi('fixture-session', async () => { await entry.gate.promise; return endings[entry.ending](); }).view('topic', {}));
        pending.push(entry); did = entry.bounded ? 'start a bounded read' : 'start a request';
        peakHeld = Math.max(peakHeld, pending.length);
      } else if (kind === 'end') {
        const entry = pending.splice(Math.floor(random() * pending.length), 1)[0];
        entry.ending = entry.bounded ? 'ranOut' : pick(Object.keys(endings));
        entry.gate.resolve();
        if (entry.bounded) await new Promise(resolve => setTimeout(resolve, 2));
        await entry.done; await drain();
        // An answered request settles a doubt as it stamps the answer.
        if (entry.ending === 'success' || entry.ending === 'refusal') Object.assign(model, { answered: step, doubted: false });
        else if (model.live && model.answered <= entry.began && !model.doubted) { Object.assign(model, { live: false, doubted: true }); doubted++; }
        if (entry.ending !== 'success') Object.assign(model, { text: words[entry.ending], at: entry.ending === 'refusal' ? null : step });
        did = `end: ${entry.ending}`;
      } else if (kind === 'up') {
        if (!live.current) live.start();
        // Its first number is a new commit only the first time the feed comes up.
        if (live.seq !== seq) model.doubted = false;
        live.current.socket.onmessage({ data: JSON.stringify({ seq }) });
        Object.assign(model, { live: true, answered: step });
      } else if (kind === 'message') {
        live.current.socket.onmessage({ data: JSON.stringify({ seq: ++seq }) });
        Object.assign(model, { answered: step, doubted: false });
      } else if (kind === 'down') {
        live.current.socket.onclose();
        Object.assign(model, { live: false, doubted: false });
      } else {
        const answers = random() < 0.6, token = answers ? 'session-' + seed + '-' + (random() < 0.5 ? step : 0) : null;
        held.page = answers ? async () => new Response('<meta name="aim-next-session" content="' + token + '">', { status: 200 }) : async () => { throw new TypeError('Failed to fetch'); };
        f.updateStatus({ kind: 'reconnect' });
        await drain(); await drain();
        if (answers) model.answered = step;
        // A newer session: the feed opens again under it. Theseus answered
        // the new session's bootstrap request, which settles a doubt.
        if (answers && token !== model.token) { Object.assign(model, { token, live: false, doubted: false }); renewed++; }
        did = answers ? 'renewal answered' : 'renewal not answered';
      }
      await drain();
      history.push(did); seen.add(did);
      if (model.at !== null) { if (expected()) shown++; else hidden++; }
      assert.equal(said(), expected(), `seed ${seed}, step ${step} (${did}): the status line says ${JSON.stringify(said())}, the rule says ${JSON.stringify(expected())}; steps: ${history.join(', ')}`);
      checked++;
    }
    for (const entry of pending) { entry.ending = 'success'; entry.gate.resolve(); }
    await new Promise(resolve => setTimeout(resolve, 2)); await Promise.all(pending.map(entry => entry.done)); await drain();
  }
  assert.equal(checked, SEEDS * STEPS);
  assert.equal(peakHeld, MAX_HELD_READS, 'the driver still reaches overlapping held reads');
  // Every kind of step ran, and connection lines both showed and were hidden.
  assert.deepEqual([...seen].sort(), ['down', 'end: nothing', 'end: proxy', 'end: ranOut', 'end: refusal', 'end: session', 'end: success', 'message',
    'renewal answered', 'renewal not answered', 'start a bounded read', 'start a request', 'up']);
  assert.ok(shown > 50 && hidden > 50, `connection lines shown at ${shown} steps and hidden at ${hidden}`);
  assert.ok(doubted > 20 && renewed > 20, `the feed doubted ${doubted} times and opened again under a renewed session ${renewed} times`);
});

test('a renewed session leaves a message that was not about the connection, and writing that cannot be saved', async () => {
  const renewals = [], { f, live, answers } = restartable(renewals);
  await f.initialize(); await drain();
  await f.run(async () => { throw new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } }); });
  f.editor.unavailable = true;
  f.events.length = 0; answers.push('renewed'); live.emit({ kind: 'refused' }); await drain();
  assert.equal(f.get('app-status').textContent, 'This topic is closed.');
  assert.equal(f.events.some(e => e[0] === 'schedule'), false, 'writing whose destination is unavailable is not saved');
});

test('updates refused for the session say so, reconnect by themselves, and retry once for each session', async () => {
  const renewals = [], { f, answers } = restartable(renewals);
  await f.initialize(); await drain();
  const requests = () => f.events.filter(e => e[0] === 'request').length;
  let before = requests();
  answers.push('renewed');
  f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.equal(f.get('updates-message').textContent, 'Reconnecting to Theseus. Your writing is kept. ');
  assert.equal(f.get('updates-retry').textContent, 'Reconnect');
  assert.equal(requests() - before, 1, 'the stopped updates are tried again');
  // Refused again with the same session: not tried again by itself.
  before = requests(); answers.push('current');
  f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.equal(requests() - before, 0);
  // The Reconnect button tries again on demand.
  before = requests(); answers.push('current');
  await f.get('updates-retry').onclick(); await drain();
  assert.equal(requests() - before, 1);
  // Once updates have run again, a later refusal of the same session is tried again once.
  f.updateStatus({ kind: 'current' });
  before = requests(); answers.push('current');
  f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.equal(requests() - before, 1, 'tried again after updates ran');
  before = requests(); answers.push('current');
  f.updateStatus({ kind: 'reconnect' }); await drain();
  assert.equal(requests() - before, 0, 'and only once');
  // Not answering yet: the button says so, and nothing else runs.
  before = requests();
  await f.get('updates-retry').onclick(); await drain();
  assert.equal(requests() - before, 0);
  assert.match(f.get('app-status').textContent, /not answering yet/);
});

// A refused source hides its Notebook title with its text, so a page the
// reader can no longer see does not keep saying what it was called.
test('a source refused on Retry hides its title along with its text', async () => {
  const f = fixture();
  const source = { source_ref: { kind: 'memory', id: 'n1', revision: 2 }, title: 'Private plan', author: 'tony', body: 'Secret words', attachments: [] };
  const modal = { source: { ...source }, sourceUnavailable: false, availabilityUnconfirmed: false, editors: { reply: { unavailable: false }, note: { unavailable: false } } };
  f.registry.current = modal;
  f.reader.hideUnavailableSource = () => f.events.push(['hidden']);
  f.api.view = async (name, args) => { if (name === 'source') throw Object.assign(Error('Forbidden'), { code: 'FORBIDDEN' }); return f.state(args.source_ref); };
  await f.retrySource();
  assert.equal(modal.sourceUnavailable, true);
  assert.deepEqual([modal.source.title, modal.source.body], ['Source unavailable', '']);
  assert.equal(f.events.filter(e => e[0] === 'hidden').length, 1);
  // Readable, but Core says this person may no longer see it: the same.
  const g = fixture(), shown = { source: { ...source }, sourceUnavailable: false, availabilityUnconfirmed: false, editors: { reply: { unavailable: false }, note: { unavailable: false } } };
  g.registry.current = shown;
  g.api.view = async (name, args) => name === 'source' ? { ...source, instance_id: 'fixture' } : { ...g.state(args.source_ref), source_available: false };
  await g.retrySource();
  assert.deepEqual([shown.sourceUnavailable, shown.source.title, shown.source.body], [true, 'Source unavailable', '']);
});

test('confirmed inline access resumes dirty save only after confirmation; no send or recovery replay', async () => {
  for (const recovery of [false, true]) {
    const f = fixture(), gate = defer(); f.editor.authorityRecovery = recovery;
    const read = async name => { await gate.promise; return name === 'topic' ? { topic: f.topic } : f.state(); };
    const running = f.checkInlineAvailability(read, () => true);
    assert.equal(f.editor.unavailable, true); assert.equal(f.events.some(e => e[0] === 'schedule'), false);
    gate.resolve(); await running;
    assert.equal(f.editor.unavailable, false); assert.equal(f.p.availabilityUnconfirmed, false);
    assert.equal(f.events.filter(e => e[0] === 'schedule').length, recovery ? 0 : 1);
    assert.equal(f.calls.some(c => c.kind), false);
  }
});

test('interrupted inline availability keeps access unconfirmed, releases checking and queues one fenced recheck', async () => {
  const f = fixture(), gate = defer(); let epoch = true;
  const running = f.checkInlineAvailability(async name => { await gate.promise; return name === 'topic' ? { topic: f.topic } : f.state(); }, () => epoch);
  epoch = false; gate.resolve(); await running;
  assert.equal(f.p.availabilityUnconfirmed, true); assert.equal(f.editor.unavailable, true);
  assert.equal(f.p.availabilityChecking, false); assert.equal(f.get('inline-retry').hidden, false);
  assert.equal(f.events.filter(e => e[0] === 'invalidate' && e[1] === 'availability').length, 1);
  assert.equal(f.events.some(e => e[0] === 'schedule'), false);
  await f.checkInlineAvailability(async name => name === 'topic' ? { topic: f.topic } : f.state(), () => true);
  assert.equal(f.p.availabilityUnconfirmed, false); assert.equal(f.editor.unavailable, false);
  assert.equal(f.events.filter(e => e[0] === 'schedule').length, 1); assert.equal(f.calls.some(c => c.kind), false);
});

test('superseded inline check cannot clear a newer check or accept for a replacement registered editor', async () => {
  const f = fixture(), old = defer(), next = defer();
  const read = gate => async name => { await gate.promise; return name === 'topic' ? { topic: f.topic } : f.state(); };
  const first = f.checkInlineAvailability(read(old), () => true), second = f.checkInlineAvailability(read(next), () => true);
  old.resolve(); await first; assert.equal(f.p.availabilityChecking, true); assert.equal(f.editor.unavailable, true);
  f.registry.sessions.set(f.editor.key, { editor: { ...f.editor } });
  next.resolve(); await second; assert.equal(f.editor.unavailable, true); assert.equal(f.p.availabilityUnconfirmed, true);
  assert.equal(f.events.some(e => ['schedule','invalidate'].includes(e[0])), false);
});

// The writing registered under its key, as the registry holds it.
const registered = (f, editor, underWay = () => false) => f.registry.sessions.set(editor.key, { editor, underWay });

test('inline pending stays beside inline only; modal pending remains in the topic summary', () => {
  const f = fixture(); f.editor.submissions.push({ id: 'inline-submission' });
  f.registry.inline = null; f.changed(f.editor);
  assert.equal(f.get('topic-pending').children.length, 0, 'restoring a topic editor before its presentation is installed must not create the duplicate');
  f.registry.inline = f.p; f.changed(f.editor);
  assert.equal(f.get('inline-pending').children.length, 1); assert.equal(f.get('topic-pending').children.length, 0);
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [{ id: 'modal-submission' }] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } }; f.changed(modal);
  assert.equal(f.get('topic-pending').children.length, 1); assert.equal(f.get('topic-pending').children[0].dataset.key, 'modal');
});


// Item 118: a "Review N reply" button under a topic's title counts only
// replies still in doubt, so a reply that went leaves no button behind.
test('a Review button under the title shows only while a reply is in doubt: one confirmed sent, here or on the server, leaves none', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => host.firstElementChild?.textContent);
  modal.submissions = [{ id: 'went', status: 'confirmed' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'a reply this device saw confirmed has no button');
  modal.submissions = [{ id: 'held', status: 'prepared' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'a reply not yet confirmed has one');
  modal.submissions = [{ id: 'held', status: 'confirmed' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'once it is confirmed its button goes');
  modal.submissions = [{ id: 'refused', status: 'refused' }, { id: 'unknown', status: 'unknown' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 2 replies'], 'refused and unconfirmed replies are both in doubt');
  // The server's record of each send: one committed is sent, whatever this device last saw.
  modal.submissions = [{ id: 'refused', status: 'refused' }, { id: 'late', status: 'prepared' }];
  f.registry.pending = () => ({ items: [{ id: 'late', send_status: 'committed' }, { id: 'earlier', send_status: 'committed' }, { id: 'lost', send_status: 'unknown' }, { id: 'refused', send_status: 'rejected' }], next_cursor: null });
  f.changed(modal);
  assert.deepEqual(shown(), ['Review 2 replies'], 'the refused reply and the unconfirmed one from the server, not the two it records as sent');
  f.registry.pending = () => ({ items: [{ id: 'late', send_status: 'committed' }], next_cursor: null });
  modal.submissions = [{ id: 'late', status: 'prepared' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'a reply the server records as sent needs no button');
});

// Item 118: a reply still on its way is not in doubt. Its button would come
// and go on every reply, moving the composer, and the page under a Reader's
// title, twice; only a send that ended unconfirmed, or a refusal, leaves one.
test('a reply on its way has no Review button; one whose send ended without a confirmation does', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  const going = new Set();
  registered(f, modal, id => going.has(id)); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => host.firstElementChild?.textContent);
  going.add('next'); modal.submissions = [{ id: 'next', status: 'preparing' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'a reply being prepared to go has none');
  modal.submissions = [{ id: 'next', status: 'prepared' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'nor while its send is out');
  f.registry.pending = () => ({ items: [{ id: 'next', send_status: 'prepared' }], next_cursor: null }); f.changed(modal);
  assert.deepEqual(shown(), [], 'nor when the server lists it as prepared while it goes');
  going.delete('next'); f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'its send ended unconfirmed: now it is in doubt');
  // One going beside one in doubt: the button counts only the one in doubt.
  going.add('another'); modal.submissions = [{ id: 'next', status: 'prepared' }, { id: 'another', status: 'preparing' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'a second reply on its way leaves the count at one');
  modal.submissions = [{ id: 'next', status: 'confirmed' }, { id: 'another', status: 'preparing' }];
  f.registry.pending = () => ({ items: [], next_cursor: null }); f.changed(modal);
  assert.deepEqual(shown(), [], 'the first confirmed and the second on its way: no button');
});

// Item 118: a refusal that was prepared again is carried by its correction, so
// the two are one reply: in doubt while the correction is, and not once it went.
test('a refused reply prepared again shows a Review button only while its correction is in doubt, here or from an earlier runtime', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  const going = new Set();
  registered(f, modal, id => going.has(id)); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => host.firstElementChild?.textContent);
  const refused = { id: 'orig', status: 'refused', receipt: { kind: 'submission.prepare', status: 'rejected' } };
  modal.submissions = [refused]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'the refusal alone is in doubt');
  going.add('fix'); modal.submissions = [{ ...refused, correctedBy: 'fix' }, { id: 'fix', status: 'preparing' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'its correction is on its way, so its words are');
  going.delete('fix'); modal.submissions = [{ ...refused, correctedBy: 'fix' }, { id: 'fix', status: 'confirmed' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'the correction went, so the refusal leaves no button');
  modal.submissions = [{ id: 'old', status: 'prepared', detached: true, correctedBy: 'fix' }, { id: 'fix', status: 'confirmed' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'nor does an earlier runtime\'s reply whose correction went');
  f.registry.pending = () => ({ items: [{ id: 'old', send_status: 'unknown' }], next_cursor: null }); f.changed(modal);
  assert.deepEqual(shown(), [], 'even while the server lists that earlier reply unconfirmed');
  f.registry.pending = () => ({ items: [], next_cursor: null });
  modal.submissions = [{ ...refused, correctedBy: 'fix' }, { id: 'fix', status: 'refused', correctedBy: 'again' }, { id: 'again', status: 'prepared' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'a twice-corrected reply whose last correction ended unconfirmed is one reply in doubt');
  modal.submissions = [{ ...refused, correctedBy: 'fix' }, { id: 'fix', status: 'refused', receipt: { kind: 'message.send', status: 'rejected' } }, { id: 'other', status: 'unknown' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 2 replies'], 'a correction refused in its turn is in doubt, beside another reply');
  modal.submissions = [{ ...refused, correctedBy: 'missing' }]; f.changed(modal);
  assert.deepEqual(shown(), ['Review 1 reply'], 'a correction this device does not hold answers for nothing: the refusal stays in doubt');
  modal.submissions = [{ id: 'other', status: 'confirmed' }]; f.changed(modal);
  assert.deepEqual(shown(), [], 'and the button goes once none is');
});

// Item 118: the server's list of replies not sent answers for the replies it
// could see only once it is read to its end. A list not read to its end, or
// not read at all, is never an answer of none.
test('a Review button counts a reply prepared here as sent only from a complete read that could see it, and an unread list keeps a button', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => host.firstElementChild?.textContent);
  const page = (items, next_cursor, through) => { f.registry.pending = () => ({ items, next_cursor, through }); f.changed(modal); return shown(); };
  const held = { id: 'held', status: 'prepared', preparationConfirmed: true, prepareReceipt: { result: { seq: 5 } } };
  modal.submissions = [held];
  assert.deepEqual(page([], null, 5), [], 'the whole list of replies not sent was read after it was prepared and does not hold it: it went');
  assert.deepEqual(page([], null, 9), [], 'a read later still');
  assert.deepEqual(page([], null, 4), ['Review 1 reply'], 'a read that could not see it answers nothing for it');
  assert.deepEqual(page([{ id: 'held', send_status: 'unknown' }], null, 5), ['Review 1 reply'], 'listed as not sent, it is in doubt');
  assert.deepEqual(page([], 3, 5), ['Review 1+ replies'], 'a list not read to its end answers nothing, and more may be in doubt');
  modal.submissions = [{ ...held, prepareReceipt: { result: {} } }];
  assert.deepEqual(page([], null, 5), ['Review 1 reply'], 'a prepare answer with no place in the list answers nothing');
  modal.submissions = [{ ...held, status: 'preparing', preparationConfirmed: false, prepareReceipt: undefined }];
  assert.deepEqual(page([], null, 5), ['Review 1 reply'], 'a reply whose preparation is not confirmed is in doubt');
  modal.submissions = [];
  assert.deepEqual(page([{ id: 'x', send_status: 'unknown' }], 21, 40), ['Review 1+ replies'], 'one known, more unread');
  assert.deepEqual(page([], 21, 40), ['Review more replies'], 'none known, more unread');
  f.registry.pending = () => undefined; f.changed(modal);
  assert.deepEqual(shown(), ['Review more replies'], 'a list never read is not an answer of none');
  assert.deepEqual(page([], null, 40), [], 'a whole list with nothing in it is');
});

// Item 548: a reply this page set aside is in doubt no more, even one prepared
// here whose prepare answered no place in the list, and setting aside one
// leaves the others in doubt.
test('a reply set aside here has no Review button, and the others keep theirs', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => host.firstElementChild?.textContent);
  const page = (items, next_cursor, through) => { f.registry.pending = () => ({ items, next_cursor, through }); f.changed(modal); return shown(); };
  modal.submissions = [{ id: 'held', status: 'prepared', preparationConfirmed: true, prepareReceipt: { result: {} } }];
  const listed = [{ id: 'other', send_status: 'unknown' }, { id: 'third', send_status: 'unknown' }];
  assert.deepEqual(page(listed, null, 5), ['Review 3 replies']);
  f.registry.asides = new Set(['held']);
  assert.deepEqual(page(listed, null, 5), ['Review 2 replies'], 'the reply set aside is not counted; the others are');
  f.registry.asides.add('other');
  assert.deepEqual(page(listed, null, 5), ['Review 1 reply']);
  f.registry.asides = new Set();
  assert.deepEqual(page(listed, null, 5), ['Review 3 replies'], 'put back, it is in doubt again');
});

// Item 548: a reply set aside with its words kept only on its line has a quiet
// Set aside chip where its Review button was, so the line stays one press away;
// the departure guard never names it, and one whose words went back into the
// writing has none.
test('a reply set aside with its words kept has a Set aside chip the guard does not name', () => {
  const f = fixture();
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } };
  const shown = () => f.get('topic-pending').children.map(host => [host.firstElementChild?.textContent, Boolean(host.firstElementChild?.title)]);
  const page = (aside, items = []) => { f.registry.pending = () => ({ items, next_cursor: null, through: 5, aside }); f.changed(modal); return shown(); };
  const kept = (id, restored) => ({ id, restored, body: 'Words of ' + id, attachments: [], topic_id: 't1' });
  assert.deepEqual(page([kept('a', false)]), [['Set aside 1', true]], 'its words kept only on its line: a named chip with a tooltip');
  assert.deepEqual(f.registry.inDoubt, [], 'nothing is in doubt, so the guard names nothing');
  assert.deepEqual(page([kept('a', false), kept('b', true)]), [['Set aside 1', true]], 'one whose words went back into the writing is not counted');
  assert.deepEqual(page([kept('b', true)]), [], 'with every reply set aside back in the writing there is no chip');
  assert.deepEqual(page([kept('a', false)], [{ id: 'other', send_status: 'unknown' }]), [['Review 1 reply', false]], 'a reply in doubt keeps its Review button, which opens the same list');
});

// Item 118: "Review 2 replies" opens those two. A reply checked as sent
// while the list is open says so in its place.
test('the Review list shows the replies its button counts, and keeps one checked as sent while it is open', async () => {
  const f = fixture(), settle = async () => { for (let n = 0; n < 6; n++) await new Promise(setImmediate); };
  f.get('version-review').showModal = function () { this.open = true; };
  const kept = (id, status) => ({ id, status, topicId: 't1', snapshot: { body: id, attachments: [] } });
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [kept('went', 'confirmed'), kept('held', 'prepared')] };
  registered(f, modal); f.registry.current = { editors: { reply: modal } }; f.registry.pendingReason = () => null;
  f.registry.pending = () => ({ items: [{ id: 'old', send_status: 'committed', topic_id: 't1' }, { id: 'lost', send_status: 'unknown', topic_id: 't1' }], next_cursor: null, through: 9 });
  f.registry.checkPending = async (editor, id) => { editor.submissions.find(item => item.id === id).status = 'confirmed'; f.changed(editor); };
  f.changed(modal);
  const control = f.get('topic-pending').children[0].firstElementChild;
  assert.equal(control.textContent, 'Review 2 replies');
  await control.onclick(); await settle();
  const cards = () => f.get('review-content').children.filter(card => card.dataset.id).map(card => [card.dataset.id, card.querySelector('h3').textContent]);
  assert.deepEqual(cards(), [['held', 'Confirmation unknown'], ['lost', 'Confirmation unknown']], 'the two in doubt, not the two that went');
  await f.get('review-content').children[0].children.find(child => child.textContent === 'Check confirmation').onclick(); await settle();
  assert.equal(control.textContent, 'Review 1 reply', 'checked as sent, it is no longer counted');
  assert.deepEqual(cards(), [['held', 'Sent to Theseus'], ['lost', 'Confirmation unknown']], 'but its card stays, and says so in place');
});

// The Review list belongs to the writing registered under its button's key:
// a writing replaced while the list is open is not the one it acts on.
test('the Review list acts on the writing registered under its key, even one replaced while the list is open', async () => {
  const f = fixture(), settle = async () => { for (let n = 0; n < 6; n++) await new Promise(setImmediate); };
  f.get('version-review').showModal = function () { this.open = true; };
  const kept = (id, status) => ({ id, status, topicId: 't1', snapshot: { body: id, attachments: [] } });
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [kept('held', 'prepared')] };
  registered(f, modal); f.registry.pendingReason = () => null; f.registry.pending = () => ({ items: [], next_cursor: null, through: 0 });
  const checked = []; f.registry.checkPending = async editor => { checked.push(editor); };
  f.changed(modal);
  await f.get('topic-pending').children[0].firstElementChild.onclick(); await settle();
  const replacement = { ...modal, submissions: [kept('held', 'prepared')] };
  registered(f, replacement); f.changed(modal);
  await f.get('review-content').children[0].children.find(child => child.textContent === 'Check confirmation').onclick(); await settle();
  assert.deepEqual(checked.map(editor => editor === replacement), [true], 'Check confirmation goes to the registered writing');
});

// Items 272 and 131: each page is a run of the shell that keeps the rails and
// the phone drawer across moves (in-place-navigation.mjs, which wires the
// drawer; tests/ui_rail_drawer.test.mjs presses it). The page begins its run
// as it starts, handing the shell its own way to open a place and to retire.
test('the page begins its run of the shell as it starts, with its own way to open a place and to retire', () => {
  const begun = [];
  fixture('https://fixture/?topic=t1', { shell: { begin: page => begun.push(page), ready() {}, go: () => false, topicChanged() {} } });
  assert.equal(begun.length, 1, 'once, as the page starts');
  // updated (item 523): the page's way to say a move found another build while its writing is not yet safe;
  // refused: to say why it stayed when a move that waited on the build no longer has the guard's leave.
  assert.deepEqual(Object.keys(begun[0]).sort(), ['open', 'refused', 'retire', 'updated']);
  assert.ok(begun.every(page => ['open', 'refused', 'retire', 'updated'].every(name => typeof page[name] === 'function')));
});

test('a move the guard let go, refused as it is made, says why the page stayed where a refused move says it: by the topic line and in the Reader or New message sheet that is open', () => {
  for (const open of [null, 'reader', 'new-message-sheet']) {
    const begun = [], stayed = [], scrolled = [];
    const f = fixture('https://fixture/?topic=t1', { shell: { begin: page => begun.push(page), ready() {}, go: () => false, topicChanged() {}, stayed: () => stayed.push('stayed') } });
    if (open) f.get(open).open = true;
    f.get('topic-navigation-status').scrollIntoView = how => scrolled.push(JSON.stringify(how));
    const why = Error('Keep this page open until your writing and selected images are safely saved, then choose the topic again.');
    begun[0].refused(why);
    assert.equal(f.get('topic-navigation-status').textContent, why.message, `${open}: the topic line says why`);
    assert.deepEqual(stayed, ['stayed'], `${open}: a press that went nowhere lands as a refused move's does`);
    const near = { reader: 'reader-notice', 'new-message-sheet': 'inline-notice' }[open];
    if (near) assert.deepEqual([f.get(near).textContent, scrolled], [why.message, []], `${open}: and so does the writing open over the page`);
    else assert.deepEqual([f.get('reader-notice').textContent, f.get('inline-notice').textContent, scrolled], ['', '', ['{"block":"nearest"}']], 'with nothing open, only the topic line says it, brought into view');
  }
});

test('a move that found another build says Theseus updated with a Reload that reloads, by the topic line and in the Reader or New message sheet that is open', () => {
  for (const open of [null, 'reader', 'new-message-sheet']) {
    const begun = [], reloads = [], scrolled = [];
    const f = fixture('https://fixture/?topic=t1', { shell: { begin: page => begun.push(page), ready() {}, go: () => false, topicChanged() {} } });
    if (open) f.get(open).open = true;
    f.get('topic-navigation-status').scrollIntoView = how => scrolled.push(JSON.stringify(how));
    begun[0].updated(() => reloads.push('reload'));
    const said = id => { const line = f.get(id); return [line.textContent, line.children.filter(c => typeof c === 'object' && c.tagName === 'BUTTON')]; };
    const [words, [button]] = said('topic-navigation-status');
    assert.equal(words, 'Theseus updated.', open);
    assert.deepEqual([button.textContent, button.className, button.title, button.type], ['Reload', 'updated-reload', 'Reload Theseus', 'button']);
    button.onclick();
    assert.deepEqual(reloads, ['reload'], 'Reload asks for the load');
    const near = { reader: 'reader-notice', 'new-message-sheet': 'inline-notice' }[open];
    if (near) {
      const [there, [again]] = said(near);
      assert.equal(there, 'Theseus updated.', 'said where the person is writing');
      again.onclick();
      assert.deepEqual([reloads.length, scrolled], [2, []]);
    } else {
      assert.deepEqual([said('reader-notice')[0], said('inline-notice')[0], scrolled], ['', '', ['{"block":"nearest"}']], 'with nothing open, only the topic line says it, brought into view');
    }
  }
});

test('every application route reloads a restored closed document before accepting input',async()=>{
  for(const suffix of ['', '?workspace=w1','?new=outcome&intent=i','?workspace=w1&opening=o&opening_topic=t','?topic=t1']){
    const f=fixture('https://fixture/'+suffix),handler=f.events.find(e=>e[0]==='window-handler'&&e[1]==='pageshow');
    assert.ok(handler,'common pageshow listener exists before route initialization');handler[2]({persisted:false});assert.equal(f.events.some(e=>e[0]==='reload'),false);
    handler[2]({persisted:true});assert.equal(f.events.filter(e=>e[0]==='reload').length,1);
  }
});

test('outcome pages list unfinished openings from Core, not from browser storage',async()=>{
  const f=fixture('https://fixture/?workspace=w1');f.inject({api:f.api,bootstrap:f.bootstrap});
  f.api.view=async(name,args)=>{f.calls.push({name,args});return name==='workspace'?{instance_id:'fixture',workspace:{id:'w1',title:'Real outcome'}}:{instance_id:'fixture',items:[],next_cursor:null};};
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.events.filter(e=>e[0]==='unfinished'),[['unfinished','w1']]);
  assert.deepEqual(f.calls.filter(c=>c.name==='openings').map(c=>c.args),[{workspace_id:'w1',limit:20}]);
  assert.equal(f.events.some(e=>e[0]==='intent-journal'),false,'an outcome page does not consult browser-only pointers');
});
test('the opening route writes through a server-owned opening and never starts an editor registry',async()=>{
  const f=fixture('https://fixture/?workspace=w1&opening=o1&opening_topic=t9');f.inject({api:f.api,bootstrap:f.bootstrap});
  f.api.view=async(name,args)=>{f.calls.push({name,args});return name==='workspace'?{instance_id:'fixture',workspace:{id:'w1',title:'Real outcome'}}:{instance_id:'fixture',items:[],next_cursor:null};};
  await f.initialize();
  assert.deepEqual(f.events.find(e=>e[0]==='opening-draft')?.[1],{workspace:'w1',opening:'o1',topic:'t9'});
  assert.ok(f.events.some(e=>e[0]==='opening-load'));
  assert.equal(f.events.some(e=>['registry','journal','intent-journal'].includes(e[0])),false,'no EditorRegistry, recovery journal or prepared submission');
  assert.equal(f.get('body').dataset.ready,'true');
});

test('a topic page reports read-through only for what the person sees, and never their own messages', async () => {
  const f = fixture(); Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const reads = () => f.calls.filter(c => c.kind === 'topic.read_through').map(c => JSON.parse(JSON.stringify(c.envelope)));
  const ranges = () => reads().map(e => [e.args.from_seq, e.args.seq]);
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: 'older', memoryCursor: null, newest: 0 });
  await f.initialize(); await settle();
  const [observer, middle] = f.observers;
  assert.deepEqual(JSON.parse(JSON.stringify(middle.options)), { rootMargin: '-50% 0px -50% 0px', threshold: 0 }, 'the second observer watches the middle line');
  const message = (seq, author = 'agent-a') => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: author, body: 'Body ' + seq, topic_id: 't1' });
  const card = seq => observer.targets.find(target => target.dataset.seq === seq);
  const show = (shown, hidden = []) => {
    const away = seq => ({ target: card(seq), isIntersecting: false, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 0 } });
    if (hidden.length) middle.callback(hidden.map(away));
    observer.callback([...shown.map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })),
      ...hidden.map(seq => ({ target: card(seq), isIntersecting: false, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 600 } }))]);
  };
  // The page loaded #20..#31; older history (an addressed #1, say) is not loaded.
  for (let seq = 20; seq <= 31; seq++) message(seq);
  f.views.newest = 31; f.paintViews('messages'); await settle();
  assert.deepEqual(reads(), [], 'painting messages reads nothing until a card is on screen');
  assert.equal(observer.targets.length, 12, 'each message card is observed');

  show([29, 30, 31]); await settle();
  assert.equal(reads().length, 1);
  const [first] = reads();
  assert.deepEqual({ ...first, operation_id: typeof first.operation_id }, { v: 1, instance_id: 'fixture', operation_id: 'string', kind: 'topic.read_through',
    target: { topic_id: 't1' }, expected: { authority: { authority_id: 'a1', authority_epoch: 'e1' } }, args: { from_seq: 29, seq: 31 } });
  f.paintViews('messages'); await settle();
  assert.equal(reads().length, 1, 'repainting the same messages is not a new read');

  // A card only slightly in view is not read; one filling half the viewport is.
  observer.callback([{ target: card(28), isIntersecting: true, intersectionRatio: 0.1, intersectionRect: { height: 10 }, rootBounds: { height: 600 } }]); await settle();
  assert.deepEqual(ranges(), [[29, 31]], 'a sliver of a card is not read');
  observer.callback([{ target: card(28), isIntersecting: true, intersectionRatio: 0.4, intersectionRect: { height: 300 }, rootBounds: { height: 600 } }]); await settle();
  assert.deepEqual(ranges(), [[29, 31]], 'less than half of a card is not read by its own share');
  middle.callback([{ target: card(28), isIntersecting: true, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 0 } }]); await settle();
  assert.deepEqual(ranges(), [[29, 31], [28, 31]], 'a tall card across the middle of the viewport is read');

  // Visible but unfocused (a second display), or hidden: a new message is not read.
  message(32); f.views.newest = 32; f.paintViews('messages');
  f.document.focused = false; show([32]); await settle();
  f.document.focused = true; f.document.visibilityState = 'hidden'; show([32]); await settle();
  assert.deepEqual(ranges(), [[29, 31], [28, 31]], 'nothing is read without focus or while hidden');
  f.document.visibilityState = 'visible';
  const focus = f.events.filter(e => e[0] === 'window-handler' && e[1] === 'focus');
  assert.ok(focus.length); for (const handler of focus) handler[2]();
  await settle();
  assert.deepEqual(ranges().at(-1), [28, 32], 'focusing the page reads what is on screen');

  // Scrolled down into older history: a new message inserted above the viewport is not read.
  show([24, 25], [28, 29, 30, 31, 32]); await settle();
  assert.deepEqual(ranges().at(-1), [24, 25]);
  message(33); f.views.newest = 33; f.paintViews('messages'); await settle();
  assert.deepEqual(ranges().at(-1), [24, 25], 'a message added outside the viewport is not read');

  // The person's own messages settle nothing and are never reported.
  message(34, 'fixture-person'); message(35, 'fixture-person'); f.views.newest = 35; f.paintViews('messages');
  show([34, 35], [24, 25]); await settle();
  assert.deepEqual(ranges().at(-1), [24, 25], 'only the person\'s own messages on screen: nothing to report');
  assert.ok(ranges().every(([from]) => from >= 20), 'nothing below the loaded page is ever reported');

  const presentation = { source: { source_ref: { kind: 'message', id: 'm7' }, topic_id: 't1', seq: 26, author: 'agent-a' }, editors: {}, mode: 'reply' };
  const count = reads().length;
  f.registry.current = presentation; show([33]); await settle();
  assert.deepEqual(ranges().slice(count), [[26, 26]], 'under a Reader only the message it shows is read');
  f.registry.current = null; f.registry.options.closed(presentation); await settle();
  assert.deepEqual(ranges().at(-1), [33, 33], 'closing the Reader reads the cards on screen');

  // A reply and the message it answers read as one stack (reply-stacks.mjs):
  // each card in it on screen is read, not only the stack's newest.
  message(36); f.views.messages.set('m37', { ...f.views.messages.get('m36'), id: 'm37', seq: 37, body: 'Body 37', reply_to: 'm36', reply_to_author: 'agent-a', reply_to_excerpt: 'Body 36' });
  f.views.newest = 37; f.paintViews('messages'); await settle();
  assert.ok(card(36).parent !== f.get('messages') && card(37).parent !== f.get('messages'), 'both cards are in a stack');
  show([36, 37], [33]); await settle();
  assert.deepEqual(ranges().at(-1), [36, 37], 'both cards of the stack on screen are read');
});

async function readingPage() {
  const f = fixture(); Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await settle();
  const ranges = () => f.calls.filter(c => c.kind === 'topic.read_through').map(c => [c.envelope.args.from_seq, c.envelope.args.seq]);
  const card = seq => f.observers[0].targets.find(target => target.dataset.seq === seq);
  return { f, ranges, card };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// Item 857 starts ordinary dossiers open. A check about a folded dossier
// makes that choice through the actual chevron before checking its behavior.
const foldDossier = (f, id) => {
  const folder = entryIn(f, id)?.closest('.reply-stack');
  assert.equal(folder?.dataset.fold, 'open', `${id} starts open before the explicit fold`);
  const toggle = folder.children.find(node => node.classList?.contains('stack-toggle'));
  toggle.onclick();
  assert.equal(folder.dataset.fold, 'folded', `${id} takes the explicit folded choice`);
};

test('843 actual dossier chevron clears its session marks on collapse, preserves them on expand and leaves other dossiers alone', async () => {
  const { f } = await readingPage();
  // This fixture supplies the browser microtask primitive used by clearVisitNew.
  f.runObservation('globalThis.queueMicrotask = fn => Promise.resolve().then(fn)');
  const items = [
    { id: 'm1', seq: 1, body: 'Head' },
    { id: 'm2', seq: 2, body: 'Reply', reply_to: 'm1' },
    { id: 'm3', seq: 3, body: 'Newest reply', reply_to: 'm1' },
    { id: 'm4', seq: 4, body: 'Unrelated dossier' },
  ].map(item => ({ ...item, author_id: 'agent-a', topic_id: 't1', unread: false, acts: { folded: false, fold_revision: 0 } }));
  for (const item of items) f.views.messages.set(item.id, item);
  const stored = JSON.stringify(items), commands = f.calls.filter(c => c.kind).length;
  // An already-folded dossier receives these arrivals. Seeding the earlier
  // choice avoids handling these very messages in a setup collapse (843).
  f.runObservation("stackState(document.getElementById('messages')).levels.set('m1', 'folded')");
  f.runObservation('visitNew.arrive([...views.messages.values()])');
  f.paintViews('messages'); await settle();
  const marks = () => [...f.runObservation('visitNew.arrivals')].sort();
  const walk = node => (node.children ?? []).filter(e => e && typeof e === 'object').flatMap(e => [e, ...walk(e)]);
  const chevron = () => walk(f.get('messages')).find(e => e.classList?.contains('stack-toggle') && e.closest('.reply-stack')?.dataset.stack === 'm1');
  assert.deepEqual(marks(), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(chevron().dataset.state, 'folded');
  chevron().onclick(); await settle();
  assert.equal(chevron().dataset.state, 'open');
  assert.deepEqual(marks(), ['m1', 'm2', 'm3', 'm4'], 'expansion is not handling the messages');
  chevron().onclick(); await settle();
  assert.equal(chevron().dataset.state, 'folded');
  assert.deepEqual(marks(), ['m4'], 'collapse handles the loaded dossier, not just its head');
  f.runObservation('stackFeed.undos.pop()()'); await settle();
  assert.equal(chevron().dataset.state, 'open');
  f.runObservation('visitNew.arrive([...views.messages.values()]); paintMessageUpdates()');
  assert.deepEqual(marks(), ['m4'], 'Undo or a repeated live page cannot resurrect handled marks');
  f.runObservation("visitNew.arrive([{id:'later',author_id:'agent-a'}])");
  assert.deepEqual(marks(), ['later', 'm4'], 'later arrivals still become new');
  assert.equal(JSON.stringify(items), stored, 'stored read and fold facts remain untouched');
  assert.equal(f.calls.filter(c => c.kind).length, commands, 'collapse sends no Core command');
});
const messages = (from, through) => Array.from({ length: through - from + 1 }, (_, i) => ({ id: 'm' + (from + i), seq: from + i, author_id: 'agent-a', body: 'Body ' + (from + i), topic_id: 't1' }));
const page = (from, through, next) => ({ instance_id: 'fixture', items: messages(from, through), next_cursor: next, relevant_versions: { topic: 1 } });

test('a page that leaves a gap in the loaded messages never reads across it', async () => {
  const { f, ranges, card } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage(page(22, 31, 22), { initial: true }); await settle();
  // #32..#41 arrive, then #42..#71, and a newest page is loaded on its own
  // (a page that neither continues nor overlaps what was loaded), so #32..#41
  // are not loaded.
  const pages = [page(32, 41, 32), page(20, 31, 20)];
  const view = f.api.view;
  f.api.view = async (name, args) => {
    if (name === 'topic_messages') { f.calls.push({ name, args }); return pages.shift(); }
    if (name === 'memory_items') return { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } };
    return view(name, args);
  };
  views.messagesPage(page(42, 71, 42), { initial: true, cursor: views.olderCursor }); await settle();
  assert.equal(views.messages.has('m35'), false, 'the gap is real: #35 was never loaded');
  const shown = seqs => f.observers[0].callback(seqs.map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })));
  shown([30, 31, 42, 43]); await settle(); await settle();
  assert.deepEqual(ranges().sort((a, b) => a[0] - b[0]), [[30, 31], [42, 43]], 'each side of the gap is its own range; #32..#41 stay pending');
  // An older page continues the newest run. Until a page overlaps what was
  // loaded before, nothing shows the two runs meet: #31 and #32 side by side
  // on screen are two ranges. Once a page overlaps both, the screen from #30
  // to #43 (with #32..#41 loaded between them, they show too) is one range.
  await f.loadOlderMessages(); await settle();
  assert.equal(views.messages.has('m35'), true);
  shown([31, 32]); await settle(); await settle();
  assert.deepEqual(ranges().slice(2), [[32, 32]], 'the runs have not met: #32 is reported apart from #31');
  await f.loadOlderMessages(); await settle();
  shown(Array.from({ length: 14 }, (_, i) => 30 + i)); await settle(); await settle();
  assert.deepEqual(ranges().at(-1), [30, 43], 'once a page overlaps both, the cards on screen are one range');
});

test('nothing is read while the version review covers the page; closing it reads once', async () => {
  const { f, ranges, card } = await readingPage();
  for (let seq = 20; seq <= 25; seq++) f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  f.paintViews('messages'); await settle();
  const review = f.get('version-review');
  review.open = true;
  f.observers[0].callback([24, 25].map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })));
  for (const handler of f.events.filter(e => e[0] === 'window-handler' && e[1] === 'focus')) handler[2]();
  await settle();
  assert.deepEqual(ranges(), [], 'the cards under the review are not read');
  review.open = false; review.handlers.close(); await settle();
  assert.deepEqual(ranges(), [[24, 25]], 'closing the review reads what it covered, once');
  review.handlers.close(); await settle();
  assert.deepEqual(ranges(), [[24, 25]]);
});

// The New line holds for what the page read on screen until the reader acts on
// it (TopicViews.held): opens a message at or above it in the Reader, replies,
// or presses Mark read. What counts is what the page saw before the act, not
// when its report goes out: ReadThrough sends one report per topic at a time,
// a microtask after it is asked, so a report can leave after an act. The page
// here is real (noteRead, ReadThrough, TopicViews); only Core is held, each
// receipt answered by the check.
test('an act on what the New line marks releases every card read on screen before it, whenever its report goes out; the Reader\'s own report never holds the line', async () => {
  const start = async () => {
    const { f, card } = await readingPage();
    const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', reader: 'fixture-person', paint: kind => f.paintViews(kind), invalidate() {} });
    f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
    const sends = [];
    f.api.command = envelope => {
      assert.equal(envelope.kind, 'topic.read_through');
      const answer = defer();
      sends.push({ range: [envelope.args.from_seq, envelope.args.seq], settles: n => answer.resolve({ recorded: true, status: 'committed', result: { topic_id: 't1', acknowledged: n } }) });
      return answer.promise;
    };
    // #20..#26 loaded; #22 is the oldest unread, so the line is under it.
    views.messagesPage({ ...page(20, 26, null), oldest_unread: { seq: 22, id: 'm22' }, commit_seq: 5 }, { initial: true }); await settle();
    const show = (seqs, hidden = []) => f.observers[0].callback([...seqs.map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })),
      ...hidden.map(seq => ({ target: card(seq), isIntersecting: false, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 600 } }))]);
    const reader = seq => { f.registry.current = { source: { source_ref: { kind: 'message', id: 'm' + seq }, topic_id: 't1', seq, author: 'agent-a' }, editors: {}, mode: 'reply' }; show([]); };
    // Core then says nothing is unread, at a later commit.
    const allRead = async () => { await views.readUnread(async () => ({ instance_id: 'fixture', topic_id: 't1', oldest_unread: null, commit_seq: 50 })); return views.held; };
    return { f, views, sends, show, reader, allRead };
  };
  const sent = sends => sends.map(s => s.range);

  // Opened in the Reader one by one, down to the line, each its own report: the
  // first screen's cards were acted on, and the Reader's reports hold nothing.
  {
    const { sends, show, reader, allRead } = await start();
    show([25, 26]); await settle();
    sends[0].settles(2); await settle();
    for (const seq of [26, 25, 24, 23, 22]) {
      const before = sends.length;
      reader(seq); await settle();
      if (sends.length > before) sends.at(-1).settles(1);
      await settle();
    }
    assert.deepEqual(sent(sends), [[25, 26], [24, 24], [23, 23], [22, 22]], 'the first screen, then each message the Reader showed that was not reported yet');
    assert.equal(await allRead(), false, 'every message at or above the line opened in the Reader: the line fades');
  }

  // The Reader is open when a message arrives and the faded line comes back
  // under it; the Reader then shows it. Its report goes out after the open,
  // while it is unread: an open, never a range read on screen.
  {
    const { views, sends, reader, allRead } = await start();
    assert.equal(await allRead(), false, 'read elsewhere, the line has faded');
    views.messagesPage({ ...page(27, 27, null), items: [{ id: 'm27', seq: 27, author_id: 'agent-a', body: 'Arrives', topic_id: 't1' }] }, { live: true, cursor: 26 });
    await views.readUnread(async () => ({ instance_id: 'fixture', topic_id: 't1', oldest_unread: { seq: 27, id: 'm27' }, commit_seq: 60 }));
    assert.deepEqual([views.line?.seq, views.held], [27, true], 'the line comes back under the message that arrived');
    reader(27); await settle();
    assert.deepEqual(sent(sends).at(-1), [27, 27], 'the Reader reports it read');
    sends.at(-1).settles(1); await settle();
    await views.readUnread(async () => ({ instance_id: 'fixture', topic_id: 't1', oldest_unread: null, commit_seq: 70 }));
    assert.equal(views.held, false, 'shown in the Reader, the line fades once nothing is unread');
  }

  // Cards read on screen while another report is in flight wait in
  // ReadThrough, and go out after the act: they were read before it, so they
  // hold nothing. Without an act they hold the line, so the check can fail.
  for (const act of ['none', 'open', 'reply', 'mark read']) {
    const { views, sends, show, reader, allRead } = await start();
    show([25, 26]); await settle();
    show([22, 23, 24]); await settle();
    assert.deepEqual(sent(sends), [[25, 26]], act + ': the second range waits behind the first');
    if (act === 'open') reader(26);
    if (act === 'reply') views.messagesPage({ ...page(27, 27, null), items: [{ id: 'm27', seq: 27, author_id: 'fixture-person', body: 'A reply', topic_id: 't1' }] }, { live: true, cursor: 26 });
    if (act === 'mark read') views.placeAfresh();
    await settle();
    sends[0].settles(2); await settle();
    assert.deepEqual(sent(sends), [[25, 26], [22, 26]], act + ': the waiting range goes out after the act');
    sends[1].settles(3); await settle();
    assert.equal(await allRead(), act === 'none', act === 'none' ? 'read on screen with no act, the line holds' : act + ': read on screen before the act, the line fades once nothing is unread');
  }

  // Read in two pieces before the act, one in flight and one waiting, and on
  // screen together after it: nothing in the range is new, so it holds nothing.
  for (const act of ['none', 'reply', 'mark read']) {
    const { views, sends, show, allRead } = await start();
    show([25, 26]); await settle();
    show([22, 23, 24], [25, 26]); await settle();
    if (act === 'reply') views.messagesPage({ ...page(27, 27, null), items: [{ id: 'm27', seq: 27, author_id: 'fixture-person', body: 'A reply', topic_id: 't1' }] }, { live: true, cursor: 26 });
    if (act === 'mark read') views.placeAfresh();
    show([25, 26]); await settle();
    sends[0].settles(2); await settle();
    sends[1].settles(3); await settle();
    assert.deepEqual(sent(sends), [[25, 26], [22, 24]], act + ': each piece once, and nothing again');
    assert.equal(await allRead(), act === 'none', act === 'none' ? 'read on screen with no act, the line holds' : act + ': seen again after the act, cards read before it hold nothing');
  }
});

// A report whose answer is lost after Core recorded it (the connection drops,
// a phone puts the page in the background, the server restarts): the page
// cannot tell it from a report Core never saw, so its cards keep holding the
// line, which reading on screen never fades. The page here is real (noteRead,
// ReadThrough, TopicViews); Core records the report and the answer is lost.
test('a report whose answer is lost after Core recorded it keeps the New line until the reader acts', async () => {
  for (const act of ['none', 'open']) {
    const { f, card } = await readingPage();
    const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', reader: 'fixture-person', paint: kind => f.paintViews(kind), invalidate() {} });
    f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
    const recorded = [];
    f.api.command = async envelope => {
      assert.equal(envelope.kind, 'topic.read_through');
      recorded.push([envelope.args.from_seq, envelope.args.seq]);
      throw new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
    };
    views.messagesPage({ ...page(20, 21, null), oldest_unread: { seq: 20, id: 'm20' }, commit_seq: 5 }, { initial: true }); await settle();
    f.observers[0].callback([20, 21].map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })));
    await settle(); await settle();
    assert.deepEqual(recorded, [[20, 21]], act + ': Core recorded the first screen; its answer was lost');
    if (act === 'open') { f.registry.current = { source: { source_ref: { kind: 'message', id: 'm21' }, topic_id: 't1', seq: 21, author: 'agent-a' }, editors: {}, mode: 'reply' }; f.observers[0].callback([]); await settle(); }
    // Core then says nothing is unread, at a later commit.
    await views.readUnread(async () => ({ instance_id: 'fixture', topic_id: 't1', oldest_unread: null, commit_seq: 50 }));
    assert.equal(views.held, act === 'none', act === 'none' ? 'read on screen and recorded, its answer lost: the line still holds' : 'opened in the Reader, the line fades');
  }
});

// What is drawn above the messages after they paint, in their column
// (docs/agents.md): the marks line, and on a conversation page its Show row
// and header, which land with the conversation's read. Each would push the
// cards down, so no card is read on screen until each has had its first
// answer, read or refused; then the cards on screen are. The outcome rail is
// never above them (beside the topic, or in the phone's drawer), so a read of
// the rail, held, holds no card back. Each read is held in turn, alone.
test('no card is read on screen until every fill drawn above the messages has had its first answer, read or refused, and a fill of the rail holds none back', async t => {
  const fills = [
    { fill: 'the marks line', page: 'topic', holds: name => name === 'marks', above: true },
    { fill: 'conversation reply metadata', page: 'conversation', holds: name => name === 'conversation', above: false },
    { fill: 'the topics rail', page: 'topic', holds: name => name === 'workspace_topics', above: false },
    { fill: 'the conversation row', page: 'topic', holds: name => name === 'conversation', above: false },
    { fill: 'the Pipeline row', page: 'topic', holds: name => name === 'pipeline_row', above: false },
    { fill: '← Outcomes with its light', page: 'topic', holds: (name, args) => name === 'attention' && args.workspace_id === 'w1', above: false },
    { fill: 'the conversation page\'s topics rail', page: 'conversation', holds: name => name === 'workspace_topics', above: false },
  ];
  for (const { fill, page: kind, holds, above } of fills) {
    for (const answer of ['read', 'refused']) await t.test(`${fill}, ${answer}`, async () => {
      const label = `${fill} on a ${kind} page, ${answer}`;
      const f = fixture('https://fixture/?topic=t1', { history: { state: null, replaceState() {} } }); Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
      if (kind === 'conversation') f.topic.kind = 'conversation';
      f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
      Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
      const view = f.api.view, held = [];
      f.api.view = (name, args, options) => {
        if (!holds(name, args ?? {}) || held.length) return view(name, args, options);
        const release = defer(); held.push(release);
        return release.promise.then(() => { if (answer === 'refused') throw new AttemptError('Refused.', 503); return view(name, args, options); });
      };
      const ranges = () => f.calls.filter(c => c.kind === 'topic.read_through').map(c => [c.envelope.args.from_seq, c.envelope.args.seq]);
      await f.initialize(); await settle();
      assert.equal(held.length, 1, label + ': the page asked for it once, and it is held');
      assert.equal(f.document.body.classList.contains('conversation-page'), false, label + ': every topic uses the ordinary page');
      for (let seq = 20; seq <= 22; seq++) f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body ' + seq, topic_id: 't1' });
      f.views.newest = 22; f.paintViews('messages'); await settle();
      const card = seq => f.observers[0].targets.find(target => target.dataset.seq === seq);
      f.observers[0].callback([21, 22].map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })));
      for (const handler of f.events.filter(e => e[0] === 'window-handler' && e[1] === 'focus')) handler[2]();
      await settle(); await settle();
      assert.deepEqual(ranges(), above ? [] : [[21, 22]], above ? label + ': while it is unanswered, no card on screen is read'
        : label + ': it is not above the messages, so the cards on screen are read while it is unanswered');
      held[0].resolve(); await settle(); await settle(); await settle();
      assert.deepEqual(ranges(), [[21, 22]], label + ': once it has its answer, the cards on screen are read, once');
    });
  }
});

// A model of IntersectionObserver for vertical scrolling: an entry is queued
// when a target's threshold index or isIntersecting changes, and an edge-
// adjacent (zero-area) intersection counts as intersecting.
function viewport(observers, height, boxes) {
  const known = new Map();
  return top => {
    for (const observer of observers) {
      const [above, , below] = (observer.options.rootMargin ?? '0% 0px 0% 0px').split(' ').map(value => parseFloat(value) / 100 * height);
      const rootTop = top - above, rootBottom = top + height + below, thresholds = [observer.options.threshold].flat();
      const entries = [];
      for (const target of observer.targets) {
        const box = boxes.get(Number(target.dataset.seq));
        const from = Math.max(box.top, rootTop), to = Math.min(box.top + box.height, rootBottom);
        const isIntersecting = from <= to, ratio = isIntersecting ? (to - from) / box.height : 0;
        const index = thresholds.findIndex(value => value > ratio), state = (index < 0 ? thresholds.length : index) + ':' + isIntersecting;
        const key = `${observer.options.rootMargin}|${target.dataset.seq}`;
        if (known.get(key) === state) continue;
        known.set(key, state);
        entries.push({ target, isIntersecting, intersectionRatio: ratio, intersectionRect: { height: Math.max(0, to - from) }, rootBounds: { height: rootBottom - rootTop } });
      }
      if (entries.length) observer.callback(entries);
    }
  };
}

test('a card taller than four viewports is read when the person scrolls through it', async () => {
  const { f, ranges } = await readingPage();
  for (const seq of [30, 31, 32]) f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  f.paintViews('messages'); await settle();
  // #30 fills the top of the viewport; #31 below it is five viewports tall.
  const scroll = viewport(f.observers, 600, new Map([[30, { top: 0, height: 400 }], [31, { top: 400, height: 3000 }], [32, { top: 3400, height: 100 }]]));
  const reads = [];
  for (let top = 0; top <= 2600; top += 50) {
    scroll(top); await settle(); await settle();
    reads.push([top, ranges().some(([from, through]) => from <= 31 && 31 <= through)]);
  }
  assert.deepEqual(ranges()[0], [30, 30], 'the short card on screen at the start is read alone');
  // It covers half the 600-pixel viewport once scrolled 100 pixels.
  assert.deepEqual(reads.filter(([top]) => top <= 100), [[0, false], [50, false], [100, true]], 'the tall card is read once it covers half the viewport, not before');
});

test('a message sent by name opens where it can even when the page never started', async () => {
  const f = fixture();
  // No initialize: the page's start failed, so it has no navigation of its own.
  await f.openSent({ id: 'd1', topic_readable: true, topic: { id: 't9', title: 'Plans' } });
  await f.openSent({ id: 'd2', topic_readable: false, topic: { id: 't8', title: 'Lost' } });
  assert.deepEqual(f.events.filter(event => event[0] === 'navigate').map(event => event[1]), ['?topic=t9', '/']);
});

// The pickers: who may change a topic's participants or an outcome's team gets
// a field fed by the directory, and the composer offers who can be sent to.
const walk = node => (node.children ?? []).filter(child => child && typeof child === 'object').flatMap(child => [child, ...walk(child)]);
// A person in the topic's people: one pill, at the bottom of the page.
const isPill = node => String(node.className ?? '').split(' ').includes('person-pill');
// A small stand-in for Core: participation.set and workspace.member_set check
// the revision as Core does, topic.update each field it is fenced on; each
// applies the change and advances the version. A topic.update answers with the
// topic as it now stands, as Core does.
const pickerApi = (f, { topic = {}, workspace = {} } = {}) => {
  const state = f.pickers = {
    topic: { ...f.topic, version: 3, owner_id: 'fixture-person', creator_id: 'other', ...topic },
    workspace: { id: 'w1', title: 'Outcome', owner_id: 'fixture-person', version: 5, ...workspace },
    participants: [{ actor_id: 'fixture-person', kind: 'human', enabled: true }, { actor_id: 'fable', kind: 'agent', enabled: true }],
    members: [{ actor_id: 'fixture-person', kind: 'human', name: 'Fixture', enabled: true }, { actor_id: 'ally', kind: 'agent', name: 'Ally', enabled: true }],
    actors: [{ id: 'tony', kind: 'human', name: 'Tony' }], membersRefused: false,
  };
  f.api.view = async (name, args) => {
    f.calls.push({ name, args });
    if (name === 'topic') return { instance_id: 'fixture', topic: { ...state.topic }, participants: state.participants.map(row => ({ ...row })) };
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { ...state.workspace } };
    if (name === 'workspace_members') return state.membersRefused ? { error: { code: 'DATABASE_BUSY', message: 'Busy' } }
      : { instance_id: 'fixture', items: state.members.map(row => ({ ...row })), next_cursor: null };
    if (name === 'actors') return { instance_id: 'fixture', items: state.actors.map(row => ({ ...row })), next_cursor: null };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  };
  f.api.command = async envelope => {
    f.calls.push({ kind: envelope.kind, envelope });
    const [record, field, list] = envelope.kind === 'participation.set' ? [state.topic, 'topic_revision', 'participants']
      : envelope.kind === 'topic.update' ? [state.topic, 'topic_revision', null] : [state.workspace, 'workspace_revision', 'members'];
    const held = { title: record.title, archived: record.archived ?? false, state: record.state ?? 'active', note: record.state_note ?? '', waiting_on: record.waiting_on ?? [] };
    const fenced = envelope.kind === 'topic.update' ? Object.entries(envelope.expected.topic_fields).every(([name, seen]) => JSON.stringify(seen) === JSON.stringify(held[name]))
      : envelope.expected[field] === record.version;
    if (!fenced)
      return { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed; preserve this attempt and reconcile', current_versions: { [field]: record.version } } };
    if (envelope.kind === 'topic.update') {
      const { title = record.title, archived = record.archived ?? false, state: said = record.state ?? 'active', waiting_on = [] } = envelope.args;
      const note = envelope.args.note ?? (said === record.state || envelope.args.keep_note ? record.state_note ?? '' : '');
      // A word on where it stands is said by someone, no longer by a message's reopen.
      const reopen = ['state', 'note', 'waiting_on'].some(name => name in envelope.args) ? null : record.state_message_id ?? null;
      Object.assign(record, { title, archived, state: said, state_note: note, waiting_on, state_by: 'fixture-person', state_ms: null, state_message_id: reopen, version: record.version + 1 });
      return { status: 'committed', result: { topic_id: record.id, version: record.version, title, archived, state: said, note, waiting_on, state_by: 'fixture-person', state_ms: null,
        state_message_id: reopen } };
    }
    const { actor_id, present } = envelope.args;
    state[list] = state[list].filter(row => row.actor_id !== actor_id).concat(present ? [{ actor_id, kind: 'human', enabled: true }] : []);
    record.version += 1;
    return { status: 'committed', result: { version: record.version } };
  };
};
// "+ Add" opens the filter; Return in it adds the name typed (or the one name it still offers).
const add = async (host, id) => {
  const opener = walk(host).find(node => node.textContent === '+ Add');
  if (opener['aria-expanded'] !== 'true') opener.onclick();
  const input = walk(host).find(node => node.className === 'people-add').children.find(node => node.tagName === 'INPUT');
  input.value = id;
  input.onkeydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  await drain();
};
// Return in the composer's small field names someone else.
const nameIn = (f, id, name) => { f.get(id).value = name; f.get(id).handlers.keydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {}, stopPropagation() {} }); };
const removeButton = (host, id) => walk(host).find(node => node['aria-label'] === `Remove ${id}`);
// Envelopes come from the page's realm; compare them as data.
const sentOf = (f, kind, field) => JSON.parse(JSON.stringify(f.calls.filter(call => call.kind === kind).map(call => [call.envelope.expected[field], call.envelope.args])));
const focusIn = (f, list) => { for (const [, name, fn] of f.events) if (name === 'focusin') fn({ target: { getAttribute: key => key === 'list' ? list : null } }); };
const drain = async () => { for (let n = 0; n < 6; n++) await new Promise(setImmediate); };

test('a topic\'s manager adds and removes participants from the directory, and the composer offers the team and participants', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  await drain();
  assert.deepEqual(f.get('directory-names').children.map(option => [option.value, option.label]), [['tony', 'Tony · human']]);
  assert.deepEqual(f.get('addressable-names').children.map(option => [option.value, option.label ?? null]),
    [['fixture-person', 'Fixture · human'], ['ally', 'Ally · agent'], ['fable', 'agent']], 'team entries, which carry names, come first');
  await add(f.get('participants'), 'tony');
  await removeButton(f.get('participants'), 'fable').onclick();
  assert.deepEqual(sentOf(f, 'participation.set', 'topic_revision'),
    [[3, { actor_id: 'tony', present: true }], [3, { actor_id: 'fable', present: false }], [4, { actor_id: 'fable', present: false }]],
    'a remove sends present:false; sent at a revision the add had moved on, it is sent once more at the current one');
  assert.deepEqual(f.pickers.participants.map(row => row.actor_id), ['fixture-person', 'tony']);
  assert.ok(f.events.some(([kind]) => kind === 'request'), 'a change asks for fresh views');
  assert.equal(walk(f.get('participants')).find(node => node.className === 'notice').hidden, true);
});

test('a conflict that persists is said plainly, and a disabled person is not offered to the composer', async () => {
  const f = fixture();
  pickerApi(f);
  f.pickers.members[1].enabled = false;
  f.pickers.participants[1].enabled = false;
  await f.initialize();
  await drain();
  assert.deepEqual(f.get('addressable-names').children.map(option => option.value), ['fixture-person']);
  const command = f.api.command;
  f.api.command = async envelope => { f.pickers.topic.version += 1; return command(envelope); };
  await add(f.get('participants'), 'tony');
  assert.equal(walk(f.get('participants')).find(node => node.className === 'notice').textContent, 'Someone else changed this at the same moment. Try again.');
  assert.equal(sentOf(f, 'participation.set', 'topic_revision').length, 2, 'one more send, never a loop');
});

test('a topic\'s creator who does not own the outcome manages its participants; a participant who is neither does not', async () => {
  const creator = fixture();
  pickerApi(creator, { topic: { owner_id: 'tony', creator_id: 'fixture-person' } });
  await creator.initialize();
  assert.ok(walk(creator.get('participants')).find(node => node.textContent === '+ Add'), 'its manager is offered "+ Add"');
  assert.ok(removeButton(creator.get('participants'), 'fable'));

  const f = fixture();
  pickerApi(f, { topic: { owner_id: 'tony', creator_id: 'tony' } });
  await f.initialize();
  const nodes = walk(f.get('participants'));
  assert.deepEqual([nodes.find(node => node.className === 'people-add').hidden, nodes.some(node => node.textContent === '×'), nodes.some(node => node.textContent === '+ Add')], [true, false, false]);
  // A pill's words, as the DOM's textContent gives them: the name is a span inside it, an agent's a button.
  assert.deepEqual(nodes.filter(isPill).map(node => node.children.map(child => child.textContent ?? child).join('')), ['fixture-person', 'fable']);
});

test('the directory and the team behind the composer are read again when someone starts naming', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  await drain();
  f.pickers.actors.push({ id: 'newcomer', kind: 'agent', name: 'Newcomer' });
  focusIn(f, 'directory-names');
  await drain();
  assert.deepEqual(f.get('directory-names').children.map(option => option.value), ['tony', 'newcomer']);
  f.pickers.actors.push({ id: 'second', kind: 'agent', name: 'Second' });
  focusIn(f, 'directory-names');
  await drain();
  assert.equal(f.get('directory-names').children.length, 3, 'each focus reads again');
  f.pickers.members = f.pickers.members.filter(row => row.actor_id !== 'ally');
  focusIn(f, 'addressable-names');
  await drain();
  assert.deepEqual(f.get('addressable-names').children.map(option => option.value), ['fixture-person', 'fable'], 'someone removed from the team is no longer offered');
});

test('a team read on focus that fails keeps the team the page had; one refused for want of permission drops it', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  await drain();
  showComposer(f);
  const offered = () => f.get('addressable-names').children.map(option => option.value);
  const mark = name => {
    nameIn(f, 'inline-recipient-input', name);
    return f.get('inline-recipient-chips').children.find(node => node.dataset.name === name).className;
  };
  assert.deepEqual([offered(), mark('stranger')], [['fixture-person', 'ally', 'fable'], 'chip unreachable']);
  // A busy server sheds the background read just as the person starts naming.
  f.pickers.membersRefused = true;
  focusIn(f, 'addressable-names');
  await drain();
  assert.deepEqual(offered(), ['fixture-person', 'ally', 'fable'], 'a busy read is not an empty team');
  assert.equal(mark('outsider'), 'chip unreachable', 'reach is still known');
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'workspace_members' ? { error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } } : view(name, args);
  focusIn(f, 'addressable-names');
  await drain();
  assert.deepEqual([offered(), mark('elsewhere')], [['fixture-person', 'fable'], 'chip'], 'a reader no longer allowed to list the team is offered no team and marks nobody');
});

test('an outcome\'s owner changes its team on the outcome page; the owner cannot be removed there', async () => {
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.live = stream(); f.useLive(f.live);
  pickerApi(f);
  await f.initialize();
  const team = f.get('team-people');
  assert.equal(f.get('outcome-team').hidden, false);
  assert.deepEqual(walk(team).filter(node => node.textContent === '×').map(node => node['aria-label']), ['Remove Ally']);
  await add(team, 'tony');
  await drain();
  // Someone's message elsewhere in the outcome moves its revision on.
  f.pickers.workspace.version += 1;
  await removeButton(team, 'Ally').onclick();
  await drain();
  assert.deepEqual(sentOf(f, 'workspace.member_set', 'workspace_revision'),
    [[5, { actor_id: 'tony', present: true }], [6, { actor_id: 'ally', present: false }], [7, { actor_id: 'ally', present: false }]]);
  assert.deepEqual(f.pickers.members.map(row => row.actor_id), ['fixture-person', 'tony']);
  const people = () => walk(team).filter(node => node.classList?.contains('person-pill')).map(node => node.children[0].textContent);
  assert.deepEqual(people(), ['Fixture', 'tony'], 'the shared participant pills show the reread team');

  // A team that cannot be read keeps the chips it had and says so.
  f.pickers.membersRefused = true;
  await commit(f.live, 2);
  assert.deepEqual(people(), ['Fixture', 'tony']);
  assert.match(walk(team).find(node => node.className === 'notice').textContent, /^The team could not be read/);

  // Someone else's commit: the page rereads the outcome, so its revision and team stay current.
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  const watched = fixture('https://fixture/?workspace=w1');
  watched.inject({ api: watched.api, bootstrap: watched.bootstrap });
  pickerApi(watched);
  watched.useLive(live);
  await watched.initialize();
  const reads = () => watched.calls.filter(call => call.name === 'workspace_members').length;
  const before = reads();
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await drain();
  assert.equal(reads(), before + 1, 'a commit rereads the team');

  const other = fixture('https://fixture/?workspace=w1');
  other.inject({ api: other.api, bootstrap: other.bootstrap });
  pickerApi(other, { workspace: { owner_id: 'tony' } });
  await other.initialize();
  assert.equal(walk(other.get('team-people')).find(node => node.className === 'people-add').hidden, true);
  assert.equal(walk(other.get('team-people')).some(node => node.textContent === '+ Add'), true, 'a member can open Coordinator; team management and Invite keep their existing rights');
  assert.deepEqual([f.get('outcome-purpose').hidden, other.get('outcome-purpose').hidden], [false, true], 'its owner sets the purpose in place; a member reads it');

  // Its coordinator organises it beside the owner, so they set the purpose too.
  const coordinator = fixture('https://fixture/?workspace=w1');
  coordinator.inject({ api: coordinator.api, bootstrap: coordinator.bootstrap });
  pickerApi(coordinator, { workspace: { owner_id: 'tony', coordinator_id: 'fixture-person' } });
  await coordinator.initialize();
  assert.equal(coordinator.get('outcome-purpose').hidden, false, 'the coordinator sets the purpose in place');
  assert.equal(walk(other.get('team-people')).some(node => node.textContent === '×'), false, 'a member who is not the owner only sees the team');
});

test('an outcome that becomes unavailable stops showing its team', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream();
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  pickerApi(f);
  await f.initialize();
  assert.equal(f.get('outcome-team').hidden, false);
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'workspace' ? { error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } } : view(name, args);
  await commit(live, 2);
  assert.equal(f.get('topic-title').textContent, 'Outcome unavailable');
  assert.equal(f.get('outcome-team').hidden, true);
});

// Show the page's own inline composer on the fixture's topic writing.
const showComposer = f => {
  f.editor.edit = patch => Object.assign(f.editor.draft, patch);
  f.owners().inline.show(f.p);
};

// A name typed in To and not named holds Send (compose-bar.mjs holdSend):
// sending with or without them would reach people the who chip did not say.
test('the New message composer\'s Send with a name typed in To and not named sends nothing and says so; with To cleared it sends as shown', async () => {
  const f = fixture('https://fixture/?topic=t1', { window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => 'none' }) } });
  const sent = [];
  f.inline.callbacks.send = editor => { sent.push(JSON.parse(JSON.stringify(editor.draft.addressees))); return Promise.resolve(); };
  f.editor.edit = patch => Object.assign(f.editor.draft, patch);
  f.get('inline-writing-body').style = {};
  f.get('inline-recipient-input').value = 'warp';
  await f.inline.send();
  assert.deepEqual([sent, f.editor.draft.addressees, f.get('inline-notice').textContent],
    [[], [], 'warp is typed in To but not named yet. Return names them; clear it to send without them.'], 'nothing is sent, no one is named, and it says why');
  assert.deepEqual([f.get('inline-who-panel').hidden, f.document.activeElement === f.get('inline-recipient-input')], [false, true], 'To is open on the name');
  f.get('inline-recipient-input').value = '';
  await f.inline.send();
  assert.deepEqual(sent, [[]], 'cleared, it goes to no one by name, as it showed');
});

// What Send said goes as soon as it is no longer true (compose-bar.mjs
// settle), however the name stops being typed and not named: Return in To, a
// tap on them among the topic's people, or To cleared.
for (const [way, act] of [
  ['Return in To names them', f => nameIn(f, 'inline-recipient-input', 'warp')],
  ['a tap on them names them', f => f.inline.addName('warp')],
  ['To is cleared', f => { f.get('inline-recipient-input').value = ''; f.get('inline-recipient-input').handlers.input({}); }],
]) test(`in the New message composer, what Send said about warp typed in To goes when ${way}`, async () => {
  const f = fixture('https://fixture/?topic=t1', { window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => 'none' }) } });
  f.inline.callbacks.send = () => { throw Error('sent while a name waited'); };
  f.editor.edit = patch => Object.assign(f.editor.draft, patch);
  f.get('inline-writing-body').style = {};
  f.get('inline-recipient-input').value = 'warp';
  await f.inline.send();
  const notice = () => f.get('inline-notice').hidden ? '' : f.get('inline-notice').textContent;
  assert.equal(notice(), 'warp is typed in To but not named yet. Return names them; clear it to send without them.', 'Send waits, and says why');
  act(f);
  assert.equal(notice(), '', `${way}: nothing says warp is not named`);
});

// Escape with focus outside the open who panel (on +, on Send) is heard by
// the composer itself, on the document, wherever the composer is: at the
// place in the feed, in no dialog, and in the popped New message sheet, whose own
// cancel then never comes. It puts the panel away as the panel's own Escape
// does, naming what was typed in To (docs/reader.md).
for (const on of ['inline-plus-button', 'inline-send']) test(`the New message composer hears Escape with focus on ${on}, outside the open who panel: it puts the panel away and names what was typed in To; with no panel open it leaves Escape to the page`, () => {
  const f = fixture('https://fixture/?topic=t1', { window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => 'none' }) } });
  f.editor.edit = patch => Object.assign(f.editor.draft, patch);
  f.get('inline-writing-body').style = {};
  // To's field sits in the who panel, as the page has it.
  f.get('inline-who-panel').append(f.get('inline-recipient-input'));
  const listening = () => f.events.filter(([kind, name]) => kind === 'document-handler' && name === 'keydown').map(([, , fn]) => fn);
  const before = listening();
  f.get('inline-who-chip').handlers.click({});
  assert.equal(f.get('inline-who-panel').hidden, false, 'the who panel is open');
  f.get('inline-recipient-input').value = 'warp';
  f.get(on).focus();
  const escape = () => {
    const event = { type: 'keydown', key: 'Escape', isComposing: false, target: f.get(on), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of listening().filter(fn => !before.includes(fn))) fn(event);
    return event.defaultPrevented;
  };
  assert.equal(escape(), true, 'the Escape was the panel\'s');
  assert.deepEqual([JSON.parse(JSON.stringify(f.editor.draft.addressees)), f.get('inline-recipient-input').value, f.get('inline-who-panel').hidden, f.document.activeElement === f.get('inline-who-chip')],
    [['warp'], '', true, true], 'warp is named, To is empty, and focus is back on the who chip');
  assert.equal(escape(), false, 'with no panel open, Escape is the page\'s (the popped sheet\'s, which puts it away)');
  assert.deepEqual(listening(), before, 'and the composer no longer listens');
});

test('a name typed in the New message composer\'s To stays with the topic it was typed in: another topic\'s message starts with To empty and never names it', () => {
  const f = fixture();
  const other = { ...structuredClone(f.editor), key: 'inline-t2', context: { ...f.editor.context, topicId: 't2', sourceRef: { kind: 'topic', id: 't2' } } };
  for (const editor of [f.editor, other]) editor.edit = patch => Object.assign(editor.draft, patch);
  const p2 = { ...f.p, topic: { ...f.topic, id: 't2', title: 'Other' }, editors: { reply: other } };
  f.get('inline-recipient-input').value = 'warp';
  f.inline.show(p2);
  assert.equal(f.get('inline-recipient-input').value, '', 'the other topic\'s To is empty');
  f.get('inline-recipient-input').handlers.keydown({ key: 'Enter', isComposing: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify([f.editor.draft.addressees, other.draft.addressees])), [[], []], 'Return there names no one');
  f.inline.show(f.p);
  assert.equal(f.get('inline-recipient-input').value, 'warp', 'back in the first topic, warp is typed in To as it was');
  nameIn(f, 'inline-recipient-input', 'warp');
  assert.deepEqual(JSON.parse(JSON.stringify([f.editor.draft.addressees, other.draft.addressees])), [['warp'], []], 'and Return names warp there alone');
});

test('addressing someone outside the topic offers its manager to add them, and the chip clears once they are in', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  showComposer(f);
  const address = name => { nameIn(f, 'inline-recipient-input', name); };
  const chip = name => f.get('inline-recipient-chips').children.find(node => node.dataset.name === name);
  address('ally'); address('stranger'); address('fable');
  assert.equal(chip('ally').className, 'chip', 'an outcome member can be sent to');
  assert.deepEqual([chip('fable').className, chip('fable')['aria-pressed']], ['choice-chip', 'true'], 'a participant is a name tapped once, lit when named');
  assert.equal(chip('ally').tagName, 'SPAN', 'someone outside the topic is named in the small field and shown with a ×');
  assert.equal(chip('stranger').className, 'chip unreachable');
  const offer = walk(chip('stranger')).find(node => node.textContent?.startsWith('Add to topic'));
  // The add commits; the next topic view lists the new participant.
  const participants = [{ actor_id: 'fixture-person' }, { actor_id: 'fable' }, { actor_id: 'stranger' }];
  offer.focus();
  await offer.onclick();
  const sent = JSON.parse(JSON.stringify(f.calls.filter(call => call.kind === 'participation.set').map(call => call.envelope.args)));
  assert.deepEqual(sent, [{ actor_id: 'stranger', present: true }]);
  Object.assign(f.views, { topic: { ...f.topic, version: 4, owner_id: 'fixture-person', creator_id: 'other' }, participants, messages: new Map() });
  f.paintViews('topic');
  assert.deepEqual([chip('stranger').className, chip('stranger')['aria-pressed']], ['choice-chip', 'true'], 'once a participant, the mark goes and the name is lit');
  assert.equal(f.document.activeElement, f.get('inline-recipient-input'), 'focus that was on the offer goes to the recipient field');
});

test('a switched-off participant or teammate is marked so, with no add offer, and a refused add is said on its chip', async () => {
  const f = fixture();
  pickerApi(f);
  f.pickers.participants.push({ actor_id: 'idle', kind: 'agent', enabled: false });
  f.pickers.members.push({ actor_id: 'gone', kind: 'agent', name: 'Gone', enabled: false });
  await f.initialize();
  showComposer(f);
  const address = name => { nameIn(f, 'inline-recipient-input', name); };
  const chip = name => f.get('inline-recipient-chips').children.find(node => node.dataset.name === name);
  address('idle'); address('gone'); address('stranger');
  for (const name of ['idle', 'gone']) {
    assert.equal(chip(name).className, 'chip unreachable', `${name} cannot receive`);
    assert.equal(walk(chip(name)).find(node => node.className === 'reach').textContent, ' · switched off');
    assert.equal(walk(chip(name)).some(node => node.textContent?.startsWith('Add to topic')), false);
  }
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return { status: 'refused', error: { code: 'FORBIDDEN', message: 'No permission for this topic' } }; };
  const before = f.get('app-status').textContent;
  await walk(chip('stranger')).find(node => node.textContent?.startsWith('Add to topic')).onclick();
  assert.equal(walk(chip('stranger')).find(node => node.className === 'reach-notice').textContent, ' · No permission for this topic');
  assert.equal(f.get('app-status').textContent, before, 'nothing is said behind the reader');
});

test('a change to who is in the topic or the team repaints the open reader\'s recipients, and a closed reader is left alone', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  const painted = () => f.events.filter(e => e[0] === 'reader-recipients').length;
  f.reader.paintRecipients = () => f.events.push(['reader-recipients']);
  Object.assign(f.views, { topic: { ...f.pickers.topic }, participants: f.pickers.participants, messages: new Map() });
  f.paintViews('topic');
  assert.equal(painted(), 0, 'no reader is open');
  f.reader.sessions = { reply: { draft: { addressees: [] } } };
  f.paintViews('topic');
  assert.equal(painted(), 1, 'a participant change reaches the open reader');
  f.pickers.members.push({ actor_id: 'newcomer', kind: 'human', name: 'Newcomer', enabled: true });
  focusIn(f, 'addressable-names');
  await drain();
  assert.equal(painted(), 2, 'a team read on focus reaches it too');
});

test('a reader who cannot change the participants is told who could, and a team that cannot be read marks nobody', async () => {
  const f = fixture();
  pickerApi(f, { topic: { owner_id: 'tony', creator_id: 'tony' } });
  await f.initialize();
  showComposer(f);
  nameIn(f, 'inline-recipient-input', 'stranger');
  const chip = f.get('inline-recipient-chips').children.find(node => node.dataset.name === 'stranger');
  assert.equal(chip.className, 'chip unreachable');
  assert.equal(walk(chip).some(node => node.textContent?.startsWith('Add to topic')), false);
  nameIn(f, 'inline-recipient-input', 'tony');
  assert.equal(f.get('inline-recipient-chips').children.find(node => node.dataset.name === 'tony').className, 'chip',
    'the topic\'s owner can always be sent to, participant or not');

  const hidden = fixture();
  pickerApi(hidden);
  const view = hidden.api.view;
  hidden.api.view = async (name, args) => name === 'workspace_members' ? { error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } } : view(name, args);
  await hidden.initialize();
  showComposer(hidden);
  nameIn(hidden, 'inline-recipient-input', 'stranger');
  assert.equal(hidden.get('inline-recipient-chips').children.find(node => node.dataset.name === 'stranger').className, 'chip');
});

test('a card in the topic log says when its message was sent, and a message from before times were kept says nothing', async () => {
  const f = fixture();
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  const sent = new Date(2026, 10, 5, 5, 44).getTime();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'tony', body: 'Timed', topic_id: 't1', sent_ms: sent });
  f.views.messages.set('m2', { id: 'm2', seq: 2, author_id: 'fable', body: 'Untimed', topic_id: 't1', sent_ms: null });
  f.views.messages.set('m3', { id: 'm3', seq: 3, author_id: 'fable', body: 'Last night', topic_id: 't1', sent_ms: new Date(2026, 10, 4, 21, 12).getTime() });
  f.views.messages.set('m4', { id: 'm4', seq: 4, author_id: 'fable', body: 'Earlier', topic_id: 't1', sent_ms: new Date(2026, 10, 3, 7, 41).getTime() });
  f.paintViews('messages');
  // The author line follows the card's ⋯ (docs/links.md).
  const author = id => entryIn(f, id).children.find(node => node.className === 'message-author');
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  // The star in the header (item 376) comes after who and when, and is no part of the time.
  const parts = id => author(id).children.filter(node => node.className !== 'card-star').map(text);
  assert.deepEqual(parts('m1'), ['tony', ' · 5:44 AM'], 'sent today: the time alone');
  assert.deepEqual(author('m1').children.map(node => node.className).slice(-1), ['card-star'], 'the star follows who and when');
  assert.deepEqual(parts('m2'), ['fable']);
  assert.deepEqual(parts('m3'), ['fable', ' · Yesterday 9:12 PM']);
  assert.deepEqual(parts('m4'), ['fable', ' · 7:41 AM Tue Nov 3'], 'earlier: dated as before');
  assert.equal(author('m1').children[1].children[1].title, '5:44 AM Thu Nov 5', 'a time\'s title keeps its date');
});

test('the page watches the viewer\'s day once, and at a new day repaints every shown time with the list held in place', async () => {
  const f = fixture();
  assert.equal(f.days.length, 1, 'one watch for the page');
  const [{ doc, win, repaint }] = f.days;
  assert.equal(doc, f.document);
  assert.equal(typeof win.addEventListener, 'function');
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'tony', body: 'Timed', topic_id: 't1', sent_ms: new Date(2026, 10, 5, 5, 44).getTime() });
  f.paintViews('messages');
  const time = entryIn(f, 'm1').children.find(node => node.className === 'message-author').children[1].children[1];
  assert.equal(time.textContent, '5:44 AM');
  const query = f.document.querySelectorAll;
  f.document.querySelectorAll = selector => selector === 'time[data-ms]' ? [time] : query(selector);
  try {
    times.clock.now = () => new Date(2026, 10, 6, 0, 0).getTime();
    repaint();
    assert.equal(time.textContent, 'Yesterday 5:44 AM', 'a card painted yesterday says so');
  } finally { times.clock.now = () => TODAY; f.document.querySelectorAll = query; }
});

test('a reply card says quietly which message it answers, and a message answering none says nothing', async () => {
  const f = fixture();
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'fable', body: 'Ship the table', topic_id: 't1', sent_ms: null, reply_to: null });
  f.views.messages.set('m2', { id: 'm2', seq: 2, author_id: 'tony', body: 'Yes', topic_id: 't1', sent_ms: null,
    reply_to: 'm1', reply_to_author: 'fable', reply_to_excerpt: 'Ship the table' });
  f.paintViews('messages');
  const card = id => entryIn(f, id);
  // This DOM stores appended strings and nested elements separately. Read
  // through the parent-word span and links as a browser's textContent does.
  const words = node => typeof node === 'string' ? node : (node.textContent ?? '') + (node.children ?? []).map(words).join('');
  const lines = id => card(id).children.filter(node => node.className === 'message-reply-to').map(words);
  assert.deepEqual(lines('m2'), ['Replying to fable: Ship the table']);
  assert.deepEqual(lines('m1'), []);
  // The ⋯ is on the one bar over a lit card (message-menu.mjs), not on the card; the words are formatted (message-format.mjs).
  assert.deepEqual(card('m2').children.map(node => node.className), ['message-author', 'message-reply-to', 'message-preview formatted'], 'the line sits between the author and the words, and the card carries no ⋯ of its own');
});

test('a reply to someone else\'s message in this topic is offered to its author, once; one to anything else is not', () => {
  const f = fixture();
  const offers = [];
  const reply = (topicId = 't1') => ({ context: { topicId }, offerAddressees(names) { this.offered = names; offers.push(names.join(',')); } });
  const message = (author, topicId = 't1') => ({ source_ref: { kind: 'message', id: 'm1' }, topic_id: topicId, author });
  const offered = (source, editor = reply(), extra = {}) => { offers.length = 0; f.offerAuthor({ source, editors: { reply: editor }, ...extra }); return [...offers]; };
  assert.deepEqual(offered(message('fable')), ['fable']);
  assert.deepEqual(offered(message('fixture-person')), [], 'never to the person themselves');
  assert.deepEqual(offered(message('fable', 't2')), [], 'not for a message from another topic');
  assert.deepEqual(offered({ source_ref: { kind: 'memory', id: 'n1', revision: 1 }, topic_id: 't1', author: 'fable' }), [], 'not for a Notebook page');
  assert.deepEqual(offered(message('fable'), reply(), { sourceUnavailable: true }), [], 'not for a source that could not be read');
  const kept = reply(); kept.offered = [];
  assert.deepEqual(offered(message('fable'), kept), [], 'an offer the person declined is not made again');
});

test('a reply is offered only to an author a message would reach', () => {
  const f = fixture();
  const offers = [];
  const reply = () => ({ context: { topicId: 't1' }, offerAddressees(names) { this.offered = names; offers.push(names.join(',')); } });
  const offered = author => { offers.length = 0; f.offerAuthor({ source: { source_ref: { kind: 'message', id: 'm1' }, topic_id: 't1', author }, editors: { reply: reply() } }); return [...offers]; };
  f.views.participants = [{ actor_id: 'fixture-person', enabled: true }, { actor_id: 'fable', enabled: true }, { actor_id: 'idle', enabled: false }];
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.inline, topic: f.topic, views: f.views, freshness: f.fresh,
    outcomeMembers: [{ actor_id: 'fixture-person' }, { actor_id: 'teammate' }] });
  assert.deepEqual(offered('fable'), ['fable'], 'a participant');
  assert.deepEqual(offered('teammate'), ['teammate'], 'a member of the outcome\'s team, who can see the topic');
  assert.deepEqual(offered('idle'), [], 'a switched-off author would make the reply refused');
  assert.deepEqual(offered('gone'), [], 'nor one who left the topic and is not on the team');
});

// Every element under a node; text children are skipped.
const deep = node => node.children.flatMap(child => typeof child === 'object' ? [child, ...deep(child)] : []);

// Where a topic stands, wired into the page: a tapped chip saves at once at
// the topic's current version, a commit asks for fresh views, and a fresh
// topic view repaints the panel.
test('a topic page says where it stands, saves a tapped state or person fenced on where it stands, and repaints from fresh data', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  const panel = f.get('topic-state');
  const all = () => deep(panel), find = predicate => all().find(predicate);
  const classes = node => String(node.className ?? '').split(' ');
  // The four state chips, by the one that is lit.
  const lit = () => all().filter(node => node.dataset?.state && node['aria-pressed'] === 'true').map(node => node.textContent);
  const chip = words => find(node => classes(node).includes('choice-chip') && node.textContent === words);
  const notice = () => find(node => classes(node).includes('notice'));
  assert.equal(panel.hidden, false);
  assert.deepEqual(lit(), ['Active'], 'the state that holds is the lit chip');
  assert.equal(find(node => node.textContent === 'Save'), undefined, 'there is no Save to press');
  const requests = () => f.events.filter(([kind]) => kind === 'request').length, before = requests();
  await chip('Ready for review').onclick();
  // Envelopes come from the page's realm; compare them as data.
  const sent = () => JSON.parse(JSON.stringify(f.calls.filter(call => call.kind === 'topic.update').map(call => [call.envelope.target, call.envelope.expected.topic_fields, call.envelope.args])));
  const stands = (state, waiting_on = []) => ({ state, waiting_on });
  assert.deepEqual(sent(), [[{ topic_id: 't1' }, stands('active'), { state: 'review', keep_note: true }]], 'one tap, one change, fenced on where it stands');
  assert.deepEqual([f.pickers.topic.state, f.pickers.topic.version], ['review', 4], 'Core took the change');
  assert.deepEqual([notice()?.hidden, notice()?.textContent, classes(notice()).includes('quiet')], [false, 'Saved', true], 'a quiet Saved, not a refusal');
  assert.deepEqual(lit(), ['Ready for review'], 'Core\'s answer is painted before any fresh read');
  assert.equal(requests(), before + 1, 'a committed change asks for fresh views');
  // The next change is fenced on what the first one made; Waiting then
  // offers the topic's people, the reader first as you.
  await chip('Waiting').onclick();
  assert.deepEqual(sent()[1], [{ topic_id: 't1' }, stands('review'), { state: 'waiting', keep_note: true }]);
  const people = find(node => classes(node).includes('people-chips'));
  assert.deepEqual([people.parent.hidden, people.children.map(node => node.textContent)], [false, ['you', 'fable']]);
  await chip('fable').onclick();
  assert.deepEqual(sent()[2], [{ topic_id: 't1' }, stands('waiting'), { state: 'waiting', waiting_on: ['fable'], keep_note: true }]);
  assert.deepEqual([f.pickers.topic.version, chip('fable')['aria-pressed'], chip('you')['aria-pressed']], [6, 'true', 'false']);
  Object.assign(f.views, { topic: { ...f.views.topic, version: 7, state: 'done', state_note: 'Shipped', waiting_on: [] }, messages: new Map() });
  f.paintViews('topic');
  assert.deepEqual(lit(), ['Done'], 'a fresh topic view repaints the panel');
  assert.equal(find(node => node.id === 'topic-state-note')?.value, 'Shipped');
  assert.equal(people.parent.hidden, true, 'a done topic offers nobody to wait on');
});

// A tap whose answer was lost goes again when the browser is back online, as
// the same command: the same operation id, so Core runs it at most once.
// Closing acts require real durable storage; item1000's native Core/IDB checks
// own their recovery. This adapter checks the unchanged non-closing state path.
for (const [how, back] of [['online', f => { for (const [, name, handler] of f.events.filter(([kind]) => kind === 'window-handler')) if (name === 'online') handler(); }],
  ['on the live feed', f => f.live.emit({ kind: 'state', state: 'live' })]]) {
  test(`a topic page sends a lost non-closing state tap again when it is back ${how}, as the same operation`, async () => {
    const f = fixture();
    f.live = stream(); f.useLive(f.live);
    pickerApi(f);
    await f.initialize();
    const panel = f.get('topic-state');
    const chip = words => deep(panel).find(node => String(node.className ?? '').split(' ').includes('choice-chip') && node.textContent === words);
    const core = f.api.command, envelopes = [];
    let offline = true;
    f.api.command = async envelope => { envelopes.push(JSON.parse(JSON.stringify(envelope))); if (offline && envelope.kind === 'topic.update') throw Error('Connection interrupted.'); return core(envelope); };
    await chip('Ready for review').onclick();
    assert.deepEqual([envelopes.length, f.pickers.topic.state ?? 'active'], [1, 'active'], 'lost: Core never saw it');
    offline = false;
    back(f);
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(envelopes.length, 2, 'sent again once');
    assert.deepEqual(envelopes[1], envelopes[0], 'the same envelope, operation id and all');
    assert.equal(f.pickers.topic.state, 'review');
  });
}

// Item 86: every outcome's questions are listed on the Outcomes home only; an
// outcome's own page says its questions once, in "Where it stands".
const waitingPage = async (href, waiting) => {
  const f = fixture(href);
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  pickerApi(f);
  const view = f.api.view;
  f.api.view = async (name, args, options) => name === 'attention'
    ? { instance_id: 'fixture', unread: 0, addressed: 0, latest_addressed: [], waiting_on_me: waiting().length, latest_waiting: waiting() }
    : view(name, args, options);
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  f.useLive(live);
  await f.initialize();
  return { f, live };
};

test('an outcome page does not list what waits on the reader, even as attention answers come', async () => {
  const waiting = [{ id: 't7', title: 'First', title_truncated: false, note: '', state_by: 'fable', state_ms: null, workspace: { id: 'w2', title: 'Pitch deck', title_truncated: false } }];
  const { f, live } = await waitingPage('https://fixture/?workspace=w1', () => waiting);
  const settle = async () => { for (let n = 0; n < 4; n++) await new Promise(setImmediate); };
  await settle();
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await settle();
  assert.equal(waiting.length, 1, 'something waits on the reader');
  assert.deepEqual(f.get('waiting-on-you').children, [], 'the Waiting on you box is not painted on an outcome page');
});

test('the Outcomes home lists what waits on the reader, and follows each new attention answer', async () => {
  const f = fixture('https://fixture/');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  pickerApi(f);
  let waiting = [{ id: 't7', title: 'First', title_truncated: false, note: '', state_by: 'fable', state_ms: null }];
  const view = f.api.view;
  f.api.view = async (name, args, options) => name === 'attention'
    ? { instance_id: 'fixture', unread: 0, addressed: 0, latest_addressed: [], waiting_on_me: waiting.length, latest_waiting: waiting }
    : view(name, args, options);
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  f.useLive(live);
  await f.initialize();
  const settle = async () => { for (let n = 0; n < 4; n++) await new Promise(setImmediate); };
  await settle();
  const titles = () => deep(f.get('waiting-on-you')).filter(node => node.href?.startsWith('?topic=')).map(node => node.textContent);
  waiting = [{ id: 't8', title: 'Second', title_truncated: false, note: 'Pick one', state_by: 'fable', state_ms: null }, ...waiting];
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await settle();
  assert.deepEqual(titles(), ['Second', 'First'], 'a commit brings the new list');
  assert.equal(f.get('waiting-on-you').hidden, false);
  waiting = [];
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 10 });
  await settle();
  assert.equal(f.get('waiting-on-you').hidden, true, 'nothing waits, so nothing is listed');
});

// Lists that follow commits: the stream announces a commit, and each list the
// page shows is read again after it.
const stream = () => ({ listeners: [], listen(fn) { this.listeners.push(fn); return () => {}; }, emit(event) { for (const fn of [...this.listeners]) fn(event); } });
const outcomesPage = (f, held) => {
  const answers = [];
  f.api.view = async (name, args) => {
    f.calls.push({ name, args });
    if (name === 'workspaces') { const next = answers.shift(); return typeof next === 'function' ? next() : next; }
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Outcome', owner_id: 'fixture-person', version: 1 } };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  };
  const row = id => ({ id, owner_id: 'o', title: id, title_truncated: false, version: 1 });
  return { answers, page: ids => ({ instance_id: 'fixture', items: ids.map(row), next_cursor: null }), reads: () => f.calls.filter(call => call.name === 'workspaces').length };
};

test('a commit while the outcomes page reads its first list is read after that read', async () => {
  const f = fixture('https://fixture/?'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  let release; o.answers.push(() => new Promise(resolve => release = resolve), o.page(['a', 'b']));
  const started = f.initialize(); await drain();
  assert.equal(o.reads(), 1);
  live.emit({ kind: 'commit', seq: 6 });
  release(o.page(['a'])); await started; await drain();
  assert.equal(o.reads(), 2, 'the commit asked for a read after the first');
  assert.deepEqual([...f.owners().outcomeRail.pages.items.map(item => item.id)], ['a', 'b']);
});

test('a commit while a reload reads the outcomes is read after it, and a failed reload is read again when the stream returns', async () => {
  const f = fixture('https://fixture/?'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['a'])); await f.initialize(); await drain();
  let release; o.answers.push(() => new Promise(resolve => release = resolve), o.page(['a', 'b']));
  live.emit({ kind: 'commit', seq: 6 }); await drain();
  live.emit({ kind: 'commit', seq: 7 });
  release(o.page(['a'])); await drain();
  assert.equal(o.reads(), 3);
  assert.deepEqual([...f.owners().outcomeRail.pages.items.map(item => item.id)], ['a', 'b']);
  o.answers.push(() => Promise.reject(Object.assign(Error('This read could not enter its bounded lane.'), { status: 503 })));
  live.emit({ kind: 'commit', seq: 8 }); await drain();
  assert.equal(f.get('retry-workspaces').hidden, false);
  live.emit({ kind: 'state', state: 'down' }); await drain();
  assert.equal(o.reads(), 4, 'the stream going down reads nothing');
  o.answers.push(o.page(['a', 'b', 'c']));
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(o.reads(), 5, 'the stream coming back reads the list again');
  assert.deepEqual([...f.owners().outcomeRail.pages.items.map(item => item.id)], ['a', 'b', 'c']);
  assert.equal(f.get('retry-workspaces').hidden, true);
});

// The shell's single outcome-list answer also serves the body's Also waiting.
// The main column does not show the old outcomes list.
test('on an outcome page a commit refreshes the shared outline and republishes its cards beside the other outcome reads', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), outline = mountOutcomeOutline(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  const view = f.api.view;
  let title = 'Before the commit';
  f.api.view = async (name, args, options) => {
    if (name === 'workspace') { f.calls.push({ name, args }); return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Outcome', owner_id: 'fixture-person', version: 1 } }; }
    if (name === 'workspaces') { f.calls.push({ name, args }); return { instance_id: 'fixture', items: [{ id: 'w1', title: 'Outcome', title_truncated: false, owner_id: 'fixture-person', version: 1 }], next_cursor: null }; }
    if (name === 'workspace_topics') { f.calls.push({ name, args }); return { instance_id: 'fixture', items: [{ ...f.topic, title, list_position: 1, activity_ms: 1 }], next_cursor: null }; }
    return view(name, args, options);
  };
  await f.initialize(); await drain();
  const count = name => f.calls.filter(call => call.name === name).length;
  const before = { workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') };
  assert.equal(before.topics, 1, 'only the outline owns the outcome topic read');
  assert.deepEqual(outcomeCardTitles(f), ['Before the commit']);
  title = 'After the commit';
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.deepEqual({ workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') },
    { workspaces: before.workspaces + 1, workspace: before.workspace + 1, topics: before.topics + 1 });
  assert.equal(outline.outcomes.get('w1').rail.pages.items[0].title, title);
  assert.deepEqual(outcomeCardTitles(f), ['After the commit'], 'the outline republishes its new state to the cards');
  assert.equal(f.get('rail').hidden, false, 'the outcome page keeps the shared rail');
  assert.equal(f.get('outcome-navigation').hidden, true, 'and shows no list of outcomes');
  f.document.visibilityState = 'hidden';
  live.emit({ kind: 'commit', seq: 10 }); await drain();
  assert.deepEqual([count('workspaces'), count('workspace_topics')], [before.workspaces + 1, before.topics + 1], 'a hidden page waits');
});

// The outcome page with the light and the Also-waiting line together. The
// light counts every wait on the reader; the line names only outcomes the
// reader can list. waits: outcome ids with a wait on the reader; listed: the
// outcome rows the reader can list, each { id, asks }.
const lightAndLine = async (waits, listed) => {
  const f = fixture('https://fixture/?workspace=w5'), live = stream();
  mountOutcomeOutline(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  const state = { waits, listed, failing: null };
  const lit = asks => asks ? { light: 'waiting', label: 'Waiting on you', short: { kind: 'asks', count: asks }, unreadable: false }
    : { light: 'quiet', label: 'Quiet', short: { kind: 'since', ms: 1 }, unreadable: false };
  f.api.view = async (name, args) => {
    f.calls.push({ name, args });
    if (name === 'attention') return { instance_id: 'fixture', unread: 0, addressed: 0, latest_addressed: [], waiting_on_me: 0, latest_waiting: [],
      waiting_outcomes: { count: state.waits.length, here: state.waits.includes(args?.workspace_id) } };
    if (name === 'workspaces') {
      if (state.failing) throw state.failing;
      return { instance_id: 'fixture', next_cursor: null, items: state.listed.map(({ id, asks }) => ({ id, owner_id: 'o', title: 'Outcome ' + id, title_truncated: false, version: 1, light: lit(asks) })) };
    }
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { id: 'w5', title: 'Five', owner_id: 'fixture-person', version: 1 } };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  };
  await f.initialize(); await drain(); await drain();
  const words = f.get('elsewhere-words'), also = f.get('also-waiting');
  // Seen: on the page, with nothing between it and the outcome page hidden.
  const seen = node => { for (let at = node; at; at = at.parent) { if (at.hidden) return false; if (at === f.get('outcome-page')) return true; } return false; };
  const textOf = node => typeof node === 'string' ? node : (node.textContent || '') + (node.children ?? []).map(textOf).join('');
  return { f, live, state, words, also, seen, textOf };
};

test('on an outcome page a wait in an outcome the reader is not on the team of is said in words beside "← Outcomes"', async () => {
  // agent-b reads w5; the wait is in w6, whose team they are not on, so their outcomes are w1 and w5.
  const { words, also, f } = await lightAndLine(['w6'], [{ id: 'w1' }, { id: 'w5' }]);
  assert.equal(f.get('outcome-light').hidden, false, 'the light is lit');
  assert.equal(also.hidden, true, 'the Also-waiting line cannot name w6');
  assert.equal(words.hidden, false, 'so the light says it in words');
  assert.equal(words.textContent, '1 other outcome is waiting on you');
});

test('on an outcome page the light keeps its words unseen only while the Also-waiting line names every outcome it counts', async () => {
  const { words, also, live, state, textOf } = await lightAndLine(['w2'], [{ id: 'w2', asks: 1 }, { id: 'w5' }]);
  assert.equal(also.hidden, false); assert.equal(textOf(also), 'Also waiting on you: 1 in Outcome w2 ›');
  assert.equal(words.hidden, true, 'the line names it: the light without its words');
  // A second wait, in an outcome the reader cannot list.
  state.waits = ['w2', 'w9'];
  live.emit({ kind: 'commit', seq: 5 }); await drain(); await drain();
  assert.equal(words.hidden, false, 'the line names one of two: the words say both');
  assert.equal(words.textContent, '2 other outcomes are waiting on you');
});

test('on an outcome page a failed read of the outcome list says so with Retry where the person sees it, and its stale line goes', async () => {
  const { f, words, also, live, state, seen, textOf } = await lightAndLine(['w2'], [{ id: 'w2', asks: 1 }, { id: 'w5' }]);
  assert.equal(also.hidden, false); assert.equal(words.hidden, true);
  const notice = f.get('outcomes-status'), retry = f.get('retry-workspaces');
  assert.equal(seen(notice) && !notice.hidden, false, 'no notice while the list reads');
  // The next read fails, and the wait in w2 has been answered meanwhile.
  state.failing = Object.assign(Error('This read could not enter its bounded lane.'), { status: 503 });
  live.emit({ kind: 'commit', seq: 6 }); await drain(); await drain();
  assert.equal(also.hidden, true, 'the line from the last rows is not shown as if fresh');
  assert.equal(seen(notice), true, 'the failure is said on the outcome page, not in the hidden rail');
  assert.match(notice.textContent, /could not enter its bounded lane/);
  assert.equal(seen(retry), true, 'with Retry beside it');
  assert.equal(words.hidden, false, 'and the light, read apart from the list, says what waits in words');
  // Retry reads the list again.
  state.failing = null;
  await retry.onclick(); await drain();
  assert.equal(notice.hidden, true); assert.equal(retry.hidden, true);
  assert.equal(also.hidden, false); assert.equal(textOf(also), 'Also waiting on you: 1 in Outcome w2 ›');
  assert.equal(words.hidden, true);
});

test('the page starts its attention from the bootstrap\'s number', async () => {
  const f = fixture('https://fixture/?'), o = outcomesPage(f);
  o.answers.push(o.page([]));
  f.bootstrap.attention = { after: 41 };
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  await f.initialize();
  assert.equal(f.owners().attention.after, 41);
});

test('835 removes Sent to you by name without marking any delivery read', async () => {
  const f = fixture('https://fixture/?'), o = outcomesPage(f), view = f.api.view;
  o.answers.push(o.page([]));
  const lost = { id: 'd1', seq: 3, topic_readable: false, topic: { id: 't9', title: 'Lost', title_truncated: false }, message: { author_id: 'tony', body: 'Hi' } };
  f.api.view = async (name, args) => name === 'attention' ? (f.calls.push({ name }), { instance_id: 'fixture', unread: 1, addressed: 1, latest_addressed: [lost] }) : view(name, args);
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  await f.initialize(); await drain();
  const nodes = host => host.children.filter(child => typeof child === 'object').flatMap(child => [child, ...nodes(child)]);
  assert.equal(nodes(f.get('sent-to-you')).length,0,'835 removes the play-by-play wall even when there are addressed messages');
  assert.equal(f.calls.filter(call=>call.kind==='delivery.ack').length,0,'hiding the wall acknowledges nothing');
});

// A topic page whose server keeps the read lanes apart, with the real recovery
// cleanup and the real freshness pass on a clock the test runs.
function partitionedTopic() {
  const jobs = new Map(); let serial = 0;
  const clock = { jobs, setTimeout(fn, ms) { jobs.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { jobs.delete(id); } };
  const binding = { instance_id: 'fixture', actor_id: 'fixture-person', authority_id: 'a', authority_epoch: 'e' };
  const scope = { kind: 'topic', id: 't1' };
  const cursor = seq => ({ v: 1, kind: 'checkpoint', ...binding, scope, after_seq: seq });
  const f = fixture('https://fixture/?topic=t1', {
    initialViews: async () => cursor(1),
    Freshness: class extends Freshness { constructor(options) { super({ ...options, timers: clock, yieldRead: async () => {} }); } } });
  f.bootstrap.authority = { authority_id: 'a', authority_epoch: 'e' }; f.registry.runtime.current = f.bootstrap.authority;
  f.bootstrap.transport = { read_admission: { version: 1, header: 'X-AIM-Read-Class',
    foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } };
  const cleanup = new RecoveryCleanup({ api: f.api, bootstrap: f.bootstrap, journal: {}, runtime: { readTimeoutMs: 5000 }, changed() {} });
  f.registry.cleanup = cleanup;
  const live = stream(); live.connected = true; f.useLive(live);
  // rails: a promise the rails' reads wait on; changes: one the next changes read waits on.
  const held = { rails: null, changes: null }, signals = []; let seq = 1;
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name === 'changes') {
      f.calls.push({ name }); signals.push(options?.signal);
      const wait = held.changes; held.changes = null; if (wait) await wait;
      return { instance_id: 'fixture', scope, baseline: false, items: [], has_more: false, continuation: null,
        checkpoint: cursor(++seq), covered_versions: { topic: 1, notebook: 1 } };
    }
    if (['workspaces', 'workspace_topics'].includes(name) && held.rails) { f.calls.push({ name }); await held.rails; return { instance_id: 'fixture', items: [], next_cursor: null }; }
    return view(name, args, options);
  };
  return { f, live, jobs, held, signals, changes: () => f.calls.filter(call => call.name === 'changes').length };
}

test('a commit on a topic page reads its changes at once, beside the rails it reloads, with no timer', async () => {
  const { f, live, jobs, held, changes } = partitionedTopic();
  await f.initialize(); await drain();
  const before = changes();
  assert.ok(before >= 1, 'the page read its changes when it started');
  const rails = defer(); held.rails = rails.promise;
  live.emit({ kind: 'commit', seq: 7 }); await drain();
  assert.equal(changes(), before + 1, 'the commit\'s changes are read while the rails still read');
  assert.equal(jobs.size, 0, 'no timer waits to read them');
  held.rails = null; rails.resolve(); await drain();
  f.owners().freshness.dispose();
});

test('a commit\'s rail reload leaves a freshness pass already reading alone', async () => {
  const { f, live, held, signals } = partitionedTopic();
  await f.initialize(); await drain();
  const reading = defer(); held.changes = reading.promise;
  live.emit({ kind: 'commit', seq: 7 }); await drain();
  const signal = signals.at(-1);
  live.emit({ kind: 'commit', seq: 8 }); await drain();
  assert.equal(signal?.aborted, false, 'the next commit\'s rail reload does not stop the pass reading');
  reading.resolve(); await drain();
  f.owners().freshness.dispose();
});

// The stream's return rereads a page's lists only when a reload could not read
// them: anything saved while it was down changes its first number, which comes
// as a commit. A topic's page lists no outcome Notebook (item 464); its own
// Notebook is read with the topic's changes.
// Outcome topic failures belong to the shell outline, exercised below; the
// outcome body's reconnect still owes its own failed workspace read.
for (const [route, lists] of [['?', ['workspaces']], ['?workspace=w1', ['workspace']], ['?topic=t1', ['workspace_topics']]]) {
  test(`the stream coming back rereads the lists on ${route} only after a reload that failed`, async () => {
    const f = fixture('https://fixture/' + route), live = stream(), failing = new Set();
    if (route !== '?topic=t1') f.inject({ api: f.api, bootstrap: f.bootstrap });
    f.useLive(live);
    const view = f.api.view;
    f.api.view = async (name, args, options) => {
      if (name === 'workspace' && route === '?workspace=w1') { f.calls.push({ name }); if (failing.has(name)) throw Object.assign(Error('busy'), { status: 503 }); return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Outcome', owner_id: 'fixture-person', version: 1 } }; }
      if (failing.has(name)) { f.calls.push({ name }); throw Object.assign(Error('This read could not enter its bounded lane.'), { status: 503 }); }
      return view(name, args, options);
    };
    await f.initialize(); await drain();
    const count = () => f.calls.filter(call => lists.includes(call.name)).length;
    const reconnect = async () => { live.emit({ kind: 'state', state: 'down' }); live.emit({ kind: 'state', state: 'live' }); await drain(); };
    let before = count();
    await reconnect();
    assert.equal(count(), before, 'nothing was owed, so the return reads nothing');
    for (const name of lists) {
      failing.add(name); live.emit({ kind: 'commit', seq: 20 }); await drain(); failing.delete(name);
      before = count(); await reconnect();
      assert.ok(count() > before, `a failed ${name} read is read again when the stream returns`);
      before = count(); await reconnect();
      assert.equal(count(), before, `once ${name} is read, the next return reads nothing`);
    }
  });
}

test('847 the outline republishes failed topic reads, reconnect recovery and Retry to the outcome cards', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), outline = mountOutcomeOutline(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  const view = f.api.view, opened = [];
  let failure = null, title = 'Before disconnection';
  outline.open = (target, label) => opened.push({ target, label });
  f.api.view = async (name, args, options) => {
    if (name === 'workspace') { f.calls.push({ name, args }); return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Outcome', owner_id: 'fixture-person', version: 1 } }; }
    if (name === 'workspace_topics') {
      f.calls.push({ name, args }); if (failure) throw failure;
      return { instance_id: 'fixture', items: [{ ...f.topic, title, unread: 2,
        asks: [{ actor_id: 'fixture-person', message_id: 'q1' }], list_position: 1, activity_ms: 1 }], next_cursor: null };
    }
    return view(name, args, options);
  };
  await f.initialize(); await drain();
  const cardsHost = () => f.get('topic-navigation').children.find(node => node.className === 'outcome-topic-cards');
  const notice = () => cardsHost().children.find(node => node.className === 'notice');
  const retry = () => cardsHost().children.find(node => node.textContent === 'Retry topics');
  const reads = () => f.calls.filter(call => call.name === 'workspace_topics').length;
  assert.deepEqual(outcomeCardTitles(f), ['Before disconnection']);
  failure = Object.assign(Error('This read could not enter its bounded lane.'), { status: 503 });
  await commit(live, 20);
  assert.deepEqual(outcomeCardTitles(f), ['Before disconnection'], 'a transient failure keeps the readable card');
  assert.equal(notice().hidden, false); assert.match(notice().textContent, /bounded lane/);
  assert.equal(retry().hidden, false, 'the cards expose the outline retry');
  failure = null; title = 'Recovered on reconnect'; const before = reads();
  live.emit({ kind: 'state', state: 'down' }); live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(reads(), before + 1, 'the outline rereads on reconnect');
  assert.deepEqual(outcomeCardTitles(f), ['Recovered on reconnect'], 'reconnect republishes the recovered cards');
  assert.equal(notice().hidden, true); assert.equal(retry().hidden, true);
  failure = Object.assign(Error('Busy again'), { status: 503 }); await commit(live, 21);
  assert.equal(retry().hidden, false);
  failure = null; title = 'Recovered by Retry'; await retry().onclick(); await drain();
  assert.deepEqual(outcomeCardTitles(f), ['Recovered by Retry']);
  assert.equal(notice().hidden, true); assert.equal(retry().hidden, true);
  const card = outcomeCards(f)[0], unread = walk(card).find(node => node.classList?.contains('unread-count'));
  assert.ok(unread, 'the actual card carries its unread count');
  assert.equal(unread.dataset.lands, 'unread');
  card.onclick({ button: 0, target: card, preventDefault() {} });
  card.onclick({ button: 0, target: unread, preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(opened.map(row => row.target))),
    [{ kind: 'topic', id: 't1', message: 'q1' }, { kind: 'topic', id: 't1', at: 'unread' }], 'question and unread navigation use the outline activation');
});

test('a New line read that failed after a commit is read again when the stream returns, and only then', async () => {
  const f = fixture('https://fixture/?topic=t1'), live = stream();
  f.useLive(live);
  let failing = false, reads = 0;
  // The page's own read, as TopicViews.readUnread makes it: a failure rejects.
  f.views.readUnread = async read => { await read('topic_unread', { topic_id: 't1' }); return true; };
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name !== 'topic_unread') return view(name, args, options);
    reads++;
    if (failing) throw Object.assign(Error('This read could not enter its bounded lane.'), { status: 503 });
    return { instance_id: 'fixture', topic_id: 't1', oldest_unread: null, commit_seq: 1 };
  };
  await f.initialize(); await drain();
  const reconnect = async () => { live.emit({ kind: 'state', state: 'down' }); live.emit({ kind: 'state', state: 'live' }); await drain(); };
  live.emit({ kind: 'commit', seq: 20 }); await drain();
  let before = reads;
  assert.ok(before > 0, 'a commit reads where the line is');
  await reconnect();
  assert.equal(reads, before, 'nothing was owed, so the return reads nothing');
  failing = true; live.emit({ kind: 'commit', seq: 21 }); await drain(); failing = false;
  before = reads; await reconnect();
  assert.equal(reads, before + 1, 'the failed read is owed, and the return reads it again');
  before = reads; await reconnect();
  assert.equal(reads, before, 'once read, the next return reads nothing');
});

// The new outcome page shows the outcome list beside the writing.
for (const route of ['?new=outcome&intent=i1']) {
  test(`the outcome list beside ${route} is read again after each commit`, async () => {
    const f = fixture('https://fixture/' + route, {
      openIntentJournal: async () => ({ close() {} }),
      OutcomeCreation: class { constructor() { this.row = { phase: 'draft' }; } async load() {} leave() {} },
      CreateOutcomeView: class { run(action) { return Promise.resolve().then(action); } } });
    const live = stream(), o = outcomesPage(f);
    f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
    o.answers.push(o.page(['w1']), o.page(['w1', 'w2']));
    await f.initialize(); await drain();
    assert.equal(f.get('body').dataset.ready, 'true');
    assert.equal(o.reads(), 1);
    live.emit({ kind: 'commit', seq: 9 }); await drain();
    assert.equal(o.reads(), 2, 'a commit reads the outcome list again');
    assert.deepEqual([...f.owners().outcomeRail.pages.items.map(item => item.id)], ['w1', 'w2']);
    f.document.visibilityState = 'hidden';
    live.emit({ kind: 'commit', seq: 10 }); await drain();
    assert.equal(o.reads(), 2, 'a hidden page waits');
  });
}

// Beside a new topic the rail shows only its outcome: its topics, read again
// after each commit with the opening itself. It lists no Notebook (item 464).
test('the rail beside a new topic shows its outcome, and each commit reads it and the opening once, never the list of outcomes or the outcome Notebook', async () => {
  const f = fixture('https://fixture/?workspace=w1&opening=o1&opening_topic=t9'), live = stream();
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  f.api.view = async (name, args) => { f.calls.push({ name, args });
    return name === 'workspace' ? { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome' } } : { instance_id: 'fixture', items: [], next_cursor: null }; };
  await f.initialize(); await drain();
  const count = name => f.calls.filter(call => call.name === name).length, follows = () => f.events.filter(e => e[0] === 'opening-follow').length;
  assert.equal(f.get('body').dataset.ready, 'true');
  assert.deepEqual([count('workspace_topics'), count('memory_items'), follows()], [1, 0, 1], 'the first read');
  assert.equal(f.get('outcome-navigation').hidden, true, 'no list of outcomes in the rail');
  assert.equal(f.get('rail')['aria-label'], 'This outcome');
  await commit(live, 2);
  assert.deepEqual([count('workspace_topics'), count('memory_items'), follows()], [2, 0, 2], 'a commit reads the rail and the opening again');
  assert.equal(count('workspaces'), 0, 'and never the list of outcomes');
});

test('attention is read again when the stream comes back, and not when it goes down', async () => {
  const f = fixture('https://fixture/?'), live = stream(), o = outcomesPage(f), view = f.api.view;
  o.answers.push(o.page([]));
  let unread = 0;
  f.api.view = async (name, args) => name === 'attention'
    ? (f.calls.push({ name }), { instance_id: 'fixture', unread, addressed: 0, latest_addressed: [] }) : view(name, args);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  await f.initialize(); await drain();
  const reads = () => f.calls.filter(call => call.name === 'attention').length, before = reads();
  unread = 2;
  live.emit({ kind: 'state', state: 'down' }); await drain();
  assert.equal(reads(), before, 'the stream going down reads nothing');
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(reads(), before + 1, 'the stream coming back reads attention');
  assert.equal(f.owners().attention.unread, 2);
});

test('clicking an agent\'s name on its card opens its color picker, not the message; a choice recolors its cards', async () => {
  const opened = [];
  const f = fixture(undefined, { openColorPicker: options => { opened.push(options); return {}; } });
  Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await settle();
  const add = (seq, author_id, author_kind) => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id, author_kind, body: 'Body', topic_id: 't1' });
  add(1, 'fable', 'agent'); add(2, 'fixture-person', 'human'); add(3, 'fable', 'agent'); add(4, 'dan', 'human');
  f.paintViews('messages');
  const card = id => entryIn(f, id);
  const name = id => card(id).children.find(node => node.className === 'message-author').children[0];
  const opens = () => f.calls.filter(c => c.name === 'source' || c.name === 'editor_state').length;
  const before = opens();
  await card('m3').onclick({ target: name('m3') }); await settle();
  assert.equal(opened.length, 1, 'the picker opened');
  assert.deepEqual([opened[0].anchor, opened[0].agent, opened[0].own, opened[0].chosen, opened[0].palette], [name('m3'), 'fable', 'green', null, AGENT_PALETTE]);
  assert.equal(opened[0].back, card('m3'), 'closing it gives the focus to the card, which can hold it');
  assert.equal(opens(), before, 'the message was not opened');
  // Choosing goes to Core, and every card of that agent changes.
  card('m1').classList.add('stack-head-card');
  card('m1').classList.add('lit');
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return { status: 'committed', recorded: true, result: { actor_id: 'fable', color: 'rose', color_revision: 1 } }; };
  assert.equal((await opened[0].choose('rose')).status, 'committed');
  const sent = f.calls.find(c => c.kind === 'color.set').envelope;
  assert.deepEqual([sent.target, sent.args, sent.expected.color_revision], [{ actor_id: 'fable' }, { color: 'rose' }, 0]);
  assert.deepEqual(['m1', 'm2', 'm3', 'm4'].map(id => card(id).className),
    ['message-card agent-card stack-head-card lit agent-rose', 'message-card own-message', 'message-card agent-card agent-rose', 'message-card']);
  // Your own name and a person's open no picker.
  for (const id of ['m2', 'm4']) await card(id).onclick({ target: name(id) });
  assert.equal(opened.length, 1, 'only an agent\'s name opens a picker');
});

test('the reader\'s agent colors are read with the page, in the foreground, so the first cards wear them', async () => {
  const f = fixture();
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  const classes = [], view = f.api.view;
  f.api.view = async (name, args, options) => { if (name === 'colors') classes.push(options?.readClass); return view(name, args, options); };
  await f.initialize(); await settle();
  assert.deepEqual(classes, ['foreground'], 'not in the background lane, which turns a busy start away');
});

test('an agent in the participants is a button that opens its color picker, in its color; people are plain names', async () => {
  const opened = [];
  const f = fixture(undefined, { openColorPicker: options => { opened.push(options); return {}; } });
  Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await settle();
  Object.assign(f.views, { topic: f.topic, participants: [{ actor_id: 'dan', kind: 'human' }, { actor_id: 'fable', kind: 'agent' }, { actor_id: 'fixture-person', kind: 'human' }] });
  f.paintViews('topic');
  const chips = f.get('participants').children[0].children;
  const names = chips.map(chip => chip.children[0]);
  assert.deepEqual(names.map(n => n.textContent), ['dan', 'fable', 'fixture-person']);
  const agent = names[1];
  assert.equal(names[0].type, undefined, 'a person is a plain name');
  assert.equal(agent.type, 'button');
  // Each person is one pill in their colour: an agent's as the reader sees it,
  // the reader's own black, another person's the plain one.
  assert.deepEqual(chips.map(chip => chip.className), ['person-pill', 'person-pill agent-green', 'person-pill own-pill'], 'in the agent\'s color');
  assert.equal(agent['aria-haspopup'], 'dialog');
  await agent.onclick(); await settle();
  assert.deepEqual([opened.length, opened[0]?.anchor, opened[0]?.agent], [1, agent, 'fable']);
  f.api.command = async () => ({ status: 'committed', recorded: true, result: { actor_id: 'fable', color: 'olive', color_revision: 1 } });
  await opened[0].choose('olive');
  const now = f.get('participants').children[0].children[1].children[0];
  assert.equal(now.parent.className, 'person-pill agent-olive', 'the pill takes the choice at once');
  // The choice repainted the participants; the picker gives the focus back to
  // the name it opened from, so that name is still the one on the page.
  assert.equal(now, agent, 'the name that opened the picker is the one in the participants after the repaint');
  assert.equal(opened[0].back, agent);
});

test('a message between others is one quiet line that opens and folds its card; one for the person stays a card', async () => {
  const f = fixture();
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  const me = f.bootstrap.actor, say = (id, seq, more) => f.views.messages.set(id, { id, seq, author_id: 'aim-core', author_kind: 'agent', body: 'Body', topic_id: 't1', addressees: [], ...more });
  say('m1', 1, { addressees: ['aim-ux', 'warp'], body: '\n  the wake check fails on\nthe second line' });
  say('m2', 2, { addressees: [me] });
  say('m3', 3);
  say('m4', 4, { addressees: ['aim-ux'], reply_to: 'm5', reply_to_author: me });
  say('m5', 5, { author_id: me, author_kind: 'human', addressees: ['aim-ux'] });
  say('m6', 6, { author_id: 'dan', author_kind: 'human', addressees: ['aim-ux', me] });
  say('m7', 7, { addressees: ['aim-ux'], reply_to: 'm6', reply_to_author: 'dan' });
  f.paintViews('messages');
  const entry = id => entryIn(f, id);
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  assert.deepEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map(id => entry(id).className.split(' ')[0]),
    ['message-fold', 'message-card', 'message-card', 'message-card', 'message-card', 'message-card', 'message-fold'],
    'to the person, to everyone, a reply to the person, their own, and one naming them stay cards');
  const fold = entry('m1'), [line, card] = fold.children;
  assert.deepEqual([fold.dataset.seq, line.type, line.className, text(line)], [1, 'button', 'fold-line', 'aim-core to aim-ux, warp: the wake check fails on']);
  assert.deepEqual([card.className.split(' ')[0], card.dataset.id, card.hidden, line['aria-expanded'], line['aria-controls']], ['message-card', 'm1', true, 'false', card.id]);
  line.onclick();
  assert.deepEqual([card.hidden, line['aria-expanded']], [false, 'true'], 'pressed, it opens the card below it');
  line.onclick();
  assert.deepEqual([card.hidden, line['aria-expanded']], [true, 'false'], 'pressed again, it folds it away');
  assert.equal(f.observers[0].targets.includes(fold), true, 'the fold is what is seen on screen');
  f.paintViews('messages');
  assert.equal(entries(f.get('messages')).filter(child => child.dataset.id === 'm1').length, 1, 'a repaint keeps one fold');
});

// Core settles a message between others only for a person; for an agent it is
// work it is woken for, unread until handled, so a page an agent reads folds nothing.
test('an agent reading the page sees a message between others as a card, since it is still unread for the agent', async () => {
  const f = fixture();
  f.bootstrap.actor_kind = 'agent';
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'aim-core', author_kind: 'agent', body: 'Body', topic_id: 't1', addressees: ['aim-ux'] });
  f.paintViews('messages');
  const entry = entryIn(f, 'm1');
  assert.equal(entry.className.split(' ')[0], 'message-card', 'not folded for an agent');
});

test('a folded message the person marked unread carries the pill on its line, the New line under it, and older-below opens it', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const between = (from, through) => messages(from, through).map(item => ({ ...item, addressees: item.seq === 5 ? ['agent-b'] : [] }));
  const at = (from, through, next) => ({ instance_id: 'fixture', items: between(from, through), next_cursor: next, relevant_versions: { topic: 1 }, oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 });
  views.messagesPage(at(10, 19, 10), { initial: true }); await settle();
  const marker = listed(f).at(-1);
  const pages = [at(1, 9, null)], view = f.api.view;
  f.api.view = async (name, args) => name === 'topic_messages' ? pages.shift() : view(name, args);
  await marker.onclick(); await settle();
  const order = () => listed(f).map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order().split(' ').slice(-7).join(' '), '6 5 new 4 3 2 1', 'the New line sits just below the fold');
  const fold = entryIn(f, 'm5'), [line, card] = fold.children;
  assert.equal(fold.className, 'message-fold');
  assert.deepEqual([card.hidden, line['aria-expanded'], f.document.activeElement], [false, 'true', card], 'older-below opened the fold and focused its card');
  const pills = node => typeof node === 'string' ? 0 : (node.className === 'unread-mark' ? 1 : 0) + node.children.reduce((n, child) => n + pills(child), 0);
  assert.equal(pills(line), 0);
  f.owners().marks.learn('m5', 1, { topicId: 't1', seq: 5 });
  assert.equal(pills(line), 1, 'marked unread: the pill on its line');
  f.owners().marks.learn('m5', 2, { topicId: 't1', seq: 5 });
  assert.equal(pills(line), 0, 'cleared: no pill');
});

test('the New line is drawn under the card of the message it holds, moves with it, and goes', async () => {
  const { f } = await readingPage();
  for (let seq = 20; seq <= 25; seq++) f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  const order = () => listed(f).map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  f.views.line = { seq: 22, id: 'm22' }; f.paintViews('messages');
  assert.equal(order(), '25 24 23 22 new 21 20');
  f.views.messages.set('m26', { id: 'm26', seq: 26, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  f.views.line = { seq: 24, id: 'm24' }; f.paintViews('messages');
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'it moves with the message it holds; a new card goes above it');
  f.views.messages.set('m19', { id: 'm19', seq: 19, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  f.paintViews('messages');
  assert.equal(order(), '26 25 24 new 23 22 21 20 19', 'an older card loaded by More goes below it');
  f.views.line = null; f.paintViews('messages');
  assert.equal(order(), '26 25 24 23 22 21 20 19', 'no message held: no line');
  // The line says when its message was sent, from what the server gave.
  f.views.line = { seq: 22, id: 'm22', sent_ms: new Date(2026, 10, 5, 4, 40).getTime() }; f.paintViews('messages');
  const line = f.get('messages').children.find(child => child.dataset.line === 'new');
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  assert.equal(text(line), 'New above · 4:40 AM');
});

test('the New line for a message further back sits at the bottom, and pressing it loads down to that message', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = (from, through, next) => ({ ...page(from, through, next), oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 });
  views.messagesPage(at(20, 29, 20), { initial: true }); await settle();
  const order = () => listed(f).map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order(), '29 28 27 26 25 24 23 22 21 20 older', 'the line waits at the bottom of what is loaded');
  const marker = listed(f).at(-1);
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  assert.equal(text(marker), 'More new below', 'a line without a time says none');
  //1045 removes the redundant control; the New line retains its own destination.
  assert.equal(f.get('more-messages').onclick, undefined, 'the retired control has no handler');
  f.paintViews('memory');
  assert.equal(f.get('more-messages').onclick, undefined, 'painting the Notebook wires no retired control');
  const pages = [at(10, 19, 10), at(1, 9, null)], reads = [];
  const view = f.api.view;
  f.api.view = async (name, args) => {
    if (name === 'topic_messages') { reads.push(args.cursor); return pages.shift(); }
    return view(name, args);
  };
  await marker.onclick(); await settle();
  assert.deepEqual(reads, [20, 10], 'it read older pages until the message was loaded, and no further');
  assert.equal(order().split(' ').slice(-7).join(' '), '6 5 new 4 3 2 1', 'loaded: the line is in its true place');
  assert.equal(f.get('messages').children.filter(child => child.dataset.line).length, 1, 'one line');
  assert.equal(f.document.activeElement?.dataset.seq, 5, 'the message it was for has the focus');
});

test('once the New line is in its place, the older cursor remains available', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = (from, through, next) => ({ ...page(from, through, next), oldest_unread: { seq: 15, id: 'm15' }, commit_seq: 1 });
  views.messagesPage(at(20, 29, 20), { initial: true }); await settle();
  assert.equal(views.olderCursor, 20);
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'topic_messages' ? at(10, 19, 10) : view(name, args);
  await listed(f).at(-1).onclick(); await settle();
  assert.equal(f.get('messages').children.find(child => child.dataset.line)?.dataset.line, 'new', 'the line is in its place');
  assert.equal(views.olderCursor, 10, 'older pages remain available to1045 scroll admission');
});

// "More new below" promises unread messages further back. Once they are read
// elsewhere it fades where it is, inert; marked unread again, the line holds
// once more.1045 admission retains the older cursor in either state.
test('the older-below line fades once read elsewhere and the older cursor remains', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage({ ...page(20, 29, 20), oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 }, { initial: true }); await settle();
  const marker = listed(f).at(-1);
  assert.deepEqual([marker.dataset.line, marker.inert, views.olderCursor], ['older', false, 20], 'the line waits at the bottom with its older cursor');
  const unread = async (oldest, at) => { await views.readUnread(async () => ({ instance_id: 'fixture', topic_id: 't1', oldest_unread: oldest, commit_seq: at })); await settle(); };
  await unread(null, 2);
  assert.equal(listed(f).at(-1), marker, 'read elsewhere, the line stays in its place');
  assert.deepEqual([marker.className, marker.inert], ['new-line new-line-older new-line-read', true], 'faded and inert');
  assert.equal(views.olderCursor, 20, 'reading elsewhere preserves the older cursor');
  f.paintViews('memory');
  assert.equal(views.olderCursor, 20, 'painting the Notebook preserves the older cursor');
  await unread({ seq: 5, id: 'm5' }, 3);
  assert.deepEqual([marker.className, marker.inert, views.olderCursor], ['new-line new-line-older', false, 20], 'marked unread again: the line holds with its older cursor');
});

test('with nothing older left to load, no line promises older messages below', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage({ ...page(20, 29, null), oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 }, { initial: true }); await settle();
  const order = () => listed(f).map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order(), '29 28 27 26 25 24 23 22 21 20', 'no line: there is nothing it could load');
});

test('pressing the older-below line while the page may not read stops at once and reads nothing', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage({ ...page(20, 29, 20), oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 }, { initial: true }); await settle();
  const reads = [], view = f.api.view;
  f.api.view = async (name, args) => { if (name === 'topic_messages') reads.push(args.cursor); return view(name, args); };
  // The runtime changed: the page asks for a review before it reads again.
  f.registry.runtime.current = { authority_id: 'other', authority_epoch: 'e2' };
  await listed(f).at(-1).onclick(); await settle();
  assert.deepEqual(reads, [], 'nothing was read');
  assert.equal(listed(f).at(-1).dataset.line, 'older', 'the line still waits at the bottom');
});

test('during a visit the New line holds as the person reads, fades once nothing above it is unread, moves to show more, and only Mark read places it afresh, the card being read held still', async () => {
  const scrolls = [];
  const f = fixture(undefined, { window: { addEventListener() {}, scrollBy: (x, y) => { const delta = typeof x === 'object' ? x.top : y; if (delta) scrolls.push(delta); }, matchMedia: () => ({ matches: false, addEventListener() {} }) }, innerHeight: 800 });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  const live = stream(); f.useLive(live);
  await f.initialize(); await settle();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  // Children are laid out from where the list starts: a card is 100px, the line 30px.
  let listTop = 0;
  const list = f.get('messages'), cards = () => list.children.filter(child => child.dataset.seq);
  f.document.querySelectorAll = () => cards();
  // The first message entry, on its own or in a reply stack (app.mjs MESSAGE_ENTRIES): here every card is on its own.
  f.document.querySelector = selector => selector.startsWith('#messages > [data-id]') ? cards()[0] ?? null : selector.startsWith('meta') ? { content: 'fixture-session' } : f.get(selector.slice(1));
  const layout = () => { for (const child of list.children) child.getBoundingClientRect = () => {
    let top = listTop; for (const before of list.children.slice(0, list.children.indexOf(child))) top += before.dataset.line ? 30 : 100;
    return { top, bottom: top + (child.dataset.line ? 30 : 90) }; }; };
  views.messagesPage({ ...page(20, 26, null), oldest_unread: { seq: 22, id: 'm22' }, commit_seq: 5 }, { initial: true }); await settle(); layout();
  const order = () => listed(f).map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order(), '26 25 24 23 22 new 21 20', 'placed from the server when the topic opens');
  // The person is reading #21, just below the line; #22 and #23 were read on screen.
  listTop = -500;
  const reads = [], view = f.api.view;
  let answer = { oldest_unread: { seq: 24, id: 'm24' }, commit_seq: 7 };
  f.api.view = async (name, args) => { if (name === 'topic_unread') { reads.push(args); return { instance_id: 'fixture', topic_id: 't1', ...answer }; } return view(name, args); };
  live.emit({ kind: 'commit', seq: 7 }); for (let n = 0; n < 5; n++) await settle(); layout();
  assert.deepEqual(reads, [{ topic_id: 't1' }], 'the reload a commit sets off reads where the oldest unread message is');
  assert.equal(order(), '26 25 24 23 22 new 21 20', 'reading during the visit leaves the line where it was');
  assert.deepEqual(scrolls, []);
  // Marked unread elsewhere, further back: the line moves down to show it.
  answer = { oldest_unread: { seq: 20, id: 'm20' }, commit_seq: 8 };
  live.emit({ kind: 'commit', seq: 8 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 23 22 21 20 new', 'a mark further back moves the line down');
  assert.deepEqual(scrolls, [-30], 'the card being read is held where it was');
  // Pressed in the Reader on message seq: the mark it had, and the one Core records.
  const press = async (seq, from, to) => {
    const id = 'm' + seq;
    f.registry.current = { source: { source_ref: { kind: 'message', id }, topic_id: 't1', seq }, mark: { marked: from % 2 === 1, mark_revision: from } };
    f.owners().marks.learn(id, from, { topicId: 't1', seq });
    f.api.command = async envelope => ({ recorded: true, status: 'committed', operation_id: envelope.operation_id,
      result: { message_id: id, topic_id: 't1', seq, marked: to % 2 === 1, mark_revision: to, changed: true } });
    await f.toggleMark(); for (let n = 0; n < 5; n++) await settle();
  };
  // A commit reads the line again but never places it afresh: #24 is newer than the line, which holds.
  answer = { oldest_unread: { seq: 24, id: 'm24' }, commit_seq: 9 };
  live.emit({ kind: 'commit', seq: 9 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(reads.length, 3, 'the commit reads it');
  assert.equal(order(), '26 25 24 23 22 21 20 new', 'and leaves the line where it was');
  // The person's own Mark read in the Reader places it afresh, under the oldest unread message.
  await press(23, 1, 2);
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'Mark read places the line afresh, under the oldest unread message');
  assert.deepEqual(scrolls.filter(Boolean), [-30, 30], 'the card being read still holds still');
  // The line as drawn: shown, or faded where it is and inert.
  const line = () => list.children.find(child => child.dataset.line);
  const faded = () => [line().className.split(' ').includes('new-line-read'), line().inert];
  assert.deepEqual(faded(), [false, false], 'holding an unread message, it shows');
  // Read meanwhile, nothing at or above the line is unread: it fades where it is, with no Refresh.
  answer = { oldest_unread: null, commit_seq: 10 };
  live.emit({ kind: 'commit', seq: 10 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'everything read: the line stays in its place');
  assert.deepEqual(faded(), [true, true], 'and fades, inert');
  // Faded, the line is gone for the person: Mark unread on a message newer
  // than where it was brings it just below that message, shown again.
  answer = { oldest_unread: { seq: 26, id: 'm26' }, commit_seq: 11 };
  await press(26, 0, 1);
  assert.equal(order(), '26 new 25 24 23 22 21 20', 'faded, a mark above where it was brings the line just below the message');
  assert.deepEqual(faded(), [false, false], 'shown again');
  // An arrival above a line that shows is shown as new there: the line holds it.
  answer = { oldest_unread: { seq: 26, id: 'm26' }, commit_seq: 12 };
  live.emit({ kind: 'commit', seq: 12 }); for (let n = 0; n < 5; n++) await settle();
  assert.deepEqual([order(), faded()], ['26 new 25 24 23 22 21 20', [false, false]], 'still unread: it holds');
  answer = { oldest_unread: null, commit_seq: 13 };
  await press(26, 1, 2);
  assert.equal(order(), '26 new 25 24 23 22 21 20', 'an explicit Mark read with nothing unread leaves the line where it is');
  assert.deepEqual(faded(), [true, true], 'to fade');
  // Mark read whose read of the line fails: the stream's return reads it and places the line afresh.
  answer = { oldest_unread: { seq: 20, id: 'm20' }, commit_seq: 14 };
  live.emit({ kind: 'commit', seq: 14 }); for (let n = 0; n < 5; n++) await settle();
  answer = { oldest_unread: null, commit_seq: 15 };
  live.emit({ kind: 'commit', seq: 15 }); for (let n = 0; n < 5; n++) await settle();
  assert.deepEqual([order(), faded()], ['26 25 24 23 22 21 20 new', [true, true]], 'marked further back, then read: the line fades where it is');
  answer = { oldest_unread: { seq: 22, id: 'm22' }, commit_seq: 16 };
  live.emit({ kind: 'commit', seq: 16 }); for (let n = 0; n < 5; n++) await settle();
  answer = { oldest_unread: { seq: 24, id: 'm24' }, commit_seq: 17 };
  live.emit({ kind: 'commit', seq: 17 }); for (let n = 0; n < 5; n++) await settle();
  assert.deepEqual([order(), faded()], ['26 25 24 23 22 new 21 20', [false, false]], 'faded, a mark brings it under that message; read on to #24, it holds there');
  f.api.view = async (name, args) => { if (name === 'topic_unread') throw Error('offline'); return view(name, args); };
  await press(22, 1, 2);
  assert.equal(order(), '26 25 24 23 22 new 21 20', 'the read failed: the line is where it was');
  f.api.view = async (name, args) => { if (name === 'topic_unread') return { instance_id: 'fixture', topic_id: 't1', oldest_unread: { seq: 24, id: 'm24' }, commit_seq: 18 }; return view(name, args); };
  live.emit({ kind: 'state', state: 'down' }); live.emit({ kind: 'state', state: 'live' }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'the stream returns: the read is made again and the line placed afresh');
  // A read that fails leaves the line where it was, and the reload is owed.
  f.api.view = async (name, args) => { if (name === 'topic_unread') throw Error('offline'); return view(name, args); };
  live.emit({ kind: 'commit', seq: 19 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 new 23 22 21 20');
});

test('785 a document-top arrival waits behind New above; below the header its displacement is absorbed', async () => {
  for (const startY of [0, 570]) {
    const scrolls = [];
    const win = { scrollY: startY, addEventListener() {}, removeEventListener() {},
      scrollBy({ top }) { this.scrollY += top; if (top) scrolls.push(top); },
      matchMedia: () => ({ matches: false, addEventListener() {} }) };
    const f = fixture(undefined, { window: win, innerHeight: 800 });
    f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
    Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
    await f.initialize(); await settle();
    const list = f.get('messages'), cards = () => entries(list), visible = () => cards().filter(card => !card.hidden);
    const proto = Object.getPrototypeOf(list), originalRect = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function() {
      if (!this.dataset.id && this !== list) return originalRect.call(this);
      const top = this.hidden ? 0 : 120 + (this === list ? 0 : visible().indexOf(this) * 100) - win.scrollY;
      const height = this.hidden ? 0 : this === list ? visible().length * 100 : 90;
      return { top, bottom: top + height, height, left: 0, right: 300, width: 300 };
    };
    f.document.querySelectorAll = () => visible();
    const add = seq => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
    for (let seq = 20; seq <= 25; seq++) add(seq);
    f.paintViews('messages'); scrolls.length = 0;
    const held = visible().find(card => card.getBoundingClientRect().bottom > 0), before = held.getBoundingClientRect().top;
    add(26); f.paintViews('messages');
    assert.equal(held.getBoundingClientRect().top, before, 'same visible card keeps its position');
    assert.equal(entryIn(f, 'm26').isConnected, true);
    assert.equal(entryIn(f, 'm26').hidden, startY === 0);
    assert.equal(f.runObservation("stackState($('messages')).waiting.has('m26')"), startY === 0);
    assert.deepEqual(scrolls, startY === 0 ? [] : [100]);
  }
});

test('an agent\'s card in the topic log carries its color, and the person\'s own keeps its black', async () => {
  const { f } = await readingPage();
  const add = (seq, author_id, author_kind) => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id, author_kind, body: 'Body', topic_id: 't1' });
  add(1, 'fable', 'agent'); add(2, 'fixture-person', 'human'); add(3, 'dan', 'human'); add(4, 'warp', 'agent');
  f.paintViews('messages');
  const classes = Object.fromEntries(listed(f).map(card => [card.dataset.id, card.className]));
  assert.deepEqual(classes, { m4: 'message-card agent-card agent-cyan', m3: 'message-card', m2: 'message-card own-message', m1: 'message-card agent-card agent-green' });
});

// Item 465: the page's New message composer at rest sits among the messages, just above More: under the last
// message shown above it, never at the list's top and never among the dossiers put aside.
test('the New message composer rests just above More, under the last message shown above it', async () => {
  const { f } = await readingPage();
  const add = seq => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', author_kind: 'agent', body: 'Body ' + seq, topic_id: 't1' });
  add(1); add(2); add(3);
  f.paintViews('messages');
  const order = () => f.get('messages').children.map(singleEntry).map(child => child === f.get('new-message-sheet') ? 'composer' : child.className === 'stack-controls' ? 'More' : child.dataset.id);
  assert.deepEqual(order(), ['m3', 'm2', 'm1', 'composer'], 'under the last message, with nothing below More');
  // m2 put below More: the composer stays above More, under m1.
  f.views.messages.get('m2').stack_position = { root_id: 'm2', through: 2, aside_revision: 1, below: true, at: { messages: 2, acts: 1 } };
  f.paintViews('acts');
  assert.deepEqual(order(), ['m3', 'm1', 'composer', 'More', 'm2'], 'between the last message above More and the More line');
  assert.equal(f.get('messages').querySelector(':scope > .stack-controls > .stack-more').textContent, 'Archived (1)');
});

test('your own message keeps its own style when it arrives live and when More loads it, among agents\' colors', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const item = (seq, author_id) => ({ id: 'm' + seq, seq, author_id, author_kind: author_id === 'fixture-person' ? 'human' : 'agent', body: 'Body ' + seq, topic_id: 't1' });
  const page = (items, next, version) => ({ instance_id: 'fixture', items, next_cursor: next, relevant_versions: { topic: version } });
  views.messagesPage(page([29, 30, 31].map(seq => item(seq, 'fable')), 29, 1), { initial: true }); await settle();
  views.messagesPage(page([item(32, 'fixture-person'), item(33, 'warp')], null, 2), { live: true, cursor: views.newest }); await settle();
  views.messagesPage(page([item(27, 'aim-lead'), item(28, 'fixture-person')], null, 2), { cursor: views.olderCursor }); await settle();
  const classes = Object.fromEntries(listed(f).map(card => [card.dataset.id, card.className]));
  assert.deepEqual(classes, { m33: 'message-card agent-card agent-cyan', m32: 'message-card own-message', m31: 'message-card agent-card agent-green',
    m30: 'message-card agent-card agent-green', m29: 'message-card agent-card agent-green', m28: 'message-card own-message', m27: 'message-card agent-card agent-blue' });
});

// Item 550's limits: a topic whose messages all answer its opening message, above the page, is one dossier, one
// stack. More messages fills that stack: the older messages it loads show at the stack's end, where the button was,
// newest first and whole, under the head the stack had; a message of the reader's own, live or loaded, never heads it
// and keeps its own style.
test('More messages shows the older messages of the dossier it fills where its button was, under the head it had, the reader\'s own their own', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = { root_id: 'm1', through: null, below: false, aside_revision: 0, name: null, name_revision: 0, at: { acts: 1, messages: 0 } };
  const item = (seq, author_id = 'fable') => ({ id: 'm' + seq, seq, author_id, author_kind: author_id === 'fixture-person' ? 'human' : 'agent', body: 'Body ' + seq, topic_id: 't1', reply_to: 'm1', stack_position: at });
  const page = (items, next, version) => ({ instance_id: 'fixture', items, next_cursor: next, relevant_versions: { topic: version } });
  views.messagesPage(page([40, 41, 42, 43].map(seq => item(seq)), 40, 1), { initial: true }); await settle();
  views.messagesPage(page([item(44, 'fixture-person')], null, 2), { live: true, cursor: views.newest }); await settle();
  const view = f.api.view;
  // The page More reads reaches the dossier's first message, m1, which then heads nothing and gathers nothing.
  const first = { id: 'm1', seq: 1, author_id: 'fable', author_kind: 'agent', body: 'Where shall we meet?', topic_id: 't1', stack_position: at };
  f.api.view = async (name, args) => name === 'topic_messages' ? page([first, item(36), item(37, 'fixture-person'), item(38)], null, 2)
    : name === 'memory_items' ? { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } } : view(name, args);
  const drawn = () => entries(f.get('messages')).map(entry => [entry.dataset.id, entry.className, !entry.hidden]);
  const before = drawn();
  assert.deepEqual(before.map(([id]) => id), ['m40', 'm41', 'm42', 'm43', 'm44'], 'one stack, its head m40');
  await f.loadOlderMessages(); await settle(); await settle();
  assert.deepEqual(drawn(), [...before, ['m38', 'message-card agent-card agent-green', true], ['m37', 'message-card own-message', true], ['m36', 'message-card agent-card agent-green', true],
    ['m1', 'message-card agent-card agent-green', true]],
    'the stack keeps its head and what it showed, then the older messages, newest first, each shown, the reader\'s own its own');
  assert.equal(drawn().find(([id]) => id === 'm44')[1], 'message-card own-message', 'the reader\'s own live message is a reply, never the head');
  // Where the button was: the filled cards a run of whole cards, none overlapping another or covering the face above
  // it, which keeps the place it had (stack-look.css, data-stack-filled); the faces above still overlap as a stack's do,
  // the head m40 among them, which shows whole though the stack is folded (its first message is not loaded, fix round B2).
  const faces = Object.fromEntries(entries(f.get('messages')).map(entry => [entry.dataset.id, [entry.dataset.stackFilled, entry.dataset.stackOverlap, entry.dataset.stackCovered]]));
  assert.deepEqual(faces, { m40: ['false', 'false', 'true'], m41: ['false', 'true', 'true'], m42: ['false', 'true', 'true'], m43: ['false', 'true', 'true'], m44: ['false', 'true', 'false'],
    m38: ['true', 'false', 'false'], m37: ['true', 'false', 'false'], m36: ['true', 'false', 'false'], m1: ['true', 'false', 'false'] });
});

// Item 799, shipped b8d449218cb01c42e003e76bc588637f3c99f252, replaced the apart branch:
// More-loaded replies stay inside their existing dossier, keeping its head and existing order.
// Here m36 is a separate dossier below m37..m41; older replies join that higher dossier.
test('More keeps older replies inside their existing dossier with its head retained through both presses (799 b8d44921)', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = root => ({ root_id: root, through: null, below: false, aside_revision: 0, name: null, name_revision: 0, at: { acts: 1, messages: 0 } });
  const item = (seq, root, reply_to = null) => ({ id: 'm' + seq, seq, author_id: 'fable', author_kind: 'agent', body: 'Body ' + seq, topic_id: 't1',
    ...(reply_to ? { reply_to } : {}), stack_position: at(root) });
  const run = (from, through, make) => Array.from({ length: through - from + 1 }, (_, n) => make(from + n));
  const page = (items, next, version) => ({ instance_id: 'fixture', items, next_cursor: next, relevant_versions: { topic: version } });
  // m2..m35 answer m1, older than the page; m36 is a message of its own; m37..m41 answer m1; m42..m65 are messages of their own.
  views.messagesPage(page([item(36, 'm36'), ...run(37, 41, seq => item(seq, 'm1', 'm1')), ...run(42, 65, seq => item(seq, 'm' + seq))], 36, 1), { initial: true }); await settle();
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'topic_messages' ? page(run(6, 35, seq => item(seq, 'm1', 'm1')), 6, 1)
    : name === 'memory_items' ? { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } } : view(name, args);
  const drawn = () => entries(f.get('messages')).map(entry => [entry.dataset.id, !entry.hidden]);
  const stackOf = id => entryIn(f, id)?.closest('.reply-stack')?.dataset.stack ?? null;
  const before = drawn();
  assert.deepEqual([before.at(-1), stackOf('m41'), ['m37', 'm38', 'm39', 'm40', 'm41'].map(stackOf)], [['m36', true], 'm37', Array(5).fill('m37')],
    'm36 is the last card above More, and the dossier\'s five replies are one stack higher up, headed by m37');
  await f.loadOlderMessages(); await settle(); await settle();
  assert.deepEqual(drawn(), [...before.slice(0, -1), ...run(6, 35, seq => ['m' + (41 - seq), true]), before.at(-1)],
    'existing cards keep their relative order and visibility; older replies stay in their dossier before m36');
  assert.deepEqual([['m37', 'm38', 'm39', 'm40', 'm41'].map(stackOf), run(6, 35, seq => stackOf('m' + seq)).filter(Boolean)], [Array(5).fill('m37'), Array(30).fill('m37')],
    'the higher dossier retains m37 as its head and owns every older reply');
  // The separate m36 dossier remains last. A second More press adds the next older replies
  // to the same higher dossier, after its previous older page, without changing its head.
  const shown = drawn();
  assert.deepEqual(shown.at(-1), ['m36', true], 'the separate m36 dossier stays last above More');
  f.api.view = async (name, args) => name === 'topic_messages' ? page(run(2, 5, seq => item(seq, 'm1', 'm1')), null, 1)
    : name === 'memory_items' ? { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } } : view(name, args);
  await f.loadOlderMessages(); await settle(); await settle();
  assert.deepEqual(drawn(), [...shown.slice(0, -1), ['m5', true], ['m4', true], ['m3', true], ['m2', true], shown.at(-1)],
    'pressed again: older replies remain together in their dossier before m36, newest first and shown');
  assert.deepEqual([['m37', 'm38', 'm39', 'm40', 'm41'].map(stackOf), run(2, 35, seq => stackOf('m' + seq)).filter(Boolean)], [Array(5).fill('m37'), Array(34).fill('m37')],
    'pressed again, the higher dossier still keeps its head and owns all of its older replies');
});

// Item 803, shipped cdfeae10cff085a744c7ab48d570c8c43890d806, frames every admitted message.
// A nonempty cover has one sheet even for a lone reply; More and root arrival duplicate no cover pills.
test('B3 More keeps one cover sheet per dossier with no duplicate pills through root arrival (803 cdfeae10)', async () => {
  for (const folder of [false, true]) for (const state of ['empty', 'stands', 'waiting', 'proposed', 'thumb', 'word']) {
    const { f } = await readingPage();
    f.document.createElementNS = (_ns, tag) => f.document.createElement(tag);
    const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
    f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
    const cover = state === 'empty' ? null : { stands: 'Answered', owner: 'fixture-person', by: 'fable', at_ms: 1,
      waiting: state === 'waiting' || state === 'proposed' ? [{ text: 'Launch?', default: 'Friday' }] : [],
      payload: ['proposed', 'thumb', 'word'].includes(state) ? { text: 'Ready', message_id: 'm1', seq: 1, kind: 'answer',
        done: state === 'proposed' ? null : { how: state, by: 'fixture-person', at_ms: 1700000000000 } } : null };
    const item = (seq, root = 'm1') => ({ id: 'm' + seq, seq, author_id: 'fable', author_kind: 'agent', body: 'Body ' + seq, topic_id: 't1',
      reply_to: seq === Number(root.slice(1)) ? null : root, acts: { cover: seq === 1 ? cover : null, cover_revision: seq === 1 ? 1 : 0 },
      stack_position: { root_id: root, cover: root === 'm1' ? cover : null, cover_revision: 1, through: null, below: false, aside_revision: 0, at: { acts: 1, messages: 7 } } });
    const page = (items, next) => ({ instance_id: 'fixture', items, next_cursor: next, relevant_versions: { topic: 1 } });
    views.messagesPage(page([item(4, 'm4'), item(5), ...(folder ? [item(6)] : []), item(7, 'm7')], 4), { initial: true }); await settle();
    const walk = node => (node.children ?? []).filter(e => e && typeof e === 'object').flatMap(e => [e, ...walk(e)]);
    const descendants = () => walk(f.get('messages'));
    const pills = () => descendants().filter(e => e.classList?.contains('row-pills'));
    const sheets = () => descendants().filter(e => e.classList?.contains('dossier-cover'));
    const checkOrder = () => {
      for (const sheet of sheets()) {
        const siblings = sheet.parentElement.children;
        const card = siblings.find(e => e.dataset?.id);
        assert.ok(card && siblings.indexOf(sheet) < siblings.indexOf(card), '783 cover precedes the first message, including a lone reply');
      }
    };
    assert.equal(pills().length, 0, `${folder}/${state}: a lone reply is framed and uses its cover sheet`);
    assert.equal(sheets().length, cover ? 1 : 0);
    checkOrder();
    const view = f.api.view;
    for (const [items, next] of [[[item(2), item(3)], 2], [[item(1)], null]]) {
      f.api.view = async (name, args) => name === 'topic_messages' ? page(items, next)
        : name === 'memory_items' ? { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } } : view(name, args);
      await f.loadOlderMessages(); await settle(); await settle();
      assert.equal(pills().length, 0, `${folder}/${state}: More never duplicates the dossier cover as pills`);
      assert.equal(sheets().length, cover ? 1 : 0, 'the original sheet stays');
      checkOrder();
      for (const older of [1, 2, 3]) {
        const entry = entryIn(f, 'm' + older);
        if (entry) assert.equal(walk(entry).some(e => e.classList?.contains('row-pills')), false, 'a reply or arriving root has no duplicate cover pills');
      }
    }
  }
});

// Item 550, its fix round's B2: in a stack gathered under a first message the page has not loaded (m1), the message
// at its head is a reply, a card of its own before 550, and its words show, as each reply kept in view shows, while
// the stack is folded: unread or read. The negative: a stack headed by its own first message (m40) folds it to its
// tab, as before.
test('folded, a stack gathered under a first message not loaded shows its head\'s words, unread or read; a first message heading its stack folds to its tab', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = root => ({ root_id: root, through: null, below: false, aside_revision: 0, name: null, name_revision: 0, at: { acts: 1, messages: 0 } });
  const item = (seq, root, extra = {}) => ({ id: 'm' + seq, seq, author_id: 'fable', author_kind: 'agent', body: 'Body ' + seq, topic_id: 't1', stack_position: at(root), ...extra });
  // m2..m5 answer m1, above the page, all unread; m20..m22 answer m10, above the page, all read; m40 heads its own reply m41.
  const items = [...[2, 3, 4, 5].map(seq => item(seq, 'm1', { reply_to: 'm1', unread: true })), ...[20, 21, 22].map(seq => item(seq, 'm10', { reply_to: 'm10' })),
    item(40, 'm40'), item(41, 'm40', { reply_to: 'm40' })];
  views.messagesPage({ instance_id: 'fixture', items, next_cursor: null, relevant_versions: { topic: 1 } }, { initial: true }); await settle();
  for (const id of ['m2', 'm20', 'm40']) foldDossier(f, id);
  const section = id => entryIn(f, id)?.closest('.reply-stack') ?? null;
  const look = id => [section(id)?.dataset.stack, section(id)?.dataset.fold, section(id)?.dataset.headOpen];
  assert.deepEqual([look('m2'), look('m20'), look('m40')], [['m2', 'folded', 'true'], ['m20', 'folded', 'true'], ['m40', 'folded', 'false']],
    'folded, each gathered stack shows its head\'s card whole, unread or read; the stack headed by its own first message shows its tab alone');
  assert.deepEqual([2, 3, 4, 5].map(seq => entryIn(f, 'm' + seq).hidden), [false, false, false, false], 'every unread reply in view, its head among them');
  // A press on the head's words does what it does on any card (opens the Reader), as it did on that reply's own card
  // before 550; a press on its tab opens the dossier. The negative: a head folded to its tab opens the dossier wherever
  // it is pressed.
  const part = (id, name) => entryIn(f, id).children.find(child => String(child.className).split(' ').includes(name));
  const press = async (id, name) => { await entryIn(f, id).onclick({ target: part(id, name), button: 0, preventDefault() {} }); await settle(); };
  await press('m2', 'message-preview');
  assert.deepEqual(look('m2')[1], 'folded', 'the head\'s words are the card\'s, not the tab\'s');
  await press('m40', 'message-preview');
  assert.equal(look('m40')[1], 'open', 'a head folded to its tab opens its dossier wherever it is pressed');
  await press('m2', 'stack-head');
  assert.deepEqual([look('m2'), look('m40')], [['m2', 'open', 'true'], ['m40', 'open', 'true']], 'the tab opens the gathered dossier, its head still whole');
});

// Item 550's limit on the Reader's title (item 561): under a source it names the dossier, by its name, else its first
// message's line, never by the oldest reply the page holds; where the page's stacks cannot say (that first message not
// loaded, or the topic's updates paused), the dossier Core read with the source says. A dossier of that one message
// keeps the topic's name.
test('the Reader\'s title names the dossier by its name, else its first message\'s line, never the oldest loaded reply, the topic paused or not', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  const wire = extra => f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh, ...extra });
  wire({});
  const at = name => ({ root_id: 'm1', through: null, below: false, aside_revision: 0, name, name_revision: name ? 1 : 0, at: { acts: 1, messages: 0 } });
  const item = (seq, name = null) => ({ id: 'm' + seq, seq, author_id: 'fable', author_kind: 'agent', body: 'Reply line ' + seq, topic_id: 't1', reply_to: 'm1', stack_position: at(name) });
  views.messagesPage({ instance_id: 'fixture', items: [40, 41, 42].map(seq => item(seq)), next_cursor: 40, relevant_versions: { topic: 1 } }, { initial: true }); await settle();
  const core = { root_id: 'm1', name: null, first: { body: 'Where shall the club meet?\nThe hall or the boathouse.', attachments: [] }, alone: false };
  const source = (id, dossier = core) => ({ source_ref: { kind: 'message', id }, topic_id: 't1', dossier });
  assert.equal(f.readerDossierName(source('m41')), 'Where shall the club meet?', 'the first message\'s line, as Core read it, not "Reply line 40"');
  wire({ topicUnavailable: true });
  assert.equal(f.readerDossierName(source('m41')), 'Where shall the club meet?', 'the same while the topic\'s updates are paused');
  assert.equal(f.readerDossierName(source('m41', { ...core, name: { text: 'Club hall', by: 'fable' } })), 'Club hall', 'paused, the name Core read');
  wire({ topicUnavailable: false });
  // A name on the page's positions shows at once, over what Core read with the source.
  views.messagesPage({ instance_id: 'fixture', items: [item(43, { text: 'Hall plan', by: 'fable', at_ms: 1 })], next_cursor: null, relevant_versions: { topic: 2 } }, { live: true, cursor: views.newest }); await settle();
  assert.equal(f.readerDossierName(source('m41')), 'Hall plan');
  // The negatives: a dossier of one message alone keeps the topic's name, and so does a message read without a
  // dossier (sent by name from a topic the reader does not read).
  const lone = { id: 'm50', seq: 50, author_id: 'fable', author_kind: 'agent', body: 'On its own', topic_id: 't1', stack_position: { ...at(null), root_id: 'm50' } };
  views.messagesPage({ instance_id: 'fixture', items: [lone], next_cursor: null, relevant_versions: { topic: 3 } }, { live: true, cursor: views.newest }); await settle();
  assert.equal(f.readerDossierName(source('m50', { root_id: 'm50', name: null, first: { body: 'On its own', attachments: [] }, alone: true })), null);
  assert.equal(f.readerDossierName(source('m50', null)), null);
});

test('a Notebook page shown in the Reader is read at the revision shown; a message is not, and a refused read is said', async () => {
  const { f } = await readingPage();
  const answers = [];
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return answers.shift() ?? { status: 'committed', recorded: true, result: { previous_revision: 0 } }; };
  Object.assign(f.reader, { show() {}, paintPending() {}, paintRecipients() {} });
  Object.assign(f.views, { revisions: { observe() {}, offer: () => null } });
  f.registry.neighbors = async () => null;
  const shown = (source_ref, extra = {}) => {
    const presentation = { surface: 'reader', mode: 'reply', source: { source_ref, title: 'Page', body: 'Words', attachments: [], topic_id: 't1', author: 'agent-a', ...extra },
      editors: { reply: { key: 'r', context: { kind: 'reply', topicId: 't1', sourceRef: source_ref }, submissions: [] }, note: { key: 'n', context: { kind: 'note' }, submissions: [] } } };
    f.registry.current = presentation; return presentation;
  };
  const reads = () => JSON.parse(JSON.stringify(f.calls.filter(c => c.kind === 'memory.read').map(c => [c.envelope.target, c.envelope.args, c.envelope.expected])));
  f.registry.options.present(shown({ kind: 'memory', id: 'p1', revision: 3 })); await settle(); await settle();
  assert.deepEqual(reads(), [[{ item_id: 'p1' }, { revision: 3 }, { authority: { authority_id: 'a1', authority_epoch: 'e1' } }]]);
  f.registry.options.present(shown({ kind: 'message', id: 'm1' })); await settle(); await settle();
  assert.equal(reads().length, 1, 'a message is read through its topic, not here');
  f.registry.options.present(Object.assign(shown({ kind: 'memory', id: 'p1', revision: 3 }), { sourceUnavailable: true })); await settle(); await settle();
  assert.equal(reads().length, 1, 'an unavailable page is not read');
  answers.push({ status: 'rejected', recorded: true, error: { code: 'FORBIDDEN', message: 'No readable Notebook revision' } });
  f.registry.options.present(shown({ kind: 'memory', id: 'p2', revision: 1 })); await settle(); await settle();
  assert.equal(reads().length, 2);
  assert.ok(f.events.some(e => e[0] === 'reader-notice' && /No readable Notebook revision.*may still show as changed/.test(e[1])), 'the refusal is said in the Reader');
});

test('a Notebook page read at an older revision shows what changed since then; one never read, or read as it stands, shows nothing', async () => {
  const { f } = await readingPage();
  const answers = [], shown = [];
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return answers.shift(); };
  const view = f.api.view;
  let whileReading = () => {};
  f.api.view = async (name, args) => name === 'source' ? (f.calls.push({ name, args }), whileReading(), { instance_id: 'fixture', source_ref: args, body: `Revision ${args.revision} words.` }) : view(name, args);
  Object.assign(f.reader, { show() {}, paintPending() {}, paintRecipients() {}, showChanges: (...args) => shown.push(args) });
  Object.assign(f.views, { revisions: { observe() {}, offer: () => null } });
  f.registry.neighbors = async () => null;
  const open = async (previous, revision = 3, id = 'p1') => {
    answers.push({ status: 'committed', recorded: true, result: { previous_revision: previous } });
    const source_ref = { kind: 'memory', id, revision };
    f.registry.current = { surface: 'reader', mode: 'reply', source: { source_ref, title: 'Page', body: 'Revision 3 words, now longer.', attachments: [], topic_id: 't1' },
      editors: { reply: { key: 'r', context: { kind: 'reply', topicId: 't1', sourceRef: source_ref }, submissions: [] }, note: { key: 'n', context: { kind: 'note' }, submissions: [] } } };
    f.registry.options.present(f.registry.current); for (let n = 0; n < 4; n++) await settle();
  };
  await open(1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(c => c.name === 'source').map(c => c.args))), [{ kind: 'memory', id: 'p1', revision: 1 }], 'the revision read before is read');
  assert.deepEqual(shown, [[1, 'Revision 1 words.', 'Revision 3 words, now longer.']]);
  for (const previous of [0, 3]) await open(previous, 3, 'p2');
  assert.equal(shown.length, 1, 'nothing to compare for a page never read or read as it stands');
  assert.equal(f.calls.filter(c => c.name === 'source').length, 1);
  // Shown again, though Core now has it read, the page shows the same changes.
  await open(3);
  assert.deepEqual(shown, [[1, 'Revision 1 words.', 'Revision 3 words, now longer.'], [1, 'Revision 1 words.', 'Revision 3 words, now longer.']]);
  shown.length = 1;
  // The Reader moved on while the earlier revision was read: nothing is drawn over what it shows now.
  whileReading = () => { f.registry.current = { ...f.registry.current, source: { ...f.registry.current.source } }; };
  await open(2);
  assert.equal(f.calls.filter(c => c.name === 'source').length, 3, 'the earlier revision was asked for');
  assert.equal(shown.length, 1, 'a Reader showing something else is left alone');
});

test('on an outcome page its Notebook pages precede its topics and read again with them on each commit', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['w1']), o.page(['w1']));
  await f.initialize(); await drain();
  assertOutcomeTeamHeader(f);
  const page = f.get('outcome-page').children.map(child => child.id);
  assert.deepEqual(page.slice(page.indexOf('team-invite'), page.indexOf('topic-navigation') + 1),
    ['team-invite', 'outcome-references', 'page-here', 'topic-navigation'], 'below Team, its invitation, Notebook and the open page precede the topic cards');
  assert.ok(f.get('topic-navigation').children.some(node => node.className === 'outcome-topic-cards'));
  const pages = () => JSON.parse(JSON.stringify(f.calls.filter(call => call.name === 'memory_items').map(call => call.args.owner_scope)));
  assert.deepEqual(pages(), [{ kind: 'workspace', id: 'w1' }]);
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.equal(pages().length, 2, 'a commit reads the pages again, so a light goes out or comes on');
});

test('an outcome that becomes unavailable stops showing its Notebook pages and the page open in place, and shows them again on recovery', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream();
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  let failure = null;
  const item = { id: 'p1', seq: 1, title: 'Release plan', revision: 2, read_revision: 1, owner_scope: { kind: 'workspace', id: 'w1' }, source_ref: { kind: 'memory', id: 'p1', revision: 2 } };
  f.api.view = async name => {
    if (name === 'workspace') { if (failure) throw failure; return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome', purpose: 'Purpose' } }; }
    return { instance_id: 'fixture', items: name === 'memory_items' ? [item] : name === 'workspace_topics' ? [f.topic] : [], next_cursor: null };
  };
  await f.initialize();
  assert.equal(f.get('outcome-references').hidden, false);
  f.get('page-here').hidden = false;
  failure = Object.assign(Error('Access denied'), { code: 'FORBIDDEN' });
  await commit(live, 2);
  assert.equal(f.get('outcome-references').hidden, true, 'a denied outcome lists no pages');
  assert.equal(f.get('page-here').hidden, true, 'and shows none open');
  failure = null; await commit(live, 3);
  assert.equal(f.get('outcome-references').hidden, false, 'recovery lists them again');
});

test('a cached topic Notebook page keeps its read revision across commits without a bottom-feed card', async () => {
  const f = fixture(), live = stream(); Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.useLive(live);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  const scope = { kind: 'topic', id: 't1' };
  const page = (revision, read_revision) => ({ id: 'n1', seq: 1, owner_scope: scope, revision, read_revision, title: 'Plan', body: 'Words',
    source_ref: { kind: 'memory', id: 'n1', revision } });
  let shown = page(3, 1);
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'memory_items' && args.owner_scope?.kind === 'topic'
    ? (f.calls.push({ name, args }), { instance_id: 'fixture', items: [shown], next_cursor: null, relevant_versions: { notebook: 3 } }) : view(name, args);
  await f.initialize(); await drain();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.memoryPage({ instance_id: 'fixture', items: [shown], next_cursor: null, relevant_versions: { notebook: 3 } }, { initial: true });
  const state = () => [views.memory.get('n1').revision, views.memory.get('n1').read_revision];
  assert.deepEqual(state(), [3, 1]);
  assert.equal(f.get('memory-items').children.length, 0, 'the right rail owns the visible page list');
  const asked = () => f.calls.filter(call => call.name === 'memory_items' && call.args.owner_scope?.kind === 'topic').length;
  const before = asked();
  shown = page(3, 3);
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.equal(asked(), before + 1, 'a commit reads the topic Notebook\'s read state again');
  assert.deepEqual(state(), [3, 3], 'read, the cache records that revision');
  shown = page(4, 3);
  live.emit({ kind: 'commit', seq: 10 }); await drain();
  assert.deepEqual(state(), [4, 3], 'revised again, the cache retains the read revision');
  assert.equal(f.get('memory-items').children.length, 0, 'commits do not recreate bottom-feed pages');
});

test('once the topic is denied, or the runtime changed, a commit reads none of its Notebook\'s read state and puts nothing in the page status', async () => {
  const f = fixture(), live = stream(); Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  Object.assign(f.registry.runtime, { current: { ...f.bootstrap.authority } });
  f.useLive(live);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  const scope = { kind: 'topic', id: 't1' };
  const page = { id: 'n1', seq: 1, owner_scope: scope, revision: 3, read_revision: 1, title: 'Plan', body: 'Words', source_ref: { kind: 'memory', id: 'n1', revision: 3 } };
  let denied = false;
  const view = f.api.view, notebook = (name, args) => name === 'memory_items' && args.owner_scope?.kind === 'topic';
  f.api.view = async (name, args) => {
    if (!notebook(name, args)) return view(name, args);
    f.calls.push({ name, args });
    return denied ? { instance_id: 'fixture', error: { code: 'FORBIDDEN', message: 'No readable topic' } }
      : { instance_id: 'fixture', items: [page], next_cursor: null, relevant_versions: { notebook: 3 } };
  };
  await f.initialize(); await drain();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.memoryPage({ instance_id: 'fixture', items: [page], next_cursor: null, relevant_versions: { notebook: 3 } }, { initial: true });
  const asked = () => f.calls.filter(call => notebook(call.name, call.args)).length;
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  const before = asked();
  assert.ok(before > 0, 'an available topic\'s Notebook is read on a commit');
  const runtime = f.registry.runtime.current;
  f.registry.runtime.current = { ...runtime, authority_epoch: 'e2' };
  live.emit({ kind: 'commit', seq: 10 }); await drain();
  assert.equal(asked(), before, 'while the runtime changed, nothing of the Notebook is read');
  f.registry.runtime.current = runtime;
  live.emit({ state: 'live' }); await drain();
  assert.equal(asked(), before + 1, 'the read stays owed and is made once the stream is back');
  denied = true;
  await f.checkAvailability(async name => name === 'topic' ? { instance_id: 'fixture', topic: f.topic } : f.state(), () => true);
  f.get('app-status').textContent = ''; f.get('app-status').hidden = true;
  live.emit({ kind: 'commit', seq: 11 }); await drain();
  assert.equal(f.get('app-status').textContent, '', 'a denied topic\'s refusal is not said in the page status at every commit');
  assert.equal(f.get('app-status').hidden, true);
  assert.equal(asked(), before + 1, 'for its Notebook is not read');
});

test('a Notebook page counts as read only once the person can see it: shown in a background or unfocused tab, it is read when the tab comes forward', async () => {
  const { f } = await readingPage();
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return { status: 'committed', recorded: true, result: { previous_revision: 0 } }; };
  Object.assign(f.reader, { show() {}, paintPending() {}, paintRecipients() {} });
  Object.assign(f.views, { revisions: { observe() {}, offer: () => null } });
  f.registry.neighbors = async () => null;
  const shown = (id, revision) => {
    const source_ref = { kind: 'memory', id, revision };
    const presentation = { surface: 'reader', mode: 'reply', source: { source_ref, title: 'Page', body: 'Words', attachments: [], topic_id: 't1', author: 'agent-a' },
      editors: { reply: { key: 'r', context: { kind: 'reply', topicId: 't1', sourceRef: source_ref }, submissions: [] }, note: { key: 'n', context: { kind: 'note' }, submissions: [] } } };
    f.registry.current = presentation; f.registry.options.present(presentation);
  };
  const reads = () => f.calls.filter(c => c.kind === 'memory.read').map(c => [c.envelope.target.item_id, c.envelope.args.revision]);
  const fire = (kind, name) => { for (const event of f.events.filter(e => e[0] === kind && e[1] === name)) event[2]({}); };
  f.document.focused = false;
  shown('p1', 2); await settle(); await settle();
  assert.deepEqual(reads(), [], 'restored in a tab without focus, the page is not yet read');
  f.document.focused = true; fire('window-handler', 'focus'); await settle(); await settle();
  assert.deepEqual(reads(), [['p1', 2]], 'focus reads it');
  fire('window-handler', 'focus'); await settle();
  assert.deepEqual(reads(), [['p1', 2]], 'once');
  f.document.visibilityState = 'hidden';
  shown('p2', 1); await settle(); await settle();
  assert.deepEqual(reads(), [['p1', 2]], 'a hidden tab reads nothing');
  shown('p3', 4); await settle();
  f.document.visibilityState = 'visible'; fire('document-handler', 'visibilitychange'); await settle(); await settle();
  assert.deepEqual(reads(), [['p1', 2], ['p3', 4]], 'coming forward reads the page shown then, not one shown before it');
  f.document.focused = false;
  shown('p4', 1); await settle();
  f.registry.current = null;
  f.document.focused = true; fire('window-handler', 'focus'); await settle(); await settle();
  assert.deepEqual(reads(), [['p1', 2], ['p3', 4]], 'a page the Reader closed before the tab came forward was never seen, so it is not read');
});

// An agent whose wakes are not getting through says so after its name, in the
// topic's participants and in its outcome's team, from the wakes view; a commit
// reads the wakes again with everything else, and the words go when it is off.
const wakesApi = (f, quiet, more = () => ({ runner: { live: true } })) => {
  const view = f.api.view;
  f.api.view = async (name, args) => {
    if (name !== 'wakes') return view(name, args);
    f.calls.push({ name, args });
    return { instance_id: 'fixture', quiet: quiet(), ...more() };
  };
};
const chipWords = host => walk(host).filter(node => node.className === 'chip' || isPill(node)).map(node => node.textContent + node.children.map(child => child.textContent ?? child).join(''));

test('a participant whose wakes stopped says so on its name until a commit shows it answering', async () => {
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  const f = fixture();
  pickerApi(f, { topic: { owner_id: 'tony', creator_id: 'tony' } });
  let quiet = [{ actor_id: 'fable', waiting: 2, since_ms: Date.UTC(2026, 10, 5, 4, 23), why: 'not_answering' }];
  wakesApi(f, () => quiet);
  f.useLive(live);
  await f.initialize();
  await drain();
  const [person, agent] = chipWords(f.get('participants'));
  assert.equal(person, 'fixture-person');
  assert.match(agent, /^fable · not answering since \d+:\d\d [AP]M \w+ \w+ \d+ · 2 waiting$/);
  quiet = [];
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await drain();
  assert.deepEqual(chipWords(f.get('participants')), ['fixture-person', 'fable']);
});

test('an outcome\'s team says wakes are paused on each agent with work while no runner sends them', async () => {
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  pickerApi(f, { workspace: { owner_id: 'tony' } });
  wakesApi(f, () => [{ actor_id: 'ally', waiting: 4, why: 'wakes_paused' }]);
  await f.initialize();
  await drain();
  assert.deepEqual(chipWords(f.get('team-people')), ['Fixture', 'Ally · wakes paused · 4 waiting']);
});

test('while wakes are not going out, the page says so once, and the words go when a commit shows them going out again', async () => {
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  const f = fixture();
  pickerApi(f, { topic: { owner_id: 'tony', creator_id: 'tony' } });
  let more = { runner: { live: false, state: 'exited', reason: 'killed', since_ms: Date.UTC(2026, 10, 5, 4, 23) }, notice: { waiting_agents: 2 } };
  wakesApi(f, () => [], () => more);
  f.useLive(live);
  await f.initialize();
  await drain();
  const notice = f.get('wakes-status');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /^Wakes are not going out: the agent runner was killed at \d+:\d\d [AP]M .+\. 2 agents have work waiting\.$/);
  more = { runner: { live: true } };
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await drain();
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('the outcomes page an owner lands on says so too, and reads the wakes again on each commit', async () => {
  const live = { listeners: [], listen(fn) { this.listeners.push(fn); } };
  const f = fixture('https://fixture/');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  let more = { runner: { live: false, state: 'stopped', since_ms: Date.UTC(2026, 10, 5, 4, 23) }, notice: { waiting_agents: 1 } };
  wakesApi(f, () => [], () => more);
  f.useLive(live);
  await f.initialize();
  await drain();
  assert.match(f.get('wakes-status').textContent, /^Wakes are not going out: the agent runner was stopped at .+\. 1 agent has work waiting\.$/);
  more = { runner: { live: true } };
  for (const listener of live.listeners) listener({ kind: 'commit', seq: 9 });
  await drain();
  assert.equal(f.get('wakes-status').hidden, true);
});

// The top of a topic (r21 item 8): its note is the subtitle, the old hint is
// never written there, the gear opens Topic settings, and a topic the reader
// can no longer see shows neither gear nor open settings.
test('a topic page shows its note under the title, never the old hint, and its gear goes with the topic', async () => {
  const HINT = 'Open a message to read, quote, reply, or keep a private note.';
  const f = fixture();
  Object.assign(f.topic, { state: 'active', state_note: 'Ongoing: each release and what comes next', waiting_on: [], version: 1 });
  const dialog = f.get('topic-settings');
  Object.assign(dialog, { open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  const subtitle = f.get('topic-description'), gear = f.get('settings-open');
  const words = () => subtitle.children.map(node => typeof node === 'string' ? node : node.textContent).join('');
  assert.equal(f.get('topic-title').textContent, 'Fixture');
  assert.deepEqual([words(), subtitle.hidden, gear.hidden], ['Each release and what comes next', false, false]);
  assert.notEqual(subtitle.textContent, HINT, 'the hint is not written when the topic opens');
  // A fresh view of the topic repaints the subtitle, and never writes the hint.
  Object.assign(f.views, { topic: { ...f.topic, version: 2, state: 'done' }, participants: [] });
  f.paintViews('topic');
  assert.equal(words(), 'Done Ongoing: each release and what comes next');
  assert.notEqual(subtitle.textContent, HINT, 'nor when the topic is painted again');
  // A read that left before that version, landing late, does not take the subtitle back.
  Object.assign(f.views, { topic: { ...f.topic, version: 1, state: 'active' }, participants: [] });
  f.paintViews('topic');
  assert.equal(words(), 'Done Ongoing: each release and what comes next', 'the subtitle keeps the newest topic seen');
  // The gear opens Topic settings; a topic that becomes unavailable closes it and hides the gear.
  gear.handlers.click();
  assert.equal(dialog.open, true);
  await f.checkAvailability(async name => name === 'topic' ? { instance_id: 'fixture', topic: f.topic } : f.state(), () => true);
  assert.deepEqual([gear.hidden, dialog.open, f.get('topic-title').textContent], [true, false, 'Topic unavailable']);
  // On a conversation, which refuses every change Topic settings makes, there is no gear.
  Object.assign(f.views, { topic: { ...f.topic, version: 3, kind: 'conversation' }, participants: [] });
  f.paintViews('topic');
  assert.equal(gear.hidden, true);
});

// A start that fails was recovered by the Refresh button; now it says why with
// a button that reloads the page, which runs start again from nothing.
test('a start that fails says why with Reload this page, and a start that succeeds offers nothing', async () => {
  const f = fixture('https://fixture/?');
  assert.equal(await f.begin(async () => { throw Error('This page needs a session from the Theseus server.'); }), false);
  const status = f.get('app-status'), reload = status.children.find(child => child.id === 'start-reload');
  assert.equal(status.hidden, false); assert.equal(status.textContent, 'This page needs a session from the Theseus server.');
  assert.ok(reload, 'a button to start again'); assert.equal(reload.textContent, 'Reload this page'); assert.equal(reload.type, 'button');
  reload.onclick(); assert.deepEqual(f.events.filter(e => e[0] === 'reload'), [['reload']]);
  const g = fixture('https://fixture/?');
  assert.equal(await g.begin(async () => {}), true);
  assert.equal(g.get('app-status').children.some(child => child.id === 'start-reload'), false);
});

// The Outcomes home and the new outcome page keep the list of outcomes; only
// pages inside an outcome show that outcome alone.
for (const route of ['?', '?new=outcome&intent=i1']) {
  test(`the list of outcomes stays on ${route}, with its heading and New outcome`, async () => {
    const f = fixture('https://fixture/' + route, {
      openIntentJournal: async () => ({ close() {} }),
      OutcomeCreation: class { constructor() { this.row = { phase: 'draft' }; } async load() {} leave() {} },
      CreateOutcomeView: class { run(action) { return Promise.resolve().then(action); } } });
    const o = outcomesPage(f); o.answers.push(o.page(['w1']), o.page(['w1']));
    f.inject({ api: f.api, bootstrap: f.bootstrap });
    await f.initialize(); await drain();
    assert.equal(f.get('outcome-navigation').hidden, false, 'the outcomes list shows');
    assert.equal(f.get('new-outcome').disabled, false, 'New outcome is offered');
    assert.equal(f.get('rail')['aria-label'], undefined, 'the rail is not narrowed to one outcome');
    assert.equal(o.reads(), 1, 'the list is read');
  });
}

test('844 outcome home keeps the brand and navigation in the visible side rail', async () => {
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  f.api.view = async name => name === 'workspace' ? { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome', purpose: '' } } : { instance_id: 'fixture', items: [], next_cursor: null };
  await f.initialize(); await drain();
  assert.deepEqual(f.get('rail').children.slice(0, 2).map(child => child.id), ['brand', 'page-notices']);
  assert.equal(f.get('rail').hidden, false);
  assert.ok(!f.get('main').children.includes(f.get('brand')));
  let opened = false; await f.get('outcomes-home').onclick({ button: 0, preventDefault() { opened = true; } });
  assert.equal(opened, true, '"← Outcomes" opens the Outcomes home');
});

// Links in a message's words, as the page paints them (docs/links.md).
const linksIn = node => (node.children ?? []).flatMap(child => [...(child.tagName === 'A' ? [child] : []), ...linksIn(child)]);
const clicked = (a, fields = {}) => {
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...fields };
  a.handlers.click(event); return event;
};

test('a message card and the line a reply quotes show web links that press nothing under them; Notebook stays in cache', async () => {
  const f = fixture();
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'fable', body: 'Preview: https://preview.example:5211/ — try it.', topic_id: 't1', sent_ms: null, reply_to: null });
  f.views.messages.set('m2', { id: 'm2', seq: 2, author_id: 'tony', body: 'See https://a.example/one and https://a.example/tw', preview: true, topic_id: 't1', sent_ms: null,
    reply_to: 'm1', reply_to_author: 'fable', reply_to_excerpt: 'Preview: https://preview.example:5211/ — try it.' });
  f.paintViews('messages');
  const card = id => entryIn(f, id);
  const part = (id, name) => card(id).children.find(node => String(node.className).split(' ').includes(name));
  const shown = node => linksIn(node).map(a => [a.textContent, a.href, a.target, a.rel]);
  assert.deepEqual(shown(part('m1', 'message-preview')), [['https://preview.example:5211/', 'https://preview.example:5211/', '_blank', 'noopener noreferrer']]);
  assert.deepEqual(shown(part('m2', 'message-preview')), [['https://a.example/one', 'https://a.example/one', '_blank', 'noopener noreferrer']],
    'an excerpt\'s last address may be cut, so it is words');
  assert.deepEqual(shown(part('m2', 'message-reply-to')), [['https://preview.example:5211/', 'https://preview.example:5211/', '_blank', 'noopener noreferrer']]);
  const press = clicked(linksIn(part('m1', 'message-preview'))[0]);
  assert.deepEqual([press.stopped, press.prevented], [true, false], 'the browser follows it, and the card under it hears nothing');
  f.views.memory.set('n1', { id: 'n1', seq: 1, title: 'Plan', body: 'Lives at https://docs.example/plan.', source_ref: { kind: 'memory', id: 'n1', revision: 1 } });
  f.paintViews('memory');
  assert.equal(f.get('memory-items').children.length, 0, 'Notebook body rendering at the bottom of the feed is retired');
  assert.equal(f.views.memory.get('n1').body, 'Lives at https://docs.example/plan.');
});

test('a link to a place in this Theseus opens it as the rail does, keeping writing that is not yet saved', async () => {
  const assigned = [];
  const location = Object.assign(new URL('https://fixture/?topic=t1'), { assign: url => assigned.push(url), reload() {} });
  const f = fixture('https://fixture/?topic=t1', { location });
  // As the topic rows' check does: writing not yet confirmed saved holds the move.
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  f.registry.keepEditorsLocal = async () => {};
  Object.assign(f.editor, { localVersion: 1, ackVersion: 0 }); Object.defineProperty(f.editor, 'dirty', { get: () => f.editor.ackVersion < f.editor.localVersion });
  f.registry.flush = async () => ({ recorded: false, status: 'unknown' });
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await drain();
  f.views.messages.set('m1', { id: 'm1', seq: 1, author_id: 'fable', body: 'Carried on in https://fixture/?topic=t2 now.', topic_id: 't1', sent_ms: null, reply_to: null });
  f.paintViews('messages');
  const [a] = linksIn(entryIn(f, 'm1'));
  assert.deepEqual([a.href, a.target ?? ''], ['?topic=t2', ''], 'it stays in this tab');
  const press = clicked(a);
  assert.deepEqual([press.stopped, press.prevented], [true, true], 'the page opens it, not the browser');
  await drain();
  assert.deepEqual(assigned, [], 'writing not confirmed saved holds the move');
  assert.equal(f.editor.draft.body, 'kept');
  assert.match(f.get('topic-navigation-status').textContent, /not confirmed saved/);
  assert.equal(clicked(a, { metaKey: true }).prevented, false, 'a Cmd-click is the browser\'s own, to a new tab');
  f.registry.flush = async () => { f.editor.ackVersion = 1; return { recorded: true, status: 'committed' }; };
  clicked(a); await drain();
  assert.deepEqual(assigned, ['?topic=t2'], 'saved, it goes to the topic');
});

test('the version review closes on a press outside it, as Keep both for now does, and not on one inside', async () => {
  const f = fixture();
  const review = f.get('version-review');
  Object.assign(review, { showModal() { this.open = true; }, close() { this.open = false; },
    getBoundingClientRect: () => ({ left: 300, right: 1100, top: 100, bottom: 700 }), querySelector: () => null });
  f.registry.recoveryCandidates = async (editor, options, shown) => { const page = { items: [], nextCursor: null }; shown(page, false); return page; };
  await f.showVersions(f.editor, f.get('opener'), f.p);
  assert.equal(review.open, true);
  const listened = f.events.find(e => e[0] === 'window-handler' && e[1] === 'pointerdown');
  assert.ok(listened, 'the page listens for a press outside the version review');
  const [, , down] = listened;
  const press = (x, y) => { const event = { target: review, clientX: x, clientY: y, button: 0, isPrimary: true }; down(event); review.handlers.click(event); };
  press(700, 400);
  assert.equal(review.open, true, 'a press inside keeps it open');
  press(50, 400);
  assert.equal(review.open, false, 'a press on the backdrop closes it');
  assert.equal(f.document.activeElement, f.get('opener'), 'the focus goes back to what opened it');
});

// The Review buttons are drawn from the registry alone: one for each
// registered writing with a reply in doubt. The topic's own writing has its
// button in the composer while the composer shows, loaded or failed, and under
// the title until then. Leaving goes at once, and the buttons stay (item 547).
function doubtful(f, { composer = 'shown' } = {}) {
  f.registry.inline = null;
  f.registry.pending = () => ({ items: [{ id: 'from-phone', send_status: 'unknown' }], next_cursor: null, through: 1 });
  f.registry.keepEditorsLocal = async () => {}; f.registry.flush = async () => null; f.editor.dirty = false;
  // The page's own HTML hides the composer until it loads or fails.
  if (composer === 'loading') f.get('inline-composer').hidden = true;
}
const reviewLabels = el => el.children.flatMap(c => [c.textContent, ...reviewLabels(c)]).filter(t => /^Review/.test(t ?? ''));
const leaving = f => f.owners().topicNavigation.openTarget({ kind: 'topic', id: 't2' }, 'Second').then(() => null, error => error.message);

test('a topic composer that failed after registering shows its reply\'s Review button in the composer, and leaving goes at once', async () => {
  const f = fixture(); doubtful(f);
  f.registry.initializeInline = async () => { throw Error('This device could not read its saved versions'); };
  await f.initialize();
  assert.match(f.get('inline-notice').textContent, /New message is unavailable/);
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply'], 'the button is beside the failed composer');
  assert.deepEqual(reviewLabels(f.get('topic-pending')), [], 'and only there');
  assert.equal(await leaving(f), null, 'leaving goes at once, the reply in doubt kept');
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply'], 'and its button stays');
});

test('while the topic composer is still loading, its reply in doubt has its Review button under the title, then in the composer, and leaving goes at once', async () => {
  const f = fixture(); doubtful(f, { composer: 'loading' });
  const held = defer(), asked = defer();
  f.registry.initializeInline = () => { asked.resolve(); return held.promise; };
  const started = f.initialize(); await asked.promise;
  f.changed(f.editor); // registered, so the page is told; the composer is not there yet
  assert.deepEqual(reviewLabels(f.get('topic-pending')), ['Review 1 reply'], 'under the title while the composer loads');
  assert.deepEqual(reviewLabels(f.get('inline-pending')), []);
  assert.equal(await leaving(f), null, 'leaving goes at once');
  // A message's writing in doubt has its button under the title too, after the topic's.
  const message = { ...f.editor, key: 'm1', context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm1' } } };
  registered(f, message); f.changed(message);
  assert.deepEqual(f.get('topic-pending').children.map(host => host.dataset.key), ['inline', 'm1']);
  assert.equal(await leaving(f), null, 'leaving goes at once with both in doubt');
  assert.deepEqual(f.get('topic-pending').children.map(host => host.dataset.key), ['inline', 'm1'], 'and both buttons stay');
  // The composer shows: the topic's button moves into it, and is in one place only.
  f.registry.inline = f.p; f.owners().inline.show(f.p);
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply']);
  assert.deepEqual(f.get('topic-pending').children.map(host => host.dataset.key), ['m1']);
  held.resolve(f.p); await started;
});

test('a loaded topic composer and a message\'s writing each show their Review button, and leaving goes at once', async () => {
  const f = fixture(); doubtful(f);
  const message = { ...f.editor, key: 'm1', context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm1' } } };
  registered(f, message);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize(); f.changed(message);
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply']);
  assert.deepEqual(reviewLabels(f.get('topic-pending')), ['Review 1 reply']);
  assert.equal(await leaving(f), null);
});

test('leaving with replies in doubt goes at once, sends nothing and discards nothing (item 547)', async () => {
  const f = fixture(); doubtful(f);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize();
  f.registry.pending = () => ({ items: [{ id: 'a', send_status: 'unknown' }, { id: 'b', send_status: 'unknown' }], next_cursor: null, through: 2 });
  const sent = f.registry.send, discarded = [];
  f.registry.send = () => assert.fail('leaving sends nothing');
  f.registry.discard = (...args) => { discarded.push(args); };
  assert.equal(await leaving(f), null, 'leaving goes at once');
  assert.deepEqual([discarded, f.registry.inDoubt.map(entry => entry.label)], [[], ['Review 2 replies']], 'nothing discarded; both replies still in doubt');
  f.registry.send = sent;
});

// The registry holds one writing per key. A notice about any other editor
// (one a recovered version replaced, say) draws the registered writing's
// buttons, and an editor never registered draws none.
test('a notice about an editor that is not the registered writing draws the registered writing\'s Review button', async () => {
  const f = fixture(); doubtful(f);
  f.registry.pending = () => ({ items: [], next_cursor: null, through: 0 });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize();
  const restored = { ...f.editor, draft: { ...f.editor.draft }, submissions: [{ id: 'refused-1', status: 'refused', snapshot: { body: 'earlier reply' } }] };
  registered(f, restored); f.p.editors.reply = restored;
  const stranger = { ...f.editor, key: 'm9', submissions: [{ id: 'x', status: 'refused' }], context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm9' } } };
  const replacedWithDoubt = { ...f.editor, submissions: [{ id: 'kept-there', status: 'refused' }] };
  assert.deepEqual([replacedWithDoubt, stranger].map(editor => f.registry.doubt(editor).label), [null, null], 'an editor not registered, under its key or none, is in doubt about nothing');
  for (const told of [f.editor, stranger, restored]) {
    f.changed(told);
    assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply'], 'the recovered writing\'s refused reply keeps its button');
    assert.deepEqual(reviewLabels(f.get('topic-pending')), [], 'and an editor never registered draws none');
  }
  assert.equal(await leaving(f), null);
});


test('a notice about writing whose registration failed, still in the composer, draws only the buttons and throws nothing', async () => {
  const f = fixture(); doubtful(f);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize();
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply']);
  const { uploads } = f.registry.sessionFor(f.editor);
  f.registry.sessionFor = editor => { if (f.registry.sessions.get(editor.key)?.editor !== editor) throw Error('This writing is not registered in this document.'); return { uploads }; };
  f.registry.sessions.delete(f.editor.key); // Recover this version took it out, and the recovered copy could not register
  assert.doesNotThrow(() => f.changed(f.editor), 'the notice changes nothing about writing no longer registered');
  assert.deepEqual(reviewLabels(f.get('inline-pending')), [], 'and nothing registered there has a button');
});

// The Reader draws its writing's button as it shows, before any notice.
test('a message\'s Reader shows its writing\'s Review button as it opens', async () => {
  const reader = { narrow: { addEventListener() {} }, dialog: { open: false }, notice() {}, paintOffer() {}, paintStatus() {}, paintOrigin() {}, drawSource() {}, drawAttachments() {}, hideUnavailableSource() {},
    show(source, sessions) { this.sessions = sessions; this.paintPending(); }, paintPending() { this.callbacks.renderPending(this.host, this.sessions.reply); } };
  const f = fixture('https://fixture/?topic=t1', { Reader: class { constructor(callbacks) { reader.callbacks = callbacks; return reader; } } });
  reader.host = f.get('pending-submissions');
  await f.initialize();
  const modal = { ...f.editor, key: 'm1', submissions: [{ id: 'refused-1', status: 'refused' }], context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm1' } } };
  registered(f, modal);
  const reading = { token: 1, source: { instance_id: 'fixture', source_ref: { kind: 'message', id: 'm1' }, topic_id: 't1', title: 'm1', body: '', attachments: [] },
    editors: { reply: modal }, mode: 'reply', opener: null, mark: null };
  f.registry.current = reading;
  await f.registry.options.present(reading);
  assert.equal(f.get('pending-submissions').firstElementChild?.textContent, 'Review 1 reply');
});

// Recover this version (EditorRegistry.adoptCandidate, its real call order:
// the restored writing registers and the page is told, the presentation
// shows it, and then the page is told about the editor it replaced). The
// recovered copy holds a refused reply, so its button stays, and leaving
// names it.
function recovering(f, old) {
  const R = f.registry, uploads = { current: () => [], running: new Map(), status: () => 'Ready' };
  const restored = { ...old, draft: { ...old.draft }, submissions: [{ id: 'refused-1', status: 'refused', snapshot: { body: 'earlier reply' } }] };
  Object.assign(R.sessions.get(old.key), { attempts: [], uploads });
  R.sessionFor = editor => R.sessions.get(editor.key);
  R.isCurrent = p => !!p && R.interactive === p;
  R.api = { view: async () => ({}) }; R.validateState = () => {}; R.journal = { adopt: async () => {} };
  R.changed = R.options.changed;
  R.register = async () => { R.sessions.set(old.key, { editor: restored, attempts: [], uploads, underWay: () => false }); R.changed(restored); return restored; };
  return restored;
}

test('Recover this version in the topic composer keeps the Review button of the refused reply it brings back, and leaving goes at once', async () => {
  const f = fixture(); doubtful(f);
  f.registry.pending = () => ({ items: [], next_cursor: null, through: 0 });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize();
  assert.deepEqual(reviewLabels(f.get('inline-pending')), [], 'nothing in doubt before the recovery');
  const restored = recovering(f, f.editor);
  f.registry.present = f.registry.options.present;
  assert.equal(await EditorRegistry.prototype.adoptCandidate.call(f.registry, f.editor, { id: 'c1', stamp: 's1' }, f.p), restored);
  await new Promise(setImmediate);
  assert.deepEqual(reviewLabels(f.get('inline-pending')), ['Review 1 reply'], 'the refused reply in the recovered writing shows its Review button');
  assert.equal(await leaving(f), null, 'leaving goes at once');
});

test('Recover this version in a message\'s Reader keeps the refused reply\'s Review button under the title once the Reader closes', async () => {
  const f = fixture(); doubtful(f);
  f.registry.pending = () => ({ items: [], next_cursor: null, through: 0 });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.initialize();
  const old = { ...f.editor, key: 'm1', submissions: [], draft: { ...f.editor.draft }, context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm1' } } };
  registered(f, old); f.changed(old);
  const reading = { surface: 'reader', editors: { reply: old }, source: { source_ref: old.context.sourceRef } };
  f.registry.current = reading;
  recovering(f, old); f.registry.present = () => {};
  await EditorRegistry.prototype.adoptCandidate.call(f.registry, old, { id: 'c1', stamp: 's1' }, reading);
  f.registry.current = null; // the Reader closes
  assert.deepEqual(reviewLabels(f.get('topic-pending')), ['Review 1 reply'], 'the refused reply in the recovered writing shows its Review button under the title');
  assert.equal(await leaving(f), null, 'leaving goes at once');
});

// The property behind item 118's Review buttons (docs/replies-in-doubt.md):
// after every step of a random run, the buttons the page draws are
// EditorRegistry.inDoubt over what the registry holds at that moment, and
// leaving waits only for a send under way or writing not yet safe, never for a
// reply in doubt (item 547). It runs the page's own app.mjs, its composer
// and its guard, over a real EditorRegistry and EditorSession, an in-memory
// recovery journal, and the small Core below; only the Reader is a stand-in
// that draws its writing's button as the real one does.

// The server's record for the run: each source's draft and replies, and every
// recorded operation. Each prepare and send waits for the run to answer it,
// and a named read can be made to fail once.
function smallCore(instanceId) {
  const sources = new Map(), operations = new Map(), held = [], failing = new Set();
  let seq = 0, made = 0;
  const fresh = prefix => `${prefix}-${++made}`;
  const source = ref => {
    const key = JSON.stringify([ref.kind, ref.id]);
    if (!sources.has(key)) sources.set(key, { ref: structuredClone(ref), draft: null, replies: [] });
    return sources.get(key);
  };
  const recorded = (envelope, status, body) => ({ recorded: true, instance_id: instanceId, operation_id: envelope.operation_id, kind: envelope.kind, status, ...body });
  // The replies not sent, oldest first and paged, and the highest place of any.
  const page = (s, { cursor = null, limit = 20 } = {}) => {
    const unsent = s.replies.filter(reply => reply.send_status !== 'committed' && (cursor === null || reply.seq > cursor)), items = unsent.slice(0, limit);
    return { instance_id: instanceId, items: structuredClone(items), next_cursor: unsent.length > limit ? items.at(-1).seq : null,
      through: s.replies.reduce((top, reply) => Math.max(top, reply.seq), 0) };
  };
  const reply = id => [...sources.values()].flatMap(s => s.replies).find(item => item.id === id);
  function apply(envelope, outcome) {
    const { kind, target, expected, args } = envelope;
    let receipt;
    if (kind === 'draft.save') {
      const s = source(args.source_ref), revision = (expected.draft_revision ?? 0) + 1;
      s.draft = { id: target.draft_id, generation: args.generation, revision, source_ref: structuredClone(args.source_ref), topic_id: args.topic_id };
      receipt = recorded(envelope, 'committed', { result: { draft_id: target.draft_id, generation: args.generation, draft_revision: revision } });
    } else if (kind === 'submission.prepare') {
      const s = [...sources.values()].find(s => s.draft?.id === args.draft_id);
      if (outcome === 'refuse' || !s) receipt = recorded(envelope, 'rejected', { error: { code: 'FORBIDDEN', message: 'Not allowed here.' } });
      else {
        const item = { id: args.submission_id, seq: ++seq, send_status: 'unknown', source_ref: structuredClone(s.ref), topic_id: target.topic_id,
          send_operation_id: args.send_operation_id, prepare_operation_id: envelope.operation_id, authority: structuredClone(expected.authority) };
        s.replies.push(item);
        const next = { id: fresh('draft'), generation: fresh('generation'), revision: 1 };
        s.draft = { ...next, source_ref: structuredClone(s.ref), topic_id: target.topic_id };
        receipt = recorded(envelope, 'committed', { result: { submission_id: item.id, send_operation_id: item.send_operation_id, next_draft: next, seq: item.seq } });
      }
    } else if (kind === 'message.send') {
      const item = reply(args.submission_id);
      item.send_status = outcome === 'refuse' ? 'rejected' : 'committed';
      receipt = outcome === 'refuse' ? recorded(envelope, 'rejected', { error: { code: 'FORBIDDEN', message: 'Not sent.' } })
        : recorded(envelope, 'committed', { result: { submission_id: item.id } });
    } else throw Error(`The small Core has no ${kind}.`);
    operations.set(envelope.operation_id, receipt);
    return structuredClone(receipt);
  }
  const api = {
    bootstrap: async () => ({ instance_id: instanceId, authority: structuredClone(BOOT.authority) }),
    view: async (name, args) => {
      if (failing.delete(name)) throw Error(`The ${name} read failed.`);
      if (name === 'editor_state') {
        const s = source(args.source_ref);
        return { instance_id: instanceId, source_ref: structuredClone(args.source_ref), destination: { topic_id: args.topic_id ?? null }, source_available: true,
          destination_available: true, draft: structuredClone(s.draft), note: null, mark: null, submissions: page(s, args) };
      }
      if (name === 'submissions') return page(source(args.source_ref), args);
      if (name === 'source') return { instance_id: instanceId, source_ref: structuredClone(args), topic_id: 't1', title: args.id, body: '', attachments: [] };
      if (name === 'operation') return structuredClone(operations.get(args.operation_id) ?? { instance_id: instanceId, operation_id: args.operation_id, status: 'unknown', recorded: false });
      return { instance_id: instanceId, items: [], next_cursor: null };
    },
    command: async envelope => {
      if (envelope.kind === 'draft.save') return apply(envelope);
      const answer = {}; answer.promise = new Promise((resolve, reject) => Object.assign(answer, { resolve, reject }));
      held.push({ envelope, answer }); return answer.promise;
    },
  };
  // The run answers the oldest act waiting: recorded and answered, refused,
  // recorded with its answer lost, or lost before Core recorded it.
  const answer = outcome => {
    const { envelope, answer } = held.shift();
    if (outcome === 'lost before') return answer.reject(Error('The answer was lost.'));
    const receipt = apply(envelope, outcome === 'refuse' ? 'refuse' : 'commit');
    if (outcome === 'lost after') answer.reject(Error('The answer was lost.')); else answer.resolve(receipt);
  };
  // A reply from another device: never landed, sent, or refused.
  const phone = (ref, sendStatus) => {
    const s = source(ref);
    s.replies.push({ id: fresh('phone'), seq: ++seq, send_status: sendStatus, source_ref: structuredClone(s.ref), topic_id: 't1',
      send_operation_id: fresh('send'), prepare_operation_id: fresh('prepare'), authority: structuredClone(BOOT.authority) });
  };
  return { api, held, failing, answer, phone, fresh };
}
const BOOT = { instance_id: 'fixture', actor: 'fixture-person', actor_kind: 'human',
  authority: { authority_id: 'runtime-1', authority_epoch: 'epoch-1', continuity: 'initial' } };

// Mulberry32 (seeded, above): the same seed is the same run.

async function reviewRun(seed, tally, steps = 30) {
  const random = seeded(seed), pick = list => list[Math.floor(random() * list.length)], chance = p => random() < p;
  const core = smallCore(BOOT.instance_id), rows = new Map(), failingOwn = new Set();
  const journal = new RecoveryJournal({
    put: async row => { rows.set(row.id, structuredClone(row)); },
    get: async id => { if (failingOwn.delete(id)) throw Error('This device could not read its saved writing.'); return structuredClone(rows.get(id)); },
    forEditor: async key => { if (key === topicKey && gate) await gate.promise; return [...rows.values()].filter(row => row.editorKey === key).map(row => structuredClone(row)); },
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(row => row?.editorKey === key).map(row => structuredClone(row)),
    removeExact: async (id, stamp) => rows.get(id)?.stamp === stamp ? rows.delete(id) : false,
    adopt: async (key, candidate) => {
      const adopted = { ...structuredClone(rows.get(candidate.id)), id: journal.id(key), writerId: journal.writerId, stamp: core.fresh('adopted') };
      rows.set(adopted.id, adopted); return structuredClone(adopted);
    },
  }, 'this-tab');
  const topicKey = JSON.stringify([BOOT.instance_id, BOOT.actor, 'reply', 'topic', 't1', 't1']);
  // The composer's first read of its saved versions waits for the run, so the
  // topic's writing is registered while the composer is still loading.
  let gate = { promise: null }; gate.promise = new Promise((resolve, reject) => Object.assign(gate, { resolve, reject }));
  const reader = { narrow: { addEventListener() {} }, dialog: { open: false }, sessions: null, presentation: null, layoutChoice: null, host: null,
    notice() {}, paintOffer() {}, paintStatus() {}, hideUnavailableSource() {}, drawSource() {}, drawAttachments() {}, paintOrigin() {},
    get editor() { return this.sessions?.[this.presentation?.mode ?? 'reply']; },
    show(source, sessions, { presentation } = {}) { this.sessions = sessions; this.presentation = presentation; this.dialog.open = true; this.paintPending(); },
    paintPending() { this.callbacks.renderPending(this.host, this.sessions.reply); this.paintStatus(); },
    finishClose() { this.dialog.open = false; this.sessions = null; } };
  let registry;
  const made = defer();
  const f = fixture('https://fixture/?topic=t1', {
    EditorRegistry: class { constructor(options) { registry = new EditorRegistry({ ...options, api: core.api, bootstrap: BOOT, journal, pendingPageSize: 2,
      timers: { setTimeout: () => 0, clearTimeout() {}, now: () => 0 } }); made.resolve(); return registry; } },
    Reader: class { constructor(callbacks) { reader.callbacks = callbacks; return reader; } },
  });
  reader.host = f.get('pending-submissions');
  // The page's own HTML hides the composer until it loads or fails.
  f.get('inline-composer').hidden = true;
  const started = f.initialize();
  const trail = [], replaced = [];
  const settle = async () => { for (let n = 0; n < 4; n++) await new Promise(setImmediate); };
  const attempt = async (name, act) => { try { await act(); trail.push(name); } catch (error) { trail.push(`${name} (refused: ${error.message})`); } };
  const writings = () => [...registry.sessions.values()].map(session => session.editor).filter(editor => editor.context.kind === 'reply');
  const front = () => registry.current ? [registry.current, registry.current.editors.reply] : registry.inline ? [registry.inline, registry.inline.editors.reply] : [];
  await Promise.race([made.promise, started]);
  assert.ok(registry, `seed ${seed}: the page made its registry`);
  await settle();
  let leaves = 0;
  const check = async () => {
    await settle();
    const why = `seed ${seed} after: ${trail.join(' → ')}`;
    const entries = registry.inDoubt, composer = !f.get('inline-composer').hidden;
    const inComposer = entry => composer && entry.editor.context.sourceRef.kind === 'topic';
    const button = host => host.firstElementChild?.textContent ?? null;
    assert.deepEqual(f.get('topic-pending').children.map(host => [host.dataset.key, button(host)]),
      entries.filter(entry => !inComposer(entry)).map(entry => [entry.editor.key, entry.label]), `under the title: ${why}`);
    assert.equal(button(f.get('inline-pending')), entries.find(inComposer)?.label ?? null, `in the composer: ${why}`);
    // The open Reader shows its writing's button too.
    const reading = registry.current?.editors.reply?.key;
    if (reading) assert.equal(button(f.get('pending-submissions')), entries.find(entry => entry.editor.key === reading)?.label ?? null, `in the Reader: ${why}`);
    // The guard, to a topic not chosen before.
    const going = registry.hasInFlightSend, title = `Topic ${++leaves}`;
    const words = await f.owners().topicNavigation.openTarget({ kind: 'topic', id: `t-${leaves}` }, title).then(() => null, error => error.message);
    await settle();
    const now = registry.inDoubt;
    if (going) assert.equal(words, 'Wait for the send to finish before changing topics.', `leaving waits: ${why}`);
    else if (words === null) {
      // Free to leave, it goes at once, replies in doubt or none (item 547).
      tally[now.length ? 'leftInDoubt' : 'left']++;
    } else {
      // Writing not yet safe on this device or in Theseus holds the move first, and names no button.
      assert.doesNotMatch(words, /Review/, `leaving held for the writing: ${why}`);
      tally.held++;
    }
    assert.deepEqual(f.get('topic-pending').children.map(host => [host.dataset.key, button(host)]),
      now.filter(entry => !inComposer(entry)).map(entry => [entry.editor.key, entry.label]), `under the title once leaving asked: ${why}`);
  };
  await check();
  for (let n = 0; n < steps; n++) {
    const kind = pick(['open', 'open', 'close', 'send', 'send', 'answer', 'answer', 'answer', 'phone', 'phone', 'phone', 'check', 'more', 'more', 'replace', 'stale', 'load']);
    if (kind === 'open') {
      const id = pick(['m1', 'm2', 'm3']), fail = chance(0.2);
      if (fail) core.failing.add('editor_state');
      await attempt(`open ${id}${fail ? ' (its read fails)' : ''}`, () => registry.open({ kind: 'message', id }, { topicId: 't1' }));
      core.failing.delete('editor_state');
    } else if (kind === 'close') {
      if (registry.current) await attempt('close', () => registry.close(registry.current, { explicit: true }));
    } else if (kind === 'send') {
      const [p, editor] = front();
      if (p) await attempt(`send from ${editor.context.sourceRef.id}`, () => {
        editor.edit({ body: `Reply ${n}` });
        registry.send(editor, { presentation: p, stay: true }).catch(error => trail.push(`(its send ended: ${error.message})`));
      });
    } else if (kind === 'answer') {
      if (core.held.length) { const outcome = pick(['commit', 'commit', 'refuse', 'lost after', 'lost before']); trail.push(`${core.held[0].envelope.kind} ${outcome}`); core.answer(outcome); }
    } else if (kind === 'phone') {
      const ref = pick([{ kind: 'topic', id: 't1' }, { kind: 'message', id: 'm1' }, { kind: 'message', id: 'm2' }]), status = pick(['unknown', 'unknown', 'committed', 'rejected']);
      core.phone(ref, status); trail.push(`a reply from the phone to ${ref.id}, ${status}`);
    } else if (kind === 'check') {
      const editor = pick(writings()), fail = chance(0.2);
      const ids = editor ? [...registry.pending(editor).items.map(item => item.id), ...editor.submissions.map(item => item.id)] : [];
      if (ids.length) {
        if (fail) core.failing.add('operation');
        // A check of a reply still going waits behind its send, as on the page.
        const name = `check confirmation in ${editor.context.sourceRef.id}${fail ? ' (its read fails)' : ''}`;
        await attempt(name, () => { registry.checkPending(editor, pick(ids)).catch(error => trail.push(`(${name} ended: ${error.message})`)).finally(() => core.failing.delete('operation')); });
      }
    } else if (kind === 'more') {
      const editor = writings().find(editor => registry.pending(editor).next_cursor !== null), fail = chance(0.2);
      if (editor) {
        if (fail) core.failing.add('submissions');
        await attempt(`more replies in ${editor.context.sourceRef.id}${fail ? ' (its read fails)' : ''}`, () => registry.morePending(editor));
        core.failing.delete('submissions');
      }
    } else if (kind === 'replace') {
      // Recover this version: a saved copy from another tab holding a refused
      // reply replaces the writing in front; or its registration fails, and
      // nothing is registered under that key.
      const [p, editor] = front();
      if (p && registry.sessions.get(editor.key)?.editor === editor) {
        const copy = new Editor(editor.context, { id: core.fresh('draft'), revision: 0, generation: core.fresh('generation') });
        copy.edit({ body: 'Earlier reply' });
        const refused = copy.beginPrepare({ prepareOperationId: core.fresh('prepare'), sendOperationId: core.fresh('send'), submissionId: core.fresh('refused') });
        copy.acceptPreparation({ recorded: true, instance_id: BOOT.instance_id, operation_id: refused.prepareOperationId, kind: 'submission.prepare', status: 'rejected', error: { code: 'FORBIDDEN', message: 'Not allowed here.' } });
        const row = { id: JSON.stringify([editor.key, 'other-tab']), editorKey: editor.key, writerId: 'other-tab', scope: JSON.stringify([BOOT.instance_id, BOOT.actor]),
          active: 1, stamp: core.fresh('stamp'), snapshot: copy.snapshot() };
        rows.set(row.id, row);
        const unregister = chance(0.3);
        if (unregister) failingOwn.add(journal.id(editor.key));
        await attempt(`replace ${editor.context.sourceRef.id}${unregister ? ' (and its registration fails)' : ''}`, () => registry.adoptCandidate(editor, { id: row.id, stamp: row.stamp }, p));
        failingOwn.delete(journal.id(editor.key));
        if (registry.sessions.get(editor.key)?.editor !== editor) replaced.push(editor);
      }
    } else if (kind === 'stale') {
      // An editor no longer registered: a notice about it, and acts through it, change nothing.
      const old = pick(replaced);
      if (old) {
        assert.doesNotThrow(() => registry.changed(old), `a notice about a replaced writing: seed ${seed}`);
        await assert.rejects(registry.checkPending(old, registry.pending(old).items[0]?.id ?? old.submissions[0]?.id ?? 'none'), /not registered/, `Check confirmation through a replaced writing: seed ${seed}`);
        await assert.rejects(registry.morePending(old), /not registered/, `More through a replaced writing: seed ${seed}`);
        trail.push(`a notice, Check confirmation and More through a replaced ${old.context.sourceRef.id}`);
      }
    } else if (kind === 'load' && gate) {
      const fail = chance(0.25), opening = gate; gate = null;
      trail.push(fail ? 'the composer fails to load' : 'the composer loads');
      if (fail) opening.reject(Error('This device could not read its saved versions.')); else opening.resolve();
    }
    await check();
  }
  // Every act still waiting is answered, so nothing is left running.
  if (gate) gate.resolve();
  while (core.held.length) { core.answer('commit'); await settle(); }
  await started; await settle();
  registry.dispose();
  return trail;
}

test('after every step of a random run, the Review buttons are the registry\'s one answer, and a reply in doubt never holds the reader', async () => {
  const seen = [], tally = { leftInDoubt: 0, left: 0, held: 0 };
  // A writing whose registration failed cannot be kept by a step or a close: the page says so, and the registry's console warning is quiet here.
  const warn = console.warn; console.warn = () => {};
  try { for (let seed = 1; seed <= 60; seed++) seen.push(...await reviewRun(seed, tally)); } finally { console.warn = warn; }
  // The runs reach every kind of step, the refusals and failures among them, and leaving goes with replies in doubt and with none.
  console.log('# leaving:', JSON.stringify(tally));
  for (const kind of ['open m1', 'close', 'send from', 'submission.prepare commit', 'submission.prepare refuse', 'submission.prepare lost', 'message.send commit',
    'message.send refuse', 'message.send lost', 'a reply from the phone', 'check confirmation', 'more replies', 'replace m1', 'replace t1', 'a notice',
    'the composer loads', 'the composer fails']) assert.ok(seen.some(step => step.startsWith(kind)), `no run reached ${kind}`);
  for (const part of ['(its read fails)', '(and its registration fails)', '(refused: Return to this writing before sending.)']) assert.ok(seen.some(step => step.includes(part)), `no run reached ${part}`);
  assert.ok(tally.leftInDoubt > 100 && tally.left > 100, 'leaving goes, with replies in doubt and without, many times');
});

test('cards inside a reply stack count as read on screen, and a range breaks at a message the stack moved away', async () => {
  const { f, ranges, card } = await readingPage();
  const msgs = messages(20, 25); msgs[5].reply_to = 'm21';
  for (const m of msgs) f.views.messages.set(m.id, m);
  f.views.newest = 25; f.paintViews('messages'); await settle();
  const list = f.get('messages');
  const stack = list.children.find(c => String(c.className).includes('reply-stack'));
  assert.ok(stack, 'a stack formed');
  assert.ok(!list.children.includes(card(21)) && !list.children.includes(card(25)), 'm21 and m25 sit inside the stack');
  f.observers[0].callback([21, 24, 25].map(seq => ({ target: card(seq), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 40 }, rootBounds: { height: 600 } })));
  await settle(); await settle();
  assert.deepEqual(ranges().sort((a, b) => a[0] - b[0]), [[21, 21], [24, 25]]);
});

// The outcome's conversation (docs/conversation.md) is a topic page, and its
// replies stack under what they answer as in any topic (docs/topic-reading.md,
// "Reply stacks"). The page here is the real app on a conversation: the topic
// is of kind conversation, the conversation's view says who answers and what
// waits, and each message carries its item. The tags, "Asks you" and the About
// line are painted by outcome-conversation.mjs, whose own checks
// (ui_conversation.test.mjs) and the browser's (conversation_native.mjs) read
// their words; here each painter records the card it was given and the link it
// follows, so these checks read what the page hands them for a stacked message.
async function conversationPage(list, { waits = [], href = 'https://fixture/?topic=t1', folded = [] } = {}) {
  const painted = { tags: new Map(), asks: new Map(), about: new Map() }, renames=[];
  const f = fixture(href, { history: { state: null, replaceState(_state,_title,url) {renames.push(url);} },
    paintItemTags: (card, item, shownWaits, _reader, open) => painted.tags.set(card.dataset.id, { card, item, waits: shownWaits, open }),
    paintAsksYou: (author, item, shownWaits, reader) => painted.asks.set(item.id, (shownWaits ?? []).some(wait => wait.on === reader && wait.ask_message_id === item.id)),
    paintAbout: (card, item, _reader, open) => painted.about.set(card.dataset.id, { item, open }) });
  Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.topic.kind = 'conversation';
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  const opens = [];
  f.registry.open = async (ref, options) => {
    opens.push([ref.id, options.opener?.dataset?.id ?? null]);
    const presentation = { token: f.registry.generation, source: { instance_id: 'fixture', source_ref: ref }, editors: {} };
    f.registry.current = presentation;
    Object.assign(f.reader, { dialog: { open: true }, presentation, source: presentation.source });
    return presentation;
  };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  for (const message of list) f.views.messages.set(message.id, { topic_id: 't1', sent_ms: null, reply_to: null, unread: false, item: null, ...message });
  f.views.newest = Math.max(...list.map(message => message.seq));
  // The first page of messages is painted as the page starts, as TopicViews paints it.
  // Tests of links may need a folded destination before initialize handles
  // the address. Choose it on the actual first paint, through its chevron.
  f.views.messagesPage = () => { f.paintViews('messages'); for (const id of folded) foldDossier(f, id); };
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name === 'conversation') return { instance_id: 'fixture', conversation: { topic_id: 't1', version: 1, coordinator: { actor_id: 'agent-a' },
      new_items: list.filter(message => message.item?.state === 'new').length, unread: 0, addressed: false, waits, work: null, replaced: [], live: true } };
    if (name === 'topic_messages') return { instance_id: 'fixture', items: [...f.views.messages.values()], next_cursor: null };
    return view(name, args, options);
  };
  await f.initialize(); for (let n = 0; n < 6; n++) await settle();
  assert.equal(f.document.body.classList.contains('conversation-page'), false, 'the conversation uses the ordinary topic page');
  const stackOf = id => { const folder = entryIn(f, id)?.closest('.reply-stack'); return folder?.dataset.single === 'true' ? null : folder ?? null; };
  return { f, painted, opens, stackOf, renames };
}
// One item answered, asked back about, and replied to, beside a new item of its own:
// m1 the person's item, answered by the coordinator's m2 and asked back about in m4 (which waits on them);
// dan's m3, a reply to m2, is an item nothing has settled; the coordinator's m5 is the newest reply; m6 stands alone.
const ANSWERED = { state: 'settled', takes: [{ kind: 'answer', ref: 'm2', actor_id: 'agent-a', at_ms: TODAY, part: false }] };
const conversationMessages = () => [
  { id: 'm1', seq: 1, author_id: 'fixture-person', body: 'Where does the launch stand?', item: ANSWERED },
  { id: 'm2', seq: 2, author_id: 'agent-a', body: 'On track for Friday.', reply_to: 'm1' },
  { id: 'm3', seq: 3, author_id: 'dan', body: 'And the press kit?', reply_to: 'm2', item: { state: 'new', takes: [] } },
  { id: 'm4', seq: 4, author_id: 'agent-a', body: '@fixture-person which Friday?', reply_to: 'm1', intent: 'ask', addressees: ['fixture-person'] },
  { id: 'm5', seq: 5, author_id: 'agent-a', body: 'Noted.', reply_to: 'm2' },
  { id: 'm6', seq: 6, author_id: 'dan', body: 'A new question.', item: { state: 'new', takes: [] } },
];
const ASKED = [{ ask_message_id: 'm4', on: 'fixture-person', by: 'agent-a', since_ms: TODAY, item_id: 'm1', excerpt: 'which Friday?' }];

test('a covered dossier keeps its first sheet above every message through an edit and a cover rewrite', async () => {
  const list = conversationMessages();
  list[0].acts = { cover: { stands: 'Ready for Friday', waiting: [], payload: null, owner: 'fixture-person' }, cover_revision: 1 };
  const { f, stackOf, opens } = await conversationPage(list);
  const parts = () => stackOf('m1').children;
  const checkParts = stands => {
    const [cover, head, toggle, tools, replies] = parts();
    assert.equal(head.dataset.id, 'm1');
    assert.equal(cover.className, 'dossier-cover');
    assert.equal(cover.children[0].children[0].textContent, stands);
    assert.equal(toggle.className, 'stack-toggle');
    assert.equal(tools.className, 'stack-tools');
    assert.deepEqual(tools.children.map(button => button.dataset.tool), ['reply', 'aside', 'menu']);
    assert.equal(replies.className, 'stack-replies');
    assert.equal(stackOf('m1').dataset.covered, 'true');
  };
  checkParts('Ready for Friday');
  const original = parts()[0];
  f.views.messages.set('m1', { ...f.views.messages.get('m1'), body: 'The launch now stands at Saturday.', revision: 2 });
  f.paintViews('messages'); await settle();
  checkParts('Ready for Friday');
  assert.equal(parts()[0], original, 'an edit keeps the existing cover sheet');
  const root = f.views.messages.get('m1');
  f.views.messages.set('m1', { ...root, acts: { ...root.acts, cover: { ...root.acts.cover, stands: 'Ready for Saturday' }, cover_revision: 2 } });
  f.paintViews('messages'); await settle();
  checkParts('Ready for Saturday');
  f.runObservation('replyInCard = async id => { globalThis.latestReply907 = id; }');
  parts()[3].children[0].onclick(); await settle();
  const latest = list.find(item => item.id === 'm5'); // newest nested reply in m1's dossier
  assert.equal(f.runObservation('latestReply907'), latest.id, 'Reply opens the latest message in this dossier');
});

test('on the conversation page replies stack under the message they answer, as in any topic, and its own marks reach every stacked message', async () => {
  const { f, painted, stackOf } = await conversationPage(conversationMessages(), { waits: ASKED, folded: ['m1'] });
  assert.ok(stackOf('m2'), 'a reply on the conversation page is in a reply stack');
  const stack = stackOf('m1');
  assert.deepEqual(['m2', 'm3', 'm4', 'm5'].map(id => stackOf(id) === stack), [true, true, true, true], 'every reply up the chain, in the one stack of the message they answer');
  assert.deepEqual(listed(f).map(child => child.dataset.id ?? 'stack'), ['m6', 'stack'], 'the stack sits where its newest message would, below the newer item on its own');
  // The title bar's glyphs (item 473) sit between the chevron and the replies.
  const [head, toggle, tools, replies] = stack.children;
  assert.equal(tools.className, 'stack-tools');
  assert.deepEqual([head.dataset.id, replies.children.map(child => child.dataset.id ?? child.className)], ['m1', ['m2', 'm3', 'm4', 'm5']],
    'the message on top, its replies under it oldest first, as a chat reads, with folded replies kept in their positions');
  // Folded, a stack shows its newest reply and what the person must not miss there: an item nothing has settled, and an ask that waits on them.
  assert.deepEqual(['m5', 'm4', 'm3', 'm2'].map(id => entryIn(f, id).hidden), [false, true, true, true],
    'read asks and unsettled items do not override latest plus unread');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.className, 'stack-toggle');
  assert.equal(painted.tags.size, 0, 'the retired item-tag painter is never called');
  assert.ok(['m1','m2','m3','m4','m5','m6'].every(id => entryIn(f,id).dataset.item === undefined), 'no Only new markers');
  assert.deepEqual([painted.asks.get('m4'), painted.asks.get('m2')], [true, false], '"Asks you" on the stacked ask, and on no other');
});

test('on the conversation page a link to a message folded in a stack opens its stack and lands on it, from a tag or from the address', async () => {
  const { f, painted, opens, stackOf } = await conversationPage(conversationMessages(), { waits: ASKED, folded: ['m1'] });
  const scrolled = [];
  for (const id of ['m2', 'm4']) entryIn(f, id).scrollIntoView = () => scrolled.push(id);
  assert.equal(entryIn(f, 'm2').hidden, true, 'the reply the item\'s Answered tag names is folded away');
  // "agent-a's reply" on m1's Answered tag.
  painted.about.get('m1').open('message', 'm2'); await settle();
  assert.equal(stackOf('m2').dataset.fold, 'open', 'its stack opens');
  assert.deepEqual([entryIn(f, 'm2').hidden, scrolled, opens.at(-1)], [false, ['m2'], ['m2', 'm2']],
    'the reply shows, is brought into view, and opens in the Reader from its own card');
  // The ask in m1's "Waiting on you" tag, kept in view: it is brought into view and opened the same way.
  painted.about.get('m1').open('message', 'm4'); await settle();
  assert.deepEqual([scrolled, opens.at(-1)], [['m2', 'm4'], ['m4', 'm4']]);
  // A message that is not on the page opens in the Reader alone, from where the person is.
  painted.about.get('m1').open('message', 'elsewhere'); await settle();
  assert.equal(opens.at(-1)[0], 'elsewhere');
  // A message's link (docs/links.md) to a folded reply in the conversation.
  const linked = await conversationPage(conversationMessages(), { waits: ASKED, href: 'https://fixture/?topic=t1&message=m2', folded: ['m1'] });
  assert.deepEqual([linked.stackOf('m2').dataset.fold, entryIn(linked.f, 'm2').hidden, linked.opens.at(-1)], ['open', false, ['m2', 'm2']],
    'the address opens the stack and the Reader on the message, from its card');
});

test('on the conversation page More messages brings a stack\'s first message: the replies gather under it, and its tags and what it keeps in view follow', async () => {
  const all = conversationMessages(), first = all[0];
  const { f, painted, stackOf } = await conversationPage(all.slice(1), { waits: ASKED, folded: ['m2'] });
  // Its parent not loaded, the ask heads nothing and stands alone; m2 heads its own replies.
  assert.deepEqual([stackOf('m4'), stackOf('m3') === stackOf('m2'), entryIn(f, 'm2').closest('.reply-stack')?.children[0].dataset.id], [null, true, 'm2']);
  f.views.messages.set(first.id, { topic_id: 't1', sent_ms: null, reply_to: null, unread: false, ...first });
  f.paintViews('messages'); await settle();
  const stack = stackOf('m1');
  assert.deepEqual(['m2', 'm3', 'm4', 'm5'].map(id => stackOf(id) === stack), [true, true, true, true], 'the older message heads the one stack');
  // This legacy response omits Core's stack_position. Until m1 is loaded,
  // it names m2 and m4 as separate dossiers; m1 therefore starts a new view.
  foldDossier(f, 'm1');
  assert.deepEqual(['m5', 'm4', 'm3', 'm2'].map(id => entryIn(f, id).hidden), [false, true, true, true], 'read asks and New items do not add extra messages');
  assert.equal(entryIn(f, 'm1').dataset.item, undefined, 'More paints no retired Only new marker');
  assert.equal(painted.about.get('m1').item.id, 'm1', 'More keeps ordinary source-link context');

  // A current Core response identifies the canonical dossier even before
  // its first message is loaded. Its explicit fold must survive reheading.
  const positioned = all.map(message => ({ ...message, stack_position: {
    root_id: message.id === 'm6' ? 'm6' : 'm1', through: null, below: false, aside_revision: 0,
    name: null, name_revision: 0, at: { acts: 1, messages: 0 },
  } }));
  const current = await conversationPage(positioned.slice(1), { waits: ASKED, folded: ['m2'] });
  assert.equal(current.stackOf('m4') === current.stackOf('m2'), true, 'Core identifies the unloaded first message for every branch');
  current.f.views.messages.set('m1', { topic_id: 't1', sent_ms: null, reply_to: null, unread: false, ...positioned[0] });
  current.f.paintViews('messages'); await settle();
  assert.equal(current.stackOf('m1').dataset.fold, 'folded', 'the canonical dossier keeps its chosen fold when its first message loads');
  assert.deepEqual(['m2', 'm3', 'm4', 'm5'].map(id => current.stackOf(id) === current.stackOf('m1')), [true, true, true, true]);
  assert.deepEqual(['m5', 'm4', 'm3', 'm2'].map(id => entryIn(current.f, id).hidden), [false, true, true, true]);
  assert.equal(current.painted.about.get('m1').item.id, 'm1');
});

test('on the conversation page a reply folded in its stack is never reported read, as in any topic', async () => {
  const { f } = await conversationPage(conversationMessages(), { waits: ASKED, folded: ['m1'] });
  const ranges = () => f.calls.filter(c => c.kind === 'topic.read_through').map(c => [c.envelope.args.from_seq, c.envelope.args.seq]);
  // On screen, as a browser sees it: every entry shown, and none folded away.
  const [observer] = f.observers;
  observer.callback(observer.targets.map(target => {
    const shown = !target.hidden;
    return { target, isIntersecting: shown, intersectionRatio: shown ? 1 : 0, intersectionRect: { height: shown ? 40 : 0 }, rootBounds: { height: 600 } };
  }));
  for (const handler of f.events.filter(e => e[0] === 'window-handler' && e[1] === 'focus')) handler[2]();
  await settle(); await settle();
  assert.equal(entryIn(f, 'm2').hidden, true, 'm2 is folded in its stack');
  assert.deepEqual(ranges(), [[5, 6]], 'the messages on screen are read, the folded reply is not, and the person\'s own is never reported');
});


// This suite's old sheet double only toggled `open`. 1026 waits for the
// browser's queued close event; preserve its installed handler and once waiter.
function closeSheet673(sheet) {
  const installed = sheet.handlers.close, add = sheet.addEventListener.bind(sheet), waiters = [];
  sheet.addEventListener = (type, fn, options) => {
    if (type === 'close' && options?.once) waiters.push(fn); else add(type, fn, options);
  };
  sheet.close = function () {
    this.open = false;
    queueMicrotask(() => { installed?.(); for (const fn of waiters.splice(0)) fn(); });
  };
}

for (const ending of ['confirmed', 'refused', 'unknown', 'new writing', 'new opening', 'closed']) test(`item 673: inline send closes only its confirmed unchanged opening: ${ending}`, async () => {
  const f = fixture('https://fixture/?topic=t1', { window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => 'none' }) } });
  const answer=defer(), sheet=f.get('new-message-sheet');
  f.inline.popped=true;f.inline.opening=Symbol();sheet.open=true;closeSheet673(sheet);
  f.inline.callbacks.send=()=>answer.promise;
  f.editor.edit=patch=>Object.assign(f.editor.draft,patch);
  const sending=f.inline.send();
  if(ending==='new writing')f.editor.localVersion=(f.editor.localVersion??0)+1;
  if(ending==='new opening')f.inline.opening=Symbol();
  if(ending==='closed')sheet.close();
  answer.resolve({status:['refused','unknown'].includes(ending)?ending:'confirmed'});
  await sending;
  assert.equal(sheet.open,!['confirmed','closed'].includes(ending),ending);
});

// Independent reviewer reproducer: real Editor and Uploads; only transport and DOM are fixtures.
for (const newer of ['text', 'picker', 'capturing image', 'image needing a choice', 'memory-only image', 'image recovery error']) test(`review 673: late confirmation keeps newer ${newer} open`, async () => {
  const { Uploads } = await import('../web/uploads.mjs');
  const f=fixture('https://fixture/?topic=t1',{window:{addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=> 'none'})}});
  const editor=new Editor({...f.editor.context,instanceId:'fixture',actor:'fixture-person'}, {id:'draft',generation:'g',revision:1,body:'First message.'});
  f.p.editors.reply=editor;
  const answer=defer(), capture=defer(), sheet=f.get('new-message-sheet');
  f.inline.popped=true; f.inline.opening=Symbol(); sheet.open=true; closeSheet673(sheet);
  f.inline.callbacks.send=e=>{e.beginPrepare({prepareOperationId:'prepare',sendOperationId:'send',submissionId:'submission'});return answer.promise;};
  const sending=f.inline.send(), version=editor.localVersion;
  let choosing;
  if(newer==='text')editor.edit({body:'Second message.'});
  else {
    const authority={authority_id:'a',authority_epoch:'e'};
    const session={editor,api:{},authority,snapshot:()=>editor.snapshot(),persist:async()=>{},journal:{writerId:'review',capture:async(_key,_snapshot,_bytes,entry)=>{await capture.promise;if(newer==='memory-only image')throw Error('Fixture device capture refused');entry.bytes_state='durable';entry.bytes_ref='review-bytes';}}};
    const registry={disposed:false,sessions:new Map([[editor.key,session]]),runtime:{current:authority},isCurrent:()=>true,changed(){},bootstrap:{limits:{media_name_utf8_bytes:255,image_bytes:1000000,media_file_bytes:1000000,attachment_count:10,attachment_bytes:10000000}}};
    const uploads=new Uploads(session,registry);
    const token=uploads.reserve(f.p);
    const file=Object.assign(new Blob(['phone photo'],{type:'image/heic'}),{name:'IMG_3307.heic',lastModified:0});
    if(newer==='picker'){
      answer.resolve({status:'confirmed'});await sending;const stayed=sheet.open;uploads.cancel(token);assert.equal(stayed,true,'an older Send must not dismiss the reserved successor picker');return;
    }
    choosing=uploads.choose(token,file);
    if(['image needing a choice','memory-only image','image recovery error'].includes(newer)){capture.resolve();await choosing;}
    if(newer==='memory-only image')assert.equal(uploads.current()[0].bytes_state,'memory-only','actual capture refusal retains the memory-only selection');
    if(newer==='image recovery error')editor.imageStorageError='The image change could not be kept';
    assert.equal(uploads.current().length,1,'a real image selection belongs to the successor writing');
    assert.equal(editor.localVersion,version,'image selection does not advance the text version');
    console.log(JSON.stringify({newer,version,imageVersion:editor.uploadState.revision,bytes:uploads.current()[0].bytes_state}));
  }
  answer.resolve({status:'confirmed'});await sending;
  const stayed=sheet.open;
  capture.resolve();if(choosing)await choosing;
  assert.equal(stayed,true,`an older Send must not dismiss newer ${newer}`);
});

async function starred655() {
  const f = fixture();
  await f.initialize();
  Object.assign(f.reader, { dialog: { open: false }, show() { this.dialog.open = true; }, paintPending() {}, paintRecipients() {} });
  f.registry.neighbors = async () => null;
  f.registry.recoveryCandidates = async () => ({ items: [], nextCursor: null });
  const source = { instance_id: 'fixture', source_ref: { kind: 'message', id: 'old-root' }, topic_id: 't1', seq: 1, body: 'The unnamed first line.\nMore words.', attachments: [] };
  const p = { token: 1, surface: 'reader', mode: 'reply', source, editors: { reply: { ...f.editor, offered: true } } };
  f.registry.current = p;
  const feed = { dossierName: () => null, arrange() {}, actsOf: () => ({}), asideOffer: () => null };
  f.inject({ ...f.owners(), api: f.api, bootstrap: f.bootstrap, reader: f.reader, topic: f.topic, views: f.views, stackFeed: feed });
  let position = { root_id: 'old-root', name: null, has_other_messages: true };
  const read = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name === 'stack_positions') return { instance_id: 'fixture', topic_id: 't1', items: [{ message_id: args.message_ids[0], stack_position: position }] };
    if (name === 'topic_messages' && args.message_ids) return { instance_id: 'fixture', items: [{ id: position.root_id, body: 'The unnamed first line.', attachments: [] }] };
    return read(name, args, options);
  };
  return { f, p, source, feed, setPosition: value => { position = value; } };
}

test('item 655 B1 unloaded unnamed roots and replies use the first line while singletons keep the topic fallback', async () => {
  const { f, p, source, setPosition } = await starred655();
  await f.present(p);
  assert.equal(f.readerDossierName(source), 'The unnamed first line.', 'an unloaded root with replies has the dossier first line');
  setPosition({ root_id: 'old-root', has_other_messages: false, name: null });
  await f.present(p);
  assert.equal(f.readerDossierName(source), null, 'a singleton does not acquire a dossier title');
  source.source_ref.id = 'old-reply';
  setPosition({ root_id: 'old-root', has_other_messages: true, name: null });
  await f.present(p);
  assert.equal(f.readerDossierName(source), 'The unnamed first line.', 'a reply uses its root, not its own words');
});

test('item 655 B2 freshness follows unloaded rename clear join split and loaded singleton without a stale cached name', async () => {
  const { f, p, source, setPosition } = await starred655();
  setPosition({ root_id: 'old-root', has_other_messages: true, name: { text: 'Old name' } });
  await f.present(p);
  assert.equal(f.readerDossierName(source), 'Old name');
  f.enableFreshness({});
  for (const [position, expected] of [
    [{ root_id: 'old-root', has_other_messages: true, name: { text: 'Renamed elsewhere' } }, 'Renamed elsewhere'],
    [{ root_id: 'old-root', has_other_messages: true, name: null }, 'The unnamed first line.'],
    [{ root_id: 'joined-root', has_other_messages: true, name: { text: 'Joined elsewhere' } }, 'Joined elsewhere'],
    [{ root_id: 'old-root', has_other_messages: true, name: null }, 'The unnamed first line.'],
  ]) {
    setPosition(position);
    await f.fresh.options.refresh('acts', 2, (name, args) => f.api.view(name, args), () => true);
    assert.equal(f.readerDossierName(source), expected, 'freshness must refresh the unloaded source title too');
  }
  p.dossierName = 'Old cached name';
  f.views.messages.set(source.source_ref.id, { id: source.source_ref.id });
  assert.equal(f.readerDossierName(source), null, 'a loaded singleton never falls back to a cached old dossier name');
});

test('item 932 remote question state invalidates acts without painting an unloaded dossier', async () => {
  const { f, p, source } = await starred655();
  await f.present(p);
  f.enableFreshness({});
  const invalidations = [];
  f.fresh.invalidate = (...args) => invalidations.push(args);
  const question = { state: 'resolved', waiting_on: [], may_resolve: false, by: 'asker', at_ms: 42, superseded_by: null };
  await assert.doesNotReject(f.fresh.options.refresh('question:' + source.source_ref.id, 1,
    async name => { assert.equal(name, 'source'); return { ...source, question }; }, () => true));
  assert.equal(source.question.state, 'resolved', 'the open Reader learns its exact source');
  assert.deepEqual(invalidations, [['acts', 0, true]], 'the view redraw follows ordinary freshness instead of a direct paint');
});

test('item 932 topic freshness updates only its open Reader question without reopening it', async () => {
  const { f, p, source } = await starred655();
  source.question = { state: 'waiting', waiting_on: ['answerer'], may_resolve: true, archived: false };
  await f.present(p);
  f.enableFreshness({});
  const reads = [];
  f.views.refresh = async () => true;
  await f.fresh.options.refresh('topic', 2, async (name, ref) => {
    reads.push([name, ref.id]);
    return { ...source, question: { state: 'answered', waiting_on: [], may_resolve: false, archived: true } };
  }, () => true);
  assert.deepEqual(reads, [['source', source.source_ref.id]]);
  assert.equal(source.question.archived, true);
  assert.equal(f.reader.dialog.open, true);
  assert.equal(f.reader.presentation.source, source);
});

for (const failedRead of ['stack_positions', 'topic_messages']) test(`item 655 B3 ${failedRead} lookup failure opens the exact source and shows a notice`, async () => {
  const { f, p, source } = await starred655();
  source.source_ref.id = 'old-reply';
  const view = f.api.view;
  f.api.view = async (name, ...args) => { if (name === failedRead) throw Error('Transient lookup refusal'); return view(name, ...args); };
  await assert.doesNotReject(f.present(p), 'metadata failure must not reject presentation');
  assert.equal(f.reader.dialog.open, true, 'metadata failure must not hide the source');
  assert.equal(f.reader.presentation.source, source);
  assert.match(f.get('reader-notice').textContent, /Dossier name could not be read/);
});




test('item 655 B1 a loaded root whose replies are still outside the page agrees with its scoped title', async () => {
  const { f, p, source, setPosition } = await starred655();
  const position = { root_id: source.source_ref.id, name_revision: 0, at: { acts: 3 }, has_other_messages: true, name: null };
  setPosition(position);
  f.views.messages.set(source.source_ref.id, { id: source.source_ref.id, stack_position: position });
  await f.present(p);
  assert.equal(f.readerDossierName(source), 'The unnamed first line.');
  f.views.messages.get(source.source_ref.id).stack_position = { ...position, name_revision: 1, at: { acts: 4 } };
  assert.equal(f.readerDossierName(source), null, 'a later loaded position refuses stale cached metadata');
});

test('item 655 B2 an older dossier lookup cannot reverse a newer freshness answer', async () => {
  const { f, p, source, setPosition } = await starred655();
  setPosition({ root_id: source.source_ref.id, name: { text: 'Latest confirmed name' } });
  const entered = defer(), held = defer(), view = f.api.view;
  let first = true;
  f.api.view = async (name, ...args) => {
    if (name === 'stack_positions' && first) { first = false; entered.resolve(); return held.promise; }
    return view(name, ...args);
  };
  const old = f.present(p);
  await entered.promise;
  await f.present(p);
  held.resolve({ instance_id: 'fixture', topic_id: 't1', items: [{ message_id: source.source_ref.id,
    stack_position: { root_id: source.source_ref.id, name: { text: 'Stale old name' } } }] });
  await old;
  assert.equal(f.readerDossierName(source), 'Latest confirmed name', 'the later lookup wins even when the older one finishes last');
});

test('item 655 B3 a metadata failure from an abandoned opening cannot paint over the newer Reader', async () => {
  const { f, p } = await starred655();
  const entered = defer(), held = defer(), view = f.api.view;
  let first = true;
  f.api.view = async (name, ...args) => {
    if (name === 'stack_positions' && first) { first = false; entered.resolve(); return held.promise; }
    return view(name, ...args);
  };
  const old = f.present(p).catch(error => error);
  await entered.promise;
  const next = { ...p, token: 2, source: { ...p.source, source_ref: { kind: 'message', id: 'newer-source' } } };
  f.registry.current = next;
  await f.present(next);
  held.reject(Error('Abandoned read failed'));
  await old;
  assert.equal(f.reader.presentation, next);
  assert.doesNotMatch(f.get('reader-notice').textContent, /Dossier name could not be read/);
});

for (const act of ['agent menu', 'image list', 'picker owner', 'new error', 'same error again']) test(`item 673: late confirmation preserves successor presentation ownership: ${act}`, async () => {
  const f=fixture('https://fixture/?topic=t1',{window:{addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=> 'none'})}});
  const answer=defer(),sheet=f.get('new-message-sheet');
  f.inline.popped=true;f.inline.opening=Symbol();sheet.open=true;closeSheet673(sheet);
  f.inline.callbacks.send=()=>answer.promise;
  f.editor.edit=patch=>Object.assign(f.editor.draft,patch);
  if(act==='same error again')f.inline.notice('The newer image could not be read.');
  const sending=f.inline.send();
  if(act==='agent menu')f.inline.bar.panel='who';
  if(act==='image list')f.inline.images={open:true};
  if(act==='picker owner')f.inline.imagePicker={token:{}};
  if(['new error','same error again'].includes(act))f.inline.notice('The newer image could not be read.');
  answer.resolve({status:'confirmed'});await sending;
  assert.equal(sheet.open,true,`older confirmation retains ${act}`);
});

for (const outcome of ['confirmed', 'refused', 'recovery error']) test(`item 673 final observer: delayed startup and actual send continuation ${outcome}`, async () => {
  const { PENCIL_OBSERVE } = await import('./pencil-states.mjs');
  let notify, disconnected = false;
  const f = fixture('https://fixture/?topic=t1', { MutationObserver: class {
    constructor(fn) { notify = fn; } observe() {} disconnect() { disconnected = true; }
  } });
  // Execute the injected observer in the app's own lexical scope, while begin
  // still waits on initialization. The actual begin and send bodies run.
  const owner = f.inline, initialization = defer(), answer = defer();
  f.runObservation('globalThis.retainedInline=inline; inline=undefined;');
  f.runObservation(PENCIL_OBSERVE);
  assert.equal(f.runObservation('window.pencil.inline'), undefined);
  const original = owner.send;
  const started = f.begin(async () => {
    await initialization.promise;
    f.runObservation('inline=globalThis.retainedInline');
    f.document.body.dataset.ready = 'true'; notify();
  });
  await Promise.resolve(); assert.equal(owner.send, original, 'startup scheduling remains delayed');
  initialization.resolve(); assert.equal(await started, true); assert.equal(disconnected, true);
  assert.notEqual(owner.send, original, 'wrapper installs after initialization');
  owner.callbacks.send = () => answer.promise;
  f.editor.edit = patch => Object.assign(f.editor.draft, patch);
  owner.popped = true; owner.opening = Symbol(); const sheet = f.get('new-message-sheet');
  sheet.open = true; closeSheet673(sheet);
  const sending = owner.send();
  assert.equal(f.runObservation('window.pencilSendSettled'), false);
  assert.equal(sheet.open, true);
  if (outcome === 'recovery error') answer.reject(Error('Real pending send recovery failed'));
  else answer.resolve({ status: outcome });
  await sending; await Promise.resolve();
  assert.equal(f.runObservation('window.pencilSendSettled'), true, 'only the actual send continuation settles observation');
  assert.equal(f.runObservation('window.pencil.calls.length'), 1);
  assert.equal(sheet.open, outcome !== 'confirmed');
  if (outcome === 'recovery error') assert.match(f.get('inline-notice').textContent, /recovery failed/);
});


test('835 legacy conversation links resolve to the ordinary topic with its actual title and unchanged writing destination',async()=>{
  const {f,renames}=await conversationPage(conversationMessages(),{waits:ASKED,href:'https://fixture/?conversation=w1'});
  assert.ok(renames.some(url=>url.startsWith('?topic=t1')), 'legacy address replaced with real topic identity');
  assert.equal(f.owners().registry.inline.topic.id,'t1');
  assert.equal(f.owners().registry.inline.editors.reply.context.topicId,'t1');
  assert.equal(f.owners().registry.inline.editors.reply.draft.body,'kept');
  assert.equal(f.get('settings-open').hidden,true,'Core still refuses conversation settings');
  assert.equal(f.get('topic-title').textContent,'Fixture');
  assert.equal(f.get('conversation-show').children.length,0);
  assert.equal(f.get('conversation-row').children.length,0);
});

test('847, 852 and 879 outcome home keeps Team, Notebook and pencil without a right rail; topic context remains',async()=>{
  const thumbnails=[], live=stream(); let denied=false;
  const f=fixture('https://fixture/?workspace=w1',{paintThumb:(_host,_key,load)=>thumbnails.push(load), listen:(target,type,fn)=>target.addEventListener(type,fn), KeyTree:class {constructor(){} refresh(){} }}), original=f.api.view;
  f.topic.list_position=0;
  const pencil=f.get('new-topic-pencil-fixture');
  f.get('new-message').querySelector=selector=>selector==='svg'?pencil:null;
  f.api.media=async(instance,attachment,ref)=>{assert.equal(instance,'fixture');assert.equal(attachment.id,'image835');assert.equal(ref.id,'retained835');return {blob:'fixture image bytes'};};
  f.api.view=async(name,args,options)=>{
    if(['workspace','pipeline','conversation','stars','topic_messages','topic_images','topic_tools'].includes(name))f.calls.push({name,args});
    if(name==='workspace'){if(denied)throw Object.assign(Error('No access'),{code:'FORBIDDEN'});return {instance_id:'fixture',workspace:{id:'w1',title:'Launch',purpose:'Ship',owner_id:'owner'}};}
    if(name==='topic_tools')return {instance_id:'fixture',linked:[]};
    if(name==='pipeline')return {instance_id:'fixture',pipeline:null,items:[],next_cursor:null};
    if(name==='conversation')return {instance_id:'fixture',conversation:{topic_id:'t1',version:1}};
    if(name==='stars')return {instance_id:'fixture',items:[{workspace_id:'w1',topic_id:'t1',message_id:'retained835',author_id:'fixture-person',excerpt:'Keep this reference',star_revision:1}]};
    if(name==='topic_messages')return {instance_id:'fixture',items:[{id:'retained835',topic_id:'t1',author_id:'fixture-person',body:'[Preview](https://example.test/preview/835) [Change](https://github.com/example/project/pull/835)',item:{state:'new',takes:[]}}],next_cursor:null};
    if(name==='topic_images')return {instance_id:'fixture',items:[{topic_id:'t1',author_id:'fixture-person',source_ref:{kind:'message',id:'retained835'},attachment:{id:'image835',name:'Plan.png'}}],next_cursor:null};
    return original(name,args,options);
  };
  f.inject({api:f.api,bootstrap:f.bootstrap}); f.useLive(live);
  await f.initialize();await drain();
  assertOutcomeTeamHeader(f);
  const ids=f.get('outcome-page').children.map(node=>node.id);
  assert.deepEqual(ids,['outcomes-status','retry-workspaces','team-invite','outcome-references','page-here','topic-navigation','outcome-tools','outcome-standing','outcome-purpose','target-panel','pipeline-line','also-waiting','loop-panel','problems-panel']);
  assert.equal(f.get('new-topic').children[0]?.id,pencil.id);
  assert.notEqual(f.get('new-topic').children[0],pencil);
  assert.equal(f.get('new-topic').getAttribute('aria-label'),'New topic');
  const handles=f.runObservation('shell.handles');
  assert.equal(handles?.workspaceId,'w1','outcome initializes the same shell as topics');
  assert.equal(handles.topic,null);
  assert.equal(handles.api,f.api);
  assert.equal(Boolean(f.owners().topicRail),false,'the outcome page does not create an independent topic-list owner');
  assert.equal(typeof handles.outcomeTopics,'function','the outline publishes its current rows to the middle');
  assert.equal(typeof handles.centerPane?.focus,'function');
  assert.equal(typeof handles.centerPane?.key,'function');
  assert.equal(typeof handles.notebookCreate,'function');
  assert.equal(f.calls.some(call=>call.name==='stars'),false,'closed references read no stars');
  const count=name=>f.calls.filter(call=>call.name===name).length, notes=count('memory_items'),tools=count('tools');
  const rail=f.runObservation("(() => {const rail=new ThingsRail({host:document.getElementById('things'),backdrop:document.getElementById('things-backdrop'),doc:document,win:window});shell.follow(rail);return rail;})()");
  rail.begin(true,{kind:'workspace',id:'w1'});
  rail.ready(handles);
  assert.equal(rail.handles,null,'879 outcome home starts no right-rail owner');
  assert.equal(rail.host.hidden,true);
  rail.open(); await rail.reload(); await drain();
  assert.equal(f.calls.some(call=>call.name==='stars'),false);
  assert.equal(count('memory_items'),notes);assert.equal(count('tools'),tools);
  denied=true; live.emit({kind:'commit',seq:20}); await drain();
  assert.equal(handles.readable(),false);
  assert.ok([...rail.sections.values()].every(part=>part.details.hidden),'permission loss leaves no retained outcome context');
  denied=false; live.emit({kind:'commit',seq:21}); await drain(); await rail.reload();
  assert.equal(handles.readable(),true);
  assert.equal(rail.host.hidden,true,'recovery does not restore a removed home rail');
  // Retain the existing bounded context assertions on a real topic route,
  // where 788 now fixes it to this topic, with no scope-switch surface.
  f.runObservation("location.href='https://fixture/?topic=t1'");
  await f.initialize(); await drain();
  const topicHandles=f.runObservation('shell.handles');
  assert.equal(rail.handles,topicHandles);assert.equal(topicHandles.route.kind,'topic');
  assert.equal(typeof rail.choose,'undefined','788 retires the scope-choice handler');
  const toolsBeforeRail = count('tools');
  rail.open(); await rail.reload();await drain();
  assert.equal(f.calls.some(call=>call.name==='stars'),false,'788 removes the rail Stars read');
  assert.ok(count('memory_items')>notes,'the right rail includes its existing Notebook');
  assert.equal(count('tools'),toolsBeforeRail,'opening the topic rail does not read outcome tools');
  assert.ok(f.calls.some(call=>call.name==='topic_tools'&&call.args.topic_id==='t1'),'the rail reads this topic’s tools');
  const walk=node=>[node,...(node.children??[]).flatMap(walk)], nodes=walk(f.get('things'));
  const shown=nodes.filter(node=>node.className==='things-sec'&&!node.hidden).map(node=>node.dataset.key);
  assert.deepEqual(shown,['prs','images','previews']);
  assert.ok(nodes.some(node=>node.href==='https://example.test/preview/835'));
  assert.ok(nodes.some(node=>node.href==='https://github.com/example/project/pull/835'));
  assert.equal(nodes.filter(node=>node.href==='?topic=t1&message=retained835').length,1,'the image keeps its message destination; retired Starred and outcome Waiting do not appear');
  assert.equal(thumbnails.length,1);
  assert.equal(await thumbnails[0](),'fixture image bytes','right-rail image uses the current page media reader');
  assert.equal(rail.sections.get('images').details.hidden,false,'the topic rail still reads current context');
});

// 860: initialized page's actual Reader handler, Reactions and card callback.
// The API is a controlled peer; this does not claim a native click.
const decisionReactions860 = more => ({ version: 5, thumbs: [], answers: [], thumb_revision: 1, answer_revision: 7, ...more });
async function decisionPage860({ loaded = true } = {}) {
  const item = { id: 'decision860', seq: 1, author_id: 'agent-a', body: 'May I proceed?', intent: 'ask', go_ahead: true,
    addressees: ['fixture-person'], reactions: decisionReactions860() };
  const { f } = await conversationPage([item]);
  const presentation = { source: { ...item, author: item.author_id, source_ref: { kind: 'message', id: item.id } }, editors: { reply: f.editor }, mode: 'reply' };
  f.registry.current = presentation; Object.assign(f.reader, { dialog: { open: true }, presentation });
  let closes = 0; f.registry.close = async () => { closes++; };
  // These reaction checks observe close requests; item889 below executes
  // the real Reader/registry/device-save chain separately.
  f.reader.close = () => f.registry.close(f.reader.presentation);
  if (!loaded) f.views.messages.delete(item.id);
  let current = decisionReactions860(), command = null;
  const commands = [], original = f.api.view;
  f.api.view = async (name, args, options) => name === 'reactions'
    ? { instance_id: 'fixture', message_id: args.message_id, go_ahead: true, reactions: current } : original(name, args, options);
  f.api.command = async envelope => {
    commands.push(envelope); if (command) return command(envelope);
    current = decisionReactions860({ version: current.version + 1, answer_revision: current.answer_revision + 1,
      answers: [{ actor_id: 'fixture-person', answer: envelope.args.answer }] });
    return { status: 'committed', result: { message_id: envelope.target.message_id } };
  };
  const paint = () => f.runObservation('paintReaderThumb$()'); paint();
  return { f, item, presentation, commands, paint, get closes() { return closes; },
    answer: choice => f.get('reader-reactions').querySelector(`[data-react="${choice}"]`),
    setCommand: value => { command = value; }, setCurrent: value => { current = value; } };
}
const cardDecision860 = (f, choice) => entryIn(f, 'decision860')?.querySelector(`[data-react="${choice}"]`);

test('860/889 actual Reader answer uses the current revision, paints the card and requests close without losing writing', async () => {
  const d = await decisionPage860(), { f } = d;
  assert.ok(d.answer('yes'), 'the actual Reader exposes Go ahead'); const stale = d.answer('yes');
  f.views.messages.set(d.item.id, { ...f.views.messages.get(d.item.id), reactions: decisionReactions860({ answer_revision: 19 }) });
  const held = defer(); d.setCommand(async () => held.promise); const sent = stale.onclick();
  assert.equal(d.commands.length, 1); assert.equal(d.commands[0].kind, 'message.answer');
  assert.equal(d.commands[0].target.message_id, 'decision860'); assert.equal(d.commands[0].expected.answer_revision, 19, 'latest revision at press');
  assert.deepEqual({ ...d.commands[0].expected.authority }, { authority_id: 'a1', authority_epoch: 'e1' });
  assert.equal(d.commands[0].args.answer, 'yes');
  assert.equal(d.answer('yes').disabled, true); assert.equal(d.answer('no').disabled, true);
  assert.equal(d.answer('yes'), stale, 'pending repaint keeps the same control');
  await stale.onclick(); assert.equal(d.commands.length, 1, 'pending duplicate cannot send');
  f.editor.draft.body = 'newer writing while the decision waits';
  d.setCurrent(decisionReactions860({ version: 6, answer_revision: 20, answers: [{ actor_id: 'fixture-person', answer: 'yes' }] }));
  held.resolve({ status: 'committed', result: { message_id: 'decision860' } }); await sent; await drain();
  assert.equal(d.answer('yes').getAttribute('aria-pressed'), 'true'); assert.equal(d.answer('yes').disabled, false);
  assert.equal(d.answer('yes'), stale, 'learned-result repaint keeps the same control');
  assert.equal(cardDecision860(f, 'yes').classList.contains('mine'), true, 'Reader result paints the actual card');
  assert.equal(f.editor.draft.body, 'newer writing while the decision waits');
  assert.equal(f.registry.current, d.presentation); assert.equal(d.closes, 1);
});

test('860 the actual card answer callback paints the open Reader and the card', async () => {
  const d = await decisionPage860(), { f } = d;
  await f.runObservation("menu.answer(views.messages.get('decision860'), 'no')"); await drain();
  assert.ok(d.answer('no'), 'the open Reader offers the same decisions');
  assert.equal(d.commands.length, 1); assert.equal(d.commands[0].args.answer, 'no');
  assert.equal(d.answer('no').getAttribute('aria-pressed'), 'true');
  assert.equal(cardDecision860(f, 'no').classList.contains('mine'), true);
});

test('860 source-only Reader preserves refused or lost answers in words and learns a committed decision', async () => {
  for (const outcome of ['refused', 'lost', 'committed']) {
    const d = await decisionPage860({ loaded: false }), { f } = d;
    assert.ok(d.answer('no'), 'source-only Reader has a decision button');
    d.setCommand(async () => {
      if (outcome === 'lost') throw new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
      if (outcome === 'refused') return { status: 'rejected', error: { code: 'FORBIDDEN', message: 'This question is no longer yours' } };
      d.setCurrent(decisionReactions860({ version: 6, answers: [{ actor_id: 'fixture-person', answer: 'no' }] }));
      return { status: 'committed', result: { message_id: 'decision860' } };
    });
    await d.answer('no').onclick(); await drain();
    assert.equal(d.commands.length, 1); assert.equal(d.commands[0].expected.answer_revision, 7);
    assert.equal(d.answer('no').disabled, false); assert.equal(d.closes, outcome === 'committed' ? 1 : 0); assert.equal(f.editor.draft.body, 'kept');
    if (outcome === 'lost') assert.match(f.get('reader-notice').textContent, /Connection interrupted; whether that was saved is unknown/);
    if (outcome === 'refused') assert.match(f.get('reader-notice').textContent, /This question is no longer yours/);
    if (outcome === 'committed') assert.equal(d.answer('no').getAttribute('aria-pressed'), 'true');
  }
});

test('860 stale Reader button cannot answer after source, permission or withdrawal changes', async () => {
  for (const change of ['source', 'unavailable', 'non-message', 'agent', 'unaddressed', 'withdrawn']) {
    const d = await decisionPage860(), { f } = d;
    assert.ok(d.answer('yes'), 'start with an eligible button'); const stale = d.answer('yes');
    if (change === 'source') d.presentation.source = { ...d.item, author: 'dan', source_ref: { kind: 'message', id: 'other860' } };
    if (change === 'unavailable') d.presentation.sourceUnavailable = true;
    if (change === 'non-message') d.presentation.source.source_ref.kind = 'memory';
    if (change === 'agent') f.bootstrap.actor_kind = 'agent';
    if (change === 'unaddressed') f.views.messages.get(d.item.id).addressees = [];
    if (change === 'withdrawn') f.views.messages.get(d.item.id).withdrawal = { reason: 'Superseded' };
    await stale.onclick(); await drain(); assert.equal(d.commands.length, 0, change);
    d.paint();
    if (change === 'source') { assert.equal(d.answer('yes').dataset.messageId, 'other860'); assert.notEqual(d.answer('yes'), stale); }
    else assert.equal(d.answer('yes'), null, change);
  }
});

test('860 late refusal cannot replace another Reader source or its notice and writing', async () => {
  const d = await decisionPage860(), { f } = d, held = defer();
  assert.ok(d.answer('yes'), 'start with an eligible button');
  d.setCommand(() => held.promise); const sent = d.answer('yes').onclick();
  const next = { source: { source_ref: { kind: 'memory', id: 'note860' } }, editors: { reply: f.editor } };
  f.registry.current = next; f.editor.draft.body = 'new source writing'; f.reader.notice('Current source notice'); d.paint();
  held.resolve({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'Old question refused' } }); await sent; await drain();
  assert.equal(f.registry.current, next); assert.equal(f.editor.draft.body, 'new source writing');
  assert.equal(f.get('reader-notice').textContent, 'Current source notice');
  assert.equal(f.get('reader-reactions').hidden, true); assert.equal(d.answer('yes'), null); assert.equal(d.closes, 0);
});

// 880 uses this file's actual app loader and the real TopicViews renderer.
// Only transport and the device journal are held in memory; no store opens.
function startup880(t, { answers = {}, journalError = null, prerequisites = false } = {}) {
  const names = ['topic_messages', 'memory_items', 'colors', 'journal', ...(prerequisites ? ['workspace', 'wakes', 'workspace_members'] : [])];
  const gates = new Map(names.map(name => [name, defer()])), asked = [], baselines = [];
  let closes = 0, settled = false, f;
  const opened = { close() { closes++; } };
  f = fixture('https://fixture/?topic=t1', {
    TopicViews,
    initialViews: async () => { baselines.push('feed'); return {}; },
    actorBaseline: async () => { baselines.push('actor'); return null; },
    openJournal: async options => {
      asked.push({ name: 'journal', args: options });
      await gates.get('journal').promise;
      if (journalError) throw journalError;
      return opened;
    },
  });
  const message = { id: 'm880', seq: 1, topic_id: 't1', author_id: 'fixture-writer', body: 'Message words 880', sent_ms: null, reply_to: null };
  const note = { id: 'n880', seq: 1, title: 'Notebook 880', body: 'Notebook words 880', revision: 2,
    owner_scope: { kind: 'topic', id: 't1' }, source_ref: { kind: 'memory', id: 'n880', revision: 2 } };
  const values = {
    topic_messages: { instance_id: 'fixture', items: [message], next_cursor: null, relevant_versions: { topic: 1 } },
    memory_items: { instance_id: 'fixture', items: [note], next_cursor: null, relevant_versions: { notebook: 1 } },
    colors: { instance_id: 'fixture', palette: [...AGENT_PALETTE], items: [], next_cursor: null },
    workspace: { instance_id: 'fixture', workspace: { id: 'w1', title: 'Workspace' } },
    wakes: { instance_id: 'fixture', quiet: [] },
    workspace_members: { instance_id: 'fixture', items: [], next_cursor: null },
    ...answers,
  };
  const read = f.api.view;
  f.api.view = async (name, args, options) => {
    if (!gates.has(name)) return read(name, args, options);
    asked.push({ name, args, options, baselines: [...baselines] });
    await gates.get(name).promise;
    const value = values[name]; if (value instanceof Error) throw value;
    return structuredClone(value);
  };
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  // The normal fixture has an already-present editor for its other checks;
  // this scenario begins with no startup owner and observes its construction.
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  const started = f.initialize().then(() => { settled = true; return { ok: true }; }, error => { settled = true; return { ok: false, error }; });
  const release = name => gates.get(name).resolve();
  const releaseAll = () => names.forEach(release);
  t.after(async () => { releaseAll(); await started; await drain(); });
  const unpublished = () => {
    assert.equal(f.events.filter(e => e[0] === 'registry').length, 0, 'no editor registry before the startup join');
    assert.equal(f.get('messages').querySelector('[data-id]'), null, 'no clickable message source');
    assert.equal(f.get('memory-items').querySelector('[data-id]'), null, 'no clickable Notebook source');
    assert.equal(f.get('body').dataset.ready, undefined, 'page is not marked ready');
  };
  const text = node => typeof node === 'string' ? node : node?.textContent || (node?.children ?? []).map(text).join('');
  const page = () => {
    const views = f.runObservation('views');
    return { title: f.get('topic-title').textContent, messages: [...views.messages.values()].map(x => [x.id, x.body]),
      memory: [...views.memory.values()].map(x => [x.id, x.title, x.body, x.revision]),
      messageText: text(entryIn(f, 'm880')?.querySelector(':scope > .message-preview')),
      memoryText: text(f.get('memory-items').querySelector('[data-id=n880]')?.children[1]),
      sourceClickable: typeof entryIn(f, 'm880')?.onclick, memoryClickable: typeof f.get('memory-items').querySelector('[data-id=n880]')?.onclick,
      ready: f.get('body').dataset.ready };
  };
  return { f, names, asked, gates, opened, started, release, releaseAll, unpublished, page, closes: () => closes, settled: () => settled };
}
const expected880 = { title: 'Fixture', messages: [['m880', 'Message words 880']], memory: [['n880', 'Notebook 880', 'Notebook words 880', 2]],
  messageText: 'Message words 880', memoryText: '', sourceClickable: 'function', memoryClickable: 'undefined', ready: 'true' };

test('880 all four startup reads are already asked while messages are held, with exact bounds and baselines', async t => {
  const s = startup880(t); await drain();
  assert.deepEqual(s.asked.map(x => x.name).sort(), ['colors', 'journal', 'memory_items', 'topic_messages']);
  const one = name => s.asked.find(x => x.name === name);
  assert.deepEqual(JSON.parse(JSON.stringify(one('topic_messages').args)), { topic_id: 't1', audience: 'all', direction: 'before', limit: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(one('memory_items').args)), { owner_scope: { kind: 'topic', id: 't1' }, limit: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(one('colors').args)), { limit: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(one('colors').options)), { readClass: 'foreground' });
  assert.deepEqual(JSON.parse(JSON.stringify(one('journal').args)), { instanceId: 'fixture', actor: 'fixture-person' });
  for (const name of ['topic_messages', 'memory_items']) assert.deepEqual(one(name).baselines, ['feed', 'actor']);
  s.unpublished();
  for (const name of ['memory_items', 'colors', 'journal']) s.release(name);
  await drain(); assert.equal(s.settled(), false); s.unpublished();
  s.release('topic_messages'); assert.equal((await s.started).ok, true); await drain();
  assert.deepEqual(s.page(), expected880); assert.equal(s.closes(), 0, 'successful startup keeps its journal');
  assert.equal(s.f.events.filter(e => e[0] === 'registry').length, 1);
  assert.equal(s.f.registry.options.journal === s.opened, true, 'the startup owner adopts this exact journal');
  assert.deepEqual(s.asked.map(x => x.name).sort(), ['colors', 'journal', 'memory_items', 'topic_messages'], 'no extra startup read was introduced');
});

const permutations880 = values => values.length ? values.flatMap((value, index) => permutations880(values.filter((_, at) => at !== index)).map(rest => [value, ...rest])) : [[]];
for (const order of permutations880(['topic_messages', 'memory_items', 'colors', 'journal'])) {
  test('880 release order ' + order.join(' > ') + ' paints the same page without early sources', async t => {
    const s = startup880(t); await drain(); s.unpublished();
    for (const [index, name] of order.entries()) {
      s.release(name); await drain();
      if (index < order.length - 1) { assert.equal(s.settled(), false); s.unpublished(); }
    }
    assert.equal((await s.started).ok, true); await drain(); assert.deepEqual(s.page(), expected880);
    assert.equal(s.closes(), 0); assert.equal(s.f.events.filter(e => e[0] === 'registry').length, 1);
  });
}

for (const name of ['topic_messages', 'memory_items']) for (const failure of ['refused answer', 'wrong instance', 'transport refusal']) {
  test('880 ' + name + ' ' + failure + ' refuses startup and leaves no sources', async t => {
    const refused = Object.assign(Error('Transport refused880'), { status: 403, code: 'FORBIDDEN' });
    const answer = failure === 'wrong instance' ? { instance_id: 'other-instance', items: [], next_cursor: null } :
      failure === 'refused answer' ? { instance_id: 'fixture', error: { code: 'FORBIDDEN', message: 'List refused880' } } : refused;
    const s = startup880(t, { answers: { [name]: answer } }); s.releaseAll();
    const result = await s.started; assert.equal(result.ok, false);
    if (failure === 'wrong instance') assert.match(result.error.message, /another instance or is malformed/);
    else if (failure === 'transport refusal') assert.equal(result.error, refused);
    else { assert.equal(result.error.message, 'List refused880'); assert.equal(result.error.details.error.code, 'FORBIDDEN'); }
    s.unpublished();
  });
}

test('880 rejected journal refuses startup; rejected colors keep their existing fallback', async t => {
  const error = Error('Device journal refused880'), failed = startup880(t, { journalError: error });
  failed.releaseAll(); const result = await failed.started;
  assert.equal(result.ok, false); assert.equal(result.error, error); failed.unpublished();
  const colorFailure = startup880(t, { answers: { colors: Error('Color read refused880') } });
  colorFailure.releaseAll(); assert.equal((await colorFailure.started).ok, true); await drain();
  assert.deepEqual(colorFailure.page(), expected880); assert.equal(colorFailure.closes(), 0);
});

for (const name of ['topic_messages', 'memory_items']) for (const when of ['before', 'after']) test('880 journal resolved ' + when + ' refused ' + name + ' is closed exactly once', async t => {
  const refused = Object.assign(Error('List refused880'), { status: 403 });
  const s = startup880(t, { answers: { [name]: refused } }); await drain();
  assert.equal(s.asked.filter(x => x.name === 'journal').length, 1, 'journal was opened concurrently');
  if (when === 'before') { s.release('journal'); await drain(); assert.equal(s.closes(), 0); }
  s.release(name); await drain();
  assert.equal(s.settled(), true, 'a refusal settles without waiting for held sibling reads');
  const result = await s.started;
  assert.equal(result.ok, false); assert.equal(result.error, refused); s.unpublished();
  if (when === 'after') { assert.equal(s.closes(), 0); s.release('journal'); }
  await drain(); assert.equal(s.closes(), 1); s.releaseAll(); await drain(); assert.equal(s.closes(), 1);
});

test('880 confirmed topic precedes the startup join; the existing color read keeps its early start', async t => {
  const held = defer(), s = startup880(t), read = s.f.api.view;
  s.f.api.view = async (name, args, options) => { if (name === 'topic') await held.promise; return read(name, args, options); };
  try {
    await drain(); assert.deepEqual(s.asked.map(x => x.name), ['colors']); s.unpublished();
    held.resolve(); await drain();
    assert.deepEqual(s.asked.map(x => x.name).sort(), ['colors', 'journal', 'memory_items', 'topic_messages']);
  } finally { held.resolve(); s.releaseAll(); }
  assert.equal((await s.started).ok, true); await drain(); assert.deepEqual(s.page(), expected880);
});

const startup886 = (t, options = {}) => startup880(t, { ...options, prerequisites: true });
test('886 all independent topic reads start before any answer, after topic and baseline, with unchanged bounds', async t => {
  const s = startup886(t); await drain();
  assert.deepEqual(s.asked.map(x => x.name).sort(), [...s.names].sort());
  const one = name => s.asked.find(x => x.name === name);
  for (const name of ['topic_messages', 'memory_items']) assert.deepEqual(one(name).baselines, ['feed', 'actor']);
  assert.deepEqual(JSON.parse(JSON.stringify(one('workspace').args)), { workspace_id: 'w1' });
  assert.deepEqual(JSON.parse(JSON.stringify(one('workspace_members').args)), { workspace_id: 'w1', limit: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(one('wakes').args)), {});
  for (const name of ['wakes', 'workspace_members']) assert.equal(one(name).options.readClass, 'background');
  s.unpublished(); s.releaseAll(); assert.equal((await s.started).ok, true); await drain();
  assert.deepEqual(s.page(), expected880); assert.equal(s.asked.length, 7, 'no duplicate color or other startup request');
});
for (const held of ['workspace', 'wakes', 'workspace_members', 'topic_messages', 'memory_items', 'colors', 'journal']) {
  test('886 held ' + held + ' does not stop sibling reads or admit early sources', async t => {
    const s = startup886(t); await drain();
    assert.equal(s.asked.length, 7);
    for (const name of s.names) if (name !== held) s.release(name);
    await drain(); assert.equal(s.settled(), false); s.unpublished();
    s.release(held); assert.equal((await s.started).ok, true); await drain();
    assert.deepEqual(s.page(), expected880); assert.equal(s.closes(), 0);
  });
}
for (const name of ['workspace', 'wakes', 'workspace_members']) test('886 ' + name + ' refusal retains its existing nonfatal fallback', async t => {
  const s = startup886(t, { answers: { [name]: Error('Optional read refused886') } });
  s.releaseAll(); assert.equal((await s.started).ok, true); await drain(); assert.deepEqual(s.page(), expected880);
  if (name === 'workspace') assert.equal(s.f.get('workspace-name').textContent, 'w1');
  if (name === 'workspace_members') assert.equal(s.f.runObservation('outcomeMembers'), null);
});
for (const name of ['topic_messages', 'memory_items']) test('886 refused ' + name + ' settles while workspace and other prerequisites stay held; late journal closes', async t => {
  const refused = Error('List refused886'), s = startup886(t, { answers: { [name]: refused } }); await drain();
  assert.equal(s.asked.length, 7); s.release(name); await drain();
  assert.equal(s.settled(), true, 'fatal startup refusal does not wait for optional read gates');
  const result = await s.started; assert.equal(result.ok, false); assert.equal(result.error, refused); s.unpublished();
  assert.equal(s.closes(), 0); s.release('journal'); await drain(); assert.equal(s.closes(), 1);
  s.releaseAll(); await drain(); assert.equal(s.closes(), 1); s.unpublished();
});
test('886 topic identity is confirmed before new independent reads; colors retains its earlier start', async t => {
  const topic = defer(), s = startup886(t), read = s.f.api.view;
  s.f.api.view = async (name, ...args) => { if (name === 'topic') await topic.promise; return read(name, ...args); };
  try {
    await drain(); assert.deepEqual(s.asked.map(x => x.name), ['colors']); s.unpublished();
    topic.resolve(); await drain(); assert.equal(s.asked.length, 7);
  } finally { topic.resolve(); s.releaseAll(); }
  assert.equal((await s.started).ok, true);
});

test('886 actual dossier adapter keeps batched reads background and checks the instance before admitting words', async t => {
  const s = startup886(t); s.releaseAll(); assert.equal((await s.started).ok, true); await drain();
  const heads = s.f.runObservation('dossierHeads'), reads = [];
  let foreign = false, paints = 0; heads.changed = () => paints++;
  s.f.api.view = async (name, args, options) => {
    reads.push({ name, args: JSON.parse(JSON.stringify(args)), options: JSON.parse(JSON.stringify(options)) });
    return { instance_id: foreign ? 'foreign' : 'fixture', items: args.message_ids.map(id => ({ id, topic_id: 't1', body: 'Admitted words', stack_position: { root_id: id } })) };
  };
  const messages = new Map(['a', 'b'].map(id => ['reply-' + id, { id: 'reply-' + id, reply_to: id, stack_position: { root_id: id } }]));
  heads.sync(messages); await heads.readTail;
  assert.deepEqual(reads, [{ name: 'topic_messages', args: { topic_id: 't1', message_ids: ['a', 'b'] }, options: { readClass: 'background' } }]);
  assert.equal(paints, 1); assert.equal(heads.messages(new Map()).size, 2);
  heads.invalidate(); foreign = true; heads.sync(messages); await heads.readTail;
  assert.equal(reads.length, 2); assert.equal(paints, 2); assert.equal(heads.messages(new Map()).size, 0);
  assert.deepEqual([...heads.records.values()].map(record => record.state), ['error', 'error']);
});

test('886 Landing-shaped opening counts actual full-feed arrangements and identifies later repaint triggers', async t => {
  const roots = ['head-886-a', 'head-886-b', 'head-886-c', 'head-886-d'];
  const position = (id, revision = 0) => ({ root_id: id, at: { acts: revision, messages: 130 }, order_key: roots.indexOf(id), order_tie: 1,
    cover_revision: revision, cover: revision ? { stands: `Cover revision ${revision}`, waiting: [], payload: null } : null });
  const messages = Array.from({ length: 30 }, (_, index) => ({ id: `reply-886-${index}`, seq: 101 + index, topic_id: 't1', author_id: 'fixture-writer', body: `Landing-shaped reply ${index}`, sent_ms: null,
    reply_to: roots[index % 4], stack_position: position(roots[index % 4]),
    attachments: index === 0 ? [{ id: 'image-886', inline: true, content_type: 'image/png', name: 'Fixture image' }] : [] }));
  const heads = roots.map((id, index) => ({ id, seq: index + 1, topic_id: 't1', author_id: 'fixture-writer', body: `Original ${id}`, sent_ms: null, reply_to: null, stack_position: position(id) }));
  const s = startup886(t, { answers: { topic_messages: { instance_id: 'fixture', items: messages, next_cursor: 101, relevant_versions: { topic: 1 } } } });
  // Wrappers delegate to the actual app/StackFeed implementations. This is
  // not a DossierHeads.changed count: full arrangements render real stacks.
  const trace = s.f.runObservation(`(() => {
    const trace = { phase: 'opening', events: [] }, paint = paintViews, arrange = StackFeed.prototype.arrange;
    paintViews = function(kind) { trace.events.push({ owner: 'paintViews', kind, phase: trace.phase, stack: new Error().stack }); return paint(kind); };
    StackFeed.prototype.arrange = function(...args) {
      const stack = new Error().stack, result = arrange.apply(this, args);
      trace.events.push({ owner: 'StackFeed.arrange', phase: trace.phase, stacks: this.state.stacks.length, entries: entries(this.list).length, stack });
      return result;
    };
    return trace;
  })()`);
  const headGate = defer(), markGate = defer(), imageGate = defer(), requests = [], read = s.f.api.view;
  s.f.api.view = async (name, args, options) => {
    if (name === 'topic_messages' && args.message_ids) {
      requests.push({ name, ids: [...args.message_ids], readClass: options?.readClass }); await headGate.promise;
      return { instance_id: 'fixture', items: heads.filter(item => args.message_ids.includes(item.id)), next_cursor: null };
    }
    if (name === 'marks') { await markGate.promise; return { instance_id: 'fixture', topic_id: 't1', items: [{ message_id: messages[0].id, seq: 101, mark_revision: 1 }], next_cursor: null }; }
    return read(name, args, options);
  };
  let imageReads = 0, imageURL;
  s.f.api.media = async () => { imageReads++; await imageGate.promise; return { blob: new Blob(['in-memory image bytes'], { type: 'image/png' }) }; };
  t.after(() => { headGate.resolve(); markGate.resolve(); imageGate.resolve(); if (imageURL) URL.revokeObjectURL(imageURL); });
  s.releaseAll(); assert.equal((await s.started).ok, true); await drain();
  const arrangements = () => Array.from(trace.events).filter(event => event.owner === 'StackFeed.arrange');
  const count = phase => arrangements().filter(event => event.phase === phase).length;
  assert.equal(s.f.runObservation('views.messages.size'), 30); assert.equal(arrangements()[0].stacks, 4);
  assert.equal(count('opening'), 1, 'one initial full feed arrangement before the held arrivals');
  trace.phase = 'marks'; markGate.resolve(); await drain(); assert.equal(count('marks'), 0);
  trace.phase = 'image';
  for (const observer of s.f.observers.filter(each => each.options?.rootMargin === '50% 0px')) observer.callback([...observer.targets].map(target => ({ target, isIntersecting: true })));
  await drain(); assert.equal(imageReads, 1); imageGate.resolve(); await drain();
  const image = entryIn(s.f, messages[0].id).querySelector(':scope > .card-images').querySelector(':scope > .card-image').querySelector(':scope > img.image-thumb');
  imageURL = image?.src; assert.equal(image?.hidden, false, 'actual thumbnail completion is observed'); assert.equal(count('image'), 0);
  trace.phase = 'heads'; headGate.resolve(); await s.f.runObservation('dossierHeads.readTail'); await drain();
  assert.deepEqual(requests.map(each => ({ ...each, ids: [...each.ids].sort() })), [{ name: 'topic_messages', ids: roots, readClass: 'background' }]);
  assert.equal(count('heads'), 1, 'all four heads cause one actual full feed arrangement');
  assert.equal(trace.events.filter(event => event.owner === 'paintViews' && event.kind === 'messages' && event.phase === 'heads').length, 1);
  assert.equal(arrangements().at(-1).stacks, 4); assert.equal(s.f.runObservation('feedMessages().size'), 34);
  const openingAfterFirst = arrangements().slice(1).map(event => event.phase);
  assert.deepEqual(openingAfterFirst, ['heads']);

  // Additional explicit arrivals are probes, not assertions that these
  // changes happened in Tony's opening. Exercise the app's freshness callback
  // and actual TopicViews, retaining the fixture's deterministic feed driver.
  const refresh = async (phase, revision, withAct = false) => {
    trace.phase = phase;
    const read = async name => name === 'message_acts'
      ? { instance_id: 'fixture', topic_id: 't1', version: revision, next_cursor: null,
        items: withAct ? [{ message_id: roots[0], seq: 1, acts: { name: { text: 'Changed dossier name' }, name_revision: 1 } }] : [] }
      : { instance_id: 'fixture', topic_id: 't1', items: roots.map(id => ({ message_id: id, stack_position: position(id, revision) })) };
    await s.f.fresh.options.refresh('acts', revision, read, () => true); await drain();
  };
  await refresh('freshness unchanged', 0); assert.equal(count('freshness unchanged'), 0);
  await refresh('cover positions changed', 1); assert.equal(count('cover positions changed'), 1);
  await refresh('acts and positions changed', 2, true); assert.equal(count('acts and positions changed'), 2, 'existing readPositions and readActs each paint the changed feed');
  t.diagnostic('886 repaint trace ' + JSON.stringify({ openingAfterFirst, counts: Object.fromEntries(['opening', 'marks', 'image', 'heads', 'freshness unchanged', 'cover positions changed', 'acts and positions changed'].map(phase => [phase, count(phase)])), requests, events: trace.events }));
});

test('872 app gives New message the verified instance for width preferences even before its editor loads', async () => {
  const f = fixture();
  await f.initialize();
  const inline = f.owners().inline;
  assert.equal(inline.callbacks.instanceId, f.bootstrap.instance_id);
  assert.equal(inline.layoutInstance, f.bootstrap.instance_id);
  assert.equal(inline.layout.widthKeys['new-message'], JSON.stringify(['aim-next', f.bootstrap.instance_id, 'composer-width', 'new-message']));
});

test('788 revised page markup has no bottom Notebook container or paging control', async () => {
  const html = webSource('index.html');
  assert.doesNotMatch(html, /id="(?:notebook|memory-items|more-memory)"/);
});
test('788 revised memory paint keeps admitted pages in cache without rendering bottom-feed cards', async t => {
  const s = startup880(t); s.releaseAll(); assert.equal((await s.started).ok, true); const f = s.f;
  const item = { id: 'n788', seq: 1, title: 'Plan', body: 'Exact cached words', revision: 2, read_revision: 1,
    owner_scope: { kind: 'topic', id: 't1' }, source_ref: { kind: 'memory', id: 'n788', revision: 2 } };
  const views = f.runObservation('views');
  views.memoryPage({ instance_id: 'fixture', items: [item], next_cursor: null, relevant_versions: { notebook: 2 } }, { initial: true });
  assert.equal(f.get('memory-items').children.length, 0);
  assert.deepEqual(views.memory.get(item.id), item);
});

test('788 revised a current-topic Notebook link still opens the shared sheet with its opener', async () => {
  const f = fixture(); await f.initialize();
  f.runObservation("globalThis.notebookOpened788 = []; notebookSheet = { open: (id, options) => notebookOpened788.push([id, options.opener.id]) };");
  await f.runObservation("openDestination({ kind: 'topic', id: 't1', page: 'n788' }, 'Plan', document.getElementById('opener788'))");
  assert.deepEqual(JSON.parse(JSON.stringify(f.runObservation('notebookOpened788'))), [['n788', 'opener788']]);
  assert.equal(f.get('memory-items').children.length, 0);
});

// 889: the real app/Reader/registry close chain, with only the device persist
// adapter kept in memory. No Core, device database, server or browser opens.
async function decisionPage889(options) {
  const d = await decisionPage860(options), { f } = d, saved = [], closes = [];
  let device = null, failSave = false;
  const session = { attempts: [], persist() {
    const copy = structuredClone({ draft: f.editor.draft, context: f.editor.context, localVersion: f.editor.localVersion });
    saved.push(copy); return device ? device.promise : failSave ? Promise.reject(Error('device unavailable')) : Promise.resolve();
  } };
  f.editor.localVersion = 2;
  f.editor.context = { kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: d.item.id } };
  Object.assign(f.editor.draft, { body: 'unsent exact words', addressees: ['agent-a'], attachments: [{ id: 'fixture-image-889' }] });
  Object.assign(f.registry, { generation: 1, localWrites: new Map(), timers: { now: () => 100 }, activity() {}, changed() {}, sessionFor: () => session,
    close: EditorRegistry.prototype.close, keepLocal: EditorRegistry.prototype.keepLocal, keepEditorsLocal: EditorRegistry.prototype.keepEditorsLocal,
    persistLocal: EditorRegistry.prototype.persistLocal, savedAt: EditorRegistry.prototype.savedAt, closeRefusal: EditorRegistry.prototype.closeRefusal,
    closed: f.registry.options.closed });
  Object.assign(f.reader, { viewToken: 1, editor: f.editor, sessions: d.presentation.editors, opener: f.get('opener889'),
    rememberPlace() {}, caret: () => ({ start: 3, end: 5 }), placeReply() {}, disarm() {}, close: RealReader.prototype.close, finishClose: RealReader.prototype.finishClose });
  f.reader.dialog.close = () => { closes.push(f.reader.presentation); f.reader.dialog.open = false; };
  const coverDoc = miniDocument(), cover = { owner: 'fixture-person', stands: 'A choice waits', payload: null, waiting: [{ actor_id: 'fixture-person', ask_id: 'linked889', message_id: 'linked889', text: 'Proceed?', go_ahead: true, answer_revision: 4 }] };
  f.reader.$ = id => coverDoc.byId(id);
  f.reader.callbacks.dossierCover = () => ({ rootId: 'root889', topicId: 't1', cover });
  const paintCover = () => {
    const before = globalThis.document; globalThis.document = coverDoc;
    try { RealReader.prototype.paintCover.call(f.reader, f.reader.presentation.source); }
    finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
    return coverDoc.byId('reader-cover').querySelectorAll('button.cover-answer');
  };
  return { ...d, f, saved, closes, paintCover, coverDoc, cover,
    holdDevice() { device = defer(); return device; }, refuseDevice() { failSave = true; },
    configureCover() { configureCoverAnswers(() => ({ reactions: f.runObservation('reactions'), changed() {} })); } };
}

// 908 reuses the actual close/save chain, and binds the actual Reader gesture
// to the app's existing callback. Only event/transport/device ports are fake.
async function foldPage908(acts = {}) {
  const d = await decisionPage889(), { f } = d;
  f.views.ownAct = TopicViews.prototype.ownAct;
  const item = f.views.messages.get(d.item.id); item.acts = { fold_revision: 3, ...acts };
  d.presentation.source.topic_id = 't1';
  Object.assign(f.reader, { source: d.presentation.source, sourceBody: f.get('source-body') });
  f.paintViews('messages');
  await drain(); d.commands.length = 0; // Finish the initial reading mark before measuring the swipe.
  let pending;
  const fold = f.reader.callbacks.foldMessage;
  f.reader.callbacks.foldMessage = source => { pending = fold(source); return pending; };
  const target = { parentElement: f.reader.sourceBody, scrollWidth: 100, clientWidth: 100, closest: () => null };
  RealReader.prototype.bindSwipe.call(f.reader);
  const swipe = () => {
    const before = globalThis.window; globalThis.window = { getSelection: () => ({ isCollapsed: true }) };
    let prevented = false;
    try { f.reader.sourceBody.handlers.wheel({ target, deltaX: -100, deltaY: 0, deltaMode: 0, timeStamp: 500, preventDefault() { prevented = true; } }); }
    finally { if (before === undefined) delete globalThis.window; else globalThis.window = before; }
    assert.equal(prevented, true); return pending;
  };
  return { ...d, item, swipe, feed: f.runObservation('stackFeed') };
}

test('908 Reader swipe waits for the committed fold and existing writing save before closing', async () => {
  const d = await foldPage908(), answer = defer(), device = d.holdDevice();
  d.setCommand(() => answer.promise); const done = d.swipe(); await drain();
  assert.equal(d.commands.length, 1); assert.equal(d.commands[0].kind, 'message.fold');
  assert.equal(d.commands[0].expected.fold_revision, 3); assert.equal(d.commands[0].args.folded, true);
  assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
  d.f.editor.draft.body = 'new writing while the fold waits';
  answer.resolve({ status: 'committed', result: { message_id: d.item.id, folded: true, fold_revision: 4 } }); await drain();
  assert.equal(d.saved.length, 1, d.f.get('reader-notice').textContent); assert.equal(d.closes.length, 0);
  assert.equal(d.saved[0].draft.body, 'new writing while the fold waits');
  assert.deepEqual(d.saved[0].draft.attachments, [{ id: 'fixture-image-889' }]);
  device.resolve(); await done; await drain();
  assert.equal(d.closes.length, 1); assert.equal(d.f.reader.dialog.open, false);
  assert.equal(d.item.acts.folded, true); assert.equal(d.f.editor.draft.body, 'new writing while the fold waits');
});

for (const kind of ['refused', 'lost']) test(`908 ${kind} fold keeps Reader writing and shows its notice`, async () => {
  const d = await foldPage908();
  d.setCommand(async () => { if (kind === 'lost') throw new AttemptError('Connection interrupted');
    return { status: 'rejected', error: { code: 'FORBIDDEN', message: 'Folding is not allowed here' } }; });
  await d.swipe(); await drain();
  assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
  assert.equal(d.f.reader.dialog.open, true); assert.equal(d.f.editor.draft.body, 'unsent exact words');
  assert.match(d.f.get('reader-notice').textContent, kind === 'lost' ? /connection was interrupted/i : /Folding is not allowed here/);
  assert.notEqual(d.item.acts.folded, true); d.feed.deafen();
});

test('908 a late committed fold cannot close a replacement Reader', async () => {
  const d = await foldPage908(), answer = defer(); d.setCommand(() => answer.promise);
  const done = d.swipe(); await drain();
  const next = { source: { source_ref: { kind: 'memory', id: 'next908' } }, editors: { reply: d.f.editor } };
  d.f.registry.current = next; d.f.reader.presentation = next; d.f.reader.viewToken++;
  answer.resolve({ status: 'committed', result: { message_id: d.item.id, folded: true, fold_revision: 4 } }); await done; await drain();
  assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.f.registry.current, next);
  assert.equal(d.item.acts.folded, true, 'the original fold really committed');
});

test('908 a failed device save after the fold keeps Reader and writing open', async () => {
  const d = await foldPage908(); d.refuseDevice();
  d.setCommand(async () => ({ status: 'committed', result: { message_id: d.item.id, folded: true, fold_revision: 4 } }));
  await d.swipe(); await drain();
  assert.equal(d.item.acts.folded, true); assert.equal(d.saved.length, 1);
  assert.equal(d.closes.length, 0); assert.equal(d.f.reader.dialog.open, true);
  assert.equal(d.f.editor.draft.body, 'unsent exact words');
  assert.match(d.f.get('reader-notice').textContent, /kept|save|device/i);
});

test('908 a feed fold still leaves the open Reader and writing alone', async () => {
  const d = await foldPage908();
  d.setCommand(async () => ({ status: 'committed', result: { message_id: d.item.id, folded: true, fold_revision: 4 } }));
  await d.feed.swipeAct(entryIn(d.f, d.item.id), true);
  assert.equal(d.item.acts.folded, true); assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
});

for (const [acts, reason] of [[{ starred: true }, 'Starred messages stay in view; unstar it to fold.'], [{ folded: true }, 'Already folded.']])
  test(`917 Reader refused swipe says ${reason}`, async () => {
    const d = await foldPage908(acts); await d.swipe(); await drain();
    assert.equal(d.commands.length, 0); assert.equal(d.closes.length, 0);
    assert.equal(d.f.get('app-status').textContent, reason); assert.equal(d.f.get('reader-notice').textContent, reason);
  });

test('917 a qualifying feed swipe with no message is consumed and says what happened', async () => {
  const d = await foldPage908(); let prevented = false;
  d.feed.wheeled({ target: d.f.get('messages'), deltaX: -100, deltaY: 0, deltaMode: 0, timeStamp: 500, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(d.commands.length, 0);
  assert.equal(d.f.get('app-status').textContent, 'Nothing to fold here'); assert.equal(d.closes.length, 0);
});

test('917 a Reader without a message consumes its swipe and gives the existing notice', async () => {
  const d = await foldPage908(); d.f.reader.source = null; RealReader.prototype.bindSwipe.call(d.f.reader);
  await d.swipe(); await drain();
  assert.equal(d.commands.length, 0); assert.equal(d.closes.length, 0);
  assert.equal(d.f.get('reader-notice').textContent, 'Nothing to fold here');
  assert.equal(d.f.get('app-status').textContent, 'Nothing to fold here');
});

test('917 a starred feed message consumes wheel and touch refusals without a command', async () => {
  const d = await foldPage908({ starred: true }), card = entryIn(d.f, d.item.id);
  d.f.document.getSelection = () => ({ isCollapsed: true });
  let consumed = 0;
  d.feed.wheeled({ target: card, deltaX: -100, deltaY: 0, deltaMode: 0, timeStamp: 500, preventDefault() { consumed++; } });
  d.feed.swipe = { x: 0, y: 0, target: card };
  d.feed.swiped({ changedTouches: [{ clientX: 100, clientY: 0 }], preventDefault() { consumed++; } });
  assert.equal(consumed, 2); assert.equal(d.commands.length, 0);
  assert.equal(d.f.get('app-status').textContent, 'Starred messages stay in view; unstar it to fold.');
});

test('919 the Reader star agrees on first paint and immediately after unstar', async () => {
  const d = await foldPage908({ starred: true });
  d.f.runObservation('paintReaderStar()');
  assert.equal(d.f.get('reader-star').hidden, false); assert.equal(d.f.get('reader-star').getAttribute('aria-pressed'), 'true');
  assert.equal(d.f.get('reader-star').textContent, '★');
  d.item.acts = { starred: false, star_revision: 2 }; d.f.paintViews('acts');
  assert.equal(d.f.get('reader-star').getAttribute('aria-pressed'), 'false');
  assert.equal(d.f.get('reader-star').textContent, '☆');
});

test('917 a starred message retains a disabled Fold menu row with the same reason', async () => {
  const d = await foldPage908({ starred: true });
  const choice = d.feed.menuItems(d.item, { reader: true }).first.find(item => item.key === 'fold');
  assert.ok(choice); assert.equal(choice.disabled, true);
  assert.match(choice.label, /Starred messages stay in view; unstar it to fold\./);
});

test('919 starred first card paints its filled star and dossier cue without a pointer event', async () => {
  const { f, stackOf } = await conversationPage([
    { id: 'star919', seq: 1, author_id: 'agent-a', body: 'Starred first message', acts: { starred: true, star_revision: 1 } },
    { id: 'reply919', seq: 2, author_id: 'dan', reply_to: 'star919', body: 'A reply' },
  ]);
  const card = entryIn(f, 'star919'), star = card.querySelector(':scope > .message-author > .card-star');
  assert.equal(card.dataset.starred, 'true'); assert.equal(star.textContent, '★'); assert.equal(star.getAttribute('aria-pressed'), 'true');
  const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
  const headerStar = nodes(stackOf('star919')).find(node => node.classList?.contains('stack-star'));
  assert.equal(headerStar.textContent, '★\uFE0E'); assert.equal(headerStar.getAttribute('aria-pressed'), 'true');
  f.views.messages.get('star919').acts = { starred: false, star_revision: 2 }; f.paintViews('acts');
  assert.equal(card.dataset.starred, 'false'); assert.equal(star.textContent, '☆');
});

test('919 a starred first card has no CSS exception hiding its painted star until hover', () => {
  const look = webSource('stack-look.css');
  assert.match(look, /\[data-starred=true\] \.card-star\{visibility:visible\}/);
  assert.doesNotMatch(look, /\.stack-head-card\[data-starred=true\][^{]*\{[^}]*visibility:hidden/);
});

test('889 both Reader decisions wait for recorded success and the real device-save barrier before closing', async () => {
  for (const choice of ['yes', 'no']) {
    const d = await decisionPage889(), { f } = d, answer = defer(); d.setCommand(() => answer.promise);
    const device = d.holdDevice(), sent = d.answer(choice).onclick();
    assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
    f.editor.draft.body = 'newer unsent words while answer waits';
    answer.resolve({ status: 'committed', result: { message_id: d.item.id } }); await drain();
    assert.equal(d.saved.length, 1, 'actual keepLocal reaches the persist adapter'); assert.equal(f.reader.dialog.open, true);
    assert.equal(d.saved[0].draft.body, 'newer unsent words while answer waits');
    assert.deepEqual(d.saved[0].draft.addressees, ['agent-a']); assert.deepEqual(d.saved[0].draft.attachments, [{ id: 'fixture-image-889' }]);
    assert.deepEqual(d.saved[0].draft.caret, { start: 3, end: 5 }); assert.deepEqual(d.saved[0].context, f.editor.context);
    device.resolve(); await sent; await drain();
    assert.equal(d.closes.length, 1); assert.equal(f.reader.dialog.open, false); assert.equal(f.registry.current, null);
    assert.equal(f.editor.draft.body, 'newer unsent words while answer waits');
  }
});
test('889 refused and lost Reader answers keep the Reader and writing with their notice', async () => {
  for (const kind of ['refused', 'lost']) {
    const d = await decisionPage889({ loaded: false }); d.setCommand(async () => {
      if (kind === 'lost') throw new AttemptError('Connection interrupted.');
      return { status: 'rejected', error: { code: 'FORBIDDEN', message: 'Question is no longer yours' } };
    });
    await d.answer('no').onclick(); await drain(); assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
    assert.equal(d.f.reader.dialog.open, true); assert.equal(d.f.editor.draft.body, 'unsent exact words');
    assert.match(d.f.get('reader-notice').textContent, kind === 'lost' ? /Connection interrupted/ : /Question is no longer yours/);
  }
});
test('889 local-save failure or a held image keeps a successfully answered Reader open', async () => {
  for (const kind of ['device', 'image']) {
    const d = await decisionPage889(); if (kind === 'device') d.refuseDevice(); else d.f.editor.imageReservation = {};
    const warn = console.warn; console.warn = () => {};
    try { await d.answer('yes').onclick(); await drain(); } finally { console.warn = warn; }
    assert.equal(d.commands.length, 1); assert.equal(d.closes.length, 0); assert.equal(d.f.reader.dialog.open, true);
    assert.equal(d.f.editor.draft.body, 'unsent exact words'); assert.match(d.f.get('reader-notice').textContent, kind === 'device' ? /Not closed.*keep your writing/ : /image/i);
  }
});
test('889 a successful late answer never closes a replacement Reader', async () => {
  const d = await decisionPage889(), held = defer(); d.setCommand(() => held.promise); const sent = d.answer('yes').onclick();
  const next = { source: { source_ref: { kind: 'memory', id: 'new889' } }, editors: { reply: d.f.editor } };
  d.f.registry.current = next; d.f.reader.presentation = next; d.f.reader.viewToken++;
  held.resolve({ status: 'committed', result: { message_id: d.item.id } }); await sent; await drain();
  assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.f.registry.current, next);
});
test('889 a duplicate pending answer does not close early and a feed-card decision never closes Reader', async () => {
  const d = await decisionPage889(), held = defer(); d.setCommand(() => held.promise);
  const first = d.answer('yes').onclick(); await d.answer('no').onclick(); assert.equal(d.commands.length, 1); assert.equal(d.closes.length, 0);
  held.resolve({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'not taken' } }); await first;
  d.setCommand(null); await d.f.runObservation("menu.answer(views.messages.get('decision860'), 'no')"); await drain();
  assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.f.reader.dialog.open, true);
});
test('889 Reader Waiting-on buttons share the close owner and their observed answer revision', async () => {
  for (const index of [0, 1]) {
    const d = await decisionPage889(); d.configureCover();
    try {
      const buttons = d.paintCover(); assert.equal(buttons.length, 2);
      await buttons[index].onclick({ stopPropagation() {} }); await drain();
      assert.equal(d.commands[0].target.message_id, 'linked889'); assert.equal(d.commands[0].expected.answer_revision, 4);
      assert.equal(d.commands[0].args.answer, index ? 'no' : 'yes');
      assert.equal(d.closes.length, 1); assert.equal(d.saved.length, 1, 'the cover answer keeps writing before closing');
      assert.equal(d.saved[0].draft.body, 'unsent exact words'); assert.equal(d.f.registry.current, null);
    } finally { configureCoverAnswers(null); }
  }
});
test('889 Waiting-on refusal and lost answer retain their status and a late success cannot close another Reader', async () => {
  for (const kind of ['refused', 'lost', 'late']) {
    const d = await decisionPage889(), held = defer(); d.configureCover();
    try {
      d.setCommand(() => held.promise); const sent = d.paintCover()[0].onclick({ stopPropagation() {} });
      if (kind === 'late') { const p = { source: { source_ref: { kind: 'memory', id: 'next889' } }, editors: { reply: d.f.editor } }; d.f.registry.current = p; d.f.reader.presentation = p; }
      if (kind === 'lost') held.reject(new AttemptError('Connection interrupted.'));
      else held.resolve(kind === 'refused' ? { status: 'rejected', error: { code: 'FORBIDDEN', message: 'Not your choice' } } : { status: 'committed', result: { message_id: 'linked889' } });
      await sent; await drain(); assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.f.reader.dialog.open, true);
      if (kind !== 'late') assert.match(d.coverDoc.byId('reader-cover').querySelector('.cover-answer-status').textContent, kind === 'lost' ? /Connection interrupted/ : /Not your choice/);
    } finally { configureCoverAnswers(null); }
  }
});
test('889 a reused unchanged cover captures its Reader at press, not when the cover was painted', async () => {
  const d = await decisionPage889(); d.configureCover();
  try {
    const old = d.paintCover()[0], next = { ...d.presentation, source: { ...d.presentation.source, source_ref: { kind: 'message', id: 'other-in-dossier889' } } };
    d.f.registry.current = next; d.f.reader.presentation = next; assert.equal(d.paintCover()[0] === old, true, 'actual unchanged cover reuses the control');
    await old.onclick({ stopPropagation() {} }); await drain(); assert.equal(d.closes.length, 1); assert.equal(d.closes[0] === next, true);
  } finally { configureCoverAnswers(null); }
});

test('889 feed-cover answers keep Reader open and duplicate pending Reader-cover answers cannot close early', async () => {
  const d = await decisionPage889(), held = defer(); d.configureCover();
  try {
    const feed = coverSheet(d.coverDoc, d.cover, { viewer: 'fixture-person', nameOf: id => id, topicId: 't1', rootId: 'root889' });
    await feed.querySelector('button.cover-answer').onclick({ stopPropagation() {} }); await drain();
    assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.commands.length, 1);
    d.setCommand(() => held.promise); const buttons = d.paintCover(), sent = buttons[0].onclick({ stopPropagation() {} });
    await buttons[1].onclick({ stopPropagation() {} }); assert.equal(d.commands.length, 2); assert.equal(d.closes.length, 0); assert.equal(d.saved.length, 0);
    held.resolve({ status: 'committed', result: { message_id: 'linked889' } }); await sent; await drain();
    assert.equal(d.closes.length, 1); assert.equal(d.saved.length, 1);
  } finally { configureCoverAnswers(null); }
});
test('889 the existing close generation protects a Reader replaced while its device save is pending', async () => {
  const d = await decisionPage889(), device = d.holdDevice(), sent = d.answer('yes').onclick(); await drain();
  assert.equal(d.saved.length, 1); assert.equal(d.closes.length, 0);
  const next = { source: { source_ref: { kind: 'memory', id: 'after-save889' } }, editors: { reply: d.f.editor } };
  d.f.registry.current = next; d.f.registry.generation++; d.f.reader.presentation = next; d.f.reader.viewToken++;
  d.f.editor.draft.body = 'new Reader writing'; device.resolve(); await sent; await drain();
  assert.equal(d.closes.length, 0); assert.equal(d.f.registry.current, next); assert.equal(d.f.reader.dialog.open, true);
  assert.equal(d.saved[0].draft.body, 'unsent exact words'); assert.equal(d.f.editor.draft.body, 'new Reader writing');
});

// 890 uses the actual app loader and shared menu descriptor. The final edit
// endpoint is observed here; separate checks execute the Reader edit owner.
test('890 app supplies the bar the same current Edit descriptor and opener as the shared message menu', async () => {
  const f = fixture(); f.bootstrap.actor_kind = 'human'; await f.initialize();
  f.runObservation("globalThis.edits890 = []; editMessage = async (id, opener) => edits890.push([id, opener.id]);");
  const owner = f.runObservation('menu');
  assert.equal(typeof owner.editChoice, 'function', 'the bar receives the shared descriptor owner');
  const item = { id: 'm890', topic_id: 't1', author_id: f.bootstrap.actor, body: 'Exact words' }, anchor = f.get('opener890');
  const choice = owner.editChoice(item, anchor);
  assert.equal(choice?.label, 'Edit'); assert.equal(choice.glyph, 'pencil');
  await choice.act();
  assert.deepEqual(JSON.parse(JSON.stringify(f.runObservation('edits890'))), [['m890', 'opener890']]);
  assert.equal(owner.editChoice({ ...item, author_id: 'another-person' }, anchor), undefined);
  f.runObservation('outcomeReached = true'); assert.equal(owner.editChoice(item, anchor), undefined);
  f.runObservation('outcomeReached = false; topicUnavailable = true'); assert.equal(owner.editChoice(item, anchor), undefined);
  f.runObservation('topicUnavailable = false; messageEdit = {}'); assert.equal(owner.editChoice(item, anchor), undefined);
});

// A DOM event boundary for 890 only. The page's registered document handlers
// run in capture order; a consumed overlay click never reaches its target.
// The source-read adapter is in memory; openSource, menus and card handlers
// are the shipped owners. Native gesture dispatch remains unproven here.
async function editClick890(options = {}) {
  // Native module bindings keep MessageEdit's ENDED distinct from the
  // Notebook writer's same-named export in the broad app VM adapter.
  const f = fixture(undefined, { MessageEdit: RealMessageEdit, MessageEditWriting: RealMessageEditWriting });
  f.runObservation('globalThis.selectionClears890 = 0; window.getSelection = () => ({ removeAllRanges() { selectionClears890++; } });');
  f.registry.initializeInline = async () => f.p;
  Object.assign(f.views, { memory: new Map(), memoryMap: new Map(), olderCursor: null, memoryCursor: null, newest: 1 });
  options.beforeInitialize?.(f);
  await f.initialize(); await settle();
  const item = { id: 'm890', seq: 1, topic_id: 't1', author_id: options.author ?? 'fixture-person', author_kind: 'human', body: 'My exact words', revision: 1 };
  f.views.messages.set(item.id, item); f.paintViews('messages');
  const entry = entryIn(f, item.id), card = f.runObservation('cardIn')(entry), words = card.children.find(child => child.classList?.contains('message-preview'));
  assert.ok(words, 'actual painted message body: ' + card.children.map(child => child.className).join(', '));
  const overlay = f.get('reader'); overlay.tagName = 'DIALOG';
  const closest = function(selector) {
    for (let at = this; at; at = at.parent) for (const part of selector.split(',').map(s => s.trim())) {
      if (part.startsWith('#') ? at.id === part.slice(1) : part.startsWith('.') ? at.classList.contains(part.slice(1)) : part === '[role="button"]' ? at.getAttribute('role') === 'button' : part === '[contenteditable]' ? at.hasAttribute('contenteditable') : at.tagName?.toLowerCase() === part) return at;
    }
    return null;
  };
  card.closest = words.closest = overlay.closest = closest;
  let opened = 0, edits = [], pending = null;
  const cards = f.runObservation('cardReplies = { sync() {}, paint() {} }');
  let inlineOpens = 0, replyShown = false;
  cards.open = async () => { ++inlineOpens; if (pending) await pending.promise; replyShown = true; return { surface: 'card', source: { source_ref: { kind: 'message', id: item.id } } }; };
  cards.shown = () => replyShown && !overlay.open;
  cards.from = () => ({ wide: false });

  f.registry.generation = 1;
  f.reader.dialog = overlay;
  f.owners().marks.open = async (_registry, ref, { opener }) => {
    opened++;
    const p = { token: 1, surface: 'reader', source: { instance_id: 'fixture', source_ref: ref, author: item.author_id, body: item.body, revision: 1, attachments: [] }, opener, editors: {} };
    if (pending) await pending.promise;
    f.registry.current = p; f.reader.presentation = p; f.reader.source = p.source; overlay.open = true;
    return p;
  };
  f.runObservation('globalThis.edits890 = [];');
  if (!options.realEdit) f.runObservation('editMessage = async (id, opener) => edits890.push([id, opener]);');
  edits = f.runObservation('edits890');
  const emit = (type, target = words, props = {}) => {
    const event = { type, target, button: 0, pointerType: 'mouse', pointerId: 1, detail: 1, clientX: 20, clientY: 30, timeStamp: 1000,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.immediate = true; }, ...props };
    for (const [kind, name, fn, options] of f.events) if (kind === 'document-handler' && name === type && (options === true || options?.capture)) { fn(event); if (event.immediate) break; }
    if (!event.stopped && type === 'click' && target !== card && target !== overlay) target.onclick?.(event);
    if (!event.stopped && target !== overlay && card.contains(target)) { card.handlers[type]?.(event); if (type === 'click') card.onclick(event); }
    if (!event.stopped && type === 'click' && target === overlay) event.overlayAction = true;
    return event;
  };
  const click = (target = words, props = {}) => { emit('pointerdown', target, props); emit('mousedown', target, props); emit('pointerup', target, props); return emit('click', target, props); };
  const control = (tag, host = words, id = '') => { const node = id ? f.get(id) : f.document.createElement(tag); node.tagName = tag.toUpperCase(); node.closest = closest; host.append(node); return node; };
  return { f, card, words, overlay, item, edits, emit, click, control, opened: () => opened, inlineOpens: () => inlineOpens, hold() { pending = defer(); return pending; } };
}

test('907 R2 a failed card source read falls back to the Reader without starting Edit', async () => {
  const x=await editClick890();
  x.f.runObservation('cardReplies').open=async()=>{throw Error('This message is not available to you.');};
  x.click();await settle();assert.equal(x.opened(),1);assert.equal(x.overlay.open,true);assert.equal(x.edits.length,0);
});
test('907 first body click opens only its reply; the second opens Reader and shared Edit once', async () => {
  const x = await editClick890(); x.click();
  assert.equal(x.inlineOpens(), 1); assert.equal(x.opened(), 0); await settle();
  const second = x.click(x.words, { timeStamp: 1400, clientX: 26 }); await settle();
  assert.equal(second.defaultPrevented, true); assert.equal(x.opened(), 1);
  assert.equal(x.edits.length, 1); assert.equal(x.edits[0][0], 'm890');
  assert.equal(x.edits[0][1], x.f.get('reader-menu'));
});
test('907 double click while the reply read waits opens Reader only after that reply arrives', async () => {
  const x = await editClick890(), held = x.hold(); x.click();
  const second = x.click(x.words, { timeStamp: 1100, detail: 2 });
  assert.equal(second.defaultPrevented, true); assert.equal(x.opened(), 0);
  held.resolve(); await settle(); assert.equal(x.opened(), 1); assert.equal(x.edits.length, 1);
});
test('907 double-click timing and travel boundaries apply while the first reply read waits', async () => {
  for (const [props, accepted] of [[{ timeStamp: 1400, clientX: 26 }, true], [{ timeStamp: 1401 }, false],
    [{ timeStamp: 1800, detail: 2 }, true], [{ clientX: 26.01 }, false]]) {
    const x = await editClick890(), held = x.hold(); x.click(); const second = x.click(x.words, props);
    assert.equal(Boolean(second.defaultPrevented), accepted); held.resolve(); await settle();
    assert.equal(x.opened(), accepted ? 1 : 0);
  }
});
test('907 another author opens Reader without Edit; touch uses the same click model', async () => {
  for (const own of [true, false]) {
    const x = await editClick890(own ? {} : { author: 'another-person' });
    x.click(x.words, { pointerType: 'touch' }); await settle();
    x.click(x.words, { pointerType: 'touch', timeStamp: 1100 }); await settle();
    assert.equal(x.opened(), 1); assert.equal(x.edits.length, own ? 1 : 0);
  }
});
test('907 controls retain their actions and a drag never becomes a body click', async () => {
  for (const tag of ['a', 'button', 'img', 'input', 'textarea', 'select']) {
    const x = await editClick890(); x.click(); await settle();
    const control = x.control(tag); let acts = 0; control.onclick = event => { ++acts; event.stopPropagation(); };
    const second = x.click(control, { timeStamp: 1100, detail: 2 }); await settle();
    assert.equal(acts, 1); assert.equal(x.opened(), 0); assert.notEqual(second.defaultPrevented, true);
  }
  const x = await editClick890(); x.emit('pointerdown'); x.emit('pointermove', x.words, { clientX: 25 }); x.emit('pointerup'); x.emit('click');
  await settle(); assert.equal(x.inlineOpens(), 0); assert.equal(x.opened(), 0);
});
test('907 R2 a refused first reply tries Reader; retired or superseded opens cannot open a later Reader', async () => {
  for (const mode of ['failed', 'retired', 'superseded']) {
    const x = await editClick890(), held = x.hold(); x.click(); x.click(x.words, { timeStamp: 1100 });
    if (mode === 'failed') held.reject(Error('source refused'));
    else if(mode==='retired'){ x.f.runObservation('retired = new Set()'); held.reject(Error('late source refusal')); }
    else { x.f.runObservation('opening++'); held.reject(Error('superseded source refusal')); }
    await settle(); assert.equal(x.opened(), mode==='failed'?1:0);assert.equal(x.edits.length,0);
  }
});

// Build2 executes the actual Reader start/stop/Escape and MessageEdit endings.
// Only transport, source opening and the device journal are in-memory adapters.
async function editFinish890() {
  const x = await editClick890({ realEdit: true }), { f } = x, commands = [];
  f.runObservation(`globalThis.device890 = { held: null, get: async () => null, put: async value => { device890.held = value; }, delete: async () => { device890.held = null; }, close() {} };
    messageEditStore = async () => device890;`);
  Object.assign(f.reader, { $: f.get, sourceBody: f.get('source-body'), disarm() {}, placeEnd() {}, redrawSource() {},
    startEdit: RealReader.prototype.startEdit, stopEdit: RealReader.prototype.stopEdit, escape: RealReader.prototype.escape });
  Object.assign(f.bootstrap.authority, { authority_id: 'a890', authority_epoch: 'e890' });
  let conflict = false;
  const read = f.api.view;
  f.api.view = async (name, args, options) => conflict && name === 'source'
    ? { instance_id: 'fixture', revision: 2, body: 'Saved on another device' } : read(name, args, options);
  f.api.command = async sent => {
    commands.push(sent);
    const receipt = { instance_id: sent.instance_id, operation_id: sent.operation_id, kind: sent.kind, status: 'committed', recorded: true };
    if (sent.kind === 'message.edit_open') return { ...receipt, result: { message_id: 'm890', session_revision: 1, base_revision: 1, base_words: x.item.body, draft: x.item.body } };
    if (sent.kind === 'message.edit') return conflict ? { ...receipt, status: 'rejected', error: { code: 'REVISION_CONFLICT', current_versions: { message_revision: 2 } } }
      : { ...receipt, result: { message_id: 'm890', revision: 2, edited_ms: 42, session_closed: true, session_revision: 2 } };
    assert.equal(sent.kind, 'message.edit_close'); return { ...receipt, result: { message_id: 'm890' } };
  };
  return { ...x, commands, conflict() { conflict = true; } };
}
for (const ending of ['Save', 'Cancel', 'Use saved', 'Escape']) test('890 Build2 ' + ending + ' after second-click Edit keeps Reader focus exactly as its More Edit does', async () => {
  for (const entry of ['Reader More', 'second click']) {
    const x = await editFinish890(), { f } = x;
    try {
      if (entry === 'second click') { x.click(); await settle(); x.click(x.words, { timeStamp: 1100 }); }
      else {
        await f.owners().marks.open(f.registry, { kind: 'message', id: 'm890' }, { opener: x.card });
        f.runObservation('globalThis.choices890 = null; openMessageMenu = options => { choices890 = options.items; }; openReaderMenu();');
        await f.runObservation("choices890.find(item => item.label === 'Edit').act()");
      }
      await settle();
      const session = f.runObservation('messageEdit'); assert.ok(session, entry + ' starts a real edit');
      const host = f.get('message-edit'), field = host.children[0];
      assert.equal(f.document.activeElement === field, true); assert.equal(f.reader.dialog.dataset.editing, 'true');
      field.value = 'Exact revised words'; field.handlers.input();
      if (ending === 'Use saved') {
        x.conflict(); await host.querySelector('[data-act="save"]').onclick(); await settle();
        assert.equal(session.writing.state, 'conflict'); assert.equal(host.children[1].hidden, false);
        await host.querySelector('[data-act="saved"]').onclick();
      } else if (ending === 'Save') await host.querySelector('[data-act="save"]').onclick();
      else if (ending === 'Cancel') await host.querySelector('[data-act="cancel"]').onclick();
      else f.reader.escape();
      await settle();
      assert.equal(f.runObservation('messageEdit'), null, entry + ': the actual finish/leave owner ended Edit');
      assert.equal(f.reader.dialog.open, true); assert.equal(f.reader.editing, null); assert.equal(f.reader.sourceBody.hidden, false);
      assert.equal(f.document.activeElement === f.get('reader-menu'), true, entry + ': focus returns to the Reader More control, not its inert feed card');
      assert.equal(session.writing.closed, true);
      assert.equal(session.writing.state, { Save: 'saved', Cancel: 'cancelled', 'Use saved': 'discarded', Escape: 'editing' }[ending]);
      assert.deepEqual(x.commands.map(sent => sent.kind), ending === 'Save' ? ['message.edit_open', 'message.edit']
        : ending === 'Use saved' ? ['message.edit_open', 'message.edit', 'message.edit_close']
        : ending === 'Cancel' ? ['message.edit_open', 'message.edit_close'] : ['message.edit_open']);
      if (ending === 'Save') assert.equal(f.registry.current.source.body, 'Exact revised words');
      if (ending === 'Use saved') assert.equal(f.registry.current.source.body, 'Saved on another device');
      if (ending === 'Escape') assert.equal(f.runObservation('device890.held.value'), 'Exact revised words');
    } finally { f.runObservation('messageEdit?.writing.close()'); }
  }
});
test('890 Build2 a late outcome_light answer removes the stale pencil when its shared Edit recheck refuses', async () => {
  const light = defer();
  const x = await editClick890({ beforeInitialize(f) {
    const read = f.api.view; f.api.view = (name, args, options) => name === 'outcome_light' ? light.promise : read(name, args, options);
  } }), { f } = x, menu = f.runObservation('menu');
  try {
    // The bar borrows the page's New message SVG; this check is eligibility,
    // while the shared glyph fixture owns drawing assertions.
    f.get('new-message').append(f.document.createElement('svg'));
    menu.lit = x.card; menu.paintBar(); assert.equal(menu.buttons.edit.hidden, false);
    light.resolve({ instance_id: 'fixture', lead: { kind: 'reached' } }); await settle();
    assert.equal(f.runObservation('outcomeReached'), true, 'actual background read changed shared rights');
    assert.equal(menu.buttons.edit.hidden, false, 'no background repaint: this is the stale control');
    await menu.buttons.edit.onclick(); await settle();
    assert.equal(x.edits.length, 0); assert.equal(menu.buttons.edit.hidden, true, 'the rejected stale press repaints the bar');
  } finally { light.resolve({ instance_id: 'fixture' }); }
});

// Item899 exercises actual + Add, command adapter, outcome refresh and topic
// projection owners. Transport records/receipts and DOM are in memory only.
async function coordinatorPage899({ owner = 'fixture-person', coordinator = 'ally', member = true, prepare = () => {} } = {}) {
  const f = fixture('https://fixture/?workspace=w1');
  // This picker is removed and reoffered as permissions change. Native
  // remove() clears parentNode; the generic inline fake only unlists it.
  const create = f.document.createElement.bind(f.document);
  f.document.createElement = tag => {
    const element = create(tag), remove = element.remove.bind(element);
    element.remove = () => { remove(); element.parent = null; };
    return element;
  };
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.live = stream(); f.useLive(f.live);
  Object.assign(f.bootstrap.authority, { authority_id: 'a899', authority_epoch: 'e899' });
  pickerApi(f, { workspace: { owner_id: owner, coordinator_id: coordinator } });
  if (!member) f.pickers.members = f.pickers.members.filter(row => row.actor_id !== 'fixture-person');
  f.pickers.members.push({ actor_id: 'other899', name: 'Other member', kind: 'human', enabled: true });
  f.pickers.actors.push({ id: 'outside899', name: 'Not on team', kind: 'agent' });
  const receipts = new Map();
  const exact = (request, more) => ({ instance_id: 'fixture', operation_id: request.operation_id, kind: request.kind, recorded: true, ...more });
  const apply = request => {
    if (receipts.has(request.operation_id)) return receipts.get(request.operation_id);
    assert.equal(request.kind, 'workspace.coordinator_set');
    let answer;
    if (request.expected.workspace_revision !== f.pickers.workspace.version) answer = exact(request, { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed; preserve this attempt and reconcile', current_versions: { workspace_revision: f.pickers.workspace.version } } });
    else if (request.args.actor_id !== null && !f.pickers.members.some(row => row.actor_id === request.args.actor_id)) answer = exact(request, { status: 'rejected', error: { code: 'INVALID_RECIPIENT', message: 'The coordinator must belong to the outcome’s team.' } });
    else {
      if (f.pickers.workspace.coordinator_id !== request.args.actor_id) { f.pickers.workspace.coordinator_id = request.args.actor_id; f.pickers.workspace.version++; }
      answer = exact(request, { status: 'committed', result: { workspace_id: 'w1', coordinator_id: request.args.actor_id, version: f.pickers.workspace.version } });
    }
    receipts.set(request.operation_id, answer); return answer;
  };
  f.api.command = async request => { f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); return apply(request); };
  await prepare(f, { apply, exact });
  await f.initialize(); await drain();
  const panel = () => f.runObservation('teamPanel');
  const row = () => walk(f.get('team-people')).find(node => node.classList?.contains('coordinator-choice'));
  const choices = () => walk(f.get('team-people')).filter(node => node.dataset?.coordinator !== undefined);
  const notice = () => walk(f.get('team-people')).find(node => node.classList?.contains('coordinator-notice'));
  const open = () => {
    assert.ok(panel().opener.parentNode, 'this team member can open + Add');
    panel().toggle(true); assert.ok(row(), 'Coordinator row is offered'); row().onclick();
    return choices();
  };
  const choose = async id => {
    const button = choices().find(node => node.dataset.coordinator === (id ?? ''));
    assert.ok(button, 'only an offered member or Nobody can be picked');
    await button.onclick(); await drain();
  };
  const sent = () => f.calls.filter(call => call.kind === 'workspace.coordinator_set').map(call => call.envelope);
  return { f, panel, row, choices, notice, open, choose, sent, apply, exact };
}

test('899 Coordinator row names current member above Invite and offers only team plus Nobody', async () => {
  const p = await coordinatorPage899(); p.open();
  assert.equal(p.row().textContent, 'Coordinator: Ally');
  assert.deepEqual(p.choices().map(node => [node.dataset.coordinator, node.textContent]), [['', 'Nobody'], ['fixture-person', 'Fixture'], ['ally', 'Ally'], ['other899', 'Other member']]);
  const extra = p.panel().choices.children;
  assert.ok(extra.indexOf(p.row()) >= 0); assert.ok(extra.indexOf(p.row()) < extra.indexOf(p.f.runObservation('teamInvite.opener')));
  assert.equal(extra.at(-1), p.f.runObservation('teamInvite.opener'), 'Invite remains last');
  assert.equal(p.sent().length, 0, 'opening makes no change');
});

test('899 ordinary member may choose coordinator without management controls or Invite', async () => {
  const p = await coordinatorPage899({ owner: 'someone-else' }); p.open();
  assert.equal(p.panel().input.hidden, true);
  assert.equal(walk(p.f.get('team-people')).some(node => node.textContent === '×'), false);
  assert.equal(p.f.runObservation('teamInvite.opener.hidden'), true);
  assert.equal(p.f.get('outcome-purpose').hidden, true);
  await p.choose('other899'); assert.equal(p.row().textContent, 'Coordinator: Other member');
});

test('899 nonmember receives no coordinator capability', async () => {
  const p = await coordinatorPage899({ owner: 'someone-else', coordinator: 'ally', member: false });
  assert.equal(p.panel().opener.parentNode === null, true);
  assert.ok(!p.row() || p.row().hidden); assert.equal(p.sent().length, 0);
});

test('899 a pick sends one exact viewed-revision authority command then rereads actual coordinator', async () => {
  const p = await coordinatorPage899(); p.open(); await p.choose('other899');
  assert.equal(p.sent().length, 1);
  const request = p.sent()[0];
  assert.deepEqual([request.kind, request.target, request.expected, request.args], ['workspace.coordinator_set', { workspace_id: 'w1' }, { workspace_revision: 5, authority: { authority_id: 'a899', authority_epoch: 'e899' } }, { actor_id: 'other899' }]);
  assert.ok(request.operation_id); assert.equal(p.row().textContent, 'Coordinator: Other member');
  assert.equal(p.f.calls.filter(call => call.name === 'workspace').length >= 2, true);
});

test('899 Nobody clears coordinator immediately with null', async () => {
  const p = await coordinatorPage899(); p.open(); await p.choose(null);
  assert.equal(p.sent()[0].args.actor_id, null); assert.equal(p.row().textContent, 'Coordinator: Nobody');
});

test('899 stale pick refuses once, preserves reason and shows actual current coordinator', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.pickers.workspace.version++; p.f.pickers.workspace.coordinator_id = 'fixture-person';
  await p.choose('other899');
  assert.equal(p.sent().length, 1, 'no setPresence conflict auto-retry');
  assert.equal(p.notice().textContent, 'Someone else changed this at the same moment. Try again.'); assert.equal(p.notice().hidden, false);
  assert.equal(p.row().textContent, 'Coordinator: Fixture');
});

test('899 a target who left the team is refused and removed from refreshed choices', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.pickers.members = p.f.pickers.members.filter(row => row.actor_id !== 'other899');
  await p.choose('other899');
  assert.match(p.notice().textContent, /must belong/); assert.equal(p.row().textContent, 'Coordinator: Ally');
  p.open(); assert.equal(p.choices().some(node => node.dataset.coordinator === 'other899'), false);
});

test('899 pending pick never relabels coordinator or sends a double pick', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => { f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return apply(request); }; } });
  p.open(); const target = p.choices().find(node => node.dataset.coordinator === 'other899');
  const pending = target.onclick(); await settle(); const second = target.onclick(); await settle();
  try {
    assert.equal(p.sent().length, 1); assert.equal(p.row().textContent, 'Coordinator: Ally');
    assert.ok(p.choices().every(node => node.disabled));
  } finally { gate.resolve(); await Promise.all([pending, second]); await drain(); }
  assert.equal(p.row().textContent, 'Coordinator: Other member');
});

test('899 lost response retry keeps exact operation without claiming success', async () => {
  let attempts = 0;
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => { f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); if (++attempts === 1) throw Error('Fixture connection lost'); return apply(request); }; } });
  p.open(); await p.choose('other899'); assert.match(p.notice().textContent, /connection lost/);
  assert.equal(p.row().textContent, 'Coordinator: Ally');
  p.open(); await p.choose('other899');
  assert.deepEqual(p.sent()[1], p.sent()[0]); assert.equal(p.row().textContent, 'Coordinator: Other member');
});

test('899 unconfirmed receipt never claims success and a failed reread stays visible', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.api.command = async request => { p.f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); return p.exact(request, { status: 'committed', operation_id: 'some-other-operation', result: { workspace_id: 'w1', coordinator_id: 'other899', version: 6 } }); };
  const view = p.f.api.view;
  p.f.api.view = async (name, args) => { if (name === 'workspace') throw Error('Fixture refresh offline'); return view(name, args); };
  await p.choose('other899');
  assert.equal(p.row().textContent, 'Coordinator: Ally'); assert.match(p.notice().textContent, /not confirmed/i); assert.match(p.notice().textContent, /refresh offline/);
});

test('899 actual picker key handlers reach choices and Escape returns to Coordinator then Add', async () => {
  const p = await coordinatorPage899(); p.panel().toggle(true); assert.ok(p.row(), 'Coordinator row is offered');
  const key = (node, key) => { const event = { key, isComposing: false, target: p.f.document.activeElement, preventDefault() {}, stopPropagation() {} }; (node.onkeydown ?? node.handlers.keydown)(event); };
  p.row().focus(); key(p.row(), 'ArrowDown'); assert.equal(p.f.document.activeElement, p.choices()[0]);
  const list = walk(p.f.get('team-people')).find(node => node.classList?.contains('coordinator-choices'));
  key(list, 'ArrowDown'); assert.equal(p.f.document.activeElement, p.choices()[1]);
  key(list, 'End'); assert.equal(p.f.document.activeElement, p.choices().at(-1));
  key(list, 'Escape'); assert.equal(list.hidden, true); assert.equal(p.f.document.activeElement, p.row());
  key(p.row(), 'Escape'); assert.equal(p.panel().row.hidden, true); assert.equal(p.f.document.activeElement, p.panel().opener);
  assert.equal(p.sent().length, 0);
});

test('899 existing commit refresh updates another open outcome page', async () => {
  const p = await coordinatorPage899(), other = await coordinatorPage899(); other.open();
  p.open(); await p.choose('other899');
  other.f.pickers.workspace = { ...p.f.pickers.workspace };
  await commit(other.f.live, 7);
  assert.equal(other.row().textContent, 'Coordinator: Other member');
});

test('899 duplicate displayed names use the same distinct team labels', async () => {
  const p = await coordinatorPage899({ prepare(f) { f.pickers.members[1].name = 'Alex'; f.pickers.members[2].name = 'Alex'; } });
  p.open(); assert.equal(p.row().textContent, 'Coordinator: Alex (ally)');
  assert.deepEqual(p.choices().filter(node => node.dataset.coordinator === 'ally' || node.dataset.coordinator === 'other899').map(node => node.textContent), ['Alex (ally)', 'Alex (other899)']);
});

test('899 late command result cannot repaint or refresh a replacement page choice', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { exact }) { f.api.command = async request => { f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return exact(request, { status: 'committed', result: { workspace_id: 'w1', coordinator_id: request.args.actor_id, version: 6 } }); }; } });
  p.open(); const pending = p.choices().find(node => node.dataset.coordinator === 'other899').onclick();
  p.f.runObservation("coordinatorChoice.paint({id:'w2',version:9,coordinator_id:null}, [{actor_id:'new-member',name:'Replacement'}], true)");
  const reads = p.f.calls.filter(call => call.name === 'workspace').length;
  gate.resolve(); await pending; await drain();
  assert.equal(p.row().textContent, 'Coordinator: Nobody');
  assert.equal(p.f.calls.filter(call => call.name === 'workspace').length, reads, 'the old command does not refresh a different page');
  assert.equal(p.notice().hidden, true); assert.equal(p.row().disabled, false);
});

test('899 older team read cannot restore an obsolete coordinator or choices', async () => {
  const p = await coordinatorPage899(); p.open(); const gate = defer(), view = p.f.api.view; let count = 0;
  p.f.api.view = async (name, args) => name === 'workspace_members' && ++count === 1 ? gate.promise : view(name, args);
  const older = p.f.runObservation("paintTeam({id:'w1',version:6,owner_id:'fixture-person',coordinator_id:'ally'}, async()=>{})");
  await settle();
  p.f.pickers.members = p.f.pickers.members.filter(row => row.actor_id !== 'ally');
  await p.f.runObservation("paintTeam({id:'w1',version:7,owner_id:'fixture-person',coordinator_id:'other899'}, async()=>{})");
  gate.resolve({ instance_id: 'fixture', items: [{ actor_id: 'fixture-person', name: 'Fixture' }, { actor_id: 'ally', name: 'Old Ally' }], next_cursor: null });
  await older;
  assert.equal(p.row().textContent, 'Coordinator: Other member'); p.open();
  assert.equal(p.choices().some(node => node.dataset.coordinator === 'ally'), false);
});

test('899 losing membership on refusal keeps its reason visible outside the closed Add popover', async () => {
  const p = await coordinatorPage899({ owner: 'someone-else' }); p.open();
  p.f.api.command = async request => { p.f.pickers.members = p.f.pickers.members.filter(row => row.actor_id !== 'fixture-person'); return p.exact(request, { status: 'rejected', error: { message: 'You are no longer on this team.' } }); };
  await p.choose('other899'); assert.equal(p.panel().opener.parentNode, null);
  assert.match(p.notice().textContent, /no longer on this team/);
  for (let at = p.notice(); at && at !== p.f.get('team-people'); at = at.parentElement) assert.equal(at.hidden, false, 'refusal remains readable after the capability goes away');
});

test('899 closing Add while a pick is pending keeps dismissal focus after success', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => { await gate.promise; return apply(request); }; } });
  p.open(); p.choices()[3].focus(); const pending = p.choices()[3].onclick();
  p.panel().toggle(false); assert.equal(p.f.document.activeElement, p.panel().opener);
  gate.resolve(); await pending; await drain();
  assert.equal(p.panel().row.hidden, true); assert.equal(p.f.document.activeElement === p.panel().opener, true);
});

test('899 changed authority drops an obsolete pending presentation without freezing the new one', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { exact }) { f.api.command = async request => { f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return exact(request, { status: 'committed', result: { workspace_id: 'w1', coordinator_id: request.args.actor_id, version: 6 } }); }; } });
  p.open(); const pending = p.choices()[3].onclick();
  p.f.bootstrap.authority.authority_epoch = 'new-epoch';
  p.f.runObservation('coordinatorChoice.paint()');
  gate.resolve(); await pending; await drain();
  assert.equal(p.row().textContent, 'Coordinator: Ally'); assert.equal(p.row().disabled, false);
  assert.equal(p.notice().hidden, true);
});

test('899 mismatched committed target is not treated as saved', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.api.command = async request => p.exact(request, { status: 'committed', result: { workspace_id: 'different-outcome', coordinator_id: 'other899', version: 6 } });
  await p.choose('other899'); assert.equal(p.row().textContent, 'Coordinator: Ally');
  assert.match(p.notice().textContent, /not confirmed/i);
});

test('899 existing workspace change key refreshes topic management through actual TopicViews', async () => {
  const f = fixture(); pickerApi(f, { topic: { owner_id: 'someone-else', creator_id: 'someone-else', coordinator_id: null } });
  await f.initialize(); await drain();
  const canAdd = () => Boolean(f.runObservation('participantsPanel.opener.parentNode'));
  assert.equal(canAdd(), false);
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => { if (kind === 'topic') { Object.assign(f.views, { topic: views.topic, participants: views.participants }); f.paintViews('topic'); } }, invalidate() {} });
  const keys = views.keys({ resource_kind: 'workspace', resource_id: 'w1', version: 8 });
  assert.deepEqual(keys, [{ key: 'topic', version: 0 }]);
  const read = async (name, args) => { assert.equal(name, 'topic'); assert.deepEqual(args, { topic_id: 't1' }); return { instance_id: 'fixture', topic: { ...f.pickers.topic, coordinator_id: 'fixture-person' }, participants: f.pickers.participants, summary: { topic_id: 't1', latest_message_id: null } }; };
  await views.refresh(keys[0].key, keys[0].version, read, () => true);
  assert.equal(canAdd(), true, 'existing topic refresh grants current coordinator management');
});

test('899 loss of outcome access keeps the refused pick reason on the surviving page notice', async () => {
  const p = await coordinatorPage899({ owner: 'someone-else' }); p.open();
  const view = p.f.api.view; let denied = false;
  p.f.api.command = async request => { denied = true; return p.exact(request, { status: 'rejected', error: { message: 'You are no longer on this team.' } }); };
  p.f.api.view = async (name, args) => {
    if (denied && name === 'workspace') throw Object.assign(Error('Outcome access was removed.'), { code: 'FORBIDDEN' });
    return view(name, args);
  };
  await p.choose('other899');
  assert.equal(p.f.get('outcome-team').hidden, true);
  assert.match(p.f.get('app-status').textContent, /no longer on this team/);
  assert.match(p.f.get('app-status').textContent, /Outcome access was removed/);
});

test('899 lost committed response rereads actual state and retry preserves the same operation', async () => {
  let attempts = 0;
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => {
    f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); const receipt = apply(request);
    if (++attempts === 1) throw Error('Fixture response lost after record'); return receipt;
  }; } });
  p.open(); await p.choose('other899');
  assert.equal(p.row().textContent, 'Coordinator: Other member', 'the refreshed record, not the transport failure, owns the displayed coordinator');
  assert.match(p.notice().textContent, /not confirmed/i); const version = p.f.pickers.workspace.version;
  p.open(); await p.choose('other899');
  assert.deepEqual(p.sent()[1], p.sent()[0]); assert.equal(p.f.pickers.workspace.version, version);
  assert.equal(p.notice().hidden, true);
});

test('899 failed membership read offers no stale choices and a later commit restores the capability', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.pickers.membersRefused = true; await commit(p.f.live, 11);
  assert.equal(p.row().hidden, true); assert.equal(p.choices().length, 0);
  assert.match(p.panel().notice.textContent, /team could not be read/i);
  assert.equal(p.sent().length, 0);
  p.f.pickers.membersRefused = false; await commit(p.f.live, 12); p.open();
  assert.equal(p.row().hidden, false); assert.equal(p.choices().length, 4);
});

test('899 a newer actual coordinator wins over the older successful receipt', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { exact }) { f.api.command = async request => {
    f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise;
    return exact(request, { status: 'committed', result: { workspace_id: 'w1', coordinator_id: request.args.actor_id, version: 6 } });
  }; } });
  p.open(); const pending = p.choices()[3].onclick();
  p.f.pickers.workspace.coordinator_id = 'fixture-person'; p.f.pickers.workspace.version = 8;
  gate.resolve(); await pending; await drain();
  assert.equal(p.row().textContent, 'Coordinator: Fixture');
  assert.equal(p.f.pickers.workspace.version, 8);
});

// 894: actual composer, editor, creation owner and memory command adapter.
function pencil894(answer, { popped = true } = {}) {
  const f = fixture(), requests = [], opened = [], saved = [];
  const editor = new Editor({ ...f.editor.context, instanceId: 'fixture', actor: 'fixture-person' }, { id: 'draft-894', generation: 'g', revision: 1, body: 'Title\nBody' });
  f.p.editors.reply = editor;
  const api = { command: async request => {
    requests.push(structuredClone(request));
    if (answer) return answer(request, requests.length);
    return receipt894(request);
  } };
  f.inline.callbacks.notebook = { api, bootstrap: f.bootstrap, mayWrite: true, open: async (id, options) => opened.push({ id, options }) };
  f.inline.callbacks.edit = e => { saved.push(e.draft.body); return Promise.resolve(); };
  const sheet = f.inline.sheet; sheet.open = false;
  sheet.showModal = () => { sheet.open = true; };
  sheet.close = () => { sheet.open = false; sheet.handlers.close?.(); };
  sheet.getBoundingClientRect = () => ({ height: 80 }); sheet.before = () => {};
  sheet.style.removeProperty = name => delete sheet.style[name]; sheet.style.setProperty = (name, value) => { sheet.style[name] = value; };
  f.document.defaultView.getComputedStyle = () => ({ marginTop: '0px', marginBottom: '0px' });
  f.inline.bar.fit = () => {}; // Geometry only; real folding, admission and handlers remain.
  // These selectors must find actual intent descendants, never the generic fixture's id fallback.
  const scoped = node => {
    const one = node.querySelector.bind(node), all = node.querySelectorAll.bind(node);
    node.querySelectorAll = selector => selector === 'button[data-intent]'
      ? walk(node).filter(child => child.tagName === 'BUTTON' && child.dataset.intent !== undefined) : all(selector);
    node.querySelector = selector => ['.intent-choice', '.audience-line'].includes(selector)
      ? walk(node).find(child => child.classList?.contains(selector.slice(1))) ?? null : one(selector);
    return node;
  };
  const create = f.document.createElement; f.document.createElement = tag => scoped(create(tag));
  scoped(f.get('inline-intent-row')); scoped(f.get('inline-who-sentence'));
  f.get('inline-who-panel').append(f.get('inline-intent-row'), f.get('inline-who-sentence'));
  let noticeText = '';
  Object.defineProperty(f.get('inline-notice'), 'textContent', { get: () => noticeText,
    set(value) { noticeText = value; this.replaceChildren(); } });
  // Mount the controls under the real root so ComposeBar owns their focus and fold.
  const root = f.inline.root, group = f.get('inline-kind');
  const fieldBox = f.document.createElement('div'); fieldBox.className = 'field-box'; fieldBox.append(f.inline.field);
  root.append(group, f.get('inline-notice'), f.get('inline-who-chip'), f.get('inline-who-panel'),
    f.get('inline-plus-button'), f.get('inline-plus-panel'), f.get('inline-attachments'), fieldBox, f.get('inline-send'));
  for (const kind of ['message', 'note-card']) group.append(f.get('inline-kind-' + kind));
  for (const node of [f.inline.field, ...group.children]) {
    node.focus = () => { f.document.activeElement = node; root.handlers.focusin({ target: node }); };
    node.blur = () => { if (f.document.activeElement === node) f.document.activeElement = null; };
  }
  f.inline.presentation = null; f.inline.show(f.p); if (popped) f.inline.pop();
  const choose = kind => { const button = f.get('inline-kind-' + kind); button.focus();
    assert.ok(root.contains(button)); assert.equal(typeof button.handlers.click, 'function'); return button.handlers.click(); };
  const write = body => { editor.edit({ body, caret: { start: body.length, end: body.length } }); f.inline.drawEditor(); };
  return { ...f, editor, requests, opened, saved, sheet, choose, write };
}
function receipt894(request) {
  return { instance_id: request.instance_id, operation_id: request.operation_id, kind: request.kind, status: 'committed', recorded: true,
    result: { item_id: request.target.item_id, revision: 1, owner_scope: request.target.owner_scope } };
}

function target911(f, value) {
  const select = f.get('inline-note-page'); select.value = value;
  select.handlers.change?.({ target: select });
}
function destinations911(f, append = async () => {}) {
  const added = [];
  Object.assign(f.inline.callbacks.notebook, {
    pages: async () => [{ id: 'n-newer', name: 'Newest page' }, { id: 'n-older', name: 'Notebook page' }],
    append: async (id, job) => { added.push({ id, job }); await append(id, job); job.card = 'c-added'; },
  });
  return added;
}
test('911 Note offers rail names with New page first; Message hides the selector', async () => {
  const f = pencil894(); destinations911(f);
  assert.equal(f.get('inline-note-page').hidden, true);
  f.choose('note-card'); await drain();
  const select = f.get('inline-note-page');
  assert.equal(select.hidden, false);
  assert.deepEqual(select.children.map(option => [option.value, option.textContent]), [['', 'New page'], ['n-newer', 'Newest page'], ['n-older', 'Notebook page']]);
  assert.equal(select.value, '');
  f.choose('message'); assert.equal(select.hidden, true);
});
test('911 chosen page appends and opens the confirmed card without creating a page', async () => {
  const f = pencil894(), added = destinations911(f);
  f.choose('note-card'); await drain(); target911(f, 'n-older');
  assert.equal(f.get('inline-send').querySelector('.send-word').textContent, 'Add card');
  await f.inline.send();
  assert.equal(added.length, 1); assert.equal(added[0].id, 'n-older'); assert.equal(added[0].job.body, 'Title\nBody');
  assert.equal(f.requests.length, 0); assert.equal(f.editor.draft.body, '');
  assert.equal(f.opened[0].id, 'n-older'); assert.equal(f.opened[0].options.card, 'c-added');
  assert.equal(f.opened[0].options.mode, 'cards'); assert.equal(f.opened[0].options.beside, true);
});
test('911 vanished page refuses with writing kept and no fallback creation', async () => {
  const f = pencil894(); destinations911(f, async () => { throw Error('This Notebook page is no longer available.'); });
  f.choose('note-card'); await drain(); target911(f, 'n-older'); await f.inline.send();
  assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.sheet.open, true);
  assert.equal(f.requests.length, 0); assert.equal(f.opened.length, 0);
  assert.match(f.get('inline-notice').textContent, /no longer available/);
});
test('911 each sheet opening resets the target to New page while retaining writing', async () => {
  const f = pencil894(); destinations911(f);
  f.choose('note-card'); await drain(); target911(f, 'n-older');
  f.sheet.close(); f.inline.pop(); f.choose('note-card'); await drain();
  assert.equal(f.get('inline-note-page').value, '');
  await f.inline.send(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].kind, 'memory.create');
});
test('911 an append answering after another opening cannot consume newer writing', async () => {
  const gate = defer(), f = pencil894(), added = destinations911(f, () => gate.promise);
  f.choose('note-card'); await drain(); target911(f, 'n-older'); const saving = f.inline.send();
  f.sheet.close(); f.inline.pop(); f.write('Later writing'); gate.resolve(); await saving;
  assert.equal(added.length, 1); assert.equal(f.requests.length, 0);
  assert.equal(f.editor.draft.body, 'Later writing'); assert.equal(f.sheet.open, true); assert.equal(f.opened.length, 0);
});
test('911 empty topic keeps only New page and a stale list cannot repaint a later opening', async () => {
  const f = pencil894(null, { popped: false }), gate = defer();
  f.inline.callbacks.notebook.pages = () => gate.promise;
  f.choose('note-card');
  assert.deepEqual(f.get('inline-note-page').children.map(option => option.textContent), ['New page']);
  f.inline.pop(); gate.resolve([{ id: 'stale', name: 'Old opening' }]); await drain();
  assert.equal(f.get('inline-note-page').hidden, true);
  assert.equal(f.inline.notePages.length, 0);
  f.inline.callbacks.notebook.pages = async () => []; f.choose('note-card'); await drain();
  assert.deepEqual(f.get('inline-note-page').children.map(option => option.textContent), ['New page']);
});
test('911 actual app connects the current topic rail and existing Notebook sheet append owner', async () => {
  const added = [], opened = [];
  const f = fixture(undefined, { NotebookSheet: class {
    appendNote(id, job) { added.push({ id, job }); }
    canDock() { return true; } holds() { return false; }
    open(id, options) { opened.push({ id, options }); }
  } });
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    const result = await view(name, args, options);
    return name === 'memory_items' ? { ...result, items: [{ id: 'p-real', title: 'Rail name' }] } : result;
  };
  f.registry.initializeInline = async () => f.p;
  await f.initialize(); await drain();
  // initialize() starts a page run without begin()'s persistent shell DOM.
  // Supply that shell-owned rail with its actual list methods and page port.
  f.runObservation('panes.things = Object.create(ThingsRail.prototype); panes.things.handles = { topic, view: pipelineView };');
  const notebook = f.owners().inline.callbacks.notebook, job = { words: 'Exact writing' };
  assert.deepEqual(JSON.parse(JSON.stringify(await notebook.pages())), [{ id: 'p-real', name: 'Rail name' }]);
  await notebook.append('p-real', job); assert.equal(added[0].id, 'p-real'); assert.ok(added[0].job === job);
  await notebook.open('p-real', { mode: 'cards', beside: true, card: 'c-target' });
  assert.equal(opened[0].id, 'p-real'); assert.equal(opened[0].options.card, 'c-target');
});

test('925 two choices use one writing field, keep caret and default to Message on every opening', () => {
  const f = pencil894();
  assert.equal(f.get('inline-kind').hidden, false);
  assert.equal(f.get('inline-kind-message').getAttribute('aria-checked'), 'true');
  const words = f.editor.draft.body, caret = f.editor.draft.caret;
  for (const kind of ['note-card', 'message']) {
    f.choose(kind); assert.equal(f.editor.draft.body, words); assert.deepEqual(f.editor.draft.caret, caret);
    assert.equal(f.get('inline-kind-' + kind).getAttribute('aria-checked'), 'true');
  }
  f.choose('note-card'); f.sheet.close(); f.inline.pop();
  assert.equal(f.get('inline-kind-message').getAttribute('aria-checked'), 'true', 'a Note chosen last time does not carry over');
  assert.equal(f.requests.length, 0);
  const html = webSource('index.html');
  assert.match(html, /id="inline-kind"[^>]*role="radiogroup"[^>]*aria-label="Create"/);
  assert.equal((html.match(/id="inline-kind-[^"]+"[^>]*role="radio"/g) ?? []).length, 2);
});

test('894 radio arrows and Home/End select, focus and wrap with one tab stop', () => {
  const f = pencil894();
  const press = (from, key, to) => {
    let stopped = false;
    assert.equal(typeof f.get('inline-kind-' + from).handlers.keydown, 'function', 'radio keys are wired');
    f.get('inline-kind-' + from).handlers.keydown({ key, preventDefault() { stopped = true; }, stopPropagation() {} });
    assert.ok(stopped); assert.equal(f.document.activeElement, f.get('inline-kind-' + to));
    assert.equal(f.get('inline-kind-' + to).tabIndex, 0);
    for (const kind of ['message', 'note-card'].filter(k => k !== to)) assert.equal(f.get('inline-kind-' + kind).tabIndex, -1);
  };
  press('message', 'ArrowLeft', 'note-card'); press('note-card', 'ArrowRight', 'message');
  press('message', 'ArrowDown', 'note-card'); press('message', 'End', 'note-card'); press('note-card', 'Home', 'message');
});

for (const kind of ['note-card']) test(`894 ${kind} sends only memory.create and opens the intended view after confirmed save`, async () => {
  const f = pencil894(); f.choose(kind);
  await f.inline.send();
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.kind, 'memory.create'); assert.deepEqual(request.target.owner_scope, { kind: 'topic', id: 't1' });
  assert.equal(request.args.title, 'Title'); assert.equal(request.args.body, kind === 'note-card' ? '## Title\n\nBody\n' : 'Body');
  assert.deepEqual(Object.keys(request.args).sort(), ['attachments', 'body', 'references', 'title']);
  assert.equal(f.editor.draft.body, ''); assert.deepEqual(f.saved, ['']); assert.equal(f.sheet.open, false);
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0].id, request.target.item_id);
  assert.equal(f.opened[0].options.mode, kind === 'note-card' ? 'cards' : 'text'); assert.equal(f.opened[0].options.beside, true);
});

for (const kind of ['note-card']) test(`894 empty ${kind} starts Notebook page`, async () => {
  const f = pencil894(); f.write(''); f.choose(kind);
  assert.equal(f.get('inline-send').disabled, false);
  await f.inline.send(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].args.title, 'Notebook page');
  assert.equal(f.requests[0].args.body, kind === 'note-card' ? '## Notebook page\n' : '');
});

test('894 Notebook recipient controls stay hidden; 926 image controls remain available', async () => {
  const f = pencil894(); f.editor.edit({ addressees: ['fable'], intent: 'ask' });
  f.choose('note-card'); f.inline.paintStatus();
  for (const name of ['who-chip', 'who-panel', 'writing-to']) assert.equal(f.get('inline-' + name).hidden, true, name);
  for (const name of ['plus-button', 'attachments']) assert.equal(f.get('inline-' + name).hidden, false, name);
  assert.equal(f.get('inline-send').querySelector('.send-word').textContent, 'Start page');
  f.inline.addName('warp'); f.inline.choose('tell');
  assert.deepEqual(f.editor.draft.addressees, ['fable']); assert.equal(f.editor.draft.intent, 'ask');
  assert.equal(f.inline.imagePicker, undefined); assert.equal(f.requests.length, 0);
  f.choose('message'); assert.equal(f.get('inline-who-chip').hidden, false); assert.equal(f.get('inline-plus-button').hidden, false);
});

test('894 refused creation keeps writing, message choices and the sheet, with the reason visible', async () => {
  const f = pencil894(r => ({ ...receipt894(r), status: 'rejected', error: { code: 'FORBIDDEN', message: 'This topic is read-only.' } }));
  f.choose('note-card'); await f.inline.send();
  assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.sheet.open, true); assert.equal(f.opened.length, 0);
  assert.match(f.get('inline-notice').textContent, /This topic is read-only/);
});

test('894 lost answer retries the exact operation for unchanged writing and kind', async () => {
  const f = pencil894((r, n) => { if (n === 1) throw Error('offline'); return receipt894(r); });
  f.choose('note-card'); await f.inline.send();
  assert.match(f.get('inline-notice').textContent, /Choose Start page to try once more/);
  f.choose('note-card'); await f.inline.send(); assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.opened.length, 1);
});

test('894 a late confirmation keeps a reopened sheet and newer writing, and offers the created page without another create', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => receipt894(r)));
  f.choose('note-card'); const sending = f.inline.send();
  assert.equal(f.inline.field.readOnly, true); assert.equal(f.get('inline-send').disabled, true);
  await f.inline.send(); assert.equal(f.requests.length, 1);
  f.sheet.close(); f.inline.pop();
  f.editor.edit({ body: 'Newer recovered writing' }); // a recovery owner can replace writing while the DOM is disabled.
  d.resolve(); await sending;
  assert.equal(f.sheet.open, true); assert.equal(f.editor.draft.body, 'Newer recovered writing'); assert.equal(f.opened.length, 0);
  const button = f.get('inline-notice').children.find(n => n.textContent === 'Open started page'); assert.ok(button);
  await button.onclick(); assert.equal(f.requests.length, 1); assert.equal(f.opened.length, 1); assert.equal(f.editor.draft.body, 'Newer recovered writing');
});

test('894 Message retains its publication callback and never creates a Notebook page', async () => {
  const f = pencil894(); f.choose('message'); let sends = 0;
  f.inline.callbacks.send = async () => { sends++; return { status: 'confirmed' }; };
  await f.inline.send(); assert.equal(sends, 1); assert.equal(f.requests.length, 0); assert.equal(f.opened.length, 0);
});

test('894 another opening during the writing save cannot be dismissed by completion', async () => {
  const f = pencil894(), saved = defer();
  f.inline.callbacks.edit = () => saved.promise;
  f.choose('note-card'); const sending = f.inline.send();
  await new Promise(setImmediate); // create confirmed; clearing exact writing now awaits its existing save owner
  f.sheet.close(); f.inline.pop(); f.editor.edit({ body: 'Fresh words' });
  saved.resolve(); await sending;
  assert.equal(f.sheet.open, true); assert.equal(f.editor.draft.body, 'Fresh words'); assert.equal(f.opened.length, 0);
  assert.ok(f.get('inline-notice').children.find(n => n.textContent === 'Open started page'));
});

test('926 changing kind preserves the shared file reservation for the same writing', async () => {
  const f = pencil894(), calls = [];
  f.inline.imagePicker = { token: 'pending', uploads: { cancel: id => calls.push(['cancel', id]), choose: () => calls.push(['choose']) } };
  f.choose('note-card'); await f.get('inline-image-file').onchange({ target: { files: [{}] } });
  assert.deepEqual(calls, [['choose']]); assert.equal(f.editor.draft.body, 'Title\nBody');
});

test('894 real app constructor wires the existing command client and bootstrap into Notebook creation', () => {
  const f = fixture(), app = webSource('app.mjs');
  const owner = app.slice(app.indexOf('  inline = new InlineComposer({'), app.indexOf('  reader = new Reader({'));
  const capability = f.runObservation('(() => { const topicImages = () => {}, imageBytes = () => {}, memoryAnswer = { reader_may_write: true }; ' + owner + '; return inline.callbacks.notebook; })()');
  assert.ok(capability, 'topic pencil receives Notebook creation capability');
  assert.equal(capability.api, f.api); assert.equal(capability.bootstrap, f.bootstrap); assert.equal(typeof capability.open, 'function'); assert.equal(capability.mayWrite, true);
});

test('894 a confirmation for an inactive presentation never clears writing or navigates', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => receipt894(r)));
  f.choose('note-card'); const sending = f.inline.send(); f.registry.current = { surface: 'reader' };
  d.resolve(); await sending;
  assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.opened.length, 0);
  f.registry.current = null; f.inline.show(f.p);
  const open = f.get('inline-notice').children.find(n => n.textContent === 'Open started page'); assert.ok(open);
  await open.onclick(); assert.equal(f.requests.length, 1); assert.equal(f.opened.length, 1);
});

test('894 empty Notebook starts still honor access, recovery, conflict and in-flight message preparation', async () => {
  const f = pencil894(); f.write(''); f.choose('note-card');
  for (const flag of ['adopting', 'unavailable', 'authorityRecovery', 'conflict']) {
    f.editor[flag] = true; await f.inline.send(); assert.equal(f.requests.length, 0, flag); f.editor[flag] = null;
  }
  f.editor.submissions.push({ status: 'preparing' }); await f.inline.send(); assert.equal(f.requests.length, 0);
  f.editor.submissions = []; f.registry.current = {}; await f.inline.send(); assert.equal(f.requests.length, 0);
});

test('894 a reopened unchanged draft is not consumed or closed by its earlier create', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => receipt894(r)));
  f.choose('note-card'); const sending = f.inline.send(); f.sheet.close(); f.inline.pop();
  d.resolve(); await sending;
  assert.equal(f.sheet.open, true); assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.opened.length, 0);
});

test('894 a recovered newer version in the same opening is not dismissed by an older create', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => receipt894(r)));
  f.choose('note-card'); const sending = f.inline.send(); f.editor.edit({ body: 'Recovered newer writing' });
  d.resolve(); await sending;
  assert.equal(f.sheet.open, true); assert.equal(f.editor.draft.body, 'Recovered newer writing'); assert.equal(f.opened.length, 0);
});

test('894 openNotebook is the single opening door for docked and phone/full-page creations', async () => {
  const app = webSource('app.mjs');
  const body = app.slice(app.indexOf('function openNotebook(id,'), app.indexOf('// An outcome\'s Notebook page opening'));
  const calls = [], sheet = { canDock: () => true, open: (id, options) => calls.push(['sheet', id, options]) };
  const open = new Function('notebookSheetOf', 'openDestination', body + '\nreturn openNotebook;')(() => sheet, (route, label) => calls.push(['page', route, label]));
  open('new', { beside: true, mode: 'text' }); assert.equal(calls[0][0], 'sheet');
  sheet.canDock = () => false;
  open('phone', { beside: true, mode: 'text' }); assert.deepEqual(calls[1][1], { kind: 'cards', id: 'phone', view: 'text' });
  open('card', { beside: true, mode: 'cards' }); assert.deepEqual(calls[2][1], { kind: 'cards', id: 'card' });
  open('existing'); assert.equal(calls[3][0], 'sheet', 'ordinary Notebook openings keep their behavior');
});

// Build 2: the mounted owner catches folding/blur, and the actual image gate is driven.
test('894 B2 mounted radio clicks preserve writing state, caret, and focus', () => {
  const f = pencil894(); f.editor.edit({ caret: { start: 2, end: 4 } }); f.inline.drawEditor();
  for (const kind of ['note-card', 'message']) {
    f.choose(kind);
    assert.equal(f.inline.root.dataset.compose, 'writing');
    assert.equal(f.document.activeElement, f.get('inline-kind-' + kind));
    assert.equal(f.inline.field.selectionStart, 2); assert.equal(f.inline.field.selectionEnd, 4);
  }
});

test('894 B2 Message restores its label, recipients, intent and images after Note and close', () => {
  const f = pencil894(); f.editor.edit({ addressees: ['fable'], intent: 'ask' });
  const image = { selection_id: 'image', file: { name: 'kept.png' }, attempts: [], choice: 0, bytes_state: 'durable', version: 1 };
  f.inline.callbacks.uploads = () => ({ current: () => [image], running: new Map(), status: () => 'Ready' });
  for (const kind of ['note-card']) {
    f.choose(kind); f.choose('message');
    assert.equal(f.get('inline-attachments').hidden, false);
    assert.ok(f.get('inline-attachments').children.length, 'retained image is painted');
    assert.equal(f.get('send-word').textContent, 'Ask');
    assert.equal(f.get('inline-who-chip').hidden, false); assert.equal(f.get('inline-plus-button').hidden, false);
    assert.deepEqual(f.editor.draft.addressees, ['fable']); assert.equal(f.editor.draft.intent, 'ask');
    const ask = f.get('inline-intent-row').querySelectorAll('button[data-intent]').find(button => button.dataset.intent === 'ask');
    assert.ok(ask); assert.equal(ask.getAttribute('aria-pressed'), 'true'); assert.equal(ask.disabled, false);
  }
  f.choose('note-card'); f.sheet.close();
  // Closing goes back to Message (item 925): the image and the Ask intent are painted again.
  assert.equal(f.get('inline-attachments').hidden, false); assert.equal(f.get('send-word').textContent, 'Ask');
  f.inline.pop(); assert.equal(f.get('inline-attachments').hidden, false); assert.equal(f.get('send-word').textContent, 'Ask');
  f.choose('note-card'); assert.equal(f.get('inline-attachments').hidden, false); assert.equal(f.get('send-word').textContent, 'Start page');
  f.choose('message'); assert.equal(f.get('inline-attachments').hidden, false); assert.equal(f.get('send-word').textContent, 'Ask');
});

test('910 kind selector shows in the resting feed but requires explicit Notebook write access', () => {
  const f = pencil894(); f.sheet.close(); f.inline.paintStatus(); assert.equal(f.get('inline-kind').hidden, false);
  for (const permission of [false, undefined, 'true']) {
    f.inline.callbacks.notebook.mayWrite = permission; f.inline.pop();
    assert.equal(f.get('inline-kind').hidden, true); f.choose('note-card'); assert.equal(f.inline.kind, 'message'); f.sheet.close();
  }
  f.inline.callbacks.notebook.mayWrite = true; f.inline.pop(); assert.equal(f.get('inline-kind').hidden, false);
});

test('926 actual ImagePick admission serves Note and Message', () => {
  const f = pencil894(); f.inline.callbacks.images = async () => []; f.choose('message');
  assert.equal(f.inline.images.admits(), true);
  f.choose('note-card'); assert.equal(f.inline.images.admits(), true);
  f.choose('note-card'); assert.equal(f.inline.images.admits(), true);
  f.choose('message'); assert.equal(f.inline.images.admits(), true);
});

test('894 B2 late refusal reaches the reopened same editor', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => ({ ...receipt894(r), status: 'rejected', error: { code: 'FORBIDDEN', message: 'Notebook access was removed.' } })));
  f.choose('note-card'); const sending = f.inline.send(); f.sheet.close(); f.inline.pop();
  d.resolve(); await sending;
  assert.match(f.get('inline-notice').textContent, /Notebook access was removed/); assert.equal(f.sheet.open, true);
  assert.equal(f.editor.draft.body, 'Title\nBody');
});

test('894 B2 a confirmed earlier page does not take over Start page for new writing', async () => {
  const d = defer(), f = pencil894((r, n) => n === 1 ? d.promise.then(() => receipt894(r)) : receipt894(r));
  f.choose('note-card'); const sending = f.inline.send(); f.editor.edit({ body: 'New title\nNew body' });
  d.resolve(); await sending;
  const earlier = f.get('inline-notice').children.find(n => n.textContent === 'Open started page'); assert.ok(earlier);
  await f.inline.send(); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].args.title, 'New title');
  assert.notEqual(f.requests[1].operation_id, f.requests[0].operation_id); assert.equal(f.opened[0].id, f.requests[1].target.item_id);
  f.inline.show(f.p); assert.ok(f.get('inline-notice').children.find(n => n.textContent === 'Open started page'));
  await earlier.onclick(); assert.equal(f.opened[1].id, f.requests[0].target.item_id);
});

test('894 B2 uncertain earlier writing allows a new page and keeps an exact retry action', async () => {
  const f = pencil894((r, n) => { if (n === 1) throw Error('offline'); return receipt894(r); });
  f.choose('note-card'); await f.inline.send();
  f.write('New page\nDifferent words'); f.choose('note-card'); await f.inline.send();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].args.title, 'New page');
  f.inline.show(f.p); f.inline.pop(); f.write('Writing after both attempts');
  const retry = f.get('inline-notice').children.find(n => /Retry earlier page/.test(n.textContent)); assert.ok(retry); assert.equal(retry.disabled, false);
  await retry.onclick(); assert.deepEqual(f.requests[2], f.requests[0]); assert.equal(f.opened.length, 1);
  assert.equal(f.editor.draft.body, 'Writing after both attempts'); assert.equal(f.sheet.open, true);
  assert.ok(f.get('inline-notice').children.find(n => n.textContent === 'Open started page'));
});

test('926 image storage barriers hold both Message and Note until recovery', async () => {
  const f = pencil894(); f.choose('message'); f.editor.imageStorageError = Error('image still saving'); f.inline.paintStatus();
  assert.equal(f.get('inline-send').disabled, true);
  f.choose('note-card'); assert.equal(f.get('inline-send').disabled, true);
  await f.inline.send(); assert.equal(f.requests.length, 0);
  f.editor.imageStorageError = null; f.inline.paintStatus();
  await f.inline.send(); assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].args.attachments, []);
});

test('894 B2 kind controls occupy a full grid row in normal and retry layouts', () => {
  const css = webSource('aim.css');
  assert.match(css, /\.pencil-kinds\{[^}]*grid-area:kinds/);
  const normal = css.match(/#inline-composer\{([^}]+)\}/)?.[1]; assert.ok(normal);
  const retry = css.match(/#inline-composer:has\(>#inline-retry:not\(\[hidden\]\)\)\{([^}]+)\}/)?.[1]; assert.ok(retry);
  for (const rule of [normal, retry]) assert.match(rule, /"kinds kinds kinds kinds"/);
});

for (const kind of ['note-card']) test(`894 B2 ${kind} uses the card box first-line rule`, async () => {
  const f = pencil894(); f.write('\r\n  \r\n## A title\r\n\r\nSome words\r\n'); f.choose(kind); await f.inline.send();
  assert.equal(f.requests[0].args.title, 'A title');
  assert.equal(f.requests[0].args.body, kind === 'note-card' ? '## A title\n\nSome words\n' : 'Some words');
});

test('894 B2 page refusal reaches the line as the original error object', async () => {
  const f = pencil894(), failure = Object.assign(Error('Refused by Notebook'), { code: 'FORBIDDEN' }), notices = [];
  f.runObservation('NotebookStart.prototype').create = async () => { throw failure; };
  f.inline.notice = what => notices.push(what);
  f.choose('note-card'); await f.inline.send();
  assert.ok(notices.some(parts => Array.isArray(parts) && parts.includes(failure)));
});

test('894 B2 a failed page opening keeps its confirmed result for another Open', async () => {
  const f = pencil894(); let opens = 0;
  f.inline.callbacks.notebook.open = async () => { if (++opens === 1) throw Error('Could not open the page.'); };
  f.choose('note-card'); await f.inline.send();
  const open = f.get('inline-notice').children.find(n => n.textContent === 'Open started page'); assert.ok(open);
  assert.equal(open.disabled, false); await open.onclick(); assert.equal(opens, 2); assert.equal(f.requests.length, 1);
});

for (const retry of [false, true]) test(`894 B3 phone panels have their own row below writing and Send (${retry ? 'retry' : 'normal'})`, () => {
  const css = webSource('aim.css');
  const template = (retry
    ? css.match(/#inline-composer:has\(>#inline-retry:not\(\[hidden\]\)\)\{([^}]+)\}/)
    : css.match(/#inline-composer\{([^}]+)\}/))?.[1];
  assert.ok(template);
  const areas = template.match(/grid-template-areas:([^;}]*)/)?.[1]; assert.ok(areas);
  const rows = [...areas.matchAll(/"([^"]+)"/g)].map(match => match[1].split(/\s+/));
  const common = css.match(/\.composer>\.compose-panel\{([^}]+)\}/)?.[1]; assert.ok(common);
  const pencil = css.match(/#inline-composer>\.compose-panel\{([^}]+)\}/)?.[1] ?? '';
  // The shared phone placement is overridden by the pencil's more specific
  // rule. Interpret grid-area's row reset as well as an explicit grid-row.
  let area, row;
  for (const declaration of (common + ';' + pencil).split(';')) {
    const [property, value] = declaration.split(':').map(part => part.trim());
    if (property === 'grid-area') { area = value; row = undefined; }
    if (property === 'grid-row') row = Number(value) - 1;
  }
  const panelRow = row ?? rows.findIndex(cells => cells.includes(area));
  const writingRow = rows.findIndex(cells => cells.includes('field'));
  const sendRow = rows.findIndex(cells => cells.includes('act'));
  assert.ok(writingRow >= 0 && sendRow >= 0);
  assert.ok(panelRow > Math.max(writingRow, sendRow), `panel row ${panelRow + 1} must follow writing/Send row ${Math.max(writingRow, sendRow) + 1}`);
  assert.ok(rows[panelRow]?.every(cell => cell === area), 'panel owns a named, full-width row');
});

for (const kind of ['note-card']) test(`926 ${kind} and Message share image reservation through working uploads`, async () => {
  const f = pencil894(), reservations = [], choices = [];
  const uploads = { current: () => [], running: new Map(), status: () => 'Ready',
    reserve: presentation => { const token = { presentation }; reservations.push(token); return token; },
    choose: async (token, file) => { choices.push({ token, file }); } };
  f.inline.callbacks.uploads = () => uploads;
  const file = { name: 'fixture.png', type: 'image/png' };
  f.choose(kind); await f.inline.addImages([file]);
  assert.equal(reservations.length, 1, 'Note reserves through the upload owner');
  assert.equal(choices.length, 1, 'Note passes image bytes to the same owner');
  f.choose('message'); await f.inline.addImages([file]);
  assert.equal(reservations.length, 2); assert.equal(choices.length, 2);
  assert.equal(reservations[0].presentation, f.p);
  assert.equal(choices[0].token, reservations[0]); assert.equal(choices[0].file, file);
});

for (const permission of [false, undefined]) test(`894 B3 actual app wiring denies Notebook write when permission is ${String(permission)}`, () => {
  const f = fixture(), app = webSource('app.mjs');
  const owner = app.slice(app.indexOf('  inline = new InlineComposer({'), app.indexOf('  reader = new Reader({'));
  const memoryAnswer = JSON.stringify(permission === undefined ? {} : { reader_may_write: permission });
  const capability = f.runObservation('(() => { const topicImages = () => {}, imageBytes = () => {}, memoryAnswer = ' + memoryAnswer + '; ' + owner + '; return inline.callbacks.notebook; })()');
  assert.equal(capability.mayWrite, false);
  assert.equal(capability.api, f.api); assert.equal(capability.bootstrap, f.bootstrap);
});

test('894 B3 typing in Note keeps Start page and hides the To line', () => {
  const f = pencil894(); f.write(''); f.choose('note-card');
  const field = f.inline.field; field.focus(); field.value = 'x'; field.setSelectionRange(1, 1);
  assert.equal(typeof field.handlers.input, 'function');
  field.handlers.input({ inputType: 'insertText', data: 'x' });
  assert.equal(f.editor.draft.body, 'x'); assert.equal(f.saved.at(-1), 'x');
  assert.equal(f.get('inline-send').querySelector('.send-word').textContent, 'Start page');
  assert.equal(f.get('inline-writing-to').hidden, true);
});


test('925 resting composer starts on Message; a press on Note starts a new page in Cards without opening the sheet', async () => {
  const f = pencil894(undefined, { popped: false });
  assert.equal(f.sheet.open, false); assert.equal(f.inline.kind, 'message');
  assert.equal(f.get('inline-kind').hidden, false);
  assert.equal(f.get('inline-send').querySelector('.send-word').textContent, 'Send');
  f.choose('note-card');
  assert.equal(f.get('inline-send').querySelector('.send-word').textContent, 'Start page');
  await f.get('inline-send').onclick();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].kind, 'memory.create');
  assert.equal(f.requests[0].args.body, '## Title\n\nBody\n');
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0].options.mode, 'cards');
  assert.equal(f.editor.draft.body, '');
});

test('910 resting selector keeps exact writing and Message still uses the existing send owner', async () => {
  const f = pencil894(undefined, { popped: false }), sent = [];
  f.inline.callbacks.send = (editor, presentation) => { sent.push({ body: editor.draft.body, presentation }); return Promise.resolve({}); };
  f.editor.edit({ caret: { start: 1, end: 4 } }); f.inline.drawEditor();
  f.choose('message'); f.choose('note-card'); f.choose('message');
  assert.equal(f.inline.field.value, 'Title\nBody'); assert.equal(f.inline.field.selectionStart, 1); assert.equal(f.inline.field.selectionEnd, 4);
  await f.inline.send(); assert.equal(sent.length, 1); assert.equal(sent[0].body, 'Title\nBody'); assert.equal(sent[0].presentation, f.p);
  assert.equal(f.requests.length, 0);
});

test('910 opening the sheet while an inline Note saves keeps the later opening and writing', async () => {
  const d = defer(), f = pencil894(r => d.promise.then(() => receipt894(r)), { popped: false });
  f.choose('note-card');
  const sending = f.inline.send(); f.inline.pop(); d.resolve(); await sending;
  assert.equal(f.sheet.open, true); assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.opened.length, 0);
  assert.ok(f.get('inline-notice').children.find(n => n.textContent === 'Open started page'));
});

test('910 removed Note page cannot be selected; the title remains a screen-reader label', () => {
  const f = pencil894(); assert.equal(f.inline.chooseKind('note-page'), false); assert.equal(f.inline.kind, 'message');
  const html = webSource('index.html');
  assert.doesNotMatch(html, /id="inline-kind-note-page"/);
  assert.match(html, /<h2 id="inline-writing-title" class="sr-only">New Notebook page<\/h2>/);
  assert.match(html, /id="new-message-sheet"[^>]*aria-labelledby="inline-writing-title"/);
});

// 905 binds the actual Reader paint owners to the actual app callbacks. Only
// DOM ports are supplied here: descendant selectors and a local document for
// the natively imported Reader modules. No product body or source read is added.
async function conversationReader905() {
  const f = fixture();
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.live = stream(); f.useLive(f.live);
  pickerApi(f);
  f.pickers.members.push({ actor_id: 'other905', name: 'Other agent', kind: 'agent', enabled: true });
  let coordinator = 'ally';
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name !== 'conversation') return view(name, args, options);
    f.calls.push({ name, args, options });
    return { instance_id: 'fixture', conversation: { topic_id: 'conversation905', coordinator: { actor_id: coordinator }, waits: [] } };
  };
  await f.initialize(); await drain();
  assert.equal(f.runObservation('here.conversation'), false, 'this is an ordinary topic');
  assert.equal(f.runObservation('here.view.coordinator.actor_id'), 'ally');
  const adapt = node => {
    const query = node.querySelector.bind(node), all = node.querySelectorAll.bind(node);
    const matches = (child, selector) => {
      const simple = selector.match(/^([a-z]+)?(?:\.([\w-]+))?(?:\[data-([\w-]+)\])?$/);
      if (!simple || !child?.tagName && !child?.classList) return false;
      const [, tag, cls, data] = simple;
      return (!tag || child.tagName === tag.toUpperCase()) && (!cls || child.classList.contains(cls))
        && (!data || child.dataset?.[data.replace(/-(.)/g, (_, c) => c.toUpperCase())] !== undefined);
    };
    node.querySelectorAll = selector => {
      if (/^(?:[a-z]+)?(?:\.[\w-]+)?(?:\[data-[\w-]+\])?$/.test(selector)) return walk(node).filter(child => matches(child, selector));
      if (selector.startsWith(':scope > ')) return node.children.filter(child => matches(child, selector.slice(9)));
      return all(selector);
    };
    node.querySelector = selector => selector.startsWith('.') || selector.startsWith(':scope > ') || /^[a-z]+\[data-/.test(selector)
      ? node.querySelectorAll(selector)[0] ?? null : query(selector);
    return node;
  };
  const create = f.document.createElement.bind(f.document);
  f.document.createElement = tag => adapt(create(tag));
  const who = adapt(f.get('who-row-905')), label = adapt(f.get('who-label-905'));
  who.className = 'who-row'; label.className = 'who-label'; label.textContent = 'To';
  const audience = adapt(f.get('reply-audience')), chips = adapt(f.get('recipient-chips')), input = adapt(f.get('recipient-input'));
  chips.className = 'chips'; input.className = 'name-filter'; audience.append(chips, input); who.append(label, audience);
  for (const id of ['intent-row', 'who-sentence', 'send-reply']) adapt(f.get(id));
  const editor = { ...f.editor, key: 'reply905', draft: { ...f.editor.draft, body: '', addressees: [] }, context: { ...f.editor.context, topicId: 'conversation905' } };
  Object.assign(f.reader, { $: f.get, mode: 'reply', sessions: { reply: editor }, field: f.get('reply-field'),
    source: { source_ref: { kind: 'message', id: 'message905' }, topic_id: 't1' },
    presentation: { surface: 'reader', editors: { reply: editor } }, paintLine() {}, naming: null, compose: null });
  const withDocument = action => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: f.document });
    try { return action(); } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
  };
  for (const name of ['paintRecipients', 'paintChoice', 'own', 'names', 'members', 'place', 'answering']) {
    f.reader[name] = (...args) => withDocument(() => RealReader.prototype[name].apply(f.reader, args));
  }
  Object.defineProperty(f.reader, 'kindOf', { get: () => Object.getOwnPropertyDescriptor(RealReader.prototype, 'kindOf').get.call(f.reader) });
  f.reader.paintRecipients(); f.reader.paintChoice();
  const defaults = () => walk(audience).filter(node => node.dataset?.answerer !== undefined && node.getAttribute('aria-pressed') === 'true').map(node => node.dataset.answerer);
  const refresh = async () => {
    coordinator = 'other905';
    const before = f.calls.length;
    assert.equal(await f.runObservation('loadConversation()'), true);
    assert.equal(f.runObservation('here.view.coordinator.actor_id'), 'other905', 'the actual app accepted the newer view');
    assert.deepEqual(structuredClone(f.calls.slice(before)), [{ name: 'conversation', args: { workspace_id: 'w1' }, options: { readClass: 'background' } }], 'repaint needs no extra read');
  };
  return { f, label, defaults, refresh };
}

test('905 keyboard pick returns focus to Coordinator after disabling the focused choice', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => {
    f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return apply(request);
  }; } });
  p.panel().toggle(true);
  const key = (node, value) => node.onkeydown({ key: value, preventDefault() {}, stopPropagation() {} });
  key(p.row(), 'ArrowDown'); const list = p.choices()[0].parentNode;
  key(list, 'End'); const choice = p.f.document.activeElement;
  assert.equal(choice.dataset.coordinator, 'other899');
  // Native disabling removes focus from this button. Keep that DOM behavior
  // local; the generic fixture and all its existing controls remain unchanged.
  let disabled = choice.disabled;
  Object.defineProperty(choice, 'disabled', { configurable: true, get: () => disabled, set(value) {
    disabled = value;
    if (value && p.f.document.activeElement === choice) p.f.document.activeElement = p.f.document.body;
  } });
  const pending = choice.onclick(); // Native Return activates this same handler; no native gesture claim.
  try { await drain(); assert.equal(choice.disabled, true); assert.equal(p.f.document.activeElement === p.f.document.body, true); }
  finally { gate.resolve(); await pending; await drain(); }
  assert.equal(p.row().textContent, 'Coordinator: Other member');
  assert.equal(list.hidden, true);
  assert.equal(p.f.document.activeElement === p.row(), true, 'settled keyboard pick returns to the Coordinator row');
  key(p.row(), 'Escape');
  assert.equal(p.panel().row.hidden, true); assert.equal(p.f.document.activeElement === p.panel().opener, true);
});

test('905 conversation refresh repaints the real Reader Answered by default', async () => {
  const p = await conversationReader905();
  assert.equal(p.label.textContent, 'Answered by'); assert.deepEqual(p.defaults(), ['ally']);
  await p.refresh();
  assert.deepEqual(p.defaults(), ['other905']);
});

test('905 conversation refresh repaints the real Reader answers there note', async () => {
  const p = await conversationReader905();
  assert.equal(p.f.get('destination-note').textContent, "Goes to the outcome's conversation with a link to this message. ally answers there; nobody in this topic is woken.");
  await p.refresh();
  assert.equal(p.f.get('destination-note').textContent, "Goes to the outcome's conversation with a link to this message. other905 answers there; nobody in this topic is woken.");
  assert.equal(p.f.get('destination-note').hidden, false);
});

test('905 a page-learned workspace revision is sent by the next pick and commits its row', async () => {
  const p = await coordinatorPage899(); p.open();
  p.f.pickers.workspace.version = 7; p.f.pickers.workspace.coordinator_id = 'fixture-person';
  await commit(p.f.live, 7);
  assert.equal(p.row().textContent, 'Coordinator: Fixture', 'the page actually learned the intervening workspace');
  await p.choose('other899');
  assert.equal(p.sent().length, 1);
  assert.equal(p.sent()[0].expected.workspace_revision, 7, 'use the newer page-learned revision, not the opening revision');
  assert.equal(p.f.pickers.workspace.version, 8);
  assert.equal(p.row().textContent, 'Coordinator: Other member', 'the asserted revision allowed the real adapter to commit');
});

test('905 a pending pick preserves focus moved to a different control', async () => {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => {
    f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return apply(request);
  }; } });
  p.open(); const choice = p.choices().find(node => node.dataset.coordinator === 'other899'); choice.focus();
  const elsewhere = p.f.document.createElement('button'); elsewhere.textContent = 'Another control'; p.f.document.body.append(elsewhere);
  const pending = choice.onclick();
  try {
    await drain(); assert.equal(choice.disabled, true);
    elsewhere.focus(); assert.equal(p.f.document.activeElement === elsewhere, true);
    assert.equal(p.panel().row.hidden, false, 'the panel was not dismissed');
  } finally { gate.resolve(); await pending; await drain(); }
  assert.equal(p.sent().length, 1); assert.equal(p.row().textContent, 'Coordinator: Other member');
  assert.equal(p.panel().row.hidden, false);
  assert.equal(p.f.document.activeElement === elsewhere, true, 'settled pick must not take focus from another control');
});

// 905 Build2: actual picker command/refresh and key handlers, with native
// disabled-button focus represented only on this case's chosen button.
async function refusedKeyboardPick905B2({ moveFocus = false } = {}) {
  const gate = defer();
  const p = await coordinatorPage899({ prepare(f, { apply }) { f.api.command = async request => {
    f.calls.push({ kind: request.kind, envelope: structuredClone(request) }); await gate.promise; return apply(request);
  }; } });
  const key = (node, value) => node.onkeydown({ key: value, preventDefault() {}, stopPropagation() {} });
  p.panel().toggle(true); key(p.row(), 'ArrowDown');
  const list = p.choices()[0].parentNode; key(list, 'End');
  const choice = p.f.document.activeElement; assert.equal(choice.dataset.coordinator, 'other899');
  let disabled = choice.disabled;
  Object.defineProperty(choice, 'disabled', { configurable: true, get: () => disabled, set(value) {
    disabled = value;
    if (value && p.f.document.activeElement === choice) p.f.document.activeElement = p.f.document.body;
  } });
  const elsewhere = p.f.document.createElement('button'); elsewhere.textContent = 'Another control'; p.f.document.body.append(elsewhere);
  const pending = choice.onclick();
  try {
    await drain(); assert.equal(choice.disabled, true); assert.equal(p.f.document.activeElement === p.f.document.body, true);
    p.f.pickers.workspace.version++; p.f.pickers.workspace.coordinator_id = 'fixture-person';
    if (moveFocus) { elsewhere.focus(); assert.equal(p.f.document.activeElement === elsewhere, true); }
    assert.equal(p.panel().row.hidden, false);
  } finally { gate.resolve(); await pending; await drain(); }
  assert.equal(p.sent().length, 1, 'a refused revision is not automatically retried');
  assert.equal(p.notice().textContent, 'Someone else changed this at the same moment. Try again.');
  assert.equal(p.notice().hidden, false); assert.equal(p.row().textContent, 'Coordinator: Fixture');
  assert.equal(list.hidden, false); assert.equal(p.choices()[0].disabled, false);
  return { p, list, key, elsewhere };
}

test('905 B2 refused keyboard pick restores the first eligible choice and Escape works', async () => {
  const { p, list, key } = await refusedKeyboardPick905B2();
  assert.equal(p.f.document.activeElement === p.choices()[0], true, 'refused pick returns focus to its first eligible choice');
  key(list, 'Escape'); assert.equal(list.hidden, true); assert.equal(p.f.document.activeElement === p.row(), true);
  key(p.row(), 'Escape'); assert.equal(p.panel().row.hidden, true); assert.equal(p.f.document.activeElement === p.panel().opener, true);
});

test('905 B2 refused pick preserves focus moved to a different control', async () => {
  const { p, elsewhere } = await refusedKeyboardPick905B2({ moveFocus: true });
  assert.equal(p.panel().row.hidden, false);
  assert.equal(p.f.document.activeElement === elsewhere, true, 'a refusal must not take focus from a different control');
});

// Actual Reader callbacks remember their completed paint.
test('905 B2 an unchanged coordinator does not repaint the real Reader again', async () => {
  const p = await conversationReader905();
  const recipients = p.f.reader.paintRecipients, choice = p.f.reader.paintChoice;
  let recipientPaints = 0, choicePaints = 0;
  p.f.reader.paintRecipients = (...args) => { recipientPaints++; return recipients(...args); };
  p.f.reader.paintChoice = (...args) => { choicePaints++; return choice(...args); };
  await p.refresh();
  assert.equal(recipientPaints, 1, 'the changed coordinator repaints recipients once');
  assert.equal(choicePaints, 1, 'the changed coordinator repaints the destination note once');
  await p.refresh();
  assert.equal(recipientPaints, 1, 'an unchanged coordinator already painted by the real Reader is not repainted');
  assert.equal(choicePaints, 1, 'the already painted destination note is not repainted');
});

// 926: the real upload owner, with only byte storage and transport in memory.
async function imageNote926(answer, options) {
  const f = pencil894(answer, options), { Uploads } = await import('../web/uploads.mjs');
  const pin = { authority_id: 'fixture-authority', authority_epoch: 'fixture-epoch' }, bytes = new Map(), begins = new Map();
  const receipt = (request, result) => ({ ...receipt894(request), result });
  const api = {
    command: async request => { begins.set(request.target.media_id, request.args); return receipt(request, { media_id: request.target.media_id, media_revision: 1, state: 'pending' }); },
    upload: async (request, blob) => { const file = begins.get(request.target.media_id); assert.equal(blob.size, file.size_bytes);
      return receipt(request, { instance_id: 'fixture', media_id: request.target.media_id, media_revision: 2, state: 'ready', ...file, inline: true }); }
  };
  const journal = { writerId: 'fixture-926',
    capture: async (_key, _snapshot, row, entry, current) => { assert.ok(current()); bytes.set(row.id, row); entry.bytes_ref = row.id; entry.bytes_state = 'durable'; },
    readBytes: async (_key, id) => bytes.get(id),
    transition: async (_key, _snapshot, mutate, current) => { assert.ok(current()); mutate(); }
  };
  const session = { editor: f.editor, api, journal, authority: pin, snapshot: () => f.editor.snapshot(), persist: async () => {},
    envelope: (kind, operation_id, target, expected, args) => ({ v: 1, instance_id: 'fixture', kind, operation_id, target, expected, args }) };
  const registry = { sessions: new Map([[f.editor.key, session]]), runtime: { current: pin }, disposed: false,
    isCurrent: p => p === f.p, changed() {}, schedule() {}, bootstrap: { limits: { media_name_utf8_bytes: 255,
      image_bytes: 1000000, media_file_bytes: 1000000, attachment_count: 10, attachment_bytes: 10000000 } } };
  const uploads = new Uploads(session, registry); f.inline.callbacks.uploads = () => uploads;
  const file = Object.assign(new Blob(['fixture image bytes'], { type: 'image/png' }), { name: 'photo.png', lastModified: 0 });
  f.choose('note-card');
  return { ...f, uploads, file, bytes };
}
test('911 Add card receives the shared ready images and consumes them only after confirmation', async () => {
  const f = await imageNote926(), added = destinations911(f);
  await f.uploads.add(f.file); f.choose('note-card'); await drain(); target911(f, 'n-older');
  const before = structuredClone(f.editor.draft.attachments);
  await f.inline.send();
  assert.equal(added.length, 1); assert.deepEqual(added[0].job.attachments, before);
  assert.equal(added[0].job.images.length, 1); assert.ok(added[0].job.cardWords.includes(`](attachment:${before[0].id})`));
  assert.equal(f.requests.length, 0); assert.equal(f.editor.draft.body, '');
  assert.equal(currentImages(f.editor).length, 0); assert.equal(f.opened[0].id, 'n-older');
});
test('911 refused Add card keeps the shared ready images and words', async () => {
  const f = await imageNote926(); destinations911(f, async () => { throw Error('This page was deleted.'); });
  await f.uploads.add(f.file); f.choose('note-card'); await drain(); target911(f, 'n-older');
  const before = structuredClone(f.editor.draft);
  await f.inline.send();
  assert.deepEqual(f.editor.draft, before); assert.equal(currentImages(f.editor).length, 1);
  assert.equal(f.requests.length, 0); assert.equal(f.opened.length, 0);
  assert.match(f.get('inline-notice').textContent, /deleted/);
});

for (const popped of [false, true]) test(`926 Note paste creates the first card with its image (${popped ? 'sheet' : 'feed'})`, async () => {
  const f = await imageNote926(null, { popped });
  assert.equal(f.get('inline-plus-button').hidden, false);
  assert.equal(f.get('inline-attachments').hidden, false);
  let prevented = false;
  await f.inline.field.handlers.paste({ clipboardData: { items: [{ type: f.file.type, getAsFile: () => f.file }] }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.uploads.current().length, 1);
  const media = f.editor.draft.attachments[0].id;
  f.write('First card\nWords\n\n## Another card\nOther words'); await f.inline.send();
  assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].args.attachments, [{ id: media }]);
  const { parseDeck, cardImages } = await import('../web/deck.mjs');
  const cards = parseDeck(f.requests[0].args.body).cards;
  assert.equal(cards.length, 2); assert.equal(cards[0].title, 'First card');
  assert.deepEqual(cardImages(cards[0].words).images.map(image => image.id), [media]);
  assert.deepEqual(cardImages(cards[1].words).images, []);
  assert.equal(f.opened[0].options.mode, 'cards');
  assert.equal(f.editor.draft.body, ''); assert.deepEqual(f.editor.draft.attachments, []); assert.equal(f.uploads.current().length, 0);
});

test('926 a refused Note start keeps exact words and ready image selections', async () => {
  const f = await imageNote926(request => ({ ...receipt894(request), status: 'rejected', error: { code: 'FORBIDDEN', message: 'This topic is read-only.' } }));
  await f.uploads.add(f.file); const images = structuredClone(f.editor.draft.attachments);
  await f.inline.send();
  assert.deepEqual(f.requests[0].args.attachments, images);
  assert.equal(f.editor.draft.body, 'Title\nBody'); assert.deepEqual(f.editor.draft.attachments, images);
  assert.equal(f.uploads.current().length, 1); assert.equal(f.sheet.open, true);
  assert.match(f.get('inline-notice').textContent, /read-only/);
});

test('926 pending image bytes hold Start page until the shared upload barrier clears', async () => {
  const f = await imageNote926(); await f.uploads.add(f.file, { start: false });
  f.inline.paintStatus(); await f.inline.send();
  assert.equal(f.requests.length, 0); assert.equal(f.get('inline-send').disabled, true);
  assert.equal(f.uploads.current().length, 1); assert.equal(f.editor.draft.body, 'Title\nBody');
});

for (const kind of ['note-card', 'message']) test(`926 ${kind} drop and file choice share the actual image owner`, async () => {
  const f = await imageNote926(); f.choose(kind);
  let prevented = 0;
  assert.equal(typeof f.inline.field.handlers.drop, 'function');
  await f.inline.field.handlers.drop({ dataTransfer: { files: [f.file] }, preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(f.uploads.current().length, 1);
  f.inline.chooseFile(); assert.ok(f.inline.imagePicker);
  await f.get('inline-image-file').onchange({ target: { files: [f.file] } });
  assert.equal(f.uploads.current().length, 2); assert.equal(f.editor.draft.attachments.length, 2);
  const first = f.uploads.current()[0].selection_id;
  await f.uploads.remove(first); f.inline.paintStatus();
  assert.equal(f.editor.draft.attachments.length, 1); assert.equal(f.uploads.current().length, 1);
});

test('926 lost creation retries the identical image envelope and confirms only once', async () => {
  const f = await imageNote926((request, n) => { if (n === 1) throw Error('connection lost'); return receipt894(request); });
  await f.uploads.add(f.file); const images = structuredClone(f.editor.draft.attachments);
  await f.inline.send(); assert.equal(f.uploads.current().length, 1); assert.deepEqual(f.editor.draft.attachments, images);
  await f.inline.send(); assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.opened.length, 1); assert.equal(f.uploads.current().length, 0);
});

test('926 an older creation cannot consume a newer image whose capture changed no text version', async () => {
  const gate = defer(), f = await imageNote926(request => gate.promise.then(() => receipt894(request)));
  await f.uploads.add(f.file); const sending = f.inline.send(), version = f.editor.localVersion;
  await f.uploads.add(f.file, { start: false }); // A recovered/new selection; capture itself does not edit the draft.
  assert.equal(f.editor.localVersion, version); assert.equal(f.uploads.current().length, 2);
  gate.resolve(); await sending;
  assert.equal(f.editor.draft.body, 'Title\nBody'); assert.equal(f.uploads.current().length, 2);
  assert.equal(f.opened.length, 0); assert.equal(f.sheet.open, true);
});

test('926 an image cleanup persistence wait cannot dismiss newer writing', async () => {
  const f = await imageNote926(); await f.uploads.add(f.file);
  const gate = defer(), entered = defer(), transition = f.uploads.journal.transition;
  f.uploads.journal.transition = async (...args) => { await transition(...args); entered.resolve(); await gate.promise; };
  const sending = f.inline.send(); await entered.promise;
  f.editor.edit({ body: 'Newer writing after the journal mutation' });
  gate.resolve(); await sending;
  assert.equal(f.editor.draft.body, 'Newer writing after the journal mutation');
  assert.equal(f.sheet.open, true); assert.equal(f.opened.length, 0);
});

test('926 first-card images survive the actual Text projection and an unfinished code fence', async () => {
  const f = await imageNote926(); await f.uploads.add(f.file);
  const media = f.editor.draft.attachments[0].id;
  f.write('Code example\n```js\nconst kept = true;'); await f.inline.send();
  const { parseDeck, cardImages } = await import('../web/deck.mjs');
  const { CardTextProjection } = await import('../web/notebook-card-text.mjs');
  const projection = new CardTextProjection(), body = f.requests[0].args.body;
  projection.show(body, body);
  assert.match(projection.text, new RegExp('attachment:' + media));
  assert.deepEqual(cardImages(parseDeck(projection.text).cards[0].words).images.map(image => image.id), [media]);
  assert.equal(projection.edit(projection.text, null), body);
});

test('926 changed writing before the image journal mutation keeps every selection', async () => {
  const f = await imageNote926(); await f.uploads.add(f.file);
  const before = structuredClone(f.editor.draft.attachments), entered = defer(), gate = defer(), transition = f.uploads.journal.transition;
  f.uploads.journal.transition = async (...args) => { entered.resolve(); await gate.promise; return transition(...args); };
  const sending = f.inline.send(); await entered.promise;
  f.editor.edit({ body: 'Recovered while cleanup waits' }); gate.resolve(); await sending;
  assert.equal(f.editor.draft.body, 'Recovered while cleanup waits');
  assert.deepEqual(f.editor.draft.attachments, before); assert.equal(f.uploads.current().length, 1);
  assert.equal(f.sheet.open, true); assert.equal(f.opened.length, 0);
});

// Item 891 uses the actual app, withdrawal, grouping and stack painters. Only
// the transport, registry persistence and DOM are in memory; source records
// remain available even when this viewer's visible projection omits a row.
const content891 = node => typeof node === 'string' ? node : String(node?.textContent ?? '') + (node?.children ?? []).map(content891).join('');
const withdrawn891 = { by: 'fixture-person', at_ms: TODAY, revision: 1 };
const ask891 = (more = {}) => ({ id: 'q891', seq: 1, author_id: 'fixture-person', author_kind: 'human',
  intent: 'ask', body: 'WITHDRAWN QUESTION WORDS', go_ahead: true, addressees: ['dan'], withdrawal: withdrawn891, ...more });
const reply891 = (id = 'r891', seq = 2, more = {}) => ({ id, seq, author_id: 'dan', author_kind: 'human',
  intent: 'tell', body: 'Authored reply survives', reply_to: 'q891', reply_to_author: 'fixture-person', reply_to_excerpt: 'WITHDRAWN QUESTION WORDS', ...more });
async function questionPage891(items, { viewer = 'fixture-person', heads = [], href = 'https://fixture/?topic=t1' } = {}) {
  const f = fixture(href, { history: { state: null, replaceState() {} } }), reads = [], opens = [];
  // The generic inline fake maps named page lookups by id. These message
  // checks need real descendant class lookups, including a genuinely absent
  // withdrawal marker; no product painter or eligibility decision is mocked.
  const create = f.document.createElement.bind(f.document);
  f.document.createElement = tag => {
    const element = create(tag), query = element.querySelector.bind(element);
    element.querySelector = selector => /^\.[\w-]+$/.test(selector)
      ? walk(element).find(child => child.classList?.contains(selector.slice(1))) ?? null : query(selector);
    return element;
  };
  f.runObservation('window.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} }');
  f.bootstrap.actor = viewer;
  Object.assign(f.bootstrap.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  f.registry.generation = 1;
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  f.reader.dialog = { open: false };
  Object.assign(f.views, { messages: new Map(items.map(item => [item.id, { topic_id: 't1', sent_ms: null, reply_to: null, unread: false, ...structuredClone(item) }])), memory: new Map(), olderCursor: null, memoryCursor: null, newest: Math.max(0, ...items.map(item => item.seq)) });
  const sources = new Map([...f.views.messages, ...heads.map(item => [item.id, { topic_id: 't1', sent_ms: null, unread: false, ...structuredClone(item) }])]);
  f.views.messagesPage = () => f.paintViews('messages');
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    reads.push([name, structuredClone(args)]);
    if (name === 'source') {
      const item = sources.get((args.source_ref ?? args).id);
      return { instance_id: 'fixture', source_ref: args.source_ref ?? args, topic_id: 't1', attachments: [], ...structuredClone(item), author: item?.author_id };
    }
    if (name === 'topic_messages') return { instance_id: 'fixture', items: (args.message_ids ?? []).map(id => structuredClone(sources.get(id))).filter(Boolean), next_cursor: null };
    return view(name, args, options);
  };
  f.registry.open = async (ref, options) => {
    const source = checkedView(await f.api.view('source', { source_ref: ref }), 'fixture');
    const p = { token: f.registry.generation, source, editors: { reply: f.editor }, mode: 'reply' };
    opens.push({ ref, options, p }); f.registry.current = p;
    Object.assign(f.reader, { presentation: p, source }); f.reader.dialog.open = true;
    return p;
  };
  await f.initialize(); for (let i = 0; i < 6; i++) await settle();
  const state = () => f.runObservation("stackState($('messages'))");
  const ids = () => Array.from(state().stacks, stack => [stack.head.id, ...stack.replies.map(item => item.id)]);
  const visible = id => {
    let entry = entryIn(f, id);
    if (!entry || !f.get('messages').contains(entry)) return false;
    while (entry && entry !== f.get('messages')) { if (entry.hidden) return false; entry = entry.parentElement; }
    return true;
  };
  const text = node => !node || node.hidden ? '' : [typeof node === 'string' ? node : node.textContent ?? '', ...(node.children ?? []).map(text)].join(' ');
  const words = () => text(f.get('messages'));
  const arrange = () => f.runObservation('stackMessages()');
  return { f, sources, reads, opens, state, ids, visible, words, arrange };
}

test('891 own withdrawn root leaves feed and dossier projection but retains its exact record', async () => {
  const p = await questionPage891([ask891()]);
  assert.deepEqual(p.ids(), [], 'the withdrawn question supplies no head, tab or row');
  assert.equal(p.visible('q891'), false); assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
  assert.equal(p.f.views.messages.get('q891').body, 'WITHDRAWN QUESTION WORDS');
  p.arrange(); assert.deepEqual(p.ids(), [], 'a second arrangement cannot admit the retained record');
});

test('891 other viewer keeps withdrawn question and cue with no answer action', async () => {
  const p = await questionPage891([ask891()], { viewer: 'dan' });
  assert.deepEqual(p.ids(), [['q891']]); assert.equal(p.visible('q891'), true);
  assert.match(p.words(), /WITHDRAWN QUESTION WORDS/); assert.match(p.words(), /Question withdrawn/);
  assert.equal(p.f.runObservation("mayAnswer(views.messages.get('q891'), bootstrap.actor, bootstrap.actor_kind)"), false);
});

test('891 unwithdrawn own asks and nonquestions are not hidden by the author rule', async () => {
  const p = await questionPage891([ask891({ withdrawal: null }), ask891({ id: 'tell891', seq: 2, intent: 'tell' })]);
  assert.deepEqual(p.ids(), [['tell891'], ['q891']]); assert.equal(p.visible('q891'), true); assert.equal(p.visible('tell891'), true);
});

test('891 replies survive hidden root with neutral tab, author cue and unchanged authored quotation', async () => {
  const p = await questionPage891([ask891(), reply891('r891', 2, { body: 'I explicitly quote WITHDRAWN QUESTION WORDS.' })]);
  assert.deepEqual(p.ids(), [['r891']]); assert.equal(p.visible('q891'), false); assert.equal(p.visible('r891'), true);
  const folder = entryIn(p.f, 'r891').closest('.reply-stack');
  assert.equal(folder.querySelector(':scope > .stack-header')?.querySelector(':scope > .stack-head')?.querySelector(':scope > .stack-name')?.textContent
    ?? walk(folder).find(node => node.classList?.contains('stack-name'))?.textContent, 'Dossier');
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-reply-to')), 'Replying to fixture-person');
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-preview')), 'I explicitly quote WITHDRAWN QUESTION WORDS.');
  assert.equal(p.state().stacks[0].dossier, 'q891');
});

for (const minted of [false, true]) test(`891 ${minted ? 'minted' : 'explicit'} dossier name and independent cover survive for own and other viewers`, async () => {
  const cover = { stands: 'Independent dossier state', waiting: [], owner: 'fixture-person', payload: null };
  const root = ask891({ acts: { name: { text: 'Independent name', minted, by: 'agent-a' }, cover, starred: true } });
  for (const viewer of ['fixture-person', 'dan']) {
    const p = await questionPage891([root, reply891()], { viewer });
    assert.match(p.words(), /Independent name/); assert.match(p.words(), /Independent dossier state/);
    assert.equal(/Named by/.test(p.words()), minted);
    assert.equal(p.state().starred.has('q891'), true, 'hiding a row does not remove a dossier star');
    assert.match(p.words(), /★/, 'the title bar still marks that dossier star');
    assert.deepEqual(p.ids(), [viewer === 'fixture-person' ? ['r891'] : ['q891', 'r891']]);
  }
});

test('891 nested withdrawn ask keeps descendant ancestry and original dossier order across arrangements', async () => {
  const p = await questionPage891([
    { id: 'root891', seq: 1, author_id: 'dan', body: 'Visible ancestor' },
    ask891({ seq: 3, reply_to: 'root891' }), reply891('r891', 4),
    { id: 'separate891', seq: 2, author_id: 'dan', body: 'Separate dossier' },
  ]);
  assert.deepEqual(p.ids(), [['root891', 'r891'], ['separate891']]);
  p.arrange(); p.arrange(); assert.deepEqual(p.ids(), [['root891', 'r891'], ['separate891']]);
  assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
});

test('891 fold, Earlier and Only new cannot restore a hidden question while replies remain', async () => {
  const p = await questionPage891([ask891({ acts: { folded: true, starred: true } }), ...Array.from({ length: 10 }, (_, n) => reply891('reply' + n, n + 2, { unread: true }))]);
  const expected = Array.from({ length: 10 }, (_, n) => 'reply' + n);
  for (const level of ['folded', 'open']) for (const only of [false, true]) {
    const s = p.state(), id = s.stacks[0].id; s.levels.set(id, level); s.earlier.add(id); s.only = only ? item => item.unread === true : null; p.arrange();
    assert.deepEqual(p.ids(), [expected]); assert.equal(p.visible('q891'), false); assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
  }
});

const sourcePosition891 = { root_id: 'q891', order_key: 100, order_tie: 1, at: { acts: 0, messages: 8 }, name: null, cover: null };
test('891 supplemental withdrawn root never promotes back into head or generated reply excerpt', async () => {
  const p = await questionPage891([reply891('r891', 8, { stack_position: sourcePosition891 })], { heads: [ask891({ stack_position: sourcePosition891 })] });
  assert.ok(p.reads.some(([name, args]) => name === 'topic_messages' && args.message_ids?.includes('q891')));
  assert.equal(p.f.views.messages.has('q891'), false, 'source head does not enter loaded page or frontier');
  assert.deepEqual(p.ids(), [['r891']]); assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
  assert.equal(p.f.runObservation("dossierHeads.records.get('q891').item.body"), 'WITHDRAWN QUESTION WORDS');
});

test('891 scoped withdrawal refresh reaches cached-only root and suppresses its existing reply excerpt', async () => {
  const p = await questionPage891([reply891('r891', 8, { stack_position: sourcePosition891 })], { heads: [ask891({ withdrawal: null, stack_position: sourcePosition891 })] });
  assert.deepEqual(p.ids(), [['q891', 'r891']]);
  const reads = [];
  const answer = await p.f.fresh.options.refresh('withdrawal:q891', 1, async (name, args) => {
    reads.push([name, args.id]); return { instance_id: 'fixture', withdrawal: withdrawn891 };
  }, () => true);
  assert.equal(answer, true); assert.deepEqual(reads, [['source', 'q891']]);
  assert.deepEqual(p.ids(), [['r891']]); assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
  assert.equal(p.f.views.messages.has('q891'), false);
});

test('891 committed withdrawal updates same Reader but preserves writing and removes visible ask only after success', async () => {
  const p = await questionPage891([ask891({ withdrawal: null }), reply891()]);
  await p.f.openSource({ kind: 'message', id: 'q891' }, entryIn(p.f, 'q891'));
  const shown = p.f.registry.current, kept = p.f.editor.draft.body, gate = defer();
  p.f.api.command = async request => { assert.equal(request.kind, 'message.withdraw'); return gate.promise; };
  const pending = p.f.runObservation("withdrawals.withdraw(views.messages.get('q891'))");
  assert.deepEqual(p.ids(), [['q891', 'r891']], 'in-flight command does not hide a question');
  gate.resolve({ recorded: true, status: 'committed', result: { message_id: 'q891', withdrawal: withdrawn891 } });
  await pending; await settle();
  assert.deepEqual(p.ids(), [['r891']]); assert.doesNotMatch(p.words(), /WITHDRAWN QUESTION WORDS/);
  assert.equal(p.f.registry.current, shown); assert.equal(p.f.reader.source, shown.source);
  assert.deepEqual(shown.source.withdrawal, withdrawn891); assert.equal(p.f.editor.draft.body, kept);
});

test('891 refused withdrawal leaves question and generated reply excerpt visible', async () => {
  const p = await questionPage891([ask891({ withdrawal: null }), reply891()]);
  p.f.api.command = async () => ({ recorded: true, status: 'refused', error: { message: 'Ask cannot be withdrawn' } });
  assert.equal(await p.f.runObservation("withdrawals.withdraw(views.messages.get('q891'))"), null);
  assert.deepEqual(p.ids(), [['q891', 'r891']]); assert.match(p.words(), /WITHDRAWN QUESTION WORDS/);
  assert.equal(p.f.views.messages.get('q891').withdrawal, null);
});

test('891 direct message link opens exact hidden question in Reader without putting it back in feed', async () => {
  const p = await questionPage891([ask891(), reply891()], { href: 'https://fixture/?topic=t1&message=q891' });
  assert.equal(p.opens.length, 1); assert.equal(p.f.reader.dialog.open, true);
  assert.equal(p.f.reader.source.source_ref.id, 'q891'); assert.equal(p.f.reader.source.body, 'WITHDRAWN QUESTION WORDS');
  assert.deepEqual(p.f.reader.source.withdrawal, withdrawn891);
  assert.deepEqual(p.ids(), [['r891']]); assert.equal(p.visible('q891'), false);
});

test('891 other viewers and unknown parents keep generated context, independent of author bodies', async () => {
  const p = await questionPage891([ask891(), reply891()], { viewer: 'dan' });
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-reply-to')), 'Replying to fixture-person: WITHDRAWN QUESTION WORDS');
  const unknown = await questionPage891([reply891()]);
  assert.equal(content891(entryIn(unknown.f, 'r891').querySelector(':scope > .message-reply-to')), 'Replying to fixture-person: WITHDRAWN QUESTION WORDS');
});

test('891 late loaded parent and actual edit repaint keep only the reply author cue', async () => {
  const p = await questionPage891([reply891()]);
  assert.match(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-reply-to')), /WITHDRAWN QUESTION WORDS/);
  p.f.views.messages.set('q891', { topic_id: 't1', ...ask891() });
  p.f.paintViews('messages');
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-reply-to')), 'Replying to fixture-person');
  const reply = p.f.views.messages.get('r891'); reply.body = 'Revised authored words'; reply.revision = 2;
  p.f.runObservation("repaintEdited(['r891'], [])");
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-reply-to')), 'Replying to fixture-person');
  assert.equal(content891(entryIn(p.f, 'r891').querySelector(':scope > .message-preview')), 'Revised authored words');
  assert.deepEqual(p.ids(), [['r891']]);
});

test('891 joined descendants keep canonical grouping and original explicit position with hidden root', async () => {
  const position = { ...sourcePosition891, order_key: 40, order_tie: 1, name: { text: 'Position name' }, cover: { stands: 'Position cover', waiting: [], payload: null } };
  const p = await questionPage891([
    ask891({ stack_position: position, acts: { name: position.name, cover: position.cover } }), reply891('r891', 2, { stack_position: position }),
    { id: 'joined891', seq: 3, author_id: 'dan', body: 'Joined content', acts: { joined: { into: 'q891', by: 'dan', at_ms: TODAY } }, stack_position: position },
    { id: 'joined-reply891', seq: 4, author_id: 'dan', body: 'Joined descendant', reply_to: 'joined891', stack_position: position },
    { id: 'above891', seq: 5, author_id: 'dan', body: 'Above by position', stack_position: { ...position, root_id: 'above891', order_key: 90 } },
  ]);
  assert.deepEqual(p.ids(), [['above891'], ['r891', 'joined891', 'joined-reply891']]);
  assert.equal(p.state().stacks[1].orderKey, 40); assert.equal(p.state().stacks[1].dossier, 'q891');
  assert.match(p.words(), /Position name/); assert.match(p.words(), /Position cover/);
  p.arrange(); assert.deepEqual(p.ids(), [['above891'], ['r891', 'joined891', 'joined-reply891']]);
});

test('891 stale withdrawal answer cannot hide or mutate cached source', async () => {
  const p = await questionPage891([reply891('r891', 8, { stack_position: sourcePosition891 })], { heads: [ask891({ withdrawal: null, stack_position: sourcePosition891 })] });
  let current = true; const gate = defer(), read = [];
  const pending = p.f.fresh.options.refresh('withdrawal:q891', 1, async (name, args) => { read.push([name, args.id]); return gate.promise; }, () => current);
  current = false; gate.resolve({ instance_id: 'fixture', withdrawal: withdrawn891 });
  assert.equal(await pending, false); assert.deepEqual(read, [['source', 'q891']]);
  assert.deepEqual(p.ids(), [['q891', 'r891']]); assert.equal(p.f.runObservation("dossierHeads.records.get('q891').item.withdrawal"), null);
});

test('891 withdrawal refresh refusal leaves visible question and reply context intact', async () => {
  const p = await questionPage891([ask891({ withdrawal: null }), reply891()]);
  await assert.rejects(p.f.fresh.options.refresh('withdrawal:q891', 1, async () => { throw Error('Fixture source refused'); }, () => true), /Fixture source refused/);
  assert.deepEqual(p.ids(), [['q891', 'r891']]); assert.match(p.words(), /WITHDRAWN QUESTION WORDS/);
});

test('891 withdrawn ask adds no answer or waiting cue while another active question still asks', async () => {
  const p = await questionPage891([ask891(), ask891({ id: 'active891', seq: 2, author_id: 'dan', addressees: ['fixture-person'], withdrawal: null, body: 'Still waiting on you' })]);
  assert.deepEqual(p.ids(), [['active891']]);
  assert.equal(p.f.runObservation("mayAnswer(views.messages.get('q891'), 'dan', 'human')"), false);
  assert.equal(p.f.runObservation("mayAnswer(views.messages.get('active891'), bootstrap.actor, 'human')"), true);
  assert.equal(walk(entryIn(p.f, 'q891')).some(node => node.classList?.contains('reaction-choice')), false);
  assert.equal(walk(entryIn(p.f, 'active891')).some(node => node.classList?.contains('reaction-choice')), true);
});

test('891 newer position held by hidden root still places surviving replies below More', async () => {
  const old = { ...sourcePosition891, below: false, at: { acts: 1, messages: 8 }, aside_revision: 0 };
  const latest = { ...old, below: true, at: { acts: 2, messages: 8 }, aside_revision: 1 };
  const p = await questionPage891([ask891({ stack_position: latest }), reply891('r891', 8, { stack_position: old })]);
  assert.deepEqual(p.ids(), [['r891']]);
  assert.equal(p.state().below.has('r891'), true); assert.equal(p.visible('r891'), false);
  assert.equal(p.f.runObservation("positionOf(stackState($('messages')).stacks[0]).aside_revision"), 1);
  p.state().moreOpen = true; p.arrange(); assert.equal(p.visible('r891'), true); assert.equal(p.visible('q891'), false);
});

// 891 Build2: preserve questionPage891 and its source reads. This wrapper
// supplies in-memory response/lifecycle ports, and invokes the imported real
// Reader title, close and step methods with the actual app callbacks.
async function questionPage891B2(items, options = {}) {
  const p = await questionPage891(items, options), { f } = p, r = f.reader;
  const create = f.document.createElement.bind(f.document);
  f.document.createElement = tag => {
    const element = create(tag);
    element.matches = selector => /^\.[\w-]+$/.test(selector) && element.classList.contains(selector.slice(1));
    return element;
  };
  f.get('reader').close = function () { this.open = false; };
  const withDocument = action => {
    const previous = globalThis.document; globalThis.document = f.document;
    try { return action(); } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  };
  Object.assign(r, { $: f.get, dialog: f.get('reader'), sourceBody: f.get('source-body'), positions: new Map(),
    viewToken: 0, card: null, editor: null, paintPending() {}, paintRecipients() {}, paintQuote() {} });
  for (const name of ['paintTitle', 'paintCover', 'finishClose', 'disarm']) r[name] = (...args) => withDocument(() => RealReader.prototype[name].apply(r, args));
  for (const name of ['close', 'step', 'stepTo', 'rememberPlace', 'placeKey', 'placeReply']) r[name] = (...args) => RealReader.prototype[name].apply(r, args);
  r.show = (source, sessions, { topics, presentation, opener, mode }) => {
    Object.assign(r, { source, sessions, topics, presentation, opener, mode }); ++r.viewToken;
    r.dialog.open = true; r.paintTitle(source);
  };
  f.registry.close = async presentation => {
    if (!f.registry.isCurrent(presentation)) return false;
    f.registry.current = null; f.registry.options.closed(presentation); return true;
  };
  const view = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name === 'stack_positions') {
      p.reads.push([name, structuredClone(args)]);
      return { instance_id: 'fixture', topic_id: 't1', items: args.message_ids.map(id => ({ message_id: id,
        stack_position: structuredClone(p.sources.get(id)?.stack_position ?? sourcePosition891) })) };
    }
    return view(name, args, options);
  };
  const open = f.registry.open;
  f.registry.open = async (...args) => { const presentation = await open(...args); await f.present(presentation); return presentation; };
  return { ...p, title: () => content891(f.get('reader-title')), open: async id => {
    await f.openSource({ kind: 'message', id }, entryIn(f, id) ?? f.get('main')); await drain(); return f.registry.current;
  }, land: id => f.runObservation(`landOnMessage(${JSON.stringify(id)})`) };
}
function dossier891B2(name = null) {
  const position = { ...sourcePosition891, can_move: true, move_revision: 0, aside_revision: 0, through: null,
    has_other_messages: true, below: false, name, name_revision: name ? 1 : 0 };
  return [ask891({ stack_position: position, acts: { name } }), reply891('r891', 2, { stack_position: position }), reply891('r891b', 3, { stack_position: position })];
}

for (const [kind, name, expected] of [
  ['neutral', null, 'Dossier'],
  ['explicit', { text: 'Independent title', by: 'fixture-person', at_ms: TODAY }, 'Independent title'],
  ['minted', { text: 'Minted title', by: 'agent-a', at_ms: TODAY, minted: true }, 'Minted title'],
]) test(`891 B2 Reader uses the shown ${kind} dossier name without extra metadata reads`, async () => {
  const p = await questionPage891B2(dossier891B2(name));
  const section = p.state().sections.get('r891'), tab = section.querySelector('.stack-head');
  assert.ok(content891(tab).includes(expected), 'the real feed painter shows the expected name');
  const before = p.reads.length; await p.open('r891');
  assert.equal(p.title(), expected);
  assert.deepEqual(p.reads.slice(before).filter(([read]) => ['stack_positions', 'topic_messages'].includes(read)), [], 'a loaded shown name needs no metadata fallback');
  assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 other reader keeps the question-derived dossier title and visible question', async () => {
  const p = await questionPage891B2(dossier891B2(), { viewer: 'dan' });
  await p.open('r891'); assert.equal(p.title(), 'WITHDRAWN QUESTION WORDS');
  assert.equal(p.visible('q891'), true); assert.deepEqual(p.ids(), [['q891', 'r891', 'r891b']]);
});

for (const [kind, name, expected] of [['neutral', null, 'Dossier'], ['named', { text: 'Independent title', by: 'fixture-person', at_ms: TODAY }, 'Independent title']])
  test(`891 B2 refused archive notice uses the shown ${kind} dossier name`, async () => {
    const p = await questionPage891B2(dossier891B2(name));
    const sent = []; p.f.api.command = async request => { sent.push(request); return { recorded: true, status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'The dossier changed elsewhere.' } }; };
    const feed = p.f.runObservation('stackFeed');
    assert.equal(feed.setAside(p.state().stacks[0], true, { focus: false }), true);
    await feed.chain; await drain();
    assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'stack.aside');
    assert.equal(sent[0].target.message_id, 'q891', 'the canonical command target stays the root');
    const words = p.f.get('app-status').textContent;
    assert.match(words, new RegExp(`Archiving “${expected}” was not saved`));
    assert.doesNotMatch(words, /WITHDRAWN QUESTION WORDS/);
    assert.deepEqual(p.ids(), [['r891', 'r891b']]);
  });

test('891 B2 land-only hidden root focuses the first visible dossier card without opening Reader', async () => {
  const p = await questionPage891B2(dossier891B2()); const kept = p.f.editor.draft.body;
  assert.equal(await p.land('q891'), true);
  assert.equal(p.f.document.activeElement?.dataset.id, 'r891'); assert.equal(p.visible('r891'), true);
  assert.equal(p.visible('q891'), false); assert.equal(p.opens.length, 0);
  assert.equal(p.f.editor.draft.body, kept); assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 land-only nested hidden question selects the same dossier first visible card', async () => {
  const root = { id: 'root891b2', seq: 1, author_id: 'dan', body: 'Visible first message' };
  const q = ask891({ seq: 2, reply_to: root.id }), reply = reply891('r891', 3);
  const p = await questionPage891B2([root, q, reply]);
  assert.equal(await p.land('q891'), true); assert.equal(p.f.document.activeElement?.dataset.id, root.id);
  assert.equal(p.visible(root.id), true); assert.deepEqual(p.ids(), [[root.id, 'r891']]);
});

test('891 B2 land-only dossier with no visible card opens its exact question in Reader', async () => {
  const p = await questionPage891B2([ask891()]);
  assert.equal(await p.land('q891'), true);
  assert.equal(p.opens.length, 1); assert.equal(p.f.reader.dialog.open, true);
  assert.equal(p.f.reader.source.source_ref.id, 'q891'); assert.equal(p.f.reader.source.body, 'WITHDRAWN QUESTION WORDS');
  assert.equal(p.visible('q891'), false); assert.deepEqual(p.ids(), []);
});

test('891 B2 Reader title return from the direct hidden question lands on a visible reply', async () => {
  const p = await questionPage891B2(dossier891B2()); await p.open('q891');
  assert.equal(p.f.reader.source.source_ref.id, 'q891', 'ordinary direct opening still selects its exact source');
  const kept = p.f.editor.draft.body, button = p.f.get('reader-title').firstElementChild;
  assert.ok(button, 'real Reader paintTitle creates its destination button');
  await button.onclick(); await drain();
  assert.equal(p.f.reader.dialog.open, false); assert.equal(p.f.document.activeElement?.dataset.id, 'r891');
  assert.equal(p.f.editor.draft.body, kept); assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 New line stays below its visible dossier when the hidden ask is newest', async () => {
  const root = { id: 'root891b2', seq: 1, author_id: 'dan', body: 'Visible first message' };
  const reply = reply891('r891', 2, { reply_to: root.id });
  const q = ask891({ seq: 9, reply_to: root.id });
  const other = { id: 'other891b2', seq: 6, author_id: 'dan', body: 'Other dossier' };
  const p = await questionPage891B2([root, reply, q, other]);
  p.f.views.line = { seq: 1, id: root.id, sent_ms: null }; p.f.views.held = true; p.arrange();
  const children = p.f.get('messages').children, section = p.state().sections.get(root.id), line = children.find(node => node.dataset.line === 'new');
  assert.ok(line, 'actual placeLine paints a New line');
  assert.equal(section.dataset.seq, '2', 'folder sequence comes from visible messages');
  assert.equal(children[children.indexOf(section) + 1] === line, true, 'the actual New line follows its folder, not the hidden top entry');
  assert.equal(p.visible('q891'), false); assert.deepEqual(p.ids(), [[other.id], [root.id, 'r891']]);
});

for (const [direction, key] of [[1, 'next'], [-1, 'previous']]) test(`891 B2 Reader ${key} at the page edge refuses the loaded hidden question`, async () => {
  const p = await questionPage891B2(dossier891B2());
  const id = direction > 0 ? 'r891' : 'r891b'; await p.open(id);
  p.f.registry.current.core = { next: null, previous: null, [key]: { id: 'q891', position: sourcePosition891 } };
  const opened = p.opens.length; await p.f.reader.step(direction); await drain();
  assert.equal(p.opens.length, opened, 'actual Reader step and app onPage do not reopen the hidden loaded question');
  assert.equal(p.f.registry.current.source.source_ref.id, id); assert.equal(p.visible('q891'), false);
});

test('891 B2 Reader page edge still opens a genuinely unloaded readable neighbor', async () => {
  const p = await questionPage891B2(dossier891B2());
  p.sources.set('outside891b2', { id: 'outside891b2', seq: 20, topic_id: 't1', author_id: 'dan', body: 'Unread outside loaded page', attachments: [], intent: 'tell', stack_position: { ...sourcePosition891, root_id: 'outside891b2', has_other_messages: false } });
  await p.open('r891');
  p.f.registry.current.core = { next: { id: 'outside891b2', position: { root_id: 'outside891b2' } }, previous: null };
  await p.f.reader.step(1); await drain();
  assert.equal(p.f.registry.current.source.source_ref.id, 'outside891b2'); assert.equal(p.f.reader.dialog.open, true);
  assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 initial land-only URL lands visibly without opening the hidden source', async () => {
  const p = await questionPage891(dossier891B2(), { href: 'https://fixture/?topic=t1&message=q891&land=only' });
  assert.equal(p.f.document.activeElement?.dataset.id, 'r891'); assert.equal(p.visible('r891'), true);
  assert.equal(p.opens.length, 0); assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 same-topic dossier rail destination uses the visible landing owner', async () => {
  const p = await questionPage891B2(dossier891B2());
  await p.f.runObservation("openDestination({kind:'topic',id:'t1',message:'q891',land:true}, 'Fixture dossier')"); await drain();
  assert.equal(p.f.document.activeElement?.dataset.id, 'r891'); assert.equal(p.visible('r891'), true);
  assert.equal(p.opens.length, 0); assert.deepEqual(p.ids(), [['r891', 'r891b']]);
});

test('891 B2 Reader title return with no visible member reopens the exact source', async () => {
  const p = await questionPage891B2([ask891()]); await p.open('q891');
  const first = p.f.registry.current, opened = p.opens.length, kept = p.f.editor.draft.body;
  const button = p.f.get('reader-title').firstElementChild;
  assert.ok(button, 'real Reader title supplies the parent destination');
  await button.onclick(); await drain();
  assert.equal(p.opens.length, opened + 1);
  assert.equal(p.f.registry.current !== first, true, 'the existing close owner completes before the exact source reopens');
  assert.equal(p.f.reader.dialog.open, true);
  assert.equal(p.f.reader.source.source_ref.id, 'q891');
  assert.equal(p.f.reader.source.body, 'WITHDRAWN QUESTION WORDS');
  assert.equal(p.f.editor.draft.body, kept); assert.deepEqual(p.ids(), []);
  assert.equal(p.visible('q891'), false);
});

test('891 B2 Reader edge refuses a known question in an entirely omitted dossier', async () => {
  const other = { id: 'visible891b2', seq: 2, author_id: 'dan', body: 'Visible dossier',
    stack_position: { ...sourcePosition891, root_id: 'visible891b2', has_other_messages: false } };
  const p = await questionPage891B2([ask891(), other]); await p.open(other.id);
  p.f.registry.current.core = { next: { id: 'q891', position: sourcePosition891 }, previous: null };
  const opened = p.opens.length; await p.f.reader.step(1); await drain();
  assert.equal(p.opens.length, opened);
  assert.equal(p.f.registry.current.source.source_ref.id, other.id);
  assert.deepEqual(p.ids(), [[other.id]]); assert.equal(p.visible('q891'), false);
});

for (const answer of ['refused', 'unreached']) test(`891 B3 ${answer} split-out names the split message, not its containing dossier`, async () => {
  const p = await questionPage891([
    { id: 'rootB3', seq: 1, author_id: 'dan', body: 'Root words', acts: { name: { text: 'Bravo dossier', by: 'dan', at_ms: TODAY } } },
    { id: 'joinedB3', seq: 2, author_id: 'dan', body: 'Message to split', acts: { joined: { into: 'rootB3', by: 'dan', at_ms: TODAY }, join_revision: 7 } },
  ]);
  const feed = p.f.runObservation('stackFeed'), item = p.f.views.messages.get('joinedB3'), sent = [];
  assert.equal(feed.dossierName(item.id), 'Bravo dossier');
  p.f.api.command = async request => {
    sent.push(structuredClone(request));
    if (answer === 'unreached') throw new AttemptError('Connection interrupted');
    return { recorded: true, status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'The dossier changed elsewhere.' } };
  };
  feed.split(item); await feed.chain; await drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'stack.join'); assert.equal(sent[0].target.message_id, 'joinedB3');
  assert.equal(sent[0].args.into, null); assert.equal(sent[0].expected.join_revision, 7);
  const words = p.f.get('app-status').textContent;
  assert.match(words, answer === 'refused' ? /^Splitting out “Message to split” was not saved:/ : /^Not known yet whether splitting out “Message to split” was saved:/);
  assert.doesNotMatch(words, /Bravo dossier/);
  assert.equal(item.acts.joined.into, 'rootB3', 'a failed split leaves the recorded join intact');
  assert.equal(feed.doubts.size, answer === 'unreached' ? 1 : 0);
  if (answer === 'unreached') {
    const kept = [...feed.doubts.values()][0].envelope;
    assert.equal(kept.operation_id, sent[0].operation_id, 'recovery retains this exact operation');
    feed.deafen();
  }
});

function outcomeReads923({ conversation = false } = {}) {
  const f = fixture('https://fixture/?workspace=w1');
  const outline = mountOutcomeOutline(f), calls = [], original = f.api.view;
  const conversationTopic = { ...f.topic, id: 'conversation-923', kind: 'conversation', version: 1, activity_ms: 1, list_position: 1 };
  f.api.view = async (name, args) => {
    calls.push({ name, args });
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { id: 'w1', title: 'Outcome 923', owner_id: 'fixture-person', version: 1 } };
    if (name === 'workspace_topics') return { instance_id: 'fixture', items: [{ ...f.topic, activity_ms: 2, list_position: 2 }], next_cursor: null };
    if (name === 'conversation') return { instance_id: 'fixture', conversation: conversation ? { topic_id: conversationTopic.id } : null };
    if (name === 'topic' && args.topic_id === conversationTopic.id) return { instance_id: 'fixture', topic: conversationTopic, participants: [] };
    return original(name, args);
  };
  return { f, outline, calls };
}

test('923 actual outcome topics are asked before outcomes and paint while team and panels are held', async () => {
  const { f, calls } = outcomeReads923(), gate = defer(), view = f.api.view;
  const withheld = new Set(['wakes', 'workspace_members', 'outcome_checks', 'outcome_light', 'tools', 'memory_items', 'pipeline']);
  f.api.view = async (name, args) => { if (withheld.has(name)) await gate.promise; return view(name, args); };
  const opening = f.initialize(); await drain();
  const early = { cards: outcomeCardTitles(f), names: calls.map(call => call.name) };
  gate.resolve(); await opening; await drain();
  assert.deepEqual(early.cards, ['Fixture'], 'actual shared topic rows paint without waiting for the team or panels');
  assert.ok(early.names.indexOf('workspace_topics') >= 0);
  assert.ok(early.names.indexOf('workspaces') < 0 || early.names.indexOf('workspace_topics') < early.names.indexOf('workspaces'), 'current topics enter the lane first: ' + early.names.join(', '));
});

for (const conversation of [false, true]) test(`923 actual outline shares its one Conversation answer (${conversation ? 'present' : 'absent'})`, async () => {
  const { f, outline, calls } = outcomeReads923({ conversation });
  await f.initialize(); await drain();
  assert.equal(calls.filter(call => call.name === 'conversation').length, 1);
  assert.deepEqual(outcomeCardTitles(f), conversation ? ['Fixture', 'Fixture'] : ['Fixture']);
  assert.equal(outline.outcomes.get('w1').conversationRead, true);
  assert.equal(outline.outcomes.get('w1').conversation?.topic_id ?? null, conversation ? 'conversation-923' : null);
});

test('923 reopening an outcome shares its list Conversation answer too', async () => {
  const { f, outline, calls } = outcomeReads923({ conversation: true });
  await f.initialize(); await drain();
  const outcome = outline.outcomes.get('w1');
  outline.setOpen(outcome, false); calls.length = 0;
  outline.setOpen(outcome, true); await drain();
  assert.equal(calls.filter(call => call.name === 'conversation').length, 1);
  assert.equal(outcome.conversation.topic_id, 'conversation-923');
});

function scopedOutcome923(options = {}) {
  const setup = outcomeReads923(options), { f } = setup, history = { workspace: [], actor: [] };
  let seq = 0, denied = false;
  Object.assign(f.bootstrap, { authority: { authority_id: 'a', authority_epoch: 'e' }, transport: { read_admission: {
    version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 },
    background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } });
  const view = f.api.view, changes = [];
  f.api.view = async (name, args) => {
    if (denied && (name === 'workspace' || name === 'changes' && args.scope.kind === 'workspace')) throw Object.assign(Error('No permission for this workspace'), { code: 'FORBIDDEN' });
    if (name !== 'changes') return view(name, args);
    changes.push(args);
    const { scope, cursor } = args, versions = scope.kind === 'actor' ? {} : { workspace: 1, notebook: 0 };
    return { instance_id: 'fixture', scope, baseline: !cursor, items: cursor ? history[scope.kind].filter(item => item.seq > cursor.after_seq) : [],
      has_more: false, continuation: null, covered_versions: versions,
      checkpoint: { v: 1, kind: 'checkpoint', instance_id: 'fixture', authority_id: 'a', authority_epoch: 'e', actor_id: f.bootstrap.actor, scope, after_seq: seq } };
  };
  return { ...setup, changes, deny: value => { denied = value; }, add: (scope, kind, id = 'w1') => {
    history[scope].push({ seq: ++seq, resource_kind: kind, resource_id: id, version: 1 }); return seq;
  } };
}

for (const route of ['workspace', 'topic']) test(`904 actual ${route} outline refreshes a remote rename on its key, not an ordinary message`, async () => {
  const setup = route === 'workspace' ? scopedOutcome923() : (() => {
    const f = fixture('https://fixture/?topic=t1');
    return { f, outline: mountOutcomeOutline(f) };
  })();
  const { f, outline } = setup, live = stream(); live.outcomes = 'first'; f.useLive(live);
  const view = f.api.view; let title = 'First title', reads = 0, fail = false;
  f.api.view = async (name, args) => {
    if (name === 'workspaces') {
      reads++; if (fail) throw Error('List interrupted');
      return { instance_id: 'fixture', items: [{ id: 'w1', title, title_truncated: false, owner_id: 'fixture-person', version: 1 }], next_cursor: null };
    }
    return view(name, args);
  };
  await f.initialize(); await drain();
  assert.equal(outline.pages.items[0].title, title);
  reads = 0; setup.add?.('workspace', 'topic', 't1');
  live.emit({ kind: 'commit', seq: 1, outcomes: 'first' }); await drain();
  assert.equal(reads, 0, 'ordinary message keeps the global list cached');
  title = 'Renamed elsewhere';
  live.emit({ kind: 'commit', seq: 2, outcomes: 'second' }); await drain();
  assert.equal(reads, 1, 'one remote rename commit refreshes the actual list');
  assert.equal(outline.pages.items[0].title, title);
  fail = true; title = 'Retried title';
  live.emit({ kind: 'commit', seq: 3, outcomes: 'third' }); await drain();
  assert.equal(outline.pages.items[0].title, 'Renamed elsewhere');
  fail = false;
  live.emit({ kind: 'commit', seq: 4, outcomes: 'third' }); await drain();
  assert.equal(outline.pages.items[0].title, title, 'failed key remains owed');
});

test('923 actual commit refresh leaves unrelated private work alone and refreshes only the changed panels or stars', async () => {
  const { f, calls, changes, add } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain(); calls.length = changes.length = 0;
  add('actor', 'draft', 'private-draft'); await commit(live, 10);
  const lists = new Set(['workspaces', 'workspace', 'workspace_topics', 'conversation', 'workspace_members', 'outcome_checks', 'outcome_light', 'tools', 'memory_items', 'pipeline_row', 'stars', 'memory_stars']);
  assert.deepEqual(calls.filter(call => lists.has(call.name)), [], 'a private writing key changes none of these lists');
  assert.equal(changes.length, 2, 'both exact scopes are checked');
  calls.length = 0;
  add('workspace', 'checks', 'check-1'); await commit(live, 11);
  assert.deepEqual(calls.filter(call => lists.has(call.name)).map(call => call.name).sort(), ['outcome_checks', 'outcome_light']);
  calls.length = 0;
  add('actor', 'acts', 't1'); await commit(live, 12);
  assert.deepEqual(calls.filter(call => lists.has(call.name)).map(call => call.name), ['stars'], 'personal dossier changes refresh their actual star owner, once');
});

test('923 scoped access refusal hides the outcome and its cards, and a later permitted change recovers', async () => {
  const { f, deny, add } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain();
  assert.deepEqual(outcomeCardTitles(f), ['Fixture']);
  deny(true); await commit(live, 20);
  assert.equal(f.get('topic-title').textContent, 'Outcome unavailable');
  assert.equal(f.get('topic-navigation').hidden, true);
  assert.deepEqual(outcomeCardTitles(f), []);
  deny(false); add('workspace', 'workspace'); await commit(live, 21);
  assert.equal(f.get('topic-title').textContent, 'Outcome 923');
  assert.equal(f.get('topic-navigation').hidden, false);
  assert.deepEqual(outcomeCardTitles(f), ['Fixture']);
});

test('923 a failed full refresh remains owed even when the next change window is empty', async () => {
  const { f } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain();
  const view = f.api.view; let tools = 0;
  f.api.view = async (name, args) => {
    if (name === 'tools' && ++tools === 1) throw Error('The tools read was interrupted');
    return view(name, args);
  };
  for (const event of f.events.filter(event => event[0] === 'document-handler' && event[1] === 'visibilitychange')) event[2]({});
  await drain(); assert.equal(tools, 1);
  live.emit({ kind: 'state', state: 'live' }); await drain();
  assert.equal(tools, 2, 'the failed full read is retried without needing a new resource key');
});

test('923 B2 ordinary commit refreshes do not read the global list, but explicit workspace and visibility changes do', async () => {
  const { f, calls, add } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain();
  for (const [scope, kind] of [['workspace', 'topic'], ['workspace', 'pipeline'], ['actor', 'mark'], ['actor', 'delivery'], ['actor', 'waiting']]) {
    calls.length = 0; await commit(live, add(scope, kind));
    assert.equal(calls.filter(call => call.name === 'workspaces').length, 0, scope + ':' + kind);
    assert.ok(calls.some(call => call.name === 'workspace_topics'), 'local topic owner still refreshes');
  }
  calls.length = 0; await commit(live, add('workspace', 'workspace'));
  assert.equal(calls.filter(call => call.name === 'workspaces').length, 1);
  calls.length = 0;
  for (const event of f.events.filter(event => event[0] === 'document-handler' && event[1] === 'visibilitychange')) event[2]({});
  await drain(); assert.equal(calls.filter(call => call.name === 'workspaces').length, 1);
});

test('923 B2 failed changes read falls back to full lists and retries the same checkpoint', async () => {
  const { f, calls, changes, add } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain(); const view = f.api.view; let fail = true, refusedCursor;
  f.api.view = async (name, args) => {
    if (name === 'changes' && args.cursor && fail) { refusedCursor = args.cursor.after_seq; throw Error('Changes interrupted'); }
    return view(name, args);
  };
  calls.length = 0; await commit(live, add('workspace', 'checks'));
  assert.ok(calls.some(call => call.name === 'workspace'), 'failed scoped changes must not silently suppress the refresh');
  assert.ok(calls.some(call => call.name === 'outcome_checks'));
  fail = false; changes.length = 0; calls.length = 0; await commit(live, 50);
  assert.equal(changes[0].cursor.after_seq, refusedCursor, 'failed changes were never accepted');
  assert.ok(calls.some(call => call.name === 'outcome_checks'));
});

test('923 B2 a star commit during More reads a fresh star page before settling', async () => {
  const { f, outline, add } = scopedOutcome923(), live = stream(); f.useLive(live);
  await f.initialize(); await drain();
  // The outcome's center cards are not rail anchors. Model one visible topic
  // row while retaining the actual outline refresh and star sync/read/paint.
  const parent = f.document.createElement('a'); parent.dataset.topicId = 't1'; outline.list.append(parent);
  outline.dossiers.parents = () => [parent]; outline.dossiers.sync();
  await outline.dossiers.states.get('t1').busy;
  const view = f.api.view, old = defer(), fresh = defer(), reads = [];
  f.api.view = async (name, args) => {
    if (name !== 'stars') return view(name, args);
    reads.push(args); return reads.length === 1 ? old.promise : fresh.promise;
  };
  const state = outline.dossiers.states.get('t1'); state.next = 10;
  let done = false; const more = outline.dossiers.load(state, true).then(() => { done = true; });
  await drain(); await commit(live, add('actor', 'acts', 't1'));
  old.resolve({ instance_id: 'fixture', items: [], next_cursor: null }); await drain();
  assert.equal(reads.length, 2, 'the commit needs a newer page than the held More response');
  assert.equal(reads[1].cursor, undefined); assert.equal(done, false);
  fresh.resolve({ instance_id: 'fixture', items: [{ topic_id: 't1', star: 11, dossier: { id: 'star-923', name: 'New star' } }], next_cursor: null });
  await more; await drain();
  // 151 wraps original star words so a retracted name can be decorated.
  const words = node => typeof node === 'string' ? node : (node.textContent ?? '') + (node.children ?? []).map(words).join('');
  assert.equal(words(state.links.get('star-923')), '★ New star');
});

for (const conversation of [false, true]) test(`923 actual app read trace reaches topics in bounded rounds (${conversation ? 'Conversation' : 'no Conversation'})`, async t => {
  const { f, calls } = scopedOutcome923({ conversation }), pending = [], trace = [];
  let round = 0, active = 0, max = 0, complete = false, failed = null, painted = null;
  const actual = new RealApi('fixture', (path, options) => {
    const body = options.body ? JSON.parse(options.body) : null, foreground = options.headers['X-AIM-Read-Class'] !== 'background';
    if (foreground) max = Math.max(max, ++active);
    trace.push({ round, name: body?.name ?? 'bootstrap' });
    return new Promise(resolve => pending.push(async () => {
      const value = path === '/api/bootstrap' ? f.bootstrap : await f.api.view(body.name, body.args);
      resolve({ ok: true, json: async () => { if (foreground) active--; return value; } });
    }));
  });
  // The only substituted boundary is the network: app, Api, Shell and Outline
  // retain their actual queues and call sites. No socket or store is opened.
  f.runObservation('globalThis.makeApi923 = null');
  f.runObservation('Api = class { constructor() { return globalThis.makeApi923(); } }');
  // Pass this real API through the existing VM observation door, without a
  // second app body or a different source loader.
  f.runObservation('globalThis.apiDoor923 = value => { globalThis.makeApi923 = () => value; }')(actual);
  const opening = f.initialize().then(() => { complete = true; }, error => { failed = error; complete = true; });
  for (let step = 0; step < 35; step++) {
    await drain();
    if (outcomeCardTitles(f).length && painted === null) painted = round;
    if (complete && !pending.length) break;
    const batch = pending.splice(0); round++;
    await Promise.all(batch.map(release => release()));
  }
  await opening; await drain();
  if (failed) throw failed;
  t.diagnostic(JSON.stringify({ conversation, roundsToTopics: painted, totalReads: trace.length, foregroundMaximum: max, trace }));
  assert.ok(complete);
  assert.equal(painted, conversation ? 6 : 5, 'actual dependent rounds to first topic cards, including bootstrap and scoped baselines');
  assert.ok(max <= 4, `actual API foreground maximum ${max}`);
  assert.equal(trace.filter(call => call.name === 'conversation').length, 1);
});

// Real app listeners on the Reader source body; the fixture only supplies DOM
// propagation. Shared descriptors and (above) all four real Edit endings run.
function readerText909(x) {
  const body = x.f.get('source-body'); x.overlay.append(body);
  const words = x.control('span', body); words.textContent = x.item.body;
  return { body, words, emit(type, target = words, props = {}) {
    const event = { target, button: 0, detail: 2, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
    body.handlers[type]?.(event); return event;
  } };
}
test('909 Reader own-text double click uses More Edit and replaces word selection without reopening', async () => {
  const x = await editClick890(); await openReader909(x); const r = readerText909(x);
  assert.equal(r.emit('mousedown', r.words, { detail: 1 }).defaultPrevented, undefined);
  assert.equal(r.emit('mousedown').defaultPrevented, true);
  const event = r.emit('dblclick'); await settle();
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  assert.equal(x.edits.length, 1); assert.equal(x.edits[0][0], x.item.id);
  assert.equal(x.edits[0][1], x.f.get('reader-menu'));
  assert.equal(x.opened(), 1); assert.equal(x.overlay.open, true);
  assert.equal(x.f.runObservation('selectionClears890'), 1);
});
test('909 Reader Edit eligibility is rechecked for each gesture', async () => {
  for (const mode of ['other author', 'agent', 'reached', 'unavailable', 'source unavailable', 'memory', 'closed', 'already editing']) {
    const x = await editClick890(mode === 'other author' ? { author: 'someone-else' } : {});
    await openReader909(x); const r = readerText909(x);
    if (mode === 'agent') x.f.bootstrap.actor_kind = 'agent';
    if (mode === 'reached') x.f.runObservation('outcomeReached = true');
    if (mode === 'unavailable') x.f.runObservation('topicUnavailable = true');
    if (mode === 'source unavailable') x.f.registry.current.sourceUnavailable = true;
    if (mode === 'memory') x.f.registry.current.source.source_ref.kind = 'memory';
    if (mode === 'closed') x.overlay.open = false;
    if (mode === 'already editing') x.f.runObservation('messageEdit = {}');
    const down = r.emit('mousedown'), event = r.emit('dblclick'); await settle();
    assert.equal(down.defaultPrevented, undefined, mode); assert.equal(event.defaultPrevented, undefined, mode);
    assert.equal(x.edits.length, 0, mode); assert.equal(x.f.runObservation('selectionClears890'), 0, mode);
  }
});
test('909 controls, Reader whitespace, outside text and modified clicks keep their actions', async () => {
  const x = await editClick890(); await openReader909(x); const r = readerText909(x);
  for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'img', 'svg']) {
    const control = x.control(tag, r.words), nested = x.control('span', control);
    for (const target of [control, nested]) {
      assert.equal(r.emit('mousedown', target).defaultPrevented, undefined, tag);
      assert.equal(r.emit('dblclick', target).defaultPrevented, undefined, tag);
    }
  }
  for (const [attr, value] of [['contenteditable', 'true'], ['role', 'button']]) {
    const control = x.control('span', r.words); control.setAttribute(attr, value);
    assert.equal(r.emit('dblclick', control).defaultPrevented, undefined, attr);
  }
  for (const target of [r.body, x.words, x.f.get('reader-menu')]) assert.equal(r.emit('dblclick', target).defaultPrevented, undefined);
  for (const props of [{ button: 1 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])
    assert.equal(r.emit('dblclick', r.words, props).defaultPrevented, undefined);
  await settle(); assert.equal(x.edits.length, 0);
});

async function openReader909(x) {
  await x.f.owners().marks.open(x.f.registry, { kind: 'message', id: x.item.id }, { opener: x.card });
  await settle();
}
for (const ending of ['Save', 'Cancel', 'Use saved', 'Escape']) test('909 ' + ending + ' after Reader text double-click keeps the Reader and More focus', async () => {
  {
    const entry = 'Reader double click', x = await editFinish890(), { f } = x;
    try {
      await openReader909(x); readerText909(x).emit('dblclick');
      await settle();
      const session = f.runObservation('messageEdit'); assert.ok(session, entry + ' starts a real edit');
      const host = f.get('message-edit'), field = host.children[0];
      assert.equal(f.document.activeElement === field, true); assert.equal(f.reader.dialog.dataset.editing, 'true');
      field.value = 'Exact revised words'; field.handlers.input();
      if (ending === 'Use saved') {
        x.conflict(); await host.querySelector('[data-act="save"]').onclick(); await settle();
        assert.equal(session.writing.state, 'conflict'); assert.equal(host.children[1].hidden, false);
        await host.querySelector('[data-act="saved"]').onclick();
      } else if (ending === 'Save') await host.querySelector('[data-act="save"]').onclick();
      else if (ending === 'Cancel') await host.querySelector('[data-act="cancel"]').onclick();
      else f.reader.escape();
      await settle();
      assert.equal(f.runObservation('messageEdit'), null, entry + ': the actual finish/leave owner ended Edit');
      assert.equal(f.reader.dialog.open, true); assert.equal(f.reader.editing, null); assert.equal(f.reader.sourceBody.hidden, false);
      assert.equal(f.document.activeElement === f.get('reader-menu'), true, entry + ': focus returns to the Reader More control, not its inert feed card');
      assert.equal(session.writing.closed, true);
      assert.equal(session.writing.state, { Save: 'saved', Cancel: 'cancelled', 'Use saved': 'discarded', Escape: 'editing' }[ending]);
      assert.deepEqual(x.commands.map(sent => sent.kind), ending === 'Save' ? ['message.edit_open', 'message.edit']
        : ending === 'Use saved' ? ['message.edit_open', 'message.edit', 'message.edit_close']
        : ending === 'Cancel' ? ['message.edit_open', 'message.edit_close'] : ['message.edit_open']);
      if (ending === 'Save') assert.equal(f.registry.current.source.body, 'Exact revised words');
      if (ending === 'Use saved') assert.equal(f.registry.current.source.body, 'Saved on another device');
      if (ending === 'Escape') assert.equal(f.runObservation('device890.held.value'), 'Exact revised words');
    } finally { f.runObservation('messageEdit?.writing.close()'); }
  }
});


test('929 modified second clicks do not become a pending double-click or replace selection', async () => {
  for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    const x = await editClick890(), held = x.hold(); x.click();
    const second = x.click(x.words, { [key]: true, detail: 2, timeStamp: 1100 });
    assert.notEqual(second.defaultPrevented, true, key); held.resolve(); await settle();
    assert.equal(x.opened(), 0, key); assert.equal(x.edits.length, 0, key);
    assert.equal(x.f.runObservation('selectionClears890'), 0, key);
  }
});
test('929 a key between presses cancels the pending double-click', async () => {
  const x = await editClick890(), held = x.hold(); x.click();
  x.emit('keydown', x.words, { key: 'Escape' });
  const second = x.click(x.words, { detail: 2, timeStamp: 1100 });
  assert.notEqual(second.defaultPrevented, true); held.resolve(); await settle();
  assert.equal(x.opened(), 0); assert.equal(x.edits.length, 0); assert.equal(x.f.runObservation('selectionClears890'), 0);
});
test('929 Space uses the card action once; repeat, modifiers and nested fields keep their keys', async () => {
  const x = await editClick890(); x.card.click = () => x.emit('click', x.card, { detail: 0 });
  for (const props of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: x.words }])
    x.card.handlers.keydown({ target: x.card, key: ' ', preventDefault() {}, ...props });
  await settle(); assert.equal(x.inlineOpens(), 0); assert.equal(x.opened(), 0);
  x.card.handlers.keydown({ target: x.card, key: ' ', preventDefault() {} }); await settle();
  assert.equal(x.inlineOpens(), 1); assert.equal(x.opened(), 0);
  x.card.handlers.keydown({ target: x.card, key: ' ', preventDefault() {} }); await settle();
  assert.equal(x.opened(), 1); assert.equal(x.edits.length, 1);
});

// 933: actual app/OutlineRail/OutcomeChanges. Read-port answers only; no
// browser, Core, HTTP or time claim in these Node checks.
function countsOutline933(route = 'workspace') {
  const setup = route === 'workspace' ? scopedOutcome923() : (() => {
    const f = fixture('https://fixture/?topic=t1'); return { f, outline: mountOutcomeOutline(f) };
  })();
  const { f } = setup, live = stream(); live.outcomes = 'stable'; f.useLive(live);
  const metrics = (id, unread = 0) => ({ id, unread, addressed: 0, build: { unread: 0, addressed: 0 }, cover_waiting: 0, light: null });
  const rows = ['w1', 'w2'].map(id => ({ id, title: 'Outcome ' + id, title_truncated: false, owner_id: 'fixture-person', version: 1, ...metrics(id) }));
  const counts = new Map(rows.map(row => [row.id, metrics(row.id)])), calls = [], view = f.api.view;
  let fail = false, hold = null;
  f.api.view = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'workspaces') return { instance_id: 'fixture', items: structuredClone(rows), next_cursor: null, order: { ids: ['w2', 'w1'], revision: 1 } };
    if (name === 'workspace_counts') {
      const answer = { instance_id: 'fixture', items: args.workspace_ids.map(id => structuredClone(counts.get(id))) };
      if (hold) await hold.promise;
      if (fail) throw Error('Counts interrupted');
      return answer;
    }
    return view(name, args);
  };
  return { ...setup, live, rows, counts, calls, fail: value => { fail = value; }, hold: value => { hold = value; } };
}

for (const route of ['workspace', 'topic']) test(`933 ${route}: arrival in folded Y updates its count/lamp and elsewhere in one commit without a list reread`, async () => {
  const { f, outline, live, counts, calls, add } = countsOutline933(route);
  await f.initialize(); await drain();
  outline.opened.set('w2', false); outline.paint();
  const y = outline.outcomes.get('w2'), node = y.li, before = outline.pages.items.map(row => [row.id, row.title]);
  const order = outline.pages.order, next = outline.pages.next;
  counts.set('w2', { id: 'w2', unread: 3, addressed: 2, build: { unread: 1, addressed: 1 }, cover_waiting: 1,
    light: { light: 'waiting', label: 'Waiting on you', short: { kind: 'asks', count: 2 }, unreadable: false } });
  calls.length = 0;
  live.emit({ kind: 'commit', seq: add?.('actor', 'delivery', 'foreign-message') ?? 2, outcomes: 'stable' }); await drain();
  assert.equal(outline.pages.loaded.get('w2').unread, 3);
  assert.equal(y.item.light.light, 'waiting');
  assert.equal(y.li.hasAttribute('data-fresh'), true, 'actual folded row paints new');
  assert.equal(y.li.hasAttribute('data-waiting'), true, 'actual folded row paints waiting');
  assert.equal(y.li, node); assert.equal(outline.isOpen('w2'), false);
  assert.deepEqual(outline.pages.items.map(row => [row.id, row.title]), before);
  assert.equal(outline.pages.order, order); assert.equal(outline.pages.next, next);
  assert.match(f.get('outline-elsewhere').children.map(child => child.textContent).join(' '), /3 new in 1 other outcome/);
  assert.equal(calls.filter(call => call.name === 'workspaces').length, 0);
  assert.equal(calls.filter(call => call.name === 'workspace_counts').length, 1);
  assert.deepEqual(calls.find(call => call.name === 'workspace_counts').args.workspace_ids, ['w1', 'w2']);
});

test('933 counts failure retains the scoped window; retry and a mark clear the count without a list read', async () => {
  const { f, outline, live, counts, calls, add, fail, changes } = countsOutline933();
  await f.initialize(); await drain();
  counts.get('w2').unread = 4; fail(true); calls.length = 0;
  await commit(live, add('actor', 'waiting', 'other-topic'));
  assert.equal(outline.pages.loaded.get('w2').unread, 0, 'failed answer publishes no counts');
  const refusedAt = changes.filter(args => args.scope.kind === 'actor' && args.cursor).at(-1).cursor.after_seq;
  fail(false); changes.length = 0; await commit(live, 20);
  assert.equal(outline.pages.loaded.get('w2').unread, 4);
  assert.equal(changes.find(args => args.scope.kind === 'actor' && args.cursor).cursor.after_seq, refusedAt);
  counts.get('w2').unread = 0;
  await commit(live, add('actor', 'mark', 'other-message'));
  assert.equal(outline.pages.loaded.get('w2').unread, 0);
  assert.equal(calls.filter(call => call.name === 'workspaces').length, 0);
});

test('933 a retired run cannot merge late counts', async () => {
  const { f, outline, counts, hold } = countsOutline933();
  await f.initialize(); await drain();
  const gate = defer(); counts.get('w2').unread = 7; hold(gate);
  const loading = outline.load(new Set(['counts'])); await drain();
  outline.begin(true); gate.resolve(); await loading;
  assert.equal(outline.pages.loaded.get('w2').unread, 0);
  hold(null);
  assert.equal(outline.handles, null);
});

test('933 bounded chunks publish atomically and reject missing, duplicate or foreign count rows', async () => {
  const { f, outline, counts, calls } = countsOutline933();
  await f.initialize(); await drain();
  f.bootstrap.limits = { page_max: 2 };
  outline.pages.loaded.set('w3', { ...outline.pages.loaded.get('w2'), id: 'w3' });
  counts.set('w3', { ...counts.get('w2'), id: 'w3' });
  for (const row of counts.values()) row.unread = 5;
  const view = f.api.view; let mode = 'failed-second';
  f.api.view = async (name, args) => {
    const answer = await view(name, args);
    if (name !== 'workspace_counts') return answer;
    if (mode === 'failed-second' && args.workspace_ids.includes('w3')) throw Error('Second chunk interrupted');
    if (mode === 'missing') answer.items.pop();
    if (mode === 'duplicate') answer.items[1] = answer.items[0];
    if (mode === 'foreign') answer.instance_id = 'foreign';
    return answer;
  };
  calls.length = 0;
  assert.equal(await outline.load(new Set(['counts'])), false);
  assert.equal(outline.pages.loaded.get('w1').unread, 0, 'successful first chunk cannot publish before the second');
  assert.deepEqual(calls.filter(call => call.name === 'workspace_counts').map(call => call.args.workspace_ids), [['w1', 'w2'], ['w3']]);
  for (mode of ['missing', 'duplicate', 'foreign']) {
    assert.equal(await outline.load(new Set(['counts'])), false, mode);
    assert.equal(outline.pages.loaded.get('w1').unread, 0, mode);
  }
  mode = 'valid';
  assert.equal(await outline.load(new Set(['counts'])), true);
  assert.deepEqual(Array.from(outline.pages.items, row => row.unread), [5, 5, 5]);
  assert.equal(calls.filter(call => call.name === 'workspaces').length, 0);
});

function review931() {
  const f = fixture('https://fixture/?topic=t1', { refusedAtDraft: uploadState931.refusedAtDraft, refusedCopyAtDraft: uploadState931.refusedCopyAtDraft, readableUploads: uploadState931.readableUploads });
  f.editor.sourceRef = structuredClone(f.editor.context.sourceRef);
  Object.assign(f.editor, { localVersion: 4, ackVersion: 4, clientCycleId: 'cycle931',
    uploadState: { format: 2, revision: 1, client_cycle_id: 'cycle931', entries: [], submission_links: {} } });
  Object.assign(f.editor.draft, { id: 'draft931', generation: 'generation931', revision: 3, quotes: [], intent: 'tell', whisper: false });
  const row = (draft = f.editor.draft) => ({ id: 'copy931', stamp: 'stamp931', availability: 'available',
    snapshot: { format: 1, draft: structuredClone(draft), localVersion: 4, ackVersion: 4, submissions: [] } });
  const list = items => f.owners().candidates.set(f.editor.key, { items, nextCursor: null });
  return { f, row, list, needs: () => f.runObservation('needsReview(registry.inline.editors.reply)') };
}
test('931 an empty upload state and ordinary newer typing ask for no version decision', () => {
  const { f, needs } = review931(); assert.equal(needs(), false);
  f.editor.draft.body += ' and more'; f.editor.localVersion++; assert.equal(needs(), false);
});
test('931 identical saved writing ignores caret and save metadata, before and after more typing', () => {
  const { f, row, list, needs } = review931(); const saved = row(); saved.snapshot.draft.caret = { start: 2, end: 2 };
  saved.snapshot.draft.revision = 2; list([saved]); assert.equal(needs(), false);
  f.editor.draft.body += ' newer'; f.editor.localVersion++; assert.equal(needs(), false, 'a known older saved revision in this generation is not competing writing');
});
test('931 unreadable copies and unloaded pages do not claim a known writing difference', () => {
  const { f, list, needs } = review931(); list([{ id: 'held', availability: 'open-in-another-tab' }]); assert.equal(needs(), false);
  f.owners().candidates.set(f.editor.key, { items: [], nextCursor: 'later-page' }); assert.equal(needs(), false);
});
test('931 a different unsaved copy asks for a decision while an identical unsaved copy does not', () => {
  const { row, list, needs } = review931(); const saved = row(); saved.snapshot.localVersion = 5;
  list([saved]); assert.equal(needs(), false);
  saved.snapshot.draft.body = 'Other words'; assert.equal(needs(), true);
});
test('931 the frozen refused writing is compared even when its successor draft matches', () => {
  const { f, row, list, needs } = review931(); const saved = row();
  saved.snapshot.format = 2; saved.snapshot.clientCycleId = f.editor.clientCycleId; saved.snapshot.uploadState = structuredClone(f.editor.uploadState);
  saved.snapshot.submissions = [{ status: 'refused', receipt: { kind: 'submission.prepare' }, snapshot: { ...structuredClone(f.editor.draft), body: 'Earlier refused words' } }];
  f.editor.recoveryServerDraft = structuredClone(f.editor.draft); list([saved]); assert.equal(needs(), true);
});

test('931 the pill names the actual refused difference and opens with it first', async () => {
  const { f, row, list } = review931(); const saved = row(); saved.snapshot.localVersion++;
  saved.snapshot.draft.body = 'The different saved words'; list([saved]);
  const state = f.runObservation('reviewState(registry.inline.editors.reply)');
  assert.equal(state.text, 'Check recovery'); assert.match(state.title, /copy.*differs from this field/);
  f.registry.recoveryCandidates = async (_editor, _options, shown) => { const page = { items: [], nextCursor: null }; shown(page, false); return page; };
  f.get('version-review').showModal = function() { this.open = true; };
  await f.showVersions(f.editor, f.get('opener'), f.p);
  assert.equal(f.get('review-content').children[0].children.at(-1).textContent, 'The different saved words');
});
test('931 runtime recovery retains its action without claiming a known version difference', () => {
  const { f, needs } = review931(); f.editor.authorityRecovery = { phase: 'parked' };
  assert.equal(needs(), false); const state = f.runObservation('reviewState(registry.inline.editors.reply)');
  assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
});
test('931 identical writing with an unknown public send keeps a recovery action', () => {
  const { f, row, list, needs } = review931(), saved = row(); saved.snapshot.submissions = [{ status: 'prepared' }]; list([saved]);
  assert.equal(needs(), false);
  const state = f.runObservation('reviewState(registry.inline.editors.reply)'); assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
  assert.equal(saved.snapshot.submissions[0].status, 'prepared');
});

test('931 R2 a plain other-tab journal row without snapshot keeps the recovery door', () => {
  const { f, list, needs } = review931();
  const held = { id: 'held', editorKey: f.editor.key, writerId: 'other-tab', stamp: 's', availability: 'open-in-another-tab', uploadPresent: false };
  assert.equal(Object.hasOwn(held, 'snapshot'), false);
  list([held]); assert.equal(needs(), false);
  let state = f.runObservation('reviewState(registry.inline.editors.reply)');
  assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
  list([{ ...held, availability: 'unreadable' }]);
  assert.equal(f.runObservation('reviewState(registry.inline.editors.reply)').hidden, false);
  list([{ ...held, active: 0, superseded_by: 'new-writer' }]);
  assert.equal(f.runObservation('reviewState(registry.inline.editors.reply)').hidden, true, 'retired rows need no recovery action');
});
test('931 R2 cleanup failure keeps the only door to retry', () => {
  const { f, needs } = review931(); f.editor.cleanupError = 'Could not check the saved writing';
  assert.equal(needs(), false);
  const state = f.runObservation('reviewState(registry.inline.editors.reply)');
  assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
});
test('931 R2 own retained bytes and unsettled image attempts keep recovery reachable', () => {
  const { f, needs } = review931();
  for (const entry of [
    { selected: false, bytes_ref: 'retained-file', attempts: [] },
    { selected: false, bytes_ref: null, attempts: [{ phase: 'publish-unknown', begin_response: { recorded: true }, publish_response: null }] },
  ]) {
    f.editor.uploadState.entries = [entry]; assert.equal(needs(), false);
    const state = f.runObservation('reviewState(registry.inline.editors.reply)');
    assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
  }
  f.editor.uploadState.entries = [{ selected: false, bytes_ref: null, attempts: [{ phase: 'ready', publish_response: { recorded: true } }] }];
  assert.equal(f.runObservation('reviewState(registry.inline.editors.reply)').hidden, true, 'receipted work without bytes is quiet');
});
test('931 R2 opaque upload metadata keeps recovery reachable without reading malformed entries', () => {
  const { f } = review931(); f.editor.uploadOpaque = true;
  for (const entries of [undefined, {}, [null], [{ attempts: [null] }]]) {
    f.editor.uploadState = { format: 2, entries };
    const state = f.runObservation('reviewState(registry.inline.editors.reply)');
    assert.equal(state.hidden, false); assert.equal(state.text, 'Check recovery');
  }
});
test('931 R2 every conflict review rereads the remote, including its first comparison', async () => {
  const { f } = review931();
  const currentWords = f.editor.draft.body;
  const remote = body => ({ ...structuredClone(f.editor.draft), body });
  f.editor.conflict = { remote: remote('Obsolete remote'), attempted: structuredClone(f.editor.draft) };
  f.registry.recoveryCandidates = async (_editor, _options, shown) => { const page = { items: [], nextCursor: null }; shown(page, false); return page; };
  f.get('version-review').showModal = function() { this.open = true; };
  let latest = 'Fresh remote one', reads = 0; const view = f.api.view;
  f.api.view = async (name, args) => name === 'editor_state'
    ? (++reads, { ...f.state(), draft: remote(latest) }) : view(name, args);
  for (const words of ['Fresh remote one', 'Fresh remote two']) {
    latest = words; await f.showVersions(f.editor, f.get('opener'), f.p);
    assert.equal(f.get('review-content').children[0].children.at(-1).textContent, words);
  }
  assert.equal(reads, 2);
  assert.equal(f.editor.draft.body, currentWords, 'fresh reads never overwrite current writing');
});


for (const failed of [false, true]) test(`864 startup ${failed ? 'unconfirmed' : 'empty'} lookup retains the original initializer`, async () => {
  const f = fixture('https://fixture/?topic=t1', { resolveTopicLink: async () => {
    if (failed) throw Error('Destination could not be confirmed');
    return null;
  } });
  await f.initialize(); await drain();
  assert.equal(f.get('body').dataset.ready, 'true');
  assert.equal(f.get('topic-title').textContent, 'Fixture');
  assert.equal(f.runObservation('topic.id'), 't1');
});

test('864 ordinary internal destinations do not request topic-name lookup', async () => {
  let lookups = 0;
  const f = fixture('https://fixture/', { resolveTopicLink: async () => { lookups++; throw Error('Unconfirmed'); } });
  await f.initialize(); await drain();
  f.runObservation('shell.go = () => true');
  await f.runObservation("openDestination({ kind: 'topic', id: 't2' }, 'Known route')");
  assert.equal(lookups, 0);
});

test('864 an unconfirmed authored query uses the existing departure guard and keeps writing', async () => {
  const assigned = [], location = { href: 'https://fixture/?topic=t1', origin: 'https://fixture', assign: href => assigned.push(href), reload() {} };
  const f = fixture('https://fixture/?topic=t1', { location });
  // Model an interrupted lookup explicitly. The generic fixture returns t1
  // for every topic read; a mismatched identity now refuses under 958.
  const read = f.api.view;
  f.api.view = async (name, args, options) => {
    if (name === 'topic' && args.topic_id === 't2') throw Object.assign(Error('Connection interrupted'), { code: 'REQUEST_UNCONFIRMED' });
    return read(name, args, options);
  };
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  f.registry.keepEditorsLocal = async () => {};
  Object.assign(f.editor, { localVersion: 1, ackVersion: 0 });
  Object.defineProperty(f.editor, 'dirty', { get: () => f.editor.ackVersion < f.editor.localVersion });
  f.registry.flush = async () => ({ recorded: false, status: 'unknown' });
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await drain();
  f.views.messages.set('m864', { id: 'm864', seq: 1, author_id: 'fable', body: '[Next](?topic=t2)', topic_id: 't1', sent_ms: null, reply_to: null });
  f.paintViews('messages');
  const [a] = linksIn(entryIn(f, 'm864'));
  assert.equal(a.href, '?topic=t2');
  clicked(a); await drain();
  assert.deepEqual(assigned, []);
  assert.equal(f.editor.draft.body, 'kept');
  assert.match(f.get('topic-navigation-status').textContent, /not confirmed saved/);
  f.registry.flush = async () => { f.editor.ackVersion = 1; return { recorded: true, status: 'committed' }; };
  clicked(a); await drain();
  assert.deepEqual(assigned, ['?topic=t2']);
});
