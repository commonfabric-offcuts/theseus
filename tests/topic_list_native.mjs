import assert from 'node:assert/strict';

// The topic list in the real browser against the real server
// (docs/topic-list.md): latest activity first, done topics folded into a
// "Done (N)" line the person opens with the pointer and finds open again
// after a reload, archived ones behind an "Archived (N)" line, a new message
// bringing a done topic back, and a list that keeps still under the pointer
// and keeps a focused row focused while rows move around it.
export async function listChecks({ check, page, until, control, view, shot }) {
  const rows = (p, list = '#topics') => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(list + ' .nav-item')})].map(a=>a.dataset.topicId)`);
  const line = (p, name) => p.evaluate(`(()=>{const d=document.querySelector('#${name}-topics');return {hidden:d.hidden,open:d.open,label:document.querySelector('#${name}-topics-label').textContent}})()`);
  // The pointer rests over the main column, away from the topic list.
  const away = p => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 700 });
  const post = (operation, topic) => control({ method: 'agent_message', operation_id: operation, body: 'News in ' + topic, topic_id: topic, addressees: [], join: true });
  const state = (operation, topic, args) => control({ method: 'topic_state', operation_id: operation, topic_id: topic, args });

  await check('list the list is latest activity first and a new message moves its topic to the top live', async () => {
    await control({ method: 'navigation_topics', topics: [{ id: 'list-a', title: 'List A' }, { id: 'list-b', title: 'List B' }, { id: 'list-c', title: 'List C' }] });
    const p = await page('list-order', null, true);
    await away(p);
    await until(async () => (await rows(p)).slice(0, 3).join() === 'list-c,list-b,list-a', 'newest topics first');
    const served = (await view('workspace_topics', { workspace_id: 'w1' })).items.map(item => item.id);
    assert.deepEqual(await rows(p), served, 'the page shows the server order');
    await post('list-order-a', 'list-a');
    await until(async () => (await rows(p))[0] === 'list-a', 'the topic written in comes to the top without a reload');
    await shot(p, 'topics-order');
    assert.deepEqual(p.errors, []);
  });

  await check('list done topics fold into a Done line that opens with the pointer and stays open after a reload', async () => {
    await state('list-done-b', 'list-b', { state: 'done' });
    const p = await page('list-done', null, true);
    await away(p);
    await until(async () => !(await rows(p)).includes('list-b'), 'a done topic leaves the list');
    const closed = await until(async () => { const l = await line(p, 'done'); return !l.hidden && l; }, 'Done line shown');
    assert.deepEqual(closed, { hidden: false, open: false, label: 'Done (1)' });
    assert.deepEqual(await rows(p, '#done-topic-list'), [], 'a closed line lists nothing');
    await p.point('#done-topics-label');
    await until(async () => (await rows(p, '#done-topic-list')).join() === 'list-b', 'opening the line lists the done topic');
    await shot(p, 'topics-done-open');
    await p.close();
    // The person's choice is kept on this browser: the next page starts with the line open and reads it.
    const again = await page('list-done-again', null, true);
    await until(async () => (await line(again, 'done')).open && (await rows(again, '#done-topic-list')).join() === 'list-b', 'Done line open again after a reload');
    await again.point('#done-topics-label');
    await until(async () => !(await line(again, 'done')).open, 'closed again');
    // A closed line is not read. A topic said done meanwhile is there when the
    // person opens it again, at once, though the pointer that opened it rests on the list.
    await state('list-done-c', 'list-c', { state: 'done' });
    await until(async () => (await line(again, 'done')).label === 'Done (2)', 'the closed line counts the new done topic');
    await again.point('#done-topics-label');
    await until(async () => (await rows(again, '#done-topic-list')).join() === 'list-c,list-b', 'the line opened again lists what it holds now');
    await again.point('#done-topics-label');
    await until(async () => !(await line(again, 'done')).open, 'closed again');
    await post('list-done-c-back', 'list-c');
    await until(async () => (await line(again, 'done')).label === 'Done (1)', 'list-c is back among the active topics');
    await again.close();
    const third = await page('list-done-closed', null, true);
    await until(async () => !(await line(third, 'done')).hidden, 'Done line shown');
    assert.equal((await line(third, 'done')).open, false, 'and closed, as the person left it');
    assert.deepEqual(third.errors, []);
  });

  await check('list a new message in a done topic brings it back to the top of the list', async () => {
    const p = await page('list-reopen', null, true);
    await away(p);
    await until(async () => (await line(p, 'done')).label === 'Done (1)', 'one done topic');
    await post('list-reopen-b', 'list-b');
    await until(async () => (await rows(p))[0] === 'list-b', 'the reopened topic heads the list');
    await until(async () => (await line(p, 'done')).hidden, 'no done topic left, so no Done line');
    const topic = (await view('topic', { topic_id: 'list-b' })).topic;
    assert.equal(topic.state, 'active');
    assert.equal(topic.state_by, 'fixture-notebook-agent', 'the message’s author reopened it');
    assert.equal(topic.state_note, 'Reopened by a new message');
    assert.match(topic.state_message_id, /^m-/);
    assert.deepEqual(p.errors, []);
  });

  await check('list an archived topic leaves the list for an Archived line', async () => {
    await state('list-archive-c', 'list-c', { archived: true });
    const p = await page('list-archived', null, true);
    await away(p);
    await until(async () => !(await rows(p)).includes('list-c') && (await line(p, 'archived')).label === 'Archived (1)', 'Archived line');
    await p.point('#archived-topics-label');
    await until(async () => (await rows(p, '#archived-topic-list')).join() === 'list-c', 'archived topic listed');
    await p.point('#archived-topics-label');
    await state('list-unarchive-c', 'list-c', { archived: false });
    assert.deepEqual(p.errors, []);
  });

  await check('list the list keeps still under the pointer and takes its order once the pointer leaves', async () => {
    const p = await page('list-pointer', null, true);
    await away(p);
    const before = await until(async () => { const r = await rows(p); return r.length > 3 && r; }, 'list read');
    const last = before.at(-1), first = before[0], resting = `#topics .nav-item[data-topic-id="${first}"]`;
    // The pointer rests on the first row; someone says where the last topic stands, which is activity.
    await p.point(resting, 'move');
    await state('list-pointer-review', last, { state: 'review', note: 'Pointer check' });
    await until(() => p.evaluate(`document.querySelector('#topics .nav-item[data-topic-id="${last}"] .topic-state')?.title.includes('Pointer check') ?? false`), 'the row says what changed while the pointer rests');
    assert.deepEqual(await rows(p), before, 'no row moved under the pointer');
    const spot = await p.box(resting);
    assert.equal(await p.evaluate(`document.elementFromPoint(${spot.x + 12}, ${spot.y + 12})?.closest('.nav-item')?.dataset.topicId`), first, 'the pointer is still on the row it rested on');
    await away(p);
    await until(async () => (await rows(p))[0] === last, 'the list takes its order once the pointer leaves');
    assert.deepEqual(p.errors, []);
  });

  await check('list a focused row keeps its focus when it moves, and leaves its list only once focus moves on', async () => {
    const p = await page('list-focus', null, true);
    await away(p);
    const before = await until(async () => { const r = await rows(p); return r.length > 3 && r; }, 'list read');
    // Keyboard focus reaches the second row from the first with the person's Tab.
    await p.evaluate("document.querySelector('#topics .nav-item').focus()");
    await p.key('Tab');
    const focused = await p.evaluate("document.activeElement?.dataset.topicId");
    assert.equal(focused, before[1], 'Tab reached the second row');
    await p.evaluate(`(()=>{window.listBlurs=0;document.activeElement.addEventListener('blur',()=>{window.listBlurs++;});return true})()`);
    await post('list-focus-move', focused);
    await until(async () => (await rows(p))[0] === focused, 'the focused topic moves to the top');
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), focused, 'focus stayed on that row');
    assert.equal(await p.evaluate('window.listBlurs'), 0, 'it never lost focus while it moved');
    // Said done while focused: it stays put, focused, until focus moves on.
    await state('list-focus-done', focused, { state: 'done' });
    await until(async () => (await line(p, 'done')).label === 'Done (1)', 'the server counts it done');
    assert.equal((await rows(p))[0], focused, 'the focused row has not left the list');
    assert.equal(await p.evaluate('document.activeElement?.dataset.topicId'), focused);
    await p.key('Tab');
    await until(async () => !(await rows(p)).includes(focused), 'once focus moves on, it leaves for the Done line');
    assert.notEqual(await p.evaluate('document.activeElement?.dataset.topicId'), focused);
    await shot(p, 'topics-focus-moved');
    assert.deepEqual(p.errors, []);
  });
}
