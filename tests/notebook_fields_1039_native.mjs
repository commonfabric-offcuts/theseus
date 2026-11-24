// Actual Notebook creation/Rename fields, computed contrast and native controls in scratch Core.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/aim.css','web/look.css','web/look-touch.css','web/rails.css','web/rail-dense.css','web/paper-flight.css','web/write-black.css','web/notebook-create.mjs','web/quick-create.mjs','web/notebook-page.mjs','web/notebook-sheet.mjs','web/look.mjs','tests/fixtures/ui_http.py','tests/notebook_fields_1039_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}

const inspectField = field => field.evaluate(input=>{
 const rgba=text=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=text;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((x,i)=>i===3?x/255:x);};
 const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [0,1,2].map(i=>(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/alpha).concat(alpha);};
 const ancestors=[];for(let n=input;n;n=n.parentElement)ancestors.unshift(n);let background=[255,255,255,1];for(const n of ancestors)background=over(rgba(getComputedStyle(n).backgroundColor),background);
 const s=getComputedStyle(input),p=getComputedStyle(input,'::placeholder'),rect=input.getBoundingClientRect();const text=rgba(s.webkitTextFillColor||s.color),placeholder=rgba(p.color);placeholder[3]*=Number(p.opacity);
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
 const ratio=c=>{const a=lum(over(c,background)),b=lum(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
 return {tag:input.tagName,label:input.getAttribute('aria-label'),placeholder:input.placeholder,value:input.value,color:s.color,textFill:s.webkitTextFillColor,background:s.backgroundColor,compositedBackground:background,placeholderColor:p.color,placeholderOpacity:p.opacity,textContrast:ratio(text),placeholderContrast:ratio(placeholder),tokens:{ink:s.getPropertyValue('--ink').trim(),muted:s.getPropertyValue('--muted').trim(),panel:s.getPropertyValue('--panel').trim()},focus:document.activeElement===input,selection:[input.selectionStart,input.selectionEnd],bounds:{x:rect.x,right:rect.right,width:rect.width},viewport:innerWidth};
});
try {
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [320,375,390,1280])for(const look of ['bookends','paper'])for(const scheme of ['light','dark'])for(const density of(width===1280?['compact','roomy']:['compact'])){
  const key=`${width}-${look}-${scheme}-${density}`;if(!selected.test(key))continue;
  const result={key,errors:[],fields:[],contrastFailures:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:scheme});
  await context.addInitScript(({look,density})=>{localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');},{look,density});
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>result.errors.push(error.stack));const served={},jobs=[];
  page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path)){const job=response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');});job.catch(()=>{});jobs.push(job);}});
  const press=async target=>{if(width<=760)await target.tap();else await target.click();};
  const measure=async(field,phase,placeholder=false)=>{const detail=await inspectField(field);result.fields.push({phase,...detail});if(detail.textContrast<4.5)result.contrastFailures.push({phase,kind:'text',ratio:detail.textContrast});if(placeholder&&detail.placeholderContrast<4.5)result.contrastFailures.push({phase,kind:'placeholder',ratio:detail.placeholderContrast});assert.ok(detail.bounds.x>=-.5&&detail.bounds.right<=width+.5,phase+' stays in viewport');return detail;};
  try{
   await page.goto(origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches),scheme==='dark');
   if(width<=760)await press(page.locator('#things-open'));
   const pencil=page.locator('#things [data-key=notebook] .notebook-create');await pencil.waitFor();await press(pencil);
   const title=page.getByRole('textbox',{name:'New Notebook page title',exact:true});await title.waitFor();assert.equal(await title.getAttribute('placeholder'),'Page title');assert.equal((await measure(title,'pencil-empty',true)).focus,true);await page.screenshot({path:`${evidence}/${key}-pencil-empty.png`});
   const exact=`Notebook ${key} — exact`;await page.keyboard.type(exact);let typed=await measure(title,'pencil-typed');assert.equal(typed.value,exact);await page.screenshot({path:`${evidence}/${key}-pencil-typed.png`});await page.keyboard.press('Meta+A');assert.deepEqual((await inspectField(title)).selection,[0,exact.length]);await page.keyboard.press('Escape');await title.waitFor({state:'detached'});assert.equal(await pencil.evaluate(n=>document.activeElement===n),true);
   await press(pencil);await title.waitFor();await page.keyboard.press('Meta+A');await page.keyboard.type(exact);
   const creating=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.create';}catch{return false;}});creating.catch(()=>{});await page.keyboard.press('Enter');result.created=await(await creating).json();assert.equal(result.created.status,'committed');const item=result.created.result.item_id;
   const current=()=>control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:item}});const saved=await current();assert.equal(saved.title,exact);assert.equal(saved.body,'');result.savedBeforeRename=saved;
   const dialog=page.locator('#notebook-sheet-dialog[open]');await dialog.waitFor();const menu=dialog.getByRole('button',{name:'This page',exact:true});await menu.waitFor();await press(menu);await press(page.getByRole('menuitem',{name:'Rename',exact:true}));
   const rename=dialog.locator('.notebook-rename:not([hidden])');await rename.waitFor();const renamed=exact+' renamed';assert.equal((await measure(rename,'rename-selected')).focus,true);assert.deepEqual((await inspectField(rename)).selection,[0,exact.length]);await page.keyboard.type('Title saved by Escape');const escaping=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.revise';}catch{return false;}});escaping.catch(()=>{});await page.keyboard.press('Escape');assert.equal((await(await escaping).json()).status,'committed');assert.equal((await current()).title,'Title saved by Escape');assert.equal((await current()).body,'');
   await press(menu);await press(page.getByRole('menuitem',{name:'Rename',exact:true}));await rename.waitFor();await page.keyboard.type(renamed);await measure(rename,'rename-typed');await page.screenshot({path:`${evidence}/${key}-rename-typed.png`});
   const changing=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.revise';}catch{return false;}});changing.catch(()=>{});await page.keyboard.press('Enter');result.renamed=await(await changing).json();assert.equal(result.renamed.status,'committed');const after=await current();assert.equal(after.title,renamed);assert.equal(after.body,'');assert.equal(after.draft,saved.draft);result.savedAfterRename=after;
   await press(menu);await press(page.getByRole('menuitemcheckbox',{name:'Show as text',exact:true}));const sheetText=dialog.locator('.notebook-text');await sheetText.waitFor();await measure(sheetText,'sheet-text');await page.screenshot({path:`${evidence}/${key}-sheet-text.png`});
   await page.goto(origin+'/?cards='+item+'&view=text');await page.locator('body[data-ready=true]').waitFor();const full=page.locator('#deck-page');await full.waitFor();const fullText=full.locator('.notebook-text');await fullText.waitFor();await measure(fullText,'full-text');const fullMenu=full.getByRole('button',{name:'This page',exact:true});await press(fullMenu);await press(page.getByRole('menuitem',{name:'Rename',exact:true}));const fullRename=page.locator('#topic-title .notebook-rename:not([hidden])');await fullRename.waitFor();await measure(fullRename,'full-rename');await page.screenshot({path:`${evidence}/${key}-full-rename.png`});await page.keyboard.press('Escape');assert.equal((await current()).title,renamed);
   await Promise.all(jobs);result.served=served;for(const path of sourceFiles.filter(p=>p.startsWith('web/')))assert.equal(served[path],hashes[path],path+' served matches');assert.deepEqual(result.errors,[]);assert.deepEqual(result.contrastFailures,[],'actual field contrast');result.passed=true;
  }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify({key,passed:result.passed,contrastFailures:result.contrastFailures,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
 }
}catch(error){failure=error.stack;}
finally {
  if(browser){retain();await browser.close();}cleanup.disconnected=browser?!browser.isConnected():true;
  fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();
  const ps=processes();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps.some(p=>p.pid===fixture.pid);cleanup.ownedPids=[...owned];cleanup.remainingOwned=ps.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?ps.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.disconnected&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
  cleanup.portClosed=origin?await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));}):null;
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,results,cleanup,failure},null,2));
}
assert.equal(cleanup.disconnected,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const path of sourceFiles)assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path]);
assert.equal(failure,undefined);assert.ok(results.length);assert.ok(results.every(r=>r.passed),'inspect retained failures');console.log(JSON.stringify({passed:results.length,cleanup}));
