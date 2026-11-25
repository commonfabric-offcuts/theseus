# Cover defaults and linked items (1262)

Fable26955 binds the combined page change from Tony26086 and Tony26922
revision2, selected by Warp26925 revision2. Source starts on canonical458;
the eventual current-live carry must preserve1278. Core's cover/item/access
facts and authored words keep their existing owners.

A cover heading may end with ` {folded}`, for example `## Done {folded}`.
Only the cover renderer consumes this annotation. The visible heading keeps
its inline formatting, links and original character positions; subsequent
words keep their original positions too. Unmarked headings start open.
Code, ordinary message text and complete HTML-fence covers retain their
existing behavior. No live cover is edited by this source change.

An explicit reader open or closed choice wins over either default. Keep
the existing device-local viewer/topic/root scope and heading/occurrence
identity, ignoring the annotation when identifying a section. Legacy stored
closed-section strings remain valid. The same preference array additionally
accepts `{section: ID, open: true}` entries for explicit open choices; old
readers ignore these objects and retain their open default. Corrupt/refused
storage keeps the in-document choice, and storage events synchronize mounted
feed/Reader sections. A new/renamed heading has its own default.

Generated linked items use a separate stable disclosure identity. One
initially closed summary gives the current row count and counts by supplied
state, e.g. `9 items: 8 live, 1 next`. All original item links, titles, states,
order and duplicate occurrences remain inside it. An empty list has no
disclosure. Count/state/cover revisions retain the reader's open choice,
the existing summary control and unchanged item nodes; an updated state
does not replace its item link. Real removals retire their rows. If a focused
row is removed or hidden, focus moves to the group's still-visible summary.

Both surfaces use native details/summary semantics. Pointer click/touch tap,
Tab/Shift-Tab reach, Enter/Space, nested sections, item-link activation,
focus through close/reopen and mounted-surface updates are named controls.
Outer Reader folding, hover/wheel/swipe, current refresh/answer authority,
selection/reading holds and later writing keep their existing owners.
The own complete-file model checks and the16 existing direct files are
separate from native gesture/range/geometry and performance evidence.
Native follow-through remains postlanding under Fable26955; no native/783
phase is selected here. Preserve every old-code/fault/restored attempt and
the original PUSH12:40/HANDOFF12:50/conditionalLIVE13:05 Pacific Nov25.
