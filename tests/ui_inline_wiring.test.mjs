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
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
// overrides: names the app imports, replaced in its scope for one test.
function fixture(href = 'https://fixture/?topic=t1', overrides = {}) {
  const elements = new Map(), events = [], calls = [], paints = [], observers = [];
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; this.isConnected = true; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
    append(...items) { for (const item of items) { if (typeof item === 'object') item.parent = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    get firstElementChild() { return this.children[0]; }
    querySelector(selector) { return get(selector.slice(1)); }
    querySelectorAll() { return [...elements.values()].filter(el => el.id.startsWith('inline-') && el.id !== 'inline-composer'); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    getAttribute(name) { return this[name] ?? null; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    contains() { return false; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const document = { body: get('body'), activeElement: null, visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, getElementById: get,
    createElement: () => new Element(), querySelectorAll: () => [], querySelector: s => s.startsWith('meta') ? { content: 'fixture-session' } : get(s.slice(1)),
    addEventListener(name, fn) { events.push(['document-handler', name, fn]); } };
  const bootstrap = { instance_id: 'fixture', actor: 'fixture-person', authority: { id: 'a', epoch: 'e' } };
  const topic = { id: 't1', title: 'Fixture', workspace_id: 'w1' };
  const api = { bootstrap: async () => bootstrap, view: async (name, args) => {
    calls.push({ name, args });
    if (name === 'topic') return { instance_id: 'fixture', topic, participants: [] };
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { title: 'Workspace' } };
    if (name === 'marks') return { instance_id: 'fixture', topic_id: args.topic_id, items: [], next_cursor: null };
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
    sessionFor() { return { uploads }; }, status() { return 'Saved'; },
    cleanup: { foregroundListeners: new Set(), resumeListeners: new Set(), foreground() { return { read: action => action({}), release() { events.push(['release']); } }; },
      list: action => action({ readClass: 'foreground' }) },
    runtime: { current: bootstrap.authority },
  };
  const reader = { notice: text => events.push(['reader-notice', text]), paintOffer() {}, paintStatus() {}, hideUnavailableSource() {}, drawSource() {}, drawAttachments() {}, paintOrigin: source => events.push(['origin', source]) };
  const views = { scope: {}, retain() {}, messagesPage() { paints.push('messages'); }, memoryPage() { paints.push('memory'); }, refreshKeys: () => [], refresh: async () => {}, keys: () => [], runOf: () => 1 };
  const fresh = { enabled: true, invalidate: (...args) => events.push(['invalidate', ...args]), request: async () => events.push(['request']), setVisible: () => events.push(['freshness-enabled']), schedule() {} };
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  }
  const scope = { ...writing, replyLine, WritingInput, ReadThrough, Live, liveOffered, reloader, Attention, paintSent, IntersectionObserver, crypto, setImmediate, readFailure, checkedView, bindingOf, currentImages, document, URL, URLSearchParams, TextEncoder, structuredClone, console,
    window: { addEventListener(name,fn) { events.push(['window-handler',name,fn]); } }, location: { href,assign:url=>events.push(['navigate',url]),reload:()=>events.push(['reload']) },
    Api: class { constructor() { return api; } }, openJournal: async () => { events.push(['journal']); return {}; },
    EditorRegistry: class { constructor(options) { events.push(['registry']); registry.options = options; return registry; } },
    Reader: class { constructor() { return reader; } },
    TopicViews: class { constructor() { return views; } }, Freshness: class { constructor() { return fresh; } },
    initialViews: async () => ({}), readableUploads() {}, uploadWork() {}, recoveryReadOnly: () => false, refusedCopyAtDraft() {}, refusedAtDraft() {}, PRIOR_PUBLICATION_NOTICE: '',
    openIntentJournal: async () => { events.push(['intent-journal']); throw Error('No browser intent storage in this fixture'); },
    openOpeningStore: async () => { events.push(['opening-store']); return { close() {} }; },
    OpeningDraft: class { constructor(o) { events.push(['opening-draft', { workspace: o.workspace, opening: o.opening, topic: o.topic }]); this.editable = false; }
      load() { events.push(['opening-load']); return Promise.resolve('editing'); } leave() {} refresh() {} cancelSave() {} },
    OpeningView: class { constructor() { this.title = { focus() {} }; } run(action) { return Promise.resolve().then(action); } loadMembers() { return Promise.resolve(); } },
    UnfinishedOpenings: class { constructor(o) { events.push(['unfinished', o.workspace]); this.o = o; } load() { return this.o.read({ workspace_id: this.o.workspace, limit: 20 }); } } };
  const context = vm.createContext(Object.assign(scope, overrides));
  const stateSource = readFileSync(new URL('../web/topic-state.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + stateSource + '; return {TopicStatePanel,paintWaiting,paintState,readableTime}; })())', context);
  const attentionSource = readFileSync(new URL('../web/attention.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + attentionSource + '; return {Attention,paintSent}; })())', context);
  const peopleSource = readFileSync(new URL('../web/people.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function|async function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + peopleSource + '; return {PeoplePanel,fillNames,readDirectory,readMembers,markReach,replaceChips}; })())', context);
  const navigationSource = readFileSync(new URL('../web/topic-navigation.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (class|function|const|async function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + navigationSource + '; return {TopicPages,TopicNavigation,TopicRail,WorkspacePages,parseRoute,routeHref,paintUnread,reread,PAGE}; })())', context);
  const marksSource = readFileSync(new URL('../web/marks.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (const|class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + marksSource + '; return {Marks,paintMarkButton,paintAuthor,marksWords}; })())', context);
  const outcomeSource = readFileSync(new URL('../web/outcomes.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class OutcomeRail', 'class OutcomeRail');
  vm.runInContext('globalThis.OutcomeRail = (()=>{' + outcomeSource + '; return OutcomeRail; })()', context);
  const referencesSource = readFileSync(new URL('../web/outcome-references.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class OutcomeReferences', 'class OutcomeReferences');
  vm.runInContext('globalThis.OutcomeReferences = (()=>{' + referencesSource + '; return OutcomeReferences; })()', context);
  const inlineSource = readFileSync(new URL('../web/inline-composer.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class InlineComposer', 'class InlineComposer');
  vm.runInContext('globalThis.InlineComposer = (()=>{' + inlineSource + '; return InlineComposer; })()', context);
  let source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  assert.equal(source.match(/^run\(start\);$/gm)?.length, 1); source = source.replace(/^run\(start\);$/m, '');
  vm.runInContext(source + `\nglobalThis.wiring = { initialize, refreshLists, openSource, retrySource, checkInlineAvailability, changed, paintViews, showVersions, discover, openSent, offerAuthor,
    inject(value) { ({api,bootstrap,registry,reader,inline,topic,views,freshness}=value); marks = value.marks ?? marks; },
    useLive(value) { live = value; },
    inline(callbacks, options) { return new InlineComposer(callbacks, options); },
    get() { return {registry,inline,freshness,candidates,attention,outcomeRail,topicRail}; } };`, context);
  const inline = context.wiring.inline({ admits: p => registry.isCurrent(p), status: () => 'Saved', uploads: () => uploads,
    edit: editor => events.push(['inline-edit',editor.key]),
    needsReview: () => false, renderPending: (host, e) => { if (e.submissions.length) host.replaceChildren(new Element('inline-review')); } });
  // Initialize the real adapter; empty upload list is a deliberate fixture.
  inline.show(p);
  context.wiring.inject({ api, bootstrap, registry, reader, inline, topic, views, freshness: fresh,
    marks: new context.Marks({ api, instanceId: 'fixture', authority: () => bootstrap.authority, doc: null, win: null }) });
  const state = (ref = editor.context.sourceRef) => ({ instance_id: 'fixture', source_ref: ref, destination: { topic_id: 't1' }, source_available: true, destination_available: true });
  return { ...context.wiring, makeInline:context.wiring.inline, owners: context.wiring.get, registry, reader, inline, topic, editor, p, api, fresh, get, events, calls, paints, state, bootstrap, views, document, observers };
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

test('outcome detail keeps transient choices, hides denied content, and recovers through Refresh', async () => {
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api:f.api, bootstrap:f.bootstrap });
  let failure = null;
  f.api.view = async name => {
    if(name==='workspace') {
      if(failure) throw failure;
      return {instance_id:'fixture',workspace:{id:'w1',title:'Real outcome',purpose:'Purpose'}};
    }
    return {instance_id:'fixture',items:name==='workspace_topics'?[f.topic]:[],next_cursor:null};
  };
  await f.initialize();
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('topics').children.length,1);
  failure = Object.assign(Error('Temporarily offline'),{code:'DATABASE_BUSY'});
  await f.get('refresh').onclick();
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  failure = Object.assign(Error('Access denied'),{code:'FORBIDDEN'});
  await f.get('refresh').onclick();
  assert.equal(f.get('topic-navigation').hidden,true,'confirmed denial removes stale topic choices');
  assert.equal(f.get('topic-title').textContent,'Outcome unavailable');
  assert.equal(f.get('topic-description').textContent,'');
  assert.equal(f.get('app-status').hidden,false);
  failure = null;await f.get('refresh').onclick();
  assert.equal(f.get('topic-navigation').hidden,false);
  assert.equal(f.get('topic-title').textContent,'Real outcome');
  assert.equal(f.get('app-status').hidden,true);
});

