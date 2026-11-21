# Dim follows the person (1004)

Intake: Warp14928 and Fable14931; Tony14738 and Warp14740 read through
the bound profile. Fable14940 binds medium1004 Build1 p-929fce584ab441a3a007bb11.1006 is independently verified shipped297.
New own branch page-lane5/1004-core-dim-live297, base actual LIVE297
924f6a6ccdfb36ae7c9010f8655a218d27979dad, tree
3b9aa93e3ef4ab5a7f1275ac6ebc1676be4a4cc9. Contract only at intake.14954/14956 now settle the freeze order; active
own tree page-lane5-1004-core-dim-757345, branch
page-lane5/1004-core-dim-757345, now reconciled onto approved757
e6049706c764285e89442b34e01dedb61687db2d (schema62, Warp14973/Fable14976).
The original live297 intake tree is preserved.14954 assigns the next schema only at the first green freeze;
14955's approved-predecessor requirement is met. Current-live
ordinary changes, including1003/1005/1006, remain required on actual-live carry.

## Product and defaults

Keep973's Dim0/1/2 appearance, modifiers, independent editable sets and inverse
focus semantics, including outcomes/topics arriving later, selected-row wake,
the existing1003 waiting exceptions, phone/coarse input and retained navigation.
Only the persistence owner changes: the authenticated person's selected level
and both sets become Core records, shared across that person's devices. Other
people never read or change them. The browser is an offline cache, not authority
for a confirmed Core preference. No dossier, outline or1006 cover fold changes.

No saved Core record starts at Dim0 with two empty sets. Import valid existing
973 device choices once only while Core revision is0; a confirmed existing Core
record wins over a stale device copy. An import conflict rereads Core and never
overwrites another device's saved settings. Existing malformed/absent cache is
not imported. Preserve2048 outcome and2048 topic exceptions per set, inverse
focus representation and all existing validated ID/boolean/shape limits.
The existing Core command-envelope limit (2 MiB UTF-8) also applies; the2048
counts are maxima within that byte bound. A definitive validation refusal rolls
back only the refused batch, including when Core refused before a ledger record.
Unknown transport/busy/unreadable answers retain the exact pending request.

## Core/client contract

Proposed concrete names: actor-only `rail_dimming` view returns
`{instance_id,value:{version:1,selected,sets},dim_revision}`; `rail.dimming_set` writes that
bounded value with explicit `expected.dim_revision`. Actor comes from the
authenticated binding, never from a caller-supplied owner. Default revision0;
revision grows only on an actual change, with no row deletion resetting it.
An explicit empty first save creates revision1 (absence differs from saved Dim0).
The write is atomic, authority-fenced, uses the existing operation ledger and
emits only an actor-scoped `rail_dimming` change. CLI/HTTP use the same library.
Core owns `limits.rail_dim_choices` (2048), exposed through capabilities/bootstrap;
the client consumes it for state decoding and editing, and refuses Core writes
if that capability is missing or malformed. The retired973 import format alone
retains its legacy2048 decoder default. Validate the entire bounded shape and readable outcome/topic target bindings;
neither a refusal nor a read leaks another person's preferences or private rows.

Keep the existing rail state/painter owner. Bind once per runtime instance/actor
and authority, read current preferences through a bounded view and observe its
actor change for targeted refresh; no unrelated topic/history reads, foreground
navigation barrier, idle polling timer or full rail cascade. Typed transient read/
transport failures get at most three failure-driven retries (100/200/400ms),
coalescing Live wakes; explicit Retry/focus/online can resume later. Foreground
preference writes skip background change reads once initialized. Apply a local choice
immediately and retain its intended edit plus exact uncertain envelope until a
recorded answer settles it. Serial writes must not let a late read/receipt undo
a newer choice. After a revision conflict, reconcile against current Core and
preserve the user's explicit intent; never silently publish the old whole-device
snapshot over newer settings. Identity/authority changes fence late results.

