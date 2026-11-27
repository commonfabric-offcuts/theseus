// Order the right rail and its two secondary readers inside one document.
// Core still owns the bounded server lane across documents.
export class RailReadOrder {
  constructor() {
    this.visible = null;
  }
  async whileVisible(load) {
    if (!this.visible) {
      let finish;
      const done = new Promise(resolve => { finish = resolve; });
      this.visible = { count: 0, done, finish };
    }
    const pass = this.visible;
    pass.count++;
    // Already dispatched work cannot delay the visible pass. The shell
    // still owns the transport queue for the rail itself.
    try { return await load(); }
    finally {
      if (--pass.count === 0) {
        this.visible = null;
        pass.finish();
      }
    }
  }
  async defer(read) {
    // Starting in a microtask gives other listeners of a commit a chance to
    // register visible work before either secondary reader starts.
    await Promise.resolve();
    while (this.visible) await this.visible.done;
    return read();
  }
}

export const railReadOrder = new RailReadOrder();
