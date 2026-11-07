import assert from 'node:assert/strict';

// The outcome light in the real browser against the real server (item 86): the
// words of each light on the Outcomes home, the peek under a real pointer and
// keyboard, and an outcome's own questions said once on its page. The peek's
// rule is checked both ways, each step by real pointer in small steps, as a
// hand moves: it touches its row, it holds while the pointer crosses from the
// row onto it and back, and leaving both, or Escape, closes it.
export async function lightChecks({ check, page, until, control, view, facts, shot }) {
  const rowOf = id => `#workspaces a[data-workspace-id="${id}"]`;
  const outcomes = async () => new Set((await view('workspaces', { limit: 100 })).items.map(item => item.id));
  // Each case makes what it needs, so it runs alone as well as after the others.
  const ensure = async (id, title, topic = null, ask = null) => {
    if ((await outcomes()).has(id)) return;
    await control({ method: 'light_outcome', outcome: id, title, topic });
    if (ask) await control({ method: 'agent_message', operation_id: 'light-ask-' + id, body: ask, topic_id: topic.id, source: 'topic', addressees: [facts.actor], intent: 'ask' });
  };
  const pitch = () => ensure('light-pitch', 'Pitch deck', { id: 'light-notes', title: 'Speaker notes' }, 'Which order for the slides?');
  const standing = (p, id) => p.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(rowOf(id))});if(!a)return null;const s=a.querySelector('small.standing');if(!s)return null;
    const lamp=s.querySelector('.outcome-light'),c=lamp?getComputedStyle(lamp):null;
    return {text:s.textContent,light:s.dataset.light,lamp:lamp?{light:lamp.dataset.light,fill:c.backgroundColor,border:c.borderTopStyle,halo:c.boxShadow,inFirst:lamp.parentElement.classList.contains('what')}:null,
      whole:[...s.querySelectorAll('.what,.when')].map(e=>getComputedStyle(e).whiteSpace)}})()`);
  const sideways = p => p.evaluate('document.documentElement.scrollWidth - innerWidth');
  const phone = async q => {
    await q.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await q.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  };

  await check('light the Outcomes home says each light in its words, and lists every question with its outcome', async () => {
    await pitch();
    await ensure('light-hand', 'Team handbook', { id: 'light-sections', title: 'Sections' });
    await ensure('light-board', 'Board prep');
    const p = await page('light-home', null, true, { url: facts.origin + '/' });
    await until(async () => (await standing(p, 'light-pitch'))?.light === 'waiting', 'the outcomes are listed with their lights');
    const [waiting, built, quiet, home] = [await standing(p, 'light-pitch'), await standing(p, 'light-hand'), await standing(p, 'light-board'), await standing(p, 'w1')];
    assert.equal(waiting.text, 'Waiting on you · 1 question');
    assert.match(built.text, /^Worked on at \d{1,2}:\d{2}\s[AP]M$/);
    assert.equal(built.light, 'built');
    assert.equal(quiet.text, 'No topics yet');
    assert.equal(quiet.light, 'quiet');
    assert.ok(home.lamp && home.text.length > 0, 'every row carries a light and its words: ' + JSON.stringify(home));
    // Only Waiting on you is lit; the others are grey shapes, each with its words beside it.
    assert.notEqual(waiting.lamp.fill, 'rgba(0, 0, 0, 0)', 'waiting on you is filled');
    assert.notEqual(waiting.lamp.halo, 'none', 'with a halo');
    assert.deepEqual([built.lamp.fill, built.lamp.border], ['rgba(0, 0, 0, 0)', 'solid'], 'being worked on is a hollow ring');
    assert.deepEqual([quiet.lamp.fill, quiet.lamp.border], ['rgba(0, 0, 0, 0)', 'dashed'], 'quiet is a dashed ring');
    for (const row of [waiting, built, quiet]) {
      assert.equal(row.lamp.inFirst, true, 'the light stays with the first piece');
      assert.ok(row.whole.length && row.whole.every(value => value === 'nowrap'), 'each piece stays whole: ' + JSON.stringify(row.whole));
    }
    // The whole list of questions stays on the Outcomes home, each saying which outcome it is in.
    const list = await p.evaluate(`(()=>{const h=document.querySelector('#waiting-on-you');return {hidden:h.hidden,heading:h.querySelector('h2')?.textContent,rows:[...h.querySelectorAll('li')].map(li=>li.textContent)}})()`);
    assert.equal(list.hidden, false);
    assert.equal(list.heading, 'Waiting on you (1)');
    assert.equal(list.rows.length, 1);
    assert.match(list.rows[0], /^Speaker notes, in Pitch deck — fixture-notebook-agent asked at \d{1,2}:\d{2}\s[AP]M$/);
    assert.ok(await sideways(p) <= 0, 'no sideways scroll at 1440');
    await shot(p, 'light-home');
    assert.deepEqual(p.errors, []);
    await p.close();
    // On a phone the short words are always under the name, and nothing scrolls sideways.
    const small = await page('light-home-phone', null, true, { url: facts.origin + '/', beforeNavigate: phone });
    await until(async () => (await standing(small, 'light-pitch'))?.text === 'Waiting on you · 1 question', 'phone: the words under the name');
    const shown = await small.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(rowOf('light-pitch') + ' small.standing')}).getBoundingClientRect();return [b.width,b.height,b.right<=innerWidth]})()`);
    assert.ok(shown[0] > 0 && shown[1] > 0 && shown[2], 'phone: the words show inside the screen: ' + shown);
    assert.ok(await sideways(small) <= 0, 'no sideways scroll at 390');
    await shot(small, 'light-home-phone');
    assert.deepEqual(small.errors, []);
    await small.close();
  });

  await check('light the peek opens by real pointer, touches its row, holds from the row onto it and back, and closes on leaving both or Escape', async () => {
    await ensure('light-peek', 'Peek outcome', { id: 'light-peek-topic', title: 'Peek topic' });
    await ensure('light-later', 'Later outcome');
    // A page inside an outcome lists no outcomes; the new outcome page keeps them in its rail.
    const p = await page('light-peek', null, true, { url: facts.origin + '/?new=outcome&intent=light-peek' });
    const row = rowOf('light-peek');
    await until(async () => (await standing(p, 'light-peek'))?.light === 'built', 'the sidebar lists the outcome with its light');
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center'})`);
    const tip = () => p.evaluate(`(()=>{const t=document.querySelector('#light-tip');if(t.hidden)return null;const b=t.getBoundingClientRect();
      return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,name:t.querySelector('strong')?.textContent,text:t.textContent,events:getComputedStyle(t).pointerEvents}})()`);
    const rect = selector => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}})()`);
    let at = { x: 1400, y: 880 };
    // A hand's move: small steps from where the pointer is to the point.
    const glide = async (x, y) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(x - at.x, y - at.y) / 4));
      for (let n = 1; n <= steps; n++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + (x - at.x) * n / steps, y: at.y + (y - at.y) * n / steps });
      at = { x, y };
    };
    const inside = (x, y, selector) => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x},${y}))`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    assert.equal(await tip(), null, 'no row hovered, no peek');
    const r = await rect(row);
    const centre = { x: r.x + (r.right - r.x) / 2, y: r.y + (r.bottom - r.y) / 2 };
    await glide(centre.x, centre.y);
    const opened = await until(async () => { const t = await tip(); return t?.text.includes('This comes from posts') && t; }, 'hovering the row opens its peek, read from the server');
    assert.equal(opened.name, 'Being worked on', 'the peek is the hovered row\'s');
    assert.notEqual(opened.events, 'none', 'the peek takes the pointer like any panel');
    // (1) It touches its row.
    assert.ok(opened.x <= r.right && opened.right >= r.x && opened.y <= r.bottom && opened.bottom >= r.y, `the peek touches its row: ${JSON.stringify([opened, r])}`);
    // (2) From the row straight onto the peek: still open, and the pointer is on it.
    const onto = { x: Math.min(opened.right - 10, opened.x + 24), y: centre.y };
    await glide(onto.x, onto.y);
    assert.ok(await tip(), 'still open on the peek');
    assert.equal(await inside(onto.x, onto.y, '#light-tip'), true, 'the element under the pointer is in the peek');
    // (3) Back onto its row: still open.
    await glide(centre.x, centre.y);
    assert.ok(await tip(), 'still open back on the row');
    // (4) Leaving both, to empty rail: closed.
    const empty = await p.evaluate(`(()=>{const rail=document.querySelector('.rail').getBoundingClientRect();
      for(let y=rail.bottom-6;y>rail.y;y-=12){const hit=document.elementFromPoint(rail.x+8,y);
        if(hit&&hit.closest('.rail')&&!hit.closest('#workspaces a,#topics a,#light-tip,button,input,a'))return {x:rail.x+8,y};}
      return null})()`);
    assert.ok(empty, 'the rail has empty room to move to');
    await glide(empty.x, empty.y);
    await until(async () => (await tip()) === null, 'leaving both closes the peek');
    // (5) Open again, press Escape: closed.
    await glide(centre.x, centre.y);
    await until(() => tip(), 'the peek opens again');
    await p.key('Escape');
    assert.equal(await tip(), null, 'Escape closes it');
    await glide(empty.x, empty.y);
    // (6) Another row hovered shows its own light, never the first row's.
    await p.evaluate(`document.querySelector(${JSON.stringify(rowOf('light-later'))}).scrollIntoView({block:'center'})`);
    const later = await rect(rowOf('light-later'));
    await glide(later.x + 20, later.y + (later.bottom - later.y) / 2);
    const other = await until(async () => { const t = await tip(); return t?.text.includes('This comes from posts') && t; }, 'the other row\'s peek');
    assert.equal(other.name, 'No topics yet');
    // A topic opened by another member while the peek is open changes it, without a reload.
    await control({ method: 'light_outcome', outcome: 'light-later', exists: true, topic: { id: 'light-later-topic', title: 'Later topic' } });
    await until(async () => (await tip())?.name === 'Being worked on', 'the open peek follows the commit');
    // The row repaints from its own read of the list, which may land after the peek's.
    await until(async () => (await p.evaluate(`document.querySelector(${JSON.stringify(rowOf('light-later') + ' small.standing')}).dataset.light`)) === 'built', 'and so does its row');
    await shot(p, 'light-peek');
    await glide(empty.x, empty.y);
    await until(async () => (await tip()) === null, 'closed');
    // By keyboard: focusing a row by Tab opens its peek; leaving it closes it.
    // The row Tab reaches may sit below the rail's fold: taking focus scrolls it into view, and its peek holds.
    await p.evaluate(`(()=>{document.activeElement?.blur?.();})()`);
    let focused = null;
    for (let n = 0; n < 60 && !focused; n++) {
      await p.key('Tab');
      focused = await p.evaluate(`document.activeElement?.closest?.('#workspaces a')?.dataset.workspaceId ?? null`);
    }
    assert.ok(focused, 'Tab reaches an outcome row');
    const byKey = await until(async () => { const t = await tip(); return t?.text.includes('This comes from posts') && t; }, 'focus by Tab opens the peek');
    assert.ok(byKey.name.length > 0);
    await p.key('Escape');
    assert.equal(await tip(), null);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('light an outcome page says its own questions once, and other outcomes\' in one line that opens them', async () => {
    await pitch();
    const p = await page('light-outcome-page', null, true, { url: facts.origin + '/?workspace=w1' });
    await until(() => p.evaluate(`!document.querySelector('#outcome-standing').hidden && !document.querySelector('#also-waiting').hidden`), 'the outcome page says where it stands');
    const top = await p.evaluate(`(()=>{const s=document.querySelector('#outcome-standing'),t=document.querySelector('#topic-navigation'),w=document.querySelector('#waiting-on-you');
      return {also:document.querySelector('#also-waiting').textContent,heading:s.querySelector('h2').textContent,before:Boolean(s.compareDocumentPosition(t)&Node.DOCUMENT_POSITION_FOLLOWING),
        alsoFirst:Boolean(document.querySelector('#also-waiting').compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING),
        box:!w.hidden&&w.textContent.includes('Waiting on you ('),source:s.textContent.includes('This comes from posts, agent work and questions in Theseus.')}})()`);
    assert.deepEqual(top, { also: 'Also waiting on you: 1 in Pitch deck ›', heading: 'Where this outcome stands', before: true, alsoFirst: true, box: false, source: true });
    await shot(p, 'light-outcome-page');
    await p.point('#also-waiting a');
    await until(() => p.evaluate(`document.body?.dataset.ready==='true' && new URL(location.href).searchParams.get('workspace')==='light-pitch' && !document.querySelector('#outcome-standing').hidden`), 'the link opens Pitch deck\'s page');
    const own = await p.evaluate(`(()=>{const s=document.querySelector('#outcome-standing'),w=document.querySelector('#waiting-on-you');
      return {also:document.querySelector('#also-waiting').hidden,name:s.querySelector('.state-line').textContent,lead:s.querySelector('.lead').textContent,
        facts:[...s.querySelectorAll('.standing-facts li')].map(li=>li.textContent),box:!w.hidden}})()`);
    assert.equal(own.also, true, 'no line for its own questions');
    assert.equal(own.box, false, 'and no Waiting on you box');
    assert.equal(own.name, 'Waiting on you');
    assert.equal(own.lead, 'A question is waiting for your answer:');
    assert.equal(own.facts.length, 1);
    assert.match(own.facts[0], /^Speaker notes — fixture-notebook-agent asked at \d{1,2}:\d{2}\s[AP]M$/);
    await shot(p, 'light-pitch-page');
    assert.deepEqual(p.errors, []);
    await p.close();
    // On a phone the line wraps between links, each kept whole, and nothing scrolls sideways.
    const small = await page('light-outcome-phone', null, true, { url: facts.origin + '/?workspace=w1', beforeNavigate: phone });
    await until(() => small.evaluate(`!document.querySelector('#also-waiting').hidden`), 'phone: the line');
    assert.equal(await small.evaluate(`getComputedStyle(document.querySelector('#also-waiting a')).whiteSpace`), 'nowrap');
    assert.ok(await sideways(small) <= 0, 'no sideways scroll at 390');
    await shot(small, 'light-outcome-phone');
    assert.deepEqual(small.errors, []);
    await small.close();
  });
}
