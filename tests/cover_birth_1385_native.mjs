// Item 1385. Native Reader checks against the isolated real HTTP/Core fixture: a dossier whose cover holds only birth
// facts, or whose ordinary fields were cleared while birth facts persist, draws no Reader cover; a cover with words
// still draws its line. Birth facts are written through Core's actual stack.birth command, fenced on the dossier's
// name and cover revisions (tests/fixtures/ui_http.py stack_act). AIM_COVER_BIRTH_1385_EXPECT=negative states the
// expectation for the explicit consumer-negative construction (birth-capable Core, pre-fix page): there the first two
// states draw the defective line ('0 things wait on '), and the control is unchanged. No other surface is claimed.
import assert from 'node:assert/strict';

export async function coverBirth1385Checks({ check, until, control, shot, observations }, { seed, open, openReader, closeReader }) {
  const negative = process.env.AIM_COVER_BIRTH_1385_EXPECT === 'negative';
  const act = async (kind, root, args, operation_id) => {
    const r = await control({ method: 'stack_act', kind, sender: 'aim-core', message_id: root, args, operation_id });
    assert.equal(r.status, 'committed', JSON.stringify(r)); return r.result;
  };
  const cases = {
    'birth-only': async (topic, ids) => { await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'question' }, topic + '-birth'); },
    'cleared-birth-persists': async (topic, ids) => {
      await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'decision', done_when: 'the owner agrees' }, topic + '-birth');
      await act('stack.cover', ids.root, { stands: 'Comparing two dates' }, topic + '-words');
      await act('stack.cover', ids.root, { stands: null }, topic + '-cleared');
    },
    'worded-birth-control': async (topic, ids) => {
      await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'question', stands: 'Friday works for both' }, topic + '-birth');
    },
  };
  const readerCover = p => p.evaluate(`(()=>{const h=document.querySelector('#reader-cover'),w=h?.querySelector('.reader-cover-words');
    return {hidden:!h||h.hidden||!h.getClientRects().length,words:w?.textContent??null,sheet:Boolean(h?.querySelector('.dossier-cover'))}})()`);
  for (const device of ['laptop', 'phone']) for (const theme of ['light', 'dark']) for (const [name, write] of Object.entries(cases)) {
    await check(`reading item 1385 ${name} ${device} ${theme}: ${negative ? 'consumer-negative' : 'candidate'} Reader cover`, async () => {
      const topic = `birth1385-${name}-${device}-${theme}`;
      const ids = await seed(topic, [
        ['root', { sender: 'aim-core', join: true, body: 'Which weekend suits the cabin trip?' }],
        ['answer', { sender: 'aim-core', reply_to: 'root', body: 'Either works; Friday is easier for the drive.' }],
      ]);
      await write(topic, ids);
      const p = await open(topic, device, topic, ids.root);
      try {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await openReader(p, device, ids.root, 'Which weekend suits the cabin trip?');
        await until(async () => (await p.evaluate('window.fetchesOut')) === 0, 'Reader reads settled');
        const seen = await readerCover(p);
        observations.push({ name: 'item 1385 reader cover', topic, device, theme, mode: negative ? 'negative' : 'candidate', seen });
        await shot(p, topic);
        if (name === 'worded-birth-control') {
          assert.equal(seen.hidden, false, 'a cover with words draws its Reader line');
          assert.equal(seen.words, 'Friday works for both');
        } else if (negative) {
          assert.equal(seen.hidden, false, 'consumer-negative: the pre-fix page draws a Reader cover line');
          assert.match(seen.words ?? '', /^0 things wait on /, 'consumer-negative: the defective empty line');
        } else {
          assert.equal(seen.hidden, true, 'a cover holding only birth facts draws no Reader cover: ' + JSON.stringify(seen));
          assert.equal(seen.sheet, false);
        }
        await closeReader(p, device);
      } finally { await p.close(); }
    });
  }
}
