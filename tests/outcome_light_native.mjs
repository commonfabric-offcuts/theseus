import assert from 'node:assert/strict';

// The outcome light in the real browser against the real server (item 86): the
// words of each light on the Outcomes home, the peek under a real pointer and
// keyboard, and "Where it stands" on an outcome's page: two lines, its own
// questions said once, and what the light is made of behind a real press of the ⓘ. The peek's
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
      return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,name:t.querySelector('strong')?.textContent,last:t.querySelector('.standing-last')?.textContent??null,
        links:t.querySelectorAll('a').length,text:t.textContent,events:getComputedStyle(t).pointerEvents}})()`);
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
    const opened = await until(async () => { const t = await tip(); return t?.last && t; }, 'hovering the row opens its peek, read from the server');
    // The peek says what the card says: the name with its time, and the Last line in plain words; nothing more.
    assert.match(opened.name, /^Worked on at \d{1,2}:\d{2}\s[AP]M$/, 'the peek is the hovered row\'s');
    assert.equal(opened.last, 'Last: fixture-notebook-agent in “Peek topic”');
    assert.equal(opened.text, opened.name + opened.last, 'a state and a time, and one Last line');
    assert.equal(opened.links, 0, 'no link in the peek: the row is the way in');
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
    const other = await until(async () => { const t = await tip(); return t?.last && t; }, 'the other row\'s peek');
    assert.equal(other.name, 'No topics yet');
    assert.equal(other.last, `Started by ${facts.actor}.`, 'with no topic, who started it');
    // A topic opened by another member while the peek is open changes it, without a reload.
    await control({ method: 'light_outcome', outcome: 'light-later', exists: true, topic: { id: 'light-later-topic', title: 'Later topic' } });
    await until(async () => { const t = await tip(); return /^Worked on at /.test(t?.name ?? '') && t.last === 'Last: fixture-notebook-agent in “Later topic”'; }, 'the open peek follows the commit');
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
    const byKey = await until(() => tip(), 'focus by Tab opens the peek');
    assert.ok(byKey.name.length > 0);
    await p.key('Escape');
    assert.equal(await tip(), null);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('light an outcome page says where it stands in two lines, its own questions once, and other outcomes\' in one line that opens them; the ⓘ opens what the light is made of', async () => {
    await pitch();
    const p = await page('light-outcome-page', null, true, { url: facts.origin + '/?workspace=w1' });
    await until(() => p.evaluate(`!document.querySelector('#outcome-standing').hidden && !document.querySelector('#also-waiting').hidden`), 'the outcome page says where it stands');
    const top = await p.evaluate(`(()=>{const s=document.querySelector('#outcome-standing'),t=document.querySelector('#topic-navigation'),w=document.querySelector('#waiting-on-you');
      return {also:document.querySelector('#also-waiting').textContent,heading:s.querySelector('h2').textContent,before:Boolean(s.compareDocumentPosition(t)&Node.DOCUMENT_POSITION_FOLLOWING),
        alsoFirst:Boolean(document.querySelector('#also-waiting').compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING),
        box:!w.hidden&&w.textContent.includes('Waiting on you ('),more:s.querySelector('#standing-more').hidden,source:s.querySelector('#standing-more').textContent.includes('This comes from posts, agent work and questions in Theseus.')}})()`);
    assert.deepEqual(top, { also: 'Also waiting on you: 1 in Pitch deck ›', heading: 'Where it stands', before: true, alsoFirst: true, box: false, more: true, source: true },
      'what it is made of, where it comes from among it, waits behind the ⓘ');
    // The line names the one other outcome the "← Outcomes" light counts, so the light shows without its words.
    const home = await until(() => p.evaluate(`(()=>{const h=document.getElementById('outcomes-home'),l=h.querySelector('.outcome-light'),w=h.querySelector('.elsewhere-words');
      return l&&l.getClientRects().length>0&&{words:w.getClientRects().length>0?w.textContent:null,label:h.getAttribute('aria-label')}})()`), 'the light is lit');
    assert.deepEqual(home, { words: null, label: 'Outcomes. 1 other outcome is waiting on you.' }, 'the line already names it; screen readers still hear the words');
    await shot(p, 'light-outcome-page');
    await p.point('#also-waiting a');
    await until(() => p.evaluate(`document.body?.dataset.ready==='true' && new URL(location.href).searchParams.get('workspace')==='light-pitch' && !document.querySelector('#outcome-standing').hidden`), 'the link opens Pitch deck\'s page');
    // The card, as a person sees it: the lines drawn, not the words in the page.
    const card = () => p.evaluate(`(()=>{const s=document.querySelector('#outcome-standing'),w=document.querySelector('#waiting-on-you'),i=s.querySelector('.standing-info'),
        m=s.querySelector('#standing-more'),l=s.querySelector('.standing-last'),lb=l?.getBoundingClientRect(),ib=i.getBoundingClientRect(),sb=s.getBoundingClientRect();
      return {also:document.querySelector('#also-waiting').hidden,box:!w.hidden,shown:[...s.children].filter(c=>c.getClientRects().length>0).map(c=>c.textContent),
        name:s.querySelector('.state-line').textContent,last:l?.textContent??null,lastHeight:lb?Math.round(lb.height):null,lineHeight:l?parseFloat(getComputedStyle(l).lineHeight)||null:null,
        info:{label:i.getAttribute('aria-label'),expanded:i.getAttribute('aria-expanded'),size:[Math.round(ib.width),Math.round(ib.height)],inside:ib.right<=sb.right&&ib.top>=sb.top},
        more:{hidden:m.hidden,source:m.querySelector('.source')?.textContent??null,lead:m.querySelector('.lead')?.textContent??null,facts:[...m.querySelectorAll('.standing-facts li')].map(li=>li.textContent)}}})()`);
    const own = await card();
    assert.equal(own.also, true, 'no line for its own questions');
    assert.equal(own.box, false, 'and no Waiting on you box');
    assert.deepEqual(own.shown, ['Where it standsi', 'Waiting on you · 1 question', 'Asked: fixture-notebook-agent in “Speaker notes”'], 'two lines under the heading, and nothing more shown');
    assert.equal(own.name, 'Waiting on you · 1 question');
    assert.ok(own.lastHeight > 0 && own.lastHeight <= Math.ceil(own.lineHeight * 1.5), 'the Last line is one line: ' + JSON.stringify(own));
    assert.deepEqual(own.info, { label: 'What this is made of', expanded: 'false', size: own.info.size, inside: true });
    assert.equal(own.more.hidden, true);
    await shot(p, 'light-pitch-page');
    // A real press of the ⓘ opens what the light is made of, in place; another closes it.
    await p.point('#outcome-standing .standing-info');
    const opened = await until(async () => { const c = await card(); return !c.more.hidden && c; }, 'the ⓘ opens what the light is made of');
    assert.equal(opened.info.expanded, 'true');
    assert.equal(opened.more.lead, 'A question is waiting for your answer:');
    assert.equal(opened.more.facts.length, 1);
    assert.match(opened.more.facts[0], /^Speaker notes — fixture-notebook-agent asked at \d{1,2}:\d{2}\s[AP]M$/);
    assert.equal(opened.more.source, 'This comes from posts, agent work and questions in Theseus. Work done somewhere else won’t show here.', 'with where it comes from');
    assert.equal(opened.shown.length, 4, 'shown below the two lines, in place');
    await shot(p, 'light-pitch-page-open');
    await p.point('#outcome-standing .standing-info');
    await until(async () => (await card()).more.hidden, 'a second press closes it');
    assert.equal((await card()).info.expanded, 'false');
    // The Last line's topic is a link: a real click opens the topic.
    await p.point('#outcome-standing .standing-last a');
    await until(() => p.evaluate(`document.body?.dataset.ready==='true' && new URL(location.href).searchParams.get('topic')==='light-notes'`), 'the Last line opens its topic');
    assert.deepEqual(p.errors, []);
    await p.close();
    // On a phone the line wraps between links, each kept whole, and nothing scrolls sideways.
    const small = await page('light-outcome-phone', null, true, { url: facts.origin + '/?workspace=w1', beforeNavigate: phone });
    await until(() => small.evaluate(`!document.querySelector('#also-waiting').hidden && !document.querySelector('#outcome-standing').hidden`), 'phone: the line');
    assert.equal(await small.evaluate(`getComputedStyle(document.querySelector('#also-waiting a')).whiteSpace`), 'nowrap');
    // The card fits the screen, its Last line cut with an ellipsis where it does not fit.
    const fit = await small.evaluate(`(()=>{const s=document.querySelector('#outcome-standing').getBoundingClientRect(),l=document.querySelector('#outcome-standing .standing-last');
      if(!l)return {inside:s.right<=innerWidth,last:null};const b=l.getBoundingClientRect(),t=l.querySelector('.title');
      return {inside:s.right<=innerWidth&&b.right<=s.right,last:{nowrap:getComputedStyle(l).whiteSpace,ellipsis:t?getComputedStyle(t).textOverflow:null}}})()`);
    assert.equal(fit.inside, true, 'phone: the card and its lines inside the screen');
    if (fit.last) assert.deepEqual(fit.last, { nowrap: 'nowrap', ellipsis: 'ellipsis' });
    assert.ok(await sideways(small) <= 0, 'no sideways scroll at 390');
    await shot(small, 'light-outcome-phone');
    assert.deepEqual(small.errors, []);
    await small.close();
  });
}
