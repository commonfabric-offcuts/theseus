# Choose a headless seat template (1040)

Base: live335, 7c9d78a2da54611d6cd8fa7a8223c01c1a40937c. Own branch
core-lane7/1040-seat-template-335. Fable16893 binds Build1,
p-d6d8eae08acc426d9b7140b1.1046 stays held/unreproduced; no more1046 cells.

Team +Add → Headless Codex shows named existing full-mode host templates when
more than one distinct configuration exists. One distinct template keeps the
current default. Multiple distinct templates require the person’s choice;
never pick the first arbitrarily. Several actors with identical home,
executable, CLI, model and effort represent one template.335 already carries
an optional global deploy seat_template setting; that historical “cannot pass”
description is stale. This slice adds a per-request choice, not a new home.

The owned runner publishes a bounded catalogue to Core after acquiring its
lease. Public options carry an opaque settings fingerprint and the existing
actor’s name/model/effort; no home, executable, CLI path, profile, credentials,
role or native thread is exposed. A workspace-scoped hosted_seat_templates
view is owner-only and returns available:false when its recorded runner token
is no longer current/running. Reads never inspect the host filesystem or do
network work in SQLite. Form opening/explicit submission refreshes catalogue
state through the ordinary API; there is no new polling loop.

workspace.hosted_seat_add accepts optional template_id. The same command backs
page and CLI. Core retains the resolved choice with the seat, includes it in
status and enforces an explicit choice for a current multi-template catalogue.
Exact retries keep the original command/choice. Same-name recovery cannot
adopt a different recorded template. Legacy requests with no catalogue retain
the existing pending behavior; a missing/stale explicit choice is refused,
never rebound. Native creation still uses only trusted host configuration.

The host resolves the recorded fingerprint against its current full-mode
settings before planning, and refuses an unavailable choice before a profile
or thread is created. Once a plan exists it remains immutable. A definite
profile-stage template refusal with no plan/thread may accept an explicit
named choice on safe Retry setup; that retry retains the original seat actor,
role and operation recovery. Uncertain native stages never gain a new retry.
The UI names the required template choice and keeps all form/request writing,
including through reload, authority change and late confirmations.

The next appended step on335 (65→66 for this build) adds the retained choice; old schema65 code must
not silently ignore it. Backward migration refuses while chosen seats exist.
Catalogue bytes stay bounded in the existing Core metadata authority and are
lease-bound, not a second runtime authority. Warp16902 confirms this diff is judged.16910 orders1070→1071→1021 Links
65→66→1028 colours66→67→1040 choice67→68. Build/freeze now on335; at carry
Warp renumbers only the appended choice step and reads that head before it
lands. Tests derive the version from the migration list. Fable/Warp own that
classification/staging and installation. No live schema, route, runner, tool,
profile or authenticated host edit occurs in builder work.

Checks: named red-first isolated Core and host selection controls; per-choice
request/retry/late-writing and journal checks; single/default, distinct/no
selection, explicit second choice, invalid/stale choice and unsafe retry cases.
Use real scratch Stores and synthetic native child processes only. Retain
actual applied routing/choice fault, its failure and exact restored control,
with unique bytecode caches. Focused native CFT/WebKit covers actual named
chips and Add at phone/laptop widths; no handler or synthetic event is called a
native gesture. One substantial workload at a time; shared browser slot only
after its actual handoff. Browser.close, observed PID/profile absence, fixture
EOF/exit0/empty errors and fresh TCP refusal precede browser-free.

Freeze at meaningful green with explicit retained inherited failures. Publish
exact branch/HEAD/tree/base, test files/results and raw proof for Warp’s one
independent read. Fable owns canonical state; Warp owns carry/landing/runtime.
No authenticated new seat or production timing is claimed from the fixtures.

Adapter shapes: `view hosted_seat_templates {workspace_id}` returns
`{instance_id, available, items:[{id, actor_id, name, model, reasoning_effort}]}`.
Only the human outcome owner reads it. The runner token and paths stay private.
The catalogue has at most128 distinct options/64KiB, and printable model/effort
fields of at most200 characters. A malformed or disabled-actor catalogue is
unavailable; an expired/replaced lease yields no current options.

Add arguments are `{name, role, template_id?}` with the existing workspace
revision/authority fence. Retry arguments are `{template_id?}` with the
existing original-seat revision/authority fence. Omitted remains distinct from
explicit null. `template_id` is `template-` plus64 lowercase SHA256 hex digits;
Core accepts it only from its current lease-bound catalogue. Public status
adds the recorded nullable `template_id`; private plan/thread semantics stay
unchanged. CLI: `seat-templates OUTCOME`, `seat-add OUTCOME NAME --role -
--template ID`, and `seat-retry OUTCOME SEAT_REQUEST --template ID` use the same
view/commands. Saved outbox requests retain the exact optional choice.

Second head, Warp16991/16992 and Fable16994: publication belongs in the
successful lease acquire/resume transaction. It must not add another write
after acquisition. An empty catalogue with no stored catalogue creates no
metadata row; an empty current host clears an older stored catalogue inside
acquisition. A nonempty catalogue is validated and recorded atomically with
the new token, once per acquire/resume. Busy/paused or failed acquisition
cannot publish another host's options. Keep the existing idle five-write
expectation unchanged and run test_effects_runner in the final cohort.
Retain the first head's source/proof;1072 stays bound and waits until this
correction freezes. Page6/1037 holds the shared native/workload slot meanwhile.
The owner-only catalogue is classified in both explicit whisper/removal view
inventories. Warp16999 limits this correction to the new member: preserve the
complete-registry assertions and name the inherited335 missing sets (12/5)
separately. The first native producer reset its input ledger on reload; its
choice gesture is producer-directed click/tap plus state evidence, while only
post-reload events have retained isTrusted values.
