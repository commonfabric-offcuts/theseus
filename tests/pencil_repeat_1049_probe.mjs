// Headless input-mechanism diagnostic on unchanged1049 intake; not a Mac IME proof.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const api=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium',out=process.argv[2];
await mkdir(out,{recursive:true});const producerBody=await readFile(new URL(import.meta.url));await writeFile(out+'/producer.mjs',producerBody);
const sha=b=>createHash('sha256').update(b).digest('hex'),producer=sha(producerBody),files=['app.mjs','pencil-keys.mjs','inline-composer.mjs','compose-bar.mjs','pane-keys.mjs','session.mjs','interaction-guide.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile('web/'+p))])));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const load=+execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)[1];assert.ok(load<12);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(s=>{const m=s.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:+m[1],ppid:+m[2],command:m[3]}]:[];});
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness']),{control,exit,errors}=fixtureControl(fixture);
const owned=new Set(),cleanup={},row={engine,served:{},servedURLs:{},events:[],chords:[],pageErrors:[]};let browser,profile,facts,failure;
const observe=()=>{const rows=ps();for(const p of rows)if(profile&&p.command.includes(profile))owned.add(p.pid);for(let more=true;more;){more=false;for(const p of rows)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);more=true;}}};
try{
 facts=await control({method:'ready'});profile=await mkdtemp(out+'/'+engine+'-profile-');
 const persistent=await api[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{executablePath:process.env.AIM_WEBKIT})});browser=persistent.browser();observe();assert.ok(owned.size);await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>row.pageErrors.push({message:e.message,stack:e.stack}));
 await page.addInitScript(()=>{window.trace1049=[];for(const type of ['keydown','keyup','keypress','compositionstart','compositionupdate','compositionend','beforeinput','input'])addEventListener(type,e=>{const r={type,key:e.key,code:e.code,keyCode:e.keyCode,alt:e.altKey,repeat:e.repeat,isComposing:e.isComposing,data:e.data,inputType:e.inputType,trusted:e.isTrusted,target:e.target?.id};Object.defineProperty(r,'prevented',{enumerable:true,get:()=>e.defaultPrevented});trace1049.push(r);},true);});
 await page.goto(facts.origin+'/?topic=t1');await page.locator('body[data-ready=true]').waitFor();await page.locator('#new-message').click();const field=page.locator('#inline-writing-body');await field.fill('1049 keep these exact words');await field.press('Home');await field.press('ArrowRight');await field.press('ArrowRight');await field.press('Shift+ArrowRight');await field.press('Shift+ArrowRight');
 const snap=()=>page.evaluate(()=>{const f=document.getElementById('inline-writing-body');return{body:f.value,start:f.selectionStart,end:f.selectionEnd,direction:f.selectionDirection,active:document.activeElement?.id,sheet:document.getElementById('new-message-sheet').open,kind:document.querySelector('#inline-kind [aria-checked=true]')?.id};});
 await mkdir(out+'/served',{recursive:true});for(const p of files){const url=await page.evaluate(p=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/'+p))?.name,p);assert.ok(url,'actual loaded '+p);const body=await(await page.request.get(url)).body();row.servedURLs[p]=url;row.served[p]=sha(body);assert.equal(row.served[p],hashes[p]);await writeFile(out+'/served/'+p,body);}
 row.platform=await page.evaluate(()=>({platform:navigator.platform,userAgent:navigator.userAgent}));row.before=await snap();
 const chord=async(key,label)=>{const before=await snap(),at=await page.evaluate(()=>trace1049.length);await page.keyboard.press(key);const after=await snap(),events=await page.evaluate(at=>trace1049.slice(at),at);row.chords.push({label,key,before,after,events,wanted:key==='n'?'inline-kind-note-card':'inline-kind-message',modeMatches:after.kind===(key==='n'?'inline-kind-note-card':'inline-kind-message'),writingKept:before.body===after.body,selectionKept:before.start===after.start&&before.end===after.end&&before.direction===after.direction});};
 await page.keyboard.down('Alt');await chord('n','same-N-first');await chord('n','same-N-second');await chord('m','same-M-first');await chord('m','same-M-second');await page.keyboard.up('Alt');
 await page.keyboard.down('Alt');for(let i=0;i<50;i++)await chord(i%2?'m':'n','alternating-'+(i+1));await page.keyboard.up('Alt');
 await page.keyboard.type('x');await page.keyboard.down('Alt');await chord('n','after-letter-N');await page.keyboard.up('Alt');await page.keyboard.type('y');await page.keyboard.down('Alt');await chord('m','after-letter-M');await page.keyboard.up('Alt');
 row.events=await page.evaluate(()=>trace1049);row.after=await snap();row.driverModeFailures=row.chords.filter(c=>!c.modeMatches).map(c=>c.label);row.driverResidues=row.chords.filter(c=>!c.writingKept).map(c=>c.label);row.driverSelectionChanges=row.chords.filter(c=>!c.selectionKept).map(c=>c.label);row.deadKeyEvents=row.events.filter(e=>e.key==='Dead'||e.keyCode===229);row.compositionEvents=row.events.filter(e=>e.type.startsWith('composition'));row.driverInputComplete=row.chords.length===56;
 row.inputMechanism='Playwright keyboard via engine protocol in an isolated headless browser; no native macOS input-source/keyboard act.';row.nativeMacInputMethodProof=false;row.reportedMacResidueReproduced=row.driverResidues.length>0;row.limit='Trusted DOM protocol events do not establish the Mac input-method sequence. No imeSetComposition, synthetic composition or authored Dead/229 event was injected; no native OS act or visible window was used.';
 await page.screenshot({path:out+'/pencil.png'});assert.deepEqual(row.pageErrors,[]);await context.close();
}catch(e){failure=e.stack;}
finally{
 if(browser){observe();await browser.close();cleanup.browserClosed=!browser.isConnected();}const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?rows.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);
 if(facts)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(out+'/results.json',JSON.stringify({head,tree,source:process.cwd(),engine,version:browser?.version(),load,hashes,producer,producerAtEnd:sha(await readFile(new URL(import.meta.url))),row,cleanup,failure},null,2));
}
assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);assert.equal(cleanup.profileRemoved,true);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.equal(sha(await readFile(new URL(import.meta.url))),producer);assert.equal(failure,undefined);assert.equal(row.driverInputComplete,true);
console.log(JSON.stringify({engine,chords:row.chords.length,modeFailures:row.driverModeFailures,residue:row.driverResidues,deadKeyEvents:row.deadKeyEvents.length,compositionEvents:row.compositionEvents.length,nativeMacInputMethodProof:false,cleanup}));
process.exitCode=2; // Required Mac input method was not exercised; this is not a green1049 result.
