import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeLoadHeld, sampleLaunchResource, requireLaunchResource } from './native_launch_resource_1028.mjs';

// Pure checker ports; these are not host-load or native launch observations.
test('1028 resource sampler retains raw readings and holds at the strict12 boundary', () => {
  for (const [first, qualified] of [[11.999, true], [12, false], [12.001, false], [NaN, false]]) {
    const reading = sampleLaunchResource('browser', {
      load: () => [first, 9, 8], cpuCount: () => 18, now: () => 'declared-checker-UTC',
    });
    assert.deepEqual(reading.load, [first, 9, 8]);
    assert.equal(reading.UTC, 'declared-checker-UTC');
    assert.equal(reading.cpus, 18);
    assert.equal(reading.measurementSource, 'checker-control');
    assert.equal(reading.qualified, qualified);
    assert.equal(reading.admitted, qualified);
    assert.equal(reading.forcedHold, false);
  }
});

test('1028 forced hold can only refuse while preserving the actual qualified reading', () => {
  const reading = sampleLaunchResource('browser', { load: () => [1, 1, 1] });
  reading.forcedHold = true; reading.admitted = false;
  assert.equal(reading.qualified, true);
  assert.throws(() => requireLaunchResource(reading), NativeLoadHeld);
});

test('1028 resource hold retains its exact boundary reading and interrupts the launch continuation', () => {
  for (const boundary of ['fixture', 'browser']) {
    const reading = sampleLaunchResource(boundary, { load: () => [12, 9, 8] });
    let launched = false;
    assert.throws(() => { requireLaunchResource(reading); launched = true; }, error => {
      assert.ok(error instanceof NativeLoadHeld);
      assert.equal(error.reading, reading);
      assert.equal(error.reading.boundary, boundary);
      return true;
    });
    assert.equal(launched, false);
  }
});
