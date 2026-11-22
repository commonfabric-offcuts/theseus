// Actual app/HTTP/Core sends and native notice controls in isolated records.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['web/compose-bar.mjs','web/mention-pick.mjs','web/inline-composer.mjs','web/reader.mjs','web/app.mjs','web/session.mjs','web/aim.css','web/write-touch.css','tests/first_touch_send_1022_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}}
try {
  const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();retain();assert.ok(owned.size);
  for(const width of [320,375,390,1280])for(const look of ['bookends','paper'])for(const surface of ['foot','reply','pencil','reader']) {
    const key=`${width}-${look}-${surface}`;if(!selected.test(key))continue;const result={key,errors:[]};
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760});
    await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.events1022=[];for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click','focusout'])document.addEventListener(type,event=>{window.events1022.push({type,id:event.target.id,tag:event.target.tagName,prevented:event.defaultPrevented,active:document.activeElement?.id,x:event.clientX,y:event.clientY});},true);},look);
    const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>result.errors.push(error.message));
    const served={},jobs=[],sends=[];page.on('request',request=>{try{const e=request.postDataJSON();if(e?.kind==='message.send')sends.push(e);}catch{}});page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path))jobs.push(response.body().then(body=>{served[path]=createHash('sha256').update(body).digest('hex');}));});
    try {
      const created=await control({method:'agent_topic',operation_id:`1022-${key}`,title:`First touch ${key}`,body:`Source ${key}`}),topicId=created.topic_id;
      await page.goto(`${origin}/?topic=${topicId}`);await page.locator('body[data-ready=true]').waitFor();
      let field=page.locator('#inline-writing-body'),send=page.locator('#inline-send');
      if(surface==='pencil')await page.locator('#new-message').click();
      if(!['reply','reader'].includes(surface))await page.locator('#inline-kind-message').click();
      if(['reply','reader'].includes(surface)) {
        const card=page.locator('.message-card').first();await card.locator(':scope > .message-preview').click();
        const id=await card.getAttribute('data-id');field=page.locator(`[id="reply-${id}-writing-body"]`);send=page.locator(`[id="reply-${id}-send"]`);
        if(surface==='reader'){await card.locator(':scope > .message-preview').click();await page.locator('#reader[open]').waitFor();field=page.locator('#writing-body');send=page.locator('#send-reply');}
      }
      const body=(width>760||process.argv.includes('--plain'))?`First native Send ${key}\nExact saved writing.`:`Native mention ${key}: @fixture-outside-agent @fixture-outside-agent. @fixture-notebook-agent`;
      await field.fill(body);await field.focus();
      const fieldId=await field.getAttribute('id');
      await page.waitForFunction(id=>document.getElementById(id)?.closest('.composer')?.querySelector('[data-save]')?.dataset.save==='saved',fieldId);
      const response=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});
      response.catch(()=>{});
      // The first touch/click is the only Send act in this case.
      result.before=await field.evaluate(f=>{const s=f.closest('.composer').querySelector(':scope > .compose-send'),r=s.getBoundingClientRect();return {focus:document.activeElement===f,pickerOpen:f.getAttribute('aria-expanded'),pickerHeight:f.parentElement.querySelector('.mention-pick')?.getBoundingClientRect().height,send:{x:r.x,y:r.y,width:r.width,height:r.height},scrollY,vv:{height:visualViewport.height,top:visualViewport.offsetTop}};});
      if(width<=760){assert.equal(result.before.pickerOpen,'true');assert.ok(result.before.pickerHeight>0);}
      if(width<=760)await send.tap();else await send.click();
      const receipt=await(await response).json();assert.equal(receipt.status,'committed');result.receipt=receipt;
      const source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:receipt.result.message_id}}});assert.equal(source.body,body);result.source=source;
      const operation=await control({method:'agent_view',actor:facts.actor,name:'operation',args:{operation_id:receipt.operation_id}});assert.equal(operation.result.message_id,receipt.result.message_id);result.operation=operation;assert.equal(sends.length,1);result.sendEnvelopes=sends;
      const messages=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:topicId}});assert.equal(messages.items.filter(m=>m.body===body).length,1);result.exactBodyCount=1;
      await page.screenshot({path:`${evidence}/${key}-sent.png`});
      await Promise.all(jobs);result.served=served;for(const path of sourceFiles.filter(p=>p.startsWith('web/')))assert.equal(served[path],hashes[path],`${path} source matched`);
      assert.deepEqual(result.errors,[]);result.passed=true;
    }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
    result.events=await page.evaluate(()=>window.events1022);results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
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
