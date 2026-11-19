import assert from 'node:assert/strict';
import { assertLook783 } from './cover_783_oracle.mjs';

export function assertFailure783(error, phase, at) {
  const wanted = {
    original: ['783.first-child', false, true],
    'wrong-order': ['783.first-child', false, true],
    flat: ['783.inset-pair', 1, 2],
    'outer-shadow': ['783.inset-pair', 1, 2],
    'wrong-background': ['783.folder-background', at.background, at.folderBackground],
  }[phase];
  assert.ok(wanted, '783 known negative Build phase');
  assert.ok(error instanceof assert.AssertionError, '783 intended AssertionError required');
  assert.equal(error.code, 'ERR_ASSERTION', '783 assertion code');
  assert.equal(error.oracle783, wanted[0], '783 stable oracle identity');
  assert.equal(error.operator, 'strictEqual', '783 assertion operator');
  assert.deepEqual(error.actual, wanted[1], '783 assertion actual');
  assert.deepEqual(error.expected, wanted[2], '783 assertion expected');
  assert.notDeepEqual(error.actual, error.expected, '783 an actual mismatch');
  return { oracle783: error.oracle783, code: error.code, actual: error.actual, expected: error.expected, operator: error.operator };
}

export function assertBuild783(at, phase) {
  if (phase === 'restored') { assertLook783(at); return { restored: true }; }
  let caught;
  try { assertLook783(at); } catch (error) { caught = error; }
  return assertFailure783(caught, phase, at);
}
