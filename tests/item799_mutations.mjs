// Actual product source mutations, serial; byte-exact restore in finally.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const destination = process.argv[2];
assert.ok(destination); mkdirSync(destination, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mutants = [
  ['More-reorders', 'web/reply-stacks.mjs', 'const paged = loaded.filter(item => !state.sourceRoots.has(item.id) || !dossiers.has(item.id));', 'const paged = loaded.filter(item => !item.dossierSource);'],
  ['default-head', 'web/stack-order.mjs', 'return { ...stack, id: root.id, head: root, replies: [stack.head, ...stack.replies],', 'return { ...stack, id: stack.id, head: stack.head, replies: stack.replies,'],
  ['private-head', 'web/stack-order.mjs', "item?.withheld ? { state: 'refused' }", "false ? { state: 'refused' }"],
  ['stale-answer', 'web/stack-order.mjs', "if (!this.current() || this.records.get(id) !== record) return;", "if (!this.current()) return; this.records.set(id, record);"],
  ['false-frontier', 'web/reply-stacks.mjs', "if (!item.dossierSource) { known.add(item.id); below = Math.min(below, item.seq); }", "{ known.add(item.id); below = Math.min(below, item.seq); }"],
];
const results = [];
for (const [label, file, from, to] of mutants) {
  const original = readFileSync(file), text = original.toString();
  assert.ok(text.includes(from), label + ' exact mutation target exists');
  try {
    writeFileSync(file, text.replace(from, to));
    assert.notEqual(hash(readFileSync(file)), hash(original), label + ' mutation applied');
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/ui_dossier_heads_799.test.mjs', 'tests/ui_dossier_renderer_799.test.mjs'], { encoding: 'utf8' });
    writeFileSync(`${destination}/${label}-red.txt`, run.stdout + run.stderr);
    assert.equal(run.status, 1, label + ' must be caught by a real failing assertion');
    assert.match(run.stdout + run.stderr, /AssertionError|assertion|Expected/, label + ' fails semantically');
    results.push({ label, file, original_sha256: hash(original), mutant_sha256: hash(readFileSync(file)), red_exit: run.status });
  } finally {
    writeFileSync(file, original);
    assert.deepEqual(readFileSync(file), original, label + ' restored byte exactly');
  }
  const control = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/ui_dossier_heads_799.test.mjs', 'tests/ui_dossier_renderer_799.test.mjs'], { encoding: 'utf8' });
  writeFileSync(`${destination}/${label}-restored.txt`, control.stdout + control.stderr);
  assert.equal(control.status, 0, label + ' restored control passes');
  results.at(-1).restored_exit = control.status;
}
writeFileSync(`${destination}/mutations.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
