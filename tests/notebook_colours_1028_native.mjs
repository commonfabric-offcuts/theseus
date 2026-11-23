// Native 1028 colour/menu contract against scratch Core; native acts, computed colours and exact settlement.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {probeTcp} from './native_tcp_refusal_1028.mjs';
import {NativeLoadHeld,sampleLaunchResource,requireLaunchResource} from './native_launch_resource_1028.mjs';
import {fixtureControl} from './fixture_control.mjs';
import {readingFixtureReport} from './fixture_teardown_evidence.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const forcedHoldBoundary=process.argv.find(arg=>arg.startsWith('--force-resource-hold='))?.split('=')[1]??null;
assert.ok(forcedHoldBoundary===null||['fixture','browser'].includes(forcedHoldBoundary),'unknown resource hold boundary');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/app.mjs','web/aim.css','web/look.css','web/look-touch.css','web/rails.css','web/notebook-page.mjs','web/notebook-writing.mjs','web/notebook-sheet.mjs','web/deck-page.mjs','web/outcome-references.mjs','web/color-picker.mjs','web/card-details.mjs','aim_next/memory.py','aim_next/store.py','aim_next/migrations.py','tests/fixtures/ui_http.py','tests/fixtures/fixture_teardown.py','tests/notebook_colours_1028_native.mjs','web/index.html','web/notebook-colours.css','web/notebook-colors.mjs','web/notebook-thumbnail-menu.mjs','web/notebook-rail-menu.mjs','web/things-rail.mjs','web/outline-menus.mjs','tests/fixture_control.mjs','tests/fixture_teardown_evidence.mjs','tests/native_tcp_refusal_1028.mjs','tests/native_tcp_probe_1028.py','tests/native_launch_resource_1028.mjs','tests/native_resource_cleanup_1028.py'].filter(path=>existsSync(path));
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const results=[],cleanup={},owned=new Map(),launchResources=[];
let fixture,fixtureClosed,channel,exit,errors,browser,profile,origin,failure,held;
const launchBoundary=boundary=>{
 const reading=sampleLaunchResource(boundary);reading.forcedHold=forcedHoldBoundary===boundary;reading.admitted=reading.qualified&&!reading.forcedHold;launchResources.push(reading);
 appendFileSync(`${evidence}/launch-boundaries.jsonl`,JSON.stringify(reading)+'\n');requireLaunchResource(reading);
};
const control=request=>{appendFileSync(`${evidence}/fixture-requests.jsonl`,JSON.stringify(request)+'\n');return channel.control(request);};
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,lstart=,command='],{encoding:'utf8'}).trim().split('\n').flatMap(line=>{
 const a=line.trim().split(/\s+/),pid=+a.shift(),ppid=+a.shift(),started=a.splice(0,5).join(' '),command=a.join(' ');
 return command?[{pid,ppid,started,command,commandSHA256:createHash('sha256').update(command).digest('hex')}]:[];
});
const identity=p=>p.pid+':'+p.started+':'+p.commandSHA256;
function retain(){const all=processes();let parents=new Set([fixture.pid,...[...owned.values()].map(p=>p.pid)]);
 for(let changed=true;changed;){changed=false;for(const p of all)if((parents.has(p.ppid)||profile&&p.command.includes(profile))&&!parents.has(p.pid)){parents.add(p.pid);changed=true;}}
 for(const p of all)if(parents.has(p.pid))owned.set(identity(p),p);
 writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,identities:[...owned.values()]},null,2));}
const eventually=async(test,label)=>{const until=Date.now()+10000;for(;;){if(await test())return;if(Date.now()>=until)throw Error(label+' timed out');await new Promise(done=>setTimeout(done,30));}};
const bodyFile=async(bytes)=>{const digest=createHash('sha256').update(bytes).digest('hex');await mkdir(`${evidence}/bodies`,{recursive:true});await writeFile(`${evidence}/bodies/${digest}`,bytes);return {sha256:digest,bytes:bytes.length,file:'bodies/'+digest};};

