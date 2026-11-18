// Item 704: the existing dashed whisper frame on every drawing, and on its
// selection. These checks are called by the reading families and native-compose
// (which already runs both engines). No browser is launched by this module.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { choiceOf, sending } from '../web/whisper-choice.mjs';


// Owned interceptions retain every continuation and response. Callback errors
// are collected immediately (never an unhandled rejection), then fail cleanup.
export function commandRoutes704(p) {
  const pending = new Set(), failures = [], releases = new Set(), handlers = [];
  let started = 0, finished = 0;
  const drain = async () => { while (pending.size) await Promise.all([...pending]); };
  return {
    hold() {
      let release;
      const wait = new Promise(resolve => { release = resolve; });
      releases.add(release);
      return { wait, release };
    },
    async route(handle) {
      const handler = route => {
        started++;
        const work = (async () => {
          try { await handle(route); } catch (error) { failures.push(error); }
          try {
            const response = await route.request().response();
            if (response) {
              const error = await response.finished();
              assert.equal(error, null, '704 intercepted response finished');
            } else assert.fail('704 intercepted request had no response');
          } catch (error) { failures.push(error); }
          finally { finished++; }
        })();
        pending.add(work);
        return work.finally(() => pending.delete(work));
      };
      await p.route('**/command', handler);
      handlers.push(handler);
    },
    async finish() {
      for (const release of releases) release();
      await drain();
      for (const handler of handlers) await p.unroute('**/command', handler);
      await drain();
      console.log('item 704 routes settled', JSON.stringify({ started, finished, pending: pending.size, failures: failures.length }));
      if (failures.length) throw new AggregateError(failures, '704 interception failed');
      assert.equal(started, finished, 'every intercepted request settled before closing');
    },
  };
}

export function undecidedWhisper704(draft, agent) {
  assert.ok(draft.whisper == null, 'no explicit privacy choice before Send');
  const kindOf = name => name === agent ? 'agent' : 'human';
  assert.equal(choiceOf(draft, draft.addressees, kindOf, { answeringWhisper: true }).choice, 'whisper', 'reply-to-whisper default is private to its one agent');
  assert.deepEqual(sending(draft, draft.addressees, kindOf, { answeringWhisper: true }), { whisper: true, intent: null });
}

