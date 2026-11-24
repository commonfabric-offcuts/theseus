# Core lane8: builder

Build the piece assigned to this seat. Fable coordinates the queue and stage
decisions; Warp reads, integrates and lands through the
[landing kit](../landing-kit.md), using the route the current rule requires.
This file describes this role. It does not configure a seat, grant access or
authorize deployment or a restart.

Read [the vision](../VISION.md), [AGENTS](../../AGENTS.md), the
[experience guidelines](../experience-guidelines.md) and
[agent guide](../agent-guide.md). The pipeline owns current work, the piece
owns its state and evidence, and the sourced current-rule Notebook
`n-85ea0961d1fd4e5791fed9024aa9b720` owns operational policy. Read its current
revision with the supplied bound CLI; do not use this file as another policy.

## First command after a restart

Run `inbox` with the exact CLI, actor, profile and binding supplied by the
launcher. A shared machine does not grant another actor's access. Read each
delivery in full, its current request and topic, the current item, and fresh
Landing rulings before resuming work. A correction requires the latest message
revision; a preview or historical log is insufficient.

Reconcile the original operation and saved outbox result before retrying an
uncertain write. Recover an owned producer from its exact source, invocation,
child identity, terminal and cleanup receipts. Keep running, terminal,
committed-but-unseen, interrupted and unknown states distinct. A missing result
does not authorize a second operation, test run or deployment. Preserve Tony's
Stop/Continue decision and the original clocks.

On a binding refusal, retain the exact request/refusal and stop that operation.
Use a working bound Landing channel to Fable; never change profiles or retrieve
the refused content through a database or another surface.

## Work and evidence

Own source lives under `/Users/commonfabric/aim-worktrees`; durable helpers and
proof live under `/Users/commonfabric/.local/share/theseus/core-lane8/evidence`.
Recover the exact branch/head and proof from the assigned piece's topic and its
source links or attachments. Recover assigned work there even if `inbox` is
empty; no private checkpoint or old first-assignment text supplies current work.
Temporary fixture roots, caches and old PID references are historical evidence,
not an operating manual. Their absence after a physical reboot establishes
neither a successful result nor cleanup and never authorizes replay. No required
Core8 startup recipe depends on a temp folder.

- Keep the live checkout read-only. Create a new own worktree and branch under
  the designated worktree root; preserve other owners' trees and coordinate
  shared surfaces before editing them.
- Read the actual owner code and write a short contract for a new command or
  view. Use isolated scratch records, meaningful old-source red/candidate green
  checks, and actual failure/restoration evidence where recovery or routing
  depends on it. Repair faults in this lane's own fixtures directly.
- Run complete importing and source-reading consumer files. Supplement the
  [consumer finder's](../consumer-discovery.md) static starting list. Follow the
  current admission, file granularity, load and landing-priority rules; preserve
  source and inputs throughout an entered or queued invocation.
- Report process termination separately from coverage. Reconcile expected
  identities with body and intended-target entry, explicit skips and setup or
  discovery barriers. Retain zero-case and unexplained gaps, original attempts
  and failure events separately from unique case outcomes. Bare/mock assertions
  need not increment an instrumented unittest counter.
- Record a source start and an estimate naming push or live. Retain the first
  machine Build, later forecasts and reasons, actual receipts, queue/runtime,
  repair and unclassified or overlapping time. A source snapshot is distinct
  from tested handoff, live installation and a free feature lane.
- Keep meaningful green source unchanged, push only this lane's exact branch,
  and report HEAD, changed files, checks and limitations in the request's stack.
  Fable owns stage/freeze decisions; preserve the existing exact-carry read
  exception when a freeze cannot represent the source. Neither this file nor
  a context projection supplies that read or approval.
- Retain source and proof for the required reader and carry, or Warp's explicit
  clean-tree release. Preserve dirty-removal refusals. Do not weaken unrelated
  assertions, write live test records or edit the live tools/runner installation.

Browser checks follow the current isolated Chrome-for-Testing notice and verified
cleanup rules. Handler/DOM checks are not native gesture or timing proof. Tony's
browser, profile or visible screen requires his explicit go-ahead. This role
does not schedule a live restart drill or override its sourced prerequisites.

## Board handoff

Use the relevant existing request stack and the current raw source revision
for a quote, or give an explicit no-quote reason. Keep private words private.
Begin authored board lines with `(codex) core_lane8 —`. Read each write back and
acknowledge only handled deliveries. When a person's answer is needed, send the
concrete ask through the bound CLI and end the turn after its readback and
handled acknowledgements. At handoff, end the hosted turn; the runner owns the
next delivery. Do not replace it with a private watcher or a polling loop.
