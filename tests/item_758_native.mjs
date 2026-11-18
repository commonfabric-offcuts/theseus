// Tony 9210's approved synthetic words, using real Core records and native
// pointer/touch/keyboard actions. Protocol assertions also run below-browser
// in test_item_758_fixture.py; no handler invocation stands in for a gesture.
import assert from 'node:assert/strict';
import { observeReader, readerSnapshot, assertReaderDestination } from './outline_stars_oracle.mjs';
import { assertPassagePresentation } from './item_758_oracle.mjs';

export async function passageChecks({ check, until, control, view, shot, observations, engine }, h) {
  const { open, centre, press, openReader, closeReader, into, card, words } = h;
  for (const [device, width] of [['laptop', 1280], ['phone', 390], ['phone', 375], ['phone', 320]]) {
    for (const theme of ['light', 'dark']) {
      const label = `item758-${width}-${theme}`;
      await check(`reading item 758 ${width} ${theme}: approved passage and visible exception in feed and Reader, exact retry, refusal and manual reply`, async () => {
        const topic = label;
        await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Reply passages' }] });
        const before = await control({ method: 'item758_begin', topic });
        observations.push({ name: label + ' before', ...before });
        const size = width === 1280 ? 'laptop' : width === 390 ? 'phone' : `phone-${width}`;
        const p = await open(label, size, topic, before.parent, '', undefined, async q => {
          await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        });
        try {
          await p.evaluate(observeReader);
          await centre(p, card(before.parent));
          await shot(p, label + '-before-feed');
          await openReader(p, device, before.parent, 'Before');
          assertReaderDestination(await p.evaluate(readerSnapshot), before.parent, topic);
          await shot(p, label + '-before-reader');
          await closeReader(p, device);
          const after = await control({ method: 'item758_finish', topic });
          observations.push({ name: label + ' after', ...after });
          const quote = after.quoted.source_ref.id, exception = after.exception.source_ref.id;
          // Core's live updates draw the two newly committed replies. No reload
          // or fixture DOM replacement manufactures the feed's after state.
          await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(quote))})) && Boolean(document.querySelector(${JSON.stringify(card(exception))}))`), label + ': both replies arrive');
          assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(card(quote))}).length`), 1, label + ': retry draws one reply');
          assert.equal(await p.evaluate(`document.querySelector('#messages').textContent.includes('Must not appear:')`), false, label + ': refusals draw no partial message');
          const raw = async selector => p.evaluate(`(async()=>{const {drawnText}=await import('/message-format.mjs');return drawnText(document.querySelector(${JSON.stringify(selector)}))})()`);
          const presentation = async selector => p.evaluate(`(async()=>{const {drawnText}=await import('/message-format.mjs'),host=document.querySelector(${JSON.stringify(selector)});
            return {raw:drawnText(host),text:host.textContent,quoteCount:host.querySelectorAll('.md-quote').length,
              quote:host.querySelector('.md-quote')?.textContent,bold:host.querySelector('strong')?.textContent}})()`);
          for (const [id, source, starts, kind] of [[quote, after.quoted, '', 'quoted'],
            [exception, after.exception, 'Reply without a quote:', 'exception']]) {
            // Agent replies to the human stay expanded. These reads fail if
            // the actual renderer loses the inserted prefix or repeats it.
            await centre(p, words(id));
            const feed = await presentation(words(id));
            observations.push({ name: label + ' feed ' + kind, actual: feed });
            assertPassagePresentation(feed, source.body, kind, after.exception.reply_basis.reason);
            assert.ok((await p.evaluate(`document.querySelector(${JSON.stringify(card(id) + ' > .message-reply-to')})?.textContent`))?.includes('Before'), label + ': source context names parent words');
            await shot(p, label + '-after-feed-' + kind);
            await openReader(p, device, id, starts);
            assertReaderDestination(await p.evaluate(readerSnapshot), id, topic);
            const reader = await presentation('#source-body');
            observations.push({ name: label + ' Reader ' + kind, actual: reader });
            assertPassagePresentation(reader, source.body, kind, after.exception.reply_basis.reason);
            await shot(p, label + '-after-reader-' + kind);
            if (kind === 'quoted') {
              // ↑ steps to this reply's actual source, with the reply context
              // and destination following it. The private fixture record is
              // older than the parent, so it is never the expected source.
              await press(p, device, '#next-message');
              await until(() => p.evaluate(`window.item715Reader?.source?.source_ref?.id === ${JSON.stringify(before.parent)}`), label + ': native source navigation');
              assertReaderDestination(await p.evaluate(readerSnapshot), before.parent, topic);
              assert.equal(await raw('#source-body'), before.parent_source.body);
              await shot(p, label + '-source-navigation');
            }
            await closeReader(p, device);
          }
          await openReader(p, device, exception, 'Reply without a quote:');
          await into(p, device, '#writing-body');
          const manual = `Manual human reply ${width} ${theme}.\nSecond line.`;
          await p.send('Input.insertText', { text: manual });
          assert.equal(await p.evaluate(`document.querySelector('#writing-body').value`), manual);
          await shot(p, label + '-manual-before-send');
          await press(p, device, '#send-reply');
          let sent;
          await until(async () => {
            sent = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 20 })).items.find(item => item.body === manual);
            return Boolean(sent);
          }, label + ': native manual send commits unchanged');
          assert.equal(sent.reply_to, exception);
          assert.equal(sent.reply_basis, null);
          const manualSource = await view('source', { kind: 'message', id: sent.id });
          assert.equal(manualSource.body, manual);
          assert.equal(manualSource.author_kind, 'human');
          assert.deepEqual(manualSource.quotes, []);
          observations.push({ name: label + ' manual reply', engine, sent, source: manualSource });
          if (await p.evaluate(`document.querySelector('#reader').open`)) await closeReader(p, device);
          await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(sent.id))}))`),
            label + ': the committed manual reply arrives in the feed');
          await centre(p, card(sent.id));
          await shot(p, label + '-manual-after-send');
          assert.deepEqual(p.errors, []);
        } finally { await p.close(); }
      });
    }
  }
}
