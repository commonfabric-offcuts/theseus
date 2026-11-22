//1077: paired author/position controls on scratch Core with real browser input.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';

const engine = process.env.AIM_BROWSER ?? 'chromium', out = process.argv[2];
const playwright = await import(process.env.AIM_PLAYWRIGHT_CORE);
const sha = b => createHash('sha256').update(b).digest('hex');
const files = ['web/index.html','web/aim.css','web/look.css','web/agent-colors.css','web/look.mjs','web/author-colors.mjs','web/card-reading.mjs','web/card-scroll.mjs','web/message-menu.mjs','web/message-format.mjs','web/topic-views.mjs','web/feed-passages.mjs','web/lit-field.mjs','web/pointer-light.mjs','web/pane-keys.mjs','web/reply-stacks.mjs','web/stack-look.css','web/card-replies.mjs','tests/fixtures/ui_http.py','tests/fixture_control.mjs','tests/ui_agent_message_light_1077.test.mjs','tests/text_display_768_fixtures.mjs','tests/agent_message_light_1077_native.mjs'];
await mkdir(out,{recursive:true});
const hashes = {};
for (const f of files) {
  const b = await readFile(f); hashes[f] = sha(b);
  await mkdir(out+'/source-bytes/'+f.slice(0,f.lastIndexOf('/')),{recursive:true});
  await writeFile(out+'/source-bytes/'+f,b);
}
await writeFile(out+'/source.json',JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes},null,2));
const load = () => Number(execFileSync('/usr/bin/uptime',{encoding:'utf8'}).match(/load averages?:\s*([0-9.]+)/)?.[1]);
assert.ok(load()<12);
const fixture = spawn('/usr/bin/python3',['-B','tests/fixtures/ui_http.py','--freshness','--agent-colors','--other-person']);
const {control,exit,errors} = fixtureControl(fixture);
const rows=[],cleanup={},owned=new Set(),fixtureOwned=new Set([fixture.pid]);
const ps=()=>execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(l=>{const m=l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return m?[{pid:+m[1],ppid:+m[2],command:m[3]}]:[];});
let browser,profile,origin,version,failure;
function retain(){const list=ps();for(const set of[owned,fixtureOwned])for(let changed=true;changed;){changed=false;for(const p of list)if((set.has(p.ppid)||set===owned&&profile&&p.command.includes(profile))&&!set.has(p.pid)){set.add(p.pid);changed=true;}}}
const resources=phase=>writeFile(out+'/resource-checkpoint.json',JSON.stringify({phase,origin,profile,owned:[...owned],fixtureOwned:[...fixtureOwned]},null,2));
const portClosed=address=>new Promise(resolve=>{const u=new URL(address),s=net.createConnection({host:u.hostname,port:+u.port});s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));});
try {
  await resources('fixture spawned');
  const facts=await control({method:'ready'});origin=facts.origin;await resources('fixture ready');
  const topic='agentlight1077';
  await control({method:'navigation_topics',topics:[{id:topic,title:'Agent and person passage controls'}]});
  const body='> A quoted instruction.\n\n@person Paired passage sentence. Another sentence stays separate.\n\n'+(process.argv.includes('--long')?Array.from({length:18},(_,i)=>`Paragraph ${i+1} keeps wrapped words in this synthetic specimen. The person is reading a reply in a dossier with other messages nearby. The passage under the pointer should remain the passage that Return would quote. Its author and position must not choose another route.`).join('\n\n'):'A final paragraph keeps wrapped words in this synthetic specimen.');
  const ids={},specimens=[['agent-head','warp',null],['person-reply','fixture-other-person','agent-head'],['person-head','fixture-other-person',null],['agent-reply','warp','person-head']];
  for(const [name,sender,parent]of specimens){
    const result=await control({method:'agent_message',operation_id:topic+'-'+name,topic_id:topic,source:'topic',sender,join:true,read:true,addressees:[facts.actor],body,...(parent?{reply_to:ids[parent],reply_without_quote:'Paired author hover control.'}:{divergence_reason:'Separate paired author control '+name})});
    assert.equal(result.status,'committed');ids[name]=result.result.message_id;
  }
  profile=await mkdtemp(out+'/'+engine+'-profile-');await resources('before browser launch');
  const persistent=await playwright[engine].launchPersistentContext(profile,{headless:true,...(engine==='chromium'?{executablePath:process.env.AIM_CHROME}:{})});
  browser=persistent.browser();version=browser.version();retain();assert.ok(owned.size);await resources('browser launched');
  const requested=process.argv.includes('--only')?new Set(process.argv[process.argv.indexOf('--only')+1].split(',')):null;
  const cells=(process.argv.includes('--matrix')?['paper','bookends'].flatMap(look=>['dark','light'].flatMap(theme=>['quiet','vivid'].flatMap(intensity=>['darker','lighter',''].map(choice=>[look,theme,intensity,choice])))):[['paper','dark','quiet','darker']]).filter(([look,theme,intensity,choice])=>!requested||requested.has([look,intensity,theme,choice||'Middle'].join('-')));
  assert.ok(cells.length&&(!requested||cells.length===requested.size),'execute every explicitly requested cell exactly once');
  for(const [look,colorScheme,intensity,choice]of cells){
  assert.ok(load()<12);
  const row={key:[look,intensity,colorScheme,choice||'Middle'].join('-'),ids,body,checks:[],observations:[],executed:{},served:{},captureErrors:[],errors:[]};rows.push(row);
  const context=await browser.newContext({viewport:{width:1280,height:900},colorScheme});
  await context.addInitScript(()=>{
    window.light1077Events=[];window.light1077Pending=0;window.light1077Writes=[];
    for(const type of['pointermove','pointerdown','click','keydown'])addEventListener(type,e=>light1077Events.push({type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,key:e.key,target:e.target.tagName,cls:e.target.className,message:e.target.closest?.('[data-id]')?.dataset.id}),true);
    const f=window.fetch;window.fetch=function(input,init){let request;try{request=JSON.parse(init?.body)}catch{}light1077Pending++;const answer=f.call(this,input,init);const watched=request?.kind?answer.then(r=>r.clone().json()).then(receipt=>light1077Writes.push({request,receipt}),error=>light1077Writes.push({request,error:String(error)})):answer.then(()=>{},()=>{});watched.finally(()=>light1077Pending--);return answer;};
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>row.errors.push(e.stack));
  const captures=[];
  page.on('response',response=>{
    const f=files.find(f=>f.startsWith('web/')&&f!=='web/index.html'&&new URL(response.url()).pathname.endsWith('/'+f.split('/').at(-1)));
    if(!f)return;
    captures.push((async()=>{const b=await response.body();assert.equal(sha(b),hashes[f]);await mkdir(out+'/executed-bodies',{recursive:true});await writeFile(out+'/executed-bodies/'+sha(b),b);row.executed[f]={url:response.url(),sha256:sha(b)};})().catch(e=>row.captureErrors.push(e.stack)));
  });
  const check=(name,fn)=>{try{fn();row.checks.push({name,passed:true});}catch(e){row.checks.push({name,passed:false,error:e.stack});}};
  const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForFunction(()=>light1077Pending===0);};
  try {
    await page.goto(origin+'/?topic='+topic);await page.locator('body[data-ready=true]').waitFor();await page.waitForLoadState('networkidle');
    for(const [group,value]of[['look',look==='paper'?'paper':''],['agentColors',intensity==='quiet'?'':'vivid'],['lightColour',choice],['pointerLight','']])await page.locator(`.look-switch[data-switch="${group}"] button[data-value="${value}"]`).click();
    for(const name of['agent-head','person-head']){
      const toggle=page.locator(`#messages .reply-stack[data-stack="${ids[name]}"] > .stack-toggle`);
      if(await toggle.getAttribute('data-state')!=='open')await toggle.click();
    }
    await settle();await Promise.all(captures);assert.deepEqual(row.captureErrors,[]);
    for(const f of['web/message-menu.mjs','web/feed-passages.mjs','web/message-format.mjs','web/pane-keys.mjs','web/aim.css','web/look.css'])assert.equal(row.executed[f]?.sha256,hashes[f],'loaded owner '+f);
    for(const [f,meta]of Object.entries(row.executed)){const b=await(await page.request.get(meta.url)).body();assert.equal(sha(b),hashes[f]);row.served[f]=sha(b);await mkdir(out+'/served-bodies',{recursive:true});await writeFile(out+'/served-bodies/'+sha(b),b);}
    for(const [name,id]of Object.entries(ids))for(const needle of['Paired passage','quoted instruction']){
      const words=page.locator(`#messages .message-card[data-id="${id}"] > .message-preview`);await words.scrollIntoViewIfNeeded();
      const point=await words.evaluate(async(el,{needle,formatUrl})=>{const fmt=await import(formatUrl),walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){const at=n.data.indexOf(needle);if(at<0)continue;n.parentElement.scrollIntoView({block:'center'});const r=document.createRange();r.setStart(n,at+1);r.setEnd(n,at+3);const b=r.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,text:n.data,parent:n.parentElement.outerHTML,before:{text:fmt.drawnText(el),revision:fmt.drawnRevision(el),card:{...el.closest('.message-card').dataset}}};}throw Error('No specimen words '+needle);},{needle,formatUrl:row.executed['web/message-format.mjs'].url});
      await page.mouse.move(2,2);await page.mouse.move(point.x,point.y);await settle();
      const observed=await words.evaluate(async(el,{id,point,formatUrl,keysUrl})=>{
        const fmt=await import(formatUrl),keys=await import(keysUrl),card=el.closest('.message-card'),style=getComputedStyle(el,'::highlight(lit-passage)'),caret=document.caretPositionFromPoint?.(point.x,point.y),range=caret?null:document.caretRangeFromPoint?.(point.x,point.y),node=caret?.offsetNode??range?.startContainer,offset=caret?.offset??range?.startOffset;
        const lit=[...(CSS.highlights.get('lit-passage')??[])].map(r=>({text:r.toString(),onCard:card.contains(r.commonAncestorContainer),start:fmt.sourcePosition(r.startContainer,r.startOffset),end:fmt.sourcePosition(r.endContainer,r.endOffset,true)}));
        const intent=keys.returnIntent({key:'Enter',target:document.activeElement},document,document.querySelector('#messages'));
        return{id,point,cardClass:card.className,card:{...card.dataset},wordsClass:el.className,drawn:fmt.drawnText(el),revision:fmt.drawnRevision(el),sourcePosition:node&&fmt.sourcePosition(node,offset),caretInside:!!node&&el.contains(node),hit:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,700),active:{tag:document.activeElement.tagName,cls:document.activeElement.className,id:document.activeElement.id,message:document.activeElement.closest('[data-id]')?.dataset.id},intent:intent?{message:intent.entry?.dataset.id,dossier:!!intent.dossier}:null,lit,field:style.backgroundColor,ink:style.color,lineLayers:[...new Set([card,el,...el.querySelectorAll('*')].map(n=>getComputedStyle(n).backgroundImage).filter(x=>x!=='none'))],selection:getSelection().toString(),root:{...document.documentElement.dataset},events:light1077Events.slice(-8)};
      },{id,point,formatUrl:row.executed['web/message-format.mjs'].url,keysUrl:row.executed['web/pane-keys.mjs'].url});
      const record={name,needle,...observed};row.observations.push(record);
      check(name+' '+needle+' native pointer lights its actual words',()=>assert.ok(observed.lit.some(x=>x.onCard&&x.text.includes(needle))));
      const lighter={paper:{quiet:'#e3dccf',vivid:'#d9e0c2'},bookends:{quiet:'#d5dbd9',vivid:'#c9e3d8'}};
      const hex=choice==='lighter'?lighter[look][intensity]:choice==='darker'?(intensity==='vivid'?(name.startsWith('agent')?(colorScheme==='dark'?'#003338':'#003b42'):(look==='paper'?'#123908':'#00321f')):(look==='paper'?'#100d0a':'#050606')):(colorScheme==='dark'?'#5e6160':'#000000');
      const expected='rgb('+hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')';
      check(name+' '+needle+' chosen paint draws behind highlighted words',()=>{assert.equal(observed.field,expected);assert.ok(observed.lineLayers.some(x=>x.includes(observed.field)));});
      await page.screenshot({path:out+'/'+row.key+'-'+name+'-'+needle.replaceAll(' ','-')+'.png'});
      if(row.key==='paper-quiet-dark-darker'&&name==='agent-head'&&needle==='Paired passage'){
        const selected=observed.lit.find(r=>r.onCard&&r.text.includes(needle));
        if(!selected)check('Return keeps the complete same-revision passage after expansion',()=>assert.ok(selected));
        else{
          await page.keyboard.press('Enter');await page.locator('#reader[open] #writing-body').waitFor();
          await page.waitForFunction(()=>light1077Writes.some(x=>x.request.kind==='draft.save'&&x.request.args.quotes?.length));await settle();
          row.quoted={field:await page.locator('#writing-body').inputValue(),writes:await page.evaluate(()=>light1077Writes),expected:{source:{kind:'message',id,revision:observed.revision},start:selected.start,end:selected.end}};
          row.quoted.core=(await control({method:'agent_view',actor:facts.actor,name:'editor_state',args:{source_ref:{kind:'message',id},topic_id:topic}})).draft;
          check('Return keeps the complete same-revision passage after expansion',()=>{
            assert.equal(row.quoted.field,'> '+observed.drawn.slice(selected.start,selected.end)+'\n\n');
            assert.deepEqual(row.quoted.core.quotes,[{source:row.quoted.expected.source,excerpt:observed.drawn.slice(selected.start,selected.end)}]);
            assert.equal(row.quoted.core.body,row.quoted.field);
            assert.ok(row.quoted.writes.some(x=>x.request.kind==='draft.save'&&x.receipt.status==='committed'&&x.request.args.quotes?.some(q=>q.source.id===id&&q.excerpt===observed.drawn.slice(selected.start,selected.end)&&q.source.revision===observed.revision)));
          });
          await page.keyboard.press('Escape');await page.locator('#reader[open]').waitFor({state:'hidden'});
        }
      }
      await page.mouse.move(point.x+4,point.y);await settle();
      record.afterFreshMove=await words.evaluate(el=>({lit:[...(CSS.highlights.get('lit-passage')??[])].map(r=>({text:r.toString(),onCard:el.contains(r.commonAncestorContainer)})),lineLayers:[...el.querySelectorAll('*'),el,el.closest('.message-card')].map(n=>getComputedStyle(n).backgroundImage).filter(x=>x!=='none')}));
    }
    await page.locator('.look-switch[data-switch="pointerLight"] button[data-value="off"]').click();await settle();
    row.offHighlightCount=await page.evaluate(()=>CSS.highlights.get('lit-passage')?.size??0);
    check('Light off clears native pointer highlight',()=>assert.equal(row.offHighlightCount,0));
    await page.locator('.look-switch[data-switch="pointerLight"] button[data-value=""]').click();
    const writing=page.locator('#inline-writing-body');await writing.click();await page.keyboard.insertText('Unsent1077');
    const target=page.locator(`#messages .message-card[data-id="${ids['agent-reply']}"] > .message-preview .md-p`).last();await target.scrollIntoViewIfNeeded();await target.hover();await page.keyboard.insertText('!');await settle();
    row.writing=await page.evaluate(()=>({active:document.activeElement.id,value:document.querySelector('#inline-writing-body').value,highlights:CSS.highlights.get('lit-passage')?.size??0}));
    check('writing retains native input and prevents hover quoting',()=>{assert.equal(row.writing.active,'inline-writing-body');assert.equal(row.writing.value,'Unsent1077!');assert.equal(row.writing.highlights,0);});
    check('no page or source capture errors',()=>{assert.deepEqual(row.errors,[]);assert.deepEqual(row.captureErrors,[]);});
  }catch(e){row.error=e.stack;row.failureSnapshot=await page.evaluate(()=>({writes:light1077Writes,active:document.activeElement.id,field:document.querySelector('#writing-body')?.value})).catch(()=>null);await page.screenshot({path:out+'/producer-error.png'}).catch(()=>{});}
  retain();await context.close();row.passed=!row.error&&row.checks.every(c=>c.passed);
  await writeFile(out+'/observations.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify({key:row.key,passed:row.passed,pass:row.checks.filter(c=>c.passed).length,fail:row.checks.filter(c=>!c.passed).length,error:row.error?.split('\n')[0]}));
  if(row.error)break;
  }
}catch(e){failure=e.stack;}
finally{
  if(browser){retain();await resources('before browser close');await browser.close();}cleanup.browserClosed=browser?!browser.isConnected():true;
  fixture.stdin.end();cleanup.fixtureExit=await exit;cleanup.fixtureErrors=errors();const list=ps();cleanup.ownedPids=[...owned];cleanup.fixturePids=[...fixtureOwned];cleanup.remainingOwned=list.filter(p=>owned.has(p.pid));cleanup.remainingFixture=list.filter(p=>fixtureOwned.has(p.pid));cleanup.profileProcesses=profile?list.filter(p=>p.command.includes(profile)):[];
  if(profile&&cleanup.browserClosed&&!cleanup.remainingOwned.length&&!cleanup.profileProcesses.length)await rm(profile,{recursive:true});
  cleanup.profileAbsent=profile?await access(profile).then(()=>false,()=>true):true;cleanup.portClosed=origin?await portClosed(origin):null;
  const endHashes={};for(const f of files)endHashes[f]=sha(await readFile(f));
  await writeFile(out+'/results.json',JSON.stringify({engine,version,hashes,endHashes,rows,cleanup,failure},null,2));
}
assert.ok(cleanup.browserClosed&&cleanup.profileAbsent&&cleanup.portClosed);assert.deepEqual(cleanup.fixtureExit,{code:0,signal:null});assert.equal(cleanup.fixtureErrors,'');assert.deepEqual(cleanup.remainingOwned,[]);assert.deepEqual(cleanup.remainingFixture,[]);assert.deepEqual(cleanup.profileProcesses,[]);
for(const f of files)assert.equal(sha(await readFile(f)),hashes[f],f+' stable');
console.log(JSON.stringify({engine,version,checks:rows.flatMap(r=>r.checks).map(({name,passed})=>({name,passed})),error:rows[0]?.error,failure,cleanup}));
assert.equal(failure,undefined);assert.ok(rows.length&&rows.every(r=>r.passed),'1077 inspect retained paired observations');
