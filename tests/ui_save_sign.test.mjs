import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Reader } from '../web/reader.mjs';
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
});
