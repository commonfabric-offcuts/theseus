// Real Return input against scratch Core/HTTP. No product handler is invoked.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const playwright=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const evidence=process.argv[2],filter=new RegExp(process.argv[3]??'');await mkdir(evidence,{recursive:true});
const root=process.env.AIM_990_ROOT??process.cwd(),sources=['web/deck-page.mjs','web/app.mjs','web/notebook-passages.mjs'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async f=>[f,createHash('sha256').update(await readFile(`${root}/${f}`)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes,harness:createHash('sha256').update(await readFile('tests/cards_link_return_990_native.mjs')).digest('hex')},null,2));
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness'],{cwd:root});
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{
  const[,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return{pid:+pid,ppid:+ppid,command};});
function children(set){const list=ps();for(let changed=true;changed;){changed=false;for(const p of list)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
let browser,profile,origin,failure,activePage,serial=0;
try{
  const facts=await control({method:'ready'});origin=facts.origin;children(fixtureOwned);
  await control({method:'topic_state',operation_id:'990-landing',topic_id:'t1',args:{title:'Landing'}});
  const destination='n-990-destination';
  assert.equal((await control({method:'agent_page',operation_id:'990-destination',item_id:destination,topic_id:'t1',title:'Destination990',body:'## Destination990\n\nExact destination words990.'})).status,'committed');
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();cleanup.engine=browser.browserType().name();cleanup.version=browser.version();assert.equal(cleanup.engine,engine);
  for(const p of ps())if(p.command.includes(profile))owned.add(p.pid);children(owned);assert.ok(owned.size);
  await writeFile(`${evidence}/owned-start.json`,JSON.stringify({profile,owned:[...owned],fixturePid:fixture.pid,origin}));
  const cells=[...['bookends','paper'].flatMap(look=>['light','dark'].map(theme=>['full',look,theme])),
    ['sheet','bookends','light'],['sheet','paper','dark'],['dock','bookends','dark'],['dock','paper','light']];
  for(const [surface,look,theme]of cells){
    const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme:theme});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    for(const action of ['unknown-name','missing-page','good-topic','good-page','plain-card-return','writing-newline']){
      const key=`${surface}-${look}-${theme}-${action}`;if(!filter.test(key))continue;
      const page=await context.newPage();activePage=page;const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.setDefaultTimeout(5000);
      const item=`n-990-source-${++serial}`,body='## Links990\n\n[Unknown name](?topic=NoSuch990)\n\n[Missing page](?topic=Landing&page=n-'+ 'b'.repeat(32)+')\n\n[Good topic](?topic=Landing)\n\n[Good page](?topic=Landing&page='+destination+')\n\n## Last990\n\nKept words990.\n';
      const host=()=>page.locator(surface==='full'?'#deck-page':'#notebook-sheet-dialog .notebook-sheet-page:not([hidden])');
      const current=()=>control({method:'agent_view',name:'memory_current',args:{item_id:item}});
      const untilSaved=async expected=>{const end=Date.now()+5000;let last;do{last=await current();if(last.body===expected)return;await page.waitForTimeout(25);}while(Date.now()<end);assert.equal(last.body,expected);};
      let error;
      try{
        assert.equal((await control({method:'agent_page',operation_id:item,item_id:item,topic_id:'t1',title:'Source990 '+serial,body})).status,'committed');
        const url=origin+(surface==='full'?`/?cards=${item}&view=cards`:`/?topic=t1&page=${item}`);
        await page.goto(url);await page.waitForFunction(()=>document.body.dataset.ready==='true');
        const moduleURL=await page.evaluate(()=>new URL('./deck-page.mjs',[...document.scripts].find(s=>s.src.includes('/app.mjs')).src).href);
        assert.equal(createHash('sha256').update(await (await page.request.get(moduleURL)).body()).digest('hex'),hashes['web/deck-page.mjs']);
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.look??''),look==='bookends'?'':look);
        assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches),theme==='dark');
        if(surface!=='full'){
          const dialog=page.locator('#notebook-sheet-dialog[open]');await dialog.waitFor();
          if(!await host().locator('.deck-card').first().isVisible()){
            await dialog.locator('.notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Show as cards',exact:true}).click();
          }
          if((await dialog.evaluate(el=>el.classList.contains('notebook-docked')))!==(surface==='dock')){
            await dialog.locator('.notebook-menu').click();await page.getByRole('menuitemcheckbox',{name:'Side by side',exact:true}).click();
          }
          assert.equal(await dialog.evaluate(el=>el.classList.contains('notebook-docked')),surface==='dock');
        }
        await host().locator('.deck-card').first().waitFor();
        const before=await current();assert.equal(before.body,body);assert.ok(Number.isInteger(before.version)&&before.version>0);
        if(action==='plain-card-return'||action==='writing-newline'){
          await host().locator('.deck-card .deck-title').first().click();
          const field=host().locator('.deck-writing textarea');await field.waitFor();
          if(action==='plain-card-return'){
            await page.keyboard.press('Escape');await host().locator('.deck-card').first().focus();await page.keyboard.press('Enter');
            assert.equal(await field.inputValue(),'');await page.keyboard.type('Created990');await page.keyboard.press('Escape');
            await untilSaved(body.replace('\n\n## Last990','\n\n## Created990\n\n## Last990'));
          }else{
            const text=await field.inputValue();await page.keyboard.press('Meta+a');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.type('New line990');
            assert.equal(await field.inputValue(),text+'\nNew line990');await page.keyboard.press('Escape');
            await untilSaved(body.replace('\n\n## Last990','\nNew line990\n\n## Last990'));
          }
        }else{
          const name={'unknown-name':'Unknown name','missing-page':'Missing page','good-topic':'Good topic','good-page':'Good page'}[action];
          const link=host().getByRole('link',{name,exact:true});await link.focus();assert.equal(await link.evaluate(el=>el===document.activeElement),true);
          const sourceUrl=page.url();await page.keyboard.press('Enter');
          // Check promptly, so an accidentally opened empty card is a concrete
          // failure rather than only a missing-navigation timeout.
          assert.equal(await page.locator('.deck-writing:visible').count(),0,'link Return started a card');
          if(action==='unknown-name'||action==='missing-page'){
            const text=action==='unknown-name'?'No topic is named NoSuch990. Choose the topic from Outcomes.':'This page could not be found or is not available to you. Stayed here.';
            await host().getByText(text,{exact:true}).waitFor();assert.equal(page.url(),sourceUrl);assert.equal(await link.isVisible(),true);
          }else if(action==='good-topic'){
            await page.waitForFunction(()=>new URL(location.href).searchParams.get('topic')==='t1'&&document.querySelector('#topic-title').textContent==='Landing');
            assert.equal(await page.locator('#deck-page').isVisible(),false);
          }else{
            await page.locator('#notebook-sheet-dialog[open]').getByText('Exact destination words990.',{exact:true}).waitFor();
            assert.equal(await page.locator('#topic-title').textContent(),'Landing');
          }
          const after=await current();assert.equal(after.body,before.body);assert.equal(after.version,before.version,'links do not revise the source');
        }
        assert.deepEqual(pageErrors,[]);children(owned);
        if(action==='unknown-name'){
          // Preview the rendered refusal after explicitly bringing it into view;
          // this is not an assertion about958's notice-positioning behavior.
          await host().getByText('No topic is named NoSuch990. Choose the topic from Outcomes.',{exact:true}).scrollIntoViewIfNeeded();
          await page.screenshot({path:`${evidence}/${key}.png`});
        }
      }catch(e){error=e.stack;await page.screenshot({path:`${evidence}/${key}-failure.png`});await writeFile(`${evidence}/${key}-failure.html`,await page.content());}
      results.push({key,error:error??null,pageErrors});await writeFile(`${evidence}/observations.json`,JSON.stringify(results,null,2));
      await page.close();activePage=null;
    }
    await context.close();
  }
}catch(e){failure=e;if(activePage&&!activePage.isClosed())await activePage.screenshot({path:`${evidence}/fatal.png`});}
finally{
  if(browser){children(owned);await browser.close();cleanup.browserClosed=!browser.isConnected();}
  const after=ps();cleanup.ownedPids=[...owned];cleanup.remainingOwned=after.filter(p=>owned.has(p.pid));cleanup.profileProcesses=profile?after.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length){await rm(profile,{recursive:true});cleanup.profileRemoved=await access(profile).then(()=>false,()=>true);}
  children(fixtureOwned);fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();cleanup.fixturePid=fixture.pid;
  cleanup.fixtureAbsent=!ps().some(p=>p.pid===fixture.pid);cleanup.fixtureOwnedPids=[...fixtureOwned];cleanup.remainingFixtureOwned=ps().filter(p=>fixtureOwned.has(p.pid));
  if(origin)cleanup.portClosed=await new Promise(resolve=>{const u=new URL(origin),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});
  await writeFile(`${evidence}/results.json`,JSON.stringify({engine,hashes,results,cleanup,failure:failure?.stack??null},null,2));
}
const failed=results.filter(r=>r.error);console.log(JSON.stringify({engine,pass:results.length-failed.length,fail:failed.length,failed,cleanup,fatal:failure?.stack??null},null,2));
if(failure||!results.length||failed.length||!cleanup.browserClosed||cleanup.remainingOwned?.length||cleanup.profileProcesses?.length||!cleanup.profileRemoved||cleanup.fixtureExit?.code!==0||!cleanup.fixtureAbsent||cleanup.remainingFixtureOwned?.length||!cleanup.portClosed||cleanup.fixtureErrors)process.exitCode=1;
