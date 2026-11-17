// Reply stacks on the topic page (docs/reply-stacks.md), pressed as a person
// presses them: a pointer and keys at 1280 wide, and a finger at 390 wide.
// Each check seeds a topic of its own through the fixture's real commands and
// reads what Core then holds, for the person and for another reader (the
// fixture's stack_act and acts_as act and read as someone else), so a press
// that only repaints the page fails. Run from topic_reading_native.mjs, in
// Chrome for Testing (reader_persistence_native.mjs --reading) and in Safari's
// engine (webkit_native.mjs --reading). Screenshots are kept as stack-*.png.
import assert from 'node:assert/strict';
import { messagePreview } from '../web/message-preview.mjs';
import { pngPixels } from './png-bands.mjs';
import { ROWS, misdrawn, misglyphed, misplaced } from './menu_glyphs.mjs';

// helpers: what topic_reading_native.mjs's checks press and read with.
export async function stackChecks({ check, until, view, control, shot, facts, observations, engine }, helpers) {
  const { seed, open, becomes, centre, tap, press, lit, bar, away, readerOn, closeReader, light, openReader, entry, card, words, DEVICES } = helpers;
  const other = 'aim-core';
  // Item 429: the static material uses the actual feed renderer and isolated
  // Core records. Palette probes recolor that rendered face only; they do
  // not stand in for native color-picker or fold gestures.
  const dossierSeed = async (topic, wrapped = false, readAll = false) => seed(topic, [
    ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Fixture membership is ready.' }],
    ['root', { sender: other, join: true, addressees: [wrapped ? 'aim-ux' : facts.actor], body: 'Dossier original words.\nA second paragraph stays readable.' }],
    ['middle', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'An earlier reply with enough words to wrap on a phone.' }],
    ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest reply remains fully readable.' }],
    ['single', { sender: other, addressees: [facts.actor], body: 'A single message stays a normal card.', read: readAll }],
  ]);
  const dossierOpen = async (p, device, root) => {
    const toggle = `#messages .reply-stack[data-stack="${root}"] > .stack-toggle`;
    await centre(p, toggle); await press(p, device, toggle);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state === 'open'`), 'the dossier opens through its native control');
    return toggle;
  };
  const dossierTheme = (p, theme) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const dossierFold = (topic, id, on = true) => control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: id, operation_id: `${topic}-${id}-${on}`, args: { folded: on } });

  await check('reading dossier look overlaps visible cards by 12px without covering their words, including wrapped roots', async () => {
    for (const device of Object.keys(DEVICES)) for (const wrapped of [false, true]) {
      const topic = `dossier-layers-${device}-${wrapped}`, ids = await dossierSeed(topic, wrapped);
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const geometry = await p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},rect=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom}},
          c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),entry=e=>e.parentElement.classList.contains('message-fold')?e.parentElement:e,
          cards=[c(ids.root),c(ids.middle),c(ids.last)],section=cards[0].closest('.reply-stack');
          return {wrapped:entry(cards[0]).classList.contains('message-fold'),fold:section.dataset.fold,
            faces:cards.map(e=>({box:rect(entry(e)),words:rect(e.querySelector('.message-preview')),position:getComputedStyle(e).position})),
            overflow:document.documentElement.scrollWidth>innerWidth}})()`);
        assert.equal(geometry.wrapped, wrapped, 'the fixture exercises both root shapes');
        assert.equal(geometry.fold, 'open', 'the dossier remains fully open');
        for (let i = 1; i < geometry.faces.length; i++) {
          const prior = geometry.faces[i - 1], face = geometry.faces[i];
          assert.ok(Math.abs(prior.box.bottom - face.box.top - 12) < .5, `${device} ${theme}: newer face overlaps its predecessor by 12px: ${JSON.stringify(geometry)}`);
          assert.ok(prior.words.bottom <= face.box.top, 'overlap never covers the preceding words');
        }
        assert.equal(geometry.faces[0].position, 'static', 'the root keeps the folder as its tab containing block');
        assert.equal(geometry.overflow, false, 'layering never overflows horizontally');
        observations.push({ name: 'dossier layers', engine, device, theme, ...geometry });
        await shot(p, `dossier-layers-${device}-${wrapped}-${theme}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading dossier look aligns the first author letter with the message words', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-align-${device}`, ids = await dossierSeed(topic);
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const aligned = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.middle))}),n=c.querySelector('.message-author > .author-name'),r=document.createRange();r.selectNodeContents(n);
          return {name:r.getBoundingClientRect().left,words:c.querySelector('.message-preview').getBoundingClientRect().left}})()`);
        assert.ok(Math.abs(aligned.name - aligned.words) < .5, `${device} ${theme}: first author letter aligns with body words: ${JSON.stringify(aligned)}`);
        observations.push({ name: 'dossier alignment', engine, device, theme, ...aligned });
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading dossier look keeps folded words at 4.5 contrast across every palette and quiet-agent state', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-ink-${device}`, ids = await dossierSeed(topic, false, true);
      await dossierFold(topic, ids.middle);
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root); await away(p);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const samples = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.middle))}),w=c.querySelector('.folded-words'),row=w.parentElement,
          palettes=['green','blue','indigo','violet','rose','peach','cyan','olive','neutral','own'],results=[],saved={cls:c.className,talk:c.dataset.talk,style:c.getAttribute('style'),rowStyle:row.getAttribute('style')};
          // Measure the static endpoint, not the first frame of the existing
          // quiet-opacity transition. Opacity itself remains entirely CSS-owned.
          c.style.transition='none';row.style.transition='none';
          const pixel=color=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)},
            blend=(a,b,t)=>a.map((v,i)=>v*t+b[i]*(1-t)),lum=a=>a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),
            contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
          for(const palette of palettes)for(const quiet of [false,true]){c.className='message-card '+(palette==='own'?'own-message':palette==='neutral'?'':'agent-card agent-'+palette);c.dataset.talk=quiet?'agents':'';
            const cs=getComputedStyle(c),rs=getComputedStyle(row),under=pixel(getComputedStyle(c.closest('.reply-stack')).backgroundColor),bg=pixel(cs.backgroundColor),fg=pixel(getComputedStyle(w).color),a=Number(cs.opacity),r=Number(rs.opacity),
              background=blend(bg,under,a),foreground=blend(blend(fg,bg,r),under,a);
            results.push({palette,quiet,ratio:contrast(foreground,background),opacity:a,rowOpacity:r});}
          c.className=saved.cls;if(saved.talk===undefined)delete c.dataset.talk;else c.dataset.talk=saved.talk;
          if(saved.style===null)c.removeAttribute('style');else c.setAttribute('style',saved.style);if(saved.rowStyle===null)row.removeAttribute('style');else row.setAttribute('style',saved.rowStyle);return results})()`);
        for (const sample of samples) assert.ok(sample.ratio >= 4.5, `${device} ${theme}: folded ${sample.palette}, quiet=${sample.quiet}, contrast ${sample.ratio.toFixed(2)} is at least 4.5`);
        observations.push({ name: 'dossier folded contrast', engine, device, theme, samples });
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading dossier look exposes a 44px phone strip and its folded thumbs-up remains reachable', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-touch-${device}`, ids = await dossierSeed(topic);
      // In a dossier a folded row shows its 👍 once someone has given one (item 471): another has.
      await control({ method: 'agent_thumb', sender: other, message_id: ids.middle, operation_id: topic + '-their-thumb' });
      await dossierFold(topic, ids.middle);
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme); await centre(p, card(ids.middle)); await away(p);
        const metrics = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.middle))}),next=document.querySelector(${JSON.stringify(card(ids.last))}),t=c.querySelector('.folded-thumb'),b=c.getBoundingClientRect(),n=next.getBoundingClientRect(),r=t.getBoundingClientRect(),x=r.left+r.width/2;
          return {height:b.height,exposed:n.top-b.top,thumb:r.height,top:t.contains(document.elementFromPoint(x,r.top+1)),bottom:t.contains(document.elementFromPoint(x,r.bottom-1)),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
        if (device === 'phone') {
          assert.ok(metrics.exposed >= 43.5 && Math.abs(metrics.height - metrics.exposed - 12) < .5, `${theme}: the phone strip exposes 44px before the 12px overlap: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.thumb >= 44 && metrics.top && metrics.bottom, 'all 44px of the phone thumbs-up receive the tap');
        }
        assert.equal(metrics.overflow, false, 'the folded strip never overflows sideways');
        const target = card(ids.middle) + ' > .message-folded > .folded-thumb';
        const before = await p.evaluate(`document.querySelector(${JSON.stringify(target)}).getAttribute('aria-pressed')`);
        await press(p, device, target);
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(target)}).getAttribute('aria-pressed')!==${JSON.stringify(before)}`), 'native press toggles the folded thumbs-up');
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.middle))}).dataset.folded`), 'true', 'the thumb never unfolds its card');
        observations.push({ name: 'dossier folded target', engine, device, theme, ...metrics });
        await shot(p, `dossier-target-${device}-${theme}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 546: a message the reader folded is its one row on every screen (docs/reply-stacks.md, "Folded
  // messages"). A cut-off message (an excerpt, with its cue) folded by the reader's own 👍 draws none of its
  // words past that row: in a dossier, on its own, and in a dossier put below More once More shows it; by touch
  // at 390, 375 and 320 wide and on a laptop, light and dark, as Core keeps it after a reload. No card's painted
  // words fall outside its own box. Unfolded, it reads its excerpt, and nothing above it moves; the long cards
  // beside it read as they always did. The words are invented, in the shape of the message that showed it.
  await check('reading dossier look a folded excerpt draws only its row, by touch at 390, 375 and 320 and on a laptop, after a reload and below More; unfolded it reads its excerpt', async () => {
    const fill = (start, phrases, size) => { let out = start; for (let i = 0; out.length < size; i++) out += ' ' + phrases[i % phrases.length]; return out; };
    const GARDEN = ['The bean rows want another week of sun before they climb.', 'Two of the pepper trays went out at noon, one stays inside.',
      'A bed takes about forty minutes to turn, then an hour for the compost to settle, then a watering.', 'So a full row is most of a morning.',
      'The shed holds three rakes, two hoes and a spade with a split handle.', 'Mulch arrives on Thursday if the lane is dry.'];
    const excerpt = (who, asked) => [`> ${asked}`, '', `@${who} ` + fill('Six garden beds are planted, all of them watered since dawn: the three herb rows, the tomato frame', GARDEN, 184),
      '', '> how many beds would it take to feed the whole street through summer?', '', fill('Waiting to plant: 16 seedlings, four of them the rest of the pepper series.', GARDEN, 850), ''].join('\n');
    const LONG = ['The shed list is sorted, and "waiting to be stacked" now lists only the rakes, the hoes and two spades.', '',
      '- **The 9:35 time:** that is when the delivery was logged. Its unloading really began at 8:24.',
      '- **Going forward:** each new delivery is logged the same way the moment it starts, beginning with the mulch once the soil comes.', '',
      fill('The soil changed a piece of the yard that every bed reads, so all 44 beds have to be turned, and that is why it is taking long.', GARDEN, 380)].join('\n');
    const PHONES = [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 320, height: 568 }];
    for (const device of ['phone', 'laptop']) {
      const topic = `dossier-folded-excerpt-${device}`;
      const ids = await seed(topic, [
        ['long', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: LONG }],
        ['cut', { sender: 'aim-ux', addressees: [facts.actor], body: excerpt(facts.actor, 'what is left in the shed?') }],
        ['root', { sender: facts.actor, body: fill('How should the garden notes read, bed by bed?', GARDEN, 1100) }],
        ['r1', { sender: other, join: true, reply_to: 'root', addressees: [facts.actor], body: fill('Notes read best as one line a bed.', GARDEN, 889) }],
        ['r2', { sender: facts.actor, reply_to: 'r1', addressees: [other], body: '> one line a bed\n\n' + fill('Then say which beds wait on the weather.', GARDEN, 760) }],
        ['r3', { sender: other, reply_to: 'r2', addressees: [facts.actor], body: '> which beds wait on the weather\n\n' + fill('The herb rows and the far trellis.', GARDEN, 470) }],
        ['r4', { sender: facts.actor, reply_to: 'r3', addressees: [other], body: '> the far trellis\n\nHow many rows are we planting today?' }],
        ['folded', { sender: other, reply_to: 'r4', addressees: [facts.actor], body: excerpt(facts.actor, 'how many rows are we planting today?') }],
        ['alone', { sender: other, addressees: [facts.actor], body: excerpt(facts.actor, 'what does the far bed need?') }],
        ['asideRoot', { sender: 'aim-ux', addressees: [facts.actor], body: 'A dossier the reader put below More.' }],
        ['aside', { sender: other, reply_to: 'asideRoot', addressees: [facts.actor], body: excerpt(facts.actor, 'when does the mulch come?') }],
      ]);
      // The reader's own 👍 folds each excerpt in Core (docs/thumbs.md); they starred the dossier's first message
      // and put the second dossier below More, through the commands their page sends.
      for (const id of [ids.folded, ids.alone, ids.aside]) await control({ method: 'agent_thumb', sender: facts.actor, message_id: id, operation_id: `${topic}-${id}-thumb` });
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.root, operation_id: `${topic}-star`, args: { starred: true } });
      const items = async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 30 })).items;
      const seeded = await items(), item = id => seeded.find(each => each.id === id);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.asideRoot, operation_id: `${topic}-aside`, args: { through: item(ids.aside).seq } });
      for (const id of [ids.cut, ids.root, ids.folded, ids.alone, ids.aside]) assert.equal(item(id).preview, true, `${device}: ${id} is a cut-off message, an excerpt`);
      assert.equal(item(ids.long).preview, false, `${device}: the long card is whole`);
      assert.deepEqual([ids.folded, ids.alone, ids.aside, ids.r1, ids.r3].map(id => item(id).acts.folded), [true, true, true, true, true], `${device}: the reader's 👍 and replies folded what they answered`);
      const foldedInCore = async (id, on) => (await items()).find(each => each.id === id).acts.folded === on;

      const p = await open(`${topic}-390`, device, topic, ids.long, 'window.holdReads=true;');
      const LOOK = `(()=>{const ids=${JSON.stringify(ids)},c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),
        box=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}},spills=[];
        // Each card's words where they paint: a text box, cut by every box between it and the card that clips, must lie
        // inside the card. A stack's tab stands above its head's card by design, and hidden tips paint nothing.
        for(const card of document.querySelectorAll('#messages .message-card')){
          if(!card.getClientRects().length)continue;
          const cb=card.getBoundingClientRect(),walk=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
          for(let t;(t=walk.nextNode());){
            if(!t.data.trim()||t.parentElement.closest('.stack-head,.stack-rename,.replied-words,.sr-only'))continue;
            const range=document.createRange();range.selectNodeContents(t);
            for(const r of range.getClientRects()){
              let top=r.top,bottom=r.bottom,left=r.left,right=r.right,painted=r.width>0&&r.height>0;
              for(let e=t.parentElement;e&&painted;e=e===card?null:e.parentElement){
                const s=getComputedStyle(e);
                if(s.opacity==='0'||s.visibility==='hidden')painted=false;
                else if(s.overflowX!=='visible'||s.overflowY!=='visible'){const b=e.getBoundingClientRect();top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);left=Math.max(left,b.left);right=Math.min(right,b.right)}
              }
              if(!painted||bottom-top<.5||right-left<.5)continue;
              if(top<cb.top-1||bottom>cb.bottom+1||left<cb.left-1||right>cb.right+1)
                spills.push({id:card.dataset.id,folded:card.dataset.folded==='true',words:t.data.trim().slice(0,20),painted:{top:Math.round(top),bottom:Math.round(bottom)},card:{top:Math.round(cb.top),bottom:Math.round(cb.bottom)}});
            }
          }
        }
        const fold=id=>{const e=c(id);return {shown:e.getClientRects().length>0,folded:e.dataset.folded==='true',height:Math.round(box(e).height),
          row:Boolean(e.querySelector(':scope > .message-folded')?.getClientRects().length),
          rest:[...e.children].filter(k=>!k.classList.contains('message-folded')&&k.getClientRects().length).map(k=>k.className)}};
        const whole=id=>{const e=c(id),w=e.querySelector(':scope > .message-preview'),cue=e.querySelector(':scope > .message-preview-cue'),cb=box(e),wb=box(w);
          return {folded:e.dataset.folded==='true',words:w.getClientRects().length>0,wordsHeight:Math.round(wb.height),inside:wb.top>=cb.top-1&&wb.bottom<=cb.bottom+1,
            cue:Boolean(cue?.getClientRects().length),height:Math.round(cb.height),window:innerHeight}};
        // The dossier's first message, itself an excerpt, shown as its tab alone: nothing of its card draws.
        const head=c(ids.root),stack=head.closest('.reply-stack');
        return {spills,folded:fold(ids.folded),alone:fold(ids.alone),aside:fold(ids.aside),long:whole(ids.long),cut:whole(ids.cut),
          head:{open:stack.dataset.headOpen,rest:[...head.children].filter(k=>!k.classList.contains('stack-head')&&k.getClientRects().length).map(k=>k.className)}}})()`;
      const look = () => p.evaluate(LOOK);
      // Where each card above the folded one stands on the page, scrolling aside.
      const above = () => p.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(card(ids.folded))});
        return [...document.querySelectorAll('#messages .message-card')].filter(e=>e.getClientRects().length&&(e.compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING)).map(e=>[e.dataset.id,Math.round(e.getBoundingClientRect().top+scrollY)])})()`);
      const drawn = () => p.evaluate(`(()=>{const c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),aside=document.querySelector('#messages .reply-stack[data-stack="${ids.asideRoot}"]');
        return ${JSON.stringify([ids.folded, ids.alone])}.every(id=>c(id)?.dataset.folded==='true'&&c(id).querySelector(':scope > .message-folded'))&&Boolean(document.querySelector('#messages .stack-more'))&&Boolean(aside)&&!aside.getClientRects().length})()`);
      const faults = [];
      const expect = (ok, said, seen) => { if (!ok) faults.push(`${said}: ${JSON.stringify(seen)}`); };
      // Every fault seen so far, before a press that a card's spilled words could cover.
      const flush = where => assert.deepEqual(faults, [], `${where}: ${faults.length} faults`);
      const coarse = device === 'phone', foldedMax = coarse ? 56 : 44;
      const rowOnly = (where, f, inDossier) => {
        expect(f.shown && f.folded && f.row, `${where}: shows as its folded row`, f);
        expect(f.rest.length === 0, `${where}: draws nothing of its card but the row`, f.rest);
        expect(inDossier ? Math.abs(f.height - foldedMax) <= 1 : f.height <= 60, `${where}: keeps the folded row's height`, f.height);
      };
      const reload = async () => {
        // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
        const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
        await p.send('Page.reload');
        await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true'`).catch(() => false), `${device}: the page loads again`);
      };
      for (const size of device === 'phone' ? PHONES : [null]) {
        const at = size ? `${device} ${size.width}` : device;
        if (size) { await p.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: true }); await reload(); }
        await until(drawn, `${at}: the folds and the move below More are drawn from Core`);
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme); await centre(p, card(ids.folded)); await away(p);
          await shot(p, `dossier-folded-excerpt-${at.replace(' ', '-')}-${theme}-folded`);
          const seen = await look();
          expect(seen.spills.length === 0, `${at} ${theme}: no card's words paint outside its box`, seen.spills);
          rowOnly(`${at} ${theme}: the folded excerpt in a dossier`, seen.folded, true);
          rowOnly(`${at} ${theme}: the folded excerpt on its own`, seen.alone, false);
          expect(!seen.aside.shown, `${at} ${theme}: the dossier below More draws nothing`, seen.aside);
          expect(seen.head.open === 'false' && seen.head.rest.length === 0, `${at} ${theme}: the dossier's first message, an excerpt, shows as its tab alone`, seen.head);
          expect(seen.long.words && seen.long.inside && !seen.long.cue, `${at} ${theme}: the long unfolded card shows all its words inside its box`, seen.long);
          expect(seen.cut.words && seen.cut.cue && seen.cut.inside && (!coarse || seen.cut.wordsHeight <= seen.cut.window * .6 + 1),
            `${at} ${theme}: the unfolded excerpt reads with its cue${coarse ? ', no taller than 60% of the window' : ''}`, seen.cut);
          observations.push({ name: 'folded excerpt', engine, at, theme, ...seen });
        }
        flush(at);
        // More shows the dossier put below it: its folded excerpt is its row there too.
        await centre(p, '#messages .stack-more'); await press(p, device, '#messages .stack-more');
        await until(async () => (await look()).aside.shown, `${at}: More shows the dossier put below it`);
        await centre(p, card(ids.aside)); await away(p);
        await shot(p, `dossier-folded-excerpt-${at.replace(' ', '-')}-below-more`);
        const shown = await look();
        expect(shown.spills.length === 0, `${at}: below More, no card's words paint outside its box`, shown.spills);
        rowOnly(`${at}: the folded excerpt shown below More`, shown.aside, true);
        await centre(p, '#messages .stack-more'); await press(p, device, '#messages .stack-more');
        await until(async () => !(await look()).aside.shown, `${at}: More puts it back`);
        flush(at + ' below More');
        // A press on the row unfolds it whole: its excerpt reads, inside its card, and nothing above it moves.
        // On its author, at the row's start: in a dossier "Folded" is said to a screen reader only (item 471).
        await centre(p, card(ids.folded));
        const before = await above();
        await press(p, device, card(ids.folded) + ' > .message-folded > .folded-author');
        await until(async () => !(await look()).folded.folded, `${at}: a press on the row unfolds it`);
        await until(() => foldedInCore(ids.folded, false), `${at}: Core keeps the unfold`);
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme); await centre(p, card(ids.folded)); await away(p);
          await shot(p, `dossier-folded-excerpt-${at.replace(' ', '-')}-${theme}-unfolded`);
          const open = await look(), it = await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(card(ids.folded))}),w=e.querySelector(':scope > .message-preview'),cb=e.getBoundingClientRect(),
            first=document.createRange();first.selectNodeContents(w);const r=first.getClientRects()[0];
            return {words:w.getClientRects().length>0,cue:Boolean(e.querySelector(':scope > .message-preview-cue')?.getClientRects().length),firstInside:Boolean(r)&&r.top>=cb.top-1&&r.bottom<=cb.bottom+1,
              height:Math.round(cb.height),window:innerHeight}})()`);
          expect(open.spills.length === 0, `${at} ${theme}: unfolded, no card's words paint outside its box`, open.spills);
          expect(it.words && it.cue && it.firstInside && it.height > foldedMax, `${at} ${theme}: unfolded, its excerpt reads in its card with its cue`, it);
          expect(!coarse || it.height < it.window, `${at} ${theme}: unfolded by touch, the card stays shorter than the window`, it);
        }
        expect(JSON.stringify(await above()) === JSON.stringify(before), `${at}: unfolding moves nothing above it`, { before, after: await above() });
        // Folded again (here, from another device), the row is all that draws, and the next size reloads it.
        await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.folded, operation_id: `${topic}-refold-${at}`, args: { folded: true } });
        await until(async () => (await look()).folded.folded, `${at}: the page hears it folded again`);
        const again = await look();
        expect(again.spills.length === 0, `${at}: folded again, no card's words paint outside its box`, again.spills);
        rowOnly(`${at}: folded again`, again.folded, true);
      }
      await reload();
      await until(drawn, `${device}: after a last reload the folds are drawn from Core`);
      const last = await look();
      expect(last.spills.length === 0, `${device}: after a reload, no card's words paint outside its box`, last.spills);
      rowOnly(`${device}: after a reload, the folded excerpt in a dossier`, last.folded, true);
      flush(device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // An agent's reply and a person's (item 430: the rule for a card that is no agent's is checked too).
  await check('reading dossier look gives a saved fold the read material before its read marker catches up', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-material-${device}`, ids = await dossierSeed(topic);
      ids.human = (await control({ method: 'agent_message', operation_id: topic + '-human', topic_id: topic, source: 'topic', sender: 'fixture-other-person', join: true,
        reply_to: ids.root, addressees: [facts.actor], body: 'A person\'s reply, folded.' })).result.message_id;
      await dossierFold(topic, ids.middle); await dossierFold(topic, ids.human);
      const p = await open(topic, device, topic, ids.root, 'window.holdReads=true;'); await dossierOpen(p, device, ids.root); await away(p);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        for (const [key, material] of [['middle', 'color-mix(in srgb,var(--agent-card) var(--read-tint),var(--read-card))'], ['human', 'var(--read-card)']]) {
          const fill = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids[key]))}),probe=document.createElement('span');
            probe.style.background=${JSON.stringify(material)};c.append(probe);
            const pixel=color=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)},
              result={read:c.hasAttribute('data-read'),folded:c.dataset.folded,agent:c.classList.contains('agent-card'),inDossier:c.closest('.reply-stack')?.dataset.single==='false',actual:pixel(getComputedStyle(c).backgroundColor),expected:pixel(getComputedStyle(probe).backgroundColor)};probe.remove();return result})()`);
          assert.equal(fill.read, false, 'the fixture retains its unread marker, so readNow cannot make this pass');
          assert.deepEqual([fill.folded, fill.agent, fill.inDossier], ['true', key === 'middle', true], `${device} ${theme}: ${key} is a saved fold in the dossier, ${key === 'middle' ? 'an agent\'s' : 'a person\'s'}`);
          assert.deepEqual(fill.actual, fill.expected, `${device} ${theme}: a saved fold (${key}) uses read material without a read marker`);
          observations.push({ name: 'dossier folded read material', engine, device, theme, key, ...fill });
        }
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // The read material is a saved fold's in a dossier, and nothing else's: the
  // reader's own thumbs-up on an unread card, inside a dossier or out, and a
  // fold outside a dossier keep the feed's unread material, beside a twin of
  // the same palette that nobody touched.
  await check('reading dossier look gives read material to no thumbs-up and no fold outside a dossier', async () => {
    const human = 'fixture-other-person';
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-unread-material-${device}`;
      const ids = await seed(topic, [
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'Dossier root for unread material.', read: true }],
        ['agentThumb', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'An agent reply with the reader\'s thumbs-up.' }],
        ['agentPlain', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'An agent reply nobody touched.' }],
        ['humanThumb', { sender: human, join: true, reply_to: 'root', addressees: [facts.actor], body: 'A person\'s reply with the reader\'s thumbs-up.' }],
        ['humanPlain', { sender: human, reply_to: 'root', addressees: [facts.actor], body: 'A person\'s reply nobody touched.' }],
        ['singleThumb', { sender: other, addressees: [facts.actor], body: 'A single agent message with the reader\'s thumbs-up.' }],
        ['singleFold', { sender: other, addressees: [facts.actor], body: 'A single agent message the reader folded.' }],
        ['singlePlain', { sender: other, addressees: [facts.actor], body: 'A single agent message nobody touched.' }],
        ['humanSingleFold', { sender: human, addressees: [facts.actor], body: 'A single person\'s message the reader folded.' }],
        ['humanSinglePlain', { sender: human, addressees: [facts.actor], body: 'A single person\'s message nobody touched.' }],
        ['placedFold', { sender: other, addressees: [facts.actor], body: 'A placed single message the reader folded.' }],
        ['placedPlain', { sender: other, addressees: [facts.actor], body: 'A placed single message nobody touched.' }],
      ]);
      const thumbed = [ids.agentThumb, ids.humanThumb, ids.singleThumb];
      // A star keeps a thumbed card whole (a thumbs-up folds it otherwise), as the reviewer's steps do.
      for (const id of thumbed) {
        await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: id, operation_id: `${topic}-${id}-star`, args: { starred: true } });
        await control({ method: 'agent_thumb', sender: facts.actor, message_id: id, operation_id: `${topic}-${id}-thumb` });
      }
      for (const id of [ids.singleFold, ids.humanSingleFold, ids.placedFold]) await dossierFold(topic, id);
      // A placed single is a stack section of one message, still no dossier.
      for (const [id, key] of [[ids.placedFold, 1], [ids.placedPlain, 2]]) {
        await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.place', message_id: id, operation_id: `${topic}-${id}-place`, args: { key } });
      }
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: thumbed, marked: true });
      const p = await open(topic, device, topic, ids.root, 'window.holdReads=true;'); await dossierOpen(p, device, ids.root);
      const pairs = [['agentThumb', 'agentPlain', 'dossier'], ['humanThumb', 'humanPlain', 'dossier'], ['singleThumb', 'singlePlain', 'feed'],
        ['singleFold', 'singlePlain', 'feed'], ['humanSingleFold', 'humanSinglePlain', 'feed'], ['placedFold', 'placedPlain', 'placed']];
      await until(() => p.evaluate(`${JSON.stringify(thumbed)}.every(id=>document.querySelector('#messages .message-card[data-id="'+id+'"] > .message-reactions > .reaction-count.mine'))`),
        `${device}: the reader's own thumbs-up shows on each thumbed card`);
      await away(p);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const material = await p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),
          pixel=color=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)},
          face=id=>{const e=c(id),s=e.closest('.reply-stack');return {where:!s?'feed':s.dataset.single==='true'?'placed':'dossier',read:e.hasAttribute('data-read'),folded:e.dataset.folded==='true',
            unreadPill:Boolean(e.querySelector('.unread-mark')),mine:Boolean(e.querySelector(':scope > .message-reactions > .reaction-count.mine')),fill:pixel(getComputedStyle(e).backgroundColor)}};
          return Object.fromEntries(Object.keys(ids).map(name=>[name,face(ids[name])]))})()`);
        for (const [touched, plain, where] of pairs) {
          const t = material[touched], u = material[plain];
          assert.deepEqual([t.where, u.where], [where, where], `${device} ${theme}: ${touched} and ${plain} are both in the ${where}: ${JSON.stringify(material)}`);
          assert.deepEqual([t.read, u.read], [false, false], `${device} ${theme}: ${touched} and ${plain} are both unread`);
          if (touched.endsWith('Thumb')) assert.deepEqual([t.mine, t.folded, t.unreadPill], [true, false, true], `${device} ${theme}: ${touched} holds the reader's thumbs-up, whole, marked unread`);
          else assert.equal(t.folded, true, `${device} ${theme}: ${touched} is a saved fold`);
          assert.deepEqual(t.fill, u.fill, `${device} ${theme}: ${touched} keeps the unread material of ${plain}`);
        }
        observations.push({ name: 'dossier unread material', engine, device, theme, material });
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 429 at the level people see most: latest and unread. Read replies are
  // hidden there; a hidden reply above the first visible one gives it no
  // overlap past the folder's top edge, and one between two faces neither
  // separates them nor takes the covered padding.
  await check('reading dossier look at latest and unread overlaps only visible faces, never past the folder\'s top edge', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-default-level-${device}`;
      const ids = await seed(topic, [
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'Dossier root, read.', read: true }],
        ['before', { sender: facts.actor, reply_to: 'root', addressees: [other], body: 'The reader\'s own reply, read, hidden above the first face.' }],
        ['first', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An unread reply, the first face.' }],
        ['between', { sender: facts.actor, reply_to: 'root', addressees: [other], body: 'The reader\'s own reply, read, hidden between two faces.' }],
        ['latest', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest reply, the second face.' }],
      ]);
      // The reader's own replies are read to them, so this level hides them;
      // a reply folds what it answers, and the root is put back whole.
      await dossierFold(topic, ids.root, false);
      const p = await open(topic, device, topic, ids.root, 'window.holdReads=true;');
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.first))})?.getClientRects().length)`),
        `${device}: the unread reply shows at latest and unread`);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const g = await p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),entry=e=>e.parentElement.classList.contains('message-fold')?e.parentElement:e,
          section=c(ids.root).closest('.reply-stack'),replies=section.querySelector(':scope > .stack-replies'),rect=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom}};
          return {fold:section.dataset.fold,headOpen:section.dataset.headOpen,replies:rect(replies),
            hidden:[ids.before,ids.between].map(id=>{const e=entry(c(id));return {shown:e.getClientRects().length>0,overlap:e.dataset.stackOverlap,covered:e.dataset.stackCovered}}),
            first:{box:rect(entry(c(ids.first))),words:rect(c(ids.first).querySelector('.message-preview')),margin:parseFloat(getComputedStyle(entry(c(ids.first))).marginTop)},
            latest:{box:rect(entry(c(ids.latest))),covered:entry(c(ids.latest)).dataset.stackCovered}}})()`);
        assert.deepEqual([g.fold, g.headOpen], ['folded', 'false'], `${device} ${theme}: the dossier is at latest and unread, its head a tab: ${JSON.stringify(g)}`);
        assert.deepEqual(g.hidden.map(h => h.shown), [false, false], `${device} ${theme}: both read replies are hidden at this level`);
        assert.ok(g.first.box.top >= g.replies.top - .5 && g.first.margin === 0, `${device} ${theme}: the first visible face takes no overlap past the folder's top edge: ${JSON.stringify(g)}`);
        assert.ok(Math.abs(g.first.box.bottom - g.latest.box.top - 12) < .5, `${device} ${theme}: the next visible face overlaps it by 12px across the hidden reply: ${JSON.stringify(g)}`);
        assert.ok(g.first.words.bottom <= g.latest.box.top, `${device} ${theme}: the overlap never covers the first face's words`);
        assert.deepEqual(g.hidden.map(h => [h.overlap, h.covered]), [['false', 'false'], ['false', 'false']], `${device} ${theme}: a hidden reply takes neither the overlap nor the covered padding`);
        assert.equal(g.latest.covered, 'false', `${device} ${theme}: the last face is covered by nothing`);
        observations.push({ name: 'dossier default level layers', engine, device, theme, ...g });
        await shot(p, `dossier-default-level-${device}-${theme}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading dossier look preserves full open messages, single cards and star fold protection', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-negatives-${device}`, ids = await dossierSeed(topic);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.middle, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root); const toggle = await dossierOpen(p, device, ids.root);
      const full = await p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),single=c(ids.single),s=getComputedStyle(single);
        return {bodies:[ids.root,ids.middle,ids.last].map(id=>{const e=c(id).querySelector('.message-preview');return e.getClientRects().length>0&&getComputedStyle(e).display!=='none'}),
          single:{stack:Boolean(single.closest('.reply-stack')),padding:parseFloat(s.paddingTop),folded:single.dataset.folded==='true'},overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      assert.deepEqual(full.bodies, [true,true,true], 'all original and reply words stay shown when open');
      assert.deepEqual(full.single, { stack:false,padding:16,folded:false }, 'a single message keeps its normal box and behavior');
      assert.equal(full.overflow, false, 'no horizontal overflow');
      // Focus is setup; the actual x key must refuse folding a star in Core.
      await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.middle))}).focus()`); await p.key('x');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.middle))}).dataset.folded==='true'`), false, 'a starred message never folds');
      const acts = await view('message_acts', { topic_id: topic });
      assert.equal(acts.items.find(item => item.message_id === ids.middle).acts.folded, false, 'no fold was recorded for the star');
      await centre(p, toggle); await press(p, device, toggle); await press(p, device, toggle);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state`), 'open', 'the existing two-state control is unchanged');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  // A stack, as the page shows it: its head's row and whether its full message
  // shows, its fold, and what sits under it top to bottom, by the names seeded.
  const look = (p, ids, head) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return p.evaluate(`(()=>{const names=${JSON.stringify(names)},c=document.querySelector(${JSON.stringify(card(ids[head]))}),s=c?.closest('.reply-stack');
      if(!s)return null;const row=s.querySelector('.stack-head');const shown=e=>e.getClientRects().length>0;
      return {fold:s.dataset.fold,headOpen:s.dataset.headOpen,placed:s.dataset.placed,head:names[s.firstElementChild.dataset.id],
        name:row?.querySelector('.stack-name')?.textContent??null,meta:row?.querySelector('.stack-meta')?.textContent??null,isNew:Boolean(row?.querySelector('.stack-new')),
        full:shown(c.querySelector(':scope > .message-preview')),
        rows:[...s.querySelector(':scope > .stack-replies').children].filter(shown).map(e=>e.dataset.id?names[e.dataset.id]:e.classList.contains('stack-join-line')?'join: '+e.querySelector('.stack-join-words').textContent.replace(/, .*$/,''):e.className)}})()`);
  };
  // The stacks down the page, each by its head's name.
  const stacks = (p, ids) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    // The topic's opening, the person's own and the oldest, is left out.
    return p.evaluate(`[...document.querySelector('#messages').children].filter(e=>(e.dataset.id||e.classList.contains('reply-stack'))&&!(e.classList.contains('own-message')&&!(${JSON.stringify(names)})[e.dataset.id])).map(e=>(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??('?'+e.tagName+'.'+e.className))`);
  };
  // The acts on a message as a reader holds them in Core.
  const actsOf = async (topic, id, reader = facts.actor) => {
    const found = reader === facts.actor ? await view('message_acts', { topic_id: topic }) : (await control({ method: 'acts_as', reader, topic_id: topic })).acts;
    return found.items.find(item => item.message_id === id)?.acts ?? null;
  };
  const starsOf = async reader => (reader === facts.actor ? await view('stars', {}) : (await control({ method: 'acts_as', reader, topic_id: 'none' })).stars).items.map(star => star.message_id);
  // The keys on a message, reached as a person reaches it: ↑ or ↓ until its card holds the focus. From a control in
  // the list between the cards (More, where Move below More leaves the keys) the keys step from where it is.
  const keyTo = async (p, id) => {
    // From the bar or a menu the keys come back to the page first, as Esc or a press on the page brings them.
    await p.evaluate(`(()=>{if(!document.querySelector('#messages').contains(document.activeElement))document.activeElement?.blur()})()`);
    for (let step = 0; step < 30; step++) {
      // A dossier's chevron is a stop before its head, so it is placed as the dossier itself.
      const way = await p.evaluate(`(()=>{const here=document.activeElement,to=document.querySelector(${JSON.stringify(card(id))});
        const at=here?.matches?.('#messages .reply-stack > .stack-toggle')?here.parentElement:here?.closest?.('#messages [data-id]');
        const from=at??(here&&here!==document.body&&document.querySelector('#messages').contains(here)?here:null);
        if(at?.dataset.id===${JSON.stringify(id)})return 'there';if(!from)return 'ArrowDown';return from.compareDocumentPosition(to)&Node.DOCUMENT_POSITION_FOLLOWING?'ArrowDown':'ArrowUp'})()`);
      if (way === 'there') return;
      await p.key(way);
    }
    assert.fail(`the keys never reached ${id}`);
  };
  const said = p => p.evaluate(`document.getElementById('stack-said')?.textContent ?? ''`);
  const alertColour = p => p.evaluate(`(()=>{const s=document.createElement('span');s.style.color='var(--alert)';document.body.append(s);const c=getComputedStyle(s).color;s.remove();return c})()`);
  const focusedOn = p => p.evaluate(`document.activeElement?.closest?.('[data-id]')?.dataset.id ?? null`);
  // A right click (two fingers' click on a trackpad) on a card, where a person opens a message's menu with no bar:
  // in its corner, clear of its words, as Safari's engine selects the word a right click lands on, and the page leaves
  // a right click on selected words to the browser's own menu.
  const rightClick = async (p, selector) => {
    await centre(p, selector);
    const b = await p.box(selector), x = b.x + 8, y = b.y + 8;
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  };
  // The ⋯ menu of a message, from its bar, and the words of its items. A message lit with no bar (a dossier's one-row
  // head): on a laptop its menu is the right click's.
  const menuOf = async (p, device, id) => {
    await light(p, device, id);
    if (device !== 'phone' && await bar(p) === null) await rightClick(p, card(id));
    else await press(p, device, '.message-bar [data-act=more]');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: ⋯ opens the menu`);
    return p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.textContent)`);
  };
  // A press held down where its click opens nothing: on the topic's name, at the top of the page. Gives
  // back the press's release.
  const holdOnTitle = async p => {
    await p.evaluate('scrollTo(0,0)');
    const b = await p.box('#topic-title'), x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
    assert.equal(await p.evaluate(`document.getElementById('topic-title').contains(document.elementFromPoint(${x},${y}))`), true, 'the topic\'s name shows where it is pressed');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    return () => p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  // Two frames on: a repaint the page made at once is on the page.
  const twoFrames = p => p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  // The page at rest before a press is aimed at selector: none of its requests out, and the target's box the same
  // across two animation frames, measured in one look. An answer that lands draws the page again, and a redraw
  // between the aim and the press moves the target from under the point (item 433).
  const atRest = (p, selector) => until(() => p.evaluate(`window.fetchesOut===0&&new Promise(done=>{
    const box=()=>{const b=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return b?[b.x,b.y,b.width,b.height].join():null};
    const first=box();requestAnimationFrame(()=>{const second=box();requestAnimationFrame(()=>done(first!==null&&first===second&&second===box()&&window.fetchesOut===0))})})`),
    `${selector} is at rest: no request out, and its box the same across two frames`);
  const choose = async (p, device, label) => {
    const at = await p.evaluate(`[...document.querySelectorAll('.message-menu-list button')].findIndex(b=>b.firstChild.textContent===${JSON.stringify(label)})`);
    assert.ok(at >= 0, `${label} is in the menu`);
    await press(p, device, `.message-menu-list button:nth-of-type(${at + 1})`);
  };

  await check('reading coordination dossiers stay compact, can be hidden, and return for human or room replies', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-coordination-' + device;
      const ids = await seed(topic, [
        ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
        ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Review between agents only' }],
        ['reply', { sender: 'aim-ux', join: true, addressees: ['aim-core'], reply_to: 'root', body: 'The review is ready.' }],
        ['room', { sender: 'aim-core', addressees: [], body: 'An update for the room.' }],
        ['roomReply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'room', body: 'I checked it.' }],
        ['mine', { sender: facts.actor, addressees: ['aim-core'], body: 'My question.' }],
        ['answer', { sender: 'aim-core', addressees: ['aim-ux'], reply_to: 'mine', body: 'Answering the human without a To field naming them.' }],
      ]);
      const p = await open(topic, device, topic, ids.root);
      const target = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const state = () => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(target)});return s?{compact:s.dataset.compact,fold:s.dataset.fold,visible:s.getClientRects().length>0,height:s.getBoundingClientRect().height}:null})()`);
      await until(async () => (await state())?.compact === 'true', 'the agent-only dossier is compact');
      assert.ok((await state()).height <= 52, 'one quiet row, not a folder and another row');
      assert.equal((await look(p, ids, 'room')).fold, 'folded', 'room posts retain normal dossiers');
      assert.equal((await look(p, ids, 'mine')).fold, 'folded', 'direct answers to the human stay visible');
      await shot(p, 'coordination-compact-' + device);
      const toggle = target + ' > .stack-toggle', filter = '#agent-coordination-show button';
      // From its header alone, the two states every dossier has (item 394); it never goes back to the header alone.
      for (const wanted of ['folded', 'open', 'folded']) {
        await centre(p, toggle); await press(p, device, toggle);
        await becomes(async () => (await state()).fold, wanted, 'from the header, the two states: ' + wanted);
      }
      await centre(p, filter); await press(p, device, filter);
      await becomes(async () => (await state()).visible, false, 'Show agent coordination hides the row');
      const later = (await control({ method: 'agent_message', operation_id: topic + '-later', topic_id: topic, source: 'topic', sender: 'aim-ux', addressees: ['aim-core'], reply_to: ids.reply, body: 'Another internal check.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(later))}))`), 'new internal reply arrives');
      assert.equal((await state()).visible, false, 'agent replies do not make it reappear');
      const human = (await control({ method: 'agent_message', operation_id: topic + '-human', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: device === 'phone' ? [] : [facts.actor], reply_to: later, body: 'Now this needs your attention.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(human))}))`), 'human-addressed reply arrives');
      await becomes(async () => (await state()).visible, true, 'a human-addressed reply brings the dossier back');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(target)}).dataset.coordination`), '', 'mixed stack is not classified as agent-only');
      await shot(p, 'coordination-returned-' + device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 403: Show agent coordination sits in the row of filters over the feed, between the header's buttons and the
  // messages. The keys go onto it and off again as on any of the buttons at the top of the feed, with it on and with it
  // off: ↑ and ↓ go from row to row, so they pass through it both ways and never stay on it.
  await check('reading coordination the keys go on from Show agent coordination: ↑ goes on up to the header\'s buttons, ↓ reaches the top of the feed and ↑ comes back, on and off, skipping no message, and Return, Space, a press and the pointer still work', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-coordination-keys-' + device;
      const ids = await seed(topic, [
        ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
        ['plain', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message for you.' }],
        ['root', { sender: 'aim-core', addressees: ['aim-ux'], body: 'Agents only, between us.' }],
        ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.' }],
      ]);
      const p = await open(topic, device, topic, ids.plain);
      const filter = '#agent-coordination-show button', dossier = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
      // Where the keys are: the chip, a dossier's chevron, a message by its seeded name, the Team's "+ Add" (the
      // header's last button, item 465), or another control by its id.
      const keyed = () => p.evaluate(`(()=>{const e=document.activeElement,n=${JSON.stringify(names)};if(e?.matches?.(${JSON.stringify(filter)}))return 'chip';if(e?.matches?.('#participants .add-chip'))return 'add';
        if(e?.matches?.('.stack-toggle'))return 'chevron:'+(n[e.closest('.reply-stack').dataset.stack]??'?');
        const m=e?.closest?.('#messages [data-id]');if(m)return n[m.dataset.id]??'another message';return e?.id||e?.tagName||'none'})()`);
      const shownDossier = () => p.evaluate(`(s=>Boolean(s?.getClientRects().length))(document.querySelector(${JSON.stringify(dossier)}))`);
      const pressed = () => p.evaluate(`document.querySelector(${JSON.stringify(filter)}).getAttribute('aria-pressed')`);
      await until(async () => await shownDossier() && await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(filter)})?.checkVisibility())`),
        `${device}: the agents' dossier shows, and Show agent coordination over the feed`);
      const inHeader = () => p.evaluate(`Boolean(document.querySelector('#main > .topic-header')?.contains(document.activeElement))`);
      // The keys reach the chip as a person's do: up from the top of the feed to the header's buttons, along them to
      // the last, the Team's "+ Add", and Tab on.
      await keyTo(p, ids.root);
      assert.equal(await keyed(), 'root', `${device}: the agents' dossier is at the top of the feed`);
      for (let n = 0; n < 16 && await keyed() !== 'add'; n++) await p.key(await inHeader() ? 'ArrowRight' : 'ArrowUp');
      assert.equal(await keyed(), 'add', `${device}: the keys are on "+ Add", the header's last button`);
      // ↑ on the header's top row goes on to what lies above it, if anything (item 301): where the header wraps a
      // control of it may stand above "+ Add"; where none does, the keys stay.
      const above = await p.evaluate(`(e=>{const b=e.getBoundingClientRect();return [...document.querySelectorAll('#main > .topic-header button, #main > .topic-header a[href]')].some(x=>x!==e&&x.checkVisibility()&&(c=>c.bottom<=b.top+1&&c.left<b.right&&c.right>b.left)(x.getBoundingClientRect()))})(document.activeElement)`);
      await p.key('ArrowUp');
      if (above) {
        assert.equal(await p.evaluate(`(e=>Boolean(e.closest('#main > .topic-header'))&&e.getBoundingClientRect().bottom<=document.querySelector('#participants .add-chip').getBoundingClientRect().top+1)(document.activeElement)`), true, `${device}: ↑ on "+ Add" goes on to the header's control above it, not ${await keyed()}`);
        await p.evaluate("document.querySelector('#participants .add-chip').focus()");
      } else assert.equal(await keyed(), 'add', `${device}: ↑ on the header's buttons, the top row, with nothing above, moves nothing`);
      await p.key('Tab');
      assert.equal(await keyed(), 'chip', `${device}: Tab from "+ Add" reaches Show agent coordination`);
      await shot(p, 'coordination-keys-' + device);
      // Up from the chip: the header's buttons, at "+ Add", the one the keys were last on there; never the chip again.
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'add', `${device}: ↑ from Show agent coordination goes up to "+ Add", the header's button the keys were last on`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'chip', `${device}: ↓ from "+ Add" comes down to the row of filters, onto the chip`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'root', `${device}: and ↓ from it into the feed`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'chip', `${device}: ↑ from the top of the feed reaches the row of filters just above it`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'add', `${device}: and ↑ again the header's buttons, at "+ Add"`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'chip', `${device}: ↓ from "+ Add" comes back down to the chip`);
      // On: ↓ goes on to the top of the feed, and ↑ comes back; the keys never stay on the chip.
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'root', `${device}: ↓ from Show agent coordination moves the keys on to the dossier at the top of the feed`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'chip', `${device}: ↑ from the top of the feed comes back to Show agent coordination, the button the keys left`);
      await p.key('ArrowDown'); await p.key('ArrowDown');
      assert.equal(await keyed(), 'plain', `${device}: and ↓ goes on down the feed, skipping no message`);
      await p.key('ArrowUp'); await p.key('ArrowUp');
      assert.equal(await keyed(), 'chip', `${device}: and ↑ back up to the chip`);
      // Off by Return, the keys still on it: ↓ goes to the first message shown, never the hidden dossier, and ↑ comes back.
      await p.key('Enter');
      await becomes(pressed, 'false', `${device}: Return on Show agent coordination turns it off`);
      assert.equal(await shownDossier(), false, `${device}: and the agents' dossier is hidden`);
      assert.equal(await keyed(), 'chip', `${device}: the keys stay on it`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'plain', `${device}: ↓ from it, turned off, goes to the first message shown, past the hidden dossier`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'chip', `${device}: ↑ comes back to it`);
      await p.key(' ');
      await becomes(pressed, 'true', `${device}: Space turns it on again`);
      await until(shownDossier, `${device}: the dossier shows again`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'root', `${device}: ↓ goes to the dossier again`);
      // A press still turns it off and on; after it ↓ moves the keys into the feed, onto no hidden message. Chrome
      // leaves a pressed button the focus, Safari's engine does not, so the keys go on from the chip or from where they were.
      await centre(p, filter); await press(p, device, filter);
      await becomes(pressed, 'false', `${device}: a press turns it off`);
      await p.key('ArrowDown');
      const after = await keyed();
      assert.ok(!['chip', 'root', 'reply'].includes(after) && await p.evaluate(`document.getElementById('messages').contains(document.activeElement)`),
        `${device}: after the press ↓ moves the keys into the feed, onto a message shown, not ${after}`);
      await centre(p, filter); await press(p, device, filter);
      await becomes(pressed, 'true', `${device}: a second press turns it on`);
      await until(shownDossier, `${device}: the dossier shows once more`);
      // A click or a tap in a message, or the pointer moving onto it, still gives it the keys' place (items 386 and 387),
      // and from there ↑ goes up the feed and on to the chip the keys were last on.
      await centre(p, words(ids.plain));
      if (device === 'phone') await tap(p, words(ids.plain)); else await p.point(words(ids.plain), 'move');
      await until(async () => await keyed() === 'plain', `${device}: the ${device === 'phone' ? 'tap' : 'pointer moving'} on a message gives it the keys' place`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'root', `${device}: ↑ goes from there to the dossier above`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'chip', `${device}: and on to Show agent coordination`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'add', `${device}: and on up past it to "+ Add", the header's button the keys were last on, never staying on the chip`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 403: the row of filters over the feed is a row of its own under the header's buttons. ← and → move along it,
  // "Read it" among them, and past either end go on to the outline and the right rail as from the messages, where those
  // are on screen; the header's buttons end at their own row, so → from its last, the Team's "+ Add", goes to the right
  // rail, not on to a filter. No arrow presses a filter.
  await check('reading coordination ← and → move along the filters\' row, Read it among them, and past either end to the outline and the right rail; ↑ and ↓ go between it and the header\'s buttons, and no arrow presses one', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-coordination-row-' + device, laptop = device === 'laptop';
      const ids = await seed(topic, [
        ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
        ['plain', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A message for you.' }],
        ['root', { sender: 'aim-core', addressees: ['aim-ux'], body: 'Agents only, between us.' }],
        ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.' }],
      ]);
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.plain], marked: true });
      const p = await open(topic, device, topic, ids.plain);
      const filter = '#agent-coordination-show button';
      const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
      // Where the keys are: Read it, the chip, the outline, the right rail, one of the header's buttons, a message by its
      // seeded name, or another control by its id.
      const keyed = () => p.evaluate(`(()=>{const e=document.activeElement,n=${JSON.stringify(names)};if(e?.matches?.(${JSON.stringify(filter)}))return 'chip';
        if(e?.id==='read-mark')return 'read-it';if(e?.closest?.('#outline'))return 'outline';if(e?.closest?.('#things'))return 'things';
        if(e?.matches?.('#participants .add-chip'))return 'header:add';if(e?.closest?.('#main > .topic-header'))return 'header:'+(e.id||e.textContent.trim());
        if(e?.matches?.('.stack-toggle'))return 'chevron:'+(n[e.closest('.reply-stack').dataset.stack]??'?');
        const m=e?.closest?.('#messages [data-id]');if(m)return n[m.dataset.id]??'another message';return e?.id||e?.tagName||'none'})()`);
      const marked = () => p.evaluate(`!document.getElementById('topic-marks').hidden`);
      await until(async () => await marked() && await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(filter)})?.checkVisibility())`),
        `${device}: Read it and Show agent coordination show over the feed`);
      // The right rail takes the keys at the laptop width once it has loaded, and not on a phone, where it is behind a
      // button. → from a plain message finds it as a person would (→ never leaves a dossier's root, so the root cannot
      // tell); past the row's last button the keys go there too, else nowhere.
      if (laptop) await until(() => p.evaluate(`Boolean(document.querySelector('#things .things-sec:not([hidden]) > summary')?.checkVisibility())`),
        'laptop: the right rail has loaded');
      await keyTo(p, ids.plain);
      await p.key('ArrowRight');
      const rail = await keyed() === 'things';
      assert.equal(rail, laptop, `${device}: → from a message ${laptop ? 'reaches the right rail' : 'moves nothing, the right rail being behind a button'}`);
      if (rail) { await p.key('ArrowLeft'); if (await keyed() === 'things') await p.key('ArrowLeft'); }
      assert.equal(await p.evaluate(`document.getElementById('messages').contains(document.activeElement)`), true, `${device}: the keys are in the feed`);
      await keyTo(p, ids.root);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'read-it', `${device}: ↑ from the top of the feed reaches the row of filters, at its first, Read it`);
      await p.key('ArrowRight');
      assert.equal(await keyed(), 'chip', `${device}: → from Read it goes along the row to Show agent coordination`);
      await p.key('ArrowLeft');
      assert.equal(await keyed(), 'read-it', `${device}: ← from the chip comes back to Read it`);
      await p.key('ArrowLeft');
      if (laptop) {
        assert.equal(await keyed(), 'outline', 'laptop: ← past Read it, the row\'s first, goes to the outline');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate(`document.getElementById('messages').contains(document.activeElement)`), true, 'laptop: → from the outline comes back into the feed');
        await keyTo(p, ids.root); await p.key('ArrowUp');
        assert.equal(await keyed(), 'read-it', 'laptop: ↑ from there finds Read it again, the filter the keys were last on');
      } else {
        // The outline is behind ☰: the keys never open it; ← goes on to the nearest control that way in the feed (item 301).
        const at = await keyed();
        assert.equal(await p.evaluate(`Boolean(document.activeElement?.closest('#main'))&&!document.getElementById('rail').classList.contains('open')&&document.getElementById('rail-open')?.getAttribute('aria-expanded')!=='true'`), true, `phone: ← past Read it stays in the feed, never opening the outline, on ${at}`);
        await p.evaluate("document.getElementById('read-mark').focus()");
      }
      await p.key('ArrowRight'); await p.key('ArrowRight');
      if (rail) {
        assert.equal(await keyed(), 'things', `${device}: → past the chip, the row's last, goes to the right rail`);
        await p.key('ArrowLeft');
        if (await keyed() === 'things') await p.key('ArrowLeft');
        assert.equal(await p.evaluate(`document.getElementById('messages').contains(document.activeElement)`), true, `${device}: ← from the right rail comes back into the feed`);
        await keyTo(p, ids.root); await p.key('ArrowUp');
        assert.equal(await keyed(), 'chip', `${device}: ↑ from there finds the chip, the filter the keys were last on`);
      } else assert.equal(await keyed(), 'chip', `${device}: → past the chip, the row's last, moves nothing where the right rail takes no keys`);
      // Up and down between the two rows, each finding the button the keys were last on in it.
      await p.key('ArrowLeft');
      assert.equal(await keyed(), 'read-it', `${device}: ← to Read it`);
      await p.key('ArrowUp');
      assert.match(await keyed(), /^header:/, `${device}: ↑ from Read it goes up to the header's buttons`);
      // The header's buttons end with the Team's "+ Add" (item 465).
      for (let n = 0; n < 16 && await keyed() !== 'header:add'; n++) await p.key('ArrowRight');
      assert.equal(await keyed(), 'header:add', `${device}: → along the header's buttons reaches the Team's "+ Add"`);
      await p.key('ArrowDown');
      assert.equal(await keyed(), 'read-it', `${device}: ↓ from "+ Add" comes down to Read it, the filter the keys were last on`);
      await p.key('ArrowUp');
      assert.equal(await keyed(), 'header:add', `${device}: ↑ goes back up to "+ Add"`);
      // The header's buttons end at their own row: → from "+ Add" goes on to the right rail, never to a filter. Where no
      // rail takes the keys it goes on to the nearest control that way on screen (item 301; on a phone the Team wraps,
      // and a pill's × stands to the right of "+ Add"), and stays where none does. Nearest as docs/interaction.md says
      // ("The arrows everywhere"): one beside it in its row first, else the least gap that way plus twice the gap
      // across. The control that rule names is marked before the press, and the press must land on it.
      const ahead = await p.evaluate(`(()=>{const e=document.activeElement,b=e.getBoundingClientRect(),mid=r=>(r.left+r.right)/2;
        const all=[...document.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea,[tabindex]')].filter(x=>x!==e&&x.tabIndex>=0&&!x.disabled&&!x.closest('[inert],[aria-hidden="true"]')&&x.checkVisibility())
          .map(x=>({x,c:x.getBoundingClientRect()})).filter(({c})=>c.width>0&&c.left>b.left&&c.right>b.right&&mid(c)>mid(b)+0.5);
        const across=c=>Math.max(0,c.top-b.bottom,b.top-c.bottom),row=all.filter(({c})=>across(c)===0);
        let best=null,score=Infinity;for(const {x,c} of row.length?row:all){const v=Math.max(0,c.left-b.right)+2*across(c);if(v<score){score=v;best=x}}
        for(const x of document.querySelectorAll('[data-nearest-right]'))delete x.dataset.nearestRight;
        if(!best)return null;best.dataset.nearestRight='';return {team:Boolean(best.closest('#participants')),said:best.getAttribute('aria-label')||best.textContent.trim(),of:all.length}})()`);
      await p.key('ArrowRight');
      const to = await keyed();
      if (rail || !ahead) assert.equal(to, rail ? 'things' : 'header:add',
        `${device}: → from "+ Add", the header's last, goes ${rail ? 'to the right rail' : 'nowhere, nothing lying that way'}, not on to a filter`);
      else {
        // On a phone the wrapped Team puts a pill's × there: the nearest that way is the Team's own.
        assert.equal(ahead.team, true, `${device}: the nearest control to the right of "+ Add" is the Team's, as the wrapped header draws it: ${JSON.stringify(ahead)}`);
        assert.equal(await p.evaluate(`document.activeElement?.hasAttribute('data-nearest-right')===true`), true,
          `${device}: → from "+ Add", no right rail taking keys, lands on the nearest control that way (${ahead.said}, of ${ahead.of}), not on a farther one: ${to}`);
      }
      // No arrow pressed a filter: no Reader opened, the mark is still there, and the agents' dossier still shows.
      assert.equal(await readerOn(p), null, `${device}: no arrow on Read it opened the Reader`);
      assert.equal(await marked(), true, `${device}: and the mark is still there`);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(filter)}).getAttribute('aria-pressed')`), 'true', `${device}: and Show agent coordination is still on`);
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids.plain], marked: false });
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks a dossier left at its header alone shows latest plus unread once it is not agents\' alone, and a new agent-only dossier still begins as its header', async () => {
    // Item 394: the header alone is no state of an ordinary dossier. An agent-only dossier (item 359) still begins
    // there; ⌘Z after opening one takes it back there; once a reply brings in the person it reads as any other.
    const topic = 'stack-head-left';
    const ids = await seed(topic, [
      ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.' }],
      ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Agents only, at first.' }],
      ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const target = `#messages .reply-stack[data-stack="${ids.root}"]`, toggle = target + ' > .stack-toggle';
    const state = () => p.evaluate(`(s=>s&&{compact:s.dataset.compact,fold:s.dataset.fold,coordination:s.dataset.coordination})(document.querySelector(${JSON.stringify(target)}))`);
    await becomes(state, { compact: 'true', fold: 'head', coordination: 'agents' }, 'an agent-only dossier begins as its header alone');
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(state, { compact: 'false', fold: 'folded', coordination: 'agents' }, 'its chevron opens it to latest plus unread');
    await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
    await p.key('z', 4);
    await becomes(state, { compact: 'true', fold: 'head', coordination: 'agents' }, '⌘Z takes it back to its header alone');
    const human = (await control({ method: 'agent_message', operation_id: topic + '-human', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: [facts.actor], reply_to: ids.reply, body: 'Now this one is yours.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(human))}))`), 'the reply to the person arrives');
    await becomes(state, { compact: 'false', fold: 'folded', coordination: '' }, 'not agents\' alone now, the dossier left at its header shows latest plus unread');
    assert.ok((await look(p, { ...ids, human }, 'root')).rows.includes('human'), 'and the reply to the person shows in it');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'true', 'its chevron says it is open');
    await shot(p, 'stack-head-left-laptop');
    // A dossier between agents that arrives now still begins as its header alone.
    const fresh = (await control({ method: 'agent_message', operation_id: topic + '-fresh', topic_id: topic, source: 'topic', sender: 'aim-core', addressees: ['aim-ux'], body: 'A new check between agents.' })).result.message_id;
    await control({ method: 'agent_message', operation_id: topic + '-fresh-reply', topic_id: topic, source: 'topic', sender: 'aim-ux', addressees: ['aim-core'], reply_to: fresh, body: 'On it.' });
    const freshStack = `#messages .reply-stack[data-stack="${fresh}"]`;
    await becomes(() => p.evaluate(`(s=>s&&{compact:s.dataset.compact,fold:s.dataset.fold})(document.querySelector(${JSON.stringify(freshStack)}))`), { compact: 'true', fold: 'head' },
      'a new agent-only dossier begins as its header alone');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading coordination links reveal hidden work and plain arrows open a dossier from its header to the two states, never back to the header', async () => {
    const topic = 'stack-coordination-links';
    const ids = await seed(topic, [
      ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready.' }],
      ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Internal dossier.' }],
      ['reply', { sender: 'aim-ux', reply_to: 'root', addressees: ['aim-core'], body: 'Internal answer.' }],
      ['single', { sender: 'aim-core', addressees: ['aim-ux'], body: 'Internal standalone.' }],
    ]);
    const link = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `[Reply](${facts.origin}/?topic=${topic}&message=${ids.reply}) and [Standalone](${facts.origin}/?topic=${topic}&message=${ids.single}).` })).result.message_id;
    const p = await open(topic, 'laptop', topic, ids.root);
    await keyTo(p, ids.root);
    for (const [key, want] of [['ArrowRight', 'folded'], ['ArrowRight', 'open'], ['ArrowLeft', 'folded']]) {
      await p.key(key); await becomes(async () => (await look(p, ids, 'root')).fold, want, key + ' chooses ' + want);
    }
    // ← at latest plus unread leaves for the outline, and the dossier stays as it is.
    await p.key('ArrowLeft');
    await until(() => p.evaluate("Boolean(document.activeElement.closest('#outline'))"), 'another ← moves into the outline');
    assert.equal((await look(p, ids, 'root')).fold, 'folded', 'leaving the dossier at latest plus unread, not its header alone');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.reply,
      operation_id: topic + '-saved-fold', args: { folded: true } });
    await until(async () => (await actsOf(topic, ids.reply))?.folded === true, 'the quiet reply has a saved personal fold');
    const filter = '#agent-coordination-show button';
    for (const [id, words] of [[ids.reply, 'Internal answer.'], [ids.single, 'Internal standalone.']]) {
      await centre(p, filter); await p.point(filter);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).getClientRects().length`), 0, 'the target is hidden');
      const anchor = `${card(link)} a.words-link[href*="message=${id}"]`;
      await centre(p, anchor); await p.point(anchor);
      await until(async () => (await readerOn(p))?.startsWith(words), 'the link opens the hidden message in the Reader');
      await closeReader(p, 'laptop');
      assert.equal(await p.evaluate(`document.querySelector('#agent-coordination-show button').getAttribute('aria-pressed')`), 'true', 'the filter says the target is visible again');
      assert.equal((await actsOf(topic, ids.reply)).folded, true, 'revealing hidden work preserves the saved personal fold');
    }
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks fully expanded dossiers keep their own keyboard stop in both directions', async () => {
    const topic = 'stack-open-header-stop';
    const ids = await seed(topic, [
      ['older', { sender: other, join: true, addressees: [facts.actor], body: 'Older dossier' }],
      ['olderReply', { sender: other, reply_to: 'older', addressees: [facts.actor], body: 'Older reply' }],
      ['newer', { sender: other, addressees: [facts.actor], body: 'Newer dossier' }],
      ['newerReply', { sender: other, reply_to: 'newer', addressees: [facts.actor], body: 'Newer reply' }],
    ]);
    const p = await open(topic, 'laptop', topic, ids.newer);
    for (const id of [ids.older, ids.newer]) await press(p, 'laptop', `.reply-stack[data-stack="${id}"] > .stack-toggle`);
    const focused = () => p.evaluate(`(()=>{const at=document.activeElement;return at.matches('.stack-toggle')?'stack:'+at.closest('.reply-stack').dataset.stack:at.closest('[data-id]')?.dataset.id??null})()`);
    await keyTo(p, ids.newerReply);
    await p.key('ArrowDown');
    assert.equal(await focused(), 'stack:' + ids.older, 'Down reaches the neighboring dossier before its original message');
    assert.equal(await p.evaluate("document.querySelector('.message-bar').hidden"), true, 'a dossier has no message toolbar');
    await p.key('ArrowDown'); assert.equal(await focused(), ids.older);
    await p.key('ArrowDown'); assert.equal(await focused(), ids.olderReply);
    for (const expected of [ids.older, 'stack:' + ids.older, ids.newerReply, ids.newer, 'stack:' + ids.newer]) {
      await p.key('ArrowUp'); assert.equal(await focused(), expected, 'Up traverses every message and dossier');
    }
    await p.key('ArrowUp');
    assert.equal(await p.evaluate("Boolean(document.activeElement.closest('.topic-header'))"), true, 'Up from the first dossier reaches the page header');
    await p.key('ArrowDown'); assert.equal(await focused(), 'stack:' + ids.newer);
    await p.key('ArrowDown'); assert.equal(await focused(), ids.newer);
    await shot(p, 'stack-expanded-header-keyboard');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks move the keys from a dossier whose chevron holds the focus without being a stop', async () => {
    const topic = 'stack-chevron-not-a-stop';
    // Eight dossiers, s7 at the top of the page down to s0, each folded to its unread reply.
    const said = [];
    for (let n = 0; n < 8; n++) {
      said.push(['s' + n, { sender: other, ...(n ? {} : { join: true }), addressees: [facts.actor], body: 'Dossier ' + n }]);
      said.push(['s' + n + 'R', { sender: other, reply_to: 's' + n, addressees: [facts.actor], body: 'Reply in dossier ' + n }]);
    }
    const ids = await seed(topic, said);
    const p = await open(topic, 'laptop', topic, ids.s3);
    const toggle = id => `.reply-stack[data-stack="${id}"] > .stack-toggle`;
    const fold = id => p.evaluate(`document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${id}"]`)}).dataset.fold`);
    const focused = () => p.evaluate(`(()=>{const at=document.activeElement;return at.matches('.stack-toggle')?'stack:'+at.closest('.reply-stack').dataset.stack:at.closest('[data-id]')?.dataset.id??null})()`);
    const atPageHeader = () => p.evaluate("Boolean(document.activeElement.closest('.topic-header'))");
    // Whether the dossier sits below the first message in view, so a move that
    // starts over from the top of the window shows as a move from elsewhere.
    const belowFirstInView = id => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${id}"]`)});
      const first=[...document.querySelectorAll('#messages [data-id]')].find(e=>e.getClientRects().length&&e.getBoundingClientRect().bottom>0);return Boolean(first)&&!s.contains(first)})()`);
    // Shift-Tab back onto a dossier's chevron from a message after it, so the
    // message the keys were last on is not the dossier's head.
    const backTo = async id => {
      for (let step = 0; step < 12 && await focused() !== 'stack:' + id; step++) await p.key('Tab', 8);
      assert.equal(await focused(), 'stack:' + id, 'Shift-Tab reaches the chevron of ' + id);
    };
    assert.equal(await fold(ids.s3), 'folded', 'an unread dossier starts folded');
    for (let step = 0; step < 3 && await fold(ids.s3) !== 'open'; step++) { await centre(p, toggle(ids.s3)); await press(p, 'laptop', toggle(ids.s3)); }
    assert.equal(await fold(ids.s3), 'open');
    await centre(p, toggle(ids.s3));
    await keyTo(p, ids.s4R);
    await p.key('ArrowDown');
    assert.equal(await focused(), 'stack:' + ids.s3, 'Down from the dossier above reaches the expanded header');
    // Space on the expanded header folds the dossier to latest plus unread (Return there edits its title, item 385);
    // its chevron keeps the focus but is no longer a stop, and stands for the dossier's compact header.
    await p.key(' ');
    await becomes(() => fold(ids.s3), 'folded', 'Space on the expanded header folds the dossier to latest plus unread');
    assert.equal(await focused(), 'stack:' + ids.s3, 'the folding chevron keeps the focus');
    assert.equal(await belowFirstInView(ids.s3), true, 'the dossier is not the first in view');
    await p.key('ArrowDown');
    assert.equal(await focused(), ids.s3R, 'Down from a folded chevron reaches its dossier\'s shown reply');
    await backTo(ids.s3);
    await p.key('ArrowUp');
    assert.equal(await focused(), ids.s4R, 'Up from a folded chevron reaches the last message of the dossier above');
    // Tab back onto the folded dossier's chevron, the keys move on the same way.
    await centre(p, toggle(ids.s3));
    await keyTo(p, ids.s3R); await backTo(ids.s3);
    assert.equal(await belowFirstInView(ids.s3), true, 'the folded dossier is not the first in view');
    await p.key('ArrowDown');
    assert.equal(await focused(), ids.s3R, 'Down from a folded chevron reached by Tab reaches its dossier\'s shown reply');
    // Space on the first dossier's expanded header, then Up, reaches the page header.
    for (let step = 0; step < 3 && await fold(ids.s7) !== 'open'; step++) { await centre(p, toggle(ids.s7)); await press(p, 'laptop', toggle(ids.s7)); }
    assert.equal(await fold(ids.s7), 'open');
    await keyTo(p, ids.s7);
    await p.key('ArrowUp');
    assert.equal(await focused(), 'stack:' + ids.s7, 'Up from the first original message reaches its expanded header');
    await p.key(' ');
    await becomes(() => fold(ids.s7), 'folded', 'Space on the expanded header folds the first dossier');
    assert.equal(await focused(), 'stack:' + ids.s7, 'the folding chevron keeps the focus');
    await p.key('ArrowUp');
    assert.equal(await atPageHeader(), true, 'Up from the first dossier\'s folded chevron reaches the page header');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks below More persists across devices and only another persons new reply brings it back', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-aside-' + device;
      const ids = await seed(topic, [['root', { sender: other, join:true, addressees:[facts.actor], body:'Put this dossier aside.' }],
        ['one', { sender:other, reply_to:'root', addressees:[facts.actor], body:'An older unread reply.' }],
        ['two', { sender:other, reply_to:'one', addressees:[facts.actor], body:'The newest reply.' }]]);
      const p = await open('stack-aside-' + device, device, topic, ids.root);
      const section = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const below = async () => (await view('stack_positions', {topic_id:topic,message_ids:[ids.root]})).items[0].stack_position.below;
      const visible = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
      await menuOf(p, device, ids.two);
      if (device === 'phone') await choose(p, device, 'Move or join…');
      await choose(p, device, 'Move below More');
      await until(below, 'Core kept the move');
      await becomes(visible, false, 'the dossier disappears below More');
      assert.equal((await actsOf(topic, ids.root, other))?.aside ?? null, null, 'the other reader has no move');
      assert.equal(await p.evaluate(`Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`), true, 'More exists with no older page');
      if (device === 'laptop') {
        await p.key('z', 4);
        await until(async () => !await below(), 'Command-Z undoes the whole-dossier move');
        await becomes(visible, true, 'Undo brings it back');
        await menuOf(p, device, ids.two); await choose(p, device, 'Move below More');
        await until(below, 'moved aside again');
      }
      await shot(p, 'stack-aside-' + device);
      const otherTab = await open('stack-aside-reload-' + device, device, topic, ids.root);
      await until(() => otherTab.evaluate(`Boolean(document.querySelector('#messages .stack-more'))`), 'another document reads More from Core');
      assert.equal(await otherTab.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`), false, 'the dossier remains put aside on another device');
      await otherTab.close(); await p.send('Page.bringToFront');
      const own = (await control({method:'agent_message',operation_id:topic+'-own',topic_id:topic,source:'topic',sender:facts.actor,reply_to:ids.two,body:'My reply does not revive it.'})).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(own))}))`), 'the own reply reaches the loaded page');
      assert.equal(await below(), true); assert.equal(await visible(), false);
      await press(p, device, '#messages .stack-more');
      await becomes(visible, true, 'More opens its dossiers');
      await menuOf(p, device, own); if (device === 'phone') await choose(p, device, 'Move or join…');
      await choose(p, device, 'Bring back above More');
      await until(async () => !await below(), 'Bring back clears the personal move');
      await menuOf(p, device, own); if (device === 'phone') await choose(p, device, 'Move or join…');
      await choose(p, device, 'Move below More'); await until(below, 'put aside before someone answers');
      // More was explicitly opened; close it again without changing the durable act.
      if (await p.evaluate(`document.querySelector('.stack-more')?.getAttribute('aria-expanded')==='true'`)) await press(p, device, '.stack-more');
      const answer = (await control({method:'agent_message',operation_id:topic+'-answer',topic_id:topic,source:'topic',sender:other,reply_to:own,addressees:[facts.actor],body:'Here is the new answer.'})).result.message_id;
      await until(async () => !await below(), 'another persons new reply brings it back in Core');
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(answer))})?.getClientRects().length)`), 'the live page brings the dossier back with the answer');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks below More handles an unloaded root and an exact link without clearing the saved choice', async () => {
    const topic='stack-aside-partial';
    const ids=await seed(topic,[['root',{sender:other,join:true,addressees:[facts.actor],body:'The old dossier root.',read:true}],
      ...Array.from({length:35},(_,i)=>['r'+i,{sender:other,reply_to:i?'r'+(i-1):'root',addressees:[facts.actor],body:'Reply '+i,read:true}])]);
    const p=await open(topic,'laptop',topic,ids.r34);
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.root))}))`),false,'the canonical root is outside the loaded page');
    const position=async()=>(await view('stack_positions',{topic_id:topic,message_ids:[ids.root]})).items[0].stack_position;
    const below=async()=>(await position()).below;
    // Command-Z at once, while the move may still be on its way to Core: the undo follows the
    // move's own answer, though the page holds no message for the root it acts on.
    await menuOf(p,'laptop',ids.r34); await choose(p,'laptop','Move below More');
    await p.key('z',4);
    await until(async()=>(await position()).aside_revision===2,'Command-Z right after the move reaches Core as a second act');
    assert.equal(await below(),false,'the undo brought the dossier back');
    await becomes(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.r34))})?.getClientRects().length)`),true,'the loaded fragment shows again');
    await menuOf(p,'laptop',ids.r34); await choose(p,'laptop','Move below More');
    await until(below,'the unloaded canonical root holds the move');
    await becomes(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.r34))})?.getClientRects().length)`),false,'the loaded fragment is hidden too');
    const linking=(await control({method:'agent_message',operation_id:topic+'-link',topic_id:topic,source:'topic',sender:other,addressees:[facts.actor],
      body:`See ${facts.origin}/?topic=${topic}&message=${ids.r0} for the older message. Latest: ${facts.origin}/?topic=${topic}&message=${ids.r34}`,read:true})).result.message_id;
    await until(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(linking)+' a.words-link')}))`),'the separate linking message arrives');
    await centre(p,card(linking)+' a.words-link'); await p.point(card(linking)+' a.words-link');
    await until(async()=>(await readerOn(p))?.startsWith('Reply 0'),'the exact unloaded target opens in the Reader');
    assert.equal(await below(),true,'following a link clears no durable choice');
    await closeReader(p,'laptop');
    const latestLink=card(linking)+' a.words-link[href*="message='+ids.r34+'"]';
    await centre(p,latestLink); await p.point(latestLink);
    await until(async()=>(await readerOn(p))?.startsWith('Reply 34'),'the loaded exact target opens too');
    await closeReader(p,'laptop');
    await becomes(()=>p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.r34))})?.getClientRects().length)`),true,'the loaded linked message is revealed on the page');
    const q=await open(topic+'-again','laptop',topic,ids.r34);
    await becomes(()=>q.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.r34))})?.getClientRects().length)`),false,'a new visit still has the dossier below More');
    assert.equal(await below(),true); assert.deepEqual(p.errors,[]); assert.deepEqual(q.errors,[]);
    await q.close(); await p.close();
  });

  // Item 378: the Reader's archive button beside the star is ⋯'s Move below More for the message's whole dossier,
  // labelled with how many of the stack's messages go with it, and Bring back once they are there, pressed. Pressed
  // as a person presses it, on a laptop and by a finger at 320, 375 and 390, in light and dark; what Core holds is
  // read for the person and for another reader, and a message of another stack stays where it is.
  await check('reading stacks the Reader\'s archive button moves the message\'s whole dossier below More, says how many messages go, and brings it back pressed', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-archive-' + device;
      const ids = await seed(topic, [['lone', { sender: other, join: true, addressees: [facts.actor], body: 'A message of its own stays where it is.' }],
        ['root', { sender: other, addressees: [facts.actor], body: 'File this dossier out of sight.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An earlier reply in the dossier.' }],
        ['two', { sender: other, reply_to: 'one', addressees: [facts.actor], body: 'The newest reply in the dossier.' }]]);
      const p = await open('stack-archive-' + device, device, topic, ids.root);
      const section = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const position = async id => (await view('stack_positions', { topic_id: topic, message_ids: [id] })).items[0].stack_position;
      const shown = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
      // The button as it shows: its name, tooltip, count and whether it is pressed; where it sits; its size; and
      // whether any control of the Reader's header covers another (a phone's header has the least room).
      const button = () => p.evaluate(`(()=>{const b=document.querySelector('#reader-aside'),r=b.getBoundingClientRect(),star=document.querySelector('#reader-star');
        const els=[...document.querySelectorAll('#reader .reader-header button, #reader .reader-header h2')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().width>=1);
        // What shows of each: a title's button is clipped by its heading, which cuts it off with an ellipsis.
        const seen=e=>{const r=e.getBoundingClientRect(),h=e.parentElement.closest('#reader .reader-header h2');if(!h)return r;const c=h.getBoundingClientRect();return {left:Math.max(r.left,c.left),right:Math.min(r.right,c.right),top:Math.max(r.top,c.top),bottom:Math.min(r.bottom,c.bottom)}};
        const over=[];for(const e of els)for(const f of els){const x=seen(e),y=seen(f);if(els.indexOf(e)<els.indexOf(f)&&!e.contains(f)&&!f.contains(e)&&!(x.right<=y.left+0.5||y.right<=x.left+0.5||x.bottom<=y.top+0.5||y.bottom<=x.top+0.5))over.push((e.id||e.className||e.tagName)+'/'+(f.id||f.className||f.tagName));}
        const header=document.querySelector('#reader .reader-header').getBoundingClientRect();
        return {header:Math.round(header.height),shown:b.getClientRects().length>0,name:b.getAttribute('aria-label'),title:b.title,count:b.querySelector('.aside-count').textContent,pressed:b.getAttribute('aria-pressed'),
          glyph:Boolean(b.querySelector('svg')),besideStar:b.previousElementSibling===star,size:[Math.round(r.width),Math.round(r.height)],over,inside:r.left>=header.left-0.5&&r.right<=header.right+0.5,
          sideways:document.documentElement.scrollWidth>innerWidth}})()`);
      await openReader(p, device, ids.two, 'The newest reply');
      const widths = device === 'phone' ? [320, 375, 390] : [1280];
      const sized = async width => { if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width }); };
      for (const width of widths) {
        await sized(width);
        await until(async () => (await button()).shown, `${device} ${width}: the archive button shows beside the star`);
        const at = await button();
        assert.deepEqual([at.name, at.title, at.count, at.pressed, at.glyph, at.besideStar], ['Move below More: 3 messages', 'Move below More: 3 messages', '3', 'false', true, true],
          `${device} ${width}: an archive glyph named Move below More, with the stack's 3 messages: ${JSON.stringify(at)}`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-archive-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
        if (device === 'phone') assert.ok(at.size[0] >= 44 && at.size[1] >= 44, `${width}: 44px under a finger: ${at.size}`);
        assert.deepEqual([at.over, at.inside, at.sideways], [[], true, false], `${device} ${width}: no control of the header covers another, and nothing scrolls sideways: ${JSON.stringify(at)}`);
        assert.ok(at.header < 100, `${device} ${width}: the Reader's header is not stretched: ${at.header}px`);
      }
      await press(p, device, '#reader-aside');
      await until(async () => (await position(ids.root)).below, `${device}: Core holds the dossier below More`);
      await becomes(shown, false, `${device}: the whole dossier goes below a closed More`);
      assert.equal((await actsOf(topic, ids.root, other))?.aside ?? null, null, `${device}: the other reader has no move`);
      assert.equal((await position(ids.lone)).below, false, `${device}: a message of another stack stays above More`);
      assert.equal(await p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids.lone}"]')?.getClientRects().length)`), true, `${device}: and stays on the page`);
      await until(async () => (await button()).pressed === 'true', `${device}: the button is pressed once the dossier is below More`);
      const moved = await button();
      assert.deepEqual([moved.name, moved.title, moved.count, await readerOn(p).then(text => text?.startsWith('The newest reply'))],
        ['Bring back above More: 3 messages', 'Bring back above More: 3 messages', '3', true], `${device}: it offers Bring back, and the Reader stays on the message: ${JSON.stringify(moved)}`);
      // The focus stays in the Reader (on the button where a press focuses it, as Chrome's does), never on More.
      assert.equal(await p.evaluate(`Boolean(document.activeElement?.closest('#reader')) && !document.activeElement.closest('#messages')`), true, `${device}: the focus stays in the Reader`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-archive-${device}-pressed-${theme}`); }
      await dossierTheme(p, 'light');
      await press(p, device, '#reader-aside');
      await until(async () => !(await position(ids.root)).below, `${device}: Bring back clears the move in Core`);
      await until(async () => (await button()).pressed === 'false', `${device}: the button is no longer pressed`);
      await closeReader(p, device);
      await becomes(shown, true, `${device}: the dossier is back above More`);
      // A message of its own is a stack of one: one message moves.
      await openReader(p, device, ids.lone, 'A message of its own');
      await until(async () => (await button()).name === 'Move below More: 1 message', `${device}: a message of its own moves alone`);
      assert.equal((await button()).count, '1');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 561: the Reader's title, beside its archive button, names the dossier a reply there is written into: its name,
  // typed or minted, as the dossier's tab shows it. A dossier nobody has named yet shows its first line, as its tab
  // does, and a name given while the Reader is open shows at once. A long name stays on one line, cut off with an
  // ellipsis, and the archive button (right of the title) and ✕ stay within the header's width: on a laptop and by a finger at 320, 375 and 390, in light
  // and dark. A press on the title still goes back to the topic.
  const titleOf = p => p.evaluate(`(()=>{const h=document.querySelector('#reader-title'),b=h.querySelector('.reader-topic'),header=document.querySelector('#reader .reader-header').getBoundingClientRect(),
    box=id=>document.getElementById(id).getBoundingClientRect(),inside=r=>r.width>0&&r.left>=header.left-0.5&&r.right<=header.right+0.5;
    const range=document.createRange();range.selectNodeContents(b??h);const lines=new Set([...range.getClientRects()].filter(r=>r.width>0).map(r=>Math.round(r.top))).size;
    const cut=[b,h].some(e=>e&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).textOverflow==='ellipsis'),title=h.getBoundingClientRect(),aside=box('reader-aside'),close=box('reader-close');
    return {text:h.textContent,button:Boolean(b),lines,cut,aside:inside(aside)&&aside.left>=title.right-0.5,close:inside(close),sideways:document.documentElement.scrollWidth>innerWidth}})()`);
  await check('reading stacks the Reader\'s title names the dossier its reply goes into, its first line until it is named, on one line however long', async () => {
    const ROOT = 'Where shall we stay for the cabin week?\nThe lake or the hills, either is fine.';
    const LONG = 'The cabin week plan, with every booking, the lake, the long drive up and who brings the food for all seven days';
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-title-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Shall we book the lake cabin for the week?' }],
        ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The lake cabin is free that week.' }],
        ['plain', { sender: other, addressees: [facts.actor], body: ROOT }],
        ['answer', { sender: other, reply_to: 'plain', addressees: [facts.actor], body: 'The hills, for the walks.' }]]);
      await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-name`, args: { name: 'Cabin week plan' } });
      const p = await open(topic, device, topic, ids.answer);
      await openReader(p, device, ids.reply, 'The lake cabin');
      await becomes(async () => { const t = await titleOf(p); return [t.text, t.button]; }, ['Cabin week plan', true], `${device}: a reply in a named dossier is titled by the dossier's name`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-title-named-${device}-${theme}`); }
      await dossierTheme(p, 'light');
      await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-long`, args: { name: LONG } });
      await becomes(async () => (await titleOf(p)).text, LONG, `${device}: renamed while the Reader is open, the title follows`);
      for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme);
          const at = await titleOf(p);
          assert.deepEqual([at.text, at.lines, at.cut, at.aside, at.close, at.sideways], [LONG, 1, true, true, true, false],
            `${device} ${width} ${theme}: the long name stays on one line, cut off with an ellipsis, the archive button and ✕ in the header: ${JSON.stringify(at)}`);
          await shot(p, `stack-title-long-${device}-${width}-${theme}`);
        }
        await dossierTheme(p, 'light');
      }
      if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
      await press(p, device, '#reader-title .reader-topic');
      await until(async () => await readerOn(p) === null, `${device}: a press on the title goes back to the topic`);
      await openReader(p, device, ids.answer, 'The hills');
      await becomes(async () => { const t = await titleOf(p); return [t.text, t.button]; }, [messagePreview({ body: ROOT }), true], `${device}: a dossier nobody named is titled by its first line, as its tab is`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  // Item 561's other side: a message of the topic's own, in no dossier (nobody replied to it, nobody named it), keeps
  // the topic's name as the Reader's title, a new one arriving while the page is open as well.
  await check('reading stacks the Reader\'s title is the topic\'s name for a new topic-level message, in no dossier', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-title-topic-' + device;
      const ids = await seed(topic, [['first', { sender: other, join: true, addressees: [facts.actor], body: 'A message of the topic, answered by nobody.' }]]);
      const p = await open(topic, device, topic, ids.first);
      const fresh = (await control({ method: 'agent_message', operation_id: `${topic}-new`, topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor], body: 'A new message at the topic level.' })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(fresh))}))`), `${device}: the new message arrives`);
      await openReader(p, device, fresh, 'A new message at the topic level');
      await becomes(async () => { const t = await titleOf(p); return [t.text, t.button, t.lines]; }, ['Reading ' + topic, true, 1], `${device}: its title is the topic's name`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-title-topic-${device}-${theme}`); }
      await dossierTheme(p, 'light');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 378, the count where Core's dossier is drawn as more than one stack: its first message is older than the page
  // loaded, and two of its replies on the page are two stacks. The button moves the whole dossier, both stacks, so its
  // count names both stacks' messages; a message of another dossier stays where it is.
  await check('reading stacks the Reader\'s archive button counts every message that moves with the dossier, where the page draws it as two stacks, its first message not loaded', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-archive-split-' + device;
      const said = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'An old question everyone answers.', read: true }]];
      for (let n = 0; n < 30; n++) said.push(['f' + n, { sender: other, addressees: [facts.actor], body: `Filler ${n}, a message of its own.`, read: true }]);
      said.push(['a', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'First answer to the old question.' }]);
      said.push(['b', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Second answer to the old question.' }]);
      const ids = await seed(topic, said);
      const p = await open(topic, device, topic, ids.b);
      const shownId = id => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${id}"]')?.getClientRects().length)`);
      const drawn = () => p.evaluate(`[${JSON.stringify(ids.a)},${JSON.stringify(ids.b)},${JSON.stringify(ids.f29)}].map(id=>Boolean(document.querySelector('#messages [data-id="'+id+'"]')?.getClientRects().length))`);
      await becomes(drawn, [true, true, true], `${device}: both answers and the newest filler are drawn`);
      // The page as this case needs it: the dossier's first message not loaded, and its two answers in two stacks.
      assert.deepEqual(await p.evaluate(`(()=>{const own=id=>document.querySelector('#messages [data-id="'+id+'"]'),stackOf=id=>own(id).closest('.reply-stack')?.dataset.stack??id;
        return {root:Boolean(own(${JSON.stringify(ids.root)})),apart:stackOf(${JSON.stringify(ids.a)})!==stackOf(${JSON.stringify(ids.b)})}})()`), { root: false, apart: true },
        `${device}: the old question is not loaded, and its two answers are two stacks`);
      const button = () => p.evaluate(`(b=>({shown:b.getClientRects().length>0,name:b.getAttribute('aria-label'),title:b.title,count:b.querySelector('.aside-count').textContent,pressed:b.getAttribute('aria-pressed')}))(document.querySelector('#reader-aside'))`);
      await openReader(p, device, ids.b, 'Second answer');
      for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
        await becomes(button, { shown: true, name: 'Move below More: 2 messages', title: 'Move below More: 2 messages', count: '2', pressed: 'false' },
          `${device} ${width}: the button names both answers, the two messages that move`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-archive-split-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
      }
      await press(p, device, '#reader-aside');
      await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, `${device}: Core holds the dossier below More`);
      await becomes(button, { shown: true, name: 'Bring back above More: 2 messages', title: 'Bring back above More: 2 messages', count: '2', pressed: 'true' }, `${device}: pressed, it brings back the same 2`);
      await closeReader(p, device);
      await becomes(drawn, [false, false, true], `${device}: both answers went below More, as the count said, and the filler stays`);
      assert.equal((await view('stack_positions', { topic_id: topic, message_ids: [ids.f29] })).items[0].stack_position.below, false, `${device}: Core moved no other dossier`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 378, where the button never shows: the Reader on a message the page's stacks do not hold, which ⋯ offers no
  // move either. Each such state on a laptop and at 320, 375 and 390 by a finger, beside the message it does show for.
  // With the button hidden, a phone's header keeps one row: the title row beside ✕, not on a row of its own under it.
  const asideButton = p => p.evaluate(`(b=>{const t=document.querySelector('#reader .reader-title-row').getBoundingClientRect(),x=document.querySelector('#reader-close').getBoundingClientRect();
    return {hidden:b.hidden,shown:b.getClientRects().length>0,name:b.getAttribute('aria-label'),oneRow:t.top<x.bottom-4}})(document.querySelector('#reader-aside'))`);
  const noAsideAtEachWidth = async (p, device, said) => {
    for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
      if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
      await becomes(async () => { const b = await asideButton(p); return [b.hidden, b.shown, b.oneRow]; }, [true, false, true], `${device} ${width}: no archive button for ${said}, and the header keeps one row`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-archive-none-${said.replace(/\W+/g, '-')}-${device}-${width}-${theme}`); }
      await dossierTheme(p, 'light');
    }
    if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
  };
  await check('reading stacks the Reader\'s archive button shows for no message of the topic opened alone from its link, and shows for one the page\'s stacks hold', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-archive-alone-' + device;
      const ids = await seed(topic, Array.from({ length: 36 }, (_, n) => ['m' + n, { sender: other, ...(n ? {} : { join: true }), addressees: [facts.actor], body: `Message ${n}, of a long topic.`, read: true }]));
      const p = await open(topic, device, `${topic}&message=${ids.m0}`, ids.m35);
      await until(async () => (await readerOn(p))?.startsWith('Message 0,'), `${device}: the link opens the oldest message in the Reader`);
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.m0))}))`), false, `${device}: the page has not loaded its card: it opened alone`);
      await until(() => p.evaluate(`Boolean(document.querySelector('#reader-star').getClientRects().length)`), `${device}: its star shows, its acts read`);
      await noAsideAtEachWidth(p, device, 'a message opened alone');
      await closeReader(p, device);
      await openReader(p, device, ids.m35, 'Message 35,');
      await becomes(async () => { const b = await asideButton(p); return [b.shown, b.name]; }, [true, 'Move below More: 1 message'], `${device}: a message the stacks hold has the button`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  await check('reading stacks the Reader\'s archive button goes when the Reader moves from a message the stacks hold to another topic\'s message, from its About link', async () => {
    for (const device of Object.keys(DEVICES)) {
      const name = 'stack-archive-about-' + device;
      const ids = await seed(name, [['other', { sender: 'aim-ux', join: true, body: 'Here to read the message.' }],
        ['elsewhere', { sender: 'aim-core', join: true, body: 'A message in another topic, read by another reader.' }]]);
      await control({ method: 'navigation_workspaces', workspaces: [{ id: name, title: name, team: ['fable'], coordinator: 'fable' }] });
      const topic = (await view('conversation', { workspace_id: name })).conversation.topic_id;
      const reply = (await control({ method: 'agent_message', operation_id: name + '-about', topic_id: topic, sender: 'person', reply_to: ids.elsewhere, body: 'About the message elsewhere.' })).result.message_id;
      const p = await open(name, device, topic, reply, '', '/?conversation=' + name);
      await openReader(p, device, reply, 'About the message elsewhere');
      await becomes(async () => (await asideButton(p)).shown, true, `${device}: the reply the stacks hold has the button`);
      await closeReader(p, device);
      const about = card(reply) + ' .about-line .item-link';
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(about)}))`), `${device}: the reply's About line links to the message`);
      await centre(p, about);
      if (device === 'laptop') await p.point(about);
      else {
        // As on any card, a phone's first tap lights the reply (the Reader closing lit it already); the next follows the link.
        if (!(await lit(p)).includes(reply)) { await tap(p, about, 'first'); await until(async () => (await lit(p)).includes(reply), `${device}: the first tap lights the reply`); }
        await tap(p, about, 'first');
      }
      await until(async () => (await readerOn(p))?.startsWith('A message in another topic'), `${device}: the About link opens the Reader on the message`);
      await noAsideAtEachWidth(p, device, 'another topic\'s message');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  await check('reading stacks the Reader\'s archive button shows for no Notebook page in the Reader, and shows for a message of the topic', async () => {
    const page = (await control({ method: 'seed', memory_items: 1 })).item_ids[0];
    for (const device of Object.keys(DEVICES)) {
      const message = (await control({ method: 'agent_message', operation_id: 'stack-archive-page-' + device, topic_id: 't1', addressees: [facts.actor], body: `A message beside the Notebook page, on a ${device}.` })).result.message_id;
      const p = await open('stack-archive-page-' + device, device, 't1', message, '', `/?topic=t1&page=${page}&revision=1`);
      await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#reader-title').textContent !== 'Message' && document.querySelector('#source-body').textContent.length > 0`), `${device}: the Reader shows the Notebook page`);
      await noAsideAtEachWidth(p, device, 'a Notebook page');
      await closeReader(p, device);
      await openReader(p, device, message, 'A message beside the Notebook page');
      // t1's own messages may join a stack of the fixture's: how many go is the counting cases' business.
      await becomes(async () => { const b = await asideButton(p); return [b.shown, /^Move below More: \d+ messages?$/.test(b.name)]; }, [true, true], `${device}: a message the stacks hold has the button`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A message whose dossier Core has not placed: every position taken out of what the page reads, as Core would send
  // a message with none. ⋯ offers no move for it, and the button does not show.
  const UNPLACED = `(()=>{const own=window.fetch;window.fetch=async function(input,init){const answer=await own.call(this,input,init);
    if(!String(input?.url??input).endsWith('/api/view'))return answer;
    const text=await answer.text(),drop=v=>{if(Array.isArray(v))v.forEach(drop);else if(v&&typeof v==='object'){delete v.stack_position;Object.values(v).forEach(drop);}return v;};
    let body=text;try{body=JSON.stringify(drop(JSON.parse(text)));}catch{}
    return new Response(body,{status:answer.status,statusText:answer.statusText,headers:answer.headers});};})()`;
  await check('reading stacks the Reader\'s archive button shows for no message whose dossier Core has not placed', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-archive-unplaced-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A dossier Core has not placed.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Its only reply.' }]]);
      const p = await open(topic, device, topic, ids.root, UNPLACED);
      await openReader(p, device, ids.one, 'Its only reply');
      await until(() => p.evaluate(`Boolean(document.querySelector('#reader-star').getClientRects().length)`), `${device}: its star shows, its acts read`);
      await noAsideAtEachWidth(p, device, 'a message Core has not placed');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 378, the button's busy and refused states: pressed, it shows the move at once while Core has it (busy), and
  // a refusal puts it back unpressed, saying so, with the dossier above More again and nothing moved in Core. On a
  // laptop and at 320, 375 and 390 by a finger. Chrome holds Core's answer; Safari's harness cannot.
  if (engine === 'chrome') await check('reading stacks the Reader\'s archive button shows the move at once while Core has it, and a refusal puts it back unpressed, the dossier above More', async () => {
    for (const device of Object.keys(DEVICES)) for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
      const topic = `stack-archive-refused-${device}-${width}`;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A dossier whose move is refused.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Its only reply.' }]]);
      const p = await open(topic, device, topic, ids.root);
      if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
      const section = `#messages .reply-stack[data-stack="${ids.root}"]`;
      const shown = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
      const button = () => p.evaluate(`(b=>({shown:b.getClientRects().length>0,name:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),count:b.querySelector('.aside-count').textContent}))(document.querySelector('#reader-aside'))`);
      await openReader(p, device, ids.one, 'Its only reply');
      await until(async () => (await button()).shown, `${device} ${width}: the archive button shows`);
      await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }] });
      const asideSent = payload => payload?.kind === 'stack.aside';
      p.intercept(asideSent);
      await press(p, device, '#reader-aside');
      const held = await until(() => p.held.find(entry => asideSent(entry.payload)), `${device} ${width}: the move is on its way to Core`);
      // Busy: Core has not answered, and the button and the page already show the move.
      assert.deepEqual(await button(), { shown: true, name: 'Bring back above More: 2 messages', pressed: 'true', count: '2' }, `${device} ${width}: while Core has it, the button shows the move, pressed`);
      assert.equal(await shown(), false, `${device} ${width}: and the dossier is below More`);
      await shot(p, `stack-archive-busy-${device}-${width}`);
      p.held.splice(p.held.indexOf(held), 1);
      p.intercept(null);
      await p.send('Fetch.fulfillRequest', { requestId: held.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
      // Refused: back as it was, unpressed, and the page says why.
      await until(async () => (await button()).pressed === 'false', `${device} ${width}: refused, the button is no longer pressed`);
      assert.deepEqual(await button(), { shown: true, name: 'Move below More: 2 messages', pressed: 'false', count: '2' }, `${device} ${width}: it offers the move again`);
      await until(() => p.evaluate(`document.getElementById('app-status').textContent.includes('Refused for this check.')`), `${device} ${width}: the refusal is said`);
      assert.equal((await view('stack_positions', { topic_id: topic, message_ids: [ids.root] })).items[0].stack_position.below, false, `${device} ${width}: Core moved nothing`);
      assert.equal(await p.evaluate(`document.documentElement.scrollWidth > innerWidth`), false, `${device} ${width}: nothing scrolls sideways`);
      await shot(p, `stack-archive-refused-${device}-${width}`);
      await closeReader(p, device);
      await becomes(shown, true, `${device} ${width}: the dossier is above More`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  else observations.push({ name: 'the Reader\'s archive button refused', engine, held: 'holds Core\'s answers with the Chrome harness\'s request interception, which Safari\'s harness does not offer' });

  // Item 465: the page's New message composer at rest sits between the last dossier above More and the More line,
  // drawn in the feed, never among the dossiers put aside nor after the Notebook. Up over the page (✎) it is not
  // moved while another device moves a dossier across More, so the writing keeps its cursor; put back, it takes
  // its place again. On a laptop and at 320, 375 and 390 by a finger, light and dark.
  await check('reading stacks the New message composer rests between the last dossier above More and the More line, and is not moved while it is up', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-composer-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The oldest dossier.' }],
        ['b', { sender: other, addressees: [facts.actor], body: 'The dossier put aside.' }],
        ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply in the dossier put aside.' }],
        ['c', { sender: other, addressees: [facts.actor], body: 'The newest dossier.' }]]);
      const p = await open(topic, device, topic, ids.c);
      const newest = async () => (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      const aside = async (through, n) => control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.b, operation_id: `${topic}-aside-${n}`, args: { through } });
      // What the feed shows, in its order: each dossier or message by its seed name, More, and the composer; and
      // whether each sits wholly below the one before it, the composer included.
      const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
      const shown = () => p.evaluate(`(()=>{const names=${JSON.stringify(names)},list=document.querySelector('#messages'),sheet=document.querySelector('#new-message-sheet');
        // The seeded dossiers and messages, More and the composer; a line, or the fixture's notice of who joined, is not one.
        const rows=[...list.children].filter(e=>e===sheet||e.getClientRects().length&&(e.classList.contains('stack-more')||names[e.dataset.id??e.dataset.stack]));
        const order=rows.map(e=>e===sheet?'composer':e.classList.contains('stack-more')?'More':names[e.dataset.id??e.dataset.stack]);
        const boxes=rows.map(e=>e.getBoundingClientRect()),stacked=boxes.every((b,i)=>!i||b.top>=boxes[i-1].bottom-0.5);
        const notebook=document.querySelector('#notebook').getBoundingClientRect();
        return {order,stacked,inFeed:sheet.parentElement===list,beforeNotebook:sheet.getBoundingClientRect().bottom<=notebook.top+0.5,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
      await becomes(async () => (await shown()).order, ['c', 'b', 'a', 'composer'], `${device}: with nothing below More, the composer rests under the last dossier`);
      assert.deepEqual(await shown().then(s => [s.stacked, s.inFeed, s.beforeNotebook]), [true, true, true], `${device}: drawn in the feed, below the last dossier and above the Notebook`);
      await aside(await newest(), 1);
      await becomes(async () => (await shown()).order, ['c', 'a', 'composer', 'More'], `${device}: with a dossier below More, the composer sits between the last dossier above More and the More line`);
      assert.equal((await shown()).stacked, true, `${device}: each wholly below the one before it`);
      for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
        await centre(p, '#new-message-sheet');
        assert.equal((await shown()).sideways, false, `${device} ${width}: nothing scrolls sideways`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-composer-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
      }
      await press(p, device, '#messages .stack-more');
      await becomes(async () => (await shown()).order, ['c', 'a', 'composer', 'More', 'b'], `${device}: with More open, the composer stays above the More line, not among the dossiers put aside`);
      await press(p, device, '#messages .stack-more');
      // Another device brings the dossier back: More goes, and the composer is under the last dossier again.
      await aside(null, 2);
      await becomes(async () => (await shown()).order, ['c', 'b', 'a', 'composer'], `${device}: brought back, the composer rests under the last dossier, More gone`);
      // ✎ puts the composer up over the page. Another device puts the dossier aside again while it is up, which would
      // carry the composer's place past it.
      await p.evaluate('scrollTo(0, 0)');
      await press(p, device, '#new-message');
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').matches(':modal') && document.activeElement?.id === 'inline-writing-body'`), `${device}: ✎ puts the composer up, ready to type`);
      await p.send('Input.insertText', { text: 'Writing while the feed changes.' });
      await aside(await newest(), 3);
      await until(() => p.evaluate(`!document.querySelector('#messages .reply-stack[data-stack="${ids.b}"]')?.getClientRects().length && Boolean(document.querySelector('#messages .stack-more'))`), `${device}: the dossier goes below More behind the sheet`);
      assert.deepEqual(await p.evaluate(`[document.querySelector('#new-message-sheet').matches(':modal'), document.activeElement?.id, document.querySelector('#inline-writing-body').value, document.querySelector('#inline-writing-body').selectionStart]`),
        [true, 'inline-writing-body', 'Writing while the feed changes.', 'Writing while the feed changes.'.length], `${device}: the sheet stays up and the writing keeps its cursor`);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('#new-message-sheet').open`), `${device}: Escape puts the composer back`);
      await becomes(async () => (await shown()).order, ['c', 'a', 'composer', 'More'], `${device}: put back, it takes its place between the last dossier above More and the More line`);
      assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Writing while the feed changes.', `${device}: with the writing kept`);
      if (device === 'laptop') {
        // Among the messages, the composer keeps its own keys as it did at the page's end (the feed's keys pass over
        // what is in a dialog, pane-keys.mjs): ← and → on its + do not take the focus out of it.
        await p.evaluate(`document.querySelector('#inline-plus-button').focus()`);
        assert.equal(await p.evaluate(`document.activeElement?.id === 'inline-plus-button' && Boolean(document.activeElement.getClientRects().length)`), true, 'the resting composer\'s + has the focus');
        for (const key of ['ArrowRight', 'ArrowLeft']) {
          await p.key(key);
          assert.equal(await p.evaluate(`Boolean(document.activeElement?.closest('.composer-home'))`), true, `${key} on the resting composer's + leaves the focus in the composer`);
        }
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 465, the composer popped up: at rest it sits among the dossiers, and up over the page it leaves that place,
  // which a holder of its height keeps (sheet-holder.mjs), so nothing behind the backdrop moves, whichever engine draws
  // it (Chrome's scroll anchoring would hide a moved feed where Safari's engine shows it). By ✎ with the page at its top
  // and by ⌘Return with a dossier below the composer near the window's top, on a laptop, and by a finger's ✎ at 390:
  // every dossier and More stay where they were while it is up, and put back each is where it was, with the list no
  // taller than before, nothing left holding a place. What gives the place back is the sheet's own open state, read by
  // one rule (aim.css, .sheet-holder): so the composer is where it rested in the very task its close() runs in, before
  // the close event is heard, read in that task, with no listener between.
  await check('reading stacks the New message composer popped up by ✎ or ⌘Return leaves every dossier behind it where it was, and put back each is where it was', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-composer-still-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The oldest dossier.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'The dossier put aside.', read: true }],
        ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply in the dossier put aside.', read: true }],
        ['c', { sender: other, addressees: [facts.actor], body: 'The newest dossier.', read: true }]]);
      const newest = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.b, operation_id: `${topic}-aside`, args: { through: newest } });
      const p = await open(topic, device, topic, ids.c);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages .stack-more'))`), `${device}: More drawn`);
      await press(p, device, '#messages .stack-more');
      const below = `#messages .reply-stack[data-stack="${ids.b}"]`;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(below)})?.getClientRects().length)`), `${device}: the dossier below More shows, below the composer`);
      // Room under the feed, so the dossier below the composer can be scrolled near the window's top.
      await p.evaluate(`document.querySelector('#notebook').style.minHeight='2000px'`);
      // Where each dossier, message and More of the feed is in the window, the page's scroll, and the list's height.
      const where = () => p.evaluate(`(()=>{const list=document.querySelector('#messages');
        const rows=[...list.children].filter(e=>e.getClientRects().length&&(e.matches('.reply-stack,.stack-more')||e.dataset.id));
        const sheet=document.querySelector('#new-message-sheet');
        return {scroll:scrollY,list:list.getBoundingClientRect().height,tops:Object.fromEntries(rows.map(e=>[e.dataset.stack??e.dataset.id??'More',e.getBoundingClientRect().top])),
          composer:{top:sheet.getBoundingClientRect().top,height:sheet.getBoundingClientRect().height,words:document.querySelector('#inline-writing-body').value,compose:document.querySelector('#inline-composer').dataset.compose??null}}})()`);
      const moved = (from, to) => [['scroll', from.scroll, to.scroll], ['list', from.list, to.list],
        ...Object.keys({ ...from.tops, ...to.tops }).map(key => [key, from.tops[key], to.tops[key]])].filter(([, x, y]) => !(Math.abs(x - y) <= 1));
      const ways = device === 'phone' ? [['✎', 'top']] : [['✎', 'top'], ['⌘Return', 'scrolled']];
      for (const [way, at] of ways) {
        if (at === 'top') await p.evaluate('scrollTo(0, 0)');
        else await p.evaluate(`(e=>scrollBy(0,e.getBoundingClientRect().top-150))(document.querySelector(${JSON.stringify(below)}))`);
        const before = await where();
        assert.deepEqual([ids.c, ids.a, 'More', ids.b].filter(key => !(key in before.tops)), [], `${device} ${way}: the feed shows c, a, More and b: ${JSON.stringify(before)}`);
        if (way === '✎') await press(p, device, '#new-message');
        else { await p.evaluate(`(()=>{document.activeElement?.blur();document.querySelector('#main').focus({preventScroll:true})})()`); await p.key('Enter', 4); }
        await until(() => p.evaluate(`document.querySelector('#new-message-sheet').matches(':modal') && document.activeElement?.id === 'inline-writing-body'`), `${device} ${way}: the composer is up, ready to type`);
        const up = await where();
        assert.deepEqual(moved(before, up), [], `${device} ${way}: with the composer up, nothing behind the backdrop moved: ${JSON.stringify({ before, up })}`);
        if (way === '✎') for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-composer-still-${device}-${theme}`); }
        await dossierTheme(p, 'light');
        await p.key('Escape');
        // Put back: the sheet's close, heard, folds the composer to its line and gives New message the focus.
        await until(() => p.evaluate(`!document.querySelector('#new-message-sheet').open && document.querySelector('#inline-composer').dataset.compose === 'line' && document.activeElement?.id === 'new-message'
          && document.querySelector('#new-message-sheet').nextElementSibling?.classList.contains('stack-more')`), `${device} ${way}: put back in its place, above More, folded to its line`);
        const after = await where();
        assert.deepEqual(moved(before, after), [], `${device} ${way}: put back, each is where it was, the list no taller: ${JSON.stringify({ before, after })}`);
        observations.push({ name: 'composer popped, the feed still', engine, device, way, before, up, after });
        if (way !== '✎') continue;
        // Up once more, then closed and read in one task: the place is back before any close event is heard.
        await press(p, device, '#new-message');
        await until(() => p.evaluate(`document.querySelector('#new-message-sheet').matches(':modal') && document.activeElement?.id === 'inline-writing-body'`), `${device} ${way}: the composer is up again`);
        const closing = await p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet'),holder=d.previousElementSibling;let heard=false;d.addEventListener('close',()=>{heard=true},{once:true});
          d.close();return {open:d.open,heard,top:d.getBoundingClientRect().top,scroll:scrollY,holder:holder?.classList.contains('sheet-holder')?holder.getClientRects().length:null}})()`);
        assert.deepEqual([closing.open, closing.heard, Math.abs(closing.top - before.composer.top) <= 1, Math.abs(closing.scroll - before.scroll) <= 1, closing.holder],
          [false, false, true, true, 0], `${device} ${way}: closed, before its close event is heard, the composer is where it rested and its holder draws nothing: ${JSON.stringify({ before: before.composer, closing })}`);
        await until(() => p.evaluate(`document.querySelector('#inline-composer').dataset.compose === 'line' && document.activeElement?.id === 'new-message'`), `${device} ${way}: the close heard, folded to its line`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 465, where the feed is not drawn: a topic the reader can no longer read hides its messages, and the composer
  // that rests among them would go with them, and come up unseen. It rests at the page's end instead, where it shows,
  // its writing kept, put back first if it was up; ✎ brings it up where it shows. On a laptop and at 320, 375 and 390.
  await check('reading stacks the New message composer, the topic no longer readable, rests at the page\'s end where it shows, and ✎ brings it up where it shows', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-composer-denied-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'A message before the topic closes to the reader.' }]]);
      const p = await open(topic, device, topic, ids.a);
      // The sheet as it shows: open, modal, where it is, whether it is drawn, and whether a press on its middle reaches it.
      const sheet = () => p.evaluate(`(()=>{const d=document.querySelector('#new-message-sheet'),r=d.getBoundingClientRect(),at=r.width&&r.height?document.elementFromPoint(r.left+r.width/2,r.top+Math.min(r.height/2,40)):null;
        return {open:d.open,modal:d.matches(':modal'),parent:d.parentElement.id,drawn:d.getClientRects().length>0&&r.width>0&&r.height>0,takes:Boolean(at&&d.contains(at)),
          words:document.querySelector('#inline-writing-body').value,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
      await p.evaluate('scrollTo(0, 0)');
      await press(p, device, '#new-message');
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').matches(':modal') && document.activeElement?.id === 'inline-writing-body'`), `${device}: ✎ puts the composer up, ready to type`);
      await p.send('Input.insertText', { text: 'Writing kept as the topic closes.' });
      // The topic closes to the reader while the composer is up: the next read of what changed is refused.
      await control({ method: 'read_fault', name: 'changes', status: 200, body: { instance_id: facts.instance_id, error: { code: 'FORBIDDEN', message: 'Fixture FORBIDDEN', retryable: false } }, count: 1 });
      await control({ method: 'agent_message', operation_id: topic + '-news', topic_id: topic, source: 'topic', sender: other, body: 'News the reader may no longer read.' });
      await until(() => p.evaluate("document.getElementById('topic-title').textContent==='Topic unavailable'"), `${device}: the page says the topic is unavailable`);
      assert.equal(await p.evaluate(`document.querySelector('#messages').hidden`), true, `${device}: the messages are not drawn`);
      await becomes(async () => { const s = await sheet(); return [s.open, s.parent, s.drawn, s.words]; }, [false, 'main', true, 'Writing kept as the topic closes.'],
        `${device}: the composer is put back and rests at the page's end, drawn, its writing kept`);
      for (const width of device === 'phone' ? [320, 375, 390] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
        await p.evaluate('scrollTo(0, 0)');
        await press(p, device, '#new-message');
        await until(async () => (await sheet()).modal, `${device} ${width}: ✎ puts the composer up`);
        const up = await sheet();
        assert.deepEqual([up.drawn, up.takes, up.sideways], [true, true, false], `${device} ${width}: up where it shows, and a press reaches it: ${JSON.stringify(up)}`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-composer-denied-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
        await press(p, device, '#new-message-close');
        await until(async () => !(await sheet()).open, `${device} ${width}: ✕ puts it back`);
        const back = await sheet();
        assert.deepEqual([back.parent, back.drawn, back.words], ['main', true, 'Writing kept as the topic closes.'], `${device} ${width}: back at the page's end, drawn, the writing kept: ${JSON.stringify(back)}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 472: a swipe right on any message of a dossier, its last visible one included, folds that message in place;
  // only the title bar (its head row) moves the dossier below More, and a swipe left there brings it back.
  if (engine === 'chrome') await check('reading stacks below More uses a real swipe on chrome on the title bar alone: a swipe on the last visible message folds it in place, as on any other message', async () => {
    const topic = 'stack-aside-swipe';
    const ids = await seed(topic, [['root', {sender:other,join:true,addressees:[facts.actor],body:'A dossier to swipe.'}],
      ['one', {sender:other,reply_to:'root',addressees:[facts.actor],body:'First visible reply.'}],
      ['two', {sender:other,reply_to:'root',addressees:[facts.actor],body:'Last visible reply.'}]]);
    let p = await open('stack-aside-swipe', 'phone', topic, ids.root);
    const section = `#messages .reply-stack[data-stack="${ids.root}"]`;
    const drag = async (selector, way = 1) => {
      await centre(p, selector); const b=await p.box(selector), y=b.y+b.height/2, t=Date.now()/1000, from=way>0?b.x+30:b.x+Math.min(b.width-30,170);
      await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y}],timestamp:t});
      for (const part of [1,2,3,4]) await p.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+way*35*part,y}],timestamp:t+part*.08});
      await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[],timestamp:t+.6});
    };
    const shown = () => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)});return Boolean(s?.getClientRects().length)&&[...s.querySelectorAll(':scope > .stack-replies .message-card[data-id]')].filter(c=>c.getClientRects().length).map(c=>c.dataset.id+(c.dataset.folded==='true'?':row':''))})()`);
    await drag(card(ids.one));
    await until(async () => (await actsOf(topic,ids.one))?.folded, 'a swipe on a message that is not the last folds it');
    assert.equal((await actsOf(topic,ids.root))?.aside??null,null);
    await drag(card(ids.two));
    await until(async () => (await actsOf(topic,ids.two))?.folded, 'a swipe on the last visible message folds it, in Core');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.equal((await actsOf(topic,ids.root))?.aside??null,null,'and leaves the dossier where it is, above More');
    assert.equal((await actsOf(topic,ids.two,other))?.folded??false,false,'another reader\'s view of it is unchanged');
    await becomes(shown, [ids.one+':row', ids.two+':row'], 'both replies are their rows, in their places, in the dossier on show');
    await shot(p,'stack-aside-swipe-folded');
    // A reload finds the order and the folds as Core holds them.
    await p.close(); p = await open('stack-aside-swipe-reload', 'phone', topic, ids.root);
    // Read now, they are drawn at latest and unread no longer; every message is there once the dossier is fully open.
    const toggle = `${section} > .stack-toggle`;
    if ((await look(p, ids, 'root')).fold !== 'open') { await centre(p, toggle); await press(p, 'phone', toggle); }
    await becomes(shown, [ids.one+':row', ids.two+':row'], 'after a reload, the same rows in the same order');
    // The title bar alone moves the dossier: below More, and back with a swipe left there.
    await drag(`${section} .stack-head`);
    await until(async () => (await actsOf(topic,ids.root))?.aside>0, 'a swipe on the dossier\'s title bar puts it below More');
    assert.equal((await actsOf(topic,ids.root))?.folded??false,false,'and folds no message of it');
    await press(p,'phone','.stack-more');
    await drag(`${section} .stack-head`, -1);
    await until(async () => (await actsOf(topic,ids.root))?.aside===null,'a swipe left on its title bar below More brings it back');
    assert.deepEqual([(await actsOf(topic,ids.one))?.folded, (await actsOf(topic,ids.two))?.folded], [true, true], 'moving the dossier changed no fold');
    assert.deepEqual(p.errors,[]); await shot(p,'stack-aside-swipe'); await p.close();
  });

  if (engine === 'chrome') await check('reading stacks below More takes an agent coordination row by a swipe, and Show agent coordination hides it there too', async () => {
    const topic = 'stack-aside-coordination';
    const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready.' }],
      ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Agents only, to put aside.' }],
      ['reply', { sender: 'aim-ux', reply_to: 'root', addressees: ['aim-core'], body: 'Agents only, answered.' }]]);
    const p = await open(topic, 'phone', topic, ids.root);
    const section = `#messages .reply-stack[data-stack="${ids.root}"]`, filter = '#agent-coordination-show button';
    const state = () => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)}),m=document.querySelector('#messages .stack-more');
      return {compact:s?.dataset.compact,visible:Boolean(s?.getClientRects().length),more:m?.isConnected&&m.getClientRects().length?m.textContent:null}})()`);
    await until(async () => (await state()).compact === 'true', 'the agent-only dossier is its quiet row');
    await centre(p, section + ' .stack-head'); const b = await p.box(section + ' .stack-head'), y = b.y + b.height / 2, t = Date.now() / 1000;
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 60, y }], timestamp: t });
    for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 60 + 35 * part, y }], timestamp: t + part * .08 });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + .6 });
    await until(async () => (await actsOf(topic, ids.root))?.aside > 0, 'a swipe on the quiet row puts the whole dossier aside');
    assert.equal((await actsOf(topic, ids.reply))?.folded ?? false, false, 'no message of it is folded');
    await becomes(async () => (await state()).visible, false, 'the row goes below More');
    assert.match((await state()).more, /1 put aside/, 'More counts it');
    await press(p, 'phone', '#messages .stack-more');
    await becomes(async () => (await state()).visible, true, 'More shows it');
    assert.equal((await state()).compact, 'true', 'below More it is still the quiet row');
    await centre(p, filter); await press(p, 'phone', filter);
    await becomes(async () => (await state()).visible, false, 'Show agent coordination off hides it below More too');
    assert.equal((await state()).more, null, 'More counts only what it would show, so it goes');
    await centre(p, filter); await press(p, 'phone', filter);
    await becomes(async () => (await state()).visible, true, 'turned back on, it is below More again');
    assert.match((await state()).more, /1 put aside/, 'More counts it again');
    assert.ok((await actsOf(topic, ids.root))?.aside > 0, 'the filter changed nothing in Core');
    assert.deepEqual(p.errors, []); await shot(p, 'stack-aside-coordination'); await p.close();
  });

  await check('reading stacks long message headers scroll away inside their cards without moving the dossier tab', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-scrolling-headers-' + device;
      const body = Array.from({ length: 80 }, (_, i) => `Line ${i}: long words to read inside this message.`).join('\n');
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body }],
        ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body }]]);
      const p = await open(topic, device, topic, ids.root);
      await keyTo(p, ids.root);
      await p.key('ArrowRight');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the full stack opens');
      for (const name of ['root', 'reply']) {
        const selector = card(ids[name]);
        await keyTo(p, ids[name]);
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.whole === 'shown'`), name + ' loads the whole message');
        await centre(p, selector);
        const measure = () => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),b=c.getBoundingClientRect(),t=c.closest('.reply-stack').querySelector('.stack-head').getBoundingClientRect();
          return {top:b.top,height:b.height,page:scrollY,scroll:c.scrollTop,author:c.querySelector('.message-author').getBoundingClientRect().bottom-b.top,
            reply:c.querySelector('.message-reply-to')?.getBoundingClientRect().bottom-b.top,tabTop:t.top,tabHeight:t.height,
            tabHit:c.closest('.reply-stack').querySelector('.stack-head').contains(document.elementFromPoint(t.left+t.width/2,t.top+t.height/2))}})()`);
        const before = await measure();
        const b = await p.box(selector), x = b.x + b.width / 2, y = Math.max(0,b.y) + Math.min(120, (Math.min(b.y+b.height,b.viewportHeight)-Math.max(0,b.y))/2);
        await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 240 });
        await until(async () => (await measure()).scroll > 100, name + ': the wheel scrolls inside the message');
        const after = await measure();
        assert.ok(after.author < 0, name + ': the author scrolls out of the card');
        if (name === 'reply') assert.ok(after.reply < 0, 'the reply context scrolls away too');
        assert.deepEqual([after.top,after.height,after.page,after.tabTop,after.tabHeight], [before.top,before.height,before.page,before.tabTop,before.tabHeight], 'card and dossier tab stay in place');
        if (name === 'root') assert.equal(after.tabHit, true, 'the dossier title is still visible and clickable');
        await shot(p, 'stack-headers-away-' + name + '-' + device);
      }
      // Folding and reopening must retain a usable card and title, including a loaded root.
      await keyTo(p, ids.root); await p.key('ArrowLeft');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'the loaded stack folds to latest plus unread');
      await p.key('ArrowRight');
      await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the loaded stack reopens');
      assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).clientHeight > 96`), 'the reopened root has its scrolling viewport');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks plain arrows change the stack before leaving for a siderail, and leave writing alone', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-plain-arrows-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A stack for the arrow keys.' }],
        ['one', { sender: other, reply_to: 'root', body: 'An earlier reply.', read: true }],
        ['kept', { sender: other, reply_to: 'root', body: 'An earlier reply the reader starred.', read: true }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest reply.' }]]);
      // The star gives the desktop right rail a Starred section, and stays on a reply that latest plus unread keeps (item 413).
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root);
      if (device === 'laptop') await until(() => p.evaluate("Boolean(document.querySelector('#things .things-sec[data-key=starred]:not([hidden])'))"), 'the desktop right rail has a Starred section');
      const state = async level => becomes(async () => (await look(p, ids, 'root')).fold, level, device + ': ' + level);
      const inPane = pane => p.evaluate(`Boolean(document.activeElement.closest(${JSON.stringify(pane)}))`);
      // A dossier has two states (item 394): latest plus unread, where it starts, and all of it.
      await keyTo(p, ids.root);
      await p.key('ArrowLeft');
      assert.equal((await look(p, ids, 'root')).fold, 'folded', 'Left at latest plus unread changes nothing in the stack');
      assert.equal(await inPane(device === 'laptop' ? '#outline' : '#messages'), true, 'Left at latest plus unread leaves only when the outline is on screen');
      if (device === 'laptop') await p.key('ArrowRight');
      assert.equal(await focusedOn(p), ids.root, 'returning keeps the same stack');
      await p.key('ArrowRight'); await state('open');
      await shot(p, 'plain-arrows-open-' + device);
      assert.equal(await inPane('#messages'), true, 'the opening press stays in the stack');
      await p.key('ArrowRight');
      assert.equal(await inPane(device === 'laptop' ? '#things' : '#messages'), true, device + ': another Right leaves only when the right rail is on screen');
      await keyTo(p, ids.two);
      await p.evaluate("document.getElementById('new-message').focus()");
      await p.key('ArrowDown');
      assert.equal(await p.evaluate("document.activeElement.matches('.stack-toggle') ? document.activeElement.closest('.reply-stack').dataset.stack : null"), ids.root, 'Down from the page header starts at the first open dossier, not its original message or a remembered reply');
      await keyTo(p, ids.two);
      await p.key('ArrowLeft'); await state('folded');
      assert.equal(await focusedOn(p), ids.two, 'a still-visible reply retains the keys');
      await p.key('ArrowRight'); await state('open');
      await keyTo(p, ids.kept);
      await p.key('ArrowLeft'); await state('folded');
      assert.deepEqual((await look(p, ids, 'root')).rows, ['kept', 'two'], 'latest plus unread keeps the starred read reply');
      assert.equal(await focusedOn(p), ids.kept, 'a starred reply stays in view and retains the keys');
      await p.key('ArrowRight'); await state('open');
      await keyTo(p, ids.one);
      await p.key('ArrowLeft'); await state('folded');
      assert.equal(await focusedOn(p), ids.root, 'folding away a read reply returns the keys to its header');
      // The chevron itself has the same arrows as a message, with no second pane move.
      for (let step = 0; step < 12 && !await p.evaluate("document.activeElement.matches('.stack-toggle')"); step++) await p.key('Tab');
      assert.equal(await p.evaluate("document.activeElement.matches('.stack-toggle')"), true, 'Tab reaches the chevron');
      await p.key('ArrowRight'); await state('open');
      assert.equal(await inPane('#messages'), true, 'the chevron opens in place');
      await p.key('z', 4); await state('folded');
      // A real cursor keeps plain arrows, even with a stack selected beforehand.
      await p.key('Enter', 4);
      await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'new message writing has the cursor');
      await p.send('Input.insertText', { text: 'Keep this writing' });
      await p.key('ArrowLeft'); await p.key('ArrowRight');
      await state('folded');
      assert.equal(await p.evaluate("document.activeElement?.id"), 'inline-writing-body', 'writing keeps the cursor');
      assert.equal(await p.evaluate("document.activeElement.value"), 'Keep this writing', 'writing stays intact');
      assert.equal(await readerOn(p), null, 'no Reader opened');
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks use exactly two states, latest plus unread and all messages, by the chevron, the header, the arrows and the menu, with no header alone', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-chat-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for July 12?\nThe owner wants an answer by Friday.' }],
        ['one', { sender: other, reply_to: 'root', body: 'Older read reply.', read: true }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', body: 'Older read starred reply.', read: true }],
        ['three', { sender: other, reply_to: 'root', body: 'Another read reply.', read: true }],
        ['four', { sender: other, reply_to: 'root', body: 'Read reply four.', read: true }],
        ['five', { sender: other, reply_to: 'two', addressees: [facts.actor], body: 'Unread reply five.' }],
        ['six', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Latest reply, also unread.' }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.two, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root);
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      const all = ['one','two','three','four','five','six'];
      const labels = { folded: 'Latest and unread replies; show all messages', open: 'All messages; show latest and unread replies' };
      const assertState = async (level, rows, full) => {
        await becomes(async () => { const v=await look(p,ids,'root');return {level:v.fold,rows:v.rows,full:v.full}; }, {level,rows,full}, device + ': ' + level);
        assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-foot,#messages .stack-reply').length`),0,'no input-looking reply strip in any state');
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).dataset.state`),level);
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`),'true','the chevron always says the dossier is expanded: there is no closed state');
        assert.ok((await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-label')`)).startsWith(labels[level]+': '),'the chevron names the state it shows and the one it moves to');
      };
      await assertState('folded', ['two','five','six'], false);
      assert.match((await look(p,ids,'root')).meta,/^6 replies .*2 new$/,'counts remain in the header');
      // The count is the alert red; on a folder an agent began it is a deeper red of the folder's own, kept at 4.5:1 on
      // that colour (item 477, tests/ui_folder_colour.test.mjs).
      const fresh = await p.evaluate(`(()=>{const f=document.querySelector('#messages .stack-fresh'),s=f.closest('.reply-stack'),probe=document.createElement('span');probe.style.color='var(--stack-new)';s.append(probe);const own=getComputedStyle(probe).color;probe.remove();return {color:getComputedStyle(f).color,own,coloured:s.dataset.color==='agent'}})()`);
      const [fr, fg, fb] = fresh.color.match(/\d+/g).map(Number);
      assert.ok(fr > fg + 60 && fr > fb + 60, `new count remains red: ${fresh.color}`);
      assert.equal(fresh.color, fresh.coloured ? fresh.own : await alertColour(p), 'new count remains red: the alert red, or on a coloured folder its own deeper red');
      assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-fold-line').length`),0,'no repeated fold bars');
      assert.equal(await p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(toggle)}).getBoundingClientRect(),n=document.querySelector(${JSON.stringify(card(ids.root)+' .stack-name')}).getBoundingClientRect();return t.right<=n.left+1&&t.top<n.bottom&&t.bottom>n.top})()`),true,'chevron beside the title');
      await shot(p,'stack-chat-'+device);
      await centre(p,toggle); await press(p,device,toggle);
      await assertState('open',all,true);
      await shot(p,'stack-open-'+device);
      // The same native button goes back to latest plus unread: a second press never leaves the header alone.
      if(device==='laptop') {
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).focus({preventScroll:true})`);
        // The original's links and reactions can precede the sibling button.
        for(let step=0;step<12&&!await p.evaluate(`document.activeElement.matches('.stack-toggle')`);step++) await p.key('Tab');
        assert.equal(await p.evaluate(`document.activeElement.matches('.stack-toggle')`),true,'Tab reaches chevron');
        // Space presses it; Return on a dossier edits its title (item 385).
        await p.key(' ');
      } else await press(p,device,toggle);
      await assertState('folded',['two','five','six'],false);
      const partial=await look(p,ids,'root');
      assert.equal(partial.rows.filter(x=>x==='six').length,1,'latest unread is never duplicated');
      assert.equal(partial.rows.filter(x=>x==='two').length,1,'the read star stays visible once, without adding a stack state');
      await press(p,device,toggle);
      await assertState('open',all,true);
      await press(p,device,toggle);
      await assertState('folded',['two','five','six'],false);
      // The header row is the same switch.
      await light(p,device,ids.root);
      await press(p,device,`${card(ids.root)} .stack-who`);
      await assertState('open',all,true);
      await press(p,device,`${card(ids.root)} .stack-who`);
      await assertState('folded',['two','five','six'],false);
      assert.equal(await readerOn(p),null,'the chevron and the header open no Reader');
      if(device==='laptop') {
        // The ⋯ menu offers only the step there is: Open at latest plus unread, Fold at all. (A phone's sheet
        // holds the same items behind Move or join…, as "reading stacks on a phone ⋯ opens the acts as a sheet …" checks.)
        const stackItems = async () => (await menuOf(p,device,ids.six)).filter(t=>/^(Open|Fold) its stack/.test(t));
        assert.deepEqual(await stackItems(),['Open its stack→'],'at latest plus unread, ⋯ offers Open its stack and no Fold');
        await choose(p,device,'Open its stack');
        await assertState('open',all,true);
        assert.equal(await said(p),'Original message and every reply shown');
        assert.equal(await readerOn(p),null,'choosing Open its stack opens no Reader');
        assert.deepEqual(await stackItems(),['Fold its stack←'],'at all messages, ⋯ offers Fold its stack and no Open');
        await choose(p,device,'Fold its stack');
        await assertState('folded',['two','five','six'],false);
        assert.equal(await said(p),'Latest and unread replies shown');
        assert.equal(await readerOn(p),null,'choosing Fold its stack opens no Reader');
        // → and ← step between the two; ← at latest plus unread leaves for the outline, the dossier as it was.
        await keyTo(p,ids.root);
        await p.key('ArrowRight');
        await assertState('open',all,true);
        await p.key('ArrowLeft');
        await assertState('folded',['two','five','six'],false);
        await p.key('ArrowLeft');
        await until(() => p.evaluate("Boolean(document.activeElement.closest('#outline'))"),'← at latest plus unread moves into the outline');
        await assertState('folded',['two','five','six'],false);
        await p.key('ArrowRight');
        assert.equal(await focusedOn(p),ids.root,'→ from the outline comes back to the same dossier');
        // ⌘Z puts back each step, and only those two states.
        await p.key('ArrowRight'); await assertState('open',all,true);
        await p.key('z',4); await assertState('folded',['two','five','six'],false);
      }
      assert.equal(await readerOn(p),null,'stack controls do not open a modal');
      assert.deepEqual(p.errors,[]); await p.close();
    }
  });

  await check('reading stacks keep their dossier through color changes, returning to the tab and arriving replies', async () => {
    for (const audience of ['person', 'agents']) {
      const topic = 'stack-color-refresh-' + audience, to = audience === 'person' ? facts.actor : 'aim-ux';
      const ids = await seed(topic, [...(audience === 'agents' ? [['join', { sender: to, join: true, body: 'Here to reply.', read: true }]] : []),
        ['root', { sender: other, join: true, addressees: [to], body: 'A dossier that stays a dossier.', read: true }],
        ['reply', { sender: other, reply_to: 'root', addressees: [to], body: 'A reply inside the folder.', read: true }]]);
      const p = await open(topic, 'laptop', topic, ids.root);
      const selector = card(ids.root), stack = `.reply-stack[data-stack="${ids.root}"]`;
      await p.evaluate(`(()=>{window.stackDamage=[];const c=document.querySelector(${JSON.stringify(selector)});
        new MutationObserver(()=>{if(c.isConnected&&c.closest('.reply-stack')&&!c.classList.contains('stack-head-card'))window.stackDamage.push(c.className)})
          .observe(c,{attributes:true,attributeFilter:['class']})})()`);
      if (audience === 'agents') {
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(stack)})?.dataset.compact === 'true'`), 'agent-only coordination starts as its compact row');
        await press(p, 'laptop', stack + ' > .stack-toggle');
        await until(async () => (await look(p, ids, 'root')).fold === 'folded', 'one press shows latest and unread');
      }
      await press(p, 'laptop', stack + ' > .stack-toggle');
      await until(async () => (await look(p, ids, 'root')).fold === 'open', 'the original shows');
      // In a dossier a press on the author's name folds the message (item 471): the color is chosen from the participants.
      const chip = `#participants .pill-name[title="Change ${other}'s color"]`;
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(chip)})?.getClientRects().length)`), `${other} is in the participants`);
      await p.point(chip);
      await until(() => p.evaluate("Boolean(document.querySelector('.color-picker'))"), 'the color picker opens');
      await p.point('.color-picker [aria-label="rose"]');
      await until(() => p.evaluate(`!document.querySelector('.color-picker')&&document.querySelector(${JSON.stringify(selector)}).classList.contains('agent-rose')`), 'the chosen color is on the card');
      assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'a color choice never erases the dossier');
      // Back to latest plus unread, then leave and return to the actual tab.
      await press(p, 'laptop', stack + ' > .stack-toggle');
      await until(async () => (await look(p, ids, 'root')).fold === 'folded', 'one press goes back to latest and unread');
      // The headless WebKit harness's bringToFront does not dispatch window
      // focus. Chrome proves that native trigger; both engines prove the
      // same color painter through an actual picker choice above.
      if (engine === 'chrome') {
        const elsewhere = await open(topic + '-elsewhere', 'laptop', topic, ids.root);
        await p.evaluate("(()=>{window.watchFor={read:'colors',words:'palette'};window.watched=false})()");
        await p.send('Page.bringToFront');
        await until(() => p.evaluate('window.watched'), 'returning to the tab read the colors again');
        assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'a focus refresh never erases the dossier');
        await elsewhere.close();
      }
      for (let n = 0; n < 3; n++) {
        const id = (await control({ method: 'agent_message', operation_id: topic + '-live-' + n, topic_id: topic, source: 'topic',
          sender: other, addressees: [to], reply_to: ids.root, body: 'Arriving reply ' + n })).result.message_id;
        await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}))`), 'the arriving reply is drawn');
        const state = await look(p, ids, 'root');
        assert.equal(state.fold, 'folded'); assert.equal(state.full, false, 'arrival does not reveal the original');
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector + ' .stack-head')})).position`), 'absolute', 'the dossier tab keeps its position');
      }
      assert.deepEqual(await p.evaluate('window.stackDamage'), [], 'the class survives the complete refresh sequence');
      await shot(p, topic); assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks give only the current message or stack one strong highlight', async () => {
    for(const device of Object.keys(DEVICES)) for(const theme of ['light','dark']) {
      const topic='stack-one-highlight-'+device+'-'+theme;
      const ids=await seed(topic,[['root',{sender:other,join:true,addressees:[facts.actor],body:'One selected thing at a time.',read:true}],
        ['one',{sender:other,reply_to:'root',addressees:[facts.actor],body:'An unread reply with its own quiet cue.'}],
        ['two',{sender:facts.actor,reply_to:'root',addressees:[other],body:'My latest reply has a quiet border too.'}]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.one, operation_id: topic + '-star', args: { starred: true } });
      // My reply folded the first message for me (item 377); unfolded again, it reads whole when the stack is open.
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.root, operation_id: topic + '-unfold', args: { folded: false } });
      const p=await open(topic,device,topic,ids.root);
      await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
      const strong=()=>p.evaluate(`(()=>{const probe=document.createElement('i');probe.style.color='var(--focus)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();
        return [...document.querySelectorAll('#messages .reply-stack,#messages .message-card,#messages .fold-line,#messages .stack-toggle')].filter(e=>{const b=e.getBoundingClientRect();if(!b.width||!b.height)return false;const s=getComputedStyle(e);return s.boxShadow.includes(color)||(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0&&s.outlineColor===color)||s.borderColor===color}).map(e=>e.classList.contains('reply-stack')?'stack:'+e.dataset.stack:e.dataset.id||e.parentElement.dataset.id||e.className)})()`);
      if(device==='laptop') await keyTo(p,ids.one); else await light(p,device,ids.one);
      await becomes(strong,[ids.one],device+' '+theme+': selected unread message alone has the ring');
      await light(p,device,ids.two);
      await becomes(strong,[ids.two],device+' '+theme+': pointer/tap moves the only ring, leaving earlier focus quiet');
      await shot(p,'one-highlight-message-'+device+'-'+theme);
      await light(p,device,ids.root);
      await becomes(strong,['stack:'+ids.root],device+' '+theme+': compact header selects just the stack');
      if(device==='laptop') {
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).focus({preventScroll:true})`);
        await p.key('Tab');
        assert.equal(await p.evaluate(`document.activeElement.matches('.stack-toggle')`),true,'chevron has keyboard focus');
        await becomes(strong,['stack:'+ids.root],'control focus has one stack ring, with no leftover message ring');
      }
      await shot(p,'one-highlight-header-'+device+'-'+theme);
      await light(p,device,ids.two);
      await becomes(strong,[ids.two],'returning to a message takes the stack ring away');
      if (device === 'laptop') {
        await keyTo(p, ids.root);
        await p.key('ArrowLeft');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#outline'))"), true, 'Left at latest plus unread moves into the outline');
        await becomes(strong, [], 'the outline leaves no strong feed ring');
        // The pointer moving onto the dossier takes the only ring, and the keys' place with it (item 387): the outline lets go.
        await light(p, device, ids.root);
        await becomes(strong, ['stack:' + ids.root], 'hover takes the only ring');
        assert.equal(await focusedOn(p), ids.root, 'and the keys: they are on the dossier the pointer moved onto');
        await p.key('ArrowLeft');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#outline'))"), true, 'Left from there moves into the outline again');
        await becomes(strong, [], 'the keys in the outline clear the feed\'s ring');
        assert.notEqual(await p.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'the current rail row owns the ring');
        await p.key('ArrowRight');
        assert.equal(await focusedOn(p), ids.root, 'the feed remembers its place without a persistent highlight');
        await becomes(strong, ['stack:' + ids.root], 'returning to the feed restores its selection');
        await p.key('ArrowRight');
        await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'one → opens every message');
        await away(p);
        await becomes(strong, [], 'moving the pointer off the feed leaves no stale stack ring');
        await p.key('ArrowDown');
        await becomes(strong, [ids.one], 'keys in the feed resume from its focused message');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#things'))"), true, 'Right moves into the other rail');
        await becomes(strong, [], 'the right rail also owns the highlight alone');
        await light(p, device, ids.root);
        await becomes(strong, [ids.root], 'pointer selection takes over from the right rail too');
        assert.equal(await focusedOn(p), ids.root, 'and the keys with it');
        assert.equal(await p.evaluate("Boolean(document.querySelector('#things').contains(document.activeElement))"), false, 'the right rail has no stale focus');
        await p.key('ArrowRight');
        assert.equal(await p.evaluate("Boolean(document.activeElement.closest('#things'))"), true, 'Right on the open stack moves into the right rail again');
        await becomes(strong, [], 'the right rail\'s keys take the light back');
      }
      assert.deepEqual(p.errors,[]); await p.close();
    }
  });

  await check('reading stacks rename in place: Return saves it for everyone with who typed it, Esc cancels, ⌘Z puts it back, an empty name gives back the first line, and another\'s rename shows at once', async () => {
    const topic = 'stack-rename';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for the week of July 12 before Friday when the owner decides?' }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply.', read: true }]]);
    const p = await open('stack-rename', 'laptop', topic, ids.root);
    const name = async () => (await look(p, ids, 'root')).name;
    await until(async () => (await name()) === 'Can we lock the cabin for the week of July 12 before Friday when the owner decides?', 'the name is the first line');
    const input = `#messages .reply-stack .stack-rename-input`;
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'a press on the name opens it to rename, the cursor in it');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Escape');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Esc closes it');
    assert.equal((await actsOf(topic, ids.root))?.name ?? null, null, 'Esc saves nothing');
    await p.point(`${card(ids.root)} .stack-pen`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'the ✎ opens it too');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Enter');
    await until(async () => (await name()) === 'Cabin week', 'Return saves: the row shows the new name');
    await until(async () => (await actsOf(topic, ids.root, other))?.name?.text === 'Cabin week', 'Core holds it for everyone, another reader included');
    assert.equal((await actsOf(topic, ids.root, other)).name.by, facts.actor, 'with who typed it');
    assert.equal(await focusedOn(p), ids.root, 'the head keeps the focus');
    await p.key('z', 4);
    await until(async () => (await actsOf(topic, ids.root))?.name === null && (await name()).startsWith('Can we lock'), '⌘Z puts the first line back, in Core');
    // Another reader renames it: the page shows it without a reload.
    await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: 'stack-rename-other', args: { name: 'Their name' } });
    await until(async () => (await name()) === 'Their name', 'another reader\'s rename shows at once');
    assert.match(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root) + ' .stack-name')}).title`), new RegExp(`Named by ${other}`));
    // Cleared, it is named by its first line again.
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'open to rename again');
    await p.evaluate(`document.activeElement.select()`);
    await p.key('Backspace');
    await p.key('Enter');
    await until(async () => (await name()).startsWith('Can we lock') && (await actsOf(topic, ids.root, other))?.name === null, 'an empty name gives back the first line, for everyone');
    const ellipsis = await p.evaluate(`(n=>getComputedStyle(n).textOverflow)(document.querySelector(${JSON.stringify(card(ids.root) + ' .stack-name')}))`);
    assert.equal(ellipsis, 'ellipsis', 'a long name ends in …');
    // The keys leaving the name save it, as Return does: the field closes, and Core holds it for everyone.
    await p.point(`${card(ids.root)} .stack-name`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'open to rename once more');
    await p.send('Input.insertText', { text: 'Boat keys' });
    await p.key('Tab');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'the keys leaving the name close it');
    await until(async () => (await name()) === 'Boat keys' && (await actsOf(topic, ids.root, other))?.name?.text === 'Boat keys', 'and save it, for everyone');
    await shot(p, 'stack-rename');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks ⋯ Star is the reader\'s own: a starred reply never folds, the rail\'s Starred lists it and lands on it, and another reader sees no star', async () => {
    const topic = 'stack-star';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the stack.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to star.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.' }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const p = await open('stack-star', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'read through: the newest reply alone shows');
    await press(p, 'laptop', `#messages .reply-stack .stack-toggle`);
    await until(async () => (await look(p, ids, 'root')).fold === 'open', 'opened');
    const items = await menuOf(p, 'laptop', ids.one);
    assert.ok(items.includes('Star for me') && items.some(item => item.startsWith('Move its stack up')) && items.some(item => item.startsWith('Join the stack above')),
      `the menu offers Star and the stack's keys: ${items}`);
    assert.ok(items.some(item => item.endsWith('⌘↑')), 'each stack item names its keys');
    await choose(p, 'laptop', 'Star for me');
    await until(async () => (await actsOf(topic, ids.one))?.starred === true, 'Core holds the star');
    assert.equal((await actsOf(topic, ids.one, other))?.starred ?? false, false, 'another reader sees no star');
    assert.deepEqual(await starsOf(other), [], 'and lists none');
    assert.ok((await starsOf(facts.actor)).includes(ids.one), 'the reader\'s stars list it');
    // Latest plus unread retains a read star, alongside the latest reply.
    await keyTo(p, ids.root);
    await p.key('ArrowLeft');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one','three'], 'latest plus unread keeps the starred read reply visible');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one) + ' > .message-author > .card-star')})?.textContent`), '★', 'the starred reply shows its filled star after its author');
    // The rail's Starred: this topic's star, and a press lands on it.
    // Stars elsewhere (another check's) sit under Elsewhere, after this topic's.
    const row = `#things .things-sec[data-key=starred] .things-body > div > ul:first-child a.row`;
    await becomes(() => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(row)})].map(e=>e.firstChild.textContent)`), ['Reply one, to star.'], 'the rail\'s Starred lists this topic\'s star first, by its words');
    assert.equal(await p.evaluate(`[...document.querySelectorAll('#things .things-sec')].filter(d=>!d.hidden)[0].dataset.key`), 'starred', 'Starred comes first');
    assert.equal(await p.evaluate(`document.querySelector('#things .things-sec[data-key=starred] .things-quiet').textContent`), 'Only you see your stars.');
    if (!await p.evaluate(`document.querySelector('#things .things-sec[data-key=starred]').open`)) await p.point('#things .things-sec[data-key=starred] > summary');
    await p.point(row);
    await until(async () => await focusedOn(p) === ids.one, 'a press on the star lands on its message');
    assert.equal(await readerOn(p), null, 'landing opens no Reader');
    await shot(p, 'stack-star');
    await menuOf(p, 'laptop', ids.one);
    await choose(p, 'laptop', 'Unstar');
    await until(async () => (await actsOf(topic, ids.one))?.starred === false, 'Unstar takes it back, in Core');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(row)})`), 'and the rail lists it no more');
    // Landing on an already-visible star does not open the full stack.
    // Unstar leaves the reply where the reader is; opening the dossier explicitly lets go of it.
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one','three'], 'unstar leaves the older read reply in view under the reader');
    assert.equal((await look(p, ids, 'root')).fold, 'folded', 'landing on a visible star preserves latest and unread');
    const starToggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    await centre(p, starToggle); await press(p, 'laptop', starToggle);
    await until(async () => (await look(p, ids, 'root')).fold === 'open', 'the native chevron opens all replies again');
    await menuOf(p, 'laptop', ids.one);
    await choose(p, 'laptop', 'Star for me');
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'starred again, the rail lists it');
    const unstar = `#things .things-sec[data-key=starred] .things-body > div > ul:first-child .things-unstar`;
    await p.point(unstar);
    await until(async () => (await actsOf(topic, ids.one))?.starred === false, 'the rail\'s Unstar takes it off, in Core');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(row)})`), 'and the rail lists it no more');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).dataset.starred === 'false'`), 'the card shows no star');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks starred read replies remain visible at latest and unread after reload, and once unstarred hide when the stack changes', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-star-visible-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A read root.' }],
        ['star', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'An older read starred reply.' }],
        ['ordinary', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An ordinary read reply.' }],
        ['latest', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest read reply.', read: true }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.star, operation_id: topic + '-star', args: { starred: true } });
      let p = await open(topic, device, topic, ids.root);
      const rows = () => look(p, ids, 'root').then(state => ({ fold: state.fold, rows: state.rows, full: state.full }));
      await becomes(rows, { fold:'folded', rows:['star','latest'], full:false }, 'the default level keeps the read star and latest, hiding ordinary read replies');
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.star))}).dataset.folded==='true'`), false, 'the star reads whole');
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      await centre(p, toggle); await press(p, device, toggle);
      await becomes(rows, { fold:'open', rows:['star','ordinary','latest'], full:true }, 'all messages remains chronological');
      await centre(p, toggle); await press(p, device, toggle);
      await becomes(rows, { fold:'folded', rows:['star','latest'], full:false }, 'returning to latest and unread retains the star');
      await p.close(); p = await open(topic + '-reload', device, topic, ids.root);
      await becomes(rows, { fold:'folded', rows:['star','latest'], full:false }, 'reload retains the reader\'s saved star');
      assert.equal((await actsOf(topic, ids.star, other))?.starred ?? false, false, 'no star leaks to another reader');
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.star, operation_id: topic + '-unstar', args: { starred: false } });
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.star))}).dataset.starred === 'false'`), 'the page learns of the unstar on another device');
      await becomes(rows, { fold:'folded', rows:['star','latest'], full:false }, 'unstarred on another device, the reply in view stays until the stack changes');
      await centre(p, toggle); await press(p, device, toggle);
      await becomes(rows, { fold:'open', rows:['star','ordinary','latest'], full:true }, 'all messages');
      await centre(p, toggle); await press(p, device, toggle);
      await becomes(rows, { fold:'folded', rows:['latest'], full:false }, 'back at latest and unread, the unstarred older read reply is hidden again');
      await shot(p, 'star-visible-unstar-' + device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks ⌘↑ ⌘↓ move a stack where the reader wants it, kept after a reload; a new reply does not lift it; another reader keeps newest on top', async () => {
    const topic = 'stack-move';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.', read: true }]]);
    let p = await open('stack-move', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ moves A above B');
    assert.equal(await focusedOn(p), ids.a, 'the keys stay on A');
    assert.match(await said(p), /Moved up/, 'a screen reader hears the move');
    await until(async () => typeof (await actsOf(topic, ids.a))?.placed === 'number', 'Core holds the place');
    assert.equal((await actsOf(topic, ids.a, other))?.placed ?? null, null, 'another reader\'s order is untouched');
    assert.equal(await p.evaluate(`document.querySelector('#messages .reply-stack[data-stack=${JSON.stringify(ids.a)}] .stack-placed-words')?.textContent`), 'Placed here by you');
    await p.close();
    p = await open('stack-move-again', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], 'after a reload the place holds');
    // A new reply to A does not lift it; a new stack lands on top.
    const late = (await control({ method: 'agent_message', operation_id: 'stack-move-late', topic_id: topic, source: 'topic', sender: other, reply_to: ids.a, addressees: [facts.actor], body: 'A late reply to A.' })).result.message_id;
    const fresh = (await control({ method: 'agent_message', operation_id: 'stack-move-fresh', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor], body: 'A new stack D.' })).result.message_id;
    const all = { ...ids, late, d: fresh };
    await becomes(() => stacks(p, all), ['d', 'c', 'a', 'b'], 'the late reply leaves A where it was placed; the new stack lands on top');
    await keyTo(p, ids.a);
    await p.key('ArrowDown', 4);
    await becomes(() => stacks(p, all), ['d', 'c', 'b', 'a'], '⌘↓ moves it down');
    await p.key('z', 4);
    await becomes(() => stacks(p, all), ['d', 'c', 'a', 'b'], '⌘Z puts it back');
    await p.point(`#messages .reply-stack[data-stack="${ids.a}"] .stack-unplace`);
    await becomes(() => stacks(p, all), ['d', 'a', 'c', 'b'], 'Let new replies move it: it goes where its newest reply puts it');
    await until(async () => (await actsOf(topic, ids.a))?.placed === null, 'and Core holds none');
    await shot(p, 'stack-move');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the reader\'s own reply leaves its stack where it was, under their eyes and after a reload; anyone else\'s reply lifts it', async () => {
    const topic = 'stack-own-reply';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    let p = await open('stack-own-reply', 'laptop', topic, ids.c);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    const topOf = () => p.evaluate(`document.querySelector('#messages .reply-stack[data-stack=${JSON.stringify(ids.b)}]').getBoundingClientRect().top`);
    const before = await topOf();
    // The reader answers B's reply as a person does: Reply on its bar, the words, Send.
    const text = 'My own reply to B.';
    await light(p, 'laptop', ids.b1);
    await press(p, 'laptop', '.message-bar [data-act=reply]');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    await p.send('Input.insertText', { text });
    await press(p, 'laptop', '#send-reply');
    const mine = await until(async () => (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 50 })).items
      .find(item => item.author_id === facts.actor && item.body === text)?.id, 'Core holds the reply');
    if (await readerOn(p) !== null) await closeReader(p, 'laptop');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(mine))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(ids.b)} && window.fetchesOut === 0`),
      'the reply is drawn into B\'s stack');
    assert.deepEqual(await stacks(p, ids), ['c', 'b', 'a'], 'the reader\'s own reply leaves B where it was, under C');
    assert.equal(await topOf(), before, 'B\'s stack holds still on the page as the reply arrives');
    await p.close();
    p = await open('stack-own-reply-again', 'laptop', topic, ids.c);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'after a reload B is still where it was');
    // A reply by anyone else lifts its stack, B's own included, the reader's reply in it notwithstanding.
    await control({ method: 'agent_message', operation_id: topic + '-to-a', topic_id: topic, source: 'topic', sender: other, reply_to: ids.a, addressees: [facts.actor], body: 'A reply to A.', read: true });
    await becomes(() => stacks(p, ids), ['a', 'c', 'b'], 'another\'s reply lifts A to the top');
    await control({ method: 'agent_message', operation_id: topic + '-to-b', topic_id: topic, source: 'topic', sender: other, reply_to: ids.b1, addressees: [facts.actor], body: 'Another reply in B.', read: true });
    await becomes(() => stacks(p, ids), ['b', 'a', 'c'], 'another\'s reply in B lifts B to the top');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Core's answers held at the network (the Chrome harness's interception), and let go one at a time.
  if (engine === 'chrome') await check('reading stacks quick acts and late answers: the page always draws the last act and ends where Core does, an answer read before an act puts nothing back, and a quick star then unstar shows unstarred', async () => {
    const topic = 'stack-quick';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.', read: true }]]);
    let p = await open('stack-quick', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'newest activity on top');
    const heldOf = test => p.held.filter(entry => test(entry.payload));
    const reads = payload => payload?.name === 'message_acts', places = payload => payload?.kind === 'stack.place', starsSent = payload => payload?.kind === 'message.star';
    // A star the reader gave A elsewhere, so every acts answer names A, with its place as it then stood.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-star-a', args: { starred: true } });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).dataset.starred === 'true'`), 'the star given elsewhere shows');
    // An acts read answered before the move below, and let go after Core confirmed it.
    p.intercept(payload => reads(payload));
    await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.c, operation_id: topic + '-name', args: { name: 'Named by them' } });
    const early = await until(() => heldOf(reads)[0], 'an acts read is answered and held');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ moves A above B');
    await until(async () => (await actsOf(topic, ids.a))?.place_revision === 1, 'Core holds the place');
    p.held.splice(p.held.indexOf(early), 1);
    await p.release(early);
    await until(async () => (await look(p, ids, 'c')).name === 'Named by them', 'the early answer is read: it names C');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'the early answer puts back none of the move it was read before');
    await p.key('ArrowDown', 4);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], '⌘↓ after it moves A back below B');
    await until(async () => (await actsOf(topic, ids.a))?.place_revision === 2, 'Core takes the move sent after the early answer, fenced on the revision it confirmed');
    assert.deepEqual(p.errors, []);
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    // ⌘↑ ⌘↓ ⌘Z at once, Core's answers held and let go one at a time, with the page drawn again between them.
    // Each act reaches Core as it is sent; only its answer is held, and the next is sent once it lands.
    p.intercept(payload => places(payload));
    await p.key('ArrowUp', 4); await p.key('ArrowDown', 4); await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], '⌘↑ ⌘↓ ⌘Z: A above B, as ⌘Z left it');
    for (const step of [1, 2]) {
      const answer = await until(() => heldOf(places)[0], `act ${step} reached Core`);
      const said = await p.response(answer.event);
      assert.equal(said?.status, 'committed', `Core takes act ${step}`);
      p.held.splice(p.held.indexOf(answer), 1);
      await p.release(answer);
      await until(() => heldOf(places)[0], `act ${step + 1} is sent once act ${step}'s answer lands`);
      await becomes(async () => (await actsOf(topic, ids.a))?.place_revision, 3 + step, `Core holds act ${step + 1}`);
    }
    // A reply arriving draws the page again while the last act is unanswered.
    const reply = (await control({ method: 'agent_message', operation_id: topic + '-reply', topic_id: topic, source: 'topic', sender: other, reply_to: ids.c, addressees: [facts.actor], body: 'Another reply to C.', read: true })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(reply))}))`), 'the reply arrives');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'drawn again before the last answer, the page still shows the last act');
    const last = heldOf(places)[0];
    p.held.splice(p.held.indexOf(last), 1);
    p.intercept(null);
    await p.release(last);
    assert.equal((await actsOf(topic, ids.a))?.place_revision, 5, 'Core holds the last act');
    assert.deepEqual(await stacks(p, ids), ['c', 'a', 'b'], 'and the page still draws it');
    // A quick star then unstar, the first answer let go while the second is unanswered.
    p.intercept(payload => starsSent(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Unstar');
    const starred = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    await until(async () => await starred() === 'false', 'star then unstar: no star shows');
    const first = await until(() => heldOf(starsSent)[0], 'the star reached Core');
    p.held.splice(p.held.indexOf(first), 1);
    await p.release(first);
    const second = await until(() => heldOf(starsSent)[0], 'the unstar is sent after it');
    await control({ method: 'agent_message', operation_id: topic + '-reply-2', topic_id: topic, source: 'topic', sender: other, reply_to: ids.c, addressees: [facts.actor], body: 'A third reply to C.', read: true });
    await until(async () => (await look(p, ids, 'c')).meta?.startsWith('3 replies'), 'another reply draws the page again');
    assert.equal(await starred(), 'false', 'with the star confirmed and the unstar not, the card still shows no star');
    p.held.splice(p.held.indexOf(second), 1);
    p.intercept(null);
    await p.release(second);
    await until(async () => (await actsOf(topic, ids.b))?.star_revision === 2 && (await actsOf(topic, ids.b)).starred === false, 'Core holds the unstar');
    assert.equal(await starred(), 'false');
    assert.deepEqual(p.errors, []);
    await p.close();
    // A fresh page draws what Core holds: the same as the page did.
    p = await open('stack-quick-again', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'a', 'b'], 'after a reload the order is the one the page last drew');
    const starredNow = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    assert.equal(await starredNow(), 'false');
    // A star refused before it reaches Core is drawn no more: the card shows what Core holds.
    await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
    p.intercept(payload => starsSent(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await until(async () => await starredNow() === 'true', 'the star shows at once');
    const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'the star is on its way');
    p.held.splice(p.held.indexOf(refused), 1);
    p.intercept(null);
    await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
    await until(async () => await starredNow() === 'false', 'refused, the card shows no star');
    assert.equal((await actsOf(topic, ids.b))?.starred, false, 'and Core holds none');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks quick acts', engine, held: 'holds Core\'s answers with the Chrome harness\'s request interception, which Safari\'s harness does not offer' });

  // Item 547: Core's answers to the page's requests, held at the network for a check to drop, let through or
  // answer itself, in Chrome with the harness's interception and in Safari's engine with Playwright's routing.
  // before: what the check picks is held before Core sees it; else once Core has answered it.
  const network = async (p, before = false) => {
    const take = (list, entry) => list.splice(list.indexOf(entry), 1);
    if (engine === 'chrome') {
      if (before) await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
      return { hold: test => p.intercept(test && (payload => test(payload))), held: () => p.held,
        drop: entry => { take(p.held, entry); return p.fail(entry); },
        pass: entry => { take(p.held, entry); return entry.event.responseStatusCode === undefined ? p.send('Fetch.continueRequest', { requestId: entry.event.requestId }) : p.release(entry); },
        answer: (entry, status, body) => { take(p.held, entry); return p.send('Fetch.fulfillRequest', { requestId: entry.event.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }); } };
    }
    const held = []; let test = null;
    await p.pw.route(facts.origin + '/api/*', async route => {
      let payload = null; try { payload = route.request().postDataJSON(); } catch { /* not JSON */ }
      if (!test?.(payload)) return route.continue();
      held.push({ payload, route, response: before ? null : await route.fetch() });
    });
    return { hold: given => { test = given; }, held: () => held,
      drop: entry => { take(held, entry); return entry.route.abort('connectionreset'); },
      pass: entry => { take(held, entry); return entry.response ? entry.route.fulfill({ response: entry.response }) : entry.route.continue(); },
      answer: (entry, status, body) => { take(held, entry); return entry.route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); } };
  };
  // The page's status line, as shown.
  const statusLine = p => p.evaluate(`(()=>{const n=document.getElementById('app-status');return {shown:!n.hidden&&n.getClientRects().length>0,text:n.textContent}})()`);
  const foldedCard = (p, id) => p.evaluate(`document.querySelector(${JSON.stringify(card(id))}).dataset.folded === 'true'`);

  await check('reading stacks an act whose answer is lost says which act on which card until Core answers that same request again: then the line goes, the card shows what Core holds, Core holds it once, and the page\'s own act as a reply arrives says nothing', async () => {
    const topic = 'stack-lost';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card whose fold is lost.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'The card the reader answers.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p), folds = payload => payload?.kind === 'message.fold' && payload.target.message_id === ids.a;
    net.hold(folds);
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Fold');
    const lost = await until(() => net.held().find(entry => folds(entry.payload)), 'the fold reached Core; its answer is held');
    assert.equal((await actsOf(topic, ids.a))?.folded, true, 'Core recorded the fold');
    await net.drop(lost);
    // The line is read while nothing has settled the fold: the page's next ask of Core is held too.
    await becomes(() => statusLine(p), { shown: true, text: 'Not known yet whether folding “The card whose fold is lost.” was saved: the connection was interrupted. The page asks Theseus again.' },
      'the line names the act and its card, and says what is not known');
    const again = await until(() => net.held().find(entry => folds(entry.payload)), 'the page asks Core about the same fold again');
    assert.equal((await statusLine(p)).shown, true, 'nothing has settled it while that ask is out');
    net.hold(null); await net.pass(again);
    await until(async () => !(await statusLine(p)).shown, 'Core\'s answer settles it: the line goes');
    await until(() => foldedCard(p, ids.a), 'the card shows the fold Core holds');
    const sent = p.calls.filter(call => folds(call.payload)).map(call => call.payload.operation_id);
    assert.deepEqual([sent.length, sent[1]], [2, sent[0]], 'asked again as the same request');
    assert.equal((await actsOf(topic, ids.a))?.fold_revision, 1, 'Core holds the fold once');
    // The page's own act, a stack dealt with as the reader's reply arrives, settles the same way, without a word.
    const deals = payload => payload?.kind === 'message.deal';
    net.hold(deals);
    const mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor, reply_to: ids.b, addressees: [other], body: 'The reader answers from another device.' })).result.message_id;
    await net.drop(await until(() => net.held().find(entry => deals(entry.payload)), 'the reply arriving deals with its stack; that answer is held'));
    const dealtAgain = await until(() => net.held().find(entry => deals(entry.payload)), 'the page asks Core about the deal again');
    assert.equal((await statusLine(p)).shown, false, 'the page\'s own act says nothing while it is not settled');
    net.hold(null); await net.pass(dealtAgain);
    await until(async () => (await actsOf(topic, mine))?.dealt === true, 'Core holds the deal');
    assert.equal((await statusLine(p)).shown, false, 'nor once it is');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks an act Theseus was too busy to take is said as busy, never as a lost connection, with its card, after the acts are read again; it goes again, and the line goes once Core takes it', async () => {
    const topic = 'stack-busy';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card a busy Theseus did not take.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), folds = payload => payload?.kind === 'message.fold';
    net.hold(folds);
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Fold');
    const first = await until(() => net.held().find(entry => folds(entry.payload)), 'the fold is on its way, before Core');
    const reads = () => p.calls.filter(call => call.payload?.name === 'message_acts').length, before = reads();
    // The server's own answer when its command lane is full (aim_next/server.py).
    await net.answer(first, 503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
    await until(() => reads() > before, 'the acts are read again from Core');
    await until(async () => !(await foldedCard(p, ids.a)), 'the card shows what Core holds: not folded');
    await becomes(() => statusLine(p), { shown: true, text: 'Folding “The card a busy Theseus did not take.” is not saved yet: Theseus was busy. The page sends it again.' },
      'the line says busy, names the act and its card, and stays true after the acts are read again');
    assert.doesNotMatch((await statusLine(p)).text, /Connection interrupted/, 'a busy answer is no lost connection');
    const again = await until(() => net.held().find(entry => folds(entry.payload)), 'the same fold goes again');
    assert.equal(again.payload.operation_id, first.payload.operation_id, 'as the same request');
    net.hold(null); await net.pass(again);
    await until(async () => !(await statusLine(p)).shown, 'Core takes it: the line goes');
    await until(() => foldedCard(p, ids.a), 'the card shows the fold Core holds');
    assert.equal((await actsOf(topic, ids.a))?.fold_revision, 1, 'Core holds it once');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks an act refused for a session Theseus no longer holds, as after a deploy restarts it, says so with its card, goes again once the page holds a session, and Core holds it once', async () => {
    const topic = 'stack-restart';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card folded across a restart.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), folds = payload => payload?.kind === 'message.fold';
    net.hold(folds);
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Fold');
    const first = await until(() => net.held().find(entry => folds(entry.payload)), 'the fold is on its way, before Core');
    // The server's answer to a session it does not hold (aim_next/server.py), as a restarted server gives it.
    await net.answer(first, 401, { error: { code: 'SESSION_REQUIRED', message: 'Session required.' } });
    await becomes(() => statusLine(p), { shown: true, text: 'Folding “The card folded across a restart.” is not saved yet: Theseus restarted. The page sends it again.' },
      'the line says the server restarted, names the act and its card');
    const again = await until(() => net.held().find(entry => folds(entry.payload)), 'once Theseus answers again, the same fold goes again');
    assert.equal(again.payload.operation_id, first.payload.operation_id, 'as the same request');
    net.hold(null); await net.pass(again);
    await until(async () => !(await statusLine(p)).shown, 'Core takes it: the line goes');
    await until(() => foldedCard(p, ids.a), 'the card shows the fold Core holds');
    assert.equal((await actsOf(topic, ids.a))?.fold_revision, 1, 'Core holds it once');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks an act Core refuses is said as not saved, in words of its act and card, never as unknown or a lost connection, until a read of the acts begun after it lands and the card shows what Core holds; a read begun before it, or one that fails, ends nothing', async () => {
    const topic = 'stack-refused';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card folded on another device.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), folds = payload => payload?.kind === 'message.fold', acts = payload => payload?.name === 'message_acts';
    const heldOf = test => net.held().find(entry => test(entry.payload));
    const REFUSED = 'Folding “The card folded on another device.” was not saved: it changed on another tab or device. The card shows what Theseus holds.';
    net.hold(payload => folds(payload) || acts(payload));
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Fold');
    const held = await until(() => heldOf(folds), 'the fold is on its way, before Core');
    // Meanwhile the reader folds it on another device: this page's fold is fenced on a revision gone by, and the
    // page begins reading the acts for that commit before Core refuses its own.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.a, operation_id: topic + '-elsewhere', args: { folded: true } });
    const early = await until(() => heldOf(acts), 'the page reads the acts for the other device\'s fold; that read is held');
    await net.pass(held);
    await becomes(() => statusLine(p), { shown: true, text: REFUSED }, 'the line says the fold was not saved, and why, in words of its act and card');
    assert.doesNotMatch((await statusLine(p)).text, /Not known|Connection interrupted/, 'a refusal is an answer: neither unknown nor a lost connection');
    // The read begun before the refusal lands: the card shows the other device's fold, and the line stays.
    await net.pass(early);
    await until(() => foldedCard(p, ids.a), 'the card shows the fold Core holds, made on the other device');
    const late = await until(() => net.held().find(entry => entry !== early && acts(entry.payload)), 'the acts are read again after the refusal; that read is held');
    assert.deepEqual(await statusLine(p), { shown: true, text: REFUSED }, 'a read begun before the refusal ends nothing');
    // That read fails: nothing is ended by it, and the page reads the acts again, as it does after a failed read.
    await net.drop(late);
    const again = await until(() => net.held().find(entry => entry !== early && entry !== late && acts(entry.payload)), 'the acts are read once more');
    assert.deepEqual(await statusLine(p), { shown: true, text: REFUSED }, 'a read that failed ends nothing');
    net.hold(null); await net.pass(again);
    await until(async () => !(await statusLine(p)).shown, 'a read of the acts begun after the refusal lands: the line goes');
    assert.equal(await foldedCard(p, ids.a), true, 'and the card shows what Core holds');
    assert.equal((await actsOf(topic, ids.a))?.fold_revision, 1, 'Core holds the other device\'s fold alone');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a thumbs-up Theseus was too busy to take is said as busy, with its card, never as a lost connection, until its reactions read again after it land; a read that fails ends nothing, and a press Core takes ends it', async () => {
    const topic = 'stack-thumb-busy';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card a busy Theseus did not thumb.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), thumbs = payload => payload?.kind === 'message.thumb';
    const reactions = payload => payload?.name === 'reactions' && payload.args?.message_id === ids.a, heldOf = test => net.held().find(entry => test(entry.payload));
    const BUSY = 'The thumbs-up on “The card a busy Theseus did not thumb.” was not saved: Theseus was busy. Press again: Core keeps one of each.';
    net.hold(payload => thumbs(payload) || reactions(payload));
    await light(p, 'laptop', ids.a);
    await p.point('.message-bar [data-act=thumb]');
    const first = await until(() => heldOf(thumbs), 'the thumbs-up is on its way, before Core');
    // The server's own answer when its command lane is full (aim_next/server.py), as when the reader's own reply holds it.
    await net.answer(first, 503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
    const read = await until(() => heldOf(reactions), 'the message\'s reactions are read again; that read is held');
    await becomes(() => statusLine(p), { shown: true, text: BUSY }, 'the line says busy, names the act and its card');
    assert.doesNotMatch((await statusLine(p)).text, /Connection interrupted|Not known/, 'a busy answer is no lost connection');
    await net.drop(read);
    await until(() => p.evaluate('window.fetchesOut===0'), 'the failed read has ended at the page');
    assert.deepEqual(await statusLine(p), { shown: true, text: BUSY }, 'a read that failed ends nothing');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}+' .message-reactions .mine')`), null, 'the card shows no thumbs-up of the reader\'s');
    // Pressed again, Core takes it; its reactions read after it end the line.
    net.hold(null);
    await light(p, 'laptop', ids.a);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => (await view('reactions', { message_id: ids.a })).reactions.thumbs.some(thumb => thumb.actor_id === facts.actor), 'Core takes the thumbs-up');
    await until(async () => !(await statusLine(p)).shown, 'its reactions read again: the line goes');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a thumbs-up Theseus was too busy to take is said only until its reactions read again after it land: then the line goes, with the card as Core holds it', async () => {
    const topic = 'stack-thumb-busy-read';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card a busy Theseus did not thumb.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), thumbs = payload => payload?.kind === 'message.thumb';
    const reactions = payload => payload?.name === 'reactions' && payload.args?.message_id === ids.a, heldOf = test => net.held().find(entry => test(entry.payload));
    net.hold(payload => thumbs(payload) || reactions(payload));
    await light(p, 'laptop', ids.a);
    await p.point('.message-bar [data-act=thumb]');
    await net.answer(await until(() => heldOf(thumbs), 'the thumbs-up is on its way, before Core'), 503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
    const read = await until(() => heldOf(reactions), 'the message\'s reactions are read again; that read is held');
    await until(async () => /^The thumbs-up on .* was not saved: Theseus was busy\./.test((await statusLine(p)).text), 'what became of the thumbs-up is said while that read is out');
    net.hold(null); await net.pass(read);
    await until(async () => !(await statusLine(p)).shown, 'the read lands: the line goes');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}+' .message-reactions .mine')`), null, 'and the card shows what Core holds: no thumbs-up of the reader\'s');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks Mark unread from a card\'s menu that Theseus was too busy to take is said as busy, with its card, never as a lost connection, until the marks read again after it land', async () => {
    const topic = 'stack-mark-busy';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'The card a busy Theseus did not mark.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p, true), marking = payload => payload?.kind === 'message.mark', marksRead = payload => payload?.name === 'marks';
    const heldOf = test => net.held().find(entry => test(entry.payload));
    const BUSY = 'Marking unread “The card a busy Theseus did not mark.” was not saved: Theseus was busy. Choose it again to send the same request.';
    net.hold(payload => marking(payload) || marksRead(payload));
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Mark unread');
    await net.answer(await until(() => heldOf(marking), 'the mark is on its way, before Core'), 503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
    const read = await until(() => heldOf(marksRead), 'the marks are read again; that read is held');
    await becomes(() => statusLine(p), { shown: true, text: BUSY }, 'the line says busy, names the act and its card');
    assert.doesNotMatch((await statusLine(p)).text, /Connection interrupted|Not known/, 'a busy answer is no lost connection');
    net.hold(null); await net.pass(read);
    await until(async () => !(await statusLine(p)).shown, 'the marks read lands: the line goes');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.a))}+' .unread-mark'))`), false, 'the card shows what Core holds: not marked unread');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks an act asked again that Core takes is no longer said as not known when the positions read after it fails: what the page says of a later act holds nothing of it', async () => {
    const topic = 'stack-aside-positions';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root moved aside.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An older unread reply.' }],
      ['two', { sender: other, reply_to: 'one', addressees: [facts.actor], body: 'The newest reply.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'The card folded after.' }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const net = await network(p), asides = payload => payload?.kind === 'stack.aside', positions = payload => payload?.name === 'stack_positions';
    const heldOf = test => net.held().find(entry => test(entry.payload));
    net.hold(payload => asides(payload) || positions(payload));
    await menuOf(p, 'laptop', ids.two); await choose(p, 'laptop', 'Move below More');
    await net.drop(await until(() => heldOf(asides), 'the move reached Core; its answer is held, then lost'));
    await until(async () => /^Not known yet whether moving below More/.test((await statusLine(p)).text), 'the move is said as not known');
    for (let entry; (entry = heldOf(positions));) await net.drop(entry);
    const again = await until(() => heldOf(asides), 'the page asks Core about the same move again');
    await net.pass(again);
    await net.drop(await until(() => heldOf(positions), 'Core took the move; the positions read after it is held, and its answer lost'));
    net.hold(null);
    for (const entry of [...net.held()]) await net.pass(entry);
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.root] })).items[0].stack_position.below, 'Core holds the move');
    // Another card's fold, its answer lost too: the line says that fold alone, and goes once Core answers it.
    const foldsB = payload => payload?.kind === 'message.fold' && payload.target.message_id === ids.b;
    net.hold(foldsB);
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Fold');
    await net.drop(await until(() => heldOf(foldsB), 'the other card\'s fold reached Core; its answer is held, then lost'));
    await becomes(() => statusLine(p), { shown: true, text: 'Not known yet whether folding “The card folded after.” was saved: the connection was interrupted. The page asks Theseus again.' },
      'the line says the fold alone: the move Core took is not said as not known');
    const againB = await until(() => heldOf(foldsB), 'the page asks Core about the fold again');
    net.hold(null); await net.pass(againB);
    await until(async () => !(await statusLine(p)).shown, 'Core answers the fold: the line goes, with nothing of the move left on it');
    assert.equal((await actsOf(topic, ids.b))?.fold_revision, 1, 'Core holds the fold once');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks two acts not settled each say their own card; a read or an ask that fails clears neither, and Core\'s answer to one leaves the other said until its own answer', async () => {
    const topic = 'stack-two-lost';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'First card lost.' }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Second card lost.' }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const net = await network(p), fold = id => payload => payload?.kind === 'message.fold' && payload.target.message_id === id;
    const acts = payload => payload?.name === 'message_acts', heldOf = test => net.held().find(entry => test(entry.payload));
    const A = 'Not known yet whether folding “First card lost.” was saved: the connection was interrupted. The page asks Theseus again.';
    const B = 'Not known yet whether folding “Second card lost.” was saved: the connection was interrupted. The page asks Theseus again.';
    net.hold(payload => fold(ids.a)(payload) || fold(ids.b)(payload) || acts(payload));
    await menuOf(p, 'laptop', ids.a); await choose(p, 'laptop', 'Fold');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Fold');
    await net.drop(await until(() => heldOf(fold(ids.a)), 'the first fold reached Core; its answer is held'));
    await net.drop(await until(() => heldOf(fold(ids.b)), 'the second fold goes after it; its answer is held'));
    await becomes(() => statusLine(p), { shown: true, text: A + ' ' + B }, 'each act not settled is said, with its own card');
    // The acts read again fails: nothing is settled by it.
    await net.drop(await until(() => heldOf(acts), 'the acts are read again; that answer is lost too'));
    // Only that one read is lost. The page's later reads are answered: one held would only meet the page's own read
    // deadline, which gives it up, and the end could then let through a request the page no longer waits on.
    net.hold(payload => fold(ids.a)(payload) || fold(ids.b)(payload));
    const againA = await until(() => heldOf(fold(ids.a)), 'once Theseus answers anything, the first fold is asked again');
    assert.deepEqual(await statusLine(p), { shown: true, text: A + ' ' + B }, 'a read that failed clears neither');
    await net.pass(againA);
    const againB = await until(() => heldOf(fold(ids.b)), 'then the second');
    await becomes(() => statusLine(p), { shown: true, text: B }, 'Core\'s answer to the first leaves the second said');
    await net.drop(againB);
    // The page takes the failed ask as not known, reads the acts again and, at that answer, asks once more: that ask is the
    // sign the failure was handled. A count of fetches under way cannot say it, as the page's next requests start at once.
    await until(() => heldOf(fold(ids.b)), 'the second fold\'s ask failed at the page, and it is asked again at the next answer');
    assert.deepEqual(await statusLine(p), { shown: true, text: B }, 'an ask that failed does not clear it');
    net.hold(null);
    for (const entry of [...net.held()]) await net.pass(entry);
    await until(async () => !(await statusLine(p)).shown, 'the second fold is settled at the next answer: the line goes');
    assert.deepEqual([await foldedCard(p, ids.a), await foldedCard(p, ids.b)], [true, true], 'both cards show the folds Core holds');
    assert.deepEqual([(await actsOf(topic, ids.a))?.fold_revision, (await actsOf(topic, ids.b))?.fold_revision], [1, 1], 'each held once');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks ⇧⌘↑ joins a stack to the one above for everyone, its first message in view with a join line, and Split back out takes it out again', async () => {
    const topic = 'stack-join';
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'The older stack.' }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'Its reply.' }],
      ['top', { sender: other, addressees: [facts.actor], body: 'The newer stack.' }],
      ['topReply', { sender: other, reply_to: 'top', addressees: [facts.actor], body: 'The newer stack\'s reply.', read: true }]]);
    const p = await open('stack-join', 'laptop', topic, ids.old);
    await becomes(() => stacks(p, ids), ['top', 'old'], 'two stacks');
    await keyTo(p, ids.old);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['top'], '⇧⌘↑ joins the older stack into the one above');
    assert.match(await said(p), /Joined to the stack above/, 'a screen reader hears the join');
    // The join opens the stack it went into, with no → needed (item 354).
    await becomes(async () => (await look(p, ids, 'top')).rows, ['join: Joined from its own stack by You', 'old', 'oldReply', 'topReply'],
      'one run, oldest first: its first message in view with a join line, its reply, in view before, still in view, then the newer stack\'s reply');
    // The joined stack's first message heads nothing now: its head row goes, and it reads as a card.
    const headed = id => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))});return {row:Boolean(c.querySelector(':scope > .stack-head')),head:c.classList.contains('stack-head-card')}})()`);
    assert.deepEqual(await headed(ids.old), { row: false, head: false }, 'the joined stack\'s first message keeps no head row');
    assert.equal(await p.evaluate(`document.querySelectorAll('#messages .stack-replies .stack-head').length`), 0, 'no head row inside a stack\'s replies');
    await until(async () => (await actsOf(topic, ids.old, other))?.joined?.into === ids.top, 'Core holds the join for everyone');
    assert.equal((await actsOf(topic, ids.old, other)).joined.by, facts.actor, 'with who joined it');
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['top', 'old'], 'Split back out takes it out again');
    assert.deepEqual(await headed(ids.old), { row: true, head: true }, 'split back out, it heads its stack again, with its row');
    await until(async () => (await actsOf(topic, ids.old, other))?.joined === null, 'for everyone');
    await keyTo(p, ids.old);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['top'], 'joined again');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['top', 'old'], '⌘Z undoes the join');
    await shot(p, 'stack-join');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A dossier below More sits apart: a move or a join steps over it to the stack shown beside the one acted on,
  // and More is a boundary neither crosses. Seeded C (with a reply), B and A, newest first; B put below More.
  // The topic's opening, the reader's own and the oldest, stays the last stack above More, out of shown().
  const besideMore = async topic => {
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    // What shows down the page: each stack by its head's name, and More.
    const shown = () => p.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]).filter(Boolean)`);
    await becomes(shown, ['c', 'b', 'a'], 'newest on top');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await becomes(shown, ['c', 'a', 'More'], 'B is below More, out of sight');
    return { ids, p, shown };
  };
  const joinedInto = async (topic, id) => (await actsOf(topic, id, other))?.joined?.into ?? null;

  await check('reading stacks ⇧⌘↑ ⇧⌘↓ join a stack to the one shown beside it, never into a dossier below More', async () => {
    const topic = 'stack-aside-joins';
    const { ids, p, shown } = await besideMore(topic);
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 12);
    await until(async () => await joinedInto(topic, ids.a) === ids.c, '⇧⌘↑ joins A into C, the stack shown above it, not B below More');
    await becomes(shown, ['c', 'More'], 'A is in C, above More');
    assert.equal(await focusedOn(p), ids.a, 'the keys stay on A');
    await p.key('z', 4);
    await until(async () => await joinedInto(topic, ids.a) === null, '⌘Z splits A out again');
    await becomes(shown, ['c', 'a', 'More'], 'A is its own stack again');
    await keyTo(p, ids.c);
    await p.key('ArrowDown', 12);
    await until(async () => await joinedInto(topic, ids.c) === ids.a, '⇧⌘↓ joins C into A, the stack shown below it, not B below More');
    await becomes(shown, ['a', 'More'], 'C is in A, above More');
    assert.equal(await focusedOn(p), ids.c, 'the keys stay on C');
    await p.key('z', 4);
    await until(async () => await joinedInto(topic, ids.c) === null, '⌘Z splits C out again');
    // More opened, B is shown below it, and joins nothing above it.
    await press(p, 'laptop', '#messages .stack-more');
    await becomes(shown, ['c', 'a', 'More', 'b'], 'More shows B');
    await keyTo(p, ids.b);
    await p.key('ArrowUp', 12);
    await until(async () => /No stack above to join/.test(await said(p)), 'B, first below More, has no stack above to join');
    assert.equal(await joinedInto(topic, ids.b), null, 'B joined nothing');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks ⌘↑ ⌘↓ move a stack past the one shown beside it, stepping over a dossier below More', async () => {
    const topic = 'stack-aside-moves';
    const { ids, p, shown } = await besideMore(topic);
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(shown, ['a', 'c', 'More'], '⌘↑ moves A above C, the stack shown above it');
    assert.equal(await focusedOn(p), ids.a, 'the keys stay on A');
    await keyTo(p, ids.c);
    await p.key('ArrowUp', 4);
    await becomes(shown, ['c', 'a', 'More'], '⌘↑ moves C back above A');
    await p.key('ArrowDown', 4);
    await becomes(shown, ['a', 'c', 'More'], '⌘↓ moves C below A, still above More');
    await press(p, 'laptop', '#messages .stack-more');
    await becomes(shown, ['a', 'c', 'More', 'b'], 'More shows B');
    await keyTo(p, ids.b);
    await p.key('ArrowUp', 4);
    await until(async () => /Already at the top/.test(await said(p)), 'B, first below More, moves no further up');
    await becomes(shown, ['a', 'c', 'More', 'b'], 'and nothing moved');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // The Reader's ↑ (above) and ↓ (below) read the same page order as the stack keys (reply-stacks.mjs,
  // shownStacks): by the header's buttons on a laptop, by ↑ Previous · ↓ Next at the end of the message on a phone.
  const stepButton = (device, where) => device === 'phone' ? `.reader-end .end-step:${where === 'above' ? 'first' : 'last'}-child`
    : where === 'above' ? '#next-message' : '#previous-message';
  const readerStep = async (p, device, where, starts, message) => {
    const button = stepButton(device, where);
    if (device === 'phone') await p.evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(button)}).disabled`), `${device}: ${message}: its button can be pressed`);
    await press(p, device, button);
    await becomes(async () => (await readerOn(p))?.slice(0, starts.length) ?? null, starts, `${device}: ${message}`);
  };
  // At an end of what the page shows, that way's button cannot be pressed, once the page has said which the
  // Reader's neighbours are (the other way's button can).
  const readerEnd = async (p, device, where, message) => {
    const other = stepButton(device, where === 'above' ? 'below' : 'above');
    if (device === 'phone') await p.evaluate(`document.querySelector('.reader-end').scrollIntoView({block:'center'})`);
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(other)}).disabled`), `${device}: the Reader knows its neighbours`);
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(stepButton(device, where))}).disabled`), true, `${device}: ${message}`);
  };

  await check('reading stacks shown order: the Reader\'s ↑ and ↓ step over a dossier below More to the message shown beside it, and reach it once More is open', async () => {
    const topic = 'stack-aside-reader';
    const { ids, p, shown } = await besideMore(topic);
    await openReader(p, 'laptop', ids.a, 'Stack A.');
    await readerStep(p, 'laptop', 'above', 'A reply to C.', '↑ from A is C\'s reply, shown above it, not B below More');
    await readerStep(p, 'laptop', 'below', 'Stack A.', '↓ from C\'s reply is A, shown below it, not B below More');
    await closeReader(p, 'laptop');
    await becomes(shown, ['c', 'a', 'More'], 'stepping brought nothing out from below More');
    // More open: B shows below it, after every stack above More, and the Reader goes on to it there.
    await press(p, 'laptop', '#messages .stack-more');
    await becomes(shown, ['c', 'a', 'More', 'b'], 'More shows B');
    await openReader(p, 'laptop', ids.a, 'Stack A.');
    // Below A is the topic's opening, the last stack above More; below that, B, the first below it.
    await until(() => p.evaluate(`!document.querySelector('#previous-message').disabled`), 'laptop: ↓ from A can be pressed');
    await p.point('#previous-message');
    await until(async () => !(await readerOn(p))?.startsWith('Stack A.'), 'laptop: ↓ goes on from A');
    assert.notEqual((await readerOn(p))?.startsWith('Stack B'), true, 'laptop: ↓ from A is the opening, still above More, not B');
    await readerStep(p, 'laptop', 'below', 'Stack B, put aside.', '↓ from the last stack above More, with More open, is B below it');
    await closeReader(p, 'laptop');
    assert.ok((await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'B is still below More in Core');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks shown order: the Reader stops at the ends of what the page shows, never going on into a dossier below More, on a laptop and a phone', async () => {
    // A, X, C, Y, oldest first; X and Y put below More. Core's neighbours of C are Y above it and X below it,
    // both loaded and put aside: not beyond what the page loaded, so neither stands in at an end.
    const topic = 'stack-aside-reader-ends';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['x', { sender: other, addressees: [facts.actor], body: 'Stack X, put aside.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }],
      ['y', { sender: other, addressees: [facts.actor], body: 'Stack Y, put aside.', read: true }]]);
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    // What shows down the page, the topic's opening (the person's own) included.
    const shown = q => q.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??(e.querySelector?.('.own-message')||e.classList.contains('own-message')?'opening':null)).filter(Boolean)`);
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => shown(p), ['y', 'c', 'x', 'a', 'opening'], 'newest on top');
    for (const id of [ids.y, ids.x]) {
      await menuOf(p, 'laptop', id); await choose(p, 'laptop', 'Move below More');
      await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [id] })).items[0].stack_position.below, 'Core holds it below More');
    }
    await becomes(() => shown(p), ['c', 'a', 'opening', 'More'], 'X and Y are below More');
    await openReader(p, 'laptop', ids.c, 'Stack C.');
    await readerEnd(p, 'laptop', 'above', '↑ from C, the top of what shows, goes nowhere: not on to Y below More');
    await closeReader(p, 'laptop');
    // C moved to the bottom, past the opening: ↓ from it goes nowhere, not on to X below More.
    await keyTo(p, ids.c);
    await p.key('ArrowDown', 4); await becomes(() => shown(p), ['a', 'c', 'opening', 'More'], '⌘↓ moves C below A');
    await p.key('ArrowDown', 4); await becomes(() => shown(p), ['a', 'opening', 'c', 'More'], '⌘↓ again moves C below the opening');
    await openReader(p, 'laptop', ids.c, 'Stack C.');
    await readerEnd(p, 'laptop', 'below', '↓ from C, the bottom of what shows, goes nowhere: not on to X below More');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
    // On a phone, ↑ Previous · ↓ Next step by the same rule. Core's neighbour of A above it is X, of C below it
    // X too: both put aside, so A's ↑ Previous and C's ↓ Next go nowhere.
    const q = await open(topic + '-phone', 'phone', topic, ids.a);
    await becomes(() => shown(q), ['a', 'opening', 'c', 'More'], 'phone: C where it was placed, X and Y below More');
    await openReader(q, 'phone', ids.a, 'Stack A.');
    await readerEnd(q, 'phone', 'above', '↑ Previous from A, the top of what shows, goes nowhere: not on to X below More');
    await closeReader(q, 'phone');
    await openReader(q, 'phone', ids.c, 'Stack C.');
    await readerEnd(q, 'phone', 'below', '↓ Next from C, the bottom of what shows, goes nowhere: not on to X below More');
    await closeReader(q, 'phone');
    assert.deepEqual(q.errors, []);
    await q.close();
  });

  // Further down, the card in view at the top stays where it was as the page redraws (docs/attention.md).
  // Here that card's dossier is put below More on another device, so the page stops drawing it.
  await check('reading stacks below More: when the first card in view goes below a closed More from another device, the cards under it do not jump past where it was', async () => {
    const topic = 'below-more-anchor';
    const said = [];
    for (let n = 0; n < 20; n++) said.push(['g' + n, { sender: 'aim-ux', join: n === 0, addressees: [facts.actor], body: `Older ${n}: a message long enough to take a line or two on the page, said to the person.`, read: true }]);
    for (let n = 0; n < 8; n++) said.push(['f' + n, { sender: 'aim-ux', addressees: [facts.actor], body: `Filler ${n}: a message long enough to take a line or two on the page, said to the person.`, read: true }]);
    said.push(['x', { sender: other, join: true, addressees: [facts.actor], body: 'The message that goes aside.\n' + Array.from({ length: 30 }, (_, n) => `Line ${n} of a tall message.`).join('\n'), read: true }]);
    for (let n = 8; n < 16; n++) said.push(['f' + n, { sender: 'aim-ux', addressees: [facts.actor], body: `Filler ${n}: a message long enough to take a line or two on the page, said to the person.`, read: true }]);
    const ids = await seed(topic, said);
    const p = await open(topic, 'laptop', topic, ids.f15);
    const x = entry(ids.x);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(x)})?.getClientRects().length)`), 'x is drawn');
    // x, a tall card, the first card in view, its top well above the window's; f7, drawn under it, in view.
    await p.evaluate(`(e=>{e.scrollIntoView({block:'start'});scrollBy(0,Math.round(e.getBoundingClientRect().height/2))})(document.querySelector(${JSON.stringify(x)}))`);
    await twoFrames(p);
    const at = () => p.evaluate(`({scroll:scrollY,x:(e=>e.getClientRects().length?e.getBoundingClientRect().top:null)(document.querySelector(${JSON.stringify(x)})),
      xHeight:document.querySelector(${JSON.stringify(x)}).getBoundingClientRect().height,
      f7:document.querySelector(${JSON.stringify(entry(ids.f7))}).getBoundingClientRect().top,
      first:[...document.querySelectorAll('#messages > [data-id], #messages > .reply-stack > [data-id], #messages > .reply-stack > .stack-replies > [data-id]')].find(e=>{const b=e.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight})?.dataset.id})`);
    const before = await at();
    assert.ok(before.first === ids.x && before.x < -100 && before.f7 > 0 && before.f7 < 900, `x the first card in view, its top well above the window's; f7 under it in view (${JSON.stringify(before)})`);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.x, operation_id: topic + '-aside', args: { through: (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(x)}).getClientRects().length`), 'x goes below the closed More');
    await twoFrames(p);
    const after = await at();
    // Where f7 may go: held where it was, or up into the place x left, at most to where x's top was. Not further.
    assert.ok(after.f7 >= before.x - 1, `f7 does not jump past where x was (${JSON.stringify({ before, after })})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks shown order: with Show agent coordination off, a join and the Reader\'s ↑ step over the hidden agent coordination to the stack shown', async () => {
    const topic = 'stack-hidden-coordination-steps';
    const ids = await seed(topic, [['a', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['k', { sender: other, join: true, addressees: ['aim-ux'], body: 'Agents only.', read: true }],
      ['k1', { sender: 'aim-ux', reply_to: 'k', addressees: [other], body: 'Agents only, answered.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    const shown = () => p.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]).filter(Boolean)`);
    await becomes(shown, ['c', 'k', 'a'], 'the agent coordination shows between C and A');
    const filter = '#agent-coordination-show button';
    await centre(p, filter); await p.point(filter);
    await becomes(shown, ['c', 'a'], 'Show agent coordination off hides it');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 12);
    await until(async () => (await actsOf(topic, ids.a, other))?.joined?.into === ids.c, '⇧⌘↑ joins A into C, the stack shown above it, not the hidden agent coordination');
    await p.key('z', 4);
    await until(async () => !(await actsOf(topic, ids.a, other))?.joined?.into, '⌘Z splits A out again');
    await becomes(shown, ['c', 'a'], 'A is its own stack again, the agent coordination still hidden');
    await openReader(p, 'laptop', ids.a, 'Stack A.');
    await readerStep(p, 'laptop', 'above', 'Stack C.', '↑ from A is C, shown above it, not the hidden agent coordination');
    await closeReader(p, 'laptop');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(filter)}).getAttribute('aria-pressed')`), 'false', 'the agent coordination stays hidden');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Every way the Reader comes to be open on a message, the one open hidden or not: it steps only to a message
  // shown or not loaded (stack-order.mjs, stepTarget). These cases began as an independent review's.
  const pageShown = (q, ids) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return q.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??(e.querySelector?.('.own-message')||e.classList.contains('own-message')?'opening':null)).filter(Boolean)`);
  };
  const putAsideBy = async (q, device, topic, id) => {
    await menuOf(q, device, id);
    if (device === 'phone') await choose(q, device, 'Move or join…');
    await choose(q, device, 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [id] })).items[0].stack_position.below, 'Core holds it below More');
  };
  const stepsOffered = q => q.evaluate(`({above:!document.querySelector('#next-message').disabled,below:!document.querySelector('#previous-message').disabled})`);

  await check('reading stacks shown order: Read it on a message below a closed More: the Reader never steps on into another dossier put aside', async () => {
    const wrongSteps = [];
    for (const device of Object.keys(DEVICES)) {
      // A, X, Y, C oldest first; X and Y put below More. Core's neighbour of X above it is Y, put aside.
      const topic = 'shown-order-readit-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
        ['x', { sender: other, addressees: [facts.actor], body: 'Stack X, put aside.', read: true }],
        ['y', { sender: other, addressees: [facts.actor], body: 'Stack Y, put aside.', read: true }],
        ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      await becomes(() => pageShown(p, ids), ['c', 'y', 'x', 'a', 'opening'], device + ': newest on top');
      // X marked unread, as the Reader's Mark unread leaves it.
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.x], marked: true });
      await until(() => p.evaluate(`!document.querySelector('#topic-marks').hidden`), device + ': the page says one message is marked unread');
      for (const id of [ids.y, ids.x]) await putAsideBy(p, device, topic, id);
      await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More'], device + ': X and Y are below More');
      await centre(p, '#read-mark'); await press(p, device, '#read-mark');
      await until(async () => (await readerOn(p))?.startsWith('Stack X'), device + ': Read it opens X in the Reader');
      await until(async () => { const b = await stepsOffered(p); return b.above || b.below; }, device + ': the Reader knows its neighbours');
      const buttons = await stepsOffered(p);
      observations.push({ name: 'shown order read-it', engine, device, shownWhileOpen: await pageShown(p, ids), buttons });
      if (buttons.above) {
        if (device === 'phone') await p.evaluate(`document.querySelector('.reader-end').scrollIntoView({block:'center'})`);
        await press(p, device, stepButton(device, 'above'));
        await until(async () => !(await readerOn(p))?.startsWith('Stack X'), `${device}: ↑ went somewhere`);
      }
      const landed = await readerOn(p);
      observations.push({ name: 'shown order read-it landed', engine, device, landed: landed?.slice(0, 30), shownAfter: await pageShown(p, ids) });
      if (landed?.startsWith('Stack Y')) wrongSteps.push(`${device}: ↑ from X (opened by Read it, below a closed More) opened Y, put aside; buttons ${JSON.stringify(buttons)}`);
      await closeReader(p, device);
      await p.close();
    }
    assert.deepEqual(wrongSteps, []);
  });

  await check('reading stacks shown order: second device puts the Reader\'s message below More, then a new message: ↓ never opens a dossier put aside', async () => {
    const wrong = [];
    for (const device of Object.keys(DEVICES)) {
      // A, Y, C oldest first; Y below More. The Reader is on C on one device; the other puts C below More.
      const topic = 'shown-order-second-device-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
        ['y', { sender: other, addressees: [facts.actor], body: 'Stack Y, put aside.', read: true }],
        ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      await becomes(() => pageShown(p, ids), ['c', 'y', 'a', 'opening'], device + ': newest on top');
      await putAsideBy(p, device, topic, ids.y);
      await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More'], device + ': Y below More');
      await openReader(p, device, ids.c, 'Stack C.');
      await until(async () => (await stepsOffered(p)).below, device + ': the Reader knows its neighbours');
      const q = await open(topic + '-other', 'laptop', topic, ids.a);
      await becomes(() => pageShown(q, ids), ['c', 'a', 'opening', 'More'], 'the other device shows the same');
      await putAsideBy(q, 'laptop', topic, ids.c);
      await q.close(); await p.send('Page.bringToFront');
      await becomes(() => pageShown(p, ids), ['a', 'opening', 'More'], device + ': the first device hears C went below More');
      const n = (await control({ method: 'agent_message', operation_id: topic + '-n', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor], body: 'Stack N, new.', read: true })).result.message_id;
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${n}"]'))`), device + ': N reaches the page');
      await until(async () => (await stepsOffered(p)).above, device + ': the Reader reads its neighbours again (N above C in Core)');
      const buttons = await stepsOffered(p);
      if (buttons.below) {
        if (device === 'phone') await p.evaluate(`document.querySelector('.reader-end').scrollIntoView({block:'center'})`);
        await press(p, device, stepButton(device, 'below'));
        await until(async () => !(await readerOn(p))?.startsWith('Stack C.'), device + ': ↓ went somewhere');
      }
      const landed = await readerOn(p);
      observations.push({ name: 'shown order second device', engine, device, buttons, landed: landed?.slice(0, 30), shown: await pageShown(p, { ...ids, n }) });
      if (landed?.startsWith('Stack Y')) wrong.push(`${device}: ↓ from C (put below More on another device) opened Y, below a closed More`);
      await closeReader(p, device);
      await p.close();
    }
    assert.deepEqual(wrong, []);
  });

  // A topic longer than the page loads (30 messages): Core's neighbour at the bottom of what shows is one the page
  // has not loaded, and the page may still know it is not on show. These cases began as an independent review's.
  const fillers = count => Array.from({ length: count }, (_, n) => [`f${n}`, { sender: other, addressees: [facts.actor], body: `Filler ${n}.`, read: true }]);
  await check('reading stacks shown order: at the bottom of a long topic, ↓ never opens the unloaded first message of a dossier the page holds below a closed More', async () => {
    const wrong = [];
    for (const device of Object.keys(DEVICES)) {
      // R, older than anything loaded; fillers F0..F28; R1, a reply to R, loaded and heading its own stack.
      const topic = 'shown-order-unloaded-root-' + device;
      const ids = await seed(topic, [['r', { sender: other, join: true, addressees: [facts.actor], body: 'Root R, older than the page.', read: true }],
        ...fillers(29), ['r1', { sender: other, addressees: [facts.actor], reply_to: 'r', body: 'Reply R1.', read: true }]]);
      const p = await open(topic, device, topic, ids.r1);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids.f0}"]'))`), device + ': F0 is the oldest loaded');
      assert.equal(await p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids.r}"]'))`), false, device + ': R is not loaded');
      await putAsideBy(p, device, topic, ids.r1);
      await until(() => p.evaluate(`!document.querySelector('#messages [data-id="${ids.r1}"]').getClientRects().length`), device + ': R1 is below a closed More');
      await openReader(p, device, ids.f0, 'Filler 0.');
      await until(async () => (await stepsOffered(p)).above, device + ': the Reader knows its neighbours');
      const buttons = await stepsOffered(p);
      if (buttons.below) {
        if (device === 'phone') await p.evaluate(`document.querySelector('.reader-end').scrollIntoView({block:'center'})`);
        await press(p, device, stepButton(device, 'below'));
        await until(async () => !(await readerOn(p))?.startsWith('Filler 0.'), device + ': ↓ went somewhere');
      }
      const landed = await readerOn(p);
      if (landed?.startsWith('Root R')) wrong.push(`${device}: ↓ from F0 opened R, the root of the dossier below a closed More`);
      await closeReader(p, device);
      await p.close();
    }
    assert.deepEqual(wrong, []);
  });

  await check('reading stacks shown order: at the bottom of a long topic, ↓ never opens an unloaded message Core holds below a closed More', async () => {
    const wrong = [];
    for (const device of Object.keys(DEVICES)) {
      // R and its reply R1, both older than anything loaded, put below More on another device; fillers F0..F29.
      const topic = 'shown-order-unloaded-aside-' + device;
      const ids = await seed(topic, [['r', { sender: other, join: true, addressees: [facts.actor], body: 'Root R, put aside.', read: true }],
        ['r1', { sender: other, addressees: [facts.actor], reply_to: 'r', body: 'Reply R1, put aside.', read: true }], ...fillers(30)]);
      const newest = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.r, operation_id: topic + '-aside', args: { through: newest } });
      await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.r1] })).items[0].stack_position.below, device + ': Core holds R\'s dossier below More');
      const p = await open(topic, device, topic, ids.f29);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids.f0}"]'))`), device + ': F0 is the oldest loaded');
      await openReader(p, device, ids.f0, 'Filler 0.');
      await until(async () => (await stepsOffered(p)).above, device + ': the Reader knows its neighbours');
      const buttons = await stepsOffered(p);
      if (buttons.below) {
        if (device === 'phone') await p.evaluate(`document.querySelector('.reader-end').scrollIntoView({block:'center'})`);
        await press(p, device, stepButton(device, 'below'));
        await until(async () => !(await readerOn(p))?.startsWith('Filler 0.'), device + ': ↓ went somewhere');
        const landed = await readerOn(p);
        if (/^(Root R|Reply R1)/.test(landed ?? '')) wrong.push(`${device}: ↓ from F0 opened ${landed.slice(0, 20)}, which Core holds below a closed More`);
      }
      await closeReader(p, device);
      await p.close();
    }
    assert.deepEqual(wrong, []);
  });

  await check('reading stacks shown order: More opened, a dossier brought back across it, More closed: the Reader steps the page as shown', async () => {
    for (const device of Object.keys(DEVICES)) {
      // A, X, C, Y oldest first; X and Y below More, then X brought back.
      const topic = 'shown-order-across-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
        ['x', { sender: other, addressees: [facts.actor], body: 'Stack X, put aside.', read: true }],
        ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }],
        ['y', { sender: other, addressees: [facts.actor], body: 'Stack Y, put aside.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      for (const id of [ids.y, ids.x]) await putAsideBy(p, device, topic, id);
      await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More'], device + ': X and Y below More');
      await press(p, device, '#messages .stack-more');
      await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More', 'y', 'x'], device + ': More open');
      await menuOf(p, device, ids.x); if (device === 'phone') await choose(p, device, 'Move or join…');
      await choose(p, device, 'Bring back above More');
      await until(async () => !(await view('stack_positions', { topic_id: topic, message_ids: [ids.x] })).items[0].stack_position.below, device + ': X back in Core');
      await becomes(() => pageShown(p, ids), ['c', 'x', 'a', 'opening', 'More', 'y'], device + ': X above More, More still open');
      await press(p, device, '#messages .stack-more');
      await becomes(() => pageShown(p, ids), ['c', 'x', 'a', 'opening', 'More'], device + ': More closed');
      await openReader(p, device, ids.x, 'Stack X');
      await readerStep(p, device, 'above', 'Stack C.', '↑ from X is C');
      await readerEnd(p, device, 'above', '↑ from C goes nowhere: Y is below a closed More');
      await readerStep(p, device, 'below', 'Stack X', '↓ from C is X');
      await readerStep(p, device, 'below', 'Stack A.', '↓ from X is A');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading stacks shown order: Undo of Move below More, then the Reader steps through the dossier again; a link to a put-aside dossier still works', async () => {
    const topic = 'shown-order-undo';
    const { ids, p, shown } = await besideMore(topic);
    // ⌘Z brings B back: the Reader goes through it again.
    await keyTo(p, ids.a);
    await p.key('z', 4);
    await until(async () => !(await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Undo brings B back in Core');
    await becomes(shown, ['c', 'b', 'a'], 'B back above');
    await openReader(p, 'laptop', ids.a, 'Stack A.');
    await readerStep(p, 'laptop', 'above', 'Stack B', '↑ from A is B again after Undo');
    await readerStep(p, 'laptop', 'above', 'A reply to C.', '↑ from B is C\'s reply');
    await readerStep(p, 'laptop', 'above', 'Stack C.', '↑ from C\'s reply is C, order within the dossier kept');
    await closeReader(p, 'laptop');
    // Put aside again, then a link to B: it opens, and the Reader steps from it along the page.
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'B below More again');
    await becomes(shown, ['c', 'a', 'More'], 'B below More');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.b} please.`, read: true })).result.message_id;
    const link = card(linking) + ' a.words-link';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the link arrives');
    await centre(p, link); await p.point(link);
    await until(async () => (await readerOn(p))?.startsWith('Stack B'), 'the link to B, put aside, opens it');
    observations.push({ name: 'shown order link', engine, shownWithLink: await shown() });
    await readerStep(p, 'laptop', 'below', 'Stack A.', '↓ from B, revealed for the link where it sits, is A');
    assert.ok((await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'the link cleared no choice');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks shown order: the Reader keeps the order within a dossier, folded replies included, beside one put aside', async () => {
    const topic = 'shown-order-folded';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'First reply to C.', read: true }],
      ['c2', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'Second reply to C.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    await putAsideBy(p, 'laptop', topic, ids.b);
    await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More'], 'B below More');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.c1, operation_id: topic + '-fold', args: { folded: true } });
    await until(async () => (await actsOf(topic, ids.c1))?.folded === true, 'C\'s first reply is folded');
    await openReader(p, 'laptop', ids.a, 'Stack A.');
    await readerStep(p, 'laptop', 'above', 'Second reply to C.', '↑ from A is C\'s newest reply');
    await readerStep(p, 'laptop', 'above', 'First reply to C.', '↑ again is C\'s first reply');
    await readerStep(p, 'laptop', 'above', 'Stack C.', '↑ again is C');
    await readerEnd(p, 'laptop', 'above', '↑ from C, the top, goes nowhere');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks shown order: while the Reader is open, another device putting a dossier aside or bringing it back changes what ↑ offers at once', async () => {
    // A, C, Y oldest first. The Reader is on C, with Y above it; another device puts Y below More, then brings it back.
    const topic = 'shown-order-redrawn';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }],
      ['y', { sender: other, addressees: [facts.actor], body: 'Stack Y, put aside.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => pageShown(p, ids), ['y', 'c', 'a', 'opening'], 'newest on top');
    await openReader(p, 'laptop', ids.c, 'Stack C.');
    await until(async () => (await stepsOffered(p)).above, 'laptop: ↑ from C is offered, Y above it');
    const q = await open(topic + '-other', 'laptop', topic, ids.a);
    await putAsideBy(q, 'laptop', topic, ids.y);
    await p.send('Page.bringToFront');
    await becomes(() => pageShown(p, ids), ['c', 'a', 'opening', 'More'], 'the Reader\'s page hears Y went below More');
    await becomes(async () => (await stepsOffered(p)).above, false, '↑ from C is no longer offered: Y went below More on another device');
    await q.send('Page.bringToFront');
    await press(q, 'laptop', '#messages .stack-more');
    await menuOf(q, 'laptop', ids.y); await choose(q, 'laptop', 'Bring back above More');
    await until(async () => !(await view('stack_positions', { topic_id: topic, message_ids: [ids.y] })).items[0].stack_position.below, 'Core holds Y above More again');
    await q.close(); await p.send('Page.bringToFront');
    await becomes(() => pageShown(p, ids), ['y', 'c', 'a', 'opening'], 'the Reader\'s page hears Y came back');
    await readerStep(p, 'laptop', 'above', 'Stack Y', '↑ from C is offered again, and opens Y');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks shown order: the New line beside a dossier put below a closed More takes the first place shown after it', async () => {
    // A read; B, C and C's reply new. B, the oldest new, is put below More: the line goes under C, above A,
    // not below the More button.
    const topic = 'shown-order-new-line';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.' }]]);
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    const lined = q => q.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.dataset.line?'New':e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??(e.classList.contains('own-message')||e.querySelector?.('.own-message')?'opening':null)).filter(Boolean)`);
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => lined(p), ['c', 'b', 'New', 'a', 'opening'], 'the line under B, the oldest new');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await becomes(() => lined(p), ['c', 'New', 'a', 'opening', 'More'], 'with B below More, the line sits under C, the first place shown after B');
    await p.close();
    const q = await open(topic + '-again', 'laptop', topic, ids.a);
    await becomes(() => lined(q), ['c', 'New', 'a', 'opening', 'More'], 'opened again, the same');
    assert.deepEqual(q.errors, []);
    await q.close();
  });

  // The New line is placed again each time the stacks are drawn: a line placed while More was open does not stay
  // below More once it closes. This case began as an independent review's.
  await check('reading stacks shown order: after More opens, an act arrives and More closes, the New line is not left below the closed More', async () => {
    const topic = 'new-line-more-closes';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.' }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.' }],
      ['c1', { sender: other, reply_to: 'c', addressees: [facts.actor], body: 'A reply to C.' }]]);
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    const lined = q => q.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length)
      .map(e=>e.dataset.line?'New':e.classList.contains('stack-more')?'More':(${JSON.stringify(names)})[e.dataset.id??e.dataset.stack]??(e.classList.contains('own-message')||e.querySelector?.('.own-message')?'opening':null)).filter(Boolean)`);
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => lined(p), ['c', 'b', 'New', 'a', 'opening'], 'the line under B, the oldest new');
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await becomes(() => lined(p), ['c', 'New', 'a', 'opening', 'More'], 'with B below More, the line sits under C');
    await press(p, 'laptop', '#messages .stack-more');
    await until(async () => (await lined(p)).includes('b'), 'More opens: B shows');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-star', args: { starred: true } });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).dataset.starred==='true'`), 'the star reaches the page');
    const open_ = await lined(p);
    await press(p, 'laptop', '#messages .stack-more');
    await until(async () => !(await lined(p)).includes('b'), 'More closes: B goes');
    const closed = await lined(p);
    assert.deepEqual(closed, ['c', 'New', 'a', 'opening', 'More'], `with More closed again the line is not below More (More open after the star: ${JSON.stringify(open_)})`);
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // rv355r7 (independent review): the New line is placed again on every draw, including More's own press, which draws
  // the stacks again outside keepListAnchor (state.again). The line moving from above the window to below More must not
  // move what the person sees: More stays under the pointer, opened and closed again.
  await check('reading stacks shown order: opening and closing More moves the New line but not what the reader sees', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'rv7-line-jump-' + device;
      const said = [['a0', { sender: other, join: true, addressees: [facts.actor], body: 'Read 0, an older message.' }]];
      for (let n = 1; n < 22; n++) said.push(['a' + n, { sender: other, addressees: [facts.actor], body: `Read ${n}, an older message.`, ...(n === 21 ? { read: true } : {}) }]);
      said.push(['b', { sender: other, addressees: [facts.actor], body: 'Stack B, the oldest new, put aside.' }],
        ['c', { sender: other, addressees: [facts.actor], body: 'Stack C, new.' }],
        ['d', { sender: other, addressees: [facts.actor], body: 'Stack D, new.' }]);
      const ids = await seed(topic, said);
      const p = await open(topic, device, topic, ids.d);
      const lineAt = () => p.evaluate(`(()=>{const l=document.querySelector('#messages > [data-line]');if(!l||!l.getClientRects().length)return null;const prev=l.previousElementSibling;return prev?.dataset.id??prev?.dataset.stack??prev?.className??null})()`);
      await until(async () => (await lineAt()) === ids.b, `${device}: the line under B, the oldest new`);
      // B goes below More as another device puts it there (the menu's own move is checked elsewhere).
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.b, operation_id: topic + '-aside',
        args: { through: (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq } });
      await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
      await until(async () => (await lineAt()) === ids.c, `${device}: with B below a closed More, the line sits under C`);
      // More at the bottom of the window, the line well above it.
      await p.evaluate(`document.querySelector('#messages .stack-more').scrollIntoView({block:'end'}),scrollBy(0,40)`);
      await twoFrames(p); await away(p);
      const where = () => p.evaluate(`(()=>{const m=document.querySelector('#messages .stack-more').getBoundingClientRect(),l=document.querySelector('#messages > [data-line]')?.getBoundingClientRect();
        return {more:Math.round(m.top),line:l?Math.round(l.top):null,scroll:Math.round(scrollY)}})()`);
      const before = await where();
      assert.ok(before.line !== null && before.line < 0 && before.more > 0 && before.more < (await p.evaluate('innerHeight')), `${device}: More in the window, the line above it (${JSON.stringify(before)})`);
      await press(p, device, '#messages .stack-more');
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).getClientRects().length>0`), `${device}: More opens: B shows`);
      await twoFrames(p);
      const opened = await where();
      assert.equal(await lineAt(), ids.b, `${device}: with More open the line goes under B`);
      assert.ok(Math.abs(opened.more - before.more) <= 1, `${device}: opening More leaves More where it was under the pointer (before ${JSON.stringify(before)}, after ${JSON.stringify(opened)})`);
      await press(p, device, '#messages .stack-more');
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).getClientRects().length===0`), `${device}: More closes: B goes`);
      await twoFrames(p);
      const closed = await where();
      assert.equal(await lineAt(), ids.c, `${device}: with More closed again the line is back under C`);
      assert.ok(Math.abs(closed.more - opened.more) <= 1, `${device}: closing More leaves More where it was under the pointer (open ${JSON.stringify(opened)}, closed ${JSON.stringify(closed)})`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 354, Tony's case: ⇧⌘↑ on an older stack whose replies were all read, into the newer message on its
  // own above it. Drawn as a stack is by default, the stack it went into showed its head as one row and only
  // its newest reply, with neither the joined message nor its join line, and the keys went to the head.
  await check('reading stacks a join you make shows where it went: the stack it went into open, its head and the joined messages under their join line, the keys on the message you acted on, in the window; a join made elsewhere opens nothing', async () => {
    // The stack headed by head as the page shows it, with the keys' message, whether the acted message and the
    // join line before the joined stack's first message (joined) are in the window, uncovered (a pixel's leeway
    // for an edge that scrolling to it leaves a fraction past the window), and where the page went since from,
    // what placeOf read before the join: 'kept' when the list's frame or the card still has not moved in the window
    // (a browser that keeps the page's place by a card the reader sees holds that card, and the frame moves by the
    // room a stack's tab takes above a message that was on its own; one that holds what is above the list holds
    // the frame, and the card moves by that room); else 'to the join line at the top' when the page moved just
    // until the line's top stood a tenth of the window below the window's top, or 'to the message at the bottom'
    // when it moved just until the acted message's bottom stood a tenth of the window above the window's bottom
    // (what the keys select comes into view with that room beyond it, docs/interaction.md); anything else is how
    // far it moved, which a join that scrolls only as far as it needs never does.
    const where = async (p, ids, head, acted, joined, still, from) => {
      const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
      const now = await placeOf(p, ids[still]);
      const at = await p.evaluate(`(()=>{const inWindow=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.height>0&&r.top>=-1&&r.bottom<=innerHeight+1&&e.contains(document.elementFromPoint(r.left+r.width/2,(r.top+r.bottom)/2))};
        const c=document.querySelector(${JSON.stringify(card(ids[acted]))}),line=[...document.querySelectorAll('#messages .stack-join-line')].find(n=>n.dataset.join===${JSON.stringify(ids[joined])});
        return {acted:inWindow(c),line:inWindow(line),lineTop:line?.getBoundingClientRect().top,bottom:innerHeight-document.querySelector(${JSON.stringify(entry(ids[acted]))}).getBoundingClientRect().bottom,tenth:innerHeight*0.1}})()`);
      const went = Math.abs(now.frame - from.frame) < 1 || Math.abs(now.card - from.card) < 1 ? 'kept'
        : Math.abs(at.lineTop - at.tenth) <= 1 ? 'to the join line at the top'
          : Math.abs(at.bottom - at.tenth) <= 1 ? 'to the message at the bottom'
            : `moved ${Math.round(from.frame - now.frame)}px`;
      const shown = await look(p, ids, head);
      return { fold: shown?.fold, full: shown?.full, rows: shown?.rows, keys: names[await focusedOn(p)] ?? null, acted: at.acted, line: at.line, went };
    };
    // Where the list's frame (what holds the list, which a join leaves where it is on the page) and a message's
    // card are in the window: their tops.
    const placeOf = (p, id) => p.evaluate(`({frame:document.querySelector('#messages').parentElement.getBoundingClientRect().top,card:document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().top})`);
    // Scrolls the page so the acted message's card starts where a step needs it: its top just inside the window's
    // top ('top'), its bottom just inside the window's bottom ('bottom'), wholly above the window ('above') or wholly
    // below it ('below').
    const startAt = async (p, id, at) => {
      const r = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c.getBoundingClientRect(),at=${JSON.stringify(at)};
        scrollBy(0,{top:r.top-2,bottom:r.bottom-innerHeight+2,above:r.bottom+40,below:r.top-innerHeight-40}[at]);const n=c.getBoundingClientRect();return {top:n.top,bottom:n.bottom,h:innerHeight}})()`);
      const want = { top: [r.top, 2], bottom: [r.bottom, r.h - 2], above: [r.bottom, -40], below: [r.top, r.h + 40] }[at];
      assert.ok(Math.abs(want[0] - want[1]) < 1, `the page scrolls the card ${at}: ${JSON.stringify(r)}`);
    };
    const seeds = (older, newer, newerReplies) => [[older, { sender: other, join: true, addressees: [facts.actor], body: `Stack ${older}, older.`, read: true }],
      [older + '1', { sender: other, reply_to: older, addressees: [facts.actor], body: `A read reply to ${older}.`, read: true }],
      [older + '2', { sender: other, reply_to: older, addressees: [facts.actor], body: `Another read reply to ${older}.`, read: true }],
      [newer, { sender: other, addressees: [facts.actor], body: `Stack ${newer}, newer.`, read: true }],
      ...Array.from({ length: newerReplies }, (_, n) => [newer + (n + 1), { sender: other, reply_to: newer, addressees: [facts.actor], body: `A read reply to ${newer}.`, read: true }])];
    const line = 'join: Joined from its own stack by You';

    // ⇧⌘↑ into B on its own above A's stack: from A's first message, with A and the place its join line takes in
    // the window already; from A's last reply with its card at the window's top, wholly above the window, and wholly
    // below it; each undone by ⌘Z. Then the ⋯ menu's join, and Split back out.
    let topic = 'stack-join-shows-up';
    let ids = await seed(topic, seeds('a', 'b', 0));
    let p = await open(topic, 'laptop', topic, ids.a);
    await p.evaluate(`document.body.style.paddingTop = document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B on its own above A\'s stack');
    await keyTo(p, ids.a);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).scrollIntoView({block:'start'})`);
    let from = await placeOf(p, ids.b);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['b'], '⇧⌘↑ joins A\'s stack into B');
    await becomes(() => where(p, ids, 'b', 'a', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a', acted: true, line: true, went: 'kept' },
      '⇧⌘↑: B open, its own message whole, then A under its join line with every reply; the keys on A, in the window with its join line, and the page where it was');
    await shot(p, 'stack-join-shows-up');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['b', 'a'], '⌘Z puts A\'s stack back');
    assert.equal(await focusedOn(p), ids.a, '⌘Z leaves the keys on A, as before');
    for (const [at, place, went] of [['top', 'at the window\'s top', 'to the join line at the top'], ['above', 'above the window', 'to the join line at the top'], ['below', 'below the window', 'to the message at the bottom']]) {
      await keyTo(p, ids.a2);
      await startAt(p, ids.a2, at);
      from = await placeOf(p, ids.b);
      await p.key('ArrowUp', 12);
      await becomes(() => stacks(p, ids), ['b'], `⇧⌘↑ from A's last reply ${place} joins A's stack into B`);
      await becomes(() => where(p, ids, 'b', 'a2', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a2', acted: true, line: true, went },
        `⇧⌘↑ from A's last reply ${place}: the keys on it, in the window with A's join line, the page scrolled ${went}`);
      await p.key('z', 4);
      await becomes(() => stacks(p, ids), ['b', 'a'], `⌘Z puts A's stack back (from ${place})`);
    }
    await menuOf(p, 'laptop', ids.a2);
    from = await placeOf(p, ids.b);
    await choose(p, 'laptop', 'Join the stack above');
    await becomes(() => stacks(p, ids), ['b'], '⋯ Join the stack above joins A\'s stack into B');
    await becomes(() => where(p, ids, 'b', 'a2', 'a', 'b', from), { fold: 'open', full: true, rows: [line, 'a', 'a1', 'a2'], keys: 'a2', acted: true, line: true, went: 'kept' },
      '⋯: B open with A under its join line; the keys on the reply the menu was opened on, in the window with the join line');
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'Split back out takes A out again');
    assert.deepEqual(p.errors, []);
    await p.close();

    // ⇧⌘↓ on a reply of D, into C's stack below it, read against E, on its own above both: with E's card half a
    // tenth of the window below the window's top, where the join carries D's reply into the window's bottom tenth
    // (with half a tenth to spare either way: the cards of a stack, overlapping by 12px, stand closer than they did
    // with a gap between them, and E at the very top left D's reply 1px short of that tenth), then with its card at
    // the window's bottom, where the join carries it below the window.
    const newest = ['e', { sender: other, addressees: [facts.actor], body: 'On its own, newest.', read: true }];
    topic = 'stack-join-shows-down';
    ids = await seed(topic, [...seeds('c', 'd', 2), newest]);
    p = await open(topic, 'laptop', topic, ids.c);
    await p.evaluate(`document.body.style.paddingTop = document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], 'D\'s stack above C\'s');
    await keyTo(p, ids.d2);
    await p.evaluate(`(()=>{document.querySelector(${JSON.stringify(card(ids.e))}).scrollIntoView({block:'start'});scrollBy(0,-innerHeight*0.05)})()`);
    from = await placeOf(p, ids.e);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['e', 'c'], '⇧⌘↓ joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      '⇧⌘↓: C open, its own message whole and its replies, then D under its join line with every reply; the keys on D\'s reply, which the join carries into the window\'s bottom tenth, so the page scrolls just until a tenth shows below it, with the join line');
    await p.key('z', 4);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], '⌘Z puts D\'s stack back');
    assert.equal((await look(p, ids, 'c')).fold, 'folded', '⌘Z puts back how far C was folded');
    await keyTo(p, ids.d2);
    await startAt(p, ids.d2, 'bottom');
    from = await placeOf(p, ids.e);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['e', 'c'], '⇧⌘↓ from D\'s reply at the window\'s bottom joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      '⇧⌘↓ from D\'s reply at the window\'s bottom: the join carries it below the window, and the page scrolls down just until it shows, with its join line');
    assert.deepEqual(p.errors, []);
    await p.close();

    // On a phone, ⋯'s Move or join… sheet, from where the page opened: on the phone's shorter window the join
    // carries D's reply below it.
    topic = 'stack-join-shows-phone';
    ids = await seed(topic, [...seeds('c', 'd', 2), newest]);
    p = await open(topic, 'phone', topic, ids.c);
    await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
    await becomes(() => stacks(p, ids), ['e', 'd', 'c'], 'phone: D\'s stack above C\'s');
    await menuOf(p, 'phone', ids.d2);
    await choose(p, 'phone', 'Move or join…');
    await until(() => p.evaluate(`[...document.querySelectorAll('.message-menu-list.menu-sheet button')].some(b=>b.firstChild.textContent==='Join the stack below')`), 'phone: the second sheet');
    from = await placeOf(p, ids.e);
    await choose(p, 'phone', 'Join the stack below');
    await becomes(() => stacks(p, ids), ['e', 'c'], 'phone: the sheet joins D\'s stack into C');
    await becomes(() => where(p, ids, 'c', 'd2', 'd', 'e', from), { fold: 'open', full: true, rows: ['c1', 'c2', line, 'd', 'd1', 'd2'], keys: 'd2', acted: true, line: true, went: 'to the message at the bottom' },
      'phone: C open with D under its join line; the keys on the reply the sheet was opened on, which the join carries below the phone\'s window, scrolled just into it with the join line');
    await shot(p, 'stack-join-shows-phone');
    assert.deepEqual(p.errors, []);
    await p.close();

    // A join someone else makes reaches the page as it always has: nothing opens under the reader.
    topic = 'stack-join-shows-theirs';
    ids = await seed(topic, seeds('a', 'b', 0));
    p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B on its own above A\'s stack');
    await control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: ids.a, operation_id: topic + '-join', args: { into: ids.b } });
    await becomes(() => stacks(p, ids), ['b'], 'their join reaches the page');
    const theirs = await look(p, ids, 'b');
    assert.deepEqual({ fold: theirs.fold, full: theirs.full, rows: theirs.rows }, { fold: 'folded', full: false, rows: ['a2'] },
      'their join draws B as any stack is drawn: its head as one row and its newest reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Item 361, Tony's case: a join makes the two stacks one, so a reply to any message in it lands at the bottom.
  await check('reading stacks a join makes one stack: every message of both oldest first under its head, a new reply to the joined stack\'s message lands at the bottom, the keys and the phone read the same, and Split back out puts both back', async () => {
    const topic = 'stack-join-one';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A, older.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, newer.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['a2', { sender: other, reply_to: 'a', addressees: [facts.actor], body: 'A reply to A.', read: true }],
      ['b3', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'Another reply to B.', read: true }]]);
    const line = 'join: Joined from its own stack by You';
    const toggle = `#messages .reply-stack[data-stack="${ids.b}"] > .stack-toggle`;
    const p = await open(topic, 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'B above A');
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 12);
    await becomes(() => stacks(p, ids), ['b'], '⇧⌘↑ joins A into B');
    // Fully open, every message shows: a join you make that already opens it (release 58) needs no press.
    if ((await look(p, ids, 'b')).fold !== 'open') await press(p, 'laptop', toggle);
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3'], 'B\'s head, then A under its join line, b1, a2, b3: one run by when each was written');
    const reply = async (name, to, body) => { ids[name] = (await control({ method: 'agent_message', operation_id: `${topic}-${name}`, topic_id: topic, source: 'topic', sender: other, reply_to: ids[to], addressees: [facts.actor], body })).result.message_id; };
    await reply('a6', 'a', 'A new reply to A, after the join.');
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6'], 'a new reply to the joined stack\'s message lands at the bottom');
    await reply('b7', 'b1', 'A new reply to B\'s reply.');
    await becomes(async () => (await look(p, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6', 'b7'], 'and a new reply to B\'s own reply lands under it');
    assert.deepEqual(await stacks(p, ids), ['b'], 'still one stack');
    // The keys step down the stack in the same order.
    await keyTo(p, ids.b);
    const stepped = [];
    for (let n = 0; n < 6; n++) { await p.key('ArrowDown'); const at = await focusedOn(p); stepped.push(Object.keys(ids).find(key => ids[key] === at) ?? at); }
    assert.deepEqual(stepped, ['a', 'b1', 'a2', 'b3', 'a6', 'b7'], '↓ from B\'s head steps down the one run');
    await shot(p, 'stack-join-one');
    // The phone, opening the topic afresh, reads the same run.
    const q = await open(topic + '-phone', 'phone', topic, ids.b);
    await becomes(async () => (await look(q, ids, 'b')).fold, 'folded', 'phone: latest and unread first');
    await press(q, 'phone', toggle);
    await becomes(async () => (await look(q, ids, 'b')).rows, [line, 'a', 'b1', 'a2', 'b3', 'a6', 'b7'], 'phone: fully open, the same one run');
    assert.deepEqual(q.errors, []);
    await q.close();
    // Split back out: B as it was with its own replies, A on its own again.
    await p.point(`#messages .stack-join-line .stack-split`);
    await becomes(() => stacks(p, ids), ['b', 'a'], 'Split back out: two stacks again');
    await becomes(async () => (await look(p, ids, 'b')).rows, ['b1', 'b3', 'b7'], 'B keeps only its own replies, oldest first, and no join line');
    await until(async () => (await actsOf(topic, ids.a, other))?.joined === null, 'for everyone');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a head shown as one row has no bar; shown whole, its bar sits below the head row, never across where the tab meets the stack', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-bar-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Is the gate code still 4471?\nAsking before Saturday.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It is.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      // light() waits for the head to light with no bar.
      await light(p, device, ids.root);
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => (await look(p, ids, 'root')).full, `${device}: a press on the head shows its full message`);
      await until(async () => await bar(p) !== null, `${device}: shown whole, the head has its bar`);
      const place = await p.evaluate(`(()=>{const b=document.querySelector('.message-bar').getBoundingClientRect(),c=document.querySelector(${JSON.stringify(card(ids.root))}),
        row=c.querySelector(':scope > .stack-head').getBoundingClientRect(),box=c.getBoundingClientRect();return {belowRow:b.top>=row.bottom,onCard:b.bottom<=box.bottom}})()`);
      assert.deepEqual(place, { belowRow: true, onCard: true }, `${device}: the bar sits below the head row, on the head's card`);
      // Hidden again by another press on its row, the head loses its bar while it stays lit.
      await press(p, device, `${card(ids.root)} .stack-who`);
      await until(async () => !(await look(p, ids, 'root')).full, `${device}: another press on the head row hides it`);
      await until(async () => (await lit(p)).includes(ids.root) && await bar(p) === null, `${device}: a head shown as one row again has no bar, and stays lit`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // The head's row stands above the folder's top edge, over the head's own box, which has no height at
  // all while the head shows only its row (stack-look.css). The keys reaching the head from below
  // bring that row into view, not just the edge, whether the head shows as one row or whole.
  await check('reading stacks ↑ onto a stack\'s head from a reply at the top of the window brings the head\'s row into view, shown as one row or whole', async () => {
    const topic = 'stack-head-up';
    const ids = await seed(topic, [['before', { sender: other, join: true, addressees: [facts.actor], body: 'A message on its own, above the stack.', read: true }],
      ['root', { sender: other, addressees: [facts.actor], body: 'Which ferry do we take on Sunday?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The 9:40, it has room for the car.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
    for (const shown of ['one row', 'whole']) {
      if (shown === 'whole') {
        await press(p, 'laptop', `${card(ids.root)} .stack-who`);
        await until(async () => (await look(p, ids, 'root')).full, 'laptop: a press on the head shows it whole');
      }
      await keyTo(p, ids.one);
      // The reply at the very top of the window: its head's row is above it, out of view.
      await p.evaluate(`scrollBy(0, document.querySelector(${JSON.stringify(card(ids.one))}).getBoundingClientRect().top)`);
      await p.key('ArrowUp');
      await until(async () => await focusedOn(p) === ids.root, `laptop, head ${shown}: ↑ puts the keys on the head`);
      await twoFrames(p);
      const row = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(card(ids.root))}).querySelector(':scope > .stack-head'),b=r.getBoundingClientRect(),who=r.querySelector('.stack-who'),w=who.getBoundingClientRect();
        const hit=document.elementFromPoint(w.left+w.width/2,w.top+w.height/2);return {top:b.top,bottom:b.bottom,window:innerHeight,shown:b.top>=0&&b.bottom<=innerHeight&&who.contains(hit)}})()`);
      assert.equal(row.shown, true, `laptop, head ${shown}: the head's row is in the window, uncovered: ${JSON.stringify(row)}`);
    }
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks repeated arrows keep keyboard selection while the page scrolls under a stationary pointer', async () => {
    const topic = 'stack-stationary-pointer';
    const body = name => name + '\n' + Array.from({ length: 16 }, (_, n) => `Line ${n + 1} of a reply that makes the page scroll.`).join('\n');
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'Older stack' }],
      ['oldOne', { sender: other, reply_to: 'old', addressees: [facts.actor], body: body('Old reply one') }],
      ['oldTwo', { sender: other, reply_to: 'old', addressees: [facts.actor], body: body('Old reply two') }],
      ['new', { sender: other, addressees: [facts.actor], body: 'Newer stack' }],
      ['newOne', { sender: other, reply_to: 'new', addressees: [facts.actor], body: body('New reply one') }],
      ['newTwo', { sender: other, reply_to: 'new', addressees: [facts.actor], body: body('New reply two') }]]);
    const p = await open(topic, 'laptop', topic, ids.old);
    try {
      await light(p, 'laptop', ids.oldTwo);
      const x = await p.evaluate(`document.querySelector('#messages').getBoundingClientRect().left + 100`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 750 });
      await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.oldTwo))}).focus({preventScroll:true})`);
      const order = [ids.new, ids.newOne, ids.newTwo, ids.old, ids.oldOne, ids.oldTwo];
      for (let index = order.length - 2; index >= 0; --index) {
        const expected = order[index];
        await p.key('ArrowUp');
        await twoFrames(p);
        // WebKit can report a same-position pointermove after scrolling
        // settles, about 100ms later. Hold the selection at a person's pace.
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(await focusedOn(p), expected, 'Up moves one message upward: step ' + index);
        assert.ok((await lit(p)).includes(expected), 'scrolling under a stationary pointer does not steal the keyboard light');
      }
      // The page's existing key navigation can continue into its header;
      // another Up must not select a lower message again.
      await p.key('ArrowUp'); await twoFrames(p);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(await p.evaluate("Boolean(document.activeElement.closest('.topic-header'))"), true, 'Up past the first message reaches the header');
      assert.deepEqual(await lit(p), [], 'the header owns the focus, with no stale feed selection');
      // The pointer can take over again as soon as it actually moves.
      const target = await p.evaluate(`(()=>{const e=document.elementFromPoint(${x},750);return e?.closest('[data-id]')?.dataset.id})()`);
      assert.ok(target && target !== order[0], 'a different message is under the resting pointer');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 1, y: 750 });
      await until(async () => (await lit(p)).includes(target), 'real mouse movement resumes hover selection');
      await shot(p, 'stack-stationary-pointer');
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });

  await check('reading stacks the bar stays in the window while any of its card is, and scrolls away with it, in a stack or on its own', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-bar-away-' + device;
      const ids = await seed(topic, [['alone', { sender: other, join: true, addressees: [facts.actor], body: 'A message on its own, with no replies.', read: true }],
        ['root', { sender: other, addressees: [facts.actor], body: 'Who has the spare key?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It hangs by the door.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      // Room to scroll a card well above the window, whatever the window's height.
      await p.evaluate(`document.body.style.paddingBottom = '2000px'`);
      const barAt = () => p.evaluate(`(()=>{const b=document.querySelector('.message-bar');if(!b||b.hidden)return null;const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,window:innerHeight}})()`);
      // Scrolls so the card's bottom edge sits at y in the window.
      const bottomAt = (id, y) => p.evaluate(`scrollBy(0, document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().bottom - (${y}))`);
      for (const [name, id] of [['a reply in a stack', ids.one], ['a card on its own', ids.alone]]) {
        assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(id))}).closest('.reply-stack'))`), id === ids.one, `${device}: ${name} is ${id === ids.one ? '' : 'not '}in a stack`);
        await light(p, device, id);
        // Leave the pointer still: scrolling must preserve the selected card.
        const { height } = await barAt();
        // A little of the card's bottom still in the window: its bar is there too.
        await bottomAt(id, height + 10);
        let seen;
        await until(async () => { seen = await barAt(); return seen && seen.top >= 0 && seen.bottom <= height + 10 + 1; }, `${device}: ${name}'s bar stays in the window while its bottom does`)
          .catch(error => assert.fail(`${error.message}: ${JSON.stringify(seen)}`));
        // The card's bottom 150px above the window: its bar has gone with it, over nothing else on the page.
        await bottomAt(id, -150);
        await until(async () => { seen = await barAt(); return seen && seen.bottom <= 0; }, `${device}: ${name}'s bar scrolls away with it`)
          .catch(error => assert.fail(`${error.message}: ${JSON.stringify(seen)}`));
        assert.deepEqual((await lit(p)).includes(id), true, `${device}: ${name} stays lit, its bar out of the window with it`);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  // A finger's tap lights a card. The first mouse move after it, with the pointer never placed, only places it: WebKit
  // sends a mouse's move after a scroll that follows a tap, and it once took the light (and the bar) from the tapped
  // card at random. A move after that is a pointer's own, and acts as one: over another card it lights it, over
  // nothing it lets the light go.
  await check('reading stacks a tap\'s light stays through the first mouse move after it, which only places the pointer; moves after it light another card or let the light go', async () => {
    const topic = 'stack-tap-then-mouse';
    const ids = await seed(topic, [['alone', { sender: other, join: true, addressees: [facts.actor], body: 'A message on its own.', read: true }],
      ['root', { sender: other, join: true, addressees: [facts.actor], body: 'Who has the spare key?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It hangs by the door.', read: true }]]);
    const p = await open(topic, 'phone', topic, ids.root);
    await light(p, 'phone', ids.one);
    await away(p); await twoFrames(p);
    assert.deepEqual([(await lit(p)).includes(ids.one), await bar(p) !== null], [true, true], 'the first mouse move after the tap leaves the tapped card lit, with its bar');
    await centre(p, words(ids.alone)); await p.point(words(ids.alone), 'move');
    await until(async () => (await lit(p)).includes(ids.alone) && !(await lit(p)).includes(ids.one) && await bar(p) !== null, 'the next move, over another card, lights it with its bar');
    await away(p);
    await until(async () => (await lit(p)).length === 0, 'and a move over nothing lets the light go');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A reply lit under the pointer and then folded away in its stack has no
  // box for its bar to sit over: the light goes, and no bar is left lying
  // over the stack's fold line, where the pointer goes next to open it again.
  await check('reading stacks a lit reply its stack folds away takes its light and its bar with it, and its fold line can be pressed again', async () => {
    const topic = 'stack-bar-folded';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Which room is the meeting in?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room four, upstairs.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room four is booked, so room six.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Room six it is.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const line = `#messages .reply-stack[data-stack="${ids.root}"] .stack-toggle`;
    const shows = async () => (await look(p, ids, 'root')).rows.includes('one');
    await centre(p, line);
    await press(p, 'laptop', line);
    await until(shows, 'laptop: the fold line opens the earlier replies');
    await light(p, 'laptop', ids.one);
    // The pointer goes up to the fold line just above, which lights nothing, and folds the lit reply away.
    assert.deepEqual(await lit(p), [ids.one], 'laptop: the reply is lit');
    await press(p, 'laptop', line);
    await until(async () => !await shows(), 'laptop: the fold line folds the lit reply away');
    await twoFrames(p);
    assert.deepEqual({ lit: await lit(p), bar: await bar(p) }, { lit: [], bar: null }, 'laptop: the folded reply keeps no light, and no bar is left on the page');
    // The next press opens them all again.
    await press(p, 'laptop', line);
    await until(shows, 'laptop: the fold line, pressed again, opens the earlier replies');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a reply arriving while a press is held is drawn once it ends, so nothing moves under the pointer and the press lands where it began', async () => {
    // A pointer's press: a finger held as long can turn into a long press, which ends the hold by its menu.
    const topic = 'stack-held-press';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Who is bringing the ladder?', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'I can bring it.', read: true }],
      ['later', { sender: other, addressees: [facts.actor], body: 'The van is parked out front.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.later);
    await centre(p, words(ids.later));
    const at = await p.box(words(ids.later)), x = at.x + at.width / 2, y = at.y + at.height / 2;
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    // The pointer resting on the message moved nothing: it is still under it.
    assert.equal((await p.box(words(ids.later))).y, at.y, 'laptop: the message pressed is where it was aimed at');
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    const body = 'A new reply while the press is held.';
    await p.evaluate(`(window.watched = false, window.watchFor = ${JSON.stringify({ read: 'topic_messages', words: body })})`);
    const arrived = (await control({ method: 'agent_message', operation_id: `${topic}-held`, topic_id: topic, source: 'topic', sender: other, reply_to: ids.root, addressees: [facts.actor], body })).result.message_id;
    await until(() => p.evaluate('window.watched'), 'laptop: the page read the topic\'s new messages, the new reply among them, while the press is held');
    // Two frames on, a reply drawn at once would be on the page.
    await p.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const held = await p.evaluate(`({top:document.querySelector(${JSON.stringify(words(ids.later))}).getBoundingClientRect().top,
      under:document.querySelector(${JSON.stringify(card(ids.later))}).contains(document.elementFromPoint(${x},${y})),drawn:Boolean(document.querySelector(${JSON.stringify(card(arrived))}))})`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    assert.deepEqual(held, { top: at.y, under: true, drawn: false }, 'laptop: while the press is held, the new reply waits and the message pressed stays under the pointer');
    await until(async () => (await readerOn(p))?.startsWith('The van is parked out front.'), 'laptop: the click lands on the message pressed and opens it');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(arrived))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(ids.root)}`), 'laptop: once the press ends the new reply is drawn into its stack');
    // The click above opens the Reader, which draws the page again whatever the release did. Held where
    // its click opens nothing, the reply that waited is drawn by the release alone: read at once after
    // it, with no wait, it is in its stack.
    await closeReader(p, 'laptop');
    const release = await holdOnTitle(p);
    const second = 'A second reply while a press is held.';
    await p.evaluate(`(window.watched = false, window.watchFor = ${JSON.stringify({ read: 'topic_messages', words: second })})`);
    // The answers the page has taken in that hold the second reply (api.mjs
    // reads every answer, a command's or a view's, with json()). The page's own handling
    // of an answer runs on from json() in the same task (freshness.mjs, then
    // topic-views.mjs paints), so once the mark shows, the page has the reply
    // in hand and its drawing waits on the press. window.watched alone reads
    // a copy of the answer, which can come in before the page's own.
    await p.evaluate(`(()=>{const json=Response.prototype.json;window.answersTaken=0;window.repliesTaken=0;
      Response.prototype.json=function(){return json.call(this).then(value=>{window.answersTaken++;if(JSON.stringify(value).includes(${JSON.stringify(second)}))window.repliesTaken++;return value})}})()`);
    const later = (await control({ method: 'agent_message', operation_id: `${topic}-held-2`, topic_id: topic, source: 'topic', sender: other, reply_to: ids.root, addressees: [facts.actor], body: second })).result.message_id;
    await until(() => p.evaluate('window.watched && window.repliesTaken > 0'), 'laptop: the page read the second reply and has it in hand while the press on the topic\'s name is held');
    await twoFrames(p);
    const stackOf = `document.querySelector(${JSON.stringify(card(later))})?.closest('.reply-stack')?.dataset.stack ?? null`;
    assert.equal(await p.evaluate(stackOf), null, 'laptop: while the press is held, the second reply waits');
    // The release as the page hears it: a listener after the page's own
    // (press-hold.mjs, on the document) reads the stacks within the release's
    // own pointerup, once the page's handler and its microtasks have run,
    // with how many answers holding the reply the page took in since it was
    // seen waiting (other answers, such as its reports of what was read, are
    // counted for the record).
    await p.evaluate(`(()=>{const taken=window.repliesTaken,all=window.answersTaken;window.atRelease=null;
      document.addEventListener('pointerup',()=>{window.atRelease={stack:${stackOf},answers:window.repliesTaken-taken,others:window.answersTaken-all}},{capture:true,once:true})})()`);
    await release();
    const atRelease = await until(() => p.evaluate('window.atRelease'), 'laptop: the page heard the release');
    observations.push({ name: 'held press released', engine, atRelease });
    assert.deepEqual({ stack: atRelease.stack, answers: atRelease.answers }, { stack: ids.root, answers: 0 }, 'laptop: the moment the press ends, the reply that waited is drawn into its stack, by the release alone');
    assert.equal(await readerOn(p), null, 'laptop: and the press on the topic\'s name opened nothing');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // An act's answer that changes the stacks waits under a held press as a
  // reply does, and is drawn the moment the press ends (stack-feed.mjs,
  // settled). A star Core refuses: the card shows it at once, and the
  // refusal takes it away. The page also reads the acts again on its next
  // pass; any such read is held until after the release, so only the
  // release can draw the refusal.
  if (engine === 'chrome') await check('reading stacks an act\'s answer landing while a press is held is drawn the moment it ends, and not before', async () => {
    const topic = 'stack-held-act';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const starred = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.b))}).dataset.starred`);
    const starsSent = payload => payload?.kind === 'message.star', reads = payload => payload?.name === 'message_acts';
    await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
    p.intercept(payload => starsSent(payload) || reads(payload));
    await menuOf(p, 'laptop', ids.b); await choose(p, 'laptop', 'Star for me');
    await until(async () => await starred() === 'true', 'laptop: the star shows at once');
    const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'laptop: the star is on its way');
    p.held.splice(p.held.indexOf(refused), 1);
    const release = await holdOnTitle(p);
    await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
    // The page says the refusal once the stacks were told of it.
    await until(() => p.evaluate(`document.getElementById('app-status').textContent.includes('Refused for this check.')`), 'laptop: the refusal is heard while the press is held');
    await twoFrames(p);
    assert.equal(await starred(), 'true', 'laptop: while the press is held, the refusal waits and the card still shows the star');
    await release();
    assert.equal(await starred(), 'false', 'laptop: the moment the press ends, the refusal is drawn: no star');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    assert.equal(await readerOn(p), null, 'laptop: and the press on the topic\'s name opened nothing');
    assert.notEqual((await actsOf(topic, ids.b))?.starred, true, 'Core holds no star');
    await until(async () => await starred() === 'false', 'laptop: the acts read again agree: no star');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks an act\'s answer under a held press', engine, held: 'holds Core\'s answers with the Chrome harness\'s request interception, which Safari\'s harness does not offer' });

  // A press that ends with no pointerup ends all the same, or every repaint
  // after it would wait for the next tap (press-hold.mjs). Chrome's own input
  // gives each ending: a finger that scrolls (pointercancel), ⌃ and a press
  // on a Mac (its context menu), and the window losing the focus (blur, as
  // the focus going into a frame gives it). Safari's engine in this harness
  // has no finger drag, no ⌃-press menu and no blur of its own to give.
  if (engine === 'chrome') await check('reading stacks a press ends however it ends: a finger that scrolls, a context menu from the press, the window losing the focus; and what arrives is drawn without another press', async () => {
    const arrives = async (p, topic, root, label, device) => {
      const body = `A reply after ${label}.`;
      const id = (await control({ method: 'agent_message', operation_id: `${topic}-${label.replace(/\W+/g, '-')}`, topic_id: topic, source: 'topic', sender: other, reply_to: root, addressees: [facts.actor], body })).result.message_id;
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(id))})?.closest('.reply-stack')?.dataset.stack === ${JSON.stringify(root)}`), `${device}: after ${label}, a reply arriving is drawn into its stack with no other press`);
    };
    // Each press and how it ended, as the page heard them.
    const HEARD_ENDS = `(()=>{window.pressEvents=[];for(const n of ['pointerdown','pointerup','pointercancel','contextmenu'])document.addEventListener(n,e=>pressEvents.push(n),true);addEventListener('blur',()=>pressEvents.push('blur'))})()`;
    const ended = p => p.evaluate('window.pressEvents.join()');

    // A phone: a finger that scrolls the page. The browser takes the touch for
    // the scroll and cancels the pointer; no pointerup comes.
    {
      const topic = 'stack-press-scroll';
      const said = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Who has the spare paddle?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'It is in the shed.', read: true }]];
      for (let n = 0; n < 12; n++) said.push([`later${n}`, { sender: other, addressees: [facts.actor], body: `Another stack, ${n}, long enough to fill the phone's window as a topic does.`, read: true }]);
      const ids = await seed(topic, said);
      const p = await open(topic, 'phone', topic, ids.root);
      await p.evaluate(HEARD_ENDS);
      const scrolled = () => p.evaluate('Math.round(document.scrollingElement.scrollTop)');
      const before = await scrolled();
      await p.send('Input.synthesizeScrollGesture', { x: 195, y: 650, yDistance: -300, speed: 800, gestureSourceType: 'touch' });
      await until(async () => (await scrolled()) !== before, 'phone: the finger scrolled the page');
      assert.deepEqual(await ended(p), 'pointerdown,pointercancel', 'phone: the finger went down and the scroll cancelled it, with no pointerup');
      await arrives(p, topic, ids.root, 'a finger that scrolls', 'phone');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    // A laptop: ⌃ and a press on a message opens its menu (a Mac's context
    // menu from the primary button), and the window losing the focus while a
    // press is held. In each, the button is still down when the reply arrives.
    {
      const topic = 'stack-press-ends';
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'When does the ferry leave?', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'At nine.', read: true }],
        ['later', { sender: other, addressees: [facts.actor], body: 'The tickets are booked.', read: true }]]);
      const p = await open(topic, 'laptop', topic, ids.later);
      await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await p.evaluate(HEARD_ENDS);
      await centre(p, words(ids.later));
      const at = await p.box(words(ids.later)), x = at.x + at.width / 2, y = at.y + at.height / 2;
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers: 2 });
      await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'laptop: ⌃ and a press opens the message\'s menu');
      assert.equal(await ended(p), 'pointerdown,contextmenu', 'laptop: the press opened the context menu, its button still down');
      await arrives(p, topic, ids.root, 'a context menu from the press', 'laptop');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: 2 });
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'laptop: Esc closes the menu');
      // The window loses the focus with the press held: the focus goes into a frame on the page.
      await p.evaluate(`(()=>{const f=document.createElement('iframe');f.id='press-elsewhere';f.srcdoc='<p>elsewhere</p>';f.style.cssText='position:fixed;right:0;bottom:0;width:40px;height:40px';document.body.append(f);return new Promise(done=>f.onload=done)})()`);
      await p.evaluate('window.pressEvents=[]');
      await centre(p, words(ids.later));
      const again = await p.box(words(ids.later)), ax = again.x + again.width / 2, ay = again.y + again.height / 2;
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay });
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', clickCount: 1 });
      await p.evaluate(`document.getElementById('press-elsewhere').contentWindow.focus()`);
      await until(async () => (await ended(p)) === 'pointerdown,blur', 'laptop: the window lost the focus, the press still held');
      await arrives(p, topic, ids.root, 'the window losing the focus', 'laptop');
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ax, y: ay, button: 'left', clickCount: 1 });
      await p.evaluate(`document.getElementById('press-elsewhere').remove()`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading stacks the one New line sits under the lowest stack holding anything new, never inside one', async () => {
    const topic = 'stack-new-line';
    const ids = await seed(topic, [['old', { sender: other, join: true, addressees: [facts.actor], body: 'An old stack, read.' }],
      ['middle', { sender: other, addressees: [facts.actor], body: 'A stack in the middle, read.', read: true }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'A new reply in the old stack.' }],
      ['top', { sender: other, addressees: [facts.actor], body: 'The newest stack, new.' }]]);
    const p = await open('stack-new-line', 'laptop', topic, ids.old);
    await becomes(() => stacks(p, ids), ['top', 'old', 'middle'], 'the old stack rises with its new reply');
    const line = () => p.evaluate(`(()=>{const l=document.querySelector('#messages > [data-line=new]');return l?{under:l.previousElementSibling?.dataset.stack??l.previousElementSibling?.dataset.id,lines:document.querySelectorAll('#messages [data-line=new]').length,inside:Boolean(document.querySelector('.reply-stack [data-line]'))}:null})()`);
    await becomes(line, { under: ids.old, lines: 1, inside: false }, 'one New line, under the stack holding the new reply, none inside it');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the Reader\'s ↑ and ↓ follow the page: down a stack to its newer replies, then on to the stack below', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-reader-' + device;
      const ids = await seed(topic, [['below', { sender: other, join: true, addressees: [facts.actor], body: 'The stack below.' }],
        ['root', { sender: other, addressees: [facts.actor], body: 'The stack on top.' }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.' }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
      const p = await open('stack-reader-' + device, device, topic, ids.root);
      await openReader(p, device, ids.two, 'Reply two.');
      const step = async (where, starts, message) => {
        const button = device === 'phone' ? `.reader-end .end-step:${where === 'above' ? 'first' : 'last'}-child` : where === 'above' ? '#next-message' : '#previous-message';
        if (device === 'phone') await p.evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);
        await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(button)}).disabled`), `${device}: ${message}: its button can be pressed`);
        await press(p, device, button);
        await until(async () => (await readerOn(p))?.startsWith(starts), `${device}: ${message}`);
      };
      if (device === 'phone') assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('.reader-end .end-step')].map(b=>b.dataset.words)`), ['↑ Previous', '↓ Next'], 'phone: the line says ↑ Previous · ↓ Next');
      else assert.deepEqual(await p.evaluate(`['next-message','previous-message'].map(id=>document.getElementById(id).getAttribute('aria-label'))`), ['Previous message (above)', 'Next message (below)']);
      await step('above', 'Reply one.', '↑ is the reply above, the older one');
      await step('above', 'The stack on top.', '↑ again is the stack\'s first message');
      await step('below', 'Reply one.', '↓ goes down the stack');
      await step('below', 'Reply two.', '↓ to the newer reply');
      await step('below', 'The stack below.', '↓ from the stack\'s last reply is the stack below');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('reading stacks the stack keys are inert in writing, even with a message lit', async () => {
    const topic = 'stack-inert';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }], ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }]]);
    const p = await open('stack-inert', 'laptop', topic, ids.a);
    // A lit message (the keys were on it a moment ago), then the cursor goes into the writing.
    await keyTo(p, ids.a);
    await p.point('#inline-writing-body');
    assert.deepEqual(await lit(p), [], 'writing takes the light off A');
    assert.equal(await p.evaluate("document.querySelector('#messages').dataset.lastMessage"), ids.a, 'the feed remembers A without highlighting it');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is in the topic\'s writing');
    await p.send('Input.insertText', { text: 'Writing a reply' });
    for (const [key, modifiers] of [['ArrowUp', 4], ['ArrowDown', 4], ['ArrowUp', 12], ['ArrowLeft', 4], ['ArrowLeft', 0], ['ArrowRight', 0], ['z', 4]]) await p.key(key, modifiers);
    assert.deepEqual(await stacks(p, ids), ['b', 'a'], 'no stack moved or joined');
    assert.equal(await actsOf(topic, ids.a), null, 'and nothing was recorded');
    assert.equal(await p.evaluate(`document.activeElement?.id`), 'inline-writing-body', 'the writing keeps the cursor');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks on a phone ⋯ opens the acts as a sheet, and Move or join… opens the stack\'s moves in a second sheet', async () => {
    const topic = 'stack-sheet';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.' }], ['b', { sender: other, addressees: [facts.actor], body: 'Stack B.' }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }]]);
    const p = await open('stack-sheet', 'phone', topic, ids.a);
    const items = await menuOf(p, 'phone', ids.b1);
    assert.equal(await p.evaluate(`document.querySelector('.message-menu-list').classList.contains('menu-sheet')`), true, 'phone: a sheet from the bottom');
    assert.ok(items.includes('Star for me') && items.includes('Fold') && items.at(-1) === 'Move or join…', `phone: the acts, then Move or join…: ${items}`);
    await choose(p, 'phone', 'Move or join…');
    await until(() => p.evaluate(`[...document.querySelectorAll('.message-menu-list.menu-sheet button')].some(b=>b.firstChild.textContent==='Move its stack down')`), 'phone: a second sheet with the stack\'s moves');
    await shot(p, 'stack-sheet-phone');
    await choose(p, 'phone', 'Move its stack down');
    await becomes(() => stacks(p, ids), ['a', 'b'], 'phone: the stack moved down');
    await until(async () => typeof (await actsOf(topic, ids.b))?.placed === 'number', 'phone: Core holds the place');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a thumbs-up on a reply deals with its stack: coming back, its earlier unread replies fold', async () => {
    const topic = 'stack-dealt';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three, unread.' }]]);
    let p = await open('stack-dealt', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'unread replies all in view');
    await light(p, 'laptop', ids.two);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => (await actsOf(topic, ids.two))?.dealt === true, 'the thumbs-up deals with the stack up to it, in Core');
    assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'nothing folds while it is in front of the person');
    await p.close();
    // Coming back, the replies dealt with fold; three, newer, stays.
    p = await open('stack-dealt-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'coming back, the replies up to the thumbs-up fold, read');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks the reader\'s own reply in a stack deals with it: coming back, it folds to that reply', async () => {
    const topic = 'stack-replied';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }]]);
    let p = await open('stack-replied', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two'], 'both unread replies in view');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.two, addressees: [other], body: 'My answer to reply two.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'mine'], 'the reply shows in its stack, nothing folding under the person\'s eyes');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'the reply deals with the stack up to it, in Core');
    // Another message of the reader's own, not in a stack, deals with nothing.
    const alone = (await control({ method: 'agent_message', operation_id: topic + '-alone', topic_id: topic, source: 'topic', sender: facts.actor, addressees: [other], body: 'A new message of mine.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(alone))}))`), 'the message on its own shows');
    assert.deepEqual(await p.evaluate(`window.sent.filter(kind => kind === 'message.deal').length`), 1, 'a message of the reader\'s own starting no stack sends no deal');
    assert.equal((await actsOf(topic, alone))?.dealt ?? false, false, 'and Core holds none');
    assert.deepEqual(p.errors, []);
    await p.close();
    p = await open('stack-replied-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['mine'], 'coming back, the stack folds to the reader\'s reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a sent reply stays visible when its answer arrives', async () => {
    const topic = 'stack-sent-answer';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A question I am reading.' }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one'], 'the unread question is visible');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'My reply must stay while I read the answer.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'mine'], 'my sent reply joins the question');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'my reply is dealt with before the answer arrives');
    ids.answer = (await control({ method: 'agent_message', operation_id: topic + '-answer', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.mine, addressees: [facts.actor], body: 'The answer to your reply.' })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'mine', 'answer'], 'the answer does not hide my intervening reply');
    assert.equal((await look(p, ids, 'root')).full, false, 'retaining my reply does not expand the original');
    await keyTo(p, ids.root); await p.key('ArrowRight');
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'I explicitly open the whole stack');
    await p.key('ArrowLeft');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['answer'], 'folding to latest/unread again clears the temporary retention');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // Only the reader's own reply is held so: another person's reply, read as it
  // arrives, is replaced by a newer one as before; and coming back to the tab
  // with the stack off screen lets go of the reader's reply, as a later visit
  // never had it.
  await check('reading stacks a sent reply is held alone: another reader\'s read reply arriving is replaced as before, and coming back with the stack off screen lets go', async () => {
    const topic = 'stack-sent-held-alone';
    // Messages after the stack's own, enough that it is off screen with the page scrolled to its end.
    const later = Array.from({ length: 8 }, (_, n) => [`later${n}`, { sender: other, addressees: [facts.actor], read: true,
      body: `An earlier message, number ${n}, long enough to take room on the page. `.repeat(6) }]);
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }], ...later,
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'One, read.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    const rows = async () => (await look(p, ids, 'root')).rows;
    await becomes(rows, ['one'], 'the read latest shows');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'Mine.' })).result.message_id;
    await becomes(rows, ['mine'], 'my reply replaces the read latest');
    await until(async () => (await actsOf(topic, ids.mine))?.dealt === true, 'my reply is dealt with');
    // Another reader's reply that the person reads on arrival. The fixture writes it and then the person's read of it, two
    // commands; a page that read the messages between them would see it unread, and an unread reply is rightly kept in
    // view for the reader. So the page's reads of the messages wait while both are written, and it learns of the reply
    // already read, in one answer, as a reader who read it on arrival does.
    const readOnArrival = async (name, body) => {
      await p.evaluate("window.waitView = 'topic_messages'");
      await until(() => p.evaluate('window.fetchesOut === 0'), name + ': no read the page sent before is still out');
      ids[name] = (await control({ method: 'agent_message', operation_id: topic + '-' + name, topic_id: topic, source: 'topic', sender: other,
        reply_to: ids.root, addressees: [facts.actor], body, read: true })).result.message_id;
      await p.evaluate('window.letViews()');
    };
    await readOnArrival('x', 'X, read on arrival.');
    await becomes(rows, ['mine', 'x'], 'my reply stays beside the newer reply');
    await readOnArrival('y', 'Y, read on arrival.');
    await becomes(rows, ['mine', 'y'], 'another reader\'s read reply is replaced by a newer one, not held as mine is');
    // The reader scrolls to the end of the page, where the stack is off screen, and comes back to the tab.
    const offScreen = () => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card(ids.root))}).closest('.reply-stack').getBoundingClientRect();return b.bottom<=0||b.top>=innerHeight})()`);
    if (engine === 'chrome') {
      const elsewhere = await open(topic + '-elsewhere', 'laptop', topic, ids.root);
      await until(() => p.evaluate("document.visibilityState === 'hidden'"), 'with another tab in front, the page is hidden');
      await p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');
      assert.equal(await offScreen(), true, 'at the end of the page the stack is off screen');
      await p.send('Page.bringToFront');
      await until(() => p.evaluate("document.visibilityState === 'visible'"), 'the page is shown again');
      await elsewhere.close();
    } else {
      // Safari's headless harness never hides a page behind another, so it says the page is shown again itself.
      await p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');
      assert.equal(await offScreen(), true, 'at the end of the page the stack is off screen');
      await p.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    }
    await becomes(rows, ['y'], 'coming back with the stack off screen lets go of my reply');
    assert.deepEqual(p.errors, []);
    await p.close();
    const q = await open(topic + '-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(q, ids, 'root')).rows, ['y'], 'a later visit does not hold my reply');
    assert.deepEqual(q.errors, []);
    await q.close();
  });

  // A reply of the reader's own from another device, dealt with there, that
  // arrives in one answer with its answer: the first draw with them in holds it.
  await check('reading stacks a sent reply arriving already dealt with, in one update with its answer, shows from the first draw', async () => {
    const topic = 'stack-sent-elsewhere';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'One, read.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one'], 'the read latest shows');
    await p.evaluate("window.waitView = 'topic_messages'");
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.one, addressees: [other], body: 'Mine, from my phone.' })).result.message_id;
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.deal', message_id: ids.mine, operation_id: topic + '-deal', args: { dealt: true } });
    ids.answer = (await control({ method: 'agent_message', operation_id: topic + '-answer', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.mine, addressees: [facts.actor], body: 'The answer, read on arrival.', read: true })).result.message_id;
    await until(() => p.evaluate('window.waitingViews.length > 0'), 'the page went to read the new messages, and its read waits');
    // What the stack showed the first time the answer was drawn in it.
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    await p.evaluate(`(()=>{window.firstRows=null;const names=${JSON.stringify(names)},shown=e=>e.getClientRects().length>0;
      new MutationObserver((_,o)=>{const c=document.querySelector(${JSON.stringify(card(ids.answer))}),s=c?.closest('.reply-stack');if(!s||!shown(c))return;
        window.firstRows=[...s.querySelector(':scope > .stack-replies').children].filter(shown).map(e=>names[e.dataset.id]??e.className);o.disconnect()})
        .observe(document.getElementById('messages'),{childList:true,subtree:true,attributes:true})})()`);
    await p.evaluate('window.letViews()');
    await until(() => p.evaluate('window.firstRows !== null'), 'the answer is drawn in the stack');
    assert.deepEqual(await p.evaluate('window.firstRows'), ['mine', 'answer'], 'the first draw with them in shows my reply beside its answer');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['mine', 'answer'], 'and it stays');
    assert.equal(await p.evaluate(`window.sent.filter(kind => kind === 'message.deal').length`), 0, 'a reply dealt with elsewhere sends no deal from here');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a reply arriving replaces the read latest in the partial view', async () => {
    const topic = 'stack-arrive';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, read.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, read.', read: true }]]);
    let p = await open('stack-arrive', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['two'], 'the newest reply shows, the earlier one folded');
    ids.three = (await control({ method: 'agent_message', operation_id: 'stack-arrive-three', topic_id: topic, source: 'topic', sender: other,
      reply_to: ids.root, addressees: [facts.actor], body: 'Reply three, read.', read: true })).result.message_id;
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'the new latest replaces the older read latest');
    await p.close();
    p = await open('stack-arrive-back', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['three'], 'coming back, two folds with the earlier reply');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a link in a message to a folded reply opens its stack and lands on it', async () => {
    const topic = 'stack-link';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, folded away.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
    const linking = (await control({ method: 'agent_message', operation_id: 'stack-link-to', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.one} for that.`, read: true })).result.message_id;
    const p = await open('stack-link', 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['two'], 'reply one is folded away');
    await centre(p, `${card(linking)} a.words-link`);
    await p.point(`${card(linking)} a.words-link`);
    await until(async () => (await look(p, ids, 'root')).fold === 'open' && await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).getClientRects().length>0`), 'the link opens its stack, the reply in view');
    await until(async () => (await readerOn(p))?.startsWith('Reply one'), 'and opens it in the Reader, as a link to a message here does');
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await check('reading stacks a card a join or a move carries keeps its table scrolled sideways', async () => {
    const topic = 'stack-carry';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A, older.' }],
      ['a1', { sender: other, reply_to: 'a', addressees: [facts.actor], body: 'A reply to A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, newer.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table }],
      ['c', { sender: other, addressees: [facts.actor], body: 'A message on its own, the newest.', read: true }]]);
    const p = await open('stack-carry', 'laptop', topic, ids.a);
    await becomes(() => stacks(p, ids), ['c', 'b', 'a'], 'three stacks');
    const wrap = `${card(ids.b1)} .md-table-wrap`;
    const scrolled = () => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(wrap)});return {left:w.scrollLeft,fade:w.classList.contains('md-more-left'),over:w.scrollWidth-w.clientWidth}})()`);
    await until(async () => (await scrolled()).over > 100, 'the table is wider than its card');
    await centre(p, wrap);
    const b = await p.box(wrap);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x + b.width / 2, y: b.y + b.height / 2, deltaX: 300, deltaY: 0 });
    await until(async () => (await scrolled()).left > 100 && (await scrolled()).fade, 'the wheel scrolls the table sideways; its left edge fades');
    const left = (await scrolled()).left;
    // ⇧⌘↓ on B joins it into A: B's cards move into A's stack.
    await keyTo(p, ids.b);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['c', 'a'], 'B joined into A');
    await until(async () => (await look(p, ids, 'a')).rows.includes('b1'), 'the table\'s card shows in A');
    assert.equal((await scrolled()).left, left, 'carried into A by the join, the table keeps its sideways scroll');
    assert.equal((await scrolled()).fade, true, 'and its left fade');
    // ⌘↑ on A moves its stack, every card in it, above C.
    await keyTo(p, ids.a);
    await p.key('ArrowUp', 4);
    await becomes(() => stacks(p, ids), ['a', 'c'], '⌘↑ moves A above C');
    assert.equal((await scrolled()).left, left, 'moved with its stack, the table keeps its sideways scroll');
    await shot(p, 'stack-carry');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // A message the reader folds stays folded for them (Core's message.fold), on every device and after a reload,
  // in every state of its stack, until they unfold it; nobody else's view changes.
  // Its row's words leave out the 👍 on it (item 390), which thumbOn reads.
  const folded = (p, id) => p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(id))}),r=c?.querySelector(':scope > .message-folded'),shown=e=>Boolean(e&&e.getClientRects().length);
    const t=r?.querySelector(':scope > .folded-thumb');
    return {row:c?.dataset.folded==='true'&&shown(r),words:shown(r)?[...r.childNodes].filter(n=>n!==t).map(n=>n.textContent).join(''):null,whole:shown(c?.querySelector(':scope > .message-preview'))}})()`);
  // The 👍 on a message's folded row: what it says, whether it is pressed, its name and tooltip, and its size.
  const thumbOn = (p, id) => p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(card(id) + ' > .message-folded > .folded-thumb')});if(!t||!t.getClientRects().length)return null;
    const b=t.getBoundingClientRect();return {text:t.textContent,pressed:t.getAttribute('aria-pressed'),label:t.getAttribute('aria-label'),title:t.title,role:t.getAttribute('role'),width:Math.round(b.width),height:Math.round(b.height)}})()`);
  const foldOf = async (topic, id, reader = facts.actor) => (await actsOf(topic, id, reader))?.folded ?? false;
  await check('reading stacks a message folded in a fully open stack stays folded for the reader through every state, a reload and another device, and unfolds by a press or ⌘Z', async () => {
    const topic = 'stack-fold';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the folder.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to open by a link.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, to fold.\nIts second line.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const openAll = async (p, device) => {
      await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', `${device}: latest and unread first`);
      await press(p, device, '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], `${device}: fully open, every reply shows`);
    };
    let p = await open('stack-fold', 'laptop', topic, ids.root);
    await openAll(p, 'laptop');
    // Another device of the reader's, open on the same topic.
    const q = await open('stack-fold-other-device', 'laptop', topic, ids.root);
    await openAll(q, 'laptop');
    // A page behind another reads what it missed when it is shown: the other device is looked at in front, then put back.
    const onOther = async (read, want, message) => {
      await q.send('Page.bringToFront');
      await becomes(read, want, message);
      await p.send('Page.bringToFront');
    };
    await p.send('Page.bringToFront');
    const items = await menuOf(p, 'laptop', ids.two);
    assert.ok(items.includes('Fold') && !items.includes('Unfold'), `⋯ offers Fold: ${items}`);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.two), 'Core holds the fold');
    assert.equal(await foldOf(topic, ids.two, other), false, 'another reader\'s view of it is unchanged');
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, to fold.Folded`, whole: false },
      'in the fully open stack it is one row: who wrote it, its first words and Folded');
    assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'in its place; nothing else folds');
    assert.equal((await look(p, ids, 'root')).fold, 'open', 'the stack stays fully open');
    await onOther(async () => (await folded(q, ids.two)).row, true, 'the other device shows it folded');
    // ⌘Z undoes the fold just made, in Core and on both devices.
    assert.equal(await focusedOn(p), ids.two, 'the folded message keeps the focus');
    await p.key('z', 4);
    await until(async () => !await foldOf(topic, ids.two), '⌘Z unfolds it, in Core');
    await becomes(() => folded(p, ids.two), { row: false, words: null, whole: true }, 'and it reads whole');
    await onOther(async () => (await folded(q, ids.two)).whole, true, 'on the other device too');
    await menuOf(p, 'laptop', ids.two);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.two), 'folded again');
    // Every state of the stack keeps it: changing the state clears no fold.
    for (const level of ['folded', 'open']) {
      await press(p, 'laptop', '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).fold, level, `the chevron steps to ${level}`);
      assert.equal(await foldOf(topic, ids.two), true, `${level}: Core still holds the fold`);
    }
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, to fold.Folded`, whole: false }, 'open again, it is still its row');
    await shot(p, 'stack-fold-open');
    await p.close();
    // A reload: the fold is still there.
    p = await open('stack-fold-reload', 'laptop', topic, ids.root);
    await openAll(p, 'laptop');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'after a reload it is still folded');
    // A press on the row unfolds it, and opens no Reader.
    await centre(p, card(ids.two));
    await p.point(card(ids.two) + ' > .message-folded > .folded-words');
    await until(async () => !await foldOf(topic, ids.two), 'a press on the row unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'and it reads whole');
    assert.equal(await readerOn(p), null, 'the press opened no Reader');
    await onOther(async () => (await folded(q, ids.two)).whole, true, 'on the other device too');
    // A link to a folded message opens it for that view, and writes no unfold.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.one, operation_id: topic + '-fold-one', args: { folded: true } });
    await becomes(async () => (await folded(p, ids.one)).row, true, 'folded on another device, it shows folded here');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.one} for that.`, read: true })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(linking) + ' a.words-link')}))`), 'the link arrives');
    await centre(p, `${card(linking)} a.words-link`);
    await p.point(`${card(linking)} a.words-link`);
    await becomes(async () => (await folded(p, ids.one)).whole, true, 'the link opens the folded message whole');
    assert.equal(await foldOf(topic, ids.one), true, 'and Core keeps its fold');
    await until(async () => (await readerOn(p))?.startsWith('Reply one'), 'the Reader opens on it, as a link does');
    await closeReader(p, 'laptop');
    // Opened only for that view: changing its stack's state folds it to its row again, and Core is unchanged.
    for (const level of ['folded', 'open']) {
      await press(p, 'laptop', '#messages .reply-stack .stack-toggle');
      await becomes(async () => (await look(p, ids, 'root')).fold, level, `after the link, the chevron steps to ${level}`);
    }
    await becomes(async () => (await folded(p, ids.one)).row, true, 'a state change folds the message the link opened back to its row');
    assert.equal(await foldOf(topic, ids.one), true, 'and Core still holds its fold');
    // A star keeps a message in view: starring a folded message unfolds it, and a starred one offers no Fold.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.three, operation_id: topic + '-fold-three', args: { folded: true } });
    await becomes(async () => (await folded(p, ids.three)).row, true, 'three is folded');
    await centre(p, card(ids.three));
    await p.point(card(ids.three) + ' > .message-folded > .folded-author', 'move');
    // A folded row keeps its bar in a dossier, which offers Unfold (item 473 over 471's barless fold).
    await until(async () => (await lit(p)).includes(ids.three) && await bar(p) !== null, 'the pointer lights the folded row, with its bar');
    await until(() => p.evaluate(`(b=>Boolean(b&&!b.hidden&&b.querySelector('[data-act=fold]:not([hidden])')?.getAttribute('aria-label')==='Unfold'))(document.querySelector('.message-bar'))`), 'its bar offers Unfold');
    await rightClick(p, card(ids.three));
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'a right click opens the folded message\'s menu');
    const offered = await p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.textContent)`);
    assert.ok(offered.includes('Unfold') && !offered.includes('Fold'), `a folded message offers Unfold: ${offered}`);
    await choose(p, 'laptop', 'Star for me');
    await until(async () => (await actsOf(topic, ids.three))?.starred === true && !await foldOf(topic, ids.three), 'starring it unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.three)).whole, true, 'and it reads whole');
    assert.ok(!(await menuOf(p, 'laptop', ids.three)).includes('Fold'), 'a starred message offers no Fold');
    await p.key('Escape');
    // The stack's first message folds as any message does (item 471): to its own row under the head row, which stays
    // the dossier's title and says nothing of the fold; a press on the row unfolds it.
    await menuOf(p, 'laptop', ids.root);
    await choose(p, 'laptop', 'Fold');
    await until(async () => await foldOf(topic, ids.root), 'the first message is folded, in Core');
    await until(async () => { const v = await look(p, ids, 'root'); return v.fold === 'open' && v.headOpen === 'true' && !v.full; }, 'fully open, the dossier keeps its title open and the first message is not whole');
    await becomes(() => folded(p, ids.root), { row: true, words: `${other}The root of the folder.Folded`, whole: false }, 'the first message is its own folded row');
    assert.deepEqual(await p.evaluate(`(c=>[...c.children].filter(e=>e.getClientRects().length).map(e=>e.className.split(' ')[0]))(document.querySelector(${JSON.stringify(card(ids.root))}))`),
      ['stack-head', 'message-folded'], 'under the head row, once');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.root) + ' > .stack-head > .stack-folded')}))`), false, 'and the head row says no Folded');
    await p.point(card(ids.root) + ' > .message-folded > .folded-words');
    await until(async () => !await foldOf(topic, ids.root), 'a press on its row unfolds it');
    await until(async () => (await look(p, ids, 'root')).full, 'and it shows whole');
    assert.equal(await readerOn(p), null, 'opening no Reader');
    assert.deepEqual(p.errors, []);
    assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  if (engine === 'chrome') await check('reading stacks on a phone a message swiped right in a fully open stack folds to its row, and swiped left or tapped unfolds', async () => {
    const topic = 'stack-fold-swipe';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, swiped.', read: true }],
      ['three', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three.', read: true }]]);
    const p = await open('stack-fold-swipe', 'phone', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'phone: latest and unread first');
    await press(p, 'phone', '#messages .reply-stack .stack-toggle');
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'three'], 'phone: fully open');
    const drag = async (selector, from, to) => {
      await centre(p, selector);
      const b = await p.box(selector), y = b.y + b.height / 2, t0 = Date.now() / 1000;
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
      await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
    };
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: swiped right in the fully open stack, it is folded in Core');
    await becomes(async () => ({ ...(await folded(p, ids.two)), rows: (await look(p, ids, 'root')).rows }), { row: true, words: `${other}Reply two, swiped.Folded`, whole: false, rows: ['one', 'two', 'three'] },
      'phone: it is one row, in its place in the open stack');
    await shot(p, 'stack-fold-phone');
    await drag(card(ids.two), 160, 20);
    await until(async () => !await foldOf(topic, ids.two), 'phone: its row swiped left unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'phone: and it reads whole');
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: folded once more');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'phone: its row shows');
    await tap(p, card(ids.two) + ' > .message-folded > .folded-words');
    await until(async () => !await foldOf(topic, ids.two), 'phone: one tap on its row unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'phone: and it reads whole');
    assert.equal(await readerOn(p), null, 'phone: the tap opened no Reader');
    // A starred message is not folded: a swipe right on it writes nothing and leaves it whole. Acts go to Core in
    // order, so once a later swipe's fold is in Core, any fold the starred one had sent would be there before it.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.one, operation_id: topic + '-star-one', args: { starred: true } });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))})?.dataset.starred === 'true'`), 'phone: three shows starred');
    await drag(card(ids.one), 20, 160);
    await drag(card(ids.two), 20, 160);
    await until(async () => await foldOf(topic, ids.two), 'phone: the later swipe on two lands in Core');
    assert.equal(await foldOf(topic, ids.one), false, 'phone: the starred message swiped right is not folded in Core');
    assert.deepEqual(await folded(p, ids.one), { row: false, words: null, whole: true }, 'phone: and its card is whole');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks fold swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the fold\'s swipe is checked in Chrome' });

  if (engine === 'chrome') await check('reading stacks a reply swiped to the right on a phone folds to its row, and a drag that scrolls a wide table or code folds nothing', async () => {
    const topic = 'stack-swipe';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    // The message stays under the 1,024 bytes a card shows, so its card holds the whole of it.
    const code = '```\n' + Array.from({ length: 6 }, (_, i) => `step_${i}_with_a_long_name()`).join('; ') + '\n```';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['wide', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table + '\n\n' + code }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread.' }]]);
    const p = await open('stack-swipe', 'phone', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'wide', 'two'], 'phone: every unread reply in view');
    // A finger's drag, timed as a hand moves: it comes to rest before it lifts, so nothing flings on after it.
    const drag = async (selector, from, to) => {
      await centre(p, selector);
      const b = await p.box(selector), y = b.y + b.height / 2, t0 = Date.now() / 1000;
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
      await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
    };
    // A finger dragging a wide table or a block of code back to its start scrolls it, and folds nothing.
    for (const [what, inner] of [['table', '.md-table-wrap'], ['code', '.md-pre']]) {
      const at = `${card(ids.wide)} ${inner}`;
      const left = () => p.evaluate(`document.querySelector(${JSON.stringify(at)}).scrollLeft`);
      await until(() => p.evaluate(`(e=>e.scrollWidth-e.clientWidth>200)(document.querySelector(${JSON.stringify(at)}))`), `phone: the ${what} is wider than its card`);
      await p.evaluate(`document.querySelector(${JSON.stringify(at)}).scrollLeft=200`);
      await until(async () => await left() === 200, `phone: the ${what} scrolled sideways`);
      await drag(at, 20, 160);
      await until(async () => await left() < 200, `phone: the drag scrolls the ${what} back`);
      assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'wide', 'two'], `phone: a drag on the ${what} folds nothing`);
    }
    await drag(card(ids.one), 20, 160);
    await until(async () => await foldOf(topic, ids.one), 'phone: swiped right, reply one is folded, in Core');
    await becomes(async () => ({ ...(await folded(p, ids.one)), rows: (await look(p, ids, 'root')).rows }), { row: true, words: `${other}Reply one, unread.Folded`, whole: false, rows: ['one', 'wide', 'two'] },
      'phone: swiped right, reply one is its one row, in its place');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  else observations.push({ name: 'stacks swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the swipe is checked in Chrome' });

  // A trackpad's two-finger swipe reaches the page as wheel events, sideways. With macOS's natural scrolling, fingers moving
  // right give a negative deltaX: a run of events close together, then the smaller ones of the momentum after the fingers lift.
  await check('reading stacks on a laptop two fingers swiped right on the trackpad fold a reply once, swiped left unfold it, and a scroll, a sideways table or a star folds nothing', async () => {
    const topic = 'stack-trackpad';
    const table = ['| ' + Array.from({ length: 14 }, (_, i) => `Column ${i} heading`).join(' | ') + ' |', '|' + ' --- |'.repeat(14),
      '| ' + Array.from({ length: 14 }, (_, i) => `cell ${i} with words`).join(' | ') + ' |'].join('\n');
    const tall = Array.from({ length: 8 }, (_, i) => `Line ${i} of a message that makes the page taller than the window.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      ['wide', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A wide table, unread:\n\n' + table }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.' }],
      ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Last reply for the dossier swipe.' }],
      ...[1, 2, 3, 4, 5].map(n => ['tall' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n${tall}`, read: true }])]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    // Every wheel event the window hears, after the feed has had it: its deltas and whether the page took it from the browser.
    const heard = `addEventListener('wheel',e=>{(window.wheels??=[]).push({x:e.deltaX,y:e.deltaY,prevented:e.defaultPrevented})},{passive:true})`;
    const p = await open('stack-trackpad', 'laptop', topic, ids.root, heard);
    // The stack fully open, every reply in view; each new document opens it again.
    const fullyOpen = async () => {
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] .stack-toggle`;
      if ((await look(p, ids, 'root')).fold !== 'open') { await centre(p, toggle); await press(p, 'laptop', toggle); }
      await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'wide', 'kept', 'last'], 'the stack fully open, every reply in view');
    };
    await fullyOpen();
    const where = await p.evaluate('JSON.stringify([location.href, history.length])');
    const folds = () => p.evaluate(`window.sent.filter(kind=>kind==='message.fold').length`);
    const wheels = () => p.evaluate(`(window.wheels??[]).splice(0)`);
    const RIGHT = [[-30, 0], [-30, 0], [-30, 0], [-30, 0], [-18, 0], [-10, 0], [-5, 0], [-2, 0], [-1, 0]];
    const LEFT = RIGHT.map(([x, y]) => [-x, y]);
    // Fingers that come back to the left before they lift, in the same swipe, further than a swipe left goes.
    const BACK = Array.from({ length: 8 }, () => [30, 0]);
    // Fingers on the trackpad over a target, the pointer resting on it; done when the window has heard every delta.
    // A trackpad stamps its events 16 ms apart however busy the page is, so each event is stamped so, which Chrome hands
    // on as its timeStamp: stamped as each is sent, a page or runner busy between two sends (as with the fold the
    // swipe's third event makes) splits one swipe into two, and the fingers coming back unfold the reply. Each gesture
    // starts 300 ms after the last event of the one before by those stamps, or now if that is later: a new swipe.
    let stamped = 0;
    const fingers = async (selector, steps, modifiers = 0) => {
      await centre(p, selector);
      const b = await p.box(selector), x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 20);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      const at = Math.max(await p.evaluate('performance.timeOrigin + performance.now()') / 1000, stamped + 0.3);
      stamped = at + 0.016 * (steps.length - 1);
      for (const [n, [deltaX, deltaY]] of steps.entries()) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, timestamp: at + 0.016 * n });
      const sum = steps.reduce((s, [dx, dy]) => [s[0] + dx, s[1] + dy], [0, 0]);
      const got = [];
      await until(async () => { got.push(...await wheels()); return got.reduce((s, w) => s + w.x, 0) === sum[0] && got.reduce((s, w) => s + w.y, 0) === sum[1]; }, `the window heard the gesture over ${selector}`);
      return got;
    };
    // A new document is a new gesture: what the page heard of the last one goes with it.
    const reload = async () => {
      // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
      const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
      await p.send('Page.reload');
      await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(card(ids.kept))}))`).catch(() => false), 'the page loads again');
      await fullyOpen();
    };

    // Two fingers right over reply one fold it, once: neither the momentum after it nor the fingers coming back
    // before they lift folds it again or unfolds it.
    const right = await fingers(card(ids.one), [...RIGHT, ...BACK]);
    await until(async () => await foldOf(topic, ids.one), 'two fingers right: reply one is folded, in Core');
    await becomes(async () => (await folded(p, ids.one)).row, true, 'and it is its one row');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.equal(await folds(), 1, 'one swipe, momentum and coming back and all, sent one fold');
    assert.equal(await foldOf(topic, ids.one), true, 'and it stays folded');
    assert.ok(right.length > 0 && right.every(w => w.prevented), `the page took every event of the sideways swipe from the browser: ${JSON.stringify(right)}`);
    assert.equal(await p.evaluate(`getComputedStyle(document.documentElement).overscrollBehaviorX`), 'none', 'over the feed a sideways overscroll goes back to no page');
    assert.equal(await p.evaluate('JSON.stringify([location.href, history.length])'), where, 'the page went nowhere');
    // One page hears many swipes: a pause of 250 ms or more between wheel events, by the events' own times, starts the next.
    // Chrome stamps each event as CDP says, so on this same page a swipe left begins 300 ms or more after the last event of
    // the swipe right and unfolds reply one, and a swipe right as long after that folds it again. Safari's engine in this
    // harness stamps the wheel itself.
    if (engine === 'chrome') {
      await fingers(card(ids.one), LEFT);
      await until(async () => !await foldOf(topic, ids.one), 'a second swipe, left, on the same page unfolds reply one, in Core');
      await becomes(async () => (await folded(p, ids.one)).whole, true, 'and it reads whole');
      await fingers(card(ids.one), RIGHT);
      await until(async () => await foldOf(topic, ids.one), 'a third swipe, right, on the same page folds it again, in Core');
      await becomes(async () => (await folded(p, ids.one)).row, true, 'and it is its one row again');
      await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
      assert.equal(await folds(), 3, 'three swipes on one page sent three folds');
    }
    // Folded is the reader's: after a reload it is still folded, and two fingers left over its row unfold it.
    await reload();
    await becomes(async () => (await folded(p, ids.one)).row, true, 'after a reload reply one is still folded');
    await fingers(card(ids.one), LEFT);
    await until(async () => !await foldOf(topic, ids.one), 'two fingers left over its row unfold it, in Core');
    await becomes(async () => (await folded(p, ids.one)).whole, true, 'and it reads whole');
    // A scroll down that drifts to the right scrolls the page and folds nothing; the page leaves it to the browser.
    await reload();
    await centre(p, card(ids.one));
    const top = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.one))}).getBoundingClientRect().top`);
    const before = await top();
    const down = await fingers(card(ids.one), [[-25, 80], [-25, 80], [-25, 80], [-25, 80], [-25, 80]]);
    await until(async () => before - await top() > 100, 'the scroll moves the page');
    assert.equal((await folded(p, ids.one)).whole, true, 'a scroll folds nothing');
    assert.ok(down.every(w => !w.prevented), `the page left every event of the scroll to the browser: ${JSON.stringify(down)}`);
    // Two fingers over a table wider than its card scroll the table, and fold nothing.
    await reload();
    const wrap = `${card(ids.wide)} .md-table-wrap`;
    const left = () => p.evaluate(`document.querySelector(${JSON.stringify(wrap)}).scrollLeft`);
    await until(() => p.evaluate(`(e=>e.scrollWidth-e.clientWidth>200)(document.querySelector(${JSON.stringify(wrap)}))`), 'the table is wider than its card');
    await centre(p, wrap);
    await p.evaluate(`document.querySelector(${JSON.stringify(wrap)}).scrollLeft=200`);
    await until(async () => await left() === 200, 'the table scrolled sideways');
    const sideways = await fingers(wrap, RIGHT);
    await until(async () => await left() < 200, 'the swipe scrolls the table back');
    assert.deepEqual([(await folded(p, ids.wide)).whole, (await look(p, ids, 'root')).rows], [true, ['one', 'wide', 'kept', 'last']], 'a swipe on the table folds nothing');
    assert.ok(sideways.every(w => !w.prevented), `the page left every event over the table to the browser: ${JSON.stringify(sideways)}`);
    // A starred message is not folded.
    await reload();
    await fingers(card(ids.kept), RIGHT);
    assert.equal((await folded(p, ids.kept)).whole, true, 'two fingers right over a starred message fold nothing');
    assert.equal(await folds(), 0, 'and send no fold');
    assert.equal(await foldOf(topic, ids.kept), false, 'Core holds no fold');
    // The wheel with Ctrl held zooms, and folds nothing. Safari's engine in this harness turns the wheel with no keys held.
    if (engine === 'chrome') {
      await reload();
      await fingers(card(ids.one), RIGHT, 2);
      assert.equal((await folded(p, ids.one)).whole, true, 'two fingers right with Ctrl held fold nothing');
      assert.equal(await folds(), 0, 'and send no fold');
    }
    // Item 472: the last visible message folds in place as any message does, and the dossier stays.
    await reload();
    await fingers(card(ids.last), RIGHT);
    await until(async () => await foldOf(topic, ids.last), 'a trackpad swipe on the last visible message folds it, in Core');
    await becomes(async () => (await folded(p, ids.last)).row, true, 'it is its row');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.equal((await actsOf(topic, ids.root))?.aside ?? null, null, 'and the dossier stays above More');
    assert.deepEqual((await look(p, ids, 'root')).rows, ['one', 'wide', 'kept', 'last'], 'every reply in its place');
    await reload();
    await fingers(`#messages .reply-stack[data-stack="${ids.root}"] .stack-head`,RIGHT);
    await until(async () => (await actsOf(topic,ids.root))?.aside>0,'a trackpad swipe on the header moves its dossier too');
    assert.equal(await p.evaluate('JSON.stringify([location.href, history.length])'), where, 'the page went nowhere through it all');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  // x as a person types it: in Chrome a key press with its letter, which a field takes as typing; in Safari's
  // engine the keyboard's own press, which types it too.
  const typeX = p => engine === 'chrome'
    ? p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, text: 'x', unmodifiedText: 'x' })
      .then(() => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 }))
    : p.key('x');
  const foldsSent = p => p.evaluate(`window.sent.filter(kind=>kind==='message.fold').length`);
  const thumbedBy = async (id, who = facts.actor) => (await view('reactions', { message_id: id })).reactions.thumbs.some(thumb => thumb.actor_id === who);
  const fullyOpen = async (p, device, ids) => {
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    if ((await look(p, ids, 'root')).fold !== 'open') { await centre(p, toggle); await press(p, device, toggle); }
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', `${device}: the stack fully open`);
  };
  // A finger's drag across a card on a phone, as the swipe cases make it.
  const fingerDrag = async (p, selector, from, to) => {
    await centre(p, selector);
    const b = await p.box(selector), y = b.y + Math.min(b.height / 2, 120), t0 = Date.now() / 1000;
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + from, y }], timestamp: t0 });
    for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + from + (to - from) * part / 4, y }], timestamp: t0 + 0.05 * part });
    await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + to, y }], timestamp: t0 + 0.6 });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.65 });
  };
  // Two fingers on the trackpad over a card, the pointer resting on it, as the trackpad case sends them (natural
  // scrolling: fingers moving right give a negative deltaX), stamped as a real trackpad's events are: one gesture's
  // events close together, and the next gesture on the page beginning 300 ms or more after the last event of the one
  // before, the fingers lifted and set down again (the page tells one swipe from the next by a pause of 250 ms, by the
  // events' own times). Chrome takes each event's stamp from CDP: 16 ms apart, from 300 ms after the last gesture's last
  // stamp, or now if that is later. Safari's engine in this harness stamps each event itself as it dispatches it, on a
  // frame after the last: there the gesture begins on the first frame whose time, on the page's own clock, is 300 ms past
  // the last wheel event the page heard. Done once the window has heard every delta, which it gives back.
  const HEARD_WHEELS = `addEventListener('wheel',e=>{(window.wheels??=[]).push({x:e.deltaX,y:e.deltaY,prevented:e.defaultPrevented,at:e.timeStamp});window.lastWheel=e.timeStamp},{passive:true})`;
  const SWIPE_RIGHT = [[-30, 0], [-30, 0], [-30, 0], [-30, 0], [-18, 0], [-10, 0], [-5, 0], [-2, 0], [-1, 0]];
  const GESTURE_GAP = 300, lastStamp = new WeakMap();
  // modifiers: the keys held, as CDP numbers them (1 Option, 2 Ctrl); Safari's engine in this harness turns the wheel with none.
  const trackpad = async (p, selector, steps, modifiers = 0) => {
    await centre(p, selector);
    const b = await p.box(selector), x = b.x + b.width / 2, y = Math.max(b.y, 0) + Math.min(b.height / 2, 40);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (engine === 'chrome') {
      const at = Math.max(await p.evaluate('performance.timeOrigin + performance.now()'), (lastStamp.get(p) ?? -Infinity) + GESTURE_GAP);
      lastStamp.set(p, at + 16 * (steps.length - 1));
      for (const [n, [deltaX, deltaY]] of steps.entries()) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, timestamp: (at + 16 * n) / 1000 });
    } else {
      await p.evaluate(`new Promise(begin=>{const due=(window.lastWheel??-Infinity)+${GESTURE_GAP},frame=t=>t>=due?begin():requestAnimationFrame(frame);requestAnimationFrame(frame)})`);
      for (const [deltaX, deltaY] of steps) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers });
    }
    const sum = steps.reduce((all, [dx, dy]) => [all[0] + dx, all[1] + dy], [0, 0]), got = [];
    await until(async () => { got.push(...await p.evaluate('(window.wheels??[]).splice(0)')); return got.reduce((all, w) => all + w.x, 0) === sum[0] && got.reduce((all, w) => all + w.y, 0) === sum[1]; },
      `the window heard the gesture over ${selector}`);
    return got;
  };

  // Item 377: a person's reply to a message, or their thumbs-up on it, folds it for them in Core, as their Fold would.
  await check('reading stacks replying to a message or a thumbs-up on it folds it for the person, on every device; a starred one stays whole, the Reader keeps showing it whole, the feed keeps its place and the keys, and ⌘Z leaves it folded', async () => {
    const topic = 'stack-fold-answered';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root, already read.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, to answer.' }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, to thumb up.' }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.' }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    const p = await open(topic, 'laptop', topic, ids.root);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two', 'kept'], 'every unread reply in view');
    // A reply written in the Reader and sent with ⇧⌘Return, which keeps the Reader open on the message.
    await openReader(p, 'laptop', ids.one, 'Reply one');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    const topOf = id => p.evaluate(`Math.round(document.querySelector(${JSON.stringify(card(id))}).getBoundingClientRect().top)`);
    const before = await topOf(ids.one);
    await p.send('Input.insertText', { text: 'My answer to reply one.' });
    await p.key('Enter', 12);
    await until(async () => await foldOf(topic, ids.one), 'the reply folds reply one for the person, in Core');
    await becomes(async () => (await folded(p, ids.one)).row, true, 'the feed shows reply one as its row');
    assert.ok((await readerOn(p))?.startsWith('Reply one, to answer.'), 'the Reader, still open on reply one, shows it whole');
    assert.equal(await topOf(ids.one), before, 'its row keeps the place the message had in the feed');
    assert.deepEqual((await look(p, ids, 'root')).rows.slice(0, 3), ['one', 'two', 'kept'], 'in its place in its stack');
    await closeReader(p, 'laptop');
    await until(async () => await focusedOn(p) === ids.one, 'the keys come back to reply one, now its row');
    // ⌘Z puts back what the person did on this page: the reply's fold is not one of those, and stays.
    await p.key('z', 4);
    await until(async () => await said(p) === 'Nothing to put back', '⌘Z has nothing of the reply\'s to put back');
    assert.equal(await foldOf(topic, ids.one), true, 'the fold the reply made stays after ⌘Z');
    // The bar's 👍 on reply two folds it.
    await light(p, 'laptop', ids.two);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await foldOf(topic, ids.two), 'a thumbs-up folds reply two for the person, in Core');
    await becomes(async () => (await folded(p, ids.two)).row, true, 'the feed shows reply two as its row');
    // A starred message keeps in view: neither a thumbs-up nor a reply folds it.
    await light(p, 'laptop', ids.kept);
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await thumbedBy(ids.kept), 'the thumbs-up on the starred reply is in Core');
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.kept, addressees: [other], body: 'An answer to the starred reply.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))})) && window.fetchesOut === 0`), 'the answer to the starred reply is drawn');
    assert.equal(await foldOf(topic, ids.kept), false, 'a starred message is not folded by a thumbs-up or a reply, in Core');
    assert.deepEqual(await folded(p, ids.kept), { row: false, words: null, whole: true }, 'and it reads whole');
    // Taking the thumbs-up back unfolds nothing. In a dossier the folded row lights with its bar, which offers Unfold
    // (item 473 over 471's barless fold), and shows its own 👍 once given (item 471): that 👍 takes it back.
    await centre(p, card(ids.two));
    await p.point(card(ids.two) + ' > .message-folded > .folded-author', 'move');
    await until(async () => (await lit(p)).includes(ids.two) && await bar(p) !== null, 'the pointer lights reply two\'s row, with its bar');
    await until(() => p.evaluate(`(b=>Boolean(b&&!b.hidden&&b.querySelector('[data-act=fold]:not([hidden])')?.getAttribute('aria-label')==='Unfold'))(document.querySelector('.message-bar'))`), 'reply two\'s bar offers Unfold');
    await p.point(card(ids.two) + ' > .message-folded > .folded-thumb');
    await until(async () => !await thumbedBy(ids.two), 'the thumbs-up on reply two is taken back, in Core');
    assert.equal(await foldOf(topic, ids.two), true, 'and reply two stays folded');
    // Nobody else's view changes; the person's other device shows both folded.
    assert.deepEqual([await foldOf(topic, ids.one, other), await foldOf(topic, ids.two, other)], [false, false], 'another reader sees neither folded');
    await shot(p, 'stack-fold-answered');
    const q = await open(topic + '-other-device', 'laptop', topic, ids.root);
    await fullyOpen(q, 'laptop', ids);
    await becomes(async () => [(await folded(q, ids.one)).row, (await folded(q, ids.two)).row, (await folded(q, ids.kept)).whole], [true, true, true],
      'the person\'s other device shows replies one and two folded and the starred reply whole');
    assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    await p.close(); await q.close();
  });

  // Item 381: a long message that scrolls up and down in its card folds by a swipe like any other.
  await check('reading stacks a swipe folds a long message that scrolls up and down inside its card, by a finger on a phone and two fingers on a trackpad', async () => {
    for (const device of engine === 'chrome' ? ['phone', 'laptop'] : ['laptop']) {
      const topic = 'stack-fold-long-' + device;
      const long = Array.from({ length: 60 }, (_, i) => `Line ${i}: a long message, read where it is, that scrolls up and down inside its card.`).join('\n');
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
        ['long', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A long reply.\n' + long }],
        ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The last reply.' }]]);
      const p = await open(topic, device, topic, ids.root, device === 'laptop' ? HEARD_WHEELS : '');
      await becomes(async () => (await look(p, ids, 'root')).rows, ['long', 'last'], `${device}: both unread replies in view`);
      const selector = card(ids.long);
      await light(p, device, ids.long);
      await until(() => p.evaluate(`(c=>c.dataset.whole==='shown'&&c.classList.contains('scroll-in-place')&&c.scrollHeight-c.clientHeight>200)(document.querySelector(${JSON.stringify(selector)}))`),
        `${device}: the long reply is read whole, scrolling up and down in its card`);
      // Real screens round a long message's words to a pixel wider than its card shows (item 381); the harness's
      // screens lay them out to the pixel, so the words are given that pixel here: they run a pixel past the
      // card's padding, so the card is a pixel wider than it shows (scrollWidth over clientWidth) in both engines.
      await p.evaluate(`(c=>document.head.append(Object.assign(document.createElement('style'),{textContent:'.message-card.scroll-in-place>.message-preview{box-sizing:border-box;min-width:calc(100% + '+(parseFloat(getComputedStyle(c).paddingRight)+1)+'px)}'})))(document.querySelector(${JSON.stringify(selector)}))`);
      await until(() => p.evaluate(`(c=>c.scrollWidth>c.clientWidth)(document.querySelector(${JSON.stringify(selector)}))`), `${device}: the words run a pixel past the card`);
      if (device === 'phone') await fingerDrag(p, selector, 20, 160);
      else await trackpad(p, selector, SWIPE_RIGHT);
      await until(async () => await foldOf(topic, ids.long), `${device}: swiped right, the long reply is folded, in Core`);
      await becomes(async () => (await folded(p, ids.long)).row, true, `${device}: and it is its one row`);
      await shot(p, 'stack-fold-long-' + device);
      assert.deepEqual(p.errors, []); await p.close();
    }
    if (engine !== 'chrome') observations.push({ name: 'stacks fold long swipe', engine, held: 'Safari\'s engine in this harness has a tap but no finger drag: the phone\'s swipe on a long message is checked in Chrome' });
  });

  // Item 388: x on the selected message is Fold or Unfold, as in its ⋯.
  await check('reading stacks x folds the selected message to its row and x again unfolds it, in Core; a starred message and a dossier as a whole fold nothing, and in writing x is typed', async () => {
    const topic = 'stack-fold-key';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root of the folder.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, folded by x.', read: true }],
      ['kept', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply kept, starred.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.kept, operation_id: topic + '-star', args: { starred: true } });
    const p = await open(topic, 'laptop', topic, ids.root);
    await fullyOpen(p, 'laptop', ids);
    await keyTo(p, ids.two);
    await typeX(p);
    await until(async () => await foldOf(topic, ids.two), 'x folds the selected reply, in Core');
    await becomes(() => folded(p, ids.two), { row: true, words: `${other}Reply two, folded by x.Folded`, whole: false }, 'and it is its one row');
    assert.equal(await focusedOn(p), ids.two, 'the keys stay on it');
    assert.equal(await said(p), 'Folded to one line, for you only');
    assert.equal(await foldOf(topic, ids.two, other), false, 'another reader\'s view of it is unchanged');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.two), 'x again unfolds it, in Core');
    await becomes(async () => (await folded(p, ids.two)).whole, true, 'and it reads whole');
    assert.equal(await focusedOn(p), ids.two, 'the keys still on it');
    await typeX(p);
    await until(async () => await foldOf(topic, ids.two), 'x folds it once more');
    await p.key('z', 4);
    await until(async () => !await foldOf(topic, ids.two), '⌘Z puts back the fold x made');
    // A starred message stays open, and says so.
    await keyTo(p, ids.kept);
    const sentBefore = await foldsSent(p);
    await typeX(p);
    await until(async () => await said(p) === 'Starred messages stay open', 'x on a starred message says it stays open');
    assert.equal(await foldsSent(p), sentBefore, 'and sends no fold');
    assert.deepEqual(await folded(p, ids.kept), { row: false, words: null, whole: true }, 'it reads whole');
    // On a dossier as a whole, its chevron or its compact header, x does nothing (yet).
    await p.evaluate(`document.querySelector(${JSON.stringify(`.reply-stack[data-stack="${ids.root}"] > .stack-toggle`)}).focus()`);
    await typeX(p); await twoFrames(p);
    await press(p, 'laptop', `.reply-stack[data-stack="${ids.root}"] > .stack-toggle`);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'the stack back to latest plus unread, its head one row');
    await keyTo(p, ids.root);
    assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'the keys are on the dossier\'s compact header');
    await typeX(p); await twoFrames(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'nothing is out');
    assert.equal(await foldsSent(p), sentBefore, 'x on the chevron or the compact header sends no fold');
    assert.equal(await foldOf(topic, ids.root), false, 'and the first message is not folded, in Core');
    // In writing x is a letter: in the topic's composer and in the Reader's reply.
    await p.key('Enter', 4);
    await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'the new message\'s writing has the cursor');
    await typeX(p);
    await until(() => p.evaluate("document.activeElement?.value === 'x'"), 'x is typed in the composer');
    await p.key('Escape');
    await until(() => p.evaluate("!document.querySelector('#new-message-sheet')?.open"), 'Escape puts the composer back');
    await press(p, 'laptop', `.reply-stack[data-stack="${ids.root}"] > .stack-toggle`);
    await becomes(async () => (await look(p, ids, 'root')).fold, 'open', 'the stack fully open again, reply one in view');
    await openReader(p, 'laptop', ids.one, 'Reply one');
    await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), 'the cursor is in the reply');
    await typeX(p);
    await until(() => p.evaluate("document.querySelector('#writing-body').value === 'x'"), 'x is typed in the reply');
    await closeReader(p, 'laptop');
    assert.equal(await foldsSent(p), sentBefore, 'typing x sends no fold');
    assert.equal(await foldOf(topic, ids.one), false, 'and the message the Reader showed is not folded');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 388 on a dossier's original message, which item 471 makes a message like any other: x folds it to its own row
  // under the head row, the dossier staying fully open, and x again unfolds it, whether x or the person's reply (item
  // 377) folded it. At latest and unread the head shows only its row, the dossier's title, and x there does nothing.
  await check('reading stacks x folds a dossier\'s original message to its own row under the head row and x again unfolds it, after x or the person\'s reply folded it, as on any message; at latest and unread x on the title row does nothing', async () => {
    const topic = 'stack-fold-key-head';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The original message.', read: true }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }]]);
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    const head = async () => { const l = await look(p, ids, 'root'); return [l.fold, l.headOpen, l.full]; };
    const p = await open(topic, 'laptop', topic, ids.root);
    await fullyOpen(p, 'laptop', ids);
    await keyTo(p, ids.root);
    assert.deepEqual(await head(), ['open', 'true', true], 'fully open, the original message reads whole');
    const sent = await foldsSent(p);
    await typeX(p);
    await until(async () => await foldOf(topic, ids.root), 'x folds the original message, in Core');
    await becomes(head, ['open', 'true', false], 'the dossier stays fully open, its title row open');
    await becomes(async () => (await folded(p, ids.root)).row, true, 'and the message is its own row');
    assert.equal(await focusedOn(p), ids.root, 'the keys stay on it');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.root), 'x again unfolds it, in Core');
    await becomes(head, ['open', 'true', true], 'and it reads whole');
    assert.equal(await foldsSent(p), sent + 2, 'one fold sent for each x');
    assert.equal(await focusedOn(p), ids.root, 'the keys still on it');
    // The person's reply to it folds it (item 377); x on its row unfolds it.
    ids.mine = (await control({ method: 'agent_message', operation_id: topic + '-mine', topic_id: topic, source: 'topic', sender: facts.actor,
      reply_to: ids.root, addressees: [other], body: 'My answer to the original.' })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.mine))})) && window.fetchesOut === 0`), 'my reply is drawn');
    await until(async () => await foldOf(topic, ids.root), 'my reply folds the original message, in Core');
    await becomes(async () => (await folded(p, ids.root)).row, true, 'the page shows it as its row');
    await keyTo(p, ids.root);
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.root), 'x unfolds what my reply folded, in Core');
    await becomes(head, ['open', 'true', true], 'and it reads whole');
    // At latest and unread the head shows only its row, the dossier's title: x there neither folds nor unfolds.
    await typeX(p);
    await until(async () => await foldOf(topic, ids.root), 'x folds it once more');
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(head, ['folded', 'false', false], 'the dossier at latest and unread, its head one row');
    await keyTo(p, ids.root);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'nothing is out');
    const before = await foldsSent(p);
    await typeX(p); await twoFrames(p);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'nothing is out after x');
    assert.equal(await foldsSent(p), before, 'x on the title row sends nothing');
    assert.equal(await foldOf(topic, ids.root), true, 'and the first message stays folded, in Core');
    assert.deepEqual(await head(), ['folded', 'false', false], 'and the dossier stays at latest and unread');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 390: a folded message's row carries its 👍.
  await check('reading stacks a folded message\'s row carries its 👍: pressed once given, with the count, given and taken back without unfolding, reached by Tab, named, and 44px under a finger', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-fold-thumb-' + device;
      // One is a message on its own, as is the person's own; bare and two are replies in a dossier (item 471).
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
        ['bare', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply bare, folded, no thumbs-up.', read: true }],
        ['two', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, folded, thumbed by another.', read: true }],
        ['one', { sender: other, addressees: [facts.actor], body: 'A message on its own, folded.', read: true }],
        ['mine', { sender: facts.actor, addressees: [other], body: 'My own message, folded.', read: true }]]);
      await control({ method: 'agent_thumb', sender: other, message_id: ids.two, operation_id: topic + '-their-thumb' });
      assert.equal(await thumbedBy(ids.two, other), true, 'another gives reply two a thumbs-up');
      for (const id of [ids.bare, ids.one, ids.two, ids.mine]) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: id, operation_id: topic + '-fold-' + id, args: { folded: true } });
      const p = await open(topic, device, topic, ids.root);
      await fullyOpen(p, device, ids);
      await becomes(async () => [(await folded(p, ids.bare)).row, (await folded(p, ids.one)).row, (await folded(p, ids.two)).row, (await folded(p, ids.mine)).row], [true, true, true, true], `${device}: four folded rows`);
      const pick = thumb => thumb && (({ text, pressed, label, title, role }) => ({ text, pressed, label, title, role }))(thumb);
      assert.deepEqual(pick(await thumbOn(p, ids.one)), { text: '👍', pressed: 'false', label: 'Thumbs up', title: 'Thumbs up', role: 'button' }, `${device}: a folded row's 👍, named and titled`);
      assert.deepEqual(pick(await thumbOn(p, ids.two)), { text: '👍 1', pressed: 'false', label: 'Thumbs up (1)', title: 'Thumbs up', role: 'button' }, `${device}: with the count once someone else has given one`);
      assert.equal(await thumbOn(p, ids.bare), null, `${device}: in a dossier a row shows a 👍 only once someone has given one (item 471)`);
      assert.equal(await thumbOn(p, ids.mine), null, `${device}: the person's own message takes no thumbs-up from them, so its row has none`);
      // Only the card names its message (data-id): what finds a message's card finds that card alone, not its 👍 too.
      assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(`#messages [data-id="${ids.one}"]`)}).length`), 1, `${device}: the folded row's 👍 names no message of its own`);
      if (device === 'phone') {
        const size = await thumbOn(p, ids.one);
        assert.ok(size.width >= 44 && size.height >= 44, `phone: the 👍 is 44px or more each way under a finger: ${JSON.stringify(size)}`);
      }
      const thumb = `${card(ids.one)} > .message-folded > .folded-thumb`;
      await centre(p, thumb);
      if (device === 'laptop') {
        // The pointer on the row lights it, and its bar sits clear of the row's 👍, so the 👍 can still be pressed.
        await p.point(card(ids.one) + ' > .message-folded > .folded-author', 'move');
        await until(async () => (await lit(p)).includes(ids.one) && await bar(p) !== null, 'laptop: the row lights, with its bar');
        assert.equal(await p.evaluate(`(()=>{const b=document.querySelector('.message-bar').getBoundingClientRect(),t=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
          return b.right>t.left&&b.left<t.right&&b.bottom>t.top&&b.top<t.bottom})()`), false, 'laptop: the bar does not cover the row\'s 👍');
      }
      await press(p, device, thumb);
      await until(async () => await thumbedBy(ids.one), `${device}: the row's 👍 gives the thumbs-up, in Core`);
      await becomes(async () => pick(await thumbOn(p, ids.one)), { text: '👍 1', pressed: 'true', label: 'Remove thumbs up (1)', title: 'Remove thumbs up', role: 'button' }, `${device}: shown pressed, counted`);
      assert.equal(await foldOf(topic, ids.one), true, `${device}: the message stays folded, in Core`);
      assert.equal((await folded(p, ids.one)).row, true, `${device}: and on the page`);
      assert.equal(await readerOn(p), null, `${device}: the press opens nothing`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-fold-thumb-${device}-${theme}`);
      }
      await press(p, device, thumb);
      await until(async () => !await thumbedBy(ids.one), `${device}: a second press takes it back, in Core`);
      await becomes(async () => (await thumbOn(p, ids.one))?.pressed, 'false', `${device}: shown not pressed`);
      assert.equal(await foldOf(topic, ids.one), true, `${device}: and the message stays folded`);
      if (device === 'laptop' && engine !== 'chrome') observations.push({ name: 'stacks folded row thumb Tab', engine, held: 'Safari\'s key for every item is Option-Tab, which the page leaves to the browser, as it does for the bar\'s buttons: Tab from a folded row to its 👍 is checked in Chrome' });
      if (device === 'laptop' && engine === 'chrome') {
        // The keys: Tab from the selected row reaches its 👍, and Return gives the thumbs-up there.
        await keyTo(p, ids.two);
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.matches(${JSON.stringify(`${card(ids.two)} > .message-folded > .folded-thumb`)})`), 'laptop: Tab from the selected row reaches its 👍');
        await p.key('Enter');
        await until(async () => await thumbedBy(ids.two), 'laptop: Return on it gives the thumbs-up, in Core');
        assert.equal(await foldOf(topic, ids.two), true, 'laptop: and the message stays folded');
        assert.equal(await readerOn(p), null, 'laptop: Return on the 👍 opens no Reader');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 447: a message shown by one line, its folded row or its dossier's name, shows its author's own words
  // (message-preview.mjs): Tony's reply began with a quoted line and its row read "Release 69, 1:06 AM".
  await check('reading stacks a folded message\'s row shows its author\'s own words: after a quote they began with, colon and all, a quote alone as a quote, an attachment alone by its name, a dossier and a message on its own named the same, each on one line on a laptop and phones 320 to 390 wide', async () => {
    const tony = '> - Release 69, 1:06 AM: moving messages/dossiers below More...\n>\n\nbank this - not a request but lets discuss:\n\nWhat if a dossier put aside said why?';
    const his = 'bank this - not a request but lets discuss:';
    const want = { reply: his, quote: '“Release 69 shipped at 1:06 AM: the dossiers moved below More.”', list: 'Here is the plan: fold the shipped list by release.',
      file: 'Attached: cabin-notes.txt', lone: his };
    // Each folded row's words, and whether the row keeps to one line inside its card, its words shortened by the
    // page's ellipsis rather than pushing Folded (or, in a dossier, where "Folded" is said to a screen reader only, its
    // 👍, item 471) out; and whether anything scrolls sideways.
    const rows = (p, ids) => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},out={};
      for(const key of ${JSON.stringify(Object.keys(want))}){const c=document.querySelector('#messages .message-card[data-id="'+ids[key]+'"]'),r=c?.querySelector(':scope > .message-folded');
        if(!r||!r.getClientRects().length){out[key]=null;continue}
        const box=e=>e.getBoundingClientRect(),cb=box(c),w=r.querySelector('.folded-words'),a=r.querySelector('.folded-author'),f=[...r.children].filter(e=>e!==w&&e!==a&&box(e).width>1).at(-1),end=f?box(f):null;
        out[key]={words:w.textContent,oneLine:Math.abs(box(w).top-box(a).top)<4&&(!end||Math.abs(end.top+end.height/2-(box(a).top+box(a).height/2))<6),
          inCard:(end?end.right<=cb.right+0.5&&box(w).right<=end.left+0.5:box(w).right<=cb.right+0.5)&&box(a).left>=cb.left-0.5}}
      return {rows:out,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    const named = (p, id) => p.evaluate(`(()=>{const c=document.querySelector('#messages .message-card[data-id="${id}"]'),n=c?.querySelector(':scope > .stack-head > .stack-name');
      if(!n)return null;const b=n.getBoundingClientRect(),s=c.closest('.reply-stack').getBoundingClientRect();
      return {name:n.textContent,folded:Boolean(c.querySelector(':scope > .stack-head > .stack-folded')),inStack:b.right<=s.right+0.5,toggle:c.closest('.reply-stack').querySelector(':scope > .stack-toggle').getAttribute('aria-label').endsWith(': '+n.textContent)}})()`);
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-fold-words-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.', read: true }],
        ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: tony, read: true }],
        ['quote', { sender: other, reply_to: 'root', addressees: [facts.actor], body: '> Release 69 shipped at 1:06 AM: the dossiers moved below More.', read: true }],
        ['list', { sender: other, reply_to: 'root', addressees: [facts.actor], body: '- Here is the plan: fold the shipped list by release.\n- Then the rest.', read: true }],
        ['file', { sender: other, reply_to: 'root', addressees: [facts.actor], body: '', attachments: [{ name: 'cabin-notes.txt', text: 'Notes for the cabin.' }], read: true }],
        ['named', { sender: other, addressees: [facts.actor], body: tony, read: true }],
        ['namedReply', { sender: other, reply_to: 'named', addressees: [facts.actor], body: 'A reply to it.', read: true }],
        ['lone', { sender: other, addressees: [facts.actor], body: tony, read: true }]]);
      for (const key of Object.keys(want)) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids[key], operation_id: `${topic}-fold-${key}`, args: { folded: true } });
      const p = await open(topic, device, topic, ids.root);
      await fullyOpen(p, device, ids);
      for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        const fits = Object.fromEntries(Object.entries(want).map(([key, words]) => [key, { words, oneLine: true, inCard: true }]));
        await becomes(() => rows(p, ids), { rows: fits, sideways: false }, `${device} ${width}px: each folded row shows its author's own words on one line in its card`);
        assert.equal((await named(p, ids.named)).inStack, true, `${device} ${width}px: the dossier's name stays in its tab`);
      }
      // A dossier named by such a message, until someone types a name: the same words, in its tab and its chevron's name.
      await becomes(() => named(p, ids.named), { name: his, folded: false, inStack: true, toggle: true }, `${device}: the dossier is named by his own words`);
      const seen = (await rows(p, ids)).rows;
      for (const key of ['reply', 'lone']) assert.doesNotMatch(seen[key].words, /Release 69/, `${device}: ${key}: nothing of the quote he began with`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-fold-words-${device}-${theme}`);
      }
      // Renaming starts from the name shown, and Return on it unchanged names nothing: the name is still its message's
      // line. A press on the name renames on a laptop; the rename case holds it on a phone.
      if (device === 'laptop') {
        const input = `#messages .reply-stack[data-stack="${ids.named}"] .stack-rename-input`;
        await centre(p, `${card(ids.named)} .stack-name`);
        await p.point(`${card(ids.named)} .stack-name`);
        await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), `${device}: the name opens to rename`);
        assert.equal(await p.evaluate(`document.activeElement.value`), his, `${device}: starting from his own words`);
        await p.key('Enter');
        await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), `${device}: Return closes it`);
        assert.equal(await p.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`), 0, `${device}: the name unchanged sends nothing`);
        // Typed in as shown, his words unchanged also name nothing: the field touched, only the line it is named by holds it.
        await centre(p, `${card(ids.named)} .stack-name`);
        await p.point(`${card(ids.named)} .stack-name`);
        await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), `${device}: the name opens to rename again`);
        await p.evaluate(`document.activeElement.select()`);
        await p.send('Input.insertText', { text: his });
        await p.key('Enter');
        await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), `${device}: Return closes it again`);
        assert.equal(await p.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`), 0, `${device}: his words typed in unchanged send nothing`);
        assert.equal((await actsOf(topic, ids.named))?.name ?? null, null, `${device}: and Core holds no typed name`);
      }
      // Its first message folded: the head row is still the dossier's title, with the same words and nothing of the
      // fold (item 471); the message itself is its own row.
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.named, operation_id: `${topic}-fold-named`, args: { folded: true } });
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.named))}).dataset.folded === 'true'`), `${device}: the first message is folded on the page`);
      assert.deepEqual(await named(p, ids.named), { name: his, folded: false, inStack: true, toggle: true }, `${device}: folded, its head row keeps his words and says nothing of the fold`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Items 471, 472 and 430: how a dossier shows its messages. Each is a way of showing the dossier and loses nothing in
  // it: every message stays reachable in place, and what Core stores (the order, the names, the folds) changes only by
  // the reader's own acts, never by how the page shows them. Phones are checked at 320, 375 and 390 wide.
  const PHONES = [320, 375, 390];
  const widthsOf = device => (device === 'phone' ? PHONES : [DEVICES.laptop.width]);
  const atWidth = (p, device, width) => (device === 'phone' ? p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }) : null);
  const storedActs = async topic => (await view('message_acts', { topic_id: topic })).items.map(item => [item.message_id, Boolean(item.acts.folded), Boolean(item.acts.starred), item.acts.name?.text ?? null]).sort();
  // A press on target that the phone's first tap would only light: on a phone, a tap lights the message first, and the
  // tap after it acts, as a person taps twice.
  const twoTaps = async (p, device, id, selector) => {
    if (device === 'phone' && !(await lit(p)).includes(id)) { await tap(p, selector); await until(async () => (await lit(p)).includes(id), `phone: the first tap lights ${id}`); }
    await press(p, device, selector);
  };

  // Tony's 5418: a message shown whole in a dossier keeps its agent name's pill as it had it before item 471, the same
  // computed corner, fill, border and padding as the base drew; a folded row keeps 471's plain name.
  const BASE_PILL = { radius: '4.8px', border: 'none 0px', padding: '0px 4px', margin: '-4px' };
  await check('reading stacks inside a dossier a message shown whole keeps its agent name\'s pill as before, and a folded row has a plain name, no Folded pill and a 👍 only once someone gave one, at 320, 375 and 390 wide and on a laptop, light and dark; a message on its own keeps its tag, pill and 👍; and a reload finds order, names and folds unchanged (item 471, Tony 5418)', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-inside-look-' + device;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The dossier\'s first message.', read: true }],
        ['bare', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'A folded reply nobody gave a thumbs-up.', read: true }],
        ['thumbed', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A folded reply another gave a thumbs-up.', read: true }],
        ['whole', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'A reply shown whole.', read: true }],
        ['lone', { sender: other, addressees: [facts.actor], body: 'A folded message on its own.', read: true }],
        ['loneWhole', { sender: 'aim-ux', addressees: [facts.actor], body: 'A message on its own, shown whole.', read: true }]]);
      await control({ method: 'agent_thumb', sender: 'aim-ux', message_id: ids.thumbed, operation_id: topic + '-thumb' });
      for (const key of ['bare', 'thumbed', 'lone']) await dossierFold(topic, ids[key]);
      const stored = await storedActs(topic);
      let p = await open(topic, device, topic, ids.root);
      await fullyOpen(p, device, ids);
      const face = () => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),
        shown=e=>Boolean(e&&e.getClientRects().length&&e.getBoundingClientRect().width>1),painted=e=>!['rgba(0, 0, 0, 0)','transparent'].includes(getComputedStyle(e).backgroundColor);
        const name=id=>{const n=c(id).querySelector(':scope > .message-author > .author-name'),s=getComputedStyle(n),probe=document.createElement('span');
          probe.style.background='var(--agent-tag)';c(id).append(probe);const fill=getComputedStyle(probe).backgroundColor;probe.remove();
          return {text:n.textContent,tag:painted(n),fill:s.backgroundColor===fill,pill:{radius:s.borderRadius,border:s.borderStyle+' '+s.borderWidth,padding:s.padding,margin:s.marginLeft}}};
        const row=id=>{const r=c(id).querySelector(':scope > .message-folded'),t=r.querySelector('.folded-thumb'),f=r.querySelector('.folded-cue');
          return {author:r.querySelector('.folded-author').textContent,tag:painted(r.querySelector('.folded-author')),pill:shown(f),cue:f.textContent,thumb:shown(t)?t.textContent:null}};
        const s=c(ids.root).closest('.reply-stack');
        return {root:name(ids.root),whole:name(ids.whole),loneWhole:name(ids.loneWhole),bare:row(ids.bare),thumbed:row(ids.thumbed),lone:row(ids.lone),
          title:s.querySelector('.stack-head > .stack-name').textContent,
          order:[...document.querySelectorAll('#messages .message-card[data-id]')].map(e=>Object.keys(ids).find(k=>ids[k]===e.dataset.id)),
          reachable:Object.keys(ids).filter(k=>shown(c(ids[k]))),sideways:document.documentElement.scrollWidth>innerWidth}})()`);
      let seen = null;
      for (const width of widthsOf(device)) {
        await atWidth(p, device, width);
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme); await away(p);
          const now = await face();
          const at = `${device} ${width}px ${theme}`;
          assert.deepEqual([now.loneWhole.tag, now.loneWhole.fill], [true, true], `${at}: a message on its own keeps its agent tag: ${JSON.stringify(now.loneWhole)}`);
          // Before item 471 every agent name in a dossier had the pill: the computed corner, border, padding and pull
          // to the left the base (fd004e6e) shows there, at every width and in both engines, and the agent's tag fill.
          for (const key of ['root', 'whole']) {
            assert.deepEqual([now[key].tag, now[key].fill, now[key].pill], [true, true, BASE_PILL], `${at}: in a dossier ${key}, shown whole, keeps its agent name's pill as before: ${JSON.stringify(now)}`);
          }
          assert.deepEqual(now.bare, { author: 'aim-ux', tag: false, pill: false, cue: 'Folded', thumb: null }, `${at}: a folded row in a dossier: a plain name, no pill ("Folded" is said to a screen reader), no 👍 nobody gave`);
          assert.deepEqual(now.thumbed, { author: other, tag: false, pill: false, cue: 'Folded', thumb: '👍 1' }, `${at}: its 👍 shows once someone gave one`);
          const { tag: _loneTag, ...lone } = now.lone;
          assert.deepEqual(lone, { author: other, pill: true, cue: 'Folded', thumb: '👍' }, `${at}: a folded message on its own keeps its pill and its 👍`);
          assert.deepEqual(now.reachable, Object.keys(ids), `${at}: every message is on show in place, whole or as its row`);
          assert.equal(now.sideways, false, `${at}: nothing scrolls sideways`);
          if (seen) assert.deepEqual([now.order, now.title], [seen.order, seen.title], `${at}: the same order and title at every width and theme`);
          seen = now;
          await shot(p, `stack-inside-look-${device}-${width}-${theme}`);
        }
      }
      assert.deepEqual(await storedActs(topic), stored, `${device}: showing the dossier stored nothing`);
      // A reload finds the stored order, names and folds as they were.
      await p.close();
      p = await open(topic + '-reload', device, topic, ids.root);
      await fullyOpen(p, device, ids);
      const again = await face();
      assert.deepEqual([again.order, again.title, again.root.text, again.whole.text, again.bare, again.thumbed, again.lone],
        [seen.order, seen.title, seen.root.text, seen.whole.text, seen.bare, seen.thumbed, seen.lone], `${device}: after a reload, the same order, names and folds`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks inside a dossier a press on a shown message\'s header folds it for the reader alone, its words open the Reader, a folded row keeps its bar with Unfold on it, and the first message folds by its header and x, unfolds by its row and shows its bar as any message, the title row staying the dossier\'s; a message on its own opens from its header (item 471)', async () => {
    for (const device of Object.keys(DEVICES)) for (const width of widthsOf(device)) {
      const topic = `stack-inside-press-${device}-${width}`;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The original message.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
        ['two', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }],
        ['lone', { sender: other, addressees: [facts.actor], body: 'A message on its own.', read: true }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.two, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root);
      await atWidth(p, device, width);
      await fullyOpen(p, device, ids);
      const at = `${device} ${width}px`;
      const header = id => `${card(id)} > .message-author > .author-name`, row = id => `${card(id)} > .message-folded > .folded-author`;
      const nothingElse = async what => {
        assert.equal(await readerOn(p), null, `${at}: ${what} opens no Reader`);
        assert.equal(await p.evaluate(`Boolean(document.querySelector('.color-picker'))`), false, `${at}: nor the color picker`);
      };
      // A reply shown whole: a press on its header folds it, for the reader alone.
      await centre(p, card(ids.one));
      await twoTaps(p, device, ids.one, header(ids.one));
      await until(async () => await foldOf(topic, ids.one), `${at}: a press on the header folds the reply, in Core`);
      await becomes(async () => (await folded(p, ids.one)).row, true, `${at}: it is its row, in its place`);
      assert.equal(await foldOf(topic, ids.one, other), false, `${at}: another reader's view is unchanged`);
      await nothingElse('the header press');
      if (device === 'laptop') {
        // Folded, its row lights under the pointer and keeps its bar, whose Fold is now Unfold (item 473 over 471's
        // barless fold, by default pending Tony #6363).
        await p.point(row(ids.one), 'move');
        await until(async () => (await lit(p)).includes(ids.one) && await bar(p) !== null, `${at}: the folded row lights, with its bar`);
        await until(() => p.evaluate(`(b=>Boolean(b&&!b.hidden&&b.querySelector('[data-act=fold]:not([hidden])')?.getAttribute('aria-label')==='Unfold'))(document.querySelector('.message-bar'))`),
          `${at}: its bar offers Unfold`);
      }
      // A press on its row unfolds it; a press on its words opens the Reader, folding nothing.
      await press(p, device, row(ids.one));
      await until(async () => !await foldOf(topic, ids.one), `${at}: a press on the row unfolds it, in Core`);
      await becomes(async () => (await folded(p, ids.one)).whole, true, `${at}: and it reads whole`);
      // A starred reply stays open: a press on its header says so and folds nothing. (Before the Reader: in Safari's
      // engine a phone tap leaves a mouse position behind, and a later scroll lights the card under it.)
      await twoTaps(p, device, ids.two, header(ids.two));
      await until(async () => await said(p) === 'Starred messages stay open', `${at}: a press on a starred message's header says it stays open`);
      await until(() => p.evaluate('window.fetchesOut === 0'), `${at}: nothing is out after it`);
      assert.deepEqual([await foldOf(topic, ids.two), (await folded(p, ids.two)).whole], [false, true], `${at}: the starred reply stays whole, in Core`);
      await nothingElse('the starred header press');
      await twoTaps(p, device, ids.one, words(ids.one));
      await until(async () => (await readerOn(p))?.startsWith('Reply one'), `${at}: a press on its words opens the Reader`);
      await closeReader(p, device);
      assert.equal(await foldOf(topic, ids.one), false, `${at}: opening it folded nothing`);
      // The first message, as any message: its bar, a press on its header folds it under the title row, its row unfolds it.
      await centre(p, card(ids.root));
      if (device === 'laptop') {
        await p.point(words(ids.root), 'move');
        await until(async () => (await lit(p)).includes(ids.root) && await bar(p) !== null, `${at}: the first message lights with its bar`);
      }
      await twoTaps(p, device, ids.root, header(ids.root));
      await until(async () => await foldOf(topic, ids.root), `${at}: a press on the first message's header folds it, in Core`);
      await becomes(async () => { const l = await look(p, ids, 'root'); return [l.fold, l.headOpen, l.full, (await folded(p, ids.root)).row]; }, ['open', 'true', false, true],
        `${at}: the dossier stays fully open, its title row open, the first message its own row`);
      await nothingElse('the first message\'s header press');
      await press(p, device, row(ids.root));
      await until(async () => !await foldOf(topic, ids.root), `${at}: a press on its row unfolds it, in Core`);
      await becomes(async () => (await look(p, ids, 'root')).full, true, `${at}: and it reads whole`);
      if (device === 'laptop') {
        await keyTo(p, ids.root);
        await typeX(p);
        await until(async () => await foldOf(topic, ids.root), `${at}: x folds the first message`);
        await typeX(p);
        await until(async () => !await foldOf(topic, ids.root), `${at}: and x again unfolds it`);
      }
      // The title row stays the one special row: a press on it shows latest and unread and back, folding no message.
      await until(() => p.evaluate('window.fetchesOut === 0'), `${at}: nothing is out`);
      const sent = await foldsSent(p);
      await press(p, device, `${card(ids.root)} > .stack-head .stack-who`);
      await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', `${at}: a press on the title row shows latest and unread`);
      await press(p, device, `${card(ids.root)} > .stack-head .stack-who`);
      await becomes(async () => (await look(p, ids, 'root')).fold, 'open', `${at}: and again every message`);
      assert.equal(await foldsSent(p), sent, `${at}: the title row folds no message`);
      // A message on its own is no dossier: a press on its header's time opens it.
      await centre(p, card(ids.lone));
      await twoTaps(p, device, ids.lone, `${card(ids.lone)} > .message-author > .message-time`);
      await until(async () => (await readerOn(p))?.startsWith('A message on its own'), `${at}: a message on its own opens from its header`);
      await closeReader(p, device);
      assert.equal(await foldOf(topic, ids.lone), false, `${at}: and folds nothing`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-inside-press-${device}-${width}-${theme}`); }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  if (engine === 'chrome') await check('reading stacks Option held with two fingers right on the trackpad folds the message and every message before it in its dossier, for the reader alone as a plain fold; later and starred messages stay whole, ⌘Z unfolds them all, and without Option only the message folds (item 472)', async () => {
    const topic = 'stack-fold-through';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The original message.', read: true }],
      ['r1', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
      ['r2', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, starred.', read: true }],
      ['r3', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply three, swiped.', read: true }],
      ['r4', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply four, after it.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.r2, operation_id: topic + '-star', args: { starred: true } });
    let p = await open(topic, 'laptop', topic, ids.root, HEARD_WHEELS);
    await fullyOpen(p, 'laptop', ids);
    const folds = async () => Object.fromEntries(await Promise.all(['root', 'r1', 'r2', 'r3', 'r4'].map(async key => [key, await foldOf(topic, ids[key])])));
    const rows = () => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)};return ['root','r1','r2','r3','r4'].map(k=>{const c=document.querySelector('#messages .message-card[data-id="'+ids[k]+'"]');return k+(c.dataset.folded==='true'?':row':'')})})()`);
    await trackpad(p, card(ids.r3), SWIPE_RIGHT, 1);
    await becomes(folds, { root: true, r1: true, r2: false, r3: true, r4: false }, 'Option and a swipe right fold the message and every one before it, the starred one aside, in Core');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.equal(await said(p), '3 messages folded to one line, for you only');
    assert.deepEqual(await rows(), ['root:row', 'r1:row', 'r2', 'r3:row', 'r4'], 'each folded message is its row, in its place');
    assert.equal((await look(p, ids, 'root')).fold, 'open', 'and the dossier stays fully open');
    for (const key of ['root', 'r1', 'r3']) assert.equal(await foldOf(topic, ids[key], other), false, `another reader's view of ${key} is unchanged`);
    assert.equal((await actsOf(topic, ids.root))?.aside ?? null, null, 'nothing moved below More');
    await p.key('z', 4);
    await becomes(folds, { root: false, r1: false, r2: false, r3: false, r4: false }, '⌘Z unfolds them all, in Core');
    await becomes(rows, ['root', 'r1', 'r2', 'r3', 'r4'], 'and each reads whole');
    // Without Option, a swipe folds the message alone.
    await trackpad(p, card(ids.r3), SWIPE_RIGHT);
    await becomes(folds, { root: false, r1: false, r2: false, r3: true, r4: false }, 'a plain swipe folds only the message under it');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    // A reload finds what Core holds.
    const stored = await storedActs(topic);
    await p.close();
    p = await open(topic + '-reload', 'laptop', topic, ids.root);
    await fullyOpen(p, 'laptop', ids);
    await becomes(rows, ['root', 'r1', 'r2', 'r3:row', 'r4'], 'after a reload, the same messages in the same order, the same folded');
    assert.deepEqual(await storedActs(topic), stored, 'and Core holds the same');
    await shot(p, 'stack-fold-through');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 472 in a dossier longer than the page loads: its first message and the replies after it are outside the loaded
  // page, and Option with a swipe right on a loaded reply folds them too, in Core, by one request: what a plain fold
  // stores, for the reader alone. A starred one and the replies after the swiped one stay whole, another reader's own
  // folds stand, ⌘Z unfolds every one, and loading the earlier messages, on a new document, shows the stored folds.
  if (engine === 'chrome') await check('reading stacks Option held with two fingers right on the trackpad folds every message before it in a dossier longer than the loaded page, loaded or not, by one request, for the reader alone; ⌘Z unfolds them all and Earlier messages shows them folded (item 472)', async () => {
    const topic = 'stack-fold-through-long';
    const messages = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The first message, outside the loaded page.', read: true }],
      ...Array.from({ length: 35 }, (_, i) => ['r' + i, { sender: other, reply_to: i ? 'r' + (i - 1) : 'root', addressees: [facts.actor], body: `Reply ${i}.`, read: true }])];
    const ids = await seed(topic, messages);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.r2, operation_id: topic + '-star', args: { starred: true } });
    // Another reader's own fold, on a message before the swiped one, and on one after it.
    for (const key of ['r1', 'r20']) await control({ method: 'stack_act', sender: other, kind: 'message.fold', message_id: ids[key], operation_id: `${topic}-other-${key}`, args: { folded: true } });
    let p = await open(topic, 'laptop', topic, ids.r34, HEARD_WHEELS);
    const loaded = id => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(id))}))`);
    assert.deepEqual([await loaded(ids.root), await loaded(ids.r4), await loaded(ids.r5)], [false, false, true], 'the first message and replies 0 to 4 are outside the loaded page');
    const shownHead = await p.evaluate(`document.querySelector(${JSON.stringify(entry(ids.r34))}).closest('.reply-stack').dataset.stack`);
    await fullyOpen(p, 'laptop', { root: shownHead });
    // Open, a dossier of more than seven shows its newest seven and one row for the earlier ones (item 476): that row
    // is opened, as a person opens it, so reply 10 shows, as an earlier message's row, under the swipe.
    const earlierRow = `#messages .reply-stack[data-stack="${shownHead}"] > .stack-replies > .stack-earlier`;
    await centre(p, earlierRow); await press(p, 'laptop', earlierRow);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.r10))})?.getClientRects().length)`), 'reply 10 shows once the earlier messages\' row is opened');
    const keys = ['root', ...Array.from({ length: 35 }, (_, i) => 'r' + i)];
    const before = ['root', 'r0', 'r1', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10'];
    const foldsOf = async (reader = facts.actor) => {
      const found = reader === facts.actor ? await view('message_acts', { topic_id: topic, limit: 100 }) : (await control({ method: 'acts_as', reader, topic_id: topic })).acts;
      const folded = new Set(found.items.filter(item => item.acts.folded).map(item => item.message_id));
      return keys.filter(key => folded.has(ids[key]));
    };
    const sent = () => p.evaluate(`window.sent.filter(kind=>kind.startsWith('message.fold')).length`);
    await trackpad(p, card(ids.r10), SWIPE_RIGHT, 1);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    assert.deepEqual(await foldsOf(), before, 'Option and a swipe right on reply 10 fold it and every message before it in Core, loaded or not: the starred one and the ones after it stay whole');
    assert.equal(await sent(), 1, 'by one request');
    assert.deepEqual(await foldsOf(other), ['r1', 'r20'], 'another reader\'s own folds stand, and nothing else folds for them');
    assert.equal(await said(p), `${before.length} messages folded to one line, for you only`);
    await p.key('z', 4);
    await becomes(() => foldsOf(), [], '⌘Z unfolds every one of them in Core, the ones not loaded included');
    assert.deepEqual(await foldsOf(other), ['r1', 'r20'], 'and another reader\'s folds still stand');
    await trackpad(p, card(ids.r10), SWIPE_RIGHT, 1);
    await becomes(() => foldsOf(), before, 'Option and a swipe right fold them again');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    // A new document, on a laptop and on a phone: Earlier messages reads the older pages, which show the stored folds.
    await p.close();
    for (const device of Object.keys(DEVICES)) {
      p = await open(`${topic}-${device}-reload`, device, topic, ids.r34);
      const cards = () => p.evaluate(`document.querySelectorAll('#messages .message-card[data-id]').length`);
      for (let page = 0; !await loaded(ids.root); page++) {
        assert.ok(page < 3, `${device}: Earlier messages reaches the first message`);
        const count = await cards();
        await centre(p, '#more-messages'); await press(p, device, '#more-messages');
        await until(async () => (await cards()) > count, `${device}: Earlier messages reads an older page`);
      }
      await fullyOpen(p, device, ids);
      const rows = () => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)};return ${JSON.stringify(keys)}.filter(k=>document.querySelector('#messages .message-card[data-id="'+ids[k]+'"]')?.dataset.folded==='true')})()`);
      await becomes(rows, before, `${device}: after a reload, with the earlier messages loaded, each message before reply 10 but the starred one is its row, and none after it`);
      // The earlier messages wait behind their row (item 476): it is opened so the shots show the stored folds.
      const earlier = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-replies > .stack-earlier`;
      await centre(p, earlier); await press(p, device, earlier);
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.r2))})?.getClientRects().length)`), `${device}: the starred reply 2 shows once the earlier messages' row is opened`);
      await centre(p, card(ids.r2));
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-fold-through-long-${device}-${theme}`); }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 472: a message the reader placed on its own is a section with no title bar, so a swipe over it is a swipe over a
  // message, as anywhere: right folds it in place, for the reader alone, and it stays where it was placed, above More;
  // left unfolds it, on the same page. Two fingers on a laptop's trackpad in both engines, each gesture stamped as a real
  // trackpad's (trackpad), and a finger on a phone in Chrome.
  await check('reading stacks a message placed on its own folds in place under a swipe right and unfolds under a swipe left, and never goes below More (item 472)', async () => {
    const topic = 'stack-placed-swipe';
    const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
      ['placed', { sender: other, join: true, addressees: [facts.actor], body: 'A message the reader placed on its own, to swipe.', read: true }],
      ['plain', { sender: other, addressees: [facts.actor], body: 'Another message on its own, nobody placed it.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.place', message_id: ids.placed, operation_id: `${topic}-place`, args: { key: 1 } });
    const section = `#messages .reply-stack[data-stack="${ids.placed}"]`;
    const state = p => p.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)}),c=document.querySelector(${JSON.stringify(card(ids.placed))});
      return {single:s?.dataset.single??null,shown:Boolean(s?.getClientRects().length),row:c?.dataset.folded==='true',more:Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)}})()`);
    const core = async () => { const acts = await actsOf(topic, ids.placed); return { folded: acts?.folded ?? false, aside: acts?.aside ?? null, placed: typeof acts?.placed }; };
    const drag = async (p, selector, way) => {
      await centre(p, selector); const b = await p.box(selector), y = b.y + b.height / 2, t = Date.now() / 1000, from = way > 0 ? b.x + 30 : b.x + Math.min(b.width - 30, 170);
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }], timestamp: t });
      for (const part of [1, 2, 3, 4]) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + way * 35 * part, y }], timestamp: t + part * .08 });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + .6 });
    };
    const ways = [['laptop', (p, way) => trackpad(p, card(ids.placed), way > 0 ? SWIPE_RIGHT : SWIPE_RIGHT.map(([x, y]) => [-x, y]))]];
    if (engine === 'chrome') ways.push(['phone', (p, way) => drag(p, card(ids.placed), way)]);
    for (const [device, swipe] of ways) {
      const p = await open(`${topic}-${device}`, device, topic, ids.placed, HEARD_WHEELS);
      await becomes(() => state(p), { single: 'true', shown: true, row: false, more: false }, `${device}: the placed message is a section of its own, with no title bar, above no More`);
      await swipe(p, 1);
      await until(() => p.evaluate('window.fetchesOut === 0'), `${device}: every act sent is answered`);
      assert.deepEqual(await core(), { folded: true, aside: null, placed: 'number' }, `${device}: a swipe right folds the placed message in Core, and leaves it placed, above More`);
      await becomes(() => state(p), { single: 'true', shown: true, row: true, more: false }, `${device}: it is its row, where it was placed, and nothing went below More`);
      assert.equal((await actsOf(topic, ids.placed, other))?.folded ?? false, false, `${device}: another reader's view of it is unchanged`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-placed-swipe-${device}-${theme}`); }
      await swipe(p, -1);
      await until(() => p.evaluate('window.fetchesOut === 0'), `${device}: every act sent is answered`);
      assert.deepEqual(await core(), { folded: false, aside: null, placed: 'number' }, `${device}: a swipe left on the same page unfolds it in Core, still placed`);
      await becomes(() => state(p), { single: 'true', shown: true, row: false, more: false }, `${device}: it reads whole again, where it was placed`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 430, as Tony's 5418 put it right: the lit message's ring is drawn on its own box and read from the screen.
  // The card in front of it (the next one, over its bottom edge by the 12px overlap) covers the ring's bottom side as it
  // covers the card's own bottom edge; the ring's top side and its sides show. One outline: down the middle of the lit
  // message and the card in front, the ring's colour shows only at its top side, and at its bottom side when nothing is
  // in front; across its middle, only at its two sides. Each side is where the box's edge is, within a pixel as the
  // screen rounds it. A hit test alone would pass a ring drawn over the card in front (it takes no pointer), so the
  // pixels are read.
  // Each problem is said; with `wrong` given they are gathered there, every state's, for the case to say at once.
  const ringRead = async (p, selector, at, key, { inWindow = true } = {}, wrong = null) => {
    const problems = [], need = (ok, message) => { if (!ok) problems.push(message); };
    await twoFrames(p);
    const box = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),b=c.getBoundingClientRect(),probe=document.createElement('span');
      probe.style.background='var(--stack-ring)';c.append(probe);const ring=getComputedStyle(probe).backgroundColor;probe.remove();
      const x=document.createElement('canvas').getContext('2d');x.fillStyle=ring;x.fillRect(0,0,1,1);
      const s=c.closest('.reply-stack'),shown=[...s.querySelectorAll(':scope > [data-id], :scope > .stack-replies > [data-id]')].filter(e=>e.getClientRects().length);
      const entry=shown.find(e=>e.contains(c)),front=shown[shown.indexOf(entry)+1]??null,last=shown.at(-1),f=front?.getBoundingClientRect();
      const walk=front&&document.createTreeWalker(front,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.textContent.trim()&&t.parentElement.getClientRects().length?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP});
      const text=walk?.nextNode(),range=document.createRange();if(text)range.selectNodeContents(text);
      const hit=document.elementFromPoint((b.left+b.right)/2,b.bottom+1),bar=document.querySelector('.message-bar'),r=bar&&!bar.hidden&&bar.getClientRects().length?bar.getBoundingClientRect():null;
      return {bar:r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null,left:b.left,right:b.right,top:b.top,bottom:b.bottom,radius:parseFloat(getComputedStyle(c).borderTopLeftRadius)||0,
        front:f?{top:f.top,bottom:f.bottom}:null,frontWords:text?range.getBoundingClientRect().top:null,hitBelow:hit?(front?.contains(hit)?'front':c.contains(hit)?'lit':'other'):null,
        last:last===entry?null:last.getBoundingClientRect().bottom,covered:entry.dataset.stackCovered??null,scrollsInPlace:c.classList.contains('scroll-in-place'),scrollTop:c.scrollTop,
        ring:[...x.getImageData(0,0,1,1).data].slice(0,3),innerWidth,innerHeight}})()`);
    const image = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const scale = image.width / box.innerWidth, inside = (v, most) => Math.max(0, Math.min(most - 1, v));
    const ringy = (x, y) => image.pixel(Math.floor(inside(x, box.innerWidth) * scale), Math.floor(inside(y, box.innerHeight) * scale)).every((v, i) => Math.abs(v - box.ring[i]) <= 24);
    // The runs of the ring's colour along a line, each [first, last] in CSS pixels.
    const runs = (from, to, point) => {
      const out = [];
      for (let v = Math.floor(from); v <= Math.ceil(to); v++) {
        if (!ringy(...point(v))) continue;
        if (out.length && out.at(-1)[1] === v - 1) out.at(-1)[1] = v; else out.push([v, v]);
      }
      return out;
    };
    // A band from..to (its far edge exclusive) matches a run within a pixel, as the screen rounds it.
    const band = (run, from, to) => Boolean(run) && Math.abs(run[0] - from) <= 1.5 && Math.abs(run[1] + 1 - to) <= 1.5;
    const says = `${at}: ${JSON.stringify(box)}`;
    const topShown = box.top - 2 >= 0, bottomShown = box.bottom + 3 < box.innerHeight;
    if (inWindow) need(topShown && bottomShown, `${at}: ${key}'s top and bottom edges are in the window: ${says}`);
    // The message's bar floats over its top right corner, over the ring there too: points under it are not read.
    const free = (x, y) => !box.bar || x < box.bar.left - 2 || x > box.bar.right + 2 || y < box.bar.top - 2 || y > box.bar.bottom + 2;
    const across = [box.left + box.radius + 2, box.right - box.radius - 2], xs = [];
    for (let x = across[0]; x <= across[1]; x += 2) xs.push(x);
    const until_ = Math.min(box.front ? box.front.top - 2 : box.bottom - box.radius - 1, box.innerHeight - 2), ys = [];
    for (let y = Math.max(box.top, 0) + box.radius; y <= until_; y += 2) ys.push(y);
    const read = { box, under: null, top: null, sides: null, down: null, across: null };
    if (box.front) {
      need(box.covered === 'true', `${at}: the card in front overlaps ${key}`);
      if (bottomShown) {
        // The strip the ring's bottom side would take, inside the card in front: none of the ring's colour.
        read.under = [Math.floor(box.bottom), Math.floor(box.bottom) + 1].flatMap(y => xs.filter(x => free(x, y) && ringy(x, y + .5)).map(x => [x, y]));
        need(!read.under.length, `${at}: the ring's bottom side is drawn under the card in front of ${key}, never over it: ring colour at ${read.under.length} points of the strip, from ${JSON.stringify(read.under.slice(0, 3))}: ${says}`);
        need(box.hitBelow === 'front', `${at}: the card in front is topmost just below ${key}'s edge: ${says}`);
        need(box.frontWords >= box.bottom + 2 - .5, `${at}: the words the card or line in front shows first stay below ${key}'s edge: ${says}`);
      }
    }
    if (topShown) {
      // The ring's top side, above the card behind: the ring's colour all along it.
      read.top = xs.filter(x => free(x, box.top - 1.5) && !ringy(x, box.top - 1.5));
      need(!read.top.length, `${at}: the ring's top side shows all along ${key}'s top edge: missing at ${read.top.length} points from x ${read.top[0]}: ${says}`);
    }
    // Its sides, down to where the card in front begins.
    read.sides = ys.filter(y => !ringy(box.left - 1.5, y) || (free(box.right + .5, y) && !ringy(box.right + .5, y)));
    need(!read.sides.length, `${at}: the ring's sides show down ${key}'s edges: missing at ${read.sides.length} points from y ${read.sides[0]}: ${says}`);
    // One outline, on the box's own edges: down a line near its left side, clear of the bar, and across its middle.
    const mid = box.left + box.radius + 4;
    read.down = runs(Math.max(box.top - 6, 0), Math.min(box.front ? box.front.bottom - 3 : box.bottom + 6, box.innerHeight - 1), y => [mid, y]);
    const want = [...(topShown ? [[box.top - 2, box.top]] : []), ...(!box.front && bottomShown ? [[box.bottom, box.bottom + 2]] : [])];
    need(read.down.length === want.length && want.every(([a, b], i) => band(read.down[i], a, b)),
      `${at}: down ${key}${box.front ? ' and the card in front' : ''} the ring shows once, at its own top${!box.front && bottomShown ? ' and bottom' : ''}: runs ${JSON.stringify(read.down)}, want ${JSON.stringify(want)}, ${says}`);
    const row = (Math.max(box.top, 0) + box.radius + until_) / 2;
    read.across = runs(box.left - 6, box.right + 6, x => [x, row]);
    need(read.across.length === 2 && band(read.across[0], box.left - 2, box.left) && band(read.across[1], box.right, box.right + 2),
      `${at}: across ${key} the ring shows once at each side, on its edges: runs ${JSON.stringify(read.across)}, ${says}`);
    if (box.last !== null && box.last + 3 < box.innerHeight) {
      read.below = runs(box.last + .5, box.last + 2.5, y => [mid, y]);
      need(!read.below.length, `${at}: no ring is drawn below the dossier's last card while ${key} is lit: ${says}`);
    }
    observations.push({ name: 'stack lit ring', engine, at, key, ring: box.ring, down: read.down, across: read.across, scrollsInPlace: box.scrollsInPlace, scrollTop: box.scrollTop, problems });
    if (wrong) wrong.push(...problems); else assert.deepEqual(problems, [], problems.join('\n'));
    return read;
  };
  // Scrolls a box, the card read in place or the page holding it, to the place `to` names (an expression of `el`, the
  // scrolling element), done when the scroll has ended: on its scrollend event where the engine sends one, else on its
  // scroll event, the position being set at once; at once when it is already there.
  const scrolled = (p, selector, page, to) => p.evaluate(`new Promise(done=>{const c=document.querySelector(${JSON.stringify(selector)});let box=${page ? 'c.parentElement' : 'c'};
    if(${page})while(box&&!(/(auto|scroll)/.test(getComputedStyle(box).overflowY)&&box.scrollHeight>box.clientHeight+1))box=box.parentElement;
    const el=box||document.scrollingElement,events=box||document,goal=Math.round(Math.max(0,Math.min(el.scrollHeight-el.clientHeight,${to})));
    if(Math.abs(el.scrollTop-goal)<1)return done(el.scrollTop);
    events.addEventListener('onscrollend' in window?'scrollend':'scroll',()=>done(el.scrollTop),{once:true});el.scrollTop=goal})`);
  const long = what => Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of ${what}, long enough to be read in place.`).join('\n');
  const longDossier = topic => seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
    ['root', { sender: other, join: true, addressees: [facts.actor], body: long('the first message') }],
    ['long', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: long('an agent\'s reply') }],
    ['between', { sender: 'aim-ux', reply_to: 'root', addressees: [other], body: 'Between the agents, to aim-core.', read: true }],
    ['short', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A short reply after them.' }],
    ['tail', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: long('the latest reply') }]]);

  await check('reading stacks the lit message\'s ring has its bottom side under the card in front and its top and sides shown, read from the screen, a reply\'s and the first message\'s, short, long read in place and scrolled inside, and a fold line, at 320, 375 and 390 wide and on a laptop, light and dark (item 430, Tony 5418)', async () => {
    const line = id => `#messages .message-fold[data-id="${id}"] > .fold-line`;
    for (const device of Object.keys(DEVICES)) {
      const topic = `stack-ring-${device}`, ids = await dossierSeed(topic, false, true);
      const longTopic = `stack-ring-long-${device}`, longIds = await longDossier(longTopic);
      let negatives = 0;
      for (const [seeded, root, keys] of [[topic, ids, ['root', 'middle']], [longTopic, longIds, ['root', 'long', 'between']]]) {
        const p = await open(seeded, device, seeded, root.root); await dossierOpen(p, device, root.root);
        for (const width of widthsOf(device)) {
          await atWidth(p, device, width);
          for (const key of keys) {
            const id = root[key], folded = key === 'between', selector = folded ? line(id) : card(id), scrolls = seeded === longTopic && !folded;
            await centre(p, selector);
            if (folded) {
              assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')`), 'false', `${device} ${width}px: the fold line between agents is shut`);
              await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
            } else await light(p, device, id);
            await until(async () => (await lit(p)).includes(id), `${device} ${width}px: ${key} is lit`);
            if (scrolls) {
              // Lit, a long message's whole words come and its card is read in place, scrolling inside itself.
              await until(() => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).classList.contains('scroll-in-place')`), `${device} ${width}px: lit, the long ${key} is read in place`);
              await centre(p, selector);
            }
            for (const theme of ['light', 'dark']) {
              await dossierTheme(p, theme);
              const at = `${device} ${width}px ${theme}`;
              const top = await ringRead(p, selector, at, key);
              if (top.below) negatives++;
              if (scrolls) {
                assert.equal(top.box.scrollsInPlace, true, `${at}: ${key} scrolls inside its card`);
                await scrolled(p, selector, false, '(el.scrollHeight-el.clientHeight)/2');
                const inside = await ringRead(p, selector, `${at} scrolled inside`, key);
                assert.ok(inside.box.scrollTop > 0, `${at}: ${key} scrolled inside its card: ${JSON.stringify(inside.box)}`);
                await scrolled(p, selector, false, '0');
              }
              if (key === keys[1]) await shot(p, `stack-ring-${seeded === longTopic ? 'long-' : ''}${device}-${width}-${theme}`);
              if (folded) await shot(p, `stack-ring-fold-line-${device}-${width}-${theme}`);
            }
          }
        }
        assert.deepEqual(p.errors, []); await p.close();
      }
      assert.ok(negatives > 0, `${device}: the last card's bottom edge was read for a stray ring at least once`);
    }
  });

  // Tony's 5418 beside item 478: a passage lit under the pointer on a lit dossier card is painted over the card's words
  // (a highlight) and the card's ring is its box's own: the two touch the same card and neither undoes the other. Read
  // from the screen: the passage's own boxes show the highlight's fill, and the ring keeps its top and sides, one outline,
  // its bottom under the card in front.
  await check('reading stacks a passage lit under the pointer on a lit dossier card keeps its light over the words while the card keeps its ring, its bottom under the card in front, at 1280 and 900 wide, light and dark (Tony 5418, item 478)', async () => {
    const said = ['Words before the passage.', 'The lit passage is these words.', 'Words after the passage.'];
    const topic = 'stack-ring-passage', ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
      ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The message a dossier grows from.', read: true }],
      ['reply', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: said.join(' '), read: true }],
      ['after', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply in front of it.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root); await dossierOpen(p, 'laptop', ids.root);
    const at = text => p.evaluate(`(()=>{const w=document.querySelector(${JSON.stringify(card(ids.reply) + ' > .message-preview')}),t=${JSON.stringify(text)},walker=document.createTreeWalker(w,4);let n;
      while((n=walker.nextNode())&&!n.data.includes(t));if(!n)return null;const r=document.createRange();r.setStart(n,n.data.indexOf(t));r.setEnd(n,n.data.indexOf(t)+t.length);
      const b=r.getClientRects()[0];return {x:b.left+b.width/2,y:b.top+b.height/2,top:b.top,height:b.height,left:b.left,right:b.right}})()`);
    const shining = () => p.evaluate(`(()=>{const h=CSS.highlights.get('lit-passage');return h&&h.size?[...h][0].toString():null})()`);
    for (const width of [DEVICES.laptop.width, 900]) {
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: DEVICES.laptop.height, deviceScaleFactor: 1, mobile: false });
      await centre(p, card(ids.reply));
      await p.point(card(ids.reply) + ' > .message-author', 'move');
      await until(async () => (await lit(p)).includes(ids.reply), `${width}px: the reply is lit from its author's line`);
      const words = await at('lit passage');
      assert.ok(words, `${width}px: the passage is drawn on the reply`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: words.x, y: words.y });
      await becomes(shining, said[1] + ' ', `${width}px: the passage under the pointer lights`);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const where = `laptop ${width}px ${theme}`;
        assert.equal(await shining(), said[1] + ' ', `${where}: the passage is still lit`);
        await ringRead(p, card(ids.reply), `${where} with a passage lit`, 'reply');
        // The highlight's fill (aim.css: black under white words) across the passage's first line, read from the screen
        // along a row near the top of its line box, which is mostly the fill between the letters' tops.
        const box = await at('lit passage'), image = pngPixels(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        const scale = image.width / width;
        const filled = b => { const xs = []; for (let x = b.left + 1; x < b.right - 1; x += 2) xs.push(x); return [xs.filter(x => image.pixel(Math.floor(x * scale), Math.floor((b.top + b.height * .15) * scale)).every(v => v <= 40)).length, xs.length]; };
        const [dark, of] = filled(box), [unlit, unlitOf] = filled(await at('Words before'));
        assert.ok(dark >= of * .75, `${where}: the lit passage's fill shows over its words (${dark} of ${of} points)`);
        assert.ok(unlit <= unlitOf * .25, `${where}: and not over the words before it (${unlit} of ${unlitOf} points)`);
        observations.push({ name: 'stack lit ring with a passage', engine, where, dark, of, unlit, unlitOf });
        await shot(p, `stack-ring-passage-${width}-${theme}`);
      }
    }
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Tony's 5418: a long message read in place keeps one ring, on its own box, as it scrolls inside, as the page scrolls
  // it, as the window resizes and as it grows (Show full message): each read after the scroll has ended. The first
  // message and a reply have a card in front; the latest reply has none, so its whole ring shows, bottom side too.
  await check('reading stacks a lit message read in place keeps one ring on its own box as it scrolls inside, as the page scrolls, as the window resizes and as it grows, read from the screen, the first message, a reply and the latest reply, at 320, 375 and 390 wide and on a laptop, light and dark (Tony 5418)', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `stack-ring-scroll-${device}`, ids = await longDossier(topic), wrong = [];
      // Grown: on a page of its own, before anything scrolls it, Show full message takes the read-in-place box away
      // from the lit reply and its card grows below its words; its bottom side is read where the window shows it.
      const g = await open(`${topic}-grown`, device, topic, ids.root); await dossierOpen(g, device, ids.root);
      const grow = card(ids.long);
      // Lighting reads the whole message in the background lane, which a busy server may refuse: it is lit once the
      // page's own opening reads are answered.
      await until(() => g.evaluate('window.fetchesOut === 0'), `${device}: the page's opening reads are answered`);
      await centre(g, grow); await light(g, device, ids.long);
      await until(() => g.evaluate(`document.querySelector(${JSON.stringify(grow)}).classList.contains('scroll-in-place')`), `${device}: lit, the long reply is read in place`);
      await press(g, device, '.message-bar [data-act="more"]');
      const index = await g.evaluate(`[...document.querySelectorAll('.message-menu-list > button')].findIndex(b=>b.textContent==='Show full message')`);
      assert.ok(index >= 0, `${device}: the lit message offers Show full message`);
      await press(g, device, `.message-menu-list > button:nth-child(${index + 1})`);
      await until(() => g.evaluate(`document.querySelector(${JSON.stringify(grow)}).dataset.full==='shown'`), `${device}: the card shows its whole message`);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(g, theme);
        assert.ok((await lit(g)).includes(ids.long), `${device} ${theme}: the grown reply is still lit`);
        await ringRead(g, grow, `${device} ${theme} grown`, 'long', { inWindow: false }, wrong);
        await shot(g, `stack-ring-grown-${device}-${theme}`);
      }
      // Its bottom in view: the card in front covers the ring's bottom side. Scrolling the page can let a phone's light
      // go in Safari's engine in this harness; then there is no ring to read, and that is said.
      await scrolled(g, grow, true, 'el.scrollTop+c.getBoundingClientRect().bottom-innerHeight*.7');
      if ((await lit(g)).includes(ids.long)) {
        const bottom = await ringRead(g, grow, `${device} dark grown, its bottom in view`, 'long', { inWindow: false }, wrong);
        assert.ok(bottom.under !== null, `${device}: the grown card's bottom edge was read: ${JSON.stringify(bottom.box)}`);
      }
      else observations.push({ name: 'stack lit ring grown, light let go on a scroll', engine, device });
      await shot(g, `stack-ring-grown-bottom-${device}-dark`);
      assert.deepEqual(g.errors, []); await g.close();
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root);
      await until(() => p.evaluate('window.fetchesOut === 0'), `${device}: the page's opening reads are answered`);
      const sizes = device === 'phone' ? PHONES : [DEVICES.laptop.width, 900];
      for (const key of ['root', 'long', 'tail']) {
        const selector = card(ids[key]);
        for (const width of sizes) {
          if (device === 'phone') await atWidth(p, device, width);
          else await p.send('Emulation.setDeviceMetricsOverride', { width, height: DEVICES.laptop.height, deviceScaleFactor: 1, mobile: false });
          await centre(p, selector);
          if (!(await lit(p)).includes(ids[key])) await light(p, device, ids[key]);
          await until(() => p.evaluate(`document.querySelector(${JSON.stringify(selector)}).classList.contains('scroll-in-place')`), `${device} ${width}px: lit, the long ${key} is read in place`);
          await centre(p, selector);
          for (const theme of ['light', 'dark']) {
            await dossierTheme(p, theme);
            const at = `${device} ${width}px ${theme} ${key}`;
            await ringRead(p, selector, `${at} at rest`, key, {}, wrong);
            await scrolled(p, selector, false, '(el.scrollHeight-el.clientHeight)/2');
            const middle = await ringRead(p, selector, `${at} scrolled inside to its middle`, key, {}, wrong);
            assert.ok(middle.box.scrollTop > 0, `${at}: scrolled inside: ${JSON.stringify(middle.box)}`);
            await scrolled(p, selector, false, 'el.scrollHeight');
            await ringRead(p, selector, `${at} scrolled inside to its end`, key, {}, wrong);
            const moved = await scrolled(p, selector, true, 'el.scrollTop+48');
            await ringRead(p, selector, `${at} with the page scrolled (${moved})`, key, {}, wrong);
            await shot(p, `stack-ring-scroll-${key}-${device}-${width}-${theme}`);
            await scrolled(p, selector, false, '0'); await centre(p, selector);
          }
        }
      }
      assert.deepEqual(wrong, [], `${device}: ${wrong.length} problems with the ring:\n${wrong.slice(0, 24).join('\n')}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 430: a message between others is one quiet line in a dossier too, and its line answers the pointer and shows
  // when it is open, as it does anywhere.
  await check('reading stacks a fold line in a dossier answers the pointer and shows it is open, at 320, 375 and 390 wide and on a laptop, light and dark (item 430)', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `stack-fold-line-${device}`;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The dossier\'s first message.', read: true }],
        ['between', { sender: 'aim-ux', reply_to: 'root', addressees: [other], body: 'Between the agents, to aim-core.', read: true }],
        ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest reply.', read: true }]]);
      const p = await open(topic, device, topic, ids.root); await dossierOpen(p, device, ids.root);
      const line = `#messages .message-fold[data-id="${ids.between}"] > .fold-line`;
      const paint = () => p.evaluate(`(()=>{const l=document.querySelector(${JSON.stringify(line)}),probe=document.createElement('span');
        const read=v=>{probe.style.background=v;l.append(probe);const c=getComputedStyle(probe).backgroundColor;probe.remove();return c};
        const s=getComputedStyle(l);return {background:s.backgroundColor,color:s.color,soft:read('var(--soft)'),ink:read('var(--ink)'),expanded:l.getAttribute('aria-expanded'),hovered:l.matches(':hover'),inDossier:l.closest('.reply-stack')?.dataset.single==='false'}})()`);
      for (const width of widthsOf(device)) {
        await atWidth(p, device, width);
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme); await centre(p, line); await away(p);
          const at = `${device} ${width}px ${theme}`;
          const rest = await paint();
          assert.deepEqual([rest.inDossier, rest.expanded], [true, 'false'], `${at}: the line is in a dossier, shut`);
          // A phone's emulated touch can leave :hover where a tap was; the quiet words are read where nothing hovers.
          if (!rest.hovered) assert.notEqual(rest.color, rest.ink, `${at}: shut, at rest, its words are quiet`);
          if (device === 'laptop') {
            await p.point(line, 'move');
            await becomes(async () => { const now = await paint(); return [now.background, now.color]; }, [rest.soft, rest.ink], `${at}: the pointer over it gives it the soft fill and full ink`);
            await away(p);
            await becomes(async () => { const now = await paint(); return [now.background, now.color]; }, [rest.background, rest.color], `${at}: and leaving puts it back`);
          }
          await press(p, device, line);
          if (device === 'laptop') await away(p);
          await becomes(async () => { const now = await paint(); return [now.expanded, now.color]; }, ['true', rest.ink], `${at}: open, the line shows it in full ink`);
          if (device === 'laptop') assert.equal((await paint()).hovered, false, `${at}: with the pointer away from it`);
          await shot(p, `stack-fold-line-${device}-${width}-${theme}`);
          await press(p, device, line);
          await becomes(async () => (await paint()).expanded, 'false', `${at}: a press shuts it again`);
        }
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 430's open question (warp's review): whether a saved fold the reader marks unread keeps the read material.
  // Reproduced and reported, the rule unchanged: an unread folded reply is marked unread in Core, beside an unread
  // twin nobody touched; what each shows is recorded.
  await check('reading dossier look: a saved fold the reader marks unread beside an unread twin, recorded for the spec (item 430)', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `dossier-marked-fold-${device}`;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here to reply.', read: true }],
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The dossier\'s first message.', read: true }],
        ['folded', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'An unread reply, folded, then marked unread.' }],
        ['twin', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'An unread reply nobody touched.' }]]);
      await dossierFold(topic, ids.folded);
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.folded], marked: true });
      const p = await open(topic, device, topic, ids.root, 'window.holdReads=true;'); await dossierOpen(p, device, ids.root); await away(p);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const seen = await p.evaluate(`(()=>{const c=id=>document.querySelector('#messages .message-card[data-id="'+id+'"]'),
          pixel=color=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)},
          face=id=>({folded:c(id).dataset.folded==='true',read:c(id).hasAttribute('data-read'),fill:pixel(getComputedStyle(c(id)).backgroundColor)});
          return {folded:face(${JSON.stringify(ids.folded)}),twin:face(${JSON.stringify(ids.twin)})}})()`);
        assert.deepEqual([seen.folded.folded, seen.folded.read, seen.twin.folded, seen.twin.read], [true, false, false, false], `${device} ${theme}: a saved fold and an unread twin`);
        const same = seen.folded.fill.join() === seen.twin.fill.join();
        observations.push({ name: 'dossier marked-unread saved fold', engine, device, theme, keepsReadMaterial: !same, ...seen });
        console.log(`observation: ${engine} ${device} ${theme}: a saved fold marked unread ${same ? 'shows the unread twin\'s material' : 'keeps the read material'} (${seen.folded.fill} beside ${seen.twin.fill})`);
      }
      await shot(p, `dossier-marked-fold-${device}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 479: a minted name. When the first reply on the record lands in a dossier nobody has named, its namer (the
  // outcome's coordinator when it is an agent taking part in the topic, or else the first agent to reply) mints a name, and the tab says "Named by" it on its
  // second line, at every width, in light and dark. Core refuses a mint from anyone else, and a name the person types
  // replaces the minted one and its mark. The page never mints: a mint is the agent's act, arriving as any act does.
  await check('reading stacks a minted name says Named by the agent that minted it in the dossier\'s tab, on a laptop and phones 320 to 390 wide, light and dark, folded and open; a mint from anyone else is refused, and a name the person types replaces it and its mark', async () => {
    const minter = 'aim-ux', words = 'Cabin week plan';
    // The tab, as a person sees it: its name, its "Named by" mark (null without one), whether the two keep to the
    // tab's two lines inside the dossier, whether the mark's words show whole (an agent's name as short as aim-ux
    // is never cut, even at 320: the count gives way first), and the mark's contrast on the folder.
    const tab = (p, id) => p.evaluate(`(()=>{const c=document.querySelector('#messages .message-card[data-id="${id}"]'),row=c?.querySelector(':scope > .stack-head');
      if(!row)return null;const n=row.querySelector('.stack-name'),m=row.querySelector('.stack-named'),s=c.closest('.reply-stack'),box=e=>e.getBoundingClientRect();
      if(!m)return {name:n.textContent,named:null,title:n.title,sideways:document.documentElement.scrollWidth>innerWidth};
      const r=box(row),nb=box(n),mb=box(m),sb=box(s),who=box(row.querySelector('.stack-who'));
      const pixel=color=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)},
        lum=a=>a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((t,v,i)=>t+v*[.2126,.7152,.0722][i],0),
        contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      return {name:n.textContent,named:m.textContent,title:n.title,markTitle:m.title,
        secondLine:mb.top>=nb.bottom-2&&Math.abs(mb.top-who.top)<2,inTab:mb.left>=r.left-.5&&mb.right<=r.right+.5&&mb.bottom<=r.bottom+.5,inDossier:r.right<=sb.right+.5,
        whole:m.scrollWidth<=m.clientWidth+.5,contrast:Math.round(contrast(pixel(getComputedStyle(m).color),pixel(getComputedStyle(row).backgroundColor))*100)/100,
        sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-minted-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Can we lock the cabin for the week of July 12 before Friday?', read: true }],
        ['reply', { sender: minter, join: true, reply_to: 'root', addressees: [facts.actor], body: 'Friday works; I will book it.', read: true }],
        ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Booked for the twelfth.', read: true }]]);
      const p = await open(topic, device, topic, ids.root);
      // Unnamed, the tab shows the first line and no mark.
      await becomes(async () => { const t = await tab(p, ids.root); return t && [t.name, t.named]; }, ['Can we lock the cabin for the week of July 12 before Friday?', null], `${device}: unnamed, the first line and no mark`);
      // Core says who names it, and refuses anyone else's mint: here the first agent to reply, as w1 has no coordinator.
      const namer = await control({ method: 'agent_view', actor: minter, name: 'stack_namer', args: { message_id: ids.last } });
      assert.deepEqual([namer.root_id, namer.namer, namer.name_revision], [ids.root, minter, 0], `${device}: the first agent to reply names it`);
      const refused = await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-not-the-namer`, args: { name: 'Not the namer', minted: true } });
      assert.equal(refused.error?.code, 'NOT_THE_NAMER', `${device}: the root's author, who did not reply first, may not mint it`);
      const minted = await control({ method: 'stack_act', sender: minter, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-mint`, args: { name: words, minted: true } });
      assert.equal(minted.status, 'committed', `${device}: the namer mints it`);
      // The mint arrives as any act does: the tab takes the name and says who named it, with no reload.
      await becomes(async () => { const t = await tab(p, ids.root); return t && [t.name, t.named && t.named.startsWith('Named by ') && t.named.includes(minter)]; }, [words, true], `${device}: the minted name arrives with its mark`);
      for (const level of ['folded', 'open']) {
        if (level === 'open') await fullyOpen(p, device, ids);
        for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
          if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
          for (const theme of ['light', 'dark']) {
            await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            await becomes(async () => { const t = await tab(p, ids.root); return t && { secondLine: t.secondLine, inTab: t.inTab, inDossier: t.inDossier, whole: t.whole, sideways: t.sideways }; },
              { secondLine: true, inTab: true, inDossier: true, whole: true, sideways: false }, `${device} ${width}px ${theme} ${level}: the mark keeps to the tab's second line, inside the dossier, its words whole`);
            const seen = await tab(p, ids.root);
            assert.ok(seen.contrast >= 4.5, `${device} ${width}px ${theme}: the mark reads at 4.5 or more on the folder: ${seen.contrast}`);
            assert.match(seen.markTitle, /^Named by .* when the first reply landed/, 'its tooltip says how it was named');
            observations.push({ name: 'minted name', engine, device, width, theme, level, ...seen });
            await shot(p, `stack-minted-${device}-${width}-${level}-${theme}`);
          }
        }
      }
      // A second mint, even the namer's, is refused: a dossier is minted once.
      const again = await control({ method: 'stack_act', sender: minter, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-again`, args: { name: 'Another name entirely', minted: true } });
      assert.equal(again.error?.code, 'ALREADY_NAMED', `${device}: minted once`);
      if (device === 'laptop') {
        // The person's name replaces the minted one, and the mark goes: a typed name says who typed it in its tooltip.
        const input = `#messages .reply-stack[data-stack="${ids.root}"] .stack-rename-input`;
        await centre(p, `${card(ids.root)} .stack-name`);
        await p.point(`${card(ids.root)} .stack-name`);
        await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), `${device}: the minted name opens to rename`);
        assert.equal(await p.evaluate(`document.activeElement.value`), words, `${device}: starting from the minted name`);
        await p.evaluate(`document.activeElement.select()`);
        await p.send('Input.insertText', { text: 'Cabin, July 12' });
        await p.key('Enter');
        await until(async () => (await actsOf(topic, ids.root))?.name?.text === 'Cabin, July 12', `${device}: Core holds the typed name`);
        assert.equal((await actsOf(topic, ids.root)).name.minted, undefined, `${device}: a typed name is not minted`);
        await becomes(async () => { const t = await tab(p, ids.root); return t && [t.name, t.named, /^Named by You for everyone here/.test(t.title)]; }, ['Cabin, July 12', null, true], `${device}: the typed name, no mark, and its tooltip says the person named it`);
        const late = await control({ method: 'stack_act', sender: minter, kind: 'stack.name', message_id: ids.root, operation_id: `${topic}-late`, args: { name: words, minted: true } });
        assert.equal(late.error?.code, 'ALREADY_NAMED', `${device}: a typed name is never replaced by a mint`);
        assert.equal((await tab(p, ids.root)).name, 'Cabin, July 12', `${device}: and the person's name stays`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 476: an open dossier of more than seven messages shows its newest seven as cards and one row for the rest,
  // "8 earlier messages"; a press shows them all as rows, for this visit only, each in its place and each reachable
  // there (a press on a row shows it whole, its image too, and the Reader opens on it with its Open). Nothing is
  // sent, nothing moves below More, and a reload finds the row closed again and the stacks' order, the dossier's
  // name and the reader's folds as Core held them. At a laptop's width and at 390, 375 and 320 on a phone, light
  // and dark. A dossier of seven or fewer shows no such row.
  const earlierSeed = topic => seed(topic, [
    ['root', { sender: other, join: true, addressees: [facts.actor], body: 'Cabin week: the plan.\nEverything we settled.' }],
    ...Array.from({ length: 14 }, (_, n) => [`r${n + 1}`, { sender: n % 2 ? 'aim-ux' : other, join: n === 1, reply_to: 'root', addressees: [facts.actor],
      body: `Reply ${n + 1} about the cabin.`, ...(n === 2 ? { attachments: [{ name: 'screen.png', image: 'screen.png' }] } : {}), read: n === 13 }]),
    ['lone', { sender: other, addressees: [facts.actor], body: 'Another message on its own.', read: true }],
  ]);
  // The dossier as drawn: its state, the earlier-messages row's words while it shows, and each message shown, top to
  // bottom, by how it shows: its tab alone, a row of the earlier ones, a row the reader folded, or a card.
  const earlierLook = (p, ids) => {
    const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
    return p.evaluate(`(()=>{const names=${JSON.stringify(names)},s=document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]');if(!s)return null;
      const shown=e=>e.getClientRects().length>0,b=s.querySelector(':scope > .stack-replies > .stack-earlier'),cardOf=e=>e.classList.contains('message-card')?e:e.querySelector('.message-card');
      const face=c=>c.dataset.earlier==='true'?'row':c.dataset.folded==='true'?'folded':shown(c.querySelector(':scope > .message-preview'))?'card':'tab';
      return {fold:s.dataset.fold,button:b&&shown(b)?b.textContent:null,messages:[s.firstElementChild,...[...s.querySelector(':scope > .stack-replies').children].filter(e=>e.dataset.id&&shown(e))]
        .map(e=>names[cardOf(e).dataset.id]+':'+face(cardOf(e)))}})()`);
  };
  const earlierButton = root => `#messages .reply-stack[data-stack="${root}"] > .stack-replies > .stack-earlier`;
  const STACK_ACTS = ['message.fold', 'message.star', 'message.deal', 'stack.aside', 'stack.name', 'stack.join', 'stack.place'];
  const actsSent = (p, from) => p.evaluate(`window.sent.slice(${from}).filter(kind=>${JSON.stringify(STACK_ACTS)}.includes(kind))`);
  const storedActRows = async topic => (await view('message_acts', { topic_id: topic })).items.map(item => JSON.stringify(item)).sort();
  const closedLook = ['root:tab', ...Array.from({ length: 7 }, (_, n) => `r${n + 8}:card`)];
  const openedLook = ['root:row', ...Array.from({ length: 7 }, (_, n) => `r${n + 1}:${n === 4 ? 'folded' : 'row'}`), ...closedLook.slice(1)];

  await check('reading stacks an open dossier of more than seven shows its newest seven and one row for the earlier ones; opened, each is a row reachable in place with its image, nothing is sent, and a reload closes the row with the order, name and folds Core holds unchanged', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-earlier-' + device, ids = await earlierSeed(topic);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.name', message_id: ids.root, operation_id: topic + '-name', args: { name: 'Cabin week' } });
      await dossierFold(topic, ids.r5);
      const before = await storedActRows(topic);
      for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
        const p = await open(`${topic}-${width}`, device, topic, ids.root);
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        const at = `${device} ${width}px`, order = await stacks(p, ids);
        await dossierOpen(p, device, ids.root);
        await becomes(() => earlierLook(p, ids), { fold: 'open', button: '8 earlier messages', messages: closedLook }, `${at}: open, the newest seven are cards and one row stands for the eight before them`);
        // The row: one short line, as wide as its words, 44px to touch, saying what a press does, nothing sideways.
        const row = await p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(earlierButton(ids.root))}),r=b.getBoundingClientRect(),s=b.closest('.reply-stack').getBoundingClientRect();
          return {height:r.height,narrow:r.width<s.width*.75,inside:r.left>=s.left&&r.right<=s.right,title:b.title,tag:b.tagName,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
        assert.ok(row.height >= 44 && row.narrow && row.inside && row.tag === 'BUTTON', `${at}: the row is one short line, 44px to touch: ${JSON.stringify(row)}`);
        assert.equal(row.title, 'Show all 8 as rows, for this visit', `${at}: its tooltip says what a press does`);
        assert.equal(row.sideways, false, `${at}: nothing scrolls sideways`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-earlier-closed-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
        const sent = await p.evaluate('window.sent.length');
        await centre(p, earlierButton(ids.root)); await press(p, device, earlierButton(ids.root));
        await becomes(() => earlierLook(p, ids), { fold: 'open', button: null, messages: openedLook }, `${at}: pressed, every earlier message is a row in its place, the reader's fold its own row, the seven as they were`);
        assert.equal(await said(p), '8 earlier messages show as rows, for this visit', `${at}: a screen reader hears it`);
        const rows = await p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},h=k=>document.querySelector('#messages .message-card[data-id="'+ids[k]+'"]').getBoundingClientRect().height;
          return {row:h('r3'),folded:h('r5'),words:document.querySelector('#messages .message-card[data-id="'+ids.r3+'"] > .message-earlier > .folded-words').textContent,
            author:document.querySelector('#messages .message-card[data-id="'+ids.r3+'"] > .message-earlier > .folded-author').textContent,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
        assert.ok(Math.abs(rows.row - rows.folded) < .5, `${at}: an earlier message's row is as tall as a folded one: ${JSON.stringify(rows)}`);
        assert.deepEqual([rows.words, rows.author, rows.sideways], ['Reply 3 about the cabin.', other, false], `${at}: the row reads who wrote it and its line`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `stack-earlier-opened-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
        // Reachable in place: a press on its row shows the message whole where it sat, its image with it.
        await centre(p, card(ids.r3)); await press(p, device, card(ids.r3));
        await becomes(async () => (await earlierLook(p, ids)).messages, openedLook.map(m => (m === 'r3:row' ? 'r3:card' : m)), `${at}: a press on a row shows that message whole, in its place`);
        await until(() => p.evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(card(ids.r3) + ' > .card-images > .card-image')}),i=h?.querySelector('img');return Boolean(h&&h.getAttribute('aria-label')==='Image: screen.png'&&i&&!i.hidden&&i.naturalWidth>0)})()`), `${at}: its image shows in the card`);
        await openReader(p, device, ids.r3, 'Reply 3 about the cabin.');
        await until(() => p.evaluate(`[...document.querySelectorAll('#source-attachments button')].some(b=>b.textContent==='Open screen.png')`), `${at}: the Reader opens on it and offers its image's Open`);
        assert.equal(await readerOn(p), 'Reply 3 about the cabin.', `${at}: the Reader shows that message`);
        await closeReader(p, device);
        // The first message too: a press on its row under the tab shows it whole.
        await centre(p, `${card(ids.root)} > .message-earlier`); await press(p, device, `${card(ids.root)} > .message-earlier`);
        await becomes(async () => (await earlierLook(p, ids)).messages[0], 'root:card', `${at}: a press on the first message's row shows it whole under its tab`);
        assert.deepEqual(await actsSent(p, sent), [], `${at}: opening the row, and showing messages whole, sends nothing`);
        assert.equal(await p.evaluate(`document.querySelector('#messages .stack-more')?.isConnected ?? false`), false, `${at}: nothing went below More`);
        // A reload: the row is closed again, and the order, the name and the fold are as Core holds them.
        // Which document is up: its timeOrigin as first read, kept on the window (WebKit's can move 1 ms with no load).
        const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
        await p.send('Page.reload');
        await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(card(ids.r14))}))`).catch(() => false), `${at}: the page loads again, a new document`);
        await becomes(() => stacks(p, ids), order, `${at}: after a reload the stacks keep their order`);
        await dossierOpen(p, device, ids.root);
        await becomes(() => earlierLook(p, ids), { fold: 'open', button: '8 earlier messages', messages: closedLook }, `${at}: after a reload, open, the row is closed again`);
        assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root) + ' .stack-name')}).textContent`), 'Cabin week', `${at}: the dossier keeps its name`);
        await press(p, device, earlierButton(ids.root));
        await becomes(async () => (await earlierLook(p, ids)).messages, openedLook, `${at}: after a reload the reader's fold is still its row`);
        assert.deepEqual(p.errors, []); await p.close();
      }
      assert.deepEqual(await storedActRows(topic), before, `${device}: Core holds every act on the dossier as it did: names, folds and places unchanged`);
    }
  });

  // Item 558: an earlier message the reader folded (as their reply folds what it answers, item 377) opens in the
  // Reader by presses alone, as a person reaches it: the earlier-messages row, then the message as it shows, each
  // press showing more of it until one opens it. On a laptop, by the mouse, in Chrome and Safari's engine.
  await check('reading stacks an earlier message the reader folded opens in the Reader from a press on the earlier-messages row and then presses on the message, each showing more of it until one opens it', async () => {
    const topic = 'stack-earlier-reader', ids = await earlierSeed(topic);
    await dossierFold(topic, ids.r5);
    const p = await open(topic, 'laptop', topic, ids.root);
    await dossierOpen(p, 'laptop', ids.root);
    await becomes(() => earlierLook(p, ids), { fold: 'open', button: '8 earlier messages', messages: closedLook }, 'open, the newest seven are cards and one row stands for the eight before them');
    await centre(p, earlierButton(ids.root)); await p.point(earlierButton(ids.root));
    await becomes(async () => (await earlierLook(p, ids)).messages, openedLook, 'pressed, the earlier messages are rows, the reader\'s fold its own row');
    const face = async () => (await earlierLook(p, ids)).messages.find(m => m.startsWith('r5:')).slice(3);
    const faces = [await face()];
    while (await readerOn(p) === null) {
      assert.ok(faces.length <= 3, `the message opens in the Reader within three presses on it: it showed ${faces.join(', then ')}`);
      await centre(p, card(ids.r5)); await p.point(card(ids.r5));
      await until(async () => await readerOn(p) !== null || await face() !== faces.at(-1), `a press on the message as ${faces.at(-1)} shows more of it or opens it`);
      if (await readerOn(p) === null) faces.push(await face());
    }
    assert.ok((await readerOn(p)).startsWith('Reply 5 about the cabin.'), `the Reader opens on the message pressed: ${await readerOn(p)}`);
    observations.push({ name: 'reading stacks an earlier message the reader folded opens in the Reader', engine, faces });
    await closeReader(p, 'laptop');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('reading stacks the earlier-messages row is reached by Tab and opened by Return, the keys going on to the first earlier message; a link to an earlier message opens the row and shows it whole; a dossier of seven or fewer shows none', async () => {
    const seven = await seed('stack-earlier-seven', [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Seven in all.' }],
      ...Array.from({ length: 6 }, (_, n) => [`s${n + 1}`, { sender: other, reply_to: 'root', addressees: [facts.actor], body: `Seven, reply ${n + 1}.`, read: n === 5 }])]);
    for (const device of Object.keys(DEVICES)) {
      const q = await open(`stack-earlier-seven-${device}`, device, 'stack-earlier-seven', seven.root);
      await dossierOpen(q, device, seven.root);
      await becomes(async () => { const v = await earlierLook(q, seven); return v && { button: v.button, messages: v.messages }; },
        { button: null, messages: ['root:card', ...Array.from({ length: 6 }, (_, n) => `s${n + 1}:card`)] }, `${device}: a dossier of seven, open, shows every message as a card and no row`);
      assert.equal(await q.evaluate(`document.querySelectorAll('#messages .stack-earlier, #messages [data-earlier=true]').length`), 0, `${device}: no earlier row or earlier message's row`);
      assert.deepEqual(q.errors, []); await q.close();
    }
    // Nine messages none of them read, a topic for each device since a visit reads what it shows: open, the row says
    // how many of the two earlier ones are new, in the red of new.
    for (const device of Object.keys(DEVICES)) {
      const fresh = await seed('stack-earlier-fresh-' + device, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Nine, none read.' }],
        ...Array.from({ length: 8 }, (_, n) => [`f${n + 1}`, { sender: other, reply_to: 'root', addressees: [facts.actor], body: `Nine, reply ${n + 1}.` }])]);
      const q = await open(`stack-earlier-fresh-${device}`, device, 'stack-earlier-fresh-' + device, fresh.root);
      await dossierOpen(q, device, fresh.root);
      for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
        if (device === 'phone') await q.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await becomes(async () => (await earlierLook(q, fresh)).button, '2 earlier messages · 2 new', `${device} ${width}px: the row counts the new among the earlier ones`);
        const look = await q.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(earlierButton(fresh.root))}),f=b.querySelector('.stack-fresh'),r=b.getBoundingClientRect(),w=b.querySelector('.stack-earlier-words').getBoundingClientRect(),n=f.getBoundingClientRect();
          const t=document.createElement('span');t.style.color='var(--stack-new)';b.append(t);const want=getComputedStyle(t).color;t.remove();
          return {red:getComputedStyle(f).color===want&&want!==getComputedStyle(b).color,oneLine:Math.abs(w.top-n.top)<3,height:r.height>=44,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
        assert.deepEqual(look, { red: true, oneLine: true, height: true, sideways: false }, `${device} ${width}px: the count of new is red, on the row's one line`);
      }
      for (const theme of ['light', 'dark']) { await dossierTheme(q, theme); await shot(q, `stack-earlier-fresh-${device}-${theme}`); }
      assert.deepEqual(q.errors, []); await q.close();
    }
    const topic = 'stack-earlier-keys', ids = await earlierSeed(topic);
    const p = await open(topic, 'laptop', topic, ids.root);
    await dossierOpen(p, 'laptop', ids.root);
    await becomes(async () => (await earlierLook(p, ids)).button, '8 earlier messages', 'the row shows');
    await p.evaluate(`document.querySelector('#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle').focus()`);
    // The title bar's glyphs stand after the chevron (item 473): Tab goes through Reply, Move below More and ⋯, in that
    // order, and the next Tab reaches the row.
    const reached = [];
    for (let n = 0; n < 4; n++) {
      await p.key('Tab');
      reached.push(await p.evaluate(`(e=>e?.matches(${JSON.stringify(earlierButton(ids.root))})?'row':e?.closest('#messages .reply-stack > .stack-tools')?e.dataset.tool:(e?.className??'none'))(document.activeElement)`));
    }
    assert.deepEqual(reached, ['reply', 'aside', 'menu', 'row'], 'Tab from the chevron goes through the title bar\'s glyphs and reaches the row');
    const sent = await p.evaluate('window.sent.length');
    await p.key('Enter');
    const unfolded = openedLook.map(m => (m === 'r5:folded' ? 'r5:row' : m));
    await becomes(async () => (await earlierLook(p, ids)).messages, unfolded, 'Return opens it');
    assert.equal(await p.evaluate(`document.activeElement?.dataset?.id ?? null`), ids.root, 'the keys go on to the first earlier message, the dossier\'s first');
    assert.deepEqual(await actsSent(p, sent), [], 'Return sends nothing');
    // Changing the dossier's state lets the row go: latest and unread, then open again, finds it closed.
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    await p.point(toggle); await becomes(async () => (await earlierLook(p, ids)).fold, 'folded', 'the chevron folds the dossier');
    await p.point(toggle);
    await becomes(async () => { const v = await earlierLook(p, ids); return [v.button, v.messages]; }, ['8 earlier messages', closedLook], 'open again, the row is closed');
    assert.deepEqual(p.errors, []); await p.close();
    // A link written in a message to one of the earlier ones: the dossier opens, its row too, and the message shows
    // whole in its place, in view, as the Reader opens on it.
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.r2} for that.`, read: true })).result.message_id;
    const q = await open(topic + '-link', 'laptop', topic, ids.root);
    await becomes(async () => (await earlierLook(q, ids)).fold, 'folded', 'the dossier begins at latest and unread');
    await centre(q, `${card(linking)} a.words-link`); await q.point(`${card(linking)} a.words-link`);
    await becomes(async () => (await earlierLook(q, ids)).messages, unfolded.map(m => (m === 'r2:row' ? 'r2:card' : m)), 'the link opens the dossier and its row, the message whole in its place');
    assert.equal(await q.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card(ids.r2))}).getBoundingClientRect();return b.top<innerHeight&&b.bottom>0})()`), true, 'the message is in view');
    await until(async () => (await readerOn(q))?.startsWith('Reply 2'), 'and the Reader opens on it, as a link to a message here does');
    await closeReader(q, 'laptop');
    assert.deepEqual(q.errors, []); await q.close();
    // The rail's Starred lands on the dossier's first message, which in a dossier of more than seven is an earlier
    // one: the dossier opens, its row too, and the first message shows whole in its place, the keys on it, no Reader.
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.root, operation_id: topic + '-star', args: { starred: true } });
    const s = await open(topic + '-star', 'laptop', topic, ids.root);
    await becomes(async () => (await earlierLook(s, ids)).fold, 'folded', 'the dossier begins at latest and unread');
    const starRow = `#things .things-sec[data-key=starred] .things-body > div > ul:first-child a.row`;
    await becomes(() => s.evaluate(`[...document.querySelectorAll(${JSON.stringify(starRow)})].map(e=>e.firstChild.textContent.startsWith('Cabin week: the plan.'))`), [true], 'the rail\'s Starred lists the first message');
    if (!await s.evaluate(`document.querySelector('#things .things-sec[data-key=starred]').open`)) await s.point('#things .things-sec[data-key=starred] > summary');
    await s.point(starRow);
    await becomes(async () => { const v = await earlierLook(s, ids); return [v.fold, v.button, v.messages[0]]; }, ['open', null, 'root:card'], 'Starred opens the dossier and its row, the first message whole');
    await until(async () => await focusedOn(s) === ids.root, 'the keys land on the first message');
    assert.equal(await readerOn(s), null, 'landing opens no Reader');
    assert.deepEqual(s.errors, []); await s.close();
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.root, operation_id: topic + '-unstar', args: { starred: false } });
  });

  // Item 476 and "Your place holds" (docs/experience-guidelines.md): the newest seven are counted when the dossier is
  // drawn open. A message arriving after that joins the cards below and hides nothing: the card being read, or an
  // earlier message's row once the row is opened, stays shown where it was. Changing the dossier's state counts them
  // again. At a laptop's width and 390, 375 and 320 on a phone.
  await check('reading stacks a message arriving in an open dossier hides nothing being read: the seven are counted when it opened, the row and the cards stay where they were, and changing its state counts again', async () => {
    const arrivalSeed = (topic, n) => seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Arrival root.\nIts second line.' }],
      ...Array.from({ length: n - 1 }, (_, k) => [`r${k + 1}`, { sender: k % 2 ? 'aim-ux' : other, join: k === 1, reply_to: 'root', addressees: [facts.actor], body: `Arrival reply ${k + 1}.`, read: true }])]);
    const arrive = async (topic, root, name) => (await control({ method: 'agent_message', operation_id: `${topic}-${name}`, topic_id: topic, source: 'topic', sender: other,
      addressees: [facts.actor], reply_to: root, body: `Arrives while a card is read (${name}).` })).result.message_id;
    // Where a message shows: as a card, its words' top; as a row, the row's top.
    const place = (p, id) => p.evaluate(`(c=>{const w=c.querySelector(':scope > .message-preview'),e=w&&w.getClientRects().length?w:c;return {face:e===w?'card':'row',top:Math.round(e.getBoundingClientRect().top)}})(document.querySelector(${JSON.stringify(card(id))}))`);
    const cards = (from, to) => Array.from({ length: to - from + 1 }, (_, n) => `r${from + n}:card`);
    for (const device of Object.keys(DEVICES)) for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
      const at = `${device} ${width}px`, sized = async p => { if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); };
      // Seven, the reader on the first message, whole and centred.
      const seven = `stack-arrive-7-${device}-${width}`, a = await arrivalSeed(seven, 7);
      const p = await open(seven, device, seven, a.root); await sized(p);
      const toggle = await dossierOpen(p, device, a.root);
      await becomes(() => earlierLook(p, a), { fold: 'open', button: null, messages: ['root:card', ...cards(1, 6)] }, `${at}: a dossier of seven, open, every message a card`);
      await centre(p, card(a.root));
      const first = await place(p, a.root);
      a.n1 = await arrive(seven, a.root, 'n1');
      await becomes(() => earlierLook(p, a), { fold: 'open', button: null, messages: ['root:card', ...cards(1, 6), 'n1:card'] }, `${at}: a reply arriving joins the cards below; no row comes and the first message stays whole`);
      assert.deepEqual(await place(p, a.root), first, `${at}: the first message stays where it was being read`);
      // Changing the dossier's state counts them again: folded and opened, the eight show seven and the row.
      await centre(p, toggle); await press(p, device, toggle);
      await becomes(async () => (await earlierLook(p, a)).fold, 'folded', `${at}: the chevron folds the dossier`);
      await dossierOpen(p, device, a.root);
      await becomes(() => earlierLook(p, a), { fold: 'open', button: '1 earlier message', messages: ['root:tab', ...cards(1, 6), 'n1:card'] }, `${at}: opened again, the newest seven are counted afresh`);
      assert.deepEqual(p.errors, []); await p.close();
      // Ten, the reader on the oldest card shown; then, the row opened, on an earlier message's row.
      const ten = `stack-arrive-10-${device}-${width}`, b = await arrivalSeed(ten, 10);
      const q = await open(ten, device, ten, b.root); await sized(q);
      await dossierOpen(q, device, b.root);
      await becomes(() => earlierLook(q, b), { fold: 'open', button: '3 earlier messages', messages: ['root:tab', ...cards(3, 9)] }, `${at}: a dossier of ten, open, the newest seven and the row`);
      await centre(q, card(b.r3));
      const oldest = await place(q, b.r3);
      b.n1 = await arrive(ten, b.root, 'n1');
      await becomes(() => earlierLook(q, b), { fold: 'open', button: '3 earlier messages', messages: ['root:tab', ...cards(3, 9), 'n1:card'] }, `${at}: a reply arriving hides no card, and the row still stands for three`);
      assert.deepEqual(await place(q, b.r3), oldest, `${at}: the card being read stays shown where it was`);
      await centre(q, earlierButton(b.root)); await press(q, device, earlierButton(b.root));
      const rows = ['root:row', 'r1:row', 'r2:row', ...cards(3, 9), 'n1:card'];
      await becomes(async () => (await earlierLook(q, b)).messages, rows, `${at}: opened, the earlier ones are rows`);
      await centre(q, card(b.r1));
      const row = await place(q, b.r1);
      b.n2 = await arrive(ten, b.root, 'n2');
      await becomes(() => earlierLook(q, b), { fold: 'open', button: null, messages: [...rows, 'n2:card'] }, `${at}: another reply arriving leaves the rows as they were`);
      assert.deepEqual(await place(q, b.r1), row, `${at}: the earlier message's row being read stays where it was`);
      assert.deepEqual(q.errors, []); await q.close();
    }
  });

  // Item 476 on a phone: the first tap on an open dossier's tab lights it and the next acts, whatever its first message
  // shows: whole (seven messages), its tab alone behind a closed earlier-messages row, or that row once opened. A tap
  // on the row itself opens it and lights nothing, so the tab's first tap after it is a first tap too.
  await check('reading stacks on a phone the first tap on an open dossier\'s tab lights it, whether its first message shows whole, as the tab alone behind the earlier-messages row, or as that row opened; the next tap folds it', async () => {
    const tabSeed = (topic, n) => seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Tab root.' }],
      ...Array.from({ length: n - 1 }, (_, k) => [`r${k + 1}`, { sender: other, reply_to: 'root', addressees: [facts.actor], body: `Tab reply ${k + 1}.`, read: true }])]);
    const topics = { 'stack-tab-7': await tabSeed('stack-tab-7', 7), 'stack-tab-15': await tabSeed('stack-tab-15', 15) };
    const levelOf = (p, id) => p.evaluate(`import('/reply-stacks.mjs').then(m=>m.stackState(document.getElementById('messages')).levels.get(${JSON.stringify(id)})??null)`);
    for (const width of [390, 375, 320]) for (const [state, topic, face] of [['seven', 'stack-tab-7', 'root:card'], ['closed', 'stack-tab-15', 'root:tab'], ['opened', 'stack-tab-15', 'root:row']]) {
      const ids = topics[topic], at = `${width}px, ${state}`;
      const p = await open(`stack-tab-${state}-${width}`, 'phone', topic, ids.root);
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await dossierOpen(p, 'phone', ids.root);
      if (state === 'opened') { await centre(p, earlierButton(ids.root)); await tap(p, earlierButton(ids.root)); }
      await becomes(async () => { const v = await earlierLook(p, ids); return [v.fold, v.messages[0]]; }, ['open', face], `${at}: the dossier is open, its first message ${face}`);
      assert.deepEqual(await lit(p), [], `${at}: nothing is lit before the tap on the tab`);
      const who = `${card(ids.root)} > .stack-head > .stack-who`;
      await centre(p, who); await tap(p, who);
      await until(async () => (await lit(p)).includes(ids.root), `${at}: the first tap on the tab lights the dossier`);
      assert.equal(await levelOf(p, ids.root), 'open', `${at}: the first tap folds nothing`);
      assert.deepEqual((await earlierLook(p, ids)).messages[0], face, `${at}: and changes nothing it shows`);
      await tap(p, who);
      await becomes(async () => (await earlierLook(p, ids)).fold, 'folded', `${at}: the next tap folds it to latest and unread`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 474: a message's images show as thumbnails in its card, on the topic page and in a dossier, the right
  // rail's thumbnail size (4.2rem), in the order sent, each named "Image: …" with its name as a tooltip, each read
  // through the message that carries it, so only someone who may read that message gets it. The Reader keeps its
  // Open for each; a message with no image, a file that is not an image and a folded row are unchanged; an image
  // Theseus refuses shows its name and no picture.
  await check('reading thumbnails a message\'s images show in its card on the topic page and in a dossier, the right rail\'s size, named, each read through its message; the Reader keeps Open, and no image, a file and a folded row are unchanged', async () => {
    const topic = 'card-thumbs';
    const seeds = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Which view do we keep?' }],
      ['two', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'These two, in this order.', attachments: [{ name: 'palette.png', image: 'palette.png' }, { name: 'one.jpg', image: 'one.jpg' }] }],
      ['plain', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'No picture here.' }],
      ['file', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The notes.', attachments: [{ name: 'notes.txt', text: 'Plain notes.' }] }],
      ['folded', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Folded, with a picture.', attachments: [{ name: 'one.png', image: 'one.png' }] }],
      ['last', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest word.', read: true }],
      ['single', { sender: other, addressees: [facts.actor], body: 'A screenshot on its own.', attachments: [{ name: 'screen.png', image: 'screen.png' }], read: true }]];
    const ids = await seed(topic, seeds);
    await dossierFold(topic, ids.folded);
    // The fixture names each image after the message it came with (its seed's place): which message carries which.
    const carrier = Object.fromEntries(seeds.flatMap(([key, more], n) => (more.attachments ?? []).map((_, k) => [`${topic}-${n}-media-${k}`, ids[key]])));
    // Each image read the page makes, as it sends it; with window.refuseMedia, Theseus's refusal of that image.
    const READS = `(()=>{window.mediaReads=[];const f=window.fetch;window.fetch=function(input,init){let b=null;
      try{const u=typeof input==='string'?input:input.url;if(u.endsWith('/api/media/read')){b=JSON.parse(init.body);window.mediaReads.push(b)}}catch(e){}
      if(b&&b.media_id===window.refuseMedia)return Promise.resolve(new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'No readable source'}}),{status:403,headers:{'Content-Type':'application/json'}}));
      return f.call(this,input,init)}})()`;
    const thumbs = p => p.evaluate(`(()=>{const ids=${JSON.stringify(ids)},out={};
      for(const [key,id] of Object.entries(ids)){const c=document.querySelector('#messages .message-card[data-id="'+id+'"]'),s=c?.querySelector(':scope > .card-images');
        out[key]=s&&s.getClientRects().length?[...s.children].map(h=>{const b=h.getBoundingClientRect(),i=h.querySelector(':scope > img'),cb=c.getBoundingClientRect();
          return {name:h.getAttribute('aria-label'),title:h.title,role:h.getAttribute('role'),square:Math.abs(b.width-b.height)<.5,size:Math.round(b.width*10)/10,
            picture:Boolean(i&&!i.hidden&&i.naturalWidth>0),words:[...h.querySelectorAll(':scope > .card-image-name')].filter(n=>n.getClientRects().length).map(n=>n.textContent).join(''),inCard:b.left>=cb.left-.5&&b.right<=cb.right+.5}}):null}
      return {thumbs:out,rail:Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize)*4.2*10)/10,sideways:document.documentElement.scrollWidth>innerWidth}})()`);
    const image = (name, rail, picture = true) => ({ name: `Image: ${name}`, title: name, role: 'img', square: true, size: rail, picture, words: picture ? '' : name, inCard: true });
    const want = (rail, refused = false) => ({ thumbs: { root: null, two: [image('palette.png', rail), image('one.jpg', rail)], plain: null, file: null, folded: null, last: null,
      single: [image('screen.png', rail, !refused)] }, rail, sideways: false });
    for (const device of Object.keys(DEVICES)) {
      const p = await open(`${topic}-${device}`, device, topic, ids.root, READS);
      await dossierOpen(p, device, ids.root);
      for (const width of device === 'phone' ? [390, 375, 320] : [1280]) {
        if (device === 'phone') await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        const rail = (await thumbs(p)).rail;
        await becomes(() => thumbs(p), want(rail), `${device} ${width}px: each image a thumbnail in its card, the rail's size, in order, named; none for no image, a file or a folded row`);
        for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await centre(p, card(ids.two)); await shot(p, `card-thumbs-dossier-${device}-${width}-${theme}`); await centre(p, card(ids.single)); await shot(p, `card-thumbs-single-${device}-${width}-${theme}`); }
        await dossierTheme(p, 'light');
      }
      // Each picture was read through the message that carries it, and nothing else was read.
      const reads = await p.evaluate('window.mediaReads');
      assert.ok(reads.length >= 3, `${device}: the thumbnails were read: ${JSON.stringify(reads)}`);
      for (const read of reads) assert.deepEqual(read.source_ref, { kind: 'message', id: carrier[read.media_id] }, `${device}: ${read.media_id} is read through its own message`);
      // The plain card is as it was: its author line and its words, nothing after them.
      assert.deepEqual(await p.evaluate(`[...document.querySelector(${JSON.stringify(card(ids.plain))}).children].filter(e=>e.getClientRects().length).map(e=>e.className).filter(c=>/card-images/.test(c))`), [], `${device}: a message with no image draws no thumbnails`);
      // The Reader keeps Open for each attachment, an image's and a file's alike.
      await openReader(p, device, ids.two, 'These two, in this order.');
      await until(() => p.evaluate(`(()=>{const b=[...document.querySelectorAll('#source-attachments button')].map(b=>b.textContent);return b.includes('Open palette.png')&&b.includes('Open one.jpg')})()`), `${device}: the Reader offers Open for each image`);
      await closeReader(p, device);
      await openReader(p, device, ids.file, 'The notes.');
      await until(() => p.evaluate(`[...document.querySelectorAll('#source-attachments button')].some(b=>b.textContent==='Open notes.txt')`), `${device}: the Reader offers Open for the file`);
      await closeReader(p, device);
      assert.deepEqual(p.errors, []); await p.close();
    }
    // An image Theseus refuses: its square shows the image's name, and no picture.
    const refused = await open(`${topic}-refused`, 'laptop', topic, ids.root, `window.refuseMedia=${JSON.stringify(Object.keys(carrier).find(media => carrier[media] === ids.single))};` + READS);
    await dossierOpen(refused, 'laptop', ids.root);
    await becomes(() => thumbs(refused), want((await thumbs(refused)).rail, true), 'a refused image shows its name and no picture; the others show');
    await shot(refused, 'card-thumbs-refused-laptop');
    await refused.close();
  });

  // Item 474 (warp codex #5271): a card's thumbnails are read only once the card is drawn as a card near the window
  // (half a window above and below it), never for a card shown as one row (folded, or behind a dossier's
  // earlier-messages row) or far from the window; one that comes near later is read then. A topic of 30 messages,
  // each with one image: nineteen messages on their own, three of them folded, and a dossier of eleven below them. At load only the cards near the window are read, and every card in view shows its picture with its name;
  // a scroll to the card furthest from the window, an unfold, opening the dossier and its earlier-messages row, and a press that shows an
  // earlier message whole each read just the cards drawn near the window that were not read before. A square never
  // read holds no picture at all. Each look's counts go to the run's observations.
  await check('reading card thumbnails are read only for cards drawn near the window: at load none folded, behind the earlier-messages row or far below; a scroll, an unfold and an earlier message shown whole each read just those cards, and no square in view draws its name while its picture is on the way', async () => {
    const IMAGES = ['screen.png', 'one.png', 'palette.png', 'one.jpg', 'one.gif', 'one.webp', 'sixteen.png'];
    const pic = n => ({ attachments: [{ name: `pic-${n}.${IMAGES[n % IMAGES.length].split('.')[1]}`, image: IMAGES[n % IMAGES.length] }] });
    // The oldest first: the right rail, beside the page at a laptop's width, shows the newest 24 images and reads
    // them for itself, so s1 to s6 are the folded messages whose reads are only their cards' there.
    const seeds = [...Array.from({ length: 19 }, (_, n) => [`s${n + 1}`, { sender: n % 2 ? 'aim-ux' : other, join: n < 2, addressees: [facts.actor], body: `Message ${n + 1} on its own, with a picture.`, read: true, ...pic(n) }]),
      ['root', { sender: other, addressees: [facts.actor], body: 'The plan, with a picture.', read: true, ...pic(19) }],
      ...Array.from({ length: 10 }, (_, n) => [`r${n + 1}`, { sender: n % 2 ? 'aim-ux' : other, reply_to: 'root', addressees: [facts.actor], body: `Reply ${n + 1}, with a picture.`, read: true, ...pic(n + 20) }])];
    // Each image read the page makes, by its media id, as it sends it; and how many are out unanswered.
    const READS = `(()=>{window.mediaReads=[];window.mediaOut=0;const f=window.fetch;window.fetch=function(input,init){let read=null;
      try{const u=typeof input==='string'?input:input.url;if(u.endsWith('/api/media/read'))read=JSON.parse(init.body).media_id}catch(e){}
      const answer=f.call(this,input,init);if(read!==null){window.mediaReads.push(read);window.mediaOut++;const back=()=>{window.mediaOut--};answer.then(back,back)}
      return answer}})();
      (()=>{window.namesShown={};const each=()=>{for(const h of document.querySelectorAll('#messages .card-image')){const n=h.querySelector(':scope > .card-image-name'),b=h.getBoundingClientRect();
        if(n&&n.getClientRects().length&&h.getClientRects().length&&b.bottom>0&&b.top<innerHeight){const k=h.dataset.key.slice(h.dataset.key.lastIndexOf(':')+1);window.namesShown[k]=(window.namesShown[k]||0)+1}}
        requestAnimationFrame(each)};requestAnimationFrame(each)})()`;
    // The squares in view that drew their image's name in some frame since the last look (every image here comes, so
    // a name drawn is a picture on its way drawn as if refused), sampled each frame just before it is painted.
    const named = async p => p.evaluate('(()=>{const out=window.namesShown;window.namesShown={};return out})()');
    // Every thumbnail square in the page: its image's media id, its message, whether it is drawn (has a box), where,
    // whether a picture was ever asked for (its img) and shows, and its name; every image read so far; and the images
    // the right rail shows, which it reads for itself (things-rail.mjs) and are no card's reads.
    const LOOK = `(()=>{const media=k=>k.slice(k.lastIndexOf(':')+1),out={H:innerHeight,reads:window.mediaReads.slice(),out:window.mediaOut,hosts:[],
        rail:[...document.querySelectorAll('.things-thumbs img.image-thumb')].map(i=>media(i.dataset.key))};
      for(const h of document.querySelectorAll('#messages .card-image')){const b=h.getBoundingClientRect(),i=h.querySelector(':scope > img'),k=h.dataset.key;
        out.hosts.push({media:media(k),message:h.closest('.message-card').dataset.id,drawn:h.getClientRects().length>0,top:b.top,bottom:b.bottom,
          asked:Boolean(i),picture:Boolean(i&&!i.hidden&&i.naturalWidth>0),name:h.getAttribute('aria-label'),title:h.title,role:h.getAttribute('role')})}
      return out})()`;
    // Drawn within half a window of the window, give or take slack pixels at its edges.
    const near = (look, h, slack) => h.drawn && h.bottom > -look.H / 2 - slack && h.top < look.H * 1.5 + slack;
    const inView = (look, h) => h.drawn && h.bottom > 4 && h.top < look.H - 4;
    // Settled: no read out, every square asked for shows its picture, and every square drawn near the window does.
    const settle = async (p, at) => {
      let look;
      await until(async () => { look = await p.evaluate(LOOK); return look.out === 0 && look.hosts.every(h => (!h.asked || h.picture) && (!near(look, h, -4) || h.picture)); }, `${at}: every picture asked for has come`);
      return look;
    };
    // What a look read for cards since before (the reads of images the right rail shows aside): no square read
    // twice, nothing read but squares drawn near the window (slack pixels either way), and every square drawn well
    // inside that span read, by its card or the rail; a square never drawn never read. Returns the cards' reads.
    const fresh = (look, before, at, slack = 4) => {
      const rail = new Set(look.rail), was = new Set(before), all = look.reads.slice(before.length), got = all.filter(media => !rail.has(media));
      const allowed = new Set(look.hosts.filter(h => near(look, h, slack)).map(h => h.media));
      const missed = look.hosts.filter(h => near(look, h, -4) && !was.has(h.media) && !all.includes(h.media)).map(h => h.message);
      const cards = look.reads.filter(media => !rail.has(media));
      const counts = { at, squares: look.hosts.length, drawn: look.hosts.filter(h => h.drawn).length, near: look.hosts.filter(h => near(look, h, 0)).length,
        cardReadsNow: got.length, cardReadsAll: cards.length, railReads: look.reads.length - cards.length };
      observations.push({ name: 'card thumbnails read near the window', engine, ...counts }); console.log('card thumbnails near: ' + JSON.stringify({ engine, ...counts }));
      assert.equal(new Set(cards).size, cards.length, `${at}: no card's picture is read twice: ${JSON.stringify(cards)}`);
      assert.deepEqual(got.filter(media => !look.hosts.find(h => h.media === media)?.drawn), [], `${at}: no picture is read for a card shown as a row or hidden: ${JSON.stringify(counts)}`);
      assert.deepEqual(got.filter(media => !allowed.has(media)), [], `${at}: nothing is read but the cards drawn near the window: ${JSON.stringify(counts)}`);
      assert.deepEqual(missed, [], `${at}: every card drawn near the window is read: ${JSON.stringify(counts)}`);
      assert.deepEqual(look.hosts.filter(h => h.asked && !look.reads.includes(h.media)).map(h => h.message), [], `${at}: a square never read asks for no picture`);
      return got;
    };
    // Every square in view shows its picture, named for a screen reader and by its file's name under the pointer.
    const shown = (look, at) => {
      const seen = look.hosts.filter(h => inView(look, h));
      assert.ok(seen.length > 0, `${at}: a thumbnail is in view`);
      for (const h of seen) assert.deepEqual([h.picture, h.role, h.name, `Image: ${h.title}`], [true, 'img', `Image: ${h.title}`, h.name], `${at}: ${h.message}'s thumbnail shows, named`);
    };
    for (const device of Object.keys(DEVICES)) {
      const topic = `card-thumbs-near-${device}`, ids = await seed(topic, seeds);
      const media = Object.fromEntries(seeds.map(([key], n) => [key, `${topic}-${n}-media-0`]));
      for (const key of ['s2', 's5', 's15']) await dossierFold(topic, ids[key]);
      const p = await open(topic, device, topic, ids.s1, READS);
      // A card's picture as the page holds it: read for that card (not the right rail's), and showing.
      const own = (look, key) => look.reads.includes(media[key]) && !look.rail.includes(media[key]);
      const pictured = (look, key) => look.hosts.find(h => h.media === media[key]).picture;
      // At load: the cards near the window, and nothing else.
      let look = await settle(p, `${device} at load`);
      const atLoad = fresh(look, [], `${device} at load`, look.H / 2);
      assert.equal(look.hosts.length, 30, `${device}: all thirty messages are loaded, each with its square`);
      assert.ok(atLoad.length <= 15 && look.hosts.some(h => near(look, h, -4) && h.picture), `${device}: at load only the cards near the window are read, ${atLoad.length} of 30 for cards alone`);
      for (const key of ['s2', 's5', 's15', 'r1', 'r2', 'r3']) if (!look.hosts.find(h => h.media === media[key]).drawn) assert.ok(!atLoad.includes(media[key]), `${device}: ${key}, not drawn as a card, is not read`);
      shown(look, `${device} at load`);
      assert.deepEqual(await named(p), {}, `${device} at load: no square in view draws its image's name while its picture is on the way`);
      // A scroll to the card drawn furthest from the window reads the cards then drawn near it, that one among them.
      const far = h => (h.top > look.H ? h.top - look.H : -h.bottom);
      const furthest = Object.keys(media).filter(each => look.hosts.find(h => h.media === media[each]).drawn)
        .sort((a, b) => far(look.hosts.find(h => h.media === media[b])) - far(look.hosts.find(h => h.media === media[a])))[0];
      assert.ok(look.rail.includes(media[furthest]) || !look.reads.includes(media[furthest]), `${device}: the card furthest from the window, ${furthest}, is not read at load`);
      let before = look.reads;
      await named(p);
      await centre(p, card(ids[furthest]));
      look = await settle(p, `${device} scrolled to ${furthest}`);
      const scrolled = fresh(look, before, `${device} scrolled to ${furthest}`);
      assert.ok(pictured(look, furthest) && (look.rail.includes(media[furthest]) || scrolled.includes(media[furthest])), `${device}: ${furthest}'s picture is read once it is near, and shows`);
      shown(look, `${device} scrolled to ${furthest}`);
      assert.deepEqual(await named(p), {}, `${device} scrolled to ${furthest}: no square in view draws its image's name while its picture is on the way`);
      for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await shot(p, `card-thumbs-near-${device}-${theme}`); }
      await dossierTheme(p, 'light');
      // A folded message (one the right rail does not show), brought into view, reads nothing; unfolded, it reads its own picture.
      const key = ['s2', 's5', 's15'].find(each => !look.rail.includes(media[each]));
      assert.ok(key, `${device}: a folded message whose picture the right rail does not show: ${JSON.stringify(look.rail)}`);
      before = look.reads;
      await centre(p, card(ids[key]));
      look = await settle(p, `${device} ${key} folded, in view`);
      fresh(look, before, `${device} ${key} folded, in view`);
      assert.ok(!look.reads.includes(media[key]) && !look.hosts.find(h => h.media === media[key]).asked, `${device}: ${key}, folded in view, is not read`);
      before = look.reads;
      await press(p, device, card(ids[key]));
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids[key]))}).dataset.folded!=='true'`), `${device}: a press unfolds ${key}`);
      look = await settle(p, `${device} ${key} unfolded`);
      const unfolded = fresh(look, before, `${device} ${key} unfolded`);
      assert.ok(unfolded.includes(media[key]) && pictured(look, key), `${device}: unfolded, ${key}'s picture is read, and shows`);
      shown(look, `${device} ${key} unfolded`);
      // The dossier opened: its newest seven are cards, read as they come near; the earlier ones behind their row are not.
      before = look.reads;
      await dossierOpen(p, device, ids.root);
      look = await settle(p, `${device} dossier open`);
      fresh(look, before, `${device} dossier open`);
      for (const each of ['r1', 'r2', 'r3']) assert.ok(!own(look, each), `${device}: ${each}, behind the earlier-messages row, is not read`);
      // Its earlier-messages row opened: each earlier message is a row, and reads nothing.
      before = look.reads;
      await centre(p, earlierButton(ids.root)); await press(p, device, earlierButton(ids.root));
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.r2))}).dataset.earlier==='true'&&document.querySelector(${JSON.stringify(card(ids.r2))}).getClientRects().length>0`), `${device}: the earlier messages show as rows`);
      look = await settle(p, `${device} earlier rows shown`);
      fresh(look, before, `${device} earlier rows shown`);
      for (const each of ['r1', 'r2', 'r3']) assert.ok(!own(look, each), `${device}: ${each}, an earlier message's row, is not read`);
      // A press on one row shows that message whole, and its picture is read then.
      before = look.reads;
      await centre(p, card(ids.r2));
      look = await settle(p, `${device} r2's row in view`);
      fresh(look, before, `${device} r2's row in view`);
      before = look.reads;
      await press(p, device, card(ids.r2));
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.r2))}).dataset.earlier!=='true'`), `${device}: a press shows r2 whole`);
      look = await settle(p, `${device} r2 shown whole`);
      const whole = fresh(look, before, `${device} r2 shown whole`);
      assert.ok(pictured(look, 'r2') && (look.rail.includes(media.r2) || whole.includes(media.r2)), `${device}: shown whole, r2's picture is read, and shows`);
      for (const each of ['r1', 'r3']) assert.ok(!own(look, each), `${device}: ${each}, still a row, is not read`);
      shown(look, `${device} r2 shown whole`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 433: an act's answer lands on the message the page holds when it lands. A 👍's read of its message's
  // reactions, or a page of messages, puts a new copy of the message in the page while an act about it is out;
  // the answer once went only to the copy the act began with, so the card was drawn again from the copy as Core
  // held it before the act (a message unfolded folded again, a star went out) until the acts were read again.
  // Each answer here is held from the page by name (HOLD_ANSWERS, in Chrome and Safari's engine alike): the 👍's
  // reactions read until the act is under way, the act's own answer until that read has landed, and every acts
  // read until the end, so nothing but the act's answer can put the page right. window.answered: what Core
  // answered each act the page sent, in order, as it reached the page's door.
  const HOLD_ANSWERS = `(()=>{const f=window.fetch;window.holdAnswers=[];window.heldAnswers=[];window.answered=[];
    window.fetch=function(input,init){let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null}catch(e){}
      const what=b&&(b.kind||b.name),answer=f.call(this,input,init);
      if(b&&b.kind)answer.then(r=>r.clone().json()).then(a=>window.answered.push({what,said:a.error?.code??a.status}),()=>{});
      return what&&window.holdAnswers.includes(what)?answer.then(r=>new Promise(go=>window.heldAnswers.push({what,go:()=>go(r)}))):answer};
    window.letAnswers=what=>{const go=window.heldAnswers.filter(e=>e.what===what);window.heldAnswers=window.heldAnswers.filter(e=>e.what!==what);go.forEach(e=>e.go());return go.length}})()`;
  const heldAnswer = (p, what) => p.evaluate(`window.heldAnswers.some(e=>e.what===${JSON.stringify(what)})`);
  // Every value an attribute of a message's card takes, in order, from now on (each change once).
  const watchCard = (p, id, attribute) => p.evaluate(`(()=>{const read=()=>document.querySelector(${JSON.stringify(card(id))})?.getAttribute(${JSON.stringify(attribute)})??null;
    window.cardSeen=[read()];new MutationObserver(()=>{const now=read();if(window.cardSeen.at(-1)!==now)window.cardSeen.push(now)})
      .observe(document.querySelector('#messages'),{subtree:true,childList:true,attributes:true,attributeFilter:[${JSON.stringify(attribute)}]})})()`);
  const kindsSent = (p, kind) => p.evaluate(`window.sent.filter(each=>each===${JSON.stringify(kind)}).length`);
  const answered = (p, kind) => p.evaluate(`window.answered.filter(each=>each.what===${JSON.stringify(kind)}).map(each=>each.said)`);
  await check('reading stacks x unfolds a folded message while its 👍\'s read is out, and it never folds again when the answer lands after that read; a second x folds it, fenced on the revision Core gave (item 433)', async () => {
    const topic = 'stack-answer-kept-fold';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The oldest stack.', read: true }],
      ['folded', { sender: other, addressees: [facts.actor], body: 'A folded message: its 👍, then x.', read: true }],
      ['later', { sender: other, addressees: [facts.actor], body: 'A later message.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.folded, operation_id: topic + '-fold', args: { folded: true } });
    const p = await open(topic, 'laptop', topic, ids.folded, HOLD_ANSWERS);
    await becomes(async () => (await folded(p, ids.folded)).row, true, 'the folded message shows as its row');
    await p.evaluate(`window.holdAnswers.push('reactions','message.fold','message_acts')`);
    const thumb = card(ids.folded) + ' > .message-folded > .folded-thumb';
    await centre(p, thumb); await press(p, 'laptop', thumb);
    await until(async () => await thumbedBy(ids.folded), 'the row\'s 👍 gives the thumbs-up, in Core');
    await until(() => heldAnswer(p, 'reactions'), 'the 👍 reads the message\'s reactions again, and that answer waits');
    await keyTo(p, ids.folded);
    await typeX(p);
    await becomes(async () => (await folded(p, ids.folded)).whole, true, 'x shows the message whole at once');
    await until(async () => !await foldOf(topic, ids.folded), 'x unfolds it, in Core');
    await until(() => heldAnswer(p, 'message.fold'), 'the unfold\'s answer waits');
    await watchCard(p, ids.folded, 'data-folded');
    // The reactions read lands first: the page now holds a new copy of the message, made from what it read before x.
    await p.evaluate(`window.letAnswers('reactions')`);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.folded) + ' .reaction-count.mine')}))`), 'the page learns the thumbs-up: the card counts it as yours');
    // ⌘↓ is sent only once the unfold's answer has been taken in and the stacks drawn from it: acts go one at a time.
    await keyTo(p, ids.folded);
    await p.key('ArrowDown', 4);
    await p.evaluate(`window.letAnswers('message.fold')`);
    await until(async () => await kindsSent(p, 'stack.place') === 1, 'the unfold\'s answer is taken in, and the move after it sent');
    await twoFrames(p);
    assert.deepEqual(await p.evaluate('window.cardSeen'), ['false'], 'the message never folds again once its unfold is answered');
    assert.equal((await folded(p, ids.folded)).whole, true, 'it shows whole, as Core holds it');
    // A second x, the acts still unread: it folds the message, fenced on the revision the unfold's answer gave.
    await keyTo(p, ids.folded);
    await typeX(p);
    await until(async () => (await answered(p, 'message.fold')).length === 2, 'Core answers the second x');
    assert.deepEqual(await answered(p, 'message.fold'), ['committed', 'committed'], 'the second x is not refused as late: it is fenced on the revision the unfold\'s answer gave');
    assert.deepEqual(await actsOf(topic, ids.folded).then(acts => [acts?.folded, acts?.fold_revision]), [true, 3], 'it folds the message, in Core, as the third fold act');
    await p.evaluate(`(window.holdAnswers.length=0,window.letAnswers('message_acts'))`);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'the page has read all it heard of');
    assert.equal((await folded(p, ids.folded)).row, true, 'the page shows it as its row, as Core holds it');
    assert.equal(await readerOn(p), null, 'nothing opened');
    assert.deepEqual(p.errors, []); await p.close();
  });
  await check('reading stacks Star for me on a folded message while its 👍\'s read is out stays starred when the answer lands after that read (item 433)', async () => {
    const topic = 'stack-answer-kept-star';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The oldest stack.', read: true }],
      ['folded', { sender: other, addressees: [facts.actor], body: 'A folded message: its 👍, then a star.', read: true }],
      ['later', { sender: other, addressees: [facts.actor], body: 'A later message.', read: true }]]);
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.folded, operation_id: topic + '-fold', args: { folded: true } });
    const p = await open(topic, 'laptop', topic, ids.folded, HOLD_ANSWERS);
    await becomes(async () => (await folded(p, ids.folded)).row, true, 'the folded message shows as its row');
    await p.evaluate(`window.holdAnswers.push('reactions','message.star','message_acts')`);
    const thumb = card(ids.folded) + ' > .message-folded > .folded-thumb';
    await centre(p, thumb); await press(p, 'laptop', thumb);
    await until(async () => await thumbedBy(ids.folded), 'the row\'s 👍 gives the thumbs-up, in Core');
    await until(() => heldAnswer(p, 'reactions'), 'the 👍 reads the message\'s reactions again, and that answer waits');
    await menuOf(p, 'laptop', ids.folded); await choose(p, 'laptop', 'Star for me');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.folded))}).dataset.starred === 'true'`), 'the star shows at once');
    await until(async () => (await actsOf(topic, ids.folded))?.starred === true, 'Core holds the star');
    await until(() => heldAnswer(p, 'message.star'), 'the star\'s answer waits');
    await watchCard(p, ids.folded, 'data-starred');
    await p.evaluate(`window.letAnswers('reactions')`);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.folded) + ' .reaction-count.mine')}))`), 'the page learns the thumbs-up: the card counts it as yours');
    // Starring a folded message unfolds it too: that act is sent only once the star's answer has been taken in.
    await p.evaluate(`window.letAnswers('message.star')`);
    await until(async () => await kindsSent(p, 'message.fold') === 1, 'the star\'s answer is taken in, and the unfold after it sent');
    await twoFrames(p);
    assert.deepEqual(await p.evaluate('window.cardSeen'), ['true'], 'the star never goes out once it is answered');
    await until(async () => (await actsOf(topic, ids.folded))?.folded === false, 'the unfold reaches Core');
    await p.evaluate(`(window.holdAnswers.length=0,window.letAnswers('message_acts'))`);
    await until(() => p.evaluate('window.fetchesOut === 0'), 'the page has read all it heard of');
    assert.deepEqual(await p.evaluate('window.cardSeen'), ['true'], 'and stays starred after the acts are read again');
    assert.deepEqual([...await answered(p, 'message.star'), ...await answered(p, 'message.fold')], ['committed', 'committed'], 'nothing was refused');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 393: a scroll right after a trackpad swipe folds a message is the browser's at once.
  await check('reading stacks a scroll right after two fingers fold a message on the trackpad scrolls the page at once', async () => {
    const topic = 'stack-fold-then-scroll';
    const tall = Array.from({ length: 8 }, (_, i) => `Line ${i} of a message that makes the page taller than the window.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The root.' }],
      ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one, unread.' }],
      // A later reply, so reply one is not the dossier's last visible message, which a swipe right moves below More (355).
      ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two, unread, the dossier\'s last.' }],
      ...[1, 2, 3, 4, 5].map(n => ['tall' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n${tall}`, read: true }])]);
    const p = await open(topic, 'laptop', topic, ids.root, HEARD_WHEELS);
    // The tall messages' read reads the whole topic, the replies too, so at latest plus unread reply one is folded
    // away. The dossier fully open shows both, as the trackpad case above opens it.
    const toggle = `#messages .reply-stack[data-stack="${ids.root}"] .stack-toggle`;
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(async () => (await look(p, ids, 'root')).rows, ['one', 'two'], 'the dossier fully open, both replies in view');
    // The stack's head sits above the reply that folds, so only a scroll moves it.
    const top = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).getBoundingClientRect().top`);
    await centre(p, card(ids.one));
    const before = await top();
    // The fingers swipe right, then at once scroll, as a scroll that starts in the swipe's momentum. The stack
    // sits at the foot of the page (the newer messages are above it), so the scroll goes up the page.
    const DOWN = [[0, -10], [0, -20], [0, -40], [0, -60], [0, -80], [0, -80]];
    const heard = await trackpad(p, card(ids.one), [...SWIPE_RIGHT, ...DOWN]);
    await until(async () => await foldOf(topic, ids.one), 'the swipe folds reply one, in Core');
    const down = heard.filter(w => w.y !== 0);
    assert.equal(down.length, DOWN.length, `the window heard every event of the scroll: ${JSON.stringify(heard)}`);
    assert.ok(down.every(w => !w.prevented), `the page left every event of the scroll to the browser: ${JSON.stringify(down)}`);
    assert.ok(heard.filter(w => w.y === 0).every(w => w.prevented), `and took the sideways swipe from it: ${JSON.stringify(heard)}`);
    if (engine === 'chrome') await until(async () => await top() - before >= 250, 'the page scrolls the whole way the fingers moved');
    else observations.push({ name: 'stacks scroll after a trackpad fold', engine, held: 'in this harness Safari\'s engine scrolls the page for none of the wheel events that follow a swipe\'s, though the page leaves them to it (seemingly one gesture with the swipe, whose first events the page kept); that every event of the scroll is left to the browser is checked here, and that the page then scrolls, in Chrome' });
    assert.equal(await foldsSent(p), 1, 'one fold sent');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 376: a star in a message's header, and in the Reader beside its title, the same act as Star for me in ⋯;
  // and the Reader's ⋯ folds the message as the card's Fold does.
  // hits: what a press 21px from the glyph's middle each way lands on is the star (a 44px target under a finger).
  const starOn = (p, id) => p.evaluate(`(s=>{if(!s)return null;const b=s.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;
    return {shown:s.getClientRects().length>0&&getComputedStyle(s).visibility==='visible',text:s.textContent,pressed:s.getAttribute('aria-pressed'),label:s.getAttribute('aria-label'),title:s.title,role:s.getAttribute('role'),
    width:Math.round(b.width),height:Math.round(b.height),hits:[[-21,0],[21,0],[0,-21],[0,21]].map(([x,y])=>document.elementFromPoint(cx+x,cy+y)===s)}})(document.querySelector(${JSON.stringify(card(id) + ' > .message-author > .card-star')}))`);
  const readerStar = p => p.evaluate(`(s=>s&&{shown:!s.hidden&&s.getClientRects().length>0,text:s.textContent,pressed:s.getAttribute('aria-pressed'),label:s.getAttribute('aria-label'),title:s.title,
    width:Math.round(s.getBoundingClientRect().width),height:Math.round(s.getBoundingClientRect().height)})(document.getElementById('reader-star'))`);
  const glyph = s => s && (({ shown, text, pressed, label, title }) => ({ shown, text, pressed, label, title }))(s);
  const OUTLINE = { shown: true, text: '☆', pressed: 'false', label: 'Star for me', title: 'Star for me' };
  const FILLED = { shown: true, text: '★', pressed: 'true', label: 'Unstar', title: 'Unstar' };
  // The Reader's ⋯, opened by a press, and the words of its items.
  const readerMenu = async (p, device) => {
    await press(p, device, '#reader-menu');
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: the Reader's ⋯ opens its menu`);
    return p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.firstChild.textContent)`);
  };
  const shutMenu = async p => { await p.key('Escape'); await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'Escape closes the menu'); };

  await check('reading stacks a star in a message\'s header, outline while the message is lit and filled once starred, stars it for you alone and unstars it, and opens nothing', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-header-star-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Message A, starred from its header.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'Message B, left alone.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      const star = card(ids.a) + ' > .message-author > .card-star';
      if (device === 'laptop') await away(p);
      assert.equal(glyph(await starOn(p, ids.a))?.shown ?? false, false, `${device}: a message neither lit nor starred shows no star`);
      await light(p, device, ids.a);
      assert.deepEqual(glyph(await starOn(p, ids.a)), OUTLINE, `${device}: the lit message shows an outline star after who wrote it and when, named and titled`);
      assert.equal((await starOn(p, ids.a)).role, 'button', `${device}: a button to a screen reader`);
      // Only the card names its message (data-id): what finds a message's card finds that card alone, not its star too.
      assert.equal(await p.evaluate(`document.querySelectorAll(${JSON.stringify(`#messages [data-id="${ids.a}"]`)}).length`), 1, `${device}: the star names no message of its own`);
      assert.equal(glyph(await starOn(p, ids.b))?.shown ?? false, false, `${device}: the message not lit shows none`);
      if (device === 'phone') {
        assert.deepEqual((await starOn(p, ids.a)).hits, [true, true, true, true], 'phone: the star answers a finger 44px each way around it');
      }
      await press(p, device, star);
      await until(async () => (await actsOf(topic, ids.a))?.starred === true, `${device}: a press on the star stars the message, in Core`);
      await becomes(async () => glyph(await starOn(p, ids.a)), FILLED, `${device}: the star is filled, and pressed`);
      assert.equal((await actsOf(topic, ids.a, other))?.starred ?? false, false, `${device}: another reader sees no star`);
      // Its author line painted again (marked unread from another device, then read): the star is put back with it, filled.
      const unread = card(ids.a) + ' > .message-author .unread-mark';
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.a], marked: true });
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(unread)}))`), `${device}: marked unread elsewhere, its author line is painted again, with Unread`);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: and keeps its filled star`);
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids.a], marked: false });
      await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(unread)})`), `${device}: read again elsewhere, its author line is painted again, without Unread`);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: and still keeps its filled star`);
      assert.equal(await readerOn(p), null, `${device}: the press opens no Reader`);
      // The light goes to B: A keeps its filled star, B shows its outline one.
      await light(p, device, ids.b);
      assert.deepEqual(glyph(await starOn(p, ids.a)), FILLED, `${device}: a starred message shows its filled star when it is not lit`);
      assert.deepEqual(glyph(await starOn(p, ids.b)), OUTLINE, `${device}: and the lit one its outline star`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-header-star-${device}-${theme}`);
      }
      await light(p, device, ids.a);
      await press(p, device, star);
      await until(async () => (await actsOf(topic, ids.a))?.starred === false, `${device}: a second press unstars it, in Core`);
      await becomes(async () => glyph(await starOn(p, ids.a)), OUTLINE, `${device}: the lit message shows its outline star again`);
      await light(p, device, ids.b);
      assert.equal(glyph(await starOn(p, ids.a))?.shown ?? false, false, `${device}: unstarred and not lit, it shows no star`);
      if (device === 'laptop' && engine !== 'chrome') observations.push({ name: 'stacks header star Tab', engine, held: 'Safari\'s key for every item is Option-Tab, which the page leaves to the browser, as it does for the bar\'s buttons: Tab from a message to its header star is checked in Chrome' });
      if (device === 'laptop' && engine === 'chrome') {
        // The keys: Tab from the selected message reaches its star before the bar's buttons, and Return stars it.
        await keyTo(p, ids.b);
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.matches(${JSON.stringify(card(ids.b) + ' > .message-author > .card-star')})`), 'laptop: Tab from the selected message reaches its star first');
        await p.key('Enter');
        await until(async () => (await actsOf(topic, ids.b))?.starred === true, 'laptop: Return on the star stars the message, in Core');
        assert.equal(await readerOn(p), null, 'laptop: Return on the star opens no Reader');
        await p.key('Tab');
        await until(() => p.evaluate(`document.activeElement?.closest('.message-bar') !== null`), 'laptop: the next Tab goes on to the bar');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 413: latest plus unread keeps a read reply the reader starred. Taking the star off a reply in view, by its
  // header star, by ⋯ or from another device, never folds it away under the reader: as a reply read in view
  // stays, it stays, with the keys and the light, until the reader changes the stack's state or comes back.
  await check('reading stacks unstarring a reply in view leaves it, the keys and the light in place until the stack changes, by its star, its ⋯ and another device', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-unstar-in-place-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A read root.', read: true }],
        ['star', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An older read reply, starred.', read: true }],
        ['ordinary', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'An ordinary read reply.', read: true }],
        ['latest', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The latest read reply.', read: true }]]);
      let turn = 0;
      const starElsewhere = on => control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.star, operation_id: `${topic}-${turn++}`, args: { starred: on } });
      await starElsewhere(true);
      let p = await open(topic, device, topic, ids.root);
      const state = async () => { const seen = await look(p, ids, 'root'); return { fold: seen.fold, rows: seen.rows }; };
      const top = () => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.star))})?.getBoundingClientRect().top ?? null`);
      const glyphOf = `${card(ids.star)} > .message-author > .card-star`;
      await becomes(state, { fold: 'folded', rows: ['star', 'latest'] }, `${device}: latest plus unread shows the starred read reply`);
      // keys: where the keys are after the act: on the reply itself, from where the next ↓ goes on to the next reply,
      // or (after a ⋯ item) on the ⋯ that opened the menu, as for every ⋯ item, with the reply still lit.
      const stays = async (how, before, keys) => {
        await until(async () => (await actsOf(topic, ids.star))?.starred === false, `${device} ${how}: the star is off, in Core`);
        await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.star))})?.dataset.starred === 'false'`), `${device} ${how}: the card shows it`);
        await twoFrames(p);
        assert.deepEqual(await state(), { fold: 'folded', rows: ['star', 'latest'] }, `${device} ${how}: the reply stays in view, at latest plus unread`);
        assert.equal(await p.evaluate(keys === 'more' ? `document.activeElement?.matches('.message-bar [data-act=more]') ?? false` : `document.activeElement?.closest?.('[data-id]')?.dataset.id === ${JSON.stringify(ids.star)}`), true, `${device} ${how}: the keys stay ${keys === 'more' ? 'on its ⋯' : 'on it'}`);
        assert.deepEqual(await lit(p), [ids.star], `${device} ${how}: and its light`);
        assert.equal(await top(), before, `${device} ${how}: nothing slides up under the pointer`);
        if (keys === 'more') return;
        await p.key('ArrowDown');
        assert.equal(await focusedOn(p), ids.latest, `${device} ${how}: ↓ goes on to the next reply, not from the top of the page`);
      };
      // Changing the stack's state lets go of an unstarred reply: it hides, and comes back only at all messages.
      const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
      const letGo = async how => {
        await centre(p, toggle); await press(p, device, toggle);
        await becomes(state, { fold: 'open', rows: ['star', 'ordinary', 'latest'] }, `${device} ${how}: all messages`);
        await centre(p, toggle); await press(p, device, toggle);
        await becomes(state, { fold: 'folded', rows: ['latest'] }, `${device} ${how}: back at latest plus unread, the unstarred read reply is hidden`);
        await starElsewhere(true);
        await becomes(state, { fold: 'folded', rows: ['star', 'latest'] }, `${device} ${how}: starred again, it shows again`);
      };
      // ⋯ Unstar, the reply lit as a press or a tap lights it (menuOf), before the keys are used on a phone.
      await menuOf(p, device, ids.star);
      let before = await top();
      await choose(p, device, 'Unstar');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), `${device}: the menu closes`);
      await stays('by ⋯ Unstar', before, 'more');
      await letGo('after ⋯ Unstar');
      // Its header star, with the keys on the reply.
      await keyTo(p, ids.star);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(glyphOf)})?.textContent === '★'`), `${device}: the lit starred reply shows its filled star`);
      before = await top();
      await press(p, device, glyphOf);
      await stays('by its star', before, 'card');
      await letGo('after its star');
      // From another device, while the reader is on it.
      await keyTo(p, ids.star);
      before = await top();
      await starElsewhere(false);
      await stays('from another device', before, 'card');
      await shot(p, 'stack-unstar-in-place-' + device);
      assert.deepEqual(p.errors, []); await p.close();
      p = await open(topic + '-reload', device, topic, ids.root);
      await becomes(state, { fold: 'folded', rows: ['latest'] }, `${device}: after a reload the unstarred read reply is hidden`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  await check('reading stacks the Reader\'s star beside its title stars and unstars the message as the card\'s does, and its ⋯ offers Fold message, Unfold message once folded, and no Fold on a starred message', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-reader-star-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Message A, read in the Reader.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'Message B, newer.', read: true }]]);
      const p = await open(topic, device, topic, ids.a);
      await openReader(p, device, ids.a, 'Message A');
      assert.deepEqual(glyph(await readerStar(p)), OUTLINE, `${device}: an outline star beside the Reader's title, named and titled`);
      assert.equal(await p.evaluate(`document.getElementById('reader-star').parentElement.contains(document.getElementById('reader-title'))`), true, `${device}: beside the title`);
      if (device === 'phone') {
        const size = await readerStar(p);
        assert.ok(size.width >= 44 && size.height >= 44, `phone: the Reader's star is 44px or more each way under a finger: ${JSON.stringify(size)}`);
      }
      let items = await readerMenu(p, device);
      assert.ok(items.includes('Fold message') && !items.includes('Unfold message'), `${device}: the Reader's ⋯ offers Fold message: ${items}`);
      await shutMenu(p);
      await press(p, device, '#reader-star');
      await until(async () => (await actsOf(topic, ids.a))?.starred === true, `${device}: the Reader's star stars the message, in Core`);
      await becomes(async () => glyph(await readerStar(p)), FILLED, `${device}: the Reader's star is filled`);
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.a))}).dataset.starred === 'true'`), `${device}: and the card agrees`);
      assert.equal((await starOn(p, ids.a))?.text, '★', `${device}: its header shows the filled star`);
      assert.equal((await actsOf(topic, ids.a, other))?.starred ?? false, false, `${device}: another reader sees no star`);
      items = await readerMenu(p, device);
      assert.ok(!items.includes('Fold message') && !items.includes('Unfold message'), `${device}: a starred message's ⋯ offers no Fold: ${items}`);
      await shutMenu(p);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-reader-star-${device}-${theme}`);
      }
      await press(p, device, '#reader-star');
      await until(async () => (await actsOf(topic, ids.a))?.starred === false, `${device}: pressed again it unstars, in Core`);
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, `${device}: the outline star again`);
      // A star made on another device while the Reader shows the message: its star follows, with no press here.
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-elsewhere-star', args: { starred: true } });
      await becomes(async () => glyph(await readerStar(p)), FILLED, `${device}: a star made elsewhere fills the Reader's star`);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.a, operation_id: topic + '-elsewhere-unstar', args: { starred: false } });
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, `${device}: and taken off there, the outline again`);
      items = await readerMenu(p, device);
      await choose(p, device, 'Fold message');
      await until(async () => await foldOf(topic, ids.a), `${device}: Fold message folds it for the reader, in Core`);
      assert.equal(await foldOf(topic, ids.a, other), false, `${device}: another reader's view of it is unchanged`);
      assert.match(await readerOn(p) ?? '', /^Message A/, `${device}: the Reader keeps showing it whole`);
      items = await readerMenu(p, device);
      assert.ok(items.includes('Unfold message') && !items.includes('Fold message'), `${device}: once folded the ⋯ offers Unfold message: ${items}`);
      await choose(p, device, 'Unfold message');
      await until(async () => !await foldOf(topic, ids.a), `${device}: Unfold message unfolds it, in Core`);
      await closeReader(p, device);
      await becomes(async () => (await folded(p, ids.a)).whole, true, `${device}: the card reads whole`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // A link to an older message of a long topic opens it alone in the Reader, its card not loaded: its star and
  // Fold message are there as for any message, and follow a star made elsewhere.
  await check('reading stacks the Reader\'s star and Fold message show for a message the page has not loaded, opened alone from its link', async () => {
    const topic = 'stack-reader-star-alone';
    const ids = await seed(topic, Array.from({ length: 36 }, (_, n) => ['m' + n, { sender: other, ...(n ? {} : { join: true }), addressees: [facts.actor], body: `Message ${n}, of a long topic.`, read: true }]));
    const p = await open(topic, 'laptop', `${topic}&message=${ids.m0}`, ids.m35);
    await until(async () => (await readerOn(p))?.startsWith('Message 0,'), 'the link opens the oldest message in the Reader');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.m0))}))`), false, 'the page has not loaded its card: it opened alone');
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'an outline star beside the Reader\'s title');
    let items = await readerMenu(p, 'laptop');
    assert.ok(items.includes('Fold message') && !items.includes('Unfold message'), `the Reader's ⋯ offers Fold message: ${items}`);
    await shutMenu(p);
    await press(p, 'laptop', '#reader-star');
    await until(async () => (await actsOf(topic, ids.m0))?.starred === true, 'the Reader\'s star stars it, in Core');
    await becomes(async () => glyph(await readerStar(p)), FILLED, 'the Reader\'s star is filled');
    assert.equal((await actsOf(topic, ids.m0, other))?.starred ?? false, false, 'another reader sees no star');
    items = await readerMenu(p, 'laptop');
    assert.ok(!items.includes('Fold message') && !items.includes('Unfold message'), `a starred message's ⋯ offers no Fold: ${items}`);
    await shutMenu(p);
    await press(p, 'laptop', '#reader-star');
    await until(async () => (await actsOf(topic, ids.m0))?.starred === false, 'pressed again it unstars, in Core');
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'the outline star again');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.m0, operation_id: topic + '-elsewhere-star', args: { starred: true } });
    await becomes(async () => glyph(await readerStar(p)), FILLED, 'a star made elsewhere fills the Reader\'s star');
    await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.m0, operation_id: topic + '-elsewhere-unstar', args: { starred: false } });
    await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'and taken off there, the outline again');
    items = await readerMenu(p, 'laptop');
    await choose(p, 'laptop', 'Fold message');
    await until(async () => await foldOf(topic, ids.m0), 'Fold message folds it for the reader, in Core');
    assert.equal(await foldOf(topic, ids.m0, other), false, 'another reader\'s view of it is unchanged');
    items = await readerMenu(p, 'laptop');
    assert.ok(items.includes('Unfold message') && !items.includes('Fold message'), `once folded the ⋯ offers Unfold message: ${items}`);
    await choose(p, 'laptop', 'Unfold message');
    await until(async () => !await foldOf(topic, ids.m0), 'Unfold message unfolds it, in Core');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.m0))}))`), false, 'and its card is still not loaded');
    if (engine === 'chrome') {
      // A star Core refuses (held at the network, the Chrome harness's interception): the Reader's star shows it at
      // once, and the refusal takes it away, so the Reader shows what Core holds.
      const starsSent = payload => payload?.kind === 'message.star';
      await p.send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/command', requestStage: 'Request' }, { urlPattern: facts.origin + '/api/view', requestStage: 'Response' }] });
      p.intercept(payload => starsSent(payload));
      await press(p, 'laptop', '#reader-star');
      await becomes(async () => glyph(await readerStar(p)), FILLED, 'a press shows the star at once');
      const refused = await until(() => p.held.find(entry => starsSent(entry.payload)), 'the star is on its way');
      p.held.splice(p.held.indexOf(refused), 1);
      p.intercept(null);
      await p.send('Fetch.fulfillRequest', { requestId: refused.event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ instance_id: facts.instance_id, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Refused for this check.' } })).toString('base64') });
      await becomes(async () => glyph(await readerStar(p)), OUTLINE, 'refused, the Reader\'s star shows no star again');
      assert.equal((await actsOf(topic, ids.m0))?.starred, false, 'and Core holds none');
    } else observations.push({ name: 'stacks Reader star alone refused', engine, held: 'holds Core\'s answer with the Chrome harness\'s request interception, which Safari\'s harness does not offer: a refused star on a message opened alone is checked in Chrome' });
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 470: a name typed while a dossier's first message is not loaded names the dossier, and it is
  // still its name once that message loads; another page holding any part of it shows it too.
  await check('reading stacks a name typed while a dossier\'s first message is not loaded names the dossier, and stays its name once that message loads', async () => {
    const topic = 'stack-name-partial';
    // Two spaces in each reply's first line: its row and the name field show it as messagePreview does, folded.
    const messages = [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The old dossier root.', read: true }],
      ...Array.from({ length: 35 }, (_, i) => ['r' + i, { sender: other, reply_to: i ? 'r' + (i - 1) : 'root', addressees: [facts.actor], body: 'Reply  ' + i, read: true }])];
    const ids = await seed(topic, messages), bodyOf = Object.fromEntries(messages.map(([key, message]) => [ids[key], message.body]));
    const p = await open(topic, 'laptop', topic, ids.r34);
    const loaded = id => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(id))}))`);
    assert.equal(await loaded(ids.root), false, 'the first message is outside the loaded page');
    const shownHead = await p.evaluate(`document.querySelector(${JSON.stringify(entry(ids.r34))}).closest('.reply-stack').dataset.stack`);
    assert.notEqual(shownHead, ids.root, 'a reply shows as the dossier\'s head');
    const row = `#messages .reply-stack[data-stack="${ids.root}"] .stack-name, #messages .reply-stack[data-stack="${shownHead}"] .stack-name`;
    const named = () => p.evaluate(`(n=>n&&{text:n.textContent,title:n.title})(document.querySelector(${JSON.stringify(row)}))`);
    const input = '#messages .reply-stack .stack-rename-input';
    await centre(p, `#messages .reply-stack[data-stack="${shownHead}"] .stack-pen`);
    await p.point(`#messages .reply-stack[data-stack="${shownHead}"] .stack-pen`);
    await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), 'the shown head opens to rename');
    await p.evaluate(`document.activeElement.select()`);
    await p.send('Input.insertText', { text: 'Siderail changes' });
    await p.key('Enter');
    await until(async () => (await actsOf(topic, ids.root))?.name?.text === 'Siderail changes', 'Core holds the name on the dossier\'s first message');
    assert.equal((await actsOf(topic, shownHead))?.name ?? null, null, 'and none on the reply that showed as its head');
    assert.equal((await named()).text, 'Siderail changes', 'the head row shows it');
    // The first message loads: the dossier keeps the name, and says who typed it.
    const cards = () => p.evaluate(`document.querySelectorAll('#messages .message-card[data-id]').length`);
    for (let page = 0; !await loaded(ids.root); page++) {
      assert.ok(page < 3, 'Earlier messages reaches the first message');
      const before = await cards();
      await centre(p, '#more-messages'); await p.point('#more-messages');
      await until(async () => (await cards()) > before, 'Earlier messages reads an older page');
    }
    await until(async () => (await named())?.text === 'Siderail changes', 'with its first message loaded, the dossier keeps the typed name');
    assert.match((await named()).title, /^Named by You for everyone here/, 'and says the reader named it');
    // Another page holding only the newest part shows the name too.
    const q = await open(topic + '-again', 'laptop', topic, ids.r34);
    const again = () => q.evaluate(`(s=>s?.querySelector('.stack-name')?.textContent)(document.querySelector(${JSON.stringify(entry(ids.r34))}).closest('.reply-stack'))`);
    assert.equal(await q.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(ids.root))}))`), false, 'the new page has not loaded the first message');
    await until(async () => (await again()) === 'Siderail changes', 'a page holding only replies shows the dossier\'s name');
    // ⌘Z on the first page gives the dossier back its first line, on both pages.
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.root))}).focus()`);
    await p.key('z', 4);
    await until(async () => (await actsOf(topic, ids.root))?.name === null, '⌘Z clears the dossier\'s name in Core');
    await until(async () => (await again()) !== 'Siderail changes', 'and the other page no longer shows it');
    // On the page holding only replies, the field opened and left untouched records nothing, and the
    // shown reply's line, typed in, names the dossier: the first message loaded shows it.
    const shownLine = await again(), qHead = await q.evaluate(`document.querySelector(${JSON.stringify(entry(ids.r34))}).closest('.reply-stack').dataset.stack`);
    assert.equal(shownLine, messagePreview({ body: bodyOf[qHead] }), 'with no name, the row shows the reply at its head by its line');
    const qPen = `#messages .reply-stack[data-stack="${qHead}"] .stack-pen`;
    const qOpen = async what => { await centre(q, qPen); await q.point(qPen); await until(() => q.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)})`), what); };
    await qOpen('the reply showing as the head opens to rename');
    await q.key('Enter');
    await until(async () => !await q.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Return closes the untouched field');
    // The page sends an act within the press that makes it, so right after Return nothing has gone, and Core still
    // holds no name: the shown line differs from the empty name and is not the first message's, so only the field's
    // being untouched holds it.
    assert.equal(await q.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`), 0, 'the untouched field sends no name at Return');
    assert.equal((await actsOf(topic, ids.root))?.name ?? null, null, 'and Core holds none');
    await qOpen('it opens again');
    await q.evaluate(`document.activeElement.select()`);
    await q.send('Input.insertText', { text: shownLine });
    await q.key('Enter');
    await until(async () => (await actsOf(topic, ids.root))?.name?.text === shownLine, `the shown line typed in names the dossier (${shownLine})`);
    assert.equal(await q.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`), 1, 'the untouched field sent no name');
    // A page in the background reads nothing new until it is shown again: each page is brought forward to be read live.
    await p.send('Page.bringToFront');
    await until(async () => (await named())?.text === shownLine, 'the page holding the first message shows the typed name');
    // Another reader names the dossier while the field is open here, untouched: Return puts nothing back.
    await q.send('Page.bringToFront');
    await qOpen('it opens once more');
    await control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: ids.root, operation_id: topic + '-their-name', args: { name: 'Their name' } });
    await until(async () => (await actsOf(topic, ids.root))?.name?.text === 'Their name', 'Core holds the other reader\'s name');
    // Return only once this page holds that name: before it does, what the field holds is the name it knows, and
    // Return records nothing whether or not the field was touched.
    await until(async () => (await again()) === 'Their name', 'the page holds the other reader\'s name before Return');
    await q.key('Enter');
    await until(async () => !await q.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Return closes the untouched field');
    await until(async () => (await again()) === 'Their name', 'the page shows the other reader\'s name');
    assert.equal(await q.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`), 1, 'the untouched field sent no name over it');
    assert.equal((await actsOf(topic, ids.root)).name.text, 'Their name', 'and Core keeps it');
    assert.deepEqual(p.errors, []); assert.deepEqual(q.errors, []);
    await q.close(); await p.close();
  });

  // Item 470: a join or a split the reader makes leaves, until Core answers it and the page reads the positions
  // again, the positions Core sent before it on the messages it moved. Held unanswered here (window.holdKinds: the
  // kinds of act the page's commands wait unsent for, until window.letActs(); window.views: the name of each view the
  // page reads, as it asks), each head row still names its own
  // dossier and a rename typed there goes to it, on a full page and on one holding only replies. On the page holding
  // only replies, a name typed shows before Core answers it; on the full page, a first message's first line with
  // doubled spaces, typed in on it as the head, records nothing: its row shows that line folded (messagePreview).
  await check('reading stacks a split or a join waiting for its answer leaves each head row naming its own dossier and a rename going to it, on a full page and one holding only replies', async () => {
    const HOLD = `(()=>{window.heldActs=[];window.views=[];const f=window.fetch;window.fetch=function(input,init){let b=null;try{b=init&&typeof init.body==='string'?JSON.parse(init.body):null}catch(e){}
      if(b&&b.name)window.views.push(b.name);if(b&&b.kind&&(window.holdKinds||[]).includes(b.kind))return new Promise(go=>window.heldActs.push(go)).then(()=>f.call(this,input,init));
      return f.call(this,input,init)};window.letActs=()=>{window.holdKinds=null;for(const go of window.heldActs.splice(0))go()}})()`;
    const field = '#messages .reply-stack .stack-rename-input', split = '#messages .stack-join-line .stack-split';
    const section = id => `#messages .reply-stack[data-stack="${id}"]`;
    const nameIn = (p, id) => p.evaluate(`document.querySelector(${JSON.stringify(section(id) + ' .stack-name')})?.textContent ?? null`);
    const names = p => p.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`);
    const hold = (p, kinds) => p.evaluate(`window.holdKinds = ${JSON.stringify(kinds)}`);
    const held = p => p.evaluate('window.heldActs.length');
    // The pen of the stack headed by head opens its field, holding was; text typed over it, then Return.
    const renameTo = async (p, head, text, was) => {
      const pen = section(head) + ' .stack-pen';
      await centre(p, pen); await p.point(pen);
      await until(() => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(field)})`), `the stack headed by ${head} opens to rename`);
      assert.equal(await p.evaluate('document.activeElement.value'), was, 'the field opens with the name its row shows');
      await p.evaluate('document.activeElement.select()');
      await p.send('Input.insertText', { text });
      await p.key('Enter');
      await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(field)}))`), 'Return closes the field');
    };
    const nameAct = (topic, id, name) => control({ method: 'stack_act', sender: other, kind: 'stack.name', message_id: id, operation_id: `${topic}-${id}-name`, args: { name } });
    const joinAct = (topic, id, into) => control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: id, operation_id: `${topic}-${id}-join`, args: { into } });

    // A full page: Old joined into Top, each named, and Plain, its first line with two spaces, named by it.
    const topic = 'stack-name-moved';
    const plainBody = 'Plain  words with two spaces';
    const ids = await seed(topic, [['plain', { sender: other, join: true, addressees: [facts.actor], body: plainBody, read: true }],
      ['plainReply', { sender: other, reply_to: 'plain', addressees: [facts.actor], body: 'Its reply.', read: true }],
      ['top', { sender: other, addressees: [facts.actor], body: 'The top dossier.', read: true }],
      ['topReply', { sender: other, reply_to: 'top', addressees: [facts.actor], body: 'Its reply.', read: true }],
      ['old', { sender: other, addressees: [facts.actor], body: 'The old dossier.', read: true }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'Its reply.', read: true }]]);
    await nameAct(topic, ids.top, 'Top name'); await nameAct(topic, ids.old, 'Old name'); await joinAct(topic, ids.old, ids.top);
    const p = await open(topic, 'laptop', topic, ids.oldReply, HOLD);
    await becomes(() => stacks(p, ids), ['top', 'plain'], 'Old is joined into Top');
    assert.equal(await nameIn(p, ids.top), 'Top name', 'the joined stack reads Top\'s name');
    // Split back out, its answer held: Old's messages still carry Top's position.
    await dossierOpen(p, 'laptop', ids.top);
    await hold(p, ['stack.join', 'stack.name']);
    await centre(p, split); await p.point(split);
    await becomes(() => stacks(p, ids), ['old', 'top', 'plain'], 'Split back out draws Old as its own stack at once');
    assert.equal(await held(p), 1, 'the split waits for its answer');
    assert.equal(await nameIn(p, ids.old), 'Old name', 'split out, before Core answers, its row names Old, not the dossier it left');
    assert.equal(await nameIn(p, ids.top), 'Top name', 'and Top\'s names Top');
    await renameTo(p, ids.old, 'Old renamed', 'Old name');
    assert.equal(await nameIn(p, ids.old), 'Old renamed', 'the rename shows at once');
    await p.evaluate('window.letActs()');
    await until(async () => (await actsOf(topic, ids.old))?.name?.text === 'Old renamed', 'Core holds the rename on Old');
    assert.equal((await actsOf(topic, ids.old)).joined, null, 'split for everyone');
    assert.equal((await actsOf(topic, ids.top)).name.text, 'Top name', 'and Top keeps its name');
    // Joined again by ⇧⌘↓, its answer held: Old's messages, newer than Top's, still carry Old's position.
    await hold(p, ['stack.join', 'stack.name']);
    await keyTo(p, ids.old);
    await p.key('ArrowDown', 12);
    await becomes(() => stacks(p, ids), ['top', 'plain'], '⇧⌘↓ joins Old into Top at once');
    assert.equal(await held(p), 1, 'the join waits for its answer');
    assert.equal(await nameIn(p, ids.top), 'Top name', 'joined, before Core answers, the row names Top');
    await renameTo(p, ids.top, 'Top renamed', 'Top name');
    assert.equal(await nameIn(p, ids.top), 'Top renamed', 'the rename shows at once');
    await p.evaluate('window.letActs()');
    await until(async () => (await actsOf(topic, ids.top))?.name?.text === 'Top renamed', 'Core holds the rename on Top');
    assert.equal((await actsOf(topic, ids.old)).joined?.into, ids.top, 'joined for everyone');
    assert.equal((await actsOf(topic, ids.old)).name.text, 'Old renamed', 'and Old keeps its name');
    await until(async () => (await nameIn(p, ids.top)) === 'Top renamed', 'answered and read again, the row names Top');
    // Plain's first message is its head: its row shows its line folded, and its first line typed in, two spaces and
    // all, records nothing.
    const plainLine = await nameIn(p, ids.plain), sentBefore = await names(p);
    assert.equal(plainLine, messagePreview({ body: plainBody }), 'the row shows the first message by its line');
    await renameTo(p, ids.plain, plainBody, plainLine);
    assert.equal(await names(p), sentBefore, 'the first line typed in on the first message sends no name');
    assert.equal((await actsOf(topic, ids.plain))?.name ?? null, null, 'and Core holds none');
    // A split answered reads the positions again at once, though no change is heard of meanwhile: the reads a change
    // heard of starts with (message_acts) wait unsent, and nothing chained after it (a rename) reads them.
    if (await p.evaluate(`document.querySelector(${JSON.stringify(section(ids.top) + ' > .stack-toggle')}).dataset.state`) !== 'open') await dossierOpen(p, 'laptop', ids.top);
    await p.evaluate(`window.waitView = 'message_acts'`);
    const viewsBefore = await p.evaluate('window.views.length');
    await centre(p, split); await p.point(split);
    await becomes(() => stacks(p, ids), ['old', 'top', 'plain'], 'Split back out once more');
    // The page sends its acts one after another: a star made now is sent once the split's answer is handled.
    const stars = () => p.evaluate(`window.sent.filter(kind=>kind==='message.star').length`), starsBefore = await stars();
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.topReply) + ' > .message-author > .card-star')}).click()`);
    await until(async () => (await stars()) > starsBefore, 'a star made after the split is sent once the split is handled');
    assert.equal((await actsOf(topic, ids.old))?.joined, null, 'Core holds the split');
    assert.ok(await p.evaluate(`window.views.slice(${viewsBefore}).includes('stack_positions')`), 'the split\'s answer read the positions again');
    await p.evaluate('window.letViews()');
    assert.equal(await nameIn(p, ids.old), 'Old renamed', 'Old\'s row names Old');
    assert.deepEqual(p.errors, []); await p.close();

    // A page holding only replies of a dossier, Old joined into its newest reply.
    const part = 'stack-name-moved-part';
    const pids = await seed(part, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The long dossier.', read: true }],
      ...Array.from({ length: 35 }, (_, i) => ['r' + i, { sender: other, reply_to: i ? 'r' + (i - 1) : 'root', addressees: [facts.actor], body: 'Reply ' + i, read: true }]),
      ['old', { sender: other, addressees: [facts.actor], body: 'The old dossier.', read: true }],
      ['oldReply', { sender: other, reply_to: 'old', addressees: [facts.actor], body: 'Its reply.', read: true }]]);
    await nameAct(part, pids.root, 'Dossier name'); await nameAct(part, pids.old, 'Old name'); await joinAct(part, pids.old, pids.r34);
    const q = await open(part, 'laptop', part, pids.oldReply, HOLD);
    assert.equal(await q.evaluate(`Boolean(document.querySelector(${JSON.stringify(entry(pids.root))}))`), false, 'the first message is outside the loaded page');
    const shown = await q.evaluate(`document.querySelector(${JSON.stringify(entry(pids.oldReply))}).closest('.reply-stack').dataset.stack`);
    assert.ok(shown !== pids.root && shown !== pids.old, 'a reply of the dossier shows as the head');
    assert.equal(await nameIn(q, shown), 'Dossier name', 'the page holding only replies names the dossier');
    // A rename, its answer held, shows at once.
    await hold(q, ['stack.name']);
    await renameTo(q, shown, 'Dossier renamed', 'Dossier name');
    assert.equal(await held(q), 1, 'the rename waits for its answer');
    assert.equal(await nameIn(q, shown), 'Dossier renamed', 'before Core answers, the row shows the name typed');
    await q.evaluate('window.letActs()');
    await until(async () => (await actsOf(part, pids.root))?.name?.text === 'Dossier renamed', 'Core holds it on the dossier\'s first message');
    // Split back out, its answer held: Old's messages still carry the dossier's position.
    await dossierOpen(q, 'laptop', shown);
    await hold(q, ['stack.join', 'stack.name']);
    await centre(q, split); await q.point(split);
    await until(() => q.evaluate(`Boolean(document.querySelector(${JSON.stringify(section(pids.old))}))`), 'Split back out draws Old as its own stack at once');
    assert.equal(await held(q), 1, 'the split waits for its answer');
    assert.equal(await nameIn(q, pids.old), 'Old name', 'split out, before Core answers, its row names Old, not the dossier it left');
    assert.equal(await nameIn(q, shown), 'Dossier renamed', 'and the dossier\'s names the dossier');
    await renameTo(q, pids.old, 'Old renamed', 'Old name');
    await q.evaluate('window.letActs()');
    await until(async () => (await actsOf(part, pids.old))?.name?.text === 'Old renamed', 'Core holds the rename on Old');
    assert.equal((await actsOf(part, pids.old)).joined, null, 'split for everyone');
    assert.equal((await actsOf(part, pids.root)).name.text, 'Dossier renamed', 'and the dossier keeps its name');
    // Joined again by ⇧⌘↓ into the reply shown as the head, its answer held: Old's messages still carry Old's position.
    await hold(q, ['stack.join', 'stack.name']);
    await keyTo(q, pids.old);
    await q.key('ArrowDown', 12);
    await until(async () => !await q.evaluate(`Boolean(document.querySelector(${JSON.stringify(section(pids.old))}))`), '⇧⌘↓ joins Old into the dossier at once');
    assert.equal(await held(q), 1, 'the join waits for its answer');
    assert.equal(await nameIn(q, shown), 'Dossier renamed', 'joined, before Core answers, the row names the dossier');
    await renameTo(q, shown, 'Dossier again', 'Dossier renamed');
    assert.equal(await nameIn(q, shown), 'Dossier again', 'the rename shows at once');
    await q.evaluate('window.letActs()');
    await until(async () => (await actsOf(part, pids.root))?.name?.text === 'Dossier again', 'Core holds the rename on the dossier\'s first message');
    assert.equal((await actsOf(part, pids.old)).joined?.into, shown, 'joined for everyone');
    assert.equal((await actsOf(part, pids.old)).name.text, 'Old renamed', 'and Old keeps its name');
    await until(async () => (await nameIn(q, shown)) === 'Dossier again', 'answered and read again, the row names the dossier');
    assert.deepEqual(q.errors, []); await q.close();
  });

  // Item 385: Return on a dossier selected as a whole edits its title, as Rename in ⋯ does.
  await check('reading stacks Return on a selected dossier edits its title: Return saves it, Escape cancels, Return in writing types, and Return on a message still replies', async () => {
    const topic = 'stack-rename-key';
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Plan the cabin week.', read: true }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply to the plan.', read: true }],
      ['lone', { sender: other, addressees: [facts.actor], body: 'A message on its own.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await away(p);
    const input = '#messages .reply-stack .stack-rename-input', toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
    const editing = () => p.evaluate(`document.activeElement?.matches?.(${JSON.stringify(input)}) ? document.activeElement.value : null`);
    // What has the keys, for a failure to name: the title's words while it is edited.
    const keysOn = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.(${JSON.stringify(input)})?e.value:(e?.className||e?.tagName)+' '+(e?.closest?.('[data-id]')?.dataset.id??'')})()`);
    const names = () => p.evaluate(`window.sent.filter(kind=>kind==='stack.name').length`);
    const name = async () => (await look(p, ids, 'root')).name;
    await keyTo(p, ids.root);
    assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'the keys are on the dossier\'s compact header');
    await p.key('Enter');
    await becomes(keysOn, 'Plan the cabin week.', 'Return on the selected dossier opens its title to edit, the cursor in it');
    assert.equal(await readerOn(p), null, 'and opens no Reader');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Escape');
    await until(async () => !await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), 'Escape cancels the edit');
    assert.equal(await name(), 'Plan the cabin week.', 'the title is as it was');
    assert.equal(await names(), 0, 'and nothing is sent');
    assert.equal((await actsOf(topic, ids.root))?.name ?? null, null, 'nor held by Core');
    // Its chevron selected stands for the dossier too.
    await p.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus({preventScroll:true})`);
    const fold = (await look(p, ids, 'root')).fold;
    await p.key('Enter');
    await becomes(keysOn, 'Plan the cabin week.', 'Return on the dossier\'s chevron opens its title to edit');
    assert.equal((await look(p, ids, 'root')).fold, fold, 'and does not press the chevron');
    await p.send('Input.insertText', { text: 'Cabin week' });
    await p.key('Enter');
    await until(async () => (await name()) === 'Cabin week', 'Return in the title saves it');
    await until(async () => (await actsOf(topic, ids.root, other))?.name?.text === 'Cabin week', 'Core holds it for everyone');
    assert.equal(await names(), 1, 'one rename sent: the Return that saved it started no second edit');
    assert.equal(await editing(), null, 'the title is no longer being edited');
    // Fully open, the head shows its whole message: Return there replies, as on any message.
    await centre(p, toggle); await press(p, 'laptop', toggle);
    await becomes(async () => (await look(p, ids, 'root')).headOpen, 'true', 'the dossier fully open, its first message whole');
    await away(p);
    await keyTo(p, ids.root);
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith('Plan the cabin week.'), 'Return on the head shown whole opens the Reader on it');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), false, 'and edits no title');
    await closeReader(p, 'laptop');
    await keyTo(p, ids.lone);
    await p.key('Enter');
    await until(async () => (await readerOn(p))?.startsWith('A message on its own.'), 'Return on a message on its own replies');
    await closeReader(p, 'laptop');
    // In writing Return is a new line, wherever the keys were.
    await keyTo(p, ids.root);
    await p.key('Enter', 4);
    await until(() => p.evaluate("document.activeElement?.id === 'inline-writing-body'"), 'the new message\'s writing has the cursor');
    await p.send('Input.insertText', { text: 'One' });
    await p.key('Enter');
    await p.send('Input.insertText', { text: 'Two' });
    await until(() => p.evaluate("document.activeElement?.value === 'One\\nTwo'"), 'Return in the writing makes a new line');
    assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(input)}))`), false, 'and edits no title');
    assert.equal(await names(), 1, 'nor renames anything');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 433: the harness's point() aims by a hit-test, then presses. A redraw landing between the two (here a
  // block put above the cards as the pointer comes to rest, as an answer drawing the page again moves them) makes
  // the press fall on something else: point() fails then, naming where it fell, rather than as a later wait.
  await check('reading stacks a press whose target a redraw moves between the aim and the press fails by naming where it fell (item 433)', async () => {
    const topic = 'stack-press-fell';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Message A, aimed at.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Message B.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    await away(p);
    await centre(p, words(ids.a));
    await p.evaluate(`addEventListener('pointermove',()=>{const s=document.createElement('div');s.className='press-fell-block';s.style.height='240px';
      document.querySelector('#messages').prepend(s)},{capture:true,once:true})`);
    await assert.rejects(p.point(words(ids.a)), / moved between the hit-test and the press: the press fell on \S/, 'the press that missed fails by naming where it fell');
    await p.evaluate(`document.querySelector('.press-fell-block').remove()`);
    // At rest, the same press lands where it was aimed.
    await p.point(words(ids.a));
    await until(async () => (await lit(p)).includes(ids.a), 'a press that lands where it was aimed lights the message');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Item 386: a click or a tap in a message, or on a dossier's header, puts the keys there, scrolling nothing.
  await check('reading stacks a click or a tap in a message moves the keys\' place there and scrolls nothing, a click on a dossier\'s header puts them on the dossier, and a press in writing keeps the cursor', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-click-keys-' + device;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'The dossier\'s first message.', read: true }],
        ['one', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply one.', read: true }],
        ['two', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'Reply two.', read: true }],
        ['folded', { sender: other, addressees: [facts.actor], body: 'A folded message whose 👍 is pressed.', read: true }],
        ...[1, 2, 3, 4, 5, 6].map(n => ['m' + n, { sender: other, addressees: [facts.actor], body: `Message ${n} on its own.\n` + 'Words to read, enough for a card of a few lines. '.repeat(3), read: true }])]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.folded, operation_id: topic + '-fold', args: { folded: true } });
      const p = await open(topic, device, topic, ids.root);
      if (device === 'laptop') await away(p);
      const at = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.('.stack-toggle')?'stack:'+e.closest('.reply-stack').dataset.stack:e?.matches?.('#messages .message-card')?e.dataset.id:e?.closest?.('#messages [data-id]')?'in:'+e.closest('[data-id]').dataset.id:e?.id||e?.tagName})()`);
      await becomes(async () => (await folded(p, ids.folded)).row, true, `${device}: the folded message shows as its row`);
      await keyTo(p, ids.m6);
      assert.equal(await at(), ids.m6, `${device}: the keys are on the newest message`);
      // The folded row stands at the foot of the window, its card reaching just past it, where moving the keys there would scroll.
      const thumb = card(ids.folded) + ' > .message-folded > .folded-thumb';
      // The window's foot between the 👍's bottom and the card's.
      const edges = await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.folded))}).getBoundingClientRect(),t=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
        scrollBy({top:Math.round((c.bottom+t.bottom)/2-innerHeight),behavior:'instant'});
        const c2=document.querySelector(${JSON.stringify(card(ids.folded))}).getBoundingClientRect(),t2=document.querySelector(${JSON.stringify(thumb)}).getBoundingClientRect();
        return {card:c2.bottom,thumb:t2.bottom,foot:innerHeight}})()`);
      assert.ok(edges.card > edges.foot && edges.thumb <= edges.foot, `${device}: the row's 👍 shows and its card runs just past the window's foot: ${JSON.stringify(edges)}`);
      const still = await p.evaluate('scrollY');
      if (device === 'laptop' && engine === 'chrome') {
        // A press with no move before it, so the pointer's resting place (item 387) plays no part.
        const b = await p.box(thumb), x = b.x + b.width / 2, y = b.y + b.height / 2;
        await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      } else await press(p, device, thumb);
      await until(async () => await thumbedBy(ids.folded), `${device}: the press acts: the row's 👍 gives the thumbs-up, in Core`);
      await becomes(async () => (await thumbOn(p, ids.folded))?.pressed, 'true', `${device}: and the page has learned it: the row's 👍 shows pressed`);
      await becomes(at, ids.folded, `${device}: the press puts the keys on the message it fell in, its card itself`);
      assert.equal(await p.evaluate('scrollY'), still, `${device}: and the page stays where it is`);
      assert.equal(await readerOn(p), null, `${device}: nothing opened`);
      // The keys act there: x unfolds the message pressed, not the one the keys were on before.
      await typeX(p);
      await until(async () => !await foldOf(topic, ids.folded), `${device}: x unfolds the message the press put the keys on, in Core`);
      await becomes(async () => (await folded(p, ids.folded)).whole, true, `${device}: and the page shows it whole, so what is below it has moved before it is pressed`);
      assert.equal(await foldOf(topic, ids.m6), false, `${device}: and folds nothing where the keys were`);
      if (device === 'laptop') {
        // Fully open, a click on the dossier's tab row folds it to latest plus unread and puts the keys on the dossier:
        // its head, which shows as one row again and stands for it.
        const toggle = `#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle`;
        // Aimed at rest, before and after centring it (centring reads what comes into view, and its answers redraw).
        await atRest(p, toggle);
        await centre(p, toggle);
        await atRest(p, toggle);
        if ((await look(p, ids, 'root')).fold !== 'open') await press(p, 'laptop', toggle);
        await becomes(async () => [(await look(p, ids, 'root')).fold, (await look(p, ids, 'root')).headOpen], ['open', 'true'], 'laptop: the dossier fully open');
        await keyTo(p, ids.m1);
        const before = await p.evaluate('scrollY');
        const row = card(ids.root) + ' > .stack-head .stack-who';
        if (engine === 'chrome') {
          const b = await p.box(row), x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
          await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        } else await p.point(row);
        await becomes(async () => (await look(p, ids, 'root')).fold, 'folded', 'laptop: the click on the tab row folds the dossier to latest plus unread, as before');
        await becomes(at, ids.root, 'laptop: and puts the keys on the dossier, its head shown as one row');
        assert.equal((await look(p, ids, 'root')).headOpen, 'false', 'laptop: the head shows as its row');
        assert.equal(await p.evaluate('scrollY'), before, 'laptop: the page stays where it is');
        await p.key('ArrowDown');
        await becomes(at, ids.two, 'laptop: ↓ goes on from the dossier, to its shown reply');
      }
      // A press in writing keeps the cursor there.
      await p.evaluate(`document.querySelector('#inline-writing-body').scrollIntoView({block:'center'})`);
      await press(p, device, '#inline-writing-body');
      await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), `${device}: a press in the writing puts the cursor there`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 387: the pointer moving onto a message or a dossier gives it the keys' place.
  await check('reading stacks the pointer moving onto a message or a dossier gives it the keys\' place, scrolling nothing; not while the keys move under a still pointer, nor from writing, and never by touch', async () => {
    const topic = 'stack-hover-keys';
    const body = name => name + '\n' + Array.from({ length: 8 }, (_, n) => `Line ${n + 1} of a message that makes the page scroll.`).join('\n');
    const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'Plan the boat trip.', read: true }],
      ['reply', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A reply to the plan.', read: true }],
      ...[1, 2, 3, 4, 5, 6].map(n => ['m' + n, { sender: other, addressees: [facts.actor], body: body(`Message ${n}`), read: true }])]);
    const p = await open(topic, 'laptop', topic, ids.root);
    await away(p);
    const at = () => p.evaluate(`(()=>{const e=document.activeElement;return e?.matches?.('#messages .message-card')?e.dataset.id:e?.id||e?.tagName})()`);
    await keyTo(p, ids.m6);
    // A message reaching into the bottom tenth of the window, where the keys would scroll it.
    await p.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(ids.m3))});scrollBy({top:c.getBoundingClientRect().top-innerHeight*0.85,behavior:'instant'})})()`);
    const still = await p.evaluate('scrollY');
    await p.point(words(ids.m3), 'move');
    await becomes(at, ids.m3, 'the pointer moving onto a message puts the keys on it');
    assert.equal(await p.evaluate('scrollY'), still, 'and the page stays where it is');
    assert.ok((await lit(p)).includes(ids.m3), 'it is lit');
    // The keys act there: x folds the message under the pointer.
    await typeX(p);
    await until(async () => await foldOf(topic, ids.m3), 'x folds the message the pointer moved onto, in Core');
    assert.equal(await foldOf(topic, ids.m6), false, 'and not the one the keys were on before');
    await typeX(p);
    await until(async () => !await foldOf(topic, ids.m3), 'x again unfolds it');
    // A dossier's compact header: the pointer on it gives the dossier the keys, and Return edits its title.
    await centre(p, card(ids.root));
    await p.point(card(ids.root) + ' > .stack-head .stack-who', 'move');
    await becomes(at, ids.root, 'the pointer on the dossier\'s compact header puts the keys on the dossier');
    await p.key('Enter');
    await until(() => p.evaluate(`document.activeElement?.matches?.('.stack-rename-input')`), 'Return edits the hovered dossier\'s title');
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector('.stack-rename-input')`), 'Escape cancels it');
    // Keys in use under a still pointer: the page scrolls under it, and the keys keep their place.
    await keyTo(p, ids.m5);
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.m5))}).scrollIntoView({block:'start'})`);
    const x = await p.evaluate(`document.querySelector('#messages').getBoundingClientRect().left + 100`), y = await p.evaluate('Math.round(innerHeight*0.15)');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.m5))}).focus({preventScroll:true})`);
    for (const expected of [ids.m4, ids.m3, ids.m2, ids.m1]) {
      await p.key('ArrowDown');
      await twoFrames(p);
      // WebKit can report a same-position pointermove after scrolling settles, about 100ms later.
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(await at(), expected, '↓ moves the keys one message on, whatever the page brings under the still pointer');
    }
    const under = await p.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y});return e?.closest('#messages .message-card')?.dataset.id??null})()`);
    assert.ok(under && under !== ids.m1, `another message is under the resting pointer (${under})`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 2, y });
    await becomes(at, under, 'once the pointer really moves, the message under it takes the keys');
    // Writing keeps the cursor: the pointer crossing the messages takes nothing from it.
    await p.evaluate(`document.querySelector('#inline-writing-body').scrollIntoView({block:'end'})`);
    await p.point('#inline-writing-body');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is in the writing');
    await p.send('Input.insertText', { text: 'Half written' });
    for (const id of [ids.m1, ids.m2]) { await centre(p, card(id)); await p.point(words(id), 'move'); await twoFrames(p); }
    assert.equal(await at(), 'inline-writing-body', 'the pointer moving over the messages leaves the cursor in the writing');
    assert.equal(await p.evaluate(`document.querySelector('#inline-writing-body').value`), 'Half written', 'and the writing as it was');
    // The writing's own controls and panels keep the keys too: Who sees this message, opened by the keys, keeps
    // them on its choice while the pointer moves over a message, and Return there opens no Reader.
    await p.evaluate(`document.getElementById('inline-who-chip').focus()`);
    await p.key('Enter');
    await until(() => p.evaluate(`(w=>!w.hidden&&w.contains(document.activeElement))(document.getElementById('inline-who-panel'))`), 'Return on the who chip opens Who sees this message, the keys on its choice');
    const choice = () => p.evaluate(`(e=>document.getElementById('inline-who-panel').contains(e)?e.textContent:(e?.className||e?.tagName)+' '+(e?.dataset?.id??''))(document.activeElement)`);
    const chosen = await choice();
    const left = await p.evaluate(`Math.round(document.querySelector('#messages').getBoundingClientRect().left + 60)`);
    for (const y of [120, 160, 200]) {
      assert.ok(await p.evaluate(`Boolean(document.elementFromPoint(${left},${y})?.closest('#messages .message-card'))`), `a message is under the pointer at ${y}`);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: left, y }); await twoFrames(p);
    }
    assert.equal(await choice(), chosen, 'the pointer moving over a message leaves the keys on the panel\'s choice');
    await p.key('Enter');
    await twoFrames(p);
    assert.equal(await readerOn(p), null, 'and Return there opens no Reader');
    if (await p.evaluate(`!document.getElementById('inline-who-panel').hidden`)) await p.key('Escape');
    // A press on a message's bar while writing acts and leaves the cursor in the writing.
    await p.point('#inline-writing-body');
    await until(() => p.evaluate(`document.activeElement?.id === 'inline-writing-body'`), 'the cursor is back in the writing');
    await centre(p, card(ids.m2));
    await p.point(words(ids.m2), 'move');
    await until(async () => (await lit(p)).includes(ids.m2), 'the pointer lights a message, its bar showing');
    await p.point('.message-bar [data-act=thumb]');
    await until(async () => await thumbedBy(ids.m2), 'the bar\'s 👍 gives the thumbs-up, in Core');
    assert.equal(await at(), 'inline-writing-body', 'and the cursor stays in the writing');
    assert.deepEqual(p.errors, []); await p.close();
    if (engine !== 'chrome') { observations.push({ name: 'stacks hover keys touch', engine, held: 'Safari\'s engine in the harness has no finger drag: that a finger moving over the messages moves no keys is checked in Chrome' }); return; }
    // A finger moving over the messages, scrolling, gives nothing the keys' place.
    const q = await open(topic + '-phone', 'phone', topic, ids.root);
    await centre(q, card(ids.m4));
    await tap(q, words(ids.m4));
    await until(async () => (await lit(q)).includes(ids.m4), 'phone: a tap lights a message');
    const placed = await q.evaluate(`document.activeElement?.closest?.('#messages [data-id]')?.dataset.id ?? document.activeElement?.tagName`);
    const fingerScroll = async () => {
      const b = await q.box(card(ids.m2)), cx = b.x + b.width / 2, cy = Math.min(b.y + b.height / 2, 600), t0 = Date.now() / 1000;
      await q.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }], timestamp: t0 });
      for (const part of [1, 2, 3, 4]) await q.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 40 * part }], timestamp: t0 + 0.05 * part });
      await q.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
    };
    await centre(q, card(ids.m2));
    await fingerScroll();
    await twoFrames(q);
    assert.equal(await q.evaluate(`document.activeElement?.closest?.('#messages [data-id]')?.dataset.id ?? document.activeElement?.tagName`), placed, 'phone: a finger moving over other messages moves no keys');
    assert.deepEqual(await lit(q), [ids.m4], 'phone: nor the light');
    assert.deepEqual(q.errors, []); await q.close();
  });

  // Item 382: the feed's view filters sit at the right of one row, "N messages marked unread · Read it" at its left.
  await check('reading stacks the feed\'s view filter sits at the right of the row "N messages marked unread · Read it" heads, at a laptop\'s width and a phone\'s, wrapping only when the row cannot hold both, and the row takes no room when nothing in it shows', async () => {
    const row = p => p.evaluate(`(()=>{const box=e=>{if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();
      return {left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom),mid:Math.round((b.top+b.bottom)/2),width:Math.round(b.width),height:Math.round(b.height)}};
      const r=document.querySelector('.feed-filters'),l=document.getElementById('messages').getBoundingClientRect();
      return {row:box(r),marks:box(document.getElementById('topic-marks')),chip:box(document.querySelector('#agent-coordination-show button')),
        list:{left:Math.round(l.left),right:Math.round(l.right)},gap:r?parseFloat(getComputedStyle(r).columnGap)||0:0,scroll:document.scrollingElement.scrollWidth,width:innerWidth}})()`);
    for (const device of Object.keys(DEVICES)) {
      const topic = 'stack-filter-row-' + device;
      const ids = await seed(topic, [['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Ready for this topic.', read: true }],
        ['root', { sender: 'aim-core', join: true, addressees: ['aim-ux'], body: 'Between agents only.', read: true }],
        ['reply', { sender: 'aim-ux', addressees: ['aim-core'], reply_to: 'root', body: 'Checked between us.', read: true }],
        ['mine', { sender: 'aim-core', addressees: [facts.actor], body: 'One to mark unread.', read: true }]]);
      await control({ method: 'mark', operation_id: topic + '-mark', message_ids: [ids.mine], marked: true });
      const p = await open(topic, device, topic, ids.mine);
      const both = await until(async () => { const r = await row(p); return r.marks && r.chip && r; }, `${device}: "1 message marked unread · Read it" and Show agent coordination show`);
      assert.ok(both.row, `${device}: they share one row above the feed: ${JSON.stringify(both)}`);
      assert.ok(Math.abs(both.marks.left - both.list.left) <= 2, `${device}: "Read it" at the row's left: ${JSON.stringify(both)}`);
      assert.ok(Math.abs(both.list.right - both.chip.right) <= 2, `${device}: the filter at its right: ${JSON.stringify(both)}`);
      const fits = both.marks.width + both.gap + both.chip.width <= both.row.width;
      if (device === 'laptop') assert.ok(fits, `laptop: the row holds both: ${JSON.stringify(both)}`);
      if (fits) assert.ok(Math.abs(both.marks.mid - both.chip.mid) <= 4, `${device}: side by side, on one line: ${JSON.stringify(both)}`);
      else assert.ok(both.chip.top >= both.marks.bottom - 1 && both.chip.top - both.marks.bottom <= 12, `${device}: the row cannot hold both, so the filter wraps just under, at the right: ${JSON.stringify(both)}`);
      assert.ok(both.scroll <= both.width, `${device}: nothing scrolls sideways (${both.scroll} of ${both.width})`);
      for (const theme of ['light', 'dark']) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await shot(p, `stack-filter-row-${device}-${theme}`);
      }
      // Read it gone, the filter keeps the row, at its right.
      await control({ method: 'mark', operation_id: topic + '-clear', message_ids: [ids.mine], marked: false });
      const alone = await until(async () => { const r = await row(p); return !r.marks && r.chip && r; }, `${device}: the mark cleared, Read it goes`);
      assert.ok(Math.abs(alone.list.right - alone.chip.right) <= 2, `${device}: the filter alone stays at the right: ${JSON.stringify(alone)}`);
      assert.ok(alone.row.height <= alone.chip.height + 2, `${device}: and the row is one line: ${JSON.stringify(alone)}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
    // Nothing in the row: it takes no room.
    const topic = 'stack-filter-row-empty';
    const ids = await seed(topic, [['plain', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'A plain message, nothing to filter.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.plain);
    const empty = await row(p);
    assert.deepEqual([empty.marks, empty.chip, empty.row], [null, null, null], `with nothing to show, the row takes no room: ${JSON.stringify(empty)}`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Where the keys are after Move below More hands them to More, ↑ and ↓ step from More's place. Just above More
  // is the topic's opening, the last stack shown above it (besideMore).
  for (const way of ['ArrowUp', 'ArrowDown']) await check(`reading stacks below More: after Move below More hands the focus to More, ${way === 'ArrowUp' ? '↑ lights the stack shown just above More' : '↓ lights nothing above More'}`, async () => {
    const topic = 'below-more-keys-' + way.toLowerCase();
    const { ids, p, shown } = await besideMore(topic);
    await becomes(shown, ['c', 'a', 'More'], 'B below More');
    assert.equal(await p.evaluate(`document.activeElement?.classList.contains('stack-more')`), true, 'Move below More hands the focus to More');
    await away(p);
    await p.key(way);
    await twoFrames(p);
    const opening = await p.evaluate(`[...document.querySelectorAll('#messages > [data-id]')].find(e=>e.classList.contains('own-message')||e.querySelector('.own-message'))?.dataset.id`);
    const names = { ...Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key])), [opening]: 'opening' };
    const now = await p.evaluate(`(e=>({lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(x=>x.dataset.id),focus:e?.closest?.('[data-id]')?.dataset.id??e?.className??null}))(document.activeElement)`);
    const litNames = now.lit.map(id => names[id] ?? id);
    if (way === 'ArrowUp') assert.deepEqual(litNames, ['opening'], `↑ from More lights the topic's opening, the stack shown just above More (lit ${JSON.stringify(litNames)}, focus ${JSON.stringify(names[now.focus] ?? now.focus)})`);
    else assert.deepEqual(litNames.filter(name => ['a', 'c', 'c1', 'opening'].includes(name)), [], `↓ from More, the last thing drawn, lights nothing above More (lit ${JSON.stringify(litNames)}, focus ${JSON.stringify(names[now.focus] ?? now.focus)})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A dossier put below a closed More and drawn where it sits for a link; → on its reply.
  await check('reading stacks below More: → on a reply of a dossier put below a closed More, drawn where it sits for a link, keeps the dossier drawn and the keys on it', async () => {
    const topic = 'below-more-peek';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const section = `#messages .reply-stack[data-stack="${ids.b}"]`;
    const drawn = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
    await becomes(drawn, true, 'B is drawn');
    await menuOf(p, 'laptop', ids.b1); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await becomes(drawn, false, 'B is below a closed More');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.b1} please.`, read: true })).result.message_id;
    const link = card(linking) + ' a.words-link';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the link arrives');
    await centre(p, link); await p.point(link);
    await until(async () => (await readerOn(p))?.startsWith('A reply to B'), 'the link opens B1 in the Reader');
    await closeReader(p, 'laptop');
    await becomes(drawn, true, 'the link draws B where it sits');
    await away(p);
    await keyTo(p, ids.b1);
    const before = await p.evaluate(`document.querySelector(${JSON.stringify(section)}).dataset.fold`);
    await p.key('ArrowRight');
    await twoFrames(p);
    const after = await p.evaluate(`(e=>({focus:{drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest?.('[data-id]')?.dataset.id??null,tag:e?.tagName??null},
      fold:document.querySelector(${JSON.stringify(section)}).dataset.fold,lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(x=>x.dataset.id),said:document.getElementById('stack-said')?.textContent??null}))(document.activeElement)`);
    const below = (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below;
    assert.equal(await drawn(), true, `→ on B1 (fold ${before} → ${after.fold}, said ${JSON.stringify(after.said)}) keeps B drawn where the link drew it (Core below ${below}; ${JSON.stringify(after)})`);
    assert.equal(after.focus.drawn, true, `after → the keys are on something drawn (${JSON.stringify(after)})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The same dossier drawn for a link; ⋯ Fold on the reply the link opened.
  await check('reading stacks below More: ⋯ Fold on the reply a link drew in a dossier put below a closed More folds it where it is drawn, the keys on it', async () => {
    const topic = 'below-more-peekfold';
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    const p = await open(topic, 'laptop', topic, ids.a);
    const section = `#messages .reply-stack[data-stack="${ids.b}"]`;
    const drawn = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
    await becomes(drawn, true, 'B is drawn');
    await menuOf(p, 'laptop', ids.b1); await choose(p, 'laptop', 'Move below More');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below, 'Core holds B below More');
    await becomes(drawn, false, 'B is below a closed More');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.b1} please.`, read: true })).result.message_id;
    const link = card(linking) + ' a.words-link';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the link arrives');
    await centre(p, link); await p.point(link);
    await until(async () => (await readerOn(p))?.startsWith('A reply to B'), 'the link opens B1 in the Reader');
    await closeReader(p, 'laptop');
    await becomes(drawn, true, 'the link draws B where it sits');
    await menuOf(p, 'laptop', ids.b1); await choose(p, 'laptop', 'Fold');
    await until(async () => (await actsOf(topic, ids.b1))?.folded === true, 'Core holds B1 folded');
    await twoFrames(p);
    const after = await p.evaluate(`(e=>({focus:{drawn:Boolean(e&&e!==document.body&&e.getClientRects().length),on:e?.closest?.('[data-id]')?.dataset.id??null,tag:e?.tagName??null,cls:e?.className??null},
      lit:[...document.querySelectorAll('#messages .lit[data-id]')].map(x=>x.dataset.id),said:document.getElementById('stack-said')?.textContent??null}))(document.activeElement)`);
    assert.equal(await drawn(), true, `⋯ Fold on B1 folds it where the link drew it, B still drawn (${JSON.stringify(after)})`);
    assert.equal(after.focus.drawn && after.focus.on === ids.b1, true, `after ⋯ Fold the keys are on B1, drawn (${JSON.stringify(after)})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A dossier B, with a reply B1, put below a closed More from another of the person's devices (or with mine, from
  // this page's ⋯); then a link to B1 arrives, and with follow the person opens it and closes the Reader, so B is
  // drawn where it sits for the link.
  // On a phone the link is tapped on its own first line: at 390 wide it wraps, and the middle of its box is the
  // paragraph between its lines.
  const linkedAside = async (topic, device, { follow = true, mine = false, init = '' } = {}) => {
    const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A.', read: true }],
      ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
      ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }],
      ['c', { sender: other, addressees: [facts.actor], body: 'Stack C.', read: true }]]);
    const p = await open(topic, device, topic, ids.a, init);
    const section = `#messages .reply-stack[data-stack="${ids.b}"]`;
    const drawn = () => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(section)})?.getClientRects().length)`);
    const newest = async () => (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
    const below = async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.below;
    // An act of the person's on another device: the fixture's stack_act, sent as them.
    let n = 0;
    const elsewhere = (kind, id, args) => control({ method: 'stack_act', sender: facts.actor, kind, message_id: id, operation_id: `${topic}-elsewhere-${n++}`, args });
    const more = () => p.evaluate(`(m=>m?{text:m.textContent,shown:m.getClientRects().length>0}:null)(document.querySelector('#messages .stack-more'))`);
    await becomes(drawn, true, 'B is drawn');
    if (mine) { await menuOf(p, device, ids.b1); await choose(p, device, 'Move below More'); }
    else await elsewhere('stack.aside', ids.b, { through: await newest() });
    await until(below, 'Core holds B below More');
    await becomes(drawn, false, 'B is below a closed More');
    const linking = (await control({ method: 'agent_message', operation_id: topic + '-link', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: `See ${facts.origin}/?topic=${topic}&message=${ids.b1} please.`, read: true })).result.message_id;
    const link = card(linking) + ' a.words-link';
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(link)}))`), 'the link arrives');
    if (follow) {
      await centre(p, link);
      if (device === 'phone') await tap(p, link, 'first'); else await p.point(link);
      await until(async () => (await readerOn(p))?.startsWith('A reply to B'), 'the link opens B1 in the Reader');
      await closeReader(p, device);
      await becomes(drawn, true, 'the link draws B where it sits');
    }
    return { ids, p, section, drawn, newest, below, elsewhere, more };
  };

  // Where the link drew B is this page's own view of the place Core held when the link was followed. Another
  // device's Bring back, then Move below More, is a later place, and B goes below the closed More as it does
  // with no link followed (the control).
  for (const device of ['laptop', 'phone']) for (const follow of [true, false]) await check(`reading stacks below More: on a ${device}, ${follow ? 'a dossier a link drew where it sits' : 'with no link followed (the control), a dossier'} goes below a closed More when another device brings it back and moves it below More again`, async () => {
    const topic = `below-more-elsewhere-${device}-${follow ? 'link' : 'control'}`;
    const { p, drawn, newest, below, elsewhere, more, ids } = await linkedAside(topic, device, { follow });
    await elsewhere('stack.aside', ids.b, { through: null });
    await until(async () => !(await below()), 'Core holds B brought back');
    await becomes(drawn, true, 'B, brought back on another device, is drawn above More');
    await elsewhere('stack.aside', ids.b, { through: await newest() });
    await until(below, 'Core holds B below More again');
    const got = await until(async () => !(await drawn()), 'B goes below the closed More after the second move on another device').then(() => 'below', () => 'still drawn');
    assert.equal(got, 'below', `after another device Brought back B and moved it below More again, this page still draws B where the link drew it (More: ${JSON.stringify(await more())})`);
    assert.equal((await more())?.shown, true, `More shows, closed, with B below it (${JSON.stringify(await more())})`);
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The same link followed again after another device's Bring back and Move below More draws B where it sits
  // again: the link's place is the one Core holds when it is followed, which the earlier following does not keep.
  for (const device of ['laptop', 'phone']) await check(`reading stacks below More: on a ${device}, the link followed again after another device's Bring back and Move below More draws B where it sits again`, async () => {
    const topic = `below-more-again-${device}`;
    const { p, drawn, newest, below, elsewhere, ids } = await linkedAside(topic, device);
    await elsewhere('stack.aside', ids.b, { through: null });
    await until(async () => !(await below()), 'Core holds B brought back');
    await becomes(drawn, true, 'B, brought back on another device, is drawn');
    await elsewhere('stack.aside', ids.b, { through: await newest() });
    await until(below, 'Core holds B below More again');
    await becomes(drawn, false, 'B goes below the closed More');
    const link = '#messages a.words-link';
    await centre(p, link);
    if (device === 'phone') await tap(p, link, 'first'); else await p.point(link);
    await until(async () => (await readerOn(p))?.startsWith('A reply to B'), 'the link opens B1 in the Reader again');
    await closeReader(p, device);
    await becomes(drawn, true, 'the link followed again draws B where it sits');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Nothing moves B's place: the keys' →, ⋯ Fold on B1, and the page reading the topic's acts and messages again
  // (another device's star on C, a new message), all with the page left open. B stays drawn where the link drew it.
  await check('reading stacks below More: a dossier a link drew where it sits stays drawn there through →, ⋯ Fold and the page reading the topic again, while nothing moves it', async () => {
    const topic = 'below-more-stays';
    const { p, drawn, below, elsewhere, ids, section } = await linkedAside(topic, 'laptop');
    await away(p);
    await keyTo(p, ids.b1);
    await p.key('ArrowRight');
    await twoFrames(p);
    assert.equal(await drawn(), true, `→ on B1 keeps B drawn where the link drew it (fold ${await p.evaluate(`document.querySelector(${JSON.stringify(section)}).dataset.fold`)})`);
    await menuOf(p, 'laptop', ids.b1); await choose(p, 'laptop', 'Fold');
    await until(async () => (await actsOf(topic, ids.b1))?.folded === true, 'Core holds B1 folded');
    await twoFrames(p);
    assert.equal(await drawn(), true, '⋯ Fold on B1 keeps B drawn where the link drew it');
    await elsewhere('message.star', ids.c, { starred: true });
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(card(ids.c))})?.dataset.starred === 'true'`), 'the page reads the star made on another device');
    const arriving = (await control({ method: 'agent_message', operation_id: topic + '-later', topic_id: topic, source: 'topic', sender: other, addressees: [facts.actor],
      body: 'Something else, later.', read: true })).result.message_id;
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(arriving))}))`), 'the page reads the new message');
    await twoFrames(p);
    assert.equal(await below(), true, 'Core still holds B below More');
    assert.equal(await drawn(), true, 'after the page read the topic again, B is still drawn where the link drew it');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The person's own Move below More, here, on B drawn where it sits for a link: two fingers swiped right over its
  // title bar (item 472: over its last reply they would fold that reply). Core finds B's place unchanged (the same through as the Move below More this page made, so the
  // same revision); B still goes below the closed More, at once and after Core answers.
  await check('reading stacks below More: two fingers swiped right over a dossier a link drew where it sits move it below the closed More, though Core finds its place unchanged', async () => {
    const topic = 'below-more-swipe-again';
    const { p, drawn, below, ids, more } = await linkedAside(topic, 'laptop', { mine: true });
    const revision = async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.b] })).items[0].stack_position.aside_revision;
    const was = await revision();
    const title = `#messages .reply-stack[data-stack="${ids.b}"] .stack-head`;
    await centre(p, title);
    const b = await p.box(title), x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 20);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const deltaX of [-30, -30, -30, -30, -18, -10, -5, -2, -1]) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY: 0 });
    await until(async () => await said(p) === 'Moved below More, for you only', 'the swipe moves B below More');
    assert.equal(await foldOf(topic, ids.b1), false, 'and folds no message of it');
    await until(() => p.evaluate('window.fetchesOut === 0'), 'every act sent is answered');
    await twoFrames(p);
    assert.deepEqual([await below(), await revision()], [true, was], 'Core holds B below More, at the place it held');
    assert.equal(await drawn(), false, `after the swipe and Core's answer, B is below the closed More (More: ${JSON.stringify(await more())})`);
    assert.deepEqual(p.errors, []); await p.close();
  });
  // Items 602 and 601 (tests/menu_glyphs.mjs, docs/links.md "A message's menu"): every item of a message's ⋯, of a
  // right-click on a cut-off message, of a dossier's menu and of the phone's two sheets shows its glyph before its
  // words, in each state an item has, at a phone's 320, 375 and 390 by touch and on a laptop, light and dark. Each
  // width and theme reads a topic of its own, its states made through Core as the person's other devices make them,
  // so what this case's own presses change is no other's.
  await check('reading menus every item of a message\'s ⋯, a right-click, a dossier\'s menu and the phone\'s sheets carries its glyph before its words, 18px and on their middle, in each state an item has, at 320, 375, 390 and a laptop, light and dark', async () => {
    const seen = [], aligned = [], kept = [];
    const WIDTHS = [['laptop', 'laptop', null], ['390', 'phone', 390], ['375', 'phone', 375], ['320', 'phone', 320]];
    for (const [width, device, phoneWidth] of WIDTHS) for (const theme of ['light', 'dark']) {
      const topic = `menu-glyphs-${engine}-${width}-${theme}`;
      const ids = await seed(topic, [
        ['primer', { sender: 'aim-ux', join: true, addressees: [facts.actor], body: 'Here for the fence.', read: true }],
        ['root', { sender: other, join: true, addressees: [facts.actor], body: 'The plan for the garden fence.', read: true }],
        ['r1', { sender: 'aim-ux', reply_to: 'root', addressees: [facts.actor], body: 'The posts come on Tuesday.' }],
        ['mine', { sender: facts.actor, addressees: [other], body: 'Then we paint on Thursday.' }],
        ['asideRoot', { sender: 'aim-ux', addressees: [facts.actor], body: 'The shed can wait.', read: true }],
        ['asideReply', { sender: other, reply_to: 'asideRoot', addressees: [facts.actor], body: 'Agreed, after the fence.', read: true }],
        ['host', { sender: other, addressees: [facts.actor], body: 'Gate hinges are ordered.', read: true }],
        ['joined', { sender: 'aim-ux', addressees: [facts.actor], body: 'And the latch with them.', read: true }],
        ['placed', { sender: other, addressees: [facts.actor], body: 'The paint is the green one.', read: true }],
        ['marked', { sender: 'aim-ux', addressees: [facts.actor], body: 'Brushes are in the shed.', read: true }],
        ['folded', { sender: other, addressees: [facts.actor], body: 'Rain is due on Friday.', read: true }],
        ['starred', { sender: 'aim-ux', addressees: [facts.actor], body: 'Keep the receipt for the posts.', read: true }],
        ['long', { sender: other, addressees: [facts.actor], body: Array.from({ length: 40 }, (_, i) => `Step ${i + 1} of the fence, written out in full.`).join('\n'), read: true }],
        ['plain', { sender: 'aim-ux', addressees: [facts.actor], body: 'The neighbours said yes.', read: true }],
      ]);
      const act = (kind, id, args) => control({ method: 'stack_act', sender: facts.actor, kind, message_id: id, operation_id: `${topic}-${kind}-${id}`, args });
      await act('message.star', ids.starred, { starred: true });
      await act('message.fold', ids.folded, { folded: true });
      await act('stack.place', ids.placed, { key: 1 });
      await act('stack.join', ids.joined, { into: ids.host });
      const seqs = (await view('topic_messages', { topic_id: topic, direction: 'before', limit: 30 })).items;
      await act('stack.aside', ids.asideRoot, { through: seqs.find(each => each.id === ids.asideReply).seq });
      await control({ method: 'mark', operation_id: `${topic}-mark`, message_ids: [ids.marked], marked: true });
      const p = await open(`menu-glyphs-${width}-${theme}`, device, topic, ids.plain);
      await dossierTheme(p, theme);
      if (phoneWidth) await p.send('Emulation.setDeviceMetricsOverride', { width: phoneWidth, height: 844, deviceScaleFactor: 1, mobile: true });
      // The open menu's rows read and pictured, then put away by Escape.
      const rows = async name => {
        await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${width} ${theme} ${name}: the menu is open`);
        const read = await p.evaluate(ROWS);
        await shot(p, `menus-${width}-${theme}-${name}`);
        seen.push(...read.map(row => ({ ...row, at: `${width} ${theme} ${name}` })));
        const lefts = read.map(row => row.words?.left ?? NaN);
        aligned.push([`${width} ${theme} ${name}`, Math.max(...lefts) - Math.min(...lefts)]);
        return read.map(row => row.label);
      };
      const away = async () => { await p.key('Escape'); await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'the menu is put away'); };
      const sheet = async name => { await choose(p, device, 'Move or join…'); await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list[aria-label="Move or join"]'))`), `${width}: the second sheet`); return rows(name); };
      // A message's ⋯, and on a phone its stack's moves on the second sheet.
      const of = async (id, name, more = false) => { await menuOf(p, device, id); const labels = await rows(name); if (device === 'phone' && more) return [...labels, ...await sheet(name + '-moves')]; return labels; };
      // A dossier's own menu: a right-click on its title row, at the row's end clear of its words (Safari's engine selects a word a right-click lands on).
      const headMenu = async name => {
        const head = `${card(ids.root)} > .stack-head`;
        await centre(p, head);
        const b = await p.box(head), x = b.x + b.width - 10, y = b.y + b.height / 2;
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', clickCount: 1 });
        return rows(name);
      };
      const has = (labels, want, where) => { for (const label of want) assert.ok(labels.includes(label), `${width} ${theme} ${where}: ${label} in ${labels.join(', ')}`); };
      has(await of(ids.plain, 'plain', true), ['Star for me', 'Fold', 'Copy Link', 'Mark unread', 'Move below More', 'Move its stack up', 'Move its stack down', 'Join the stack above', 'Join the stack below', ...(device === 'phone' ? ['Move or join…'] : [])], 'a message on its own');
      await away();
      if (device === 'laptop') { await rightClick(p, card(ids.long)); has(await rows('long'), ['Show full message'], 'a right-click on a cut-off message'); }
      else has(await of(ids.long, 'long'), ['Show full message'], 'a cut-off message');
      await away();
      has(await of(ids.starred, 'starred'), ['Unstar'], 'a starred message'); await away();
      has(await of(ids.marked, 'marked'), ['Mark read'], 'a message marked unread'); await away();
      has(await of(ids.joined, 'joined'), ['Split back out'], 'a message joined to the stack above'); await away();
      has(await of(ids.mine, 'mine'), ['Edit'], 'the person\'s own message'); await away();
      has(await of(ids.placed, 'placed', true), ['Let new replies move it'], 'a stack placed by the person'); await away();
      has(await of(ids.r1, 'reply', true), ['Open its stack'], 'a reply in a dossier at its latest and unread'); await away();
      if (device === 'laptop') {
        // A message the person folded: its row's menu is the right click's (menuOf); a phone's tap on its row unfolds it.
        has(await of(ids.folded, 'folded'), ['Unfold'], 'a folded message'); await away();
        has(await headMenu('dossier'), ['Rename', 'Show all messages'], 'a dossier\'s title row');
        await choose(p, device, 'Show all messages');
        await until(() => p.evaluate(`document.querySelector('#messages .reply-stack[data-stack="${ids.root}"] > .stack-toggle')?.dataset.state === 'open'`), 'the dossier shows all its messages');
        has(await of(ids.root, 'dossier-open'), ['Show latest and unread replies', 'Fold its stack'], 'a dossier showing all its messages'); await away();
      }
      // Undo, once the page has made a move; then Bring back above More, in More opened.
      await of(ids.plain, 'move', device === 'phone');
      await choose(p, device, 'Move its stack down');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), 'the move chosen');
      // Undo is in every message's ⋯ once a move is made; asked of a message not lit since, as a press lights it afresh.
      has(await of(ids.marked, 'undo', true), ['Undo'], 'after a move'); await away();
      await centre(p, '#messages .stack-more'); await press(p, device, '#messages .stack-more');
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card(ids.asideReply))})?.getClientRects().length)`), 'More shows the dossier below it');
      has(await of(ids.asideReply, 'below-more', true), ['Bring back above More'], 'a dossier below More'); await away();
      // The pencil and the tray the menus borrow stay on their own buttons; the feed and the bar carry no menu glyph.
      // The bars' own controls show glyphs of their own (item 473): a dossier's title bar's and the message bar's
      // buttons; a glyph anywhere else in the feed or on the bar is counted.
      kept.push([`${width} ${theme}`, await p.evaluate(`[document.querySelectorAll('#new-message svg').length,document.querySelectorAll('#reader-aside svg').length,
        [...document.querySelectorAll('#messages [data-glyph], .message-bar [data-glyph]')].filter(g=>!g.parentElement.matches('#messages .reply-stack > .stack-tools > .stack-tool, .message-bar > button')).length]`)]);
      assert.deepEqual(p.errors, []); await p.close();
    }
    // Every width and theme is drawn and pictured before any is judged, so one run keeps each picture.
    assert.deepEqual(misglyphed(seen), [], 'each item carries exactly the glyph of its meaning');
    assert.deepEqual(misdrawn(seen), [], 'each glyph draws the approved design\'s drawing and leaves ink; the pencil and the tray are the New message and Reader\'s archive buttons\' own drawings');
    assert.deepEqual(misplaced(seen), [], 'each glyph is drawn before its words, 18px, on their middle, in the row\'s colour');
    assert.deepEqual(aligned.filter(([, spread]) => !(spread < 0.5)), [], 'in each menu every item\'s words start at one edge');
    assert.deepEqual(kept.filter(([, counts]) => JSON.stringify(counts) !== '[1,1,0]'), [], 'New message keeps its pencil and the Reader\'s archive button its tray; no glyph in the feed or on the bar but on the bars\' own controls');
  });

  // Item 473: a dossier's title bar shows, at its right, Reply to its first message, Move below More (Bring back
  // once it is there) and ⋯, the menu a right-click on its first message gives (docs/reply-stacks.md, "The title bar
  // and the message bar"). Each is a button beside the head's card, named, with that name as its tooltip.
  const toolsOf = id => `#messages .reply-stack[data-stack="${id}"] > .stack-tools`;
  const toolOf = (id, name) => `${toolsOf(id)} > .stack-tool[data-tool=${name}]`;
  // Whether a dossier's title bar glyphs show: there to see, not only kept in their place.
  const toolsShown = (p, id) => p.evaluate(`(t=>{if(!t)return null;const s=getComputedStyle(t);return s.visibility==='visible'&&Number(s.opacity)===1})(document.querySelector(${JSON.stringify(toolsOf(id))}))`);
  // The title bar and its glyphs as drawn: the tab's box and its name's width, each glyph shown with its name,
  // tooltip, box, whether it shows a glyph and whether a press at its centre lands on it.
  const toolFacts = (p, id) => p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(toolsOf(id))}),s=t.closest('.reply-stack'),tab=s.querySelector(':scope > [data-id] .stack-head'),tb=tab.getBoundingClientRect();
    return {tab:{left:tb.left,right:tb.right,top:tb.top,bottom:tb.bottom},name:tab.querySelector('.stack-name').getBoundingClientRect().width,
      corner:parseFloat(getComputedStyle(s).getPropertyValue('--stack-r-tab'))*parseFloat(getComputedStyle(document.documentElement).fontSize),
      tools:[...t.children].filter(b=>!b.hidden&&b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {tool:b.dataset.tool,label:b.getAttribute('aria-label'),title:b.title,width:r.width,height:r.height,
        left:r.left,right:r.right,top:r.top,bottom:r.bottom,glyph:Boolean(b.querySelector(':scope > svg.glyph'))||b.textContent==='⋯',hit:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}}),
      overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth}})()`);
  // A press at the centre of a dossier's ⋯ as it stands: its box, whether the glyphs show, what the press finds there,
  // whether that is ⋯ or any title bar glyph, and whether it is the page holding the dossier (the point is in the
  // window, on the paper beside the tab, above the folder's own box).
  const restingPress = (p, id) => p.evaluate(`(t=>{const m=t.querySelector(':scope > .stack-tool[data-tool=menu]'),r=m.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,
    h=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null,s=getComputedStyle(t);
    return {width:r.width,height:r.height,shown:s.visibility==='visible'&&Number(s.opacity)===1,page:Boolean(h&&h!==t&&h.contains(t)),
      under:h?h.tagName+'.'+String(h.className).slice(0,40):null,hit:Boolean(h&&t.contains(h))}})(document.querySelector(${JSON.stringify(toolsOf(id))}))`);
  const barDossierSeed = (topic, extra = []) => seed(topic, [
    ['root', { sender: other, join: true, addressees: [facts.actor], body: 'Dossier first words for the title bar.', read: true }],
    ['r1', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'The first reply.', read: true }],
    ['r2', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'The second reply.', read: true }],
    ['solo', { sender: other, addressees: [facts.actor], body: 'A message on its own has no title bar.', read: true }], ...extra]);
  // Shows a dossier's title bar glyphs as a person does: the pointer onto its title bar, or a tap on it (a first tap
  // selects it).
  const showTools = async (p, device, id) => {
    const who = `#messages .reply-stack[data-stack="${id}"] > [data-id] .stack-head > .stack-who`;
    await centre(p, `#messages .reply-stack[data-stack="${id}"]`);
    if (device === 'phone') { if (!await toolsShown(p, id)) await tap(p, who); } else await p.point(who, 'move');
    await until(() => toolsShown(p, id), `${device}: the title bar shows its glyphs`);
  };
  const foldedRow = (p, id) => p.evaluate(`(c=>c?.dataset.folded==='true'&&Boolean(c.querySelector(':scope > .message-folded')?.getClientRects().length))(document.querySelector(${JSON.stringify(card(id))}))`);
  const TOOL_NAMES = { reply: 'Reply to the first message', aside: 'Move below More', menu: 'More for this dossier' };

  await check('reading stacks the title bar shows Reply, Move below More and ⋯ at its right under the pointer, or once selected by touch, each named with its tooltip and 44px by touch, beside the tab at 320, 375 and 390 pixels and on a laptop, in light and dark; a message on its own has none', async () => {
    // Under the pointer at 1280 and 761 pixels the three glyphs; at 760, as on a phone, ⋯ alone.
    for (const device of Object.keys(DEVICES)) {
      const topic = `title-bar-${device}`, ids = await barDossierSeed(topic), resting = {};
      const p = await open(topic, device, topic, ids.root);
      await away(p);
      assert.equal(await toolsShown(p, ids.root), false, `${device}: at rest the title bar shows no glyphs`);
      if (device === 'phone') {
        // By touch, hidden, they take no press: a tap at the hidden ⋯'s centre, at each phone width, finds the page
        // beneath it, not ⋯, until the dossier is selected.
        for (const width of [390, 375, 320]) {
          await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
          await centre(p, `#messages .reply-stack[data-stack="${ids.root}"]`);
          const at = await restingPress(p, ids.root);
          assert.equal(at.shown, false, `phone ${width}: at rest the title bar shows no glyphs`);
          assert.ok(at.width >= 44 && at.height >= 44, `phone ${width}: the hidden ⋯ keeps its 44px place: ${JSON.stringify(at)}`);
          assert.equal(at.hit, false, `phone ${width}: a press at the hidden ⋯'s centre does not land on it: ${JSON.stringify(at)}`);
          assert.ok(at.page, `phone ${width}: it lands on the page beneath, which holds the dossier: ${JSON.stringify(at)}`);
          await dossierTheme(p, 'light');
          resting[width] = await toolFacts(p, ids.root);
          await shot(p, `title-bar-phone-${width}-rest-light`);
        }
      }
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(entry(ids.solo))}).closest('.reply-stack')?.querySelector('.stack-tools')??null`), null, `${device}: a message on its own has no title bar glyphs`);
      if (device === 'laptop') {
        // The pointer anywhere over the dossier shows them: over the folder itself, between its cards, where nothing
        // lights; and they hide again once it leaves.
        await centre(p, `#messages .reply-stack[data-stack="${ids.root}"]`);
        const [x, y, there] = await p.evaluate(`(()=>{const s=document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]'),r=s.getBoundingClientRect(),x=r.left+r.width/2,y=r.bottom-3,h=document.elementFromPoint(x,y);
          return [x,y,h&&s.contains(h)&&!h.closest('[data-id], button')?h.className||h.tagName:null]})()`);
        assert.ok(there, 'laptop: a point on the folder below its cards is the folder itself');
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await until(() => toolsShown(p, ids.root), 'laptop: the pointer over the folder shows its title bar\'s glyphs');
        assert.deepEqual(await lit(p), [], 'laptop: with nothing lit');
        await away(p);
        await until(async () => !await toolsShown(p, ids.root), 'laptop: the pointer gone, they hide again');
      }
      // A laptop's window at 761 pixels keeps the three glyphs, and at 760 folds them into ⋯ as a phone does.
      const widths = device === 'phone' ? [390, 375, 320] : [DEVICES.laptop.width, 761, 760];
      for (const width of widths) {
        await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES[device], width });
        await showTools(p, device, ids.root);
        for (const theme of ['light', 'dark']) {
          await dossierTheme(p, theme);
          const f = await toolFacts(p, ids.root);
          await shot(p, `title-bar-${device}-${width}-${theme}`);
          // In a window 760px or narrower (a phone's) the three fold into ⋯ alone, which offers Reply and Move below
          // More first: there the tab may reach 85% of the folder, and the paper past its corner holds one glyph.
          const folded = device === 'phone' || width <= 760, shownTools = folded ? { menu: TOOL_NAMES.menu } : TOOL_NAMES;
          assert.deepEqual(f.tools.map(t => [t.tool, t.label, t.title]), Object.entries(shownTools).map(([tool, name]) => [tool, name, name]),
            folded ? `${device} ${width}: ⋯ alone, named with its tooltip` : `${device} ${width}: Reply, Move below More and ⋯, each named with that name as its tooltip`);
          for (const t of f.tools) {
            assert.ok(t.glyph, `${device} ${width}: ${t.tool} is a glyph, not a word`);
            assert.ok(t.hit, `${device} ${width}: a press at ${t.tool}'s centre lands on it`);
            assert.ok(t.left >= f.tab.right + f.corner - .5, `${device} ${width} ${theme}: ${t.tool} sits at the title bar's right, clear of the tab and its curved corner: ${JSON.stringify(f)}`);
            assert.ok(t.right <= f.width + .5 && t.top >= f.tab.top - .5 && t.bottom <= f.tab.bottom + .5, `${device} ${width}: ${t.tool} is inside the window, on the title bar's line: ${JSON.stringify(f)}`);
            if (device === 'phone') assert.ok(t.width >= 44 && t.height >= 44, `${width}: ${t.tool} is 44px to touch: ${JSON.stringify(t)}`);
          }
          assert.ok(f.name > 20, `${device} ${width}: the tab keeps room for its name beside the glyphs: ${JSON.stringify(f)}`);
          // At rest the hidden glyphs keep their place, and on a phone that place is ⋯'s alone: the tab is as wide at
          // rest as once selected, its name the same words, not cut back for two glyphs folded into ⋯.
          if (device === 'phone' && theme === 'light') {
            const r = resting[width], menu = f.tools.find(t => t.tool === 'menu');
            assert.ok(Math.abs(r.tab.right - f.tab.right) <= .5 && r.name >= f.name - .5,
              `phone ${width}: at rest the tab and its name are as wide as once selected: ${JSON.stringify({ rest: { tab: r.tab, name: r.name }, selected: { tab: f.tab, name: f.name } })}`);
            assert.ok(menu.left - r.tab.right <= menu.width, `phone ${width}: at rest the tab reaches to within one glyph of ⋯: ${JSON.stringify({ rest: r.tab, menu })}`);
            observations.push({ name: 'title bar at rest', engine, device, width, tab: r.tab, name: r.name, selectedName: f.name, gapToMenu: menu.left - r.tab.right });
          }
          assert.equal(f.overflow, false, `${device} ${width}: nothing scrolls sideways`);
          observations.push({ name: 'title bar glyphs', engine, device, width, theme, ...f });
        }
        await dossierTheme(p, 'light');
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 473: the title bar's glyphs stand in a row with the dossier's chevron, as a message bar's buttons stand with
  // each other, so ← and → go along that row to the nearest control that way (docs/interaction.md, "The arrows
  // everywhere"): on a laptop from ⋯ to Move below More, Reply and the chevron, and back; past ⋯, → goes on to the
  // right rail, as from the messages. On a phone, at 390, 375 and 320, ⋯ stands alone and ← from it reaches the
  // chevron. ↑ and ↓ stay the messages' keys there: ↓ from ⋯ lights the dossier's message below it.
  await check('reading stacks ← and → on a dossier\'s title bar glyphs go along the title bar to the nearest control that way, the chevron included, on a laptop and at 390, 375 and 320; ↓ from ⋯ goes on to the dossier\'s message below', async () => {
    const where = p => p.evaluate(`(e=>!e||e===document.body?'page':e.closest('#things')?'right rail':e.closest('#rail')?'outline':e.matches('#messages .reply-stack > .stack-toggle')?'chevron':e.closest('#messages .reply-stack > .stack-tools')?e.dataset.tool:e.closest('#messages [data-id]')?'message:'+e.closest('[data-id]').dataset.id:(e.id||e.className||e.tagName))(document.activeElement)`);
    const keyFrom = async (p, id, tool, key) => {
      await p.evaluate(`document.querySelector(${JSON.stringify(toolOf(id, tool))}).focus()`);
      await until(async () => (await where(p)) === tool, `the keys on the title bar's ${tool}`);
      await p.key(key);
      return where(p);
    };
    for (const device of Object.keys(DEVICES)) {
      const topic = `title-bar-arrows-${device}`, ids = await barDossierSeed(topic);
      const p = await open(topic, device, topic, ids.root);
      await away(p);
      if (device === 'laptop') {
        // → past ⋯ lands on the right rail's place, as from the messages: once the rail has drawn its rows.
        await until(() => p.evaluate("[...document.querySelectorAll('#things [role=treeitem]')].some(e=>e.checkVisibility())"), 'laptop: the right rail shows its rows');
        const seen = [await keyFrom(p, ids.root, 'menu', 'ArrowLeft'), await keyFrom(p, ids.root, 'aside', 'ArrowLeft'), await keyFrom(p, ids.root, 'reply', 'ArrowLeft'),
          await keyFrom(p, ids.root, 'reply', 'ArrowRight'), await keyFrom(p, ids.root, 'aside', 'ArrowRight'), await keyFrom(p, ids.root, 'menu', 'ArrowRight')];
        assert.deepEqual(seen, ['aside', 'reply', 'chevron', 'aside', 'menu', 'right rail'],
          'laptop: ← from ⋯ to Move below More, Reply and the chevron; → back along the row, and past ⋯ on to the right rail');
      } else {
        for (const width of [390, 375, 320]) {
          await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
          await centre(p, `#messages .reply-stack[data-stack="${ids.root}"]`);
          assert.equal(await keyFrom(p, ids.root, 'menu', 'ArrowLeft'), 'chevron', `phone ${width}: ← from ⋯ reaches the chevron`);
        }
      }
      // ↓ stays the messages' key: from ⋯ it lights the message below, in the dossier, never the page.
      const down = await keyFrom(p, ids.root, 'menu', 'ArrowDown');
      assert.ok([ids.r1, ids.r2].map(id => `message:${id}`).includes(down), `${device}: ↓ from ⋯ goes on to the dossier's message below: ${down}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Items 602 and 473: in a window 760px or narrower (a phone) the title bar's Reply and Move below More fold into its ⋯,
  // whose menu offers them first; as every menu item, each shows a glyph before its words, the drawing of the button
  // that does the same (602's rule): Reply to the first message the title bar's Reply, Move below More the Reader's
  // archive tray (item 601) and Bring back above More the tray with an arrow out. A menu with an item that names no
  // glyph opens nothing (openMessageMenu), so without them the phone's ⋯ opens no menu at all.
  await check('reading menus a dossier\'s title bar ⋯ on a 390px phone offers Reply to the first message and Move below More first, then Bring back above More once below, each with its glyph before its words, light and dark', async () => {
    const topic = 'title-bar-phone-menu', ids = await barDossierSeed(topic), seen = [], firstTwo = [];
    const p = await open(topic, 'phone', topic, ids.root);
    assert.equal(await p.evaluate('innerWidth'), 390, 'a phone 390px wide');
    // The title bar's ⋯ pressed by touch, and its menu's rows read: the press refused for a missing glyph fails here, by its error.
    const menuRows = async name => {
      await showTools(p, 'phone', ids.root);
      await press(p, 'phone', toolOf(ids.root, 'menu'));
      await until(async () => p.errors.length > 0 || await p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${name}: the title bar's ⋯ opens its menu, or the page says why not`);
      assert.deepEqual(p.errors.map(error => error.message ?? error.exception?.description ?? error.text ?? JSON.stringify(error)), [], `${name}: the title bar's ⋯ opens its menu, no item refused for want of a glyph`);
      const rows = await p.evaluate(ROWS);
      await shot(p, `title-bar-phone-menu-${name}`);
      seen.push(...rows.map(row => ({ ...row, at: name })));
      firstTwo.push([name, rows.slice(0, 2).map(row => [row.label, row.glyphs])]);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), `${name}: Escape puts the menu away`);
    };
    for (const theme of ['light', 'dark']) { await dossierTheme(p, theme); await menuRows(theme); }
    await dossierTheme(p, 'light');
    // Move below More chosen from ⋯ by touch; below More, the same item brings it back.
    await showTools(p, 'phone', ids.root);
    await press(p, 'phone', toolOf(ids.root, 'menu'));
    await until(() => p.evaluate(`document.querySelector('.message-menu-list > button:nth-child(2)')?.textContent === 'Move below More'`), 'the phone\'s ⋯ offers Move below More second');
    await press(p, 'phone', '.message-menu-list > button:nth-child(2)');
    await until(async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.root] })).items[0].stack_position.below, 'Core holds the dossier below More');
    await until(() => p.evaluate(`!document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]').getClientRects().length && Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`), 'the dossier is below a closed More');
    await centre(p, '#messages .stack-more'); await press(p, 'phone', '#messages .stack-more');
    await until(() => p.evaluate(`document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]').getClientRects().length > 0`), 'More shows the dossier below it');
    await menuRows('below-more');
    assert.deepEqual(firstTwo, [
      ['light', [['Reply to the first message', ['reply']], ['Move below More', ['archive']]]],
      ['dark', [['Reply to the first message', ['reply']], ['Move below More', ['archive']]]],
      ['below-more', [['Reply to the first message', ['reply']], ['Bring back above More', ['back']]]],
    ], 'the phone\'s ⋯ offers Reply with the title bar\'s Reply and Move below More with the Reader\'s tray, then Bring back with the tray and its arrow out');
    assert.deepEqual(misglyphed(seen), [], 'each item carries exactly the glyph of its meaning');
    assert.deepEqual(misdrawn(seen), [], 'each glyph draws the approved drawing and leaves ink; the tray is the Reader\'s archive button\'s own drawing');
    assert.deepEqual(misplaced(seen), [], 'each glyph is drawn before its words, 18px, on their middle, in the row\'s colour');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A title bar act as a person takes it: its glyph on a laptop; on a phone, where the three fold into ⋯, the item of
  // that name in ⋯'s menu, which offers Reply and Move below More (or Bring back) before the first message's own.
  const menuWords = p => p.evaluate(`[...document.querySelector('.message-menu-list').querySelectorAll('button')].map(b=>b.textContent)`);
  const titleAct = async (p, device, id, tool) => {
    if (device !== 'phone') { await press(p, device, toolOf(id, tool)); return; }
    const words = await p.evaluate(`document.querySelector(${JSON.stringify(toolOf(id, tool))}).getAttribute('aria-label')`);
    await press(p, device, toolOf(id, 'menu'));
    await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `phone: ⋯ opens the menu for ${words}`);
    const at = (await menuWords(p)).indexOf(words);
    assert.ok(at >= 0 && at < 2, `phone: ⋯ offers ${words} first: ${JSON.stringify(await menuWords(p))}`);
    await press(p, device, `.message-menu-list > button:nth-child(${at + 1})`);
  };
  await check('reading stacks the title bar\'s Reply opens the Reader on the dossier\'s first message, its ⋯ opens the menu that message\'s own ⋯ gives, and Move below More and Bring back move the dossier; a reload finds its order, name and folds as they were, every message in reach', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `title-bar-acts-${device}`, ids = await barDossierSeed(topic);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.name', message_id: ids.root, operation_id: topic + '-name', args: { name: 'Cabin week' } });
      await dossierFold(topic, ids.r1);
      const p = await open(topic, device, topic, ids.root);
      const kept = async q => ({ order: await stacks(q, ids), name: await q.evaluate(`document.querySelector('#messages .reply-stack[data-stack="${ids.root}"] .stack-name')?.textContent??null`),
        acts: Object.fromEntries(await Promise.all(['root', 'r1', 'r2'].map(async key => [key, (({ name = '', folded = false, starred = false }) => ({ name, folded, starred }))(await actsOf(topic, ids[key]) ?? {})]))) });
      await until(async () => (await kept(p)).name === 'Cabin week', `${device}: the dossier shows its name`);
      const before = await kept(p);
      // Reply: the Reader on the first message, the cursor in the reply.
      await showTools(p, device, ids.root);
      await titleAct(p, device, ids.root, 'reply');
      await until(async () => (await readerOn(p))?.startsWith('Dossier first words'), `${device}: Reply opens the Reader on the dossier's first message`);
      await until(() => p.evaluate(`document.activeElement?.id === 'writing-body'`), `${device}: the cursor is in the reply`);
      await closeReader(p, device);
      // ⋯ gives what the first message's own ⋯ gives, the dossier open in both.
      await dossierOpen(p, device, ids.root);
      const own = await menuOf(p, device, ids.root);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), `${device}: Escape closes the menu`);
      await showTools(p, device, ids.root);
      await press(p, device, toolOf(ids.root, 'menu'));
      await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), `${device}: the title bar's ⋯ opens the menu`);
      assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(toolOf(ids.root, 'menu'))}).getAttribute('aria-expanded')`), 'true', `${device}: ⋯ says its menu is open`);
      assert.deepEqual(await menuWords(p), device === 'phone' ? ['Reply to the first message', 'Move below More', ...own] : own,
        device === 'phone' ? 'phone: the title bar\'s ⋯ offers Reply and Move below More, then what the first message\'s ⋯ offers' : `${device}: the title bar's ⋯ offers what the first message's ⋯ offers`);
      await p.key('Escape');
      await until(() => p.evaluate(`!document.querySelector('.message-menu-list')`), `${device}: Escape closes it`);
      // Move below More, then Bring back from below More.
      const below = async () => (await view('stack_positions', { topic_id: topic, message_ids: [ids.root] })).items[0].stack_position.below;
      await showTools(p, device, ids.root);
      await titleAct(p, device, ids.root, 'aside');
      await until(below, `${device}: Core holds the dossier below More`);
      await until(() => p.evaluate(`!document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]').getClientRects().length && Boolean(document.querySelector('#messages .stack-more')?.getClientRects().length)`), `${device}: the dossier is below a closed More`);
      await press(p, device, '#messages .stack-more');
      await showTools(p, device, ids.root);
      assert.deepEqual(await p.evaluate(`(b=>[b.getAttribute('aria-label'),b.title])(document.querySelector(${JSON.stringify(toolOf(ids.root, 'aside'))}))`), ['Bring back above More', 'Bring back above More'], `${device}: below More the glyph brings it back`);
      await titleAct(p, device, ids.root, 'aside');
      await until(async () => !await below(), `${device}: Core holds it above More again`);
      if (device === 'laptop') {
        // The keys: Tab from the dossier reaches each glyph in turn, Shift-Tab comes back, and Return on Reply replies.
        await keyTo(p, ids.root);
        const at = () => p.evaluate(`document.activeElement?.closest?.('.stack-tools')?document.activeElement.dataset.tool:null`);
        for (let n = 0; n < 12 && await at() !== 'reply'; n++) await p.key('Tab');
        assert.equal(await at(), 'reply', 'Tab from the dossier\'s first message, past its bar and chevron, reaches the title bar\'s Reply');
        await until(() => toolsShown(p, ids.root), 'a glyph holding the focus shows the title bar\'s glyphs');
        await p.key('Tab'); assert.equal(await at(), 'aside', 'then Move below More');
        await p.key('Tab'); assert.equal(await at(), 'menu', 'then ⋯');
        await p.key('Tab', 8); await p.key('Tab', 8); assert.equal(await at(), 'reply', 'Shift-Tab comes back');
        await p.key('Enter');
        await until(async () => (await readerOn(p))?.startsWith('Dossier first words'), 'Return on Reply opens the Reader on the first message');
        await closeReader(p, device);
      } else {
        // The keys on a phone: Tab from the dossier reaches ⋯ and no folded glyph; Return opens its menu on Reply, and
        // Return replies; ↓ then Return moves the dossier below More.
        const at = () => p.evaluate(`document.activeElement?.closest?.('.stack-tools')?document.activeElement.dataset.tool:null`);
        const toMenu = async () => {
          await keyTo(p, ids.root);
          const met = [], trail = [];
          const where = () => p.evaluate(`(e=>e?(e.dataset?.tool??e.dataset?.act??e.id??'')+':'+e.tagName+'.'+String(e.className).slice(0,30):null)(document.activeElement)`);
          for (let n = 0; n < 40 && await at() !== 'menu'; n++) { await p.key('Tab'); const here = await at(); if (here) met.push(here); trail.push(await where()); }
          assert.deepEqual(met, ['menu'], `phone: Tab from the dossier reaches ⋯, and no folded glyph: ${JSON.stringify(trail)}`);
        };
        await toMenu();
        await p.key('Enter');
        await until(() => p.evaluate(`document.activeElement?.closest?.('.message-menu-list')?document.activeElement.textContent:null`).then(w => w === 'Reply to the first message'), 'phone: Return on ⋯ opens its menu on Reply');
        await p.key('Enter');
        await until(async () => (await readerOn(p))?.startsWith('Dossier first words'), 'phone: Return on Reply opens the Reader on the first message');
        await closeReader(p, device);
        await toMenu();
        await p.key('Enter');
        await until(() => p.evaluate(`Boolean(document.querySelector('.message-menu-list'))`), 'phone: Return opens ⋯\'s menu again');
        await p.key('ArrowDown');
        assert.equal(await p.evaluate(`document.activeElement.textContent`), 'Move below More', 'phone: ↓ reaches Move below More');
        await p.key('Enter');
        await until(below, 'phone: Return on Move below More moves the dossier below More');
        // Below More, which is open still from the Bring back before, or closed.
        if (!await p.evaluate(`document.querySelector('#messages .reply-stack[data-stack="${ids.root}"]').getClientRects().length > 0`)) await press(p, device, '#messages .stack-more');
        await showTools(p, device, ids.root);
        await titleAct(p, device, ids.root, 'aside');
        await until(async () => !await below(), 'phone: Bring back from ⋯ puts it above More again');
      }
      // Tony's rule over the dossier: how it is shown stores nothing, and every message stays in reach in place.
      // A new document, known by its timeOrigin as first read (WebKit's can move 1 ms with no load); a read while the
      // old one goes is no answer.
      const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
      await p.send('Page.reload');
      await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(entry(ids.root))}))`).catch(() => false), `${device}: the page is drawn again, a new document`);
      await until(async () => (await kept(p)).name === 'Cabin week', `${device}: reloaded, the name shows`);
      assert.deepEqual(await kept(p), before, `${device}: a reload finds the order, the name and the folds as they were`);
      await dossierOpen(p, device, ids.root);
      for (const key of ['root', 'r1', 'r2']) assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids[key]))}).getClientRects().length>0`), `${device}: ${key} is in reach, in place`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 473: the message bar's Reply is a glyph, and the bar gains Show full message, only on a message its card
  // cuts off, and Fold (Unfold once folded; none on a starred message).
  const barFacts = p => p.evaluate(`(()=>{const b=document.querySelector('.message-bar');if(!b||b.hidden)return null;return [...b.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>{const r=x.getBoundingClientRect();
    return {act:x.dataset.act,label:x.getAttribute('aria-label'),title:x.title,glyph:Boolean(x.querySelector(':scope > svg.glyph')),words:x.textContent,width:r.width,height:r.height}})})()`);
  await check('reading stacks the message bar\'s Reply is a glyph, Show full message shows only on a message its card cuts off and shows it whole, and Fold folds it for the reader and Unfold unfolds it, none on a starred message; each named with its tooltip, reached by Tab, 44px by touch', async () => {
    const long = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}. Words that need the full height of the message to be read.`).join('\n\n');
    for (const device of Object.keys(DEVICES)) {
      const topic = `message-bar-${device}`;
      const ids = await seed(topic, [['root', { sender: other, join: true, addressees: [facts.actor], body: 'A dossier for the bar.', read: true }],
        ['short', { sender: 'aim-ux', join: true, reply_to: 'root', addressees: [facts.actor], body: 'A short reply.', read: true }],
        ['starred', { sender: other, reply_to: 'root', addressees: [facts.actor], body: 'A starred reply.', read: true }],
        ['long', { sender: other, reply_to: 'root', addressees: [facts.actor], body: long, read: true }]]);
      await control({ method: 'stack_act', sender: facts.actor, kind: 'message.star', message_id: ids.starred, operation_id: topic + '-star', args: { starred: true } });
      const p = await open(topic, device, topic, ids.root, 'window.holdReads = true;');
      await dossierOpen(p, device, ids.root);
      await light(p, device, ids.short);
      let f = await barFacts(p);
      const named = act => f.find(b => b.act === act);
      assert.deepEqual(f.map(b => b.act), ['thumb', 'reply', 'fold', 'more'], `${device}: a short message's bar: 👍, Reply, Fold and ⋯, no Show full message`);
      assert.deepEqual([named('reply').glyph, named('reply').words, named('reply').label, named('reply').title], [true, '', 'Reply (Return)', 'Reply (Return)'], `${device}: Reply is a named glyph, not the word`);
      assert.deepEqual([named('fold').glyph, named('fold').label, named('fold').title], [true, 'Fold', 'Fold'], `${device}: Fold is a named glyph`);
      if (device === 'phone') for (const b of f) assert.ok(b.width >= 44 && b.height >= 44, `phone: ${b.act} is 44px to touch: ${JSON.stringify(b)}`);
      await shot(p, `message-bar-${device}-short`);
      if (device === 'phone') {
        // At 375 and 320 pixels too: every glyph 44px, inside the window, nothing scrolling sideways.
        for (const width of [375, 320]) {
          // The message stays lit (a second tap would open it), and its bar is placed again for the narrower window.
          await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
          await until(() => p.evaluate(`(b=>Boolean(b&&!b.hidden&&b.getBoundingClientRect().right<=innerWidth))(document.querySelector('.message-bar'))`), `${width}: the lit message's bar is in the window`);
          assert.ok((await lit(p)).includes(ids.short), `${width}: the short message is still lit`);
          const at = await p.evaluate(`(()=>{const b=document.querySelector('.message-bar');return {buttons:[...b.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>{const r=x.getBoundingClientRect();return [x.dataset.act,r.width,r.height,r.left>=0&&r.right<=innerWidth]}),sideways:document.documentElement.scrollWidth>innerWidth}})()`);
          assert.deepEqual(at.buttons.map(([act]) => act), ['thumb', 'reply', 'fold', 'more'], `${width}: the same bar`);
          for (const [act, w, h, inside] of at.buttons) assert.ok(w >= 44 && h >= 44 && inside, `${width}: ${act} is 44px and in the window (${w}×${h})`);
          assert.equal(at.sideways, false, `${width}: nothing scrolls sideways`);
          await shot(p, `message-bar-phone-${width}`);
        }
        await p.send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
        await until(() => p.evaluate(`(b=>Boolean(b&&!b.hidden))(document.querySelector('.message-bar'))`), '390: the bar is back');
      }
      // Fold, then Unfold, in Core for the reader.
      await press(p, device, '.message-bar [data-act=fold]');
      await until(async () => (await actsOf(topic, ids.short))?.folded === true, `${device}: Fold folds the message in Core`);
      await until(() => foldedRow(p, ids.short), `${device}: the message shows as its folded row`);
      // The folded message stays lit, and its bar now offers Unfold (a second tap on a lit message would open it).
      await until(async () => (await barFacts(p))?.some(b => b.act === 'fold' && b.label === 'Unfold'), `${device}: the bar now offers Unfold`);
      f = await barFacts(p);
      assert.deepEqual([named('fold').label, named('fold').title], ['Unfold', 'Unfold'], `${device}: on a folded message the glyph is Unfold`);
      await press(p, device, '.message-bar [data-act=fold]');
      await until(async () => (await actsOf(topic, ids.short))?.folded === false, `${device}: Unfold unfolds it in Core`);
      await until(async () => !await foldedRow(p, ids.short), `${device}: the message reads whole again`);
      assert.equal(await readerOn(p), null, `${device}: no Reader opened`);
      assert.equal((await actsOf(topic, ids.short, other))?.folded ?? false, false, `${device}: nobody else's view changed`);
      // A starred message offers no Fold. A phone taps the middle of its words, clear of the bar over the message above.
      const lightMiddle = async id => {
        if (device !== 'phone') return light(p, device, id);
        await centre(p, card(id)); await tap(p, words(id), 'centre');
        await until(async () => (await lit(p)).includes(id) && await bar(p) !== null, `phone: ${id} lights, with its bar`);
      };
      await lightMiddle(ids.starred);
      assert.deepEqual((await barFacts(p)).map(b => b.act), ['thumb', 'reply', 'more'], `${device}: a starred message's bar has no Fold`);
      // Show full message, on the long message its card cuts off, and gone once it shows whole.
      await lightMiddle(ids.long);
      await until(async () => (await barFacts(p))?.some(b => b.act === 'full'), `${device}: a cut-off message's bar offers Show full message`);
      f = await barFacts(p);
      assert.deepEqual([named('full').glyph, named('full').label, named('full').title], [true, 'Show full message', 'Show full message'], `${device}: Show full message is a named glyph`);
      if (device === 'phone') assert.ok(named('full').width >= 44 && named('full').height >= 44, 'phone: Show full message is 44px to touch');
      if (device === 'laptop') {
        // The keys reach it: Tab from the lit message goes through the bar.
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.long))}).focus({preventScroll:true})`);
        const reached = [];
        // The card's own star comes first, then the bar, then out of it.
        for (let n = 0; n < 10; n++) {
          await p.key('Tab');
          const act = await p.evaluate(`document.activeElement?.closest?.('.message-bar')?document.activeElement.dataset.act:document.activeElement?.matches?.('.card-star')?'star':null`);
          if (!act) break;
          reached.push(act);
        }
        for (const act of ['reply', 'full', 'fold', 'more']) assert.ok(reached.includes(act), `laptop: Tab reaches ${act} (${JSON.stringify(reached)})`);
        await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.long))}).focus({preventScroll:true})`);
      }
      await shot(p, `message-bar-${device}-long`);
      const height = await p.evaluate(`document.querySelector(${JSON.stringify(card(ids.long))}).getBoundingClientRect().height`);
      await press(p, device, '.message-bar [data-act=full]');
      await until(() => p.evaluate(`(c=>c.dataset.full==='shown'&&c.scrollHeight-c.clientHeight<=1&&c.getBoundingClientRect().height>${height}+100)(document.querySelector(${JSON.stringify(card(ids.long))}))`), `${device}: the card shows the whole message`);
      await until(async () => !(await barFacts(p))?.some(b => b.act === 'full'), `${device}: shown whole, it offers Show full message no more`);
      assert.equal(await readerOn(p), null, `${device}: no Reader opened`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 477: a dossier's title bar and folder wear the colour of the agent who posted its first message, across
  // their whole face; a person's dossier keeps the neutral folder. No coloured edge or bar marks it.
  await check('reading stacks a dossier an agent began wears its colour on its folder and title bar, in the colour the reader chose for it, a person\'s keeps the neutral folder, with no coloured edge, in light and dark', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = `folder-colour-${device}`;
      const ids = await seed(topic, [['agent', { sender: other, join: true, addressees: [facts.actor], body: 'An agent began this dossier.', read: true }],
        ['agent1', { sender: 'aim-ux', join: true, reply_to: 'agent', addressees: [facts.actor], body: 'A reply in the agent\'s dossier.', read: true }],
        ['person', { sender: 'fixture-other-person', join: true, addressees: [facts.actor], body: 'A person began this dossier.', read: true }],
        ['person1', { sender: other, reply_to: 'person', addressees: [facts.actor], body: 'A reply in the person\'s dossier.', read: true }],
        ['solo', { sender: other, addressees: [facts.actor], body: 'aim-core again, on its own.', read: true }]]);
      const p = await open(topic, device, topic, ids.agent);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages .reply-stack[data-stack="${ids.person}"]'))`), `${device}: both dossiers are drawn`);
      // The agent's folder as item 477 has it: its tag colour a step toward its card in light, its card a step toward
      // the page's dark in dark (docs/reply-stacks.md, "The look").
      const folderOf = (palette, theme) => theme === 'dark' ? 'color-mix(in srgb,var(--agent-card) 70%,#0b1113)' : 'color-mix(in srgb,var(--agent-tag) 70%,var(--agent-card))';
      const paint = (id, palette = null, theme = 'light') => p.evaluate(`(()=>{const s=document.querySelector('#messages .reply-stack[data-stack="${id}"]'),tab=s.querySelector(':scope > [data-id] .stack-head'),cs=getComputedStyle(s),ts=getComputedStyle(tab);
        const probe=document.createElement('span');${palette ? `probe.className='agent-${palette}';probe.style.background=${JSON.stringify(folderOf(palette, theme))};` : `probe.style.background='var(--stack-folder)';`}document.body.append(probe);const want=getComputedStyle(probe).backgroundColor;probe.remove();
        const neutral=document.createElement('span');neutral.style.background='var(--stack-folder)';document.body.append(neutral);const plain=getComputedStyle(neutral).backgroundColor;neutral.remove();
        return {folder:cs.backgroundColor,tab:ts.backgroundColor,want,plain,color:s.dataset.color,edges:[cs.borderLeftWidth,ts.borderLeftWidth,cs.boxShadow.includes('inset')]}})()`);
      // aim-core's colour is the one its own cards wear (its own, or one the reader chose for it in an earlier case).
      const paletteOf = () => p.evaluate(`(document.querySelector(${JSON.stringify(card(ids.solo))}).className.match(/\\bagent-(?!card\\b)([a-z]+)\\b/)||[])[1]??null`);
      const own = await paletteOf();
      assert.ok(own, `${device}: aim-core's card wears a palette colour`);
      for (const theme of ['light', 'dark']) {
        await dossierTheme(p, theme);
        const agent = await paint(ids.agent, own, theme), person = await paint(ids.person);
        assert.equal(agent.color, 'agent', `${device} ${theme}: the agent's dossier is marked with its colour`);
        assert.deepEqual([agent.folder, agent.tab], [agent.want, agent.want], `${device} ${theme}: aim-core's folder and title bar are its ${own} across their whole face: ${JSON.stringify(agent)}`);
        assert.notEqual(agent.folder, agent.plain, `${device} ${theme}: and not the neutral folder`);
        assert.deepEqual([person.color, person.folder, person.tab], ['', person.plain, person.plain], `${device} ${theme}: a person's dossier keeps the neutral folder: ${JSON.stringify(person)}`);
        for (const each of [agent, person]) assert.deepEqual(each.edges, ['0px', '0px', false], `${device} ${theme}: no coloured edge or bar`);
        observations.push({ name: 'folder colour', engine, device, theme, agent, person });
        await shot(p, `folder-colour-${device}-${theme}`);
        if (device === 'phone') for (const width of [375, 320]) {
          // Narrower phones: the same faces, nothing scrolling sideways.
          await p.send('Emulation.setDeviceMetricsOverride', { ...DEVICES.phone, width });
          const narrow = await paint(ids.agent, own, theme);
          assert.deepEqual([narrow.folder, narrow.tab], [narrow.want, narrow.want], `${width} ${theme}: the agent's folder and title bar are still its colour`);
          assert.equal(await p.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `${width}: nothing scrolls sideways`);
          await shot(p, `folder-colour-phone-${width}-${theme}`);
          await p.send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
        }
      }
      await dossierTheme(p, 'light');
      if (device === 'laptop') {
        // The reader's own choice of colour for the agent: the folder follows it, and Default gives it back.
        await centre(p, `${card(ids.solo)} .author-name`);
        await p.point(`${card(ids.solo)} .author-name`);
        await until(() => p.evaluate(`Boolean(document.querySelector('.color-picker .swatch[aria-label="blue"]'))`), 'the colour picker opens for aim-core');
        const chosen = own === 'blue' ? 'green' : 'blue';
        await p.point(`.color-picker .swatch[aria-label="${chosen}"]`);
        await until(async () => { const f = await paint(ids.agent, chosen); return f.folder === f.want; }, `aim-core's folder is ${chosen} once the reader chose ${chosen} for it`);
        await centre(p, `${card(ids.solo)} .author-name`);
        await p.point(`${card(ids.solo)} .author-name`);
        await until(() => p.evaluate(`Boolean(document.querySelector('.color-picker .swatch-default'))`), 'the picker opens again');
        await p.point('.color-picker .swatch-default');
        // Default gives aim-core its own colour back, the one its cards wear again, and the folder follows.
        await until(async () => { const back = await paletteOf(); return back && back !== chosen; }, 'Default gives aim-core\'s cards their own colour back');
        const back = await paletteOf();
        await until(async () => { const f = await paint(ids.agent, back); return f.folder === f.want; }, `and the folder aim-core's own ${back}`);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 426: while the Reader is open on the oldest message the page loaded, its ↓ is Core's neighbour beyond the
  // page. Another device putting that neighbour's dossier below More, and bringing it back, changes what ↓ offers at
  // once, with no change to the topic itself.
  await check('reading stacks shown order: while the Reader is open at the bottom of a long topic, another device putting the unloaded dossier below it below More, or bringing it back, changes what ↓ offers at once', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'shown-order-unloaded-live-' + device;
      const ids = await seed(topic, [['r', { sender: other, join: true, addressees: [facts.actor], body: 'Root R, older than the page.', read: true }],
        ['r1', { sender: other, addressees: [facts.actor], reply_to: 'r', body: 'Reply R1, older than the page.', read: true }], ...fillers(30)]);
      const p = await open(topic, device, topic, ids.f29);
      await until(() => p.evaluate(`Boolean(document.querySelector('#messages [data-id="${ids.f0}"]'))`), device + ': F0 is the oldest loaded');
      await openReader(p, device, ids.f0, 'Filler 0.');
      await until(async () => (await stepsOffered(p)).below, device + ': ↓ from F0 is offered: R\'s dossier is beyond the page, above More');
      const newest = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.r, operation_id: topic + '-aside', args: { through: newest } });
      await becomes(async () => (await stepsOffered(p)).below, false, device + ': ↓ is no longer offered once another device put R\'s dossier below More');
      assert.equal(await readerOn(p).then(text => text?.startsWith('Filler 0.')), true, device + ': the Reader is still on F0');
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.r, operation_id: topic + '-back', args: { through: null } });
      await becomes(async () => (await stepsOffered(p)).below, true, device + ': ↓ is offered again once it was brought back');
      await closeReader(p, device);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 426: More messages ends the run the New line waits at the bottom of. A New line saying more new messages
  // lie below (its message older than the page) never sits below More, after a dossier put aside there.
  await check('reading stacks shown order: a New line waiting at the bottom for an older message sits above More messages, never below it after a one-message dossier put aside there, More closed or open', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'new-line-below-more-' + device;
      // Nothing is read: what a reader has read is a watermark, so a message read after U would read U too.
      const ids = await seed(topic, [['u', { sender: other, join: true, addressees: [facts.actor], body: 'Unread, older than the page.' }],
        ...fillers(30).map(([key, { read, ...said }]) => [key, said]), ['x', { sender: other, addressees: [facts.actor], body: 'Stack X, a message on its own put aside.' }]]);
      const newest = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.x, operation_id: topic + '-aside', args: { through: newest } });
      const p = await open(topic, device, topic, ids.f29, 'window.holdReads = true;');
      const order = () => p.evaluate(`[...document.querySelector('#messages').children].filter(e=>e.getClientRects().length).map(e=>e.dataset.line?'line:'+e.dataset.line:e.classList.contains('stack-more')?'More':e.dataset.id===${JSON.stringify(ids.x)}?'x':null).filter(Boolean)`);
      await until(async () => (await order()).includes('line:older'), device + ': the New line waits at the bottom, saying more new messages lie below');
      assert.deepEqual(await order(), ['line:older', 'More'], device + ': with More closed, the line sits above More, not below it');
      await centre(p, '#messages .stack-more');
      await press(p, device, '#messages .stack-more');
      await becomes(order, ['line:older', 'More', 'x'], device + ': with More open, the line is still above More, and X shows below it');
      await shot(p, `new-line-below-more-${device}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 426: a join of two dossiers, one of them below More, made by someone else. The joined dossier takes the
  // choice of the dossier it went into, and Split back out gives each its own again.
  await check('reading stacks below More: a dossier put below More joined by someone else into one above it reads in that one, above More, and Split back out puts it below More again; one joined into a dossier below More goes below with it; every message in reach and a reload agrees', async () => {
    for (const device of Object.keys(DEVICES)) {
      const topic = 'join-below-more-' + device;
      const ids = await seed(topic, [['a', { sender: other, join: true, addressees: [facts.actor], body: 'Stack A, above More.', read: true }],
        ['a1', { sender: other, reply_to: 'a', addressees: [facts.actor], body: 'A reply to A.', read: true }],
        ['b', { sender: other, addressees: [facts.actor], body: 'Stack B, put aside.', read: true }],
        ['b1', { sender: other, reply_to: 'b', addressees: [facts.actor], body: 'A reply to B.', read: true }]]);
      const newest = (await view('topic_messages', { topic_id: topic, audience: 'all', direction: 'before', limit: 1 })).items[0].seq;
      await control({ method: 'stack_act', sender: facts.actor, kind: 'stack.aside', message_id: ids.b, operation_id: topic + '-aside', args: { through: newest } });
      const p = await open(topic, device, topic, ids.a);
      const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
      // Each message by its name, as the page holds it: the dossier it is drawn in, and whether that shows.
      const where = q => q.evaluate(`Object.fromEntries(Object.entries(${JSON.stringify(names)}).map(([id,key])=>{const e=document.querySelector('#messages [data-id="'+id+'"]'),s=e?.closest('.reply-stack');
        return [key,{in:s?(${JSON.stringify(names)})[s.dataset.stack]:null,shown:Boolean(s?.getClientRects().length)}]}))`);
      const positions = async () => Object.fromEntries((await view('stack_positions', { topic_id: topic, message_ids: Object.values(ids) })).items.map(item => [names[item.message_id], [names[item.stack_position.root_id], item.stack_position.below]]));
      await becomes(async () => (await where(p)).b, { in: 'b', shown: false }, `${device}: B is below a closed More`);
      await control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: ids.b, operation_id: topic + '-join', args: { into: ids.a } });
      await becomes(async () => Object.values(await where(p)).map(each => JSON.stringify(each)), Array(4).fill(JSON.stringify({ in: 'a', shown: true })), `${device}: joined into A, B and its reply read in A, above More`);
      assert.deepEqual(await positions(), { a: ['a', false], a1: ['a', false], b: ['a', false], b1: ['a', false] }, `${device}: Core holds them in A's dossier, above More`);
      assert.equal(await p.evaluate(`Boolean(document.querySelector('#messages .stack-more'))`), false, `${device}: nothing is put aside now`);
      await dossierOpen(p, device, ids.a);
      for (const key of ['a', 'a1', 'b', 'b1']) assert.ok(await p.evaluate(`document.querySelector(${JSON.stringify(card(ids[key]))}).getClientRects().length>0`), `${device}: ${key} is in reach, in place`);
      // A new document, known by its timeOrigin as first read; a read while the old one goes is no answer.
      const origin = await p.evaluate('(window.documentOrigin??=performance.timeOrigin)');
      await p.send('Page.reload');
      await until(() => p.evaluate(`(window.documentOrigin??=performance.timeOrigin) !== ${origin} && document.body?.dataset.ready === 'true' && Boolean(document.querySelector(${JSON.stringify(entry(ids.a))}))`).catch(() => false), `${device}: the page is drawn again, a new document`);
      await becomes(async () => Object.values(await where(p)).map(each => JSON.stringify(each)), Array(4).fill(JSON.stringify({ in: 'a', shown: true })), `${device}: reloaded, the same`);
      // Split back out: B goes back to its own place, below More.
      await dossierOpen(p, device, ids.a);
      const split = `#messages .stack-join-line[data-join="${ids.b}"] .stack-split`;
      await centre(p, split); await press(p, device, split);
      await becomes(async () => (await where(p)).b, { in: 'b', shown: false }, `${device}: split back out, B is below a closed More again`);
      await until(async () => (await positions()).b1[1] === true, `${device}: Core holds B below More again`);
      // The other way: A joined into B, put aside, goes below More with it.
      await control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: ids.a, operation_id: topic + '-join-a', args: { into: ids.b } });
      await becomes(async () => Object.values(await where(p)).map(each => JSON.stringify(each)), Array(4).fill(JSON.stringify({ in: 'b', shown: false })), `${device}: A joined into B reads in B, below a closed More`);
      await press(p, device, '#messages .stack-more');
      await becomes(async () => Object.values(await where(p)).map(each => JSON.stringify(each)), Array(4).fill(JSON.stringify({ in: 'b', shown: true })), `${device}: More open, every message shows in B`);
      await control({ method: 'stack_act', sender: other, kind: 'stack.join', message_id: ids.a, operation_id: topic + '-split-a', args: { into: null } });
      await becomes(async () => (await where(p)).a, { in: 'a', shown: true }, `${device}: split again, A is back above More`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });

  // Item 426: the page may hold an older place for a dossier put below More than Core does, when another device moved
  // it and the page has not yet read that. A link followed then draws the dossier where it sits at the place Core
  // holds, so reading the move it missed does not take the dossier away; a later move still does.
  await check('reading stacks below More: a link followed while the page holds an older place for the dossier than Core keeps it drawn where it sits once the page reads Core\'s place, and a later move on another device still takes it below More', async () => {
    const topic = 'below-more-link-race';
    // Before the page's own code: its reads of the views named in window.held wait unsent, as on a slow connection,
    // until window.letHeld() sends them. Reading where a dossier sits (stack_positions) is never held. window.answered:
    // how many answers to each view's reads the page has had, counted once each answer's words are read.
    const init = `window.held=new Set();window.heldWaiting=[];window.answered={};window.letHeld=()=>{window.held.clear();for(const go of window.heldWaiting.splice(0))go()};
      {const sent=window.fetch;window.fetch=function(input,init){let b=null;try{b=JSON.parse(init&&init.body)}catch{}
        const count=answer=>{if(b&&b.name)answer.clone().text().then(()=>{window.answered[b.name]=(window.answered[b.name]||0)+1},()=>{});return answer};
        if(b&&b.name&&window.held.has(b.name))return new Promise(go=>window.heldWaiting.push(go)).then(()=>sent.call(this,input,init)).then(count);return sent.call(this,input,init).then(count)}}`;
    const { p, drawn, newest, below, elsewhere, more, ids } = await linkedAside(topic, 'laptop', { follow: false, init });
    // The page reads neither the acts nor the topic: it does not hear of what another device does.
    await p.evaluate(`['message_acts','topic_messages','topic','topic_unread','reactions'].forEach(name=>window.held.add(name))`);
    await elsewhere('stack.aside', ids.b, { through: null });
    await until(async () => !(await below()), 'Core holds B brought back');
    await elsewhere('stack.aside', ids.b, { through: await newest() });
    await until(below, 'Core holds B below More again, at a later place');
    await until(() => p.evaluate('window.heldWaiting.length > 0'), 'the page\'s read of what changed waits');
    assert.equal(await drawn(), false, 'the page still holds B below More, at the place it read before');
    const link = `#messages .message-card a.words-link[href*="${ids.b1}"]`;
    await centre(p, link); await p.point(link);
    await until(async () => (await readerOn(p))?.startsWith('A reply to B'), 'the link opens B1 in the Reader');
    await closeReader(p, 'laptop');
    await becomes(drawn, true, 'the link draws B where it sits');
    const [acts, before] = await p.evaluate('[window.answered.message_acts || 0, window.answered.stack_positions || 0]');
    await p.evaluate('window.letHeld()');
    // The page reads the acts it missed, then where each dossier sits, and draws what that read says.
    await until(() => p.evaluate(`(window.answered.message_acts || 0) > ${acts} && (window.answered.stack_positions || 0) > ${before} && window.fetchesOut === 0 && window.heldWaiting.length === 0`), 'the page reads what it missed, and where the dossiers sit');
    await twoFrames(p);
    assert.equal(await drawn(), true, `having read the moves it missed, the page keeps B drawn where the link drew it (More: ${JSON.stringify(await more())})`);
    // A move after the link was followed is a new place: B goes below the closed More.
    await elsewhere('stack.aside', ids.b, { through: null });
    await until(async () => !(await below()), 'Core holds B brought back');
    await elsewhere('stack.aside', ids.b, { through: await newest() });
    await until(below, 'and below More again');
    await becomes(drawn, false, 'a move made after the link was followed takes B below the closed More');
    assert.deepEqual(p.errors, []); await p.close();
  });
}
