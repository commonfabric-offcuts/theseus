import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const engines = await import(process.env.AIM_PLAYWRIGHT_CORE);
const engine = process.env.AIM_ENGINE ?? 'chromium';
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const observations = {};
const draft = 'A pencil draft that stays put while the sidebar scrolls.';
let browser;

async function openPencil(page, url, press, prepare = async () => {}) {
  await page.goto(url);
  await page.locator('body[data-ready=true]').waitFor();
  await prepare();
  await press(page.locator('#new-message'));
  await page.locator('#new-message-sheet[open]').waitFor();
  await page.keyboard.insertText(draft);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
}

function writing(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('#new-message-sheet');
    const field = document.querySelector('#inline-writing-body');
    return {
      open: sheet.open, modal: sheet.matches(':modal'), focused: document.activeElement === field,
      text: field.value, start: field.selectionStart, end: field.selectionEnd, topic: new URL(location.href).searchParams.get('topic'),
    };
  });
}

try {
  const facts = await control({ method: 'ready' });
  await control({ method: 'navigation_topics', topics: Array.from({ length: 65 }, (_, n) => ({
    id: 'pencil-scroll-' + n, title: 'Pencil scroll fixture topic ' + n,
  })) });
  browser = await engines[engine].launch();
  const url = facts.origin + '/?topic=t1';
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 440 }, reducedMotion: 'reduce' });
  desktop.setDefaultTimeout(6000);
  await desktop.addInitScript(() => {
    window.wheelProbe = [];
    document.addEventListener('wheel', event => window.wheelProbe.push({
      target: event.target.id, trusted: event.isTrusted, x: event.clientX, y: event.clientY, delta: event.deltaY,
    }), { capture: true, passive: true });
  });
  const rail = desktop.locator('#rail');
  await openPencil(desktop, url, button => button.click(), async () => {
    const outcome = rail.locator('.ol-outcome[data-workspace-id=w1]');
    const disclosure = outcome.locator('.ol-disclosure');
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
    await outcome.locator('a[data-topic-id^="pencil-scroll-"]:visible').first().waitFor();
    observations.railPrepared = await rail.evaluate(el => ({
      height: el.clientHeight, scrollHeight: el.scrollHeight,
      visibleRows: [...el.querySelectorAll('a[data-topic-id]')].filter(row => row.getClientRects().length).length,
    }));
    await desktop.waitForFunction(() => {
      const rail = document.querySelector('#rail');
      return rail.scrollHeight - rail.clientHeight >= 100;
    });
    await rail.evaluate(el => { el.scrollTop = 0; });
  });
  const railBefore = await rail.evaluate(el => ({ top: el.scrollTop, room: el.scrollHeight - el.clientHeight }));
  assert.ok(railBefore.room >= 100, 'the real topic rail is scrollable');
  const before = await writing(desktop);
  assert.deepEqual(before, { open: true, modal: true, focused: true, text: draft, start: draft.length - 2, end: draft.length - 1, topic: 't1' });
  const railBox = await rail.boundingBox();
  await desktop.mouse.move(railBox.x + railBox.width / 2, railBox.y + 180);
  await desktop.mouse.wheel(0, 145);
  await desktop.mouse.wheel(0, 77);
  await desktop.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const firstMovement = await rail.evaluate(el => el.scrollTop);
  await desktop.mouse.wheel(0, -53);
  await desktop.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const secondMovement = await rail.evaluate(el => el.scrollTop);
  await desktop.mouse.move(1260, 120);
  await desktop.mouse.wheel(0, 90);
  await desktop.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const outsideRail = await rail.evaluate(el => el.scrollTop);
  observations.desktop = { railBefore, firstMovement, secondMovement, outsideRail, before, after: await writing(desktop),
    wheel: await desktop.evaluate(() => window.wheelProbe) };
  assert.deepEqual(observations.desktop.after, before, 'wheel preserves the modal, draft, focus and selection');
  assert.equal(outsideRail, secondMovement, 'wheel outside the rail leaves its scroll position');
  assert.ok(observations.desktop.wheel.length >= 3 && observations.desktop.wheel.every(event => event.trusted), 'native wheel events');
  const click = await rail.evaluate(el => {
    const railBox = el.getBoundingClientRect();
    const link = [...el.querySelectorAll('a[data-topic-id]')].find(link => {
      const box = link.getBoundingClientRect();
      return box.top > railBox.top && box.bottom < railBox.bottom;
    });
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await desktop.mouse.click(click.x, click.y);
  await desktop.locator('#new-message-sheet[open]').waitFor({ state: 'hidden' });
  observations.desktop.afterClick = await writing(desktop);
  assert.equal(observations.desktop.afterClick.topic, 't1', 'clicking the modal backdrop dismisses it without opening the topic');
  assert.equal(observations.desktop.afterClick.text, draft);
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  phone.setDefaultTimeout(6000);
  await openPencil(phone, url, button => button.tap());
  const beforePhone = await writing(phone);
  const bounds = await phone.locator('#new-message-sheet').boundingBox();
  if (engine === 'chromium') {
    await phone.mouse.move(12, 180);
    await phone.mouse.wheel(0, 145);
  }
  const afterPhone = await writing(phone);
  observations.phone = { bounds, before: beforePhone, after: afterPhone };
  assert.ok(bounds.width >= 390 && beforePhone.open && beforePhone.modal && beforePhone.focused, 'phone keeps its full-width modal');
  assert.deepEqual(afterPhone, beforePhone);
  await phone.locator('#new-message-close').tap();
  await phone.locator('#new-message-sheet[open]').waitFor({ state: 'hidden' });
  await phone.close();

  assert.ok(firstMovement > railBefore.top, 'native wheel scrolls the long desktop rail while the pencil is open');
  assert.ok(secondMovement < firstMovement, 'native wheel scrolls back while the pencil is open');
} finally {
  if (browser) await browser.close();
  fixture.stdin.end();
  const fixtureExit = await exit;
  await writeFile(process.argv[2], JSON.stringify({ engine, ...observations, fixtureExit, fixtureErrors: errors() }, null, 2) + '\n');
  assert.deepEqual(fixtureExit, { code: 0, signal: null }, errors());
}
