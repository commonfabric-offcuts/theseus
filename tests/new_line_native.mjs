// The red New line, as painted: just below the card of the oldest message the
// person has not read, as the server names it (topic_unread); red words "New"
// readable on the page in light and dark. Reading on screen moves it live,
// with the card being read held still; a message that arrives while the
// person is caught up brings it back; Mark unread moves it down. At the top of
// the topic a message that arrives comes into view above. Each case reads in
// a topic of its own, so what earlier checks read does not matter. Run by
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
  const reading = p => p.evaluate(`(()=>{const c=[...document.querySelectorAll('#messages .message-card')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});return {id:c.dataset.id,top:c.getBoundingClientRect().top}})()`);

  await check('colors the New line sits under the oldest unread message, and moves up live as it is read', async () => {
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
      assert.match(placed.text, new RegExp('^New · ' + SHOWN + '$'), theme + ': its words are "New" and when that message was sent');
      assert.equal(placed.label, 'New', theme + ': the label is a span of its own');
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
      // Reading the oldest on screen moves the line up, live, to the next unread
      // one above it; the card the person reads holds still.
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[0]}"]').scrollIntoView({block:'center'})`);
      const held = await reading(p);
      await until(async () => (await unread(topic))?.id !== ids[0], theme + ': the oldest, now on screen, is read');
      await settle(p, topic, theme + ': the line follows, without a reload');
      assert.ok(Math.abs(await cardTop(p, held.id) - held.top) <= 1, theme + ': the card being read held still');
      const moved = await drawn(p);
      // Reading the rest takes the line away.
      await readAll(p, topic, theme);
      await settle(p, topic, theme + ': all read, no line');
      observations.push({ name: 'new line follows reading', theme, oldest, placed, held, moved });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('colors a message arriving while the person is caught up brings the line under it, Mark unread moves it down, and an arrival at the top comes into view', async () => {
    for (const theme of ['light', 'dark']) {
      const topic = 'new-line-arrive-' + theme, ids = await topicWith(topic, 24);
      const p = await open(topic, 'new-line-arrive-' + theme, theme);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': loaded');
      await readAll(p, topic, theme + ': catching up');
      await settle(p, topic, theme + ': no line');
      // Further down, the newest card out of view above: what arrives is not on screen.
      await p.evaluate(`document.querySelector('#messages [data-id="${ids[12]}"]').scrollIntoView({block:'start'})`);
      const held = await reading(p);
      const arrival = (await control({ method: 'agent_message', operation_id: topic + '-arrival', topic_id: topic, body: 'Arriving while the person reads further down.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${arrival}"]'))`), theme + ': arrival drawn');
      await settle(p, topic, theme + ': the line just below the arrival');
      assert.equal((await drawn(p)).after, arrival, theme + ': under the message that arrived');
      assert.ok(Math.abs(await cardTop(p, held.id) - held.top) <= 1, theme + ': the card being read held still as the message and the line came');
      // Mark unread, from another tab, on an older message already read: the
      // line moves down to just below it; clearing the mark brings the line back.
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids[3]], marked: true });
      await until(async () => (await drawn(p)).after === ids[3], theme + ': marked unread, the line moves down to it');
      await settle(p, topic, theme + ': where the server says');
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids[3]], marked: false });
      await until(async () => (await drawn(p)).after === arrival, theme + ': cleared, the line returns under the arrival');
      // At the top: the arrival is read, the line goes, and what arrives next shows above the newest card.
      await p.evaluate('scrollTo(0,0)');
      await until(async () => await unread(topic) === null, theme + ': the arrival, now on screen, is read');
      await settle(p, topic, theme + ': no line');
      const top = (await control({ method: 'agent_message', operation_id: topic + '-top', topic_id: topic, body: 'Arriving while the person is at the top.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${top}"]'))`), theme + ': arrival at the top drawn');
      const shown = await p.evaluate(`(()=>{const r=document.querySelector('#messages [data-id="${top}"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,first:document.querySelector('#messages .message-card').dataset.id}})()`);
      assert.equal(shown.first, top, theme + ': the arrival is the newest card');
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height, theme + ': and it is in view');
      await shot(p, 'new-line-' + theme + '-top-arrival');
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
          color:c.color,page:getComputedStyle(document.documentElement).backgroundColor,loaded:Boolean(list.querySelector('[data-id="${ids[0]}"]'))}})()`);
      assert.deepEqual([marker.count, marker.last, marker.tag, marker.kind, marker.loaded], [1, true, 'BUTTON', 'older', false], theme + ': at the bottom of what is loaded');
      assert.match(marker.text, new RegExp('^New · older below · ' + SHOWN + '$'), theme + ': saying older below, and when that message was sent');
      assert.ok(contrast(marker.color, marker.page) >= 4.5, theme + ': readable');
      await p.send('Emulation.setDeviceMetricsOverride', phone);
      const narrowMarker = await narrowLine(p);
      assert.equal(narrowMarker.lines, 1, theme + ': at 390 wide "older below" and its time fit on one line');
      assert.ok(narrowMarker.right <= narrowMarker.width && narrowMarker.scroll <= narrowMarker.width, theme + ': and inside the page');
      await p.send('Emulation.setDeviceMetricsOverride', desk);
      await p.evaluate("document.querySelector('#messages .new-line').scrollIntoView({block:'center'})");
      await shot(p, 'new-line-older-' + theme);
      // Reached by keyboard and pressed with Return, as a button is.
      await p.evaluate("document.querySelector('#messages .new-line').focus()");
      await p.key('Enter');
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids[0]}"]'))`), theme + ': the message further back is loaded');
      await until(() => p.evaluate(`document.activeElement?.dataset?.id === ${JSON.stringify(ids[0])}`), theme + ': and has the focus');
      // In view it is read, so the line moves up to the oldest message still unread.
      await until(async () => (await unread(topic))?.id !== ids[0], theme + ': the message brought into view is read');
      await settle(p, topic, theme + ': the line where the server says');
      const placed = await p.evaluate(`(()=>{const card=document.querySelector('#messages [data-id="${ids[0]}"]'),r=card.getBoundingClientRect();
        return {inView:r.top<innerHeight&&r.bottom>0,lines:document.querySelectorAll('#messages .new-line').length}})()`);
      assert.equal(placed.inView, true, theme + ': the message is in view');
      assert.match(await p.evaluate("document.querySelector('#messages .new-line').textContent"), new RegExp('^New · ' + SHOWN + '$'),
        theme + ': the line in its place says when its message was sent');
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
