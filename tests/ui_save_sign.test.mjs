import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Reader } from '../web/reader.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Editor } from '../web/editor.mjs';
import { writingState, paintSaveTime } from '../web/writing-helpers.mjs';
import { clock } from '../web/times.mjs';

// One zone, whatever the machine's, and a clock the checks set, so the time
// beside the saving sign reads the same on any day the checks run.
process.env.TZ = 'America/Los_Angeles';
const at = (...parts) => new Date(...parts).getTime();
clock.now = () => at(2026, 10, 5, 12, 0);

// A small page for the time beside the saving sign: elements with a parent,
// children, dataset, and the few calls paintSaveTime makes.
class Element {
  constructor(tag, doc) { Object.assign(this, { tag, ownerDocument: doc, parentElement: null, children: [], dataset: {}, className: '', textContent: '', hidden: false, disabled: false }); }
  append(node) { node.parentElement = this; this.children.push(node); }
  replaceWith(node) { const host = this.parentElement; host.children[host.children.indexOf(this)] = node; node.parentElement = host; this.parentElement = null; }
  remove() { const host = this.parentElement; host.children.splice(host.children.indexOf(this), 1); this.parentElement = null; }
  replaceChildren() {}
  querySelector(selector) {
    assert.equal(selector, ':scope > time.save-time');
    return this.children.find(node => node.tag === 'time' && node.className === 'save-time') ?? null;
  }
}
// The save status as the page has it: a span inside its .save-status.
function statusNode() {
  const doc = { createElement: tag => new Element(tag, doc) };
  const host = new Element('div', doc), status = new Element('span', doc);
  host.append(status);
  return status;
}
// What shows beside the status: the time's words, when it was, and its dated title.
const shownBeside = status => status.parentElement.children.filter(node => node !== status)
  .map(node => ({ tag: node.tag, className: node.className, text: node.textContent, ms: node.dataset.ms, title: node.title }));

// The saving sign beside the writing, painted by the real Reader.paintStatus
// over stand-in nodes: the words, and the state the page draws its mark from.
// With savedAt, the page's answer to when the writing was saved, which the
// Reader shows beside the save status. The status node is kept across
// paints when one is given, as the page keeps it.
function reader(editor, sign, savedAt, status = statusNode()) {
  const nodes = new Map([['save-state', status]]);
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, textContent: '', dataset: {}, replaceChildren() {} }); return nodes.get(id); };
  const r = Object.assign(Object.create(Reader.prototype), {
    $, mode: 'reply', sessions: { reply: editor, note: editor }, source: { source_ref: editor.context.sourceRef }, presentation: {},
    field: { readOnly: false }, callbacks: { status: () => 'Saved to Theseus', sign: () => sign, ...(savedAt ? { savedAt } : {}) }, paintImages() {}, paintOffer() {}, paintAccess() {},
    // How the reply is sent has its own checks (ui_whisper.test.mjs).
    paintChoice() {},
  });
  r.paintStatus();
  return $('save-state');
}
const context = { instanceId: 'i1', actor: 'tony', kind: 'reply', topicId: 't1', sourceRef: { kind: 'message', id: 'm1' } };
const editor = () => new Editor(context, { id: 'd1', revision: 1, generation: 'g1', body: 'Writing' });

test('the Reader marks its save status with the saving sign', () => {
  for (const sign of ['saving', 'device', 'saved', 'attention']) {
    const status = reader(editor(), sign);
    assert.deepEqual([status.textContent, status.dataset.save], ['Saved to Theseus', sign]);
  }
});

test('words that are not the save status carry no saving sign', () => {
  const held = editor();
  held.imageCopiesNext = 'more';
  held.recoveryDiscovery = true;
  const state = writingState(held, { status: () => 'Saved to Theseus', sign: () => 'saved' });
  assert.notEqual(state.message, 'Saved to Theseus', 'an image barrier speaks instead');
  assert.equal(state.sign, '');
  assert.equal(writingState(editor(), { status: () => 'Saved to Theseus', sign: () => 'saved' }).sign, 'saved');
});

// Each state has its own mark, drawn only from the palette's tokens, so it
// follows light and dark.
test('each saving state is drawn from a palette token', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.match(css, /\.save-status>span::before\{content:'';display:inline-block;width:\.5em;height:\.5em;/);
  for (const [state, token] of [['saving', 'muted'], ['device', 'muted'], ['saved', 'accent'], ['attention', 'warn']]) {
    const rule = css.match(new RegExp(`\\.save-status>\\[data-save=${state}\\]::before\\{([^}]*)\\}`))?.[1] ?? '';
    assert.match(rule, new RegExp(`border-color:var\\(--${token}\\)`), state);
    assert.doesNotMatch(rule, /#[0-9a-f]{3,6}|animation/i, state);
  }
  // Saving is a ring: only what is kept somewhere is filled in.
  for (const state of ['device', 'saved', 'attention']) assert.match(css, new RegExp(`\\[data-save=${state}\\]::before\\{background:var`), state);
  assert.doesNotMatch(css.match(/\[data-save=saving\]::before\{([^}]*)\}/)?.[1] ?? 'missing', /background/, 'saving');
});

