# Read one original operation after relocation (1328)

`lookup_relocated_operation(store, actor, saved_request, publication_receipt)`
is a dormant internal reader. `store` is the caller's already valid current
Store. No CLI, broker, server or runner calls this library automatically.

`saved_request` is the intact original `{v:1, binding:..., command:...}` CLI
wrapper. Its binding keeps the original actor, instance, DB path and authority
ID/epoch. Its command, expected authority, operation ID and writing are never
rewritten. The original envelope fingerprint uses the unchanged command
validator and canonical JSON encoder used by Store command deduplication.

`publication_receipt` is the retained confirmed 1326 `published` result, with
`durability_confirmed:true`, destination binding, move ID, request digest,
journal path, historical cutover metadata and observed commit. It is checked
against the CURRENT validated active anchor's relocation lineage. This reader
does not turn an observed publication into a confirmed one or authorize a move.

The source is exactly the immediate predecessor recorded by that anchor.
Older/unlinked epochs refuse; no graph search or old-path discovery occurs.
Current authority/DB/stable-lock identities remain checked under a shared
authority fence. The runner-lock identity is checked without taking its
exclusive runner role, so a live destination runner need not stop. A second
validation after the indexed actor/operation read detects replacement or lineage
change. Later destination commits are permitted; historical cutover metadata is
never compared to current application bytes or used as an inactive-data oracle.

Only the same currently enabled actor can read its original operation. The
existing operation view receives a mandatory ORIGINAL expected fingerprint.
An exact recorded committed or rejected receipt is returned unchanged, along
with that fingerprint and the observed transition reference. Missing is
`unknown_held`, with `replay_allowed:false`; it does not establish that an act
never happened. Conflicting fingerprints, foreign actors/instances/epochs,
receipt mismatches, missing lineage and identity/race failures refuse. Busy and
unconfirmed close/read outcomes remain explicit, never cached as missing.

Reads do not create, flush, repair, rewrite or acknowledge anything. No command
or retry is sent, no local receipt/outbox is written, and no old source DB,
anchor or journal is opened. Original owner, Stop/Continue, control/plan
revisions and saved requests/results remain untouched. The returned transition
is an observation attached to a read, not authority to replay an old act.

Original same-owner cutover retry/readback remains bound to its recorded UID
and old private locks. This reader uses current authority instead and does not
weaken those validators. Supported ownership/service handoff, profile/route and
consumer adoption, real second-UID acceptance and any post-transfer publisher
continuation remain separate. First real execution/adoption still requires the
judged current-live full-copy rehearsal, revert proof, independent run read and
Tony authorization. Temporary fixtures do not prove an account move.
