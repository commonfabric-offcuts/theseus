// Item 653: real owners on the isolated HTTP page, native input, unchanged
// before/after PNGs, actual original-source reds, then the frozen candidate.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Allow fractional CSS pixel rounding, not a size change. A restored 48px
// square is within 2px; the original 224px/448px images remain far outside it.
const GEOMETRY_PX = 2, TOUCH_PX = .5;
export async function imageButtons653({ check, page, press, picture, close, control, facts, root, engine, evidence }) {
  const inputs = {}, observations = [], reds = [];
  const files = ['web/app.mjs','web/aim.css','web/page-image.mjs','web/image-pick.mjs','web/notebook-page.mjs','web/deck-page.mjs','tests/image_buttons_653.mjs','tests/reader_compose_native.mjs','tests/fixtures/ui_http.py'];
  for (const name of files) inputs[name] = sha(await readFile(path.join(root,name)));
  const topic = 'item653-' + engine, note = topic + '-page';
  await control({ method:'navigation_topics',topics:[{id:topic,title:'Item 653 images'}] });
  const message = (await control({method:'agent_message',operation_id:topic,topic_id:topic,join:true,source:'topic',body:'Image source keeps its exact words.',attachments:[{name:'screen.png',png:[480,240]}]})).result.message_id;
  assert.equal((await control({method:'outcome_reference',operation_id:note,item_id:note,title:'Item 653 Notebook',body:`## Picture\nWords stay here.\n![screen.png](attachment:${note}-media-0)\n\n## Missing\n![missing.png](attachment:missing-653)`,attachments:[{name:'screen.png',png:[480,240]}]})).status,'committed');
  const shapes = ['phone-320','phone-375','phone-390','stacked'];
  const surfaces = [
    {name:'card-full',route:`/?cards=${note}`,scope:'.deck-card .deck-image',image:'.deck-card .deck-image .image-thumb',card:true},
    {name:'card-sheet',route:`/?topic=${topic}&page=${note}`,scope:'.notebook-sheet-page:not([hidden]) .deck-card .deck-image',image:'.notebook-sheet-page:not([hidden]) .deck-card .deck-image .image-thumb',card:true},
    {name:'page-here',route:`/?workspace=w1&page=${note}&revision=1`,scope:'.page-image',image:'.page-image .image-thumb'},
    {name:'page-revision',route:`/?topic=${topic}&page=${note}&revision=1`,scope:'#source-body .page-image',image:'#source-body .page-image .image-thumb'},
    {name:'source-message',route:`/?topic=${topic}&message=${message}`,scope:'#source-attachments',image:'#source-attachments .attachment-control .image-thumb',source:{kind:'message',id:message}},
    {name:'source-revision',route:`/?topic=${topic}&page=${note}&revision=1`,scope:'#source-attachments',image:'#source-attachments .attachment-control .image-thumb',source:{kind:'memory',id:note,revision:1}},
  ];
  const wait = (p, fn, arg, timeout=15000) => p.waitForFunction(fn,arg,{polling:'raf',timeout});
  const ready = async(p,s) => {
    await p.locator(s).first().scrollIntoViewIfNeeded();
    await wait(p,s=>{const i=document.querySelector(s);return i&&!i.hidden&&i.complete&&i.naturalWidth>0;},s);
  };
  const geometry = async(p,s) => {
    const value=await p.locator(s).first().evaluate(i=>{const r=i.getBoundingClientRect(),c=getComputedStyle(i);return{width:r.width,height:r.height,fit:c.objectFit,root:parseFloat(getComputedStyle(document.documentElement).fontSize)};});
    assert.ok(Math.abs(value.width-3*value.root)<=GEOMETRY_PX && Math.abs(value.height-3*value.root)<=GEOMETRY_PX,'item 653 image is a 3rem square: '+JSON.stringify(value));
    assert.equal(value.fit,'contain','item 653 whole image is contained');
    if(p.touch) assert.ok(value.width>=44-TOUCH_PX&&value.height>=44-TOUCH_PX,'item 653 thumbnail is reachable by touch');
    return value;
  };
  const opened = async(p,s,key=false) => {
    const src=await p.locator(s).first().getAttribute('src'),route=p.url(),count=p.ctx.pages().length;
    const popup=p.ctx.waitForEvent('page',{timeout:5000});
    const received=popup.then(value=>({value}),error=>({error}));
    if(key){
      // Reach the thumbnail through the actual Tab order, starting wherever
      // the preceding native act left focus. No direct focus or handlers.
      let at=false;
      for(let n=0;n<160&&!at;n++){await p.keyboard.press('Tab');at=await p.locator(s).first().evaluate(e=>document.activeElement===e);}
      assert.equal(at,true,'item 653 native Tab reaches the image');
      assert.equal(await p.locator(s).first().evaluate(e=>e.matches(':focus-visible')),true,'item 653 keyboard ring shows');
      await p.keyboard.press('Enter');
    }else await press(p,s);
    const answer=await received; assert.ok(answer.value,'item 653 thumbnail opens one tab: '+(answer.error?.message??''));
    const tab=answer.value;
    try{
      await tab.waitForLoadState('domcontentloaded');
      assert.equal(tab.url(),src,'exact displayed bytes open');
      await tab.waitForFunction(()=>document.images[0]?.complete&&document.images[0].naturalWidth>0);
      assert.equal(await tab.evaluate(()=>opener===null),true,'no opener');
      assert.equal(p.url(),route,'destination stays exact');assert.equal(p.ctx.pages().length,count+1,'one native gesture opens one tab');
    }finally{await tab.close();}
  };
  const sourceState=p=>p.evaluate(()=>{const f=document.querySelector('#writing-body');return{words:f?.value,caret:f&&[f.selectionStart,f.selectionEnd],to:document.querySelector('#who-chip')?.textContent,url:location.href};});
  const write=async(p,s,text)=>{await press(p,s);await p.keyboard.press('ControlOrMeta+A');await p.keyboard.insertText(text);await p.keyboard.press('Home');await p.keyboard.press('ArrowRight');};
  const restart=async()=>{await control({method:'server_stop'});await control({method:'server_start'});};
  const original={};
  for(const name of ['web/app.mjs','web/aim.css'])original[name]=await readFile(path.join(root,name),'utf8');
  // Each baseline run captures the unmodified original app/CSS. Expected reds
  // are caught only at the size/thumbnail assertion, never at setup or waits.
  await check('item 653 original-source reds and before images, all widths and themes',async()=>{
    const before={};
    for(const name of Object.keys(original))before[name]=execFileSync('git',['show','932856a^:'+name],{cwd:root,encoding:'utf8'});
    try{
      for(const [name,bytes]of Object.entries(before)){await writeFile(path.join(root,name),bytes);assert.equal(await readFile(path.join(root,name),'utf8'),bytes,'actual original source applied');}
      await restart();
      for(const shape of shapes)for(const scheme of ['light','dark'])for(const surface of surfaces){
        const p=await page(shape,scheme,surface.route);
        try{
          const served=await p.request.get(facts.origin+'/aim.css');assert.equal(sha(await served.body()),sha(before['web/aim.css']),'before CSS actually served');
          let error;
          if(surface.source){
            await p.locator('#source-attachments button').first().waitFor({state:'visible'});
            await picture(p,'item-653-before-'+surface.name);
            try{assert.equal(await p.locator(surface.image).count(),1,'item 653 verified source shows a thumbnail');}catch(e){error=e;}
          }else{
            await ready(p,surface.image);await picture(p,'item-653-before-'+surface.name);
            try{await geometry(p,surface.image);}catch(e){error=e;}
          }
          assert.equal(error?.code,'ERR_ASSERTION','original fails a product assertion');assert.match(error.message,/item 653 (image is a 3rem square|verified source shows a thumbnail)/);
          reds.push({shape,scheme,surface:surface.name,error:{name:error.name,message:error.message,stack:error.stack},inputs:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,sha(v)]))});
          console.log('RED item 653 '+shape+' '+scheme+' '+surface.name+': '+error.message);
        }finally{await close(p);}
      }
    }finally{
      for(const [name,bytes]of Object.entries(original)){await writeFile(path.join(root,name),bytes);assert.equal(await readFile(path.join(root,name),'utf8'),bytes,'preview restored exactly');}
      await restart();
      await writeFile(path.join(evidence,engine,'item-653-original-reds.json'),JSON.stringify({reds,restored:true},null,2));
    }
  });
  for(const shape of shapes)for(const scheme of ['light','dark'])for(const surface of surfaces){
    await check(`item 653 ${shape} ${scheme} ${surface.name}: thumbnail actions keep words image caret To and destination`,async()=>{
      const requests=[];
      const p=await page(shape,scheme,surface.route,facts,async q=>{await q.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.item653URLs={made:[],revoked:[]};URL.createObjectURL=b=>{const u=create(b);item653URLs.made.push(u);return u;};URL.revokeObjectURL=u=>{item653URLs.revoked.push(u);return revoke(u);};});q.on('request',r=>{if(r.url().endsWith('/api/media/read'))requests.push(r.postDataJSON());});});
      try{
        await ready(p,surface.image);const measured=await geometry(p,surface.image);
        await picture(p,'item-653-after-'+surface.name);
        if(surface.source){
          assert.ok(requests.some(r=>JSON.stringify(r.source_ref)===JSON.stringify(surface.source)),'bytes read through the exact source/revision');
          await write(p,'#writing-body','Item 653 exact writing — keep it.');
          const before=await sourceState(p);
          await ready(p,surface.image);await opened(p,surface.image);
          assert.deepEqual(await sourceState(p),before,'thumbnail keeps writing caret To and destination');
          await opened(p,surface.image,true);
          assert.deepEqual(await sourceState(p),before,'Return keeps writing caret To and destination');
          const thumbnailURL=await p.locator(surface.image).first().getAttribute('src');
          await press(p,'#source-attachments .attachment-open');
          await wait(p,()=>Boolean(document.querySelector('#source-attachments a[download]')));
          assert.equal(await p.locator('#source-attachments a[download]').textContent(),'Download screen.png');
          assert.equal(await p.locator('#source-attachments .attachment-control').count(),0,'explicit Open keeps its passive image and Download');
          await wait(p,url=>item653URLs.revoked.includes(url),thumbnailURL);
          observations.push({shape,scheme,surface:surface.name,revoked:thumbnailURL});
          assert.deepEqual(await sourceState(p),before,'named Open keeps writing and To');
          await picture(p,'item-653-after-'+surface.name+'-explicit-open');
        }else{
          const words=await p.locator(surface.scope).first().textContent();
          await opened(p,surface.image);await opened(p,surface.image,true);
          assert.equal(await p.locator(surface.scope).first().textContent(),words,'caption and image line stay exact');
          if(surface.card){
            await press(p,'.deck-card .deck-words');
            const field='.deck-writing textarea';await p.locator(field).waitFor({state:'visible'});
            await write(p,field,'Picture\nItem 653 card writing.');
            const image='.deck-writing .deck-image .image-thumb';await ready(p,image);await geometry(p,image);
            const before=await p.locator(field).evaluate(e=>({words:e.value,caret:[e.selectionStart,e.selectionEnd]}));
            await picture(p,'item-653-after-'+surface.name+'-writing');await opened(p,image);
            assert.deepEqual(await p.locator(field).evaluate(e=>({words:e.value,caret:[e.selectionStart,e.selectionEnd]})),before,'native image press keeps card writing and caret');
            assert.equal(await p.locator('.deck-writing .deck-image-remove').count(),1,'Remove remains distinct');
          }
        }
        observations.push({shape,scheme,surface:surface.name,measured,requests});
      }finally{await close(p);}
    });
  }
  for(const shape of shapes)for(const scheme of ['light','dark'])for(const state of ['busy','denied','unavailable','read-error','non-image','unknown','empty']){
    await check(`item 653 ${shape} ${scheme} source ${state}: named fallback remains and no stale bytes`,async()=>{
      let release,entered=0;
      const held=new Promise(resolve=>{release=resolve;});
      const surface=surfaces.find(s=>s.name==='source-message');
      const p=await page(shape,scheme,surface.route,facts,async q=>{
        if(state==='empty'||state==='unknown'||state==='non-image')await q.route('**/api/view',async route=>{
          const req=route.request().postDataJSON();const answer=await route.fetch();
          if(req.name==='source'&&req.args.id===message){const data=await answer.json();
            if(state==='empty')data.attachments=[];
            else for(const a of data.attachments){if(state==='unknown'){delete a.inline;delete a.content_type;}else{a.inline=false;a.content_type='text/plain';}}
            await route.fulfill({response:answer,json:data});
          }else await route.fulfill({response:answer});
        });
        await q.route('**/api/media/read',async route=>{
          const req=route.request().postDataJSON();
          if(req.source_ref?.id!==message)return route.continue();entered++;
          if(state==='busy'){await held;return route.continue();}
          if(['denied','unavailable','read-error'].includes(state))return route.fulfill({status:state==='denied'?403:state==='unavailable'?404:500,contentType:'application/json',body:JSON.stringify({error:{message:'Item 653 '+state}})});
          return route.continue();
        });
      });
      try{
        await wait(p,()=>document.querySelector('#reader').open&&document.querySelector('#source-body').textContent.includes('Image source'));
        if(state==='busy'){
          await wait(p,()=>Boolean(document.querySelector('#source-attachments .image-thumb[hidden]')));
          await picture(p,'item-653-source-busy');
          await write(p,'#writing-body','Item 653 busy writing.');const before=await sourceState(p);
          await press(p,'#reader-close');
          release();await wait(p,()=>!document.querySelector('#reader').open);
          await wait(p,()=>document.querySelectorAll('#source-attachments .image-thumb').length===0);
          assert.equal(await p.locator('#source-attachments .image-thumb:not([hidden])').count(),0,'late bytes never appear after disposal');
          assert.ok(entered>=1,'busy read actually started');
          observations.push({shape,scheme,state,before,entered});
        }else{
          if(['denied','unavailable','read-error'].includes(state))await wait(p,()=>document.querySelectorAll('#source-attachments .image-thumb').length===0);
          assert.equal(await p.locator('#source-attachments .image-thumb').count(),0,'fallback has no image bytes');
          assert.equal(await p.locator('#source-attachments button').count(),state==='empty'?0:1,'named Open remains unless empty');
          await picture(p,'item-653-source-'+state);
          if(['denied','unavailable','read-error'].includes(state)){
            await write(p,'#writing-body','Item 653 fallback writing.');const before=await sourceState(p);
            await press(p,'#source-attachments button');await wait(p,()=>!document.querySelector('#reader-notice').hidden);
            assert.match(await p.locator('#reader-notice').textContent(),/screen.png/,'refusal names its image');
            assert.deepEqual(await sourceState(p),before,'refusal preserves writing and destination');
            await picture(p,'item-653-source-'+state+'-open-refused');
          }
          observations.push({shape,scheme,state,entered});
        }
      }finally{release();await close(p);}
    });
  }
  for(const shape of shapes)for(const scheme of ['light','dark']){
    await check(`item 653 ${shape} ${scheme} retained reply: thumbnail Open Copy and Undo keep their owners`,async()=>{
      const id=`${topic}-aside-${shape}-${scheme}`;
      await control({method:'navigation_topics',topics:[{id,title:'Retained item 653'}]});
      const result=await control({method:'agent_message',operation_id:id,topic_id:id,sender:'person',source:'topic',unsent:true,body:'Item 653 retained words.',attachments:[{name:'screen.png',image:'screen.png'}]});
      assert.ok(result.submission_id,'actual prepared submission exists');
      const p=await page(shape,scheme,`/?topic=${id}`);
      try{
        await wait(p,()=>document.querySelector('#inline-pending button')?.textContent==='Review 1 reply');
        await write(p,'#inline-writing-body','Item 653 newer writing.');
        let found=false;for(let n=0;n<160&&!found;n++){await p.keyboard.press('Tab');found=await p.evaluate(()=>document.activeElement===document.querySelector('#inline-pending button'));}
        assert.equal(found,true,'native Tab reaches Review');await p.keyboard.press('Enter');
        const card=`#review-content .pending-card[data-id="${result.submission_id}"]`;
        await p.locator(card+' .aside-act').first().waitFor({state:'visible'});await press(p,card+' .aside-act');
        await wait(p,s=>document.querySelector(s)?.dataset.state==='aside',card);
        const image=card+' .attachment-control .image-thumb';await ready(p,image);await geometry(p,image);
        assert.equal(await p.locator(card+' pre').textContent(),'Item 653 retained words.');
        assert.deepEqual(await p.locator(card+' .aside-act').allTextContents(),['Copy','Undo']);
        await picture(p,'item-653-retained-reply');await opened(p,image);await opened(p,image,true);
        await press(p,card+' .attachment-open');await p.locator(card+' a[download]').waitFor({state:'visible'});
        await picture(p,'item-653-retained-explicit-open');
        await press(p,'#review-close');assert.equal(await p.locator('#inline-writing-body').inputValue(),'Item 653 newer writing.');
      }finally{await close(p);}
    });
    await check(`item 653 ${shape} ${scheme} Read it here: exact permitted image without topic access`,async()=>{
      const id=`${topic}-lost-${shape}-${scheme}`;
      const sent=await control({method:'lost_named_message',operation_id:id,body:'Item 653 permitted words. '+id,image:true});
      assert.equal(sent.status,'committed');
      const p=await page(shape,scheme,'/');
      try{
        const row=p.locator('#sent-to-you li').filter({hasText:'Item 653 permitted words. '+id}).last();
        const action=row.getByRole('button',{name:'Read it here',exact:true});await action.waitFor({state:'visible'});
        assert.equal(await row.locator('.attachment-control').count(),0,'no speculative image before the exact source read');
        if(p.touch)await action.tap();else await action.click();
        const image='#sent-to-you .attachment-control .image-thumb';await ready(p,image);await geometry(p,image);
        await picture(p,'item-653-permitted-read-here');await opened(p,image);
        assert.equal(await row.locator('a[href*="topic="]').count(),0,'lost topic never becomes a navigation permission');
        await press(p,'#sent-to-you .attachment-open');await p.locator('#sent-to-you a[download]').waitFor({state:'visible'});
        await picture(p,'item-653-permitted-explicit-open');
      }finally{await close(p);}
    });
  }
  for(const [name,digest]of Object.entries(inputs))assert.equal(sha(await readFile(path.join(root,name))),digest,'frozen source restored: '+name);
  await writeFile(path.join(evidence,engine,'item-653-inputs-and-observations.json'),JSON.stringify({engine,inputs,reds,observations,restored:true,tolerances:{GEOMETRY_PX,TOUCH_PX},physicalIOS:false,softwareKeyboard:false},null,2));
}