// The topic composer marks its save status the same way, and leaves its mark
// off while topic access is unconfirmed, since its words then are not the
// save status.
function composer(editor, sign, presentation, savedAt, status = statusNode()) {
  const nodes = new Map([['save-state', status]]);
  const node = () => ({ hidden: false, disabled: false, textContent: '', dataset: {}, replaceChildren() {} });
  const c = Object.assign(Object.create(InlineComposer.prototype), {
    presentation: { editors: { reply: editor }, ...presentation }, root: { inert: false }, field: { readOnly: false },
    callbacks: { admits: () => true, status: () => 'Saved to Theseus', sign: () => sign, needsReview: () => false, renderPending() {}, ...(savedAt ? { savedAt } : {}) },
    kind: 'message', notebookJobs: new WeakMap(), paintKind() {}, paintImages() {}, paintChoice() {},
  });
  c.$ = name => { if (!nodes.has(name)) nodes.set(name, node()); return nodes.get(name); };
  c.paintStatus();
  return c.$('save-state');
}

test('the topic composer marks its save status, and not while access is unconfirmed', () => {
  for (const sign of ['saving', 'device', 'saved', 'attention']) {
    const status = composer(editor(), sign);
    assert.deepEqual([status.textContent, status.dataset.save], ['Saved to Theseus', sign]);
  }
  const unconfirmed = composer(editor(), 'saved', { availabilityUnconfirmed: true });
  assert.deepEqual([unconfirmed.textContent, unconfirmed.dataset.save], ['Topic access unconfirmed — writing kept on this device', '']);
});

