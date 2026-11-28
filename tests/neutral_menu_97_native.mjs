import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureControl } from './fixture_control.mjs';

const [output, ...selected] = process.argv.slice(2);
assert.ok(output);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(fixture);
const report = [];
let browser;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'neutral-menu-proof';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Field guide' }] });
  let serial = 0;
  const commit = async request => {
    const receipt = await control({ ...request, operation_id: 'menu-highlight-97-' + ++serial });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return receipt.result;
  };
  const post = async (body, parent = null) => (await commit({ method: 'agent_message', source: 'topic',
    sender: actor, topic_id: topic, body, read: true, ...(parent ? { reply_to: parent, reply_without_quote: 'Independent fixture reply.' }
      : { divergence_reason: 'Independent fixture dossier.' }) })).message_id;
  const dossier = await post('Map sketch');
  await post('A note on the sketch', dossier);
  const reading = await post('Route summary');
  await commit({ method: 'agent_message', sender: agent, topic_id: topic, source: 'topic', join: true,
    body: 'Notebook contributor', divergence_reason: 'Admit the isolated Notebook author.' });
  await commit({ method: 'agent_page', item_id: 'menu-proof-note', title: 'Trail notebook', body: 'An isolated page.',
    owner_scope: { kind: 'topic', id: topic } });
  const archived = await post('Trail route');
  const { seq } = await control({ method: 'agent_view', actor, name: 'source', args: { source_ref: { kind: 'message', id: archived } } });
  await commit({ method: 'stack_act', sender: actor, kind: 'stack.aside', message_id: archived, args: { through: seq } });
  const trashed = await post('Old field notes');
  await commit({ method: 'stack_act', sender: actor, kind: 'stack.trash', message_id: trashed, args: { trashed: true } });
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });

  for (const width of [1280, 390]) for (const look of ['bookends', 'paper']) for (const scheme of ['light', 'dark']) {
    const phone = width === 390, key = width + '-' + look + '-' + scheme;
    if (selected.length && !selected.includes(key)) continue;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme,
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(8500);
    const run = { key, styles: [], pageErrors: [] };
    report.push(run);
    page.on('pageerror', error => run.pageErrors.push(error.message));
    try {
      await context.addInitScript(look => localStorage.setItem('theseus-look', look), look);
      await page.goto(origin + '/?topic=' + topic);
      await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
      assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), scheme === 'dark');
      const style = (locator, label) => locator.evaluate((node, label) => {
        const css = getComputedStyle(node), probe = document.createElement('span');
        const resolve = token => {
          probe.style.color = css.getPropertyValue(token).trim();
          return getComputedStyle(probe).color;
        };
        probe.hidden = true;
        document.body.append(probe);
        const result = { label, fill: css.backgroundColor, ink: css.color, outline: css.outlineColor,
          outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle, current: resolve('--row-current'),
          expectedInk: resolve('--ink'), focus: resolve('--focus'),
          focused: document.activeElement === node, focusVisible: node.matches(':focus-visible') };
        probe.remove();
        return result;
      }, label);
      const pressed = async (trigger, label) => {
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        const state = await style(trigger, label);
        run.styles.push(state);
        assert.equal(state.fill, state.current, label + ' pressed fill');
        assert.equal(state.ink, state.expectedInk, label + ' pressed ink');
      };
      const row = async (label, surface) => {
        const menu = page.getByRole('menu', { name: surface, exact: true });
        const button = label ? menu.getByRole('menuitem', { name: label, exact: true }) : menu.locator('button:focus');
        await button.waitFor();
        assert.equal(await menu.evaluate(node => node.classList.contains('menu-sheet')), phone);
        const state = await style(button, surface + ' / ' + (label ?? 'focused row'));
        run.styles.push(state);
        assert.ok(state.focused, state.label + ' receives menu focus');
        if (phone) {
          assert.equal(state.fill, state.current, state.label + ' phone fill');
          assert.equal(state.ink, state.expectedInk, state.label + ' phone ink');
        } else {
          assert.ok(state.focusVisible);
          assert.equal(state.fill, 'rgba(0, 0, 0, 0)', state.label + ' desktop focus fill');
          assert.equal(state.outline, state.focus);
          assert.equal(state.outlineWidth, '2px');
          assert.equal(state.outlineStyle, 'solid');
          await button.hover();
          const hovered = await style(button, state.label + ' with the pointer over the keyboard focus');
          run.styles.push(hovered);
          assert.equal(hovered.fill, 'rgba(0, 0, 0, 0)');
          assert.equal(hovered.outline, hovered.focus);
        }
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
      };

      const stack = page.locator('#messages .reply-stack[data-stack="' + dossier + '"]');
      const trigger = stack.locator('[data-tool=menu]');
      if (phone) { await stack.locator('.stack-who').first().tap(); await trigger.tap(); }
      else { await trigger.focus(); await page.keyboard.press('Enter'); }
      await row('Copy text', 'This message');
      if (phone) { await stack.locator('.stack-who').first().tap(); await trigger.tap(); }
      else { await trigger.focus(); await page.keyboard.press('Enter'); }
      await pressed(trigger, 'Dossier ellipsis');
      await page.keyboard.press('Escape');
      const topicTrigger = page.locator('#topic-menu');
      await (phone ? topicTrigger.tap() : topicTrigger.click());
      await page.getByRole('menu', { name: 'This topic', exact: true }).waitFor();
      await pressed(topicTrigger, 'Topic ellipsis');
      await page.keyboard.press('Escape');

      await page.goto(origin + '/?topic=' + topic + '&message=' + reading);
      await page.locator('#reader[open] #source-body').getByText('Route summary', { exact: true }).waitFor();
      const readerTrigger = page.locator('#reader-menu');
      await (phone ? readerTrigger.tap() : readerTrigger.click());
      await page.locator('#reader .message-menu-list').waitFor();
      await pressed(readerTrigger, 'Reader ellipsis');
      await page.keyboard.press('Escape');
      await (phone ? page.locator('#reader-close').tap() : page.locator('#reader-close').click());

      if (phone) await page.locator('#things-open').tap();
      const replica = page.locator('#things .shelf-dossier[data-id="' + archived + '"]');
      await replica.waitFor();
      if (phone) {
        const more = replica.locator('..').locator('.shelf-menu');
        await more.tap();
        await pressed(more, 'Archived ellipsis');
      } else { await replica.focus(); await page.keyboard.press('Shift+F10'); }
      await row('Bring back', 'Archived dossier');

      const summary = page.locator('#things .archive-trash>summary');
      await (phone ? summary.tap() : summary.click());
      const trash = page.locator('#things .archive-trash li[data-id="' + trashed + '"] .archive-trash-action');
      if (phone) { await trash.tap(); await pressed(trash, 'Trash ellipsis'); }
      else { await trash.focus(); await page.keyboard.press('Shift+F10'); }
      await row('Move out of trash', 'Trashed dossier');
      const tile = page.locator('#things a[data-page-id="menu-proof-note"]');
      await tile.focus();
      await page.keyboard.press('Shift+F10');
      await page.locator('.notebook-surface').waitFor();
      await row(null, 'This page');
      assert.deepEqual(run.pageErrors, []);
      console.log('PASS', key);
    } catch (error) {
      run.error = error.stack;
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
