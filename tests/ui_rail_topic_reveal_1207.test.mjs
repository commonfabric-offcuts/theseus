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
  let now = 0, timer;
  f.doc.defaultView.setTimeout = (fn, delay) => { timer = { fn, at: now + delay }; return timer; };
  f.doc.defaultView.clearTimeout = id => { if (timer === id) timer = null; };
  const advance = ms => { now += ms; if (timer?.at <= now) timer.fn(); };
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
  const move = (clientY, clientX = 20) => f.emit(f.host.children[7] ?? f.area, 'pointermove', { pointerType: options.phone ? 'touch' : 'mouse', clientY, clientX });
  const rest = y => { move(y); advance(250); };
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
  return { ...f, captures, move, rest, advance, action, revealed: () => f.area.hasAttribute('data-topic-revealed') };
}

for (const [y, expected] of [[20, false], [264, false], [307.9, false], [308, true], [345.4, true], [345.5, false]]) {
  test('1207 pointer at row coordinate ' + y + ' reveals only the faded row', t => {
    const f = fixture(t); f.rest(y); assert.equal(f.revealed(), expected);
  });
}

test('1207 reveal stays latched through leaving, upper-row hover, scroll and measurement', t => {
  const f = fixture(t); f.rest(320); assert.equal(f.revealed(), true);
  f.emit(f.area, 'pointerleave'); f.move(20); f.emit(f.area, 'scroll'); f.outcome.fold.measure();
  assert.equal(f.revealed(), true);
  assert.equal(f.host.children.length, 10); assert.deepEqual(f.reads, []);
});

for (const type of ['click', 'keydown']) for (const place of ['page', 'left rail', 'right rail']) {
  test('1207 the next ' + type + ' in the ' + place + ' closes without consuming its action', t => {
    const f = fixture(t), button = f.doc.createElement('button');
    button.dataset.place = place; let acted = 0;
    button['on' + type] = event => { assert.equal(f.revealed(), false); acted++; event.stopPropagation(); };
    f.rest(320); assert.equal(f.revealed(), true);
    const event = f.action(type, button, { key: 'Enter' });
    assert.equal(f.revealed(), false); assert.equal(acted, 1); assert.equal(event.prevented, false);
  });
}

test('1207 a sideways swipe outside the list closes the reveal, as swiping a dossier to archive is', t => {
  const f = fixture(t); f.rest(320); assert.equal(f.revealed(), true);
  const event = f.action('wheel', f.doc.createElement('section'), { deltaX: 24, deltaY: 3 });
  assert.equal(f.revealed(), false); assert.equal(event.prevented, false);
});

test('1207 vertical scrolling anywhere, and a swipe inside the list, keep the reveal open', t => {
  const f = fixture(t); f.rest(320);
  f.action('wheel', f.doc.createElement('section'), { deltaX: 2, deltaY: 40 });
  f.action('wheel', f.host.children[9], { deltaX: 24, deltaY: 3 });
  assert.equal(f.revealed(), true);
});

test('1207 dismissing with a topic click keeps the existing TopicRail navigation', t => {
  const f = fixture(t); f.rest(320); const link = f.host.children[9];
  const event = f.action('click', link);
  assert.equal(f.revealed(), false); assert.equal(event.stopped, false);
  assert.equal(f.opens[0][0], link.dataset.topicId);
});

test('1207 a document capture owner cannot keep a pointer-revealed list open', t => {
  const f = fixture(t, { documentStops: true }); f.rest(320);
  assert.equal(f.revealed(), true);
  f.action('click');
  assert.equal(f.revealed(), false, 'dismiss before the app body-edit click owner stops document capture');
});

test('1207 a hover-capable narrow screen can touch an already revealed topic on its first press', t => {
  const f = fixture(t, { phone: true }), link = f.host.children[7];
  f.doc.defaultView.matchMedia = () => ({ matches: true });
  f.emit(link, 'pointermove', { pointerType: 'mouse', clientY: 320, clientX: 20 });
  f.advance(250);
  assert.equal(f.revealed(), true);
  f.emit(link, 'pointerdown', { pointerType: 'touch' });
  const event = f.action('click', link);
  assert.equal(f.revealed(), false);
  assert.equal(f.opens[0]?.[0], link.dataset.topicId, 'the normal TopicRail action still opens the topic');
  assert.equal(event.stopped, false, 'the first-touch reveal bridge must not swallow an already visible link');
});

test('1207 touch movement does not start pointer reveal', t => {
  const f = fixture(t, { phone: true }); f.rest(320); assert.equal(f.revealed(), false);
});
test('1207 an uncollapsed list does not start pointer reveal', t => {
  const f = fixture(t, { count: 7 }); f.move(300); assert.equal(f.revealed(), false);
});

test('1207 disposal removes page capture and pointer listeners', t => {
  const f = fixture(t); f.rest(320); assert.equal(f.revealed(), true);
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

test('rest opens at 250 ms with under 6 px drift, and a 6 px move restarts it', t => {
  const f = fixture(t);
  f.move(320);
  f.advance(200);
  f.move(320, 26);
  f.advance(200);
  assert.equal(f.revealed(), false);
  f.move(320, 30);
  f.advance(49);
  assert.equal(f.revealed(), false);
  f.advance(1);
  assert.equal(f.revealed(), true);
});

test('leaving the eighth row cancels a pending reveal', t => {
  const f = fixture(t);
  f.move(320);
  f.advance(200);
  f.move(300);
  f.advance(250);
  assert.equal(f.revealed(), false);
});

test('press opens the fading row immediately and keyboard focus holds until a feed action', t => {
  const f = fixture(t);
  const peek = f.host.children[7];
  f.emit(peek, 'pointerdown', { pointerType: 'mouse' });
  assert.equal(f.revealed(), true);
  f.action('click', peek);
  assert.equal(f.revealed(), true);
  f.action('keydown', peek, { key: 'ArrowDown' });
  assert.ok(f.area.hasAttribute('data-topic-keys'));
  f.action('pointerdown');
  assert.equal(f.area.hasAttribute('data-topic-keys'), false);
  f.action('click');
  assert.equal(f.revealed(), false);
});

test('a keyboard click on More topics preserves the keyboard hold until focus leaves', t => {
  const f = fixture(t);
  const more = f.outcome.parts.more;
  f.action('keydown', more, { key: 'Enter' });
  f.action('click', more, { detail: 0 });
  assert.ok(f.area.hasAttribute('data-topic-keys'));
  f.action('click', f.doc.createElement('button'), { detail: 0 });
  assert.equal(f.area.hasAttribute('data-topic-keys'), false);
});

for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
  test(`a ${modifier} press lets the faded link keep its browser action`, t => {
    const f = fixture(t);
    const link = f.host.children[7];
    f.emit(link, 'pointerdown', { pointerType: 'mouse', [modifier]: true });
    assert.equal(f.revealed(), false);
    const click = f.action('click', link, { [modifier]: true });
    assert.equal(click.prevented, false);
    assert.equal(click.stopped, false);
    f.emit(link, 'pointerdown', { pointerType: 'mouse' });
    assert.equal(f.revealed(), true);
  });
}
