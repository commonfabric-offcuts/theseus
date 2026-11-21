# 1002: Add a headless Codex seat

Team + Add now offers Headless Codex with a name and role. One authorized Core act records the actor, membership and durable host intent. The existing owned host creates a private profile/outbox/work directory and a persistent native context on its existing home/runtime, then adopts the route and delivers the first Conversation task. The actual seat writes its reply. Existing turns and the operator route file are preserved.

Source branch: `page-lane6/1002-headless-seat-1004-64`. Base: approved1004 `54df5fa05785fb6a26ca8b976f046d4a9b75d243`. Actual shipping step: **63→64**, under Warp15029. The published47864f5f/63 snapshot and the shipping63 measurements below are retained as predecessor evidence; composition64 checks accompany the final return. The exact frozen HEAD/tree and remote readback accompany the board return. Fable owns stages, carry and deployment.

## Boundaries and recovery

Core and CLI share `workspace.hosted_seat_add`, `workspace.hosted_seat_retry`, `hosted_seat` and bounded `hosted_seats`. The CLI verbs are `seat-add`, `seat-retry` and `seat-status`. Named operations reuse their saved request and fence; readback cannot invent a second invitation.

Host work is guarded by the real runner lease/token and exact seat version. Callback identity is checked before another step. Known thread IDs, plan, role and first-task identity are retained; uncertain creation/persistence never blindly repeats. Safe retries resume the same seat. Route adoption follows Core confirmation; one bad route is refused without replacing another seat's context. Read-only indexed schedule hints prevent idle write polling.

The browser keeps exact requests and newer typing in a strict IndexedDB journal scoped by instance, actor, authority and outcome. Unknown results are looked up before exact retry. A late receipt cannot erase newer writing. CAS refuses another tab's overwrite. A failed or unreadable cache blocks publication, retains opaque original bytes and leaves new writing visible under the leaving guard. No cached request auto-sends on reopening.

## Checks actually run

Evidence root: `/Users/commonfabric/.local/share/theseus/page-lane6/evidence/1002`.

- Core23, CLI6, host-boundary5 and migration3 cases pass. The predecessor migration fixtures add fourteen passing757/987 cases. Test files: `test_hosted_seat_1002.py`, `test_seat_cli_1002.py`, `test_seat_host_boundaries_1002.py`, `test_seat_migration_1002.py`, `test_source_item_cover_migration_757.py`, `test_gauntlet_987.py`.
- Shipping Python cohort: **423 cases,186 inherited failure/error blocks**, versus385/186 on exact approved757. All38 added cases pass. Every full diagnostic/frame matches after source-root normalization, unittest error/failure ordering and the explicit four-line offset for removing only1002's empty tables from historical fixtures. No old assertion was weakened. Raw logs and `shipping63-python-comparison.json` retain the limits.
- Focused clients **53/53**, versus40/40 approved757. `ui_inline_wiring.test.mjs`: **485/495**, identical ten predecessor failure diagnostics/frames after roots/durations only. The new Invite-last regression was fixed in product ordering.
- `test_seat_host_1002.py`: **5/5 actual isolated runner/CLI/child cases** on shipping63. These prove addition beside an active turn on the same child, restart without a second context, named auth refusal, same-seat recovery and no replay after stopped uncertain creation. Exact operator-map digests and owned process cleanup are retained.
- `headless_seat_1002_native.mjs`: **36/36 on shipping63**. Chromium156.0.8078.47 and WebKit26.6 cover32 cells at1280/390/375/320, Bookends/Paper and light/dark, with actual click/tap, newline, Tab and Safari Option-Tab. Each engine also proves committed-lost-answer/full-tab-close/reopen, exact operation recovery, newer writing, real IndexedDB CAS/full16KiB-role capacity and unreadable-row refusal without overwrite. Source hashes were captured before and verified unchanged after the run. Browser.close, observed PID absence, profile removal, fixture EOF/exit0/absence and closed ports are verified.
- Seven actually applied unit mutations and the actual IndexedDB-capacity mutation fail their intended checks; exact source bytes are restored and controls pass. Fresh Python bytecode directories are separate for every mutation and restored control. The comparison instrument also detects an altered diagnostic with an unchanged test name.
- Actual operator CLI upgrade of a scratch Store initialized by approved757 preserves **all96 existing tables/definitions and records**; only schema/commit metadata changes. Repeat is an exact-byte no-op. A seat act commits after upgrade, and occupied downgrade refuses with the database digest unchanged. Failed-step injection retains all original database bytes.

Exact test commands are retained in the evidence command manifest; raw outputs stay in their named logs. Native command: set `AIM_PLAYWRIGHT_CORE` and `AIM_CHROME` to the installed test engines, then run `node tests/headless_seat_1002_native.mjs OUTPUT`. Process artifacts use `AIM_SEAT_EVIDENCE`.

Actual reds remain: unsupported initial commands, role/cursor/pin defects, idle13-versus5 writes, Invite ordering, unreadable-cache loading, missing migration registration and the757 latest-schema fixture. Harness failures are identified separately: initial recovery inspection lacked session authorization; Safari plain Tab skips buttons under its default setting; the first capacity probe wrongly included bootstrap continuity; and an immediate cache read did not await the asynchronous device write. The stronger recovery check requires immediate DOM typing and exact committed cache bytes before closing, without repeating a gesture. An earlier WebKit hard-reload cancellation is retained; the shipping63 run has no browser errors and one narrowly recorded WebKit read cancellation during explicit leaving. The driver permits only the existing narrow WebKit cancellation during explicit leaving, and records any such event.

## Defaults and material limits

The existing full-mode template supplies home, executable, CLI, model and reasoning effort; `--seat-template` / optional deploy `seat_template` resolves ambiguity. No fallback to another account/home and no real credential/profile copying. Hot-add of workspace-mode permission profiles is explicitly unsupported. Role limit16KiB; private device journal256KiB. Unknown native effects require reconciliation, preserving known IDs.

The native app-server is synthetic: these tests prove real process/Core/CLI/browser protocol and recovery, not an authenticated production model hello, physical devices or production latency. Fixture archives contain only fictional identities and isolated stores. Shipping and activation remain Fable/Warp's judged carry. The retained predecessor failures are not reported as a green broad suite.
