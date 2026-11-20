# 705: Command–Down archives the selected dossier

On release220 the real shortcut sent `stack.place`. It now uses the existing
personal `stack.aside` route on the dossier containing Return's selected
message or header. The existing More focus, Undo, star protection, root fence
and recovery owner remain in use. Writing, no selection and other pane owners
keep their own keys. No Core/schema change.

Four product files change (10 additions/5 removals): `stack-feed.mjs` routes
the feed key to aside; `stack-menu-items.mjs` moves its shortcut hint from
reorder-down to Archive (not the Reader); `pane-keys.mjs` and
`interaction-guide.mjs` describe the new meaning. Reorder-down remains available
in its existing menu. The eight older native reorder gestures now use that
menu while retaining their position/Undo assertions; matching case names in
`acts.json` follow the changed gesture. Those broader historical cases are not
claimed run here. The nearby Node ordering/menu controls are green.

Base: release220,73d3c2b34da8b6d69e1d541833ebd7be88cee189, fetched again
before freeze. Own branch/tree: `page-lane6/705-command-down-live220` at
`/Users/commonfabric/aim-worktrees/page-lane6-705-command-down-live220`.

## Retained checks

Evidence: `/Users/commonfabric/.local/share/theseus/page-lane6/evidence/705/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Actual220 native key path |red: sends stack.place instead of stack.aside|`chrome-red-route/native.json`|
| Ten-file related Node cohort |170/170|`node-final.tap`|
| Chrome156 topic/Conversation,390/1280px, light/dark |8/8|`chrome-final/native.json`|
| WebKit26.6 same scopes |8/8|`webkit-final/native.json`|
| Applied old-route mutation |red: stack.place|`mutation-verdict.json`, `chrome-mutation/native.json`|
| Exact byte restore and native control |1/1|`mutation-verdict.json`, `chrome-restored/native.json`|

Each native scope proves actual HTTP/Core archive state for the entire dossier,
the selected child's actual root, no unrelated dossier movement, personal
isolation, focus on More and real Command-Z restoration. It exercises native
hover/last-touch message selection, arrow-key selection and dossier-header
selection, plus no-selection, star hold and exact unsent-writing controls.
Every successful shortcut sends one `stack.aside`, never `stack.place`.

Node files: `ui_dossier_command_down_705`, `ui_outline_order`,
`ui_message_menus_861`, `ui_siderail_menus_863`, `ui_stack_order`,
`ui_stack_position`, `ui_stack_drawing_870`, `ui_coordination_467`,
`ui_menu_glyphs`, and `ui_dossier_selection_quote` (all `.test.mjs`). Existing
assertions were retained; the message key legend follows the new contract.

The mutation actually replaces the new routing block with the old reorder
dispatch. The native assertion fails, and `stack-feed.mjs` is restored exactly
to SHA256 `b347f339ef92ab629b03f3692f218669f6f85b127444e1c4b692076fdded4c54`.
Both full matrices and the restored control use those same product bytes.
The native module and product files are captured with source hashes in both
engines; `final-source-check.json` compares them with the frozen source.

## Diagnostics and limits

Earlier setup failures are retained, not counted as product reds: assuming
initial focus was main rather than body; toggling an already-open dossier
closed; posting before the scratch agent joined; expecting a stationary
pointer after Undo to change selection; missing Conversation post_args for a
new subject; and appending to the same scratch Conversation draft across
scopes. The new Node fixture initially lacked querySelector, the messages id
and element nodeType; those fixture gaps were corrected without changing the
assertions. See the earlier `chrome-*` and `node-focused*` artifacts.

The prior fable705 branches and item record were read, including the small
f7078990 routing idea and792abed38 return. Their three actual WebKit failures
(covered writing hit and two More/Undo preconditions) remain historical failed
results, not a passing result for this head. Current220 native checks exercise
the current writing and More/Undo owners. The known188 Item783 failure remains
unwaived; this scoped run does not claim the full native suite is green.

Phone means emulated390px touch plus native Command keyboard events; no physical
phone or keyboard claim. Native refusal/retry/unknown-result fault injection
was not repeated: the shortcut delegates to the existing archive owner. No
new recovery path, data layer or root lookup was introduced. Native scenarios
use loaded roots; existing position/order units retain partial-page behavior.

All data is isolated scratch HTTP/Core data. Every browser closed through its
normal API; fixtures ended with EOF exit0 and empty stderr. Per-run cleanup
records show absent observed browser/fixture PIDs, closed origin ports and
Chrome owned-profile process absence. WebKit logs identify its observed root
and child, absent after close. No other seat's process or installed runner was
changed. Preserve851's reading registration and646's separate stack-feed work
when carrying this source; app.mjs and message-menu.mjs are untouched here.
