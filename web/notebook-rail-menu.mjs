import { notebookMenuItems } from './notebook-page.mjs';
import { notebookActionEnvelope } from './notebook-writing.mjs';
import { notebookSheetMenuItems } from './notebook-sheet.mjs';
import { pageLink } from './links.mjs';
import { copyText } from './message-menu.mjs';
import { copyWordsChoice, hasClipboardWords, notebookClipboard } from './copy-words.mjs';
import { openNotebookMenu } from './notebook-menu.mjs';

// The rail borrows the actual page list. Metadata suffices to draw an unopened
// page's choices; only an explicit choice may ask the sheet to open its writer.
export class NotebookRailMenu {
  constructor({ loaded, open, layout, mode, current, changed, notice, copy = copyText, show = openNotebookMenu }) {
    Object.assign(this, { loaded, open, layout, mode, current, changed, notice, copy, show });
  }
  items(source, choose, doc) {
    const id = source.source_ref.id, loaded = this.loaded(id);
    const page = loaded ?? {
      writing: { pageState: source, deleted: source.deleted, reading: !source.reader_may_write },
      readOnly: !source.reader_may_write, mode: this.mode(id), drafted: () => source.draft === true,
      copyWordsItem: typeof source.body === 'string' ? () => this.copyWords(source, {doc}) : null,
      menuExtras: position => notebookSheetMenuItems(this.layout(), position),
    };
    const items=loaded?loaded.menuItems({rail:true}):notebookMenuItems(page);
    return items.map(item => ({ ...item, act: () => choose(item.key, item.label) }));
  }
  copyWords(source, {doc, handles, notice = this.notice} = {}) {
    const choice = copyWordsChoice({ empty: !hasClipboardWords(source.body),
      contents: () => notebookClipboard(source.body, this.mode(source.source_ref.id), null, doc),
      status: notice, doc, current: () => !handles || this.current(handles) });
    return { ...choice, key: 'copy-text' };
  }
  async act(source, key, label, row, commands, handles, notice) {
    if (!this.current(handles)) return false;
    const id = source.source_ref.id, loaded = this.loaded(id);
    const choiceOf = page => page?.menuItems({rail:true}).find(item => item.key === key && item.label === label && !item.disabled);
    if (key === 'copy-text') {
      const choice = loaded ? loaded.copyWordsItem({notice}) : this.copyWords(source, {doc:row.ownerDocument, handles, notice});
      if (choice.label !== label || choice.disabled) throw Error('The page changed. Open its menu again.');
      return choice.act();
    }
    if (loaded) {
      const choice = choiceOf(loaded);
      if (!choice) throw Error('The page changed. Open its menu again.');
      return choice.act();
    }
    if (key === 'star') {
      await commands.send(handles, notebookActionEnvelope(handles.bootstrap, id, source, 'memory.star', { starred: !source.starred }));
      if (this.current(handles)) { this.notice('Saved.'); this.changed(); } return;
    }
    if (key === 'copy') {
      const link = pageLink(source.owner_scope, id), copied = await this.copy(link);
      if (this.current(handles)) this.notice(copied ? 'Link copied.' : `The link could not be copied here: ${link}`); return;
    }
    // Opening may wait for reading/recovery. A departed run cannot invoke a
    // returned writer, and a changed choice must be made again from that writer.
    if (!await this.open(id, { opener: row }) || !this.current(handles)) return false;
    const page = this.loaded(id), choice = choiceOf(page);
    if (!choice) throw Error('The page changed. Open its menu again.');
    // Delete acts on arrival too: the opened page's own Delete runs it through the delete owner, which keeps its Undo.
    if (['text', 'cards', 'rename', 'start-topic', 'start-dossier', 'move-page', 'copy-page', 'delete'].includes(key)) return choice.act();
    this.show({ anchor: page.more, items: page.menuItems(), label: 'This page', sheet: true, focusKey: key, doc: page.doc });
  }
}
