# Question resolution and supersession

Warp13427: a newer public question supersedes an older open question only in
the same current dossier, from the same asker, with the same full set of
addressees other than the asker. A+B and A are distinct. This applies to plain
and go-ahead questions, including questions written before this release.
Target and stage questions controlled by their records are excluded.

`message.resolve`, target `{message_id}`, args `{}`, expected `{authority}`,
is available to the asker and the outcome's current coordinator with source
and topic access in an open outcome. It closes a question; it does not answer
it, withdraw it, post words, or decide a target/stage record. A new operation
on an already resolved question is unchanged; an exact retry returns its
original receipt. Other terminal questions cannot be resolved again.

Warp13527: eligibility follows closure and withdrawal records, not the current
waiting projection. An answered or archived question without either record
can still be resolved or superseded; an archived outcome remains closed to
these commands. Topic archiving hides question and cover-wait pills without
discarding their underlying records. Unarchiving cannot revive a closed ask.

Schema 57 (provisional until composition) adds immutable `question_closures`
rows: message, kind (`resolved` or `superseded`), actor, timestamp and optional
successor. Migration does not reinterpret existing questions. Rollback refuses
once a closure exists. Publication and supersession are one transaction;
closure, linked cover removal, Conversation/topic waits and the receipt are
also one transaction. No message words or reaction answers change.
Supersession leaves the topic touch to publication, after the successor's wait
is recorded. Each publication announces the version actually stored by its
single touch, including waiting changes for recipients of superseded asks.

Message source, feed and delivery project `question`: null for non-questions,
otherwise `{state, waiting_on, may_resolve, by, at_ms, superseded_by, archived}`. Waiting
comes from the existing per-question wait records and rules. Terminal records
take precedence. The command returns this projection as `question` with
`message_id`, `topic_id`, and `changed`. Actor-scoped `question` changes tell
loaded clients to read that source; existing topic/acts changes refresh waits.
Replies to public questions announce that exact question at the committed
topic version. An open Reader also refreshes its question on topic changes,
covering archival and legacy waits cleared by writing elsewhere in the topic.

The Reader names its own question's wait and offers Resolve only when Core
permits it. Terminal Resolved/Superseded states have no display label in a card or the
Reader origin (1239); their authoritative facts remain kept.
The client learns terminal states monotonically and filters them from every
loaded cover before its next paint, including stale cover reads. Unknown
command outcomes keep the exact operation for Retry; a late receipt cannot
change a different Reader source. Withdrawals use the same local filtering.
Moving a dossier rebuilds waits only from questions without closure or
withdrawal records; the move cannot recreate a closed wait in its destination.

Default preserved: thumbs still clear plain waits exactly as before. Explicit
go-ahead/no-go-ahead answers remain separate. Closed questions cannot receive
a new decision or be restored by thumb Undo. Record-owned decisions retain
their existing controls and authority.

Item 1239 replaces 1237's one-label presentation with no terminal labels or
card-author display projection. Shared question-state learning for reaction
eligibility stays, as do waiting/Resolve actions and resolution commands.
Author/time/edit/carries, star/update, withdrawal/removal and reaction owners
retain their content. The 1237 composition file now holds deliberate absence
through repeated cached paints; 932 covers the actual Reader origin and kept
question facts/controls. Native timing and live observations remain separate.
