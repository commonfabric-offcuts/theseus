// Actual app/HTTP/Core replies and native source selection in isolated records.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {fixtureControl} from './fixture_control.mjs';
const engines=await import(process.env.AIM_PLAYWRIGHT_CORE),engine=process.env.AIM_ENGINE??'chromium';
const selected=new RegExp(process.argv[3]??'');
const evidence=process.argv[2];await mkdir(evidence,{recursive:true});
const sourceFiles=['aim_next/reply_passages.py','web/reply-basis.mjs','web/message-format.mjs','web/message-preview.mjs','web/card-scroll.mjs','web/reader.mjs','web/app.mjs','web/aim.css','web/glyphs.mjs','tests/fixtures/ui_http.py','tests/no_quote_glyph_1025_native.mjs'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(`${evidence}/source.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
for(const path of sourceFiles){const saved=`${evidence}/source/${path}`;await mkdir(saved.slice(0,saved.lastIndexOf('/')),{recursive:true});await writeFile(saved,await readFile(path));}
const fixture=spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--other-person']);
const {control,exit,errors}=fixtureControl(fixture),results=[],cleanup={},owned=new Set();
let browser,profile,origin,failure;
const processes=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [,pid,ppid,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return {pid:+pid,ppid:+ppid,command};});
function retain(){const all=processes();for(let changed=true;changed;){changed=false;for(const p of all)if((owned.has(p.ppid)||profile&&p.command.includes(profile))&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}}
try {
  const facts=await control({method:'ready'});origin=facts.origin;await writeFile(`${evidence}/fixture.json`,JSON.stringify({origin,pid:fixture.pid}));
  profile=await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent=await engines[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();retain();assert.ok(owned.size);
  for(const width of [320,375,390,1280])for(const look of ['bookends','paper'])for(const kind of ['new','legacy','quoted','human']) {
    const key=`${width}-${look}-${kind}`;if(!selected.test(key))continue;const result={key,errors:[]};
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=760,isMobile:width<=760});
    await context.addInitScript(look=>localStorage.setItem('theseus-look',look),look);
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>result.errors.push(error.message));
    const served={},jobs=[];page.on('response',response=>{const path='web/'+new URL(response.url()).pathname.split('/').at(-1);if(Object.hasOwn(hashes,path))jobs.push(response.body().then(bytes=>{served[path]=createHash('sha256').update(bytes).digest('hex');}));});
    try {
      const created=await control({method:'agent_topic',operation_id:`1025-${key}`,title:`Reply basis ${key}`,body:'Parent exact words.'}),topicId=created.topic_id;
      const parents=await control({method:'agent_view',actor:facts.actor,name:'topic_messages',args:{topic_id:topicId}}),parent=parents.items[0];
      const parentSource=await control({method:'agent_view',actor:facts.agent,name:'source',args:{source_ref:{kind:'message',id:parent.id}}});
      const reason='The whole assignment. 🪴',own='Own reply first line.\n\nExact **body words** 🪴.\n\n'+('More exact own words. '.repeat(90));
      const writing=kind==='human'?'Reply without a quote:\n\n> A literal example.\n\n'+own:own;
      const request={method:'agent_message',operation_id:`1025-${key}-reply`,topic_id:topicId,reply_to:parent.id,body:writing,addressees:[facts.actor],intent:'tell',
        ...(kind==='human'?{sender:'fixture-other-person',join:true,addressees:[],intent:null} : kind==='quoted'?{reply_passage:{source:{kind:'message',id:parent.id,revision:parentSource.revision},start:0,end:6}} : {reply_without_quote:reason,...(kind==='legacy'?{legacy_reason_1025:true}:{})})};
      const sent=await control(request);assert.equal(sent.status,'committed');result.receipt=sent;
      const source=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:sent.result.message_id}}});result.source=source;
      const expected=kind==='human'?writing:kind==='quoted'?'> Parent\n\n'+own:(kind==='legacy'?'Reply without a quote:\n\n':'')+'> '+reason+'\n\n'+own;
      assert.equal(source.body,expected);if(['new','legacy'].includes(kind)){assert.equal(source.reply_basis.reason,reason);assert.equal(source.reply_basis.reason_format,kind==='new'?2:undefined);}
      await page.goto(`${origin}/?topic=${topicId}`);await page.locator('body[data-ready=true]').waitFor();
      const card=page.locator(`.message-card[data-id="${sent.result.message_id}"]`);await card.waitFor();
      const preview=card.locator(':scope > .message-preview');await preview.waitFor();
      const marks=preview.locator('.reply-basis-mark');assert.equal(await marks.count(),['new','legacy'].includes(kind)?1:0);
      if(['new','legacy'].includes(kind)){
        assert.equal(await marks.getAttribute('aria-label'),'Reply without a quote: '+reason);assert.equal(await marks.getAttribute('title'),'Reply without a quote: '+reason);
        assert.ok(!(await preview.innerText()).includes('Reply without a quote:'));if(width>760)await marks.hover();
      }else if(kind==='human')assert.ok((await preview.innerText()).includes('Reply without a quote:'));
      await page.screenshot({path:`${evidence}/${key}-feed.png`});
      // Actual card presses open its reply and then its whole Reader, as on the page.
      if(width<=760)await preview.tap();else await preview.click();
      if(width<=760)await preview.tap();else await preview.click();
      await page.locator('#reader[open]').waitFor();const reader=page.locator('#source-body');
      assert.equal(await reader.locator('.reply-basis-mark').count(),['new','legacy'].includes(kind)?1:0);
      result.readerRaw=await page.evaluate(async()=>{const f=await import('/message-format.mjs');return f.drawnText(document.getElementById('source-body'));});assert.equal(result.readerRaw,expected);
      const words=reader.getByText('Own reply first line.',{exact:true});await words.click({clickCount:3});
      result.selection=await page.evaluate(async()=>{const f=await import('/message-format.mjs'),s=getSelection(),range=s.getRangeAt(0);return {text:s.toString(),start:f.sourcePosition(range.startContainer,range.startOffset),end:f.sourcePosition(range.endContainer,range.endOffset,true)};});
      assert.ok(Number.isInteger(result.selection.start)&&Number.isInteger(result.selection.end));assert.ok(expected.slice(result.selection.start,result.selection.end).includes('Own reply first line.'));
      await page.screenshot({path:`${evidence}/${key}-reader.png`});
      const after=await control({method:'agent_view',actor:facts.actor,name:'source',args:{source_ref:{kind:'message',id:sent.result.message_id}}});assert.equal(after.body,expected);assert.deepEqual(after.reply_basis,source.reply_basis);
      await Promise.all(jobs);result.served=served;for(const path of sourceFiles.filter(p=>p.startsWith('web/')))assert.equal(served[path],hashes[path],`${path} source matched`);
      assert.deepEqual(result.errors,[]);result.passed=true;
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
