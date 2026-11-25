import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RailTopicFold } from '../web/rail-topic-fold.mjs';
import { foldFixture } from './fixtures/rail_topic_fold_1161.mjs';

// Real fold/outline/topic owners with supplied row rectangles and an event
// adapter. These checks do not establish native pointer, layout or timing.
function fixture(t, options = {}) {
  const f = foldFixture(options), captures = new Map(), captureTargets = new Map();
  f.outcome.fold.dispose();
  f.doc.defaultView.matchMedia = query => ({ matches: query.includes('hover') ? !options.phone : Boolean(options.phone) });
  const listen = target => (type, fn, capture) => {
    assert.equal(capture, type === 'resize' ? undefined : true); captures.set(type, fn); captureTargets.set(type, target);
  };
  const unlisten = (type, fn, capture) => {
    assert.equal(capture, type === 'resize' ? undefined : true); if (captures.get(type) === fn) captures.delete(type);
  };
  f.doc.addEventListener = listen('document'); f.doc.removeEventListener = unlisten;
  f.doc.defaultView.addEventListener = listen('window'); f.doc.defaultView.removeEventListener = unlisten;
  f.outcome.fold = new RailTopicFold({ area: f.area, host: f.host, footer: f.footer, doc: f.doc });
  f.flush(); t.after(f.close);
  const move = clientY => f.emit(f.host.children[6], 'pointermove', { pointerType: options.phone ? 'touch' : 'mouse', clientY });
  const action = (type, target = f.doc.createElement('button'), extra = {}) => {
    const event = { target, button: 0, detail: 1, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; this.immediate = true; }, ...extra };
    if (captureTargets.get(type) === 'window') captures.get(type)?.(event);
    if (options.documentStops) event.stopImmediatePropagation();
    if (!event.immediate && captureTargets.get(type) === 'document') captures.get(type)?.(event);
    if (type === 'click' && f.area.contains(target)) f.area.listeners.click?.(event);
    if (!event.stopped) target['on' + type]?.(event);
    return event;
  };
  return { ...f, captures, move, action, revealed: () => f.area.hasAttribute('data-topic-revealed') };
}

for (const [y, expected] of [[20, false], [263.9, false], [264, true], [308, true], [345.4, true], [345.5, false]]) {
  test('1207 pointer at row coordinate ' + y + ' reveals only the fade and one row above', t => {
    const f = fixture(t); f.move(y); assert.equal(f.revealed(), expected);
  });
}

test('1207 reveal stays latched through leaving, upper-row hover, scroll and measurement', t => {
  const f = fixture(t); f.move(320); assert.equal(f.revealed(), true);
  f.emit(f.area, 'pointerleave'); f.move(20); f.emit(f.area, 'scroll'); f.outcome.fold.measure();
  assert.equal(f.revealed(), true);
  assert.equal(f.host.children.length, 10); assert.deepEqual(f.reads, []);
});

for (const type of ['click', 'keydown']) for (const place of ['page', 'left rail', 'right rail']) {
  test('1207 the next ' + type + ' in the ' + place + ' closes without consuming its action', t => {
    const f = fixture(t), button = f.doc.createElement('button');
    button.dataset.place = place; let acted = 0;
    button['on' + type] = event => { assert.equal(f.revealed(), false); acted++; event.stopPropagation(); };
    f.move(320); assert.equal(f.revealed(), true);
    const event = f.action(type, button, { key: 'Enter' });
    assert.equal(f.revealed(), false); assert.equal(acted, 1); assert.equal(event.prevented, false);
  });
}

test('1207 a sideways swipe outside the list closes the reveal, as swiping a dossier to archive is', t => {
  const f = fixture(t); f.move(320); assert.equal(f.revealed(), true);
  const event = f.action('wheel', f.doc.createElement('section'), { deltaX: 24, deltaY: 3 });
  assert.equal(f.revealed(), false); assert.equal(event.prevented, false);
});

test('1207 vertical scrolling anywhere, and a swipe inside the list, keep the reveal open', t => {
  const f = fixture(t); f.move(320);
  f.action('wheel', f.doc.createElement('section'), { deltaX: 2, deltaY: 40 });
  f.action('wheel', f.host.children[9], { deltaX: 24, deltaY: 3 });
  assert.equal(f.revealed(), true);
});

test('1207 dismissing with a topic click keeps the existing TopicRail navigation', t => {
  const f = fixture(t); f.move(320); const link = f.host.children[9];
  const event = f.action('click', link);
  assert.equal(f.revealed(), false); assert.equal(event.stopped, false);
  assert.equal(f.opens[0][0], link.dataset.topicId);
});

test('1207 a document capture owner cannot keep a pointer-revealed list open', t => {
  const f = fixture(t, { documentStops: true }); f.move(320);
  assert.equal(f.revealed(), true);
  f.action('click');
  assert.equal(f.revealed(), false, 'dismiss before the app body-edit click owner stops document capture');
});

test('1207 a hover-capable narrow screen can touch an already revealed topic on its first press', t => {
  const f = fixture(t, { phone: true }), link = f.host.children[7];
  f.doc.defaultView.matchMedia = () => ({ matches: true });
  f.emit(link, 'pointermove', { pointerType: 'mouse', clientY: 320 });
  assert.equal(f.revealed(), true);
  f.emit(link, 'pointerdown', { pointerType: 'touch' });
  const event = f.action('click', link);
  assert.equal(f.revealed(), false);
  assert.equal(f.opens[0]?.[0], link.dataset.topicId, 'the normal TopicRail action still opens the topic');
  assert.equal(event.stopped, false, 'the first-touch reveal bridge must not swallow an already visible link');
});

test('1207 touch movement does not start pointer reveal', t => {
  const f = fixture(t, { phone: true }); f.move(320); assert.equal(f.revealed(), false);
});
test('1207 an uncollapsed list does not start pointer reveal', t => {
  const f = fixture(t, { count: 7 }); f.move(300); assert.equal(f.revealed(), false);
});

test('1207 disposal removes page capture and pointer listeners', t => {
  const f = fixture(t); f.move(320); assert.equal(f.revealed(), true);
  assert.ok(f.captures.has('click')); assert.ok(f.captures.has('keydown')); assert.ok(f.captures.has('wheel'));
  f.outcome.fold.dispose();
  assert.equal(f.captures.size, 0); assert.equal(f.area.listeners.pointermove, undefined);
});

test('1207 the stylesheet opens the latched list and footer without whole-area hover', async () => {
  const css = await readFile(new URL('../web/rails.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.ol-own\[data-topic-fold\]:hover/);
  assert.match(css, /\[data-topic-revealed\][^\n]*>\.ol-topic-list\{[^}]*mask-image:none/);
  assert.match(css, /\[data-topic-revealed\][^\n]*>\.ol-topic-foot\{[^}]*max-height:var\(--topic-fold-foot\)/);
});