Offline/close/reopen preserves the confirmed browser cache and pending edits
separately. Pending exact requests/semantic edits use durable, independently
keyed localStorage writer records with Web Locks ownership (as in existing
editor/creation journals), not a session-only default. A new document claims
abandoned writers, deduplicates stable intent/operation IDs, writes their
combined snapshot before removing their exact source keys, then publishes.
Recovery adopts the largest locked abandoned row, avoiding a second full copy
for a single pending writer when storage is near quota. Atomic replacement
keeps that row safe; other source rows survive until the merged snapshot is kept.
Live tabs keep separate locked records and never clobber one another. A crash
during transfer leaves recoverable copies; no new Core write is published until
the transfer is durably complete. Known receipts settle only their own IDs.
If storage/ownership refuses, the current document still paints the choice and
shows an honest unsaved state, but does not publish an unkept Core operation.
The existing compact Retry control can retry after storage/connectivity recovers.
Retry an unknown write with the same operation identity; a recorded refusal is
different from an unknown transport result. Cache refusal/quota failure keeps
this document usable with an honest unsaved/pending status; never claim the Core
save happened. A reconnect refreshes Core and settles/reconciles pending choices.
Confirmed caches and pending writers are scoped by instance, actor AND authority
ID/epoch. A replacement authority may restore a lower Core revision: its current
record wins, and old-authority uncertain journals remain intact in their original
namespace, without being replayed or imported into the new authority.
No new user workflow or permission gate; save feedback must stay compact in the
existing Dim control's status/title and remain accessible.

## Composition and ownership

Warp14954/Fable14956 settle the order by green freeze, superseding both
1004-after1002 and14946's fixed numbering. After75762, the first of1004/1002
to freeze green takes63 and lands first; the other takes64 and rebases once on
the first's approved head. Nothing is stamped before freeze. Both build now;
no unfinished successor holds the other or an ordinary head.

Active base is approved757 e6049706c764285e89442b34e01dedb61687db2d
(schema62). Its correction is reconciled;57f39a3 remains preparation ancestry. Until the freeze
slot is allocated, fresh-Store module tests are explicitly unfrozen component
evidence; there is no shipping migration/stamp or deployment claim. Final
migration and downgrade checks use the actual allocated predecessor/successor.

Owned changes are a small Core preference module/schema/validation/read adapter,
the Dim synchronization/cache owner and minimal OutlineRail ready/live wiring.
Shared registration/migration surfaces are coordinated with1002/987/757 before
editing. Retain1005's single rail owner and1000 handles. No seat provisioning,
runtime/runner installation changes or live-data writes. Fable owns stages;
Warp owns independent review, actual-live composition and deployment under14954/14956 first-green-freeze order.

## Verification and boundaries

Core checks below the browser cover actor/instance isolation and authorization,
validation and bounds, atomic no-op/revision behavior, expected-revision refusal,
exact duplicate/unknown retry, restart and explicit migration preservation and
downgrade refusal with owned preference data. Client tests cover immediate paint,
first-device import versus existing Core, two independent device caches,
cross-device change, rapid edits/late responses, offline/reload/reconnect,
refusal/retry, cache failure and actor/authority switch. Preserve973/1003 state
and gesture checks and1005/1000 navigation/ready ownership. Retain actual reds
and applied/caught/exact-restored isolation/recovery/routing mutations.

An isolated real Core/HTTP fixture and two independent browser contexts/origins
prove that Dim follows Core rather than shared localStorage, with native modifier
clicks/keys/taps and unchanged appearance in both looks/themes at phone/desktop
widths. No handler check called native input, physical-device/IME or fake-DOM
timing claim. Coordinate one relevant workload at a time, actual load below12;
announce browser-in-use and verify Browser.close, every observed owned PID/profile
and fixture EOF/exit0/PID/port/scratch cleanup before browser-free. No broad suite
to fill time. Freeze on meaningful green, push exact own branch and request one
Warp diff/test read, naming actual defaults and material limits.

Warp14985 corrects the workload rule: seats run their isolated headless native
work concurrently. Each seat keeps one own workload at a time; the only load
brake is one-minute load above12 on this18-core Mac. No cross-seat browser slot.

At first freeze8dad636e,1004 uses62→63 after approved757 e6049706. Its32 native
cells use identical Dim/Core preference product code and its served client hashes;
their fresh component Store had stamp62. Shipping63 additionally receives all
Core/migration checks and an integrated native smoke after stamp/step registration.
No predecessor step is renumbered; occupied downgrade refuses even saved Dim0.

Warp14994's client-only correction removes the rail module's unused re-export
list; consumers import state names from `dim-choices.mjs` directly. The unchanged
page inliner can then parse the whole app. The corrected495-case wiring canary
has the same10 full diagnostics/frames as approved757, versus486 before the fix.
Focused clients repeat53/53 and both engines pass a fresh shipping63 native smoke.
Prior32 native cells stay explicitly bound to8dad636e; Core/migration bytes carry
unchanged under14994. Release298/15000 lifted the restart boundary; no installation
or operator configuration was changed by this correction.
