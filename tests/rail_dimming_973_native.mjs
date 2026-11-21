// Real reply arrival and native unfold in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], baseline = process.env.AIM_973_BASELINE === '1';
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
const snapshot = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const rows = [...document.querySelectorAll('#outline .ol-name, #outline a.nav-item[data-topic-id]')].map(el => {
    const row = el.classList.contains('ol-name') ? el.closest('.ol-row') : el, li = row.closest('.ol-outcome');
    const name = el.querySelector('.ol-title') ?? el, style = getComputedStyle(name), badge = el.querySelector('.unread-count');
    const probe = document.createElement('span'); probe.style.color = 'color-mix(in srgb, var(--ink) 15%, var(--paper))'; row.append(probe);
    const dimInk = getComputedStyle(probe).color; probe.remove();
    return { id: el.dataset.topicId ?? el.dataset.workspaceId, type: el.dataset.topicId ? 'topic' : 'outcome', dimmed: row.dataset.dimmed === 'true' || (!el.dataset.topicId && li.dataset.dimmed === 'true'),
      color: style.color, weight: style.fontWeight, dimInk, box: box(row), current: el.getAttribute('aria-current'),
      badge: badge ? { visibility: getComputedStyle(badge).visibility, box: box(badge) } : null,
      light: el.querySelector('.outcome-light') ? getComputedStyle(el.querySelector('.outcome-light')).opacity : null };
  });
  return { rows, url: location.href, choices: [...document.querySelectorAll('.rail-dim button')].map(el => [el.textContent,el.getAttribute('aria-pressed')]),
    order: [...document.querySelectorAll('#outline .ol-outcome')].map(el => el.dataset.workspaceId) };
});
const rowIn = (shot, id) => { const row = shot.rows.find(row => row.id === id); assert.ok(row, `actual rail row ${id}`); return row; };
const sameBox = (a,b) => { for (const key of ['x','y','width','height']) assert.ok(Math.abs(a[key]-b[key]) < .6, `${key} keeps its position`); };
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  await control({ method: 'navigation_workspaces', workspaces: [{ id: 'w973', title: 'Other outcome', team: [] }] });
  const created = await control({ method: 'navigation_topics', topics: [{ id: 't973a', title: 'Agent topic A' }, { id: 't973b', title: 'Agent topic B' }, { id: 't973c', title: 'Other topic C', workspace_id: 'w973' }] });
  assert.ok(created.every(x => x.status === 'committed'));
  const answer = await control({ method: 'agent_message', operation_id: '973-unread', sender: facts.agent, join: true, topic_id: 't973a',
    reply_to: created[0].result.message_id, addressees: [facts.actor], body: 'Unread answer for its actual rail badge.', reply_without_quote: 'Isolated973 unread badge fixture.' });
  assert.equal(answer.status, 'committed');
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await playwright[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); for (const p of ps()) if (p.command.includes(profile)) owned.add(p.pid); retainChildren(); assert.ok(owned.size);
  for (const look of baseline ? [''] : ['', 'paper']) for (const colorScheme of baseline ? ['dark'] : ['light','dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme });
    await context.addInitScript(({instance,actor,look}) => {
      if (!localStorage.getItem('973-open-seeded')) {
        localStorage.setItem(`aim-next.outline-open.${JSON.stringify([instance,actor])}`, JSON.stringify({w1:true})); localStorage.setItem('973-open-seeded','1');
      }
      if (look) localStorage.setItem('theseus-look',look);
    }, {instance:facts.instance_id,actor:facts.actor,look});
    const page = await context.newPage(), pageErrors = [], popups = [];
    page.on('pageerror', e => pageErrors.push(e.message)); page.on('popup', popup => { popups.push(popup.url()); popup.close(); }); page.setDefaultTimeout(5000);
    await page.goto(`${origin}/?topic=t1`); await page.locator('body[data-ready=true]').waitFor();
    const workspace = id => page.locator(`#outline .ol-name[data-workspace-id="${id}"]`), topic = id => page.locator(`#outline a.nav-item[data-topic-id="${id}"]`);
    const openW1 = page.locator('.ol-outcome[data-workspace-id=w1] > .ol-row > .ol-disclosure');
    if (await openW1.getAttribute('aria-expanded') !== 'true') await openW1.click();
    await topic('t973a').waitFor({state:'visible'}); await topic('t973b').waitFor({state:'visible'});
    const away = () => page.mouse.move(850,950);
    const press = (loc, modifiers) => loc.click({modifiers, position:{x:20,y:10}});
    const choose = n => page.locator(`.rail-dim button[data-dim-set="${n}"]`).click();
    const observe = async () => { await away(); return snapshot(page); };
    async function check(name, act) {
      let error, before = await observe();
      try { await act(before); assert.deepEqual(pageErrors, []); } catch(caught) { error = caught.stack; }
      const after = await observe(); results.push({key:`${engine}-${look||'bookends'}-${colorScheme}-${name}`,before,after,popups:[...popups],pageErrors:[...pageErrors],error:error??null});
      if(error || name==='outcome-toggle-hover') await page.screenshot({path:`${evidence}/${engine}-${look||'bookends'}-${colorScheme}-${name}.png`});
      await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));
    }
    await check('switch', async()=>{ assert.equal(await page.locator('.rail-dim button').count(),3); assert.deepEqual((await snapshot(page)).choices,[['0','true'],['1','false'],['2','false']]); });
    await check('outcome-toggle-hover', async before=>{
      await press(workspace('w1'),['Meta']); let dim = await observe();
      assert.equal(rowIn(dim,'w1').dimmed,true); assert.equal(rowIn(dim,'t973a').dimmed,true); assert.equal(rowIn(dim,'t973b').dimmed,true);
      assert.equal(rowIn(dim,'w1').weight,'500'); assert.equal(rowIn(dim,'w1').color,rowIn(dim,'w1').dimInk); assert.equal(rowIn(dim,'t973a').color,rowIn(dim,'t973a').dimInk);
      sameBox(rowIn(before,'w1').box,rowIn(dim,'w1').box); sameBox(rowIn(before,'t973a').box,rowIn(dim,'t973a').box);
      assert.ok(rowIn(dim,'t973a').badge,'the real unread badge exists'); assert.equal(rowIn(dim,'t973a').badge.visibility,'hidden');
      await topic('t973a').hover(); const hover=await snapshot(page); assert.notEqual(rowIn(hover,'t973a').color,rowIn(dim,'t973a').color); assert.equal(rowIn(hover,'t973a').badge.visibility,'visible'); sameBox(rowIn(hover,'t973a').box,rowIn(dim,'t973a').box); assert.equal(rowIn(hover,'t973b').color,rowIn(dim,'t973b').color);
      await workspace('w1').hover(); const parent=await snapshot(page); assert.equal(rowIn(parent,'w1').weight,rowIn(before,'w1').weight);
      await press(workspace('w1'),['Meta']); assert.equal(rowIn(await observe(),'w1').dimmed,false);
      assert.deepEqual((await snapshot(page)).order,before.order); assert.equal(page.url(),before.url); assert.deepEqual(popups,[]);
    });
    await check('inverse-alone', async before=>{
      await press(topic('t973a'),['Meta','Shift']); const inverted=await observe();
      assert.equal(rowIn(inverted,'t973a').dimmed,false); assert.equal(rowIn(inverted,'w1').dimmed,false);
      assert.equal(rowIn(inverted,'t973b').dimmed,true); assert.equal(rowIn(inverted,'w973').dimmed,true);
      assert.equal(page.url(),before.url); assert.deepEqual((await snapshot(page)).order,before.order); assert.deepEqual(popups,[]);
    });
    await check('topic-and-inverse', async before=>{
      if(!baseline) await choose(1);
      await press(workspace('w1'),['Meta','Shift']);
      await press(topic('t973a'),['Meta']); let dim=await observe(); assert.equal(rowIn(dim,'t973a').dimmed,true); assert.equal(rowIn(dim,'t973b').dimmed,false);
      await press(topic('t973a'),['Control']); assert.equal(rowIn(await observe(),'t973a').dimmed,false,'Control toggles exactly once');
      await press(topic('t973a'),['Meta','Shift']); let inverse=await observe(); assert.equal(rowIn(inverse,'t973a').dimmed,false); assert.equal(rowIn(inverse,'w1').dimmed,false); assert.equal(rowIn(inverse,'t973b').dimmed,true); assert.equal(rowIn(inverse,'w973').dimmed,true);
      const toggle=page.locator('.ol-outcome[data-workspace-id=w973] > .ol-row > .ol-disclosure'); if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
      await topic('t973c').waitFor({state:'visible'}); assert.equal(rowIn(await observe(),'t973c').dimmed,true,'a later-loaded row follows inverse');
      assert.deepEqual((await snapshot(page)).order,before.order); assert.equal(page.url(),before.url); assert.deepEqual(popups,[]);
    });
    if(!baseline) {
      await check('saved-sets-reload-and-new-browser', async()=>{
        const first=await observe(); await choose(2); let empty=await observe(); assert.equal(rowIn(empty,'t973b').dimmed,false); await press(topic('t973b'),['Meta']);
        await choose(1); assert.equal(rowIn(await observe(),'t973b').dimmed,rowIn(first,'t973b').dimmed); assert.equal(rowIn(await observe(),'w973').dimmed,true); await choose(2); assert.equal(rowIn(await observe(),'w973').dimmed,false); await choose(1);
        await choose(0); assert.ok((await observe()).rows.every(row=>!row.dimmed)); await press(topic('t973a'),['Meta']); assert.equal((await snapshot(page)).choices[1][1],'true');
        await choose(2); assert.equal(rowIn(await observe(),'t973b').dimmed,true);
        await page.reload(); await page.locator('body[data-ready=true]').waitFor(); await topic('t973b').waitFor({state:'visible'}); assert.equal(rowIn(await observe(),'t973b').dimmed,true); assert.equal((await snapshot(page)).choices[2][1],'true');
        const tab=await context.newPage(); await tab.goto(`${origin}/?topic=t1`); await tab.locator('body[data-ready=true]').waitFor();
        assert.equal((await snapshot(tab)).choices[2][1],'true');
        await tab.locator('.rail-dim button[data-dim-set="0"]').click();
        await page.waitForFunction(()=>document.querySelector('.rail-dim button[data-dim-set="0"]')?.getAttribute('aria-pressed')==='true');
        await choose(2); await tab.waitForFunction(()=>document.querySelector('.rail-dim button[data-dim-set="2"]')?.getAttribute('aria-pressed')==='true'); await tab.close();
        const other=await browser.newContext({viewport:{width:1280,height:1000},colorScheme}); const p=await other.newPage(); await p.goto(`${origin}/?topic=t1`); await p.locator('body[data-ready=true]').waitFor(); assert.equal((await snapshot(p)).choices[0][1],'true'); assert.ok((await snapshot(p)).rows.every(row=>!row.dimmed)); await other.close();
      });
    }
    await check('plain-click-navigation', async()=>{
      await page.keyboard.press('Escape'); await topic('t973b').click(); await page.waitForURL('**/?topic=t973b');
      await page.waitForFunction(() => document.querySelector('#outline a[data-topic-id=t973b]')?.getAttribute('aria-current') === 'page');
      const selected=await observe(); assert.notEqual(rowIn(selected,'t973b').color,rowIn(selected,'t973b').dimInk,'selected row stays full');
      if(!baseline) { assert.equal(await page.locator('.rail-dim button').count(),3); assert.equal(selected.choices[2][1],'true'); await choose(0); assert.ok((await observe()).rows.every(row=>!row.dimmed)); }
    });
    if(!baseline) await check('footer-keyboard',async()=>{
      // Safari's native all-controls key, as in the existing WebKit driver.
      const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
      const roomy=page.locator('.rail-density button').last(); await roomy.focus(); await page.keyboard.press(tab);
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.dimSet),'0');
      await page.keyboard.press(tab); assert.equal(await page.evaluate(()=>document.activeElement?.dataset.dimSet),'1');
      await page.keyboard.press('Space'); assert.equal((await snapshot(page)).choices[1][1],'true');
      await page.keyboard.press(tab); await page.keyboard.press('Enter'); assert.equal((await snapshot(page)).choices[2][1],'true');
    });
    await context.close();
  }
  if(!baseline) {
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,colorScheme:'light'});
    const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>pageErrors.push(e.message));
    let error,geometry;
    try {
      await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();await page.locator('#rail-open').tap();
      const buttons=page.locator('.rail-dim button');assert.equal(await buttons.count(),3);
      geometry=await buttons.evaluateAll(buttons=>buttons.map(button=>{const b=button.getBoundingClientRect();return {width:b.width,height:b.height};}));
      assert.ok(geometry.every(box=>box.width>=44&&box.height>=44));
      for(const choice of [2,1,0]) {await page.locator(`.rail-dim button[data-dim-set="${choice}"]`).tap();assert.equal((await snapshot(page)).choices[choice][1],'true');}
      const topic=page.locator('#outline a[data-topic-id=t973b]');await topic.waitFor({state:'visible'});await topic.tap();await page.waitForURL('**/?topic=t973b');
      await page.waitForFunction(()=>document.querySelector('#outline a[data-topic-id=t973b]')?.getAttribute('aria-current')==='page');
      await page.locator('#rail-open').tap();await page.locator('.rail-dim button[data-dim-set="2"]').tap();assert.equal((await snapshot(page)).choices[2][1],'true');
      assert.deepEqual(pageErrors,[]);
    }catch(caught){error=caught.stack;await page.screenshot({path:`${evidence}/${engine}-phone-failure.png`});}
    results.push({key:`${engine}-390-touch-controls`,geometry,pageErrors,error:error??null});await context.close();
  }
} catch(caught) { failure=caught; }
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
assert.ok(results.length && results.every(result => !result.error), '973 rail dimming and retained navigation pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));
