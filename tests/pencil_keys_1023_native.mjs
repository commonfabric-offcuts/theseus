// Actual HTTP/Core app and native keys. No product body or handler substitution.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.argv.includes('--red');
await mkdir(evidence, { recursive: true });
const hashes = {};
for (const file of ['inline-composer.mjs', 'pane-keys.mjs', 'interaction-guide.mjs', 'pencil-keys.mjs']) hashes[file] = createHash('sha256').update(await readFile('web/' + file)).digest('hex');
const load=Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]);assert.ok(load<12,'load below12/18: '+load);
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return m ? [{ pid: +m[1], parent: +m[2], command: m[3] }] : [];
});
const results = [], cleanup = {}, owned = new Set(); let browser, browserVersion, profile, origin, facts, failure;
function children() {
  const rows = ps(); for (let more = true; more;) { more = false;
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); more = true; }
  }
}
const snapshot = page => page.evaluate(() => {
  const f = document.querySelector('#inline-writing-body');
  return { body: f.value, start: f.selectionStart, end: f.selectionEnd, active: document.activeElement?.id,
    sheet: document.querySelector('#new-message-sheet').open,
    kind: document.querySelector('#inline-kind [aria-checked=true]')?.id,
    keys: window.observed1023 ?? [] };
});
try {
  facts = await control({ method: 'ready' }); origin = facts.origin;
  profile = await mkdtemp(evidence + '/' + engine + '-profile-');
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : process.env.AIM_WEBKIT ? {executablePath:process.env.AIM_WEBKIT} : {}) });
  browser = persistent.browser(); assert.ok(browser); browserVersion = browser.version();
  for (const row of ps()) if (row.command.includes(profile)) owned.add(row.pid);
  children(); assert.ok(owned.size);
  for (const look of baseline ? ['bookends'] : ['bookends', 'paper']) for (const colorScheme of baseline ? ['light'] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
    await context.addInitScript(look => { localStorage.setItem('theseus-look', look === 'paper' ? 'paper' : '');
      window.observed1023 = []; document.addEventListener('keydown', e => {
        if (e.altKey || e.key === 'Enter') window.observed1023.push({ key: e.key, code: e.code, alt: e.altKey, meta: e.metaKey, composing: e.isComposing });
      }, true);
    }, look);
    let page;
    async function check(name, act) {
      const result = { key: `${engine}-${look}-${colorScheme}-${name}`, envelopes: [] }; results.push(result);
      page = await context.newPage(); page.setDefaultTimeout(4000);
      const pageErrors = []; result.networkFailures = [];
      page.on('request', request => { try { const value = request.postDataJSON(); if (['message.send','memory.create'].includes(value?.kind)) result.envelopes.push(value); } catch {} });
      page.on('pageerror', e => pageErrors.push({ message: e.message, stack: e.stack }));
      page.on('requestfailed', r => result.networkFailures.push({ url: r.url(), method: r.method(), failure: r.failure() }));
      try {
        await page.goto(origin + '/?topic=t1'); await page.locator('body[data-ready=true]').waitFor();
        result.responses = {};
        {
          result.served = {};
          for (const [file, expected] of Object.entries(hashes)) {
            const url = await page.evaluate(file => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/' + file))?.name, file);
            assert.ok(url, 'actual module loaded: ' + file);
            const bytes = await (await page.request.get(url)).body();
            result.served[file] = createHash('sha256').update(bytes).digest('hex'); assert.equal(result.served[file], expected);
          }
        }
        const field = page.locator('#inline-writing-body'); await field.fill('1023 kept words');
        await field.press('Home'); await field.press('ArrowRight'); await field.press('ArrowRight');
        for (let i = 0; i < 4; i++) await field.press('Shift+ArrowRight');
        result.before = await snapshot(page);
        await act({ field, result, message: page.locator('#inline-kind-message'), note: page.locator('#inline-kind-note-card') });
        assert.deepEqual(pageErrors, []); result.passed = true;
      } catch (caught) { result.error = caught.stack; result.passed = false;
        await page.screenshot({ path: `${evidence}/${result.key}.png` }).catch(() => {});
      }
      result.after = await snapshot(page).catch(() => null);
      await page.close();
      await writeFile(evidence + '/observations.json', JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ key: result.key, passed: result.passed, error: result.error?.split('\n')[0] }));
    }
    const selected = async (kind, before) => {
      const after = await snapshot(page); assert.equal(after.kind, 'inline-kind-' + kind);
      assert.equal(after.body, before.body); assert.equal(after.start, before.start); assert.equal(after.end, before.end);
    };
    const send = async (kind, act, result, body) => {
      // Handle rejection immediately, retaining an actual failed send rather
      // than letting a timer rejection abort owned cleanup.
      const pending = page.waitForResponse(r => { try { return r.request().postDataJSON()?.kind === kind; } catch { return false; } }, { timeout: 2500 })
        .then(response => ({ response }), error => ({ error }));
      await act(); const { response, error } = await pending; if (error) throw error;
      const receipt = await response.json(); assert.equal(receipt.status, 'committed'); result.receipt = receipt;
      const id = kind === 'message.send' ? receipt.result.message_id : receipt.result.item_id;
      const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source', args: { source_ref: receipt.result.source_ref ?? { kind: 'message', id } } });
      assert.equal(source.error, undefined); result.source = source;
      if (kind === 'message.send') assert.equal(source.body, body);
      else { assert.equal(source.title, body.split('\n')[0]); assert.ok(source.body.includes('Second line')); }
      assert.equal(result.envelopes.filter(e => e.kind === kind).length, 1, 'one actual publication envelope');
    };
    await check('option-m-opens-message-from-page', async ({ result }) => {
      await page.locator('#topic-title').click(); const before = await snapshot(page);
      await page.keyboard.press('Alt+KeyM'); await selected('message', before);
      assert.equal((await snapshot(page)).sheet, true); result.nativeKeys = (await snapshot(page)).keys;
    });
    for (const [code, kind] of [['KeyN', 'note-card'], ['KeyM', 'message']]) await check(`typing-${code}-opens-and-preserves-writing`, async ({ field }) => {
      const before = await snapshot(page); await field.press('Alt+' + code); await selected(kind, before);
      assert.equal((await snapshot(page)).sheet, true); assert.equal((await snapshot(page)).active, 'inline-writing-body');
    });
    for (const code of ['KeyN','KeyM']) await check(`owned-naming-dialog-consumes-${code}`, async ({ result }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#new-message').click(); await page.locator('#inline-who-chip').click();
      await page.locator('#inline-recipient-open').click();
      const naming = page.locator('#inline-recipient-input'); await naming.fill('kept-filter');
      await page.evaluate(() => {
        window.afterPencilKeys = [];
        document.addEventListener('keydown', event => {
          if (event.altKey) queueMicrotask(() => window.afterPencilKeys.push({ key: event.key, code: event.code, prevented: event.defaultPrevented, composing: event.isComposing }));
        }, true);
      });
      await naming.press('Alt+' + code);
      result.guardedKeys = await page.evaluate(() => window.afterPencilKeys);
      assert.equal(result.guardedKeys.find(e => e.code === code)?.prevented, true, 'actual native shortcut consumed under naming guard');
      assert.equal(await naming.inputValue(), 'kept-filter');
      assert.equal(await page.locator('#inline-recipient-sheet').evaluate(e => e.open), true, 'dialog guard remains');
      assert.equal((await snapshot(page)).kind, 'inline-kind-message', 'held mode change stays held');
    });
    for (const kind of ['message','note-card']) for (const key of ['Enter','Meta+Enter']) await check(`pill-${kind}-${key}`, async ({ field, result }) => {
      await page.locator('#new-message').click();
      const body = `1023 ${result.key}\nSecond line`; await field.fill(body);
      const pill = page.locator('#inline-kind-' + kind); await pill.click();
      assert.equal(await pill.evaluate(e => e === document.activeElement), true, 'native click left focus on mode pill');
      await send(kind === 'message' ? 'message.send' : 'memory.create', () => page.keyboard.press(key), result, body);
    });
    await check('empty-mode-pill-cannot-publish', async ({ field, result }) => {
      await page.locator('#new-message').click(); await field.fill('');
      await page.locator('#inline-kind-message').click();
      await page.keyboard.press('Enter'); await page.keyboard.press('Meta+Enter');
      assert.deepEqual(result.envelopes, [], 'existing empty Send guard');
    });
    await check('text-return-newline-command-return-send', async ({ field, result }) => {
      await page.locator('#new-message').click(); await field.fill('1023 newline'); await field.press('End');
      await field.press('Enter'); await page.keyboard.type('Second line');
      const body = '1023 newline\nSecond line'; assert.equal(await field.inputValue(), body);
      await send('message.send', () => field.press('Meta+Enter'), result, body);
    });
    if (!baseline) await check('guide-and-legend-name-opening-and-pill-defaults', async () => {
      const words = await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').find(e => e.name.includes('/pane-keys.mjs')).name;
        const keys = await import(url), guide = await import(url.replace('pane-keys.mjs', 'interaction-guide.mjs'));
        return { keys: keys.KEY_WORDS.flat().join(' '), guide: guide.RULES.flat().join(' ') };
      });
      assert.match(words.keys, /Message mode with Option-M/);
      assert.match(words.guide, /Option-M opens it in Message mode/);
      for (const text of Object.values(words)) {
        assert.match(text, /After clicking Note or Message, Return (?:or|and) ⌘Return/);
        assert.match(text, /Return (?:still )?makes a new line/);
      }
    });
    await context.close();
  }
} catch (caught) { failure = caught; }
finally {
  if (browser) { children(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  const after = ps(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = after.filter(row => owned.has(row.pid));
  cleanup.profileProcesses = profile ? after.filter(row => row.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(row => row.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(evidence + '/results.json', JSON.stringify({ engine, browserVersion, baseline, hashes, results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileRemoved, true);
if (failure) throw failure;
assert.ok(results.length && results.every(r => r.passed), '1023 native keys; inspect retained evidence');
