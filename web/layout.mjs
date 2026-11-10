// The wide layout's share of the writing column. Stacked, the reply is as
// tall as its writing (docs/reader.md), so it keeps no share.
const defaults = { wide: .45 };
const MODES = ['stacked', 'wide'];
const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
const validShare = value => Number.isFinite(value) && value >= .2 && value <= .8;

// Screen preferences only. Drafts and reading records do not live here.
export class ReaderLayout {
  constructor(instanceId, storage) {
    if (typeof instanceId !== 'string' || !instanceId) throw new Error('Reader layout needs an instance identity.');
    this.storage = storage;
    this.keys = Object.fromEntries(['mode', 'wide'].map(name => [name, JSON.stringify(['aim-next', instanceId, 'reader-layout', name])]));
    this.mode = read(storage, this.keys.mode) === 'wide' ? 'wide' : 'stacked';
    this.shares = Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
      const value = Number(read(storage, this.keys[name]));
      return [name, validShare(value) ? value : fallback];
    }));
  }
  share(shape = 'wide') { return this.shares[shape]; }
  setMode(shape) {
    if (!MODES.includes(shape)) throw new Error('Unknown reader layout.');
    this.mode = shape;
    try { this.storage?.setItem(this.keys.mode, shape); } catch { /* in-memory preference still works */ }
  }
  setShare(value, shape = 'wide') {
    if (!Object.hasOwn(defaults, shape) || !Number.isFinite(value)) return;
    this.shares[shape] = Math.max(.2, Math.min(.8, value));
    try { this.storage?.setItem(this.keys[shape], String(this.shares[shape])); } catch { /* in-memory preference still works */ }
  }
  resetShare(shape = 'wide') {
    if (!Object.hasOwn(defaults, shape)) return;
    this.shares[shape] = defaults[shape];
    try { this.storage?.removeItem(this.keys[shape]); } catch { /* in-memory preference still works */ }
  }
}
