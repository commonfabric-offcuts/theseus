import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { doc, byClass, walk, RULE } from './text_display_768_fixtures.mjs';
const root = process.env.HOVER_GAPS_SOURCE || fileURLToPath(new URL('..', import.meta.url));
const format = await import(pathToFileURL(path.join(root, 'web/message-format.mjs')));
const { fieldLayers } = await import(pathToFileURL(path.join(root, 'web/lit-field.mjs')));
const host = () => ({ clientLeft: 1, clientTop: 2, scrollLeft: 7, scrollTop: 13,
  getBoundingClientRect: () => ({ left: 20, top: 30 }) });
const draw = (body, rules = [RULE]) => {
  const node = doc.createElement('div'); node.append(...format.formatNodes(body, { doc, displayRules: rules })); return node;
};
const row = (block, top, left = 40, right = 140) => ({ block, top, bottom: top + 16, left, right });
const joins = (nodes, positions = nodes.map((_, i) => 100 + 40 * i)) => fieldLayers(host(), nodes.map((n, i) => row(n, positions[i])), 24);
const covered = (layers, x, y) => layers.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

test('839 actual formatted fragments have continuous paint across their selected gap, with authored copy positions', () => {
  const body = 'First **bold** sentence. Second sentence.';
  const drawn = draw(body), parts = byClass(drawn, 'md-p'); assert.equal(parts.length, 2);
  const layers = joins(parts);
  // Host background coordinates: screen x/y minus border-adjusted, scrolled origin (14,19).
  for (let y = 96; y < 160; y++) assert.ok(covered(layers, 50 - 14, y - 19), `the lit field covers screen row ${y}`);
  const texts = walk(drawn).filter(n => n.nodeType === 3), first = texts[0], last = texts.at(-1);
  const start = format.sourcePosition(first, 0), end = format.sourcePosition(last, last.data.length, true);
  assert.equal(body.slice(start, end), body, 'Copy/Quote retains authored Markdown, including inter-sentence whitespace');
  assert.equal(drawn.textContent, 'First bold sentence. Second sentence.', 'no separator characters added');
  assert.deepEqual(parts.map(n => n.dataset.sentenceParagraph), ['more', 'end']);
});

test('839 only selected adjacent parts join; authored paragraph boundaries and Off retain their old layers', () => {
  const on = byClass(draw('First sentence. Second sentence.\n\nThird sentence. Fourth sentence.'), 'md-p');
  assert.equal(on.length, 4);
  const all = joins(on);
  assert.ok(covered(all, 36, 107), 'first display gap is painted');
  assert.equal(covered(all, 36, 147), false, 'authored paragraph gap remains');
  assert.ok(covered(all, 36, 187), 'second display gap is painted');
  assert.equal(joins([on[0]]).length, 1, 'an unselected next passage receives no paint');
  assert.equal(joins([on[0], on[2]]).length, 2, 'nonadjacent parts cannot bridge over unselected writing');
  const off = byClass(draw('First sentence. Second sentence.\n\nThird sentence.', []), 'md-p');
  assert.ok(off.every(n => n.dataset.sentenceParagraph === undefined));
  assert.deepEqual(joins(off), [{ x:26,y:77,width:100,height:24 }, { x:26,y:117,width:100,height:24 }]);
});

test('839 list fragments join inside one item, never across markers, and an overlapped field needs no bridge', () => {
  const parts = byClass(draw('1) First sentence. Second sentence.\n2) Third sentence. Fourth sentence.'), 'sentence-paragraph');
  assert.equal(parts.length, 4);
  const layers = joins(parts);
  assert.ok(covered(layers, 36, 107)); assert.equal(covered(layers, 36, 147), false); assert.ok(covered(layers, 36, 187));
  assert.equal(joins(parts.slice(0,2), [100,120]).length, 2, 'existing overlapping line fields stay exact');
});

test('839 bridge uses shared horizontal extent and existing scroll coordinates; separate columns stay separate', () => {
  const parts = byClass(draw('First sentence. Second sentence.'), 'md-p');
  const lines = [row(parts[0],100,40,90),row(parts[1],140,60,140)];
  assert.deepEqual(fieldLayers(host(),lines,24).at(-1), {x:46,y:101,width:30,height:16});
  assert.equal(fieldLayers(host(),[lines[0],row(parts[1],140,100,150)],24).length,2,'no horizontal overlap to paint');
  const unrelated = [{dataset:{},nextSibling:null},{dataset:{}}];
  assert.equal(joins(unrelated).length,2,'tables/code/ordinary blocks keep line-by-line paint');
});
