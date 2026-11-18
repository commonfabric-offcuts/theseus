import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startCardScrollProbe, cardScrollHeld } from './card_scroll_probe.mjs';

function fixture() {
  const nodes = Object.fromEntries(['.notebook-sheet-pages', '#new-message-sheet', '.notebook-sheet-page:not([hidden])'].map(selector => [selector, {scrollTop: 0}]));
  const frames = [];
  const context = vm.createContext({scrollY: 93, document: {querySelector: selector => nodes[selector]}, requestAnimationFrame: read => frames.push(read)});
  const trail = vm.runInContext(`(${startCardScrollProbe})()`, context);
  return {nodes, context, trail, frame: () => frames.shift()()};
}

test('item 644 B1 the every-frame probe rejects a 350px sheet-page jump even after it returns', () => {
  const {nodes, trail, frame} = fixture();
  const sheet = nodes['.notebook-sheet-page:not([hidden])'];
  assert.equal(cardScrollHeld(trail), true, 'stationary sheet passes');
  sheet.scrollTop = 350;
  assert.equal(sheet.scrollTop, 350, 'the mutation applied to the actual sheet owner');
  frame();
  sheet.scrollTop = 0;
  frame();
  assert.equal(cardScrollHeld(trail), false, 'a transient sheet jump must not pass the native predicate');
});

test('item 644 the probe still rejects jumps in the document, wrapper and dialog', () => {
  for (const selector of ['window', '.notebook-sheet-pages', '#new-message-sheet']) {
    const {nodes, context, trail, frame} = fixture();
    if (selector === 'window') context.scrollY += 350;
    else nodes[selector].scrollTop = 350;
    frame();
    assert.equal(cardScrollHeld(trail), false, selector);
  }
});

test('item 644 the full-page probe accepts stationary frames with no sheet', () => {
  const {nodes, trail, frame} = fixture();
  for (const selector of Object.keys(nodes)) delete nodes[selector];
  frame(); frame();
  assert.equal(cardScrollHeld(trail), true);
});
