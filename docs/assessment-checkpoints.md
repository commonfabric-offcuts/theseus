# Artifact checkpoints (405 follow-through)

A checkpoint series is an explicit owner/coordinator policy for one named team,
assignment and public topic. It records the next expected artifact, due time,
observations, known waits and an assessment threshold. It never judges an agent
from elapsed time, a turn count, message prose or a queue alone.

Core commands use the normal bound envelope and operation identity:

A reached outcome is final: creating, observing, prompting or closing a checkpoint
there is refused with `OUTCOME_REACHED`. Existing records and observations remain
readable. This rule applies explicitly even though checkpoint changes use actor
scope rather than topic scope.

- `checkpoint.create`, targeting `topic_id`, takes the same assessor, team,
  assignment, sources and operator as `assessment.request`, plus `artifact`,
  `due_ms` and `miss_limit` (2–10). This explicitly authorizes an assessment after
  that many consecutive evidenced misses or repetitions of the same named fault.
  Identical active policies coalesce; changed policies require closing the old one.
- `checkpoint.observe`, targeting `checkpoint_id`, is the named operator's act.
  It requires `expected.checkpoint_revision` and arguments `observation_id`,
  `status` (`met`, `missed`, `waiting`, `unknown`), `note`, `evidence_message_ids`,
  `wait_kind` (`none`, `human`, `tool`), `fault_key` (null or a stable identifier),
  `next_artifact` and `next_due_ms`. Evidence is at least one public source in
  the original topic, readable by the operator and assessor. A missed commitment
  cannot be recorded before its due time. Human/tool waits are recorded as waiting,
  never as misses; unknown and waiting preserve, but do not increment, the count.
  A met artifact resets consecutive misses. Only a missed observation may name a
  recurring fault. The next artifact and due time must be supplied even when the
  observation triggers assessment, preserving the proposed next useful step.
  Observation ids are write-once: an identical retry, even under another operation,
  returns its first result without counting twice. A changed retry is refused.
- At the adopted threshold Core atomically creates (or reuses) one assessment
  request and closes this series to further observations. The report remains the
  fresh assessor's work. The existing dispatcher executes that request, and the
  operator records `assessment.renew` after the report. A next increment needs a
  new explicit checkpoint policy. No agent is restarted or replaced by this act.
  If the assessment was explicitly abandoned without a report, the organizer may
  adopt a new policy; a nonexistent report cannot require a renewal decision.
- `checkpoint.prompt` is an explicit operator/owner/coordinator act. Once due,
  it posts one reminder per checkpoint revision in the original named topic,
  addressed to the operator. It asks for evidence and known waits, and expressly
  does not declare a failure. Identical retries return the same message. Prompting
  does not change the checkpoint revision or count as an observation.
  The reminder preserves topic state, reading/folding state and waits. Only its
  explicitly addressed operator receives pending work; other readers can see the
  public record without being woken by subscription.
- `checkpoint.close` requires the expected revision and a reason. The named
  operator or current owner/coordinator can end an open policy without assessment.
  The record/history remain readable; staffing and ongoing work stay unchanged.

Views `checkpoint`, `checkpoints` (own operator scope, optionally a readable topic),
`checkpoint_observations` and `checkpoints_due` are paged. Due work uses a bounded
index for the calling operator, and caller-supplied `before_ms` cannot exceed now.
No view mutates records, prompts, launches an assessor or scans unrelated history.
Checkpoint metadata changes stay in actor scope, where the coordinator reads them;
ordinary topic changes from reminder/report messages keep the topic feed current.

This is the durable policy and due-work interface for the existing coordinator's
loop. It does not install a new background scheduler or infer an assessment request
from an ordinary post. The first manual assessment candidate can ship separately.
