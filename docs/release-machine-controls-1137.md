# Release-machine behavioral controls (1137)

The starting tool source is the independently approved and published 1131 R4
commit `9377283ecdcc60a84ed173117dad03cfac65afe0`. The application predecessor
at intake is release 366, `fd6a67a78f008d057d6b0509f1af5564f8af7464`.
These are separate identities. The current item is Build1, source preparation;
this document and the controls do not establish an executed result.

## Pre-merge record preparation

`tools/deploy.py rehearse CANDIDATE EVIDENCE --config FILE --train FILE
--judgment FILE --release N` prepares a dry release record in a new owned
evidence directory. CANDIDATE is the actual PR head, not an invented merged
commit. Train and judgment files are absolute paths and must name identical
judgment content. The entry accepts version1131 judged-first evidence and
ordinary trains with a null judgment. Legacy judged-first exceptions are not
silently translated into version1131 evidence.

The selected repository must have a clean tracked checkout at the actual live
base. The actual PR must be OPEN and unmerged, target the configured release
branch at this base, and name CANDIDATE as its head in the configured repository.
The Git tree, ancestry of every declared approved head, complete deterministic
evidence, independent audit and canonical frozen-source approvals are read and
validated through the existing owners. Normal `deploy` continues to require
real release-branch containment and the exact merged PR facts.

The entry calls the real admission and `release_plan`/`prepare_record` paths.
Its returned preparation keeps the full train judgment and audit, source and
approval identities, actual candidate/tree/base, PR facts and release number.
An exclusive evidence reservation contains the binding, admission, plan,
prepared record and canonical full measurements. A refusal is retained and
returns nonzero. It never merges, stops, starts, migrates, changes a profile,
publishes an installation, or writes a release or repair to a live store.
Evidence-directory writes are its only writes. It does not run runner-policy
preparation or treat its output as an effect reservation.
The original train and judgment bytes are copied before validation; their
original paths, captured paths, sizes and hashes stay in `00-inputs.json`.
Each readable input is captured even if the other cannot be read. An
unavailable input keeps its explicit read error instead of an invented hash.
Malformed JSON, duplicate keys and invalid UTF-8 refuse only after the raw
input copies and identities have been retained, beside the separate refusal.

A caller must require a successful preparation before continuing to merge,
then re-read admission at the actual merge boundary and authenticate the real
merge during deployment. The isolated control exercises that continuation
with a merge recorder; it does not claim that Warp's installed landing caller
has adopted the new command. That adoption remains a separately reviewed owner
change. A guarded tool revision still needs the whole dry deployment rehearsal
against the last real merged train before independent approval/publication.

## Controls against installed behavior

Controls call the actual admission, release-summary judgment and deploy paths.
All repositories, run records and evidence are owned temporary fixtures.
Notification/repair/process ports are inert recorders: they do not signal a
process, contact Signal, create live items, or mutate seats, routes or profiles.
The recorders never deduplicate a product request on the product's behalf.

The contract requires an incomplete harness, missing terminal, dead fixture,
timeout and zero executed cases to remain INCOMPLETE, never PASS. Missing or
cancelled Verdict by itself must not veto otherwise valid deterministic
admission. A genuinely new named deterministic failure must veto its change,
while an unrelated eligible candidate remains admissible.

Failure effects must produce one visible owned repair item and one notification
per failure identity. A repeated delivery or retry produces neither duplicate;
a new failure produces a new retained identity. A named diagnosis authorizes
only a bounded corrective attempt; completed unchanged input-bound evidence
must be reused, and missing metadata cannot trigger an unchanged whole suite.
These assertions remain ordinary failing assertions where the current hook or
notifier does not deliver them. They are not expected-failure decorators,
skipped cases, or a green proxy for 1139 or the notifier.

Post-stop controls retain the original deploy refusal separately from recovery
and require service restoration only on a tree compatible with the actual
database schema. An incompatible migrated database must never run the old
server. Exact ownership and process identities, no duplicate services, and
already-live/safely-resumed boundaries remain required. Absent 1136 behavior
stays RED or INCOMPLETE; tests do not implement recovery in their fake host.

The process port retains the exact argv supplied by the deployment owner and
synthetic process identities; those are not OS processes or a claim of real
service recovery. The schema control changes actual scratch SQLite metadata
through the migration port and compares it with the fake service's declared
Git schema marker. It does not run production migration DDL or supply a
production compatibility oracle. The tiny harness controls run real owned
children for zero cases, a missing terminal and a dead fixture. Their
INCOMPLETE label is an observer classification of the actual rejected result,
not a new durable product status. The timeout control injects the subprocess
exception without launching a child; it makes no elapsed-time claim. The
named-diagnosis assertion bounds requests and evidence reuse; it does not
claim to execute or deliver an automatic repair.

The post-fast-forward migration-refusal control follows the failure order
reported for the failed 367 attempt (Landing19488/19491/19493): stopped
services, successful backup, candidate checkout, migration refusal with
unchanged schema, separate compatible recovery, then explicit safe retry.
It injects only the migration port's refusal and retains the original raw
result beside recovery/retry; it does not reproduce 858's foreign-key bug,
read the live backup or claim Warp's actual-store migration evidence.

## Results and scope

Each future routed phase records its exact source/body map, named selector and
executed case identities, argv/cwd/environment, unique cache, owned PID and raw
normal terminal/direct exit. The original baseline failures and every applied
mutation/exact restoration remain separate. A timeout or an earlier fixture
refusal is INCOMPLETE, not the intended red. No whole-suite or browser run is
part of this item. A passing boundary does not guarantee that future machine
failures cannot occur, and partial green controls never complete the whole
1137 contract while these required assertions remain unmet.

The isolated Python child receives an explicit `-X pycache_prefix=...` for
each fresh phase; it records and requires `sys.pycache_prefix` and
`sys.dont_write_bytecode` before any candidate import. An environment variable
ignored by isolated mode is not the cache mechanism. Resource sampling saves
the kernel executable descriptor and command display before classification,
handles the Apple `Python` spelling, and treats unreadable or raced samples
as INCOMPLETE. These are bounded known-root checks, not actual argv or global
process-absence proof.
