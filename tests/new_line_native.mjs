// The red New line, as painted: just below the card of the oldest message the
// person has not replied to, as the server names it; red words "New" readable
// on the page in light and dark. At the top of the topic a message that
// arrives comes into view above; further down, the card being read holds
// still. Run by reader_persistence_native.mjs with --colors; screenshots are
// kept as new-line-*.png for review.
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

export async function newLineCheck({ check, page, until, view, control, shot, observations }) {
  await check('colors the New line sits under the oldest unanswered message, and an arrival at the top comes into view', async () => {
    // A message from an agent the person has not answered, newest of all.
    await control({ method: 'agent_message', operation_id: 'new-line-waiting', body: 'An agent message waiting for an answer.' });
    const answer = await view('topic_messages', { topic_id: 't1', audience: 'all', direction: 'before', limit: 30 });
    assert.ok(answer.unanswered && Number.isInteger(answer.unanswered.seq), 'the server names the oldest unanswered message');
    const boundary = answer.unanswered;
    for (const theme of ['light', 'dark']) {
      const p = await page('new-line-' + theme, null, true, { beforeNavigate: async p => {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      } });
      for (let n = 0; n < 8 && !await p.evaluate(`Boolean(document.querySelector('#messages [data-id="${boundary.id}"]'))`); n++) {
        const cards = await p.evaluate("document.querySelectorAll('#messages .message-card').length");
        await p.evaluate("document.querySelector('#more-messages').scrollIntoView({block:'center'})");
        await p.point('#more-messages');
        await until(() => p.evaluate(`document.querySelectorAll('#messages .message-card').length > ${cards}`), 'More loaded older messages');
      }
      const placed = await p.evaluate(`(()=>{
        const lines=[...document.querySelectorAll('#messages .new-line')],line=lines[0];
        if(!line)return {count:0};
        const card=document.querySelector('#messages [data-id="${boundary.id}"]');
        const c=getComputedStyle(line),rule=getComputedStyle(line,'::before');
        const time=line.querySelector('.new-line-time time'),cardTime=card?.querySelector('.message-time time');
        return {count:lines.length,text:line.textContent,label:line.querySelector('.new-line-label')?.textContent??null,
          time:time?.textContent??null,title:time?.title??null,cardTime:cardTime?.textContent??null,cardTitle:cardTime?.title??null,
          timeCase:time?getComputedStyle(time.parentElement).textTransform:null,after:line.previousElementSibling===card,
          seq:line.dataset.seq??null,id:line.dataset.id??null,color:c.color,rule:rule.backgroundColor,
          page:getComputedStyle(document.documentElement).backgroundColor,transform:c.textTransform}})()`);
      assert.equal(placed.count, 1, theme + ': one New line');
      assert.match(placed.text, new RegExp('^New · ' + SHOWN + '$'), theme + ': its words are "New" and when that message was sent');
      assert.equal(placed.label, 'New', theme + ': the label is a span of its own');
      assert.deepEqual([placed.time, placed.title], [placed.cardTime, placed.cardTitle], theme + ': the time its card shows, with the same dated title');
      assert.match(placed.title, DATED, theme + ': its title keeps the date');
      assert.equal(placed.timeCase, 'none', theme + ': the time is not in capitals');
      assert.equal(placed.after, true, theme + ': just below the oldest unanswered card');
      assert.deepEqual([placed.seq, placed.id], [null, null], theme + ': the line is not a card');
      assert.equal(placed.rule, placed.color, theme + ': rule and words are one red');
      const [r, g, b] = placed.color.match(/[\d.]+/g).map(Number);
      assert.ok(r > g + 60 && r > b + 60, theme + ': red');
      assert.ok(contrast(placed.color, placed.page) >= 4.5, theme + `: readable (${contrast(placed.color, placed.page).toFixed(2)})`);
      await p.evaluate(`document.querySelector('#messages [data-id="${boundary.id}"]').scrollIntoView({block:'center'})`);
      await shot(p, 'new-line-' + theme);
      // At the top: what arrives shows above the card that was newest.
      await p.evaluate("scrollTo(0,0)");
      const newest = await p.evaluate("document.querySelector('#messages .message-card').dataset.id");
      const arrival = (await control({ method: 'agent_message', operation_id: 'new-line-top-' + theme, body: 'Arriving while the person is at the top.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${arrival}"]'))`), theme + ': arrival drawn');
      const shown = await p.evaluate(`(()=>{const r=document.querySelector('#messages [data-id="${arrival}"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,first:document.querySelector('#messages .message-card').dataset.id}})()`);
      assert.equal(shown.first, arrival, theme + ': the arrival is the newest card');
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height, theme + ': and it is in view');
      await shot(p, 'new-line-' + theme + '-top-arrival');
      // Further down: the card in view holds still while another arrives.
      await p.evaluate(`(()=>{document.querySelector('#messages [data-id="${newest}"]').nextElementSibling.scrollIntoView({block:'start'});scrollBy(0,-20)})()`);
      const held = await p.evaluate(`(()=>{const c=[...document.querySelectorAll('#messages .message-card')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});return {id:c.dataset.id,top:c.getBoundingClientRect().top}})()`);
      const later = (await control({ method: 'agent_message', operation_id: 'new-line-down-' + theme, body: 'Arriving while the person reads further down.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${later}"]'))`), theme + ': later arrival drawn');
      const after = await p.evaluate(`document.querySelector('#messages [data-id="${held.id}"]').getBoundingClientRect().top`);
      assert.ok(Math.abs(after - held.top) <= 1, theme + `: the card being read holds still (${held.top} then ${after})`);
      observations.push({ name: 'new line', theme, boundary, placed, shown, held, after });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('colors the New line for a message further back waits at the bottom, and pressing it brings that message', async () => {
    // A page and a few more of agent messages put the oldest unanswered one
    // beyond the first page the topic loads.
    for (let n = 0; n < 40; n++) await control({ method: 'agent_message', operation_id: 'new-line-older-' + n, body: `Agent message ${n} after the unanswered one.` });
    const answer = await view('topic_messages', { topic_id: 't1', audience: 'all', direction: 'before', limit: 30 });
    const boundary = answer.unanswered;
    assert.ok(boundary && !answer.items.some(item => item.id === boundary.id), 'the oldest unanswered message is not on the first page');
    for (const theme of ['light', 'dark']) {
      const p = await page('new-line-older-' + theme, null, true, { beforeNavigate: async p => {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      } });
      await until(() => p.evaluate("Boolean(document.querySelector('#messages .new-line'))"), theme + ': a line drawn');
      const marker = await p.evaluate(`(()=>{const list=document.querySelector('#messages'),line=list.querySelector('.new-line');
        const c=getComputedStyle(line);return {count:list.querySelectorAll('.new-line').length,last:list.lastElementChild===line,tag:line.tagName,text:line.textContent,
          color:c.color,page:getComputedStyle(document.documentElement).backgroundColor,loaded:Boolean(list.querySelector('[data-id="${boundary.id}"]'))}})()`);
      assert.deepEqual([marker.count, marker.last, marker.tag, marker.loaded], [1, true, 'BUTTON', false], theme + ': at the bottom of what is loaded');
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
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${boundary.id}"]'))`), theme + ': the message further back is loaded');
      await until(() => p.evaluate(`document.activeElement?.dataset?.id === ${JSON.stringify(boundary.id)}`), theme + ': and has the focus');
      const placed = await p.evaluate(`(()=>{const list=document.querySelector('#messages'),lines=list.querySelectorAll('.new-line'),card=list.querySelector('[data-id="${boundary.id}"]');
        const r=card.getBoundingClientRect();return {count:lines.length,after:lines[0]?.previousElementSibling===card,tag:lines[0]?.tagName,text:lines[0]?.textContent,inView:r.top<innerHeight&&r.bottom>0}})()`);
      assert.deepEqual({ ...placed, text: undefined }, { count: 1, after: true, tag: 'DIV', text: undefined, inView: true }, theme + ': the line in its true place, the message in view');
      assert.match(placed.text, new RegExp('^New · ' + SHOWN + '$'), theme + ': saying when that message was sent');
      // At a phone's width, both forms of the line keep their words on one line, inside the page.
      await p.send('Emulation.setDeviceMetricsOverride', phone);
      const narrow = await narrowLine(p);
      assert.equal(narrow.lines, 1, theme + ': at 390 wide the words fit on one line');
      assert.ok(narrow.right <= narrow.width && narrow.scroll <= narrow.width, theme + ': and inside the page');
      await shot(p, 'new-line-older-' + theme + '-390');
      await shot(p, 'new-line-older-' + theme + '-reached');
      observations.push({ name: 'new line further back', theme, boundary, marker, placed });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
}
