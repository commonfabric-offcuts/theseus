# Working on AIM Next

Read [docs/VISION.md](docs/VISION.md) first, and reread it at the start of every
session. It is why we build Theseus the way we do; everything below serves it.

Theseus is a separate rewrite of AIM that the team builds while working inside it.

## Ownership and isolation

- One owner builds and ships each slice end to end: design, Core, client, tests, migration, deployment and the live runtime. Other agents review, build delegated pieces, and raise friction. Ownership follows the work, not a fixed lane; ask in the team's Theseus outcome who owns a slice before building in it.
- Work in your own worktree and branch. Never write in another agent's worktree. Coordinate a shared interface change with whoever owns the slice it touches.
- Never modify `/Users/commonfabric/aim` application files, existing AIM records/services/wake routes, or another agent's work. Old AIM data is not imported. A Theseus instance upgrades its own schema through `bin/aim-next-admin migrate`; reads and servers never migrate. New instance paths and identities are explicit, with no fallback to another instance.
- All development/test data is isolated. Never attribute test messages to a real person/agent in a live conversation. Never clear browser storage by prefix. A room name is not storage isolation; use a separate origin.

## Core contracts

Use CPython 3.9; each Python module starts with `from __future__ import annotations`. No unsupported syntax or new runtime assumptions.

SQLite is the new instance's sole record authority. Attributed messages remain immutable; corrections are separate acts. Notebook revisions retain history. Derived views cannot independently change work state. CLI and HTTP use the same command/query library; local agent access must work without the web server.

The initial selected runtime is stdlib SQLite with DELETE journaling, synchronous EXTRA, macOS fullfsync ON, foreign keys ON and bounded busy handling, with actual settings read back. Transactions are short and contain no network waits, broad reconstruction or attachment publication. External effects need durable intent and recovery.

A retry keeps the same operation identity. A transport/attempt error is not proof of an operation's recorded result. Prepared submissions, committed messages and agent delivery/acceptance are distinct. Preserve exact writing, destination, author, source revision and attachments through interruption; late responses cannot erase newer writing or reverse later Undo.

Reads are scoped and paged. Unrelated history must not cause whole-instance scans or refresh cascades. Keep foreground acts independent of background read queues. Initial limits and capabilities have one backend owner and are consumed by both adapters and UI.

## Building and evidence

Build first, then review the code that exists. A short contract in `docs/` comes before a new command or view so that Core and clients agree on names and shapes; it is not an approval gate. Write meaningful red checks with the behavior. For load-bearing record, routing, recovery and instrument claims, assert an actual mutation applied, observe failure and restore; use a unique PYTHONPYCACHEPREFIX for each Python mutation and its restored control. A review reports defects with concrete scenarios and gets them fixed; when a round of fixes does not shrink the problem, change the design.

Keep core checks below the browser. Native-browser checks prove actual selection, keyboard, touch, focus and sending behavior; handler invocation is not a native gesture. Run one substantial test workload at a time. Use Chrome for Testing, never the user's Chrome; close through Browser.close, never a signal. Preserve exact test artifact/phase evidence and owned browser cleanup. Do not import the old full browser suite as a compatibility gate for deliberately retired behavior.

No unexplained test failure is waived. A release names the exact source, checks performed, remaining limits and the new instance/remote revision; existing AIM is not replaced as an incidental deployment step. Preserve local untracked work. Push reviewed code to GitHub as part of delivery; never push unrelated branches with --all or --mirror.
