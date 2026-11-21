import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext, Script } from 'node:vm';
import { expression790 as X } from './onboarding_790_expressions.mjs';
import { onboardingChecks790 } from './onboarding_790_native.mjs';
import { COPIED } from '../web/onboarding.mjs';
import { digest790, assertViewport790, nativePaste790, probePaste790, assertPaste790,
  focused790, clipboardRead790, instrument790, pasted790, phases790, fixtureButton790, controlText790 } from './clipboard_790_diagnostics.mjs';

const want='fixture only\ncurrent prompt';
function fake({text=want,value=want}={}) {
  const dispatched=[];
  return {dispatched,key:async(...args)=>dispatched.push(args),send:async(...args)=>dispatched.push(args),
    evaluate:async source=>{
      if(source===clipboardRead790)return {ok:true,text};
      if(source===focused790)return {tag:'TEXTAREA',id:'onboarding-paste-proof',type:'textarea'};
      if(source===pasted790)return value;
      if(source===phases790)return [{type:'paste',trusted:true},{type:'input',trusted:true,inputType:'insertFromPaste'}];
      assert.equal(source,instrument790);return true;
    }};
}
const opts=p=>({p,want,press:async()=>{},until:async predicate=>assert.ok(await predicate()),observations:[],device:'laptop',variant:'claude',stage:'current-retry',route:'native-paste-command'});

test('safe diagnostics retain hashes, actual focus and native phases on success without text',async()=>{
  const options=opts(fake());const record=await probePaste790(options);assertPaste790(record);
  assert.equal(options.observations[0],record);assert.equal(record.expected.length,want.length);
  assert.equal(record.readback.sha256,digest790(want).sha256);assert.equal(record.readback.exact,true);
  assert.equal(record.focus.id,'onboarding-paste-proof');assert.equal(record.events[0].type,'paste');
  assert.equal(record.dispatched.length,2);assert.equal(record.complete,true);
  assert.ok(!JSON.stringify(record).includes(want));assert.ok(!JSON.stringify(record).includes('headers'));
});

test('exact equality rejects different text even at same length and leaves failure diagnostics',async()=>{
  const options=opts(fake({value:'x'.repeat(want.length)}));
  await assert.rejects(()=>probePaste790(options));
  const record=options.observations[0];assert.equal(record.readback.exact,true);
  assert.equal(record.pasted.length,want.length);assert.equal(record.exact,false);assert.equal(record.complete,true);
  assert.equal(record.events[1].inputType,'insertFromPaste');assert.throws(()=>assertPaste790(record));
});

test('wrong clipboard content stops before paste, retains safe product defect classification',async()=>{
  const p=fake({text:'wrong fixture'}),options=opts(p),record=await probePaste790(options);
  assert.equal(record.failure,'product-write-mismatch');assert.equal(record.readback.exact,false);
  assert.equal(p.dispatched.length,0);assert.throws(()=>assertPaste790(record));
});

