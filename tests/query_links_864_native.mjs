// Actual220 query links in written surfaces, with scratch HTTP/Core records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const baselineOnly = process.argv.includes('--baseline');
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: process.env.AIM_864_FIXTURE_ROOT ?? process.cwd() });
const { control, exit } = fixtureControl(child);
const records = [], failures = [], errors = [], marker = `theseus-864-${process.pid}`;
let facts, browser, page, profile;
const target = '?topic=Landing&page=n-864-target', markdown = `[The smoke checks](${target})`;
const check = (name, act) => { try { act(); records.push({ name, pass: true }); } catch (error) { failures.push({ name, error: error.stack }); } };
const ready = () => page.waitForFunction(() => document.body.dataset.ready === 'true');
try {
  facts = await control({ method: 'ready' });
  await control({ method: 'topic_state', operation_id: '864-target-name', topic_id: 't1', args: { title: 'Landing' } });
  await control({ method: 'navigation_topics', topics: [{ id: 't-864-source', title: 'Written links source' }, { id: 't-864-dup-a', title: 'Ambiguous864' }, { id: 't-864-dup-b', title: 'Ambiguous864' }] });
  await control({ method: 'light_outcome', outcome: 'w864-other', title: 'Another outcome', topic: { id: 't-864-other-landing', title: 'Landing' } });
  await control({ method: 'agent_page', operation_id: '864-target-page', item_id: 'n-864-target', topic_id: 't1', title: 'The smoke checks', body: '# Smoke checks\n\nActual864 destination.' });
  await control({ method: 'agent_page', operation_id: '864-note-page', item_id: 'n-864-note', topic_id: 't1', title: 'Written note', body: '# Written note\n\n' + markdown + '\n\n[Go Landing](?topic=landing) [Missing from note](?topic=NoSuch864)' });
  const root = (await control({ method: 'agent_message', operation_id: '864-message', topic_id: 't-864-source', sender: 'person', whole_topic: true, body: markdown })).result.message_id;
  await control({ method: 'agent_message', operation_id: '864-reply', topic_id: 't-864-source', sender: 'person', body: 'A second message keeps the dossier cover visible.', post_args: { reply_to: root } });
  const choices = (await control({ method: 'agent_message', operation_id: '864-choice-links', topic_id: 't-864-source', sender: 'person', whole_topic: true, body: '[Missing topic](?topic=NoSuch864) [Ambiguous topic](?topic=Ambiguous864) [Named topic](?topic=landing) [Id topic](?topic=t1)' })).result.message_id;
  await control({ method: 'stack_act', kind: 'stack.cover', operation_id: '864-cover', sender: facts.actor, message_id: root, args: { stands: markdown } });
  await control({ method: 'stack_act', kind: 'stack.name', operation_id: '864-stack-name', sender: facts.actor, message_id: root, args: { name: 'Written query links' } });
  await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: '864-pipeline', target: { workspace_id: 'w1' }, args: { enabled: true } });
  const added = await control({ method: 'pipeline', kind: 'pipeline.item_add', operation_id: '864-record', target: { workspace_id: 'w1' }, args: { title: 'Written record', description: markdown, section: 'now', size: 'small', sources: [{ note: 'Scratch864 written link' }] } });
  const number = added.result.number;
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation', `--${marker}`] });
  const cdp = await browser.newBrowserCDPSession(); profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16); assert.ok(profile); await cdp.detach();
  for (const width of (baselineOnly ? [1280] : [1280, 390])) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    const sources = [
      { name: 'message', url: '/?topic=t-864-source', selector: `#messages [data-id="${root}"] .message-preview` },
      { name: 'reader', url: '/?topic=t-864-source&message=' + root, selector: '#source-body' },
      { name: 'item-record', url: '/?pipeline=w1&item=' + number, selector: '#topic-description' },
      { name: 'cover', url: '/?topic=t-864-source', selector: '#messages .cover-stands' },
      { name: 'note-reader', url: '/?topic=t1&page=n-864-note&revision=1', selector: '#source-body' },
      { name: 'note-cards', url: '/?cards=n-864-note&view=cards', selector: '#deck-page' },
      { name: 'note-sheet', url: '/?topic=t1&page=n-864-note', selector: 'dialog.notebook-sheet-dialog[open]' },
    ];
    for (const source of sources) {
      const key = `${width}-${source.name}`;
      await page.goto(facts.origin + source.url); await ready();
      const host = page.locator(source.selector); await host.waitFor();
      await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('The smoke checks'), source.selector);
      const anchors = host.locator('a.words-link').filter({ hasText: 'The smoke checks' });
      const count = await anchors.count(); check(key + ' actual written query anchor', () => assert.equal(count, 1));
      if (!count) { await page.screenshot({ path: `${evidence}/${key}-red.png`, fullPage: true }); continue; }
      if (width === 390) await anchors.tap(); else await anchors.click();
      const sheet = page.locator('dialog.notebook-sheet-dialog[open]'); await sheet.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('dialog.notebook-sheet-dialog[open]')].some(el => el.textContent.includes('Actual864 destination.')));
      assert.match(await sheet.innerText(), /Actual864 destination/);
      assert.equal(await page.locator('#topic-title').textContent(), 'Landing', 'page opens in its recorded topic');
      records.push({ name: key + ' native press opens actual owner page', pass: true, url: page.url() });
      await page.screenshot({ path: `${evidence}/${key}.png`, fullPage: true });
    }
    if (!baselineOnly) {
      for (const [label, message] of [['Missing topic', 'No topic is named NoSuch864'], ['Ambiguous topic', 'Two or more topics are named Ambiguous864']]) {
        await page.goto(facts.origin + '/?topic=t-864-source'); await ready(); const url = page.url();
        const anchor = page.locator(`#messages [data-id="${choices}"] a.words-link`).filter({ hasText: label });
        if (width === 390) await anchor.tap(); else await anchor.click();
        await page.waitForFunction(text => document.getElementById('topic-navigation-status').textContent.includes(text), message);
        assert.equal(page.url(), url, 'refused name leaves current route unchanged'); records.push({ name: `${width}-${label} refuses without navigation`, pass: true });
      }
      for (const label of ['Named topic', 'Id topic']) {
        await page.goto(facts.origin + '/?topic=t-864-source'); await ready();
        const anchor = page.locator(`#messages [data-id="${choices}"] a.words-link`).filter({ hasText: label });
        if (width === 390) await anchor.tap(); else await anchor.click();
        await page.waitForFunction(() => document.getElementById('topic-title').textContent === 'Landing' && new URL(location.href).searchParams.get('topic') === 't1');
        records.push({ name: `${width}-${label} opens correct topic`, pass: true });
      }
    }
    if (!baselineOnly) {
      await page.goto(facts.origin + '/?cards=n-864-note&view=cards'); await ready();
      const body = page.locator('#deck-page');
      const missing = body.locator('a.words-link').filter({ hasText: 'Missing from note' });
      if (width === 390) await missing.tap(); else await missing.click();
      await body.getByText(/^No topic is named NoSuch864/).first().waitFor();
      records.push({ name: `${width}-Cards refusal is visible`, pass: true });
      const local = body.locator('a.words-link').filter({ hasText: 'Go Landing' });
      if (width === 390) await local.tap(); else await local.click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('topic') === 't1' && document.getElementById('topic-title').textContent === 'Landing');
      records.push({ name: `${width}-Cards own outcome wins over other Landing`, pass: true });
      await page.goto(facts.origin + '/?topic=t1&page=n-864-note'); await ready();
      const sheet = page.locator('dialog.notebook-sheet-dialog[open]');
      const inSheet = sheet.locator('a.words-link').filter({ hasText: 'Missing from note' }); await inSheet.waitFor();
      if (width === 390) await inSheet.tap(); else await inSheet.click();
      await sheet.getByText(/^No topic is named NoSuch864/).first().waitFor();
      records.push({ name: `${width}-sheet refusal is visible`, pass: true });
      await page.goto(facts.origin + '/?topic=Landing&page=n-864-target'); await ready();
      await page.waitForFunction(() => [...document.querySelectorAll('dialog.notebook-sheet-dialog[open]')].some(el => el.textContent.includes('Actual864 destination.')));
      assert.equal(await page.locator('#topic-title').textContent(), 'Landing');
      records.push({ name: `${width}-initial named query opens actual owner page`, pass: true });
    }
    await page.goto(facts.origin + '/?cards=n-864-note&view=text'); await ready();
    const writing = page.locator('textarea.notebook-text'); await writing.waitFor();
    assert.ok((await writing.inputValue()).includes(markdown));
    assert.equal(await page.locator('.notebook-text-panel a').count(), 0, 'the writing field stays literal');
    records.push({ name: `${width}-Text writing remains literal`, pass: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) { failures.push({ fatal: error.stack }); if (page && !page.isClosed()) await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {}); }
