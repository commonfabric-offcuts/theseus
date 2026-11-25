# Sequence in the send receipt (1261)

Core already allocates the message sequence when publication inserts the message.
Return that same integer as `result.seq` from the shared publication result;
`message.send` keeps it alongside `submission_id`. Topic opening and other
existing publication callers carry the same additive result field. No schema,
request shape, binding or protocol-version change is needed.

This is the committed message sequence, not the submission.prepare sequence,
commit cursor, topic version or a later source lookup. The original operation
and its recorded result remain authoritative. Repeating the exact request
returns the stored result without another publication or a computed enrichment.
A historical recorded receipt without seq stays without seq. Refused or unknown
operations acquire no invented message/sequence result.

The page already checks a positive safe integer receipt seq. For an unloaded
canonical message that skips only the conditional source read; the existing
bounded topic_messages read still supplies and authorizes the canonical card.
Missing/invalid old receipt seq retains the current source fallback. Loaded
canonical messages need neither read. Current binding/access/navigation fences,
placement and original send identity remain in their existing owners.

Focused proof uses actual prepare/send/store/replay/recovery results in an
isolated database and the actual app placement function with supplied read/DOM
ports. It distinguishes message and submission sequences, additive publisher
callers, old receipt replay and operation rejection/unknown truth. Page controls
cover usable/missing/invalid seq, loaded/unloaded cards, malformed source and
late access/navigation. These modeled ports establish selected calls and fences,
not native focus, scroll, image behavior or measured latency/CPU savings.

The source base is live445/b3b67eaa. Reconcile actual live before carry and
preserve1273/1270 as they land. Rule9 focused shipping, Warp source/direct
comparison, Fable exact freeze and empirical measurement remain separate.
