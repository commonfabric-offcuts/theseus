import assert from 'node:assert/strict';
import { expression790 as X, centre790, hit790 } from './onboarding_790_expressions.mjs';
import { assertViewport790, probePaste790, assertPaste790, fixtureButton790, controlText790 } from './clipboard_790_diagnostics.mjs';
import { COPIED, COPY_FAILED } from '../web/onboarding.mjs';

export async function onboardingChecks790({check,page,until,control,shot,facts,observations,grant,engine='chrome'}) {
  let pasteRoute='raw-meta-v',stopReason=null;
  if(engine==='chrome')await check('reading item 790 clipboard-control: fixture-only raw Meta+V versus native paste editing command',async()=>{
    stopReason='clipboard-control-not-established';
    const p=await page('onboarding790-clipboard-control',null,true,{url:facts.origin+'/'});
    if(grant)await grant(['clipboard-read','clipboard-write']);
    await until(()=>p.evaluate(`document.body.dataset.ready === 'true'`),'control page ready');
    await p.evaluate(fixtureButton790);await p.evaluate(centre790('#clipboard-control-790'));await p.point('#clipboard-control-790');
    await until(()=>p.evaluate(`window.controlCopied790 === true`),'fixture clipboard write completes');
    const press=async(q,selector)=>{await q.evaluate(centre790(selector));await q.point(selector);};
    const options={p,want:controlText790,press,until,observations,device:'control',variant:'fixture-only',stage:'clipboard-control',control:true};
    const raw=await probePaste790({...options,route:'raw-meta-v'});
    const command=await probePaste790({...options,route:'native-paste-command'});
    observations.push({name:'reading item 790 clipboard control comparison',rawExact:raw.exact,commandExact:command.exact,
      selectedRoute:raw.exact?'raw-meta-v':command.exact?'native-paste-command':null});
    if(!raw.exact&&!command.exact){stopReason='clipboard-control-failed';assert.fail('neither bounded native paste path worked');}
    pasteRoute=raw.exact?'raw-meta-v':'native-paste-command';assertPaste790(raw.exact?raw:command);stopReason=null;
  });
  if(stopReason)return;
  const devices={laptop:{width:1280,height:900,deviceScaleFactor:1,mobile:false},phone:{width:390,height:844,deviceScaleFactor:1,mobile:true}};
  for(const [device,metrics] of Object.entries(devices)) {
    const press=async(p,selector)=>{
      await p.evaluate(centre790(selector));
      if(!metrics.mobile){await p.point(selector);return;}
      const b=await p.box(selector);assert.ok(b&&b.width>0&&b.height>0,selector+' is reachable');
      const at={x:b.x+b.width/2,y:b.y+b.height/2};assert.equal(await p.evaluate(hit790(selector,at.x,at.y)),true,selector+' is hit by touch');
      await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[at]});
      await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    const open=async(name,workspace)=>{
      const p=await page(name,null,true,{url:facts.origin+'/?workspace='+workspace,beforeNavigate:async q=>{
        await q.send('Emulation.setDeviceMetricsOverride',metrics);
        if(metrics.mobile)await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      }});
      await until(()=>p.evaluate(X.ready),'item 790 outcome ready');return p;
    };
    const seed=async(suffix,owner=null)=>{
      const workspace='w-onboarding-790-'+device+'-'+suffix;
      await control({method:'team_outcome',operation_id:workspace+'-create',workspace_id:workspace,title:'Isolated onboarding '+device,team:['aim-core'],...(owner?{owner}:{})});
      if(!owner)await control({method:'onboarding_790',action:'update',operation_id:workspace+'-purpose',workspace_id:workspace,purpose:'Initial purpose for interactive work'});
      return workspace;
    };
    const sheet=async p=>{
      await press(p,'#outcome-menu');await press(p,'.message-menu-list [role=menuitem]');
      await until(()=>p.evaluate(X.opened),'item 790 choice sheet opens');
    };
    const layout=async p=>{
      const b=await p.evaluate(X.layout),viewportTolerance790Px=1;
      assertViewport790(b);
      observations.push({name:'reading item 790 layout',device,engine,viewportTolerance790Px,...b});
    };
    const paste=async(p,want,variant,stage)=>{
      if(engine!=='chrome'){
        await p.evaluate(X.scratch);await press(p,'#onboarding-paste-proof');await p.key('v',4);
        await until(async()=>await p.evaluate(X.pasted)===want,'native paste equals exact prompt');
        assert.ok(await p.evaluate(X.pasted)===want,'actual native clipboard paste proof');return;
      }
      const record=await probePaste790({p,want,press,until,observations,device,variant,stage,route:pasteRoute});
      if(record.failure==='product-write-mismatch')stopReason='product-write-mismatch';
      assertPaste790(record);
    };
    await check(`reading item 790 ${device}: owner chooses both variants and copies current prompt by native paste`,async()=>{
      const workspace=await seed('copy'),p=await open('onboarding790-'+device+'-copy',workspace);
      if(grant)await grant(['clipboard-read','clipboard-write']);
      for(const variant of ['codex','claude']) {
        await sheet(p);await press(p,'#onboarding-'+variant);
        await until(async()=>await p.evaluate(X.state)===COPIED,'copy confirmed');
        const prompt=await p.evaluate(X.text);assert.ok(prompt.includes(variant==='codex'?'AGENTS.md':'CLAUDE.md'));
        assert.ok(prompt.includes('Initial purpose for interactive work'));assert.ok(prompt.includes('aim-core'));
        assert.doesNotMatch(prompt,/sk-synthetic|token=|\/Users\/|\.profile\.json|session\.json/);
        await layout(p);await shot(p,'onboarding790-'+device+'-'+variant+'.png');await paste(p,prompt,variant,'first-copy');
        await press(p,'#onboarding-close');
      }
    });
    if(stopReason)return;
    await check(`reading item 790 ${device}: refused clipboard keeps readable text and retry copies fresh state`,async()=>{
      const workspace=await seed('refusal'),p=await open('onboarding790-'+device+'-refusal',workspace);
      if(grant)await grant(['clipboard-read','clipboard-write']);
      for(const variant of (engine==='chrome'?['codex','claude']:['codex'])) {
        await sheet(p);await p.evaluate(X.deny);await press(p,'#onboarding-'+variant);
        await until(async()=>await p.evaluate(X.state)===COPY_FAILED,'truthful clipboard refusal');
        assert.ok((await p.evaluate(X.text)).includes(variant==='codex'?'Initial purpose':'Fresh purpose at retry time codex'));
        await layout(p);await shot(p,'onboarding790-'+device+'-'+variant+'-refused.png');
        const fresh='Fresh purpose at retry time '+variant;
        await control({method:'onboarding_790',action:'update',operation_id:workspace+'-fresh-'+variant,workspace_id:workspace,purpose:fresh});
        await p.evaluate(X.restore);await press(p,'#onboarding-retry');await until(async()=>await p.evaluate(X.state)===COPIED,'retry copies');
        const prompt=await p.evaluate(X.text);assert.ok(prompt.includes(fresh));assert.ok(!prompt.includes('Initial purpose'));
        assert.ok(prompt.includes(variant==='codex'?'AGENTS.md':'CLAUDE.md'));
        await paste(p,prompt,variant,'current-retry');await press(p,'#onboarding-close');
      }
    });
    if(stopReason)return;
    await check(`reading item 790 ${device}: non-owner has no overflow and Core refuses the prompt`,async()=>{
      const workspace=await seed('nonowner','aim-core'),p=await open('onboarding790-'+device+'-nonowner',workspace);
      assert.equal(await p.evaluate(X.ownerMenu),false);
      const denied=await control({method:'onboarding_790',action:'read',workspace_id:workspace});
      assert.equal(denied.error?.code,'FORBIDDEN');assert.equal(Object.hasOwn(denied,'prompt'),false);
      await shot(p,'onboarding790-'+device+'-nonowner.png');
    });
  }
}
