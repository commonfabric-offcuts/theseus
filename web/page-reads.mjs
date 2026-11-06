// Opening a Notebook page reads it. Core keeps the revision each person last
// read (memory.read), so a page revised since shows as changed on every page
// and device until they open it again; the next commit the live feed names
// redraws the sidebar without its light. The answer says which revision the
// person had read before, which is where what changed since begins.
export class PageReads {
  // send(itemId, revision): the memory.read command's receipt.
  // recorded(): after a read Core recorded, so a page without the live feed
  // still shows what Core now holds.
  constructor({ send, recorded = () => {} }) {
    Object.assign(this, { send, recorded });
  }
  // The revision the person had read before this one, when it is older than
  // the one shown, else null: a page never read, or read as it stands.
  async opened(source) {
    const ref = source?.source_ref;
    if (ref?.kind !== 'memory' || typeof ref.id !== 'string' || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
      throw Error('Only an exact Notebook revision is read.');
    }
    let receipt;
    try { receipt = await this.send(ref.id, ref.revision); }
    catch { throw Error('Connection interrupted; this page may still show as changed. Open it again to read it.'); }
    if (receipt?.status !== 'committed') {
      throw Error((receipt?.error?.message ?? 'Reading this page was not recorded.') + ' It may still show as changed.');
    }
    this.recorded();
    const before = receipt.result?.previous_revision;
    return Number.isSafeInteger(before) && before > 0 && before < ref.revision ? before : null;
  }
}
