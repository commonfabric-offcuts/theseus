# Outcome page redesign (960)

Warp14024 assigns960 ahead of959/954, from Tony's designer handoff
`n-9a3ee3b00f7049cea694d4258a56c64f` in
`t-083198d334874c5c81201c744dff77a0`. Resumed14141 from245,
`a988a19fd6762ee76aa1787b6c305cb05cbb7f0d`, in an isolated own tree.
The full revision2 handoff and its design assets are now readable and read.

## Ownership and first cut

The existing owner is `Store._view_workspace_topics` and its shared
`_topic_items` projection, already joined to the one-row public topic summary.
Add a bounded newest-message projection there for the returned page, with the
message identity, author and opening words/time. Do not add per-card reads or
another topic-list owner. Empty topics have no newest message. Private or
removed text must not leak through this projection. Keep paging, unread,
Build/Done/Archived grouping, order, and read scoping intact. Exact field shape
and byte budget will be documented before implementation after reading the
current Core contracts; no schema change is assumed.

This Core part may freeze independently, as Warp permits. Tests must cover the
newest public message, empty/image-only topics, Unicode bounds, removal and
private-message isolation, plus the existing order/group/read contracts.

## Page cut

Keep847's `TopicRail.presentation()` as the single data/act boundary into
`OutcomeTopicCards`: lifted topic sheets show title/unread, latest speaker and
opening words, one quiet wait/time footer, and one under-sheet for more than
one message/two at ten. One-message topics get no under-sheet. Follow the
designer's exact material, spacing, type and agent-colour rules once readable.
Agents/skills become words; Notebook becomes its own material panel; remove
Where it stands/Also waiting; put Pipeline off/Turn on and settings at the foot.
Purpose pencil edits in place, Return saves and Escape restores.

Auditor14032 owns957's title colour-ring component and actor-scoped colour
records. Preserve its integration;960 owns neither957 Core fields nor rail
colour behavior. Avoid rail/topic-page markup/style changes. Retain their
native geometry/appearance controls and purpose/edit/send/access handling.
Native outcome-page red precedes page product edits, in a scratch origin and
isolated headless browser under the current load/cleanup rules.

The five initial Core checks failed on the missing projection before product edits. The real outcome-page native baseline is retained separately before implementation. Fable owns
the single960 Build and stage bookkeeping; Warp owns review/carry/deployment.

## Readable handoff and Core shape

Warp14048 granted access. Read handoff revision2, prototype2 CSS and prototype3
JS plus14055/14057: Notebook snippets skip a repeated opening title. The
change applies at widths1100px and above; narrow/phone presentations retain
their current layout and content. Prototype code is reference, not a shipped
fetch interceptor, observer or per-card query.

Each returned `workspace_topics` item gains `latest_message`, null when no
public message exists, otherwise `{id, revision, author_id, author_kind,
sent_ms, opening, truncated, withheld, removed}`. `opening` is at most180
Unicode code points of the current message's opening prose, excluding quote
lines and the agent reply preface and simplifying Markdown marks. A single
batched query visits only the returned topics' summary message IDs. It reads
their current words through the existing edit/exposure helper, processes one
row at a time and returns only the short projection. Cost follows this page's
newest-message bytes, bounded by the existing message/page limits, not topic
history. Held words remain withheld from agents; removed words and whispers
never enter the preview. Edited preview words record the actual revision.
No schema, stored message or existing summary fact changes.

## Core cut on release 245

The first source cut adds the projection and its exposure boundary only. It
changes no web files. The actual outcome-page baseline, taken on isolated242
before product changes, showed a committed newest-message sentinel absent
from its topic card. The page composition and its native green remain owed.

`tests/test_topic_latest_960.py` passes all15 checks, including current words,
public-only selection, bounded Unicode, empty/image-only content, removal,
held drafts, exact agent revision exposure/correction, human first exposure,
and hold/unsend races between the boundary's two phases. An instrumented read
proves one batch reads only the returned topic's latest body, not history or
off-page words. Removing the new `opening` exposure admission actually fails
the human-preview oracle; exact byte restoration precedes the final control.

Final related command: `PYTHONPATH=tests /usr/bin/python3 -m unittest
test_topic_latest_960 test_topic_order test_topic_state test_whispers
test_message_edit test_message_exposure test_message_marking
test_message_words test_message_removal_151 test_store`. It runs230 tests;
42 fail. The same common cohort on a pristine245 tree runs215 tests with the
same42 failure identities and multiplicities, with no errors in either run.
The reply/ask/piece fixtures refuse newer contracts; the source/view audits
have identical pre-existing gaps after classifying this cut's one new query.
These remain failures, not a broad green or a waiver. The15 added tests pass.

Raw logs, the independent source/view inventory, applied mutation and restored
hash receipt, baseline screenshots and verified browser cleanup are retained
under `/Users/commonfabric/.local/share/theseus/page-lane6/evidence/960/`:
`core-pristine245.log`, `core-restored245.log`, `cohort-comparison245.json`,
`audit-inventory245.json`, `human-preview-red.log`,
`exposure-mutation-red.log`, `exposure-mutation.json`, and
`native-red242-cardsopen/results.json`. Mutation and restored control use
distinct Python cache prefixes. The earlier exact188 Item783 failure remains
failed and unwaived; this cut makes no claim about it.