test('inline startup failure disables ownerless input but paints lists, enables freshness and keeps one registry on Refresh', async () => {
  const f = fixture(); f.registry.inline = null;
  f.registry.initializeInline = async () => { throw Object.assign(Error('Read deadline expired'), { code: 'READ_TIMEOUT' }); };
  await f.initialize();
  assert.deepEqual(f.paints, ['messages','memory']); assert.equal(f.get('body').dataset.ready, 'true');
  assert.ok(f.events.some(e => e[0] === 'freshness-enabled'));
  assert.equal(f.get('inline-composer').hidden, false); assert.equal(f.get('inline-writing-body').disabled, true);
  assert.match(f.get('inline-notice').textContent, /Read deadline/); assert.equal(f.registry.inline, null);
  assert.equal(f.get('inline-send').disabled, true); assert.equal(f.get('inline-retry').hidden, false);
  await f.get('refresh').onclick();
  assert.equal(f.events.filter(e => e[0] === 'registry').length, 1); assert.equal(f.events.filter(e => e[0] === 'journal').length, 1);
  assert.equal(f.calls.some(c => c.kind), false);
  f.registry.initializeInline = async () => { f.registry.inline = f.p; f.owners().inline.show(f.p); return f.p; };
  await f.get('inline-retry').onclick();
  assert.equal(f.get('inline-writing-body').disabled, false); assert.equal(f.get('inline-writing-body').value, 'kept');
  assert.equal(f.get('inline-retry').hidden, true);
  assert.equal(f.events.filter(e => e[0] === 'registry').length, 1); assert.equal(f.events.filter(e => e[0] === 'journal').length, 1);
});
test('optional outcome and topic rail reads begin after the primary composer is initialized',async()=>{
  const f=fixture(),order=[],read=f.api.view;
  f.api.view=async(name,args)=>{order.push(name);return read(name,args);};
  f.registry.initializeInline=async()=>{order.push('composer');f.registry.inline=f.p;return f.p;};
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(order.indexOf('composer')<order.indexOf('workspaces'));
  assert.ok(order.indexOf('composer')<order.indexOf('workspace_topics'));
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
test('actual home wordmark and outcome links preserve dirty writing before same-tab departure',async()=>{
  const f=fixture(),read=f.api.view;
  f.registry.initializeInline=async()=>{f.registry.inline=f.p;return f.p;};
  f.registry.keepEditorsLocal=async()=>{};f.registry.unconfirmedSends=[];
  Object.assign(f.editor,{localVersion:1,ackVersion:0});Object.defineProperty(f.editor,'dirty',{get:()=>f.editor.ackVersion<f.editor.localVersion});
  f.registry.flush=async()=>({recorded:false,status:'unknown'});
  f.api.view=async(name,args)=>name==='workspaces'?{instance_id:'fixture',items:[{id:'w2',owner_id:'fixture-person',title:'Second',title_truncated:false,version:1}],next_cursor:null}:read(name,args);
  await f.initialize();await new Promise(resolve=>setImmediate(resolve));
  for(const control of [f.get('outcomes-home'),f.get('wordmark'),f.get('workspaces').children[0]]){
    assert.ok(control);let prevented=false;await control.onclick({button:0,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(f.events.some(e=>e[0]==='navigate'),false);assert.equal(f.editor.draft.body,'kept');
    assert.match(f.get('topic-navigation-status').textContent,/not confirmed saved/);
    await control.onclick({button:0,metaKey:true,preventDefault(){throw Error('modified link intercepted');}});
  }
  f.registry.flush=async()=>{f.editor.ackVersion=1;return {recorded:true,status:'committed'};};
  await f.get('workspaces').children[0].onclick({button:0,preventDefault(){}});
  assert.deepEqual(f.events.filter(e=>e[0]==='navigate'),[['navigate','?workspace=w2']]);
});
test('outcome Refresh sequences reads so an older denial cannot repaint a newer result',async()=>{
  const f=fixture('https://fixture/?workspace=w1'),held=defer();let count=0;
  f.inject({api:f.api,bootstrap:f.bootstrap});
  f.api.view=async name=>{
    if(name==='workspace'){count++;if(count===2)return held.promise;return {instance_id:'fixture',workspace:{id:'w1',title:count===1?'Initial':'New title',purpose:''}};}
    return {instance_id:'fixture',items:[],next_cursor:null};
  };
  await f.initialize();const first=f.get('refresh').onclick(),second=f.get('refresh').onclick();
  held.resolve({instance_id:'fixture',error:{code:'FORBIDDEN',message:'Old denial'}});await Promise.all([first,second]);
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

test('a Refresh that leaves a gap in the loaded messages never reads across it', async () => {
  const { f, ranges, card } = await readingPage();
  const views = new TopicViews({ instanceId: 'fixture', topicId: 't1', paint: kind => f.paintViews(kind), invalidate() {} });
  f.inject({ api: f.api, bootstrap: f.bootstrap, registry: f.registry, reader: f.reader, inline: f.owners().inline, topic: f.topic, views, freshness: f.fresh });
  views.messagesPage(page(22, 31, 22), { initial: true }); await settle();
  // Freshness is stopped; #32..#41 arrive meanwhile, then #42..#71. Refresh
  // loads the newest page, so #32..#41 are not loaded.
  f.fresh.stopped = true;
  const pages = [page(42, 71, 42), page(32, 41, 32), page(20, 31, 20)];
  const view = f.api.view;
  f.api.view = async (name, args) => {
    if (name === 'topic_messages') { f.calls.push({ name, args }); return pages.shift(); }
    if (name === 'memory_items') return { instance_id: 'fixture', items: [], next_cursor: null, relevant_versions: { notebook: 1 } };
    return view(name, args);
  };
  await f.refreshLists(); await settle();
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
  assert.deepEqual(nodes.filter(node => node.className === 'chip').map(node => node.textContent), ['fixture-person', 'fable']);
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
  f.inject({ api: f.api, bootstrap: f.bootstrap });
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
  await f.get('refresh').onclick();
  await drain();
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
  const f = fixture('https://fixture/?workspace=w1');
  f.inject({ api: f.api, bootstrap: f.bootstrap });
  pickerApi(f);
  await f.initialize();
  assert.equal(f.get('outcome-team').hidden, false);
  const view = f.api.view;
  f.api.view = async (name, args) => name === 'workspace' ? { error: { code: 'FORBIDDEN', message: 'No permission for this workspace' } } : view(name, args);
  await f.get('refresh').onclick();
  await drain();
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
  f.paintViews('messages');
  const author = id => f.get('messages').children.find(card => card.dataset.id === id).children[0];
  const parts = id => author(id).children.map(node => typeof node === 'string' ? node : node.textContent);
  assert.deepEqual(parts('m1'), ['tony', ' · 5:44 AM Thu Nov 5']);
  assert.deepEqual(parts('m2'), ['fable']);
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

test('an outcome page lists what waits on the reader, and follows each new attention answer', async () => {
  const f = fixture('https://fixture/?workspace=w1');
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

test('a commit while Refresh reads the outcomes is read after it, and a failed reload is read again when the stream returns', async () => {
  const f = fixture('https://fixture/?'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['a'])); await f.initialize(); await drain();
  let release; o.answers.push(() => new Promise(resolve => release = resolve), o.page(['a', 'b']));
  const refresh = f.get('refresh').onclick(); await drain();
  live.emit({ kind: 'commit', seq: 7 });
  release(o.page(['a'])); await refresh; await drain();
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

test('on an outcome page a commit reads the outcome rail as well as the outcome and its topics', async () => {
  const f = fixture('https://fixture/?workspace=w1'), live = stream(), o = outcomesPage(f);
  f.inject({ api: f.api, bootstrap: f.bootstrap }); f.useLive(live);
  o.answers.push(o.page(['w1']), o.page(['w1', 'w2']));
  await f.initialize(); await drain();
  const count = name => f.calls.filter(call => call.name === name).length;
  const before = { workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') };
  live.emit({ kind: 'commit', seq: 9 }); await drain();
  assert.deepEqual({ workspaces: count('workspaces'), workspace: count('workspace'), topics: count('workspace_topics') },
    { workspaces: before.workspaces + 1, workspace: before.workspace + 1, topics: before.topics + 1 });
  assert.deepEqual([...f.owners().outcomeRail.pages.items.map(item => item.id)], ['w1', 'w2']);
  f.document.visibilityState = 'hidden';
  live.emit({ kind: 'commit', seq: 10 }); await drain();
  assert.equal(count('workspaces'), before.workspaces + 1, 'a hidden page waits');
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
for (const [route, lists] of [['?', ['workspaces']], ['?workspace=w1', ['workspaces', 'workspace', 'workspace_topics']], ['?topic=t1', ['workspaces', 'workspace_topics']]]) {
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

// The new-topic and new-outcome pages show the outcome list beside the writing.
for (const route of ['?workspace=w1&opening=o1&opening_topic=t9', '?new=outcome&intent=i1']) {
  test(`the outcome list beside ${route} is read again after each commit`, async () => {
    const f = fixture('https://fixture/' + route, {
      openIntentJournal: async () => ({ close() {} }),
      OutcomeCreation: class { constructor() { this.row = { phase: 'draft' }; } async load() {} refresh() {} leave() {} },
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
