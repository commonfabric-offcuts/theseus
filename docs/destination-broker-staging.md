# Cold queue broker settings (1331)

`stage_destination_broker(store, publication_receipt, request)` is a dormant
internal library with no runtime caller. It exclusively creates selected
`ACTOR.broker.json`, `ACTOR.route.json`, a broker-only `routes.json`, then
`manifest.json`. All results require separate adoption; no consumer starts.

The exact v1 request keys are `v`, `output_root`, `output_dir`,
`profiles_request`, `profiles_result`, `profiles_manifest_bytes`,
`profiles_manifest_digest`, `actors`. Each of 1–16 actor rows has `actor_id`,
`source_route_path`, `source_route_bytes`, `source_config_path`,
`source_config_bytes`, `broker_executable`. Each snapshot is at most 65536
UTF-8 bytes; the full encoded request is at most 2 MiB, manifest 4 MiB and
output 2N+2 files. Unknown/duplicate JSON fields, aliases and overflows refuse.
Historical normalized absolute paths/executables are data, never opened or
resolved. Only the explicitly selected NEW broker executable is checked by the
unchanged executable/ancestor trust policy; source Codex installation is not
certified by cold generation.

Require confirmed1326/current immediate lineage and exact landed1327
request/confirmed result/manifest raw bytes and SHA256. The unchanged inspector
checks actual profile bytes/modes/identities and empty outboxes. Current
publication/binding, enabled/non-ending actors and all THREE original
DB/authority-lock/runner-lock identities are rechecked; later commits are valid.
Read only each selected actor's strictly derived predecessor pin key from the
supplied CURRENT DB; compare the entire decoded binding and exact QUEUE
destination, then close before output. This is a SELECT-only application
callgraph; unchanged `_connect` uses mode=rw, not engine-enforced readonly.

Both old route/config profile references must equal the actor's1327 source
profile. Source route v1 is exactly `{v,profile,argv}` with three argv elements
`[historical_broker,"--config",source_config_path]`. Broker config v1 is exactly
`{v,profile,codex_executable,destination}`; destination is exact queue kind,
protocol1, normalized absolute home and canonical thread UUID. Preserve the
source Codex executable/home/thread/protocol. Change both profile references
to the manifested destination profile and regenerate route argv as the JSON
array `[explicit_trusted_broker,"--config",absolute_new_broker_config]`.
Never concatenate a shell string, accept arbitrary extra args, infer a pin,
consult same-binding recovery or replace a complete mixed map with this subset.

Use one new private0700 direct child of the canonical private output root,
disjoint from authority/media/control, source route/config/profile/outbox/home
contexts and the1327 output. Existing or partial folders are held unchanged;
no overwrite/repair/delete/redirect/new-name retry. Private0600 files are
created exclusively and fully flushed; manifest is last. Recheck authority,
actors, pins, profiles and file observations through final confirmation.
Write/flush/close/response uncertainty stays unconfirmed even when files exist.
The result is `cold_broker_staged`, `durability_confirmed:true`,
`requires_adoption:true`, with `output_dir`, `manifest_path`, `files`.

`inspect_destination_broker(request)` is bounded/read-only and returns
`not_started`, `broker_incomplete` or `cold_broker_observed`, always
`durability_confirmed:false`, `requires_adoption:true`. It checks the exact
request/profile provenance/saved pin context, file bytes/modes/identities and
manifest file set; it grants neither current-authority nor durability/startup.
Normal relocated startup MUST still refuse without supported adoption. Existing
pins/control/owner/Stop/Continue/plan/settings/profiles/outboxes/saved requests
remain unchanged. Native queue/service/account/UID transition, physical home
alias safety and complete mixed-map activation remain separate judged work.
