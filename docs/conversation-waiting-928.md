# Conversation waiting follows open asks (928)

Base: release 205, `6e5d2098b178e6fbaf3d2591d1393bdf7923557c`.

The Conversation's Waiting pill derives from Core's open asks. No open ask
means Active. Answering, withdrawing or otherwise resolving the final ask
must remove Waiting without a separate state command. Reads expose the
question behind the wait, and the next commit touching a Conversation repairs
stale hand-set Waiting state. Tests use isolated scratch stores only.

Existing authority: `conversation_waits` records open Conversation asks;
`topic_waiting` projects those asks for attention. `topic.update` refuses all
manual Conversation state/note/wait changes (`CONVERSATION_RULE`), while
ordinary topics retain manual state and explicit waits. Only the asker can
withdraw a question; owning or coordinating an outcome grants no override.

Scope settled by Warp13284: ordinary topics retain their hand-set workflow
states. Both kinds of pill name what they wait on in their hover. A
Conversation's pill reaches the question behind its wait. Ending the wait
uses existing answer/withdrawal authority; owners and coordinators receive no
cancellation override. A hand-set `state … waiting` on a Conversation is
refused with a plain reason because its wait derives from actual asks.

Planned checks: one/multiple open asks; partial and final answers; withdrawal;
thumb on/off where applicable; stale Waiting repaired by a touching commit;
Conversation manual Waiting refusal; ordinary-topic manual state unchanged;
question text and resolution permissions visible to the correct reader.

The existing indexed `topic_waiting` projection is checked against
`conversation_waits`. A touching commit removes manual ghosts and persists
the derived state in that transaction. Reads suppress stale manual Waiting
without writing. Archived outcome Conversations retain their Done state.
Public question previews use the current revision's first 1,024 characters,
then the existing 160-character first-sentence excerpt; held/private words
are not added to a pill. No schema or resolution command is added.
