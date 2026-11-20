import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { waitingDots } from '../web/outcome-conversation.mjs';
import { waitingEnded, waitingSilence } from '../web/waiting-silence.mjs';
import { MessageMenu } from '../web/message-menu.mjs';

function control(doc, key) {
  const mark = waitingDots(doc, 'Waiting for a reply');
  let menu;
  const button = waitingSilence(mark, key, doc, options => { menu = options; });
  doc.byId('host').append(button);
  return { button, mark, open() {
    let stopped = false;
    button.onclick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, 'the click does not open the card');
    return menu;
  } };
}

test('Silence is one check-marked action that changes only this pulse presentation', () => {
  const doc = miniDocument(), first = control(doc, 'm1');
  assert.equal(first.button.tag, 'button');
  assert.equal(first.button.getAttribute('aria-haspopup'), 'menu');
  const menu = first.open();
  assert.deepEqual(menu.items.map(item => [item.label, item.glyph]), [['Silence', 'kept']]);
  assert.equal(first.mark.classList.contains('is-silent'), false, 'opening the menu does not silence');
  menu.items[0].act();
  assert.equal(first.mark.classList.contains('is-silent'), true);
  assert.equal(first.mark.getAttribute('aria-label'), 'Waiting for a reply');
  assert.equal(first.mark.children.length, 3);
  assert.equal(control(doc, 'm2').mark.classList.contains('is-silent'), false, 'a different request still pulses');
  assert.equal(control(miniDocument(), 'm1').mark.classList.contains('is-silent'), false, 'another document starts unsilenced');
});

test('a repaint keeps silence, but a completed waiting episode clears its choice', () => {
  const doc = miniDocument(), first = control(doc, 'm1');
  first.open().items[0].act();
  assert.equal(control(doc, 'm1').mark.classList.contains('is-silent'), true);
  waitingEnded(doc, 'm1');
  assert.equal(control(doc, 'm1').mark.classList.contains('is-silent'), false);
});

test('an action from a detached marker cannot silence a later waiting episode', () => {
  const doc = miniDocument(), first = control(doc, 'm1'), menu = first.open();
  first.button.remove(); waitingEnded(doc, 'm1');
  menu.items[0].act();
  assert.equal(control(doc, 'm1').mark.classList.contains('is-silent'), false);
});

test('the generic mark used inside cover-refresh controls remains noninteractive', () => {
  const mark = waitingDots(miniDocument(), 'Preparing a cover');
  assert.equal(mark.tag, 'span'); assert.equal(mark.getAttribute('role'), 'img');
  assert.equal(mark.children.length, 3); assert.equal(mark.onclick, undefined);
});

test('message click-focus claiming leaves the waiting control focused', () => {
  const doc = miniDocument(), { button, mark } = control(doc, 'm1');
  button.focus(); mark.nodeType = 1;
  let lookedForCard = false;
  MessageMenu.prototype.claim.call({ doc, entryOf() { lookedForCard = true; return null; } }, mark);
  assert.equal(lookedForCard, false);
  assert.equal(doc.activeElement, button);
});
