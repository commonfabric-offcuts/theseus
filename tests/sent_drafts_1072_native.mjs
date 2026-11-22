// Two actual app contexts, one isolated Core and human. No seeded recovery rows.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const out = process.argv[2], engine = process.env.AIM_ENGINE ?? 'chromium', newerB = process.env.AIM_CASE === 'newer-b';
assert.ok(out, 'An isolated evidence directory is required');
assert.ok(process.env.PYTHONPYCACHEPREFIX, 'Each phase needs its own Python cache');
const driver = await import(process.env.AIM_PLAYWRIGHT_CORE);
const sha = body => createHash('sha256').update(body).digest('hex');
const ps = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
  return m ? [{ pid: +m[1], ppid: +m[2], command: m[3] }] : [];
});
await mkdir(out, { recursive: true });
const inputs = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();
const snapshot = async label => {
  const current = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const hashes = Object.fromEntries(await Promise.all(current.map(async name => [name, sha(await readFile(name))])));
  const result = { at: Date.now(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes };
  await writeFile(`${out}/${label}-inputs.json`, JSON.stringify(result, null, 2)); return result;
};
const start = await snapshot('start');
await mkdir(out + '/source', { recursive: true });
for (const name of inputs) {
  const target = out + '/source/' + name; await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  await writeFile(target, await readFile(name));
}
const load = +execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).match(/load averages?:\s*([0-9.]+)/)[1];
assert.ok(load < 12, `Native phase waits above load 12: ${load}`);
const rendered = execFileSync('/usr/bin/python3', ['-c', "import sys;from aim_next.web_build import load;sys.stdout.buffer.write(load('web').index)"]);
await writeFile(out + '/rendered-index.html', rendered);
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture);
const owned = new Set(), cleanup = {}, observations = { engine, newerB, load, network: [], gestures: [], served: [], cases: [] }, tasks = [], watchers = new Set();
let browser, profile, facts, failure, finish, contexts = [], releaseSend = () => {};
const observed = predicate => new Promise((resolve, reject) => {
  const ready = () => { const found = observations.network.find(predicate); if (found) { clearTimeout(timer); watchers.delete(ready); resolve(found); } };
  const timer = setTimeout(() => { watchers.delete(ready); reject(Error('Actual B freshness response was not observed')); }, 12000);
  watchers.add(ready); ready();
});
const observe = () => {
  const rows = ps(); for (const row of rows) if (profile && row.command.includes(profile)) owned.add(row.pid);
  for (let again = true; again;) { again = false; for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); again = true; } }
};
const core = async (name, args) => control({ method: 'agent_view', actor: facts.actor, name, args });
const state = id => core('editor_state', { source_ref: { kind: 'message', id }, topic_id: 't1' });
const bodySelector = id => `#reply-${id}-writing-body`;
const cardSelector = id => `#messages [data-id="${id}"] > .message-preview`;
const journal = (page, ids) => page.evaluate(async ids => {
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open('aim-next-pending', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try {
    const rows = await new Promise((resolve, reject) => { const req = db.transaction('editors').objectStore('editors').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    return rows.filter(row => ids.includes(row.snapshot?.context?.sourceRef?.id));
  } finally { db.close(); }
}, ids);
try {
  facts = await control({ method: 'ready', runtime_evidence: true });
  observations.facts = facts;
  const ids = {};
  for (const name of ['sent', 'never']) {
    const result = await control({ method: 'agent_message', sender: 'person', whole_topic: true,
      body: `1072 independent ${name} source`, operation_id: '1072-source-' + name });
    assert.equal(result.status, 'committed'); ids[name] = result.result.message_id;
  }
  observations.ids = ids;
  profile = await mkdtemp(out + '/' + engine + '-profile-');
  const persistent = await driver[engine].launchPersistentContext(profile, { headless: true,
    executablePath: engine === 'chromium' ? process.env.AIM_CHROME : process.env.AIM_WEBKIT });
  browser = persistent.browser(); observe(); assert.ok(owned.size);
  observations.browserVersion = browser.version();
  const open = async (name, width) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 760, isMobile: width < 760 && engine === 'chromium' });
    contexts.push(context);
    await context.addInitScript(() => {
      window.gestures1072 = [];
      for (const type of ['pointerdown', 'keydown', 'input', 'click']) document.addEventListener(type, event => {
        window.gestures1072.push({ type, trusted: event.isTrusted, id: event.target.id, key: event.key, inputType: event.inputType });
      }, true);
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => { observations.pageErrors ??= []; observations.pageErrors.push({ name, error: error.stack }); });
    page.on('response', response => {
      const url = new URL(response.url()), path = url.pathname, request = response.request();
      if (path === '/api/view' || path === '/api/command' || path === '/api/bootstrap') {
        tasks.push((async () => {
          let sent; try { sent = request.postDataJSON(); } catch { sent = request.postData(); }
          observations.network.push({ name, path, sent, status: response.status(), body: await response.json() });
          for (const ready of [...watchers]) ready();
        })().catch(error => { observations.responseErrors ??= []; observations.responseErrors.push({ name, path, error: error.message }); }));
      } else if (response.status() === 200 && (path.endsWith('.mjs') || path === '/' || path.endsWith('.css') || path.endsWith('.js'))) {
        tasks.push((async () => {
          const body = await response.body(), relative = path === '/' ? 'index.html' : path.split('/').at(-1);
          const canonical = path === '/' ? Buffer.from(body.toString().replace(/(<meta name="aim-next-session" content=")[^"]+(">)/, '$1__AIM_SESSION_TOKEN__$2')) : body;
          const expected = path === '/' ? sha(rendered) : start.hashes['web/' + relative];
          assert.equal(sha(canonical), expected, 'Served owner differs: ' + relative);
          const file = `${name}-${observations.served.length}-${relative}`;
          observations.served.push({ name, url: response.url(), sha256: sha(body), canonical_sha256: sha(canonical), file });
          await writeFile(out + '/served/' + file, body);
        })().catch(error => { observations.servedErrors ??= []; observations.servedErrors.push({ name, path, error: error.stack }); }));
      }
    });
    await page.goto(facts.origin + '/?topic=t1');
    await page.locator('body[data-ready=true]').waitFor();
    await page.locator(cardSelector(ids.sent)).waitFor();
    return page;
  };
  await mkdir(out + '/served', { recursive: true });
  const a = await open('A-phone', 390);
  const words = { sent: '1072 shared writing to send.', never: '1072 never sent; keep these words.' };
  const typed = async (page, id, text) => {
    await page.locator(cardSelector(id)).tap();
    const field = page.locator(bodySelector(id)); await field.waitFor(); await field.tap();
    const saved = page.waitForResponse(response => {
      try { const request = response.request().postDataJSON(); return request?.kind === 'draft.save' && request.args.body === text; } catch { return false; }
    });
    await field.pressSequentially(text);
    assert.equal((await (await saved).json()).status, 'committed');
    assert.equal(await field.inputValue(), text);
  };
  await typed(a, ids.sent, words.sent); await typed(a, ids.never, words.never);
  const before = { sent: await state(ids.sent), never: await state(ids.never) };
  assert.equal(before.sent.draft.body, words.sent); assert.equal(before.never.draft.body, words.never);
  const b = await open('B-laptop', 1280);
  for (const name of ['sent', 'never']) {
    await b.waitForFunction(({ selector, body }) => document.querySelector(selector)?.value === body, { selector: bodySelector(ids[name]), body: words[name] });
    assert.equal(await b.locator(bodySelector(ids[name])).isVisible(), true);
  }
  await Promise.all(tasks);
  observations.before = { core: before, bJournal: await journal(b, Object.values(ids)), bWritingReads: observations.network.filter(entry => entry.name === 'B-laptop' && entry.sent?.name === 'editor_state') };
  for (const name of ['sent', 'never']) {
    const row = observations.before.bWritingReads.find(row => row.body?.draft?.id === before[name].draft.id);
    assert.ok(row, 'B actually read the shared Core draft: ' + name);
    for (const field of ['id', 'revision', 'generation', 'body']) assert.equal(row.body.draft[field], before[name].draft[field]);
    assert.deepEqual(row.body.source_ref, { kind: 'message', id: ids[name] });
    assert.equal(row.body.destination.topic_id, 't1'); assert.equal(row.body.instance_id, facts.instance_id);
  }
  const newerWords = words.sent + ' New B writing.';
  if (newerB) {
    observations.blockedBSaves = [];
    await b.route('**/api/command', async route => {
      const request = route.request().postDataJSON();
      if (request.kind === 'draft.save' && request.args.source_ref.id === ids.sent) {
        observations.blockedBSaves.push(request); await route.abort('failed');
      } else await route.continue();
    });
    const saving = b.waitForRequest(request => { try { const q = request.postDataJSON(); return q?.kind === 'draft.save' && q.args.body === newerWords; } catch { return false; } });
    await b.locator(bodySelector(ids.sent)).click(); await b.locator(bodySelector(ids.sent)).press('Meta+ArrowRight'); await b.locator(bodySelector(ids.sent)).pressSequentially(' New B writing.'); await saving;
    assert.equal(await b.locator(bodySelector(ids.sent)).inputValue(), newerWords);
  }
  await a.screenshot({ path: out + '/A-before-send.png' }); await b.screenshot({ path: out + '/B-before-send.png' });
  let held; const reachedSend = new Promise(resolve => { held = resolve; }), sendingAllowed = new Promise(resolve => { releaseSend = resolve; });
  await a.route('**/api/command', async route => {
    const request = route.request().postDataJSON();
    if (request.kind === 'message.send') { held(request); await sendingAllowed; }
    await route.continue();
  });
  const sent = a.waitForResponse(response => { try { return response.request().postDataJSON()?.kind === 'message.send'; } catch { return false; } });
  await a.locator(`#reply-${ids.sent}-send`).tap();
  const heldSend = await reachedSend;
  const prepared = await state(ids.sent), pending = await core('submissions', { source_ref: { kind: 'message', id: ids.sent }, topic_id: 't1', limit: 20 });
  const pendingMetadata = pending.items.find(item => item.send_operation_id === heldSend.operation_id);
  assert.ok(pendingMetadata); assert.equal(pendingMetadata.send_status, 'unknown'); assert.equal(prepared.draft.body, '');
  const preparedSource = (await core('topic_messages', { topic_id: 't1', direction: 'before', limit: 50 })).items.find(item => item.id === ids.sent);
  await observed(entry => entry.name === 'B-laptop' && entry.body?.items?.some(item => item.id === ids.sent && item.yours?.version >= preparedSource.yours.version));
  await b.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await b.locator(bodySelector(ids.sent)).isVisible(), true);
  assert.equal(await b.locator(bodySelector(ids.sent)).inputValue(), newerB ? newerWords : words.sent);
  observations.prepared = { core: prepared, metadata: pendingMetadata, request: heldSend, source: preparedSource };
  observations.cases.push({ name: 'prepared with no committed send keeps B writing visible', pass: true });
  await b.screenshot({ path: out + '/B-prepared-unsent.png' }); releaseSend();
  const receipt = await (await sent).json(); assert.equal(receipt.status, 'committed');
  observations.send = receipt;
  const submissions = await core('submissions', { source_ref: { kind: 'message', id: ids.sent }, topic_id: 't1', limit: 20 });
  const match = submissions.items.find(item => item.id === receipt.result.submission_id && item.draft_id === before.sent.draft.id && item.draft_generation === before.sent.draft.generation);
  assert.ok(match, 'Actual shared generation is the sent submission'); assert.equal(match.send_status, 'committed');
  observations.submission = await core('submission', { submission_id: match.id });
  assert.equal(observations.submission.body, words.sent);
  assert.deepEqual(observations.submission.send_receipt, receipt);
  // Send finalizes an ordinary Tell choice and can save the same writing once
  // more. Prove every intervening revision instead of assuming prepare uses
  // B's earlier revision, or accepting a newer revision with different words.
  const writing = draft => ({ body: draft.body, attachments: draft.attachments, quotes: draft.quotes,
    addressees: draft.addressees, intent: draft.intent ?? null, whisper: draft.whisper ?? false });
  assert.deepEqual(writing(observations.submission), writing(before.sent.draft));
  await Promise.all(tasks);
  observations.interveningSaves = observations.network.filter(entry => entry.name === 'A-phone' && entry.sent?.kind === 'draft.save' &&
    entry.sent.target.draft_id === before.sent.draft.id && entry.body.status === 'committed' && entry.body.result.draft_revision > before.sent.draft.revision);
  let revision = before.sent.draft.revision;
  for (const entry of observations.interveningSaves) {
    assert.equal(entry.sent.expected.draft_revision, revision); assert.equal(entry.body.result.draft_revision, ++revision);
    assert.equal(entry.sent.args.generation, before.sent.draft.generation); assert.deepEqual(writing(entry.sent.args), writing(before.sent.draft));
  }
  assert.equal(match.draft_revision, revision, 'Exact save chain from B writing to prepared revision');
  const after = { sent: await state(ids.sent), never: await state(ids.never) };
  assert.equal(after.sent.draft.id, before.sent.draft.id); assert.notEqual(after.sent.draft.generation, before.sent.draft.generation);
  assert.equal(after.sent.draft.body, ''); assert.deepEqual(after.never.draft, before.never.draft);
  let folded = true;
  if (!newerB) {
    try { await b.waitForFunction(selector => !document.querySelector(selector)?.getClientRects().length, bodySelector(ids.sent), { timeout: 12000 }); }
    catch { folded = false; }
  } else {
    const retired = (await core('topic_messages', { topic_id: 't1', direction: 'before', limit: 50 })).items.find(item => item.id === ids.sent);
    await observed(entry => entry.name === 'B-laptop' && entry.body?.items?.some(item => item.id === ids.sent && item.yours?.version >= retired.yours.version));
    await b.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    folded = !await b.locator(bodySelector(ids.sent)).isVisible();
  }
  observations.after = { core: after, folded, bSentText: await b.locator(bodySelector(ids.sent)).inputValue().catch(() => null),
    bJournal: await journal(b, Object.values(ids)), bNever: await b.locator(bodySelector(ids.never)).inputValue(), aNever: await a.locator(bodySelector(ids.never)).inputValue() };
  assert.equal(observations.after.bNever, words.never); assert.equal(observations.after.aNever, words.never);
  assert.equal(await a.locator(bodySelector(ids.never)).isVisible(), true); assert.equal(await b.locator(bodySelector(ids.never)).isVisible(), true);
  observations.cases.push({ name: 'never-sent writing stays in both sessions and Core', pass: true });
  observations.cases.push({ name: newerB ? 'newer local B words stay visible after A sends shared draft' : 'same committed shared draft retires and B composer folds', pass: newerB ? !folded : folded });
  if (newerB) {
    assert.equal(observations.after.bSentText, newerWords); assert.equal(folded, false);
    assert.ok(observations.after.bJournal.some(row => row.snapshot?.draft?.body === newerWords));
  } else if (folded) assert.equal(observations.after.bSentText, '');
  await a.screenshot({ path: out + '/A-after-send.png' }); await b.screenshot({ path: out + '/B-after-send.png' });
  for (const [name, page] of [['A', a], ['B', b]]) observations.gestures.push({ name, events: await page.evaluate(() => window.gestures1072) });
  await Promise.all(tasks);
  observations.bSawRetiredWriting = observations.network.filter(entry => entry.name === 'B-laptop' && entry.body?.items?.some(item => item.id === ids.sent && item.yours?.reply === false));
  assert.ok(observations.bSawRetiredWriting.length, 'B must receive actual Core retirement freshness before a fold failure is a product red');
  assert.deepEqual(observations.servedErrors ?? [], []); assert.deepEqual(observations.pageErrors ?? [], []);
  if (!newerB) assert.equal(folded, true, '1072 shared-sent: B must fold after A sends their exact shared Core draft');
} catch (error) { failure = error.stack; }
finally {
  releaseSend();
  if (browser) { observe(); await browser.close(); cleanup.browserClosed = !browser.isConnected(); }
  cleanup.ownedPids = [...owned]; const rows = ps();
  cleanup.remainingOwned = rows.filter(row => owned.has(row.pid)); cleanup.profileProcesses = profile ? rows.filter(row => row.command.includes(profile)) : [];
  if (profile && cleanup.browserClosed && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) {
    await rm(profile, { recursive: true }); cleanup.profileRemoved = await access(profile).then(() => false, () => true);
  }
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors(); cleanup.fixturePid = fixture.pid;
  cleanup.fixtureAbsent = !ps().some(row => row.pid === fixture.pid);
  if (facts) cleanup.tcp = await new Promise(resolve => {
    const url = new URL(facts.origin), socket = net.createConnection({ host: url.hostname, port: +url.port });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); }); socket.once('error', error => resolve(error.code));
  });
  await Promise.allSettled(tasks); finish = await snapshot('end');
  await writeFile(out + '/results.json', JSON.stringify({ start, finish, observations, cleanup, failure }, null, 2));
}
assert.deepEqual(finish.hashes, start.hashes, 'Source must stay fixed during the phase');
assert.equal(cleanup.browserClosed, true); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []);
assert.equal(cleanup.profileRemoved, true); assert.deepEqual(cleanup.fixtureExit, { code: 0, signal: null }); assert.equal(cleanup.fixtureErrors, '');
assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.tcp, 'ECONNREFUSED');
assert.equal(failure, undefined, failure);
console.log(JSON.stringify({ cases: observations.cases, cleanup }));
