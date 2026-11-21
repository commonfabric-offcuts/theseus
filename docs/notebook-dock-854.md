# Notebook beside the topic feed (854)

The existing NotebookSheet can switch between a modal and a nonmodal dialog.
It keeps the same NotebookPage, writing stream, open card, selection and scroll.
It owns a dedicated dialog in both modes (871). On a topic page at least
1280 CSS pixels wide, no stored choice means docked. Its head and page menu
offer “Wide” while docked and “Open with Dossiers” while wide, with the shared
two-pane glyph. An explicit Wide choice persists for the session. The Notebook occupies the
right half of the space after the outline; the existing feed occupies the left.
The things rail gives that space to the Notebook until it is undocked.

Item868 keeps one tight title/glyph row fixed in both docked and modal modes.
Item873 moves Text/Cards/Draft, Choose dossier and Add image into the page
menu, fixed in the title row. The old toolbar is removed. Save status, the dossier picker and the deck controls scroll
with the cards; status retains its accessible announcements. The active
NotebookPage remains the scroll owner, so docking and closing preserve its
writing and scroll position. Phone controls retain their 44px minimum.

The layout control toggles docking. ✕ and Escape close either layout, keeping
writing; they do not change the stored layout preference. A card editor or open picker takes its
own Escape first. Narrowing the window returns to modal without changing the
tab's docking preference. Widening restores the preference. Outcome and full
Notebook pages never offer docking. The preference uses sessionStorage only.

“Choose dossier…” in the page menu appears only while docked and opens a list
inside the sheet. It reads one bounded topic
message page at a time and deduplicates the canonical dossier roots supplied
by Core. One bounded named-message read supplies missing root titles; no
automatic history scan. “More” explicitly reads the next page. Reopening reads
fresh names and joins. A late read after close, undock or navigation paints
nothing. Read failures retain a Retry; they never navigate.

Choosing a dossier uses the existing in-feed landing route (land:true), which
opens the dossier and materializes an unloaded target through a bounded read.
A same-topic card bubble uses that path while docked. A different-topic bubble
retains the existing guarded navigation and resumes the Notebook beside the
destination feed, with the target landed there. The sheet is kept, never cloned. Undocked
bubbles keep their Reader behavior.

Docked scrolling outside the sheet belongs to the feed. Feed keys remain the
feed's; Notebook keys apply only inside the sheet. Closing for navigation
removes layout and listeners but retains writing through the existing guard.

Evidence is focused module and handler checks with applied/restored mutations.
These checks do not establish native focus, gesture or rendered geometry.

The topic pencil stays visible while docked. New message owns its original
dialog and opens over the feed column; closing or sending it leaves Notebook
docked with its page, scroll and writing. See
[Notebook owners and menu](notebook-owners-871-873.md).
