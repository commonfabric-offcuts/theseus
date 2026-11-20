// Isolated real DOM/CSS/Notebook owners; no server, live data or user profile.
// AIM_CHROME=... AIM_PLAYWRIGHT_CORE=... node tests/docked_cards_914_native.mjs /absolute/evidence
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const {chromium}=createRequire(import.meta.url)(process.env.AIM_PLAYWRIGHT_CORE);
const root=path.resolve(import.meta.dirname,'..'),evidence=process.argv[2];
assert.ok(path.isAbsolute(evidence));await mkdir(evidence,{recursive:false});
const current=await readFile(path.join(root,'web/aim.css'),'utf8');
const baseline=execFileSync('git',['show','f60c390788b705891d038c8a64e672b2ac753b56:web/aim.css'],{cwd:root,encoding:'utf8'});
const results=[],errors=[];let browser;
const check=(name,act)=>{try{act();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.stack});}};
try{
  browser=await chromium.launch({executablePath:process.env.AIM_CHROME,headless:true});
  for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:theme});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='https://fixture.invalid')return route.abort();
      const relative=url.pathname==='/'?'tests/fixtures/docked_cards_914.html':url.pathname.slice(1);
      const file=path.resolve(root,relative);
      if(!file.startsWith(root+'/')||!(/^(web\/.*\.(mjs|css)|web\/index\.html|tests\/fixtures\/docked_cards_914\.html)$/.test(relative)))return route.abort();
      try{await route.fulfill({body:await readFile(file),contentType:file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{await route.abort();}
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.stack));
    await page.goto('https://fixture.invalid/');await page.waitForSelector('body[data-ready=true]');
    const setCSS=css=>page.evaluate(css=>{document.getElementById('aim').textContent=css;},css);
    const snapshot=()=>page.evaluate(()=>{
      const f=window.fixture,p=f.sheet.current,style=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,border:s.borderTopStyle,borderColor:s.borderTopColor,padding:s.padding,margin:s.margin,width:r.width,height:r.height};};
      return {host:style(p.host),card:style(p.list.children[0]),other:style(p.list.children[1]),words:style(p.list.querySelector('.deck-words')),title:style(p.list.querySelector('.deck-title')),menu:style(p.list.querySelector('.deck-menu')),count:style(p.count),header:style(f.sheet.head),full:style(f.full.list.children[0]),tinted:[...p.list.querySelectorAll('.deck-tinted')].map(style),text:style(p.text),whisper:style(document.querySelector('.whisper')),docked:f.sheet.docked};
    });
    await setCSS(baseline);const before=await snapshot();
    await page.evaluate(()=>fixture.sheet.current.switchView('text'));const textBefore=await snapshot();
    await page.evaluate(()=>fixture.sheet.current.switchView('cards'));await setCSS(current);const after=await snapshot();
    check(theme+' actual sheet is docked',()=>assert.equal(after.docked,true));
    check(theme+' black Cards ground',()=>assert.equal(after.host.background,'rgb(0, 0, 0)'));
    check(theme+' near-black default faces',()=>{assert.equal(after.card.background,'rgb(17, 17, 17)');assert.equal(after.other.background,'rgb(17, 17, 17)');});
    check(theme+' white title and words',()=>{assert.equal(after.title.color,'rgb(255, 255, 255)');assert.equal(after.words.color,'rgb(255, 255, 255)');});
    const ratios=await page.evaluate(()=>{
      const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{if(!color.startsWith('color(srgb'))v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
      const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const p=fixture.sheet.current,row=p.list.children[0],face=getComputedStyle(row).backgroundColor,ground=getComputedStyle(p.host).backgroundColor;
      return {words:contrast(getComputedStyle(row.querySelector('.deck-words')).color,face),menu:contrast(getComputedStyle(row.querySelector('.deck-menu')).color,face),meta:contrast(getComputedStyle(p.count).color,ground),picked:contrast(getComputedStyle(row).borderTopColor,face),tinted:[...p.list.querySelectorAll('.deck-tinted')].map(row=>({words:contrast(getComputedStyle(row.querySelector('.deck-words')).color,getComputedStyle(row).backgroundColor),menu:contrast(getComputedStyle(row.querySelector('.deck-menu')).color,getComputedStyle(row).backgroundColor)}))};
    });
    check(theme+' words/meta/menu contrast at least4.5 and picked outline at least3',()=>{for(const k of ['words','menu','meta'])assert.ok(ratios[k]>=4.5,k+' '+ratios[k]);assert.ok(ratios.picked>=3,'picked '+ratios.picked);});
    check(theme+' every explicit palette face stays and words/menu contrast at least4.5',()=>{assert.equal(after.tinted.length,8);for(let i=0;i<8;i++){assert.equal(after.tinted[i].background,before.tinted[i].background);assert.equal(after.tinted[i].color,before.tinted[i].color);assert.ok(ratios.tinted[i].words>=4.5,JSON.stringify(ratios.tinted[i]));assert.ok(ratios.tinted[i].menu>=4.5,JSON.stringify(ratios.tinted[i]));}});
    check(theme+' header and full Cards unchanged',()=>{assert.deepEqual(after.header,before.header);assert.deepEqual(after.full,before.full);});
    check(theme+' layout dimensions unchanged',()=>{for(const key of ['host','card','other','words','title','count'])for(const metric of ['width','height','padding','margin'])assert.equal(after[key][metric],before[key][metric],key+'.'+metric);});
    await page.evaluate(async()=>{fixture.sheet.current.markDraft(true);await fixture.sheet.current.writing.flush();});const draft=await snapshot();
    check(theme+' draft cards use the whisper dash',()=>{assert.equal(draft.whisper.border,'dashed');assert.equal(draft.card.border,draft.whisper.border);assert.equal(draft.other.border,draft.whisper.border);assert.ok(draft.tinted.every(s=>s.border===draft.whisper.border));});
    await page.evaluate(async()=>{fixture.sheet.current.markDraft(false);await fixture.sheet.current.writing.flush();});const cleared=await snapshot();
    check(theme+' clearing Draft restores solid border',()=>assert.equal(cleared.card.border,'solid'));
    await page.screenshot({path:path.join(evidence,theme+'-cards.png')});
    await page.evaluate(()=>fixture.sheet.current.switchView('text'));const textAfter=await snapshot();
    check(theme+' Text view unchanged',()=>{assert.deepEqual(textAfter.host,textBefore.host);assert.deepEqual(textAfter.text,textBefore.text);assert.deepEqual(textAfter.header,textBefore.header);});
    await page.evaluate(()=>{fixture.sheet.current.switchView('cards');fixture.sheet.setDocked(false);});
    await setCSS(baseline);const floatingBefore=await snapshot();await setCSS(current);const floatingAfter=await snapshot();
    check(theme+' undocked Cards unchanged',()=>assert.deepEqual(floatingAfter,floatingBefore));
    await writeFile(path.join(evidence,theme+'-styles.json'),JSON.stringify({before,after,textBefore,textAfter,draft,cleared,ratios},null,2));
    await context.close();
  }
  check('no browser page errors',()=>assert.deepEqual(errors,[]));
}catch(error){results.push({name:'fixture execution',passed:false,error:error.stack});}
finally{
  await browser?.close();
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({results,errors,browserClosed:!browser?.isConnected(),fixture:'route-fulfilled modules and memory Core ports; no HTTP server or live data'},null,2));
}
const passed=results.filter(r=>r.passed).length,failed=results.length-passed;
console.log(JSON.stringify({passed,failed,results},null,2));
if(failed)process.exitCode=1;
