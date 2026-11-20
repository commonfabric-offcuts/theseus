import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');

test('867 the actual full-page route loads before picking the card and forces Cards over Text preference',async()=>{
 const start=app.indexOf('async function initializeDeckPage(route) {');
 // Stop at the next named initializer, rather than duplicating route code.
 const body=app.slice(start,app.indexOf('\n// An outcome\'s Measurements',start));assert.ok(body.trimEnd().endsWith('}'));
 const calls=[],nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{prepend(){},dataset:{}});return nodes.get(id);};
 const document={querySelector:()=>$('rail'),body:$('body')};let options;
 class NotebookPage{constructor(opts){options=opts;this.base=null;}async load(){calls.push('load');this.base={body:'words'};}pickCardId(id){assert.ok(this.base);calls.push(['pick',id]);}}
 const fn=new Function('NotebookPage','$','document','status','drawFeed','placeBrand','pipelineView','pipelineSend','notebookAskIn','api','bootstrap','notebookViewsOf','shell','followCommits',body+'; return initializeDeckPage;');
 const open=fn(NotebookPage,$,document,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},{},{},()=>({get:()=> 'text'}),{guard(){}},fn=>fn);
 await open({kind:'cards',id:'page',card:'c-11111111111111111111111111111111'});
 assert.equal(options.mode,'cards');assert.deepEqual(calls,['load',['pick','c-11111111111111111111111111111111']]);assert.equal(document.body.dataset.ready,'true');
 calls.length=0;await open({kind:'cards',id:'page',view:'text'});assert.equal(options.mode,'text');assert.deepEqual(calls,['load']);
});
test('867 phone source always exposes the card overflow; pointer and picked states expose it on desktop',()=>{
 const phone=css.slice(css.indexOf('@media(max-width:760px){.deck-page'),css.indexOf('\n',css.indexOf('@media(max-width:760px){.deck-page')));
 assert.match(phone,/\.deck-menu\{opacity:1;pointer-events:auto\}/);
 assert.match(css,/:where\(\.deck-pointing\) \.deck-card:hover \.deck-menu,\.deck-card\[aria-current=true\] \.deck-menu,\.deck-menu:focus\{opacity:1;pointer-events:auto\}/);
 assert.match(css,/\.deck-card>\.deck-title\{padding-right:7\.3rem\}/);
});
test('867 card tint uses the existing palette background and readable quiet ink in both themes',()=>{
 const light=css.slice(0,css.indexOf('@media(prefers-color-scheme:dark){.agent-'));
 const dark=css.slice(css.indexOf('@media(prefers-color-scheme:dark){.agent-'));
 assert.match(light,/\.deck-card\.deck-tinted\{--muted:#56616a;\}/);
 assert.match(dark,/\.deck-card\.deck-tinted\{--muted:#9aaba8;--accent:#79c7ab;\}/);
 assert.match(css,/\.deck-card\.deck-tinted\{background:var\(--agent-card\)\}/);
 assert.match(css,/\.deck-card\.deck-tinted\[aria-current=true\]\{background:var\(--agent-hover\)\}/);
});
