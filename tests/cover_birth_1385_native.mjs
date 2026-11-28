// Item 1385. Native Reader checks against the isolated real HTTP/Core fixture: a dossier whose cover holds only birth
// facts, or whose ordinary fields were cleared while birth facts persist, draws no Reader cover; a cover with words
// still draws its line. Birth facts are written through Core's actual stack.birth command, fenced on the dossier's
// name and cover revisions (tests/fixtures/ui_http.py stack_act). AIM_COVER_BIRTH_1385_EXPECT=negative states the
// expectation for the explicit consumer-negative construction (birth-capable Core, pre-fix page): there the first two
// states draw the defective line ('0 things wait on '), and the control is unchanged. No other surface is claimed.
// Fixture facts (1385 rehearsal): the --reading fixture's topics already hold a dossier, so the root names a divergence
// reason, which Core takes as the new dossier's first cover words; every case clears those words through stack.cover
// before stack.birth. The Reader is opened on the dossier root (phone: shared tap path; laptop: the root's own route).
import assert from 'node:assert/strict';

export async function coverBirth1385Checks({ check, until, control, view, shot, observations },
  { seed, open, openReader, closeReader, centre, press, card }) {
  const negative = process.env.AIM_COVER_BIRTH_1385_EXPECT === 'negative';
  const act = async (kind, root, args, operation_id) => {
    const r = await control({ method: 'stack_act', kind, sender: 'aim-core', message_id: root, args, operation_id });
    assert.equal(r.status, 'committed', JSON.stringify(r)); return r.result;
  };
  const coreCover = async root => (await view('dossier_cover', { message_id: root }))?.cover ?? null;
  const cases = {
    'birth-only': {
      write: async (topic, ids) => { await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'question' }, topic + '-birth'); },
      core: cover => { assert.equal(cover?.stands ?? null, null); assert.deepEqual(cover?.birth, { nature: 'question' }); },
    },
    'cleared-birth-persists': {
      write: async (topic, ids) => {
        await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'decision', done_when: 'the owner agrees' }, topic + '-birth');
        await act('stack.cover', ids.root, { stands: 'Comparing two dates' }, topic + '-words');
        await act('stack.cover', ids.root, { stands: null }, topic + '-cleared');
      },
      core: cover => { assert.equal(cover?.stands ?? null, null); assert.deepEqual(cover?.birth, { nature: 'decision', done_when: 'the owner agrees' }); },
    },
    'worded-birth-control': {
      write: async (topic, ids) => {
        await act('stack.birth', ids.root, { reply_id: ids.answer, nature: 'question', stands: 'Friday works for both' }, topic + '-birth');
      },
      core: cover => { assert.equal(cover?.stands, 'Friday works for both'); assert.deepEqual(cover?.birth, { nature: 'question' }); },
    },
  };
  const readerCover = p => p.evaluate(`(()=>{const h=document.querySelector('#reader-cover'),w=h?.querySelector('.reader-cover-words');
    return {hidden:!h||h.hidden||!h.getClientRects().length,words:w?.textContent??null,sheet:Boolean(h?.querySelector('.dossier-cover'))}})()`);
  // Entry paths (1385 rehearsal, round 3): the Reader is opened on the dossier's root, its cover's own message. A phone uses
  // the shared openReader tap path; a laptop loads the root's public message URL (?topic=…&message=root), which opens the
  // Reader on it. Earlier laptop attempts (light()+Enter on the root head, a native click on its author text, opening the
  // revealed answer) did not open the Reader within the wait and are kept as rehearsal failures; this check proves cover
  // rendering under these two entry paths, not desktop click/Enter or answer activation.
  const readerText = p => p.evaluate(`document.querySelector('#reader').open ? document.querySelector('#source-body').textContent : null`);
  const rootWords = 'Which weekend suits the cabin trip?';
  const openRoot = async (p, device, root) => {
    if (device === 'phone') return openReader(p, device, root, rootWords);
    await until(async () => (await readerText(p))?.startsWith(rootWords), 'laptop: the root route opens the Reader on the dossier root');
  };
  const routeFor = (device, topic, root) => device === 'laptop' ? '/?' + new URLSearchParams({ topic, message: root }) : '/?topic=' + topic;
  for (const device of ['laptop', 'phone']) for (const theme of ['light', 'dark']) for (const [name, { write, core }] of Object.entries(cases)) {
    await check(`reading item 1385 ${name} ${device} ${theme}: ${negative ? 'consumer-negative' : 'candidate'} Reader cover`, async () => {
      const topic = `birth1385-${name}-${device}-${theme}`;
      const ids = await seed(topic, [
        ['root', { sender: 'aim-core', join: true, divergence_reason: 'A distinct fixture dossier for 1385', body: 'Which weekend suits the cabin trip?' }],
        ['answer', { sender: 'aim-core', reply_to: 'root', reply_without_quote: 'Fixture reply for 1385 birth facts.', body: 'Either works; Friday is easier for the drive.' }],
      ]);
      // The divergence reason is the dossier's first cover words (Core); clear them so each case starts with no words.
      await act('stack.cover', ids.root, { stands: null }, topic + '-unseed');
      assert.equal((await coreCover(ids.root))?.stands ?? null, null, 'the seeded cover words are cleared before birth');
      await write(topic, ids);
      const stored = await coreCover(ids.root);
      observations.push({ name: 'item 1385 core cover', topic, cover: stored });
      core(stored);
      const p = await open(topic, device, topic, ids.root, '', routeFor(device, topic, ids.root));
      try {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await openRoot(p, device, ids.root);
        await until(async () => (await p.evaluate('window.fetchesOut')) === 0, 'Reader reads settled');
        // Measured once the Reader has come to rest (finite animations finished), as reader_persistence_native's 'settled
        // reader' and topic_reading_native's 'the Reader has come to rest' do.
        await until(() => p.evaluate("document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=='running')"), 'the Reader has come to rest');
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
