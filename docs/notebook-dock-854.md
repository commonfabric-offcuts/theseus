# Notebook beside the topic feed (854)

The existing NotebookSheet can switch between a modal and a nonmodal dialog.
It keeps the same NotebookPage, writing stream, open card, selection and scroll.
On a topic page at least 1280 CSS pixels wide, its head and page menu offer
“Beside the feed” with the shared two-pane glyph. The Notebook occupies the
right half of the space after the outline; the existing feed occupies the left.
The things rail gives that space to the Notebook until it is undocked.

The control toggles docking. While docked, ✕ or Escape returns to the modal;
the next close dismisses it normally. A card editor or open picker takes its
own Escape first. Narrowing the window returns to modal without changing the
tab's docking preference. Widening restores the preference. Outcome and full
Notebook pages never offer docking. The preference uses sessionStorage only.

“Choose dossier” opens a list inside the sheet. It reads one bounded topic
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
