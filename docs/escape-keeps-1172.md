# Escape keeps typed changes (1172)

In an eligible writing field, Escape calls its existing Return owner and
finishes the field on success. It consumes that key; the containing sheet,
dialog or Reader remains. The next Escape, outside writing, may close that
container. One shared `keepOnEscape` adapter routes the key; it does not
synthesize another keyboard event or decide whether a command committed.
Owners retain async requests, retries, refusal reasons, history and focus.
A refusal or uncertain answer keeps the field and its exact words. Repeated
Escape while a save is pending cannot launch a second request.

Whitespace-only titles/new lines close without writing or creating. Notes,
Your part, purpose and item words may deliberately be emptied. Required stage
names retain their explicit refusal (“A stage needs a name.”); this is the
spec's named empty-stage exception. Escape and Return ignore both IME
isComposing and keyCode229. Existing modifier/newline rules remain.

The field inventory is the selected spec's 13 save groups and 9 create
groups; a group may have multiple concrete controls:

| Save group | Existing owner |
| --- | --- |
| Topic title (header/settings), Note, Your part | topic-state lineField and TopicStatePanel.save |
| Dossier name | reply-stacks renameField → StackFeed.rename/stack.name |
| Notebook page title | NotebookPage.endRename / existing1159 writing owner |
| Outcome purpose | PurposeLine.commit |
| Pipeline title | PipelinePage.saveTitle |
| Stage name, done-when, checked-by | PipelinePage.saveStageText |
| Held title | titleLine → PipelinePage.sendHeld |
| Set-aside reason | titleLine → existing move owner |
| Target writer | OutcomeTargets.saveWriter |
| Why it is reached | OutcomeTargets.sendReach |
| Outcome Link edit | WorkspaceLinks.submit |
| Item words on the item record | PipelinePage.saveWords |

| Create group | Existing owner |
| --- | --- |
| Rail topic / outcome | OneLine → TopicStart / OutcomeStart |
| Notebook page | NotebookCreate → OneLine / NotebookStart |
| Pipeline item / stage | titleLine → requestSubmit / existing submit |
| Pipeline item from a message | app.openPipelineAdd → titleLine |
| Topic from a message | app.openStartLine → OneLine / TopicStart |
| Notebook start line | NotebookStarts → OneLine / NotebookLinkStart |
| Ship-it-anyway reason | OutcomeTargets.sendAccept |
| Outcome Link | WorkspaceLinks.submit |

Inherited1165 rail topic creation keeps its one-time inline-writing route.
Inherited1159 title editing keeps the same notebook writer, access/conflict
checks and post-rename focus. No new command, view, schema or durable fact.

Blur saves the specified notebook title, purpose, target writer, reached
reason and Link edit. Focus moving within a multi-control form does not
submit before its topic/checkbox choice or explicit Cancel; leaving that
form uses the same save owner. Existing pipeline blur owners remain.
The phone things-sheet listener respects defaultPrevented and IME.

Excluded: message composition, replies, inline New message, publishing an
edit, Ask an agent, invitations/seats, finders/pickers and draft-saving
outcome/opening pages. Their CmdReturn/draft/dismissal owners stay intact.
The already-saving notebook card/text and pipeline-page words keep theirs.