test('native editing command carries no text and raw path preserves original key call',async()=>{
  const p=fake(),record={dispatched:[]};await nativePaste790(p,'native-paste-command',record);
  assert.deepEqual(p.dispatched,[['Input.dispatchKeyEvent',{type:'rawKeyDown',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:4,commands:['paste']}],
    ['Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:4}]]);
  p.dispatched.length=0;await nativePaste790(p,'raw-meta-v',record);assert.deepEqual(p.dispatched,[['v',4]]);
});

test('clipboard read denial is diagnostic refusal without exception text or product failure claim',async()=>{
  const p=fake(),evaluate=p.evaluate;p.evaluate=source=>source===clipboardRead790?{ok:false}:evaluate(source);
  const options=opts(p);await assert.rejects(()=>probePaste790(options),/clipboard read refused/);
  assert.equal(options.observations[0].failure,'clipboard-read-refused');assert.equal(p.dispatched.length,0);
});

test('all diagnostic browser expressions parse and viewport tolerance catches actual expression crossing',()=>{
  for(const expression of [focused790,clipboardRead790,instrument790,pasted790,phases790,fixtureButton790])new Script(expression);
  const document={querySelector:()=>({scrollWidth:358,clientWidth:358,getBoundingClientRect:()=>({left:0,top:0,right:358,bottom:812})})};
  const b=runInNewContext(X.layout,{document,innerWidth:390,innerHeight:844});assertViewport790(b);
  // Fractional rounding within the named tolerance is permitted; crossing it is not.
  assertViewport790({...b,left:-0.75,overflow:0.75});
  assert.throws(()=>assertViewport790({...b,overflow:2}),/viewportTolerance790Px=1/);
});

test('actual reading entry point enumerates Chromium seven and WebKit original six without execution',async()=>{
  const {readingChecks}=await import('./topic_reading_native.mjs');const cases={};
  for(const engine of ['chrome','webkit']) {
    const names=[];await readingChecks({engine,check:async(name,_body)=>{if(/^reading item 790/.test(name))names.push(name);},facts:{origin:'https://isolated.invalid'},observations:[]});
    assert.equal(names.length,engine==='chrome'?7:6);cases[engine]=names;
  }
  assert.deepEqual(cases.chrome.slice(1),cases.webkit);
  console.log(JSON.stringify({ownedLiteralCases:cases,executedBodies:0,runnerStarts:0}));
});

// Only the driver edge is fake. Execute the candidate's real control, probes,
// assertion, stop guard and first product body; never duplicate its selection.
async function actualControl790({raw,command,badPhases=null}) {
  const observations=[],names=[],failures=[],productDispatch=[];
  const trusted=[{type:'paste',trusted:true},{type:'input',trusted:true,inputType:'insertFromPaste'}];
  const page=async name=>{
    const control=name==='onboarding790-clipboard-control';
    let route=null,variant='codex';
    const prompt=()=>control?controlText790:`Initial purpose for interactive work aim-core ${variant==='codex'?'AGENTS.md':'CLAUDE.md'}`;
    const input=r=>{route=r;if(!control)productDispatch.push(r);};
    return {
      point:async selector=>{if(selector==='#onboarding-claude')variant='claude';},
      key:async(key,modifiers)=>{assert.equal(key,'v');assert.equal(modifiers,4);input('raw-meta-v');},
      send:async(method,data)=>{
        assert.equal(method,'Input.dispatchKeyEvent');
        if(data.type==='rawKeyDown'){assert.deepEqual(data.commands,['paste']);input('native-paste-command');}
        else assert.equal(data.type,'keyUp');
      },
      evaluate:async source=>{
        if(source===clipboardRead790)return {ok:true,text:prompt()};
        if(source===instrument790){route=null;return true;}
        if(source===focused790)return {tag:'TEXTAREA',id:'onboarding-paste-proof',type:'textarea'};
        if(source===pasted790)return !control||(route==='raw-meta-v'?raw:command)?prompt():'';
        if(source===phases790)return control&&route===badPhases?[]:trusted;
        if(source===X.text)return prompt();
        if(source===X.state)return COPIED;
        if(source===X.layout)return {left:0,top:0,right:704,bottom:884,width:1280,height:900,overflow:0};
        if([fixtureButton790,X.ready,X.opened,`document.body.dataset.ready === 'true'`,`window.controlCopied790 === true`].includes(source))return true;
        if(source.endsWith(".scrollIntoView({block:'center'})"))return true;
        assert.fail('unexpected fake-page expression');
      },
    };
  };
  await onboardingChecks790({engine:'chrome',facts:{origin:'https://isolated.invalid'},observations,page,
    until:async predicate=>assert.ok(await predicate(),'bounded fake driver paste wait'),
    control:async()=>({}),shot:async()=>{},grant:async()=>{},
    check:async(name,body)=>{
      names.push(name);
      // The native harness retains a failed case then returns to the stop guard.
      if(names.length===1||name==='reading item 790 laptop: owner chooses both variants and copies current prompt by native paste') {
        try{await body();}catch(error){failures.push(error);}
      }
    }});
  return {observations,names,failures,productDispatch};
}

const productSuffixes790=[
  'owner chooses both variants and copies current prompt by native paste',
  'refused clipboard keeps readable text and retry copies fresh state',
  'non-owner has no overflow and Core refuses the prompt',
];
for(const [label,raw,command,selected] of [
  ['raw-only',true,false,'raw-meta-v'],
  ['command-only',false,true,'native-paste-command'],
  ['both',true,true,'raw-meta-v'],
])test(`actual control ${label} success asserts selected record and carries route into product paste`,async()=>{
  const r=await actualControl790({raw,command});
  assert.deepEqual(r.failures,[],'real control and laptop first-copy body must pass');
  assert.deepEqual(r.names.slice(1),['laptop','phone'].flatMap(device=>productSuffixes790.map(suffix=>`reading item 790 ${device}: ${suffix}`)));
  assert.deepEqual(r.observations.find(o=>o.name==='reading item 790 clipboard control comparison'),{
    name:'reading item 790 clipboard control comparison',rawExact:raw,commandExact:command,selectedRoute:selected});
  assert.deepEqual(r.productDispatch,[selected,selected]);
  const products=r.observations.filter(o=>o.stage==='first-copy');
  assert.deepEqual(products.map(o=>[o.variant,o.route,o.exact]),[['codex',selected,true],['claude',selected,true]]);
  assert.ok(!JSON.stringify(r.observations).includes(controlText790));
  console.log(JSON.stringify({belowBrowserControl:label,selected,registeredProductCases:r.names.length-1,executedProductBodies:1,productProbes:products.length,runnerStarts:0}));
});

test('actual control neither-success refuses before registering any product case',async()=>{
  const r=await actualControl790({raw:false,command:false});
  assert.equal(r.failures.length,1);assert.match(r.failures[0].message,/neither bounded native paste path worked/);
  assert.equal(r.names.length,1);assert.deepEqual(r.productDispatch,[]);
  assert.equal(r.observations.find(o=>o.selectedRoute===null)?.rawExact,false);
});

for(const [label,raw,command,badPhases] of [
  ['raw',true,true,'raw-meta-v'],['command',false,true,'native-paste-command'],
])test(`actual control refuses selected ${label} record without trusted native phases`,async()=>{
  const r=await actualControl790({raw,command,badPhases});
  assert.equal(r.failures.length,1);assert.match(r.failures[0].message,/trusted native paste and insertFromPaste/);
  assert.equal(r.names.length,1);assert.deepEqual(r.productDispatch,[]);
});

test('actual control does not assert unselected command record when both texts match',async()=>{
  const r=await actualControl790({raw:true,command:true,badPhases:'native-paste-command'});
  assert.deepEqual(r.failures,[]);assert.equal(r.names.length,7);
  assert.deepEqual(r.productDispatch,['raw-meta-v','raw-meta-v']);
});
