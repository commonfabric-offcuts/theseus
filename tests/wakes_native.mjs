import assert from 'node:assert/strict';

// Wakes observed in the real browser against the real server (pipeline items
// 34 and 35). An agent that stopped picking up its wakes says so after its
// name, in the warning colour and no box or edge of its own; when the agent
// runner is killed the outcome's owner sees one notice saying so, and the
// agent's name says wakes are paused rather than blaming it; when a runner
// takes the role again the notice goes, live, with no reload, and on the
// outcomes page as soon as the person goes back to it.
export async function wakesChecks({ check, page, until, control, view, facts, shot }) {
  const agent = facts.agent;
  const chip = `[...document.querySelectorAll('#participants .person-pill')].find(c=>c.textContent.startsWith(${JSON.stringify(agent)}))`;
  const readChip = p => p.evaluate(`(()=>{const c=${chip};const l=c?.querySelector('.wake-light');if(!c)return null;const s=l&&getComputedStyle(l),b=getComputedStyle(c);
    return {text:c.textContent,light:l?.textContent??null,color:s?.color??null,warn:getComputedStyle(document.documentElement).getPropertyValue('--warn').trim(),
      ink:getComputedStyle(c).color,lightBorder:s?[s.borderLeftWidth,s.borderLeftStyle]:null,chipLeft:[b.borderLeftWidth,b.borderTopWidth]}})()`);
  const readNotice = p => p.evaluate(`(()=>{const n=document.getElementById('wakes-status');const s=getComputedStyle(n),b=n.getBoundingClientRect();
    return {hidden:n.hidden,text:n.textContent,role:n.getAttribute('role'),left:[s.borderLeftWidth,s.borderTopWidth],width:b.width,
      viewport:document.documentElement.clientWidth,top:b.top,header:document.querySelector('.app-header').getBoundingClientRect().bottom}})()`);
  // The swatch of the warning colour, as the browser resolves it, to compare with the light's.
  const resolved = (p, value) => p.evaluate(`(()=>{const e=document.createElement('span');e.style.color=${JSON.stringify(value)};document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c})()`);

  await check('wakes a parked agent says on its name since when it has not answered and what waits', async () => {
    assert.equal((await control({ method: 'wakes', action: 'route' })).status, 'provisioned');
    await control({ method: 'agent_message', operation_id: 'wakes-person-asks', body: 'Over to you.', topic_id: 't1', sender: 'person', addressees: [agent] });
    assert.equal((await control({ method: 'wakes', action: 'runner_live' })).status, 'acquired');
    await control({ method: 'wakes', action: 'park' });
    const quiet = (await view('wakes', {})).quiet;
    assert.deepEqual(quiet.map(q => [q.actor_id, q.why]), [[agent, 'not_answering']]);
    const p = await page('wakes-parked', null, true);
    const shown = await until(async () => { const c = await readChip(p); return c?.light && c; }, 'the agent chip carries its light');
    assert.match(shown.light, new RegExp(`^ · not answering since \\d+:\\d\\d [AP]M .+ · ${quiet[0].waiting} waiting$`));
    assert.equal(shown.color, await resolved(p, shown.warn), 'the light is in the warning colour');
    assert.notEqual(shown.color, shown.ink, 'and stands apart from the name');
    assert.deepEqual(shown.lightBorder, ['0px', 'none'], 'no edge of its own');
    assert.equal(shown.chipLeft[0], shown.chipLeft[1], 'the chip keeps one border all round, no coloured left edge');
    assert.equal((await readNotice(p)).hidden, true, 'no notice while wakes go out');
    await shot(p, 'wakes-parked-chip');
    assert.deepEqual(p.errors, []);
  });

  await check('wakes a killed runner tells the owner wakes are not going out, live, and the name stops blaming the agent', async () => {
    const p = await page('wakes-killed', null, true);
    await until(async () => (await readChip(p))?.light, 'the parked light first');
    assert.equal((await control({ method: 'wakes', action: 'runner_killed' })).status, 'recorded');
    const notice = await until(async () => { const n = await readNotice(p); return !n.hidden && n; }, 'the notice appears on the commit');
    assert.match(notice.text, /^Wakes are not going out: the agent runner was killed at \d+:\d\d [AP]M .+\. 1 agent has work waiting\.$/);
    assert.equal(notice.role, 'status');
    assert.equal(notice.left[0], notice.left[1], 'one border all round, no coloured left edge');
    assert.ok(notice.top >= notice.header, 'below the header');
    assert.ok(notice.width <= notice.viewport, 'within the page');
    const shown = await until(async () => { const c = await readChip(p); return /wakes paused/.test(c?.light ?? '') && c; }, 'the name says wakes are paused');
    assert.match(shown.light, /^ · wakes paused · \d+ waiting$/);
    await shot(p, 'wakes-runner-killed');
    assert.deepEqual(p.errors, []);
  });

  await check('wakes the notice goes when a runner takes the role again, and the outcomes page says the same', async () => {
    const home = await page('wakes-home', null, true, { url: facts.origin + '/' });
    await until(async () => !(await readNotice(home)).hidden, 'the outcomes page shows the notice');
    const p = await page('wakes-back', null, true);
    await until(async () => !(await readNotice(p)).hidden, 'the topic page shows the notice');
    assert.equal((await control({ method: 'wakes', action: 'runner_live' })).status, 'acquired');
    await until(async () => (await readNotice(p)).hidden, 'the notice goes on the commit');
    assert.equal((await readNotice(p)).text, '');
    // The agent is still parked: with wakes going out, its own light comes back.
    await until(async () => /not answering since/.test((await readChip(p))?.light ?? ''), 'the parked light again');
    await shot(p, 'wakes-runner-back');
    // The outcomes page, in the tab behind, reads nothing while hidden; going
    // back to it, the person finds the notice gone there too, with no reload.
    assert.equal(await home.evaluate('document.visibilityState'), 'hidden', 'the outcomes page is the tab behind');
    const loaded = await home.evaluate('performance.timeOrigin');
    await home.send('Page.bringToFront');
    await until(async () => (await readNotice(home)).hidden, 'and on the outcomes page');
    assert.equal(await home.evaluate('performance.timeOrigin'), loaded, 'the outcomes page was not reloaded');
    assert.deepEqual([...home.errors, ...p.errors], []);
  });
}
