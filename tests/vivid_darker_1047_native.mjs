// Real scratch Core/HTTP and native pointer/preference input. No live records.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
import {readingSeed} from './topic_reading_native.mjs';
import {Api} from '../web/api.mjs';
import {AgentColors} from '../web/colors.mjs';

const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_BROWSER??'chromium';
const out=process.argv[2],baseline=process.argv.includes('--baseline'),preflight=process.argv.includes('--preflight');
await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['web/index.html','web/aim.css','web/look.css','web/look-touch.css','web/agent-colors.css','web/look.mjs','web/colors.mjs','web/author-colors.mjs','web/feed-passages.mjs','web/lit-field.mjs','web/pointer-light.mjs','tests/fixtures/ui_http.py','tests/fixture_control.mjs','tests/vivid_darker_1047_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(f))])));
await writeFile(out+'/source.json',JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
await writeFile(out+'/producer.mjs',await readFile(new URL(import.meta.url)));
const load=Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]);assert.ok(load<12,'load below12/18: '+load);
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--agent-colors','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),rows=[],cleanup={},owned=new Set();
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(l=>{const m=l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return m?[{pid:+m[1],ppid:+m[2],command:m[3]}]:[];});
let browser,profile,origin,failure,version;
function retain(){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if((profile&&p.command.includes(profile)||owned.has(p.ppid))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}}
const closedPort=origin=>new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
const hues=['green','blue','indigo','violet','rose','peach','cyan','olive'];
const senders=['fable','aim-lead','fixture-guest-agent','aim-ux','aim-spec','aim-core','warp','fixture-notebook-agent'];
const expected={dark:['#00341b','#032a4c','#23234d','#351c43','#44162a','#441c00','#003338','#262d00'],light:['#003c1a','#002e5e','#26245f','#3f1953','#520f31','#531900','#003b42','#2a3300']};
const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')';
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
try{
 const facts=await control({method:'ready'});origin=facts.origin;
 const api=new Api(facts.token,(url,init)=>fetch(new URL(url,origin),{...init,headers:{...init?.headers,Origin:origin}})),boot=await api.bootstrap();
 const colors=new AgentColors({api,instanceId:facts.instance_id,authority:()=>boot.authority,doc:null,win:null});await colors.load();assert.equal((await colors.choose('fixture-guest-agent','indigo')).status,'committed');
 const topic='vivid1047',said=hues.map((h,i)=>[h,{sender:senders[i],join:true,body:`${h} first sentence. Another ${h} sentence.`,read:true,addressees:[facts.actor],divergence_reason:'1047 isolated color specimen'}]);
 said.push(['own',{sender:'person',body:'Own first sentence. Another own sentence.',read:true,addressees:['aim-core'],divergence_reason:'1047 own fallback'}],['plain',{sender:'fixture-other-person',join:true,body:'Plain first sentence. Another plain sentence.',read:true,addressees:[facts.actor],divergence_reason:'1047 plain fallback'}]);
 const ids=await readingSeed(control)(topic,said);
 profile=await mkdtemp(out+'/'+engine+'-profile-');const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});browser=persistent.browser();version=browser.version();retain();assert.ok(owned.size);
 const baseRows=process.env.AIM_1047_BASELINE?JSON.parse(await readFile(process.env.AIM_1047_BASELINE,'utf8')).rows:null;
 const cells=preflight?[[1280,'bookends','dark']]:[1280,390].flatMap(width=>['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>[width,look,theme])));
 for(const [width,look,colorScheme]of cells){
  assert.ok(Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1])<12,'load remains below12/18');
  const key=`${width}-${look}-${colorScheme}`,row={key,width,look,colorScheme,served:{},paints:{},checks:[],errors:[],events:[]};rows.push(row);
  // Narrow case is a pointer at phone width, not a physical finger-hover claim.
  const context=await browser.newContext({viewport:{width,height:950},colorScheme}),page=await context.newPage();page.setDefaultTimeout(6500);
  await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.gestures1047=[];addEventListener('click',e=>gestures1047.push({type:'click',trusted:e.isTrusted,text:e.target.textContent}),true);},look);
  page.on('pageerror',e=>row.errors.push(e.stack));
  const press=el=>el.click(),rail=page.locator('#rail');
  const openRail=async()=>{if(width<761&&await page.locator('#rail-open').isVisible()&&!await rail.evaluate(e=>e.classList.contains('open')))await press(page.locator('#rail-open'));};
  const closeRail=async()=>{if(width<761&&await rail.evaluate(e=>e.classList.contains('open')))await page.keyboard.press('Escape');};
  const choose=async(group,value)=>{await openRail();await press(page.locator(`.look-switch[data-switch="${group}"] button[data-value="${value}"]`));await closeRail();};
  const paint=async id=>{
   const el=page.locator(`#messages .message-card[data-id="${id}"] > .message-preview`);await el.scrollIntoViewIfNeeded();
   const p=await el.evaluate(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode())if(n.data.trim()){const r=document.createRange();r.setStart(n,0);r.setEnd(n,2);const b=r.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};}throw Error('no words');});
   await page.mouse.move(1,1);await page.mouse.move(p.x,p.y);await page.waitForFunction(id=>{const card=document.querySelector(`#messages .message-card[data-id="${id}"]`);return [...(CSS.highlights.get('lit-passage')??[])].some(r=>card.contains(r.commonAncestorContainer))&&[card,...card.querySelectorAll('*')].some(n=>getComputedStyle(n).backgroundImage!=='none');},id);
   return el.evaluate(el=>{const card=el.closest('.message-card'),h=getComputedStyle(el,'::highlight(lit-passage)'),c=getComputedStyle(card),s=getComputedStyle(el,'::selection'),rect=card.getBoundingClientRect(),canvas=document.createElement('canvas'),cx=canvas.getContext('2d');const bytes=color=>{cx.clearRect(0,0,1,1);cx.fillStyle=color;cx.fillRect(0,0,1,1);return [...cx.getImageData(0,0,1,1).data].slice(0,3);};
    return{cardClass:card.className,card:c.backgroundColor,field:h.backgroundColor,ink:h.color,fieldBytes:bytes(h.backgroundColor),inkBytes:bytes(h.color),deep:c.getPropertyValue('--agent-deep').trim(),line:getComputedStyle(el).backgroundImage,lineLayers:[...new Set([card,el,...el.querySelectorAll('*')].map(n=>getComputedStyle(n).backgroundImage).filter(v=>v!=='none'))].join(';'),selection:{field:s.backgroundColor,ink:s.color},geometry:{width:rect.width,height:rect.height},selected:getSelection().toString()};});
  };
  const check=async(name,fn)=>{try{await fn();row.checks.push({name,passed:true});}catch(error){row.checks.push({name,passed:false,error:error.stack});}};
  try{
   await page.goto(origin+'/?topic='+topic);await page.locator('body[data-ready=true]').waitFor();for(const id of Object.values(ids))await page.locator(`#messages .message-card[data-id="${id}"]`).waitFor();
   for(const file of files.filter(f=>f.startsWith('web/')&&f!=='web/index.html')){const url=await page.evaluate(file=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/'+file.split('/').at(-1)))?.name,file);assert.ok(url,'loaded '+file);row.served[file]=sha(await(await page.request.get(url)).body());assert.equal(row.served[file],hashes[file]);}
   for(const intensity of ['quiet','vivid'])for(const choice of ['','lighter','darker']){
    await choose('agentColors',intensity==='quiet'?'':intensity);await choose('lightColour',choice);
    const state=intensity+'-'+(choice||'Middle'),paints={};row.paints[state]=paints;
    for(const [h,id]of Object.entries(ids)){paints[h]=await paint(id);assert.ok(paints[h].lineLayers.includes(paints[h].field),`${state} ${h} actual paragraph line paint matches its highlight`);}
    const base=baseRows?.find(r=>r.key===key)?.paints[state];
    if(base){for(const h of Object.keys(ids)){
     // The initial baseline measured the preview's own background (line).
     // lineLayers adds its paragraph painters; keep line in every old comparison.
     const kept=p=>{const {deep,cardClass,lineLayers,...rest}=p;return rest;};
     if(state!=='vivid-darker'||['own','plain'].includes(h))assert.deepEqual(kept(paints[h]),kept(base[h]),`${key} ${state} ${h} unchanged`);
     else for(const field of ['card','selection','geometry','selected'])assert.deepEqual(paints[h][field],base[h][field],`${state} ${h} keeps ${field}`);
    }}
    if(state==='vivid-darker'){
     for(const [i,h]of hues.entries())await check(h+' follows exact designer hue with white words and >=4.5 contrast',async()=>{const p=paints[h];assert.equal(p.field,rgb(expected[colorScheme][i]));assert.ok(p.lineLayers.includes(rgb(expected[colorScheme][i])),'line field actually draws the hue');assert.equal(p.ink,'rgb(255, 255, 255)');assert.ok(contrast(p.inkBytes,p.fieldBytes)>=4.5);p.contrast=contrast(p.inkBytes,p.fieldBytes);});
     const fallback=look==='paper'?'#123908':'#00321f';for(const h of ['own','plain'])assert.equal(paints[h].field,rgb(fallback),'fixed green fallback '+h);
     await paint(ids.cyan);await page.screenshot({path:out+'/'+key+'-cyan.png'});
    }
   }
   // Actual control persistence, plus Light off suppresses the real highlighter.
   await choose('agentColors','vivid');await choose('lightColour','darker');await page.reload();await page.locator('body[data-ready=true]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.lightColour),'darker');assert.equal(await page.evaluate(()=>document.documentElement.dataset.agentColors),'vivid');
   row.reloadedCyan=await paint(ids.cyan);assert.deepEqual(row.reloadedCyan,row.paints['vivid-darker'].cyan.contrast?Object.fromEntries(Object.entries(row.paints['vivid-darker'].cyan).filter(([k])=>k!=='contrast')):row.paints['vivid-darker'].cyan);
   await choose('pointerLight','off');await page.mouse.move(1,1);const box=await page.locator(`#messages .message-card[data-id="${ids.cyan}"] > .message-preview`).boundingBox();if(box)await page.mouse.move(box.x+10,box.y+10);assert.equal(await page.evaluate(()=>CSS.highlights.get('lit-passage')?.size??0),0);row.lightOff=true;
   assert.deepEqual(row.errors,[]);row.events=await page.evaluate(()=>gestures1047);assert.ok(row.events.length&&row.events.every(e=>e.trusted),'all recorded preference clicks native');row.passed=row.checks.every(c=>c.passed);
  }catch(error){row.error=error.stack;row.passed=false;await page.screenshot({path:out+'/'+key+'-error.png'}).catch(()=>{});}
  retain();await context.close();await writeFile(out+'/observations.json',JSON.stringify(rows,null,2));console.log(JSON.stringify({key,passed:row.passed,checks:row.checks.map(c=>({name:c.name,passed:c.passed})),error:row.error?.split('\n')[0]}));
  if(row.error)break;
 }
}catch(error){failure=error.stack;}
finally{
 if(browser){retain();await browser.close();}cleanup.browserClosed=browser?!browser.isConnected():true;fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();const list=ps();cleanup.fixturePid=fixture.pid;cleanup.ownedPids=[...owned];cleanup.remainingOwned=list.filter(p=>owned.has(p.pid));cleanup.fixtureAbsent=!list.some(p=>p.pid===fixture.pid);cleanup.profileProcesses=profile?list.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;cleanup.portClosed=origin?await closedPort(origin):null;
 await writeFile(out+'/results.json',JSON.stringify({engine,version,baseline,load,hashes,rows,cleanup,failure},null,2));
}
assert.ok(cleanup.browserClosed&&cleanup.fixtureAbsent&&cleanup.profileAbsent&&cleanup.portClosed);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const f of files)assert.equal(sha(await readFile(f)),hashes[f],f+' unchanged during native phase');assert.equal(failure,undefined);assert.ok(rows.length&&rows.every(r=>r.passed),'1047 inspect retained observations');
