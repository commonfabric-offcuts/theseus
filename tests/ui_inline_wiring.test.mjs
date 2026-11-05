// Exercises actual app/inline-adapter functions below the native browser. Only
// imports and auto-start are replaced; no product function body is copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as writing from '../web/writing-helpers.mjs';
import { readFailure, checkedView, bindingOf } from '../web/freshness.mjs';
import { currentImages } from '../web/upload-state.mjs';
import { WritingInput } from '../web/writing-input.mjs';
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture(href = 'https://fixture/?topic=t1') {
  const elements = new Map(), events = [], calls = [], paints = [];
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.handlers = {}; this.isConnected = true; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    get firstElementChild() { return this.children[0]; }
    querySelector(selector) { return get(selector.slice(1)); }
    querySelectorAll() { return [...elements.values()].filter(el => el.id.startsWith('inline-') && el.id !== 'inline-composer'); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const document = { body: get('body'), activeElement: null, visibilityState: 'visible', getElementById: get,
    createElement: () => new Element(), querySelector: s => s.startsWith('meta') ? { content: 'fixture-session' } : get(s.slice(1)), addEventListener() {} };
  const bootstrap = { instance_id: 'fixture', actor: 'fixture-person', authority: { id: 'a', epoch: 'e' } };
  const topic = { id: 't1', title: 'Fixture', workspace_id: 'w1' };
  const api = { bootstrap: async () => bootstrap, view: async (name, args) => {
    calls.push({ name, args });
    if (name === 'topic') return { instance_id: 'fixture', topic, participants: [] };
    if (name === 'workspace') return { instance_id: 'fixture', workspace: { title: 'Workspace' } };
    return { instance_id: 'fixture', items: [], next_cursor: null };
  } };
  const editor = { key: 'inline', dirty: true, submissions: [], draft: { body: 'kept', addressees: [], attachments: [], caret: { start: 0, end: 0 } }, context: { kind: 'reply', topicId: 't1', sourceRef: { kind: 'topic', id: 't1' } } };
  const p = { surface: 'inline', initialized: true, topic, mode: 'reply', editors: { reply: editor } };
  const uploads = { current: () => [], running: new Map(), status: () => 'Ready' };
  const registry = { inline: p, current: null, sessions: new Map([[editor.key, { editor }]]), disposed: false,
    get interactive() { return this.current ?? this.inline; },
    isCurrent(p) { return !!p && this.interactive === p; }, isSourceCurrent(p) { return !!p && this.current?.source === p.source; },
    cancelSave(e) { events.push(['cancel', e.key]); }, schedule(e) { events.push(['schedule', e.key]); },
    validateState(state, ref, topicId) { assert.equal(state.source_ref.id, ref.id); assert.equal(state.destination.topic_id, topicId); },
    pending() { return { items: [], next_cursor: null }; },
    sessionFor() { return { uploads }; }, status() { return 'Saved'; },
    cleanup: { foregroundListeners: new Set(), foreground() { return { read: action => action({}), release() { events.push(['release']); } }; } },
    runtime: { current: bootstrap.authority },
  };
  const reader = { notice: text => events.push(['reader-notice', text]), paintOffer() {}, paintStatus() {}, hideUnavailableSource() {}, drawSource() {}, drawAttachments() {} };
  const views = { scope: {}, retain() {}, messagesPage() { paints.push('messages'); }, memoryPage() { paints.push('memory'); }, refreshKeys: () => [], refresh: async () => {}, keys: () => [] };
  const fresh = { enabled: true, invalidate: (...args) => events.push(['invalidate', ...args]), request: async () => events.push(['request']), setVisible: () => events.push(['freshness-enabled']) };
  const scope = { ...writing, WritingInput, readFailure, checkedView, bindingOf, currentImages, document, URL, URLSearchParams, TextEncoder, structuredClone, console,
    window: { addEventListener(name,fn) { events.push(['window-handler',name,fn]); } }, location: { href,assign:url=>events.push(['navigate',url]),reload:()=>events.push(['reload']) },
    Api: class { constructor() { return api; } }, openJournal: async () => { events.push(['journal']); return {}; },
    EditorRegistry: class { constructor() { events.push(['registry']); return registry; } },
    Reader: class { constructor() { return reader; } },
    TopicViews: class { constructor() { return views; } }, Freshness: class { constructor() { return fresh; } },
    initialViews: async () => ({}), readableUploads() {}, uploadWork() {}, recoveryReadOnly: () => false, refusedCopyAtDraft() {}, refusedAtDraft() {}, PRIOR_PUBLICATION_NOTICE: '' };
  const context = vm.createContext(scope);
  const navigationSource = readFileSync(new URL('../web/topic-navigation.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (class|function) /gm, '$1 ');
  vm.runInContext('Object.assign(globalThis, (()=>{' + navigationSource + '; return {TopicPages,TopicNavigation,TopicRail,WorkspacePages,parseRoute,routeHref}; })())', context);
  const outcomeSource = readFileSync(new URL('../web/outcomes.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class OutcomeRail', 'class OutcomeRail');
  vm.runInContext('globalThis.OutcomeRail = (()=>{' + outcomeSource + '; return OutcomeRail; })()', context);
  const inlineSource = readFileSync(new URL('../web/inline-composer.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export class InlineComposer', 'class InlineComposer');
  vm.runInContext('globalThis.InlineComposer = (()=>{' + inlineSource + '; return InlineComposer; })()', context);
  let source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  assert.equal(source.match(/^run\(start\);$/gm)?.length, 1); source = source.replace(/^run\(start\);$/m, '');
  vm.runInContext(source + `\nglobalThis.wiring = { initialize, openSource, retrySource, checkInlineAvailability, changed,
    inject(value) { ({api,bootstrap,registry,reader,inline,topic,views,freshness}=value); },
    inline(callbacks, options) { return new InlineComposer(callbacks, options); },
    get() { return {registry,inline,freshness}; } };`, context);
  const inline = context.wiring.inline({ admits: p => registry.isCurrent(p), status: () => 'Saved', uploads: () => uploads,
    edit: editor => events.push(['inline-edit',editor.key]),
    needsReview: () => false, renderPending: (host, e) => { if (e.submissions.length) host.replaceChildren(new Element('inline-review')); } });
  // Initialize the real adapter; empty upload list is a deliberate fixture.
  inline.show(p);
  context.wiring.inject({ api, bootstrap, registry, reader, inline, topic, views, freshness: fresh });
  const state = (ref = editor.context.sourceRef) => ({ instance_id: 'fixture', source_ref: ref, destination: { topic_id: 't1' }, source_available: true, destination_available: true });
  return { ...context.wiring, makeInline:context.wiring.inline, owners: context.wiring.get, registry, reader, inline, topic, editor, p, api, fresh, get, events, calls, paints, state, bootstrap };
}

test('inline Ctrl-W uses the shared writing input path and preserves readonly writing', () => {
  const f=fixture(), field=f.get('inline-writing-body');
  f.editor.edit=patch=>Object.assign(f.editor.draft,patch);
  field.ownerDocument={execCommand:(_command,_ui,text)=>{
    field.value=field.value.slice(0,field.selectionStart)+text+field.value.slice(field.selectionEnd);
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


test('configured opening composer shares writing and enforces surface read-only without disabling review',()=>{
  const f=fixture(),p={surface:'opening',workspace:{id:'w1',title:'Chosen outcome'},editors:{reply:f.editor}},actions=[];
  f.registry.current=p;let locked=true;
  const composer=f.makeInline({admits:()=>true,status:()=> 'Saved',uploads:()=>({current:()=>[]}),needsReview:()=>true,
    renderPending:()=>{},edit:()=>actions.push('edit'),send:()=>actions.push('send'),review:()=>actions.push('review')},
    {root:f.get('opening-composer'),prefix:'opening',destination:p=>'In '+p.workspace.title,readOnly:()=>locked});
  f.editor.edit=patch=>Object.assign(f.editor.draft,patch);composer.show(p);
  assert.equal(f.get('opening-destination').textContent,'In Chosen outcome');
  assert.equal(f.get('opening-writing-body').readOnly,true);assert.equal(f.get('opening-composer').inert,false);
  f.get('opening-writing-body').value='forbidden';f.get('opening-writing-body').handlers.input();
  assert.equal(f.editor.draft.body,'kept');assert.equal(f.get('opening-send').disabled,true);assert.equal(f.get('opening-add-image').disabled,true);
  f.get('opening-review-versions').onclick();assert.deepEqual(actions,['review']);
  locked=false;composer.paintStatus();assert.equal(f.get('opening-writing-body').readOnly,false);
  f.get('opening-writing-body').value='new writing';f.get('opening-writing-body').handlers.input();assert.equal(f.editor.draft.body,'new writing');
});

test('every application route reloads a restored closed document before accepting input',async()=>{
  for(const suffix of ['', '?workspace=w1','?new=outcome&intent=i','?workspace=w1&opening=o&opening_topic=t','?topic=t1']){
    const f=fixture('https://fixture/'+suffix),handler=f.events.find(e=>e[0]==='window-handler'&&e[1]==='pageshow');
    assert.ok(handler,'common pageshow listener exists before route initialization');handler[2]({persisted:false});assert.equal(f.events.some(e=>e[0]==='reload'),false);
    handler[2]({persisted:true});assert.equal(f.events.filter(e=>e[0]==='reload').length,1);
  }
});
