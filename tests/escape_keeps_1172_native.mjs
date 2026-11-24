// One Chromium cell,390x844. Native CDP taps/text exercise actual app form
// functions, ThingsRail and field owners through named memory API/destination ports.
// No full-app bootstrap, physical-device, Safari or software-keyboard claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { devtoolsControl, endRun } from './devtools_control.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidence] = process.argv.slice(2);
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(evidence && path.isAbsolute(evidence));
await mkdir(evidence, { recursive: true });
const deadline = Date.now() + 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, name, bound = 5000) {
  const end = Math.min(deadline, Date.now() + bound);
  while (Date.now() < end) { const value = await probe(); if (value) return value; await sleep(25); }
  throw Error(`1172 timeout: ${name}`);
}
const requests=[],errors=[],checks=[];
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;margin:20px}button,input{font:inherit;min-height:44px}dialog{width:340px;max-width:90vw}#things1172{position:fixed;inset:30px;background:white;padding:20px;overflow:auto}html:not([data-things-open]) #things1172{display:none}#backdrop1172{position:fixed;inset:0;background:#ddd}</style></head><body><button id="things-open">Things</button><div id="backdrop1172" hidden></div><aside id="things1172"></aside><dialog id="test-reader"><button id="reader-menu">More</button><button id="start-from-message">Start a topic</button><button id="pipeline-open">Add to pipeline</button><div id="pipeline-add" hidden></div></dialog><script type="module" src="/fixture1172.mjs"></script></body></html>`;
const server=createServer(async(req,res)=>{
 const route=new URL(req.url,'http://fixture').pathname;requests.push(route);
 try{
  let body,type='text/javascript';
  if(route==='/'){body=html;type='text/html';}
  else if(route==='/fixture1172.mjs')body=await readFile(path.join(root,'tests/fixtures/escape_keeps_1172_browser.mjs'));
  else if(route==='/app-forms1172.mjs'){
   const source=await readFile(path.join(root,'web/app.mjs'),'utf8');
   const from=source.indexOf('let startLine = null;'),to=source.indexOf('function paintReaderMark()',from);
   assert.ok(from>=0&&to>from,'actual app form source boundaries');
   body='const {$,OneLine,TopicStart,firstSentence,titleLine,pipelineHref,firstLine,bootstrap,api,registry,topic,mayStartFrom,run,node,openDestination}=globalThis.ports1172;let pipelineAddFor=null;\n'+source.slice(from,to)+'\nexport {openStartLine,openPipelineAdd};';
  }else if(/^\/web\/[a-z0-9-]+\.mjs$/.test(route))body=await readFile(path.join(root,route.slice(1)));
  else{res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
 }catch(error){errors.push({route,error:String(error)});res.writeHead(500).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-phone-sheet-1172-'));
let child, exited, socket, cdp, failure;
// A bounded caller may stop this Node owner. Close only our Chrome through
// CDP; neither this fixture nor its caller sends a signal to Chrome.
process.once('SIGTERM', () => {
  failure ??= '1172 caller requested bounded cleanup';
  if (cdp) cdp('Browser.close').catch(() => {});
});
try {
  const args = ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  await writeFile(path.join(evidence, 'chrome-argv.json'), JSON.stringify([chromePath, ...args]));
  child = spawn(chromePath, args, { stdio: 'ignore' });
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.once('error', error => { failure = String(error); });
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'Chrome endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await Promise.race([new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  }), sleep(5000).then(() => { throw Error('1172 socket open timeout'); })]);
  const control = devtoolsControl(socket, { bound: 5000, event: packet => {
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
  } });
  cdp = control.cdp; exited.then(result => control.end(JSON.stringify(result)));
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => {
    if (Date.now() >= deadline) throw Error('1172 cell work deadline');
    return cdp(method, params, sessionId);
  };
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Inspector.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: origin });
  await until(()=>evaluate('document.body?.dataset.fixture1172 === "ready"'),'fixture ready');
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const tap=async selector=>{
    const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    assert.ok(r.width>0&&r.height>0,'native visible control '+selector);
    const point={x:r.x+r.width/2,y:r.y+Math.min(16,r.height/2)};
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  };
  const escape=async()=>{await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await settle();};
  const type=async(selector,text)=>{await tap(selector);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',modifiers:4,commands:['selectAll']});await send('Input.insertText',{text});await settle();};
  await evaluate('fixture1172.openReader()');await tap('#start-from-message');await type('#start-topic-title','Native topic1172');await escape();
  await until(()=>evaluate('fixture1172.destinations.length===1'),'topic confirmed');
  assert.deepEqual(await evaluate('({open:document.querySelector("#test-reader").open,field:!!document.querySelector("#start-topic-title"),title:fixture1172.commands[0].args.title,focus:document.activeElement.id})'),{open:true,field:false,title:'Native topic1172',focus:'reader-menu'});
  await escape();assert.equal(await evaluate('document.querySelector("#test-reader").open'),false);checks.push('1172 native actual app topic form saves and second Escape closes Reader');
  await evaluate('fixture1172.openReader()');await tap('#pipeline-open');await type('#pipeline-add input','Native item1172');await escape();
  await until(()=>evaluate('!document.querySelector("#pipeline-add input")'),'item confirmed');
  assert.deepEqual(await evaluate('({open:document.querySelector("#test-reader").open,args:fixture1172.commands.find(x=>x.kind==="pipeline.item_add").args})'),{open:true,args:{title:'Native item1172',section:'candidates',candidate_group:'',sources:[{message_id:'source1172'}]}});
  await escape();assert.equal(await evaluate('document.querySelector("#test-reader").open'),false);checks.push('1172 native actual app pipeline form retains exact source and stops first Escape');
  await evaluate('fixture1172.refused=true;fixture1172.openReader()');await tap('#start-from-message');await type('#start-topic-title','Refused1172');await escape();
  const refused=await evaluate('({open:document.querySelector("#test-reader").open,value:document.querySelector("#start-topic-title").value,focus:document.activeElement.id,reason:document.querySelector(".one-line-state").textContent})');
  assert.equal(refused.open,true);assert.equal(refused.value,'Refused1172');assert.equal(refused.focus,'start-topic-title');assert.match(refused.reason,/1172 refused/);
  await evaluate('fixture1172.refused=false');await escape();await until(()=>evaluate('fixture1172.destinations.length===2'),'same-owner retry');await escape();checks.push('1172 native refusal keeps exact writing focus and reason; Escape retry succeeds');
  await evaluate('fixture1172.openLink()');await type('#things1172 input[aria-label="Link title"]','Native link1172');await escape();
  assert.deepEqual(await evaluate('({open:fixture1172.rail.isOpen(),hidden:fixture1172.rail.links.form.hidden,title:fixture1172.commands.find(x=>x.kind==="workspace.link_set").args.title})'),{open:true,hidden:true,title:'Native link1172'});
  await escape();assert.equal(await evaluate('fixture1172.rail.isOpen()'),false);checks.push('1172 native phone Things listener respects consumed Link Escape and closes on second');
  assert.deepEqual(errors, []);
} catch (error) { failure = error.stack; }
await endRun({ child, exited, close: cdp && (() => cdp('Browser.close')), socket, server, grace: 5000 }, async cleanup => {
  if (!cleanup.closed || cleanup.left) failure ??= '1172 owned Chrome did not close cleanly';
  if (cleanup.closed && !cleanup.left) await rm(profile, { recursive: true, force: true });
  const result = { viewport: [390,844], checks, failure: failure ?? null, cleanup, profile, chromePid: child?.pid, requests, errors,
    limitation: 'One Chromium390x844 cell, actual app form bodies loaded from source and actual ThingsRail/WorkspaceLinks. Access/API/destination are memory ports; no Core persistence, full app bootstrap, physical iPhone, Safari or software-keyboard proof.' };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  process.exitCode = failure ? 1 : 0; return JSON.stringify(result);
});
