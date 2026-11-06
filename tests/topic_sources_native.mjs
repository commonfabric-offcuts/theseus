import assert from 'node:assert/strict';

// A topic started from a message, in the real browser against the real server:
// the Reader's "Start a topic from this" leads to a new topic's page that says
// which message it answers and lists the topics already started from it, by
// pointer and typing; a topic an agent starts meanwhile refuses Send once, the
// list is read again, and the next Send goes ahead naming both.
export async function sourcesChecks({ check, page, until, control, view, facts, shot }) {
  const body = 'Which name do we ship for the release?';
  const asked = await control({ method: 'agent_message', operation_id: 'sources-question', body });
  const message = asked.result.message_id;
  const card = `#messages [data-id="${message}"]`;
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const answers = p => quiet(p, `(s => s && !s.hidden && {quote:s.querySelector('blockquote')?.textContent,
    words:[...s.querySelectorAll('p,h3')].map(e=>e.textContent).filter(Boolean),
    links:[...s.querySelectorAll('ul.started-topics a')].map(a=>[a.dataset.topicId,a.textContent,a.getAttribute('href')])})(document.querySelector('#opening-source'))`);
  const startFromCard = async p => {
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the question is drawn');
    await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
    await p.point(card);
    await until(() => quiet(p, `document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes(${JSON.stringify(body)})`), 'the Reader shows the question');
    await until(() => quiet(p, `!document.querySelector('#start-from-message').hidden`), 'the Reader offers to start a topic from it');
    await p.point('#start-from-message');
    await until(() => quiet(p, `new URLSearchParams(location.search).get('opening_from')===${JSON.stringify(message)} && document.body.dataset.ready==='true'`), 'the new topic page answers the question');
  };
  const write = async (p, title, words) => {
    await p.evaluate(`document.querySelector('#opening-title-input').scrollIntoView({block:'center'})`);
    await p.point('#opening-title-input'); await p.send('Input.insertText', { text: title });
    await p.evaluate(`document.querySelector('#opening-body').scrollIntoView({block:'center'})`);
    await p.point('#opening-body'); await p.send('Input.insertText', { text: words });
  };
  const send = async p => {
    const before = p.calls.length;
    await p.evaluate(`document.querySelector('#opening-send').scrollIntoView({block:'center'})`);
    await p.point('#opening-send');
    return (await until(() => p.calls.slice(before).find(c => c.payload?.kind === 'opening.publish'), 'the publish request')).payload;
  };
  const started = async () => (await view('source_topics', { message_id: message })).items.map(item => item.id);

  await check('sources the Reader starts a topic from a message, and the page says what it answers', async () => {
    const p = await page('sources-first', null, true);
    await startFromCard(p);
    const shown = await until(async () => { const a = await answers(p); return a?.words.length && a; }, 'what it answers is read');
    assert.equal(shown.quote, `${facts.agent}: ${body}`);
    assert.deepEqual(shown.words, ['No topic has been started from this message yet.']);
    // It comes before the title, so it is read before anything is written.
    assert.equal(await p.evaluate(`Boolean(document.querySelector('#opening-source').compareDocumentPosition(document.querySelector('#opening-title-input')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);
    await shot(p, 'sources-none-yet');
    await write(p, 'Release name', 'Picking the name up here.');
    const publish = await send(p);
    assert.deepEqual(publish.args, { seen: [] });
    const topic = await until(() => quiet(p, `new URLSearchParams(location.search).get('topic')`), 'the new topic opens');
    assert.deepEqual(await started(), [topic]);
    assert.equal((await view('topic', { topic_id: topic })).topic.source_message_id, message);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('sources a second start is shown the first, and a topic started meanwhile is shown before Send goes ahead', async () => {
    const [first] = await started();
    const p = await page('sources-second', null, true);
    await startFromCard(p);
    const shown = await until(async () => { const a = await answers(p); return a?.links.length && a; }, 'the topic already started is listed');
    assert.deepEqual(shown.links, [[first, 'Release name', `?topic=${first}`]]);
    assert.deepEqual(shown.words, ['A topic was already started from this message', 'Continue there if it is the same question. Send starts this topic anyway.']);
    await shot(p, 'sources-one-listed');
    // An agent starts another from the same message while this page is open.
    const agent = await control({ method: 'source_start', operation_id: 'sources-agent', message_id: message, title: 'Agent naming', body: 'Mine too.' });
    const meanwhile = agent.result.topic.id;
    await write(p, 'Release name, again', 'A different angle.');
    const refused = await send(p);
    assert.deepEqual(refused.args, { seen: [first] });
    await until(() => quiet(p, `!document.querySelector('#opening-notice').hidden && document.querySelector('#opening-notice').textContent.includes(${JSON.stringify(meanwhile)})`), 'the refusal names the new topic');
    const relisted = await until(async () => { const a = await answers(p); return a?.links.length === 2 && a; }, 'the list is read again');
    assert.deepEqual(relisted.links.map(([id]) => id).sort(), [first, meanwhile].sort());
    assert.equal(await p.evaluate(`document.querySelector('#opening-title-input').value`), 'Release name, again', 'the writing is kept');
    await shot(p, 'sources-refused-relisted');
    const accepted = await send(p);
    assert.deepEqual([...accepted.args.seen].sort(), [first, meanwhile].sort());
    assert.notEqual(accepted.operation_id, refused.operation_id, 'the next Send is a new operation');
    const topic = await until(() => quiet(p, `new URLSearchParams(location.search).get('topic')`), 'the new topic opens');
    assert.deepEqual((await started()).sort(), [first, meanwhile, topic].sort());
    assert.deepEqual(p.errors, []); await p.close();
  });
}
