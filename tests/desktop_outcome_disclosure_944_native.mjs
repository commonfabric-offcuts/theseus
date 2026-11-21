import assert from 'node:assert/strict';

export async function desktopOutcomeDisclosure944Checks(
  { check, until, control, facts, shot, observations },
  { open, tap, drawer }
) {
  for (const device of ['laptop', 'phone']) for (const theme of ['light', 'dark']) {
    const name = `rail item 944 ${device} ${theme}: outcome navigation keeps manual desktop disclosure`;
    await check(name, async () => {
      const prefix = `outline944-${device}-${theme}`, a = prefix + '-a', b = prefix + '-b', topic = a + '-topic';
      for (const id of [a, b]) await control({ method: 'light_outcome', outcome: id, title: 'Outcome ' + id, topic: { id: id + '-topic', title: 'Topic ' + id } });
      let p; const phases = [], phone = device === 'phone';
      const row = id => `#outline .ol-outcome[data-workspace-id="${id}"]`;
      const link = id => row(id) + ' .ol-name';
      const chevron = id => row(id) + ' .ol-disclosure';
      const expanded = id => p.evaluate(`document.querySelector(${JSON.stringify(row(id))})?.hasAttribute('data-open')`);
      const show = async () => {
        if (phone && !(await drawer(p)).open) {
          await p.evaluate("document.querySelector('#rail-open').scrollIntoView({block:'center'})");
          await tap(p, '#rail-open'); await until(async () => (await drawer(p)).open, 'phone drawer opens');
        }
      };
      const press = async selector => {
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
        await until(() => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y))})()`), 'actual outline target is visible for native input');
        if (phone) await tap(p, selector); else await p.point(selector);
      };
      const rest = what => until(() => p.evaluate(`document.body?.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading')&&Boolean(document.querySelector(${JSON.stringify(link(a))}))&&Boolean(document.querySelector(${JSON.stringify(link(b))}))`), what);
      const arrives = async id => {
        await until(() => p.evaluate(`document.body?.dataset.ready==='true'&&new URL(location.href).searchParams.get('workspace')===${JSON.stringify(id)}`), 'chosen outcome actually opens');
        await rest('chosen outcome and outline finish reading');
      };
      const choices = () => p.evaluate(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('aim-next.outline-open.')).map(k=>[k,localStorage.getItem(k)]))`);
      const reload = async () => {
        const old = await p.evaluate('(window.document944=crypto.randomUUID())'); await p.send('Page.reload');
        await until(() => p.evaluate(`window.document944!==${JSON.stringify(old)}&&document.body?.dataset.ready==='true'`), 'replacement document is ready');
        await rest('outline restores after reload');
      };
      try {
        p = await open(prefix, '/?topic=t1', device, theme); await rest(prefix);
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link(b))}))`), 'both fixture outcomes are listed');
        await show();
        assert.equal(await expanded(a), false, 'unclicked outcome starts folded');
        await press(chevron(b)); await until(async () => await expanded(b), 'explicit chevron opens the other outcome');
        const beforeChoices = await choices(), beforeUrl = await p.evaluate('location.href');
        await press(link(a));
        if (phone) {
          await until(async () => await expanded(a), 'first phone tap expands');
          assert.equal(await p.evaluate('location.href'), beforeUrl, 'first phone tap does not navigate');
          assert.equal((await drawer(p)).open, true, 'first phone tap keeps drawer open');
          phases.push('first native phone tap expands in place');
          await press(link(a));
        }
        await arrives(a); await show();
        assert.equal(await expanded(a), phone, 'desktop name navigation keeps the collapsed choice; phone opens it');
        assert.equal(await expanded(b), true, 'another manually open outcome stays open');
        if (!phone) assert.deepEqual(await choices(), beforeChoices, 'desktop navigation does not write disclosure preferences');
        phases.push('native outcome name opens without changing desktop folds');
        await reload(); await show();
        assert.equal(await expanded(a), phone, 'reload keeps the chosen disclosure');
        assert.equal(await expanded(b), true);
        if (!phone) assert.deepEqual(await choices(), beforeChoices, 'desktop reload does not write disclosure preferences');
        phases.push('reload retains both choices');

        // A chevron remains the explicit desktop control; phone first-tap
        // semantics have already opened this same outcome.
        if (!await expanded(a)) { await press(chevron(a)); await until(async () => await expanded(a), 'chevron opens its children'); }
        await press(`#outline a[data-topic-id="${topic}"]`);
        await until(() => p.evaluate(`document.body?.dataset.ready==='true'&&new URL(location.href).searchParams.get('topic')===${JSON.stringify(topic)}`), 'actual child topic opens');
        await rest('child topic and outline finish reading'); await show();
        await press(chevron(a)); await until(async () => !await expanded(a), 'explicit chevron folds the current outcome');
        const foldedChoices = await choices(); await reload(); await show();
        assert.equal(await expanded(a), phone, 'desktop reload preserves manual fold; phone arrival retains its existing open-current rule');
        if (!phone) assert.deepEqual(await choices(), foldedChoices, 'desktop current-topic reload preserves the exact fold record');
        assert.equal(await expanded(b), true);
        phases.push('chevron and child-topic arrival respect each device rule');
        await press(link(b)); await arrives(b); await show();
        await press(link(a)); await arrives(a); await show();
        assert.equal(await expanded(a), phone, 'returning to the outcome preserves desktop fold');
        assert.equal(await expanded(b), true);
        phases.push('navigation away and back keeps choices');
        await shot(p, 'rail-item944-' + device + '-' + theme);
        assert.deepEqual(p.errors, []); observations.push({ name, phases, input: phone ? 'native emulated touch' : 'native desktop pointer' });
      } catch (error) {
        observations.push({ name, phases, error: error.message });
        if (p) await shot(p, 'rail-item944-' + device + '-' + theme + '-failure');
        throw error;
      } finally { if (p) await p.close(); }
    });
  }
}
