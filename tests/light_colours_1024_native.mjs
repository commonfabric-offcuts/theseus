// Real isolated Core/HTTP and native input. Paint observations are not gesture substitutes.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {join} from 'node:path';
import {fixtureControl} from './fixture_control.mjs';
import {readingSeed} from './topic_reading_native.mjs';
const api=await import(process.env.AIM_PLAYWRIGHT_CORE), engine=process.env.AIM_ENGINE??'chromium';
const source=process.env.AIM_SOURCE_DIR??process.cwd(), out=process.argv[2], baseline=process.argv.includes('--baseline');
const filterAt=process.argv.indexOf('--case'), filter=filterAt<0?null:new RegExp(process.argv[filterAt+1]);
await mkdir(out,{recursive:true});await writeFile(out+'/harness.mjs',await readFile(new URL(import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['aim.css','look.css','look-touch.css','look.mjs','feed-passages.mjs','pointer-light.mjs','reader.mjs','notebook-passages.mjs','agent-colors.css'];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(join(source,'web',f)))])));
const load=Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]);assert.ok(load<12,'load below12/18: '+load);
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--agent-colors','--other-person'],{cwd:source});
const {control,exit,errors}=fixtureControl(fixture);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{const m=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:+m[1],parent:+m[2],command:m[3]}]:[];});
const owned=new Set(), results=[];let browser,profile,facts,failure,version,stopRequested=false;process.on('SIGTERM',()=>{stopRequested=true;});process.on('SIGINT',()=>{stopRequested=true;});
const observe=()=>{const rows=ps();for(const p of rows)if(p.command.includes(profile))owned.add(p.pid);for(let changed=true;changed;){changed=false;for(const p of rows)if(owned.has(p.parent)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}};
const groups={look:'look',intensity:'agentColors',light:'pointerLight',colour:'lightColour'};
const selector=(group,value)=>`.look-switch[data-switch="${groups[group]}"] button[data-value="${value}"]`;
const lighter={bookends:{quiet:['#d5dbd9','#3b4442'],vivid:['#c9e3d8','#2e4c42']},paper:{quiet:['#e3dccf','#4a4237'],vivid:['#d9e0c2','#41482c']}};
const darker={bookends:{quiet:['#050606','#1a1c1d'],vivid:['#00321f','#00321f']},paper:{quiet:['#100d0a','#2b2723'],vivid:['#123908','#123908']}};
const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')';
const cleanup={};
try{
 facts=await control({method:'ready'});const seed=readingSeed(control),topic='light1024';
 const ids=await seed(topic,[['other',{sender:'aim-core',join:true,body:'Alpha sentence. Beta sentence.',read:true,addressees:[facts.actor],divergence_reason:'1024 isolated other card'}],['own',{sender:'person',body:'Own first sentence. Own next sentence.',read:true,addressees:['aim-core'],divergence_reason:'1024 isolated own card'}]]);
 const memory=await control({method:'agent_view',name:'memory_current',args:{item_id:'fixture-notebook'}});
 await control({method:'memory_revise',operation_id:'light1024-notebook',item_id:'fixture-notebook',expected_revision:memory.source_ref.revision,title:'Light notebook',body:'## Passage\n\nNotebook first sentence. Notebook next sentence.'});
 profile=await mkdtemp(out+'/'+engine+'-profile-');
 const persistent=await api[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();assert.ok(browser);version=browser.version();observe();assert.ok(owned.size);await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));
 const baseRows=process.env.LIGHT_BASELINE?JSON.parse(await readFile(process.env.LIGHT_BASELINE,'utf8')).results:null;
 nativeRows:for(const width of [1280,320,375,390])for(const theme of ['light','dark'])for(const look of ['bookends','paper'])for(const intensity of ['quiet','vivid']){
  if(stopRequested){failure='Owned run stopped for runner boundary';break nativeRows;}
  const key=`${width}-${theme}-${look}-${intensity}`;if(filter&&!filter.test(key))continue;
  const row={key,spec:{width,theme,look,intensity},served:{},paints:{},events:[],errors:[]};results.push(row);
  const phone=width<760,context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,hasTouch:phone,isMobile:phone});
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>row.errors.push({message:e.message,stack:e.stack,phase:row.phase}));
  await page.addInitScript(({look,intensity})=>{if(!sessionStorage.getItem('init1024')){sessionStorage.setItem('init1024','1');if(look==='paper')localStorage.setItem('theseus-look','paper');if(intensity==='vivid')localStorage.setItem('theseus-agent-colors','vivid');}window.pending1024=0;const realFetch1024=window.fetch;window.fetch=function(...args){window.pending1024++;return realFetch1024.apply(this,args).then(value=>{window.pending1024--;return value;},error=>{window.pending1024--;throw error;});};window.events1024=[];addEventListener('click',e=>events1024.push({trusted:e.isTrusted,type:'click',text:e.target.textContent}),true);},{look,intensity});
  const ready=async url=>{row.phase='settle before '+url;await page.waitForFunction(()=>!window.pending1024);row.phase='navigate '+url;await page.goto(url);await page.locator('body[data-ready=true]').waitFor();row.phase='ready '+url;};
  const openRail=async()=>{if(phone&&await page.locator('#rail-open').isVisible()&&await page.locator('#rail').count()&&!await page.locator('#rail').evaluate(e=>e.classList.contains('open')))await page.locator('#rail-open').tap();};
  const closeRail=async()=>{if(phone&&await page.locator('#rail').count()&&await page.locator('#rail').evaluate(e=>e.classList.contains('open')))await page.keyboard.press('Escape');};
  const press=async locator=>{if(phone)await locator.tap();else await locator.click();};
  const choose=async(group,value)=>{await openRail();await press(page.locator(selector(group,value)));await closeRail();};
  const hover=async locator=>{await locator.scrollIntoViewIfNeeded();const at=await locator.evaluate(el=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let t;while(t=walk.nextNode())if(t.data.trim()){const r=document.createRange();r.setStart(t,0);r.setEnd(t,Math.min(2,t.length));const b=r.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};}throw Error('no visible words');});await page.mouse.move(at.x-8,at.y);await page.mouse.move(at.x,at.y);};
  const paint=async(locator,pseudo,highlight=true)=>{await hover(locator);if(highlight)await page.waitForFunction(name=>Boolean(CSS.highlights.get(name)?.size),pseudo==='notebook-lit-passage'?'notebook-lit-passage':'lit-passage');return locator.evaluate((el,pseudo)=>{const s=getComputedStyle(el),h=getComputedStyle(el,`::highlight(${pseudo})`),n=getComputedStyle(el,'::selection'),host=el.closest('.message-card,.notebook-reading-words')??el;const layers=[el,...el.querySelectorAll('*')];for(let n=el.parentElement;n;n=n.parentElement){layers.push(n);if(n===host)break;}const images=[...new Set(layers.map(n=>getComputedStyle(n).backgroundImage).filter(v=>v!=='none'))];return{image:images.join(';'),background:h.backgroundColor,ink:h.color,field:getComputedStyle(host).getPropertyValue('--pointer-lit-field')||getComputedStyle(host).getPropertyValue('--lit-field'),selection:{background:n.backgroundColor,ink:n.color},font:s.fontSize,lineHeight:s.lineHeight};},pseudo);};
  const capture=async()=>{
   const paints={};row.captureInFlight=paints;for(const [name,id]of Object.entries(ids))paints[name]=await paint(page.locator(`#messages .message-card[data-id="${id}"] > .message-preview`),'lit-passage');
   {
    await hover(page.locator(`#messages .message-card[data-id="${ids.other}"] > .message-preview`));await page.keyboard.press('Enter');await page.locator('#reader[open]').waitFor();await page.locator('#source-body [data-start]').first().click();await hover(page.locator('#source-body [data-start]').first());
    await page.locator('#source-body .hover-quote').first().waitFor();paints.reader=await page.locator('#source-body .hover-quote').first().evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,ink:s.color,shadow:s.boxShadow,font:s.fontSize,lineHeight:s.lineHeight};});await page.locator('#reader-close').click();
    await ready(facts.origin+'/?cards=fixture-notebook&view=cards');const notebook=page.locator('.deck-card.notebook-reading-words .deck-words').first();await notebook.waitFor();paints.notebook=await paint(notebook,'notebook-lit-passage');
   }
   return paints;
  };
  try{
   await ready(facts.origin+'/?topic='+topic);
   for(const file of files){const url=await page.evaluate(file=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/'+file))?.name,file);assert.ok(url,'loaded '+file);row.served[file]=hash(await(await page.request.get(url)).body());assert.equal(row.served[file],hashes[file]);}
   row.paints.Middle=await capture();
   if(baseRows){const base=baseRows.find(x=>x.key===key);assert.ok(base?.paints.Middle,'baseline paint exists');assert.deepEqual(row.paints.Middle,base.paints.Middle,'Middle paint exactly equals309');}
   await openRail();row.featureRed=baseline&&await page.locator('.look-switch[data-switch="lightColour"]').count()===0;assert.equal(await page.locator('.look-switch[data-switch="lightColour"]').count(),1,'three colour choices exist');
   assert.equal(await page.locator(selector('colour','')).getAttribute('aria-pressed'),'true');
   row.geometry=await page.locator('.look-light-row').evaluate(el=>{const b=el.getBoundingClientRect();const rail=el.closest('#rail,.rail,main')?.getBoundingClientRect()??{left:0,right:innerWidth};return{left:b.left,right:b.right,rail:{left:rail.left,right:rail.right},screen:innerWidth,buttons:[...el.querySelectorAll('button')].map(e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,width:b.width,height:b.height};})};});
   assert.ok(row.geometry.left>=-1&&row.geometry.right<=width+1,'row fits viewport');assert.ok(row.geometry.buttons.every(b=>b.x>=row.geometry.left-1&&b.right<=row.geometry.right+1&&b.x>=row.geometry.rail.left&&b.right<=row.geometry.rail.right),'all controls fit their row and rail');if(phone)assert.ok(row.geometry.buttons.every(b=>b.width>=44&&b.height>=44),'44px touch targets');
   assert.ok(Math.max(...row.geometry.buttons.map(b=>b.y))-Math.min(...row.geometry.buttons.map(b=>b.y))<2,'Light and colours share one row');await page.screenshot({path:out+'/'+key+'-controls.png'});await closeRail();
   if(baseline)throw Error('baseline unexpectedly has colour controls');
   for(const choice of ['lighter','darker','']){
    await choose('colour',choice);await ready(facts.origin+'/?topic='+topic);row.paints[choice||'returnedMiddle']=await capture();
    if(!choice){assert.deepEqual(row.paints.returnedMiddle,row.paints.Middle,'returning Middle restores exact paint');continue;}
    await page.screenshot({path:out+'/'+key+'-'+choice+'-notebook.png'});
    const expected=choice==='lighter'?lighter[look][intensity]:darker[look][intensity];
    for(const [name,p]of Object.entries(row.paints[choice])){
     const field=choice==='darker'&&name==='own'?expected[1]:expected[0];
     if(name==='reader')assert.equal(p.background,rgb(field));else{assert.equal(p.background,rgb(field));assert.ok(p.image.includes(rgb(field)),'line field actually paints '+field);assert.deepEqual(p.selection,row.paints.Middle[name].selection,'native selection unchanged');}
     if(choice==='lighter')assert.equal(p.ink,rgb(expected[1]));else assert.equal(p.ink,row.paints.Middle[name].ink,'darker keeps existing ink');
    }
   }
   await choose('colour','darker');await choose('light','off');await openRail();assert.equal(await page.locator('.look-switch[data-switch="lightColour"]').isVisible(),false);await closeRail();
   await ready(facts.origin+'/?topic='+topic);assert.equal(await page.evaluate(()=>document.documentElement.dataset.pointerLight),'off');assert.equal(await page.evaluate(()=>localStorage.getItem('theseus-light-colour')),'darker');
   await hover(page.locator(`#messages .message-card[data-id="${ids.other}"] > .message-preview`));assert.equal(await page.evaluate(()=>CSS.highlights.get('lit-passage')?.size??0),0,'off pointer lights no passage');
   await choose('light','');await choose('colour','');await openRail();await press(page.locator(selector('colour','lighter')));await page.keyboard.press(engine==='webkit'?'Alt+Tab':'Tab');assert.equal(await page.locator(selector('colour','')).evaluate(e=>e===document.activeElement),true,'native Tab reaches Middle');await page.keyboard.press('Space');assert.equal(await page.locator(selector('colour','')).getAttribute('aria-pressed'),'true');await closeRail();
   // Native pointer selection and Return exercise routing with Light off and on.
   // DOM Range only measures visible glyph endpoints; it never writes Selection.
   row.gestures=[];
   for(const off of [true,false]){
    await choose('light',off?'off':'');await ready(facts.origin+'/?topic='+topic);
    const target=page.locator(`#messages .message-card[data-id="${ids.other}"] > .message-preview`);
    await page.locator('#workspace-name').click();await target.scrollIntoViewIfNeeded();
    const points=await target.evaluate(el=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let t;while(t=walk.nextNode()){const start=t.data.indexOf('Alpha sentence.');if(start<0)continue;return [start,start+14].map((n,i)=>{const r=document.createRange();r.setStart(t,n);r.setEnd(t,n+1);const b=r.getBoundingClientRect(),x=i?b.right-.25:b.left+.25,y=b.top+b.height/2;return{x,y,hit:el.contains(document.elementFromPoint(x,y))};});}throw Error('selection glyphs absent');});
    assert.ok(points.every(p=>p.hit),'visible selection endpoints');await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:6});await page.mouse.up();
    assert.equal(await page.evaluate(()=>getSelection().toString()),'Alpha sentence.','native drag selects exact source words');
    if(off)assert.equal(await page.evaluate(()=>CSS.highlights.get('lit-passage')?.size??0),0,'off drag does not light pointer passage');
    await page.keyboard.press('Enter');await page.locator('#reader[open]').waitFor();assert.equal(await page.locator('#writing-body').inputValue(),'> Alpha sentence.\n\n','Return keeps exact selected quote');
    row.gestures.push({off,selected:await page.locator('#writing-body').inputValue()});await page.locator('#writing-body').fill('');await page.locator('#reader-close').click();
   }
   // A real navigation preserves the same module-owned preference controls.
   await choose('colour','darker');await openRail();await page.locator('.look-light-row').evaluate(el=>{window.lightRow1024=el;window.lightDocument1024=document;});
   await press(page.locator('#rail .wordmark'));await page.waitForFunction(()=>!new URL(location.href).searchParams.has('topic'));await page.locator('body[data-ready=true]').waitFor();
   assert.equal(await page.evaluate(()=>window.lightDocument1024===document),true,'in-place navigation retains document');
   assert.equal(await page.locator('.look-light-row').count(),1);assert.equal(await page.locator('.look-switch[data-switch="lightColour"]').count(),1);assert.equal(await page.locator('.look-light-row').evaluate(el=>el===window.lightRow1024),true,'same owned row remounted');assert.equal(await page.evaluate(()=>document.documentElement.dataset.lightColour),'darker');
   assert.deepEqual(row.errors,[]);row.passed=true;
  }catch(error){row.passed=false;row.error=error.stack;await page.screenshot({path:out+'/'+key+'.png'}).catch(()=>{});}
  row.events=await page.evaluate(()=>events1024).catch(()=>[]);observe();await context.close();await writeFile(out+'/observations.json',JSON.stringify(results,null,2));console.log(JSON.stringify({key,passed:row.passed,error:row.error?.split('\n')[0]}));await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));if(!row.passed&&(!baseline||!row.featureRed))break nativeRows;
 }
}catch(error){failure=error.stack;}
finally{
 if(browser){observe();await browser.close();cleanup.browserClosed=!browser.isConnected();}const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?rows.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);
 if(facts)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(out+'/results.json',JSON.stringify({engine,version,source,baseline,load,hashes,producer_sha256:hash(await readFile(new URL(import.meta.url))),results,cleanup,failure},null,2));
}
assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);assert.equal(cleanup.profileRemoved,true);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);
if(failure)throw Error(failure);assert.ok(results.length&&results.every(r=>r.passed),'1024 native checks; inspect evidence');
