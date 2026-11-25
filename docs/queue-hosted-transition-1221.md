# Guarded queue to hosted conversion (1221)

`aim-next-runner host-convert` is an explicit operator act while the runner is
stopped and its real authority guard is held. It takes the existing queue
configuration, the same actor/authority profiles, an original operation ID and
the ordinary explicit hosted provisioning options. It changes no live route
map. `--status` reads the retained operation through that same bound guard.

Core retains one bounded metadata intent, the entire old queue pin, exact
request fingerprint, phase and one new thread ID. Retiring the queue makes its
old transport refuse; it neither deletes its context nor acknowledges mail.
Only a matching operation can continue. Different binding, old pin, owner,
request or competing operation refuses before native creation. Idle/stopped
runner records and no unfinished owned child/claim/turn are required.

Phases are retired, creating, created, prepared and committed. The creating
phase is durable BEFORE thread/start. Missing/ambiguous native creation stays
uncertain and cannot blindly start again. A retained created ID resumes that
same thread for persistence/settings validation. Config publication is exact,
private, exclusive and fsynced; interruption after writing can accept only the
same bytes. Commit atomically installs the matching hosted pin/control and
receipt, retaining the old pin and original operation. Repeating a committed
operation verifies the same config and returns its original result without
native creation. Failed provisioning retains phase, ID and reason for
inspection; no automatic rollback makes the retired queue active again.

Actor/profile/authority identity, old context/history, deliveries, outbox,
original operation IDs, clocks and Stop/Continue intent survive. No schema
migration, live conversion, trial gate or active-goal cleanup is included.
External effects never occur in a SQLite transaction. Owned native child
cleanup is awaited, and it inherits the guard so controller loss cannot free
that guard while its child still lives.

Proof uses isolated Core stores and the scripted app-server, not real Codex
or a live seat. It checks old-transport refusal, same-operation continuation,
changed-request/binding/owner/guard refusals, unknown creation, failed and
interrupted persistence/publication, atomic activation fault and restoration,
old-history/mail preservation, exact committed replay and child cleanup.
Every selected direct consumer runs complete, unfiltered, on candidate/live
under the installed admission wrapper. Original failures and barriers remain.
