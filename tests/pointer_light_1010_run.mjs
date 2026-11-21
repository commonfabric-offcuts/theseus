// Standalone current driver for the retained1010 native behavior producer.
// Isolated fixture/Core and native Playwright input; no live account or hardware claim.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { readingSeed } from './topic_reading_native.mjs';
import { pointerLight1010Checks, cases1010, SIZES1010, leavingReadCancellation } from './pointer_light_1010_native.mjs';

const api = await import(process.env.AIM_PLAYWRIGHT_CORE), out = process.argv[2];
const requestedEngine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const root = process.env.AIM_SOURCE_DIR ?? process.cwd(), red = process.argv.includes('--red');
const patternAt = process.argv.indexOf('--case'), pattern = patternAt < 0 ? null : new RegExp(process.argv[patternAt + 1]);
const cases = cases1010().filter(c => red ? c.id === 'L-bookends' && c.size === 'laptop' && c.theme === 'light' : pattern ? pattern.test(`${c.id}-${c.size}-${c.theme}`) : true);
assert.ok(cases.length); await mkdir(out, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex'), hashes = {};
for (const file of ['web/aim.css','web/notebook-passages.mjs','web/message-format.mjs','web/interaction-guide.mjs','web/look.mjs','web/look-touch.css','web/feed-passages.mjs','web/reader.mjs','web/pointer-light.mjs','web/pane-keys.mjs','web/message-menu.mjs','web/stack-feed.mjs','web/reply-stacks.mjs','web/in-place-navigation.mjs','web/app.mjs','web/compose-bar.mjs','tests/fixtures/ui_http.py']) hashes[file] = await readFile(join(root,file)).then(hash,error=>{if((red||process.argv.includes('--notebook-only'))&&error.code==='ENOENT')return null;throw error;});
hashes.producer = hash(await readFile(new URL('./pointer_light_1010_native.mjs',import.meta.url)));
hashes.driver = hash(await readFile(new URL(import.meta.url)));
await mkdir(join(out,'source','web'),{recursive:true});await mkdir(join(out,'source','tests'),{recursive:true});
for(const file of Object.keys(hashes).filter(f=>f.startsWith('web/')))if(hashes[file]!==null)await writeFile(join(out,'source',file),await readFile(join(root,file)));
await writeFile(join(out,'source','tests','pointer_light_1010_native.mjs'),await readFile(new URL('./pointer_light_1010_native.mjs',import.meta.url)));
await writeFile(join(out,'source','tests','pointer_light_1010_run.mjs'),await readFile(new URL(import.meta.url)));

const load = Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]);assert.ok(load<12,`load ${load} must be below12/18`);
const fixture = spawn('/usr/bin/python3', ['-I','-X',`pycache_prefix=${out}/pycache`,'-c',
  'import pathlib,runpy,sys; source=pathlib.Path(sys.argv[1]); sys.path.insert(0,str(source.parent)); sys.argv=sys.argv[1:]; runpy.run_path(str(source),run_name="__main__")',
  join(root,'tests/fixtures/ui_http.py'),'--live','--agent-colors','--other-person','--item-785','--freshness','--images','--media'], {cwd:root});
