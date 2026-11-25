# Dossier positions once per read (1271)

Core remains the authority for message membership, visibility, positions, covers
and revision/exposure fences. This changes only the representation of an already
selected `topic_messages` or `stack_positions` response. No schema or page-window
change is made.

`capabilities.read_formats.dossier_positions` and the HTTP bootstrap advertise
`["root-table-v1"]`. A request may explicitly add
`position_format: "root-table-v1"`. Absent means the existing payload, unchanged;
other values are refused. An old capability selects legacy reads. Session renewal
adopts the new same-instance/person capability, including its absence.

The compact response has `position_format: "root-table-v1"` and
`positions: {ROOT_ID: FULL_POSITION}`. Each returned row replaces its full
`stack_position` with `stack_position_ref: ROOT_ID`. The position's `root_id`
must equal its key. A root row's identical non-null `acts.cover` may be replaced
by `acts.cover_ref: ROOT_ID`; all other acts, including distinct historical covers
on joined messages, remain complete. Cover contents and revision fields are not
recomputed by the codec. Only roots referenced by returned rows enter the table.

The page expands references from that response alone before existing consumers
see it. No previous root table supplies missing data. Unknown formats, missing or
unused roots, conflicting full/reference fields, wrong root identities and invalid
cover references fail the read. A complete legacy response is also accepted;
legacy output never contains references. Expansion returns the existing envelope,
including every message projection and revision, without transport fields.

Compact encoding follows the existing bounded selection and exposure marking.
If its envelope overhead would exceed the existing topic-message byte bound,
Core returns the already bounded legacy envelope rather than dropping another
row or exceeding the limit. Packing preserves marked strings until the existing
shared exposure boundary walks the final response. Access refusals and old-client
payloads retain their existing behavior. Response byte reduction is measured on
fixed serialized fixtures; it is not CPU, heap, actual network traffic or latency
proof.
