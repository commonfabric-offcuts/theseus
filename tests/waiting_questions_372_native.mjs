import assert from 'node:assert/strict';

// Synthetic public-command fixtures only. Both reading engines run these same
// own cases. Physical keyboard/phone feel and asker withdrawal are not claimed.
export async function waitingQuestions372Checks({ check, page, until, control, view, facts, shot, observations, engine }) {
  const ask = (operation, topic, body) => control({ method:'agent_message', operation_id:operation,
    topic_id:topic, whole_topic:true, body, post_args:{intent:'ask',addressees:[facts.actor],go_ahead:false,
      divergence_reason:'Separate synthetic372 question',ask_wait:{root_id:null,cover_revision:0,
        questions:[{actor_id:facts.actor,text:body,options:[],default:null,reason:'Synthetic factual question without choices or default'}]}} });
  for (const width of [320, 375, 390, 1280]) for (const theme of ['light', 'dark']) {
    await check(`reading item 372 ${width} ${theme}: four source identities, next and wrap, same-page topic cycle`, async () => {
      const oid = `q372-${width}-${theme}`, a = oid + '-a', b = oid + '-b';
      const phone = width < 600;
      const tolerances = { viewportOverflowPx: 1, targetEdgePx: 1, minimumVisibleHeightPx: 1 };
      await control({ method: 'light_outcome', outcome: oid, title: 'Synthetic item 372', topic: { id: a, title: 'Synthetic A' } });
      await control({ method: 'light_outcome', outcome: oid, exists: true, topic: { id: b, title: 'Synthetic B' } });
      const c = (await view('conversation', { workspace_id: oid })).conversation.topic_id;
      const records = [];
      for (const [topic, label] of [[a, 'A'], [b, 'B'], [c, 'Conversation first'], [c, 'Conversation second']]) {
        const body = `${oid} synthetic question [${label}]`;
        const answer = await ask(oid + '-' + records.length, topic, body);
        assert.equal(answer.status, 'committed');
        records.push({ topic_id: topic, message_id: answer.result.message_id, body });
      }
      const light = await view('outcome_light', { workspace_id: oid });
      assert.equal(light.light.short.count, 4);
      assert.equal(light.lead.count, 4);
      const asks = light.facts.filter(f => f.kind === 'ask');
      assert.equal(asks.length, 4);
      assert.deepEqual(asks.map(f => f.message_id).sort(), records.map(f => f.message_id).sort(), 'count and click expose exactly the four recorded messages, no place representative');
      const order = [...asks].sort((x, y) => x.ms - y.ms || x.topic_id.localeCompare(y.topic_id) || x.message_id.localeCompare(y.message_id));
      for (const record of records) {
        const source = await view('source', { source_ref: { kind: 'message', id: record.message_id } });
        assert.equal(source.body, record.body);
        assert.equal(source.topic_id, record.topic_id);
      }
      observations.push({ name: 'item 372 recorded fixture', engine, width, theme, records: [...records], count: light.light.short.count, asks });
      const p = await page(oid, null, true, { url: facts.origin + (phone ? '/?workspace=' + oid : '/?topic=t1'), beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 844 : 900, mobile: phone, deviceScaleFactor: 1 });
        if (phone) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      } });
      try {
      const ready = async () => {
        await until(() => p.evaluate(`document.body.dataset.ready==='true'&&!document.documentElement.hasAttribute('data-rails-reading')`).catch(() => false), oid + ': page and rails ready');
        await p.readsSettled?.();
      };
      const press = async selector => {
        await ready();
        const box = await until(() => p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();const x=b.x+Math.min(8,b.width/2),y=b.y+b.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y,height:b.height,right:b.right,bottom:b.bottom,width:innerWidth,viewportHeight:innerHeight}:null})()`), selector + ': uncovered native target');
        assert.ok(box.right <= box.width + tolerances.targetEdgePx && box.bottom <= box.viewportHeight + tolerances.targetEdgePx, `${selector}: inside viewport within targetEdgePx=${tolerances.targetEdgePx}: ${JSON.stringify(box)}`);
        assert.ok(box.height >= tolerances.minimumVisibleHeightPx, `${selector}: minimumVisibleHeightPx=${tolerances.minimumVisibleHeightPx}: ${box.height}`);
        observations.push({ name: 'item 372 native target', engine, width, theme, selector, box, tolerances });
        if (phone) {
          await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
          await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await p.point(selector);
      };
      const shown = () => p.evaluate(`({open:Boolean(document.querySelector('#reader')?.open),body:document.querySelector('#source-body')?.textContent??'',url:location.href,origin:performance.timeOrigin})`).catch(() => null);
      let pressNumber = 0;
      const opened = async (selector, expected) => {
        await press(selector);
        const record = records.find(r => r.message_id === expected.message_id);
        const seen = await until(async () => { const s = await shown(); return s?.open && s.body.includes(record.body) && s; }, oid + ': Reader opens exact source ' + expected.message_id);
        assert.ok(seen.body.includes(record.body));
        // Same-page Reader opens preserve the page route. The unique source
        // words were read back from this exact recorded id before any press.
        const actual = records.find(r => seen.body.includes(r.body));
        assert.equal(actual.message_id, expected.message_id);
        observations.push({ name: 'item 372 opened source', engine, width, theme, selector, message_id: actual.message_id, url: seen.url });
        await shot(p, oid + '-' + (++pressNumber) + '-' + expected.message_id);
        await p.key('Escape');
        await until(async () => (await shown())?.open === false, oid + ': Reader closes');
        return actual.message_id;
      };
      //14606/14618: phone keeps the drawer cycle; desktop uses the existing
      // waiting pill and lit TOPIC rows, with no restored standing/cycle button.
      const ensureOutline = async () => {
        if (phone && !await p.evaluate('document.querySelector("#rail").classList.contains("open")')) await press('#rail-open');
      };
      const lightControl = `#outline .ol-outcome[data-workspace-id="${oid}"] .ol-waiting`;
      const countVisible = () => until(() => p.evaluate(`document.querySelector(${JSON.stringify(lightControl)})?.textContent.includes('4 questions')`), oid + ': four questions rendered');
      const back = async () => {
        await p.evaluate('history.back()');
        await until(() => p.evaluate(`new URL(location.href).searchParams.get('workspace')===${JSON.stringify(oid)}`).catch(() => false), oid + ': Back to outcome');
        await ready(); await ensureOutline(); await countVisible();
      };
      const cycle = [];
      if (phone) {
        await ready(); await ensureOutline(); await countVisible();
        assert.ok(await p.evaluate('!document.querySelector("#reader").open'), 'count read opens nothing');
        for (let n = 0; n < 5; n++) {
          if (n) await back();
          cycle.push(await opened(lightControl, order[n % 4]));
        }
        assert.deepEqual(cycle, [...order.map(q => q.message_id), order[0].message_id]);
      } else {
        // Start outside this outcome so its existing left-rail topic rows own
        // navigation; opening the disclosure is setup and keeps981's folds.
        await ready();
        const disclosure=`#outline .ol-outcome[data-workspace-id="${oid}"] .ol-disclosure`;
        if (!await p.evaluate(`document.querySelector(${JSON.stringify(disclosure)})?.getAttribute('aria-expanded')==='true'`)) await press(disclosure);
        const places=await view('workspaces',{limit:100});
        // Existing cover questions contribute separately to the rail total.
        const expected=places.items.reduce((n,item)=>n+(item.light?.light==='waiting'&&item.light.short?.kind==='asks'?item.light.short.count:0)+(item.cover_waiting??0),0);
        observations.push({name:'item372 expected desktop total',engine,width,theme,expected,places:places.items.map(({id,light,cover_waiting})=>({id,light,cover_waiting}))});
        await until(()=>p.evaluate(`Number(document.querySelector('#outline-only-waiting .n')?.textContent)===${expected}`),oid+': pill counts all eligible questions');
        await press('#outline-only-waiting');
        assert.equal(await p.evaluate("document.querySelector('#outline-only-waiting').getAttribute('aria-pressed')"),'true');
        assert.equal(await p.evaluate("document.querySelectorAll('#outline .ol-waiting').length"),0,'desktop has no hidden cycle button');
        for (const record of records) {
          const row=`#outline a[data-topic-id="${record.topic_id}"]`;
          await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(row)})?.dataset.dimmed==='false'`),oid+': waiting topic stays lit');
          cycle.push(await opened(row,{message_id:record.message_id}));
        }
        assert.deepEqual(cycle,records.map(record=>record.message_id),'pill and topic rows reach both Conversation questions');
        observations.push({name:'item372 desktop waiting pill',engine,width,theme,expected,cycle,control:'#outline-only-waiting',rows:'existing topic rows'});
      }
      assert.equal(new Set(cycle.slice(0, 4)).size, 4, 'each counted source reached once, including second Conversation');
      const still = await view('outcome_light', { workspace_id: oid });
      assert.equal(still.light.short.count, 4, 'opening sources answers no asks');
      // Add a second ordinary-topic ask only after proving the exact four.
      const body = `${oid} synthetic question [A second]`;
      const answer = await ask(oid + '-a2', a, body);
      records.push({ topic_id: a, message_id: answer.result.message_id, body });
      await ready();
      const row = `#outline a[data-topic-id="${a}"]`;
      const drawer = async () => {
        if (phone && !await p.evaluate('document.querySelector("#rail").classList.contains("open")')) await press('#rail-open');
      };
      const topicAsks = (await view('topic', { topic_id: a })).topic.asks.filter(q => q.actor_id === facts.actor)
        .sort((x, y) => x.since_ms - y.since_ms || x.message_id.localeCompare(y.message_id));
      assert.equal(topicAsks.length, 2);
      // Wait for the real row's current public preview, then use its native
      // navigation owner. A harness goto after the fixture write would bypass
      // the app's departure guard while the write's live reads are queued.
      await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(row)})?.querySelector('.topic-state')?.title.includes(${JSON.stringify(body)})`),oid+': row has read the second question');
      await drawer();
      await opened(row,topicAsks[phone?0:1]);
      const topicCycle = [];
      const pageOrigin = (await shown()).origin;
      for (let n = 0; n < 3; n++) {
        await drawer();
        topicCycle.push(await opened(row, topicAsks[(n+(phone?1:0)) % 2]));
        assert.equal((await shown()).origin, pageOrigin, 'topic-row press stays on this document');
      }
      const expectedTopicCycle=(phone?[1,0,1]:[0,1,0]).map(index=>topicAsks[index].message_id);
      assert.deepEqual(topicCycle, expectedTopicCycle,'the desktop row remembers its earlier oldest-question press');
      const overflow = await p.evaluate('document.documentElement.scrollWidth-innerWidth');
      assert.ok(overflow <= tolerances.viewportOverflowPx, `viewportOverflowPx=${tolerances.viewportOverflowPx}: ${overflow}`);
      observations.push({ name: 'item 372 synthetic records and cycles', engine, width, theme, tolerances, records, count: 4, facts: asks, cycle, topicCycle, overflow });
      assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    });
  }
}
