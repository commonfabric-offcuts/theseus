# Notebook page title editing (1159) — proposed contract

Sources: Tony20204, Warp20208/20874, Fable21292. Own source base is live385
8a7383a176f9ea7bd3c83c34dbbe5bf4224cd740, tree2587943e2e5e521748badf557872244ad25e79b3,
schema69. This is source preparation, not an executed proof or runtime grant.
No Core or schema change is needed by this design.

## Entry and saving

The displayed page title in the Notebook sheet and full page opens its existing
inline title input on a primary click, a double click, or keyboard activation.
The title is reachable by Tab and the existing arrow-navigation mechanism;
Return and Space activate it as an editing control. The heading remains in its
existing header. Existing Rename pencil/menu entry uses the same owner.
A double click whose first click already opened the input does not replace the
input, reset the draft, or reselect later writing. Secondary clicks, Control-click
context menus, other controls, fields, and an inactive or retired page retain
their current owners.

The existing title input selects the current title on first entry. Escape,
Return and Command-Return each save the exact input through NotebookWriting's
current snapshot, local journal, revision and retry stream. Tony20204 supersedes
the older792 Escape-cancels sentence for this page-title editor. Composition,
keyCode229 and keys already consumed by another owner do not finish it. Closing
or navigating while a request settles cannot let its late response steal focus.
No new title-only transport or independent durable state is introduced.

## First-card focus

In Cards, completing the title opens the first actual card's existing writing
field with a collapsed caret at offset0. The first card is index0, even if
another card was selected. A card draft that was open before Rename is saved
through the existing card owner before that destination is chosen; body,
attachments, metadata and history are preserved. A no-card page, including one
with opening words, enters the existing fresh first-card input with a collapsed
caret at0. Merely opening that empty input creates no card or body revision;
ordinary typing and saving keep their existing owners.

The focus move is immediate after the title is accepted into the local writing
stream; it does not wait on network confirmation. A later save error keeps the
exact local title/body under the existing recovery controls. An unchanged title
still completes and focuses its destination without creating a title revision.
A permission loss, deleted/closed/replaced page, pending page action, unresolved
conflict or unavailable local writing copy does not start a new editor or claim
that a disallowed save succeeded. Retained title input is not discarded by a
failed admission.

Named defaults: title activation initially selects the whole title; the first
card destination is its writing field at offset0; an empty first-card entry is
not a persisted blank card; completion keys save rather than cancel.

## Text-view ruling21321 — preserve the current view

Warp21321 rejected switching Text to Cards. Completion never switches views or
changes the remembered view. Cards retains the first-card editor/empty entry
behavior above. Text focuses the current Text field at the start of the first
card's writing, using its current visible/raw projection; an actually empty
Text page focuses offset0. Record this default in the eventual release line.
The current textEdited/switchView preservation rules remain authoritative.

Warp21332 explicitly resolves the no-card Text case: focus offset0 of the
existing Text field, preserving all opening words exactly. Insert nothing:
no empty card or heading prefix. A card is made only by ordinary Markdown
typing. This also applies to a nonempty opening with no card. No structural
typing conversion, view change or incidental body write is part of1159.
The proposed product files are retained separately for review and remain
unapplied so the meaningful old-source red precedes application. Focused
Node/native sources are prepared but have not been executed.

## Intended proof surface, not executed

Owners read: NotebookPage constructor/titleBox/rename/endRename/sync/key,
DeckPage edit/start/open/finish/cardWritable, NotebookWriting capture/edit/flush,
NotebookSheet obtain/show/pageChoice/global unused-Escape handler, NotebookViews,
and existing867 memory-port and1151 caret/disclosure checks.

The meaningful old-source red will assert that Escape saves a changed title and
opens the first-card editor, rather than canceling and focusing the menu. Focused
controls will cover click/double-click/Tab activation, each completion key,
existing and no-card pages, unchanged title, a previous card draft, Text view
under21321/21332, delayed save/failure/retry and late navigation, permission and
page-action/conflict/retirement guards, composition and context-menu ownership.
Use real NotebookPage and NotebookWriting; model DOM/paint/transport explicitly
below the browser, without native gesture, layout, timing or durable-Core claims.
Native pointer/keyboard focus and the sheet's Escape propagation need the
separately bounded Chromium cell required by20208, with current browser rulings.

Before any test/helper/fixture/browser entry, return the actual implemented
sources, import closure, exact registered case names, literal bounded caller
vectors, input/source maps and a cumulative ledger for fresh review/grant.
Current entries:0 Node,0 Python semantic,0 helpers,0 fixture processes,0 browser.
The21306 judgment hold ended;21310 was a separate browser producer. The later
21322 ordinary-suite hold ended21330. None grants any1159 runtime.
