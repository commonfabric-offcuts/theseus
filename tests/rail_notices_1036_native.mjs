// Actual question withdrawal, notice closure and mention Add in isolated records.
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
const sourceFiles=['web/boot.js','web/page-notices.mjs','web/lines.mjs','web/mention-notices.mjs','web/app.mjs','web/rails.css','web/aim.css','web/rail-dense.css','web/look.mjs','web/outcome-scope.mjs','web/question-withdrawal.mjs','tests/fixtures/ui_http.py','tests/rail_notices_1036_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}writeFileSync(`${evidence}/owned-processes.json`,JSON.stringify({profile,fixturePid:fixture.pid,ownedPids:[...owned]}));}
try {
  const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();retain();assert.ok(owned.size);
  for(const width of [320,375,390,1280])for(const look of ['bookends','paper'])for(const density of (width===1280?['compact','roomy']:['compact']))for(const surface of ['topic','main',...((width===390||width===1280)&&density==='compact'?['boot']:[])]) {
    const key=`${width}-${look}-${density}-${surface}`;if(!selected.test(key))continue;const result={key,errors:[]};
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760});
    await context.addInitScript(({look,density})=>{localStorage.setItem('theseus-look',look);localStorage.setItem('theseus-rail-roomy',density==='roomy'?'1':'0');},{look,density});
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>result.errors.push(error.message));
    const served={},jobs=[];page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path))jobs.push(response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');}));});
    const press=async target=>{if(width<=760)await target.tap();else {await target.focus();await page.keyboard.press('Space');}};
    const geometry=async notice=>notice.evaluate(n=>{const r=n.getBoundingClientRect(),b=n.querySelector('.page-notice-close'),c=b.getBoundingClientRect(),s=getComputedStyle(n),p=getComputedStyle(b,'::before');return {host:n.parentElement.parentElement.id,font:parseFloat(s.fontSize),actionFonts:[...n.querySelectorAll('button:not(.page-notice-close)')].map(x=>parseFloat(getComputedStyle(x).fontSize)),close:{x:c.x,y:c.y,right:c.right,bottom:c.bottom,width:c.width,height:c.height,paintedBox:c.width-2*parseFloat(p.left)},box:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},viewport:innerWidth};});
    try {
      const created=await control({method:'agent_topic',operation_id:`1036-${key}`,title:`Notices ${key}`,body:'An isolated parent.'}),topicId=created.topic_id;
      const questions=[];for(let i=0;i<2;i++){const r=await control({method:'agent_message',sender:'person',whole_topic:true,topic_id:topicId,operation_id:`1036-${key}-ask${i}`,body:`Question ${i} for ${key}?`,post_args:{addressees:[facts.agent],intent:'ask'}});assert.equal(r.status,'committed');questions.push(r.result.message_id);}
      if(surface==='boot')await page.route('**/app.mjs',route=>route.abort('failed'));
      await page.goto(`${origin}/${surface==='topic'?'?topic='+topicId:''}`);
      const inlineBoot=await page.evaluate(()=>[...document.scripts].find(s=>!s.src&&s.textContent.startsWith("// The page's boot,"))?.textContent);result.inlineBootHash=createHash('sha256').update(inlineBoot).digest('hex');assert.equal(result.inlineBootHash,hashes['web/boot.js']);
      if(surface==='boot'){
        const status=page.locator('#app-status');await status.waitFor();assert.ok((await status.innerText()).includes('Theseus could not open this page.'));assert.equal(await page.locator('body').getAttribute('data-ready'),null);result.bootGeometry=await geometry(status);const g=result.bootGeometry;assert.ok(Math.abs(g.font-(width>760?12.32:13.6))<.15);assert.ok(g.actionFonts.every(f=>Math.abs(f-g.font)<.15));assert.ok(g.close.right<=g.box.right&&g.close.bottom<=g.box.bottom+.5);assert.ok(g.close.x>=g.box.x&&g.close.y>=g.box.y);assert.ok(g.box.x>=0&&g.box.right<=width+.5);assert.ok(g.close.paintedBox<25);if(width<=760)assert.ok(g.close.width>=44&&g.close.height>=44);await page.screenshot({path:`${evidence}/${key}-boot-visible.png`});
        const loaded=page.waitForEvent('domcontentloaded');loaded.catch(()=>{});await press(status.getByRole('button',{name:'Reload',exact:true}));await loaded;await status.waitFor();result.reloadWorks=true;
        await press(status.getByRole('button',{name:'Close notice',exact:true}));await status.waitFor({state:'hidden'});if(width>760)assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
        const buildRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/build');buildRead.catch(()=>{});await page.addScriptTag({type:'module',url:await page.locator('script[type=module][src$="/app.mjs"]').first().getAttribute('src')}).catch(()=>{});await(await buildRead).json();await page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await status.isVisible(),false);result.repeatedBootFailureStaysClosed=true;
        assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);await page.screenshot({path:`${evidence}/${key}-boot-closed.png`});await Promise.all(jobs);result.served=served;for(const path of ['web/aim.css','web/rails.css','web/rail-dense.css','web/look.mjs'])assert.equal(served[path],hashes[path]);assert.deepEqual(result.errors,[]);result.passed=true;
      }else{
      await page.locator('body[data-ready=true]').waitFor();assert.equal(await page.locator('html').getAttribute('data-look'),look==='paper'?'paper':null);
      const status=page.locator('#app-status');
      async function withdraw(id){const card=page.locator(`.message-card[data-id="${id}"]`);await card.focus();const more=page.locator('.message-bar').getByRole('button',{name:'More for this message',exact:true});if(width<=760)await more.tap();else await more.click();const reply=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.withdraw';}catch{return false;}});reply.catch(()=>{});if(width<=760)await page.getByText('Withdraw question',{exact:true}).tap();else await page.getByText('Withdraw question',{exact:true}).click();const receipt=await(await reply).json();assert.equal(receipt.status,'committed');return receipt;}
      if(surface==='topic'){result.withdrawal=await withdraw(questions[0]);await status.waitFor();assert.ok((await status.innerText()).includes('Question withdrawn.'));}
      else {result.mainProjection=true;await page.evaluate(async()=>{const {showLine}=await import('/lines.mjs');showLine(document.getElementById('app-status'),'Question withdrawn.');});await status.waitFor();}
      result.statusGeometry=await geometry(status);const g=result.statusGeometry;assert.equal(g.host,surface==='topic'?'rail':'main');assert.ok(Math.abs(g.font-(width>760&&density==='compact'?12.32:13.6))<.15);assert.ok(g.close.right<=g.box.right&&g.close.bottom<=g.box.bottom+.5);assert.ok(g.close.x>=g.box.x&&g.close.y>=g.box.y);assert.ok(g.box.x>=0&&g.box.right<=width+.5);assert.ok(g.close.paintedBox<25);if(width<=760)assert.ok(g.close.width>=44&&g.close.height>=44);
      const close=status.getByRole('button',{name:'Close notice',exact:true});await press(close);await status.waitFor({state:'hidden'});if(width>760)assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
      if(surface==='topic'){result.secondWithdrawal=await withdraw(questions[1]);assert.equal(await status.isVisible(),false,'a later actual status on this page stays closed');}
      else {await page.evaluate(async()=>{const {showLine}=await import('/lines.mjs');showLine(document.getElementById('app-status'),'Question withdrawn.');});assert.equal(await status.isVisible(),false);}
      // Isolated control projections in the real host avoid racing active status
      // writers. The actual update/wake functions and contact paints are unit-read.
      result.projections=[];
      for(const channel of ['wakes-status','updates-status','topic-navigation-status']){
        const id='fixture-'+channel;
        await page.evaluate(async id=>{const {showLine}=await import('/lines.mjs');const projected=document.createElement('div');projected.id=id;projected.className='notice';document.getElementById('page-notices').append(projected);const action=document.createElement('button');action.type='button';action.textContent='Keep action';action.onclick=()=>window.noticeActions1036=(window.noticeActions1036??0)+1;showLine(document.getElementById(id),['Projected '+id,action]);},id);
        const n=page.locator('#'+id);await n.waitFor();const before=await page.evaluate(()=>window.noticeActions1036??0);await press(n.getByRole('button',{name:'Keep action',exact:true}));assert.equal(await page.evaluate(()=>window.noticeActions1036),before+1);const layout=await geometry(n);assert.ok(layout.actionFonts.every(f=>Math.abs(f-layout.font)<.15));await press(n.getByRole('button',{name:'Close notice',exact:true}));await n.waitFor({state:'hidden'});
        await page.evaluate(async id=>{const {showLine}=await import('/lines.mjs');showLine(document.getElementById(id),'Projected again');},id);assert.equal(await n.isVisible(),false);result.projections.push({id,layout});
      }
      if(surface==='topic'){
        const field=page.locator('#inline-writing-body');await page.locator('#inline-kind-message').click();const body=`Native mention ${key}: @fixture-outside-agent`;await field.fill(body);await field.focus();await page.waitForFunction(()=>document.getElementById('inline-writing-body')?.closest('.composer')?.querySelector('[data-save]')?.dataset.save==='saved');
        const sent=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='message.send';}catch{return false;}});sent.catch(()=>{});if(width<=760)await page.locator('#inline-send').tap();else await field.press('Meta+Enter');result.sent=await(await sent).json();assert.equal(result.sent.status,'committed');
        const notice=page.locator('.mention-notice');await notice.waitFor();assert.equal(await notice.getByRole('button',{name:'Dismiss',exact:true}).count(),0);const add=notice.getByRole('button',{name:'Add @fixture-outside-agent to topic',exact:true});result.mentionGeometry=await geometry(notice);assert.ok(result.mentionGeometry.actionFonts.every(f=>Math.abs(f-result.mentionGeometry.font)<.15));
        const adding=page.waitForResponse(r=>{try{return r.request().postDataJSON()?.kind==='participation.set';}catch{return false;}});adding.catch(()=>{});await press(add);result.added=await(await adding).json();assert.equal(result.added.status,'committed');await page.screenshot({path:`${evidence}/${key}-added.png`});await press(notice.getByRole('button',{name:'Close notice',exact:true}));await notice.waitFor({state:'detached'});
        const source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:result.sent.result.message_id}}});assert.equal(source.body,body);result.source=source;
      }
      await page.screenshot({path:`${evidence}/${key}-closed.png`});
      // A real fresh page resets the node identity; the old page never reopens.
      await page.reload();await page.locator('body[data-ready=true]').waitFor();await page.evaluate(async()=>{const {showLine}=await import('/lines.mjs');showLine(document.getElementById('app-status'),'Fresh page notice.');});await status.waitFor();assert.equal(await status.getByRole('button',{name:'Close notice',exact:true}).count(),1);result.freshPageReset=true;
      await Promise.all(jobs);result.served=served;for(const path of sourceFiles.filter(p=>p.startsWith('web/')&&p!=='web/boot.js'))assert.equal(served[path],hashes[path],`${path} source matched`);assert.deepEqual(result.errors,[]);result.passed=true;
      }
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
