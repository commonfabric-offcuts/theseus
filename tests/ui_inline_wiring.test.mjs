// Exercises actual app/inline-adapter functions below the native browser. Only
// imports and auto-start are replaced; no product function body is copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as writing from '../web/writing-helpers.mjs';
import { readFailure, checkedView, bindingOf, Freshness } from '../web/freshness.mjs';
import { currentImages } from '../web/upload-state.mjs';
import { WritingInput } from '../web/writing-input.mjs';
import { ReadThrough } from '../web/read-through.mjs';
import { Live, liveOffered, reloader } from '../web/live.mjs';
import { Attention, paintSent } from '../web/attention.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { replyLine } from '../web/replies.mjs';
import { placeNewLine } from '../web/unanswered.mjs';
import { cardClass, agentColor, AGENT_PALETTE } from '../web/author-colors.mjs';
import { AgentColors } from '../web/colors.mjs';
import { openColorPicker } from '../web/color-picker.mjs';
import * as times from '../web/times.mjs';
// Every shown time is read on one fixed day, noon on Thursday 5 November 2026, wherever and whenever the check runs.
const TODAY = new Date(2026, 10, 5, 12, 0).getTime();
times.clock.now = () => TODAY;
import { PageReads } from '../web/page-reads.mjs';
import { PageHere } from '../web/page-here.mjs';
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
// overrides: names the app imports, replaced in its scope for one test.
function fixture(href = 'https://fixture/?topic=t1', overrides = {}) {
  const elements = new Map(), events = [], calls = [], paints = [], observers = [], days = [];
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; this.isConnected = true; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
    append(...items) { for (const item of items) { if (typeof item === 'object') item.parent = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    prepend(...items) { for (const item of items) item.remove(); this.children.unshift(...items); for (const item of items) item.parent = this; }
    after(...items) { const host = this.parent; if (!host) return; for (const item of items) item.remove(); host.children.splice(host.children.indexOf(this) + 1, 0, ...items); for (const item of items) item.parent = host; }
    get parentNode() { return this.parent ?? null; }
    get ownerDocument() { return this.owner ?? document; }
    set ownerDocument(value) { this.owner = value; }
    get firstElementChild() { return this.children[0]; }
    querySelector(selector) { return get(selector.slice(1)); }
    // The rail's sideways strips are a phone layout this fixture does not draw.
    querySelectorAll(selector = '') { return selector.includes('#topics') ? [] : [...elements.values()].filter(el => el.id.startsWith('inline-') && el.id !== 'inline-composer'); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    getAttribute(name) { return this[name] ?? null; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    closest(selector) { for (let at = this; at; at = at.parent) if (selector.startsWith('.') && String(at.className ?? '').split(' ').includes(selector.slice(1))) return at; return null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const document = { body: get('body'), activeElement: null, visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, getElementById: get,
    createElement: () => new Element(), querySelectorAll: () => [], querySelector: s => s.startsWith('meta') ? { content: 'fixture-session' } : get(s.slice(1)),
    addEventListener(name, fn) { events.push(['document-handler', name, fn]); } };
  const bootstrap = { instance_id: 'fixture', actor: 'fixture-person', actor_kind: 'human', authority: { id: 'a', epoch: 'e' } };
  const topic = { id: 't1', title: 'Fixture', workspace_id: 'w1' };
  const api = { bootstrap: async () => bootstrap, view: async (name, args) => {
    calls.push({ name, args });
    if (name === 'topic') return { instance_id: 'fixture', topic, participants: [] };
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { title: 'Workspace' } };
    if (name === 'marks') return { instance_id: 'fixture', topic_id: args.topic_id, items: [], next_cursor: null };
    if (name === 'colors') return { instance_id: 'fixture', palette: [...AGENT_PALETTE], items: [], next_cursor: null };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  }, command: async envelope => { calls.push({ kind: envelope.kind, envelope }); return { recorded: true }; } };
  const editor = { key: 'inline', dirty: true, submissions: [], draft: { body: 'kept', addressees: [], attachments: [], caret: { start: 0, end: 0 } }, context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'topic', id: 't1' } } };
  const p = { surface: 'inline', initialized: true, topic, mode: 'reply', editors: { reply: editor } };
  const uploads = { current: () => [], running: new Map(), status: () => 'Ready' };
  const registry = { inline: p, current: null, sessions: new Map([[editor.key, { editor }]]), disposed: false,
    get interactive() { return this.current ?? this.inline; },
    isCurrent(p) { return !!p && this.interactive === p; }, isSourceCurrent(p) { return !!p && this.current?.source === p.source; },
    cancelSave(e) { events.push(['cancel', e.key]); }, schedule(e) { events.push(['schedule', e.key]); },
    validateState(state, ref, topicId) { assert.equal(state.source_ref.id, ref.id); assert.equal(state.destination.topic_id, topicId); },
    pending() { return { items: [], next_cursor: null }; }, cancelOpen() { return false; },
    sessionFor() { return { uploads }; }, status() { return 'Saved'; }, saveSign() { return { state: 'saved', text: 'Saved' }; },
    cleanup: { foregroundListeners: new Set(), resumeListeners: new Set(), foreground() { return { read: action => action({}), release() { events.push(['release']); } }; },
      list: action => action({ readClass: 'foreground' }) },
    runtime: { current: bootstrap.authority },
  };
  const reader = { notice: text => events.push(['reader-notice', text]), paintOffer() {}, paintStatus() {}, hideUnavailableSource() {}, drawSource() {}, drawAttachments() {}, paintOrigin: source => events.push(['origin', source]) };
  const views = { scope: {}, retain() {}, messagesPage() { paints.push('messages'); }, memoryPage() { paints.push('memory'); }, readUnread: async () => true, readState: async () => true, placeAfresh() {}, refreshKeys: () => [], refresh: async () => {}, keys: () => [], runOf: () => 1 };
  const fresh = { enabled: true, invalidate: (...args) => events.push(['invalidate', ...args]), request: async () => events.push(['request']), setVisible: () => events.push(['freshness-enabled']), schedule() {} };
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  }
  const scope = { ...writing, ...times, watchDays: options => { days.push(options); return () => {}; }, replyLine, placeNewLine, cardClass, agentColor, AgentColors, openColorPicker, PageReads, PageHere, WritingInput, ReadThrough, Live, liveOffered, reloader, Attention, paintSent, IntersectionObserver, crypto, setImmediate, readFailure, checkedView, bindingOf, currentImages, document, URL, URLSearchParams, TextEncoder, structuredClone, console,
    window: { addEventListener(name,fn) { events.push(['window-handler',name,fn]); }, matchMedia: () => ({ matches: false }) }, location: { href,assign:url=>events.push(['navigate',url]),reload:()=>events.push(['reload']) },
    Api: class { constructor() { return api; } }, openJournal: async () => { events.push(['journal']); return {}; },
    EditorRegistry: class { constructor(options) { events.push(['registry']); registry.options = options; return registry; } },
    Reader: class { constructor() { return reader; } },
    TopicViews: class { constructor() { return views; } }, Freshness: class { constructor() { return fresh; } },
    initialViews: async () => ({}), readableUploads() {}, uploadWork() {}, recoveryReadOnly: () => false, refusedCopyAtDraft() {}, refusedAtDraft() {}, PRIOR_PUBLICATION_NOTICE: '',
    openIntentJournal: async () => { events.push(['intent-journal']); throw Error('No browser intent storage in this fixture'); },
    openOpeningStore: async () => { events.push(['opening-store']); return { close() {} }; },
    OpeningDraft: class { constructor(o) { events.push(['opening-draft', { workspace: o.workspace, opening: o.opening, topic: o.topic }]); this.editable = false; }
      load() { events.push(['opening-load']); return Promise.resolve('editing'); } loadSource() { return Promise.resolve(); } leave() {} follow() { events.push(['opening-follow']); return Promise.resolve(true); } cancelSave() {} },
    OpeningView: class { constructor() { this.title = { focus() {} }; } run(action) { return Promise.resolve().then(action); } loadMembers() { return Promise.resolve(); } },
    UnfinishedOpenings: class { constructor(o) { events.push(['unfinished', o.workspace]); this.o = o; } load() { return this.o.read({ workspace_id: this.o.workspace, limit: 20 }); } } };
  const context = vm.createContext(Object.assign(scope, overrides));
  const stateSource = readFileSync(new URL('../web/topic-state.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + stateSource + '; return {TopicStatePanel,paintWaiting,paintState,paintWork,STATES,stateLabel,waitsOn}; })())', context);
  const headerSource = readFileSync(new URL('../web/topic-header.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + headerSource + '; return {paintTopicHeader}; })())', context);
  const settingsSource = readFileSync(new URL('../web/topic-settings.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + settingsSource + '; return {TopicSettings}; })())', context);
  const attentionSource = readFileSync(new URL('../web/attention.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + attentionSource + '; return {Attention,paintSent}; })())', context);
  const peopleSource = readFileSync(new URL('../web/people.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function|async function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + peopleSource + '; return {PeoplePanel,fillNames,readDirectory,readMembers,markReach,replaceChips}; })())', context);
  const lightsSource = readFileSync(new URL('../web/wake-lights.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class WakeLights', 'class WakeLights');
  vm.runInContext('globalThis.WakeLights = (()=>{' + lightsSource + '; return WakeLights; })()', context);
  const navigationSource = readFileSync(new URL('../web/topic-navigation.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (class|function|const|async function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + navigationSource + '; return {TopicPages,TopicNavigation,TopicRail,WorkspacePages,parseRoute,routeHref,paintUnread,paintChanged,changedSince,reread,PAGE}; })())', context);
  const marksSource = readFileSync(new URL('../web/marks.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + marksSource + '; return {Marks,paintMarkButton,paintAuthor,marksWords}; })())', context);
  const foldSource = readFileSync(new URL('../web/fold.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + foldSource + '; return {betweenOthers,foldCard,cardIn,paintFold,opened}; })())', context);
  // The outcome light: its words, then the rows, the peek and the panel that say them (item 86).
  const lightWordsSource = readFileSync(new URL('../web/outcome-light-words.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  const outcomeLightSource = readFileSync(new URL('../web/outcome-light.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + lightWordsSource + outcomeLightSource + '; return {LightPeek,paintAlsoWaiting,paintStanding,paintStandingFailed,paintRowLight}; })())', context);
  const outcomeSource = readFileSync(new URL('../web/outcomes.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class OutcomeRail', 'class OutcomeRail');
  vm.runInContext('globalThis.OutcomeRail = (()=>{' + outcomeSource + '; return OutcomeRail; })()', context);
  const referencesSource = readFileSync(new URL('../web/outcome-references.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class OutcomeReferences', 'class OutcomeReferences');
  vm.runInContext('globalThis.OutcomeReferences = (()=>{' + referencesSource + '; return OutcomeReferences; })()', context);
  const scopeSource = readFileSync(new URL('../web/outcome-scope.mjs', import.meta.url), 'utf8').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + scopeSource + '; return {OutcomeScope,placeBrand}; })())', context);
  const inlineSource = readFileSync(new URL('../web/inline-composer.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class InlineComposer', 'class InlineComposer');
  vm.runInContext('globalThis.InlineComposer = (()=>{' + inlineSource + '; return InlineComposer; })()', context);
  let source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  assert.equal(source.match(/^begin\(\);$/gm)?.length, 1); source = source.replace(/^begin\(\);$/m, '');
  vm.runInContext(source + `\nglobalThis.wiring = { initialize, begin, toggleMark, openSource, retrySource, checkAvailability, checkInlineAvailability, changed, paintViews, showVersions, discover, openSent, offerAuthor,
    inject(value) { ({api,bootstrap,registry,reader,inline,topic,views,freshness}=value); marks = value.marks ?? marks; if ('outcomeMembers' in value) outcomeMembers = value.outcomeMembers; },
    useLive(value) { live = value; },
    inline(callbacks, options) { return new InlineComposer(callbacks, options); },
    get() { return {registry,inline,freshness,candidates,attention,outcomeRail,topicRail,outcomeScope,marks,commitReload}; } };`, context);
  const inline = context.wiring.inline({ admits: p => registry.isCurrent(p), status: () => 'Saved', uploads: () => uploads,
    edit: editor => events.push(['inline-edit',editor.key]),
    needsReview: () => false, renderPending: (host, e) => { if (e.submissions.length) host.replaceChildren(new Element('inline-review')); } });
  // Initialize the real adapter; empty upload list is a deliberate fixture.
  inline.show(p);
  context.wiring.inject({ api, bootstrap, registry, reader, inline, topic, views, freshness: fresh,
    marks: new context.Marks({ api, instanceId: 'fixture', authority: () => bootstrap.authority, doc: null, win: null }) });
  const state = (ref = editor.context.sourceRef) => ({ instance_id: 'fixture', source_ref: ref, destination: { topic_id: 't1' }, source_available: true, destination_available: true });
  return { ...context.wiring, makeInline:context.wiring.inline, owners: context.wiring.get, registry, reader, inline, topic, editor, p, api, fresh, get, events, calls, paints, state, bootstrap, views, document, observers, days };
}

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
  f.inject({ api:f.api, bootstrap:f.bootstrap }); f.useLive(live);
  let failure = null;
  f.api.view = async name => {
    if(name==='workspace') {
      if(failure) throw failure;
      return {instance_id:'fixture',workspace:{id:'w1',title:'Real outcome',purpose:'Purpose'}};
    }
    return {instance_id:'fixture',items:name==='workspace_topics'?[{...f.topic,activity_ms:1}]:[],next_cursor:null};
  };
  await f.initialize();
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('topics').children.length,1);
  failure = Object.assign(Error('Temporarily offline'),{code:'DATABASE_BUSY'});
  await commit(live, 2);
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  failure = Object.assign(Error('Access denied'),{code:'FORBIDDEN'});
  await commit(live, 3);
  assert.equal(f.get('topic-navigation').hidden,true,'confirmed denial removes stale topic choices');
  assert.equal(f.get('topic-title').textContent,'Outcome unavailable');
  assert.equal(f.get('topic-description').textContent,'');
  assert.equal(f.get('app-status').hidden,false);
  failure = null;await commit(live, 4);
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('app-status').hidden,true);
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
test('the rail\'s reads begin after the primary composer is initialized, and a topic page reads no list of outcomes',async()=>{
  const f=fixture(),order=[],read=f.api.view;
  f.api.view=async(name,args)=>{order.push(name==='memory_items'?name+':'+args.owner_scope?.kind:name);return read(name,args);};
  f.registry.initializeInline=async()=>{order.push('composer');f.registry.inline=f.p;return f.p;};
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(order.includes('workspace_topics')&&order.includes('memory_items:workspace'));
  assert.ok(order.indexOf('composer')<order.indexOf('workspace_topics'));
  assert.ok(order.indexOf('composer')<order.indexOf('memory_items:workspace'),'the outcome\'s Notebook pages too');
  assert.equal(order.includes('workspaces'),false,'inside an outcome the rail shows only that outcome');
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
  f.registry.keepEditorsLocal=async()=>{};f.registry.unconfirmedSends=[];
  Object.assign(f.editor,{localVersion:1,ackVersion:0});Object.defineProperty(f.editor,'dirty',{get:()=>f.editor.ackVersion<f.editor.localVersion});
  f.registry.flush=async()=>({recorded:false,status:'unknown'});
  f.api.view=async(name,args)=>name==='workspace_topics'?{instance_id:'fixture',items:[{id:'t2',title:'Second',workspace_id:'w1',activity_ms:1}],next_cursor:null}:read(name,args);
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

test('a source that comes back on Retry gets its whole origin line again, time included', async () => {
  const f = fixture();
  const source = { source_ref: { kind: 'message', id: 'm1' }, author: 'tony', body: '', sent_ms: 1762350240000 };
  const modal = { source: { ...source }, sourceUnavailable: true, availabilityUnconfirmed: false, editors: { reply: { unavailable: true }, note: { unavailable: true } } };
  f.registry.current = modal;
  f.api.view = async (name, args) => name === 'source' ? { ...source, body: 'Back again', instance_id: 'fixture' } : f.state(args.source_ref);
  await f.retrySource();
  const painted = f.events.filter(e => e[0] === 'origin');
  assert.equal(painted.length, 1);
  assert.deepEqual([painted[0][1].author, painted[0][1].sent_ms, modal.sourceUnavailable], ['tony', 1762350240000, false]);
  f.events.length = 0;
  await f.retrySource();
  assert.equal(f.events.some(e => e[0] === 'origin'), false, 'a source that never went away keeps its line');
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

test('inline pending stays beside inline only; modal pending remains in the topic summary', () => {
  const f = fixture(); f.editor.submissions.push({ id: 'inline-submission' });
  f.registry.inline = null; f.changed(f.editor);
  assert.equal(f.get('topic-pending').children.length, 0, 'restoring a topic editor before its presentation is installed must not create the duplicate');
  f.registry.inline = f.p; f.changed(f.editor);
  assert.equal(f.get('inline-pending').children.length, 1); assert.equal(f.get('topic-pending').children.length, 0);
  const modal = { ...f.editor, key: 'modal', context: { ...f.editor.context, sourceRef: { kind: 'message', id: 'm1' } }, submissions: [{ id: 'modal-submission' }] };
  f.registry.current = { editors: { reply: modal } }; f.changed(modal);
  assert.equal(f.get('topic-pending').children.length, 1); assert.equal(f.get('topic-pending').children[0].dataset.key, 'modal');
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
  // loaded before, nothing shows the two runs meet.
  await f.get('more-messages').onclick(); await settle();
  assert.equal(views.messages.has('m35'), true);
  shown([30, 31, 42, 43]); await settle(); await settle();
  assert.equal(ranges().length, 2, 'the runs have not met: still two ranges');
  await f.get('more-messages').onclick(); await settle();
  shown([30, 31, 42, 43]); await settle(); await settle();
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
const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
// A person in the topic's people: one pill, at the bottom of the page.
const isPill = node => String(node.className ?? '').split(' ').includes('person-pill');
// A small stand-in for Core: participation.set, workspace.member_set and
// topic.update check the revision as Core does, apply the change and advance
// it. A topic.update answers with the topic as it now stands, as Core does.
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
    if (envelope.expected[field] !== record.version)
      return { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed; preserve this attempt and reconcile', current_versions: { [field]: record.version } } };
    if (envelope.kind === 'topic.update') {
      const { title = record.title, archived = record.archived ?? false, state: said = record.state ?? 'active', note = said === record.state ? record.state_note ?? '' : '', waiting_on = [] } = envelope.args;
      Object.assign(record, { title, archived, state: said, state_note: note, waiting_on, state_by: 'fixture-person', state_ms: null, version: record.version + 1 });
      return { status: 'committed', result: { topic_id: record.id, version: record.version, title, archived, state: said, note, waiting_on, state_by: 'fixture-person', state_ms: null } };
    }
    const { actor_id, present } = envelope.args;
    state[list] = state[list].filter(row => row.actor_id !== actor_id).concat(present ? [{ actor_id, kind: 'human', enabled: true }] : []);
    record.version += 1;
    return { status: 'committed', result: { version: record.version } };
  };
};
const add = async (host, id) => {
  const nodes = walk(host), input = nodes.find(node => node.list === 'directory-names');
  input.value = id;
  await nodes.find(node => node.textContent === 'Add').onclick();
};
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
  assert.equal(walk(creator.get('participants')).find(node => node.className === 'people-add').hidden, false);
  assert.ok(removeButton(creator.get('participants'), 'fable'));

  const f = fixture();
  pickerApi(f, { topic: { owner_id: 'tony', creator_id: 'tony' } });
  await f.initialize();
  const nodes = walk(f.get('participants'));
  assert.deepEqual([nodes.find(node => node.className === 'people-add').hidden, nodes.some(node => node.textContent === '×')], [true, false]);
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
    f.get('inline-recipient-input').value = name; f.get('inline-add-recipient').onclick();
    return f.get('inline-recipient-chips').children.find(node => node.textContent === name).className;
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
  assert.deepEqual(walk(team).filter(node => node.textContent === '×').map(node => node['aria-label']), ['Remove ally']);
  await add(team, 'tony');
  await drain();
  // Someone's message elsewhere in the outcome moves its revision on.
  f.pickers.workspace.version += 1;
  await removeButton(team, 'ally').onclick();
  await drain();
  assert.deepEqual(sentOf(f, 'workspace.member_set', 'workspace_revision'),
    [[5, { actor_id: 'tony', present: true }], [6, { actor_id: 'ally', present: false }], [7, { actor_id: 'ally', present: false }]]);
  assert.deepEqual(f.pickers.members.map(row => row.actor_id), ['fixture-person', 'tony']);
  assert.deepEqual(walk(team).filter(node => node.className === 'chip').map(node => node.textContent), ['fixture-person', 'tony'], 'the panel shows the reread team');

  // A team that cannot be read keeps the chips it had and says so.
  f.pickers.membersRefused = true;
  await commit(f.live, 2);
  assert.deepEqual(walk(team).filter(node => node.className === 'chip').map(node => node.textContent), ['fixture-person', 'tony']);
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

test('addressing someone outside the topic offers its manager to add them, and the chip clears once they are in', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  showComposer(f);
  const address = name => { f.get('inline-recipient-input').value = name; f.get('inline-add-recipient').onclick(); };
  const chip = name => f.get('inline-recipient-chips').children.find(node => node.textContent === name);
  address('ally'); address('stranger'); address('fable');
  assert.equal(chip('ally').className, 'chip', 'an outcome member can be sent to');
  assert.equal(chip('fable').className, 'chip', 'a participant can be sent to');
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
  assert.equal(chip('stranger').className, 'chip', 'once a participant, the mark goes');
  assert.equal(f.document.activeElement, f.get('inline-recipient-input'), 'focus that was on the offer goes to the recipient field');
});

test('a switched-off participant or teammate is marked so, with no add offer, and a refused add is said on its chip', async () => {
  const f = fixture();
  pickerApi(f);
  f.pickers.participants.push({ actor_id: 'idle', kind: 'agent', enabled: false });
  f.pickers.members.push({ actor_id: 'gone', kind: 'agent', name: 'Gone', enabled: false });
  await f.initialize();
  showComposer(f);
  const address = name => { f.get('inline-recipient-input').value = name; f.get('inline-add-recipient').onclick(); };
  const chip = name => f.get('inline-recipient-chips').children.find(node => node.textContent === name);
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
  f.get('inline-recipient-input').value = 'stranger'; f.get('inline-add-recipient').onclick();
  const chip = f.get('inline-recipient-chips').children.find(node => node.textContent === 'stranger');
  assert.equal(chip.className, 'chip unreachable');
  assert.equal(walk(chip).some(node => node.textContent?.startsWith('Add to topic')), false);
  f.get('inline-recipient-input').value = 'tony'; f.get('inline-add-recipient').onclick();
  assert.equal(f.get('inline-recipient-chips').children.find(node => node.textContent === 'tony').className, 'chip',
    'the topic\'s owner can always be sent to, participant or not');

  const hidden = fixture();
  pickerApi(hidden);
  const view = hidden.api.view;
  hidden.api.view = async (name, args) => name === 'workspace_members' ? { error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } } : view(name, args);
  await hidden.initialize();
  showComposer(hidden);
  hidden.get('inline-recipient-input').value = 'stranger'; hidden.get('inline-add-recipient').onclick();
  assert.equal(hidden.get('inline-recipient-chips').children.find(node => node.textContent === 'stranger').className, 'chip');
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
  const author = id => f.get('messages').children.find(card => card.dataset.id === id).children[0];
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  const parts = id => author(id).children.map(text);
  assert.deepEqual(parts('m1'), ['tony', ' · 5:44 AM'], 'sent today: the time alone');
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
  const time = f.get('messages').children[0].children[0].children[1].children[1];
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
  const card = id => f.get('messages').children.find(node => node.dataset.id === id);
  const lines = id => card(id).children.filter(node => node.className === 'message-reply-to').map(node => node.textContent);
  assert.deepEqual(lines('m2'), ['Replying to fable: Ship the table']);
  assert.deepEqual(lines('m1'), []);
  assert.deepEqual(card('m2').children.map(node => node.className), ['message-author', 'message-reply-to', 'message-preview'], 'between the author and the words');
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

// Where a topic stands, wired into the page: the panel's form sends the
// topic's current version, a commit asks for fresh views, and a fresh topic
// view repaints the panel.
test('a topic page says where it stands, sends its change at the current version, and repaints from fresh data', async () => {
  const f = fixture();
  pickerApi(f);
  await f.initialize();
  const panel = f.get('topic-state');
  const find = predicate => deep(panel).find(predicate);
  assert.equal(panel.hidden, false);
  assert.equal(find(node => node.className === 'topic-state')?.textContent, 'Active');
  const choice = find(node => node.id === 'topic-state-choice'), save = find(node => node.textContent === 'Save');
  choice.value = 'review'; choice.onchange();
  const requests = () => f.events.filter(([kind]) => kind === 'request').length, before = requests();
  await save.onclick();
  // Envelopes come from the page's realm; compare them as data.
  const sent = () => JSON.parse(JSON.stringify(f.calls.filter(call => call.kind === 'topic.update').map(call => [call.envelope.target, call.envelope.expected.topic_revision, call.envelope.args])));
  assert.deepEqual(sent(), [[{ topic_id: 't1' }, 3, { state: 'review', note: '' }]]);
  assert.deepEqual([f.pickers.topic.state, f.pickers.topic.version], ['review', 4], 'Core took the change');
  assert.equal(find(node => node.className === 'notice')?.hidden, true, 'no refusal is shown');
  assert.equal(find(node => node.className === 'topic-state')?.textContent, 'Ready for review', 'Core\'s answer is painted before any fresh read');
  assert.equal(requests(), before + 1, 'a committed change asks for fresh views');
  // The next change sends the version the first one made.
  choice.value = 'waiting'; choice.onchange();
  await save.onclick();
  assert.deepEqual(sent()[1], [{ topic_id: 't1' }, 4, { state: 'waiting', note: '', waiting_on: [] }]);
  assert.equal(f.pickers.topic.version, 5);
  Object.assign(f.views, { topic: { ...f.views.topic, version: 6, state: 'done', state_note: 'Shipped' }, messages: new Map() });
  f.paintViews('topic');
  assert.equal(find(node => node.className === 'topic-state')?.textContent, 'Done', 'a fresh topic view repaints the panel');
  assert.equal(find(node => node.className === 'state-note')?.textContent, 'Shipped');
});

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

// The outcome's own page has no rail, so it shows no list of outcomes; it reads
// that list only for the line naming other outcomes' questions (item 86).
test('on an outcome page a commit reads the outcome, its topics and, for the line of other outcomes\' questions, the list of outcomes it never shows', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['w1']), o.page(['w1', 'w2']));
  await f.initialize(); await drain();
  const count = name => f.calls.filter(call => call.name === name).length;
  const before = { workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') };
  assert.equal(before.workspaces, 1, 'the page reads the list of outcomes once as it opens');
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.deepEqual({ workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') },
    { workspaces: before.workspaces + 1, workspace: before.workspace + 1, topics: before.topics + 1 });
  assert.equal(f.get('rail').hidden, true, 'the outcome page has no rail');
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

test('a Mark read that fails says so and reads attention again, leaving nothing unhandled', async () => {
  const f = fixture('https://fixture/?'), o = outcomesPage(f), view = f.api.view;
  o.answers.push(o.page([]));
  const lost = { id: 'd1', seq: 3, topic_readable: false, topic: { id: 't9', title: 'Lost', title_truncated: false }, message: { author_id: 'tony', body: 'Hi' } };
  f.api.view = async (name, args) => name === 'attention' ? (f.calls.push({ name }), { instance_id: 'fixture', unread: 1, addressed: 1, latest_addressed: [lost] }) : view(name, args);
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  await f.initialize(); await drain();
  const nodes = host => host.children.filter(child => typeof child === 'object').flatMap(child => [child, ...nodes(child)]);
  const mark = nodes(f.get('sent-to-you')).find(node => node.textContent === 'Mark read');
  assert.ok(mark, 'a lost topic offers Mark read');
  f.api.command = async () => { throw Object.assign(Error('Connection interrupted. Confirmation is unknown; your writing is kept.'), { status: 0 }); };
  const reads = f.calls.filter(call => call.name === 'attention').length;
  await mark.onclick();
  assert.match(f.get('app-status').textContent, /Connection interrupted/);
  assert.equal(f.get('app-status').hidden, false);
  assert.equal(f.calls.filter(call => call.name === 'attention').length, reads + 1, 'what Core holds is read again');
  assert.equal(mark.disabled, false);
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
// as a commit.
for (const [route, lists] of [['?', ['workspaces']], ['?workspace=w1', ['workspace', 'workspace_topics']], ['?topic=t1', ['workspace_topics', 'memory_items']]]) {
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

// Beside a new topic the rail shows only its outcome: its topics and its
// Notebook pages, read again after each commit with the opening itself.
test('the rail beside a new topic shows its outcome, and each commit reads it and the opening once, never the list of outcomes', async () => {
  const f = fixture('https://fixture/?workspace=w1&opening=o1&opening_topic=t9'), live = stream();
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  f.api.view = async (name, args) => { f.calls.push({ name, args });
    return name === 'workspace' ? { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome' } } : { instance_id: 'fixture', items: [], next_cursor: null }; };
  await f.initialize(); await drain();
  const count = name => f.calls.filter(call => call.name === name).length, follows = () => f.events.filter(e => e[0] === 'opening-follow').length;
  assert.equal(f.get('body').dataset.ready, 'true');
  assert.deepEqual([count('workspace_topics'), count('memory_items'), follows()], [1, 1, 1], 'the first read');
  assert.equal(f.get('outcome-navigation').hidden, true, 'no list of outcomes in the rail');
  assert.equal(f.get('rail')['aria-label'], 'This outcome');
  await commit(live, 2);
  assert.deepEqual([count('workspace_topics'), count('memory_items'), follows()], [2, 2, 2], 'a commit reads the rail and the opening again');
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
  const card = id => f.get('messages').children.find(child => child.dataset.id === id);
  const name = id => card(id).children[0].children[0];
  const opens = () => f.calls.filter(c => c.name === 'source' || c.name === 'editor_state').length;
  const before = opens();
  await card('m3').onclick({ target: name('m3') }); await settle();
  assert.equal(opened.length, 1, 'the picker opened');
  assert.deepEqual([opened[0].anchor, opened[0].agent, opened[0].own, opened[0].chosen, opened[0].palette], [name('m3'), 'fable', 'green', null, AGENT_PALETTE]);
  assert.equal(opened[0].back, card('m3'), 'closing it gives the focus to the card, which can hold it');
  assert.equal(opens(), before, 'the message was not opened');
  // Choosing goes to Core, and every card of that agent changes.
  f.api.command = async envelope => { f.calls.push({ kind: envelope.kind, envelope }); return { status: 'committed', recorded: true, result: { actor_id: 'fable', color: 'rose', color_revision: 1 } }; };
  assert.equal((await opened[0].choose('rose')).status, 'committed');
  const sent = f.calls.find(c => c.kind === 'color.set').envelope;
  assert.deepEqual([sent.target, sent.args, sent.expected.color_revision], [{ actor_id: 'fable' }, { color: 'rose' }, 0]);
  assert.deepEqual(['m1', 'm2', 'm3', 'm4'].map(id => card(id).className),
    ['message-card agent-card agent-rose', 'message-card own-message', 'message-card agent-card agent-rose', 'message-card']);
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
  const entry = id => f.get('messages').children.find(child => child.dataset.id === id);
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
  assert.equal(f.get('messages').children.filter(child => child.dataset.id === 'm1').length, 1, 'a repaint keeps one fold');
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
  const entry = f.get('messages').children.find(child => child.dataset.id === 'm1');
  assert.equal(entry.className.split(' ')[0], 'message-card', 'not folded for an agent');
});

test('a folded message the person marked unread carries the pill on its line, the New line under it, and older-below opens it', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const between = (from, through) => messages(from, through).map(item => ({ ...item, addressees: item.seq === 5 ? ['agent-b'] : [] }));
  const at = (from, through, next) => ({ instance_id: 'fixture', items: between(from, through), next_cursor: next, relevant_versions: { topic: 1 }, oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 });
  views.messagesPage(at(10, 19, 10), { initial: true }); await settle();
  const marker = f.get('messages').children.at(-1);
  const pages = [at(1, 9, null)], view = f.api.view;
  f.api.view = async (name, args) => name === 'topic_messages' ? pages.shift() : view(name, args);
  await marker.onclick(); await settle();
  const order = () => f.get('messages').children.map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order().split(' ').slice(-7).join(' '), '6 5 new 4 3 2 1', 'the New line sits just below the fold');
  const fold = f.get('messages').children.find(child => child.dataset.id === 'm5'), [line, card] = fold.children;
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
  const order = () => f.get('messages').children.map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
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
  const order = () => f.get('messages').children.map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
  assert.equal(order(), '29 28 27 26 25 24 23 22 21 20 older', 'the line waits at the bottom of what is loaded');
  const marker = f.get('messages').children.at(-1);
  const text = node => typeof node === 'string' ? node : node.textContent || node.children.map(text).join('');
  assert.equal(text(marker), 'More new below', 'a line without a time says none');
  // While the line says more new messages lie below, it is the one control
  // that loads older messages: More messages, doing much the same, is hidden.
  assert.equal(f.get('more-messages').hidden, true, 'More messages is hidden while the line shows');
  f.paintViews('memory');
  assert.equal(f.get('more-messages').hidden, true, 'and painting the Notebook does not bring it back');
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

test('once the line is in its place, More messages loads what is older again', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  const at = (from, through, next) => ({ ...page(from, through, next), oldest_unread: { seq: 15, id: 'm15' }, commit_seq: 1 });
  views.messagesPage(at(20, 29, 20), { initial: true }); await settle();
  assert.equal(f.get('more-messages').hidden, true, 'hidden while the line says more new below');
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'topic_messages' ? at(10, 19, 10) : view(name, args);
  await f.get('messages').children.at(-1).onclick(); await settle();
  assert.equal(f.get('messages').children.find(child => child.dataset.line)?.dataset.line, 'new', 'the line is in its place');
  assert.equal(f.get('more-messages').hidden, false, 'More messages is back, with older messages left to load');
});

test('with nothing older left to load, no line promises older messages below', async () => {
  const { f } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage({ ...page(20, 29, null), oldest_unread: { seq: 5, id: 'm5' }, commit_seq: 1 }, { initial: true }); await settle();
  const order = () => f.get('messages').children.map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
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
  await f.get('messages').children.at(-1).onclick(); await settle();
  assert.deepEqual(reads, [], 'nothing was read');
  assert.equal(f.get('messages').children.at(-1).dataset.line, 'older', 'the line still waits at the bottom');
});

test('during a visit the New line holds as the person reads, moves to show more, and only Mark read places it afresh, the card being read held still', async () => {
  const scrolls = [];
  const f = fixture(undefined, { window: { addEventListener() {}, scrollBy: (x, y) => scrolls.push(y), matchMedia: () => ({ matches: false }) }, innerHeight: 800 });
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
  f.document.querySelector = selector => selector === '#messages > [data-seq]' ? cards()[0] ?? null : selector.startsWith('meta') ? { content: 'fixture-session' } : f.get(selector.slice(1));
  const layout = () => { for (const child of list.children) child.getBoundingClientRect ??= () => {
    let top = listTop; for (const before of list.children.slice(0, list.children.indexOf(child))) top += before.dataset.line ? 30 : 100;
    return { top, bottom: top + (child.dataset.line ? 30 : 90) }; }; };
  views.messagesPage({ ...page(20, 26, null), oldest_unread: { seq: 22, id: 'm22' }, commit_seq: 5 }, { initial: true }); await settle(); layout();
  const order = () => list.children.map(child => child.dataset.line ?? Number(child.dataset.seq)).join(' ');
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
  // Read meanwhile, the line holds.
  answer = { oldest_unread: null, commit_seq: 10 };
  live.emit({ kind: 'commit', seq: 10 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'everything read: the line still holds');
  // Mark unread on a message newer than the line: it is already shown as new, so the line holds.
  answer = { oldest_unread: { seq: 26, id: 'm26' }, commit_seq: 11 };
  await press(26, 0, 1);
  assert.equal(order(), '26 25 24 new 23 22 21 20', 'Mark unread on a message above the line leaves the line where it is');
  answer = { oldest_unread: null, commit_seq: 12 };
  await press(24, 1, 2);
  assert.equal(order(), '26 25 24 23 22 21 20', 'an explicit Mark read places the line afresh: nothing is unread');
  // Mark read whose read of the line fails: the stream's return reads it and places the line afresh.
  answer = { oldest_unread: { seq: 20, id: 'm20' }, commit_seq: 13 };
  live.emit({ kind: 'commit', seq: 13 }); for (let n = 0; n < 5; n++) await settle();
  answer = { oldest_unread: null, commit_seq: 14 };
  live.emit({ kind: 'commit', seq: 14 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 23 22 21 20 new', 'marked further back, then read: the line holds');
  f.api.view = async (name, args) => { if (name === 'topic_unread') throw Error('offline'); return view(name, args); };
  await press(20, 1, 2);
  assert.equal(order(), '26 25 24 23 22 21 20 new', 'the read failed: the line is where it was');
  f.api.view = async (name, args) => { if (name === 'topic_unread') return { instance_id: 'fixture', topic_id: 't1', oldest_unread: null, commit_seq: 15 }; return view(name, args); };
  live.emit({ kind: 'state', state: 'down' }); live.emit({ kind: 'state', state: 'live' }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 23 22 21 20', 'the stream returns: the read is made again and the line placed afresh');
  // A read that fails leaves the line where it was, and the reload is owed.
  f.api.view = async (name, args) => { if (name === 'topic_unread') throw Error('offline'); return view(name, args); };
  live.emit({ kind: 'commit', seq: 16 }); for (let n = 0; n < 5; n++) await settle();
  assert.equal(order(), '26 25 24 23 22 21 20');
});

test('at the top of a topic a new message comes into view; read further down, the page holds still', async () => {
  const scrolls = [];
  const f = fixture(undefined, { window: { addEventListener() {}, scrollBy: (x, y) => scrolls.push(y), matchMedia: () => ({ matches: false }) }, innerHeight: 800 });
  f.registry.initializeInline = async () => { f.registry.inline = f.p; return f.p; };
  Object.assign(f.views, { messages: new Map(), memory: new Map(), olderCursor: null, memoryCursor: null, newest: 0 });
  await f.initialize(); await settle();
  // Cards are laid out 100px apart from where the list starts, measured when
  // asked: a new card above pushes the rest down.
  let listTop = 0;
  const cards = () => f.get('messages').children.filter(child => child.dataset.seq);
  for (const kind of ['querySelectorAll', 'querySelector']) assert.equal(typeof f.document[kind], 'function');
  f.document.querySelectorAll = () => cards();
  f.document.querySelector = selector => selector === '#messages > [data-seq]' ? cards()[0] ?? null : selector.startsWith('meta') ? { content: 'fixture-session' } : f.get(selector.slice(1));
  const add = seq => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id: 'agent-a', body: 'Body', topic_id: 't1' });
  const paint = () => { f.paintViews('messages'); for (const card of cards()) card.getBoundingClientRect ??= () => { const top = listTop + cards().indexOf(card) * 100; return { top, bottom: top + 90 }; }; };
  for (let seq = 20; seq <= 25; seq++) add(seq);
  paint();
  listTop = 120; add(26); paint();
  assert.deepEqual(scrolls, [], 'the newest card showed from its top edge: the new one comes into view above it');
  listTop = -450; add(27); paint();
  assert.deepEqual(scrolls, [100], 'read further down, the card in view is held where it was');
  listTop = -100; add(28); paint();
  assert.deepEqual(scrolls, [100, 100], 'the newest card just out of sight above: the card that heads the view is held too');
  listTop = -50; add(29); paint();
  assert.deepEqual(scrolls, [100, 100, 100], 'the newest card partly above the top is being read, not shown from its top edge: it is held');
});

test('an agent\'s card in the topic log carries its color, and the person\'s own keeps its black', async () => {
  const { f } = await readingPage();
  const add = (seq, author_id, author_kind) => f.views.messages.set('m' + seq, { id: 'm' + seq, seq, author_id, author_kind, body: 'Body', topic_id: 't1' });
  add(1, 'fable', 'agent'); add(2, 'fixture-person', 'human'); add(3, 'dan', 'human'); add(4, 'warp', 'agent');
  f.paintViews('messages');
  const classes = Object.fromEntries(f.get('messages').children.map(card => [card.dataset.id, card.className]));
  assert.deepEqual(classes, { m4: 'message-card agent-card agent-cyan', m3: 'message-card', m2: 'message-card own-message', m1: 'message-card agent-card agent-green' });
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
  const classes = Object.fromEntries(f.get('messages').children.map(card => [card.dataset.id, card.className]));
  assert.deepEqual(classes, { m33: 'message-card agent-card agent-cyan', m32: 'message-card own-message', m31: 'message-card agent-card agent-green',
    m30: 'message-card agent-card agent-green', m29: 'message-card agent-card agent-green', m28: 'message-card own-message', m27: 'message-card agent-card agent-blue' });
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

test('on an outcome page its Notebook pages are listed after its topics and read again with them on each commit', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['w1']), o.page(['w1']));
  await f.initialize(); await drain();
  const page = f.get('outcome-page').children.map(child => child.id);
  assert.ok(page.indexOf('outcome-references') === page.indexOf('topic-navigation') + 1, 'right after the topics: ' + page);
  assert.ok(page.indexOf('page-here') === page.indexOf('outcome-references') + 1, 'and the page that opens in place after them');
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

test('a page in the topic\'s own Notebook carries the changed light, and a commit, such as the person\'s own read, puts it out', async () => {
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
  const light = () => {
    const card = f.get('memory-items').children.find(child => child.dataset.id === 'n1');
    const badge = card.children[0].children.find(child => typeof child === 'object' && /\bchanged\b/.test(child.className ?? ''));
    return badge ? [badge.textContent, card.children[0].children.find(child => child.className === 'sr-only').textContent] : null;
  };
  assert.deepEqual(light(), ['2', ', changed since you read it, 2 new revisions']);
  const asked = () => f.calls.filter(call => call.name === 'memory_items' && call.args.owner_scope?.kind === 'topic').length;
  const before = asked();
  shown = page(3, 3);
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.equal(asked(), before + 1, 'a commit reads the topic Notebook\'s read state again');
  assert.equal(light(), null, 'read, the light goes out');
  shown = page(4, 3);
  live.emit({ kind: 'commit', seq: 10 }); await drain();
  assert.deepEqual(light(), ['1', ', changed since you read it, 1 new revision'], 'revised again, it comes back on');
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
  assert.deepEqual(chipWords(f.get('team-people')), ['fixture-person', 'ally · wakes paused · 4 waiting']);
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

test('on an outcome\'s own page the logo block heads the main column, then "← Outcomes", and the rail is hidden', async () => {
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  f.api.view = async name => name === 'workspace' ? { instance_id: 'fixture', workspace: { id: 'w1', title: 'Real outcome', purpose: '' } } : { instance_id: 'fixture', items: [], next_cursor: null };
  await f.initialize(); await drain();
  assert.deepEqual(f.get('main').children.slice(0, 5).map(child => child.id), ['brand', 'app-status', 'wakes-status', 'updates-status', 'outcomes-home']);
  assert.equal(f.get('rail').hidden, true);
  let opened = false; await f.get('outcomes-home').onclick({ button: 0, preventDefault() { opened = true; } });
  assert.equal(opened, true, '"← Outcomes" opens the Outcomes home');
});
