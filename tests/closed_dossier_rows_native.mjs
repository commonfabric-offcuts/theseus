import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';

const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const [evidence, mode] = process.argv.slice(2);
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(fixture);
let browser;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  for (const width of [1280, 390]) {
    const topic = `closed-rows-${width}`;
    const unread = new Set([20, 23, 26, 29]);
    await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Closed dossier rows' }] });
    const ids = [];
    async function message(n, sender, parent) {
      const receipt = await control({ method: 'agent_message', operation_id: `${topic}-message-${n}`,
        topic_id: topic, sender, join: n === 20, body: n ? `Reply ${n}` : 'Dossier opening',
        ...(sender === agent ? { addressees: [actor] } : {}),
        ...(parent ? { reply_to: parent, reply_without_quote: 'A reply for the disclosure control.' } :
          { source: 'topic', divergence_reason: 'An independent disclosure control.' }) });
      assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
      return receipt.result.message_id;
    }
    ids.push(await message(0, actor));
    for (let n = 1; n <= 31; n++) {
      const fresh = unread.has(n);
      ids.push(await message(n, fresh ? agent : actor, ids[fresh ? n - 1 : 0]));
    }
    for (const n of [...unread, 31]) {
      const receipt = await control({ method: 'stack_act', sender: actor, kind: 'message.fold', message_id: ids[n],
        args: { folded: true }, operation_id: `${topic}-fold-${n}` });
      assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    }

    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390 });
    try {
      // Admit the full 32-message fixture in the first real Core read, so
      // this comparison excludes supplemental-root and paging behavior.
      await context.route('**/api/view', route => {
        const view = route.request().postDataJSON();
        if (view?.name !== 'topic_messages' || view.args.direction !== 'before' || view.args.cursor != null) return route.continue();
        return route.continue({ postData: JSON.stringify({ ...view, args: { ...view.args, limit: 50 } }) });
      });
      // Keep the four test messages unread while observing actual layout.
      await context.route('**/api/command', route => route.request().postDataJSON()?.kind === 'topic.read_through'
        ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/?topic=${topic}`);
      await page.locator('body[data-ready=true]').waitFor();
      const section = page.locator(`#messages .reply-stack[data-stack="${ids[0]}"]`);
      const toggle = section.locator('.stack-toggle');
      const disclosure = section.locator('.stack-unread-disclosure');
      const rows = () => section.locator('.stack-replies > [data-id]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.id));
      const matchRows = async expected => {
        await page.waitForFunction(({ root, expected }) => {
          const section = document.querySelector(`#messages .reply-stack[data-stack="${root}"]`);
          if (!section) return false;
          const actual = [...section.querySelectorAll('.stack-replies > [data-id]')].filter(node => node.getClientRects().length)
            .map(node => node.dataset.id);
          return JSON.stringify(actual) === JSON.stringify(expected);
        }, { root: ids[0], expected }, { timeout: 7500 });
      };
      if (await toggle.getAttribute('data-state') === 'open') await toggle.click();
      assert.equal(await toggle.getAttribute('data-state'), 'folded');
      // Allow the first paint to restore the canonical root and page its one
      // older reply. Measure the explicit re-collapse once that work settles.
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      await toggle.click();
      assert.equal(await toggle.getAttribute('data-state'), 'open');
      await toggle.click();
      assert.equal(await toggle.getAttribute('data-state'), 'folded');
      const previous = [19, 20, 22, 23, 25, 26, 28, 29, 31].map(n => ids[n]);
      if (mode === 'baseline') {
        try { await matchRows(previous); } catch (error) {
          console.error({ width, expected: previous.map(id => ids.indexOf(id)), actual: (await rows()).map(id => ids.indexOf(id)) });
          throw error;
        }
        assert.equal(await disclosure.count(), 0);
      } else {
        await matchRows([ids[31]]);
        assert.equal(await disclosure.textContent(), '4 new');
        assert.equal(await section.locator('.stack-new-action').count(), 0);
        await disclosure.click();
        await matchRows(previous);
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
        await disclosure.click();
        await matchRows([ids[31]]);
        ids.push(await message(32, agent, ids[0]));
        await matchRows([ids[32]]);
        assert.equal(await disclosure.textContent(), '5 new');
        await page.reload();
        await page.locator('body[data-ready=true]').waitFor();
        try { await matchRows([ids[32]]); } catch (error) {
          console.error(await page.locator('#messages .reply-stack').evaluateAll(nodes => nodes.map(node => ({
            id: node.dataset.stack, level: node.dataset.fold, name: node.querySelector('.stack-name')?.textContent,
            rows: [...node.querySelectorAll('.stack-replies > [data-id]:not([hidden])')].map(row => row.textContent.slice(0, 50)),
          }))));
          throw error;
        }
        assert.equal(await disclosure.textContent(), '5 new');
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, mode, visibleReplyRows: (await rows()).length, disclosure: await disclosure.count() }));
      await page.screenshot({ path: `${evidence}/${width}.png` });
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
}
