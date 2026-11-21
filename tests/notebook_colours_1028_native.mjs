// Native 1028 colour/menu contract against scratch Core; native acts, computed colours and exact settlement.
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
const sourceFiles=['web/app.mjs','web/aim.css','web/look.css','web/look-touch.css','web/rails.css','web/notebook-page.mjs','web/notebook-writing.mjs','web/notebook-sheet.mjs','web/deck-page.mjs','web/outcome-references.mjs','web/color-picker.mjs','web/card-details.mjs','aim_next/memory.py','aim_next/store.py','aim_next/migrations.py','tests/fixtures/ui_http.py','tests/notebook_colours_1028_native.mjs','web/index.html','web/notebook-colours.css','web/notebook-colors.mjs','web/notebook-thumbnail-menu.mjs','web/notebook-rail-menu.mjs','web/things-rail.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}

// Independent expected fills from the approved designer spec, not product variables.
const palette={bookends:{green:['0d2319','1b3a2b','12281e'],blue:['0d202e','1a364a','122533'],indigo:['181d2f','2b314b','1c2234'],violet:['211a2b','382d46','251f30'],rose:['29181f','442a34','2e1d24'],peach:['281b11','432e1e','2d2016'],cyan:['032327','093a40','08282c'],olive:['1c200f','31361c','202514']},paper:{green:['ecf3e2','cedfc7','e7eedd'],blue:['ecf1f1','cddce3','e7ecec'],indigo:['f1eff2','d8d8e5','eceaed'],violet:['f7edef','e3d4e0','f2e8ea'],rose:['feece6','efd1cf','f9e7e1'],peach:['fdeddd','edd4bd','f8e8d8'],cyan:['e8f3ec','c7dfda','e4eee7'],olive:['f4f1dc','dddbbc','efecd7']}};
const rgb=hex=>'rgb('+[0,2,4].map(at=>parseInt(hex.slice(at,at+2),16)).join(', ')+')';
const within=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),10000);})]).finally(()=>clearTimeout(timer));};
const inspect=node=>node.evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect(),words=n.querySelector('.deck-words')??n,ink=getComputedStyle(words);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 const rgb=text=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=text;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);},lum=c=>c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
 const textRGB=rgb(ink.webkitTextFillColor||ink.color),backgroundRGB=rgb(s.backgroundColor),fg=lum(textRGB),bg=lum(backgroundRGB),contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
 return {classes:n.className,current:n.getAttribute('aria-current'),background:s.backgroundColor,backgroundRGB,edge:s.borderTopColor,ink:ink.color,textFill:ink.webkitTextFillColor,textRGB,contrast,radius:s.borderRadius,focus:document.activeElement===n,rect:{x:r.x,right:r.right,width:r.width},viewport:innerWidth};});
