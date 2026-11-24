import assert from 'node:assert/strict';

// One separately selected Chromium cell. This owns no browser/fixture lifecycle;
// the reading harness retains its isolated context and verified teardown.
export async function messageChanges1169({ check, until, control, shot }, helpers) {
  const { seed, open, press, openReader, closeReader, card, words } = helpers;
  await check('reading 1169 added words and hide show changes across dossier card and Reader', async () => {
    const topic = 'changes-1169-native', old = 'The rate is 0.4%, ready today.', latest = 'The rate is 0.3%, ready today.';
    const ids = await seed(topic, [
      ['root', { sender: 'aim-core', join: true, body: old, read: true }],
      ['reply', { sender: 'person', reply_to: 'root', body: 'Keeping this numeric correction together.' }],
    ]);
    const edit = await control({ method: 'agent_edit', operation_id: topic + '-edit', sender: 'aim-core', message_id: ids.root, body: latest });
    assert.equal(edit.status, 'committed');
    const p = await open(topic, 'phone', topic, ids.root, 'window.holdReads = true');
    try {
      const root = card(ids.root), preview = words(ids.root), toggle = root + ' .message-changes-toggle';
      const expose = async () => {
        const folded = await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(root + ' .stack-who')})?.getClientRects().length)`);
        if (folded) await press(p, 'phone', root + ' .stack-who');
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(toggle)})?.getClientRects().length)`), '1169 dossier byline is visible');
      };
      const marks = selector => p.evaluate(`(h=>({added:[...h.querySelectorAll('ins.added-words')].map(n=>{const c=n.cloneNode(true);c.querySelectorAll('.sr-only').forEach(s=>s.remove());return c.textContent}),removed:[...h.querySelectorAll('del.struck-words')].map(n=>{const c=n.cloneNode(true);c.querySelectorAll('.sr-only').forEach(s=>s.remove());return c.textContent})}))(document.querySelector(${JSON.stringify(selector)}))`);
      await expose();
      assert.deepEqual(await marks(preview), { added: ['0.3%'], removed: ['0.4%'] });
      assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(root)}).closest('.reply-stack') !== null`), 'actual dossier card');
      for (const scheme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(preview + ' ins')})).textDecorationLine.includes('underline')`), true);
        await shot(p, '1169-dossier-' + scheme);
      }
      await press(p, 'phone', toggle);
      assert.deepEqual(await marks(preview), { added: [], removed: [] });
      assert.equal(await p.evaluate(`document.querySelector('#reader').open`), false, 'switch did not activate enclosing card');
      await openReader(p, 'phone', ids.root, 'The rate');
      assert.deepEqual(await marks('#source-body'), { added: [], removed: [] });
      await press(p, 'phone', '#reader-origin .message-changes-toggle');
      assert.deepEqual(await marks('#source-body'), { added: ['0.3%'], removed: ['0.4%'] });
      // Focus then a real keyboard Return; no handler invocation substitutes for it.
      await p.evaluate(`document.querySelector('#reader-origin .message-changes-toggle').focus()`);
      await p.key('Enter');
      assert.deepEqual(await marks('#source-body'), { added: [], removed: [] });
      assert.equal(await p.evaluate(`document.activeElement.classList.contains('message-changes-toggle')`), true);
      await closeReader(p, 'phone');
      await p.send('Page.reload'); await expose();
      assert.deepEqual(await marks(preview), { added: [], removed: [] }, 'device-local hide survives reload');
      const next = await control({ method: 'agent_edit', operation_id: topic + '-edit-3', sender: 'aim-core', message_id: ids.root, revision: 2, body: 'The rate is 0.2%, ready today.' });
      assert.equal(next.status, 'committed');
      await until(async () => (await marks(preview)).added.includes('0.2%'), 'next revision defaults to shown');
      assert.equal(await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}
