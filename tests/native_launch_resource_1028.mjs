import { loadavg, cpus } from 'node:os';

export class NativeLoadHeld extends Error {
  constructor(reading) {
    super(`Native resource hold before ${reading.boundary}`);
    this.name = 'NativeLoadHeld';
    this.reading = reading;
  }
}

// Dependency ports are for pure checker controls. The producer passes none:
// its two boundary records always sample this host's actual OS readings.
export function sampleLaunchResource(boundary, options = {}) {
  const { load = loadavg, cpuCount = () => cpus().length,
    now = () => new Date().toISOString() } = options;
  const readings = [...load()];
  const qualified = Number.isFinite(readings[0]) && readings[0] >= 0 && readings[0] < 12;
  return { boundary, UTC: now(), load: readings, cpus: cpuCount(),
    measurementSource: Object.keys(options).length ? 'checker-control' : 'host-os',
    qualified, forcedHold: false, admitted: qualified };
}

export function requireLaunchResource(reading) {
  if (reading.qualified !== true || reading.forcedHold !== false || reading.admitted !== true)
    throw new NativeLoadHeld(reading);
}
