import { notebookMenuItems } from './notebook-page.mjs';
import { notebookActionEnvelope } from './notebook-writing.mjs';
import { notebookSheetMenuItems } from './notebook-sheet.mjs';
import { pageLink } from './links.mjs';
import { copyText, openMessageMenu } from './message-menu.mjs';

// The rail borrows the actual page list. Metadata suffices to draw an unopened
// page's choices; only an explicit choice may ask the sheet to open its writer.
export class NotebookRailMenu {
  constructor({ loaded, open, layout, mode, current, changed, notice, copy = copyText, show = openMessageMenu }) {
    Object.assign(this, { loaded, open, layout, mode, current, changed, notice, copy, show });
  }
  items(source, choose) {
    const id = source.source_ref.id, loaded = this.loaded(id);
    const page = loaded ?? {
      writing: { pageState: source, deleted: source.deleted, reading: !source.reader_may_write },
      readOnly: !source.reader_may_write, mode: this.mode(id), drafted: () => source.draft === true,
      menuExtras: position => notebookSheetMenuItems(this.layout(), position),
    };
    return (loaded ? loaded.menuItems() : notebookMenuItems(page)).map(item => ({ ...item, act: () => choose(item.key, item.label) }));
  }
  async act(source, key, label, row, commands, handles) {
    if (!this.current(handles)) return false;
    const id = source.source_ref.id, loaded = this.loaded(id);
    const choiceOf = page => page?.menuItems().find(item => item.key === key && item.label === label && !item.disabled);
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
    if (['text', 'cards', 'rename', 'dossiers', 'layout', 'move-page', 'copy-page'].includes(key)) return choice.act();
    this.show({ anchor: page.more, items: page.menuItems(), label: 'This page', sheet: true, focusKey: key, doc: page.doc });
  }
}
