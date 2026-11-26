import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { webkit } = await import(process.env.AIM_PLAYWRIGHT_CORE);
import { fixtureControl } from './fixture_control.mjs';

const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit } = fixtureControl(fixture);
let browser;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  browser = await webkit.launch();
  for (const width of [375, 390]) for (const surface of ['pencil', 'inline']) {
    const topic = `pencil-selection-${width}-${surface}`;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Selection comparison' }] });
    const root = await control({ method: 'agent_message', operation_id: `${topic}-root`, topic_id: topic,
      sender: actor, whole_topic: true, body: 'Selection comparison opening.' });
    const parent = await control({ method: 'agent_message', operation_id: `${topic}-parent`, topic_id: topic,
      sender: agent, join: true, reply_to: root.result.message_id, reply_without_quote: 'A selection comparison.',
      body: 'Selection comparison source reply.' });
    assert.equal(parent.status, 'committed');
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await context.addInitScript(() => {
        window.selectionTrace = [];
        for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup',
          'mousedown', 'mouseup', 'selectstart', 'selectionchange', 'focusin', 'focusout', 'scroll']) {
          document.addEventListener(type, event => {
            const field = document.activeElement;
            if (!window.selectionTracing || field?.tagName !== 'TEXTAREA') return;
            const target = event.target?.id || event.target?.className || null;
            setTimeout(() => selectionTrace.push({ type, target, trusted: event.isTrusted,
              canceled: event.defaultPrevented, range: [field.selectionStart, field.selectionEnd],
              y: scrollY, sheet: field.closest('dialog')?.scrollTop ?? null }));
          }, true);
        }
        const scroll = window.scrollBy;
        window.scrollBy = function (...args) {
          if (window.selectionTracing) selectionTrace.push({ type: 'scrollBy', args });
          return scroll.apply(this, args);
        };
      });
      const page = await context.newPage();
      await page.goto(origin + '/?topic=' + topic);
      await page.locator('body[data-ready=true]').waitFor();
      let field;
      if (surface === 'pencil') {
        await page.locator('#new-message').click();
        field = page.locator('dialog.composer-home[open] #inline-writing-body');
      } else {
        const id = parent.result.message_id;
        await page.locator(`.message-card[data-id="${id}"] > .message-preview`).click();
        field = page.locator(`[id="reply-${id}-composer"] textarea[id]`);
      }
      await field.tap();
      await page.keyboard.type('Alpha bravo charlie.\nDelta echo foxtrot.\nGolf hotel india.');
      await page.setViewportSize({ width, height: 540 });
      await field.scrollIntoViewIfNeeded();
      const box = await field.boundingBox();
      const x = box.x + 24, y = box.y + 12;
      const snapshot = () => field.evaluate(field => ({ start: field.selectionStart, end: field.selectionEnd,
        text: field.value.slice(field.selectionStart, field.selectionEnd), length: field.value.length,
        focused: field === document.activeElement, y: scrollY, sheet: field.closest('dialog')?.scrollTop ?? null }));
      const ancestors = await field.evaluate(field => {
        const result = [];
        for (let el = field; el; el = el.parentElement) {
          const css = getComputedStyle(el);
          result.push({ tag: el.tagName, id: el.id, css: [css.userSelect, css.webkitUserSelect, css.touchAction, css.overflowY] });
        }
        window.selectionTracing = true;
        return result;
      });
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x, y });
      assert.equal(hit, 'TEXTAREA');
      await page.touchscreen.tap(x, y);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      const heldPointer = await snapshot();
      await page.mouse.dblclick(x, y);
      const word = await snapshot();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 100, y + 20, { steps: 5 });
      await page.mouse.up();
      const extended = await snapshot();
      await page.keyboard.press('Meta+a');
      const selectAll = await snapshot();
      assert.ok(word.end > word.start, 'word selection reaches the textarea');
      assert.ok(extended.end - extended.start > word.end - word.start, 'the pointer drag extends the selection');
      assert.deepEqual([selectAll.start, selectAll.end], [0, selectAll.length]);
      assert.ok(selectAll.focused);
      const events = await page.evaluate(() => selectionTrace);
      if (surface === 'pencil') {
        assert.ok(events.some(event => event.type === 'touchstart' && event.trusted && event.target === 'inline-writing-body'));
        assert.ok(events.every(event => !event.canceled));
        const dialog = page.locator('dialog.composer-home[open]');
        const grip = dialog.locator('.composer-edge[data-edge=left]');
        const gripBox = await grip.boundingBox();
        const gripX = gripBox.x + 4, gripY = gripBox.y + gripBox.height / 2;
        assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dataset.edge, { x: gripX, y: gripY }), 'left');
        const beforeWidth = (await dialog.boundingBox()).width;
        await page.mouse.move(gripX, gripY);
        await page.mouse.down();
        await page.mouse.move(gripX + 20, gripY, { steps: 4 });
        await page.mouse.up();
        assert.ok((await dialog.boundingBox()).width < beforeWidth, 'the exposed edge still resizes the sheet');
      }
      console.log(JSON.stringify({ width, surface, heldPointer, word, extended, selectAll, ancestors, events }));
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}
