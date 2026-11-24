import test from 'node:test';
import assert from 'node:assert/strict';
import { field1168, viewport1168 } from './fixtures/phone_sheet_1168.mjs';

test('1168 fitting keeps the CSS cap and the tall-field indicator', () => field1168(f => {
  f.bar.expand(); assert.equal(f.field.style.height, '80px');
  assert.equal(f.root.hasAttribute('data-full-field'), true);
  f.root.toggleAttribute('data-tall', true); f.bar.fit();
  assert.equal(f.field.style.height, '130px');
  assert.equal(f.root.hasAttribute('data-full-field'), true);
  assert.equal(f.state.held, f.state.restored);
}));

test('1168 shorter writing can shrink without changing its caret or scroll', () => field1168(f => {
  f.bar.expand(); f.field.value = 'short writing'; f.bar.fit();
  assert.equal(f.field.style.height, '30px');
  assert.deepEqual([f.field.value, f.field.selectionStart, f.field.selectionEnd, f.field.scrollTop], ['short writing', 3, 11, 7]);
  assert.equal(f.root.hasAttribute('data-full-field'), false);
}));

test('1168 the measurement twin stays hidden and never becomes another writing control', () => field1168(f => {
  f.bar.expand(); const [twin] = f.twins();
  assert.equal(f.twins().length, 1); assert.equal(twin.getAttribute('aria-hidden'), 'true');
  assert.equal(twin.tabIndex, -1); assert.equal(twin.readOnly, true);
  assert.ok(!twin.id); assert.equal(twin.value, f.field.value);
  assert.equal(twin.className, f.field.className); assert.equal(twin.placeholder, f.field.placeholder);
  assert.equal(twin.style.width, '160px'); assert.match(twin.style.cssText, /visibility:hidden/);
  f.state.width = 240; f.field.value = 'new'; f.bar.fit();
  assert.deepEqual(f.twins(), [twin]); assert.equal(twin.style.width, '240px'); assert.equal(twin.value, 'new');
  f.bar.dispose(); assert.equal(f.twins().length, 0);
}));

test('1168 CSS-owned field heights do not add a measurement control', () => field1168(f => {
  f.state.fit = 'none'; f.bar.expand();
  assert.equal(f.field.style.height, ''); assert.equal(f.twins().length, 0);
  assert.equal(f.root.hasAttribute('data-full-field'), false);
}));

test('1168 grown pencil writing lifts its obscured foot once', () => viewport1168('pencil', f => {
  f.focus(); f.emit('resize', { height: 430 }); f.pump(); f.moves.length = 0;
  f.state.boxBottom += 60; f.state.sendBottom += 60; f.input(); f.pump();
  assert.deepEqual(f.moves, [{ who: 'window', by: 60 }]); assert.equal(f.state.sendBottom, 422);
}));

test('1168 keyboard resize retains bidirectional pencil settling', () => viewport1168('pencil', f => {
  f.focus(); f.emit('resize', { height: 430 }); f.pump();
  assert.deepEqual(f.moves, [{ who: 'window', by: -178 }]); assert.equal(f.state.sendBottom, 422);
}, { boxTop: 100, boxBottom: 200, sendBottom: 244 }));

test('1168 focus takes precedence over a coalesced typing-only request', () => viewport1168('pencil', f => {
  f.focus(); f.emit('resize', { height: 430 }); f.pump();
  f.state.boxTop = 100; f.state.boxBottom = 200; f.state.sendBottom = 244; f.moves.length = 0;
  f.input(); f.focus(); f.pump();
  assert.deepEqual(f.moves, [{ who: 'window', by: -178 }]);
}));

test('1168 Reader and Notebook retain their existing pan owner', async () => {
  for (const surface of ['reader', 'notebook']) await viewport1168(surface, f => {
    f.focus(); f.emit('resize', { height: 430, offsetTop: 60 }); f.pump(); f.moves.length = 0;
    f.emit('scroll', { offsetTop: 0 }); f.pump();
    assert.deepEqual(f.moves, [{ who: 'window', by: 60 }]);
  });
});

test('1168 an unchanged desktop viewport schedules no pencil scroll', () => viewport1168('pencil', f => {
  f.focus(); f.input(); f.emit('resize'); f.emit('scroll'); f.pump(); assert.deepEqual(f.moves, []);
}, { width: 1280 }));
