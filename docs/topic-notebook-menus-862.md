# Topic and Notebook menus

Current1096 menu contract: The Notebook row borrows the1096 page palette, including Rename even while that page is loaded in the sheet. The row still performs only its named foreground read; actions open/recheck the shared writer. Side by side remains in the sheet header and Choose dossier is removed. Outcome/topic menu redesign is separate. See [Notebook menus](notebook-menus-1096.md).


Topic title overflow and siderail rows use one descriptor list. Done/Active
and Archive/Bring back use the existing topic fields and revision fences.
Loaded topics use TopicStatePanel; other topics use the same envelope owner.
Mark all read reads the newest visible message by a bounded named-topic read
and sends topic.read_through only through that boundary. Rename and settings
open their existing UI through an ordinary guarded, consumed address.
Topic ordering uses the outline's existing owner.

On a topic page the title buttons read New message, Topic settings, then
This topic from left to right (893). Their DOM order also supplies ordinary
Tab order and the header's left/right arrow reach. Each keeps its existing
action owner. The outcome page retains More for this outcome, then New message.

A starred Notebook row uses NotebookPage's menu list and the sheet's layout
extras. Opening the menu reads only the named page, acquires no writing lock,
and leaves the document, sheet, URL and current writing alone. An existing
page uses its actual menu owner. Unloaded Star/Unstar uses the same fenced
memory action envelope; Copy Link uses the page's current scope. Other choices
open the existing sheet and recheck its current menu. Writing changes and
file selection focus their choice there for a fresh press, so they use the
actual writer and browser activation. UI-only choices may open their UI.

Private Draft and Side by side remain the current names. Menus retain the
existing permission and recovery guards. Navigation, access loss, dismissal
or row reuse retire pending reads and actions. Unknown command outcomes keep
their original operation identity for an explicit retry. No Core changes,
second menu lists, continuation stores, or editor opened by a menu read.

Focused in-memory checks exercise the owners and their handlers. They do not
claim native phone, keyboard, file picker, layout or browser proof.
