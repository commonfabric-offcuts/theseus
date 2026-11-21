// Actual Reader.paintCover on content-free origins; native details gestures.
// No Core, app-bootstrap, physical-phone or timing claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';

const api = await import(process.env.AIM_PLAYWRIGHT_CORE);
const out = process.argv[2], requestedEngine = process.argv.includes('--webkit') ? 'webkit' : 'chromium', red = process.argv.includes('--red');
const source = fileURLToPath(new URL('..', import.meta.url)), base = '90f48a872fa02b98ac8f7b317d007de6107cb1a2';
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), hashes = {};
for (const file of ['web/reader.mjs', 'web/dossier-cover.mjs', 'web/message-format.mjs', 'web/aim.css', 'tests/fixtures/reader_cover_summary_989.py', 'tests/fixtures/cover_words_963.mjs'])
  hashes[file] = hash(await readFile(join(source, file)));
hashes.harness = hash(await readFile(new URL(import.meta.url)));
hashes.baselineReader = hash(execFileSync('git', ['show', base + ':web/reader.mjs'], { cwd: source }));
const fixture = spawn('/usr/bin/python3', ['-I', '-X', `pycache_prefix=${out}/pycache`, join(source, 'tests/fixtures/reader_cover_summary_989.py'), source]);
let stderr = ''; fixture.stderr.on('data', bytes => { stderr += bytes; });
const exit = new Promise(resolve => fixture.once('exit', (code, signal) => resolve({ code, signal })));
const lines = createInterface({ input: fixture.stdout })[Symbol.asyncIterator]();
const rows = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/); return m ? { pid: +m[1], parent: +m[2], command: m[3] } : null;
}).filter(Boolean);
const result = { requestedEngine, mode: red ? 'red271' : 'candidate', hashes, cells: [], errors: [], cleanup: { fixturePid: fixture.pid }, failure: null };
let browser, profile, facts, page;
try {
  const ready = await Promise.race([lines.next(), exit.then(status => { throw Error('Fixture exited before ready: ' + JSON.stringify(status) + stderr); })]);
  assert.equal(ready.done, false); facts = JSON.parse(ready.value); result.runtime = facts; assert.equal(facts.base, base);
  if (requestedEngine === 'webkit') {
    profile = await mkdtemp(join(tmpdir(), 'page-lane6-989-webkit-'));
    const context = await api.webkit.launchPersistentContext(profile, { headless: true }); browser = context.browser(); assert.ok(browser);
    const processes = rows(), owned = new Set(processes.filter(row => row.command.includes(profile)).map(row => row.pid)); assert.ok(owned.size);
    for (let changed = true; changed;) { changed = false; for (const row of processes) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
    result.cleanup.observedBrowserPids = [...owned];
  } else {
    browser = await api.chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
    const cdp = await browser.newBrowserCDPSession();
    profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x => x.startsWith('--user-data-dir='))?.slice(16);
    result.cleanup.observedBrowserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(x => x.id); assert.ok(profile);
  }
  result.engine = browser.browserType().name(); result.version = browser.version(); assert.equal(result.engine, requestedEngine);
  const cells = red ? [[1280, 'light', 'bookends']] : [1280, 320].flatMap(width => ['light', 'dark'].flatMap(theme => ['bookends', 'paper'].map(look => [width, theme, look])));
  const raw = '**Ready** with `exact bytes` and [the result](https://example.test/result)', visible = 'Ready with exact bytes and the result';
  for (const [width, colorScheme, look] of cells) {
    const cell = { key: `${width}-${colorScheme}-${look}` }; result.cells.push(cell);
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 320 });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => result.errors.push(error.message));
    await page.goto(red ? facts.baseline : facts.candidate); await page.waitForFunction(() => window.ready963);
    await page.evaluate(look => { document.documentElement.dataset.look = look; }, look);
    const authored = await page.evaluate(raw => window.paint963(raw), raw); assert.equal(authored.stands, raw);
    const host = page.locator('#reader-cover'), line = page.locator('#reader-cover-line'), words = page.locator('.reader-cover-words');
    cell.collapsed = !(await host.evaluate(n => n.open)); cell.words = await words.textContent();
    assert.equal(cell.collapsed, true); assert.equal(cell.words, visible, 'collapsed Reader reads the cover words without inline marks');
    assert.equal(await words.locator('a,strong,code').count(), 0, 'summary text adds no nested controls or formatted nodes');
    await line.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => document.querySelector('#reader-cover').open);
    assert.equal(await page.locator('#reader-cover .cover-stands strong').textContent(), 'Ready');
    assert.equal(await page.locator('#reader-cover .cover-stands code').textContent(), 'exact bytes');
    assert.equal(await page.locator('#reader-cover .cover-stands a').getAttribute('href'), 'https://example.test/result'); cell.nativeOpen = true;
    await page.evaluate(() => window.paint963('**Next** [label](https://example.test/next)'));
    assert.equal(await host.evaluate(n => n.open), true); assert.equal(await words.textContent(), 'Next label');
    assert.equal(await line.evaluate(n => n === document.activeElement), true); cell.repaintKeepsOpenAndFocus = true;
    await page.keyboard.press('Space'); await page.waitForFunction(() => !document.querySelector('#reader-cover').open); cell.nativeClose = true;
    if (width === 320) await line.tap(); else await line.click(); assert.equal(await host.evaluate(n => n.open), true); cell.pointerToggle = true;
    await line.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => !document.querySelector('#reader-cover').open);
    const literal = '<script>window.bad989=true</script> **safe**'; await page.evaluate(v => window.paint963(v), literal);
    assert.equal(await words.textContent(), '<script>window.bad989=true</script> safe'); assert.equal(await page.evaluate(() => window.bad989), undefined); cell.htmlLiteral = true;
    const long = 'context '.repeat(100); await page.evaluate(v => window.paint963('**Long** ' + v), long);
    cell.geometry = await words.evaluate(n => { const s = getComputedStyle(n), b = n.getBoundingClientRect(); return { nowrap: s.whiteSpace, overflow: s.overflow, ellipsis: s.textOverflow, clipped: n.scrollWidth > n.clientWidth, left: b.left, right: b.right, viewport: innerWidth }; });
    assert.equal(cell.geometry.nowrap, 'nowrap'); assert.equal(cell.geometry.overflow, 'hidden'); assert.equal(cell.geometry.ellipsis, 'ellipsis'); assert.equal(cell.geometry.clipped, true);
    assert.ok(cell.geometry.left >= -1 && cell.geometry.right <= width + 1); cell.oneLine = true;
    await page.evaluate(v => window.paint963(v), raw); await page.screenshot({ path: `${out}/${cell.key}.png`, fullPage: true });
    assert.deepEqual(result.errors, []); cell.passed = true; await context.close(); console.log(JSON.stringify({ key: cell.key, passed: true }));
  }
} catch (error) {
  result.failure = error.stack; if (result.cells.length) { result.cells.at(-1).passed = false; result.cells.at(-1).error = error.stack; }
  if (page && !page.isClosed()) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.html`, await page.content()); }
} finally {
  if (browser) { await browser.close(); result.cleanup.browserClosed = !browser.isConnected(); }
  fixture.stdin.end(); result.cleanup.fixtureExit = await exit; result.cleanup.fixtureErrors = stderr;
  const processes = rows(); result.cleanup.profile = profile;
  result.cleanup.profileProcesses = profile ? processes.filter(row => row.command.includes(profile)) : [];
  result.cleanup.remainingObservedPids = (result.cleanup.observedBrowserPids ?? []).filter(pid => processes.some(row => row.pid === pid));
  result.cleanup.fixtureAbsent = !processes.some(row => row.pid === fixture.pid);
  if (requestedEngine === 'webkit' && result.cleanup.browserClosed && !result.cleanup.profileProcesses.length && !result.cleanup.remainingObservedPids.length) await rm(profile, { recursive: true, force: true });
  result.cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : false;
  if (facts) {
    const closed = origin => new Promise(resolve => { const u = new URL(origin), s = net.createConnection({ host: u.hostname, port: +u.port }); s.once('connect', () => { s.destroy(); resolve(false); }); s.once('error', () => resolve(true)); });
    result.cleanup.portsClosed = await closed(facts.candidate) && await closed(facts.baseline);
    result.cleanup.scratchAbsent = await access(facts.scratch).then(() => false, () => true);
  }
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
}
assert.deepEqual(result.cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(result.cleanup.fixtureErrors, '');
assert.equal(result.cleanup.browserClosed, true); assert.deepEqual(result.cleanup.profileProcesses, []); assert.deepEqual(result.cleanup.remainingObservedPids, []);
assert.equal(result.cleanup.fixtureAbsent, true); assert.equal(result.cleanup.portsClosed, true); assert.equal(result.cleanup.profileAbsent, true); assert.equal(result.cleanup.scratchAbsent, true);
if (result.failure) throw Error(result.failure);
