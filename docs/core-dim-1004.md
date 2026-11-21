# Dim follows the person (1004)

Owner: page-lane5; existing topic t-ca4b7bd2bb8a47ca862f824dfdcf93b9,
Build3 under Fable15012, returned findings Warp15008. Own branch
`page-lane5/1004-core-dim-757345`, base approved757
`e6049706c764285e89442b34e01dedb61687db2d` (schema62).
The original actual-live297 intake tree and all other source trees are preserved.

## Product and defaults

Keep Dim0/1/2, both independent editable sets and inverse focus, existing
appearance/modifiers/phone input, retained navigation and the exact1003 waiting
override already shipped on live297. Only personal preference persistence changes.
No saved Core row means Dim0/two empty sets/revision0. An explicit first empty
save creates revision1 so a later stale device cannot import over it.
A valid973 device copy imports only at revision0; existing Core wins.

Each set holds at most2048 outcome and2048 topic exceptions, consumed from Core
`limits.rail_dim_choices`. The existing2MiB UTF-8 command bound also applies.
IDs, exact shapes, booleans, duplicates and current outcome/topic read bindings
are checked. Malformed/missing capabilities block writes with an honest status.

## Core and import contract

Actor-only `rail_dimming` returns
`{instance_id,value:{version:1,selected,sets},dim_revision}`. The actor comes from
authentication; no caller owner field exists. `rail.dimming_set` atomically writes
with explicit `expected.dim_revision` and captured authority, using the shared
operation ledger. Revision grows on actual change; only the actor receives its
`rail_dimming` change. Reads project away newly unreadable places without resetting
revision. SQL visits only this bounded value's explicitly named IDs.

15008 correction: the same view accepts optional `candidate` for a legacy import.
It is checked against the same Core limits. With no saved row, the answer also
returns `candidate` projected through the same indexed permission filter; the
actual Core value remains the default at revision0. With a saved row, the current
Core value/revision wins and candidate is omitted. It is read-only: no preference,
revision, command, ledger or schema write and no unrelated list/history traversal.
This new read-adapter delta is explicit; the command/table/migration are unchanged.

The client prepends the filtered import before retained absolute semantic clicks
that arrived during the first read. It preserves newer edits and exact uncertain
prepared envelopes across late answers, actor/authority changes and reload.
Once Core answers a positive revision or confirms a save, only the exact973 key
for that instance/actor is retired. A conflict rereads current Core, discards a
superseded import and replays explicit edits without overwriting unrelated choices.
A definitive validation refusal can precede a ledger row; it rolls back only its
batch. Busy/transport/unreadable answers retain the exact original request.

## Durable browser recovery

Confirmed caches and independently keyed pending writers include instance,
actor and authority ID/epoch. A replacement authority may restore a lower revision:
its current Core value wins, while old-authority uncertain rows stay in their
original namespace and are not republished into the replacement.

Web Locks protect active writer rows. A new document claims abandoned writers,
validates snapshots, deduplicates stable IDs, keeps their merged state before
removing exact source keys and publishes only after recovery is kept. Recovery
adopts the largest claimed row so one writer does not need quota for a second full
copy. Live writers never clobber one another. No prefix deletion occurs.

Malformed JSON/metadata/snapshots and foreign-version rows are left untouched,
their individual locks are released and valid writers continue. Storage/lock
failure leaves an honest unsaved document choice and blocks unkept publication.
A later successful save clears the old journal error, including for subsequent
pending edits. Retry can resume after storage/connectivity returns.
Pending intents have no automatic expiry; inverse is an explicit retained intent
and can replace the chosen set after another device changed it. Unknown-version
rows are preserved rather than guessed at or silently deleted.

## Refresh and paint

Use the existing rail owner and runtime handles. Live carries commit numbers,
not preference versions; the bounded actor feed learns the relevant resource
version. An equal/older Dim version causes no preference reread or repaint; a
newer version or relevant permission change triggers the targeted preference view.
Unrelated resource changes cause no preference/list/history refresh. Unchanged
presentation suppresses painter callbacks. Foreground edits skip initialized
background reads. There is no idle polling timer. Typed transient failures get
at most three failure-driven100/200/400ms retries; explicit Retry/focus/online can
resume later. A gesture paints immediately; a late receipt cannot erase newer work.

## Composition and verification

Warp15019/Fable15021 now control successor order:1002 proceeds independently on
approved757 for63. If it freezes green before1004 approval,1004 rebases once onto
its approved head and takes64. Only1004 approval first makes1002 take64 after its
one rebase. The current tested source implements62→63; this is not a reserved
slot, a Core freeze record or an approval. Fable owns stages/carry/deploy.
15000 orders judged landing:757,994, then the successors under this rule.
Actual-live1005/1006 and other ordinary changes remain required on carry.

The757 fixture-owner boundary15011/15020 is preserved: the first migration test's
post61 upgrade and repeat target the latest schema; its literal61 layout, refusal,
records/backfill/manual-wait assertions remain. The second test deliberately
injects a failed61→62 step and keeps its literal62 target.

Keep actual red failures, applied/caught/exact-restored mutations and raw native
results. Current checks cover Core permission projection/privacy/revisions,
legacy import/click races/key retirement, malformed writer isolation, exact
recovery, status repair and known-revision suppression. Real Core/HTTP/Live native
checks use independent device contexts and native input at1280/390/375/320 in both
looks/themes. No handler called a native gesture, no fake-DOM timing, physical
phone or IME claim. Warp14985 allows seats' isolated native work concurrently;
each seat runs one own workload while one-minute load stays at most12/18cores.
Browser.close/all observed PIDs/profile/fixture EOF-exit0/port cleanup is required.
Freeze when meaningful checks are green, push only this exact branch, and return
the exact diff/evidence under15008. No new review or human permission gate.
