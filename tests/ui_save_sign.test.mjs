import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Reader } from '../web/reader.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Editor } from '../web/editor.mjs';
import { writingState } from '../web/writing-helpers.mjs';

// The saving sign beside the writing, painted by the real Reader.paintStatus
// over stand-in nodes: the words, and the state the page draws its mark from.
function reader(editor, sign) {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, textContent: '', dataset: {}, replaceChildren() {} }); return nodes.get(id); };
  const r = Object.assign(Object.create(Reader.prototype), {
    $, mode: 'reply', sessions: { reply: editor, note: editor }, source: { source_ref: editor.context.sourceRef }, presentation: {},
    field: { readOnly: false }, callbacks: { status: () => 'Saved to Theseus', sign: () => sign }, paintImages() {}, paintOffer() {}, paintAccess() {},
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
// follows light and dark; the hidden reserve carries the same mark, so the
// footer never moves as the state changes.
test('each saving state is drawn from a palette token, and the reserve keeps its room', () => {
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
function composer(editor, sign, presentation) {
  const nodes = new Map();
  const node = () => ({ hidden: false, disabled: false, textContent: '', dataset: {}, replaceChildren() {} });
  const c = Object.assign(Object.create(InlineComposer.prototype), {
    presentation: { editors: { reply: editor }, ...presentation }, root: { inert: false }, field: { readOnly: false },
    callbacks: { admits: () => true, status: () => 'Saved to Theseus', sign: () => sign, needsReview: () => false, renderPending() {} },
    paintImages() {},
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
