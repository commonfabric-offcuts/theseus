// Real open-outline repair and native navigation after a coordinator command (632).
// Isolated HTTP/Core fixture; native pointer and keyboard, no live records.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence = process.argv[2]; await mkdir(evidence, { recursive: true });
const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', '--live']);
const { control, exit } = fixtureControl(child);
const results = [], cleanup = {}, owned = new Set([child.pid]);
let profileForObserver;
const observe = () => {
  const rows = execFileSync('/bin/ps', ['-axo','pid=,ppid=,command='], {encoding:'utf8'}).trim().split('\n').map(line => {
    const [,pid,ppid,command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return {pid:Number(pid),ppid:Number(ppid),command};
  });
  for (const row of rows) if (profileForObserver && row.command.includes(profileForObserver)) owned.add(row.pid);
  let changed; do { changed=false; for(const row of rows) if(owned.has(row.ppid) && !owned.has(row.pid)) {owned.add(row.pid); changed=true;} } while(changed);
};
const observer = setInterval(observe,100);
let browser, profile, origin, failure, lastPage; const reads=[];
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  const pipeline = async (kind, operation_id, target, args) => {
    const result = await control({method: 'pipeline', kind, operation_id, target, args});
    assert.equal(result.status, 'committed'); return result.result;
  };
  await pipeline('pipeline.configure', '632-config', {workspace_id:'w1'}, {enabled:true, ships_in_releases:false});
  await pipeline('pipeline.stages_set', '632-stages', {workspace_id:'w1'}, {stages:[{stage_id:'build', name:'Build'}]});
  browser = await chromium.launch({ executablePath: process.env.AIM_CHROME, headless: true, args: ['--enable-automation'] });
  const cdp = await browser.newBrowserCDPSession();
  profile = (await cdp.send('Browser.getBrowserCommandLine')).arguments.find(arg => arg.startsWith('--user-data-dir='))?.split('=').slice(1).join('=');
  profileForObserver = profile; observe();
  assert.ok(profile, 'identify the actual isolated test profile');
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) {
    const key = `${width}-${colorScheme}`;
    const source = facts.sources[0].id;
    const topics = [];
    for (const role of ['former','destination']) {
      const made = await control({method:'source_start', operation_id:`632-${role}-${key}`, message_id:source,
        title:`632 ${role} ${key}`, body:`Keep this ${role} topic writing`});
      assert.equal(made.status, 'committed'); topics.push(`632-${role}-${key}-topic`);
    }
    const [former, destination] = topics;
    const item = await pipeline('pipeline.item_add', `632-item-${key}`, {workspace_id:'w1'},
      {title:`632 work ${key}`, section:'now', size:'small', sources:[{note:'Isolated 632 check'}]});
    const piece = await pipeline('pipeline.piece_start', `632-start-${key}`, {workspace_id:'w1'},
      {numbers:[item.number], topic_id:former, stage_id:'build'});
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: width === 390 });
    const page = await context.newPage(); lastPage=page;
    page.on('response', async response => { if(response.url().includes('/api/') || response.url().includes('/v1/')) { let request;try{request=response.request().postDataJSON();}catch{} reads.push({url:response.url(),request,status:response.status()});} }); page.setDefaultTimeout(10000);
    let liveResolve; const liveReady = new Promise(resolve => {liveResolve=resolve;});
    page.on('websocket', socket => socket.on('framereceived', event => { reads.push({socket:event.payload});liveResolve(); }));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?topic=t1');
    if (width === 390) await page.locator('#rail-open').click();
    const ordinary = id => page.locator(`#outline a[data-topic-id="${id}"]`);
    await ordinary(destination).first().waitFor({state:'visible'});
    await Promise.race([liveReady, new Promise((_,reject)=>setTimeout(()=>reject(Error('Live socket did not become ready')),10000))]);
    assert.equal(await ordinary(former).count(), 0, 'piece topic initially absent from ordinary outline');
    const document = await page.evaluate(() => { window.__632OriginalDocument = document; return location.href; });
    const result = await pipeline('pipeline.piece_move', `632-move-${key}`, {piece_id:piece.piece_id}, {topic_id:destination});
    assert.equal(result.from_topic_id, former);
    await ordinary(former).first().waitFor({state:'visible'});
    await ordinary(destination).first().waitFor({state:'detached'});
    assert.equal(await page.evaluate(() => window.__632OriginalDocument === document), true, 'same already-open document refreshed');
    assert.equal(page.url(), document, 'no navigation or reload');
    await ordinary(former).first().click();
    await page.waitForFunction(id => new URL(location.href).searchParams.get('topic') === id, former);
    await page.waitForFunction(() => document.querySelector('#messages')?.textContent.includes('Keep this former topic writing'));
    assert.deepEqual(errors, []);
    results.push({width, colorScheme, former, destination, result, alreadyOpen:true, nativeOpen:true, errors});
    await page.screenshot({path:`${evidence}/${key}.png`, fullPage:true});
    await context.close();
  }
} catch (error) { failure = error;
  if(lastPage) { await lastPage.screenshot({path:`${evidence}/failure.png`,fullPage:true});
    await writeFile(`${evidence}/diagnostic.json`, JSON.stringify({reads,outline:await lastPage.locator('#outline').innerHTML(),
      core:await control({method:'agent_view',actor:'fixture-person',name:'workspace_topics',args:{workspace_id:'w1',build:false}})},null,2)); }
}
finally {
  try { if (browser) { await browser.close(); cleanup.disconnected = !browser.isConnected(); } }
  catch (error) { cleanup.browserError = error.message; failure ??= error; }
  child.stdin.end(); cleanup.fixtureExit = await exit;
  cleanup.fixturePid = child.pid;
  clearInterval(observer);
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  cleanup.observedPids = [...owned];
  const alive = new Set(processes.trim().split('\n').map(line => Number(line.trim().split(/\s/)[0])));
  cleanup.ownedChildrenRemaining = [...owned].filter(pid => alive.has(pid));
  cleanup.profileIdentified = Boolean(profile);
  cleanup.ownedProfileProcesses = profile ? processes.split('\n').filter(line => line.includes(profile)) : null;
  cleanup.fixtureAbsent = !processes.split('\n').some(line => Number(line.trim().split(/\s/)[0]) === child.pid);
  if (origin) cleanup.portClosed = await new Promise(resolve => {
    const url = new URL(origin), socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true));
  });
  await writeFile(`${evidence}/results.json`, JSON.stringify({ results, cleanup, failure: failure?.stack ?? null }, null, 2));
}
assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.disconnected, true);
assert.equal(cleanup.profileIdentified, true); assert.deepEqual(cleanup.ownedChildrenRemaining, []);
assert.deepEqual(cleanup.ownedProfileProcesses, []); assert.equal(cleanup.fixtureAbsent, true); assert.equal(cleanup.portClosed, true);
if (failure) throw failure;
console.log(JSON.stringify({ passed: results.length, cleanup }));