const {control,exit,errors:fixtureErrors} = fixtureControl(fixture);
const result = {requestedEngine,source:root,mode:red?'red287':process.argv.includes('--notebook-only')?'notebook-only':'candidate',hashes,cases:[],observations:[],cleanup:{fixturePid:fixture.pid},failure:null};
let browser,profile,facts,lastPage,cdp;
const rows = () => execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{const m=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?{pid:+m[1],parent:+m[2],command:m[3]}:null;}).filter(Boolean);
const owned = new Set();
async function observe() {
  if(cdp)for(const p of (await cdp.send('SystemInfo.getProcessInfo')).processInfo)owned.add(p.id);
  const processes=rows();for(const p of processes)if(p.command.includes(profile))owned.add(p.pid);
  for(let changed=true;changed;){changed=false;for(const p of processes)if(owned.has(p.parent)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}
}
try {
  facts=await control({method:'ready'});result.runtime={origin:facts.origin,actor:facts.actor};result.servedHashes={};for(const [file,digest]of Object.entries(hashes)){if(!file.startsWith('web/')||digest===null)continue;const r=await fetch(facts.origin+'/'+file.slice(4));assert.equal(r.status,200);const actual=hash(Buffer.from(await r.arrayBuffer()));assert.equal(actual,digest,'served owner '+file);result.servedHashes[file]=actual;}
  if(requestedEngine==='webkit'){
    profile=await mkdtemp(join(tmpdir(),'page-lane6-1010-webkit-'));
    const context=await api.webkit.launchPersistentContext(profile,{headless:true});browser=context.browser();assert.ok(browser);
  } else {
    browser=await api.chromium.launch({executablePath:process.env.AIM_CHROME,headless:true,args:['--enable-automation']});
    cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(a=>a.startsWith('--user-data-dir='))?.slice(16);assert.ok(profile);
  }
  result.engine=browser.browserType().name();result.version=browser.version();assert.equal(result.engine,requestedEngine);await observe();assert.ok(owned.size);
  result.qualifications=requestedEngine==='webkit'?["Tab uses native Option-Tab, Safari's existing all-controls key; plain Tab skips buttons by default.","No native WebKit composition API; IME remains unrun here."]:[];
  const until=async(fn,why)=>{const end=Date.now()+10000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+why);};
  const bySlug=new Map(cases.map(c=>[`reading-1010-${c.id}-${c.size}-${c.theme}`,c]));
  const pageFactory=async(slug,_size,_theme,{url,beforeNavigate})=>{
    const spec=bySlug.get(slug);assert.ok(spec);const metrics=SIZES1010[spec.size];
    const context=await browser.newContext({viewport:{width:metrics.width,height:metrics.height},hasTouch:metrics.mobile,isMobile:metrics.mobile,colorScheme:spec.theme});
    const page=await context.newPage();lastPage=page;page.setDefaultTimeout(10000);const errors=[];let leaving=false;
    page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())leaving=true;});
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())leaving=false;});
    page.on('requestfailed',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())leaving=false;});
    page.on('pageerror',e=>{if(leavingReadCancellation(e,requestedEngine,leaving))result.observations.push({name:'leaving page read cancelled',case:slug,message:e.message,stack:e.stack});else{errors.push(e.message);result.observations.push({name:'unexpected page error',case:slug,message:e.message,stack:e.stack});console.error('Owned page error: '+e.message);}});
    const session=requestedEngine==='chromium'?await context.newCDPSession(page):null;
    let touch=null;
    const p={errors,slug,evaluate:expression=>page.evaluate(expression),
      async key(key,modifiers=0){const names=[];if((modifiers&1)||(requestedEngine==='webkit'&&key==='Tab'))names.push('Alt');if(modifiers&2)names.push('Control');if(modifiers&4)names.push('Meta');if(modifiers&8)names.push('Shift');await page.keyboard.press([...names,key].join('+'));},
      async send(method,args={}){
        if(method==='Page.reload'){await page.waitForFunction(()=>!window.probe1010?.pending);return page.reload();}
        if(method==='Page.navigate'){await page.waitForFunction(()=>!window.probe1010?.pending);return page.goto(args.url);}
        if(method==='Page.addScriptToEvaluateOnNewDocument')return page.addInitScript(args.source);
        if(method==='Emulation.setDeviceMetricsOverride')return page.setViewportSize({width:args.width,height:args.height});
        if(method==='Emulation.setTouchEmulationEnabled'){assert.equal(Boolean(args.enabled),metrics.mobile);return;}
        if(method==='Emulation.setEmulatedMedia')return page.emulateMedia({colorScheme:args.features.find(x=>x.name==='prefers-color-scheme')?.value});
        if(method==='Input.dispatchMouseEvent'){
          if(args.type==='mouseMoved')return page.mouse.move(args.x,args.y);
          if(args.type==='mousePressed')return page.mouse.down({button:args.button});
          if(args.type==='mouseReleased')return page.mouse.up({button:args.button});
        }
        if(method==='Input.dispatchTouchEvent'){
          if(args.type==='touchStart'){touch=args.touchPoints[0];return;}
          if(args.type==='touchEnd'){assert.ok(touch);const point=touch;touch=null;return page.touchscreen.tap(point.x,point.y);}
        }
        if(method==='Input.insertText')return page.keyboard.insertText(args.text);
        if(method==='Input.imeSetComposition'){assert.ok(session,'native IME requires Chromium CDP');return session.send(method,args);}
        throw Error('Unsupported native driver call: '+method);
      },
      async close(){await observe();await context.close();},
      // Capture the promised viewport without resizing it: full-page capture
      // can move fixed sheets/anchors and close the native menu being read.
      screenshot:path=>page.screenshot({path,fullPage:false}),
    };
    await beforeNavigate(p);await page.goto(url);await observe();return p;
  };
  const failures=[];
  const check=async(name,run)=>{const cell={name};result.cases.push(cell);try{await run();cell.passed=true;console.log(JSON.stringify({name,passed:true}));}catch(e){cell.passed=false;cell.error=e.stack;console.log(JSON.stringify({name,passed:false,error:e.message}));failures.push(e);if(!process.argv.includes('--continue'))throw e;}};
  await pointerLight1010Checks({check,page:pageFactory,until,control,facts,observations:result.observations,engine:requestedEngine==='chromium'?'chrome':'webkit',
    shot:async(p,name)=>{await p.screenshot(`${out}/${name.replace(/[^a-zA-Z0-9._-]/g,'_')}.png`);}}, {seed:readingSeed(control),cases});
  if(failures.length)throw Error(failures.map(e=>e.stack).join('\n\n'));
} catch(error) {
  result.failure=error.stack;
  if(lastPage&&!lastPage.isClosed()){await lastPage.screenshot({path:`${out}/driver-failure.png`,fullPage:false});await writeFile(`${out}/driver-failure.html`,await lastPage.content());}
} finally {
  if(browser){
    try { await observe(); } catch(error) { result.cleanup.observeError=error.stack; }
    await browser.close();result.cleanup.browserClosed=!browser.isConnected();
  }
  fixture.stdin.end();result.cleanup.fixtureExit=await exit;result.cleanup.fixtureErrors=fixtureErrors();
  const processes=rows();result.cleanup.profile=profile;result.cleanup.observedBrowserPids=[...owned];
  result.cleanup.profileProcesses=profile?processes.filter(p=>p.command.includes(profile)):[];result.cleanup.remainingObservedPids=[...owned].filter(pid=>processes.some(p=>p.pid===pid));
  result.cleanup.fixtureAbsent=!processes.some(p=>p.pid===fixture.pid);
  if(requestedEngine==='webkit'&&result.cleanup.browserClosed&&!result.cleanup.profileProcesses.length&&!result.cleanup.remainingObservedPids.length)await rm(profile,{recursive:true,force:true});
  result.cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):false;
  if(facts)result.cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
  await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
}
assert.deepEqual(result.cleanup.fixtureExit,{code:0,signal:null});assert.equal(result.cleanup.fixtureErrors,'');assert.equal(result.cleanup.browserClosed,true);
assert.deepEqual(result.cleanup.profileProcesses,[]);assert.deepEqual(result.cleanup.remainingObservedPids,[]);assert.equal(result.cleanup.fixtureAbsent,true);assert.equal(result.cleanup.profileAbsent,true);assert.equal(result.cleanup.portClosed,true);
if(result.failure)throw Error(result.failure);
