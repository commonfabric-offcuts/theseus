import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MessageMenu } from '../web/message-menu.mjs';
import { Reactions, learnReactions, paintReaderThumb } from '../web/reactions.mjs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';

const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
const rules = text => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, head, body]) => ({
  selectors: head.trim().split(',').map(s => s.trim()), body,
  declarations: Object.fromEntries(body.split(';').filter(part => part.includes(':')).map(part => {
    const colon = part.indexOf(':'); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  })) }));
const applied = ['.message-bar button[aria-pressed=true]', '#thumb-source[aria-pressed=true]'];
const emboss = rules(css).filter(rule => rule.declarations['box-shadow'] === 'var(--stack-cover-inset)' && rule.selectors.some(s => applied.includes(s)));
// Only the named882 rule is evaluated here. Existing unrelated CSS keeps its
// source owners; the contract separately rejects hover in that rule.
function embosses(node, hover = false) {
  return emboss.some(rule => rule.selectors.some(selector => {
    if (selector.includes(':hover') && !hover) return false;
    const plain = selector.replaceAll(':hover', '');
    if (plain.startsWith('.message-bar ')) return Boolean(node.closest('.message-bar')) && matches(node, plain.slice('.message-bar '.length));
    return matches(node, plain);
  }));
}
const reaction = (thumbs = [], answers = [], version = 1) => ({ version, thumbs, answers, thumb_revision: version, answer_revision: version });
function fixture() {
  const doc = miniDocument(); doc.body = doc.createElement('body'); doc.body.root = true;
  const card = doc.createElement('article'); card.dataset.id = 'm'; doc.body.append(card);
  const source = { id: 'm', author_id: 'writer', go_ahead: true, addressees: ['owner'], reactions: reaction() };
  const messages = new Map([['m', source]]), menu = { doc, viewer: 'owner', kind: 'human', lit: card,
    item: id => messages.get(id), barless: () => false, clipped: () => false, foldState: () => null, behind: new Set(), place() {} };
  menu.bar = MessageMenu.prototype.buildBar.call(menu);
  const reader = doc.createElement('button'); reader.id = 'thumb-source'; doc.body.append(reader);
  const paint = busy => { MessageMenu.prototype.paintBar.call(menu); paintReaderThumb(reader, messages.get('m'), 'owner', busy); };
  paint(false);
  return { doc, menu, reader, source, messages, paint };
}

test('882 one pressed-only rule shares the global light/dark inset token for bar and Reader', () => {
  assert.equal(emboss.length, 1, 'one shared inset rule must own both applied surfaces');
  assert.deepEqual(emboss[0].selectors, applied, 'hover is not a recorded act');
  const definitions = rules(tokens).filter(rule => '--stack-cover-inset' in rule.declarations);
  assert.equal(definitions.length, 2);
  assert.ok(definitions.every(rule => rule.selectors.includes(':root')), 'fixed bar outside a dossier inherits the token');
  assert.ok(definitions.every(rule => rule.declarations['--stack-cover-inset'].startsWith('inset ')));
  assert.match(tokens, /@media\(prefers-color-scheme:dark\)\s*\{\s*:root\s*\{[^}]*--stack-cover-inset:/);
  for (const rule of rules(css).filter(rule => rule.selectors.some(s => s.includes('.message-bar button:hover') || s.includes('#thumb-source:hover'))))
    assert.equal(rule.declarations['box-shadow'], undefined, 'hover keeps its fill without an embossed shadow');
});

test('882 actual bar thumb, Go ahead, Don’t and Reader thumb emboss only their recorded pressed state', () => {
  const f = fixture();
  assert.equal(f.menu.bar.parent, f.doc.body, 'the fixed bar lives outside reply-stack');
  for (const control of [f.menu.buttons.thumb, f.menu.buttons.yes, f.menu.buttons.no, f.reader]) {
    assert.equal(control.getAttribute('aria-pressed'), 'false'); assert.equal(embosses(control, true), false);
  }
  f.messages.set('m', { ...f.source, reactions: reaction([{ actor_id: 'owner' }], [{ actor_id: 'owner', answer: 'yes' }], 2) }); f.paint(false);
  assert.equal(embosses(f.menu.buttons.thumb), true); assert.equal(embosses(f.reader), true);
  assert.equal(embosses(f.menu.buttons.yes), true); assert.equal(embosses(f.menu.buttons.no), false);
  f.messages.set('m', { ...f.source, reactions: reaction([], [{ actor_id: 'owner', answer: 'no' }], 3) }); f.paint(false);
  assert.equal(embosses(f.menu.buttons.thumb), false); assert.equal(embosses(f.reader), false);
  assert.equal(embosses(f.menu.buttons.yes), false); assert.equal(embosses(f.menu.buttons.no), true);
});

test('882 pending and refused thumbs keep the prior look; only learned confirmation applies or removes the inset', async () => {
  const f = fixture(); let settle, held = reaction(), version = 1;
  const client = new Reactions({ instanceId: 'fixture882', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }),
    api: { command: () => new Promise(resolve => { settle = resolve; }),
      view: async () => ({ instance_id: 'fixture882', message_id: 'm', go_ahead: true, reactions: held }) },
    learned: value => { learnReactions(f.messages, value); f.paint(client.busy.has('m')); } });
  const visible = () => [embosses(f.menu.buttons.thumb), embosses(f.reader)];
  for (const [on, accepted, before, after] of [[true, false, false, false], [true, true, false, true], [false, false, true, true], [false, true, true, false]]) {
    const sending = client.thumb(f.messages.get('m'), on); f.paint(client.busy.has('m'));
    assert.equal(client.busy.has('m'), true); assert.equal(f.reader.disabled, true);
    assert.deepEqual(visible(), [before, before], 'pending does not invent an applied act');
    if (accepted) held = reaction(on ? [{ actor_id: 'owner' }] : [], [], ++version);
    settle(accepted ? { status: 'committed', recorded: true, result: { message_id: 'm', thumbed: on } }
      : { status: 'rejected', recorded: true, error: { code: 'FORBIDDEN', message: 'Fixture refused' } });
    if (accepted) await sending; else await assert.rejects(sending);
    f.paint(client.busy.has('m'));
    assert.equal(f.reader.disabled, false); assert.deepEqual(visible(), [after, after]);
  }
});
