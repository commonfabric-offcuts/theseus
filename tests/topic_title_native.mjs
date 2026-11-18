import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { withPageCleanup } from './native-page-cleanup.mjs';

// Item 656 runs through the header step and both colour engines. Every act is
// native input; waits name focus, a response, or the DOM state they consume.
export async function topicTitleChecks({ check, page, until, control, view, facts, shot }, mode, mutations = true, phase = 'main') {
  const capture = async (p, name) => {
    await until(() => p.evaluate("document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), 'the captured surface finished opening');
    await shot(p, name);
  };
  const active = p => p.evaluate('document.activeElement?.id');
  const held = async () => (await view('topic', { topic_id: 't1' })).topic;
  const title = p => p.evaluate('document.querySelector("#topic-title").textContent');
  const updates = p => p.calls.filter(c => c.payload?.kind === 'topic.update').map(c => c.payload);
  for (const width of [320, 375, 390, 1440]) for (const theme of ['light', 'dark']) {
    const size = width === 1440 ? 'laptop' : width;
    const setup = { touch: width < 760, titleRename: true, beforeNavigate: async p => {
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 760 });
      if (width < 760) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    } };
    const press = async (p, selector) => {
      await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
      if (width === 1440) return p.point(selector);
      const b = await p.box(selector);
      const visibleTolerancePx = 0.5;
      assert.ok(b?.width > visibleTolerancePx && b?.height > visibleTolerancePx, `visible ${selector} (visibility tolerance ${visibleTolerancePx}px)`);
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const fits = async p => {
      // DOM edges can round by a pixel; a target can round by half a pixel.
      // The local evidence contract still rejects 2px overflow and a 40px target.
      const edgeTolerancePx = 1, targetTolerancePx = 0.5;
      const boxes = await p.evaluate(`(()=>{const ids=['topic-title','topic-title-edit','topic-title-rename','settings-open','new-message'];
        return {scrollWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth, boxes:ids.map(id=>document.getElementById(id)).filter(e=>e&&e.getClientRects().length).map(e=>{
          const b=e.getBoundingClientRect();return {id:e.id,x:b.x,right:b.right,width:b.width,height:b.height};})}})()`);
      assert.ok(boxes.scrollWidth <= boxes.viewportWidth + edgeTolerancePx, `no sideways scroll (edge tolerance ${edgeTolerancePx}px): ${JSON.stringify(boxes)}`);
      for (const b of boxes.boxes) assert.ok(b.x >= -edgeTolerancePx && b.right <= width + edgeTolerancePx, `in reach (edge tolerance ${edgeTolerancePx}px): ${JSON.stringify(b)}`);
      const pencil = boxes.boxes.find(b => b.id === 'topic-title-rename');
      if (pencil) assert.ok(pencil.width >= 44 - targetTolerancePx && pencil.height >= 44 - targetTolerancePx, `the named pencil is a touch target (target tolerance ${targetTolerancePx}px)`);
    };
    const start = async (state, url) => {
      const p = await page(`item-656-${phase}-${state}-${size}-${theme}`, null, true, { ...setup, ...(url ? { url } : {}) });
      await until(() => p.evaluate('document.body.dataset.ready === "true"'), 'topic loaded');
      await capture(p, `item-656-${phase}-${state}-${size}-${theme}-before`);
      assert.equal(await p.evaluate('Boolean(document.querySelector("#topic-title-rename:not([hidden])"))'), true, 'item 656: a pencil beside the topic title');
      assert.deepEqual(await p.evaluate(`(b=>[b.getAttribute('aria-label'),b.title,Boolean(b.querySelector('svg'))])(document.querySelector('#topic-title-rename'))`), ['Rename topic', 'Rename topic', true]);
      await fits(p);
      return p;
    };
    const edit = async p => {
      await press(p, '#topic-title-rename');
      await until(async () => await active(p) === 'topic-rename', 'the in-place title line has focus');
      assert.equal(await p.evaluate('document.querySelector("#topic-settings").open'), false, 'renaming stays in the header');
      assert.equal(await p.evaluate('Boolean(document.querySelector(".title-row #topic-rename"))'), true, 'the title is edited where it was read');
      await fits(p);
    };
    const type = (p, text) => p.send('Input.insertText', { text });
    const snap = async (p, state) => { await fits(p); await capture(p, `item-656-${phase}-${state}-${size}-${theme}`); };

    if (phase === 'base' || phase === 'compare') {
      await check(`${mode} item 656 ${phase} screenshots at ${size} ${theme}`, async () => {
        const p = await page(`item-656-${phase}-${size}-${theme}`, null, true, setup);
        assert.equal(await p.evaluate('Boolean(document.querySelector("#topic-title-rename:not([hidden])"))'), phase === 'compare', 'only the current page has the title pencil');
        await until(() => p.evaluate('[...document.images].filter(i=>i.getClientRects().length).every(i=>i.complete)'), 'visible images are ready for comparison');
        await capture(p, `item-656-${phase}-normal-${size}-${theme}`);
        if (width < 760) await press(p, '#rail-open');
        await capture(p, `item-656-${phase}-rail-${size}-${theme}`);
        if (width < 760) await p.key('Escape');
        await press(p, '#settings-open');
        await until(() => p.evaluate('document.querySelector("#topic-settings").open'), 'base settings open');
        await capture(p, `item-656-${phase}-settings-${size}-${theme}`);
        await p.close();
      });
      continue;
    }

    await check(`${mode} item 656 normal: pencil renames in place; reload keeps header and rail; settings rename still works at ${size} ${theme}`, async () => {
      const original = (await held()).title;
      const p = await start('normal');
      await snap(p, 'normal');
      await edit(p);
      const renamed = original === `A topic renamed at ${size} ${theme}` ? `Another title at ${size} ${theme}` : `A topic renamed at ${size} ${theme}`;
      await type(p, renamed); await p.key('Enter');
      await until(async () => await title(p) === renamed && await active(p) === 'topic-title-rename', 'saved title and focus back on pencil');
      await snap(p, 'saved');
      assert.equal((await held()).title, renamed);
      assert.equal(await p.evaluate('Boolean(document.querySelector("#topic-settings #topic-rename"))'), true, 'settings keeps its rename field after a header save');
      assert.deepEqual(updates(p).map(c => [c.args, c.expected.topic_fields]), [[{ title: renamed }, { title: original }]], 'only the title changes');
      const networkFrom = p.network?.length ?? 0;
      await p.send('Page.reload');
      // CDP answers reload before the old execution context has gone. Wait on
      // this reload's document response completing before reading its DOM.
      // WebKit's Page.reload adapter already awaits the document's load event.
      if (!p.pw && p.network) await until(() => {
        const events = p.network.slice(networkFrom);
        const document = events.find(e => e.method === 'Network.responseReceived' && e.params.type === 'Document');
        return document && events.some(e => e.method === 'Network.loadingFinished' && e.params.requestId === document.params.requestId);
      }, 'the reloaded document response finished');
      await until(async () => await title(p) === renamed && await p.evaluate('document.body.dataset.ready === "true"'), 'reload shows the saved title');
      if (width < 760) await press(p, '#rail-open');
      await until(() => p.evaluate(`document.querySelector('#outline a[data-topic-id="t1"]')?.textContent.includes(${JSON.stringify(renamed)})`), 'the rail shows the same saved title');
      await capture(p, `item-656-${phase}-rail-${size}-${theme}`);
      if (width < 760) await p.key('Escape');
      await press(p, '#settings-open');
      await until(() => p.evaluate('document.querySelector("#topic-settings").open'), 'settings open');
      await capture(p, `item-656-${phase}-settings-${size}-${theme}`);
      await press(p, '#topic-state .settings-actions button:first-of-type');
      await until(async () => await active(p) === 'topic-rename', 'settings rename focused');
      await type(p, original); await p.key('Enter');
      await until(async () => await title(p) === original && (await held()).title === original, 'settings rename still saves');
      assert.equal(await p.evaluate('document.querySelector("#topic-settings").open'), true, 'settings stays open');
      assert.deepEqual(p.errors, []);
    });

    await check(`${mode} item 656 editing: Escape and unchanged Return record nothing, preserve the page and keyboard reaches the pencil at ${size} ${theme}`, async () => {
      const p = await start('editing'), original = await title(p), before = updates(p).length;
      // Shift-Tab from the gear reaches the preceding pencil.
      await p.evaluate('document.querySelector("#settings-open").focus()'); await p.key('Tab', 8);
      assert.equal(await active(p), 'topic-title-rename', 'native Tab reaches the pencil');
      await p.key('Enter'); await until(async () => await active(p) === 'topic-rename', 'Return opens rename');
      assert.deepEqual(await p.evaluate('(e=>[e.value,e.selectionStart,e.selectionEnd])(document.querySelector("#topic-rename"))'), [original, 0, original.length]);
      await type(p, 'Do not save these words'); await snap(p, 'editing'); await p.key('Escape');
      await until(async () => await active(p) === 'topic-title-rename', 'Escape gives the pencil back');
      assert.equal(await title(p), original); assert.equal(updates(p).length, before, 'Escape sends nothing');
      await edit(p); await p.key('Enter');
      await until(async () => await active(p) === 'topic-title-rename', 'unchanged Return closes rename');
      assert.equal(updates(p).length, before, 'unchanged Return sends nothing');
      assert.equal(await p.evaluate('document.querySelector("#new-message").getAttribute("aria-label")'), 'New message');
      assert.deepEqual(p.errors, []);
    });

    await check(`${mode} item 656 busy: one save waits on its answer without moving the controls or losing the title at ${size} ${theme}`, async () => {
      const p = await start('busy'), original = await title(p);
      await edit(p); await type(p, original + ' saved');
      p.intercept(payload => payload?.kind === 'topic.update');
      await p.key('Enter'); await until(() => p.held.length === 1, 'the save reached Core; its answer is held');
      await snap(p, 'busy');
      assert.equal(await active(p), 'topic-rename');
      await p.key('Enter'); assert.equal(updates(p).length, 1, 'no duplicate save while busy');
      p.intercept(null); await p.release(p.held.shift());
      await until(async () => await active(p) === 'topic-title-rename', 'answer restores title and pencil');
      await control({ method: 'topic_state', operation_id: `656-${phase}-busy-restore-${size}-${theme}`, topic_id: 't1', args: { title: original } });
      assert.deepEqual(p.errors, []);
    });

    await check(`${mode} item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers at ${size} ${theme}`, async () => {
      const p = await start('refused'), original = await title(p);
      const theirs = original === 'Their newer title' ? 'Another newer title' : 'Their newer title';
      const mine = 'My kept title ' + phase;
      await edit(p); await type(p, mine);
      await control({ method: 'topic_state', operation_id: `656-${phase}-conflict-${size}-${theme}`, topic_id: 't1', args: { title: theirs } });
      await until(async () => await title(p) === theirs, 'page learned the newer title');
      await p.key('Enter');
      await until(() => p.evaluate('document.querySelector("#topic-title-edit .notice")?.textContent.includes("Someone else renamed it first")'), 'refusal beside the kept title');
      assert.equal((await held()).title, theirs, 'refusal overwrites nothing');
      assert.equal(await p.evaluate('document.querySelector("#topic-rename").value'), mine);
      assert.equal(await p.evaluate('document.querySelector("#topic-settings").open'), false);
      await snap(p, 'refused'); await p.key('Enter');
      await until(async () => await title(p) === mine && await active(p) === 'topic-title-rename', 'Return recovers');
      await control({ method: 'topic_state', operation_id: `656-${phase}-conflict-restore-${size}-${theme}`, topic_id: 't1', args: { title: original } });
      assert.deepEqual(p.errors, []);
    });

    await check(`${mode} item 656 error: an empty title is refused in place and Escape keeps the saved title at ${size} ${theme}`, async () => {
      const p = await start('error'), original = await title(p);
      await edit(p); await p.key('Backspace'); await p.key('Enter');
      await until(() => p.evaluate('Boolean(document.querySelector("#topic-title-edit .notice:not([hidden])"))'), 'the error shows with the title line');
      assert.equal((await held()).title, original, 'invalid words change nothing');
      assert.equal(await p.evaluate('document.querySelector("#topic-settings").open'), false);
      await snap(p, 'error'); await p.key('Escape');
      await until(async () => await active(p) === 'topic-title-rename', 'Escape recovers');
      assert.equal(await title(p), original); assert.deepEqual(p.errors, []);
    });

    await check(`${mode} item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it live; Conversation has none at ${size} ${theme}`, async () => {
      // Start with an allowed title so this whole acceptance case is red before
      // the feature, then exercise the denied state independently.
      await start('permission');
      const made = await control({ method: 'agent_topic', operation_id: `656-${phase}-permission-${mode}-${size}-${theme}`, title: 'A member reads this topic', body: 'Permission fixture.', team: true });
      const p = await page(`item-656-denied-${size}-${theme}`, null, true, { ...setup, url: `${facts.origin}/?topic=${made.topic_id}` });
      await until(async () => await title(p) === 'A member reads this topic', 'member topic loaded');
      assert.equal(await p.evaluate('Boolean(document.querySelector("#topic-title-rename:not([hidden])"))'), false, 'no pencil without rename permission');
      await snap(p, 'read-only');
      await press(p, '#settings-open');
      assert.equal(await p.evaluate('Boolean(document.querySelector("#topic-settings #topic-rename"))'), false, 'settings agrees on permission');
      await p.key('Escape');
      await control({ method: 'outcome_change', operation_id: `656-${phase}-owner-${mode}-${size}-${theme}`, sender: facts.agent, workspace_id: made.workspace_id, owner: facts.actor });
      await until(() => p.evaluate('Boolean(document.querySelector("#topic-title-rename:not([hidden])"))'), 'new owner gains pencil live');
      await control({ method: 'outcome_change', operation_id: `656-${phase}-owner-back-${mode}-${size}-${theme}`, sender: facts.actor, workspace_id: made.workspace_id, owner: facts.agent });
      await until(() => p.evaluate('!document.querySelector("#topic-title-rename:not([hidden])")'), 'old owner loses pencil live');
      const q = await page(`item-656-conversation-${size}-${theme}`, null, true, { ...setup, url: `${facts.origin}/?workspace=${made.workspace_id}` });
      assert.equal(await q.evaluate('Boolean(document.querySelector("#topic-title-rename:not([hidden])"))'), false, 'Conversation cannot be renamed as a topic');
      assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    });
    for (const busy of [false, true]) await check(`${mode} item 656 membership-${busy ? 'busy' : 'editing'}: nonparticipant owner loses reader_may_say during rename; heading returns, exact writing and operation recover, native Escape then rename at ${size} ${theme}`, async () => {
      const prefix = `656-${phase}-membership-${busy}-${mode}-${size}-${theme}`;
      const original = 'A topic written only by the agent';
      const made = await control({ method: 'agent_topic', operation_id: prefix, title: original, body: 'Only the fixture agent wrote here.', team: true, watching: true });
      const read = () => view('topic', { topic_id: made.topic_id });
      const denied = await read();
      assert.equal(denied.topic.reader_may_say, false, 'real Core precondition: neither participant nor previous author');
      assert.equal(denied.topic.creator_id, facts.agent);
      assert.equal(denied.participants.some(person => person.actor_id === facts.actor && person.active !== false && person.active !== 0), false, 'the reader does not participate');
      const history = await view('topic_messages', { topic_id: made.topic_id, direction: 'before', limit: 20 });
      assert.equal(history.items.length, 1, 'bounded complete history of this newly created topic');
      assert.ok(history.items.every(message => message.author_id === facts.agent), 'the reader has never authored a message');
      await control({ method: 'outcome_change', operation_id: prefix + '-gain', sender: facts.agent, workspace_id: made.workspace_id, owner: facts.actor });
      const p = await start(`membership-${busy ? 'busy' : 'editing'}`, `${facts.origin}/?topic=${made.topic_id}`);
      await withPageCleanup(p, async () => {
        try {
          await edit(p);
          await p.evaluate('window.item656TitleField = document.querySelector("#topic-rename")');
          const first = 'Exact title —  two spaces ' + phase;
          const words = busy ? 'Later exact writing —  retained ' + phase : first;
          await type(p, first);
          if (busy) {
            p.intercept(payload => payload?.kind === 'topic.update');
            await p.key('Enter'); await until(() => p.held.length === 1, 'one title operation reached Core and its answer is held');
            assert.equal((await read()).topic.title, first, 'Core committed the held operation');
            await p.key('a', 4); await type(p, words);
          }
          const before = updates(p).map(call => ({ ...call }));
          await snap(p, busy ? 'membership-busy' : 'membership-editing');
          await control({ method: 'outcome_change', operation_id: prefix + '-lose', sender: facts.actor, workspace_id: made.workspace_id, owner: facts.agent });
          await until(async () => (await read()).topic.reader_may_say === false, 'Core actually revokes reader_may_say');
          await until(() => p.evaluate('document.querySelector("#topic-title-rename").hidden && !document.querySelector("#topic-state .state-chips button")'), 'live permission change rebuilt the panel read-only');
          assert.equal(await p.evaluate('document.querySelector("#topic-title-edit").hidden'), true, 'permission rebuild restores the header title');
          assert.equal(await p.evaluate('document.querySelector("#topic-title").hidden'), false, 'saved heading is visible');
          assert.equal(await title(p), busy ? first : original);
          assert.deepEqual(await p.evaluate(`(()=>{const e=window.item656TitleField;return [e===document.querySelector('#topic-settings #topic-rename'),e.value,e.disabled,document.querySelector('#topic-state .settings-actions').hidden]})()`), [true, words, true, true], 'same borrowed title field and exact writing are reclaimed, disabled and hidden');
          assert.deepEqual(updates(p), before, 'permission rebuild starts no title operation');
          await snap(p, 'membership-read-only-' + busy);
          await p.key('Escape');
          assert.equal(await p.evaluate('document.querySelector("#topic-title").hidden'), false, 'native Escape cannot leave an orphan header editor');
          if (busy) {
            p.intercept(null); await p.release(p.held.shift());
            await until(() => p.evaluate('document.querySelector("#topic-state .notice").textContent === "Saved"'), 'the original answer settles while permission is absent');
            assert.deepEqual(updates(p), before, 'the held operation is neither replaced nor resent');
          }
          await control({ method: 'outcome_change', operation_id: prefix + '-regain', sender: facts.agent, workspace_id: made.workspace_id, owner: facts.actor });
          await until(() => p.evaluate('!document.querySelector("#topic-title-rename").hidden'), 'ownership regained live');
          assert.equal((await read()).topic.reader_may_say, true);
          await edit(p);
          assert.deepEqual(await p.evaluate('(e=>[e===window.item656TitleField,e.value,e.disabled])(document.querySelector("#topic-rename"))'), [true, words, false], 'regaining permission resumes the same title writing');
          await snap(p, 'membership-recovered-' + busy);
          await p.key('Escape');
          await until(async () => await active(p) === 'topic-title-rename', 'native Escape cancels recovered title and returns focus');
          assert.equal(await p.evaluate('window.item656TitleField.value'), busy ? first : original, 'Escape cancels exact retained title writing');
          const final = 'Recovered rename ' + phase;
          await edit(p); await type(p, final); await p.key('Enter');
          await until(async () => await title(p) === final && await active(p) === 'topic-title-rename', 'rename after the permission rebuild saves normally');
          assert.equal((await read()).topic.title, final);
          assert.equal(updates(p).length, busy ? 2 : 1, 'one operation per deliberate rename, none from revoke, regain or Escape');
          await snap(p, 'membership-saved-' + busy);
        } finally {
          p.intercept(null);
          for (const entry of p.held.splice(0)) await p.release(entry);
        }
      });
    });
  }
  if (!mutations) return;
  await check(`${mode} item 656 base comparison: header, rail and settings at every width and theme`, async () => {
    const files = ['web/aim.css', 'web/app.mjs', 'web/index.html', 'web/topic-header.mjs', 'web/topic-state.mjs'];
    const originals = [];
    const restart = async () => {
      await control({ method: 'server_stop' });
      Object.assign(facts, await control({ method: 'server_start' }));
    };
    try {
      await topicTitleChecks({ check: async (_, action) => action(), page, until, control, view, facts, shot }, mode, false, 'compare');
      for (const file of files) {
        const url = new URL('../' + file, import.meta.url), original = await readFile(url, 'utf8');
        const base = execFileSync('git', ['show', '833d2a153f6fb98ff41c63f0736791f76a1188a8:' + file], { encoding: 'utf8' });
        originals.push({ url, original });
        await writeFile(url, base);
      }
      await restart();
      await topicTitleChecks({ check: async (_, action) => action(), page, until, control, view, facts, shot }, mode, false, 'base');
    } finally {
      for (const { url, original } of originals) await writeFile(url, original);
      await restart();
    }
    process.stdout.write(JSON.stringify({ item: 656, base_screenshots: '833d2a153f6fb98ff41c63f0736791f76a1188a8', restored: true }) + '\n');
  });

  // Apply each ledger break to the served source on the hosted runner, prove
  // the real acceptance action fails, restore the bytes, then run its control.
  // These stay inside item 656's filtered pool cases; no separate suite runs.
  const ledger = JSON.parse(await readFile(new URL('./acts.json', import.meta.url), 'utf8'));
  for (const act of ledger.acts.filter(act => act.item === 656)) {
    await check(`${mode} item 656 mutant: ${act.act}`, async () => {
      const originals = [];
      const pages = [];
      const selected = name => name.includes(act.check.case) && name.endsWith('320 light');
      let runNumber = 0;
      const restart = async () => {
        for (const p of pages.splice(0)) await p.close();
        await control({ method: 'server_stop' });
        Object.assign(facts, await control({ method: 'server_start' }));
      };
      const run = async () => {
        runNumber++;
        let ran = 0;
        await topicTitleChecks({ check: async (name, action) => { if (selected(name)) { ran++; await action(); } },
          page: async (...args) => { const p = await page(...args); pages.push(p); return p; }, until, control, view, facts, shot }, mode, false, `probe-${ledger.acts.indexOf(act)}-${runNumber}`);
        assert.equal(ran, 1, 'one real acceptance case exercises this mutation');
      };
      let caught = null, pageErrors = [];
      try {
        for (const [file, from, to] of act.break) {
          const url = new URL('../' + file, import.meta.url), original = await readFile(url, 'utf8');
          assert.equal(original.split(from).length, 2, 'the mutation target is unique');
          const changed = original.replace(from, to);
          assert.notEqual(changed, original, 'the source really changes');
          originals.push({ url, original, changed });
          await writeFile(url, changed);
        }
        await restart();
        try { await run(); } catch (error) { caught = error; }
      } finally {
        for (const { url, original } of originals) await writeFile(url, original);
        pageErrors = pages.flatMap(p => p.errors);
        await restart();
      }
      process.stdout.write(JSON.stringify({ item: 656, mutation: act.act, failed_case: caught?.message ?? null }) + '\n');
      assert.ok(caught, 'the acceptance case must fail with the mutation applied');
      assert.match(caught.message, /title|pencil|renam|focus|settings/i, 'failed for the title rule');
      assert.deepEqual(pageErrors, [], 'a script error is not mutation proof');
      const digest = text => createHash('sha256').update(text).digest('hex');
      for (const { url, original, changed } of originals) {
        assert.equal(await readFile(url, 'utf8'), original, 'exact source bytes restored');
        process.stdout.write(JSON.stringify({ item: 656, mutation: act.act, file: url.pathname, before: digest(original), mutated: digest(changed), caught: caught.message }) + '\n');
      }
      await run();
      process.stdout.write(JSON.stringify({ item: 656, mutation: act.act, restored_control_passed: true }) + '\n');
    });
  }

}
