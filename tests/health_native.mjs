import assert from 'node:assert/strict';

// The Health page and its link in the real browser against the real server
// (pipeline item 109, docs/health.md). Every reading on the page is checked
// against the health view it was read from; wakes that fail light the link on
// every page, in the alert colour and in words, and the page says why, live;
// a wake that gets through, or a runner that takes the role again, clears
// both with no reload. At laptop and phone width, light and dark, nothing
// scrolls sideways, nothing has a coloured edge of its own, and every line
// opens by touch.
export async function healthChecks({ check, page, until, control, view, facts, shot }) {
  const agent = facts.agent;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return null; } };
  const ready = p => until(() => quiet(p, `document.body.dataset.ready === 'true'`), 'the page is ready');
  const healthPage = async (suffix, setup = {}) => { const p = await page(suffix, null, true, { url: facts.origin + '/?health', ...setup }); await ready(p); return p; };
  const readLink = p => p.evaluate(`(()=>{const a=document.getElementById('health-link'),s=getComputedStyle(a),b=a.getBoundingClientRect(),root=getComputedStyle(document.documentElement);
    const swatch=document.createElement('span');swatch.style.color='var(--alert)';document.body.append(swatch);const alert=getComputedStyle(swatch).color;swatch.remove();
    return {text:a.textContent,red:a.classList.contains('red'),label:a.getAttribute('aria-label'),color:s.color,alert,edges:[s.borderLeftWidth,s.borderTopWidth],height:b.height,visible:b.width>0&&b.height>0}})()`);
  const readPage = p => p.evaluate(`(()=>{const top=document.querySelector('.health-top');const lines=[...document.querySelectorAll('.health-line')];
    return {top:top?[...top.querySelectorAll('p')].map(n=>n.textContent):null,bad:top?.classList.contains('health-bad')??null,
      lines:lines.map(d=>({key:d.dataset.key,bad:d.classList.contains('bad'),summary:d.querySelector('summary').textContent,details:[...d.querySelectorAll('p')].map(n=>n.textContent)}))}})()`);
  const line = (shown, key) => shown.lines.find(item => item.key === key);
  const failingWhy = "the helper that puts a wake in the Codex app's queue failed (it exited with an error)";

  await check('health hosted Stop and Continue preserve pending work across reloads', async () => {
    await control({method:'hosted_setup'});
    try {
    const agent='fixture-outside-agent';
    for (const [size,mobile] of [['laptop',false],['phone',true]]) {
    const p=await healthPage('health-hosted-controls-'+size,{beforeNavigate:async q=>{
      await q.send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:900,deviceScaleFactor:1,mobile});
      if(mobile) await q.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    }});
    const activate=async selector=>{
      await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      if(!mobile)return p.point(selector);
      const b=await p.box(selector),x=b.x+b.width/2,y=b.y+b.height/2;
      await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    const summary=`details[data-key="agent:${agent}"] summary`;
    const button=`[data-agent-control="${agent}"]`;
    await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(summary)}))`),'hosted seat is shown');
    await activate(summary);
    const before=(await view('health',{})).agents.find(a=>a.actor_id===agent);
    assert.equal(before.execution.desired,'running');
    assert.equal(before.execution.can_control,true);
    assert.equal(before.waiting,1);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(button)}).textContent`),'Stop');
    await activate(button);
    await until(async()=> (await view('health',{})).agents.find(a=>a.actor_id===agent).execution.desired==='stopped','Stop commits');
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(button)})?.textContent==='Continue'`),'Continue replaces Stop');
    // The old document is ready too: the reload is waited for by a timeOrigin kept on the window.
    const loaded=await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.reload');await until(()=>quiet(p,`document.body.dataset.ready === 'true' && (window.documentOrigin??=performance.timeOrigin) !== ${loaded}`),'the page loads again');
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(summary)})?.textContent.includes('stopped')`),'reload retains Stop');
    await activate(summary);
    const stopped=(await view('health',{})).agents.find(a=>a.actor_id===agent);
    assert.equal(stopped.waiting,1,'Stop did not acknowledge the work');
    assert.equal(stopped.execution.execution_revision,before.execution.execution_revision+1);
    await shot(p,'health-hosted-stopped-'+size);
    await activate(button);
    await until(async()=> (await view('health',{})).agents.find(a=>a.actor_id===agent).execution.desired==='running','Continue commits');
    await until(()=>p.evaluate(`document.querySelector(${JSON.stringify(button)})?.textContent==='Stop'`),'Stop returns');
    assert.equal((await view('health',{})).agents.find(a=>a.actor_id===agent).waiting,1,'Continue retains unresolved work');
    assert.deepEqual(p.errors,[]);
    await p.close();
    }
    } finally { assert.equal((await control({method:'hosted_cleanup'})).restored,true); }
  });

  await check('health the page says the runner and every agent from the view, and the link is quiet while nothing is red', async () => {
    assert.deepEqual(await control({ method: 'health', action: 'start' }), { route: 'provisioned', runner: 'acquired' });
    await control({ method: 'agent_message', operation_id: 'health-person-asks', body: 'Over to you.', topic_id: 't1', sender: 'person', addressees: [agent] });
    const p = await healthPage('health-quiet');
    const facts = await view('health', {});
    assert.deepEqual(facts.red, []);
    const shown = await until(async () => { const s = await readPage(p); return s.top && s; }, 'the page paints');
    assert.deepEqual(shown.top, ['Everything is working: the agent runner is sending wakes and they are getting through.']);
    assert.match(line(shown, 'runner').summary, /^Agent runner: Has been running since \d+:\d\d [AP]M/);
    // One line for every agent the view returns, each in the view's own terms.
    assert.deepEqual(shown.lines.filter(item => item.key.startsWith('agent:')).map(item => item.key), facts.agents.map(item => `agent:${item.actor_id}`));
    const mine = facts.agents.find(item => item.actor_id === agent);
    assert.equal(mine.route, 'codex_queue');
    assert.match(line(shown, `agent:${agent}`).summary, new RegExp(`^${agent} — (wakes going out|being woken now) · ${mine.waiting} waiting since `));
    assert.ok(line(shown, `agent:${agent}`).details.includes("Woken through the Codex app's queue."));
    // The link says "checking" until its first read answers, then quiet.
    const link = await until(async () => { const l = await readLink(p); return l.text === 'Health' && l; }, 'the link reads quiet');
    assert.deepEqual([link.text, link.red, link.label], ['Health', false, null]);
    assert.notEqual(link.color, link.alert, 'a quiet link is not in the alert colour');
    await shot(p, 'health-quiet');
    assert.deepEqual(p.errors, []);
  });

  await check('health wakes that fail light the link on another page and the page says why, live, from the view', async () => {
    const p = await healthPage('health-failing');
    const topic = await page('health-topic', null, true);
    await ready(topic);
    assert.equal((await readLink(topic)).red, false);
    await control({ method: 'health', action: 'fail', count: 3, reason: 'broker_exit' });
    const lit = await until(async () => { const l = await readLink(topic); return l.red && l; }, 'the link lights on the topic page, on the commit');
    assert.equal(lit.text, 'Health · needs attention');
    assert.equal(lit.label, 'Health: something needs attention');
    assert.equal(lit.color, lit.alert, 'in the alert colour');
    assert.deepEqual(lit.edges, ['0px', '0px'], 'no edge or box of its own');
    const facts = await view('health', {});
    assert.deepEqual(facts.red, [`failing:${agent}`]);
    const failing = facts.agents.find(item => item.actor_id === agent).failing;
    assert.deepEqual([failing.count, failing.outcome, failing.reason, failing.why], [3, 'error', 'broker_exit', failingWhy]);
    // The Health page, in the tab behind, reads nothing while hidden; brought
    // back, it says it at once, with no reload.
    assert.equal(await p.evaluate('document.visibilityState'), 'hidden', 'the Health page is the tab behind');
    // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
    const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
    await p.send('Page.bringToFront');
    const shown = await until(async () => { const s = await readPage(p); return s.bad && s; }, 'the Health page says it');
    assert.equal(await p.evaluate('(window.documentOrigin??=performance.timeOrigin)'), loaded, 'the Health page was not reloaded');
    assert.equal(shown.top.length, 1);
    assert.match(shown.top[0], new RegExp(`^${agent} can't be woken: every wake since \\d+:\\d\\d [AP]M failed \\(3 times\\)\\. Why: the helper that puts a wake in the Codex app's queue failed \\(it exited with an error\\)\\. 1 message is waiting for ${agent}\\. Its wakes go through the Codex app's queue, so look there first: is the ChatGPT app open\\?$`));
    const mine = line(shown, `agent:${agent}`);
    assert.equal(mine.bad, true);
    assert.match(mine.summary, new RegExp(`^${agent} — can't be woken · 1 waiting`));
    assert.match(mine.details[0], /^Every wake since .+ failed \(3 times\)\. Why: the helper that puts/);
    assert.equal((await readLink(p)).red, true, 'and the link on the page itself');
    await shot(p, 'health-failing');
    await shot(topic, 'health-link-lit');
    assert.deepEqual([...p.errors, ...topic.errors], []);
  });

  await check('health a wake that gets through clears the page and the link, live', async () => {
    const topic = await page('health-through-topic', null, true);
    await ready(topic);
    const p = await healthPage('health-through');
    assert.equal((await readLink(p)).red, true);
    await control({ method: 'health', action: 'through' });
    await until(async () => !(await readLink(p)).red, 'the link goes quiet on the commit');
    assert.equal((await readLink(p)).text, 'Health');
    const shown = await until(async () => { const s = await readPage(p); return s.bad === false && s; }, 'the page clears');
    assert.deepEqual(shown.top, ['Everything is working: the agent runner is sending wakes and they are getting through.']);
    assert.equal(line(shown, `agent:${agent}`).bad, false);
    assert.deepEqual((await view('health', {})).red, []);
    // The topic page behind finds its link quiet when it comes back.
    await topic.send('Page.bringToFront');
    await until(async () => !(await readLink(topic)).red, 'and on the topic page');
    assert.deepEqual([...p.errors, ...topic.errors], []);
  });

  // Item 628: the link is the last of the rail's foot, below the side rail's last section (the outline, in the
  // drawer on a phone). Lit, it keeps the alert colour there and opens Health, at every phone width and a laptop, in
  // light and dark. It needs the runner the fixture starts in "the link is quiet while nothing is red": run alone, run
  // that case with it.
  await check('health lit at the foot of the side rail, below its last section, keeps the alert colour and opens Health, at 320, 375, 390 and a laptop, light and dark', async () => {
    const sizes = [['320', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }], ['375', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }],
      ['390', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], ['laptop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }]];
    // Where the link is, read from the page as drawn: in the rail, the last of the three under the workspace name, and
    // below everything else on show there.
    const placed = p => p.evaluate(`(()=>{const a=document.getElementById('health-link'),foot=a.parentElement,rail=document.getElementById('rail'),shown=e=>e.getClientRects().length>0;
      const others=[...rail.children].filter(e=>e!==foot&&shown(e)),top=foot.getBoundingClientRect().top;
      return {inRail:foot.parentElement===rail,last:foot.lastElementChild===a,afterName:Boolean(foot.querySelector('#instance-label ~ #health-link')),
        below:others.length>0&&others.every(e=>top>=e.getBoundingClientRect().bottom-0.5),order:[...rail.children].filter(shown).map(e=>e.id||e.classList[0])}})()`);
    await control({ method: 'health', action: 'fail', count: 3, reason: 'deadline' });
    try {
      for (const [width, metrics] of sizes) {
        for (const theme of ['light', 'dark']) {
          const where = `${width} ${theme}`;
          const p = await page(`health-foot-${width}-${theme}`, null, true, { url: facts.origin + '/?topic=t1', beforeNavigate: async q => {
            await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            await q.send('Emulation.setDeviceMetricsOverride', metrics);
            if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
          } });
          await ready(p);
          // A finger on a phone, the mouse on a laptop, on the middle of what the selector names, once it is in view.
          const press = async selector => {
            await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
            if (!metrics.mobile) return p.point(selector);
            const b = await p.box(selector), x = b.x + b.width / 2, y = b.y + b.height / 2;
            assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x}, ${y}))`), true, `${where}: nothing covers ${selector}`);
            await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          };
          if (metrics.mobile) {
            await press('#rail-open');
            await until(() => quiet(p, "document.getElementById('rail').classList.contains('open')"), `${where}: "☰ Outcomes" opens the drawer`);
          }
          const lit = await until(async () => { const l = await readLink(p); return l.red && l; }, `${where}: the link is lit`);
          await p.evaluate("document.getElementById('health-link').scrollIntoView({block:'center'})");
          await shot(p, `health-foot-${width}-${theme}`);
          const at = await placed(p);
          assert.deepEqual([lit.text, lit.label], ['Health · needs attention', 'Health: something needs attention'], `${where}: it says so in words`);
          assert.equal(lit.color, lit.alert, `${where}: in the theme's alert colour`);
          assert.deepEqual(lit.edges, ['0px', '0px'], `${where}: no edge or box of its own`);
          assert.deepEqual([at.inRail, at.last, at.afterName, at.below], [true, true, true, true],
            `${where}: the last line of the rail's foot, under the workspace name, below the rail's last section: ${at.order.join(' ')}`);
          await press('#health-link');
          await until(() => quiet(p, `location.search === '?health' && document.body.dataset.ready === 'true' && document.getElementById('health-link').getAttribute('aria-current') === 'page'`),
            `${where}: a press opens Health, which marks its link as the page`);
          const there = await until(async () => { const l = await readLink(p); return l.red && l; }, `${where}: lit on Health too`);
          assert.equal(there.color, there.alert, `${where}: in the alert colour on Health`);
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      }
    } finally {
      await control({ method: 'health', action: 'through' });
    }
  });

  await check('health a paused runner is said at the top and lights the link; taking the role again clears it and says what it came back from', async () => {
    const p = await healthPage('health-paused');
    const paused = await control({ method: 'health', action: 'pause' });
    assert.equal(paused.status, 'paused');
    const shown = await until(async () => { const s = await readPage(p); return s.bad && s; }, 'the pause is said');
    assert.match(shown.top[0], /^The agent runner has been paused since \d+:\d\d [AP]M because an operator paused it, so no wakes are going out\. 1 agent has work waiting\.$/);
    assert.equal(line(shown, 'runner').bad, true);
    assert.equal((await view('health', {})).runner.why, 'an operator paused it');
    await until(async () => (await readLink(p)).red, 'the link lights');
    await shot(p, 'health-paused');
    assert.equal((await control({ method: 'health', action: 'resume', version: paused.version })).status, 'acquired');
    const back = await until(async () => { const s = await readPage(p); return s.bad === false && s; }, 'the page clears on the commit');
    assert.match(line(back, 'runner').summary, /^Agent runner: Has been running since/);
    await until(async () => !(await readLink(p)).red, 'the link goes quiet');
    // Its line opens to say what it came back from, in Core's words.
    await p.point(`details[data-key="runner"] summary`);
    const opened = await until(async () => { const s = await readPage(p); return line(s, 'runner').details.length && s; }, 'the runner line opens');
    assert.match(line(opened, 'runner').details[0], /^It came back at \d+:\d\d [AP]M after a pause at \d+:\d\d [AP]M because an operator paused it\.$/);
    assert.deepEqual(p.errors, []);
  });

  await check('health laptop and phone, light and dark: nothing sideways, no coloured edges, every line opens by touch', async () => {
    await control({ method: 'health', action: 'fail', count: 3, reason: 'deadline' });
    for (const [width, metrics] of [['laptop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
      for (const theme of ['light', 'dark']) {
        const where = `${width} ${theme}`;
        const p = await healthPage(`health-${width}-${theme}`, { beforeNavigate: async q => {
          await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          await q.send('Emulation.setDeviceMetricsOverride', metrics);
          if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        } });
        await until(async () => (await readPage(p)).bad, `${where}: the failing agent is said`);
        const layout = await p.evaluate(`(()=>{const doc=document.documentElement,top=document.querySelector('.health-top'),ts=getComputedStyle(top);
          const lines=[...document.querySelectorAll('.health-line')].map(d=>{const s=getComputedStyle(d),m=d.querySelector('summary'),r=m.getBoundingClientRect();return {left:s.borderLeftWidth,top:s.borderTopWidth,height:r.height,right:r.right}});
          const swatch=document.createElement('span');swatch.style.color='var(--alert)';document.body.append(swatch);const alert=getComputedStyle(swatch).color;swatch.remove();
          return {scroll:doc.scrollWidth,viewport:doc.clientWidth,topRight:top.getBoundingClientRect().right,topEdges:[ts.borderLeftWidth,ts.borderTopWidth],
            topColor:getComputedStyle(top.querySelector('p')).color,alert,body:getComputedStyle(document.body).backgroundColor,lines}})()`);
        assert.ok(layout.scroll <= layout.viewport, `${where}: no sideways scroll (${layout.scroll} > ${layout.viewport})`);
        assert.ok(layout.topRight <= layout.viewport, `${where}: what needs attention fits the page`);
        assert.equal(layout.topEdges[0], layout.topEdges[1], `${where}: no coloured left edge at the top`);
        assert.equal(layout.topColor, layout.alert, `${where}: the top says it in the theme's alert colour`);
        for (const item of layout.lines) {
          assert.equal(item.left, item.top, `${where}: no line has a coloured left edge`);
          assert.ok(item.right <= layout.viewport, `${where}: every line fits the page`);
          if (metrics.mobile) assert.ok(item.height >= 44, `${where}: every line is a touch target (${item.height}px)`);
        }
        const link = await readLink(p);
        assert.equal(link.color, link.alert, `${where}: the lit link in the theme's alert colour`);
        if (metrics.mobile) assert.ok(link.height >= 24, `${where}: the link can be tapped (${link.height}px)`);
        // Open the agent's line: by touch on the phone, by click on the laptop.
        const selector = `details[data-key="agent:${agent}"] summary`;
        await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        if (metrics.mobile) {
          const b = await p.box(selector), x = b.x + 12, y = b.y + b.height / 2;
          await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await p.point(selector);
        await until(() => p.evaluate(`document.querySelector('details[data-key="agent:${agent}"]').open`), `${where}: the line opens in place`);
        const opened = await p.evaluate(`(()=>{const d=document.querySelector('details[data-key="agent:${agent}"]');return {text:d.textContent,scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}})()`);
        assert.match(opened.text, /Why: the Codex app did not answer in time\./, `${where}: opened, it says why`);
        assert.ok(opened.scroll <= opened.viewport, `${where}: opened, still nothing sideways`);
        await shot(p, `health-${width}-${theme}`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    }
  });

  // Every read of the light fails while window.failLight is set, as when the server sheds background reads:
  // one asked while it is set, and one asked before it was set and answered after, which may have been read
  // in Core at a commit that came after the switch.
  const failing = `(()=>{const fetch=window.fetch.bind(window);window.failLight=true;const refused=()=>new TypeError('Failed to fetch');
    window.fetch=(input,init)=>{if(!String(init?.body??'').includes('"health_light"'))return fetch(input,init);
      if(window.failLight)return Promise.reject(refused());
      return fetch(input,init).then(async response=>{if(!window.failLight)return response;await response.arrayBuffer().catch(()=>{});throw refused();});};})()`;
  // The live feed's messages lose what is red while window.stripHealth is set, as an older server's carry none.
  const stripping = `(()=>{const Real=window.WebSocket;window.stripHealth=true;
    const Socket=function(url,protocols){const socket=new Real(url,protocols);let handler=null;
      Object.defineProperty(socket,'onmessage',{configurable:true,get(){return handler},set(f){handler=f}});
      socket.addEventListener('message',e=>{if(!handler)return;let data=e.data;if(window.stripHealth){try{const m=JSON.parse(data);delete m.health;data=JSON.stringify(m)}catch{}}handler({data})});
      return socket;};
    Socket.prototype=Real.prototype;Object.assign(Socket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});window.WebSocket=Socket;})()`;

  await check('health the link follows what is red from the live feed alone, with every read of it failing', async () => {
    const p = await page('health-feed-only', null, true, { beforeNavigate: q => q.send('Page.addScriptToEvaluateOnNewDocument', { source: failing }) });
    await ready(p);
    const lit = await until(async () => { const l = await readLink(p); return l.text === 'Health · needs attention' && l; }, 'the feed\'s first number says what is red, though the read failed');
    assert.equal(lit.red, true);
    assert.deepEqual((await view('health_light', {})).red, [`failing:${agent}`]);
    await control({ method: 'health', action: 'through' });
    await until(async () => (await readLink(p)).text === 'Health', 'quiet on the commit that cleared it, from the feed');
    await control({ method: 'health', action: 'fail', count: 3, reason: 'deadline' });
    await until(async () => (await readLink(p)).text === 'Health · needs attention', 'lit again on the commit, from the feed');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('health on a server whose feed does not say what is red, a link that cannot read it says it could not check, and is quiet only after a read that says nothing is', async () => {
    // On the Health page the light's reads are the only background reads after the page loads, so the
    // server's background lane (one read, two waiting) never refuses one. A topic page reads several
    // views in the background on every commit, and a wake that gets through is four commits: those
    // reads can fill the lane, and a refused read leaves the link saying it could not check until the
    // next commit (docs/health.md), which this check would wait for in vain.
    const p = await page('health-unread', null, true, { url: facts.origin + '/?health', beforeNavigate: async q => {
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: failing });
      await q.send('Page.addScriptToEvaluateOnNewDocument', { source: stripping });
    } });
    await ready(p);
    const unread = await until(async () => { const l = await readLink(p); return l.text !== 'Health · checking' && l; }, 'the first read of the light settles');
    assert.deepEqual([unread.text, unread.red, unread.label], ["Health · couldn't check", true, 'Health: it could not be checked, so something may need attention']);
    assert.equal(unread.color, unread.alert, 'in the alert colour: something may be red that it cannot see');
    await p.evaluate('window.failLight = false');
    await control({ method: 'health', action: 'renew' });
    await until(async () => (await readLink(p)).text === 'Health · needs attention', 'a read that answers says what Core says is red');
    await control({ method: 'health', action: 'through' });
    await until(async () => (await readLink(p)).text === 'Health', 'and quiet once a read says nothing is red');
    assert.deepEqual((await view('health_light', {})).red, []);
    await p.evaluate('window.failLight = true');
    await control({ method: 'health', action: 'renew' });
    const again = await until(async () => { const l = await readLink(p); return l.text !== 'Health' && l; }, 'a failed read after a quiet one');
    assert.deepEqual([again.text, again.red], ["Health · couldn't check", true], 'a quiet link whose next read fails does not stay quiet');
    await shot(p, 'health-link-unread');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('health a runner that stops renewing lights the link with no other commit, and Core keeps when it is to be told', async () => {
    const p = await page('health-hung', null, true);
    await ready(p);
    await until(async () => (await readLink(p)).text === 'Health', 'the link is quiet');
    const before = await control({ method: 'health', action: 'settled' });
    assert.deepEqual(before.announced, []);
    // The runner renews for one second, then never again; its process lives, so no exit is recorded.
    const hung = await control({ method: 'health', action: 'hang' });
    assert.equal(hung.status, 'renewed');
    const lit = await until(async () => { const l = await readLink(p); return l.text === 'Health · needs attention' && l; }, 'the link lights when the lease runs out');
    assert.equal(lit.color, lit.alert);
    const facts = await view('health', {});
    assert.deepEqual([facts.red, facts.runner.state], [['runner'], 'unrenewed']);
    // The server, at the lease's end, Core's kept moment, had Core settle what is red on a commit of its
    // own; the team is told once no runner has followed it for the handover (two minutes), Core's next moment.
    const settled = await control({ method: 'health', action: 'settled' });
    assert.deepEqual(settled.announced, []);
    assert.equal(settled.due, hung.lease_until_ms + 120000);
    assert.deepEqual(settled.events.slice(before.events.length).map(event => [event.event, event.due_ms, event.record.status]),
      [['health_due', hung.lease_until_ms, 'settled']]);
    assert.equal((await control({ method: 'health', action: 'take' })).status, 'acquired');
    await until(async () => (await readLink(p)).text === 'Health', 'a runner taking the role clears it');
    assert.deepEqual((await control({ method: 'health', action: 'settled' })).announced, []);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('health while the live feed is down the link says it could not check, as the page says at its top, and once it is back says what is red at once, never its answer from before', async () => {
    // The page's live socket can be closed, and new ones refused, as when the server cannot be reached.
    const sockets = `(()=>{const Real=window.WebSocket;window.liveSockets=[];window.liveBlocked=false;
      const Socket=function(url,protocols){if(window.liveBlocked)throw new Error('unreachable');const socket=new Real(url,protocols);window.liveSockets.push(socket);return socket;};
      Socket.prototype=Real.prototype;Object.assign(Socket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});window.WebSocket=Socket;})()`;
    const p = await healthPage('health-feed-down', { beforeNavigate: q => q.send('Page.addScriptToEvaluateOnNewDocument', { source: sockets }) });
    assert.deepEqual((await view('health_light', {})).red, []);
    await until(async () => (await readLink(p)).text === 'Health', 'the link is quiet while the feed is up');
    await p.evaluate('(()=>{window.liveBlocked=true;for(const socket of window.liveSockets)socket.close();return true})()');
    const down = await until(async () => { const l = await readLink(p); return l.text !== 'Health' && l; }, 'the link says it when the feed drops');
    assert.deepEqual([down.text, down.red, down.label], ["Health · couldn't check", true, 'Health: it could not be checked, so something may need attention']);
    assert.equal(down.color, down.alert, 'in the alert colour');
    const shown = await readPage(p);
    assert.equal(shown.top[0], 'This page has lost its live connection to the server, so what it shows may be out of date.', 'the page says the same at its top');
    assert.equal(line(shown, 'server').bad, true);
    await shot(p, 'health-feed-down');
    // While it is down, wakes fail: the link must never show its quiet answer from before the drop as current.
    await control({ method: 'health', action: 'fail', count: 3, reason: 'deadline' });
    await p.evaluate(`(()=>{const a=document.getElementById('health-link');window.linkSaid=[a.textContent];
      new MutationObserver(()=>window.linkSaid.push(a.textContent)).observe(a,{childList:true,characterData:true,subtree:true});return true})()`);
    await p.evaluate('window.liveBlocked = false');
    await until(async () => (await readLink(p)).text === 'Health · needs attention', 'lit once the feed is back, from its first number');
    const said = await p.evaluate('window.linkSaid');
    assert.ok(!said.includes('Health'), `never quiet between the drop and the read after it: ${JSON.stringify(said)}`);
    await until(async () => { const s = await readPage(p); return s.bad && s.top.some(words => words.includes("can't be woken")) && s; }, 'the page says it');
    await control({ method: 'health', action: 'through' });
    await until(async () => (await readLink(p)).text === 'Health', 'quiet again once a wake gets through');
    const back = await until(async () => { const s = await readPage(p); return s.bad === false && s; }, 'and the page clears');
    assert.deepEqual(back.top, ['Everything is working: the agent runner is sending wakes and they are getting through.']);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('health a release from a merged train says no release check ran here and its hosted judgment, at every phone width and a laptop, light and dark', async () => {
    // Each state of the release line a deploy's record gives (aim_next/health.py, web/health.mjs): an ordinary train
    // whose hosted judgment is pending, then attached; a train judged before its merge; and, the negative, a release
    // check's record, which still says its counts passed. Each is read on a page open at 320, 375 and 390 px phone
    // widths and a laptop, in light, and at 320 px and the laptop in dark, as each page reads again.
    const sizes = [['320', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, 'light'], ['375', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }, 'light'],
      ['390', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, 'light'], ['laptop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, 'light'],
      ['320', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }, 'dark'], ['laptop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, 'dark']];
    const pages = [];
    for (const [width, metrics, theme] of sizes) {
      const p = await healthPage(`health-train-${width}-${theme}`, { beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', metrics);
        if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      pages.push({ p, where: `${width} ${theme}`, width, theme, mobile: metrics.mobile });
    }
    const readRelease = p => p.evaluate(`(()=>{const d=document.querySelector('details[data-key="release"]');if(!d)return null;const m=d.querySelector('summary'),r=m.getBoundingClientRect(),s=getComputedStyle(d);
      return {open:d.open,summary:m.textContent,details:[...d.querySelectorAll('p')].map(n=>n.textContent),height:r.height,right:d.getBoundingClientRect().right,
        left:s.borderLeftWidth,top:s.borderTopWidth,scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}})()`);
    const latest = (await view('health', {})).release;
    let number = (latest?.release ?? 29) + 1, previous = latest?.commit ?? 'e'.repeat(40);
    const sha = n => n.toString(16).padStart(40, '0');
    const record = async measurements => {
      const commit = sha(number);
      await control({ method: 'targets', operation_id: `health-train-release-${number}`, kind: 'release',
        record: { release: number, commit, previous, deployed_at: '2026-11-14T05:00:00-08:00', items: [number + 451], measurements, source: 'deploy', evidence: null } });
      previous = commit;
      // An item ships in one release, so each record ships its own.
      return { release: number, commit, shipped: `It shipped pipeline item ${451 + number++}.` };
    };
    const train = (kind, judgment, commit) => ({ train: { file: '/abs/train.json', pr: 31, kind, merge_commit: commit, merged_tree: 'f'.repeat(40), release_branch: 'release/live73',
      items: [{ item: 481, approved_head: 'd'.repeat(40), review: 'm-review' }], hosted_run: null, judgment } });
    const judged = (head, conclusions) => ({ head, audit: 'm-audit',
      producer_runs: [{ id: 101, kind: 'run', name: 'Checks', head_sha: head, status: 'completed', conclusion: conclusions[0] }],
      verdict_checks: conclusions.slice(1).map((conclusion, i) => ({ id: 201 + i, kind: 'check', name: 'Verdict', head_sha: head, status: 'completed', conclusion })) });
    // A page in a tab behind reads again when it is shown (followCommits, web/app.mjs); the one in front follows the
    // live feed. Each page is brought to the front before it is read.
    const front = async page => {
      await page.p.send('Page.bringToFront');
      await until(() => page.p.evaluate("document.visibilityState==='visible'"), `${page.where}: the page is in front`);
    };
    // Every page shows release `release` with exactly `details`, the line opened in place and fitting the page.
    const shows = async (release, details, label) => {
      for (const page of pages) {
        await front(page);
        // A page brought forward still shows what it read before until its read again lands: wait for these words.
        let seen = null;
        const line = await until(async () => { const l = seen = await readRelease(page.p);
          return l && l.summary.startsWith(`Latest release: Release ${release} went live at `) && JSON.stringify(l.details) === JSON.stringify(details) && l; },
          `${page.where}: ${label}: the release line repaints to release ${release} with ${JSON.stringify(details)}`).catch(error => {
          throw Error(`${error.message}; it shows ${JSON.stringify(seen)}`); });
        if (!line.open) {
          const selector = 'details[data-key="release"] summary';
          await page.p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
          if (page.mobile) {
            const b = await page.p.box(selector), x = b.x + 12, y = b.y + b.height / 2;
            await page.p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await page.p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else await page.p.point(selector);
          await until(async () => (await readRelease(page.p)).open, `${page.where}: ${label}: the release line opens in place`);
        }
        const shown = await readRelease(page.p);
        assert.deepEqual(shown.details, details, `${page.where}: ${label}`);
        assert.ok(shown.scroll <= shown.viewport, `${page.where}: ${label}: nothing sideways (${shown.scroll} > ${shown.viewport})`);
        assert.ok(shown.right <= shown.viewport, `${page.where}: ${label}: the line fits the page`);
        assert.equal(shown.left, shown.top, `${page.where}: ${label}: no coloured left edge`);
        if (page.mobile) assert.ok(shown.height >= 44, `${page.where}: ${label}: the line is a touch target (${shown.height}px)`);
        if (page.width === '320' || page.width === 'laptop') {
          await page.p.evaluate(`document.querySelector('details[data-key="release"]').scrollIntoView({block:'center'})`);
          await shot(page.p, `health-train-${label}-${page.width}-${page.theme}`);
        }
      }
    };
    const pending = await record(train('ordinary', 'pending', sha(number)));
    await shows(pending.release, ['It came from a merged train, so no release check ran here.', 'Its hosted judgment is still pending.', pending.shipped], 'pending');
    await control({ method: 'targets', operation_id: `health-train-judgment-${pending.release}`, kind: 'attach_judgment', release: pending.release,
      judgment: judged(pending.commit, ['success', 'failure']) });
    // Attaching the judgment is a commit: the page in front, the last one read, repaints with it from the live feed;
    // each other page reads it when shown.
    const inFront = pages[pages.length - 1];
    await until(async () => (await readRelease(inFront.p)).details.includes('Its hosted judgment: 1 of 2 runs and checks succeeded.'),
      `${inFront.where}: the attached judgment repaints the release line from the live feed`);
    await shows(pending.release, ['It came from a merged train, so no release check ran here.', 'Its hosted judgment: 1 of 2 runs and checks succeeded.', pending.shipped], 'attached');
    const first = await record(train('judged-first', judged('c'.repeat(40), ['success', 'success']), sha(number)));
    await shows(first.release, ['It came from a merged train judged before its merge, so no release check ran here.', 'That judgment: 2 of 2 runs and checks succeeded.', first.shipped], 'judged-first');
    const checked = await record({ release_check: { commit: null, started_at: null, finished_at: null }, python_units: { tests: 1106 }, node_units: { tests: 740, pass: 740 }, native: { pass: 208, total: 208, steps: {} } });
    await shows(checked.release, ['Its release check: 1,106 Python, 740 Node and 208 of 208 browser checks passed.', checked.shipped], 'release-check');
    for (const page of pages) { assert.deepEqual(page.p.errors, [], page.where); await page.p.close(); }
  });

  await check('health a release deployed on a scoped run says how many browser steps ran and that its full run is pending, then what its full run found, at every phone width and a laptop, light and dark', async () => {
    // Item 608: a small fix's release keeps its release check's counts beside the steps it did not run, and its full
    // run follows on the deployed head (aim_next/health.py, web/health.mjs). Each state of the release line is read on a
    // page of its own at 320, 375 and 390 px and a laptop, light and dark, one page at a time, so no page waits behind
    // others for its reads; the shot of each page is taken before its words are asserted, so a page that says
    // something else is kept too. One laptop page stays open across the full run's landing and repaints from the live feed.
    const SIZES = [['320', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true }], ['375', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }],
      ['390', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }], ['laptop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }]];
    const open = async (label, width, metrics, theme) => {
      const p = await healthPage(`health-scoped-${label}-${width}-${theme}`, { beforeNavigate: async q => {
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await q.send('Emulation.setDeviceMetricsOverride', metrics);
        if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      return { p, where: `${width} ${theme}`, width, theme, mobile: metrics.mobile };
    };
    const readRelease = p => p.evaluate(`(()=>{const d=document.querySelector('details[data-key="release"]');if(!d)return null;const m=d.querySelector('summary'),r=m.getBoundingClientRect(),s=getComputedStyle(d);
      return {open:d.open,summary:m.textContent,details:[...d.querySelectorAll('p')].map(n=>n.textContent),height:r.height,right:d.getBoundingClientRect().right,
        left:s.borderLeftWidth,top:s.borderTopWidth,scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}})()`);
    const latest = (await view('health', {})).release;
    const number = (latest?.release ?? 29) + 1, commit = number.toString(16).padStart(40, '0');
    const shipped = `It shipped pipeline item ${number + 600}.`;
    // The page shows the release line once `ready` holds of it, opened in place, its shot taken, and then exactly
    // `details`, fitting the page.
    const shows = async (page, details, label, ready) => {
      let seen = null;
      const line = await until(async () => { const l = seen = await readRelease(page.p); return l && ready(l) && l; },
        `${page.where}: ${label}: the release line shows release ${number}`).catch(error => { throw Error(`${error.message}; it shows ${JSON.stringify(seen)}`); });
      if (!line.open) {
        const selector = 'details[data-key="release"] summary';
        await page.p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        if (page.mobile) {
          const b = await page.p.box(selector), x = b.x + 12, y = b.y + b.height / 2;
          await page.p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          await page.p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await page.p.point(selector);
        await until(async () => (await readRelease(page.p)).open, `${page.where}: ${label}: the release line opens in place`);
      }
      await page.p.evaluate(`document.querySelector('details[data-key="release"]').scrollIntoView({block:'center'})`);
      await shot(page.p, `health-scoped-${label}-${page.width}-${page.theme}`);
      const shown = await readRelease(page.p);
      assert.deepEqual(shown.details, details, `${page.where}: ${label}`);
      assert.ok(shown.scroll <= shown.viewport, `${page.where}: ${label}: nothing sideways (${shown.scroll} > ${shown.viewport})`);
      assert.ok(shown.right <= shown.viewport, `${page.where}: ${label}: the line fits the page`);
      assert.equal(shown.left, shown.top, `${page.where}: ${label}: no coloured left edge`);
      if (page.mobile) assert.ok(shown.height >= 44, `${page.where}: ${label}: the line is a touch target (${shown.height}px)`);
    };
    const closed = async page => { assert.deepEqual(page.p.errors, [], page.where); await page.p.close(); };
    // Open before the release is written: this page learns of it, and later of its full run, from the live feed.
    const kept = await open('live', 'laptop', SIZES[3][1], 'light');
    await until(async () => Boolean(await readRelease(kept.p)) || latest === null, 'the Health page is up');
    await control({ method: 'targets', operation_id: `health-scoped-release-${number}`, kind: 'release',
      record: { release: number, commit, previous: latest?.commit ?? 'e'.repeat(40), deployed_at: '2026-11-16T10:00:00-08:00', items: [number + 600], source: 'deploy', evidence: null,
        measurements: { release_check: { commit: null, started_at: null, finished_at: null }, python_units: { tests: 1106 }, node_units: { tests: 740, pass: 740 },
          native: { pass: 12, total: 12, steps: { health: { pass: 12, total: 12 } } },
          scoped: { live: 'e'.repeat(40), changed: ['web/aim.css', 'docs/health.md'], steps: ['native-health'], not_run: ['native-journal', 'native-colors', 'native-rail'], full_judgment: 'pending' } } } });
    const ran = "It deployed on a scoped run: 1 of 4 browser steps, the ones its files touch, beside the units, the deploy's refusals and the wake replay.";
    const counts = 'Its release check: 1,106 Python, 740 Node and 12 of 12 browser checks passed.';
    const titled = line => line.summary.startsWith(`Latest release: Release ${number} went live at `);
    await shows(kept, [ran, counts, 'Its full run is still pending.', shipped], 'live-pending', titled);
    for (const theme of ['light', 'dark']) for (const [width, metrics] of SIZES) {
      const page = await open('pending', width, metrics, theme);
      await shows(page, [ran, counts, 'Its full run is still pending.', shipped], 'pending', titled);
      await closed(page);
    }
    // The full run lands on the deployed head: one producer run that succeeded and one verdict check that failed.
    await control({ method: 'targets', operation_id: `health-scoped-judgment-${number}`, kind: 'attach_judgment', release: number,
      judgment: { head: commit, audit: 'm-audit', producer_runs: [{ id: 101, kind: 'run', name: 'Checks', head_sha: commit, status: 'completed', conclusion: 'success' }],
        verdict_checks: [{ id: 201, kind: 'check', name: 'Verdict', head_sha: commit, status: 'completed', conclusion: 'failure' }] } });
    const judged = 'Its full run: 1 of 2 runs and checks succeeded.';
    // Attaching it is a commit: the page left open repaints from the live feed, with no reload.
    await shows(kept, [ran, counts, judged, shipped], 'live-judged', line => line.details.includes(judged));
    await closed(kept);
    for (const theme of ['light', 'dark']) for (const [width, metrics] of SIZES) {
      const page = await open('judged', width, metrics, theme);
      await shows(page, [ran, counts, judged, shipped], 'judged', titled);
      await closed(page);
    }
  });
}
