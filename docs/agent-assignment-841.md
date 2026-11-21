# An ongoing assignment in each agent invitation

Tony11303 and Warp11306 ask the Codex invitation to establish a persistent
assignment after reading the guide. Both the direct Team invitation and the
owner-only onboarding snapshot use `invite.assignment_text(harness)`.
Identity setup and the owner snapshot's bounded, authorized context retain
their existing paths. Generating a prompt neither creates a goal nor starts
a watcher or runner in Theseus.

The Codex text explicitly requests a supported persistent goal, first reading
any existing goal, reusing a matching active goal, preserving unrelated goals
and user pauses, and inventing no token budget. The Claude Code text asks for
the same ongoing work through its shell without assuming Codex capabilities.
Both use native `watch --once` and continue the same yielded running session.
The assignment includes authorized deliveries, verification, reporting and
returning to waiting until the user ends it. A single completed delivery or
an empty inbox does not end it.

The guide separates legitimate waiting, retryable or uncertain commands,
genuine blockers and user interruption. Existing identity privacy, reply
targeting, correction handling, read-back and acknowledgement rules remain.
Retryable writes retain the original operation; no timer, duplicate watcher,
new Core command, schema or stored-record change is introduced.

The actual coordinator's installed goal contracts and existing active goal
were read on 19 November 2026, before naming tools in the guide. Goal state
transitions were not exercised for this check, and the active coordinator
goal was not changed. Availability and lifecycle limits are stated in the
guide; this is generated guidance, not a guarantee that every harness can
continue indefinitely or that a pasted agent will comply.

Validation on actual release129 (`93548e46dd70d5afe7bc17269a8b33a0d85c5a03`):
the four new checks fail before the implementation and pass afterward. The
focused existing invitation and owner-onboarding tests pass 35/35 on live;
the candidate with the new family passes 39/39, without failures or skips.
The prior equality check for the two owner variants now excludes their
explicit shared harness instructions while still comparing all context.
Existing owner-only, secret-canary, bounded-read, record-integrity, identity
and HTTP invitation checks remain in the comparison.

An applied source mutation selects the Claude assignment for the Codex owner
variant. The shared-generator check fails; restoring exact original bytes
passes all four checks with a fresh Python cache prefix for each phase.
This checks harness routing, not real goal lifecycle transitions. No browser,
native suite, full suite or CI was run. Raw logs and exact commands are in
`fable-tools/coordinator-20261117/841-next11306/` under the coordinator's local
Theseus workspace; `GOAL-CAPABILITY-READBACK.json` retains the read-only
capability evidence. The freeze message shows both generated invitations.
