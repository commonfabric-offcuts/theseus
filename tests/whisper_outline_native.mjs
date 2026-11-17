// Item 704: the existing dashed whisper frame on every drawing, and on its
// selection. These checks are called by the reading families and native-compose
// (which already runs both engines). No browser is launched by this module.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const cssFile = new URL('../web/aim.css', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const widths = ['laptop', 'phone-320', 'phone-375', 'phone'];
const themes = ['light', 'dark'];
const GEOMETRY_TOLERANCE_PX = 2; // rounding/scrollbar differences, not enough to hide an off-screen frame
const RING_TOLERANCE_PX = .25; // a missing 2px selection ring must fail in either engine
const q = value => JSON.stringify(value);
const card = id => `#messages .message-card[data-id="${id}"]`;

// A real on-disk source mutation, read by a fresh page. Every control gets new
// fixture operation identities. Never count an arbitrary error as a killed mutant.
async function withMutant(run, old, replacement) {
  const original = await readFile(cssFile, 'utf8');
  if (!original.includes('/* Item 704: whisper frames */')) return; // the red-before commit
  assert.equal(original.split(old).length, 2, 'the mutation has exactly one source target');
  const changed = original.replace(old, replacement);
  await writeFile(cssFile, changed);
  try {
    assert.equal(await readFile(cssFile, 'utf8'), changed, 'mutation actually applied');
    console.log('item 704 MUTANT applied', digest(original), digest(changed), old);
    await assert.rejects(() => run('mutant'), /704 frame:/, 'the native frame assertion kills this mutation');
    console.log('item 704 MUTANT killed');
  } finally {
    await writeFile(cssFile, original);
    assert.equal(digest(await readFile(cssFile)), digest(original), 'original source bytes restored');
    console.log('item 704 RESTORED', digest(original));
  }
  await run('restored');
  console.log('item 704 restored control PASS');
}

// Read every edge, rather than only borderTopStyle. A border can be dashed but
// transparent, or accompanied by a solid spread shadow. Decorative shadows on
// public cards are deliberately kept and asserted separately.
const frameExpression = selector => `(()=>{const e=document.querySelector(${q(selector)}),s=getComputedStyle(e),b=e.getBoundingClientRect();
  return {border:['Top','Right','Bottom','Left'].map(k=>[s['border'+k+'Style'],s['border'+k+'Color'],parseFloat(s['border'+k+'Width'])]),
    outline:s.outlineStyle,ring:parseFloat(s.outlineWidth),shadow:s.boxShadow,box:{x:b.x,right:b.right,width:b.width,height:b.height},viewport:innerWidth,
    text:e.textContent,visible:!!e.getClientRects().length}})()`;
function holdsFrame(f, selected, border = true) {
  assert.ok(f.visible && f.box.width > GEOMETRY_TOLERANCE_PX && f.box.height > GEOMETRY_TOLERANCE_PX, '704 frame: visible drawing');
  assert.ok(f.box.x >= -GEOMETRY_TOLERANCE_PX && f.box.right <= f.viewport + GEOMETRY_TOLERANCE_PX, '704 frame: within the page (2px tolerance)');
  if (border) for (const [style, color, width] of f.border) {
    assert.equal(style, 'dashed', '704 frame: existing dotted whisper edge');
    assert.ok(width > 0 && color !== 'transparent' && !color.endsWith(', 0)'), '704 frame: every edge has visible ink');
  }
  assert.equal(f.shadow, 'none', '704 frame: no solid spread ring around a whisper');
  if (selected) {
    assert.equal(f.outline, 'dashed', '704 frame: dotted selection/focus rectangle');
    assert.ok(Math.abs(f.ring - 2) <= RING_TOLERANCE_PX, '704 frame: selection stays visible (0.25px tolerance)');
  }
}

