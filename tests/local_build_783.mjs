// Execute actual complete-Build renderer code, then the shared native oracle/comparator.
// CSS values below are a declaration model, never measured browser geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rendererFixture783,checkRenderers783 } from './cover_783_renderers.mjs';
import { WORDS783 } from './cover_783_oracle.mjs';
import { assertBuild783 } from './cover_783_comparator.mjs';
const [folder,phase]=process.argv.slice(2);
const subject=await import(pathToFileURL(path.join(folder,'reply-stacks.mjs')));
const {Reader}=await import(pathToFileURL(path.join(folder,'reader.mjs')));
const css=fs.readFileSync(path.join(folder,'stack-look.css'),'utf8');
const rule=css.match(/\.reply-stack>\.dossier-cover\{([^}]+)\}/)?.[1];assert.ok(rule,'actual cover rule');
const property=name=>rule.match(new RegExp('(?:^|;)'+name+':([^;]+)'))?.[1];
const variables=name=>[...css.matchAll(new RegExp('--'+name+':([^;}]+)','g'))].map(x=>x[1]);
const cover={stands:WORDS783.stands,waiting:[{text:WORDS783.wait,default:WORDS783.default}],payload:{text:WORDS783.payload,seq:2,message_id:'a',kind:'answer'},owner:'person'};
const rows=[{id:'r',topic_id:'t',seq:1,body:'Root',author_id:'person',acts:{cover}},{id:'a',topic_id:'t',seq:2,body:'Answer',author_id:'agent',reply_to:'r',acts:{}}];
const f=rendererFixture783(rows,'person',subject.arrangeStacks,subject.stackState,Reader);const drawn=checkRenderers783(f,'r',cover);
for(const theme of ['light','dark']) {
  const values=variables('stack-cover-inset');
  let shadow=property('box-shadow');
  if(shadow==='var(--stack-cover-inset)')shadow=values[theme==='light'?0:1];
  else if(shadow?.startsWith('var('))shadow='none'; // old contact fallback; original fails earlier at first-child
  shadow=shadow.replace(/(^|\s)0(?=\s|,|$)/g,'$10px');
  const at={...drawn,visible:true,background:property('background'),folderBackground:'var(--stack-folder)',shadow,
    cover:{top:60,bottom:150,left:8,right:300,width:292,height:90},tab:{bottom:60},folder:{left:0,right:310},faces:[{top:151}],overflow:0};
  console.log(JSON.stringify({phase,theme,model:'actual renderer DOM + source CSS declarations; geometry model only',at,comparison:assertBuild783(at,phase)}));
}
