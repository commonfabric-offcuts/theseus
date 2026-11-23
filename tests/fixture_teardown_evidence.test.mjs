import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readingFixtureArgs, readingFixtureReport } from './fixture_teardown_evidence.mjs';

for (const engine of ['chrome', 'webkit']) {
  for (const state of ['restored', 'no-swap', 'cleanup-failed', 'missing', 'truncated', 'malformed', 'incomplete']) {
    test(`${engine}: ${state} retains original body/case/cleanup truth beside fixture evidence`, async t => {
      const folder = await mkdtemp(path.join(os.tmpdir(), 'teardown1089-'));
      t.after(() => rm(folder, { recursive: true, force: true }));
      const report = { mode: '--reading', engine, bodyCompleted: false,
        bodyError: 'Original requesting body failed', teardownError: 'Original browser cleanup failed',
        results: [{ name: 'original failed case', passed: false }], fixtureExitCode: 1,
        fixtureErrors: 'Original fixture stderr\n' };
      const original = structuredClone(report);
      const errors = state === 'cleanup-failed' ? [{ stage: 'http-close', type: 'Error', message: 'actual cleanup failed' }] : [];
      let bytes = JSON.stringify({ event: 'runtime-restored', needed: state !== 'no-swap' }) + '\n'
        + JSON.stringify({ event: 'cleanup-complete', errors }) + '\n';
      if (state === 'truncated') bytes = bytes.slice(0, -1);
      if (state === 'malformed') bytes = 'not json\n';
      if (state === 'incomplete') bytes = JSON.stringify({ event: 'runtime-restored' }) + '\n';
      if (state !== 'missing') await writeFile(path.join(folder, 'fixture-teardown.jsonl'), bytes);
      const augmented = await readingFixtureReport(report, folder);
      const { fixtureTeardown, ...kept } = augmented;
      assert.deepEqual(kept, original);
      assert.deepEqual(report, original, 'the caller body and failures are not mutated');
      assert.deepEqual(readingFixtureArgs('--reading', folder), ['--teardown-observations', path.join(folder, fixtureTeardown.file)]);
      if (state !== 'missing') {
        assert.equal(fixtureTeardown.sha256, createHash('sha256').update(bytes).digest('hex'));
        assert.equal(await readFile(path.join(folder, fixtureTeardown.file), 'utf8'), bytes, 'raw proof remains unchanged');
      }
      if (['restored', 'no-swap'].includes(state)) assert.deepEqual(fixtureTeardown.errors, []);
      else assert.ok(fixtureTeardown.errors.length, 'failure is explicit, never a fabricated clean observation');
    });
  }
}

test('other harness modes keep their report and request-id protocol unchanged', async () => {
  const report = { mode: '--notebook', bodyCompleted: false, bodyError: 'kept' };
  assert.equal(await readingFixtureReport(report, '/unused'), report);
  assert.deepEqual(readingFixtureArgs(report.mode, '/unused'), []);
});
