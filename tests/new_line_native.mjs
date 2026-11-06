// The red New line, as painted: just below the card of the oldest message the
// person had not read when the topic opened, as the server names it
// (topic_unread); red words "New above" and when that message was sent,
// readable on the page in light and dark. During the visit reading never
// moves it up, so it does not vanish as the person reads; it moves to show
// more (Mark unread further back, an arrival while caught up; Mark unread
// above the line leaves it) and on the person's explicit Mark read, and
// Refresh or opening the topic again places it afresh, with the card being
// read held still wherever it moves. At the top of the topic a message that
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

export async function newLineCheck({ check, page, until, view, control, shot, observations, facts }) {
  // A topic of the person's own, with count agent messages in it, oldest first; their ids.
  const topicWith = async (id, count) => {
    await control({ method: 'navigation_topics', topics: [{ id, title: 'New line ' + id }] });
    const ids = [];
    for (let n = 0; n < count; n++) ids.push((await control({ method: 'agent_message', operation_id: `${id}-${n}`, topic_id: id, join: n === 0,
      body: `Agent message ${n} in ${id}.` })).result.message_id);
    return ids;
  };
  const open = (topic, suffix, theme) => page(suffix, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async p => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  } });
  const unread = async topic => (await view('topic_unread', { topic_id: topic })).oldest_unread;
  // Where the page drew the line: {count, after (the card just above it), kind}.
  const drawn = p => p.evaluate(`(()=>{const lines=[...document.querySelectorAll('#messages .new-line')];
    return {count:lines.length,after:lines[0]?.previousElementSibling?.dataset?.id??null,kind:lines[0]?.dataset?.line??null}})()`);
  // The page and the server agree: one line just below the oldest unread card, or none when all is read.
  const agreed = async (p, topic) => {
    const [oldest, line] = [await unread(topic), await drawn(p)];
    return oldest === null ? line.count === 0 : line.count === 1 && line.kind === 'new' && line.after === oldest.id;
  };
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
  // Refresh, pressed from the keyboard so the page keeps its place: the header
  // is out of view when the person reads further down.
  const refresh = async p => { await p.evaluate("document.querySelector('#refresh').focus({preventScroll:true})"); await p.key('Enter'); };
  const reading = p => p.evaluate(`(()=>{const c=[...document.querySelectorAll('#messages .message-card')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});return {id:c.dataset.id,top:c.getBoundingClientRect().top}})()`);

  await check('colors the New line sits under the oldest unread message, holds while it is read, and moves on Refresh and on opening the topic again', async () => {
    for (const theme of ['light', 'dark']) {
      // A page of agent messages: the oldest ones are below the first screen.
      const topic = 'new-line-read-' + theme, ids = await topicWith(topic, 24);
      const p = await open(topic, 'new-line-' + theme, theme);
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
      await p.evaluate("document.querySelector('#messages .new-line').scrollIntoView({block:'start'})");
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
      assert.deepEqual([held.count, held.kind, held.after], [1, 'new', ids[0]], theme + ': read during the visit, the line holds where it was placed');
      // Opening the topic again places it afresh, under the oldest still unread.
      const again = await open(topic, 'new-line-again-' + theme, theme);
      await until(async () => (await drawn(again)).after === next?.id, theme + ': opened again, the line is under the oldest still unread');
      await again.close();
      await p.send('Page.bringToFront');
      // So does Refresh, and the card being read holds still as it moves.
      const reader = await reading(p);
      await refresh(p);
      await settle(p, topic, theme + ': Refresh places the line where the server says');
      assert.ok(Math.abs(await cardTop(p, reader.id) - reader.top) <= 1, theme + ': the card being read held still');
      const moved = await drawn(p);
      // Read to the end: the line holds until Refresh, which takes it away.
      await readAll(p, topic, theme);
      assert.equal((await drawn(p)).count, 1, theme + ': all read, the line still holds');
      await refresh(p);
      await settle(p, topic, theme + ': all read and refreshed, no line');
      observations.push({ name: 'new line holds while read', theme, oldest, placed, held, next, moved });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('colors a message arriving while the person is caught up brings the line under it, Mark unread moves it down (not up), Mark read places it afresh, and an arrival at the top comes into view', async () => {
    for (const theme of ['light', 'dark']) {
      const topic = 'new-line-arrive-' + theme, ids = await topicWith(topic, 24);
      const p = await open(topic, 'new-line-arrive-' + theme, theme);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': loaded');
      await readAll(p, topic, theme + ': catching up');
      await refresh(p);
      await settle(p, topic, theme + ': caught up and refreshed, no line');
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
      // page's Mark read: the line holds until Refresh.
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids[3]], marked: true });
      await until(async () => (await drawn(p)).after === ids[3], theme + ': marked unread, the line moves down to it');
      await settle(p, topic, theme + ': where the server says');
      assert.ok(Math.abs(await cardTop(p, held.id) - held.top) <= 1, theme + ': the card being read held still as the line moved down');
      const since = Date.now();
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids[3]], marked: false });
      await pageRead(p, since, theme + ': cleared elsewhere');
      assert.equal((await drawn(p)).after, ids[3], theme + ': cleared in another tab, the line holds');
      await refresh(p);
      await until(async () => (await drawn(p)).after === arrival, theme + ': Refresh brings the line back under the arrival');
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
      // At the top: the arrival is read, and the line holds under it for the visit.
      await p.evaluate('scrollTo(0,0)');
      await until(async () => await unread(topic) === null, theme + ': the arrival, now on screen, is read');
      const top = (await control({ method: 'agent_message', operation_id: topic + '-top', topic_id: topic, body: 'Arriving while the person is at the top.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${top}"]'))`), theme + ': arrival at the top drawn');
      const shown = await p.evaluate(`(()=>{const r=document.querySelector('#messages [data-id="${top}"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,first:document.querySelector('#messages .message-card').dataset.id}})()`);
      assert.equal(shown.first, top, theme + ': the arrival is the newest card');
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height, theme + ': and it is in view');
      assert.equal((await drawn(p)).after, arrival, theme + ': the line still holds under the first arrival, below the newest');
      await shot(p, 'new-line-' + theme + '-top-arrival');
      // Mark unread in the Reader on that newest message, above the line: it is
      // already shown as new, so the line holds; Mark read then places it
      // afresh, and with nothing unread there is none.
      await until(async () => await unread(topic) === null, theme + ': the newest, on screen, is read');
      await p.point(`#messages [data-id="${top}"]`);
      await until(() => p.evaluate("document.querySelector('#reader').open && !document.querySelector('#mark-unread').hidden"), theme + ': the Reader is open on the newest');
      const marking = Date.now();
      await p.point('#mark-unread');
      await until(async () => (await unread(topic))?.id === top, theme + ': the newest is marked unread');
      await pageRead(p, marking, theme + ': marked above the line');
      assert.equal((await drawn(p)).after, arrival, theme + ': Mark unread above the line leaves it where it is');
      await p.point('#mark-unread');
      await until(async () => (await drawn(p)).count === 0 && await unread(topic) === null, theme + ': Mark read places the line afresh: none');
      await p.point('#reader-close');
      await until(() => p.evaluate("!document.querySelector('#reader').open"), theme + ': the Reader closed again');
      observations.push({ name: 'new line on arrival', theme, held, arrival, shown });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
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
        const c=getComputedStyle(line);return {count:list.querySelectorAll('.new-line').length,last:list.lastElementChild===line,tag:line.tagName,kind:line.dataset.line,text:line.textContent,
          label:line.querySelector('.new-line-label')?.textContent??null,
          color:c.color,page:getComputedStyle(document.documentElement).backgroundColor,loaded:Boolean(list.querySelector('[data-id="${ids[0]}"]')),
          fill:c.backgroundColor,border:[c.borderTopWidth,c.borderBottomWidth,c.borderLeftWidth,c.borderRightWidth],more:document.querySelector('#more-messages').hidden,
          button:(b=>({fill:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderTopColor}))(document.querySelector('#more-messages')),borderColor:c.borderTopColor}})()`);
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