const original='## Blue card\n\nWords kept.\n\n<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":"blue"} -->\n\n## Plain card\n\nOther words.\n';
try {
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);
 for(const width of [1280,390])for(const look of ['bookends','paper'])for(const scheme of ['light','dark']){
  const key=`${width}-${look}-${scheme}`;if(!selected.test(key))continue;
  const item=`colours1028-${engine}-${key}`,other=item+'-other',rail=item+'-rail',result={key,errors:[],paints:[],requests:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:scheme});
  for(const [id,body]of[[item,original],[other,'Independent Text page.']])assert.equal((await control({method:'outcome_reference',operation_id:id+'-create',item_id:id,title:id,body})).status,'committed');
  assert.equal((await control({method:'agent_page',operation_id:rail+'-create',topic_id:'t1',item_id:rail,title:rail,body:'Rail writing.'})).status,'committed');
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',error=>result.errors.push(error.stack));const served={},jobs=[];
  page.on('request',r=>{try{const e=r.postDataJSON();if(e?.kind==='memory.revise')result.requests.push(e);}catch{}});
  page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path)){const job=response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');});job.catch(()=>{});jobs.push(job);}});
  const press=async target=>width<=760?target.tap():target.click();
  const current=id=>control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:id}});
  const ready=async route=>{await page.goto(origin+route);await page.locator('body[data-ready=true]').waitFor();assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);};
  const picker=()=>page.getByRole('dialog',{name:/^Color for /});
  const pageMenu=host=>host.getByRole('button',{name:'This page',exact:true});
  const openPicker=async host=>{await press(pageMenu(host));await press(page.getByRole('menuitem',{name:'Set color',exact:true}));await picker().waitFor();};
  const choose=async(host,color)=>{await openPicker(host);await press(color===null?picker().getByRole('button',{name:'No color',exact:true}):picker().getByRole('button',{name:color,exact:true}));await picker().waitFor({state:'detached'});};
  const paint=async(node,color,phase)=>{const s=await inspect(node);result.paints.push({phase,color,...s});assert.ok(palette[look][color].filter((_,i)=>i!==1).map(rgb).includes(s.background),phase+' specified fill');assert.equal(s.edge,rgb(palette[look][color][1]),phase+' hairline');assert.ok(s.contrast>=4.5,phase+' text contrast');assert.ok(s.rect.x>=-.5&&s.rect.right<=width+.5,phase+' viewport');return s;};
  try{
   await ready('/?workspace=w1');const tab=page.locator('#outcome-tab-notes');if(await tab.isVisible())await press(tab);
   const thumb=page.locator(`#outcome-references-list [data-id="${item}"]`);await thumb.waitFor();
   // Secondary and keyboard entry share descriptors without opening or revising the page.
   await thumb.click({button:'right'});const menu=page.getByRole('menu',{name:'This page',exact:true});await menu.waitFor();
   result.thumbnailItems=await menu.locator('button').allTextContents();assert.ok(result.thumbnailItems.includes('Set color'));assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0);assert.equal((await current(item)).source_ref.revision,1);
   await page.keyboard.press('Escape');assert.equal(await thumb.evaluate(n=>n===document.activeElement),true);
   await page.keyboard.press('Shift+F10');await menu.waitFor();await press(menu.getByRole('menuitem',{name:'Set color',exact:true}));
   const host=page.locator('#notebook-sheet-dialog[open]');await host.waitFor();await picker().waitFor();
   for(const color of Object.keys(palette[look])){const swatch=picker().getByRole('button',{name:color,exact:true}).locator('.swatch-tag');const s=await inspect(swatch);assert.equal(s.background,rgb(palette[look][color][0]),'swatch '+color);}
   // Keyboard selects rose; explicit blue must survive inside the rose page.
   await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');assert.equal(await picker().getByRole('button',{name:'rose',exact:true}).evaluate(n=>n===document.activeElement),true);
   await page.keyboard.press('Enter');await picker().waitFor({state:'detached'});assert.equal((await current(item)).color,'rose');assert.equal((await current(item)).body,original);
   assert.equal(await pageMenu(host).evaluate(n=>n===document.activeElement),true);
   await page.mouse.move(2,2);await paint(host.locator('.deck-card').nth(0),'blue','sheet explicit blue');await paint(host.locator('.deck-card').nth(1),'rose','sheet inherited rose');
   if(width>760){await host.locator('.deck-card').nth(1).hover();assert.equal((await inspect(host.locator('.deck-card').nth(1))).background,rgb(palette[look].rose[2]),'native pointer hover');await page.mouse.move(2,2);}
   const rows=host.locator('.deck-card');await press(rows.first().locator('.deck-title'));
   if(await host.locator('.deck-writing:visible').count())await page.keyboard.press('Escape');
   await page.keyboard.press('Shift+ArrowDown');assert.equal(await host.locator('.deck-selected').count(),2);
   result.selection=await Promise.all([inspect(rows.first()),inspect(rows.nth(1))]);assert.ok(result.selection.every(s=>s.contrast>=4.5),'native selection stays legible');
   await page.keyboard.press('Shift+ArrowUp');assert.equal(await host.locator('.deck-selected').count(),0);
   for(const color of Object.keys(palette[look])){await choose(host,color);assert.equal((await current(item)).color,color);await paint(host.locator('.deck-card').nth(1),color,'page '+color);await paint(host.locator('.deck-card').nth(0),'blue','blue preserved');}
   let release,arrived,held=false;const reached=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});
   const hold=async route=>{const e=route.request().postDataJSON();if(!held&&e?.kind==='memory.revise'&&e.target.item_id===item&&e.args.color===null){held=true;arrived();await gate;}await route.continue();};
   await page.route('**/api/command',hold);await openPicker(host);await press(picker().getByRole('button',{name:'No color',exact:true}));
   try{await within(reached,'pending clear');assert.equal((await current(item)).color,'olive','Core has not received the clear yet');assert.equal(await host.locator('.notebook-sheet-page').evaluate(n=>n.classList.contains('notebook-tinted')),false,'clear is drawn pending');}finally{release();}
   await picker().waitFor({state:'detached'});await page.unroute('**/api/command',hold);assert.equal((await current(item)).color,null);await paint(host.locator('.deck-card').nth(0),'blue','individual blue after page clear');
   await choose(host,'rose');await page.screenshot({path:`${evidence}/${key}-sheet-rose-blue.png`});
   await ready('/?cards='+item+'&view=text');const full=page.locator('#deck-page');await full.waitFor();const text=full.locator('.notebook-text');await text.waitFor();await paint(text,'rose','full Text rose');
   await press(text);await page.keyboard.press('Meta+End');await page.keyboard.type('\n\nAdded 1028 words.');
   await page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.revise'&&r.request().postDataJSON()?.args.body.includes('Added 1028 words.');}catch{return false;}});
   assert.equal((await current(item)).color,'rose');assert.match((await current(item)).body,/Added 1028 words/);assert.match((await current(item)).body,/"color":"blue"/);
   await ready('/?cards='+other+'&view=text');const otherHost=page.locator('#deck-page');await otherHost.waitFor();await choose(otherHost,'green');assert.equal((await current(item)).color,'rose');assert.equal((await current(other)).color,'green');
   const beforeUnknown=(await current(other)).source_ref.revision,from=result.requests.length;let lost=false;
   const loss=async route=>{const e=route.request().postDataJSON();if(!lost&&e?.kind==='memory.revise'&&e.target.item_id===other){lost=true;result.lostReceipt=await(await route.fetch()).json();await route.abort('failed');}else await route.continue();};
   await page.route('**/api/command',loss);await openPicker(otherHost);await press(picker().getByRole('button',{name:'rose',exact:true}));await picker().locator('.notice:not([hidden])').waitFor();assert.equal(lost,true);assert.equal(result.lostReceipt.status,'committed');
   await press(picker().getByRole('button',{name:'olive',exact:true}));await picker().waitFor({state:'detached'});await page.unroute('**/api/command',loss);
   const sent=result.requests.slice(from);assert.ok(sent.length>=3);assert.deepEqual(sent[0],sent[1],'unknown operation is retried exactly');assert.notEqual(sent[1].operation_id,sent[2].operation_id);assert.equal((await current(other)).color,'olive');assert.equal((await current(other)).source_ref.revision,beforeUnknown+2);assert.equal((await current(item)).color,'rose');
   await ready('/?cards='+item+'&view=cards');await paint(page.locator('#deck-page .deck-card').first(),'blue','reloaded full blue');await paint(page.locator('#deck-page .deck-card').nth(1),'rose','reloaded full inherited rose');
   await ready('/?workspace=w1');const again=page.locator('#outcome-tab-notes');if(await again.isVisible())await press(again);await paint(page.locator(`#outcome-references-list [data-id="${item}"] .notebook-document`),'rose','thumbnail after reload');
   await ready('/?topic=t1');if(width<=760)await press(page.locator('#things-open'));
   const row=page.locator(`#things a.row[href*="${rail}"]`);await row.waitFor();await press(row);const railHost=page.locator('#notebook-sheet-dialog[open]');await railHost.waitFor();await choose(railHost,'cyan');assert.equal((await current(rail)).color,'cyan');
   await ready('/?topic=t1');if(width<=760)await press(page.locator('#things-open'));await paint(page.locator(`#things a.row[href*="${rail}"]`),'cyan','rail after reload');
   await Promise.all(jobs);result.served=served;for(const [path,hash]of Object.entries(served))assert.equal(hash,hashes[path],path+' served');
   for(const path of sourceFiles.filter(p=>p.startsWith('web/')&&!p.endsWith('index.html')))assert.ok(served[path],path+' actually served');
   assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
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
