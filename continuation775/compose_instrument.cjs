// Preparation only: emit the explicit harness delta; never execute the harness.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const acorn={};new Function('exports','module',process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acorn,{exports:acorn});
const [source,target,deadlineModule]=process.argv.slice(2);
let src=fs.readFileSync(source,'utf8');
const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'});
const edits=[];
for(const n of ast.body){
 if(n.type==='FunctionDeclaration' && n.id.name==='check'){
  // Keep original action, native gestures, assertions and complete ending body.
  edits.push({start:n.start,end:n.start+'async function check'.length,text:'async function originalCheck775'});
 }
 if(n.type==='TryStatement'){
  let body=src.slice(n.start,n.end);
  assert.ok(body.includes('await seed();') && body.includes('try { await phase(); } finally { await browser.close(); browserClosed = true; }'));
  body=body.replace('await seed();',"await bounded775.guard({stage:'seed'}, group775.seed_seconds, () => seed());");
  body=body.replace('if (before) await before();',"if (phase.name !== group775.phase) continue;\n    activePhase775 = phase.name;\n    if (phase.name === 'runSending') { const prerequisite = PHASES.find(([p]) => p.name === 'runAnswering')?.[1]; if (prerequisite) await bounded775.guard({stage:'inherited-answering-coordinator'}, group775.seed_seconds, prerequisite); }\n    if (before) await bounded775.guard({stage:'phase-before'}, group775.seed_seconds, before);");
  body=body.replace('for (engine of ENGINES) {',"for (engine of ENGINES) {\n      if (engine !== group775.engine) continue;");
  body=body.replace("browser = engine === 'chromium' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });", "browser = await bounded775.guard({stage:'launch'}, group775.launch_seconds, () => engine === 'chromium' ? playwright.chromium.launch({ executablePath: chrome, headless: true }) : playwright.webkit.launch({ headless: true })); runtime775.push({engine,version:browser.version(),node:process.version,platform:process.platform,arch:process.arch});");
  body=body.replace('try { await phase(); } finally { await browser.close(); browserClosed = true; }', "try { await bounded775.guard({stage:'phase-setup-and-cases'}, group775.phase_seconds, () => phase()); } finally { await bounded775.guard({stage:'browser-close'}, group775.final_seconds, () => browser.close()); browserClosed = true; }");
  assert.ok(body.includes('completedPhases.push(`${phase.name}:${engine}`);') && body.includes('browserClosed, harnessCompleted, plannedPhases, completedPhases,'), 'unknown phase/report shape');
  body=body.replace('completedPhases.push(`${phase.name}:${engine}`);', 'completedPhases.push(`${phase.name}:${engine}/group:${group775.id}`);');
  body=body.replace('harnessCompleted = true;', 'bounded775.finish();\n  harnessCompleted = true;');
  body=body.replace('await Promise.all([fixtureExit, shortExit])', "await bounded775.guard({stage:'fixture-exit'}, group775.final_seconds, () => Promise.all([fixtureExit, shortExit]))");
  body=body.replace('browserClosed, harnessCompleted, plannedPhases, completedPhases,', 'browserClosed, harnessCompleted: false, scope775: { runtime: runtime775, group: group775.id, source: group775.source, cases_sha256: group775.cases_sha256, completedCases: bounded775.completed.slice(), groupCompleted: harnessCompleted, originalWholeCompleted: false }, originalPlannedPhases: originalPlannedPhases775, plannedPhases, completedPhases,');
  edits.push({start:n.start,end:n.end,text:body});
 }
 if(n.type==='VariableDeclaration' && n.declarations[0].id.name==='plannedPhases'){
  const old=src.slice(n.start,n.end);
  edits.push({start:n.start,end:n.end,text:old.replace('const plannedPhases = PHASES.flatMap', 'const originalPlannedPhases775 = PHASES.flatMap').replace(', completedPhases = [];', ";\nconst plannedPhases = [group775.phase + ':' + group775.engine + '/group:' + group775.id], completedPhases = [];" )});
 }
}
assert.equal(edits.length,3,'unknown compose source shape');
const at=src.indexOf('let browserClosed = true, harnessCompleted = false;');assert.ok(at>0);
// Initialized before all seeds and phases; closures read actual owned resources.
const injected=`
let activePhase775;
const group775 = JSON.parse(readFileSync775(process.env.AIM_COMPOSE_GROUP, 'utf8'));
const runtime775 = [];
const selected775 = new Set(group775.cases.map(r=>r.name));
const bounded775 = new ComposeDeadline775({group:group775,evidence,
 snapshot:()=>({results:results.slice(),browserClosed,harnessCompleted:false,groupCompleted775:harnessCompleted,completedPhases:completedPhases.slice()}),
 retire:async()=>{
   fixture.stdin.end(); shortFixture.stdin.end();
   const closed=browser ? await browser.close().then(()=>true,()=>false) : true;
   const exits=await Promise.all([fixtureExit,shortExit]);
   return {browserClosed:closed,fixtures:exits};
 }});
async function check(name, action) {
 const full=\`\${engine} \${name}\`;
 if(!selected775.has(full))return;
 const row=group775.cases.find(r=>r.name===full);
 if(row.phase!==activePhase775 || row.engine!==engine)throw Error('compose phase/engine differs');
 await bounded775.check(row,()=>originalCheck775(name,action));
}
`;
// group775 must exist before plannedPhases initialization.
const before=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='plannedPhases').start;
edits.push({start:before,end:before,text:injected});
for(const e of edits.sort((a,b)=>b.start-a.start))src=src.slice(0,e.start)+e.text+src.slice(e.end);
src="import {readFileSync as readFileSync775} from 'node:fs';\nimport {ComposeDeadline as ComposeDeadline775} from "+JSON.stringify(deadlineModule)+";\n"+src;
// Original substring filter MUST be empty, including helper-level filtering.
src=src.replace("const [chrome, evidence, filter = ''] = process.argv.slice(2);", "const [chrome, evidence] = process.argv.slice(2);\nconst filter = ''; // exact selection is inside check; all helper setup retained");
fs.writeFileSync(target,src);
