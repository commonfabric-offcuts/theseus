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
    await p.send('Page.reload');await ready(p);
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
    const loaded = await p.evaluate('performance.timeOrigin');
    await p.send('Page.bringToFront');
    const shown = await until(async () => { const s = await readPage(p); return s.bad && s; }, 'the Health page says it');
    assert.equal(await p.evaluate('performance.timeOrigin'), loaded, 'the Health page was not reloaded');
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
}
