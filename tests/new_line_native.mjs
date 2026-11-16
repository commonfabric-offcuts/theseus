// The red New line, as painted: just below the card of the oldest message the
// person had not read when the topic opened, as the server names it
// (topic_unread); red words "New above" and when that message was sent,
// readable on the page in light and dark. During the visit reading never
// moves it up, and reading on screen never fades it; once the person opens a
// message at or above it, replies or marks read, or what it holds is read
// elsewhere, it fades out where it is, keeping its space, inert, with no
// Refresh (Tony's case: open a message in the Reader, reply, and the line
// goes). It moves to show more (Mark
// unread further back; an arrival or a mark while there is no line or it has
// faded; Mark unread above a line that shows leaves it) and on the person's
// explicit Mark read, which places it afresh, as opening the topic again
// does; the card being read is held still wherever it moves. At the top of the topic a message that
// arrives comes into view above. Each case reads in a topic of its own, so
// what earlier checks read does not matter. Run by
// reader_persistence_native.mjs with --colors; screenshots are kept as
// new-line-*.png for review.
import assert from 'node:assert/strict';

const luminance = c => c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255)
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
// The line's time, for a message sent moments ago (or, in a run that crosses
// midnight, yesterday), and the dated form its title keeps.
const SHOWN = '(Yesterday )?\\d{1,2}:\\d{2} (AM|PM)';
const DATED = /^\d{1,2}:\d{2} (AM|PM) (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d{1,2}$/;
// At a phone's width, the line keeps its words on one line, inside the page.
const narrowLine = p => p.evaluate(`(()=>{const line=document.querySelector('#messages .new-line'),words=line.querySelector('.new-line-words');
  const r=words.getBoundingClientRect(),l=line.getBoundingClientRect();
  return {text:line.textContent,lines:Math.round(r.height/parseFloat(getComputedStyle(words).lineHeight)),right:l.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()`);
const phone = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, desk = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// What loads older messages: More messages, or the New line while it says
// more new messages lie below, which hides More.
export const olderControl = p => p.evaluate("document.querySelector('#more-messages').hidden && document.querySelector('#messages .new-line-older') ? '#messages .new-line-older' : '#more-messages'");

// The New line stays while the person reads on screen, in any engine: run
// here in Chrome for Testing, and by webkit_native.mjs --new-line in WebKit
// (the release check's native-webkit-new-line). open(url,
// size, name, {lose}) gives a page with evaluate, point (a native click), close,
// errors, reports() (the topic.read_through ranges it sent, [from, through])
// and answered(name, test) (whether the page has had an answer to a read of
// that view whose body passes test). With lose(payload), the first command
// whose payload it accepts goes to the server and its answer is then lost:
// the connection is reset before the page has it. With hold(payload), the
// server answers every view read it accepts at once, and the page gets those
// answers only on releaseAnswer() (a page reads its rail again after each
// commit); heldAnswer() says whether one waits.
// Sizes are a desk window and a phone.
export const SIZES = { desk: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } };
export async function newLineStaysChecks({ check, open, until, view, control, shot, observations, engine }) {
  const agent = 'fixture-notebook-agent';
  const unread = async topic => (await view('topic_unread', { topic_id: topic })).oldest_unread;
  // A topic, or an outcome's conversation, with count agent messages in it, oldest first.
  const place = async (id, route, count) => {
    let topic = id;
    if (route === 'conversation') {
      await control({ method: 'navigation_workspaces', workspaces: [{ id, title: 'New line ' + id, team: [agent] }] });
      topic = (await view('conversation', { workspace_id: id })).conversation.topic_id;
    } else await control({ method: 'navigation_topics', topics: [{ id, title: 'New line ' + id }] });
    const ids = [];
    for (let n = 0; n < count; n++) ids.push((await control({ method: 'agent_message', operation_id: `${id}-${n}`, topic_id: topic, join: route === 'topic' && n === 0,
      body: `Agent message ${n} in ${id}.` })).result.message_id);
    return { topic, ids, url: route === 'conversation' ? '/?conversation=' + id : '/?topic=' + id };
  };
  const card = id => `#messages [data-id="${id}"]`;
  const frames = p => p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  // Every transition (the line's fade among them) has run.
  const still = async (p, label) => { await frames(p); await until(() => p.evaluate("document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), label + ': transitions ran'); };
  const line = p => p.evaluate(`(()=>{const lines=[...document.querySelectorAll('#messages .new-line')],l=lines[0],c=l&&getComputedStyle(l);
    return {count:lines.length,kind:l?.dataset.line??null,read:l?.classList.contains('new-line-read')??null,opacity:c?.opacity??null,inert:l?.inert??null,
      after:l?.previousElementSibling?.dataset?.id??null}})()`);
  // How far the page scrolls past what it holds: its end beyond the window and beyond main's last box with main's
  // padding. While a New line shows, the page keeps room to scroll it to the top (docs/attention.md); once it has
  // faded, or is gone, none.
  const blankBelow = p => p.evaluate(`(()=>{const m=document.querySelector('main'),last=[...m.children].filter(e=>e.getClientRects().length&&!['absolute','fixed'].includes(getComputedStyle(e).position)).at(-1);
    const end=last.getBoundingClientRect().bottom+parseFloat(getComputedStyle(last).marginBottom)+parseFloat(getComputedStyle(m).paddingBottom)+scrollY;
    return Math.max(0,Math.round(Math.max(innerHeight,document.scrollingElement.scrollHeight)-Math.max(innerHeight,end)))})()`);
  // Reads until nothing is unread, bringing the oldest unread card into view,
  // and waits until the page has had the answer that says so and has drawn it.
  const readOnScreen = async (p, topic, label) => {
    for (let oldest; (oldest = await unread(topic));) {
      await p.evaluate(`document.querySelector(${JSON.stringify(card(oldest.id))}).scrollIntoView({block:'center'})`);
      await until(async () => (await unread(topic))?.id !== oldest.id, label + ': read ' + oldest.id);
    }
    await until(() => p.answered('topic_unread', body => body?.topic_id === topic && body.oldest_unread === null), label + ': the page heard that nothing is unread');
    await still(p, label);
  };

  // The person opens a short topic: both agent messages are on the first
  // screen and the page reads them there. The line stays under the older of
  // them, showing, for the visit; opening a message at or above it in the
  // Reader fades it, and closing the Reader does not bring it back.
  await check(`colors ${engine}: a short topic read on the first screen keeps its New line until a message above it is opened`, async () => {
    for (const route of ['topic', 'conversation']) {
      for (const [size, metrics] of Object.entries(SIZES)) {
        const label = `${engine} ${route} ${size}`, id = `new-line-stays-${engine}-${route}-${size}`;
        const { topic, ids, url } = await place(id, route, 2);
        assert.equal((await unread(topic))?.id, ids[0], label + ': both agent messages are unread, the older one first');
        const p = await open(url, metrics, id);
        await readOnScreen(p, topic, label);
        const held = await line(p);
        assert.deepEqual(held, { count: 1, kind: 'new', read: false, opacity: '1', inert: false, after: ids[0] },
          label + ': read on screen, the line stays under the oldest unread message, showing');
        const room = await blankBelow(p);
        assert.ok(room > 0, label + ': the line showing, the page keeps room to scroll it to the top: ' + room);
        await shot(p, `new-line-stays-${engine}-${route}-${size}`);
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids[1]))}).scrollIntoView({block:'center'})`);
        await p.point(card(ids[1]));
        await until(() => p.evaluate("document.querySelector('#reader').open"), label + ': the Reader is open on the newest message');
        const faded = await until(async () => { const now = await line(p); return now.read && now.opacity === '0' && now; }, label + ': opened, the line fades');
        assert.deepEqual([faded.count, faded.after, faded.inert], [1, ids[0], true], label + ': where it was, inert');
        await p.point('#reader-close');
        await until(() => p.evaluate("!document.querySelector('#reader').open"), label + ': the Reader closed');
        await still(p, label + ': closed');
        assert.deepEqual(await line(p), faded, label + ': closing the Reader leaves the line faded');
        assert.equal(await blankBelow(p), 0, label + ': faded, the line keeps no room: the page ends where what it holds ends');
        observations.push({ name: 'new line stays while read on screen', engine, route, size, held, faded, room });
        assert.deepEqual(p.errors, [], label + ': no page errors');
        await p.close();
      }
    }
  });

  // A topic whose oldest unread message is below the first screen: the page
  // reads the first screen's cards, then the person opens the newest card in
  // the Reader and presses its Older button down to the oldest unread, so
  // every message at or above the line is opened. Each step reports its own
  // message read, after the open that is the act: those reports never hold
  // the line, and the first screen's cards were acted on. It fades while the
  // Reader is open and stays faded when it closes.
  await check(`colors ${engine}: opening every message at or above the line in the Reader fades it, whatever each step reports`, async () => {
    const id = `new-line-step-${engine}`, { topic, ids, url } = await place(id, 'topic', 14), label = `${engine} stepped`;
    const reported = (await control({ method: 'counts' })).read_through_operations;
    const p = await open(url, SIZES.desk, id);
    await until(() => p.reports().length, label + ': the first screen is reported read');
    await until(async () => (await control({ method: 'counts' })).read_through_operations - reported === p.reports().length, label + ': and recorded');
    assert.equal((await unread(topic))?.id, ids[0], label + ': the oldest unread message is below the first screen, still unread');
    const first = p.reports(), oldest = await p.evaluate(`Number(document.querySelector(${JSON.stringify(card(ids[0]))}).dataset.seq)`);
    assert.ok(first.every(([from]) => from > oldest), label + ': the first screen does not reach it: ' + JSON.stringify({ oldest, first }));
    await still(p, label + ': first screen');
    assert.deepEqual(await line(p), { count: 1, kind: 'new', read: false, opacity: '1', inert: false, after: ids[0] }, label + ': the line shows under it');
    await p.point(card(ids.at(-1)));
    const shows = n => until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(`Agent message ${n} in ${id}.`)})`), label + `: the Reader shows message ${n}`);
    await shows(ids.length - 1);
    for (let n = ids.length - 2; n >= 0; n--) {
      await until(() => p.evaluate("!document.querySelector('#previous-message').disabled"), label + `: the Reader can step below message ${n + 1}`);
      await p.point('#previous-message');
      await shows(n);
    }
    await until(async () => await unread(topic) === null, label + ': every message is read');
    await until(() => p.answered('topic_unread', body => body?.topic_id === topic && body.oldest_unread === null), label + ': the page heard that nothing is unread');
    const faded = await until(async () => { const now = await line(p); return now.read && now.opacity === '0' && now; }, label + ': opened down to the line, it fades')
      .catch(async error => { throw Error(`${label}: every message at or above the line was opened in the Reader, yet the line: ${JSON.stringify(await line(p))} reports ${JSON.stringify(p.reports())}`, { cause: error }); });
    assert.deepEqual([faded.count, faded.after, faded.inert], [1, ids[0], true], label + ': where it was, inert');
    await p.point('#reader-close');
    await until(() => p.evaluate("!document.querySelector('#reader').open"), label + ': the Reader closed');
    await still(p, label + ': closed');
    assert.deepEqual(await line(p), faded, label + ': closing the Reader leaves the line faded');
    observations.push({ name: 'new line fades once every message above it is opened', engine, first, reports: p.reports(), faded });
    assert.deepEqual(p.errors, [], label + ': no page errors');
    await p.close();
  });

  // The Reader is open when a message arrives: the faded line comes back
  // under it, and showing it in the Reader (its Newer button) is an open, so
  // the line fades again once Core has the read. The Reader's own report of
  // the message, which goes out after the open while the message is still
  // unread, never holds it.
  await check(`colors ${engine}: a message that arrives while the Reader is open brings the line back, and showing it in the Reader fades it`, async () => {
    const id = `new-line-arrives-${engine}`, label = `${engine} arrives`, { topic, ids, url } = await place(id, 'topic', 2);
    const p = await open(url, SIZES.desk, id);
    await readOnScreen(p, topic, label);
    await p.point(card(ids[1]));
    await until(() => p.evaluate("document.querySelector('#reader').open"), label + ': the Reader is open on the newest message');
    await until(async () => { const now = await line(p); return now.read && now.opacity === '0'; }, label + ': opened, the line fades');
    const arrived = (await control({ method: 'agent_message', operation_id: id + '-arrives', topic_id: topic, body: `Agent message arrives in ${id}.` })).result.message_id;
    const back = await until(async () => { const now = await line(p); return !now.read && now.opacity === '1' && now.after === arrived && now; }, label + ': the line comes back under the message that arrived');
    assert.deepEqual([back.count, back.inert], [1, false], label + ': one line, showing');
    await until(() => p.evaluate("!document.querySelector('#next-message').disabled"), label + ': the Reader can step to the newer message');
    await p.point('#next-message');
    await until(() => p.evaluate(`document.querySelector('#source-body').textContent.includes(${JSON.stringify(`Agent message arrives in ${id}.`)})`), label + ': the Reader shows it');
    await until(async () => await unread(topic) === null, label + ': it is read');
    const faded = await until(async () => { const now = await line(p); return now.read && now.opacity === '0' && now; }, label + ': shown in the Reader, the line fades')
      .catch(async error => { throw Error(`${label}: the message that arrived was opened in the Reader, yet the line: ${JSON.stringify(await line(p))} reports ${JSON.stringify(p.reports())}`, { cause: error }); });
    assert.deepEqual([faded.count, faded.after, faded.inert], [1, arrived, true], label + ': where it was, inert');
    await p.point('#reader-close');
    await until(() => p.evaluate("!document.querySelector('#reader').open"), label + ': the Reader closed');
    await still(p, label + ': closed');
    assert.deepEqual(await line(p), faded, label + ': closing the Reader leaves the line faded');
    observations.push({ name: 'new line fades when a message that arrived is shown in the Reader', engine, back, faded, reports: p.reports() });
    assert.deepEqual(p.errors, [], label + ': no page errors');
    await p.close();
  });

  // A message's link opens its topic with that message in the Reader: the
  // one unread message, the line under it. The open is the act; the Reader's
  // report of it never holds the line, which fades once Core has the read.
  await check(`colors ${engine}: a message's link opens it in the Reader, and the line under it fades`, async () => {
    const id = `new-line-link-${engine}`, label = `${engine} link`, { topic, ids } = await place(id, 'topic', 1);
    const p = await open(`/?topic=${encodeURIComponent(topic)}&message=${encodeURIComponent(ids[0])}`, SIZES.desk, id);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(`Agent message 0 in ${id}.`)})`), label + ': the Reader shows the linked message');
    await until(async () => await unread(topic) === null, label + ': it is read');
    await until(() => p.answered('topic_unread', body => body?.topic_id === topic && body.oldest_unread === null), label + ': the page heard that nothing is unread');
    const faded = await until(async () => { const now = await line(p); return now.read && now.opacity === '0' && now; }, label + ': opened from its link, the line fades')
      .catch(async error => { throw Error(`${label}: the linked message was opened in the Reader, yet the line: ${JSON.stringify(await line(p))} reports ${JSON.stringify(p.reports())}`, { cause: error }); });
    assert.deepEqual([faded.count, faded.after, faded.inert], [1, ids[0], true], label + ': under it, inert');
    observations.push({ name: 'new line fades when a linked message opens in the Reader', engine, faded, reports: p.reports() });
    assert.deepEqual(p.errors, [], label + ': no page errors');
    await p.close();
  });

  // A report whose answer is lost after Core recorded it (the connection
  // drops, a phone puts the page in the background, the server restarts):
  // the page cannot tell it from one Core never saw, so the cards it carried
  // keep holding the line, which reading on screen never fades. Opening a
  // message above it in the Reader fades it.
  await check(`colors ${engine}: a first screen whose report's answer is lost after Core recorded it keeps its New line until a message above it is opened`, async () => {
    const id = `new-line-lost-${engine}`, label = `${engine} lost answer`, { topic, ids, url } = await place(id, 'topic', 2);
    const p = await open(url, SIZES.desk, id, { lose: payload => payload?.kind === 'topic.read_through' });
    await until(async () => await unread(topic) === null, label + ': Core recorded the first screen read');
    await until(() => p.answered('topic_unread', body => body?.topic_id === topic && body.oldest_unread === null), label + ': the page heard that nothing is unread');
    await still(p, label);
    const held = await line(p), reports = p.reports();
    observations.push({ name: 'new line stays when a report answer is lost', engine, held, reports });
    assert.deepEqual(held, { count: 1, kind: 'new', read: false, opacity: '1', inert: false, after: ids[0] },
      label + ': its answer lost, the line stays under the oldest unread message, showing: ' + JSON.stringify(reports));
    await p.point(card(ids[1]));
    await until(() => p.evaluate("document.querySelector('#reader').open"), label + ': the Reader is open on the newest message');
    const faded = await until(async () => { const now = await line(p); return now.read && now.opacity === '0' && now; }, label + ': opened, the line fades');
    assert.deepEqual([faded.count, faded.after, faded.inert], [1, ids[0], true], label + ': where it was, inert');
    assert.deepEqual(p.errors, [], label + ': no page errors');
    await p.close();
  });

  // What is drawn above the messages after they paint, in their column,
  // pushes them down: the marks line ("1 marked unread · Read it") at any
  // width, and on an outcome's conversation page its Show row ("Only new").
  // Each is held in turn, its answer kept from the page (not the server,
  // whose read lanes then serve every other read), until the messages are
  // drawn and the page has settled: while it is held no card is reported
  // read, and once it lands every card reported read is on screen where it
  // now is, the page not scrolled. The outcome rail is never above them: on
  // a phone it folds into the drawer behind "☰ Topics", so its Pipeline row
  // landing moves no card, and the page reports the first screen while that
  // read is still held.
  const lateFill = async ({ label, id, url, size, hold, drawn, newest, above }) => {
    const reported = (await control({ method: 'counts' })).read_through_operations;
    const p = await open(url, size, id, { hold: payload => payload?.name === hold });
    const top = () => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(card(newest))}).getBoundingClientRect().top)`);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(newest))}))`), label + ': the messages are drawn');
    await until(() => p.heldAnswer(), label + ': its answer is held');
    if (!above) await until(() => p.reports().length, label + ': while it is held, the first screen is reported read');
    await still(p, label + ': the rest of the page is drawn');
    assert.equal(await p.evaluate(drawn), false, label + ': not drawn yet');
    const before = await top(), early = p.reports();
    await p.releaseAnswer();
    await until(() => p.evaluate(drawn), label + ': drawn');
    await still(p, label + ': filled');
    // The first screen is reported, and every report the page sent has been answered.
    await until(async () => p.reports().length && (await control({ method: 'counts' })).read_through_operations - reported === p.reports().length, label + ': the first screen is reported and recorded');
    const after = await top(), sent = p.reports();
    const shown = await p.evaluate(`(()=>{const h=innerHeight;return {scroll:scrollY,height:h,cards:[...document.querySelectorAll('#messages > [data-seq]')].map(c=>{const r=c.getBoundingClientRect(),seen=Math.min(r.bottom,h)-Math.max(r.top,0);
      return {seq:Number(c.dataset.seq),top:Math.round(r.top),bottom:Math.round(r.bottom),on:seen>0&&(seen>=r.height/2||r.top<=h/2&&r.bottom>=h/2)}})}})()`);
    observations.push({ name: 'reads once ' + label + ' filled', engine, before, after, early, sent, shown });
    if (above) {
      assert.deepEqual(early, [], `${label}: while it was held, no card was reported read: ${JSON.stringify({ before, early, shown })}`);
      assert.ok(after > before, `${label}: filling it pushed the messages down: ${JSON.stringify({ before, after })}`);
    } else assert.equal(after, before, `${label}: filling it moved no message: ${JSON.stringify({ before, after })}`);
    assert.equal(shown.scroll, 0, label + ': the page is where it opened');
    const off = shown.cards.filter(c => !c.on && sent.some(([from, through]) => from <= c.seq && c.seq <= through));
    assert.deepEqual(off, [], `${label}: no card off screen once it filled is reported read: ${JSON.stringify({ before, after, sent, shown })}`);
    return p;
  };
  await check(`colors ${engine}: no card is reported read that a fill drawn above the messages pushes off screen, and the rail holds none back`, async () => {
    {
      // The marks line at a desk width, in a short window: the reader marked
      // an older message unread elsewhere.
      const id = `new-line-marks-${engine}`, { ids, url } = await place(id, 'topic', 12);
      await control({ method: 'mark', operation_id: id + '-mark', message_ids: [ids[0]], marked: true });
      const p = await lateFill({ label: `${engine} the marks line`, id, url, size: { ...SIZES.desk, height: 271 }, hold: 'marks',
        drawn: "!document.querySelector('#topic-marks').hidden", newest: ids.at(-1), above: true });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    {
      // A conversation's Show row at a phone's width: it shows once the
      // conversation's read says there are new messages. Opened by its
      // topic's address, so the page reads the conversation once, for that
      // row (by its own address, it reads it first to find the topic).
      const id = `new-line-show-${engine}`, { topic, ids } = await place(id, 'conversation', 8);
      const p = await lateFill({ label: `${engine} the conversation's Show row at a phone's width`, id, url: '/?topic=' + topic, size: SIZES.phone, hold: 'conversation',
        drawn: "!document.querySelector('#conversation-show').hidden", newest: ids.at(-1), above: true });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    {
      // The outcome rail at a phone's width, folded into its drawer; the
      // outcome has a pipeline, so the rail gains its Pipeline row when that
      // read lands.
      const id = `new-line-rail-${engine}`, topic = id + '-topic';
      await control({ method: 'light_outcome', outcome: id, title: 'New line ' + id, topic: { id: topic, title: 'New line ' + topic } });
      await control({ method: 'pipeline', kind: 'pipeline.configure', operation_id: id + '-pipeline', workspace_id: id, target: { workspace_id: id }, args: { enabled: true } });
      const ids = [];
      for (let n = 0; n < 8; n++) ids.push((await control({ method: 'agent_message', operation_id: `${id}-${n}`, topic_id: topic, body: `Agent message ${n} in ${id}.` })).result.message_id);
      const p = await lateFill({ label: `${engine} the outcome rail at a phone's width`, id, url: '/?topic=' + topic, size: SIZES.phone, hold: 'pipeline_row',
        drawn: "!document.querySelector('#pipeline-navigation').hidden", newest: ids.at(-1), above: false });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
}

export async function newLineCheck({ check, page, until, view, control, shot, observations, facts }) {
  // A topic of the person's own, with count agent messages in it, oldest first; their ids.
  const topicWith = async (id, count) => {
    await control({ method: 'navigation_topics', topics: [{ id, title: 'New line ' + id }] });
    const ids = [];
    for (let n = 0; n < count; n++) ids.push((await control({ method: 'agent_message', operation_id: `${id}-${n}`, topic_id: id, join: n === 0,
      body: `Agent message ${n} in ${id}.` })).result.message_id);
    return ids;
  };
  const open = (topic, suffix, theme, height = 900) => page(suffix, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async p => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
  } });
  const unread = async topic => (await view('topic_unread', { topic_id: topic })).oldest_unread;
  // Where the page drew the line: {count, after (the card just above it), kind,
  // faded (it holds nothing unread and fades where it is), inert}.
  // after: the message the line sits under; under a reply stack, the message the stack holds its replies under (docs/topic-reading.md).
  const above = 'l=>{const e=l?.previousElementSibling;return (e?.classList.contains("reply-stack")?e.querySelector("[data-id]"):e)?.dataset?.id??null}';
  const drawn = p => p.evaluate(`(()=>{const lines=[...document.querySelectorAll('#messages .new-line')];
    return {count:lines.length,after:(${above})(lines[0]),kind:lines[0]?.dataset?.line??null,
      faded:lines[0]?.classList.contains('new-line-read')??null,inert:lines[0]?.inert??null}})()`);
  // The page and the server agree: one line just below the oldest unread card,
  // showing; or, when all is read, none or one faded.
  const agreed = async (p, topic) => {
    const [oldest, line] = [await unread(topic), await drawn(p)];
    return oldest === null ? line.count === 0 || line.count === 1 && line.faded :
      line.count === 1 && line.kind === 'new' && !line.faded && line.after === oldest.id;
  };
  // The line once its fade has run: no longer seen, its space kept, inert.
  const fadedOut = (p, label) => until(() => p.evaluate(`(()=>{const line=document.querySelector('#messages .new-line'),c=line&&getComputedStyle(line);
    return line&&c.opacity==='0'&&c.visibility==='hidden'?{opacity:c.opacity,visibility:c.visibility,pointer:c.pointerEvents,inert:line.inert,
      height:line.getBoundingClientRect().height,after:(${above})(line)}:null})()`), label);
  const settle = (p, topic, label) => until(() => agreed(p, topic), label);
  const cardTop = (p, id) => p.evaluate(`document.querySelector('#messages [data-id="${id}"]').getBoundingClientRect().top`);
  // The first card in view: what the person is reading.
  // Brings the oldest unread card into view until nothing is unread; each step
  // waits for the server to hear it was read.
  const readAll = async (p, topic, label) => {
    for (let oldest; (oldest = await unread(topic));) {
      await p.evaluate(`document.querySelector('#messages [data-id="${oldest.id}"]').scrollIntoView({block:'center'})`);
      await until(async () => (await unread(topic))?.id !== oldest.id, label + ': read ' + oldest.id);
    }
  };
  // Resolves once the page has had the answer to a topic_unread read it sent
  // at or after since, and two frames have passed for it to draw what it said.
  const pageRead = async (p, since, label) => {
    await until(() => {
      const sent = p.network.filter(e => e.method === 'Network.requestWillBeSent' && e.observedAt >= since &&
        /"name":"topic_unread"/.test(e.params.request.postData ?? '')).map(e => e.params.requestId);
      return sent.some(id => p.network.some(e => e.method === 'Network.loadingFinished' && e.params.requestId === id));
    }, label + ': the page read where the oldest unread message is');
    await p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  const reading = p => p.evaluate(`(()=>{const c=[...document.querySelectorAll('#messages .message-card')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});return {id:c.dataset.id,top:c.getBoundingClientRect().top}})()`);

  // The same checks of the line staying while read on screen that
  // webkit_native.mjs --new-line runs in WebKit, here in Chrome for Testing.
  await newLineStaysChecks({ check, until, view, control, observations, engine: 'chrome', shot,
    open: async (url, size, name, { lose = null, hold = null } = {}) => {
      let lost = false, released = false;
      const held = [];
      const p = await page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
        q.recordResponses();
        // The first command lose accepts reaches the server; its answer is then
        // lost. Each view read hold accepts is answered; the page waits for it.
        if (lose || hold) q.intercept((payload, event) => {
          if (lose && !lost && event.request.url.endsWith('/api/command') && lose(payload)) {
            lost = true;
            q.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionReset' }).catch(error => q.errors.push({ message: error.message }));
            return true;
          }
          if (hold && !released && event.request.url.endsWith('/api/view') && hold(payload)) { held.push({ event, payload }); return true; }
          return false;
        });
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await q.send('Emulation.setDeviceMetricsOverride', size);
      } });
      return Object.assign(p, {
        heldAnswer: () => held.length > 0,
        releaseAnswer: async () => { released = true; for (const entry of held.splice(0)) await p.release(entry); },
        reports: () => p.calls.filter(c => c.payload?.kind === 'topic.read_through').map(c => [c.payload.args.from_seq, c.payload.args.seq]),
        answered: (viewName, test) => p.responses.some(r => r.payload?.name === viewName && test(r.body)),
      });
    } });

  await check('colors the New line sits under the oldest unread message, holds while it is read, and moves on opening the topic again', async () => {
    for (const theme of ['light', 'dark']) {
      // A page of agent messages: the oldest ones are below the first screen.
      // A screen lower than what follows the line, so the line can reach the
      // top with the oldest card wholly above it: the page ends in the reply's
      // one quiet line (docs/reader.md), not a whole writing box.
      const topic = 'new-line-read-' + theme, ids = await topicWith(topic, 24);
      const p = await open(topic, 'new-line-' + theme, theme, 400);
      // What shows on the first screen is read; the oldest message is not on it.
      await settle(p, topic, theme + ': the line drawn where the server says');
      const oldest = await unread(topic);
      assert.equal(oldest?.id, ids[0], theme + ': the oldest message, never on screen, holds the line');
      assert.ok((await view('topic_messages', { topic_id: topic, direction: 'before', limit: 30 })).oldest_unread.id === ids[0], theme + ': every page says the same');
      const placed = await p.evaluate(`(()=>{
        const lines=[...document.querySelectorAll('#messages .new-line')],line=lines[0];
        const card=document.querySelector('#messages [data-id="${ids[0]}"]');
        const c=getComputedStyle(line),rule=getComputedStyle(line,'::before');
        const time=line.querySelector('.new-line-time time'),cardTime=card?.querySelector('.message-time time');
        return {count:lines.length,text:line.textContent,label:line.querySelector('.new-line-label')?.textContent??null,
          time:time?.textContent??null,title:time?.title??null,cardTime:cardTime?.textContent??null,cardTitle:cardTime?.title??null,
          timeCase:time?getComputedStyle(time.parentElement).textTransform:null,after:line.previousElementSibling===card,
          seq:line.dataset.seq??null,id:line.dataset.id??null,color:c.color,rule:rule.backgroundColor,
          page:getComputedStyle(document.documentElement).backgroundColor}})()`);
      assert.equal(placed.count, 1, theme + ': one New line');
      assert.match(placed.text, new RegExp('^New above · ' + SHOWN + '$'), theme + ': its words say the new messages are above it, and when that message was sent');
      assert.equal(placed.label, 'New above', theme + ': the label is a span of its own');
      assert.deepEqual([placed.time, placed.title], [placed.cardTime, placed.cardTitle], theme + ': the time its card shows, with the same dated title');
      assert.match(placed.title, DATED, theme + ': its title keeps the date');
      assert.equal(placed.timeCase, 'none', theme + ': the time is not in capitals');
      assert.equal(placed.after, true, theme + ': just below the oldest unread card');
      assert.deepEqual([placed.seq, placed.id], [null, null], theme + ': the line is not a card');
      assert.equal(placed.rule, placed.color, theme + ': rule and words are one red');
      const [r, g, b] = placed.color.match(/[\d.]+/g).map(Number);
      assert.ok(r > g + 60 && r > b + 60, theme + ': red');
      assert.ok(contrast(placed.color, placed.page) >= 4.5, theme + `: readable (${contrast(placed.color, placed.page).toFixed(2)})`);
      // The line at the top of the view, the unread card wholly above it: nothing new is read.
      const above = await p.evaluate(`(()=>{document.querySelector('#messages .new-line').scrollIntoView({block:'start'});
        return document.querySelector('#messages [data-id="${ids[0]}"]').getBoundingClientRect().bottom})()`);
      assert.ok(above <= 0, theme + ': the oldest unread card is wholly above the view: ' + above);
      await shot(p, 'new-line-' + theme);
      assert.equal((await unread(topic))?.id, ids[0], theme + ': a card out of view is not read');
      // Reading the oldest on screen: the server moves on, and the line holds
      // under it for the rest of the visit, so it does not vanish.
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[0]}"]').scrollIntoView({block:'center'})`);
      const since = Date.now();
      await until(async () => (await unread(topic))?.id !== ids[0], theme + ': the oldest, now on screen, is read');
      const next = await unread(topic);
      await pageRead(p, since, theme);
      const held = await drawn(p);
      assert.deepEqual([held.count, held.kind, held.after, held.faded], [1, 'new', ids[0], false], theme + ': read during the visit, the line holds where it was placed, still showing what is unread above it');
      // Opening the topic again places it afresh, under the oldest still unread.
      const again = await open(topic, 'new-line-again-' + theme, theme);
      // Under the oldest still unread as the server has it then: the first page, still open, may read past next meanwhile.
      await until(() => agreed(again, topic), theme + ': opened again, the line is under the oldest still unread')
        .catch(async error => { throw Error(error.message + ' ' + JSON.stringify({ next: next?.id, now: (await unread(topic))?.id, drawn: await drawn(again) })); });
      assert.notEqual((await drawn(again)).after, ids[0], theme + ': placed afresh, not where the visit before held it');
      await again.close();
      await p.send('Page.bringToFront');
      // Read to the end on screen: nothing at or above the line is unread, yet
      // reading on screen is not reading for the line, so it holds, showing.
      // Opening a message at or above it in the Reader fades it out where it
      // is, with no Refresh; opening the topic again shows none.
      const last = Date.now();
      await readAll(p, topic, theme);
      await pageRead(p, last, theme + ': all read');
      const kept = await drawn(p);
      assert.deepEqual([kept.count, kept.kind, kept.after, kept.faded], [1, 'new', ids[0], false], theme + ': all read on screen, the line still shows');
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[0]}"]').scrollIntoView({block:'center'})`);
      await p.point(`#messages [data-id="${ids[0]}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open"), theme + ': the Reader is open on the message at the line');
      const read = await fadedOut(p, theme + ': opened, the line fades out');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed');
      assert.deepEqual([read.after, read.inert, read.pointer], [ids[0], true, 'none'], theme + ': in its place, inert: ' + JSON.stringify(read));
      assert.ok(read.height > 0, theme + ': it keeps its space, so nothing below it shifts');
      assert.deepEqual(p.errors, []);
      await p.close();
      const after = await open(topic, 'new-line-read-again-' + theme, theme);
      await until(() => after.evaluate(`document.body?.dataset.ready === 'true' && Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': opened again');
      await settle(after, topic, theme + ': all read and opened again, no line');
      observations.push({ name: 'new line holds while read', theme, oldest, placed, held, next });
      assert.deepEqual(after.errors, []);
      await after.close();
    }
  });

  await check('colors a message arriving while the person is caught up brings the line under it, Mark unread moves it down (not up), Mark read places it afresh, and an arrival at the top comes into view', async () => {
    for (const theme of ['light', 'dark']) {
      const topic = 'new-line-arrive-' + theme, ids = await topicWith(topic, 24);
      const first = await open(topic, 'new-line-arrive-' + theme, theme);
      await until(() => first.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': loaded');
      await readAll(first, topic, theme + ': catching up');
      assert.deepEqual(first.errors, []);
      await first.close();
      // Caught up, the topic opens again with no line.
      const p = await open(topic, 'new-line-arrive-again-' + theme, theme);
      await until(() => p.evaluate(`document.body?.dataset.ready === 'true' && Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': opened again');
      await settle(p, topic, theme + ': caught up and opened again, no line');
      // Further down, the newest card out of view above: what arrives is not on screen.
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[12]}"]').scrollIntoView({block:'start'})`);
      const held = await reading(p);
      const arrival = (await control({ method: 'agent_message', operation_id: topic + '-arrival', topic_id: topic, body: 'Arriving while the person reads further down.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${arrival}"]'))`), theme + ': arrival drawn');
      await settle(p, topic, theme + ': the line just below the arrival');
      assert.equal((await drawn(p)).after, arrival, theme + ': under the message that arrived');
      assert.ok(Math.abs(await cardTop(p, held.id) - held.top) <= 1, theme + ': the card being read held still as the message and the line came');
      // Mark unread, from another tab, on an older message already read: the
      // line moves down to just below it. Clearing the mark there is not this
      // page's Mark read: the line holds for the visit.
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids[3]], marked: true });
      await until(async () => (await drawn(p)).after === ids[3], theme + ': marked unread, the line moves down to it');
      await settle(p, topic, theme + ': where the server says');
      assert.ok(Math.abs(await cardTop(p, held.id) - held.top) <= 1, theme + ': the card being read held still as the line moved down');
      const since = Date.now();
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids[3]], marked: false });
      await pageRead(p, since, theme + ': cleared elsewhere');
      assert.deepEqual([(await drawn(p)).after, (await drawn(p)).faded], [ids[3], false], theme + ': cleared in another tab, the line holds: the arrival above it is still unread');
      // This page's own Mark unread and then Mark read on that message, in the
      // Reader, places the line afresh: back under the arrival.
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[3]}"]').scrollIntoView({block:'center'})`);
      await p.point(`#messages [data-id="${ids[3]}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open && !document.querySelector('#mark-unread').hidden"), theme + ': the Reader is open on the cleared message');
      await p.point('#mark-unread');
      await until(async () => (await unread(topic))?.id === ids[3], theme + ': marked unread here');
      await p.point('#mark-unread');
      await until(async () => (await drawn(p)).after === arrival, theme + ': Mark read here brings the line back under the arrival');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed');
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[12]}"]').scrollIntoView({block:'start'})`);
      // In this page's Reader: Mark unread moves the line down to the message;
      // pressing it again (Mark read) places the line afresh, under the arrival.
      await p.point(`#messages [data-id="${ids[10]}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open && !document.querySelector('#mark-unread').hidden"), theme + ': the Reader is open with its mark button');
      await p.point('#mark-unread');
      await until(async () => (await drawn(p)).after === ids[10], theme + ': Mark unread in the Reader moves the line down to the message');
      await p.point('#mark-unread');
      await until(async () => (await drawn(p)).after === arrival && (await unread(topic))?.id === arrival, theme + ': Mark read places the line afresh');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed');
      // At the top: the arrival is read on screen and the line holds under it;
      // opening it in the Reader fades the line where it is.
      const top0 = Date.now();
      await p.evaluate('scrollTo(0,0)');
      await until(async () => await unread(topic) === null, theme + ': the arrival, now on screen, is read');
      await pageRead(p, top0, theme + ': the arrival read');
      assert.deepEqual([(await drawn(p)).after, (await drawn(p)).faded], [arrival, false], theme + ': read on screen, the line holds under the arrival');
      await p.point(`#messages [data-id="${arrival}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open"), theme + ': the Reader is open on the arrival');
      assert.equal((await fadedOut(p, theme + ': opened, the line fades')).after, arrival, theme + ': where it was, under the arrival');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed on the arrival');
      // Faded, the line is gone for the person: a message that now arrives
      // brings it just below that message, not back where it was.
      const top = (await control({ method: 'agent_message', operation_id: topic + '-top', topic_id: topic, body: 'Arriving while the person is at the top.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${top}"]'))`), theme + ': arrival at the top drawn');
      const shown = await p.evaluate(`(()=>{const r=document.querySelector('#messages [data-id="${top}"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,first:document.querySelector('#messages .message-card').dataset.id}})()`);
      assert.equal(shown.first, top, theme + ': the arrival is the newest card');
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height, theme + ': and it is in view');
      await until(async () => (await drawn(p)).after === top, theme + ': the faded line comes back just below the newest arrival, not under the first');
      await shot(p, 'new-line-' + theme + '-top-arrival');
      // On screen, the newest is read and the line holds under it; opening it
      // in the Reader fades the line. Mark unread there brings the line back
      // where it is; Mark read then places it afresh: with nothing unread, it
      // fades again.
      await until(async () => await unread(topic) === null, theme + ': the newest, on screen, is read');
      assert.equal((await drawn(p)).faded, false, theme + ': read on screen, the line holds under the newest');
      await p.point(`#messages [data-id="${top}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open && !document.querySelector('#mark-unread').hidden"), theme + ': the Reader is open on the newest');
      assert.equal((await fadedOut(p, theme + ': opened, the line fades')).after, top);
      await p.point('#mark-unread');
      await until(async () => (await unread(topic))?.id === top, theme + ': the newest is marked unread');
      await until(async () => { const line = await drawn(p); return line.after === top && line.faded === false && line.inert === false; }, theme + ': marked unread, the line under it shows again');
      await p.point('#mark-unread');
      await until(async () => await unread(topic) === null, theme + ': Mark read');
      const again = await fadedOut(p, theme + ': Mark read places the line afresh: nothing is unread, so it fades');
      assert.deepEqual([again.after, (await drawn(p)).count], [top, 1], theme + ': where it was');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed again');
      observations.push({ name: 'new line on arrival', theme, held, arrival, shown });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // Tony's case (What's live #584, #587): he had read and answered everything
  // above the line and it stayed until Refresh. Open the message in the
  // Reader, reply, and the line fades out where it is, with no Refresh. The
  // message is marked unread from another tab, so reading it on screen does
  // not clear it first: opening it does. The reply, the person's own, holds
  // nothing, so the line stays faded. Under reduced motion there is no fade.
  await check('colors open a message in the Reader and reply: the New line fades out where it is, with no Refresh', async () => {
    for (const theme of ['light', 'dark']) {
      const topic = 'new-line-reply-' + theme, ids = await topicWith(topic, 6);
      const first = await open(topic, 'new-line-reply-catch-up-' + theme, theme);
      await until(() => first.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': loaded');
      await readAll(first, topic, theme + ': catching up');
      assert.deepEqual(first.errors, []);
      await first.close();
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids[2]], marked: true });
      const p = await open(topic, 'new-line-reply-' + theme, theme);
      await settle(p, topic, theme + ': the line under the message marked unread');
      // Which document this is: a timeOrigin kept on the window (a reload has a new one). A count of
      // navigation entries cannot tell, as every document holds exactly one.
      const loaded = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
      // The reply stacks under the message it answers and brings that stack up (docs/topic-reading.md, "Reply stacks"); the line stays where it was,
      // under the lowest stack holding anything newer than its message, so nothing newer sits below it (docs/reply-stacks.md, "One New line"), keeping its own height.
      const lineHeight = () => p.evaluate(`document.querySelector('#messages .new-line').getBoundingClientRect().height`);
      const before = await lineHeight();
      assert.deepEqual(await drawn(p), { count: 1, after: ids[2], kind: 'new', faded: false, inert: false }, theme + ': it shows');
      await p.point(`#messages [data-id="${ids[2]}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open && Boolean(document.querySelector('#writing-body'))"), theme + ': the Reader is open on the message');
      await until(async () => await unread(topic) === null, theme + ': opening it read it');
      await p.point('#writing-body'); await p.send('Input.insertText', { text: 'Read it, thanks.' });
      const from = p.calls.length;
      await p.point('#send-reply');
      const call = await until(() => p.calls.slice(from).find(c => c.payload?.kind === 'message.send'), theme + ': the reply is sent');
      const reply = (await until(async () => { const r = await view('operation', { operation_id: call.payload.operation_id }); return r.status === 'committed' && r; }, theme + ': the reply committed')).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${reply}"]'))`), theme + ': the reply drawn');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': sending closed the Reader');
      const faded = await fadedOut(p, theme + ': opened and answered, the line fades out');
      assert.deepEqual([faded.after, faded.inert, faded.pointer, (await drawn(p)).count], [ids[3], true, 'none', 1], theme + ': where it was, under the oldest message newer than its own, inert: ' + JSON.stringify({ faded, ids, reply }));
      assert.ok(Math.abs(faded.height - before) <= 1, theme + `: it keeps its space (${faded.height} of ${before})`);
      assert.equal(await p.evaluate(`(()=>{const top=document.querySelector('#messages > .reply-stack');return top.dataset.stack===${JSON.stringify(ids[2])}&&top.contains(document.querySelector('#messages [data-id="${reply}"]'))&&Boolean(top.compareDocumentPosition(document.querySelector('#messages .new-line'))&Node.DOCUMENT_POSITION_FOLLOWING)})()`), true, theme + ': the reply is in its message\'s stack, brought up above the line');
      assert.equal(await unread(topic), null, theme + ': the reply, the person\'s own, holds nothing');
      assert.equal(await p.evaluate('(window.documentOrigin??=performance.timeOrigin)'), loaded, theme + ': no reload');
      assert.equal(await p.evaluate("document.querySelector('#refresh')"), null, theme + ': and no Refresh to press');
      await shot(p, 'new-line-' + theme + '-replied');
      // The fade is a short transition; asked for reduced motion, none.
      const duration = () => p.evaluate("getComputedStyle(document.querySelector('#messages .new-line')).transitionDuration");
      assert.match(await duration(), /^0\.6s/, theme + ': a short fade');
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.match(await duration(), /^0s(, 0s)*$/, theme + ': reduced motion fades nothing');
      observations.push({ name: 'new line fades after reply', theme, faded, before });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // "More new below" promises unread messages further back. Read elsewhere, it
  // fades where it is, inert, and More messages comes back to load older ones.
  // What this page shows on its first screen was read in another tab first,
  // so nothing this page read on screen holds the line.
  await check('colors "More new below" fades once what it leads to is read elsewhere, and More messages comes back', async () => {
    const topic = 'new-line-older-read', ids = await topicWith(topic, 40);
    const elsewhere = await open(topic, 'new-line-older-read-elsewhere', 'light');
    await until(() => elsewhere.calls.some(c => c.payload?.kind === 'topic.read_through'), 'another tab reads its first screen');
    await elsewhere.close();
    const p = await open(topic, 'new-line-older-read', 'light');
    await until(async () => (await drawn(p)).kind === 'older', 'the line waits at the bottom');
    assert.deepEqual([await olderControl(p), (await drawn(p)).faded], ['#messages .new-line-older', false], 'it is what loads older messages, and More is hidden');
    // The person reads the whole topic elsewhere, as an agent writes again.
    await control({ method: 'agent_message', operation_id: topic + '-read-elsewhere', topic_id: topic, body: 'Read everywhere since.', read: true });
    await until(async () => await unread(topic) === null, 'nothing is unread');
    const marker = await until(async () => { const line = await drawn(p); return line.faded && line.inert && line; }, 'the line fades, inert');
    assert.deepEqual([marker.kind, marker.count], ['older', 1], 'where it was, at the bottom');
    await until(async () => await olderControl(p) === '#more-messages', 'More messages is back, and loads older messages');
    const cards = await p.evaluate("document.querySelectorAll('#messages .message-card').length");
    await p.evaluate("document.querySelector('#more-messages').scrollIntoView({block:'center'})");
    await p.point('#more-messages');
    await until(() => p.evaluate(`document.querySelectorAll('#messages .message-card').length > ${cards}`), 'More loads the older messages');
    await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), 'down to the oldest');
    const placed = await drawn(p);
    assert.deepEqual([placed.count, placed.kind, placed.after, placed.faded], [1, 'new', ids[0], true], 'loaded, the line is in its place, still faded: nothing there is unread');
    await shot(p, 'new-line-older-read');
    observations.push({ name: 'more new below fades', marker, placed });
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('colors the New line for a message further back waits at the bottom, and pressing it brings that message', async () => {
    for (const theme of ['light', 'dark']) {
      // More than a page: the oldest unread message is beyond the first page the topic loads.
      const topic = 'new-line-older-' + theme, ids = await topicWith(topic, 40);
      const answer = await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 30 });
      assert.equal(answer.oldest_unread?.id, ids[0]);
      assert.ok(!answer.items.some(item => item.id === ids[0]), 'the oldest unread message is not on the first page');
      const p = await open(topic, 'new-line-older-' + theme, theme);
      await until(() => p.evaluate("Boolean(document.querySelector('#messages .new-line'))"), theme + ': a line drawn');
      const marker = await p.evaluate(`(()=>{const list=document.querySelector('#messages'),line=list.querySelector('.new-line');
        const c=getComputedStyle(line);return {count:list.querySelectorAll('.new-line').length,last:![...list.children].slice([...list.children].indexOf(line)+1).some(e=>e.dataset.id||e.classList.contains('reply-stack')),tag:line.tagName,kind:line.dataset.line,text:line.textContent,
          label:line.querySelector('.new-line-label')?.textContent??null,
          color:c.color,page:getComputedStyle(document.documentElement).backgroundColor,loaded:Boolean(list.querySelector('[data-id="${ids[0]}"]')),
          fill:c.backgroundColor,border:[c.borderTopWidth,c.borderBottomWidth,c.borderLeftWidth,c.borderRightWidth],more:document.querySelector('#more-messages').hidden,
          button:(b=>({fill:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderTopColor}))(document.querySelector('#more-messages')),borderColor:c.borderTopColor}})()`);
      // Last of the messages loaded; the New message composer resting under them (item 465) comes after it.
      assert.deepEqual([marker.count, marker.last, marker.tag, marker.kind, marker.label, marker.loaded], [1, true, 'BUTTON', 'older', 'More new below', false], theme + ': at the bottom of what is loaded, saying more new messages are below');
      assert.match(marker.text, new RegExp('^More new below · ' + SHOWN + '$'), theme + ': and when that message was sent');
      assert.ok(contrast(marker.color, marker.fill) >= 4.5, theme + ': readable');
      // A control that looks like one: framed and filled as the page's other buttons.
      assert.deepEqual([marker.border, marker.fill, marker.borderColor], [Array(4).fill('1px'), marker.button.fill, marker.button.border], theme + ': framed and filled as a button: ' + JSON.stringify(marker));
      assert.equal(marker.more, true, theme + ': More messages is hidden while the line shows');
      await p.send('Emulation.setDeviceMetricsOverride', phone);
      const narrowMarker = await narrowLine(p);
      assert.equal(narrowMarker.lines, 1, theme + ': at 390 wide "More new below" and its time fit on one line');
      assert.ok(narrowMarker.right <= narrowMarker.width && narrowMarker.scroll <= narrowMarker.width, theme + ': and inside the page');
      // The longest words the line can say: its longer label with the longest
      // time forms (docs/times.md), a date on another day and yesterday's, in
      // the page's own time element, at 390 wide.
      for (const [when, form] of [['12:59 PM Wed Nov 25', 'dated'], ['Yesterday 12:59 PM', 'yesterday']]) {
        const kept = await p.evaluate(`(()=>{const t=document.querySelector('#messages .new-line .new-line-time time'),was=t.textContent;t.textContent=${JSON.stringify(when)};return was})()`);
        const longest = await narrowLine(p);
        assert.equal(longest.text, 'More new below · ' + when, theme + ': the longest ' + form + ' words are the ones measured');
        assert.equal(longest.lines, 1, theme + `: at 390 wide "More new below · ${when}" fits on one line`);
        assert.ok(longest.right <= longest.width && longest.scroll <= longest.width, theme + ': and inside the page: ' + JSON.stringify(longest));
        if (form === 'dated') await shot(p, 'new-line-older-' + theme + '-longest-390');
        await p.evaluate(`document.querySelector('#messages .new-line .new-line-time time').textContent=${JSON.stringify(kept)}`);
      }
      await p.send('Emulation.setDeviceMetricsOverride', desk);
      await p.evaluate("document.querySelector('#messages .new-line').scrollIntoView({block:'center'})");
      await shot(p, 'new-line-older-' + theme);
      // Reached by keyboard and pressed with Return, as a button is.
      await p.evaluate("document.querySelector('#messages .new-line').focus()");
      await p.key('Enter');
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': the message further back is loaded');
      await until(() => p.evaluate(`document.activeElement?.dataset?.id === ${JSON.stringify(ids[0])}`), theme + ': and has the focus');
      // In view it is read, and the line holds under it for the visit.
      await until(async () => (await unread(topic))?.id !== ids[0], theme + ': the message brought into view is read');
      assert.equal((await drawn(p)).after, ids[0], theme + ': the line in its true place, just below it');
      const placed = await p.evaluate(`(()=>{const card=document.querySelector('#messages [data-id="${ids[0]}"]'),r=card.getBoundingClientRect();
        return {inView:r.top<innerHeight&&r.bottom>0,lines:document.querySelectorAll('#messages .new-line').length}})()`);
      assert.equal(placed.inView, true, theme + ': the message is in view');
      assert.match(await p.evaluate("document.querySelector('#messages .new-line').textContent"), new RegExp('^New above · ' + SHOWN + '$'),
        theme + ': the line in its place says when its message was sent');
      // More messages is back exactly when older messages are left to load.
      const lowest = await p.evaluate("Math.min(...[...document.querySelectorAll('#messages .message-card')].map(card=>Number(card.dataset.seq)))");
      const older = await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', cursor: lowest, limit: 1 });
      assert.equal(await p.evaluate("document.querySelector('#more-messages').hidden"), older.items.length === 0, theme + `: More messages is back for what is older (${older.items.length} below #${lowest})`);
      await shot(p, 'new-line-older-' + theme + '-reached');
      // At a phone's width, both forms of the line keep their words on one line, inside the page.
      await p.send('Emulation.setDeviceMetricsOverride', phone);
      const narrow = await narrowLine(p);
      assert.equal(narrow.lines, 1, theme + ': at 390 wide the words fit on one line');
      assert.ok(narrow.right <= narrow.width && narrow.scroll <= narrow.width, theme + ': and inside the page');
      await shot(p, 'new-line-older-' + theme + '-reached-390');
      await p.send('Emulation.setDeviceMetricsOverride', desk);
      observations.push({ name: 'new line further back', theme, marker, placed, after: await drawn(p) });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
}
