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
const report = { previews: [], runs: [] };
let browser;
try {
  const { origin, actor } = await control({ method: 'ready' });
  const cases = [1280, 390].flatMap(width => ['bookends', 'paper'].flatMap(look => ['light', 'dark'].map(scheme => ({
    width, look, scheme, key: width + '-' + look + '-' + scheme,
  })))).filter(test => !selected.length || selected.includes(test.key));
  await control({ method: 'navigation_topics', topics: cases.map(({ key }) => ({ id: 'trash-menu-' + key, title: 'Field guide' })) });
  let serial = 0;
  const commit = async request => {
    const receipt = await control({ ...request, operation_id: 'trash-menu-81-' + ++serial });
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
    return receipt.result;
  };
  const post = async (topic_id, body, parent = null) => (await commit({ method: 'agent_message', source: 'topic',
    sender: actor, topic_id, body, read: true, ...(parent ? { reply_to: parent, reply_without_quote: 'Independent fixture reply.' }
      : { divergence_reason: 'Independent fixture dossier.' }) })).message_id;
  const act = (message_id, kind, args) => commit({ method: 'stack_act', sender: actor, message_id, kind, args });
  const view = (name, args) => control({ method: 'agent_view', actor, name, args });
  const position = async (topic_id, id) => (await view('stack_positions', { topic_id, message_ids: [id] })).items[0].stack_position;
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });

  for (const { width, look, scheme, key } of cases) {
    const phone = width === 390, topic = 'trash-menu-' + key;
    const archived = await post(topic, 'Trail route');
    const original = (await view('source', { source_ref: { kind: 'message', id: archived } })).seq;
    await act(archived, 'stack.aside', { through: original });
    // This makes the first wide Archive menu act from a projected replica.
    const offPage = key === '1280-bookends-light';
    if (offPage) {
      await act(archived, 'stack.trash', { trashed: true });
      await act(archived, 'stack.trash', { trashed: false });
      for (let i = 0; i < 32; i++) await post(topic, 'Field note ' + (i + 1));
    }
    const active = await post(topic, 'Map sketch');
    const reply = await post(topic, 'A note about the map sketch', active);
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme,
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(9000);
    const run = { key, commands: [], reads: [], errors: [] };
    report.runs.push(run);
    try {
      await context.addInitScript(look => localStorage.setItem('theseus-look', look), look);
      page.on('pageerror', error => run.errors.push(error.stack));
      page.on('request', request => {
        const path = new URL(request.url()).pathname, sent = request.postDataJSON();
        if (path === '/api/command' && ['stack.trash', 'message.star'].includes(sent?.kind)) run.commands.push({ kind: sent.kind, target: sent.target, args: sent.args, revision: sent.expected?.trash_revision ?? sent.expected?.star_revision });
        if (path === '/api/view' && ['dossier_archive', 'dossier_trash', 'topic_messages'].includes(sent?.name)) run.reads.push(sent);
      });
      await page.goto(origin + '/?topic=' + topic);
      await page.locator('body[data-ready=true]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-look'), look === 'paper' ? 'paper' : null);
      assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), scheme === 'dark');
      const dossier = page.locator('#messages .reply-stack[data-stack="' + active + '"]');
      const card = page.locator('#messages .message-card[data-id="' + active + '"]');
      const archivedReplica = page.locator('#things .shelf-dossier[data-id="' + archived + '"]');
      const summary = page.locator('#things .archive-trash > summary');
      const trashed = id => page.locator('#things .archive-trash li[data-id="' + id + '"] .archive-trash-action');
      const menu = page.getByRole('menu');
      const choice = label => menu.getByRole('menuitem', { name: label, exact: true });
      const screen = async () => {
        await page.waitForFunction(() => ![...document.querySelectorAll('#things .archive-shelf-notice')]
          .some(node => node.textContent.startsWith('Loading') && node.getClientRects().length));
        return (await page.screenshot({ animations: 'disabled' })).toString('base64');
      };
      const shot = [];
      const choose = async label => {
        const kind = label === 'Star' || label === 'Unstar' ? 'message.star' : 'stack.trash';
        const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
          response.request().postDataJSON()?.kind === kind, { timeout: 12000 });
        const activate = async () => {
          if (phone) return choice(label).tap();
          if (look !== 'paper') return choice(label).click();
          await choice(label).focus();
          return page.keyboard.press('Enter');
        };
        const [response] = await Promise.all([answered, activate()]);
        const receipt = await response.json();
        assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
      };
      const menuSheet = async () => assert.equal(await menu.evaluate(node => node.classList.contains('menu-sheet')), phone);

      await dossier.waitFor();
      if (phone) {
        await dossier.locator('.stack-who').first().tap();
        await dossier.locator('[data-tool=menu]').tap();
      }
      else if (look === 'paper') { await card.focus(); await page.keyboard.press('Shift+F10'); }
      else await card.click({ button: 'right', position: { x: 30, y: 17 } });
      await choice('Move to trash').waitFor();
      await menuSheet();
      shot.push(['Dossier menu', await screen()]);
      await choose('Move to trash');
      await dossier.waitFor({ state: 'hidden' });
      assert.equal(run.reads.filter(read => read.name === 'dossier_trash').length, 0);
      assert.equal(run.commands[0].revision, 0);
      assert.equal(run.commands[0].target.message_id, active, 'the dossier action names its canonical root');
      assert.equal((await position(topic, reply)).trashed, true);
      if (!phone && look === 'paper') {
        const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
          response.request().postDataJSON()?.kind === 'stack.trash');
        await page.keyboard.press('Meta+z');
        const receipt = await (await answered).json();
        assert.equal(receipt.status, 'committed', 'Undo works immediately after the keyboard move');
        await dossier.waitFor();
        assert.equal((await position(topic, reply)).trashed, false);
        await card.focus();
        await page.keyboard.press('Shift+F10');
        await choose('Move to trash');
        await dossier.waitFor({ state: 'hidden' });
      }

      const archiveCommand = run.commands.length;
      if (phone) await page.locator('#things-open').tap();
      await archivedReplica.waitFor();
      if (offPage) assert.equal(await page.locator('#messages .message-card[data-id="' + archived + '"]').count(), 0);
      if (phone) await archivedReplica.locator('..').locator('.shelf-menu').tap();
      else if (look === 'paper') { await archivedReplica.focus(); await page.keyboard.press('Shift+F10'); }
      else await archivedReplica.click({ button: 'right' });
      await menu.getByRole('menuitem', { name: 'Bring back', exact: true }).waitFor();
      await choice('Move to trash').waitFor();
      await menuSheet();
      shot.push(['Archived menu', await screen()]);
      await choose('Move to trash');
      await archivedReplica.waitFor({ state: 'hidden' });
      assert.equal(run.commands[archiveCommand].target.message_id, archived);
      assert.equal(run.commands[archiveCommand].revision, offPage ? 2 : 0);
      if (offPage) assert.ok(run.reads.some(read => read.name === 'topic_messages' && read.args?.message_ids?.length === 1
        && read.args.message_ids[0] === archived));
      assert.equal((await position(topic, archived)).through, original);
      if (!phone && look === 'paper') {
        const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
          response.request().postDataJSON()?.kind === 'stack.trash');
        await page.keyboard.press('Meta+z');
        const receipt = await (await answered).json();
        assert.equal(receipt.status, 'committed', 'Undo works immediately after a keyboard move from Archived');
        await archivedReplica.waitFor();
        await archivedReplica.focus();
        await page.keyboard.press('Shift+F10');
        await choose('Move to trash');
        await archivedReplica.waitFor({ state: 'hidden' });
      }
      assert.equal(run.reads.filter(read => read.name === 'dossier_trash').length, 0, 'archiving and trashing with a folded list do not fetch it');

      if (phone) await summary.tap(); else await summary.click();
      const activeRow = trashed(active);
      await activeRow.waitFor();
      if (phone) await activeRow.tap();
      else if (look === 'paper') { await activeRow.focus(); await page.keyboard.press('Shift+F10'); }
      else await activeRow.click({ button: 'right' });
      await choice('Move out of trash').waitFor();
      await choice('Star').waitFor();
      await menuSheet();
      if (phone) assert.ok((await activeRow.boundingBox()).height >= 44);
      shot.push(['Trash menu · unstarred', await screen()]);
      await choose('Star');
      // The current menu shows the result from Core, and the row stays in Trash.
      const starredPosition = await position(topic, active);
      assert.deepEqual(starredPosition.starred, [active]);
      assert.equal(starredPosition.trashed, true);
      if (phone) await activeRow.tap(); else { await activeRow.focus(); await page.keyboard.press('Shift+F10'); }
      await choice('Unstar').waitFor();
      shot.push(['Trash menu · starred', await screen()]);
      await choose('Unstar');
      assert.deepEqual((await position(topic, active)).starred, []);
      assert.equal(await dossier.isVisible(), false, 'starring or unstarring a trashed root never reveals it');

      const archivedRow = trashed(archived);
      if (phone) await archivedRow.tap(); else await archivedRow.click();
      await choose('Move out of trash');
      await archivedRow.waitFor({ state: 'hidden' });
      await archivedReplica.waitFor();
      assert.equal((await position(topic, archived)).through, original, 'restore keeps the dossier in its saved Archive place');
      if (!phone) {
        await summary.focus();
        await page.keyboard.press('Meta+z');
        await archivedRow.waitFor();
        await archivedReplica.waitFor({ state: 'hidden' });
        assert.equal((await position(topic, archived)).trashed, true, 'Undo puts a restored dossier back in Trash');
      }
      if (offPage) {
        await archivedRow.click();
        await choose('Move out of trash');
        await archivedReplica.waitFor();
        const restored = await position(topic, archived);
        await act(archived, 'stack.trash', { trashed: true });
        await act(archived, 'stack.trash', { trashed: false });
        const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' &&
          response.request().postDataJSON()?.kind === 'stack.trash');
        await summary.focus();
        await page.keyboard.press('Meta+z');
        const refused = await (await answered).json();
        assert.equal(refused.error?.code, 'REVISION_CONFLICT');
        assert.equal(run.commands.at(-1).revision, restored.trash_revision);
        assert.equal((await position(topic, archived)).trashed, false, 'a stale Undo leaves the newer restore intact');
      }
      if (phone) await activeRow.tap(); else await activeRow.click();
      await choose('Move out of trash');
      await activeRow.waitFor({ state: 'hidden' });
      if (phone) await page.locator('#things-close').tap();
      await dossier.waitFor();
      assert.equal((await position(topic, reply)).trashed, false);
      assert.deepEqual(run.errors, []);

      const comparison = await context.newPage();
      await comparison.setViewportSize({ width: width * 2 + 30, height: 940 });
      await comparison.setContent('<style>html,body{margin:0;background:#e5e7eb;color:#18212b;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,max-content);gap:10px;padding:10px;width:max-content}figure{margin:0}figcaption{padding:6px 0;font-weight:650}img{display:block}</style><main>' + shot.map(([title, image]) =>
        '<figure><figcaption>' + title + '</figcaption><img src="data:image/png;base64,' + image + '"></figure>').join('') + '</main>');
      const preview = 'menu-' + key + '.png';
      await comparison.locator('main').screenshot({ path: join(output, preview) });
      report.previews.push(preview);
      console.log('PASS', key);
    } catch (error) {
      run.failure = error.stack;
      await page.screenshot({ path: join(output, key + '-failure.png') }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
