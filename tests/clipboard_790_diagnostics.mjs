import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const digest790 = text => ({length:text.length,sha256:createHash('sha256').update(text,'utf8').digest('hex')});
export const controlText790 = 'Isolated item 790 clipboard control\nsecond line — fixture only';
export const focused790 = `(()=>{const e=document.activeElement;return e?{tag:e.tagName,id:e.id,type:e.type??null}:null})()`;
export const clipboardRead790 = `(async()=>{try{return {ok:true,text:await navigator.clipboard.readText()}}catch{return {ok:false}}})()`;
export const instrument790 = `(()=>{
  document.querySelector('#onboarding-paste-proof')?.remove();
  const t=document.createElement('textarea');t.id='onboarding-paste-proof';t.setAttribute('aria-label','Isolated clipboard paste proof');
  (document.querySelector('#onboarding-sheet[open]')??document.body).append(t);
  window.pastePhases790=[];
  for(const type of ['keydown','keyup','paste','beforeinput','input'])t.addEventListener(type,e=>{
    if(window.pastePhases790.length<24)window.pastePhases790.push({type:e.type,trusted:e.isTrusted,key:e.key??null,
      meta:Boolean(e.metaKey),ctrl:Boolean(e.ctrlKey),inputType:e.inputType??null,defaultPrevented:e.defaultPrevented});
  });return true})()`;
export const pasted790 = `document.querySelector('#onboarding-paste-proof').value`;
export const phases790 = `window.pastePhases790`;
export const fixtureButton790 = `(()=>{const b=document.createElement('button');b.id='clipboard-control-790';b.textContent='Copy isolated clipboard control';
  window.controlCopied790=false;b.onclick=()=>{const data=Promise.resolve(new Blob([${JSON.stringify(controlText790)}],{type:'text/plain'}));
    navigator.clipboard.write([new ClipboardItem({'text/plain':data})]).then(()=>{window.controlCopied790=true},()=>{window.controlCopied790=false})};
  document.body.append(b);return true})()`;

export function assertViewport790(b) {
  const viewportTolerance790Px=1;
  assert.ok(b.left>=-viewportTolerance790Px&&b.top>=-viewportTolerance790Px&&b.right<=b.width+viewportTolerance790Px&&b.bottom<=b.height+viewportTolerance790Px&&b.overflow<=viewportTolerance790Px,'sheet stays in viewport, viewportTolerance790Px=1');
}

// Explicit editing commands invoke Chromium's native clipboard route. No text is
// passed to the input driver. Use only after the fixture control establishes it.
export async function nativePaste790(p,route,record) {
  record.dispatched.push({phase:'rawKeyDown',route});
  if(route==='raw-meta-v') {
    await p.key('v',4);
  } else {
    assert.equal(route,'native-paste-command');
    const data={key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:4};
    await p.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...data,commands:['paste']});
    await p.send('Input.dispatchKeyEvent',{type:'keyUp',...data});
  }
  record.dispatched.push({phase:'keyUp',route});
}

export async function probePaste790({p,want,press,until,observations,device,variant,stage,route,control=false}) {
  const record={name:'reading item 790 clipboard diagnostic',device,variant,stage,route,expected:digest790(want),
    readback:null,focus:null,dispatched:[],events:[],pasted:null,exact:false,complete:false};
  observations.push(record); // Exists even if a later read, input or equality fails.
  const read=await p.evaluate(clipboardRead790);
  record.readback=read.ok?{ok:true,...digest790(read.text),exact:read.text===want}:{ok:false};
  if(!read.ok){record.failure='clipboard-read-refused';assert.fail('item 790 diagnostic clipboard read refused');}
  if(read.text!==want){record.failure=control?'control-write-mismatch':'product-write-mismatch';return record;}
  await p.evaluate(instrument790);await press(p,'#onboarding-paste-proof');
  record.focus=await p.evaluate(focused790);
  try {
    assert.equal(record.focus?.id,'onboarding-paste-proof','actual native paste target has focus');
    await nativePaste790(p,route,record);
    try { await until(async()=>await p.evaluate(pasted790)===want,'native paste equals exact prompt'); }
    catch(error) { if(!control)throw error;record.boundedPasteWaitExpired=true; }
  } finally {
    const value=await p.evaluate(pasted790);
    record.pasted=digest790(value);record.exact=value===want;
    record.events=await p.evaluate(phases790);record.focusAfter=await p.evaluate(focused790);record.complete=true;
  }
  return record;
}
export function assertPaste790(record) {
  assert.ok(record.readback?.ok&&record.readback.exact&&record.exact,'actual native clipboard paste equals exact current prompt (safe hashes in observation)');
  assert.ok(record.events.some(e=>e.type==='paste'&&e.trusted)&&record.events.some(e=>e.type==='input'&&e.trusted&&e.inputType==='insertFromPaste'),'trusted native paste and insertFromPaste input phases observed');
}
