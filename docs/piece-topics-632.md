# Pieces use their own topics (632)

A piece starts through the public `piece OUTCOME N --topic TOPIC --stage S`
verb, which calls Core's `pipeline.piece_start`. Its topic must be an ordinary
topic opened by an agent in that outcome. `topics.creator_id` records the actor
who opened it (`Conversation._open_topic`); a later message or moved dossier
does not change that origin. A person's topic is refused with
`PERSON_TOPIC`, including when the person themselves starts the piece.
Conversation is not a piece topic (`PIECE_TOPIC_REQUIRED`). Existing outcome,
item, stage and reading authority still apply. There is no schema migration.

`pipeline.piece_move` repairs an existing **piece**, not a release. Target:
`{piece_id}`; args: `{topic_id}`; expected: `{piece_revision: N}`. The revision
is required. Only the outcome owner or coordinator may move it. The destination
must be readable, in the same outcome, agent-opened and ordinary, with no other
piece under way there. The command also repairs closed/historical pieces.
An unchanged destination is a successful no-op; stale revisions are refused.

One transaction changes the piece's topic and revision, settles derived pipeline state,
calls `_build_moved` for **both** topics, and bumps the pipeline. It retains
piece identity, members, stage entries, messages, drafts and participation.
The response names `piece_id`, `from_topic_id`, `topic_id`, `piece_revision`
and `pipeline_revision`. A retry uses the same operation identity.
The existing durable operation receipt records who moved it and both topics;
item placement history and the pipeline's work facts are unchanged.

CLI: `move-piece PIECE --topic TOPIC --expected N`. N is the piece version
shown by the existing JSON pipeline/item read. The ordinary saved-outbox retry
path applies; there is no independent browser repair state.

Build classification already uses current `pipeline_pieces.topic_id` links,
not event history, and 837 already keeps legacy human-linked topics ordinary.
Those protections remain. When the last piece moves away, the former agent
topic returns to the outline. Both durable topic changes must reach an already
open outline without reload. Manual topic states retain their existing meaning.

Checks use scratch stores and actual CLI commands; the open-page check uses an
isolated headless browser. Legacy wrong links are seeded only in scratch data.
Refusal and move/freshness checks fail before the change; applied removal of
the guard and of either durable notification must fail their checks, followed
by restored green controls. No production timing or physical-phone claim.

## Retained evidence

Base: release220, `73d3c2b34da8b6d69e1d541833ebd7be88cee189`.
`tests/test_piece_topics_632.py` has ten passing public Core/CLI cases. The
initial live220 product accepts the person's topic through `cli.main`'s real
piece verb; the new repair command is missing (ten initial failures retained).
Three applied mutations remove the start guard, the old topic notification,
and the destination notification separately. Each fails its check; the exact
restoration passes all ten with separate Python cache prefixes.

`tests/piece_topics_632_native.mjs` uses the real HTTP/Core fixture with its live
feed enabled, and waits for that feed before the move. Four scopes (1280/390,
light/dark) pass: a document showing another topic refreshes both outline
placements without navigation/reload; a native click opens the returned topic
with its writing intact. Browser.close, all18 observed owned PIDs absent,
profile-process absence, fixture EOF0/PID absence and closed origin port pass.
Earlier harness diagnostics (missing returned fixture id, disabled live feed,
and observing text before navigation finished) and their cleanup are retained.

Coupled existing Build-topic/stage checks:28/36 pass on both base and head.
The same eight identities fail `ASK_WAIT_REQUIRED` on both; no assertions were
removed or weakened. Build classification's human-link fixtures now seed
pre-632 wrong links in their isolated stores, since new public starts refuse
them. Stage fixtures open their work topics as agents. Full suite, physical
phones, WebKit and production timing were not run or claimed.

Raw evidence is in the actor's evidence/632 folder: red.txt, coupled.txt,
base-coupled.txt, mutation.json, restored.txt and native-green/results.json.
