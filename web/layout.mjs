// The wide layout's share of the writing column. Stacked, the reply is as
// tall as its writing (docs/reader.md), so it keeps no share.
const defaults = { wide: .45 };
const MODES = ['stacked', 'wide'];
const WIDTHS = ['reader-stacked', 'reader-wide', 'new-message'];
const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
const validShare = value => Number.isFinite(value) && value >= .2 && value <= .8;
const validWidth = value => Number.isFinite(value) && value > 0;

// Screen preferences only. Drafts and reading records do not live here.
export class ReaderLayout {
  constructor(instanceId, storage) {
    if (typeof instanceId !== 'string' || !instanceId) throw new Error('Reader layout needs an instance identity.');
    if (arguments.length < 2) {
      try { storage = globalThis.window?.localStorage; } catch { /* in-memory preferences still work */ }
    }
    this.storage = storage;
    this.keys = Object.fromEntries(['mode', 'wide'].map(name => [name, JSON.stringify(['aim-next', instanceId, 'reader-layout', name])]));
    this.mode = read(storage, this.keys.mode) === 'wide' ? 'wide' : 'stacked';
    this.shares = Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
      const value = Number(read(storage, this.keys[name]));
      return [name, validShare(value) ? value : fallback];
    }));
    this.widthKeys = Object.fromEntries(WIDTHS.map(name => [name, JSON.stringify(['aim-next', instanceId, 'composer-width', name])]));
    this.widths = Object.fromEntries(WIDTHS.map(name => {
      const value = Number(read(storage, this.widthKeys[name]));
      return [name, validWidth(value) ? value : null];
    }));
  }
  width(surface) { return this.widths[surface] ?? null; }
  setWidth(surface, value) {
    if (!WIDTHS.includes(surface) || !validWidth(value)) return;
    this.widths[surface] = value;
    try { this.storage?.setItem(this.widthKeys[surface], String(value)); } catch { /* in-memory preference still works */ }
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
