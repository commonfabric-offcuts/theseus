// Real reply arrival and native unfold in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.env.AIM_955_BASELINE === '1';
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
const results = [], cleanup = {}, owned = new Set(); let browser, profile, origin, failure;
function retainChildren() {
  const list = ps(); for (let changed = true; changed;) { changed = false;
    for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
}
const snapshot = (page, id) => page.evaluate(id => {
  const card = document.querySelector(`.message-card[data-id="${id}"]`), entry = document.querySelector(`.message-fold[data-id="${id}"]`);
  const line = card?.querySelector(':scope > .message-folded') ?? entry?.querySelector(':scope > .fold-line'), shown = node => Boolean(node?.getBoundingClientRect().height);
  return { cardShown: shown(card), lineShown: shown(line), lineText: line?.textContent, lineExpanded: line?.getAttribute('aria-expanded'),
    folded: card?.dataset.folded === 'true', bodyShown: shown(card?.querySelector(':scope > .message-preview')),
    cardClass: card?.className, entryClass: entry?.className, text: card?.textContent };
}, id);
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const committed = value => { assert.equal(value.status, 'committed', JSON.stringify(value.error)); return value.result; };
  const view = async (id) => {
    const answer = await control({ method: 'agent_view', actor: facts.actor, name: 'topic_messages', args: { topic_id: 't1', direction: 'before', limit: 100 } });
    const item = answer.items.find(item => item.id === id); assert.ok(item, 'the actual message remains readable'); return item;
  };
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren(); assert.ok(owned.size);
  for (const mode of baseline ? ['plain'] : ['plain', 'star', 'note'])
    for (const width of baseline ? [1280] : [1280, 390]) for (const colorScheme of baseline ? ['light'] : ['light', 'dark']) {
      const key = `${engine}-${mode}-${width}-${colorScheme}`;
      const parent = committed(await control({ method: 'agent_message', operation_id: `${key}-parent`, sender: 'person', whole_topic: true,
        body: `My ${key} question for the agent.`, post_args: { addressees: [facts.agent], intent: 'tell' } })).message_id;
      if (mode === 'star') committed(await control({ method: 'stack_act', operation_id: `${key}-star`, kind: 'message.star',
        sender: facts.actor, message_id: parent, args: { starred: true } }));
      if (mode === 'note') committed(await control({ method: 'private_writing', operation_id: `${key}-note`, kind: 'note',
        sender: 'person', message_id: parent, body: 'A private955 note that keeps this message open.' }));
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390,
        isMobile: width === 390, colorScheme });
      const page = await context.newPage(), pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      let error, answer, before, after, opened, unfolded, afterReload;
      try {
        await page.goto(`${origin}/?topic=t1`); await page.locator('body[data-ready=true]').waitFor();
        const card = page.locator(`.message-card[data-id="${parent}"]`);
        await card.waitFor({ state: 'visible' }); before = await snapshot(page, parent);
        assert.equal(before.cardShown, true, 'no agent answer: the person’s message stays open'); assert.equal(before.bodyShown, true);
        const reply = async suffix => committed(await control({ method: 'agent_message', operation_id: `${key}-${suffix}`, sender: facts.agent, join: true,
          reply_to: parent, addressees: [facts.actor], body: `The ${key} answer ${suffix}.`,
          reply_without_quote: 'The isolated955 check answers the whole question.' })).message_id;
        answer = await reply('answer');
        await page.locator(`.message-card[data-id="${answer}"]`).waitFor({ state: 'visible' });
        if (mode === 'plain') {
          await page.waitForFunction(id => {
            const card = document.querySelector(`.message-card[data-id="${id}"]`);
            const line = card?.querySelector(':scope > .message-folded'), body = card?.querySelector(':scope > .message-preview');
            return card?.dataset.folded === 'true' && !body?.getBoundingClientRect().height && Boolean(line?.getBoundingClientRect().height);
          }, parent, { timeout: 5000 });
          after = await snapshot(page, parent); const folded = await view(parent);
          assert.equal(folded.acts.folded, true); assert.equal(folded.acts.fold_revision, 1);
          // Opening the dossier and unfolding its message are separate acts.
          // Touch has no preceding hover that opens the compact head.
          const stack = page.locator(`.reply-stack[data-stack="${parent}"]`);
          if (await stack.getAttribute('data-fold') !== 'open') {
            const toggle = stack.locator(':scope > .stack-toggle');
            if (width === 390) await toggle.tap(); else await toggle.click();
            await page.waitForFunction(id => document.querySelector(`.reply-stack[data-stack="${id}"]`)?.dataset.fold === 'open', parent);
          }
          opened = await snapshot(page, parent); assert.equal(opened.folded, true);
          assert.equal((await view(parent)).acts.fold_revision, 1, 'opening the dossier does not change the personal fold');
          const receipt = page.waitForResponse(response => response.url().endsWith('/api/command') && response.request().postDataJSON()?.kind === 'message.fold', { timeout: 5000 });
          const line = card.locator(':scope > .message-folded');
          // Tap the row's leading words, clear of the bar which focus shows.
          if (width === 390) await line.tap({ position: { x: 8, y: (await line.boundingBox()).height / 2 } }); else await line.click();
          assert.equal((await (await receipt).json()).status, 'committed');
          await card.waitFor({ state: 'visible' });
          const another = await reply('again'); await page.locator(`.message-card[data-id="${another}"]`).waitFor({ state: 'visible' });
          unfolded = await snapshot(page, parent); assert.equal(unfolded.cardShown, true); assert.equal(unfolded.folded, false); assert.equal(unfolded.bodyShown, true);
          const manual = await view(parent); assert.equal(manual.acts.folded, false); assert.equal(manual.acts.fold_revision, 2);
        } else {
          after = await snapshot(page, parent); assert.equal(after.cardShown, true); assert.equal(after.folded, false); assert.equal(after.bodyShown, true);
          assert.equal((await view(parent)).acts.folded, false, 'star/note blocks the Core automatic fold');
        }
        await page.reload(); await page.locator('body[data-ready=true]').waitFor(); await card.waitFor({ state: 'visible' });
        afterReload = await snapshot(page, parent); assert.equal(afterReload.cardShown, true); assert.equal(afterReload.folded, false); assert.equal(afterReload.bodyShown, true);
        assert.deepEqual(pageErrors, []);
      } catch (caught) { error = caught.stack; after ??= await snapshot(page, parent).catch(() => null); }
      results.push({ key, parent, answer, before, after, opened, unfolded, afterReload, core: await view(parent), pageErrors, error: error ?? null });
      if (error || width === 1280 && colorScheme === 'light') await page.screenshot({ path: `${evidence}/${key}.png` });
      await context.close(); await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2));
    }
} catch (caught) { failure = caught; }
finally {
  if (browser) { retainChildren(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(p => owned.has(p.pid));
  cleanup.profileProcesses = profile ? after.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(p => p.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.ok(results.length && results.every(result => !result.error), 'agent reply fold and protected/manual controls pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));
