// Registration only. Actions are retained, never invoked here; native output
// must independently supply every executed normal, mutation and restored name.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { PENCIL_STATES, PENCIL_LATE_IMAGES } from './pencil-states.mjs';
import { selectedNativeCase, pencilPartition } from './pencil-selection.mjs';
export async function pencilInventory(native, filter = 'item 673') {
  const body = native.slice(native.indexOf('async function runPencil()'), native.indexOf('// Break one production rule'));
  const names = [];
  await vm.runInNewContext(body + '\nrunPencil()', {
    PENCIL_SHAPES: ['phone-320','phone-375','phone-390','laptop-stacked'],
    PENCIL_STATES, PENCIL_LATE_IMAGES, check: async name => names.push(name),
  });
  assert.equal(names.length, 1184); assert.equal(new Set(names).size, names.length);
  const runner = native.slice(native.indexOf('async function runPencilMutants()'));
  const rules = vm.runInNewContext(runner.slice(runner.indexOf('  const rules = '), runner.indexOf('  for (const rule of rules)')) + '\nrules');
  const cases = [];
  for (const engine of ['chromium','webkit']) {
    for (const name of names) if (selectedNativeCase(filter, engine, name, `${engine} ${name}`)) cases.push({engine, phase:'normal', name:`${engine} ${name}`});
    for (const rule of rules) for (const name of names.filter(name => name.includes(rule.case) && name.includes(' light:') && (name.includes('phone-320') || (rule.name !== 'overlapping-image-remove' && name.includes('laptop-stacked'))))) {
      if (!selectedNativeCase(filter, engine, name, `${engine} ${name}`)) continue;
      for (const phase of ['mutant','restored']) cases.push({engine, phase, mutation:rule.name, file:rule.file, name:`${engine} item 673 ${phase} ${rule.name}: ${name}`});
    }
  }
  return {registrationOnly:true, partition:pencilPartition(filter), selector:filter, names, rules, cases};
}
