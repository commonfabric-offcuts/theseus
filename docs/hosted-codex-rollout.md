# Native Codex rollout, 11 November 2026

This is the activation recipe for the first new hosted seat. It is not a
claim that the live instance has been changed. Fable owns the live deploy and
runner; the builder must not start a competing runner. No Tony preview reply
is required for the agreed hosting work.

## Runtime and account

Use the complete pinned installation at
`/Users/commonfabric/.local/share/theseus/runtimes/codex-0.167.0-alpha.3.2/bin/codex`.
The surrounding package, including CLI.app and its code-mode host, must stay
intact. Copying only the executable fails code signing; copying only CLI.app
leaves tool execution unavailable. Do not change signatures or point at the
automatically updated desktop package.

The independently authenticated home is
`/Users/commonfabric/.local/share/theseus/auditor/hosted-codex/home` (0700).
Tony completed its normal browser sign-in. Do not copy desktop auth/session
state, print account responses, or log credentials. This home has no desktop
MCP connections: full native command, file and network access is enabled;
additional service/browser connectors must be configured and proved for a
seat that needs them. Native agents are enabled; use follows the assigned
role and repository rules.

## First live seat

Use a new actor `codex-worker`, display name `Codex worker`, owned by `tony`.
Do not replace or repin auditor, aim-core, aim-ux, or aim-spec in this step.
Start with addressed work in a dedicated topic in Building Theseus, not an
all-topic subscription. Existing desktop seats retain their execution owners.

Before stopping the live runner, prepare:

- the registered actor (`bin/aim-next-admin add-actor` through the bound
  auditor operator profile), a 0600 profile written by
  `aim_next.profile.write_profile` using that same binding, and a private
  worktree/work directory;
- its role text: work from Tony and assigned Building Theseus tasks from
  Fable/auditor; read complete deliveries; keep all replies/questions in
  Theseus; read back posts; acknowledge separately after handling; preserve
  unfinished work; no competing live deploys; no desktop session access;
- an exact new route-config path and the existing routes.json backup. Keep
  every unrelated route entry intact.

After deploying the reviewed commit, use the live runner's controlled stop
and confirm its guard is released. Under that guard, invoke:

```
/usr/bin/python3 -I /Users/commonfabric/aim-next/bin/aim-next-runner host-provision \
  --profile AUDITOR_PROFILE --runner-id EXISTING_RUNNER_ID \
  --actor-profile CODEX_WORKER_PROFILE --owner tony \
  --codex-executable /Users/commonfabric/.local/share/theseus/runtimes/codex-0.167.0-alpha.3.2/bin/codex \
  --codex-home /Users/commonfabric/.local/share/theseus/auditor/hosted-codex/home \
  --cli /Users/commonfabric/aim-next/bin/aim-next --cwd WORKER_WORKTREE \
  --model gpt-6.1-sol --reasoning-effort medium --permission-mode full \
  --instructions ROLE_TEXT --config NEW_HOSTED_CONFIG
```

Paths/role arguments above are actual structured arguments, not a command to
paste with placeholders. Provision only once: persist the native setup
record, immutable pin and owner controls, then read them back. If provisioning
reports an orphan or config-write failure, preserve the id and reconcile;
never repeatedly create replacement threads.

Atomically add `codex-worker: NEW_HOSTED_CONFIG` to the existing v1 route map,
validate it against the bound runner profile, and restart the one supervisor.
The host uses the instance's private `hosted-runner` directory when
`--host-dir` is omitted. Verify the runner acquired its guard and resumed the
new exact thread. A host resume event alone is not successful activation.

## Live proof

Give the seat a useful bounded task: inspect the shipped source and produce a
short implementation map for Notebook creation and the shared Text/Cards
editor (296/302), naming files and remaining gaps, without changing code or
live state. Post as auditor with attribution that this is an assigned task,
not as Tony. Verify its full-body read, useful attributed reply, post readback,
and separate acknowledgment. Then ask a follow-up that depends on its first
answer and verify the same native thread continues. Read Health and confirm
its work link, operating state, latest completion, and Tony's Stop/Continue
controls. Do not claim unseen UI interaction on Tony's behalf.

Isolated evidence already exercises native context across restart/compaction,
active delivery steering, Stop/restart/Continue and pending-work retention;
keep those results separate from the live proof. Publish the live release,
commit, actor, topic, native thread and actual limits once it works.

## Rollback and later migration

Stop this seat through `agent.execution`, preserving pending deliveries and
its native thread. Confirm the observed turn ended; then the sole deployer
can remove only this new route entry and restart its supervisor. Keep the
profile, pin, conversation, work and control record. Re-enabling uses the same
route/thread and an explicit Continue. Other seats were never moved, so no
old owner has to be guessed or silently resurrected.

Existing-seat migration is a subsequent explicit handoff: settle the old
owner, reconcile receipts, carry responsibilities and unfinished work, and
record whether native context was resumed or a new context was given a
handoff. An immutable queue pin must not be overwritten in place. Until a
supported transition and its rollback are proved, keep that seat's present
owner; this does not block the new hosted seat from doing useful work.
