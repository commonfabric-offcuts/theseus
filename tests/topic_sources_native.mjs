import assert from 'node:assert/strict';

// A topic started from a message, in the real browser against the real server:
// the Reader's "Start a topic from this" is one title line in the Reader,
// filled from the message's first sentence; Return starts the topic with the
// message quoted as its opening and its author in it. A second start from the
// same message is shown the topics already started from it and goes ahead on
// the next Return; one an agent starts meanwhile is shown the same way.
export async function sourcesChecks({ check, page, until, control, view, facts, shot }) {
  const body = 'Which name do we ship for the release? Two are left.';
  const asked = await control({ method: 'agent_message', operation_id: 'sources-question', body });
  const message = asked.result.message_id;
  const card = `#messages [data-id="${message}"]`;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const line = p => quiet(p, `(l => l && {value:l.value, focused:document.activeElement===l,
    state:document.querySelector('.start-topic-line .one-line-state')?.textContent ?? '',
    links:[...document.querySelectorAll('.start-topic-line .one-line-state a')].map(a=>[a.textContent,a.getAttribute('href')])})(document.querySelector('#start-topic-title'))`);
  const openLine = async p => {
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the question is drawn');
    if (!(await quiet(p, `document.querySelector('#reader').open`))) {
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      await p.point(card);
      await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(body)})`), 'the Reader shows the question');
    }
    await until(() => quiet(p, `!document.querySelector('#start-from-message').hidden`), 'the Reader offers to start a topic from it');
    await p.point('#start-from-message');
    return until(async () => { const l = await line(p); return l?.focused && l; }, 'one title line in the Reader, focused');
  };
  // Return in the line: the publish request it sent, or none when it was refused before sending.
  const enter = async (p, title) => {
    if (title !== undefined) await p.send('Input.insertText', { text: title });
    const before = p.calls.length;
    await p.key('Enter');
    return (await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'opening.publish'), 'the publish request')).payload;
  };
  const started = async () => (await view('source_topics', { message_id: message })).items.map(item => item.id);

  await check('sources the Reader starts a topic from a message in one line, quoting it, with its author in it', async () => {
    const p = await page('sources-first', null, true);
    const shown = await openLine(p);
    assert.equal(shown.value, 'Which name do we ship for the release?', 'filled from its first sentence');
    assert.equal(await p.evaluate(`document.querySelector('#start-from-message').getAttribute('aria-expanded')`), 'true');
    await shot(p, 'sources-line');
    // The line opens with its words selected, so typing replaces them.
    await p.send('Input.insertText', { text: 'Release name' });
    await p.key('Escape');
    // Start a topic from this is in the Reader's ⋯ (docs/reader.md): the focus goes back there.
    await until(() => quiet(p, `!document.querySelector('#start-topic-title') && document.activeElement?.id==='reader-menu'`), 'Escape closes the line and gives the focus back to the ⋯');
    assert.equal(await p.evaluate(`document.querySelector('#reader').open`), true, 'and leaves the Reader open');
    assert.equal((await openLine(p)).value, 'Release name', 'the line opens again with the title as it was left');
    // The Reader steps to another message, which closes the line, and back.
    // The question answers the topic's first message (the fixture's default
    // source), so it reads last in that message's reply stack: ↑ (#next-message)
    // steps up to the reply above, and ↓ comes back.
    await p.point('#next-message');
    await until(() => quiet(p, `!document.querySelector('#start-topic-title') && !document.querySelector('#source-body').textContent.includes(${JSON.stringify(body)})`), 'the Reader shows another message, without the line');
    await p.point('#previous-message');
    await until(() => quiet(p, `document.querySelector('#source-body').textContent.includes(${JSON.stringify(body)})`), 'the Reader is back on the question');
    assert.equal((await openLine(p)).value, 'Release name', 'stepping away and back keeps the title too');
    const publish = await enter(p);
    assert.deepEqual(publish.args, { seen: [] });
    const topic = await until(() => quiet(p, `document.body.dataset.ready==='true' && new URLSearchParams(location.search).get('topic')`), 'the new topic opens');
    // The new topic opens in place, so the page was ready before it: its title is painted when the topic's read lands.
    await until(() => quiet(p, `document.querySelector('#topic-title').textContent === 'Release name'`), 'the new topic is titled as typed');
    assert.deepEqual(await started(), [topic]);
    const read = await view('topic', { topic_id: topic });
    assert.equal(read.topic.source_message_id, message);
    assert.deepEqual(read.participants.map(x => x.actor_id).sort(), [facts.actor, facts.agent].sort(), 'its author is in it');
    const [opening] = (await view('topic_messages', { topic_id: topic, limit: 5 })).items;
    assert.equal(opening.body, '> ' + body, 'its opening is the message, quoted');
    assert.equal(opening.author_id, facts.actor);
    assert.equal(p.calls.filter(c => c.payload?.kind === 'opening.save').length, 1, 'one save');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('sources a second start is shown the first, one started meanwhile too, and the next Return goes ahead naming both', async () => {
    const [first] = await started();
    const p = await page('sources-second', null, true);
    await openLine(p);
    const refused = await enter(p, 'Release name, again');
    assert.deepEqual(refused.args, { seen: [] });
    const listed = await until(async () => { const l = await line(p); return l?.links.length && l; }, 'the topic already started is named');
    assert.deepEqual(listed.links, [['Release name', `?topic=${first}`]]);
    assert.match(listed.state, /^A topic was already started from this message\. Continue there, or press Return to start this one anyway\./);
    assert.equal(listed.value, 'Release name, again', 'the title is kept');
    assert.equal(await p.evaluate(`document.querySelector('#reader').open`), true, 'the Reader stays open');
    await shot(p, 'sources-one-listed');
    // An agent starts another from the same message while this line is open.
    const agent = await control({ method: 'source_start', operation_id: 'sources-agent', message_id: message, title: 'Agent naming', body: 'Mine too.' });
    const meanwhile = agent.result.topic.id;
    const again = await enter(p);
    assert.deepEqual(again.args, { seen: [first] });
    const relisted = await until(async () => { const l = await line(p); return l?.links.length === 2 && l; }, 'the topic started meanwhile is named too');
    assert.deepEqual(relisted.links.map(([, href]) => href).sort(), [`?topic=${first}`, `?topic=${meanwhile}`].sort());
    await shot(p, 'sources-refused-relisted');
    const accepted = await enter(p);
    assert.deepEqual([...accepted.args.seen].sort(), [first, meanwhile].sort());
    assert.equal(new Set([refused.operation_id, again.operation_id, accepted.operation_id]).size, 3, 'each Return is a new operation');
    assert.equal(p.calls.filter(c => c.payload?.kind === 'opening.save').length, 1, 'the title was saved once');
    const topic = await until(() => quiet(p, `document.body.dataset.ready==='true' && new URLSearchParams(location.search).get('topic')`), 'the new topic opens');
    assert.deepEqual((await started()).sort(), [first, meanwhile, topic].sort());
    assert.deepEqual(p.errors, []); await p.close();
  });
}
