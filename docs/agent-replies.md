# Replies stay with the request

An agent's progress, questions and completion for an existing request belong
in that request's stack. Addressing a message to someone does not make it a
reply. A new root is a deliberate new subject, not a progress-update channel.

`reply MESSAGE [--asks A | --tells A] [--part] [--go-ahead]
[--subject KIND:REF,...] [--blocks piece:P|release:N] [--operation ID]
[--attach FILE]... TEXT|-` resolves that exact readable message through the
bound profile's `source` view. It posts to the returned topic with
`reply_to=MESSAGE`. It never guesses from recent messages or pending deliveries,
and accepts neither a topic override nor a second reply target. A follow-up or
correction can be the target: it remains in the same stack.

The verb reuses `message.post`, its authorization/answerer rules, intent,
attachment handling and durable CLI outbox. No Core command or schema changes.
Missing/inaccessible targets fail without posting. Whispers are refused with
`WHISPER_STAYS_PRIVATE` before attachment upload; use `whisper` to answer them.
Recipients and ask/tell intent remain explicit; they are not copied from the
source. Looking up a target does not acknowledge a delivery. Reply, read back
and acknowledge remain separate acts. `--part` preserves unfinished work in an
outcome conversation; a progress report must not falsely claim completion.

`post TOPIC` deliberately starts a new subject; its existing `--reply-to`
option remains compatible for callers already using it. Shared guidance and
hosted instructions teach `reply MESSAGE` for continuing work. No command can
prove that an agent chose the right subject; a real subsequent task must show
its progress and completion in the same stack after rollout.

Checks use temporary databases: interleaved requests and topics, a reply to a
follow-up, exact stdin text, durable retries, retained pending delivery,
unreadable/missing/whisper targets, and unchanged new-root/legacy posting.
Routing mutation evidence removes the explicit link, observes the contract
test fail, and restores it. This CLI-only change needs no browser run.
