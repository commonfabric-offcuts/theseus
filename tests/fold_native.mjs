// A message between others (docs/attention.md, "Messages between others"),
// as painted: one quiet line that a click, a tap or Enter opens into its card
// and folds away again, reached with Tab; never unread, never holding the New
// line, so the page and the server agree; marked unread by the person, it
// holds the line, with the pill on its line, until cleared. A message to the
// person, and one answering theirs while naming only others, stay cards.
// The line holds for the visit, as docs/attention.md says, so the check
// opens the topic again before marking. At 390px wide nothing
// scrolls sideways. Run by reader_persistence_native.mjs with --colors;
// screenshots are kept as fold-*.png for review.
import assert from 'node:assert/strict';

const WIDTHS = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, phone: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } };

export async function foldCheck({ check, page, until, view, control, shot, observations, facts }) {
  await check('colors a message between others is one quiet line that opens and folds, is never unread and never holds the New line', async () => {
    for (const [width, metrics] of Object.entries(WIDTHS)) {
      // A topic of the person's own with two agents in it: a message to everyone,
      // one between the agents, one to the person, and a reply to the person's own.
      const topic = 'fold-' + width, say = async (n, more) => (await control({ method: 'agent_message', operation_id: `${topic}-${n}`, topic_id: topic, source: 'topic', ...more })).result.message_id;
      await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Between others ' + width }] });
      const everyone = await say(0, { sender: 'aim-core', join: true, body: 'aim-core here, for everyone.' });
      await say(1, { sender: 'aim-ux', join: true, body: 'aim-ux here, for everyone.' });
      const long = 'the wake check fails on the second pass because the schedule row is read before the group is counted, '.repeat(3);
      const between = await say(2, { sender: 'aim-core', addressees: ['aim-ux'], body: long });
      const mine = await say(3, { sender: 'person', body: 'My own question to the agents.' });
      const named = await say(4, { sender: 'aim-ux', addressees: [facts.actor], body: 'aim-ux, to the person by name.' });
      // aim-core answers the person's own message, naming aim-ux only: it answers them, so it is for them.
      const answer = await say(5, { sender: 'aim-core', addressees: ['aim-ux'], reply_to: mine, body: 'aim-core, answering the person, for aim-ux.' });
      const first = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 30 })).items;
      assert.deepEqual(first.find(item => item.id === between).addressees, ['aim-ux'], width + ': the message names aim-ux only');
      assert.deepEqual([first.find(item => item.id === answer).reply_to, first.find(item => item.id === answer).addressees], [mine, ['aim-ux']], width + ': the answer names aim-ux and answers the person');
      const unread = async () => (await view('topic_unread', { topic_id: topic })).oldest_unread;
      assert.equal((await unread())?.id, everyone, width + ': the oldest unread is the message to everyone, not the one between others');

      const p = await page('fold-' + width, null, true, { url: facts.origin + '/?topic=' + topic, beforeNavigate: async q => {
        await q.send('Emulation.setDeviceMetricsOverride', metrics);
        if (metrics.mobile) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${between}"]'))`), width + ': the topic is drawn');
      const fold = `#messages > [data-id="${between}"]`, line = fold + ' > .fold-line', card = fold + ' > .message-card';
      const state = () => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(fold)}),l=f.querySelector('.fold-line'),c=f.querySelector('.message-card');
        const b=l.getBoundingClientRect();
        return {fold:f.className,expanded:l.getAttribute('aria-expanded'),controls:l.getAttribute('aria-controls')===c.id,cardShown:c.offsetHeight>0,
          lineHeight:b.height,lineRight:b.right,clipped:l.scrollWidth>l.clientWidth,ellipsis:getComputedStyle(l).textOverflow,text:l.textContent,
          scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
          kinds:[...document.querySelectorAll('#messages > [data-seq]')].map(e=>[e.dataset.id,e.className.split(' ')[0]])}})()`);
      const folded = await state();
      assert.deepEqual([folded.fold, folded.expanded, folded.controls, folded.cardShown], ['message-fold', 'false', true, false], width + ': folded into one line');
      assert.ok(folded.text.startsWith('aim-core to aim-ux: the wake check fails on'), width + ': who to whom, and its first words: ' + folded.text);
      assert.ok(folded.lineHeight < 60, width + ': one line high, not a card');
      assert.deepEqual(Object.fromEntries(folded.kinds.filter(([id]) => [everyone, mine, named, answer].includes(id))),
        { [everyone]: 'message-card', [mine]: 'message-card', [named]: 'message-card', [answer]: 'message-card' },
        width + ': to everyone, the person\'s own, one to them by name and one answering theirs stay cards');
      assert.ok(folded.lineRight <= folded.viewport && folded.scrollWidth <= folded.viewport, width + `: no sideways scroll (${folded.scrollWidth} of ${folded.viewport})`);
      if (width === 'phone') assert.deepEqual([folded.clipped, folded.ellipsis], [true, 'ellipsis'], 'phone: the long line ends in an ellipsis');
      // On the phone the rail and the topic's header fill the first screen, so
      // the person scrolls to the line before pressing it.
      const reach = () => p.evaluate(`document.querySelector(${JSON.stringify(line)}).scrollIntoView({block:'center'})`);
      await reach();
      await shot(p, 'fold-' + width + '-folded');

      // A click (on the phone a tap) opens the card below the line; again, it folds.
      const press = async () => {
        await reach();
        if (!metrics.mobile) return p.point(line);
        const b = await p.box(line), x = b.x + 12, y = b.y + b.height / 2;
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await press();
      await until(async () => (await state()).expanded === 'true', width + ': pressed, the line opens');
      const open = await state();
      assert.equal(open.cardShown, true, width + ': the card shows below its line');
      assert.ok(open.scrollWidth <= open.viewport, width + ': opened, still no sideways scroll');
      await shot(p, 'fold-' + width + '-open');
      await press();
      await until(async () => !(await state()).cardShown, width + ': pressed again, it folds away');

      // From the keyboard: Tab from the newer card above reaches the line; Enter opens and folds it.
      const above = (await state()).kinds.map(([id]) => id), newer = above[above.indexOf(between) - 1];
      await p.evaluate(`document.querySelector('#messages > [data-id="${newer}"]').focus()`);
      await p.key('Tab');
      assert.equal(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(line)})`), true, width + ': Tab reaches the line');
      await p.key('Enter');
      await until(async () => (await state()).cardShown, width + ': Enter opens it');
      await p.key('Tab');
      assert.equal(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(card)})`), true, width + ': the open card is next in the Tab order');
      await p.key('Tab', 8);
      await p.key('Enter');
      await until(async () => !(await state()).cardShown, width + ': Enter folds it again');

      // Read on screen, everything for the person is read; the message between
      // others never was unread. The line fades where it was placed, under the
      // message to everyone; opening the topic again places it afresh, and with
      // nothing unread there is none, so none under the fold either.
      const drawn = () => p.evaluate(`(()=>{const l=document.querySelector('#messages .new-line');return l?l.previousElementSibling?.dataset?.id??'':null})()`);
      const faded = () => p.evaluate(`document.querySelector('#messages .new-line')?.classList.contains('new-line-read')??null`);
      assert.equal(await drawn(), everyone, width + ': placed under the oldest unread, the message to everyone');
      for (let oldest; (oldest = await unread());) {
        assert.notEqual(oldest.id, between, width + ': the message between others is never the oldest unread');
        await p.evaluate(`document.querySelector('#messages > [data-id="${oldest.id}"]').scrollIntoView({block:'center'})`);
        await until(async () => (await unread())?.id !== oldest.id, width + ': read ' + oldest.id);
      }
      assert.equal(await drawn(), everyone, width + ': read during the visit, the line stays where it was placed');
      await until(async () => await faded() === true, width + ': nothing above it unread, it fades');
      await p.send('Page.navigate', { url: facts.origin + '/?topic=' + topic });
      await until(async () => { try { return await p.evaluate(`document.body?.dataset.ready === 'true' && Boolean(document.querySelector('#messages [data-id="${between}"]'))`); } catch { return false; } }, width + ': the topic opened again');
      await until(async () => await drawn() === null, width + ': opened again with everything read, no New line, none under the fold');

      // Marked unread (from another tab), it holds the line with the pill on its line, still folded; cleared, it counts nowhere.
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [between], marked: true });
      await until(async () => (await unread())?.id === between && await drawn() === between && await faded() === false, width + ': marked unread, it holds the New line');
      const marked = await p.evaluate(`(()=>{const l=document.querySelector(${JSON.stringify(line)});return {pill:Boolean(l.querySelector('.unread-mark')),expanded:l.getAttribute('aria-expanded')}})()`);
      assert.deepEqual(marked, { pill: true, expanded: 'false' }, width + ': the pill on the folded line');
      await shot(p, 'fold-' + width + '-marked');
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [between], marked: false });
      await until(async () => await unread() === null && !(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(line)} + ' .unread-mark'))`)), width + ': cleared, unread nowhere');
      assert.equal(await drawn(), between, width + ': cleared in another tab, the line stays where it is');
      await until(async () => await faded() === true, width + ': and fades');
      observations.push({ name: 'between others folded', width, folded, open });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
}
