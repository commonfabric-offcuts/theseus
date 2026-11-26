import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixtureControl } from './fixture_control.mjs';

const { webkit } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const processFixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live', '--agent-colors']);
const { control, exit } = fixtureControl(processFixture);
let browser;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  browser = await webkit.launch();
  for (const width of [1280, 390]) {
    const topic = `thumb-menu-count-${width}`, phone = width < 761;
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Thumb menu count' }] });
    const receipt = await control({ method: 'agent_message', operation_id: `${topic}-source`, topic_id: topic,
      sender: agent, join: true, source: 'topic', divergence_reason: 'An independent menu control.',
      addressees: [actor], body: 'A message for the thumb menu.' });
    assert.equal(receipt.status, 'committed');
    const id = receipt.result.message_id;
    await control({ method: 'agent_message', operation_id: `${topic}-join-other`, topic_id: topic,
      sender: 'aim-ux', join: true, source: 'topic', divergence_reason: 'A separate reader joins.',
      body: 'Independent second reader.' });
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: phone, hasTouch: phone });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(`${origin}/?topic=${topic}`);
      await page.locator('body[data-ready=true]').waitFor();
      const card = page.locator(`.message-card[data-id="${id}"]`);
      if (phone) await card.locator('.message-preview').tap(); else await card.hover();
      const thumb = page.locator('.message-bar:not([hidden]) button[data-act="thumb"]');
      await thumb.waitFor();
      const has = async (text, pressed) => {
        await thumb.filter({ hasText: new RegExp(`^${text}$`) }).waitFor();
        assert.equal(await thumb.getAttribute('aria-pressed'), String(pressed));
      };
      const press = () => phone ? thumb.tap() : thumb.click();
      await has('👍', false);
      await press();
      await has('👍 1', true);
      await control({ method: 'agent_thumb', sender: 'aim-ux', message_id: id, operation_id: `${topic}-other` });
      await has('👍 2', true);
      await press();
      await has('👍 1', false);
      await control({ method: 'agent_thumb', sender: 'aim-ux', message_id: id, thumbed: false, operation_id: `${topic}-other-off` });
      await has('👍', false);
      console.log(JSON.stringify({ width, states: ['👍', '👍 1 pressed', '👍 2 pressed', '👍 1 unpressed', '👍'] }));
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  processFixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}
