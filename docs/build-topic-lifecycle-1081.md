# Build topics follow their work (1081)

Pre-edit contract. Core8 owns this piece under Warp17503 and Fable17514,
canonical piece p-1cff75cddde04809bee12d74. Intake is actual release347,
7b890758f36e5dc30fbf6c27594b75f64626ef92, schema65. Own branch is
core-lane8/1081-topic-lifecycle-347. 858 and1071 remain frozen.

The default is shared Core topic state, for every permitted reader, including
a member who has never opened the topic. It is not personal browser hiding.
An actual release record makes its completed build topic Done. A bound topic
whose work is set aside into Candidates or Later is archived until work starts.
Starting a new piece unarchives its build topic and reopens a completed topic.
An active piece, including work combined into a release awaiting shipment,
keeps its topic open. A partial shipment cannot close a topic with other work
still outstanding. Stage approval, a frozen head, a successful check or an
estimate never substitutes for the release record.

Scope uses Core's existing agent-created, ordinary-kind pipeline-piece topics
in the same outcome. It does not infer a build relationship from a title,
number in prose, source message or a person's topic. Conversations and ordinary
unbound topics keep their current state, archive, ownership and audience rules.
No migration, new admission rule, stage gate, command or durable shadow binding
is planned. The final frozen paths determine ordinary/judged classification.

The existing owners are Pipeline._settle, _ship_release, piece_start,
item_move/set-aside and piece_move, plus TopicState._set_topic_state and
_message_activity. Existing pipeline facts, release records and derived member
rows stay the authority. Topic changes go through _set_topic_state so versions,
waiting-row archive flags and scoped changes stay coherent. No read mutates a
topic. A release's existing transaction keeps its record and topic transition
together. Repeated/no-op synchronization must not churn topic versions.

1081 deliberately replaces the pipeline-owned Ready for review default for
shipped build topics. Their system-owned Done must survive an agent's shipment
announcement. The normal manual Done/message-reopen rule for other topics
remains. Explicit manual state given after a pipeline transition keeps its
existing meaning; a genuine later piece start can open its build topic again.
Archive of a parked topic does not claim it is Done, resolve an ask, complete
an item, erase a diagnostic or change participants/history. Starting a candidate
still refuses NOT_IN_NOW: the candidate/later test uses an existing binding
whose piece is set aside, rather than inventing a pre-start binding command.

Within pipeline.py this piece changes topic lifecycle synchronization and its
start/move hooks. Core7 owns1087's combine/admission/producer-context work,
including _command_pipeline_combine;1081 will not edit that method or any guard
tool. Shared-file composition remains explicit for the independent carry read.

The eight old shipped topics in Tony17149's report have no pipeline-piece
membership in their current item records. They must not acquire fabricated
piece history. A separate exact proposed one-time reconciliation list will
name each topic, current version/state/archive, item release and record basis.
Fable17514 requires independent review of that list before any live cleanup.
The initial named eight are965/241,955/247,951/238,947/242,950/237,827/220,
940/218 and941/214. They currently read active and archived. The proposal is
Done and unarchived, placing them in Done. No cleanup has run.

952 is different: the canonical item remains Later and its diagnostic piece
is set aside under Warp14569, with its history and open-sighting condition.
The proposed archive of that diagnostic topic preserves its state/note and
does not complete952, reopen its work or run another diagnostic. The older
already-archived952 topic is a distinct historical topic; its title alone
cannot make it shipped. All unrelated topics are excluded from the named list.
Legacy unbound topics retain ordinary manual reopen behavior after cleanup;
only real pipeline bindings get the durable automatic rule.

Named scratch Core/CLI checks will first record actual-base failures for:

- Shipment closes the bound build topic for a member who never opened it,
  with the same Done state and rail grouping for other permitted readers.
- Candidate and Later set-aside archive the existing build topic; starting
  a new piece opens it again without deleting the prior set-aside evidence.
- Approval and combine awaiting a record, partial shipment and ongoing work
  preserve the open topic. New work in a previously shipped topic reopens it.
- The shipment announcement preserves pipeline-owned Done; ordinary/person
  topics, manual state and ordinary message reopening keep their own rules.
- Public Core/CLI reads expose the same state; stale revision, permission,
  wrong-outcome and refused pipeline changes cannot partly move the topic.
- The reconciliation proposal is exact and reviewable, preserves952 and
  other topics, and is not applied to live data by a test.

After the focused checks pass, run the relevant existing pipeline, topic-state,
release and steering cohorts, retaining every real failure and actual exit.
Apply the actual old product owners in the own worktree and observe the named
checks fail; restore the exact corrected bytes with fresh pycache/evidence roots
and rerun the focused control. Freeze at meaningful green; push only the exact
source branch and publish head/tree, tests/pass/fail and raw evidence to Warp.
No browser/native fixture is planned for this Core slice; no gesture or visual
timing claim follows from Core/CLI checks. Load over12 on18 cores starts no
substantial cohort. Fable owns canonical stages and reviewed live cleanup;
Warp owns the independent read/carry. No landing during the in-flight Links run.
