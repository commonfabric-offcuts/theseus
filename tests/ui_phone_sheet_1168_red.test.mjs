import test from 'node:test';
import assert from 'node:assert/strict';
import { field1168, viewport1168 } from './fixtures/phone_sheet_1168.mjs';

test('1168 active writing never collapses during height fitting', () => field1168(f => {
  const original = [f.field.value, f.field.selectionStart, f.field.selectionEnd, f.field.scrollTop];
  f.bar.expand();
  assert.ok(!f.writes.includes('0px'), '1168 fitting must not transiently collapse the active field');
  assert.deepEqual([f.field.value, f.field.selectionStart, f.field.selectionEnd, f.field.scrollTop], original);
}));

test('1168 pencil viewport pan alone never scrolls the page again', () => viewport1168('pencil', f => {
  f.focus(); f.emit('resize', { height: 430, offsetTop: 60 }); f.pump();
  f.moves.length = 0;
  f.emit('scroll', { offsetTop: 0 }); f.pump();
  assert.deepEqual(f.moves, [], '1168 a visual pan is not a new keyboard-settle request');
}));

test('1168 typing does not move already visible pencil writing down', () => viewport1168('pencil', f => {
  f.focus(); f.emit('resize', { height: 430 }); f.pump();
  f.state.boxTop = 100; f.state.boxBottom = 200; f.state.sendBottom = 244;
  f.moves.length = 0; f.input(); f.pump();
  assert.deepEqual(f.moves, [], '1168 typing only lifts an obscured grown foot');
}));
