import assert from 'node:assert/strict';

// One separately selected Chromium cell; all setup uses the existing isolated
// fixture's real commands. No live actor, browser profile or record is used.
export async function movedDossiers1170Checks({ check, until, view, control, shot, engine }, { seed, open, centre, press, into }) {
  if (engine !== 'chrome') return;
  await check('reading 1170 moved dossiers take2 groups, preserves writing, and opens topic or dossier at desktop and phone', async () => {
    const started = Date.now();
    // Checked between bounded I/O; no abandoned Promise races the owned cleanup.
    const withinBudget = () => assert.ok(Date.now() - started <= 180000, '1170 action budget: 180 seconds between bounded operations');
    const origin = 'moved-1170-origin', first = 'moved-1170-first', second = 'moved-1170-second';
    const source = await seed(origin, [['stays', { sender: 'person', body: 'Unmoved fixture message' }]]);
    await control({ method: 'navigation_topics', topics: [{ id: first, title: 'First fixture destination' }, { id: second, title: 'Second fixture destination' }] });
    const roots = [];
    for (let index = 0; index < 7; index++) {
      withinBudget();
      const posted = await control({ method: 'agent_message', sender: 'person', topic_id: origin,
        operation_id: `moved-1170-post-${index}`, body: `Synthetic moved dossier ${index}` });
      const root = posted.result.message_id;
      roots.push(root);
      const named = await control({ method: 'stack_act', sender: 'person', kind: 'stack.name', message_id: root,
        operation_id: `moved-1170-name-${index}`, args: { name: `Fixture dossier ${index}` } });
      assert.equal(named.status, 'committed');
      const moved = await control({ method: 'stack_act', sender: 'person', kind: 'stack.move', message_id: root,
        operation_id: `moved-1170-move-${index}`, args: { topic_id: index < 6 ? first : second } });
      assert.equal(moved.status, 'committed');
    }
    const admitted = await view('dossier_moves', { topic_id: origin });
    assert.equal(admitted.items.length, 7);
    assert.ok(admitted.items.every(row => row.actor_id === 'person' && Number.isSafeInteger(row.at_ms)));

    for (const device of ['laptop', 'phone']) for (const theme of ['light', 'dark']) {
      withinBudget();
      const p = await open(`moved-1170-${device}-${theme}`, device, origin, source.stays, '', undefined,
        q => q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
      try {
        const panel = '.moved-dossiers', more = '.moved-dossiers-group:first-of-type .moved-dossiers-more';
        await until(() => p.evaluate(`document.querySelector('.moved-dossiers-total')?.textContent === '7'`), '1170 admitted panel is drawn');
        const before = await p.evaluate(`(()=>{const panel=document.querySelector(${JSON.stringify(panel)});return {
          count:document.querySelectorAll('.moved-dossiers').length,groups:panel.querySelectorAll('.moved-dossiers-group').length,
          names:[...panel.querySelectorAll('.moved-dossiers-name')].map(n=>n.textContent),
          visible:[...panel.querySelectorAll('.moved-dossiers-link')].filter(n=>n.getClientRects().length).length,
          old:document.querySelectorAll('.dossier-moved-pointer').length,more:panel.querySelector('.moved-dossiers-more').textContent}})()`);
        assert.equal(before.count, 1); assert.equal(before.groups, 2); assert.equal(before.visible, 4); assert.equal(before.old, 0);
        assert.deepEqual(before.names, roots.map((_, index) => `Fixture dossier ${index}`));
        assert.equal(before.more, '3 more');
        // A person's unsent writing survives closing its sheet and using the
        // panel. It is cleared by native input before testing departure.
        await centre(p, '#new-message'); await press(p, device, '#new-message');
        await into(p, device, '#inline-writing-body');
        const writing = `Kept fixture writing ${device} ${theme}`;
        await p.send('Input.insertText', { text: writing });
        await centre(p, '#new-message-close'); await press(p, device, '#new-message-close');
        await centre(p, more);
        if (device === 'laptop') {
          let reached = false;
          for (let n = 0; n < 80; n++) {
            withinBudget();
            await p.key('Tab');
            if (await p.evaluate(`document.activeElement?.matches(${JSON.stringify(more)})`)) { reached = true; break; }
          }
          assert.equal(reached, true, 'the native Tab path reaches N more within 80 keys');
          await p.key('Enter');
        } else await press(p, device, more);
        await until(() => p.evaluate(`document.querySelectorAll('.moved-dossiers-link:not([hidden])').length === 7 && [...document.querySelectorAll('.moved-dossiers-row')].every(n=>!n.hidden)`), 'all seven rows are expanded');
        assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), writing);
        const geometry = await p.evaluate(`(()=>{const link=document.querySelector('.moved-dossiers-link'),name=link.querySelector('.moved-dossiers-name').getBoundingClientRect(),meta=link.querySelector('.moved-dossiers-meta').getBoundingClientRect(),box=link.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:box.height,nameBottom:name.bottom,metaTop:meta.top,metaRight:meta.right,linkRight:box.right}})()`);
        assert.ok(geometry.scroll <= geometry.width + 1, 'no horizontal page overflow');
        if (device === 'phone') {
          assert.ok(geometry.height >= 44, 'phone dossier link is at least 44px tall');
          assert.ok(geometry.metaTop >= geometry.nameBottom - 1, 'phone metadata is below the name');
        }
        assert.ok(geometry.metaRight <= geometry.linkRight + 1, 'metadata stays inside the row');
        await shot(p, `moved-1170-${device}-${theme}`);
        withinBudget();

        await centre(p, '#new-message'); await press(p, device, '#new-message');
        await into(p, device, '#inline-writing-body'); await p.key('a', 4); await p.key('Backspace');
        await until(() => p.evaluate(`document.querySelector('#inline-writing-body').value === ''`), 'native input clears only this fixture writing');
        await centre(p, '#new-message-close'); await press(p, device, '#new-message-close');
        const destination = '.moved-dossiers-topic';
        await centre(p, destination); await press(p, device, destination);
        await until(() => p.evaluate(`new URL(location.href).searchParams.get('topic') === ${JSON.stringify(first)}`), 'destination chip opens its topic');
        await p.send('Page.navigate', { url: new URL(`/?topic=${origin}`, await p.evaluate('location.href')).href });
        await until(() => p.evaluate(`document.body.dataset.ready === 'true' && document.querySelector('.moved-dossiers-total')?.textContent === '7'`), 'source topic returns');
        const root = `.moved-dossiers-link[data-root-id="${roots[0]}"]`;
        await centre(p, root); await press(p, device, root);
        await until(() => p.evaluate(`new URL(location.href).searchParams.get('topic') === ${JSON.stringify(first)} && new URL(location.href).searchParams.get('message') === ${JSON.stringify(roots[0])}`), 'dossier row opens its root in the destination');
        assert.deepEqual(p.errors, []);
        withinBudget();
      } finally { await p.close(); }
    }
  });
}
