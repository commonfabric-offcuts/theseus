# Answer delivery and asking again (625)

Build from live 210 plus frozen 932, `eecc04039`. The current 625 record
contains no earlier piece or source branch. Keep 932's closure facts,
single-touch publication, and unchanged plain-thumb wait semantics.

Warp13583 default: **agent askers only**. People receive no new reaction
receipt or acknowledgement obligation and are never refused by this guard.

A thumb whose existing Core result is `answered=true` records one immutable
answer receipt and queues it to the ask's author through the existing delivery
queue and wake schedule. It is not a message attributed to the person, does
not count as public writing, and does not answer other legacy questions.
Ordinary thumbs create no answer receipt. Existing Go ahead/Don't replies
and their deliveries remain; their receipts refer to those replies rather
than producing a duplicate notification. An unchanged reaction or exact
operation retry produces nothing new. Every new answering reaction revision
is a distinct receipt, including a thumb given again after being taken back.

The inbox names the person, answer, question and delivery. Its source is the
question, so its current reactions can be read normally. A receipt also says
whether that exact reaction revision still stands. Taking a thumb back does
not acknowledge its historical delivery, but the withdrawn answer no longer
blocks an ask. A newer reaction replaces the standing answer; acknowledging
an older receipt cannot acknowledge the newer one. Answer deliveries are
separate from corrections and ordinary card unread state. They require their
own delivery acknowledgement, not reading through the original question.

Before publication or 932 supersession, Core refuses an Ask from a previous
agent asker in the same current dossier if an answer to that ask remains pending.
The refusal `ANSWER_UNREAD` names the question, answer and delivery. This
applies to answering thumbs, explicit decisions and actual replies from an
asked recipient. Private replies are disclosed only to their own recipient.
Tells and work in another dossier remain possible. The check runs at the
shared publication boundary, including prepared sends, so a send prepared
before the answer cannot bypass it. Refusal changes no question, cover,
message or delivery; acknowledging the named answer permits a new send.
Closure and withdrawal of a question do not themselves acknowledge an
answer already received. The guard follows actual current dossier ancestry,
including joins, splits and moves, rather than storing a second root fact.

Schema 58 is provisional after 932's 57. It adds immutable answer receipts
and an optional answer identity on deliveries. An answer delivery retains
the question as its source message but has its own identity; normal message
deliveries retain their uniqueness. Migration preserves delivery IDs,
sequences, reasons, pending counts and request/correction rows. Rollback
refuses once an answer receipt exists. No historical answer is fabricated
or backfilled. Initialization and migration are tested in scratch stores.

Checks cover positive and negative delivery/admission, multiple people,
withdrawal/replacement, operation retry, restart, atomic rollback, current
dossier membership, prepared sends and actual bound CLI/wake formatting.
No browser gesture is changed or claimed; the load-bearing surface is Core,
its queue, the CLI and hosted wake notices.

## Verification and limits

The 21 scratch feature cases in `tests/test_answer_delivery_625.py` pass,
including the actual bound CLI inbox/ack sequence and an actual runner
claim. The five message-words authority checks also pass (26 total).
The guard-removal mutation was physically applied to `conversation.py`:
both direct-post and prepared-send refusal probes fail, exact restoration
passes all 21 cases, with distinct Python caches and retained hashes.

The coupled ten-file Core run has 120 passes and one historical migration
fixture failure: 829 expects upgrading to the literal version 56; it also
fails on the unchanged 932 base, which upgrades to 57. Its assertions are
unchanged. The wider 395-case run has the same 229 failing identities as
the exact base's 379-case run, with no new failing test. The health/whisper
cohort has 149 passes and 22 failures; all 22 reproduce on the exact base.
These are not full-suite-green claims. The new metadata-only message reads
are classified in `tests/test_whispers.py`; existing audit gaps remain.

Raw results, initial failures, baseline comparison and actual mutation
evidence are retained at
`/Users/commonfabric/.local/share/theseus/core-lane8/evidence/625`.
The frozen source adds no browser gesture and has no native-browser claim.
No historical thumb answers are backfilled. Existing ordinary reply
deliveries already pending are considered by admission. A prepared Ask
still needs its ordinary fresh cover revision after the answer is read;
the refusal retains its frozen writing and does not bypass that check.

Schema 58 here is on 932's 57; 151's separate removal migration is being
composed by its owner. The final carry must renumber steps if needed and
verify both migrations, retaining this frozen source as the reference.
