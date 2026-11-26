# Batched change windows (1296)

The existing `changes` view accepts either its unchanged single `scope` and
optional `cursor`, or `windows`: one to `page_max` distinct `{scope, cursor?}`
objects. A batch cannot also name a top-level scope or cursor. Each window
keeps the canonical actor/topic/workspace cursor and rechecks current access.
One refused window refuses the whole read. No writes or schema changes occur.

The optional `limit` is a per-window limit, capped at
`floor(page_max / number_of_windows)`. Total returned change keys therefore
never exceed one normal page. Every window keeps its own fixed continuation
frontier; new checkpoint windows share the transaction's committed frontier.
The whole response, including projections, must fit `summary_utf8_bytes`.
An oversized projection refuses rather than returning a falsely complete page.
Callers retain their input cursors and may retry without projection.

The response contains `windows`, `topics`, `counts`, `affected_topics` and
`attention_changed`, in addition to `instance_id`. With `project: true`, only
changed topic rows from named authorized workspace scopes are projected,
including the reader's delivery/read-mark effects. Topic rows and workspace
counts use the existing canonical owners; another actor's private keys and
counts are never read. The optional `attention_counts` contains the current
actor's unread/addressed totals and the snapshot `commit_seq` when ordinary
delivery or read effects require counts but not the full attention refresh.
Named deliveries and waiting/participation/question/withdrawal keys set
`attention_changed`. The canonical `attention` response also gains its
snapshot `commit_seq` so consumers can fence count updates consistently.

This server capability does not change page refresh, loading, scroll, writing,
or operation retry owners. Those consumers are later pieces. Its focused
empirical evidence records actual requests, frontiers, JSON bytes, elapsed
values and separate SQL/VM work on isolated unchanged fixture inputs.