export const inputs704 = [
  "tests/ui_whisper_outline.test.mjs",
  "tests/ui_whisper.test.mjs",
  "aim_next/__init__.py",
  "aim_next/addressing.py",
  "aim_next/admin.py",
  "aim_next/assessment_dispatch.py",
  "aim_next/assessments.py",
  "aim_next/authority.py",
  "aim_next/backup.py",
  "aim_next/blocking.py",
  "aim_next/broker_routes.py",
  "aim_next/changes.py",
  "aim_next/check_reading.py",
  "aim_next/checks.py",
  "aim_next/cli.py",
  "aim_next/cli_covers.py",
  "aim_next/cli_outcome.py",
  "aim_next/cli_targets.py",
  "aim_next/cli_tools.py",
  "aim_next/codex_broker.py",
  "aim_next/codex_host.py",
  "aim_next/colors.py",
  "aim_next/contract.py",
  "aim_next/conversation.py",
  "aim_next/cover_values.py",
  "aim_next/covers.py",
  "aim_next/delivery.py",
  "aim_next/drafts.py",
  "aim_next/effects_runner.py",
  "aim_next/effects_watch.py",
  "aim_next/health.py",
  "aim_next/hosted_control.py",
  "aim_next/hosted_notice.py",
  "aim_next/initialization.py",
  "aim_next/invite.py",
  "aim_next/live.py",
  "aim_next/marks.py",
  "aim_next/media.py",
  "aim_next/memory.py",
  "aim_next/message_edit.py",
  "aim_next/migrations.py",
  "aim_next/openings.py",
  "aim_next/outcome_asks.py",
  "aim_next/outcome_end.py",
  "aim_next/outcome_kind.py",
  "aim_next/outcome_light.py",
  "aim_next/outcome_rules.py",
  "aim_next/outline_order.py",
  "aim_next/pipeline.py",
  "aim_next/pipeline_state.py",
  "aim_next/profile.py",
  "aim_next/reactions.py",
  "aim_next/recovery.py",
  "aim_next/recovery_io.py",
  "aim_next/releases.py",
  "aim_next/responsibility.py",
  "aim_next/route_pins.py",
  "aim_next/runner.py",
  "aim_next/serve.py",
  "aim_next/server.py",
  "aim_next/sources.py",
  "aim_next/stacks.py",
  "aim_next/standing_conversation.py",
  "aim_next/store.py",
  "aim_next/supervisor.py",
  "aim_next/tool_records.py",
  "aim_next/tool_words.py",
  "aim_next/tools_core.py",
  "aim_next/topic_reading.py",
  "aim_next/topic_state.py",
  "aim_next/validation.py",
  "aim_next/wake_adapter.py",
  "aim_next/wake_health.py",
  "aim_next/web_build.py",
  "aim_next/whispers.py",
  "aim_next/work.py",
  "tests/agent_colors_native.mjs",
  "tests/card_editor_652.mjs",
  "tests/card_scroll_probe.mjs",
  "tests/compose-reach.mjs",
  "tests/conversation_native.mjs",
  "tests/device_native.mjs",
  "tests/fixture_control.mjs",
  "tests/fixtures/ui_http.py",
  "tests/fold_native.mjs",
  "tests/form_rules_native.mjs",
  "tests/health_native.mjs",
  "tests/links_native.mjs",
  "tests/menu_glyphs.mjs",
  "tests/message_edit_native.mjs",
  "tests/native-calls.mjs",
  "tests/native-page-cleanup.mjs",
  "tests/new_line_native.mjs",
  "tests/notebook_button_geometry.mjs",
  "tests/notebook_card_images_native.mjs",
  "tests/notebook_pages_native.mjs",
  "tests/notebook_sheet_native.mjs",
  "tests/outcome_light_native.mjs",
  "tests/outcome_rail_native.mjs",
  "tests/outline_stars_native.mjs",
  "tests/outline_stars_oracle.mjs",
  "tests/pipeline_native.mjs",
  "tests/png-bands.mjs",
  "tests/press-fell.mjs",
  "tests/reader_asks_native.mjs",
  "tests/reader_colors_native.mjs",
  "tests/reader_compose_native.mjs",
  "tests/reader_departure_native.mjs",
  "tests/reader_freshness_native.mjs",
  "tests/reader_images_native.mjs",
  "tests/reader_inline_native.mjs",
  "tests/reader_live_native.mjs",
  "tests/reader_navigation_native.mjs",
  "tests/reader_persistence_native.mjs",
  "tests/release-rule.mjs",
  "tests/render_native.mjs",
  "tests/set_aside_native.mjs",
  "tests/stack_native.mjs",
  "tests/targets_native.mjs",
  "tests/team_bar_native.mjs",
  "tests/team_invite_native.mjs",
  "tests/thumbnail_open_native.mjs",
  "tests/topic_duties_native.mjs",
  "tests/topic_header_native.mjs",
  "tests/topic_list_native.mjs",
  "tests/topic_reading_native.mjs",
  "tests/topic_sources_native.mjs",
  "tests/topic_work_native.mjs",
  "tests/wakes_native.mjs",
  "tests/webkit_native.mjs",
  "tests/whisper_native.mjs",
  "tests/whisper_outline_native.mjs",
  "tools/ci-input-reads.json",
  "tools/ci_input_reads.py",
  "tools/native.py",
  "tools/release_check.py",
  "tools/unit_shards.py",
  "web/agent-invite.mjs",
  "web/aim.css",
  "web/api.mjs",
  "web/app-session.mjs",
  "web/app.mjs",
  "web/arrow-reach.mjs",
  "web/at-names.mjs",
  "web/attention.mjs",
  "web/author-colors.mjs",
  "web/boot.js",
  "web/card-images.mjs",
  "web/card-reading.mjs",
  "web/card-scroll.mjs",
  "web/characters.mjs",
  "web/charts.mjs",
  "web/cleanup.mjs",
  "web/color-picker.mjs",
  "web/colors.mjs",
  "web/compose-bar.mjs",
  "web/coordination-stacks.mjs",
  "web/creation-view.mjs",
  "web/creation.mjs",
  "web/deck-page.mjs",
  "web/deck.mjs",
  "web/dismiss.mjs",
  "web/dossier-cover.mjs",
  "web/editor.mjs",
  "web/feed-fence-copy.mjs",
  "web/feed-passages.mjs",
  "web/fence-copy.mjs",
  "web/fences.mjs",
  "web/fold.mjs",
  "web/freshness.mjs",
  "web/glyphs.mjs",
  "web/health-light.mjs",
  "web/health.mjs",
  "web/image-pick.mjs",
  "web/image-rows.mjs",
  "web/in-place-navigation.mjs",
  "web/index.html",
  "web/inline-composer.mjs",
  "web/intent-journal.mjs",
  "web/interaction-guide.mjs",
  "web/journal.mjs",
  "web/key-tree.mjs",
  "web/layout.mjs",
  "web/line-move.mjs",
  "web/line-room.mjs",
  "web/lines.mjs",
  "web/links.mjs",
  "web/lit-field.mjs",
  "web/live.mjs",
  "web/marks.mjs",
  "web/message-edit-writing.mjs",
  "web/message-edit.mjs",
  "web/message-format.mjs",
  "web/message-menu.mjs",
  "web/message-preview.mjs",
  "web/notebook-create.mjs",
  "web/notebook-images.mjs",
  "web/notebook-page.mjs",
  "web/notebook-sheet.mjs",
  "web/notebook-writing.mjs",
  "web/opening-store.mjs",
  "web/opening-view.mjs",
  "web/opening.mjs",
  "web/outcome-conversation.mjs",
  "web/outcome-end.mjs",
  "web/outcome-light-words.mjs",
  "web/outcome-light.mjs",
  "web/outcome-purpose.mjs",
  "web/outcome-references.mjs",
  "web/outcome-scope.mjs",
  "web/outcomes.mjs",
  "web/outline-dossiers.mjs",
  "web/outline-order.mjs",
  "web/outline-rail.mjs",
  "web/page-changes.mjs",
  "web/page-here.mjs",
  "web/page-image.mjs",
  "web/page-reads.mjs",
  "web/pane-keys.mjs",
  "web/panes.mjs",
  "web/people.mjs",
  "web/phone-check.mjs",
  "web/pipeline-words.mjs",
  "web/pipeline.mjs",
  "web/press-hold.mjs",
  "web/press-note.mjs",
  "web/quick-create.mjs",
  "web/rail-drawer.mjs",
  "web/rails.css",
  "web/rails.mjs",
  "web/reactions.mjs",
  "web/read-through.mjs",
  "web/reader.mjs",
  "web/repaint.mjs",
  "web/replies.mjs",
  "web/reply-stacks.mjs",
  "web/reveal.mjs",
  "web/session-renewal.mjs",
  "web/session.mjs",
  "web/sheet-holder.mjs",
  "web/skills.mjs",
  "web/stack-feed.mjs",
  "web/stack-look.css",
  "web/stack-order.mjs",
  "web/targets-words.mjs",
  "web/targets.mjs",
  "web/things-rail.mjs",
  "web/times.mjs",
  "web/topic-header.mjs",
  "web/topic-navigation.mjs",
  "web/topic-settings.mjs",
  "web/topic-state.mjs",
  "web/topic-views.mjs",
  "web/unanswered.mjs",
  "web/upload-cleanup.mjs",
  "web/upload-state.mjs",
  "web/uploads.mjs",
  "web/waiting-questions.mjs",
  "web/wake-lights.mjs",
  "web/whisper-choice.mjs",
  "web/writing-helpers.mjs",
  "web/writing-input.mjs"
];
export async function archive704(evidence) {
  const hashes = {};
  for (const filename of inputs704) {
    const bytes = await readFile(new URL('../' + filename, import.meta.url));
    hashes[filename] = digest(bytes);
    const target = path.join(evidence, 'source', filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(path.join(evidence, 'item-704-source-hashes.json'), JSON.stringify(hashes, null, 2));
  return hashes;
}

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
async function withMutant(run, old, replacement, restart) {
  const original = await readFile(cssFile, 'utf8');
  if (!original.includes('/* Item 704: whisper frames */')) return; // the red-before commit
  assert.equal(original.split(old).length, 2, 'the mutation has exactly one source target');
  const changed = original.replace(old, replacement);
  await writeFile(cssFile, changed);
  try {
    assert.equal(await readFile(cssFile, 'utf8'), changed, 'mutation actually applied');
    await restart();
    console.log('item 704 MUTANT applied', digest(original), digest(changed), old);
    await assert.rejects(() => run('mutant-' + digest(changed).slice(0, 8)), /704 frame:/, 'the native frame assertion kills this mutation');
    console.log('item 704 MUTANT killed');
  } finally {
    await writeFile(cssFile, original);
    assert.equal(digest(await readFile(cssFile)), digest(original), 'original source bytes restored');
    await restart();
    console.log('item 704 RESTORED', digest(original));
  }
  await run('restored-' + digest(changed).slice(0, 8));
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
  const restart = async () => {
    await control({ method: 'server_stop' });
    const { origin } = await control({ method: 'server_start' });
    assert.equal(origin, facts.origin, 'fixture restarts on its own origin');
  };
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
        await control({ method: 'private_writing', operation_id: topic + '-other-note', topic_id: topic,
          message_id: ids.reply, sender: 'aim-core', kind: 'note', body: 'Other actor private note sentinel704' });
        if (state.includes('folded')) await control({ method: 'stack_act', sender: facts.actor, kind: 'message.fold', message_id: ids.reply,
          operation_id: topic + '-fold', args: { folded: true } });
        const p = await h.open(topic, device, topic, ids.alone, '', '/?topic=' + topic,
          pg => pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }));
        try {
          assert.equal(digest(await p.evaluate('fetch("/aim.css").then(r=>r.text())')), digest(await readFile(cssFile)), 'page serves the exact source snapshot');
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
            await h.centre(p, h.words(ids.public));
            await p.point(h.words(ids.public), 'move');
            await h.centre(p, target);
          }
          await p.evaluate(`Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
          const selector = state.includes('header') ? root : card(id);
          const f = await p.evaluate(frameExpression(selector));
          const header = state.includes('header') ? await p.evaluate(frameExpression(card(id) + ' > .stack-head')) : null;
          await shot(p, `item-704-${state}-${device}-${theme}-${phase}`);
          const tabShadow = header ? await p.evaluate(`getComputedStyle(document.querySelector(${q(card(id) + ' .stack-name')}),'::before').boxShadow`) : null;
          observations.push({ name: `item 704 ${state}`, phase, device, theme, frame: f, header, tabShadow });
          try {
            if (header) {
              assert.equal(tabShadow, 'none', '704 frame: no nested solid tab rectangle');
              holdsFrame(f, selected, false); holdsFrame(header, selected, false);
              assert.equal(f.outline, 'dashed', '704 frame: folded dossier keeps whisper edge');
              assert.equal(header.outline, 'dashed', '704 frame: nested dossier tab keeps whisper edge');
            } else holdsFrame(f, selected);
            assert.equal((await h.lit(p)).includes(id), selected, 'the fixture exercises the named selection state');
            const ordinary = await p.evaluate(frameExpression(card(ids.public)));
            assert.ok(ordinary.border.every(([style]) => style !== 'dashed'), 'public cards do not become whispers');
            assert.ok(!await p.evaluate('document.querySelector("#reader").open'), 'selection opens no composer');
            assert.ok(!await p.evaluate('document.body.textContent.includes("Other actor private note sentinel704")'), "another actor's note never enters the page");
            assert.deepEqual(p.errors, []);
          } catch (error) { errors.push(`${device} ${theme}: ${error.message}`); }
        } finally { await p.close(); }
      }
      assert.deepEqual(errors, [], '704 frame: ' + errors.join('\n'));
    };
    await run('current');
    const header = state.includes('header'), selected = state.endsWith('selected');
    const old = header ? selected ? '/*704-header-selection*/outline:2px dashed var(--focus)' : '/*704-header*/outline:1px dashed var(--whisper-line)' : selected
      ? '/*704-selection*/outline:2px dashed var(--focus)' : '/*704-card*/border-style:dashed';
    await withMutant(phase => run(phase, ['laptop'], ['light']), old, old.replace('dashed', 'solid'), restart);
    if (state === 'feed-rest') {
      const rim = '/*704-card*/border-style:dashed;border-color:var(--whisper-line);box-shadow:none';
      await withMutant(phase => run(phase, ['laptop'], ['light']), rim, rim.replace('box-shadow:none', 'box-shadow:0 0 0 2px #000'), restart);
    }
    if (state === 'dossier-header-selected') {
      const tab = '/*704-header-selection*/outline:2px dashed var(--focus);outline-offset:0;box-shadow:none;--stack-tab-shadow:none';
      await withMutant(phase => run(phase, ['laptop'], ['light']), tab, tab.replace('--stack-tab-shadow:none', '--stack-tab-shadow:0 0 0 2px var(--stack-ring)'), restart);
    }
  });
}

export async function whisperOutlineCompose({ check, control, facts, engine, page, until, press, picture, close }) {
  const restart = async () => {
    await control({ method: 'server_stop' });
    const { origin } = await control({ method: 'server_start' });
    assert.equal(origin, facts.origin, 'fixture restarts on its own origin');
  };
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
        await control({ method: 'private_writing', operation_id: topic + '-other-note', topic_id: topic,
          message_id: reply, sender: facts.agent, kind: 'note', body: 'Other actor private note sentinel704' });
        const p = await page(shape, scheme, `/?topic=${topic}&message=${reply}`);
        const routes = commandRoutes704(p);
        let saveHeld;
        const interceptedSave = new Promise(resolve => { saveHeld = resolve; });
        try {
          assert.equal(digest(await p.evaluate(() => fetch('/aim.css').then(r=>r.text()))), digest(await readFile(cssFile)), 'page serves the exact source snapshot');
          await until(p, () => document.querySelector('#reader').open && document.querySelector('#source-body').textContent.includes('Exact private answer.'), '704 private source drawn');
          if (state === 'source-keyboard') {
            // Shift-Tab from the + reaches the source; tab until its actual
            // focus event, allowing either engine's native stop order.
            await press(p, '#writing-body');
            for (let n = 0; n < 40 && await p.evaluate(() => document.activeElement.id !== 'source-body'); n++)
              await p.keyboard.press(engine === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab');
            assert.equal(await p.evaluate(() => document.activeElement.id), 'source-body', 'native Tab reaches the source');
          } else if (!state.startsWith('source')) {
            // A native press focuses the source. Select All chooses only
            // its exact words; the Quote pill is tapped on the phone.
            const passage = '#source-body > span';
            await press(p, passage);
            await p.keyboard.press('ControlOrMeta+A');
            await until(p, () => !document.querySelector('#quote-selection').hidden, '704 quote offered for lit passage');
            await press(p, '#quote-selection');
            await until(p, () => document.querySelector('#writing-body').value === '> Exact private answer.\n\n', '704 exact words quoted');
            if (state === 'saving' || state === 'refused') {
              await until(p, () => document.querySelector('#save-state').dataset.save !== 'saving', 'previous quote saved');
              const gate = routes.hold();
              await routes.route(async route => {
                const b = route.request().postDataJSON();
                if (b.kind !== 'draft.save') return route.continue();
                saveHeld();
                await gate.wait;
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
                gate.release();
                await until(p, () => document.querySelector('#save-state').dataset.save === 'attention', '704 save refused with writing kept');
              }
            }
          }
          await p.mouse.move(0, 0);
          await p.evaluate(async () => {
            await Promise.all(document.querySelector('#reader').getAnimations({ subtree: true })
              .filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const f = await p.evaluate(frameExpression('#source-body'));
          const writing = state.startsWith('source') ? null : await p.evaluate(frameExpression('#writing-body'));
          await picture(p, `item-704-${state}-${phase}`);
          try {
            holdsFrame(f, state === 'source-keyboard');
            if (writing) {
              holdsFrame(writing, true);
              assert.equal(await p.locator('#writing-body').inputValue(), '> Exact private answer.\n\n' + (state === 'quoted' ? '' : 'Exact continuation.'), 'exact quote and continuation survive');
              assert.equal(await p.locator('#who-chip').textContent(), `Whisper to ${facts.agent} · only you two`, 'displayed private audience stays exact');
            }
            assert.ok(!await p.evaluate(() => document.body.textContent.includes('Other actor private note sentinel704')), "another actor's note never enters the composer");
            assert.equal(await p.locator('#source-body > span').first().textContent(), 'Exact private answer.', 'source holds only its exact message words');
            if (state === 'quoted') {
              await until(p, () => document.querySelector('#save-state').dataset.save === 'saved', 'exact quote saved in Core');
              const saved = await control({ method: 'agent_view', actor: facts.actor, name: 'editor_state',
                args: { source_ref: { kind: 'message', id: reply }, topic_id: topic } });
              assert.equal(saved.draft.body, '> Exact private answer.\n\n');
              undecidedWhisper704(saved.draft, facts.agent);
              assert.deepEqual(saved.draft.addressees, [facts.agent]);
              assert.deepEqual(saved.draft.quotes, [{ source: { kind: 'message', id: reply, revision: 1 }, excerpt: 'Exact private answer.' }]);
              const frozen = [];
              await routes.route(async route => {
                const body = route.request().postDataJSON();
                if (body.kind === 'draft.save') frozen.push(body.args);
                await route.continue();
              });
              const response = p.waitForResponse(r => r.url().endsWith('/api/command') && r.request().postDataJSON()?.kind === 'message.send');
              // Attach rejection handling before the gesture, even on an exceptional path.
              const sent = response.then(async r => ({ receipt: await r.json() }), error => ({ error }));
              let result;
              try { await press(p, '#send-reply'); } finally { result = await sent; }
              if (result.error) throw result.error;
              assert.equal(result.receipt.status, 'committed', 'the exact default-private reply sends');
              const exact = frozen.find(args => args.body === saved.draft.body);
              assert.ok(exact, 'the effective choice was explicitly saved before freezing');
              assert.equal(exact.whisper, true, 'Send freezes the effective whisper');
              assert.deepEqual(exact.addressees, saved.draft.addressees);
              assert.deepEqual(exact.quotes, saved.draft.quotes);
              const source = await control({ method: 'agent_view', actor: facts.actor, name: 'source',
                args: { source_ref: { kind: 'message', id: result.receipt.result.message_id } } });
              assert.equal(source.whisper, true, 'committed reply stays private');
              assert.equal(source.private_to, facts.agent);
              assert.equal(source.body, saved.draft.body);
              assert.deepEqual(source.quotes, saved.draft.quotes);
            }
            if (state === 'refused') assert.equal(await p.locator('#review-versions').isVisible(), true, 'refused save keeps its recovery control');
          } catch (error) { errors.push(`${shape} ${scheme}: ${error.message}`); }
        } finally {
          try { await routes.finish(); } finally { await close(p); }
        }
      }
      assert.deepEqual(errors, [], '704 frame: ' + errors.join('\n'));
    };
    await run('current');
    const old = state === 'source-keyboard' ? '/*704-focus*/outline-style:dashed' : '#source-body.whispering{border:1px dashed';
    await withMutant(phase => run(phase, ['stacked'], ['light']), old, old.replace('dashed', 'solid'), restart);
  });
}
