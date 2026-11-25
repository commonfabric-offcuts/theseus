# Own-action timing

`performance.record` accepts a bounded batch of observations from the current
actor's tab. It uses the ordinary command envelope, authority and operation
replay rules. Target and expected revision fields are empty apart from the
ordinary authority. Args are `{records: [...]}`. This is diagnostic writing,
never a new send, admission, journal or recovery policy.

Each version-1 record has an opaque action/tab ID, kind (`thumb`, `send`,
`reply_open`, `idle`), actual loaded build, start wall time, monotonic elapsed
time, outcome (`running`, `complete`, `failed`, `incomplete`), bounded operation
IDs and optional submission ID. Fixed names describe phase spans/events,
observation support, loaded-history/card/window burden and recorder overhead.
There are no bodies, titles, quotes, arbitrary URLs or exception messages.
Unknown/missing phases stay unknown; they are never zero or completion proof.

Core validates the complete batch before changing anything. Records live in
separate actor-scoped metadata rows and a bounded retention index; no schema version changes. At most 16 records
arrive per batch, 256 recent action records are retained, and records expire
one hour after Core receives them. A newer observation of the same tab/action
updates that record; an older sequence cannot replace it. Health reads only
the requesting actor's records, counts retained complete/failed/incomplete and
running actions, and shows the slowest recorded actions and their actual
window. Cap/expiry drops and unavailable observations are explicit. Counts
describe recorded observations, not every action a person actually performed.

An explicit context follows a click/key through its own editor/submission or
reaction. There is no global last-action attribution. Records link the actual
operation IDs, pending and confirmed thumb DOM acknowledgments, pending and
canonical sent-card placement, composer settlement, and Reply-open focus.
Queue entry/admission, actual backend put calls and transaction completion,
request dispatch/headers/decoded receipt, busy retries and follow-up reads are
distinct. Existing awaited completions retain their order and error behavior.

Browser spans use its monotonic clock. Server admission/store-call spans use
the server's monotonic clock and are returned as bounded Server-Timing facts.
No subtraction of unrelated clocks or renderer CPU inference is permitted.
Resource timing is used only for an exactly matched request, otherwise it is
unavailable. Two callbacks after DOM acknowledgment are named frame callbacks,
not displayed pixels. Idle/long-task support, incomplete attempts and recorder
overhead accompany the observation; cancellation/retirement ends ownership.

Reporting is bounded and batched, does not measure itself, and never extends
the critical awaited user action. Loss of a measurement does not change a
publication or the journal's durable writing. Local records dropped before
upload are counted when possible; a tab crash before reporting is unknown.
Native input/actual-live endpoint acceptance belongs to Flex after shipping;
modeled clocks, API responses and DOM ports are not native or CPU proof.


The complete record fields are `v,id,tab,sequence,kind,build,started_ms,elapsed_ms,
outcome,operations,submission,burden,phases,support,overhead_ms,dropped_phases,
lost_records,report_failures,counts,long_tasks,idle,failure`. `burden` contains
`loaded_messages,retained_messages,rendered_cards,window_limit`; `support`
contains boolean `long_tasks,resource_timing,frames`. `counts` contains actual
`backend_puts,journal_writes,journal_transactions,requests,retries`. Each phase
has `name,at_ms,duration_ms,request,operation,clock`. A null duration is an event,
not a zero-length span. Queue events name entry, and a later span names its
admission. An actual IDB put request and transaction completion are separate.
Failure categories are fixed; exceptions and writing never enter these fields.
The local cap is128 observations; each immutable batch has at most16 records.
A record keeps at most32 phases and4096 encoded bytes; omitted phases are
counted and DOM/frame endpoints receive priority. Core retains at most256 rows.

`input` starts when the owned action callback is invoked. It does not include
OS input dispatch before that callback. Build identity comes from the document’s loaded
module-entry script `/b/<stamp>/` path, never a later server build lookup. An unstamped local
module says `unversioned`. The tab token identifies this document instance.
Browser overhead measures recorder hot paths, burden sampling, observed-task
processing and snapshot serialization. It is not total CPU, and per-action
observer overhead can overlap. Transport/Core reporting cost is not inferred.
The one-hour window is Core receive time, not a claim that every tab action in
that hour was uploaded. Health's local drop/failure totals are observed maxima
per retained document, so omitted documents remain unknown.

Own routes: card/message bar thumb by click, touch or key activation; Reader
thumb; Reply/Return/quoted-selection opening the Reader; first body press and
inline Reply opening the card composer; Send from inline pencil, card composer
and Reader, including send keys and Reader stay-and-send. The focused owner
checks name these routes and execute actual owner functions with modeled ports.
They do not synthesize native events or establish actual-live latency. Existing
extra surfaces without a correlated DOM owner remain outside these observations.
`composer_settled` means the owned successor writing was synchronously redrawn
and focused. It does not mean a later dialog close/focus restoration completed.
`send_canonical_dom` means the current view owns the connected canonical node;
`frame1/frame2` record later callbacks for that endpoint. A failed or superseded
source, missing canonical placement or missing thumb reconciliation is incomplete.

Local loss counts only discarded dirty observations not covered by the retained
immutable batch. Evicting an already confirmed local cache entry is not an upload
loss; a retained unconfirmed batch remains pending under its original operation.


Cost repair: idle sampling maintains one local, rolling60-second observation.
It queues no report and writes no server records by itself. An action’s terminal
completion (including the last required frame or an incomplete timeout) triggers
a bounded batch; its idle snapshot travels in that batch. A failed report keeps
its immutable operation/payload parked until another action completes; there is
no idle retry timer. Late observer enrichment waits for a later action batch and
preserves the original terminal elapsed/end and overlap interval.

Core stores each observation as one metadata row. An actor-private index holds
only opaque row keys, sequences and Core receive times, at most256 references.
A flush serializes/upserts only its accepted batch payloads plus that bounded
index; it does not read or rewrite other payloads. Stale updates write no metadata.
Expired/cap-evicted exact keys are removed on the next action report; Health
already omits expired rows without a cleanup writer. No performance actor-scope
change is published. Ordinary operation receipts/health settling still commit.
The old unfrozen ed9 actor-blob layout was never deployed and is not migrated;
this remains ordinary no-schema Core metadata work.

A terminal measurement is sealed: later product publication cannot turn an
incomplete timeout into a successful measured interval. Late long-task entries
can enrich only their overlap with that fixed interval. A diagnostic retry also
keeps the original authority pair and entire command envelope; renewal never
changes the fingerprint of a pending observation operation.
