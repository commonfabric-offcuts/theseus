# 851 verification on release220

Release220 already satisfies851 through the later907 per-message reply model.
This branch changes tests and documentation only. No product, Core or schema
bytes change from73d3c2b34da8b6d69e1d541833ebd7be88cee189. The old851 default
of one field on the most recent draft is superseded by Tony's later907 request
that every message with stored writing show its own field.

The retained `reading item 851` cases show two exact saved replies on different
messages of the same dossier. They preserve their source and topic destination,
return after reload and native rail navigation, share Reader edits, and expose
no other reader's private writing. During delayed actual editor-state answers,
restoration preserves focus, scrollY and the reading card's position (1px
subpixel allowance). The Reader suppresses duplicate inline surfaces. Manual
close keeps writing for return; clearing and reloading opens nothing; confirmed
publication closes its unchanged field and a reload keeps it closed.

## Checks and retained evidence

Evidence root: `/Users/commonfabric/.local/share/theseus/page-lane6/evidence/851/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Seven-file related Node cohort |590/590|`node-final.tap`|
| Chrome for Testing156,390/1280px, light/dark |4/4|`chrome-freeze/native.json`|
| WebKit26.6,390/1280px, light/dark |4/4|`webkit-complete/native.json`|
| Applied hidden-restoration mutation |fails missing visible exact saved fields|`mutation-verdict.json`, `chrome-mutation/native.json`|
| Exact product restoration |SHA256 matches; restored Chrome/WebKit matrices pass|`mutation-verdict.json`, `final-source-check.json`|

The Node files are `ui_card_replies_907`, `ui_inline_wiring`,
`ui_inline_reply_838`, `ui_reader_temporary_wide_906`, `ui_starred_dossier`,
`ui_topic_navigation`, and `ui_quoted_inline_send_941` (all `.test.mjs`). They
retain pending/refused/stale send, images/quotes/recipients, disposal, focus,
Reader layout and routing controls. No existing assertion was removed.

The new native module is registered with the existing reading suite in both
engines. Both runners capture it and `web/card-replies.mjs` with their source
digests. Final captured native module, reading registration and relevant
product files match current bytes in both engines. All tracked web/Core file
digests are retained; the Git product diff from220 is empty.

## Failure evidence and corrections

The initial Node cohort hung in an older presentation-only fixture. On220,
`ui_starred_dossier` uses `Object.create(EditorRegistry.prototype)` and supplies
fake registered editors without their sessions.800 now reads the note session
before presenting. The retained bounded run reports2 passes,1 timeout and1
cancelled case; a direct probe names the missing `sessions.get`. Giving that
fixture its session method restores all4 original assertions and590/590 in
the cohort. Product source is unchanged. See `starred-baseline-timeout.tap`,
`starred-fixture-probe.json`, and the original `node-cohort.tap` (only its owned
hanging child was stopped; the unrelated old Node36112 was untouched).

Earlier native runs retain setup failures: an off-screen drawer button,
checking the previous document immediately after requesting reload, trying a
rail link before its redraw was ready for native input, and checking Close
before its asynchronous keep completed. The helpers now wait for those actual
conditions. WebKit returns focus to main after pointer-opened menu Escape;
Chrome returns to its menu button. Each engine's actual pre-restoration focus
is required to remain exactly the same. These setup errors are retained in
`chrome-first`, `chrome-matrix`, `chrome-restored`, `chrome-final`,
`webkit-matrix` and `webkit-corrected`; they are not product reds or waivers.

The applied mutation changed automatic opens to keep their reply hidden.
Actual applied bytes differ, the visibility assertion fails, and exact original
bytes are restored (card-replies SHA256
`2670faae61c0ef428fdf0bc83a93f8c7a876c41d433426faab4982bdcc8a6a69`).
That mutation used the earlier independent-card fixture; final matrices add
the same-dossier restoration case and pass on the identical restored product.

## Scope and cleanup

These are isolated real HTTP/Core records and browser input. The phone is an
emulated390px viewport with taps; WebKit is a desktop engine. No physical phone
or keyboard, native transport refusal, or performance claim is made. Text
draft restoration is native-tested; existing Node controls cover additional
writing shapes and uncertainty. Loaded messages are the scope of restoration.
The known Item783 failure recorded on188 remains unwaived; this851 filter does
not run783 or claim a broad native suite is green.

Every run closed normally through the browser API and fixture EOF exit0 with
empty stderr. Per-run `*-cleanup.json` records absent fixture/browser PIDs,
closed fixture ports and, for Chrome, absence of its owned profile processes.
WebKit debug logs and process records identify its observed browser root and
child, both absent after closure. No live data, installed runner or other seat's
process was changed.
