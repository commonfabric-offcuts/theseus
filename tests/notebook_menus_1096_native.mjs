//1096: real Notebook palettes, native pointer/keys/touch and scratch HTTP/Core.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,access,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_BROWSER??'chromium';
const evidence=process.argv[2],width=Number(process.argv[3]??1280),theme=process.argv[4]??'dark';await mkdir(evidence,{recursive:true});
const report={engine,width,theme,gates:[],events:[],results:[],served:{},pageErrors:[],httpReceipts:[],cleanup:{}};
const stamp=(name,extra={})=>report.events.push({name,utc:new Date().toISOString(),...extra});
const checkpoint=()=>writeFile(evidence+'/checkpoint.json',JSON.stringify(report,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const gate=name=>{const raw={name,utc:new Date().toISOString(),load:os.loadavg(),cpus:os.cpus().length};report.gates.push(raw);assert.ok(raw.cpus===18&&raw.load[0]<12,'RESOURCE HOLD '+JSON.stringify(raw));};
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,stat=,command='],{encoding:'utf8'}).split('\n').filter(Boolean).map(line=>({pid:Number(line.trim().split(/\s+/)[0]),ppid:Number(line.trim().split(/\s+/)[1]),raw:line}));
const owned=new Map();let profile;
function retain(){let list=ps();for(let again=true;again;){again=false;for(const p of list)if((p.ppid===process.pid||owned.has(p.ppid)||profile&&p.raw.includes(profile))&&!owned.has(p.pid)){owned.set(p.pid,p.raw);again=true;}}}
async function absent(path){try{await access(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
const refusal=origin=>new Promise(resolve=>{const u=new URL(origin),socket=net.createConnection({host:u.hostname,port:Number(u.port)});let done=false;const end=code=>{if(done)return;done=true;socket.destroy();resolve({origin,code,utc:new Date().toISOString()});};socket.setTimeout(2500);socket.once('connect',()=>end('CONNECTED'));socket.once('timeout',()=>end('TIMEOUT'));socket.once('error',e=>end(e.code));});
let fixture,control,exit,stdio,errors,browser,page,origin,failure;const captures=[],capturedOwners=new Set();
const capture=task=>{task.catch(()=>{});captures.push(task);};
const observed=task=>{task.catch(()=>{});return task;};
const drain=async()=>{await Promise.all(captures);};
const navigate=async url=>{await drain();await checkpoint();return page.goto(url);};
try{
 gate('immediately-before-fixture');stamp('fixture-spawn');
 fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--teardown-observations',evidence+'/teardown.jsonl']);
 stdio=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal,utc:new Date().toISOString()})));
 ({control,exit,errors}=fixtureControl(fixture));retain();report.fixturePid=fixture.pid;
 const facts=await control({method:'ready'});origin=facts.origin;report.origin=origin;await checkpoint();
 profile=await mkdtemp(evidence+'/'+engine+'-profile-');report.profile=profile;await checkpoint();
 gate('immediately-before-browser');stamp('browser-launch');
 const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{executablePath:process.env.AIM_WEBKIT})});browser=persistent.browser();retain();report.browserVersion=browser.version();
 const context=await browser.newContext({viewport:{width,height:960},colorScheme:theme,isMobile:width<760,hasTouch:width<760});page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.pageErrors.push(e.stack||e.message));
 // Capture each owner's first loaded body. Later navigations use the same
 // immutable fixture files; repeated/cache responses need no second body read.
 // A first capture error still fails the run and remains in the raw report.
 page.on('response',r=>{const path=new URL(r.url()).pathname;if(!/\/(?:notebook-(?:menu|start|page|sheet|rail-menu)|deck-page|quick-create|outline-menus|app|glyphs)\.(?:mjs|css)$/.test(path)||capturedOwners.has(path))return;capturedOwners.add(path);capture(r.body().then(async b=>{const name=path.split('/').at(-1);report.served[name]={bytes:b.length,sha256:hash(b)};await writeFile(evidence+'/served-'+name,b);}));});
 const id='notebook1096-'+engine+'-'+width+'-'+theme,title='Notebook1096 '+width+' '+theme,body='## First\n\nFirst exact writing.\n\n## Second\n\nSecond exact writing.\n';
 assert.equal((await control({method:'agent_page',operation_id:id+'-create',item_id:id,topic_id:'t1',title,body})).status,'committed');
 const source=()=>control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:id}});
 const press=locator=>width<760?locator.tap():locator.click();
 const command=(kind,accept=()=>true)=>observed(page.waitForResponse(r=>{try{const request=r.request().postDataJSON();return request?.kind===kind&&accept(request);}catch{return false;}}));
 const full=async()=>{await navigate(origin+'/?cards='+id+'&view=cards');await page.locator('#deck-page .deck-card').nth(1).waitFor();};
 const action=(menu,key)=>menu.locator('[data-notebook-action="'+key+'"]');
 const menuOf=name=>page.getByRole('menu',{name,exact:true});
 const keys=menu=>menu.locator('button').evaluateAll(es=>es.map(e=>({key:e.dataset.notebookAction,label:e.getAttribute('aria-label')??e.textContent,disabled:e.disabled,pressed:e.getAttribute('aria-pressed'),checked:e.getAttribute('aria-checked')})));
 async function palette(menu,first){
  await menu.waitFor();assert.equal(await menu.evaluate(n=>n.classList.contains('notebook-palette')),true);
  const initial=await menu.evaluate(n=>({key:document.activeElement.dataset.notebookAction,active:document.activeElement.outerHTML,connected:n.isConnected}));
  report.events.push({name:'palette-first-focus',first,...initial});await checkpoint();assert.equal(initial.key,first);
  if(width<760){assert.equal(await menu.evaluate(n=>n.classList.contains('menu-sheet')),true);const small=await menu.locator('button').evaluateAll(es=>es.filter(e=>!e.disabled).map(e=>({key:e.dataset.notebookAction,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(r=>r.w<43.5||r.h<43.5));assert.deepEqual(small,[],'every coarse target is44px');}
  const enabled=(await keys(menu)).filter(x=>!x.disabled).map(x=>x.key),at=enabled.indexOf(first);
  for(let n=1;n<=enabled.length;n++){await page.keyboard.press('ArrowDown');assert.equal(await menu.evaluate(n=>document.activeElement.dataset.notebookAction),enabled[(at+n)%enabled.length]);}
 }
 await full();const pageMore=page.locator('#deck-page .notebook-menu');await press(pageMore);let menu=menuOf('This page');await palette(menu,'text');
 let pageKeys=(await keys(menu)).map(x=>x.key);assert.deepEqual(pageKeys,['star','draft','copy','text','cards','start-topic','start-dossier','image','rename','delete','edit','undo','new']);
 await page.screenshot({path:evidence+'/full-page-menu.png'});await page.keyboard.press('Escape');assert.equal(await pageMore.evaluate(n=>n===document.activeElement),true);
 await press(pageMore);await press(action(menu,'text'));await page.locator('#deck-page .notebook-text').waitFor();assert.equal((await source()).body,body);
 await press(pageMore);menu=menuOf('This page');assert.equal(await action(menu,'text').getAttribute('aria-checked'),'true');await press(action(menu,'cards'));await page.locator('#deck-page .deck-card').nth(1).waitFor();
 const cardMore=()=>page.locator('#deck-page .deck-card').first().locator('.deck-menu');await press(cardMore());menu=menuOf('This card');await palette(menu,'copy-text');
 const cardKeys=await keys(menu),swatches=cardKeys.filter(x=>x.key.startsWith('color-'));assert.equal(swatches.length,9);assert.equal(swatches[0].key,'color-none');assert.equal(swatches[0].pressed,'true');
 await page.screenshot({path:evidence+'/card-menu.png'});
 let saved=command('memory.revise');await press(action(menu,'color-blue'));assert.equal((await(await saved).json()).status,'committed');assert.match((await source()).body,/"color"\s*:\s*"blue"/);
 await press(cardMore());menu=menuOf('This card');assert.equal(await action(menu,'color-blue').getAttribute('aria-pressed'),'true');saved=command('memory.revise');await press(action(menu,'color-none'));assert.equal((await(await saved).json()).status,'committed');assert.doesNotMatch((await source()).body,/"color"\s*:\s*"blue"/);
 // New image entry reuses the native file chooser and the existing image/save owner.
 await press(cardMore());menu=menuOf('This card');const picker=observed(page.waitForEvent('filechooser'));await press(action(menu,'image'));
 const png=await readFile('tests/fixtures/media/one.png');assert.equal(hash(png),'b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640');
 report.selectedImage={path:'tests/fixtures/media/one.png',bytes:png.length,sha256:hash(png)};await checkpoint();const uploaded=observed(page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/media/upload'));const imageSaved=command('memory.revise',request=>request.args.attachments?.length===1);await(await picker).setFiles({name:'1096-own.png',mimeType:'image/png',buffer:png});await page.locator('#deck-page .deck-writing textarea').waitFor();
 await page.waitForFunction(()=>{const figures=[...document.querySelectorAll('#deck-page .deck-writing .deck-image')];return figures.length&&figures.every(f=>f.querySelector('img')?.complete&&f.querySelector('img')?.naturalWidth>0&&!f.hasAttribute('data-state')&&f.querySelector('.deck-image-name')?.textContent==='1096-own.png');});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#deck-page .deck-writing'));
 const imageResponse=await imageSaved,imageReceipt=await imageResponse.json();report.httpReceipts.push({kind:'memory.revise',request:imageResponse.request().postDataJSON(),response:imageReceipt});report.imageUpload={httpStatus:(await uploaded).status(),response:await(await uploaded).json()};assert.equal(imageReceipt.status,'committed');const withImage=await source();report.imageReadback={source_ref:withImage.source_ref,body:withImage.body,attachments:withImage.attachments};await checkpoint();assert.equal(withImage.attachments.length,1);assert.match(withImage.body,/First exact writing\.[\s\S]*!\[1096-own\.png\]\(attachment:/);assert.ok(withImage.body.indexOf('![1096-own.png]')<withImage.body.indexOf('## Second'));
 // Start a dossier from this card's saved link; no current composer is borrowed.
 await press(cardMore());menu=menuOf('This card');await press(action(menu,'start-dossier'));const line=page.locator('.notebook-start-line input');await line.waitFor();await line.fill('1096 dossier '+width+' '+theme);
 const posted=command('message.post');await line.press('Enter');const post=await(await posted).json();assert.equal(post.status,'committed');
 const opening=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:post.result.message_id}}});assert.match(opening.body,/1096 dossier/);assert.match(opening.body,new RegExp('cards='+id));assert.match(opening.body,/card=c-/);assert.equal((await source()).attachments.length,1);
 // The same page inside the Notebook sheet has its header pencil and layout owner.
 await navigate(origin+'/?topic=t1&page='+id);await page.locator('.notebook-sheet-page .deck-card').nth(1).waitFor();
 // The host appears before its async load finishes. The actual opening ends
 // by focusing its card; press the menu after that observable UI boundary.
 await page.waitForFunction(()=>Boolean(document.activeElement.closest('.notebook-sheet-page')));
 const sheetMore=page.locator('.notebook-sheet .notebook-menu');await press(sheetMore);menu=menuOf('This page');await palette(menu,'text');
 const sheetKeys=(await keys(menu)).map(x=>x.key);assert.ok(sheetKeys.includes('fullpage'));assert.ok(!sheetKeys.includes('rename'));assert.ok(!sheetKeys.includes('layout'));assert.ok(!sheetKeys.includes('dossiers'));await page.screenshot({path:evidence+'/sheet-menu.png'});await page.keyboard.press('Escape');
 assert.equal(await page.locator('.notebook-sheet-heading [aria-label="Rename"]').count(),1);
 // The page Reader owns its own marks/revision rows and leaves quoted source DOM alone.
 const readPage=async()=>{const revision=(await source()).source_ref.revision;await navigate(origin+'/?topic=t1&page='+id+'&revision='+revision);await page.locator('#reader[open]').waitFor();await page.locator('#source-body').getByText('First exact writing.',{exact:true}).waitFor();};
 await readPage();await press(page.locator('#reader-menu'));menu=menuOf('This page');await palette(menu,'edit');
 const readerKeys=(await keys(menu)).map(x=>x.key);assert.deepEqual(readerKeys.slice(0,8),['star','copy','edit','revision','start-topic','start-dossier','rename','delete']);await page.screenshot({path:evidence+'/reader-menu.png'});
 // Rename is a Reader act even though the newly opened sheet hides that row.
 await press(action(menu,'rename'));const nameField=page.locator('.notebook-sheet .notebook-rename');await nameField.waitFor();await nameField.fill('1096 Reader renamed');
 const renamed=command('memory.revise',request=>request.args.title==='1096 Reader renamed');await nameField.press('Enter');
 const renameResponse=await renamed,renameReceipt=await renameResponse.json(),renameSource=await source();
 report.readerRename={request:renameResponse.request().postDataJSON(),response:renameReceipt,readback:{source_ref:renameSource.source_ref,title:renameSource.title,body:renameSource.body,attachments:renameSource.attachments}};await checkpoint();
 assert.equal(renameReceipt.status,'committed');assert.equal(renameSource.title,'1096 Reader renamed');
 await readPage();await press(page.locator('#reader-menu'));menu=menuOf('This page');await press(action(menu,'start-topic'));await page.locator('.notebook-start-line input').waitFor();assert.equal(await page.locator('#source-body .notebook-start-line').count(),0);
 const topicLine=page.locator('.notebook-start-line input');await topicLine.fill('1096 topic '+width+' '+theme);const publishing=command('opening.publish');await topicLine.press('Enter');const published=await(await publishing).json();assert.equal(published.status,'committed');
 const topicId=published.result.topic.id;const topic=await control({method:'agent_view',actor:facts.actor,name:'topic',args:{topic_id:topicId}});assert.equal(topic.topic.title,'1096 topic '+width+' '+theme);
 report.results.push({pageKeys,cardKeys,sheetKeys,readerKeys,imageBody:withImage.body,cardOpening:opening.body,topicId,firstFocusAndArrows:true,sourceProjectionUntouched:true});assert.deepEqual(report.pageErrors,[]);report.bodyCompleted=true;stamp('body-completed');await drain();await checkpoint();retain();await context.close();page=null;
}catch(e){failure=e;report.failure=e.stack;if(page&&!page.isClosed()){try{await page.screenshot({path:evidence+'/failure.png',fullPage:true});await writeFile(evidence+'/failure.html',await page.content());}catch(e){report.captureFailure=e.stack;}}}
finally{
 const step=async(name,fn)=>{try{await fn();}catch(e){report.cleanup[name+'Error']=e.stack;failure??=e;}await checkpoint();};
 await checkpoint();
 await step('capture',async()=>{const captured=await Promise.allSettled(captures);report.captureErrors=captured.filter(x=>x.status==='rejected').map(x=>String(x.reason));});
 if(browser)await step('browser',async()=>{retain();stamp('Browser.close-start');await browser.close();report.cleanup.browserClosed=true;report.cleanup.disconnected=!browser.isConnected();stamp('Browser.close-returned');});
 if(fixture)await step('fixture',async()=>{stamp('fixture-EOF');fixture.stdin.end();report.cleanup.fixtureExit=await exit;report.cleanup.stdioClose=await stdio;report.cleanup.fixtureStderr=errors();});
 if(fixture)await step('teardown',async()=>{const b=await readFile(evidence+'/teardown.jsonl');report.cleanup.teardown={bytes:b.length,sha256:hash(b),records:b.toString().trim().split('\n').map(JSON.parse)};});
 await step('process',async()=>{const list=ps();report.cleanup.remainingOwned=list.filter(p=>owned.has(p.pid));report.cleanup.profileProcesses=profile?list.filter(p=>p.raw.includes(profile)):[];report.cleanup.owned=[...owned.values()];});
 await step('profile',async()=>{if(profile&&browser&&!browser.isConnected()&&!report.cleanup.remainingOwned?.length&&!report.cleanup.profileProcesses?.length)await rm(profile,{recursive:true});report.cleanup.profileAbsent=profile?await absent(profile):null;});
 if(origin)await step('tcp',async()=>{report.cleanup.tcp=await refusal(origin);});
 try{if(browser){assert.equal(report.cleanup.browserClosed,true);assert.equal(report.cleanup.disconnected,true);assert.equal(report.cleanup.profileAbsent,true);}if(fixture){assert.deepEqual(report.cleanup.fixtureExit,{code:0,signal:null});assert.equal(report.cleanup.stdioClose.code,0);assert.equal(report.cleanup.fixtureStderr,'');const last=report.cleanup.teardown.records.at(-1);assert.equal(last.event,'cleanup-complete');assert.deepEqual(last.errors,[]);assert.equal(last.fixtureBodyError,null);assert.equal(report.cleanup.tcp.code,'ECONNREFUSED');}assert.deepEqual(report.cleanup.remainingOwned,[]);assert.deepEqual(report.cleanup.profileProcesses,[]);assert.deepEqual(report.captureErrors,[]);report.cleanup.verified=true;}catch(e){report.cleanup.failure=e.stack;failure??=e;}
 stamp('evidence-written');await writeFile(evidence+'/results.json',JSON.stringify(report,null,2)+'\n');
}
if(failure)throw failure;console.log(JSON.stringify({passed:report.results.length,cleanupVerified:report.cleanup.verified}));
