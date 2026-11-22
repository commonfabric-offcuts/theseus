// Actual Notebook sheet and native caret paint; no mirror/fake-DOM geometry.
// This producer is prepared before product edits and is not itself a repro.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { fixtureControl } from './fixture_control.mjs';
import { pngPixels } from './png-bands.mjs';
import { classifyCaretPaint, assessCaretScroll } from './caret_paint_1074.mjs';
import { parseDeck, cardText } from '../web/deck.mjs';

const engines = await import(process.env.AIM_PLAYWRIGHT_CORE), engine = process.env.AIM_ENGINE ?? 'chromium';
const evidence = process.argv[2], selected = new RegExp(process.argv[3] ?? ''), steps = Number(process.env.AIM_CARET_STEPS ?? 34);
assert.ok(Number.isInteger(steps) && steps > 0 && steps <= 60);
await mkdir(evidence, { recursive: true });
const files = ['web/deck-page.mjs', 'web/notebook-page.mjs', 'web/notebook-caret.mjs', 'web/notebook-sheet.mjs', 'web/reveal.mjs',
  'web/writing-input.mjs', 'web/deck.mjs', 'web/aim.css', 'web/app.mjs', 'tests/fixtures/ui_http.py',
  'tests/fixture_control.mjs', 'tests/png-bands.mjs', 'tests/caret_paint_1074.mjs', 'tests/notebook_caret_reveal_1074_native.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), hashes = {};
for (const file of files) {
  const bytes = await readFile(file); hashes[file] = sha(bytes); const out = `${evidence}/source/${file}`;
  await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, bytes);
}
await writeFile(`${evidence}/start.json`, JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2));
const fixture = spawn('/usr/bin/python3', ['-B', 'tests/fixtures/ui_http.py', '--freshness']);
const { control, exit, errors } = fixtureControl(fixture), owned = new Set([fixture.pid]), results = [], cleanup = {};
let origin, browser, profile, watcher, failure, version;
const processes = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +pid, ppid: +ppid, command };
});
function retain() {
  const rows = processes(); for (let changed = true; changed;) {
    changed = false; for (const p of rows) if ((owned.has(p.ppid) || profile && p.command.includes(profile)) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  }
  writeFileSync(`${evidence}/owned.json`, JSON.stringify({ profile, fixturePid: fixture.pid, ownedPids: [...owned] }));
}
// The only paint change is the native caret's colour. Coordinates below come
// from its actual screenshot pixels, not a textarea mirror or line arithmetic.
function caretPaint(bytes, clip, lineHeight) {
  const png = pngPixels(bytes), points = [];
  assert.equal(png.width, clip.width); assert.equal(png.height, clip.height);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const [r, g, b] = png.pixel(x, y); if (r >= 220 && g <= 60 && b >= 220) points.push([x, y]);
  }
  if (!points.length) return classifyCaretPaint(null, clip, lineHeight);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const box = { left: clip.x + Math.min(...xs), right: clip.x + Math.max(...xs) + 1,
    top: clip.y + Math.min(...ys), bottom: clip.y + Math.max(...ys) + 1 };
  return classifyCaretPaint(box, clip, lineHeight);
}
try {
  const facts = await control({ method: 'ready' }); origin = facts.origin;
  await writeFile(`${evidence}/fixture.json`, JSON.stringify({ origin, fixturePid: fixture.pid }));
  profile = await mkdtemp(`${evidence}/${engine}-profile-`);
  const persistent = await engines[engine].launchPersistentContext(profile, { headless: true,
    ...(engine === 'chromium' ? { executablePath: process.env.AIM_CHROME } : {}) });
  browser = persistent.browser(); version = browser.version(); retain(); watcher = setInterval(retain, 250);
  for (const width of [1280, 390]) {
    const key = `sheet-${width}`; if (!selected.test(key)) continue;
    const row = { key, width, errors: [], responses: [], served: {}, samples: [], checks: [] }, jobs = [];
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
    await context.addInitScript(() => {
      localStorage.setItem('theseus-look', 'bookends'); window.caret1074Events = []; window.caret1074Writes = []; window.caret1074Projection = [];
      const rangeRect = Range.prototype.getBoundingClientRect;
      Range.prototype.getBoundingClientRect = function (...args) {
        const rect = rangeRect.apply(this, args), marker = this.startContainer.parentElement;
        if (marker?.parentElement?.style.left === '-10000px') {
          const field = document.querySelector('.notebook-sheet-page .deck-editor');
          const first = marker.getClientRects()[0];
          window.caret1074Projection.push({ selection: field && [field.selectionStart,field.selectionEnd],
            range: rect.toJSON(), span: first?.toJSON(), parent: marker.parentElement.getBoundingClientRect().toJSON() });
        }
        return rect;
      };
      const inlineRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function (...args) {
        const rects = inlineRects.apply(this, args);
        if (this.parentElement?.style.left === '-10000px') {
          const field = document.querySelector('.notebook-sheet-page .deck-editor'), style = getComputedStyle(field);
          const canvas=document.createElement('canvas'), metric=canvas.getContext('2d');
          metric.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const measured=metric.measureText('Mg');
          window.caret1074Projection.push({ selection: [field.selectionStart,field.selectionEnd],
            span: rects[0]?.toJSON(), parent: this.parentElement.getBoundingClientRect().toJSON(),
            field: field.getBoundingClientRect().toJSON(), pageTop: field.closest('.notebook-sheet-page').scrollTop,
            style: { font: style.font, fontFamily:style.fontFamily, fontSize:style.fontSize, lineHeight:style.lineHeight, paddingTop:style.paddingTop },
            metrics:{ascent:measured.fontBoundingBoxAscent,descent:measured.fontBoundingBoxDescent,emAscent:measured.emHeightAscent,emDescent:measured.emHeightDescent} });
        }
        return rects;
      };
      const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      if (scroll?.set) Object.defineProperty(Element.prototype, 'scrollTop', { ...scroll, set(value) {
        const before = scroll.get.call(this); scroll.set.call(this, value);
        if (this.classList?.contains('notebook-sheet-page')) window.caret1074Writes.push({ before, value, after: scroll.get.call(this),
          diagnostic: Boolean(window.caret1074Diagnostic), stack: new Error('scrollTop writer').stack });
      } });
      for (const type of ['keydown', 'beforeinput', 'input', 'scroll']) document.addEventListener(type, event => {
        const field = document.querySelector('.notebook-sheet-page .deck-editor'); if (!field) return;
        const host = field.closest('.notebook-sheet-page');
        const capture = stage => ({ type, stage, key: event.key, inputType: event.inputType, trusted: event.isTrusted,
          text: field.value, selection: [field.selectionStart, field.selectionEnd], pageTop: host.scrollTop,
          fieldTop: field.scrollTop, documentTop: document.scrollingElement.scrollTop, windowY: scrollY });
        window.caret1074Events.push({ ...capture('event'), diagnostic: Boolean(window.caret1074Diagnostic) });
        if (type === 'input') requestAnimationFrame(() => window.caret1074Events.push(capture('frame')));
      }, true);
    });
    const page = await context.newPage(); page.setDefaultTimeout(9000); page.on('pageerror', e => row.errors.push(e.stack));
    const pending = new Set(); let requests = 0;
    page.on('request', r => { if (['/api/view', '/api/command', '/api/bootstrap'].includes(new URL(r.url()).pathname)) { pending.add(r); requests++; } });
    const done = r => pending.delete(r); page.on('requestfinished', done); page.on('requestfailed', done);
    page.on('response', response => {
      const file = 'web/' + new URL(response.url()).pathname.split('/').at(-1);
      if (Object.hasOwn(hashes, file)) {
        const job = response.body().then(async bytes => { row.served[file] = sha(bytes); const out = `${evidence}/served-${key}/${file}`; await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true }); await writeFile(out, bytes); });
        job.catch(() => {}); jobs.push(job);
      }
      let args; try { args = response.request().postDataJSON(); } catch {}
      if (args?.kind === 'memory.revise') {
        const entry = { args: args.args }; row.responses.push(entry);
        const job = response.json().then(receipt => { entry.receipt = receipt; }); job.catch(() => {}); jobs.push(job);
      }
    });
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const drain = async () => {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-rails-reading'));
      for (let i = 0; i < 180; i++) { const at = requests; await frames(); if (!pending.size && requests === at) return; }
      throw Error('API readers did not settle');
    };
    try {
      const item = `caret1074-${engine}-${width}`, body = '## Heading\n\n' + Array.from({ length: 38 }, (_, i) => `line${String(i + 1).padStart(2, '0')} stable words.`).join('\n') + '\n\n## Neighbor\n\nKeep this neighbor.\n';
      await control({ method: 'agent_page', operation_id: `create-${item}`, item_id: item, topic_id: 't1', title: `Caret1074 ${width}`, body });
      await page.goto(origin + '/?topic=t1&page=' + item); await page.locator('body[data-ready=true]').waitFor(); await drain();
      const host = page.locator('#notebook-sheet-dialog[open] .notebook-sheet-page');
      row.readingFold = await host.locator('.deck-card[data-index="0"]').evaluate(el => {
        const r = el.getBoundingClientRect(), words = el.querySelector('.deck-words'); return { top: r.top, bottom: r.bottom, height: r.height, lineClamp: getComputedStyle(words).webkitLineClamp };
      });
      await host.locator('.deck-card[data-index="0"] .deck-title').click(); const field = host.locator('.deck-editor'); await field.waitFor();
      row.caretColour = await field.evaluate(el => { const before = getComputedStyle(el).caretColor; el.style.caretColor = 'rgb(255,0,255)'; const at = el.value.indexOf('line04') + 'line04 stable words.'.length; el.setSelectionRange(at, at); el.closest('.notebook-sheet-page').scrollTop = 0; return { before, probe: getComputedStyle(el).caretColor, setupSelection: at }; });
      row.nativeSelection = await field.evaluate(() => {
        const selection = getSelection(), range = selection.rangeCount ? selection.getRangeAt(0) : null;
        return { count: selection.rangeCount, anchor: selection.anchorNode?.nodeName, focus: selection.focusNode?.nodeName,
          start: range?.startContainer.nodeName, offset: range?.startOffset, rect: range?.getBoundingClientRect().toJSON(), rects: range && Array.from(range.getClientRects(), r => r.toJSON()) };
      });
      const geometryOf = () => field.evaluate(el => {
          const host = el.closest('.notebook-sheet-page'), rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          const area = rect(host), field = rect(el), ancestors = [];
          let top = Math.max(area.top + host.clientTop, 0), bottom = Math.min(area.top + host.clientTop + host.clientHeight, innerHeight);
          for (let at = host.parentElement; at; at = at.parentElement) {
            const style = getComputedStyle(at), box = rect(at); ancestors.push({ tag: at.tagName, id: at.id, classes: at.className, scrollTop: at.scrollTop, rect: box, overflowY: style.overflowY });
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top + at.clientTop); bottom = Math.min(bottom, box.top + at.clientTop + at.clientHeight); }
          }
          return { text: el.value, selection: [el.selectionStart, el.selectionEnd], focused: document.activeElement === el,
            pageTop: host.scrollTop, fieldTop: el.scrollTop, documentTop: document.scrollingElement.scrollTop, windowY: scrollY,
            page: area, field, exposed: { top, bottom }, lineHeight: parseFloat(getComputedStyle(el).lineHeight), ancestors, viewport: { width: innerWidth, height: innerHeight } };
        });
      const capturePaint = async (label, geometry) => {
        // Keep the native caret at column zero: ceil(field.left) can crop a
        // one-pixel caret completely when the field starts on a fraction.
        const left = Math.max(0, Math.floor(geometry.field.left) - 2), right = Math.min(width, Math.ceil(geometry.field.right) + 2);
        const top = Math.max(0, Math.ceil(geometry.exposed.top), Math.ceil(geometry.field.top));
        const bottom = Math.min(900, Math.floor(geometry.exposed.bottom), Math.floor(geometry.field.bottom));
        const clip = { x: left, y: top, width: right - left, height: bottom - top }; assert.ok(clip.width > 0 && clip.height > 0);
        const bytes = await page.screenshot({ clip, caret: 'initial' }); await writeFile(`${evidence}/${key}-${label}.png`, bytes);
        return { label, ...geometry, clip, paint: caretPaint(bytes, clip, geometry.lineHeight) };
      };
      const sample = async label => {
        await frames();
        const geometry = await geometryOf(), result = await capturePaint(label, geometry);
        if (result.paint.status !== 'measured') {
          // An edge fragment supplies no full extent. Independently expose the
          // same native caret by scrolling ONLY the page, measure its full paint,
          // map that actual rectangle back, and restore the exact original state.
          // These diagnostic scrolls are tagged and never counted as product acts.
          result.probes = [];
          await page.evaluate(() => { window.caret1074Diagnostic = true; });
          try {
            for (const direction of [1, -1]) {
              await host.evaluate((el, top) => { el.scrollTop = top; }, geometry.pageTop + direction * (geometry.exposed.bottom - geometry.exposed.top) * .4);
              await frames();
              const shifted = await geometryOf(), probe = await capturePaint(`${label}-extent-${direction}`, shifted);
              result.probes.push(probe);
              if (probe.paint.status !== 'measured') continue;
              assert.equal(shifted.text, geometry.text); assert.deepEqual(shifted.selection, geometry.selection);
              assert.equal(shifted.fieldTop, geometry.fieldTop); assert.equal(shifted.focused, geometry.focused);
              assert.equal(shifted.documentTop, geometry.documentTop); assert.equal(shifted.windowY, geometry.windowY);
              assert.equal(shifted.field.width, geometry.field.width); assert.equal(shifted.field.height, geometry.field.height);
              assert.deepEqual(shifted.exposed, geometry.exposed);
              const delta = shifted.pageTop - geometry.pageTop;
              assert.ok(Math.abs(shifted.field.top - geometry.field.top + delta) < .1);
              result.paint = { status: 'measured', caret: { ...probe.paint.caret,
                top: probe.paint.caret.top + delta, bottom: probe.paint.caret.bottom + delta },
                extentSource: probe.label, diagnosticPageDelta: delta, original: result.paint };
              break;
            }
          } finally {
            await host.evaluate((el, top) => { el.scrollTop = top; }, geometry.pageTop); await frames();
            result.afterExtent = await geometryOf();
            assert.deepEqual(result.afterExtent, geometry, 'Diagnostic native extent measurement must restore the exact measured state');
            await page.evaluate(() => { window.caret1074Diagnostic = false; });
          }
        }
        row.samples.push(result); return result;
      };
      let prior = await sample('initial');
      assert.equal(prior.paint.status, 'measured', 'Instrumentation uncertainty: initial full native caret extent unresolved; no product red');
      let expected = prior.text, expectedAt = prior.selection[0];
      for (let i = 0; i < steps; i++) {
        const inserted = `\nprobe${String(i + 1).padStart(2, '0')}`;
        expected = expected.slice(0, expectedAt) + inserted + expected.slice(expectedAt); expectedAt += inserted.length;
        await page.keyboard.press('Enter'); await page.keyboard.insertText(inserted.slice(1));
        const after = await sample(`typed-${String(i + 1).padStart(2, '0')}`), measured = assessCaretScroll(prior, after);
        assert.equal(measured.status, 'measured', 'Instrumentation uncertainty: full native caret extent unresolved; fragment is not a product red or green');
        row.checks.push({ name: `typing${i + 1} least page scroll`, passed: measured.leastPassed, measurement: measured });
        row.checks.push({ name: `typing${i + 1} keeps caret visible`, passed: measured.visiblePassed });
        row.checks.push({ name: `typing${i + 1} keeps focus and other scroll owners`, passed: after.focused && after.fieldTop === prior.fieldTop && after.documentTop === prior.documentTop && after.windowY === prior.windowY });
        row.checks.push({ name: `typing${i + 1} exact text and selection`, passed: after.text === expected && after.selection[0] === expectedAt && after.selection[1] === expectedAt });
        prior = after;
      }
      if (steps >= 20) {
        const at = prior.text.indexOf('probe20');
        await field.evaluate((el, at) => el.setSelectionRange(at, at), at);
        const anchor = await sample('top-anchor'); assert.equal(anchor.paint.status, 'measured');
        await host.evaluate((el, top) => { el.scrollTop = top; }, anchor.pageTop + anchor.paint.caret.top - anchor.exposed.top - 5);
        const before = await sample('before-top-delete'); assert.equal(before.paint.status, 'measured');
        await page.keyboard.press('Backspace'); const after = await sample('after-top-delete'), measured = assessCaretScroll(before, after);
        assert.equal(measured.status, 'measured');
        row.checks.push({name:'top deletion least page scroll',passed:measured.leastPassed,measurement:measured});
        row.checks.push({name:'top deletion full caret visible',passed:measured.visiblePassed});
        expected = before.text.slice(0,at-1)+before.text.slice(at);
        row.checks.push({name:'top deletion exact text/selection/focus',passed:after.text===expected&&after.selection[0]===at-1&&after.selection[1]===at-1&&after.focused});
        prior = after;
      }
      await page.waitForFunction(() => document.querySelector('.notebook-sheet .notebook-save-dot')?.dataset.save === 'saved'); await drain();
      row.finalCore = await control({ method: 'agent_view', actor: facts.actor, name: 'memory_current', args: { item_id: item } });
      assert.equal(cardText(parseDeck(row.finalCore.body).cards[0]), prior.text.trimEnd()); assert.equal(cardText(parseDeck(row.finalCore.body).cards[1]), 'Neighbor\nKeep this neighbor.');
      row.events = await page.evaluate(() => window.caret1074Events); row.writes = await page.evaluate(() => window.caret1074Writes); row.projection = await page.evaluate(() => window.caret1074Projection); await page.screenshot({ path: `${evidence}/${key}-viewport.png`, caret: 'initial' });
      row.checks.push({name:'native input events are trusted',passed:row.events.filter(e=>e.type==='input'&&e.stage==='event').length>=steps*2&&row.events.filter(e=>e.type==='input'&&e.stage==='event').every(e=>e.trusted)});
      await page.keyboard.press('Escape'); await field.waitFor({state:'detached'}); await drain();
      await page.reload(); await page.locator('body[data-ready=true]').waitFor(); await drain();
      row.reloadedCore = await control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:item}});
      row.checks.push({name:'finished/reloaded Core and neighbor unchanged',passed:cardText(parseDeck(row.reloadedCore.body).cards[0])===prior.text.trimEnd()&&cardText(parseDeck(row.reloadedCore.body).cards[1])==='Neighbor\nKeep this neighbor.'});
      await page.goto(origin+'/?topic=t1&page='+item);await page.locator('body[data-ready=true]').waitFor();await drain();
      await host.locator('.deck-card[data-index="0"] .deck-title').click(); await field.waitFor();
      await field.evaluate(el=>{el.dataset.caret1074='same-opening';el.style.caretColor='rgb(255,0,255)';el.setSelectionRange(8,8);el.closest('.notebook-sheet-page').scrollTop=0;});await frames();
      const fresh = await field.evaluate(el=>({text:el.value,selection:[el.selectionStart,el.selectionEnd]}));
      const wrap = ' a wrapping fragment with several words '.repeat(4);
      const beforeWrap=await sample('before-wrap');assert.equal(beforeWrap.paint.status,'measured');
      await page.keyboard.insertText(wrap);await frames();const written=await field.inputValue();
      const afterWrap=await sample('after-wrap'),wrappedMeasurement=assessCaretScroll(beforeWrap,afterWrap);assert.equal(wrappedMeasurement.status,'measured');
      row.checks.push({name:'wrapped text minimum/visibility',passed:wrappedMeasurement.leastPassed&&wrappedMeasurement.visiblePassed,measurement:wrappedMeasurement});
      row.checks.push({name:'wrapped insertion preserves exact body',passed:written===fresh.text.slice(0,8)+wrap+fresh.text.slice(8)});
      await page.keyboard.press('Meta+z');await frames();
      row.checks.push({name:'fresh native Undo preserves pre-edit body',passed:await field.inputValue()===fresh.text});
      await page.keyboard.press('Meta+Shift+z');await frames();
      row.checks.push({name:'fresh native Redo keeps body and same field/focus',passed:await field.inputValue()===written&&await field.evaluate(el=>el.dataset.caret1074==='same-opening'&&el.isConnected&&document.activeElement===el)});
      await page.waitForFunction(()=>document.querySelector('.notebook-sheet .notebook-save-dot')?.dataset.save==='saved');await drain();
      row.undoRedoCore=await control({method:'agent_view',actor:facts.actor,name:'memory_current',args:{item_id:item}});
      row.checks.push({name:'wrapped Redo saved to Core',passed:cardText(parseDeck(row.undoRedoCore.body).cards[0])===written.trimEnd()});
      assert.deepEqual(row.errors, []); row.passed = row.checks.every(c => c.passed);
    } catch (e) { row.driverError = e.stack; row.events = await page.evaluate(() => window.caret1074Events).catch(() => []); await page.screenshot({ path: `${evidence}/${key}-driver-error.png`, caret: 'initial' }); }
    await drain().catch(e => { row.drainError = e.stack; }); await Promise.all(jobs); results.push(row);
    await writeFile(`${evidence}/observations.json`, JSON.stringify(results, null, 2)); retain(); await context.close();
    console.log(JSON.stringify({ engine, key, passed: row.passed, checks: row.checks, driverError: row.driverError }));
  }
} catch (e) { failure = e.stack; }
finally {
  clearInterval(watcher); if (browser) { retain(); await browser.close(); } cleanup.disconnected = browser ? !browser.isConnected() : true;
  fixture.stdin.end(); cleanup.fixtureExit = await exit; cleanup.fixtureErrors = errors();
  const ps = processes(); cleanup.ownedPids = [...owned]; cleanup.remainingOwned = ps.filter(p => owned.has(p.pid)); cleanup.profileProcesses = profile ? ps.filter(p => p.command.includes(profile)) : [];
  if (profile && cleanup.disconnected && !cleanup.remainingOwned.length && !cleanup.profileProcesses.length) await rm(profile, { recursive: true });
  cleanup.profileAbsent = profile ? await access(profile).then(() => false, () => true) : null;
  cleanup.tcp = origin ? await new Promise(resolve => { const u = new URL(origin), socket = net.createConnection({ host: u.hostname, port: +u.port }); socket.once('connect', () => { socket.destroy(); resolve({ refused: false }); }); socket.once('error', e => resolve({ refused: e.code === 'ECONNREFUSED', code: e.code })); }) : null;
  const end = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(file))]))); cleanup.inputsUnchanged = JSON.stringify(hashes) === JSON.stringify(end);
  await writeFile(`${evidence}/end.json`, JSON.stringify({ hashes: end, unchanged: cleanup.inputsUnchanged }, null, 2));
  await writeFile(`${evidence}/results.json`, JSON.stringify({ engine, version, results, cleanup, failure }, null, 2));
}
assert.equal(cleanup.disconnected, true); assert.equal(cleanup.fixtureExit.code, 0); assert.equal(cleanup.fixtureErrors, ''); assert.deepEqual(cleanup.remainingOwned, []); assert.deepEqual(cleanup.profileProcesses, []); assert.equal(cleanup.profileAbsent, true); assert.equal(cleanup.tcp?.refused, true); assert.equal(cleanup.inputsUnchanged, true);
assert.equal(failure, undefined); assert.ok(results.length && results.every(r => r.passed && !r.driverError && !r.drainError && !r.errors.length), 'Inspect retained geometry/paint/driver failures; no reproduction inferred from a producer failure');
