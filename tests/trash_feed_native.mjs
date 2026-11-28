import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureControl } from './fixture_control.mjs';

const output = process.argv[2];
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(fixture);
const report = { requests: [], pageErrors: [] };
let browser, page;
try {
  const { origin, actor, agent } = await control({ method: 'ready' });
  const topic = 'trash-feed-proof';
  await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Route planning' }] });
  let serial = 0;
  const commit = async envelope => {
    const result = await control({ ...envelope, operation_id: topic + '-' + ++serial });
    assert.equal(result.status, 'committed', JSON.stringify(result));
    return result.result;
  };
  const post = async (body, replyTo) => (await commit({ method: 'agent_message', sender: agent, topic_id: topic,
    source: 'topic', body, join: true, addressees: [actor], read: true,
    ...(replyTo ? { reply_to: replyTo, reply_without_quote: 'An independent fixture reply.' }
      : { divergence_reason: 'An independent fixture dossier.' }) })).message_id;
  const act = (message_id, kind, args) => commit({ method: 'stack_act', sender: actor, kind, message_id, args });
  const trash = (id, trashed) => act(id, 'stack.trash', { trashed });
  const star = id => act(id, 'message.star', { starred: true });
  const archive = async id => {
    const { seq } = await control({ method: 'agent_view', actor, name: 'source', args: { source_ref: { kind: 'message', id } } });
    await act(id, 'stack.aside', { through: seq });
  };

  // Dossiers of all three kinds lie outside the cold window. One trashed
  // dossier also has a recent reply whose promised root has not been loaded.
  const root = await post('First map draft');
  const early = await post('Notes on the first sketch', root);
  const discarded = await post('Old walking route');
  const olderArchive = await post('Volunteer notes');
  const newerArchive = await post('Trail route');
  await archive(discarded);
  await archive(olderArchive);
  await archive(newerArchive);
  await trash(root, true);
  await trash(discarded, true);
  for (let i = 0; i < 36; i++) await post('Field note ' + (i + 1));
  const recent = await post('One more detail on the first sketch', early);
  const kept = await post('Current route draft');
  report.ids = { root, early, recent, discarded, olderArchive, newerArchive, kept };

  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(9500);
  page.on('pageerror', error => report.pageErrors.push(error.stack));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/view') report.requests.push(request.postDataJSON());
  });
  const card = id => page.locator('#messages .message-card[data-id="' + id + '"]');
  const dossier = id => page.locator('#messages .reply-stack[data-stack="' + id + '"]');
  const shelf = page.locator('#things > .archive-shelf');
  const archived = id => shelf.locator('.shelf-dossier[data-id="' + id + '"]');
  const archiveOrder = ids => page.waitForFunction(expected => JSON.stringify(
    [...document.querySelectorAll('#things .shelf-dossier')].filter(row => row.getClientRects().length).map(row => row.dataset.id)
  ) === JSON.stringify(expected), ids);
  const foldedReadCount = () => report.requests.filter(request => request?.name === 'dossier_trash').length;

  await page.goto(origin + '/?topic=' + topic);
  await page.locator('body[data-ready=true]').waitFor();
  await card(kept).waitFor();
  await archiveOrder([newerArchive, olderArchive]);
  assert.equal(await card(root).count(), 0, 'the canonical root is outside the cold feed window');
  assert.equal(await card(recent).count(), 1, 'the cold feed already has a reply to its off-page root');
  assert.equal(await card(recent).isVisible(), false, 'cold feed hides replies to a trashed off-page root');
  assert.equal(await archived(discarded).count(), 0, 'Archived excludes a trashed root on its cold projection');
  assert.equal(foldedReadCount(), 0, 'folded Trash makes no initial read');
  assert.ok(!report.requests.some(request => request?.name === 'topic_messages' &&
    request.args?.message_ids?.includes(root)), 'cold feed does not fetch a hidden supplemental root');
  await page.screenshot({ path: join(output, '01-cold-feed-and-archive.png') });

  // Change an archive outside the admitted working set. The existing live
  // refresh must remove it and put it back in the same saved order.
  await trash(newerArchive, true);
  await archiveOrder([olderArchive]);
  assert.equal(await card(newerArchive).count(), 0);
  await trash(newerArchive, false);
  await archiveOrder([newerArchive, olderArchive]);

  // Restore the off-page root on another device. Only its reply is known to
  // this feed window, so positions must repaint even if no loaded act changed.
  await trash(root, false);
  await dossier(root).waitFor();
  await trash(root, true);
  await dossier(root).waitFor({ state: 'hidden' });
  assert.equal(await card(recent).isVisible(), false);

  await page.mouse.move(640, 250);
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(() => scrollY > 0);
  await page.mouse.wheel(0, -3000);
  await card(early).waitFor({ state: 'attached' });
  assert.equal(await card(root).isVisible(), false);
  assert.equal(await card(early).isVisible(), false);
  assert.equal(await card(recent).isVisible(), false);
  assert.ok(report.requests.some(request => request?.name === 'topic_messages' && request.args?.direction === 'before'
    && Number.isSafeInteger(request.args.cursor)), 'the older page followed the ordinary frontier');
  assert.equal(foldedReadCount(), 0, 'paging does not read the Trash fold');

  await star(early);
  const disclosure = page.getByRole('button', { name: 'Open topics in Isolated wiring', exact: true });
  if (await disclosure.isVisible()) await disclosure.click();
  const starred = page.locator('#outline .ol-dossier[data-dossier-id="' + root + '"]');
  await starred.waitFor();
  await starred.click();
  await page.locator('#reader[open] #source-body').getByText('First map draft', { exact: true }).waitFor();
  assert.equal(await card(root).isVisible(), false);
  assert.equal(await card(early).isVisible(), false);
  assert.equal(await card(recent).isVisible(), false);
  await page.locator('#reader-close').click();
  await page.screenshot({ path: join(output, '02-starred-and-still-hidden.png') });

  await trash(root, false);
  await dossier(root).waitFor();
  assert.equal(await starred.count(), 1, 'restore preserves the star');
  await archiveOrder([newerArchive, olderArchive]);
  await star(discarded);
  assert.equal(await card(discarded).isVisible(), false, 'starring an archived Trash root does not return it');
  await archiveOrder([newerArchive, olderArchive]);
  await trash(discarded, false);
  await archiveOrder([discarded, newerArchive, olderArchive]);
  assert.equal(await dossier(discarded).isVisible(), false, 'a starred restore keeps its saved Archive placement');
  assert.equal(foldedReadCount(), 0, 'live acts and starred landing leave folded Trash unread');
  await page.close();

  // Replay the pre-Trash Archive response and omit the initial feed's Trash
  // fields. Later reads get the real, already-committed state from Core.
  const coldReply = await post('A detail on the current route', kept);
  const staleArchive = await control({ method: 'agent_view', actor, name: 'dossier_archive', args: { topic_id: topic, limit: 24 } });
  assert.ok(staleArchive.items.some(item => item.message_id === discarded));
  await trash(kept, true);
  await trash(discarded, true);

  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(9500);
  page.on('pageerror', error => report.pageErrors.push(error.stack));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/view') report.requests.push(request.postDataJSON());
  });
  let omittedInitialState = false, replayedArchive = false;
  const withoutTrash = record => {
    delete record.trashed;
    delete record.trash_revision;
  };
  await page.route('**/api/view', async route => {
    const { name, args } = route.request().postDataJSON();
    if (args.topic_id !== topic) return route.continue();
    if (name === 'topic_messages' && args.direction === 'before' && args.cursor === undefined && args.audience === 'all' && !omittedInitialState) {
      omittedInitialState = true;
      const response = await route.fetch(), json = await response.json();
      assert.equal(json.positions[kept]?.trashed, true);
      withoutTrash(json.positions[kept]);
      withoutTrash(json.items.find(item => item.id === kept).acts);
      return route.fulfill({ response, json });
    }
    if (name === 'dossier_archive' && !replayedArchive) {
      replayedArchive = true;
      return route.fulfill({ json: staleArchive });
    }
    return route.continue();
  });
  await page.goto(origin + '/?topic=' + topic);
  await page.locator('body[data-ready=true]').waitFor();
  await card(kept).waitFor();
  await page.locator('#things .shelf-dossier[data-id="' + discarded + '"]').waitFor();
  assert.equal(await card(coldReply).count(), 1);
  assert.equal(await card(coldReply).isVisible(), true);
  assert.ok(omittedInitialState && replayedArchive, 'both first snapshots were stale about Trash');
  report.coldConvergence = { before: { rootVisible: true, replyVisible: true, archiveVisible: true } };
  // An ordinary actor signal asks for the current positions. Trash itself
  // has already happened and stays unchanged throughout this convergence.
  const from = report.requests.length;
  await act(olderArchive, 'message.fold', { folded: true });
  await card(kept).waitFor({ state: 'hidden' });
  await card(coldReply).waitFor({ state: 'hidden' });
  await archiveOrder([newerArchive, olderArchive]);
  assert.ok(report.requests.slice(from).some(request => request?.name === 'stack_positions'
    && request.args?.message_ids?.includes(coldReply)));
  assert.equal(foldedReadCount(), 0, 'the cold page converges through positions and Archive, with Trash folded');
  report.coldConvergence.after = { rootVisible: false, replyVisible: false, archiveVisible: false, foldedTrashReads: 0 };
  assert.deepEqual(report.pageErrors, []);
  console.log('Cold and paged feed, off-page Archive updates, starred access, restores, cold convergence and folded read bound passed.');
} catch (error) {
  report.error = error.stack;
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
