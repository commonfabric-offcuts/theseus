# Local file references copy their destination (1190)

A primary, unmodified click on a local reference rendered by1178 copies its
complete displayed destination, including a line suffix such as
`/path/file.md:28`. Preserve the authored destination after1178's Markdown
punctuation unescaping; do not expand `~`, resolve paths, or rewrite `file:`
references. The visible label and its path title remain unchanged and
selectable. There is no href, navigation, file access, or new keyboard stop.

The clipboard write starts inside the click, before any await. A successful
write briefly shows “Copied”; an absent or rejected clipboard API shows
“Could not copy”, never success. Feedback is outside the authored text and its
source mapping. A later click owns its feedback; a late earlier completion
cannot overwrite it. Feedback clears after1.5seconds. Selection gestures,
modifier clicks, non-primary clicks and editable text do not copy. Reference
events stay isolated from surrounding message/card open, fold and edit owners.

`web/links.mjs` owns the reference node and clipboard click. Messages and Reader
passages, Notebook Display pages/cards and literal-link consumers already use
that node through `message-format.mjs`; they keep those owners. `web/aim.css`
owns the copy cursor and brief feedback. Web links and their opener stay as
they are. No Core, schema, runner, record rewrite or filesystem operation.

Checks exercise the actual renderer, CardScroll and Notebook/Deck Display
owners with a memory clipboard, exact paths and line suffixes, success and
refusal, selection isolation, source mapping and unchanged web navigation.
Existing1178 tests remain the adjacent controls. A native gesture cell, if
run, uses an isolated headless browser and a memory clipboard port; it does
not write the user's system clipboard or claim physical-device behavior.
