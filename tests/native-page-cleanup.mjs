import assert from 'node:assert/strict';

// Keep action, page and cleanup failures independently legible in native.json.
const rethrow = errors => {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, errors.map(e => e.stack ?? String(e)).join('\n'));
};
export async function withPageCleanup(p, action) {
  const failures = [];
  try { await action(); } catch (error) { failures.push(error); }
  // Capture before close even if settlement or target close subsequently fails.
  try { assert.deepEqual([...p.errors], [], 'independent page errors before cleanup'); } catch (error) { failures.push(error); }
  try { await p.close(); } catch (error) { failures.push(error); }
  try { assert.deepEqual([...p.errors], [], 'independent page errors after cleanup'); } catch (error) { failures.push(error); }
  rethrow(failures);
}
export async function closeNativePage({ settle, close, forget }) {
  const failures = [];
  try { await settle(); } catch (error) { failures.push(error); }
  try { await close(); } catch (error) { failures.push(error); }
  finally { forget(); }
  rethrow(failures);
}

// Wait for owned handlers AND commands, then classify every refused pause.
// A timeout still fails; its evidence survives deletion of the page listener.
export async function settlePageReleases(p, until, record) {
  try {
    await until(() => p.releaseHandlers.size === 0 && p.pendingReleases.size === 0 && p.unsettledReleases.size === 0,
      'every refused interception release settled');
    assert.deepEqual(p.failedReleases, [], 'every interception release the page did not give up succeeded');
  } finally {
    record({name:'interception release settlement',pendingHandlers:p.releaseHandlers.size,
      pendingCommands:p.pendingReleases.size,unsettled:[...p.unsettledReleases.values()],
      failed:[...p.failedReleases],excused:[...p.excusedReleases],pageErrors:[...p.errors]});
    if (p.excusedReleases.length) record({name:'releases refused because the page gave its request up',releases:[...p.excusedReleases]});
  }
}
