// Native middle-column colours (1001) in an isolated HTTP/Core instance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2];
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
// The middle column's colour (1001): Slate, Graphite and Umber for each look and theme, chosen at the rail's foot,
// kept on the device, changing only the middle column and what is drawn from it. The colours a choice must paint:
const BENCH = {
  bookends: { dark: { '': '#1d2629', graphite: '#202223', umber: '#25211d' }, light: { '': '#f6f7f4', graphite: '#eff0f1', umber: '#f4efe6' } },
  paper: { dark: { '': '#161d20', graphite: '#1b1c1e', umber: '#1f1a16' }, light: { '': '#f4f4f1', graphite: '#f2f3f4', umber: '#f7f2e8' } },
};
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
// What the page paints: the middle column's ground (Bookends draws it as a gradient ending in the bench, Paper as a
// flat floor), and the grounds around it that must not change.
const paint = page => page.evaluate(() => {
  const css = el => getComputedStyle(el), main = css(document.querySelector('main#main'));
  return { bench: document.documentElement.dataset.bench ?? '', mainImage: main.backgroundImage, mainColor: main.backgroundColor,
    ringGap: css(document.documentElement).getPropertyValue('--stack-ring-gap').trim(),
    rail: css(document.querySelector('.rail')).backgroundColor, things: css(document.querySelector('#things')).backgroundColor,
    body: css(document.body).backgroundColor, saved: localStorage.getItem('theseus-bench'),
    name: document.querySelector('.look-switch[data-switch=bench] .look-switch-name')?.textContent ?? null,
    pressed: [...document.querySelectorAll('.look-switch[data-switch=bench] button')].map(b => [b.dataset.value, b.getAttribute('aria-pressed'), b.getAttribute('aria-label')]),
    swatches: [...document.querySelectorAll('.look-switch[data-switch=bench] button')].map(b => getComputedStyle(b, '::before').backgroundColor) };
});
const shows = (look, scheme, value, p) => {
  const want = rgb(BENCH[look][scheme][value]);
  if (look === 'bookends') assert.ok(p.mainImage.includes(want), `Bookends ${scheme} ${value || 'slate'}: the bench ends in ${want} (${p.mainImage})`);
  else assert.equal(p.mainColor, want, `Paper ${scheme} ${value || 'slate'}: the floor is ${want}`);
};
try{
  const facts=await control({method:'ready'});origin=facts.origin;
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);retainChildren();assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,ownedPids:[...owned],fixturePid:fixture.pid,origin}));
  for(const look of ['bookends','paper'])for(const scheme of ['dark','light']){
    const key=`${engine}-${look}-${scheme}`;
    const context=await browser.newContext({viewport:{width:1280,height:900},colorScheme:scheme});
    await context.addInitScript(look=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.clear();if(look==='paper')localStorage.setItem('theseus-look','paper');}},look);
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.setDefaultTimeout(5000);
    const open=async()=>{await page.locator('body[data-ready=true]').waitFor();await page.locator('.look-switch[data-switch=bench]').waitFor({state:'visible'});};
    let error;const seen=[];
    try{
      await page.goto(`${origin}/?topic=t1`);await open();
      // At first: Slate, the look's own colour, with nothing saved; the switch names the look and shows its three.
      const first=await paint(page);seen.push(['first',first]);
      assert.equal(first.bench,'');assert.equal(first.saved,null);assert.equal(first.name,look==='paper'?'Paper':'Bookends');
      assert.deepEqual(first.pressed,[['','true','Slate'],['graphite','false','Graphite'],['umber','false','Umber']]);
      assert.deepEqual(first.swatches,['','graphite','umber'].map(v=>rgb(BENCH[look][scheme][v])),'each swatch shows its colour for this look and theme');
      shows(look,scheme,'',first);
      for(const value of ['graphite','umber','']){
        await page.locator(`.look-switch[data-switch=bench] button[data-value="${value}"]`).click();
        const p=await paint(page);seen.push([value||'slate',p]);
        assert.equal(p.bench,value);assert.equal(p.saved,value||null,'kept on the device; Slate saves nothing');
        assert.deepEqual(p.pressed.map(([v,on])=>on==='true'?v:null).filter(v=>v!==null),[value]);
        shows(look,scheme,value,p);
        // Only the middle column changes: the rails and the page around the bench keep the look's own grounds.
        for(const k of ['rail','things','body'])assert.equal(p[k],first[k],`${value||'slate'} leaves the ${k}`);
        // The ring a stack draws round its cards is cut in the bench's own colour, so it follows.
        assert.equal(p.ringGap.toLowerCase(),BENCH[look][scheme][value],'the stack ring gap follows the middle colour');
      }
      // The choice is kept across a reload, and a look's change repaints the switch and the bench in the other look.
      await page.locator('.look-switch[data-switch=bench] button[data-value=umber]').click();
      await page.reload();await open();
      const kept=await paint(page);seen.push(['reload',kept]);assert.equal(kept.bench,'umber');shows(look,scheme,'umber',kept);
      const other=look==='paper'?'bookends':'paper';
      await page.locator(`.look-switch[data-switch=look] button[data-value="${other==='paper'?'paper':''}"]`).click();
      const swapped=await paint(page);seen.push(['other look',swapped]);
      assert.equal(swapped.name,other==='paper'?'Paper':'Bookends');assert.equal(swapped.bench,'umber');shows(other,scheme,'umber',swapped);
      assert.deepEqual(swapped.swatches,['','graphite','umber'].map(v=>rgb(BENCH[other][scheme][v])));
      assert.deepEqual(pageErrors,[]);
    }catch(e){error=e.stack;}
    results.push({key,seen,error:error??null,pageErrors});
    if(look==='bookends'&&scheme==='dark')await page.locator('.rail-foot').screenshot({path:`${evidence}/foot.png`});
    await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));await context.close();
  }
  // A phone: the swatches are as tall as the other switches and at least as wide, and a tap chooses.
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
  let touchError;
  try{
    await page.goto(`${origin}/?topic=t1`);await page.locator('body[data-ready=true]').waitFor();await page.locator('#rail-open').tap();
    const boxes=await page.locator('.look-switch[data-switch=bench] button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height};}));
    const look=await page.locator('.look-switch[data-switch=look] button').first().evaluate(b=>b.getBoundingClientRect().height);
    assert.equal(boxes.length,3);assert.ok(boxes.every(b=>b.height>=look-.5&&b.width>=b.height-.5),JSON.stringify({boxes,look}));
    await page.locator('.look-switch[data-switch=bench] button[data-value=graphite]').tap();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.bench),'graphite');
  }catch(e){touchError=e.stack;}
  results.push({key:`${engine}-390-touch`,error:touchError??null});await context.close();
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
assert.ok(results.length && results.every(result => !result.error), '1001 middle colours pass; inspect evidence');
console.log(JSON.stringify({ passed: results.length, cleanup }));
