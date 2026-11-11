// A press held down on the page, and the repaints that wait for it to end
// (web/press-hold.mjs). The hold is set by one event and cleared by several,
// so each way a press can end is checked here on its own: a press left held
// by a missed ending would keep every live repaint waiting until the next
// tap. The native reading checks (tests/stack_native.mjs) end a press the
// same ways in a real browser: a finger scroll, a context menu from a
// press, the window losing the focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PressHold } from '../web/press-hold.mjs';

// A page as PressHold listens to it: the document, and its window for blur.
function page() {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  const fire = (name, fields = {}, on = doc) => on.dispatchEvent(Object.assign(new Event(name), fields));
  return { doc, fire, press: (fields = {}) => fire('pointerdown', { isPrimary: true, button: 0, ...fields }) };
}

const ENDINGS = {
  'its pointerup': ({ fire }) => fire('pointerup', { isPrimary: true, button: 0 }),
  'its pointercancel (a finger that scrolls)': ({ fire }) => fire('pointercancel', { isPrimary: true, button: 0 }),
  'a context menu it opened': ({ fire }) => fire('contextmenu', { button: 0 }),
  'the window losing the focus': ({ fire, doc }) => fire('blur', {}, doc.defaultView),
};

for (const [ending, end] of Object.entries(ENDINGS)) {
  test(`a press held waits a repaint until ${ending}, then shows it once, and the next one at once`, () => {
    const p = page(), hold = new PressHold(p.doc), painted = [];
    p.press();
    assert.equal(hold.down, true, 'the press is held');
    hold.after('messages', () => painted.push('first'));
    hold.after('messages', () => painted.push('latest'));
    hold.after('reactions', () => painted.push('reactions'));
    assert.deepEqual(painted, [], 'nothing repaints under the press');
    end(p);
    assert.equal(hold.down, false, `${ending} ends the press`);
    assert.deepEqual(painted, ['latest', 'reactions'], 'each waiting repaint shows once, the latest of its name');
    hold.after('messages', () => painted.push('after'));
    assert.deepEqual(painted, ['latest', 'reactions', 'after'], 'once it has ended, a repaint shows at once');
    end(p);
    assert.deepEqual(painted, ['latest', 'reactions', 'after'], 'another ending shows nothing again');
  });
}

test('only the primary button or the first finger holds: a right or middle press, or a second finger, repaints at once', () => {
  for (const fields of [{ button: 2 }, { button: 1 }, { isPrimary: false }]) {
    const p = page(), hold = new PressHold(p.doc), painted = [];
    p.press(fields);
    assert.equal(hold.down, false, `${JSON.stringify(fields)} holds nothing`);
    hold.after('messages', () => painted.push('now'));
    assert.deepEqual(painted, ['now'], `${JSON.stringify(fields)}: the repaint shows at once`);
  }
});

test('with no press, a repaint shows at once', () => {
  const p = page(), hold = new PressHold(p.doc), painted = [];
  hold.after('line', () => painted.push('line'));
  assert.deepEqual(painted, ['line']);
});
