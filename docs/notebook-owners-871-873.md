# Notebook and New message: separate owners (871 + 873)

NotebookSheet owns one dedicated dialog in both layouts, with the same
NotebookPage and writing stream kept across closes and layout switches. The
existing New message dialog remains the only message composer. On a topic at
1280px or wider, no stored preference means docked; a boolean false under the
existing session key notebook-docked preserves an explicit Wide choice.
Narrow and non-topic pages stay modal. Close and Escape close either mode,
keeping writing. While docked, Escape closes only from inside the Notebook;
Escape in the adjacent feed leaves it showing and belongs to the feed.
Only the layout button/menu switches modes: Wide while
beside the feed, Open with Dossiers while wide.

Docked Notebook leaves inline-composer visible so the topic pencil remains.
New message opens over the feed column, constrained to that column's width;
its close and confirmed send leave Notebook's page, scroll and writing intact.
Opening a Notebook closes an already open message modal, preserving its draft.
Notebook's guards yield to another modal. Retirement removes only its own dialog.

NotebookPage.menuItems is the one list, also available to the future rail
menu (862). It orders checked Show as text / Show as cards, checked Draft with
its existing note as description, Choose dossier… (sheet, docked only), Add
image…, Wide/Open with Dossiers (sheet, eligible only), then Star/Unstar,
Rename, Delete and Copy Link. The optional menuExtras(position) contributes
beforeImage and afterImage lists; common actions stay in NotebookPage. A
read-only Draft keeps its checked state and description but is disabled;
Add image is disabled too. Shared menu keyboard navigation skips disabled
items, and a disabled item cannot invoke an action. Deleted pages keep their
existing Undo delete list. Busy page actions retain the existing menu lock.

The sheet moves the page menu to the fixed title row before layout/full/close,
removes the views/Draft toolbar and separate Add image button, and retains the
file input and image/error rows. Save status and page action/deletion notices
remain in the existing page scroller, outside the menu. Deck editing controls
are unchanged. Copy Link uses pageLink with the page's canonical owner scope
and id, reports clipboard success/refusal in the page notice without removing
an existing error, and ignores a late completion for a closed/replaced writer.

Checks exercise the actual sheet, composer pop/send, page menu and shared
menu handlers with a bounded DOM, plus the CSS contract. Applied mutations
must fail assertions and byte-exact restores must pass. This is source and
handler evidence, not native geometry, focus, keyboard, gesture or iPhone
acceptance. No Core or schema change.
