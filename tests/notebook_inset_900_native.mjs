// Real index/CSS, NotebookSheet, NotebookPage and NotebookWriting. Only API
// replies are memory fixtures; no live server, account or records are used.
// Args: Chrome for Testing executable, evidence directory, optional baseline directory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [chrome, out, baseline] = process.argv.slice(2);
assert.ok(chrome?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(out && path.isAbsolute(out));
const { chromium } = await import(process.env.AIM_PLAYWRIGHT_CORE);
const web = fileURLToPath(new URL('../web/', import.meta.url));
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    assert.ok(!name.includes('..'));
    let bytes = await readFile(name === 'aim.css' && process.env.AIM_900_BASELINE_CSS ? process.env.AIM_900_BASELINE_CSS : path.join(web, name));
    if (name === 'index.html') bytes = Buffer.from(bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.mjs') ? 'text/javascript' : 'text/html');
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const marker = `--theseus-fixture-900=${process.pid}`;
const processes = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
const results = [], failures = [], cleanup = { fixturePid: process.pid, port: server.address().port };
let browser, profile;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: [marker] });
  profile = processes().find(line => line.includes(marker))?.match(/--user-data-dir=([^\s]+)/)?.[1];
  assert.ok(profile, 'identify the actual isolated browser profile');
  cleanup.profile = profile;
  for (const width of [320, 390, 1280]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${cleanup.port}/`);
    await page.evaluate(async () => {
      const { NotebookSheet } = await import('/notebook-sheet.mjs');
      const { NotebookPage } = await import('/notebook-page.mjs');
      // A stable confirmed time makes before/after header pixels comparable.
      Date.now = () => 1795200000000;
      const bootstrap = { instance_id: 'fixture-900', actor: 'fixture-person', authority: { authority_id: 'a', authority_epoch: 'e' } };
      const raw = Array.from({ length: 24 }, (_, i) => `## Card ${i + 1}\n\nWords for native edge scrolling and card selection.\n\n`).join('');
      const make = (item, host, header, idSuffix = '', revisionShown = () => {}) => {
        const source = { instance_id: bootstrap.instance_id, source_ref: { kind: 'memory', id: item, revision: 1 },
          owner_scope: { kind: 'workspace', id: 'w-fixture' }, title: 'Notebook edges', body: raw, attachments: [], references: [], reader_may_write: true, starred: false };
        const api = { view: async name => {
          if (name === 'memory_items') return { items: [], relevant_versions: { notebook: 1 } };
          if (!['memory_current', 'memory_status'].includes(name)) throw Error(`Unexpected view ${name}`);
          return structuredClone(source);
        }, command: async () => { throw Error('No write belongs to this visual fixture'); } };
        return new NotebookPage({ host, header, item, idSuffix, revisionShown, mode: 'cards', bootstrap, api,
          read: api.view, place: async () => ({ href: '#', title: 'Fixture' }), askIn: async () => null });
      };
      const sheet = new NotebookSheet({ make, fullHref: id => `/?page=${id}`, openStack: () => {}, goBack: () => {},
        feed: { topicId: 't-fixture', read: async () => ({ items: [], next_cursor: null }), open: async () => {} } });
      if (!await sheet.open('p-fixture', { mode: 'cards' })) throw Error('Real Notebook page did not load: ' + sheet.current.status.textContent + '; ' + sheet.current.writing?.error);
      window.fixture900 = { sheet, make };
    });
    for (const mode of ['cards', 'text']) {
      const name = `${width}-${colorScheme}-${mode}`;
      try {
        await page.evaluate(mode => { const p = fixture900.sheet.current; p.switchView(mode); p.host.scrollTop = 0; p.text.scrollTop = 0; document.activeElement?.blur(); }, mode);
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
        await page.mouse.move(0, 0);
        const metric = await page.evaluate(() => {
          const s = fixture900.sheet, p = s.current, rect = n => {
            const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const d = getComputedStyle(s.dialog), a = getComputedStyle(s.body, '::after');
          return { docked: s.docked, dialog: rect(s.dialog), header: rect(s.head), page: rect(p.host),
            card: rect(p.list.querySelector('.deck-card')), text: rect(p.text), controls: [...s.head.querySelectorAll('button')].map(rect),
            dialogShadow: d.boxShadow, overlay: { content: a.content, shadow: a.boxShadow, pointerEvents: a.pointerEvents, position: a.position, inset: a.inset },
            bodyBackground: getComputedStyle(s.body).backgroundColor, sharedInset: d.getPropertyValue('--stack-cover-inset').trim() };
        });
        assert.equal(metric.docked, width >= 1280);
        const dialog = page.locator('#notebook-sheet-dialog');
        const painted = await dialog.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
        const off = await page.addStyleTag({ content: 'dialog.notebook-sheet-dialog[open],.notebook-sheet-pages::after{box-shadow:none!important}' });
        const bare = await dialog.screenshot({ animations: 'disabled', caret: 'hide' });
        await off.evaluate(n => n.remove());
        // Decode browser screenshots in the browser itself; measure actual paint,
        // not just the presence of a matching CSS rule or computed shadow.
        const compare = async (left, right) => page.evaluate(async ({ left, right, headerHeight }) => {
          const decode = async text => {
            const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(text), c => c.charCodeAt(0))], { type: 'image/png' }));
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
            return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
          };
          const a = await decode(left), b = await decode(right);
          if (a.width !== b.width || a.height !== b.height) throw Error('Screenshot geometry changed');
          const changed = (x0, y0, x1, y1) => {
            let count = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const i = (y * a.width + x) * 4;
              if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2]) count++;
            }
            return count;
          };
          return { left: changed(1, headerHeight + 10, 5, a.height - 12), right: changed(a.width - 5, headerHeight + 10, a.width - 1, a.height - 12),
            bottom: changed(12, a.height - 5, a.width - 12, a.height - 1), header: changed(0, 0, a.width, headerHeight),
            center: changed(8, headerHeight + 10, a.width - 8, a.height - 8) };
        }, { left: left.toString('base64'), right: right.toString('base64'), headerHeight: Math.floor(metric.header.height) });
        metric.paintDelta = await compare(painted, bare);
        if (baseline) {
          const prior = JSON.parse(await readFile(path.join(baseline, `${name}.json`), 'utf8'));
          metric.baselineDelta = await compare(painted, await readFile(path.join(baseline, `${name}.png`)));
          await writeFile(path.join(out, `${name}.json`), JSON.stringify(metric, null, 2));
          for (const key of ['dialog', 'header', 'page', 'card', 'text', 'controls']) assert.deepEqual(metric[key], prior[key], `${key} geometry unchanged`);
          assert.equal(metric.baselineDelta.header, 0, 'header pixels unchanged');
          assert.equal(metric.baselineDelta.center, 0, 'content pixels unchanged');
        }
        await writeFile(path.join(out, `${name}.json`), JSON.stringify(metric, null, 2));
        results.push({ name, metric });
        for (const edge of ['left', 'right', 'bottom']) if (metric.paintDelta[edge] < 10) failures.push(`${name}: inset does not paint ${edge}`);
        if (mode === 'cards') {
          const card = page.locator('.notebook-sheet-page .deck-card').nth(1), box = await card.boundingBox();
          await page.mouse.click(box.x + 2, box.y + box.height / 2);
          assert.equal(await card.getAttribute('aria-current'), 'true', 'native edge click selects card');
          const r = metric.page;
          for (const x of [r.x + 2, r.x + r.width - 2]) {
            await page.evaluate(() => fixture900.sheet.current.host.scrollTop = 0);
            await page.mouse.move(x, r.y + r.height / 2); await page.mouse.wheel(0, 300);
            await page.waitForFunction(() => fixture900.sheet.current.host.scrollTop > 0);
          }
        } else {
          const r = metric.text;
          await page.mouse.click(r.x + 2, r.y + 30);
          assert.equal(await page.locator('.notebook-text').evaluate(n => n === document.activeElement), true, 'Text edge accepts focus');
          await page.mouse.wheel(0, 300);
          await page.waitForFunction(() => fixture900.sheet.current.text.scrollTop > 0);
        }
      } catch (error) { failures.push(`${name}: ${error.stack}`); }
    }
    await page.evaluate(async () => {
      const { sheet, make } = fixture900; sheet.close();
      const host = document.querySelector('#deck-page'); host.hidden = false;
      const header = { title: document.createElement('h1'), eyebrow: document.createElement('span'), description: document.createElement('span') };
      const full = make('p-full-fixture', host, header); await full.load();
      const style = getComputedStyle(host);
      if (host.closest('dialog') || style.boxShadow !== 'none' || style.borderTopWidth !== '0px') throw Error('Full page frame assumption changed');
      full.close(); sheet.retire();
    });
    assert.deepEqual(errors, [], 'no native page errors');
    await context.close();
  }
} finally {
  if (browser) { await browser.close(); cleanup.browserDisconnected = !browser.isConnected(); }
  cleanup.remainingOwnedProcesses = profile ? processes().filter(line => line.includes(profile) || line.includes(marker)) : [];
  await new Promise(resolve => server.close(resolve)); cleanup.serverClosed = !server.listening;
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, failures, cleanup }, null, 2));
}
assert.equal(cleanup.remainingOwnedProcesses.length, 0, 'owned browser profile has no surviving process');
assert.deepEqual(failures, []);
console.log(`900: ${results.length} native Cards/Text theme/width cases passed; header and layout preserved; browser and fixture server closed.`);
