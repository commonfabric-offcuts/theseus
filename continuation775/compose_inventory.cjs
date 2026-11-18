// Browser-free source enumeration. All executable dependencies are confined to
// vm modules; filesystem writes, process spawning, network and browser APIs are absent.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const url = require('node:url');
const assert = require('node:assert/strict');
const acorn = {};
new Function('exports', 'module', process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn, {exports:acorn});
const ref = process.argv[2], output = process.argv[3];
assert.match(ref, /^(input-train49|input-train50|input-train51|HEAD|[0-9a-f]{40})$/);
const root='/enumeration';
const hashes={}, transforms=[], setup=[], rows=[];
const git=(rev,p)=>cp.execFileSync('git',['show',rev+':'+p]);
const read = (p,encoding) => {
  p=p instanceof URL ? url.fileURLToPath(p) : p;
  assert.ok(p.startsWith(root+'/'), 'source read outside virtual root: '+p);
  p=p.slice(root.length+1);
  const b=git(ref,p); hashes[p]=crypto.createHash('sha256').update(b).digest('hex');
  return encoding ? b.toString(encoding) : b;
};
const context=vm.createContext({ Buffer, URL, console: {log(){}}, __record: (phase,engine,name)=>{
  assert.equal(typeof name,'string'); rows.push({phase,engine,name:`${engine} ${name}`});
}, __setup: x=>setup.push(x), process: {argv:['node','harness','/never-chrome','/evidence',''],env:{AIM_PLAYWRIGHT_CORE:'/never-playwright'}} });
const modules=new Map();
const fakeControl=async x=>{setup.push(x);return {status:'committed',agent:'fake-agent',actor:'fake-actor',origin:'http://enumeration.invalid',instance_id:'enumeration',result:{message_id:'fake-message'}}};
function synthetic(id, values){return new vm.SyntheticModule(Object.keys(values), function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)}, {context,identifier:id})}
const builtins={
 'node:assert/strict':{default:assert}, 'node:path':{default:path},
 'node:url':{fileURLToPath:url.fileURLToPath}, 'node:crypto':{createHash:crypto.createHash},
 'node:fs/promises':{readFile:async(p,e)=>read(p,e),mkdir:async()=>{},writeFile:async()=>{},appendFile:async()=>{}},
 'node:child_process':{spawn:()=>{throw Error('enumeration forbids spawn')}, execFileSync:(cmd,args)=>{
   assert.equal(cmd,'git'); assert.equal(args.length,2); if(args[0]==='rev-parse' && args[1]==='HEAD')return cp.execFileSync('git',['rev-parse',ref]).toString(); assert.equal(args[0],'show');
   const m=args[1].match(/^([0-9a-f^]+):([a-zA-Z0-9_./-]+)$/); assert.ok(m); return git(m[1],m[2]);
 }},
 'node:module':{createRequire:()=>()=>{throw Error('enumeration forbids playwright load')}}
};
function edits(src,changes){for(const c of changes.sort((a,b)=>b.start-a.start)){transforms.push({start:c.start,end:c.end,reason:c.reason});src=src.slice(0,c.start)+c.text+src.slice(c.end)}return src}
async function load(id){
 if(modules.has(id)) return modules.get(id);
 if(builtins[id]){const m=synthetic(id,builtins[id]);modules.set(id,m);return m}
 if(id===root+'/tests/fixture_control.mjs'){
   const m=synthetic(id,{fixtureControl:()=>({control:fakeControl,exit:Promise.resolve({code:0,signal:null}),errors:()=>''})}); modules.set(id,m);return m;
 }
 let src=read(id,'utf8');
 if(id===root+'/tests/reader_compose_native.mjs'){
   const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'}), changes=[];
   for(const n of ast.body){
     if(n.type==='VariableDeclaration'){
       const name=n.declarations[0].id.name;
       if(name==='playwright')changes.push({...n,text:'const playwright = null;',reason:'no browser dependency'});
       if(name==='world')changes.push({...n,text:'const world = () => ({stdin:{end(){}},exitCode:null,signalCode:null});',reason:'no fixture process'});
     }
     if(n.type==='FunctionDeclaration' && n.id.name==='check')changes.push({...n,text:'async function check(name, action) { __record(activePhase, engine, name); }',reason:'record names, never invoke action'});
     if(n.type==='TryStatement')changes.push({start:n.start,end:src.length,text:`let activePhase;
await seed();
for (const [phase, before] of PHASES) {
 activePhase=phase.name;
 if (before) await before();
 for (engine of ENGINES) await phase();
}`,reason:'enumerate loops only; no launch, close or pass assertion'});
   }
   assert.equal(changes.length,4); src=edits(src,changes);
 }
 const m=new vm.SourceTextModule(src,{context,identifier:id,initializeImportMeta(meta){meta.url=url.pathToFileURL(id).href}});
 modules.set(id,m);
 await m.link((spec,parent)=>load(spec.startsWith('.')?path.resolve(path.dirname(parent.identifier),spec):spec));
 return m;
}
(async()=>{const m=await load(root+'/tests/reader_compose_native.mjs'); await m.evaluate({timeout:30000});
 const keys=rows.map(x=>JSON.stringify([x.phase,x.engine,x.name]));assert.equal(new Set(keys).size,keys.length,'duplicate identity');
 fs.writeFileSync(output,JSON.stringify({parser:{node:process.version,acorn:acorn.version},kind:'enumeration-only-no-native-execution',ref,rows,hashes,transforms,setup},null,2)+'\n');console.log(JSON.stringify({ref,cases:rows.length,phases:Object.fromEntries([...new Set(rows.map(x=>x.phase+':'+x.engine))].map(p=>[p,rows.filter(x=>x.phase+':'+x.engine===p).length]))}));
})().catch(e=>{console.error(e);process.exitCode=1});
