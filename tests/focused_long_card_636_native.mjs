// Observe real focus, HTTP source reads and geometry on isolated Core records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2];
const congested = process.env.AIM_636_CONGESTED === '1';
const filter = process.argv[3] ?? '';
await mkdir(evidence, { recursive: true });
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const results = [], cleanup = { browsers: [] };
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retainChildren(owned) {
  const list = processes();
  for (let changed = true; changed;) { changed = false; for (const p of list) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; } }
}
const snapshot = card => card.evaluate(el => ({ dataset: { ...el.dataset }, hidden: el.hidden, connected: el.isConnected,
  active: document.activeElement === el, activeClass: document.activeElement.className,
  rect: el.getBoundingClientRect().toJSON(), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
  preview: el.querySelector(':scope > .message-preview')?.getBoundingClientRect().toJSON(),
  classes: el.className, endVisibleInDOM: el.textContent.includes('END636'), focus: window.focus636 })).catch(e => ({ diagnosticError: e.message }));
const gap = Array.from({ length: 9 }, (_, i) => `Line ${i} has enough words to wrap on a phone.`).join('\n\n');
const bodies = {
  two: ['Before.', '~~~\nfirst copy\n~~~', gap, '~~~\nsecond copy\n~~~', gap.repeat(10), 'END636'].join('\n\n'),
  one: ['Before.', '~~~\nfirst copy\n~~~', gap.repeat(11), 'END636'].join('\n\n'),
  short: 'A short message. END636',
};
let origin, browser, failure;
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const ids = {};
  for (const [kind, body] of Object.entries(bodies)) {
    const sent = await control({ method: 'agent_message', operation_id: `636-${kind}`, sender: facts.agent,
      topic_id: 't1', reply_to: facts.sources[0].id, addressees: [facts.actor], body,
      reply_without_quote: 'Isolated 636 focus reproduction.' });
    assert.equal(sent.status, 'committed'); ids[kind] = sent.result.message_id;
  }
  const root = await control({ method: 'agent_message', operation_id: '636-root', sender: facts.agent, topic_id: 't1',
    whole_topic: true, body: bodies.two, post_args: { addressees: [facts.actor], intent: 'tell',
      divergence_reason: 'A separate isolated long-root focus control.' } });
  assert.equal(root.status, 'committed'); ids.root = root.result.message_id;
  for (const engine of ['chromium', 'webkit']) {
    const profile = await mkdtemp(`${evidence}/${engine}-profile-`);
    const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
      ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
    browser = persistent.browser();
    const owned = new Set(processes().filter(p => p.command.includes(profile)).map(p => p.pid));
    retainChildren(owned);
    assert.ok(owned.size, 'identify owned browser processes');
    let engineFailure = false;
    try {
      for (const kind of ['short', 'one', 'two', 'root']) {
        for (const width of congested ? [390, 1280] : kind === 'two' ? [320, 375, 390, 1280] : [1280]) for (const colorScheme of congested ? ['light'] : ['light', 'dark']) {
          const key = `${engine}-${kind}-${width}-${colorScheme}`, id = ids[kind];
          if (!key.includes(filter)) continue;
          const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 900 : 844 },
            isMobile: width !== 1280, hasTouch: width !== 1280, colorScheme });
          const page = await context.newPage(); page.setDefaultTimeout(10000);
          const reads = [], pageErrors = [];
          page.on('pageerror', error => pageErrors.push(error.message));
          page.on('response', async response => {
            const request = response.request();
            if (!request.url().endsWith('/api/view')) return;
            const post = request.postDataJSON(); if (post?.name !== 'source') return;
            const record = { id: post.args?.source_ref?.id, readClass: request.headers()['x-aim-read-class'], status: response.status() };
            reads.push(record); try { const body = await response.json(); record.error = body.error?.code; record.bodyLength = body.body?.length; } catch {}
          });
          await page.addInitScript(() => {
            window.focus636 = [];
            for (const type of ['focusin', 'focusout']) document.addEventListener(type, event => {
              const card = event.target.closest?.('.message-card'); if (!card) return;
              const preview = card.querySelector(':scope > .message-preview');
              window.focus636.push({ type, trusted: event.isTrusted, id: card.dataset.id, target: event.target.className,
                hidden: card.hidden, connected: card.isConnected, whole: card.dataset.whole,
                height: card.getBoundingClientRect().height, previewHeight: preview?.getBoundingClientRect().height });
            });
          });
          let error, hold, blocked, state, readsAtDecision;
          const selector = `.message-card[data-id="${id}"]`, card = page.locator(selector);
          try {
            await page.goto(`${origin}/?topic=t1`); await page.locator('body[data-ready=true]').waitFor();
            if (congested) {
              hold = `636-${key}-background`;
              await control({ method: 'read_hold', hold_id: hold, name: 'source', read_class: 'background', phase: 'callback' });
              blocked = fetch(`${origin}/api/view`, { method: 'POST', headers: { Authorization: `Bearer ${facts.token}`,
                Origin: origin, 'Content-Type': 'application/json', 'X-AIM-Read-Class': 'background' },
                body: JSON.stringify({ name: 'source', args: { source_ref: facts.sources[0] } }) }).then(r => r.json());
              const deadline = Date.now() + 5000;
              for (;;) {
                const events = await control({ method: 'admission_events' });
                if (events.events.some(e => e.event === 'hold-enter' && e.hold_id === hold)) break;
                assert.ok(Date.now() < deadline, 'the owned background request enters its hold');
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }
            await card.focus();
            if (kind !== 'short') await page.waitForFunction(sel => document.querySelector(sel)?.dataset.whole === 'shown', selector, { timeout: 10000 });
            assert.ok(await card.evaluate(el => el.textContent.includes('END636')), 'complete body reaches the card');
            assert.equal(await card.locator('.md-fence').count(), ['two', 'root'].includes(kind) ? 2 : kind === 'one' ? 1 : 0);
            const focused = await snapshot(card);
            assert.equal(focused.active, true, 'the actual card retains keyboard focus');
            assert.ok(focused.focus.some(event => event.type === 'focusin' && event.id === id && event.trusted), 'the browser delivered real focus');
            if (kind === 'short') assert.deepEqual(reads, [], 'a short body needs no whole-source read');
            if (congested && kind !== 'short') {
              assert.ok(reads.some(r => r.id === id && r.readClass === 'background' && r.status === 503), 'real occupied background lane refuses the source');
              assert.ok(reads.some(r => r.id === id && r.readClass === 'foreground' && r.status === 200), 'focused card reads through foreground before background is released');
            }
            assert.deepEqual(pageErrors, []);
          } catch (caught) { error = caught.stack; engineFailure = true; }
          finally {
            state = await snapshot(card); readsAtDecision = structuredClone(reads);
            if (hold) { await control({ method: 'read_release', hold_id: hold }); await blocked; }
          }
          results.push({ key, id, congested, reads: readsAtDecision, readsThroughCleanup: reads, state, pageErrors,
            admission: congested ? await control({ method: 'admission_events' }) : undefined, error: error ?? null });
          if (error) await page.screenshot({ path: `${evidence}/${key}.png` });
          console.log(JSON.stringify({ key, passed: !error, reads, active: state.active, hidden: state.hidden, whole: state.dataset?.whole }));
          await context.close();
          await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2));
          if (engineFailure) break;
        }
        if (engineFailure) break;
      }
    } finally {
      retainChildren(owned);
      await browser.close(); const after = processes();
      const receipt = { engine, profile, ownedPids: [...owned], browserClosed: !browser.isConnected(),
        profileProcesses: after.filter(p => p.command.includes(profile)), remainingOwned: after.filter(p => owned.has(p.pid)) };
      cleanup.browsers.push(receipt); browser = null;
      assert.equal(receipt.browserClosed, true); assert.deepEqual(receipt.profileProcesses, []); assert.deepEqual(receipt.remainingOwned, []);
      await rm(profile, { recursive: true }); receipt.profileRemoved = await access(profile).then(() => false, () => true);
      assert.equal(receipt.profileRemoved, true);
    }
  }
} catch (error) { failure = error; }
finally {
  if (browser) await browser.close();
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  cleanup.fixturePid = fixture.pid; cleanup.fixtureAbsent = !processes().some(p => p.pid === fixture.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
assert.ok(results.length > 0, 'the case filter matched actual native cases');
assert.ok(results.every(result => !result.error), 'native focus cases pass; inspect preserved observations');
console.log(JSON.stringify({ passed: results.length, cleanup }));
