# Notebook secondary-click menu (961)

Current1096 menu contract: The same secondary-click door now opens the1096 Notebook palette. Copy text/Chat/Add image/Start new and red Delete card follow the inline swatches/link marks; selected text, fields and touch-origin contextmenu retain the exclusion rules below. Existing native result history does not establish1096 native proof. See [Notebook menus](notebook-menus-1096.md).


On a Notebook card, secondary click (including macOS Control-click) opens that
card’s existing ⋯ menu at the pointer, clamped to the viewport. On the page
background or title it opens the page’s existing ⋯ menu. Full page and the
modal/docked Notebook sheet share NotebookPage.

Menu items, disabled states, live permission checks, card identity and save
behavior come from the existing owners. Escape restores focus to the matching
⋯ control. Ordinary ⋯ and keyboard menu entry keep working.

A preexisting noncollapsed document selection, image or editable field keeps the browser
menu. Touch long press remains native: no hold timer or touch prevention is
added. The context entry ignores touch-origin contextmenu events, including
MouseEvent-only engines following a touch pointerdown. Closing a NotebookPage
retires its listeners and menus. No Core command, schema or HTTP shape changes.

Checks use the real menu/action owners below the browser, then native pointer,
Control-click, selection, editing and focus in isolated Chromium/WebKit pages.
A wrong-card routing mutation must be applied, fail the target assertion and
be restored. Native touch coverage and engine limits are recorded with results.

WebKit can select a word during secondary click. The entry captures any existing
selection on that pointerdown, before the browser default, and uses it for the
contextmenu decision. Explicit selection still wins; incidental selection does not
hide the page menu.

WebKit also emits a primary click after a handled Control-click contextmenu.
That same gesture is consumed in capture so the card beneath cannot take focus
or begin editing. A new pointerdown clears that flag; ordinary selection clicks
continue to the card owner.

Retained checks: `node --test tests/ui_notebook_context_menu_961.test.mjs` and
`tests/notebook_context_menu_961_native.mjs EVIDENCE_DIR [CASE_FILTER]`, with
`AIM_PLAYWRIGHT_CORE`, `AIM_BROWSER` and (for Chromium) `AIM_CHROME` pointing to
the isolated test installation. Cases are fullpage, modal, docked and phone.
The native script verifies menu parity, pointer position, modal layering,
Escape/Control-click focus, actual dragged selection, an attached image,
editable-field context menus and the targeted deletion read back from Core.

Phone checks prove native touch ⋯ and a Chromium touch hold without a custom
menu, compared with the unchanged base. Headless Chromium emits no contextmenu
for that hold; WebKit automation supplies tap only. Touch-origin contextmenu
and the MouseEvent fallback are covered by the real entry's owner checks;
there is no claim to have tested a physical phone's OS context menu.