export async function whisperOutlineReading({ check, until, control, facts, shot, engine, observations }, h) {
  const branches = ['feed-rest', 'feed-selected', 'dossier-sheet-rest', 'dossier-sheet-selected', 'dossier-folded-selected', 'dossier-header-rest', 'dossier-header-selected'];
  for (const state of branches) await check(`reading item 704 ${state}: whispers keep dotted frames at 320 375 390 and laptop, light and dark`, async () => {
    const run = async (phase, devices = widths, schemes = themes) => {
      const errors = [];
      for (const device of devices) for (const theme of schemes) {
        const topic = `outline704-${engine}-${state}-${device}-${theme}-${phase}`;
        const ids = await h.seed(topic, [
          ['public', { sender: 'aim-core', join: true, addressees: [facts.actor], body: 'Public words keep their normal frame.' }],
          ['alone', { sender: 'person', whisper: true, addressees: ['aim-core'], body: 'Private standalone words.' }],
          ['root', { sender: 'person', whisper: true, addressees: ['aim-core'], body: 'Private dossier question.' }],
          ['reply', { sender: 'aim-core', whisper: true, reply_to: 'root', addressees: [facts.actor], body: 'Private dossier answer.' }],
        ]);
        if (state.includes('folded')) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.reply,
          operation_id: topic + '-fold', args: { folded: true } });
        const p = await h.open(topic, device, topic, ids.alone, '', '/?topic=' + topic,
          pg => pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
        try {
          const mobile = device !== 'laptop', selected = state.endsWith('selected');
          const root = `#messages .reply-stack[data-stack="${ids.root}"]`;
          const dossier = state.startsWith('dossier');
          if (dossier && !state.includes('header')) {
            const toggle = root + ' > .stack-toggle';
            await h.centre(p, toggle);
            if (mobile) await h.tap(p, toggle); else await p.point(toggle);
            await until(() => p.evaluate(`document.querySelector(${q(toggle)}).dataset.state==='open'`), '704 dossier opens');
          }
          const id = dossier ? state.includes('header') ? ids.root : ids.reply : ids.alone;
          const target = state.includes('header') ? card(id) + ' > .stack-head > .stack-who'
            : state.includes('folded') ? card(id) + ' > .message-folded > .folded-author' : h.words(id);
          await h.centre(p, target);
          if (selected) {
            // A folded row unfolds on a phone tap; native keys select the row
            // without changing the fold. Keys also prove focus remains visible.
            if (state.includes('folded')) {
              await p.key('ArrowDown');
              for (let n = 0; n < 12 && !(await h.lit(p)).includes(id); n++) await p.key('ArrowDown');
            } else if (mobile) await h.tap(p, target); else await p.point(target, 'move');
            await until(async () => (await h.lit(p)).includes(id), '704 native selection lights this whisper');
          } else {
            // Moving to a different public card leaves this whisper unselected.
            await p.point(h.words(ids.public), 'move');
            await h.centre(p, target);
          }
          const selector = state.includes('header') ? root : card(id);
          const f = await p.evaluate(frameExpression(selector));
          const header = state.includes('header') ? await p.evaluate(frameExpression(card(id) + ' > .stack-head')) : null;
          await shot(p, `item-704-${state}-${device}-${theme}-${phase}`);
          observations.push({ name: `item 704 ${state}`, phase, device, theme, frame: f, header });
          try {
            if (header) {
              holdsFrame(f, selected, false); holdsFrame(header, selected, false);
              assert.equal(f.outline, 'dashed', '704 frame: folded dossier keeps whisper edge');
              assert.equal(header.outline, 'dashed', '704 frame: nested dossier tab keeps whisper edge');
            } else holdsFrame(f, selected);
            assert.equal((await h.lit(p)).includes(id), selected, 'the fixture exercises the named selection state');
            const ordinary = await p.evaluate(frameExpression(card(ids.public)));
            assert.ok(ordinary.border.every(([style]) => style !== 'dashed'), 'public cards do not become whispers');
            assert.ok(!await p.evaluate('document.querySelector("#reader").open'), 'selection opens no composer');
            assert.deepEqual(p.errors, []);
          } catch (error) { errors.push(`${device} ${theme}: ${error.message}`); }
        } finally { await p.close(); }
      }
      assert.deepEqual(errors, [], '704 frame: ' + errors.join('\n'));
    };
    await run('current');
    const header = state.includes('header'), selected = state.endsWith('selected');
    const old = header ? '/*704-header*/outline:1px dashed var(--whisper-line)' : selected
      ? '/*704-selection*/outline:2px dashed var(--focus)' : '/*704-card*/border-style:dashed';
    await withMutant(phase => run(phase, ['laptop'], ['light']), old, old.replace('dashed', 'solid'));
  });
}

