import { coverSheet } from './dossier-cover.mjs';
import { drawPassages } from './message-format.mjs';
import { NotebookPage } from './notebook-page.mjs';

localStorage.setItem('920-parent', 'private');
const html = `<style>body{margin:0}#tall{height:1800px}</style>
<button id="run">Run</button><output id="result">before</output>
<button id="rtc">Try WebRTC</button><output id="rtc-error"></output>
<a id="outside" href="https://example.invalid/920">Open outside</a><div id="facts"></div><div id="tall">Tall</div>
<script>
const facts = {};
for (const [name,read] of Object.entries({parent:()=>top.document.getElementById('private').textContent,
  cookie:()=>document.cookie, storage:()=>localStorage.getItem('920-parent')})) {
  try { facts[name]=read(); } catch(error) { facts[name]=error.name; }
}
document.getElementById('facts').textContent=JSON.stringify(facts);
document.getElementById('run').onclick=()=>document.getElementById('result').textContent='script worked';
document.getElementById('rtc').onclick=()=>{
  try{new RTCPeerConnection();document.getElementById('rtc-error').textContent='unexpectedly available';}
  catch(error){document.getElementById('rtc-error').textContent=error.message;}
};
window.tryNetwork=async origin=>{
  const result={};
  try { await fetch(origin+'/920-fetch');result.fetch='allowed'; } catch(error){result.fetch=error.name;}
  try { const ws=new WebSocket(origin.replace('http','ws')+'/920-websocket');ws.close();result.websocket='constructed'; } catch(error){result.websocket=error.name;}
  const img=new Image();img.src=origin+'/920-image';document.body.append(img);
  const script=document.createElement('script');script.src=origin+'/920-script';document.body.append(script);
  return result;
};
window.tryWebRTC=()=>new Promise(resolve=>{
  let peer, observer, timer, settled=false, initialized=false, enforced=false;
  const result={candidates:[],reports:[],error:null,timeout:false};
  const finish=()=>{
    if(settled)return;settled=true;clearTimeout(timer);observer?.disconnect();peer?.close();resolve(result);
  };
  const check=()=>{if(enforced && initialized)finish();};
  timer=setTimeout(()=>{result.timeout=true;finish();},4000);
  observer=new ReportingObserver(reports=>{
    result.reports.push(...reports.map(report=>report.toJSON()));
    if(reports.some(report=>report.type==='connection-allowlist' && report.body.connection==='webrtc' &&
      report.body.disposition==='enforce' && report.body.allowlist.length===0))enforced=true;
    check();
  },{types:['connection-allowlist']});observer.observe();
  try{
    peer=new RTCPeerConnection({iceServers:[{urls:'stun:192.0.2.1:9'}]});
    peer.onicecandidate=event=>{if(event.candidate){result.candidates.push(event.candidate.candidate);finish();}};
    peer.createDataChannel('inner-isolation');
    peer.createOffer().then(offer=>peer.setLocalDescription(offer)).then(()=>{
      initialized=true;check();
    },error=>{result.error=error.name;initialized=true;check();});
  }catch(error){result.error=error.name;initialized=true;check();}
});
<\/script>`;
export const raw = 'Before **literal**\n\n```html\n' + html + '\n```\n\nAfter <literal>';
document.getElementById('cover').append(coverSheet(document, { stands: raw, waiting: [] }, { nameOf: x=>x }));
const saved = { instance_id: 'sandbox-920', source_ref: { kind: 'memory', id: 'sandbox-page', revision: 1 },
  owner_scope: { kind: 'workspace', id: 'sandbox-outcome' }, title: 'Sandbox', body: raw, attachments: [], references: [], reader_may_write: true };
const api = { view: async name => {
  if (name !== 'memory_current') throw Error('Unexpected scratch view ' + name);
  return structuredClone(saved);
}, command: async () => { throw Error('No scratch write is authorized'); } };
const notebook = new NotebookPage({ host: document.getElementById('notebook'), item: 'sandbox-page', mode: 'cards',
  bootstrap: { instance_id: 'sandbox-920', actor: 'sandbox-person', authority: { authority_id: 'sandbox-authority', authority_epoch: 'sandbox-epoch' } },
  api, read: api.view, send: api.command, place: async () => ({ title: 'Sandbox', href: '/' }), askIn: async () => null,
  header: Object.fromEntries(['eyebrow', 'title', 'description'].map(name => [name, document.createElement('span')])) });
await notebook.load(); window.notebook920 = notebook;
drawPassages(document.getElementById('reader'), raw, document, { notebook: true });
window.raw920 = raw;
window.drawn920 = notebook.writing.value.body;
document.getElementById('parent-alive').onclick=event=>{event.target.textContent='Main page responsive';};
document.body.dataset.ready = 'true';
