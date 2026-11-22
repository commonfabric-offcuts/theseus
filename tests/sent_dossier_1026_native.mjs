// Native Send/close/focus and real isolated Core receipts. No destination focus setter.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engine=process.env.AIM_ENGINE??'chromium',api=await import(process.env.AIM_PLAYWRIGHT_CORE);
const out=process.argv[2],at=process.argv.indexOf('--case'),filter=at<0?null:new RegExp(process.argv[at+1]),guards=process.argv.includes('--guards');
await mkdir(out,{recursive:true});await writeFile(out+'/producer.mjs',await readFile(new URL(import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['app.mjs','inline-composer.mjs','compose-bar.mjs','pencil-keys.mjs','session.mjs','app-session.mjs','card-replies.mjs','message-menu.mjs','card-reading.mjs','paper-flight.mjs','fold.mjs','aim.css','write-touch.css','reader.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile('web/'+p))])));
const producer=sha(await readFile(new URL(import.meta.url)));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const load=+execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)[1];assert.ok(load<12,'launch load below12/18: '+load);
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--agent-colors']);
const {control,exit,errors}=fixtureControl(fixture);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(s=>{const m=s.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:+m[1],ppid:+m[2],command:m[3]}]:[];});
const results=[],owned=new Set(),cleanup={};let browser,profile,facts,failure,stopRequested=false;
process.on('SIGTERM',()=>{stopRequested=true;});process.on('SIGINT',()=>{stopRequested=true;});
const observe=()=>{const rows=ps();for(const p of rows)if(profile&&p.command.includes(profile))owned.add(p.pid);for(let changed=true;changed;){changed=false;for(const p of rows)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}};
try{
 facts=await control({method:'ready'});profile=await mkdtemp(out+'/'+engine+'-profile-');
 const persistent=await api[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:process.env.AIM_WEBKIT?{executablePath:process.env.AIM_WEBKIT}:{})});
 browser=persistent.browser();observe();assert.ok(owned.size);await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));
 cases:for(const width of [1280,390])for(const look of ['bookends','paper'])for(const surface of ['modal','inline'])for(const motion of (guards?['normal']:['normal','reduce']))for(const scenario of (guards?['late-writing','later-control','refusal']:['ordinary'])){
  const key=`${width}-${look}-${surface}-${motion}`+(guards?'-'+scenario:'');if(filter&&!filter.test(key))continue;if(stopRequested){failure='Stopped for explicit boundary';break;}
  const row={key,width,look,surface,motion,scenario,served:{},errors:[],sends:[]};results.push(row);
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<760,isMobile:width<760,reducedMotion:motion==='reduce'?'reduce':'no-preference'});
  await context.addInitScript(look=>{
   if(look==='paper')localStorage.setItem('theseus-look','paper');
   window.probe1026={events:[],animations:[],pending:0};const p=window.probe1026,f=window.fetch;
   window.fetch=function(...args){p.pending++;return f.apply(this,args).then(r=>{p.pending--;return r;},e=>{p.pending--;throw e;});};
   const state=()=>({active:document.activeElement?.id,tag:document.activeElement?.tagName,card:document.activeElement?.closest('.message-card')?.dataset.id,stack:document.activeElement?.closest('.reply-stack')?.dataset.stack});
   for(const type of ['pointerdown','pointerup','click','keydown','focusin','close'])document.addEventListener(type,e=>p.events.push({type,trusted:e.isTrusted,id:e.target.id,...state()}),true);
   const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const a=animate.call(this,frames,options),r={id:this.id,cls:String(this.className),frames,options,finished:false,cancelled:false};p.animations.push(r);a.finished.then(()=>{r.finished=true;},()=>{r.cancelled=true;});return a;};
  },look);
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>row.errors.push({message:e.message,stack:e.stack}));
  page.on('request',r=>{try{const e=r.postDataJSON();if(e?.kind==='message.send')row.sends.push(e);}catch{}});
  const press=async l=>width<760?l.tap():l.click();let releaseSend;
  try{
   const created=await control({method:'agent_topic',operation_id:'sent1026-'+key,title:'Sent dossier '+key,body:'Initial isolated dossier.'});row.topic=created.topic_id;
   await page.goto(facts.origin+'/?topic='+row.topic);await page.locator('body[data-ready=true]').waitFor();
   for(const p of files){const url=await page.evaluate(p=>performance.getEntriesByType('resource').find(x=>new URL(x.name).pathname.endsWith('/'+p))?.name,p);assert.ok(url,'loaded '+p);row.served[p]=sha(await(await page.request.get(url)).body());assert.equal(row.served[p],hashes[p]);}
   const field=page.locator('#inline-writing-body'),send=page.locator('#inline-send');
   if(surface==='modal'){await press(page.locator('#new-message'));await page.locator('#new-message-sheet[open]').waitFor();}else await press(field);
   await press(page.locator('#inline-kind-message'));
   const body='New dossier from '+key+'.';await press(field);await page.keyboard.insertText(body);
   await page.waitForFunction(()=>document.getElementById('inline-writing-body')?.closest('.composer')?.querySelector('[data-save]')?.dataset.save==='saved');
   row.before=await page.evaluate(()=>({active:document.activeElement?.id,sheet:document.getElementById('new-message-sheet').open,body:document.getElementById('inline-writing-body').value}));
   let sendSeen;const seen=new Promise(r=>sendSeen=r),held=new Promise(r=>releaseSend=r);
   if(guards)await page.route('**/api/command',async route=>{
    const e=route.request().postDataJSON();if(e?.kind!=='message.send')return route.continue();
    if(scenario==='refusal')return route.fulfill({status:200,json:{v:1,instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'PUBLICATION_REFUSED',message:'Isolated injected publication refusal; writing kept.'}}});
    const response=await route.fetch();row.heldReceipt=await response.json();sendSeen();await held;await route.fulfill({response});
   });
   const response=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});response.catch(()=>{});
   await press(send);
   if(guards&&scenario!=='refusal'){
    await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('held committed Send not reached')),7000))]);
    assert.equal(row.heldReceipt.status,'committed');
    if(scenario==='late-writing'){await press(field);await page.keyboard.insertText('Later writing remains.');}
    else if(surface==='modal')await press(page.locator('#new-message-close'));else await press(page.locator('#new-message'));
    row.later=await page.evaluate(()=>({active:document.activeElement?.id,body:document.getElementById('inline-writing-body').value,sheet:document.getElementById('new-message-sheet').open}));releaseSend();
   }
   row.receipt=await(await response).json();
   if(guards){
    if(scenario==='refusal'){
     assert.equal(row.receipt.status,'rejected');assert.equal(await field.isVisible(),true);
     if(surface==='modal')await press(page.locator('#new-message-close'));
     await press(page.locator('#inline-pending button').first());await page.locator('#version-review[open]').waitFor();
     row.recovery=await page.locator('#review-content').innerText();assert.ok(row.recovery.includes(body));await press(page.locator('#review-close'));
    }else{
     const id=row.receipt.result.message_id;row.source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id}}});assert.equal(row.source.body,body);
     await page.locator(`.message-card[data-id="${id}"]`).waitFor();
     // Wait for the actual response handler's status paint, not an invented delay.
     await page.waitForFunction(()=>document.getElementById('inline-composer')?.querySelector('[data-save]')?.dataset.save==='saved');
     await page.waitForFunction(()=>!document.querySelector('#inline-pending button'));
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     row.kept=await page.evaluate(()=>({active:document.activeElement?.id,body:document.getElementById('inline-writing-body').value,sheet:document.getElementById('new-message-sheet').open,compose:document.getElementById('inline-composer').dataset.compose}));
     if(scenario==='late-writing'){assert.equal(row.kept.body,'Later writing remains.');assert.equal(row.kept.active,'inline-writing-body');assert.equal(row.kept.sheet,surface==='modal');}
     else{assert.equal(row.kept.sheet,row.later.sheet);assert.equal(row.kept.active,row.later.active);}
    }
    assert.equal(row.sends.length,1);assert.deepEqual(row.errors,[]);row.passed=true;await page.screenshot({path:out+'/'+key+'-kept.png'});
   }else{
   assert.equal(row.receipt.status,'committed');const id=row.receipt.result.message_id;row.message=id;
   row.source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id}}});assert.equal(row.source.body,body);assert.equal(row.sends.length,1);
   await page.locator(`#messages .message-card[data-id="${id}"]`).waitFor();
   await page.waitForFunction(()=>!document.getElementById('new-message-sheet').open&&document.getElementById('inline-writing-body').value==='');
   if(surface==='modal')await page.waitForFunction(()=>probe1026.events.some(e=>e.type==='close'&&e.id==='new-message-sheet'));
   await page.waitForFunction(()=>!document.querySelector('.paper-ghost')&&!document.body.classList.contains('paper-sending'));
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   row.after=await page.evaluate(id=>{const active=document.activeElement,card=document.querySelector(`#messages .message-card[data-id="${id}"]`);return{active:active?.id,activeHTML:active?.outerHTML.slice(0,1600),focusedCard:active?.closest('.message-card')?.dataset.id,focusedStack:active?.closest('.reply-stack')?.dataset.stack,targetStack:card?.closest('.reply-stack')?.dataset.stack,targetClass:card?.className,sheet:document.getElementById('new-message-sheet').open,composer:document.getElementById('inline-composer').className,lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(n=>n.dataset.id),probe:probe1026};},id);
   row.reproducedPencilFocus=row.after.active==='new-message';await page.screenshot({path:out+'/'+key+'-after-send.png'});
   assert.equal(row.after.focusedCard===id||Boolean(row.after.targetStack&&row.after.focusedStack===row.after.targetStack),true,'confirmed Send focuses its actual message/dossier without corrective focus');
   assert.ok(row.after.lit.includes(id),'sent card visibly selected');
   assert.equal(await page.locator('#inline-composer').getAttribute('data-compose'),'line','pencil folded');
   await page.keyboard.press('Enter');
   const replyRoot=page.locator(`[id="reply-${id}-composer"]`),replyField=replyRoot.locator('textarea');
   await replyField.waitFor();await page.waitForFunction(id=>document.activeElement?.closest('.card-reply-composer')?.id===`reply-${id}-composer`,id);
   row.returnTarget=await replyField.evaluate(n=>({active:document.activeElement===n,root:n.closest('.card-reply-composer').id}));
   const replyBody='Reply in existing dossier '+key+'.';await page.keyboard.insertText(replyBody);
   await page.waitForFunction(id=>document.getElementById(`reply-${id}-composer`)?.querySelector('[data-save]')?.dataset.save==='saved',id);
   const replyResponse=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});replyResponse.catch(()=>{});
   await press(replyRoot.locator(`[id="reply-${id}-send"]`));row.replyReceipt=await(await replyResponse).json();assert.equal(row.replyReceipt.status,'committed');
   const replyId=row.replyReceipt.result.message_id;row.replySource=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:replyId}}});
   assert.equal(row.replySource.body,replyBody);assert.equal(row.replySource.reply_to,id);assert.equal(row.replySource.dossier.root_id,id);assert.equal(row.sends.length,2);
   await page.waitForFunction(id=>document.activeElement?.closest('.message-card')?.dataset.id===id,replyId);
   row.replyAfter=await page.evaluate(id=>({focused:document.activeElement?.closest('.message-card')?.dataset.id,lit:document.querySelector(`.message-card[data-id="${id}"]`)?.classList.contains('lit'),root:document.querySelector(`.message-card[data-id="${id}"]`)?.closest('.reply-stack')?.dataset.stack}),replyId);
   assert.equal(row.replyAfter.focused,replyId);assert.equal(row.replyAfter.lit,true);assert.equal(row.replyAfter.root,id);assert.equal(await replyRoot.isVisible(),false);
   await page.screenshot({path:out+'/'+key+'-existing-dossier.png'});assert.deepEqual(row.errors,[]);row.passed=true;
   }
  }catch(e){row.passed=false;row.error=e.stack;row.failureDOM=await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,2000),sheet:document.getElementById('new-message-sheet')?.open,body:document.getElementById('inline-writing-body')?.value,probe:window.probe1026})).catch(()=>null);await page.screenshot({path:out+'/'+key+'-failure.png'}).catch(()=>{});}
  releaseSend?.();observe();await writeFile(out+'/owned-pids.json',JSON.stringify({profile,pids:[...owned],fixture:fixture.pid}));await context.close();await writeFile(out+'/observations.json',JSON.stringify(results,null,2));console.log(JSON.stringify({key,passed:row.passed,reproducedPencilFocus:row.reproducedPencilFocus,error:row.error?.split('\n')[0]}));if(!row.passed)break cases;
 }
}catch(e){failure=e.stack;}
finally{
 if(browser){observe();await browser.close();cleanup.browserClosed=!browser.isConnected();}const rows=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=rows.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?rows.filter(p=>p.command.includes(profile)):[];
 if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
 fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);
 if(facts)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(facts.origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
 await writeFile(out+'/results.json',JSON.stringify({engine,version:browser?.version(),head,source:process.cwd(),load,hashes,producer,producerAtEnd:sha(await readFile(new URL(import.meta.url))),results,cleanup,failure},null,2));
}
assert.equal(sha(await readFile(new URL(import.meta.url))),producer,'producer stays byte-identical through this phase');assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);assert.equal(cleanup.profileRemoved,true);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.equal(cleanup.fixtureAbsent,true);assert.equal(cleanup.portClosed,true);assert.ok(results.length&&results.every(r=>r.passed),'1026 native focus check; retained actual failures');