finally {
  if (browser) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); return m && { pid: +m[1], parent: +m[2], command: m[3] }; }).filter(Boolean);
    const owned = new Set(rows.filter(r => r.command.includes(marker) || r.command.includes(profile)).map(r => r.pid));
    for (let n = 0; n < rows.length; n++) for (const r of rows) if (owned.has(r.parent)) owned.add(r.pid);
    await browser.close(); const live = new Set(execFileSync('ps', ['-axo', 'pid='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)); const remaining = [...owned].filter(pid => live.has(pid));
    const profileAbsent = profile ? await access(profile).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; }) : null;
    records.push({ browserClosed: !browser.isConnected(), profile, profileAbsent, ownedPids: [...owned], remaining }); assert.deepEqual(remaining, []); assert.equal(profileAbsent, true);
  }
  child.stdin.end(); const ended = await exit;
  let absent = false; try { process.kill(child.pid, 0); } catch (e) { absent = e.code === 'ESRCH'; }
  const portClosed = !facts || await new Promise(resolve => { const s = net.connect(new URL(facts.origin).port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); s.setTimeout(1000, () => { s.destroy(); resolve(false); }); });
  records.push({ fixture: ended, fixturePid: child.pid, absent, port: facts && new URL(facts.origin).port, portClosed, errors, failures });
  await writeFile(`${evidence}/results.json`, JSON.stringify(records, null, 2)); assert.deepEqual(ended, { code: 0, signal: null }); assert.equal(absent, true); assert.equal(portClosed, true);
}
if (failures.length) { process.stderr.write(JSON.stringify(failures, null, 2) + '\n'); process.exitCode = 1; }
