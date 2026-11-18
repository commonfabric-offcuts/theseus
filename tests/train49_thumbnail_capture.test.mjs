import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const thumb = () => readFileSync(path.join(root, 'tests/thumbnail_open_native.mjs'), 'utf8');
function mutation() {
  const row = thumb().split('\n').find(x => x.includes("name: 'first-touch-intercepted-mutant'"));
  assert.ok(row);
  return vm.runInNewContext(`(${row.trim().replace(/,$/, '')})`);
}
function apply(original, m) {
  // Execute the actual native harness's pre-write refusal and replacement.
  const source = thumb();
  const declaration = source.indexOf('const file = path.join(root, mutation.file)');
  assert.ok(declaration > 0);
  const start = source.indexOf('\n', declaration) + 1;
  const end = source.indexOf('    let failure', start);
  assert.ok(start > 0 && end > start);
  return new Function('assert', 'original', 'mutation', `${source.slice(start, end)} return changed;`)(assert, original, m);
}
function capture(source, target) {
  const begin = source.indexOf("host.addEventListener('click', event => {");
  const end = source.indexOf('    }, true);', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = source.slice(begin + "host.addEventListener('click', event => {".length, end);
  const entry = {}, actions = [];
  const event = { target: { closest: selector => selector.split(',').map(x => x.trim()).includes(target) ? {} : null },
    preventDefault: () => actions.push('prevent'), stopPropagation: () => actions.push('stop') };
  new Function('event', 'cardIn', 'onEarlierRow', body).call({ touch: true, before: null, entryOf: () => entry,
    light: () => actions.push('light') }, event, () => ({ contains: () => false, dataset: { folded: 'false' } }), () => false);
  return actions;
}
test('651 exact current selector refuses stale and duplicate sites before any mutation', () => {
  const original = readFileSync(path.join(root, 'web/message-menu.mjs'), 'utf8'), m = mutation();
  assert.ok(m.from.includes('.cover-refresh-glyph'));
  assert.ok(m.to.includes('.cover-refresh-glyph'), 'only thumbnail exemption is removed');
  assert.throws(() => apply(original.replace(m.from, 'stale-site'), m), /one actual source mutation site/);
  assert.throws(() => apply(original + m.from, m), /one actual source mutation site/);
});
test('651 actual capture mutant intercepts first thumbnail touch, preserves cover glyph and byte-restores', () => {
  const original = readFileSync(path.join(root, 'web/message-menu.mjs'));
  const folder = mkdtempSync(path.join(tmpdir(), 'train49-651-')), file = path.join(folder, 'message-menu.mjs');
  writeFileSync(file, original);
  try {
    assert.deepEqual(capture(original.toString(), '.image-thumb'), []);
    const changed = apply(original.toString(), mutation());
    writeFileSync(file, changed);
    assert.equal(readFileSync(file, 'utf8'), changed);
    assert.notDeepEqual(readFileSync(file), original);
    assert.throws(() => assert.deepEqual(capture(readFileSync(file, 'utf8'), '.image-thumb'), [], 'thumbnail capture must allow activation'), /thumbnail capture must allow activation/);
    assert.deepEqual(capture(changed, '.image-thumb'), ['light', 'prevent', 'stop']);
    assert.deepEqual(capture(changed, '.cover-refresh-glyph'), []);
  } finally { writeFileSync(file, original); }
  try {
    assert.deepEqual(readFileSync(file), original);
    assert.deepEqual(capture(readFileSync(file, 'utf8'), '.image-thumb'), []);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    console.log(JSON.stringify({ contract: '651-actual-capture-copy', original: hash(original), applied: hash(apply(original.toString(), mutation())), restored: hash(readFileSync(file)), caught: true, native: false }));
  } finally { unlinkSync(file); rmdirSync(folder); }
});
