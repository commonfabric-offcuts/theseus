# Refresh a dossier cover (Pipeline 738, preview only)

Pressing the cover's refresh glyph asks its writer to rewrite it using the
latest facts in that dossier. The existing cover stays whole. The glyph is an
activity indicator until Core records a real, changed `stack.cover` revision
after the revision observed by the request. A reply, delivery acknowledgement,
owner's automatic Done revision, no-op write or elapsed time cannot complete it.
The indicator means awaiting a cover, not that an agent is running.

`stack.cover_refresh` targets the dossier's first `message_id`, takes empty
`args`, and requires `expected.cover_revision`. CLI `cover MESSAGE --refresh`
uses the same command as HTTP `/api/command`; `dossier_cover`, message acts and
stack positions carry the same Core-owned refresh state. The ordinary operation
receipt deduplicates retries. Core additionally coalesces all pending requests
for a root across actors and tabs. Once completed, an attempt on its older
observed revision is refused rather than prompting again.
The pending operation identity, requester, observed revision, recipient and request
message are durable in append-only act history. Nothing schedules another prompt on a timer.

Core publishes one attributed request through the existing `_publish` path,
with its addressed delivery, wake eligibility and recovery. It is a reply in
the dossier, private between the same two people when the root is a whisper.
All ordinary topic reach, private message reach, closed outcome and publication
checks apply. No model call, route discovery or scheduler is introduced.

Recipient default: the recorded current cover writer, when enabled, an agent,
and still able to read this dossier root as the same root. Otherwise use the
outcome's explicitly configured coordinator, under those same checks. Neither
the dossier's human author nor an arbitrary team member is a fallback. A request
to oneself is refused because the normal delivery path does not deliver to its
sender. No eligible recipient is an honest refusal, with the cover untouched.
An absent/failed wake route leaves durable pending work; the request message is
reachable from the indicator. Core does not claim a writer has accepted it.

Schema 48 adds topic-owned `cover_refresh` acts and a separate writer record.
Existing cover
values, attribution, history, waits, payload kinds/links and owner-only Done are
unchanged. Historical writer attribution is reconstructed from the last cover
revision whose non-Done content changed (including `done_by`), rather than an
owner's automatic Done revision. Subsequent changed cover writes record the
writer explicitly. A changed write by an agent, leaving a nonempty cover,
completes pending refresh in the same transaction; human edits cannot stand in
for a writer's response. A newer agent with existing cover-write access may take over the cover.
Clearing the cover while pending leaves only the request indicator, without
restoring cleared content.

No-op rewriting cannot prove an update and remains pending. There is no cancel,
reassign or resend command in this preview: route repair uses existing delivery
recovery; changing recipient after a durable request remains an unsettled
product choice. A dossier joined elsewhere keeps its old request in history;
it cannot be completed by a write to another root.

The coordinator hosts this candidate on copied data without agents. A press can
therefore prove durable pending and reload continuity only after Tony tries it;
completion awaits the real writer pathway. This source-only stage writes/runs
zero tests and runs no server, browser, suite, pool work or review. Pipeline 737
links and 717 promises remain separate; this slice retains this base's cover
contracts without copying either worktree.

The browser keeps an unconfirmed command under its instance, actor and root,
with captured authority, before sending it. It retries that exact envelope; a
recorded refusal releases it for a new deliberate press. A changed authority
never silently rebinds it. Storage refusal sends nothing. Cross-tab races are
coalesced by Core in its write transaction. These mechanisms are untested here.
