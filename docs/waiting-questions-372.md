# Every waiting question (372)

Source-only feel preview under warp 8785. The default is the authenticated
reader's currently eligible questions, without an age or unread cutoff. A
question's identity is its topic and message id, not its topic alone. Its time
is the original ask time. Nothing in this read marks a message read, answers
an ask, changes a wait, or opens or focuses anything passively.

## Scopes and defaults

- An outcome's light, outline waiting control and rolled-up waiting count
  include every distinct eligible ask in that outcome's unarchived topics
  **and its Conversation**. With one in A, one in B and two in Conversation,
  the count is four and all four occur in the outcome's cycle exactly once.
- A topic row cycles every eligible ask to this reader in that topic. The
  topic and workspace topic reads expand this reader's identities in `asks`,
  still grouped by the actor asked; other actors retain their oldest-ask
  summaries. Rows on both rails consume that same field.
- The Conversation row cycles its own open asks to the reader. Its existing
  `conversation_waits` identities remain the authority; the outcome light
  includes them without adding its `topic_waiting` summary as another ask.
- A said wait without an eligible message retains the existing one topic-only
  navigation target and count. A said wait alongside message asks adds no
  duplicate target. No wait means zero targets and no question opens.
- Archived topics remain absent from outcome counts and cycles. Their own
  explicit topic/list reads keep their waiting metadata available, as before.
  Done topics with an eligible wait retain it; done alone answers nothing.
- `attention.waiting_on_me` and `latest_waiting` remain explicitly counts and
  summaries of **topics**, with the existing five-topic list limit. They are
  not the question count or the source of the outcome/row question cycle.
- Outline totals and Only waiting sum the question counts of the outcomes
  already listed for this reader; they do not widen visibility to other
  outcomes. The outcome query still requires its explicit workspace id and
  existing membership permission. Topic queries still require their explicit
  topic id. There is no new all-history or all-reader query.

## Query and visibility

Use `topic_waiting` and its reader index to locate eligible places, then the
existing `(topic_id, actor_id, seq)` message-addressee key to enumerate ask
metadata only. Reuse `_ask_waits` for each candidate: the Conversation's own
wait row; otherwise the existing held-record, record settlement, thumb and
reply rules. Keep explicit archived-place reads available without changing
blocking's default exclusion of archived asks. Do not infer eligibility from
delivery/ack state, unread counts, words or a client copy of message history.

Apply the existing topic read permission and whisper visibility predicates
before returning identities. Ask enumeration reads no bodies, excerpts,
attachments or private replies; eligibility may check reply existence as it
already does. Work and attention summary reads retain their compact rows.
There is no new schema, policy, actor/session binding, answer or delivery act.

Blocking changes only the ordering/annotation of the exact matching ask fact,
never replaces every question in a topic with one representative. Count and
click use the very same complete set of ask facts.

## Click and refresh

Keep the existing oldest-first comparator (time, topic id, message id), wrap,
per-place page-memory-first position and tab sessionStorage. The outcome's
outline and light share a position; topic and Conversation rows keep their
own. The first press defaults to the oldest; the next press advances. After
an ask ends or visibility is lost, a refreshed set omits it and the next press
continues after the remembered position, wrapping if needed. A passive refresh
never jumps the current reading. Storage failure remains silent and starts
at the oldest on the next page load, as before.

Keep existing exact-message routing and Reader/source permission checks for
same-page, older, collapsed and off-page questions. Keep current highlight,
focus, scroll, 44px targets and waiting dots with their owners.

## Integration boundary

This uses only the supplied base, not in-flight 722/594 source. Any later
waiting-dot or source-identity integration must retain these exact question
identities and not restore topic-level deduplication. The supplied base has no
asker-withdraw command or UI in the inspected conversation, reaction, topic
state or message-menu source. This preview adds no withdrawal authority or
schema; a coordinator-supplied ending/withdrawal must feed the same existing
eligibility records. Withdrawal feel is NOT COVERED until that path is present
on the hosted copy. Tony tries the candidate before tests or review.
