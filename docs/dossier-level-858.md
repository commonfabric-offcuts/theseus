# Keep each reader's dossier open state (858)

Pre-edit contract, Core8. Piece `p-52f4dce5434f408797d5ac5b`, opening
17068 and binding 17073. Intake is actual release 336,
`c3bdd6e69165aff33948f8ba61734cf6952c3c10`, schema 65. The own branch is
`core-lane8/858-dossier-open-336`. This document precedes product edits and
test execution. Shared fixtures and browser work wait for an explicit clean
handoff after 1072 and 1074; preparation alone takes no slot.

## The choice and the current defaults

`reply-stacks.mjs` currently keeps `state.levels` only for that list's visit.
`levelOf` names three presentations:

* `head`: an agent-only coordination dossier's quiet title row. This is an
  implicit default, not one of the two explicit choices in `LEVELS`.
* `folded`: latest reply plus unread/held material, with the existing starred,
  context and reading exceptions. It does not fold each message's body.
* `open`: the existing expanded dossier, with its earlier-message window.
  Expanded does not override a personal single-message fold.

On this base ordinary dossiers already default to `open` (857). Agent-only
coordination dossiers default to `head`. A prior local `head` presented in an
ordinary dossier becomes `folded`; this fallback stays. An explicit saved
`folded` or `open` wins over either applicable default. A singleton still
renders as a normal card; its saved preference remains available if it gains
replies. There is no new preference screen or third explicit choice.

Persist only a person's explicit dossier choice: the chevron, title's
open/collapse action, dossier keyboard fold/open step and corresponding menu
action. Existing links, search, starred/unread reveal and programmatic arrival
or dealt-with presentation can reveal material temporarily. They do not write
a preference. Following a link must not silently replace the saved choice.

## Core command and projection

Reuse the existing append-only personal message-act authority and command
pipeline (`stacks.py`, `validation.py`); no page storage or shadow table:

```json
{
  "v": 1,
  "instance_id": "selected-instance",
  "operation_id": "one-stable-operation-id",
  "kind": "stack.level",
  "target": {"message_id": "canonical-dossier-first-message"},
  "expected": {
    "level_revision": 0,
    "authority": {"authority_id": "selected-authority", "authority_epoch": 1}
  },
  "args": {"level": "folded"}
}
```

`args` is exactly `{level: "folded" | "open" | null}`. Null restores the
applicable default, principally for Undo of the first explicit choice. `head`,
booleans, other strings, missing values and extra keys are refused. Initial
value is `level: null, level_revision: 0`. An explicit `open` records a choice
even when the ordinary default is already open. An identical recorded value
is a no-op and retains its revision. Clearing records a new row rather than
erasing earlier revisions.

The row has `kind='level'`, `owner=actor_id`, and JSON `value={"level":...}`.
The command returns the existing act receipt shape: `message_id`, `topic_id`,
`seq`, `level`, `level_revision`, `changed`, and the existing acts watermarks
when changed. Only that reader hears its actor-scoped `acts` change. Topic
activity, shared name, order/place, unread state, message folds and other
readers' choices do not change.

The first message is Core's `StackRoots` result, not the first message loaded
on a partial page. A reply or a root since joined elsewhere is refused with
`STACK_CHANGED`; the page reads the new root before acting again. Visibility,
topic access, private-message and removed-message checks remain the existing
act checks. As a personal reading act it remains available in readable closed
outcomes. Revision and authority fences and operation identity remain those
of the other acts: stale revisions refuse without writes; identical retries
return the recorded answer; changed retries cannot replace it.

`current_acts`, `topic_messages[*].acts` and `message_acts[*].acts` expose
`level` and `level_revision` beside the other acts. The existing bounded
`stack_positions` projection adds the canonical root's `level` and
`level_revision`; each loaded fragment gets the same root preference and
fence even with the root unloaded. This rides the existing batched root-act
read. No extra view, whole-instance scan or independent state is needed.
Joined material follows the destination root's choice. A subsequent split
recovers the source root's own retained choice.

## Page ownership, ordering and writing

`StackFeed` remains the only page command queue, including optimistic acts,
serial revision learning, uncertain-attempt retry with the same operation,
refusal recovery and Undo. `rootOf` learns the level fence from positions for
an unloaded first message. `laterActs` gains the level revision; old reads
cannot undo a later choice. `TopicViews` treats changed level/revision as a
visible position change and propagates it to loaded fragments without moving
their order. A watermark alone still causes no repaint.

`reply-stacks.mjs` projects the saved choice before applying the ordinary or
agent-only default. A visit can temporarily reveal a stack. A later explicit
Core choice supersedes an older temporary presentation; an unchanged Core
snapshot does not erase a link reveal. Projection must not call `setLevel`
as remote hydration: that function deliberately releases local reading holds
for an explicit gesture. Remote refresh must preserve held/writing material,
single-message folds, stars and selection ownership. Undo restores the prior
stored preference (possibly null), not a manufactured persisted `head`.

## Schema and landing

The current `message_acts.kind` CHECK cannot hold `level`. Add a migration
using the existing table rebuild, preserving every row/id/revision and the
AUTOINCREMENT high-water mark, and restore all current act/join/cover indexes.
Fresh stores use the expanded kind set. Rollback refuses if any `level` row
exists, including a cleared row: old code neither understands its value nor
may erase its revision history. Earlier migration definitions stay exact.

This makes the built change JUDGED. Schema 65 is the actual intake base; any
next-step number used by the isolated candidate is provisional for this base,
not a production reservation. Warp assigns the step after 1040's at carry
on the actual live predecessor. No edits to the 1021 gauntlet/base, live
installation, tools or runner are part of 858.

## Evidence planned before implementation

Named actual-336 reds must first show cross-session/reload loss, absent
per-reader record/fence and partial-page projection. New tests use only
isolated scratch actors and stores. Core checks exercise two independent
Store instances, reader isolation/change scopes, stable operation retries,
stale fences, canonical roots, joins/splits, invalid values, explicit default
and clear/history. Entry proof must traverse the real CLI/HTTP command path.
Migration checks retain exact old act rows/sequence and show refusal after a
cleared level. Client checks cover stale responses, fragment updates, unloaded
root fences, actual renderer defaults, saved presentation and temporary reveal.

Native proof uses existing isolated CFT and WebKit adapters, actual pointer/
keyboard input, real Core reads and fresh page sessions. It observes an
explicit collapse, reload/new-tab retention, explicit open on another session,
another reader's independent choice, and preservation of writing/message fold.
Protocol-dispatched input is named as such; no physical-device claim or fake
DOM timing claim is made. Keep raw source/input/response and identities,
failed phases and owned Browser.close/fixture/PID/profile/TCP cleanup.

After meaningful corrected tests are green, apply actual old product owners,
observe the named failures, restore exact fixed bytes and rerun the bounded
controls with distinct Python cache directories. Once the meaningful checks
are green, keep source fixed, push only the exact own source branch and
publish HEAD, test files, pass/fail and limitations for Warp's one source/test
read. Fable owns canonical records, freezes and stages; Warp owns carry,
merge and deploy.
