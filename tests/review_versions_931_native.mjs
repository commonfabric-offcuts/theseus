// Isolated real HTTP/Core; native writing, comparison and real IndexedDB reload in Chrome for Testing.
// AIM_CHROME and AIM_PLAYWRIGHT_CORE name the browser and module.
// node tests/review_versions_931_native.mjs /absolute/evidence
// The refused submission and retained image selection are synthetic rows;
// this is not a native public refusal or native file-picker/upload test.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors: fixtureErrors } = fixtureControl(child);
let browser, page; const results = [];
let fixtureOrigin, browserProfile;
const browserMarker = 'aim-test-page-lane6-931-' + process.pid;
try {
  const facts = await control({ method: 'ready' });
  fixtureOrigin = facts.origin;
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--' + browserMarker] });
  const processList = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command=']);
  const owned = processList.stdout.split('\n').find(line => line.includes('--' + browserMarker));
  browserProfile = owned?.match(/--user-data-dir=([^\s]+)/)?.[1];
  assert.ok(browserProfile, 'isolated Chrome profile is identified for owned cleanup');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    window.transactions931 = [];
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') window.transactions931.push({ requested: args[2]?.durability, actual: tx.durability });
      return tx;
    };
  });
  page = await context.newPage(); const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  const html = (await readFile('web/index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await context.route('**/unit931', route => route.fulfill({ contentType: 'text/html', body: html }));
  const app = facts.origin + '/?topic=t1', unit = facts.origin + '/unit931';
  await page.goto(app); const field = page.locator('#inline-writing-body'), pill = page.locator('#inline-review-versions');
  await field.waitFor(); await field.fill('Chosen current words');
  await page.waitForFunction(() => document.querySelector('#inline-save-state').dataset.save === 'saved');
  assert.equal(await pill.isVisible(), false, 'saved field is quiet');
  await field.press('End'); await field.pressSequentially(' and newer typing');
  assert.equal(await pill.isVisible(), false, 'ordinary newer typing is quiet');
  await page.waitForFunction(() => document.querySelector('#inline-save-state').dataset.save === 'saved');
  const currentWords = await field.inputValue();
  const holder = await context.newPage(); await holder.goto(unit);
  const held = await holder.evaluate(async token => {
    const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs'), { Editor } = await import('/editor.mjs');
    const api = new Api(token), b = await api.bootstrap(), ref = { kind: 'topic', id: 't1' };
    const state = await api.view('editor_state', { source_ref: ref, topic_id: 't1' });
    const journal = window.heldJournal931 = await openJournal({ instanceId: b.instance_id, actor: b.actor });
    const editor = new Editor({ instanceId: b.instance_id, actor: b.actor, kind: 'reply', sourceRef: ref, topicId: 't1' }, state.draft);
    await journal.save({ ...editor.snapshot(), activeAuthority: b.authority, authorityRecovery: null, attempts: [] });
    const row = await journal.own(editor.key);
    return { id: row.id, key: editor.key, format: row.snapshot.format, hasUploads: Object.hasOwn(row.snapshot, 'uploadState') };
  }, facts.token);
  assert.equal(held.format, 1); assert.equal(held.hasUploads, false, 'plain reply row has no upload state');
  await page.reload(); await field.waitFor();
  await page.waitForFunction(() => !document.querySelector('#inline-review-versions').hidden && document.querySelector('#inline-review-versions').textContent === 'Check recovery');
  const heldShape = await page.evaluate(async ({ token, held }) => {
    const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs');
    const b = await new Api(token).bootstrap(), journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
    try {
      const rows = await journal.current(held.key, [held.id]);
      return { availability: rows[0]?.availability, hasSnapshot: Object.hasOwn(rows[0] ?? {}, 'snapshot'), uploadPresent: rows[0]?.uploadPresent };
    } finally { journal.close(); }
  }, { token: facts.token, held });
  assert.deepEqual(heldShape, { availability: 'open-in-another-tab', hasSnapshot: false, uploadPresent: false });
  await pill.click();
  await page.locator('#review-content h3').filter({ hasText: /^Open in another tab$/ }).waitFor();
  assert.equal(await page.locator('#review-retry').isVisible(), true);
  assert.equal(await field.inputValue(), currentWords);
  await page.screenshot({ path: `${evidence}/other-tab-recovery.png` });
  await holder.evaluate(() => window.heldJournal931.close()); await holder.close();
  await page.locator('#review-retry').click();
  await page.waitForFunction(() => document.querySelector('#inline-review-versions').hidden);
  await page.locator('#review-close').click();
  results.push({ passed: true, scope: 'real plain journal row held in another tab has no snapshot, exposes Check recovery and Retry, then becomes quiet after its owner closes', heldShape });
  async function seed(refused, image = null) {
    await page.goto(unit);
    return page.evaluate(async ({ token, refused, image }) => {
      const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs'), { Editor } = await import('/editor.mjs');
      const api = new Api(token), b = await api.bootstrap(), ref = { kind: 'topic', id: 't1' };
      const state = await api.view('editor_state', { source_ref: ref, topic_id: 't1' });
      const journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
      try {
        const editor = new Editor({ instanceId: b.instance_id, actor: b.actor, kind: 'reply', sourceRef: ref, topicId: 't1' }, state.draft);
        editor.uploadState = { format: 2, revision: 1, client_cycle_id: editor.clientCycleId, entries: [], submission_links: {} };
        // A retained refused-prepare fixture; the surrounding draft is saved
        // through the actual UI/Core, and this row is real strict IDB storage.
        if (refused) editor.submissions = [{ id: 'refused931', status: 'refused', snapshot: { ...structuredClone(state.draft), body: 'Different frozen refused words' }, receipt: { kind: 'submission.prepare' } }];
        const snapshot = () => ({ ...editor.snapshot(), activeAuthority: b.authority, authorityRecovery: null, attempts: [] });
        let bytesId;
        if (image) {
          const metadata = { name: 'retained931.png', size: image.length, type: 'image/png', last_modified: 0 };
          const entry = { selection_id: crypto.randomUUID(), origin: 'file', binding: {}, owner: { kind: 'cycle', id: editor.clientCycleId },
            version: 1, selected: true, file: metadata, bytes_ref: null, bytes_state: 'capturing', choice: null, attempts: [], ready_descriptor: null, association: null };
          editor.uploadState.entries.push(entry);
          bytesId = JSON.stringify([editor.key, 'upload-bytes', entry.selection_id]);
          await journal.capture(editor.key, snapshot, { id: bytesId, kind: 'upload-bytes-v1', scope: JSON.stringify([b.instance_id, b.actor]),
            editorKey: editor.key, selection_id: entry.selection_id, created_by_writer: journal.writerId, metadata,
            blob: new Blob([new Uint8Array(image)], { type: metadata.type }) }, entry, () => true);
        } else await journal.save(snapshot());
        const row = await journal.own(editor.key);
        return { id: row.id, key: editor.key, snapshot: row.snapshot, stamp: row.stamp, bytesId };
      } finally { journal.close(); }
    }, { token: facts.token, refused, image });
  }
  await seed(false); await page.goto(app); await field.waitFor();
  await page.waitForFunction(() => !document.querySelector('#inline-send').disabled);
  assert.equal(await field.inputValue(), currentWords); assert.equal(await pill.isVisible(), false, 'identical stored copy is quiet after reload');
  const refusal = await seed(true); await page.goto(app); await field.waitFor(); await page.waitForFunction(() => document.querySelector('#inline-review-versions').textContent === 'Review versions' && !document.querySelector('#inline-review-versions').hidden);
  assert.equal(await pill.textContent(), 'Review versions'); assert.match(await pill.getAttribute('title'), /earlier reply.*differs/);
  await pill.click(); const review = page.locator('#version-review'); await review.waitFor();
  assert.equal(await page.locator('#review-content > section').first().locator('pre').textContent(), 'Different frozen refused words');
  await page.screenshot({ path: `${evidence}/difference.png` });
  await review.getByRole('button', { name: 'Keep current writing', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#review-status').textContent.startsWith('Current writing kept.'));
  await page.locator('#review-close').click(); assert.equal(await pill.isVisible(), false);
  const durableChoice = await page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('aim-next-pending', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('editors').objectStore('editors').get(id);
        r.onsuccess = () => resolve(Boolean(r.result?.reviewChoice && r.result.reviewChoice.stamp === r.result.stamp));
        r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  }, refusal.id);
  assert.equal(durableChoice, true, 'Keep current writing commits the exact row to IndexedDB');
  await page.reload(); await field.waitFor();
  await page.waitForFunction(() => !document.querySelector('#inline-send').disabled);
  assert.equal(await field.inputValue(), currentWords); assert.equal(await pill.isVisible(), false, 'recorded choice stays quiet after reload');
  await page.screenshot({ path: `${evidence}/resolved-reload.png` });
  await page.goto(unit);
  const retained = await page.evaluate(async ({ token, refusal }) => {
    const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs');
    const b = await new Api(token).bootstrap(), journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
    try {
      let cursor, row;
      do { const p = await journal.candidates(refusal.key, { limit: 10, ...(cursor ? { cursor } : {}) }); row = p.items.find(r => r.id === refusal.id) ?? row; cursor = p.nextCursor; } while (cursor && !row);
      if (!row?.reviewChoice) throw Error('No durable exact-copy choice');
      let staleRefused = false, changedRefused = false, aborted = false, guardCalls = 0, strictWrites = 0;
      const choice = { ...row.reviewChoice, writerId: journal.writerId };
      try { await journal.keepCandidate(refusal.key, { ...row, stamp: refusal.stamp }, choice, () => true); } catch { staleRefused = true; }
      try { await journal.keepCandidate(refusal.key, row, choice, () => ++guardCalls < 2); } catch { changedRefused = true; }
      // Abort the real strict write after put has been issued. The transaction
      // must roll back, rather than returning a choice which never committed.
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        const request = put.call(this, value, ...args);
        if (value.id === row.id && value.reviewChoice) {
          if (this.transaction.durability === 'strict') strictWrites++;
          this.transaction.abort();
        }
        return request;
      };
      try { await journal.keepCandidate(refusal.key, row, choice, () => true); } catch { aborted = true; }
      finally { IDBObjectStore.prototype.put = put; }
      const after = await journal.inspectCandidate(refusal.key, row);
      return { snapshot: row.snapshot, choice: Boolean(row.reviewChoice), staleRefused, changedRefused, guardCalls, aborted, strictWrites,
        unchangedAfterFailures: JSON.stringify(after.snapshot) === JSON.stringify(row.snapshot),
        sameStamp: after.stamp === row.stamp, sameChoice: JSON.stringify(after.reviewChoice) === JSON.stringify(row.reviewChoice), transactions: window.transactions931 };
    } finally { journal.close(); }
  }, { token: facts.token, refusal });
  assert.deepEqual(retained.snapshot, refusal.snapshot, 'resolution preserves every frozen field and send record');
  assert.equal(retained.staleRefused, true); assert.equal(retained.changedRefused, true);
  assert.equal(retained.guardCalls, 2, 'changed guard is checked again inside the real transaction');
  assert.equal(retained.aborted, true); assert.equal(retained.strictWrites, 1);
  assert.equal(retained.sameStamp, true); assert.equal(retained.sameChoice, true);
  assert.equal(retained.unchangedAfterFailures, true);
  assert.ok(retained.transactions.length >= 2 && retained.transactions.every(tx => tx.requested === 'strict' && tx.actual === 'strict'));
  results.push({ passed: true, scope: 'strict IndexedDB stale stamp, changing guard and aborted choice preserve committed row', retained });

  const imageBytes = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSuoAAAAASUVORK5CYII=', 'base64')];
  const image = await seed(false, imageBytes);
  await page.goto(app); await field.waitFor();
  await page.waitForFunction(() => document.querySelector('#inline-review-versions').textContent === 'Review versions' && !document.querySelector('#inline-review-versions').hidden);
  await pill.click(); await review.waitFor();
  assert.equal(await page.locator('#review-content > section').first().locator('pre').textContent(), currentWords, 'image-only difference opens first');
  await page.screenshot({ path: `${evidence}/image-difference.png` });
  await page.goto(unit);
  const bytes = await page.evaluate(async ({ token, image }) => {
    const { Api } = await import('/api.mjs'), { openJournal } = await import('/journal.mjs');
    const b = await new Api(token).bootstrap(), journal = await openJournal({ instanceId: b.instance_id, actor: b.actor });
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('aim-next-pending', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = id => new Promise((resolve, reject) => { const tx = db.transaction('editors'), r = tx.objectStore('editors').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const write = row => new Promise((resolve, reject) => { const tx = db.transaction('editors', 'readwrite', { durability: 'strict' }); tx.objectStore('editors').put(row); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    try {
      const before = await read(image.id), originalBytes = await read(image.bytesId);
      const candidate = { ...before, availability: 'available' };
      const digests = await journal.comparisonImages(image.key, candidate);
      const after = await read(image.id), afterBytes = await read(image.bytesId);
      // Replace the synthetic row while SHA-256 is in flight. The final
      // production stamp recheck must refuse its now-obsolete evidence.
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let changedDuringHash = false, staleDigestRefused = false;
      crypto.subtle.digest = async (...args) => {
        await write({ ...before, stamp: crypto.randomUUID() }); changedDuringHash = true;
        return digest(...args);
      };
      try { await journal.comparisonImages(image.key, candidate); } catch { staleDigestRefused = true; }
      finally { crypto.subtle.digest = digest; await write(before); }
      const restored = await read(image.id), restoredBytes = await read(image.bytesId);
      return { digests, snapshot: after.snapshot, entry: after.snapshot.uploadState.entries[0],
        rowUnchanged: JSON.stringify(before) === JSON.stringify(after), restored: JSON.stringify(before) === JSON.stringify(restored),
        data: [...new Uint8Array(afterBytes.data)], restoredData: [...new Uint8Array(restoredBytes.data)],
        metadataUnchanged: JSON.stringify(originalBytes.metadata) === JSON.stringify(afterBytes.metadata), changedDuringHash, staleDigestRefused };
    } finally { db.close(); journal.close(); }
  }, { token: facts.token, image });
  assert.deepEqual(bytes.snapshot, image.snapshot, 'digest discovery does not edit frozen metadata');
  assert.equal(bytes.rowUnchanged, true); assert.equal(bytes.restored, true); assert.equal(bytes.metadataUnchanged, true);
  assert.deepEqual(bytes.data, imageBytes); assert.deepEqual(bytes.restoredData, imageBytes);
  assert.equal(bytes.entry.file.sha256, undefined, 'computed digests stay ephemeral');
  assert.deepEqual(Object.values(bytes.digests), [createHash('sha256').update(Buffer.from(imageBytes)).digest('hex')]);
  assert.equal(bytes.changedDuringHash, true); assert.equal(bytes.staleDigestRefused, true);
  results.push({ passed: true, scope: 'actual IDB missing image digest, native image-only comparison, retained bytes unchanged, applied/restored mid-digest stamp mutation', bytes });
  assert.deepEqual(pageErrors, []);
  results.push({ passed: true, scope: 'native typing/save/newer typing; real IDB identical-copy reload; different refused fixture, named pill, first comparison, explicit keep and new-document reload; unchanged frozen snapshot and failed stale/changed choices' });
  await context.close(); page = null;
} catch (error) {
  results.push({ passed: false, error: error.stack });
  if (page) { await page.screenshot({ path: `${evidence}/failure.png` }).catch(() => {}); await writeFile(`${evidence}/failure.html`, await page.content().catch(() => '')); }
  throw error;
} finally {
  await browser?.close(); const browserDisconnected = !browser?.isConnected();
  child.stdin.end(); const ended = await exit;
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command=']);
  const ownedBrowserProcesses = stdout.split('\n').filter(line => line.includes(browserMarker) || browserProfile && line.includes(browserProfile));
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, browserDisconnected, browserMarker, browserProfile, ownedBrowserProcesses,
    fixturePid: child.pid, fixtureOrigin, fixtureExit: ended, fixtureErrors: fixtureErrors() }, null, 2));
  assert.equal(browserDisconnected, true);
  assert.deepEqual(ownedBrowserProcesses, [], 'owned Chrome exits through Browser.close');
  assert.equal(ended.code, 0);
}
