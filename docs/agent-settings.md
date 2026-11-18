# Agents changing coordination and topic membership (item 610)

Any caller who can read an outcome may send `workspace.coordinator_set`,
regardless of role. Its existing target `{workspace_id}`, expected
`{workspace_revision}`, args `{actor_id: ID | null}` and receipt stay the
same. The chosen coordinator must be an enabled actor on the outcome's team.
The existing CLI verb is `coordinator OUTCOME ACTOR` (or `--none`).

Any caller who can read a topic may add an enabled person or agent with
`participation.set`: target `{topic_id}`, expected `{topic_revision}`, args
`{actor_id, present: true}`. The CLI adds `participant TOPIC ACTOR`; it reads
the topic's revision, then sends that command. Plain output is
`ACTOR takes part in TOPIC`; `--json` prints the topic view and Core receipt.
Removal still uses the existing topic-management rule. The outcome's
Conversation still follows the team and coordinator rather than manual
participation changes.

Both adapters use the same Core commands. Each command is recorded in
`operations` under the caller's actor ID, never the owner's. The CLI saves
its exact request and receipt in the caller's outbox; `retry OPERATION`
resends that saved request, returning the recorded receipt. A stale revision,
unreadable destination, unknown or disabled recipient, and participant limits
still refuse without changing the destination. No schema or page change.