// Independent expected fills from the approved designer spec, not product variables.
const palette={bookends:{green:['0d2319','1b3a2b','12281e'],blue:['0d202e','1a364a','122533'],indigo:['181d2f','2b314b','1c2234'],violet:['211a2b','382d46','251f30'],rose:['29181f','442a34','2e1d24'],peach:['281b11','432e1e','2d2016'],cyan:['032327','093a40','08282c'],olive:['1c200f','31361c','202514']},paper:{green:['ecf3e2','cedfc7','e7eedd'],blue:['ecf1f1','cddce3','e7ecec'],indigo:['f1eff2','d8d8e5','eceaed'],violet:['f7edef','e3d4e0','f2e8ea'],rose:['feece6','efd1cf','f9e7e1'],peach:['fdeddd','edd4bd','f8e8d8'],cyan:['e8f3ec','c7dfda','e4eee7'],olive:['f4f1dc','dddbbc','efecd7']}};
const rgb=hex=>'rgb('+[0,2,4].map(at=>parseInt(hex.slice(at,at+2),16)).join(', ')+')';
const within=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),10000);})]).finally(()=>clearTimeout(timer));};
const inspect=node=>node.evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect(),words=n.querySelector('.deck-words')??n,ink=getComputedStyle(words);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 const rgb=text=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=text;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];},lum=c=>c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
 const backgroundRGB=rgb(s.backgroundColor).slice(0,3),bg=lum(backgroundRGB),readable=[...n.querySelectorAll('.deck-words,.notebook-document-title,.outcome-page-opening')].filter(e=>e.getClientRects().length);if(!readable.length)readable.push(words);
 const textRoles=readable.map(e=>{const style=getComputedStyle(e),raw=rgb(style.webkitTextFillColor||style.color),alpha=raw[3]/255,actual=raw.slice(0,3).map((channel,i)=>channel*alpha+backgroundRGB[i]*(1-alpha)),fg=lum(actual);return {className:e.className,colour:style.color,textFill:style.webkitTextFillColor,alpha,actualRGB:actual,contrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});
 const textRGB=textRoles[0].actualRGB,contrast=Math.min(...textRoles.map(x=>x.contrast));
 return {classes:n.className,current:n.getAttribute('aria-current'),background:s.backgroundColor,backgroundRGB,textRoles,edge:s.borderTopColor,ink:ink.color,textFill:ink.webkitTextFillColor,textRGB,contrast,radius:s.borderRadius,focus:document.activeElement===n,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},visible:Boolean(n.getClientRects().length&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0)};});