// Each state the writing can be in, and the mark it gets: only writing that
// Theseus holds is marked saved, and only writing kept on this device alone is
// marked as kept here.
test('the saving sign gives each state of the writing its own mark', () => {
  const registry = new EditorRegistry({ api: {}, journal: {}, bootstrap: { actor: 'tony', instance_id: 'i1',
    authority: { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' } } });
  const sign = change => { const held = editor(); change(held); return registry.saveSign(held); };
  assert.deepEqual(sign(() => {}), { state: 'saved', text: 'Saved to Theseus' });
  assert.deepEqual(sign(held => { held.unavailable = true; }), { state: 'device', text: 'Source or destination unavailable — writing kept on this device' });
  assert.deepEqual(sign(held => { held.conflict = { error: { code: 'CONFLICT' } }; }), { state: 'attention', text: 'Not saved — another version needs review' });
  assert.deepEqual(sign(held => { held.authorityRecovery = { phase: 'ready' }; }), { state: 'attention', text: 'Runtime changed — review saved version' });
  assert.deepEqual(sign(held => { held.journalError = 'Quota'; }), { state: 'attention', text: 'Recovery copy unavailable — keep this page open' });
  assert.deepEqual(sign(held => { held.edit({ body: 'Changed' }); }), { state: 'device', text: 'Saved on this device — not yet saved to Theseus' });
});

// Item 61: when the writing was last saved, beside the saving sign's words,
// "Saved to Theseus · 4:40 AM", in the Reader and in the topic composer.
test('the time beside the saving sign is the newest save, in the words for its day, and goes when there is none', () => {
  const status = statusNode();
  status.textContent = 'Saved to Theseus';
  const first = at(2026, 10, 5, 4, 40);
  assert.deepEqual(shownBeside(status), [], 'no time before this page has seen a save');
  paintSaveTime(status, first);
  assert.deepEqual(shownBeside(status), [{ tag: 'time', className: 'save-time', text: '4:40 AM', ms: String(first), title: '4:40 AM Thu Nov 5' }]);
  assert.equal(status.textContent, 'Saved to Theseus', 'the time sits beside the words, not in them');
  const shown = status.parentElement.children[1];
  paintSaveTime(status, first);
  assert.equal(status.parentElement.children[1], shown, 'the same save keeps the same time');
  const later = at(2026, 10, 5, 11, 2);
  paintSaveTime(status, later);
  assert.deepEqual(shownBeside(status).map(t => [t.text, t.ms]), [['11:02 AM', String(later)]], 'a newer save replaces the time; only one is shown');
  paintSaveTime(status, at(2026, 10, 4, 21, 12));
  assert.deepEqual(shownBeside(status).map(t => t.text), ['Yesterday 9:12 PM'], "yesterday's save says so");
  for (const none of [null, undefined, NaN, 1.5]) {
    paintSaveTime(status, later);
    paintSaveTime(status, none);
    assert.deepEqual(shownBeside(status), [], `no save (${none}) shows no time`);
  }
});

test('the Reader shows when the writing it speaks of was saved, and no time when its words are not the save status', () => {
  const ms = at(2026, 10, 5, 4, 40);
  for (const sign of ['saved', 'device']) {
    const held = editor(), asked = [];
    const status = reader(held, sign, e => { asked.push(e); return ms; });
    assert.deepEqual(shownBeside(status).map(t => [t.text, t.ms]), [['4:40 AM', String(ms)]], sign);
    assert.deepEqual(asked, [held], `${sign}: the time is the one for this writing`);
  }
  assert.deepEqual(shownBeside(reader(editor(), 'saved', () => null)), [], 'no time before a save');
  // A time shown, then words that are not the save status (an image still
  // being copied speaks instead): the time goes with them.
  const status = reader(editor(), 'saved', () => ms);
  const held = editor();
  held.imageCopiesNext = 'more'; held.recoveryDiscovery = true;
  reader(held, 'saved', () => ms, status);
  assert.notEqual(status.textContent, 'Saved to Theseus');
  assert.deepEqual(shownBeside(status), [], 'no time beside words that are not the save status');
});

test('the topic composer shows when its writing was saved, and no time while topic access is unconfirmed', () => {
  const ms = at(2026, 10, 5, 4, 40);
  for (const sign of ['saved', 'device']) {
    const held = editor(), asked = [];
    const status = composer(held, sign, {}, e => { asked.push(e); return ms; });
    assert.deepEqual(shownBeside(status).map(t => [t.text, t.ms]), [['4:40 AM', String(ms)]], sign);
    assert.deepEqual(asked, [held], `${sign}: the time is the one for this writing`);
  }
  assert.deepEqual(shownBeside(composer(editor(), 'saved', {}, () => null)), [], 'no time before a save');
  const status = composer(editor(), 'saved', {}, () => ms);
  composer(editor(), 'saved', { availabilityUnconfirmed: true }, () => ms, status);
  assert.equal(status.textContent, 'Topic access unconfirmed — writing kept on this device');
  assert.deepEqual(shownBeside(status), [], 'the time goes while access is unconfirmed');
  composer(editor(), '', {}, () => ms, status);
  assert.deepEqual(shownBeside(status), [], 'and beside any words that carry no saving sign');
});

// The time the page gives is the save the sign speaks of: the save to
// Theseus when the sign says saved, the copy on this device when it says
// kept on this device, and none while saving or when something needs review.
test('the time is when this page saw the save the saving sign speaks of', async () => {
  let now = 0, persisted, saved;
  const timers = { now: () => now, setTimeout: () => ({}), clearTimeout() {} };
  const registry = new EditorRegistry({ api: {}, journal: {}, timers, bootstrap: { actor: 'tony', instance_id: 'i1',
    authority: { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' } } });
  const held = editor();
  registry.sessions.set(held.key, { editor: held, persist: () => (persisted = Promise.resolve()), save: () => saved });
  const settle = () => new Promise(done => setImmediate(done));
  assert.equal(registry.savedTime(held), null, 'no time before this page saw a save');

  held.edit({ body: 'Writing more' });
  now = at(2026, 10, 5, 4, 40); registry.persistLocal(held); await persisted; await settle();
  assert.equal(registry.saveSign(held).state, 'device');
  assert.equal(registry.savedTime(held), at(2026, 10, 5, 4, 40), 'kept on this device: when the device copy was made');

  now = at(2026, 10, 5, 4, 41); saved = Promise.resolve({ status: 'committed' });
  const version = held.localVersion;
  registry.flush(held); await saved; await settle();
  held.ackVersion = version;
  assert.equal(registry.saveSign(held).state, 'saved');
  assert.equal(registry.savedTime(held), at(2026, 10, 5, 4, 41), 'saved to Theseus: when Theseus took it, not the device copy');

  // A save Theseus did not take leaves the time of the last one it did.
  held.edit({ body: 'Writing again' });
  now = at(2026, 10, 5, 4, 50); saved = Promise.resolve({ status: 'conflict' });
  registry.flush(held); await saved; await settle();
  held.ackVersion = held.localVersion;
  assert.equal(registry.savedTime(held), at(2026, 10, 5, 4, 41), 'a save Theseus refused is not a time it was saved');

  // While saving, or with something to review, the sign's words say no save.
  registry.serverSaves.set(held.key, 1); held.edit({ body: 'Once more' });
  assert.equal(registry.saveSign(held).state, 'saving');
  assert.equal(registry.savedTime(held), null, 'no time while the save is under way');
  registry.serverSaves.delete(held.key); held.conflict = { error: { code: 'CONFLICT' } };
  assert.equal(registry.savedTime(held), null, 'no time while another version needs review');

  // Another writing has a time of its own.
  const other = new Editor({ ...context, sourceRef: { kind: 'message', id: 'm2' } }, { id: 'd2', revision: 1, generation: 'g1', body: 'Other' });
  assert.notEqual(other.key, held.key);
  assert.equal(registry.savedTime(other), null, "one writing's save is not another's");
});
