# Cold hosted settings (1329)

`stage_destination_hosted(store, publication_receipt, request)` creates only
selected `ACTOR.hosted.json`, a hosted-only `routes.json` and `manifest.json`
in one exclusive new private folder. There is no runtime caller or adoption.

The exact v1 request fields are `v`, `output_root`, `output_dir`,
`profiles_request`, `profiles_result`, `profiles_manifest_bytes`,
`profiles_manifest_digest`, and `actors`. Each actor entry has `actor_id`,
`source_path`, `source_bytes`, and `cli`. Limits are sixteen actors, 65536
UTF-8 bytes per source config, and 2 MiB for the encoded request. Unknown or
duplicate JSON fields, aliases, unsafe components and overflows refuse.

The explicit confirmed 1326 publication must match the landed 1327 request,
confirmed `profiles_staged` result and exact private manifest bytes/digest.
The unchanged inspector checks profiles, modes, hashes, identities and empty
outboxes. Current authority/lineage, enabled actors and the original database,
authority-lock and runner-lock identities are rechecked. Newer commits are
valid. No predecessor private path, home, cwd, profile or journal is opened.

In a short transaction on the validated CURRENT database, read only each
explicit actor's strictly derived predecessor pin key. Its decoded binding
must match. Actor and old profile references must match the 1327 source
snapshot; the hosted destination must equal the authentic retained pin.
Missing/malformed/mismatched pins or recovered-origin ambiguity refuse.

Preserve exact supported v1/v2 settings, changing only `profile`, the explicit
trusted `cli`, and legacy `writable_roots`. The legacy database-parent/outbox
projection is serialized compatibility data, not an execution grant. Home,
thread, executable, cwd, model, permissions, effort and instructions remain
unchanged. The map names exactly the selected hosted subset. It is not an
installed or complete mixed map. No pin/control/plan writer, native thread or
startup preflight is invoked. Normal relocated startup may still refuse until
separately supported adoption; these files do not override that refusal.

Directories are 0700 and files 0600. Output is disjoint from profile output,
outboxes, authority/data/control and retained historical contexts. Flush and
recheck before the manifest, publish it last, flush again and read back exact
files. Existing/partial output is held, never repaired/replaced/deleted or
redirected. IO/flush/close/lost-response uncertainty is unconfirmed, including
when complete files are observable.

Success is `cold_hosted_staged`, `durability_confirmed:true` and
`requires_adoption:true`: durability describes only the artifacts.
`inspect_destination_hosted(request)` is bounded/read-only and reports
`not_started`, `hosted_incomplete` or `cold_hosted_observed`, always durability
false and adoption required. It does not confirm current authority or startup.

Broker configs/wrappers, mixed-map coverage, managed-seat files, home/cwd or
thread migration, owner/Stop/control/plan/settings adoption and consumer start
remain separate. Real authority/UID/service/adoption execution retains its
current-live-copy rehearsal, revert, independent read and Tony authorization.
