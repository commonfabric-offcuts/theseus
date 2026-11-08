import test from 'node:test';
import assert from 'node:assert/strict';
import { ASKED, contrast, summaryLines, evidenceBody, postEnvelope } from '../web/phone-check.mjs';

// The phone check's record (docs/device-evidence.md): what goes into the topic is
// a plain line per step and the whole record as JSON, posted once as one message.
const record = {
  page: { origin: 'https://theseus.example.ts.net:5211', https: true, tailnet: true, actor: 'tony', instance: 'i1', startPointer: 'touch',
    viewport: { width: 390, height: 664 }, dpr: 3, scheme: 'dark', standalone: false },
  names: { value: 'fable', inputType: 'insertReplacementText', scaleBefore: 1, scaleAfter: 1 },
  longPress: { selected: 'the harbour', longestPressMs: 612, selectionChanges: 9 },
  keyboard: { visualBefore: 664, visualSmallest: 368, resized: true, boxInView: true, sendInView: false, selected: { text: 'two' } },
  notification: { api: 'present', permissionBefore: 'default', permissionAfter: 'granted', shown: true, error: null, saw: false, clicked: false },
  colours: { scheme: 'dark', own: { contrast: 15.2 }, agent: { contrast: 7.1 }, clear: true },
};

test('each step reads as one plain line that says what the phone did, misses included', () => {
  const lines = summaryLines(record);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /https, over the tailnet\), signed in as tony on i1; first tap by touch; 390×664 at 3x, dark scheme\.$/);
  assert.equal(lines[1], `Names list: got ${ASKED.name} as asked, picked from the list; zoom 1 → 1.`);
  assert.equal(lines[2], `Holding to select: selected "the harbour", asked for "${ASKED.words}"; longest hold 612 ms; 9 selection changes.`);
  assert.equal(lines[3], 'Keyboard: visible height 664 → 368 px when the keyboard came up; the box stayed in view and Send did not stay in view; handles selected "two".');
  assert.equal(lines[4], 'Notification: permission default → granted; shown; you saw it: no.');
  assert.equal(lines[5], 'Reading colours: dark scheme; your card 15.2:1, an agent\'s card 7.1:1; reads easily: yes.');
});

test('a typed name, a skipped step and a browser with no notifications say so, and a step not reached has no line', () => {
  const lines = summaryLines({ names: { value: 'fable', inputType: 'insertText', scaleBefore: 1, scaleAfter: 1.5 }, longPress: { skipped: true },
    notification: { api: 'absent' } });
  assert.deepEqual(lines, [`Names list: got ${ASKED.name} as asked, by insertText; zoom 1 → 1.5.`, 'Holding to select: skipped.',
    'Notification: this browser offers web pages no notifications.']);
});

test('the message carries the lines and the exact record, and the envelope posts it to the one topic under its own operation', () => {
  const body = evidenceBody(record);
  assert.ok(body.startsWith('Phone check: what this phone did, written down by the phone check page (nobody typed it).\n\n- This page: '));
  assert.deepEqual(JSON.parse(body.split('```json\n')[1].split('\n```')[0]), record);
  const bootstrap = { instance_id: 'i1', authority: { authority_id: 'a1', authority_epoch: 4 } };
  assert.deepEqual(postEnvelope({ bootstrap, topicId: 't9', operationId: 'phone-check-1', body }), { v: 1, instance_id: 'i1', operation_id: 'phone-check-1',
    kind: 'message.post', target: { topic_id: 't9' }, expected: { authority: { authority_id: 'a1', authority_epoch: 4 } }, args: { body } });
});

test('contrast is the WCAG ratio of two computed colours', () => {
  assert.equal(contrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
  assert.equal(contrast('rgb(255, 255, 255)', 'rgb(0, 0, 0)'), 21);
  assert.equal(contrast('rgb(118, 118, 118)', 'rgb(255, 255, 255)'), 4.54);
});
