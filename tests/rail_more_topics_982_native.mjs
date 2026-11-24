// Full app, real Core pages and native rail navigation. No synthetic click or timing claim.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const {chromium}=await import(process.env.AIM_PLAYWRIGHT_CORE);
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const records=[],failures=[],errors=[],marker=`theseus-982-${process.pid}`;
const check=async(name,act)=>{try{await act();records.push({name,pass:true});}catch(error){failures.push({name,error:error.stack});}};
const hashes={};for(const f of ['web/topic-navigation.mjs','web/outline-rail.mjs','web/rail-topic-fold.mjs','web/rails.css','web/app.mjs'])hashes[f]=createHash('sha256').update(await readFile(f)).digest('hex');
records.push({source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,harness:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')});
const child=spawn('/usr/bin/python3',['tests/fixtures/ui_http.py','--freshness','--live']);
const {control,exit}=fixtureControl(child);let browser,page,facts,profile;
const workspace='more982',topics=Array.from({length:24},(_,n)=>({id:'more982-'+String(n).padStart(2,'0'),title:'More982 topic '+n,workspace_id:workspace}));
const visible=el=>!el.hidden&&!el.closest('[inert]')&&el.getClientRects().length>0;
try{
 facts=await control({method:'ready'});
 await control({method:'navigation_workspaces',workspaces:[{id:workspace,title:'More topics source',purpose:'Paging truth'}]});
 await control({method:'navigation_topics',topics});
 for(const topic of topics.slice(21))await control({method:'topic_state',operation_id:topic.id+'-done',topic_id:topic.id,args:{state:'done'}});
 const core=await control({method:'agent_view',actor:facts.actor,name:'workspace_topics',args:{workspace_id:workspace,build:false,limit:100}});
 assert.equal(core.items.length,21);assert.equal(core.groups.done,3);const expected=core.items.map(x=>x.id);
 records.push({phase:'actual-Core-truth',ids:expected,groups:core.groups});
 browser=await chromium.launch({headless:true,executablePath:process.env.AIM_CHROME,args:['--enable-automation',`--${marker}`]});
 records.push({actualEngine:browser.browserType().name(),browserVersion:browser.version()});assert.equal(browser.browserType().name(),'chromium');
 const cdp=await browser.newBrowserCDPSession();profile=(await cdp.send('Browser.getBrowserCommandLine')).arguments.find(x=>x.startsWith('--user-data-dir='))?.slice(16);await cdp.detach();assert.ok(profile);
 await writeFile(evidence+'/ownership.json',JSON.stringify({marker,profile,fixturePid:child.pid,origin:facts.origin},null,2));
 const cells=process.argv.includes('--quick')?[['Bookends','light']]:['Bookends','Paper'].flatMap(look=>['light','dark'].map(theme=>[look,theme]));
 for(const [look,theme]of cells){
  const key=look+'-'+theme,context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:theme});
  await context.addInitScript(()=>{window.document982=crypto.randomUUID();});page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push({key,error:e.message}));
  await page.goto(facts.origin+'/?topic='+expected[0]);await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.getByRole('button',{name:look,exact:true}).click();
  const conversation=(await control({method:'agent_view',actor:facts.actor,name:'conversation',args:{workspace_id:workspace}})).conversation;
  if(conversation&&!expected.includes(conversation.topic_id))expected.push(conversation.topic_id);
  records.push({key,phase:'Core-conversation',conversation,expected:[...expected]});
  const outcome=page.locator(`.ol-outcome[data-workspace-id="${workspace}"]`);await outcome.waitFor();
  // 1161 deliberately folds More and later topics. Reveal the actual list
  // before pressing a control, as a person does, rather than clicking a
  // clipped button whose own DOM rectangle still exists.
  const reveal=async()=>{
   await outcome.locator('.ol-own').hover({position:{x:30,y:10}});
   await page.waitForFunction(workspace=>{const a=document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"] .ol-own`),h=a?.querySelector('.ol-topic-list');return h&&getComputedStyle(h).maskImage==='none'&&h.clientHeight>=h.scrollHeight-1;},workspace,{timeout:5000});
  };
  if(await outcome.locator('.ol-topics').evaluate(el=>el.hidden))await outcome.locator('.ol-disclosure').click();
  const settled=()=>page.waitForFunction(workspace=>{const o=document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"]`);if(!o||document.body.dataset.ready!=='true')return false;const shown=n=>!n.hidden&&!n.closest('[inert]')&&n.getClientRects().length>0;return[...o.querySelectorAll('a[data-topic-id]')].some(shown)&&![...o.querySelectorAll('button')].some(n=>shown(n)&&n.getAttribute('aria-disabled')==='true');},workspace);
  const state=()=>outcome.evaluate(el=>{const shown=n=>!n.hidden&&!n.closest('[inert]')&&n.getClientRects().length>0;return{ids:[...el.querySelectorAll('a[data-topic-id]')].filter(shown).map(n=>n.dataset.topicId),more:[...el.querySelectorAll('button')].some(n=>n.textContent==='More topics'&&shown(n)),done:[...el.querySelectorAll('summary')].filter(shown).map(n=>n.textContent).find(t=>t.startsWith('Done')),document:window.document982,url:location.search};});
  await settled();const originalDoc=await page.evaluate(()=>window.document982);
  const trace=async phase=>{await page.mouse.move(1200,900);await settled();const s=await state(),unshown=expected.filter(id=>!s.ids.includes(id));records.push({key,phase,...s,unshown});await check(key+' '+phase+' More matches actual unseen Core rows',async()=>assert.equal(s.more,unshown.length>0));await check(key+' '+phase+' Done count stays3',async()=>assert.equal(s.done,'Done (3)'));await check(key+' '+phase+' outline has no read warning',async()=>assert.equal(await page.locator('#outline .notice:visible').count(),0));return s;};
  const initial=await trace('initial');assert.equal(initial.more,true);
  await check(key+' 1161 seven full rows and fading eighth retain all accessible topics',async()=>{
   await page.waitForFunction(workspace=>{const a=document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"] .ol-own`);if(!a?.hasAttribute('data-topic-fold')||a.matches(':hover,:focus-within'))return false;const h=a.querySelector('.ol-topic-list');return Math.abs(h.getBoundingClientRect().height-parseFloat(a.style.getPropertyValue('--topic-fold-end')))<1;},workspace,{timeout:5000});
   const at=await outcome.locator('.ol-own').evaluate(a=>{const h=a.querySelector('.ol-topic-list'),rows=[...h.querySelectorAll(':scope>a[data-topic-id]')],box=h.getBoundingClientRect(),seventh=rows[6].getBoundingClientRect(),eighth=rows[7].getBoundingClientRect();return{loaded:rows.length,seventhEnd:seventh.bottom,hostEnd:box.bottom,peek:(box.bottom-eighth.top)/eighth.height,mask:getComputedStyle(h).maskImage,footer:a.querySelector('.ol-topic-foot').getBoundingClientRect().height,names:rows.map(r=>r.textContent)};});
   assert.ok(at.loaded>8);assert.ok(at.seventhEnd<=at.hostEnd+1);assert.ok(Math.abs(at.peek-.85)<.05);assert.match(at.mask,/linear-gradient/);assert.equal(at.footer,0);
   const ax=await context.newCDPSession(page);try{const tree=await ax.send('Accessibility.getFullAXTree');assert.ok(tree.nodes.some(n=>!n.ignored&&n.name?.value?.includes('More982 topic')));}finally{await ax.detach();}
   records.push({phase:'1161-native-rest',...at});
  });
  await check(key+' 1161 hover exposes More topics at the list foot',async()=>{
   await reveal();const at=await outcome.locator('.ol-own').evaluate(a=>({footer:a.querySelector('.ol-topic-foot').getBoundingClientRect().height,mask:getComputedStyle(a.querySelector('.ol-topic-list')).maskImage}));
   assert.ok(at.footer>0);assert.equal(at.mask,'none');records.push({phase:'1161-native-hover',...at});
  });
  await check(key+' 1161 native arrows reach a topic beyond seven without navigating',async()=>{
   await page.mouse.move(1200,900);await outcome.locator('.ol-name').focus();const before=page.url(),focused=[];
   for(let n=0;n<10;n++){await page.keyboard.press('ArrowDown');focused.push(await page.evaluate(()=>document.activeElement?.dataset.topicId??null));}
   const at=await outcome.locator('.ol-own').evaluate(a=>({focus:a.contains(document.activeElement),mask:getComputedStyle(a.querySelector('.ol-topic-list')).maskImage}));
   assert.ok(focused.filter(Boolean).length>=8);assert.equal(at.focus,true);assert.equal(at.mask,'none');assert.equal(page.url(),before);records.push({phase:'1161-native-keys',focused,...at});
  });
  await reveal();
  await outcome.locator('button:visible').filter({hasText:/^More topics$/}).click();await page.waitForFunction(({workspace,total})=>{const o=document.querySelector(`.ol-outcome[data-workspace-id="${workspace}"]`);return[...o.querySelectorAll('a[data-topic-id]')].filter(n=>!n.closest('[inert]')&&n.getClientRects().length).length===total;},{workspace,total:expected.length});
  await trace('after-More');
  for(const [phase,target]of [['topic',core.items[1].id],['tail-topic',core.items.at(-1).id],['home',null],['topic-again',core.items[0].id]]){
   await reveal();
   if(target)await outcome.locator(`a[data-topic-id="${target}"]:visible`).first().click();else await outcome.locator('.ol-name').click();
   await page.waitForFunction(({target,workspace})=>{const q=new URL(location.href).searchParams;return document.body.dataset.ready==='true'&&(target?q.get('topic')===target:q.get('workspace')===workspace);},{target,workspace});
   const s=await trace(phase);await check(key+' '+phase+' native navigation keeps document and loaded extent',async()=>{assert.equal(s.document,originalDoc);assert.deepEqual([...s.ids].sort(),[...expected].sort());assert.equal(s.more,false);});
   if(s.more){await reveal();await outcome.locator('button:visible').filter({hasText:/^More topics$/}).click();}
  }
  await page.screenshot({path:evidence+'/'+key+'.png',fullPage:true});await context.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){failures.push({fatal:error.stack});await writeFile(evidence+'/failure-before-cleanup.json',JSON.stringify({records,failures,errors},null,2));if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true}).catch(()=>{});}
finally{
 if(browser){
  const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);return m&&{pid:+m[1],parent:+m[2],command:m[3]};}).filter(Boolean);
  const owned=new Set(rows.filter(r=>r.command.includes(marker)||profile&&r.command.includes(profile)).map(r=>r.pid));for(let n=0;n<rows.length;n++)for(const r of rows)if(owned.has(r.parent))owned.add(r.pid);
  await browser.close();const live=new Set(execFileSync('ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));const remaining=[...owned].filter(p=>live.has(p));
  // The engine's temporary-directory removal can follow Browser.close.
  // Remove only our exact retained profile after its Chrome PIDs are gone.
  if(!remaining.length&&profile&&/^\/(?:private\/)?var\/folders\/.*\/T\/playwright_chromiumdev_profile-/.test(profile))await rm(profile,{recursive:true,force:true});
  const profileAbsent=await access(profile).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;});
  records.push({browserClosed:!browser.isConnected(),ownedPids:[...owned],remaining,profile,profileAbsent});
  if(remaining.length||!profileAbsent)failures.push({cleanup:'Browser PID/profile cleanup did not complete',remaining,profileAbsent});
 }
 child.stdin.end();const ended=await exit;let absent=false;try{process.kill(child.pid,0);}catch(e){absent=e.code==='ESRCH';}
 const portClosed=!facts||await new Promise(resolve=>{const s=net.connect(new URL(facts.origin).port,'127.0.0.1');s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});
 records.push({fixture:ended,fixturePid:child.pid,absent,portClosed,errors,failures});await writeFile(evidence+'/results.json',JSON.stringify(records,null,2));assert.deepEqual(ended,{code:0,signal:null});assert.equal(absent,true);assert.equal(portClosed,true);
}
if(failures.length){process.stderr.write(JSON.stringify(failures,null,2)+'\n');process.exitCode=1;}