const original='## Blue card\n\nWords kept.\n\n<!-- theseus-card: {"id":"c-11111111111111111111111111111111","aliases":[],"color":"blue"} -->\n\n## Plain card\n\nOther words.\n';
try {
 launchBoundary('fixture');
 fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person','--teardown-observations',`${evidence}/fixture-teardown.jsonl`]);
 fixtureClosed=new Promise(resolve=>fixture.once('close',(code,signal)=>resolve({code,signal})));
 fixture.stdout.on('data',bytes=>appendFileSync(`${evidence}/fixture-stdout.jsonl`,bytes));
 fixture.stderr.on('data',bytes=>appendFileSync(`${evidence}/fixture-stderr.txt`,bytes));
 channel=fixtureControl(fixture);({exit,errors}=channel);
 const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));retain();
 profile=await mkdtemp(`${evidence}/${engine}-profile-`);launchBoundary('browser');const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();retain();assert.ok(owned.size);cleanup.version=browser.version();
 for(const width of [1280,390])for(const look of ['bookends','paper'])for(const scheme of ['light','dark']){
  const key=`${width}-${look}-${scheme}`;if(!selected.test(key))continue;
  const item=`colours1028-${engine}-${key}`,other=item+'-other',rail=item+'-rail',result={key,errors:[],paints:[],requests:[]},context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760,colorScheme:scheme});
  for(const [id,body]of[[item,original],[other,'Independent Text page.']])assert.equal((await control({method:'outcome_reference',operation_id:id+'-create',item_id:id,title:id,body})).status,'committed');
  assert.equal((await control({method:'agent_page',operation_id:rail+'-create',topic_id:'t1',item_id:rail,title:rail,body:'Rail writing.'})).status,'committed');
  await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
  await context.addInitScript(()=>{window.native1028Events=[];for(const kind of ['keydown','contextmenu','pointerdown','pointerup','click'])document.addEventListener(kind,event=>{
 const row=event.target.closest?.('#outcome-references-list .reference');if(row)window.native1028Events.push({kind,trusted:event.isTrusted,pointerType:event.pointerType??null,key:event.key??null,x:event.clientX??null,y:event.clientY??null,id:row.dataset.id});
},true);});
  const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',error=>result.errors.push(error.stack));const served={},jobs=[];result.http=[];
  page.on('request',r=>{try{const e=r.postDataJSON();if(e?.kind==='memory.revise')result.requests.push(e);}catch{}const bytes=r.postDataBuffer();const entry={kind:'request',url:r.url(),method:r.method()};result.http.push(entry);if(bytes)jobs.push(bodyFile(bytes).then(body=>{entry.body=body;}));});
  page.on('response',response=>{if(new URL(response.url()).origin!==origin)return;const path='web/'+new URL(response.url()).pathname.split('/').at(-1),entry={kind:'response',url:response.url(),status:response.status()};result.http.push(entry);if(response.request().resourceType()==='eventsource'||response.headers()['content-type']?.includes('text/event-stream')){entry.streamingBodyNotCollected=true;return;}const job=response.body().then(async bytes=>{entry.body=await bodyFile(bytes);if(Object.hasOwn(hashes,path))served[path]=entry.body.sha256;}).catch(error=>{entry.bodyError=String(error);});jobs.push(job);});
  const press=async target=>width<=760?target.tap():target.click();
  const current=id=>control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:id}});
  const ready=async route=>{await page.goto(origin+route);await page.locator('body[data-ready=true]').waitFor();assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);};
  const picker=()=>page.getByRole('dialog',{name:/^Color for /});
  const pageMenu=host=>host.getByRole('button',{name:'This page',exact:true});
  const openPicker=async host=>{await press(pageMenu(host));await press(page.getByRole('menuitem',{name:'Set color',exact:true}));await picker().waitFor();const material=await host.getAttribute('id')==='deck-page'?(scheme==='light'?'paper':'bookends'):look;for(const color of Object.keys(palette[material])){const swatch=await inspect(picker().getByRole('button',{name:color,exact:true}).locator('.swatch-tag'));assert.ok(swatch.visible&&swatch.rect.width>0&&swatch.rect.height>0,'swatch is actually visible and positively sized');assert.equal(swatch.background,rgb(palette[material][color][0]),material+' swatch '+color);}};
  const choose=async(host,color)=>{await openPicker(host);await press(color===null?picker().getByRole('button',{name:'No color',exact:true}):picker().getByRole('button',{name:color,exact:true}));await picker().waitFor({state:'detached'});};
  const paint=async(node,color,phase)=>{await node.scrollIntoViewIfNeeded();await node.evaluate(n=>n.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await settledInput();const s=await inspect(node),material=await node.evaluate(n=>Boolean(n.closest('#deck-page')))?(scheme==='light'?'paper':'bookends'):look;
   result.paints.push({phase,color,material,tolerances:{viewportCSSPx:.5,colourChannels:0,positiveSizeStrict:true,minimumContrast:4.5},...s});
   assert.ok(s.visible&&s.rect.width>0&&s.rect.height>0,phase+' intended visible target has positive width AND height');
   assert.ok(s.rect.x>=-.5&&s.rect.right<=width+.5&&s.rect.y>=-.5&&s.rect.bottom<=900+.5,phase+' inside viewport (0.5 CSS px)');
   assert.ok(palette[material][color].filter((_,i)=>i!==1).map(rgb).includes(s.background),phase+' specified material fill');assert.equal(s.edge,rgb(palette[material][color][1]),phase+' material hairline');assert.ok(s.contrast>=4.5,phase+' actual text contrast');return s;};
  const journal=async(id,label)=>{const state=await page.evaluate(async id=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('theseus-notebook-writing-v1',3);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
   try{return await new Promise((ok,no)=>{const tx=db.transaction('writing','readonly'),r=tx.objectStore('writing').getAll();r.onsuccess=()=>ok(r.result.filter(v=>v.binding?.item_id===id));r.onerror=()=>no(r.error);});}finally{db.close();}},id);
   const body=await bodyFile(Buffer.from(JSON.stringify(state)));(result.journals??=[]).push({label,...body,state});return state;};
  const metadataReads=()=>result.http.filter(r=>r.kind==='request'&&r.url.endsWith('/api/view')&&r.view?.name==='memory_current').length;
  page.on('request',r=>{if(!r.url().endsWith('/api/view'))return;try{const e=r.postDataJSON();const entry=result.http.findLast(x=>x.kind==='request'&&x.url===r.url()&&!x.view);if(entry)entry.view=e;}catch{}});
  const settledInput=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  try{
   await ready('/?workspace=w1');const tab=page.locator('#outcome-tab-notes');if(await tab.isVisible())await press(tab);
   const thumb=page.locator(`#outcome-references-list [data-id="${item}"]`);await thumb.waitFor();
   // Secondary and keyboard entry share descriptors without opening or revising the page.
   const readsBeforeSecondary=metadataReads();await thumb.click({button:'right'});const menu=page.getByRole('menu',{name:'This page',exact:true});await menu.waitFor();await settledInput();assert.equal(metadataReads(),readsBeforeSecondary+1,'one actual secondary metadata read');
   result.thumbnailItems=await menu.locator('button').allTextContents();assert.ok(result.thumbnailItems.includes('Set color'));assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0);assert.equal((await current(item)).source_ref.revision,1);
   await page.keyboard.press('Escape');assert.equal(await thumb.evaluate(n=>n===document.activeElement),true);
   const beforeKey=metadataReads();await page.keyboard.press('Shift+F10');await menu.waitFor();await settledInput();assert.equal(metadataReads(),beforeKey+1,'one actual keyboard-door metadata read');assert.equal(await menu.count(),1);
   result.keyboardEvents=await page.evaluate(()=>window.native1028Events);result.nativeKeyboardContextGenerated=result.keyboardEvents.some(e=>e.kind==='contextmenu'&&e.trusted&&e.x===0&&e.y===0);
   await page.keyboard.press('Escape');
   // A subsequent independent secondary click must remain a separate door.
   const nextSecondary=metadataReads();await thumb.click({button:'right'});await menu.waitFor();await settledInput();assert.equal(metadataReads(),nextSecondary+1);
   const reloaded=page.waitForResponse(r=>{try{return r.url().endsWith('/api/view')&&r.request().postDataJSON()?.name==='memory_items';}catch{return false;}});
   await press(menu.getByRole('menuitem',{name:'Star',exact:true}));await reloaded;await page.locator('#outcome-references-notice:not([hidden])').waitFor();assert.equal((await current(item)).starred,true);assert.equal(await page.locator('#outcome-references-notice').innerText(),'Saved.');
   await settledInput();assert.equal(await page.locator('#outcome-references-notice').isVisible(),true,'Saved survives actual refs.load');
   if(width<=760&&engine==='chromium') {
    const cdp=await context.newCDPSession(page),box=await thumb.boundingBox();assert.ok(box&&box.width>0&&box.height>0);let down=false;
    try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});down=true;await menu.waitFor();}
    finally{if(down)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
    await settledInput();assert.equal(await page.locator('#notebook-sheet-dialog[open]').count(),0,'native hold following click does not navigate');result.touchHold={native:true,events:await page.evaluate(()=>window.native1028Events)};await page.keyboard.press('Escape');
    await thumb.tap();await page.locator('#notebook-sheet-dialog[open]').waitFor();await page.getByRole('button',{name:'Close, keeping your writing',exact:true}).tap();await page.locator('#notebook-sheet-dialog[open]').waitFor({state:'detached'});
   }else if(width<=760)result.touchHold={native:false,limitation:'Playwright WebKit touchscreen exposes tap only; no injected pointer event is labelled native hold.'};
   // Native document selection keeps the shared context/keyboard door native.
   await thumb.focus();await page.keyboard.press('Meta+a');
   result.thumbnailSelection=await page.evaluate(()=>({collapsed:document.getSelection().isCollapsed,words:String(document.getSelection())}));
   assert.equal(result.thumbnailSelection.collapsed,false,'native Select All establishes real document selection');
   const selectionReads=metadataReads();await page.keyboard.press('Shift+F10');await settledInput();assert.equal(await menu.count(),0,'selected words do not open the custom menu');assert.equal(metadataReads(),selectionReads);
   await page.keyboard.press('Escape');await page.mouse.click(width-3,3);assert.equal(await page.evaluate(()=>document.getSelection().isCollapsed),true);
   await thumb.focus();await page.keyboard.press('Shift+F10');await menu.waitFor();await press(menu.getByRole('menuitem',{name:'Set color',exact:true}));
   const host=page.locator('#notebook-sheet-dialog[open]');await host.waitFor();await picker().waitFor();
   for(const color of Object.keys(palette[look])){const swatch=picker().getByRole('button',{name:color,exact:true}).locator('.swatch-tag');const s=await inspect(swatch);assert.ok(s.visible&&s.rect.width>0&&s.rect.height>0,'sheet swatch is actually visible and positively sized');assert.equal(s.background,rgb(palette[look][color][0]),'swatch '+color);}
   // Keyboard selects rose; explicit blue must survive inside the rose page.
   await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');assert.equal(await picker().getByRole('button',{name:'rose',exact:true}).evaluate(n=>n===document.activeElement),true);
   await page.keyboard.press('Enter');await picker().waitFor({state:'detached'});assert.equal((await current(item)).color,'rose');assert.equal((await current(item)).body,original);
   assert.equal(await pageMenu(host).evaluate(n=>n===document.activeElement),true);
   await page.keyboard.press('Meta+z');await eventually(async()=>(await current(item)).color===null,'native page-colour Undo');assert.equal((await current(item)).body,original);await choose(host,'rose');
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
   try{await within(reached,'pending clear');assert.equal((await current(item)).color,'olive','Core has not received the clear yet');const kept=await journal(item,'pending clear before HTTP leaves');assert.equal(kept.length,1);assert.equal(kept[0].pending.args.color,null);assert.deepEqual(kept[0].pending,result.requests.at(-1),'actual IndexedDB pending envelope equals actual HTTP command');assert.equal(await host.locator('.notebook-sheet-page').evaluate(n=>n.classList.contains('notebook-tinted')),false,'clear is drawn pending');}finally{release();}
   await picker().waitFor({state:'detached'});await page.unroute('**/api/command',hold);assert.equal((await current(item)).color,null);await paint(host.locator('.deck-card').nth(0),'blue','individual blue after page clear');
   await choose(host,'rose');await page.screenshot({path:`${evidence}/${key}-sheet-rose-blue.png`});
   await ready('/?cards='+item+'&view=text');const full=page.locator('#deck-page');await full.waitFor();const text=full.locator('.notebook-text');await text.waitFor();await paint(text,'rose','full Text rose');
   await choose(full,'olive');await page.keyboard.press('Meta+z');await eventually(async()=>(await current(item)).color==='rose','native Text-header page-colour Undo');assert.equal((await current(item)).body,original);
   await press(text);await page.keyboard.press('Meta+End');await page.keyboard.type('\n\nAdded 1028 words.');
   await page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='memory.revise'&&r.request().postDataJSON()?.args.body.includes('Added 1028 words.');}catch{return false;}});
   assert.equal((await current(item)).color,'rose');assert.match((await current(item)).body,/Added 1028 words/);assert.match((await current(item)).body,/"color":"blue"/);
   await ready('/?cards='+other+'&view=text');const otherHost=page.locator('#deck-page');await otherHost.waitFor();await choose(otherHost,'green');assert.equal((await current(item)).color,'rose');assert.equal((await current(other)).color,'green');
   const beforeUnknown=(await current(other)).source_ref.revision,from=result.requests.length;let lost=false;
   const loss=async route=>{const e=route.request().postDataJSON();if(!lost&&e?.kind==='memory.revise'&&e.target.item_id===other){lost=true;const response=await route.fetch(),bytes=await response.body();result.lostReceiptBody=await bodyFile(bytes);result.lostReceipt=JSON.parse(bytes.toString());await route.abort('failed');}else await route.continue();};
   await page.route('**/api/command',loss);await openPicker(otherHost);await press(picker().getByRole('button',{name:'rose',exact:true}));await picker().locator('.notice:not([hidden])').waitFor();assert.equal(lost,true);assert.equal(result.lostReceipt.status,'committed');
   const uncertain=await journal(other,'Core committed but receipt lost');assert.equal(uncertain.length,1);assert.equal(uncertain[0].pending.operation_id,result.requests.at(-1).operation_id);
   await press(picker().getByRole('button',{name:'olive',exact:true}));await picker().waitFor({state:'detached'});await page.unroute('**/api/command',loss);
   const sent=result.requests.slice(from);assert.ok(sent.length>=3);assert.deepEqual(sent[0],sent[1],'unknown operation is retried exactly');
   await Promise.all(jobs);const rawSent=result.http.filter(r=>r.kind==='request'&&r.url.endsWith('/api/command')&&r.body).slice(-3);assert.equal(rawSent[0].body.sha256,rawSent[1].body.sha256,'unknown retry retains actual serialized HTTP bytes');assert.notEqual(sent[1].operation_id,sent[2].operation_id);assert.equal((await current(other)).color,'olive');assert.equal((await current(other)).source_ref.revision,beforeUnknown+2);assert.equal((await current(item)).color,'rose');
   await ready('/?cards='+item+'&view=cards');await paint(page.locator('#deck-page .deck-card').first(),'blue','reloaded full blue');await paint(page.locator('#deck-page .deck-card').nth(1),'rose','reloaded full inherited rose');
   await ready('/?workspace=w1');const again=page.locator('#outcome-tab-notes');if(await again.isVisible())await press(again);await paint(page.locator(`#outcome-references-list [data-id="${item}"]`),'rose','visible outcome reference after reload');
   await ready('/?topic=t1');if(width<=760)await press(page.locator('#things-open'));
   const row=page.locator(`#things a.row[href*="${rail}"]`);await row.waitFor();await press(row);const railHost=page.locator('#notebook-sheet-dialog[open]');await railHost.waitFor();await choose(railHost,'cyan');assert.equal((await current(rail)).color,'cyan');
   await ready('/?topic=t1');if(width<=760)await press(page.locator('#things-open'));await paint(page.locator(`#things a.row[href*="${rail}"]`),'cyan','rail after reload');
   await Promise.all(jobs);result.events=await page.evaluate(()=>window.native1028Events);result.served=served;for(const [path,hash]of Object.entries(served))assert.equal(hash,hashes[path],path+' served');
   for(const path of sourceFiles.filter(p=>p.startsWith('web/')&&!p.endsWith('index.html')))assert.ok(served[path],path+' actually served');
   assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(error){result.error=error.stack;result.events=await page.evaluate(()=>window.native1028Events).catch(()=>null);await Promise.all(jobs);await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
  results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
 }
}catch(error){if(error instanceof NativeLoadHeld)held=error.reading;else failure=error.stack;}
finally {
 cleanup.fixtureStarted=Boolean(fixture);cleanup.browserStarted=Boolean(browser);
 cleanup.closeRequested=false;cleanup.closeResolved=false;
 if(browser){retain();cleanup.closeRequested=true;cleanup.closeRequestedAt=new Date().toISOString();await browser.close();cleanup.closeResolved=true;cleanup.closeResolvedAt=new Date().toISOString();}cleanup.disconnected=browser?!browser.isConnected():null;
 cleanup.fixtureEOFRequested=false;cleanup.fixtureStdinFinished=false;cleanup.fixtureExit=null;cleanup.fixtureClose=null;cleanup.fixtureErrors=null;
 if(fixture){
  cleanup.fixtureEOFRequested=!fixture.stdin.destroyed;cleanup.fixtureStdinFinished=fixture.stdin.writableFinished;
  fixture.stdin.once('finish',()=>{cleanup.fixtureStdinFinished=true;cleanup.fixtureStdinFinishedAt=new Date().toISOString();});
  if(cleanup.fixtureEOFRequested){cleanup.fixtureEOFRequestedAt=new Date().toISOString();fixture.stdin.end();}cleanup.fixtureExit=await exit;cleanup.fixtureClose=await fixtureClosed;cleanup.fixtureErrors=errors();
  await eventually(()=>{const all=processes();return !all.some(p=>owned.has(identity(p))||profile&&p.command.includes(profile));},'owned browser/fixture processes exit').catch(error=>{cleanup.exitWaitError=error.stack;});
 }
 const ps=processes();cleanup.fixturePid=fixture?.pid??null;cleanup.fixtureAbsent=fixture?!ps.some(p=>p.pid===fixture.pid):null;cleanup.ownedIdentities=[...owned.values()];cleanup.remainingOwned=ps.filter(p=>owned.has(identity(p)));cleanup.profileProcesses=profile?ps.filter(p=>p.command.includes(profile)):[];
 if(profile&&(!browser||cleanup.disconnected)&&cleanup.fixtureExit?.code===0&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
 cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
 cleanup.tcpOutcome=origin?await probeTcp(origin):null;cleanup.portClosed=cleanup.tcpOutcome?.refused===true;
 const nativePassed=!held&&!failure&&results.length>0&&results.every(r=>r.passed),base={mode:'--reading',engine,version:cleanup.version,results,cleanup,failure,held:held??null,launchResources,phaseState:held?'held':nativePassed?'completed':'failed',nativePassed,fixtureStarted:Boolean(fixture),browserStarted:Boolean(browser),browserClosed:browser?cleanup.closeResolved:null,browserDisconnected:browser?cleanup.disconnected:null,fixtureEOFRequested:cleanup.fixtureEOFRequested,fixtureStdinFinished:cleanup.fixtureStdinFinished,fixtureExitCode:cleanup.fixtureExit?.code??null,fixtureStdioClosed:cleanup.fixtureClose!==null,fixtureErrors:cleanup.fixtureErrors,owned:{profile:profile??null,origin:origin??null,fixturePid:fixture?.pid??null}};
 const report=fixture?await readingFixtureReport(base,evidence):{...base,fixtureTeardown:null};
 await writeFile(`${evidence}/native.json`,JSON.stringify(report,null,2));if(fixture)assert.deepEqual(report.fixtureTeardown.errors,[]);
}
if(held){
 assert.equal(browser,undefined);assert.equal(failure,undefined);assert.equal(results.length,0);assert.equal(cleanup.closeRequested,false);assert.equal(cleanup.closeResolved,false);assert.equal(cleanup.disconnected,null);
 assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
 if(held.boundary==='fixture'){assert.equal(fixture,undefined);assert.equal(profile,undefined);assert.equal(origin,undefined);assert.equal(cleanup.fixtureEOFRequested,false);assert.equal(cleanup.fixtureExit,null);}
 else{assert.equal(held.boundary,'browser');assert.ok(fixture);assert.equal(cleanup.fixtureClose.code,0);assert.equal(cleanup.fixtureClose.signal,null);assert.equal(cleanup.fixtureEOFRequested,true);assert.equal(cleanup.fixtureStdinFinished,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);}
 for(const path of sourceFiles)assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path]);
 console.log(JSON.stringify({phaseState:'held',nativePassed:false,boundary:held.boundary,browserStarted:false,browserClosed:null,fixtureStarted:Boolean(fixture)}));process.exitCode=75;
}else{
assert.equal(cleanup.closeRequested,true);assert.equal(cleanup.closeResolved,true);assert.equal(cleanup.disconnected,true);assert.equal(cleanup.fixtureEOFRequested,true);assert.equal(cleanup.fixtureStdinFinished,true);assert.equal(cleanup.fixtureExit.code,0);assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.profileAbsent,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const path of sourceFiles)assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hashes[path]);
assert.equal(failure,undefined);assert.ok(results.length);assert.ok(results.every(r=>r.passed),'inspect retained failures');console.log(JSON.stringify({passed:results.length,browserClosed:cleanup.disconnected,fixtureExit:cleanup.fixtureExit,profileAbsent:cleanup.profileAbsent,portClosed:cleanup.portClosed}));
}
