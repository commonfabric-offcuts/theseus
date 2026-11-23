// Actual Team input, scratch Core/HTTP/runner; the native model child is synthetic.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';

const out=process.argv[2],engine=process.env.AIM_BROWSER??'chromium';
const api=await import(process.env.AIM_PLAYWRIGHT_CORE),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(out,{recursive:true});
const sourceFiles=['aim_next/hosted_seats.py','aim_next/seat_host.py','aim_next/effects_runner.py','aim_next/migrations.py','aim_next/store.py','aim_next/validation.py',
  'web/headless-seat.mjs','web/seat-journal.mjs','tests/fixtures/headless_seat_1002.py','tests/fixtures/fake_codex_app_server.py','tests/fixture_control.mjs','tests/seat_template_1040_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,sha(await readFile(f))])));
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(s=>{const m=s.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:+m[1],parent:+m[2],command:m[3]}]:[];});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{const end=Date.now()+20000;do{const x=await fn();if(x)return x;await pause(50);}while(Date.now()<end);throw Error('Did not observe '+label);};
const result={engine,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,cases:[],cleanup:[]};
await writeFile(out+'/producer.mjs',await readFile(new URL(import.meta.url)));
let failure;
for(const multiple of [false,true]){
  const label=multiple?'multiple':'single',fixtureOut=out+'/'+label+'-fixture';
  const fixture=spawn('/usr/bin/python3',['-I','tests/fixtures/headless_seat_1002.py',fixtureOut,...(multiple?['--multiple-templates']:[])]);
  const channel=fixtureControl(fixture),owned=new Set([fixture.pid]);let browser,profile,info,tracker;
  const observe=()=>{const rows=ps();for(let changed=true;changed;){changed=false;for(const p of rows)if(!owned.has(p.pid)&&(owned.has(p.parent)||profile&&p.command.includes(profile))){owned.add(p.pid);changed=true;}}};
  const saveOwned=async()=>{observe();await writeFile(out+'/'+label+'-owned.json',JSON.stringify({fixture:fixture.pid,profile,pids:[...owned]},null,2));};
  try{
    info=await channel.control({method:'info'});owned.add(info.runner_pid);
    const options=await until(async()=>{const x=await channel.control({method:'templates'});return x.available&&x;},'owned host catalogue');
    assert.equal(options.items.length,multiple?2:1);
    profile=await mkdtemp(out+'/'+label+'-'+engine+'-profile-');
    const persistent=await api[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
    browser=persistent.browser();result.version=browser.version();tracker=setInterval(observe,100);await saveOwned();
    for(const width of (multiple?[1280,390]:[1280])){
      const key=label+'-'+width,context=await browser.newContext({viewport:{width,height:900},hasTouch:width<800,isMobile:engine==='chromium'&&width<800});
      await context.addInitScript(look=>{localStorage.setItem('theseus-look',look);window.templateInput=[];for(const type of ['click','input','keydown'])document.addEventListener(type,e=>window.templateInput.push({type,id:e.target.id,template:e.target.dataset?.seatTemplate,trusted:e.isTrusted}),true);},width===390?'paper':'bookends');
      const page=await context.newPage(),row={key,options,errors:[],requests:[]};result.cases.push(row);let leaving=false;
      page.setDefaultTimeout(10000);page.on('pageerror',e=>{const detail={message:e.message,stack:e.stack,leaving};if(leaving&&engine==='webkit'&&/^Fetch API cannot load \S+ due to access control checks\.$/.test(e.message)){row.leavingReadCancellation??=[];row.leavingReadCancellation.push(detail);}else row.errors.push(detail);});
      page.on('request',request=>{try{const x=request.postDataJSON();if(x?.kind==='workspace.hosted_seat_add')row.requests.push(x);}catch{}});
      const press=async selector=>width<800?page.locator(selector).tap():page.locator(selector).click();
      try{
        row.workspace='template-'+engine+'-'+key;await channel.control({method:'workspace',workspace:row.workspace});
        await page.goto(info.origin+'/?workspace='+row.workspace);
        const open=async()=>{
          if(width<1100)await press('#outcome-tab-agents');
          await press('#team-people .add-chip');await press('#add-headless-seat');await page.locator('#headless-seat-role:not([readonly])').waitFor();
        };
        await open();
        await press('#headless-seat-name');await page.keyboard.insertText('Seat '+engine+' '+key);
        await press('#headless-seat-role');await page.keyboard.insertText('Keep the selected template.');
        if(multiple){
          await page.locator('[data-seat-template]').first().waitFor();
          assert.equal(await page.locator('#headless-seat-submit').isDisabled(),true,'two templates have no arbitrary first choice');
          row.selected=options.items.find(item=>item.actor_id==='template-two');assert.ok(row.selected);
          const selector=`[data-seat-template="${row.selected.id}"]`;
          await press(selector);await page.locator(selector+'[aria-pressed=true]').waitFor();
          const box=await page.locator(selector).boundingBox();assert.ok(box.height>=44&&box.width>=44);
          await page.waitForFunction(async id=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('theseus-seat-add',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{return await new Promise((resolve,reject)=>{const q=db.transaction('drafts').objectStore('drafts').getAll();q.onsuccess=()=>resolve(q.result.some(row=>row.form.template_id===id));q.onerror=()=>reject(q.error);});}finally{db.close();}},row.selected.id);
          await page.reload();await open();await page.locator(selector+'[aria-pressed=true]').waitFor();
          assert.equal(await page.locator('#headless-seat-role').inputValue(),'Keep the selected template.','reload keeps writing and choice');
        }else{
          row.selected=options.items[0];assert.equal(await page.locator('[data-seat-template]:visible').count(),0,'one template keeps the existing form');
        }
        const geometry=await page.locator('.seat-form').evaluate(n=>({right:n.getBoundingClientRect().right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}));
        assert.ok(geometry.right<=geometry.width+1&&!geometry.overflow);row.geometry=geometry;
        await page.screenshot({path:out+'/'+key+'-choice.png',fullPage:true});
        await press('#headless-seat-submit');
        row.state=await until(async()=>{const x=await channel.control({method:'inspect',workspace:row.workspace});return x.seats.length===1&&x.seats[0][2]==='ready'&&x.messages.some(m=>m[0]===x.seats[0][1])&&x;},'actual selected seat and hello');
        const plan=JSON.parse(row.state.templates[0][1]);assert.equal(row.state.templates[0][0],row.selected.id);assert.equal(plan.model,row.selected.model);assert.equal(plan.reasoning_effort,row.selected.reasoning_effort);
        const starts=row.state.starts.filter(params=>params.cwd===plan.cwd);assert.equal(starts.length,1);
        assert.equal(starts[0].model,row.selected.model);assert.equal(starts[0].config.model_reasoning_effort,row.selected.reasoning_effort);
        assert.equal(row.state.routes_unchanged,true);assert.equal(row.requests.length,1);if(multiple)assert.equal(row.requests[0].args.template_id,row.selected.id);else assert.equal(row.requests[0].args.template_id,undefined);
        row.trusted=await page.evaluate(()=>templateInput);assert.ok(row.trusted.length&&row.trusted.every(x=>x.trusted));
        assert.deepEqual(row.errors,[]);row.passed=true;await page.screenshot({path:out+'/'+key+'-ready.png',fullPage:true});
      }catch(error){row.error=error.stack;await page.screenshot({path:out+'/'+key+'-failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/'+key+'-failure.html',await page.content()).catch(()=>{});throw error;}
      finally{leaving=true;await context.close();await saveOwned();await writeFile(out+'/observations.json',JSON.stringify(result,null,2));}
    }
  }catch(error){failure=error.stack;}
  finally{
    const cleanup={label};if(browser){await browser.close();cleanup.browserClosed=!browser.isConnected();}clearInterval(tracker);
    fixture.stdin.end();cleanup.fixtureExit=await channel.exit;cleanup.fixtureErrors=channel.errors();
    observe();const active=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=active.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?active.filter(p=>p.command.includes(profile)):[];
    if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
    cleanup.profile=profile;cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):null;
    if(info){cleanup.origin=info.origin;cleanup.tcp=await new Promise(resolve=>{const u=new URL(info.origin),socket=net.createConnection({host:u.hostname,port:+u.port});socket.once('connect',()=>{socket.destroy();resolve('CONNECTED');});socket.once('error',e=>resolve(e.code));});}
    result.cleanup.push(cleanup);
    try{
      assert.equal(cleanup.browserClosed,true);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.profileProcesses,[]);assert.equal(cleanup.profileAbsent,true);assert.equal(cleanup.tcp,'ECONNREFUSED');
    }catch(error){failure=[failure,'Cleanup: '+error.stack].filter(Boolean).join('\n');}
    await writeFile(out+'/results.json',JSON.stringify({...result,failure},null,2));
  }
  if(failure)break;
}
for(const f of sourceFiles)assert.equal(sha(await readFile(f)),hashes[f],f+' stayed fixed');
if(failure)throw Error(failure);
assert.equal(result.cases.length,3);assert.ok(result.cases.every(row=>row.passed));console.log(JSON.stringify({passed:result.cases.length,engine,version:result.version,cleanup:result.cleanup}));
