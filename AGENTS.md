# Working on AIM Next

Tony authorized a separate rewrite. The selected product/build plan is maintained by aim-spec at `/Users/commonfabric/aim/work/scaling-architecture-2026-11-03/first-build-plan.md`; resolve its one bounded critique before application implementation. Do not ask Tony for another routine build GO. UX discussions continue alongside implementation.

## Ownership and isolation

- Lead integrates the repository and owns bootstrap, runtime, HTTP adapter, instance isolation and integration checks.
- aim-core owns `aim_next/store.py`, other core/storage modules, CLI and core checks. Core publishes the shared command/query contract.
- aim-ux owns `web/`, reader behavior and focused native-browser checks. It is Tony's single UX counterpart.
- aim-spec owns the one product/build plan; Fable independently critiques the plan and reviews the completed work.
- Authors use their assigned worktrees/branches and commit only their own paths. Coordinate shared interface changes before editing them.
- Never modify `/Users/commonfabric/aim` application files, existing AIM records/services/wake routes, or another agent's work. No migration/import is selected. New instance paths and identities are explicit, with no fallback to the old instance.
- All development/test data is isolated. Never attribute test messages to a real person/agent in a live conversation. Never clear browser storage by prefix. A room name is not storage isolation; use a separate origin.

## Core contracts

Use CPython 3.9; each Python module starts with `from __future__ import annotations`. No unsupported syntax or new runtime assumptions.

SQLite is the new instance's sole record authority. Attributed messages remain immutable; corrections are separate acts. Notebook revisions retain history. Derived views cannot independently change work state. CLI and HTTP use the same command/query library; local agent access must work without the web server.

The initial selected runtime is stdlib SQLite with DELETE journaling, synchronous EXTRA, macOS fullfsync ON, foreign keys ON and bounded busy handling, with actual settings read back. Transactions are short and contain no network waits, broad reconstruction or attachment publication. External effects need durable intent and recovery.

A retry keeps the same operation identity. A transport/attempt error is not proof of an operation's recorded result. Prepared submissions, committed messages and agent delivery/acceptance are distinct. Preserve exact writing, destination, author, source revision and attachments through interruption; late responses cannot erase newer writing or reverse later Undo.

Reads are scoped and paged. Unrelated history must not cause whole-instance scans or refresh cascades. Keep foreground acts independent of background read queues. Initial limits and capabilities have one backend owner and are consumed by both adapters and UI.

## Specification and evidence

Specify and independently critique before building, then implement and review. Use the agreed first-path scope, not a whole-codebase audit or legacy compatibility exercise. Write meaningful red checks before implementing behavior. For load-bearing record, routing, recovery and instrument claims, assert an actual mutation applied, observe failure and restore; use a unique PYTHONPYCACHEPREFIX for each Python mutation and its restored control.

Keep core checks below the browser. Native-browser checks prove actual selection, keyboard, touch, focus and sending behavior; handler invocation is not a native gesture. Run one substantial test workload at a time. Use Chrome for Testing, never the user's Chrome; close through Browser.close, never a signal. Preserve exact test artifact/phase evidence and owned browser cleanup. Do not import the old full browser suite as a compatibility gate for deliberately retired behavior.

No unexplained test failure is waived. A release names the exact source, checks performed, remaining limits and the new instance/remote revision; existing AIM is not replaced as an incidental deployment step. Preserve local untracked work. Push reviewed code to GitHub as part of delivery; never push unrelated branches with --all or --mirror.
