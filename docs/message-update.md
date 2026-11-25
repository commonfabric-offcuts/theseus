# Ask for update (786, updated by829)

New schema56 requests follow [refresh-requests-829.md](refresh-requests-829.md).
Historical786 native evidence below remains bound to its original source.

A readable message's overflow menu offers Ask for update when its author is
another agent. The viewer's own messages, human authors and unknown actor kinds
offer none. The request names exactly that message and its author. The author
uses the existing ordinary `message.edit` command to append a revision of the
same message; existing author-only permission, immutable history and struck
older words remain.

`message.refresh` takes `target: {message_id}`, empty `args`, and required
`expected.message_revision` plus the ordinary authority binding. It is available
through HTTP `/api/command` and local CLI `command` envelopes. It and
`stack.cover_refresh` call the same `_refresh_request` door in cover_refresh.py,
use the same typed delivery and completion/activity record shape.
Message and cover are separate target kinds, even on the same root. Schema50
adds `message_refresh` to message_acts without changing any earlier act or id.
Explicit49→50 migration retains sqlite_sequence; any update history forbids
downgrade. Reading does not migrate.

Defaults: exact enabled agent author as recipient, with current reach and no
fallback; the viewer's observed ordinary revision as fence; no activity before
a request; empty arguments. The request names that exact message and addresses
only its author. It publishes no message or reply and grants no source reach.
Only the addressed agent sees its instruction words. No route or running agent
is required. An offline author leaves the typed delivery pending; no work is attributed to a
running agent until it happens. Self, human, disabled/unreachable author,
closed outcome and stale revision are honest refusals. No timer, cancel,
reassign or automatic resend is added.

Core coalesces pending requests per target across viewers/tabs. Exact operation
retry preserves the receipt. Only a qualifying later ordinary edit of that
same message completes its activity, atomically with the revision. Reply,
acknowledgement, another message's edit, cover write, no-op/refused edit and
elapsed time do not complete it. An older revision cannot request again after
completion. A deliberate new request on the current revision can.

The existing738 browser owner stores the exact unconfirmed envelope before
sending, with instance/actor/type/message identity and captured authority.
Storage refusal sends nothing. Retry and reload retain the same command. Shared
waiting dots on the card's visible author/folded/head row and beside Reader provenance mean asked/awaiting,
with an accessible name and one timed line for the latest request. Old generated
request messages retain their links. The dots do not claim
execution. In the Reader, activity occupies a nonshrinking slot beside the
provenance text; only that text ellipsizes on phones, including320/375/390.
Author, sent/edited time and provenance nodes stay intact. Busy uses the same
dots;738's visible status remains error-only.
Revision fences and monotonically merged activity keep late replies/reads from
reviving a completed indicator. A new refresh has no ordinary ask publication
or read/fold effects. A qualifying write replaces its pending line with the
writer and completion time.

Focused real-Core and client checks are test_message_refresh.py and
ui_message_refresh.test.mjs. message_refresh_786_contract.test.mjs executes the
native expressions, geometry oracle negatives and literal eight-case inventory
without a browser. Native cases in message_refresh_native.mjs run only under
native-reading/native-webkit-reading, selected by `^reading item 786`, at
320/375/390/1280 CSS pixels, light/dark, using fixture item_786.py. Native
pointer/touch and keys operate the visible menus. Fixture commands are only
controlled synthetic agent edits; that author has no route or agent process.
Screenshots are desktop engines at phone widths, never physical phone proof.
Actual pass, phases, failures and cleanup belong to the exact frozen source
and its external REPORT. SPEC-NOTE.md was saved before product edits; this
short docs contract publishes that same design with the implementation.

The Warp10361 composition is source-only. Historical native cases and their
1 CSS px tolerances are retained unchanged, including the known raw-text
completion-wait and clipping-oracle defects. Both historical runs remain0/8.
Base harness/fixture/declaration conflicts were retained unchanged; the imported
786 native module is not wired into those base runners. No current test, native
result or visual acceptance is claimed; see REPORT.md and the external packet.

## Stable card activity (1243)

Ask for update stays on its existing card activity and message menu surfaces.
Repeated cached author and folded-row paints retain one activity node per
message. Its request-state rendering changes only when the displayed state or
labels change; unchanged paints preserve descendants and focus. Card movement
to its folded/head row reuses that node. Duplicate historical nodes retire.
The existing exact request journal, revision/authority fences and monotonic
pending/completed state remain the sole action/recovery owner. No request is
sent by painting, and no new Core command or menu-only relocation is added.
