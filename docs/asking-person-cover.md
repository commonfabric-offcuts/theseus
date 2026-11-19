# Asking a person sets the dossier's wait (item 759)

Warp9191 rules:

1. NEW linked cover asks clear per question: an eligible answer to that exact
   ask and nothing else, with ONE CONSISTENT attention and cover result.
   Already-recorded legacy asks retain broad clearing until settled. Topic
   attention must not erase a new ask while its cover still waits.
2. A factual/free-response ask MAY explicitly state it offers no choices and
   promises NO default, with its reason shown plainly. Missing metadata
   altogether REFUSES. Never invent a promise or implied go-ahead. Supplied
   options/default remain literal and visible. Ordinary human writing retains
   its current experience.

## Shared publication contract

An agent Ask addressing humans supplies `ask_wait` on `message.post` or saved
writing for a prepared send. It contains `root_id` (null for a new root),
`cover_revision` (0 for a new root), and `questions`: one entry per addressed
human other than the author. Each entry has `actor_id`, `text`, `options`
(a list of literal strings), `default` (literal string or null), and `reason`
(null unless options are empty or default is null; then nonempty words).
An empty options list explicitly means no choices; null default explicitly
promises no default. No field is inferred from prose. Text is at most 300
characters, each option/default 200, reason 300, at most four options and
four new questions per act. Literal supplied words are kept, not folded.

Required `ask_wait` metadata applies only to public agent Asks to people. Internal health
notices still use the existing internal `_publish(topic=...)` boundary, with
Theseus disabled. External commands and views still require an enabled actor;
unavailable named recipients retain `INVALID_RECIPIENT`. No internal-actor
exception is added to external validation.

Every publication path shares Core `_publish`. Missing/invalid metadata refuses
with a correction before message, delivery or cover effects. Metadata without
an agent Ask to humans refuses too. Humans acquire no required metadata or UI.
CLI post/reply accept `--ask-wait JSON`; raw CLI commands and HTTP use the same
Core contract. Prepared snapshots retain the exact object. Opening publication
that carries no ask remains unchanged.

Core resolves the dossier at publication. A reply must name its current root
and cover revision; a new root uses null/0. A changed root or stale cover refuses
the entire act. The linked wait records the generated question message, source
revision 1, addressed person and publication root in schema 53. Existing asks
have no link rows and retain their legacy meaning; migration never reinterprets
them. Downgrade refuses once any link exists, even settled. Message edits do
not retarget or rewrite the linked question. Private asks remain forbidden.

In the same transaction Core appends cover waits, retaining existing stands,
payload and independent owner waits. Linked waits carry `ask_id`, `revision`,
`actor_id` and the literal question metadata; manual cover edits cannot clear
or replace them. They are distinct from the outcome owner whose record gives
payload Done. Exact operation retries return their original receipt, even if
an answer has since changed the cover. A changed request needs its own identity.

An eligible exact reply by the addressed human (public, or whispered to the
asker), their qualifying thumb and its Undo, or the existing record-owned
settlement rules update the linked wait and attention together. Unrelated
public writing retains broad clearing for legacy asks only. Multiple linked
questions remain independent; attention's oldest ask points at an open one.
Leaving a topic releases that person's waits by the existing reach rule.
Private answer ids/words never enter public cover history.

The existing cover sheet and singleton pills, Reader and CLI readout show the
actual person, question, literal options and default, or plainly "No choices"
and "No default promised" with the supplied reason. No new surface is added.