export async function whisperOutlineCompose({ check, control, facts, engine, page, until, press, picture, close }) {
  // The source has no saving/refused/empty branch of its own: those belong to
  // the writing below it. Exercise the source while that writing is empty,
  // quoted, saving and refused, and focus by native Tab rather than .focus().
  for (const state of ['source-rest', 'source-keyboard', 'quoted', 'saving', 'refused']) await check(`item 704 composer ${state}: dotted whisper source and quote at 320 375 390 and laptop, light and dark`, async () => {
    const run = async (phase, shapes = ['stacked', 'phone-320', 'phone-375', 'phone-390'], schemes = themes) => {
      const errors = [];
      for (const shape of shapes) for (const scheme of schemes) {
        const topic = `outline704-compose-${engine}-${state}-${shape}-${scheme}-${phase}`;
        await control({ method: 'navigation_topics', topics: [{ id: topic, title: 'Private outlines' }] });
        const say = async (suffix, more) => (await control({ method: 'agent_message', operation_id: topic + suffix, topic_id: topic, source: 'topic', ...more })).result.message_id;
        await say('-join', { sender: facts.agent, join: true, body: 'Public source control.' });
        const root = await say('-root', { sender: 'person', whisper: true, addressees: [facts.agent], body: 'Exact private question.' });
        const reply = await say('-reply', { sender: facts.agent, whisper: true, reply_to: root, addressees: [facts.actor], body: 'Exact private answer.' });
        const p = await page(shape, scheme, `/?topic=${topic}&message=${reply}`);
        let releaseSave, saveHeld;
        const interceptedSave = new Promise(resolve => { saveHeld = resolve; });
        try {
          await until(p, () => document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('Exact private answer.'), '704 private source drawn');
          if (state === 'source-keyboard') {
            // Shift-Tab from the + reaches the source; tab until its actual
            // focus event, allowing either engine's native stop order.
            await press(p, '#writing-body');
            for (let n = 0; n < 40 && await p.evaluate(() => document.activeElement.id !== 'source-body'); n++)
              await p.keyboard.press(engine === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab');
            assert.equal(await p.evaluate(() => document.activeElement.id), 'source-body', 'native Tab reaches the source');
          } else if (!state.startsWith('source')) {
            // A tap on the passage lights the actual words. Return quotes
            // them on laptop; the Quote pill is a native touch target on phone.
            const passage = '#source-body > span';
            if (p.touch) await press(p, passage); else await p.locator(passage).first().hover();
            await until(p, () => !document.querySelector('#quote-selection').hidden, '704 quote offered for lit passage');
            await press(p, '#quote-selection');
            await until(p, () => document.querySelector('#writing-body').value === '> Exact private answer.\n\n', '704 exact words quoted');
            if (state === 'saving' || state === 'refused') {
              await until(p, () => document.querySelector('#save-state').dataset.save !== 'saving', 'previous quote saved');
              await p.route('**/command', async route => {
                const b = route.request().postDataJSON();
                if (b.kind !== 'draft.save') return route.continue();
                await new Promise(resolve => { releaseSave = resolve; saveHeld(); });
                if (state === 'refused') {
                  b.expected.draft_revision += 99;
                  return route.continue({ postData: JSON.stringify(b) });
                }
                await route.continue();
              });
              await p.keyboard.insertText('Exact continuation.');
              await until(p, () => document.querySelector('#save-state').dataset.save === 'saving', '704 writing saving');
              await interceptedSave;
              if (state === 'refused') {
                releaseSave?.();
                await until(p, () => document.querySelector('#save-state').dataset.save === 'attention', '704 save refused with writing kept');
              }
            }
          }
          const f = await p.evaluate(frameExpression('#source-body'));
          const writing = state.startsWith('source') ? null : await p.evaluate(frameExpression('#writing-body'));
          await picture(p, `item-704-${state}-${phase}`);
          try {
            holdsFrame(f, state === 'source-keyboard');
            if (writing) {
              holdsFrame(writing, true);
              assert.equal(await p.locator('#writing-body').inputValue(), '> Exact private answer.\n\n' + (state === 'quoted' ? '' : 'Exact continuation.'), 'exact quote and continuation survive');
              assert.match(await p.locator('#who-chip').textContent(), /Whisper to/);
            }
            assert.equal(await p.locator('#source-body > span').first().textContent(), 'Exact private answer.', 'source holds only its exact message words');
          } catch (error) { errors.push(`${shape} ${scheme}: ${error.message}`); }
        } finally {
          releaseSave?.();
          await p.unroute('**/command');
          // A refused save is intentionally left unsaved; closing this owned
          // context is safe and the harness resets its isolated drafts.
          if (state === 'refused') { await p.ctx.close(); } else await close(p);
        }
      }
      assert.deepEqual(errors, [], '704 frame: ' + errors.join('\n'));
    };
    await run('current');
    const old = state === 'source-keyboard' ? '/*704-focus*/outline-style:dashed' : '#source-body.whispering{border:1px dashed';
    await withMutant(phase => run(phase, ['stacked'], ['light']), old, old.replace('dashed', 'solid'));
  });
}
