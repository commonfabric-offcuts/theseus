import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

// What the Reader says about access to its source, drawn on stand-in elements.
function reader(presentation) {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { id, textContent: '', hidden: false, disabled: false, children: [],
    replaceChildren(...items) { this.children = items; }, classList: { remove() {} }, querySelectorAll: () => [] }); return elements.get(id); };
  const r = Object.assign(Object.create(Reader.prototype), { presentation, sessions: { reply: {} }, callbacks: {}, sourceBody: element('source-body'),
    $: element, paintStatus() { this.painted = (this.painted ?? 0) + 1; } });
  return { r, element };
}

test('a paused topic is named after what the Reader already says, with a space between', () => {
  for (const [p, said] of [
    [{ topicUpdatesPaused: true }, 'This source is available. Topic updates remain paused.'],
    [{ topicUpdatesPaused: true, accessMessage: 'Access is back.' }, 'Access is back. This source is available. Topic updates remain paused.'],
    [{ topicUpdatesPaused: true, sourceUnavailable: true }, 'The source is unavailable. Your private writing is kept. Topic updates are paused. Retry access checks only this source.'],
    [{ accessMessage: 'Access is back.' }, 'Access is back.'],
    [{}, ''],
  ]) {
    const { r, element } = reader(p);
    r.paintAccess();
    assert.equal(element('source-access-status').textContent, said, JSON.stringify(p));
    assert.equal(element('source-access-status').hidden, !said);
  }
});

test('a source that is refused hides its title along with its text', () => {
  const { r, element } = reader({});
  element('reader-title').textContent = 'Private plan';
  element('source-body').children = ['Secret words'];
  r.hideUnavailableSource();
  assert.deepEqual([element('reader-title').textContent, element('reader-origin').textContent, element('source-body').children], ['Source unavailable', 'Source unavailable', []]);
  assert.equal(r.painted, 1);
});

test('a title is the source\'s own, or names what kind of source it is', () => {
  const { r, element } = reader({});
  for (const [source, title] of [[{ title: 'Release plan', source_ref: { kind: 'memory' } }, 'Release plan'], [{ title: '', source_ref: { kind: 'memory' } }, 'Notebook'], [{ source_ref: { kind: 'message' } }, 'Message']]) {
    r.paintTitle(source);
    assert.equal(element('reader-title').textContent, title);
  }
});
