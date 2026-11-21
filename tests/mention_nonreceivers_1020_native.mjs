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
const baseline=process.argv.includes('--baseline');
const sourceFiles=['web/app.mjs','web/mention-notices.mjs','web/session.mjs','web/app-session.mjs','web/rails.css','aim_next/mention_reach.py','aim_next/store.py','aim_next/validation.py','tests/mention_nonreceivers_1020_native.mjs'].filter(path=>!baseline||!['web/mention-notices.mjs','aim_next/mention_reach.py'].includes(path));
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
  for(const width of [1280,390])for(const look of ['bookends','paper'])for(const surface of ['foot','pencil','reply','outcome','member','team','refused']) {
    const key=`${width}-${look}-${surface}`;if(!selected.test(key))continue;const result={key,errors:[]};
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
    await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.events1020=[];for(const type of ['pointerdown','pointerup','touchstart','touchend','click','focusout'])document.addEventListener(type,event=>{window.events1020.push({type,id:event.target.id,tag:event.target.tagName,prevented:event.defaultPrevented,active:document.activeElement?.id,x:event.clientX,y:event.clientY});},true);},look);
    const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>result.errors.push(error.message));
    const served={},jobs=[],sends=[];page.on('request',request=>{try{if(request.postDataJSON()?.kind==='message.send')sends.push(request.postDataJSON());}catch{}});page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path))jobs.push(response.body().then(body=>{served[path]=createHash('sha256').update(body).digest('hex');}));});
    try {
      let topicId;
      if(['outcome','team','refused'].includes(surface)) {
        const created=await control({method:'team_outcome',operation_id:`1020-${key}`,workspace_id:`1020-${key}`,title:`Mention outcome ${key}`,team:[facts.agent]});
        assert.equal(created.status,'committed');topicId=created.result.conversation_id;
      } else {
        const created=await control({method:'agent_topic',operation_id:`1020-${key}`,title:`Mention topic ${key}`,body:`Source ${key}`});topicId=created.topic_id;
      }
      await page.goto(`${origin}/?topic=${topicId}`);await page.locator('body[data-ready=true]').waitFor();
      let field=page.locator('#inline-writing-body'),send=page.locator('#inline-send');
      if(surface==='pencil')await page.locator('#new-message').click();
      if(surface!=='reply')await page.locator('#inline-kind-message').click();
      if(surface==='reply') {
        const card=page.locator('.message-card').first();await card.locator(':scope > .message-preview').click();
        const id=await card.getAttribute('data-id');field=page.locator(`[id="reply-${id}-writing-body"]`);send=page.locator(`[id="reply-${id}-send"]`);
      }
      const body=['member','team'].includes(surface)?`Native member ${key}: @fixture-notebook-agent`:`Native mention ${key}: @fixture-outside-agent @fixture-outside-agent.${['outcome','refused'].includes(surface)?'':' @fixture-notebook-agent'}`;
      await field.fill(body);await field.focus();
      // The fixture fills in one machine act. Await actual saved writing before
      // measuring/tapping; do not race the input's async fit/status repaint.
      const fieldId=await field.getAttribute('id');
      await page.waitForFunction(id=>document.getElementById(id)?.closest('.composer')?.querySelector('[data-save]')?.dataset.save==='saved',fieldId);
      const advisory=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.name==='submission_mention_reach';}catch{return false;}});advisory.catch(()=>{});
      const response=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});
      response.catch(()=>{});
      // Keyboard acts on laptop, native taps on touch contexts.
      if(process.argv.includes('--touch-send'))await send.tap();else await field.press('Meta+Enter');result.sendGesture=process.argv.includes('--touch-send')?'touch':'Meta+Enter';
      const receipt=await(await response).json();assert.equal(receipt.status,'committed');result.receipt=receipt;
      result.advisory=await(await advisory).json();
      const source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:receipt.result.message_id}}});assert.equal(source.body,body);result.source=source;
      if(surface==='team') {
        assert.deepEqual(result.advisory.items.map(p=>p.actor_id),[facts.agent]);assert.equal(result.advisory.items[0].may_add,false);
        const notice=page.locator('.mention-notice');await notice.waitFor();assert.ok((await notice.innerText()).includes('Name them in To'));assert.equal(await notice.getByRole('button').count(),1);
        await page.screenshot({path:`${evidence}/${key}-team.png`});const dismiss=notice.getByRole('button',{name:'Dismiss',exact:true});if(width===390)await dismiss.tap();else await dismiss.click();await notice.waitFor({state:'detached'});
      } else if(surface==='member'){assert.deepEqual(result.advisory.items,[]);assert.equal(await page.locator('.mention-notice').count(),0);result.passed=true;}else {
      const notice=page.locator('.mention-notice');await notice.waitFor();assert.equal(await notice.count(),1);
      assert.ok((await notice.innerText()).includes('@fixture-outside-agent'));
      assert.ok(!(await notice.innerText()).includes('@fixture-notebook-agent'),'member mention is quiet');
      assert.equal(await notice.getAttribute('role'),'status');
      const geometry=await notice.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,viewport:innerWidth,railOpen:n.closest('#rail').classList.contains('open'),parent:n.parentElement.id};});
      result.geometry=geometry;assert.equal(geometry.parent,'page-notices');assert.ok(geometry.x>=0&&geometry.right<=width+1&&geometry.y>=0&&geometry.bottom<=900,'left rail toast visible in viewport');
      if(width===390)assert.equal(geometry.railOpen,false,'phone drawer stays closed');
      const add=notice.getByRole('button',{name:`Add @fixture-outside-agent to ${['outcome','refused'].includes(surface)?'outcome':'topic'}`,exact:true});
      const box=await add.boundingBox();assert.ok(box.height>=44);await page.screenshot({path:`${evidence}/${key}-notice.png`});
      if(surface==='refused')result.ownerChange=await control({method:'outcome_change',sender:facts.actor,workspace_id:`1020-${key}`,owner:facts.agent,operation_id:`1020-${key}-owner`});
      const adding=page.waitForResponse(r=>{try{return ['participation.set','workspace.member_set'].includes(r.request().postDataJSON()?.kind);}catch{return false;}});
      adding.catch(()=>{});if(width===390)await add.tap();else await add.click();
      const added=await(await adding).json();result.added=added;
      if(surface==='refused') {
        assert.equal(added.status,'rejected');assert.equal(added.recorded,true,'this permission refusal is durably recorded');assert.equal(added.error.code,'FORBIDDEN');
        await notice.getByText(added.error.message,{exact:true}).waitFor();assert.equal(await notice.getByRole('button').count(),1);assert.ok(!(await notice.innerText()).includes('Check add'));
        await page.screenshot({path:`${evidence}/${key}-refused.png`});
        const dismiss=notice.getByRole('button',{name:'Dismiss',exact:true});if(width===390)await dismiss.tap();else await dismiss.click();await notice.waitFor({state:'detached'});
      } else {
      assert.equal(added.status,'committed');await add.getByText('Added',{exact:false}).count();
      await page.waitForFunction(operation=>document.querySelector(`[data-send-operation="${operation}"] button`)?.textContent.includes('Added to'),receipt.operation_id);
      const members=await control({method:'agent_view',actor:facts.actor,name:surface==='outcome'?'workspace_members':'topic',args:surface==='outcome'?{workspace_id:`1020-${key}`}:{topic_id:topicId}});
      assert.ok((members.items??members.participants).some(p=>p.actor_id==='fixture-outside-agent'));result.membership=members;
      const dismiss=notice.getByRole('button',{name:'Dismiss',exact:true});if(width===390)await dismiss.tap();else await dismiss.click();await notice.waitFor({state:'detached'});
      result.quiet=await control({method:'agent_view',actor:facts.actor,name:'submission_mention_reach',args:{submission_id:receipt.result.submission_id}});
      assert.deepEqual(result.quiet.items.map(p=>p.actor_id),surface==='outcome'?['fixture-outside-agent']:[]);
      if(surface==='outcome')assert.equal(result.quiet.items[0].may_add,false,'team Add does not subscribe an agent to Conversation');
      }
      }
      assert.equal(sends.length,1,'Add/refusal/Dismiss never resend');result.sendEnvelopes=sends;const messages=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:topicId}});assert.equal(messages.items.filter(m=>m.body===body).length,1);result.exactBodyCount=1;
      await Promise.all(jobs);result.served=served;for(const path of sourceFiles.filter(p=>p.startsWith('web/')))assert.equal(served[path],hashes[path],`${path} source matched`);
      assert.deepEqual(result.errors,[]);result.passed=true;
    }catch(error){result.error=error.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`,fullPage:true});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
    result.events=await page.evaluate(()=>window.events1020);results.push(result);console.log(JSON.stringify({key,passed:result.passed,error:result.error?.split('\n')[0]}));await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));retain();await context.close();
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
