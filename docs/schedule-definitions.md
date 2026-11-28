# Inactive schedule definitions

Core accepts `schedule.save` from a bound actor. The target is
`{"schedule_id":"<stable-id>"}`. Supply `expected.schedule_revision` as
zero to create the schedule, or its latest revision to append a revision.
The actor creating the schedule owns it. A retry uses the same operation
ID and receives the original receipt. A new operation with a stale
expected revision gets `REVISION_CONFLICT`.

The command takes this shape:

```json
{
  "active": false,
  "timing": {"kind": "once", "at": "2026-11-28T09:30:00-08:00"},
  "agent_id": "<enabled-agent-id>",
  "source_ref": {"kind": "message", "id": "<source-id>", "revision": 1},
  "prompt_ref": {"kind": "memory", "id": "<prompt-or-task-id>", "revision": 2},
  "config_ref": {"kind": "memory", "id": "<config-id>", "revision": 1},
  "reply_target": {
    "topic_id": "<destination-topic-id>",
    "message_ref": {"kind": "message", "id": "<parent-id>", "revision": 1}
  }
}
```

The timestamp carries seconds and a known UTC offset (`Z` or signed
hours and minutes). It may have up to three fractional digits. Core
keeps the entered timestamp and derives `due_ms` in UTC. The three
input references may each point to an exact message or Notebook
revision. A reply target names a topic and either an exact message in
it or an explicit null `message_ref` for the topic itself.

The owner and the agent must both be able to read the inputs and the
destination. Core applies normal topic and source reach and refuses
removed or held messages and draft or deleted Notebook pages. Older
readable revisions are valid pins. A later edit leaves the stored
revision number intact. Registration reads only source metadata by
identity. It loads no source words, files or topic history.

The receipt names `schedule_id`, `schedule_revision` and `due_ms`.
The owner reads the definition through `schedule_definition`, with
`schedule_id` and optional `schedule_revision` (defaults to latest).
The view rechecks reach and returns the saved inputs with the receipt
fields, `instance_id` and `registered_ms`. An unavailable identity or revision
returns `FORBIDDEN`.

Schema 72 → 73 uses `SCHEDULE_UP` to add schedule identities, immutable
definition revisions, and a run identity table. Each run identity pins a
definition revision and is unique for the schedule and logical slot.
There is no command to create a run or activate a definition in this
slice. Registration produces no automatic send, delivery or wake.
`SCHEDULE_DOWN` drops the three empty tables in dependency order.
`SCHEDULE_OCCUPIED` refuses the downgrade if any of those tables hold
a record.
