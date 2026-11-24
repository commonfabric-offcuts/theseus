import assert from 'node:assert/strict';

// One selected Chromium cell, real pointer/Tab/key events and scratch Core.
// Laptop1280/light only; this is not physical-device, WebKit or phone proof.
export async function notebookPageTitle1159Checks({ check, page, until, control, view, facts, shot }) {
  await check('notebook 1159 page title activation and save focus preserve Text Cards and empty writing', async () => {
    const populated = 'Opening stays.\n\n## First\n\nFirst words\n\n## Last\n\nLast words\n';
    for (const surface of ['sheet', 'full']) for (const mode of ['cards', 'text'])
      for (const [kind, body] of [['cards', populated], ['empty', ''], ['opening', 'Exact opening words.\n\n']]) {
        const id = `nb1159-${surface}-${mode}-${kind}`, initial = `Title ${surface} ${mode} ${kind}`;
        assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: initial, body })).status, 'committed');
        const root = surface === 'sheet' ? '#notebook-sheet-dialog' : '#deck-page';
        const title = surface === 'sheet' ? '#notebook-sheet-dialog .notebook-title-edit' : '#topic-title .notebook-title-edit';
        const input = surface === 'sheet' ? '#notebook-sheet-dialog .notebook-rename' : '#topic-title .notebook-rename';
        const more = root + ' .notebook-menu', text = root + ' .notebook-text', cards = root + ' .deck-writing textarea';
        const url = facts.origin + (surface === 'sheet' ? `/?topic=t1&page=${id}` : `/?cards=${id}&view=${mode}`);
        let p;
        try {
          p = await page(id, null, true, { url, beforeNavigate: async q => {
            await q.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
            await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
          } });
          await until(() => p.evaluate(`document.body.dataset.ready==='true'&&document.querySelector(${JSON.stringify(title)})?.getClientRects().length`), '1159 current page title is drawn');
          if (surface === 'sheet' && mode === 'text') {
            await p.point(more);
            const selector = '.message-menu-list>button';
            const index = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].findIndex(b=>b.textContent.trim()==='Show as text')`);
            assert.ok(index >= 0); await p.point(selector + `:nth-child(${index + 1})`);
          }
          const current = () => view('memory_current', { item_id: id });
          const viewChoice = () => p.evaluate("JSON.stringify(Object.entries(localStorage).filter(([key])=>key.startsWith('aim-next.notebook-view.')).sort())");
          const rememberedBefore = await viewChoice();
          for (const [i, key, modifiers] of [[0, 'Escape', 0], [1, 'Enter', 0], [2, 'Enter', 4]]) {
            if (i === 0) await p.point(title);
            else if (i === 1) {
              const b = await p.box(title), x = b.x + b.width / 2, y = b.y + b.height / 2;
              await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
              await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
            } else {
              // Native menu close restores its real button, then native
              // Shift-Tab reaches the title. No evaluate().focus surrogate.
              await p.point(more); await p.key('Escape');
              let reached = false;
              for (let step = 0; step < 40 && !reached; step++) {
                await p.key('Tab', 8);
                reached = await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(title)})`);
              }
              assert.equal(reached, true, 'title is in native Tab order'); await p.key(' ');
            }
            await until(() => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(input)});return f&&!f.hidden&&document.activeElement===f})()`), '1159 title activation focuses the inline input');
            const renamed = `${initial} saved ${i}`;
            await p.key('a', 4); await p.send('Input.insertText', { text: renamed }); await p.key(key, modifiers);
            const destination = mode === 'text' ? text : cards;
            const offset = mode === 'text' && kind === 'cards' ? populated.indexOf('First') : 0;
            await until(() => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(destination)});return f&&document.activeElement===f&&f.selectionStart===${offset}&&f.selectionEnd===${offset}})()`), '1159 completion enters the existing writing destination');
            assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(root)})!==null`), true, 'Escape did not close the Notebook sheet');
            await until(async () => (await current()).title === renamed, '1159 exact title reaches scratch Core');
            const saved = await current(); assert.equal(saved.title, renamed); assert.equal(saved.body, body);
            if (mode === 'text') assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(text)}).value`), body);
            else if (kind !== 'cards') assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(cards)}).value`), '');
            assert.equal(await viewChoice(), rememberedBefore, 'completion preserves the remembered view');
          }
          await shot(p, `notebook-1159-${surface}-${mode}-${kind}`); assert.deepEqual(p.errors, []);
        } finally { if (p) await p.close(); }
      }
  });
}
