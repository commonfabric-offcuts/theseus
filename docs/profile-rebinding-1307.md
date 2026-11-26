# Guarded profile rebinding preparation (1307)

This is the judged preparation adapter for the proposed 1306 transfer interface
in Landing 27643. It performs no production action during development. Real
transfer integration, destination execution and adoption are item 1314. The
runner must stay stopped; this command never starts or adopts a consumer.

`python3 tools/rebind_profiles.py REQUEST.json` consumes an explicit v1 request:

- `staging_id`: a canonical UUID, retained with the exact request on every retry.
- `control_path`: a new private local directory under an existing 0700 parent.
- `activation_request_path`, `confirmed_result_path`, `source_handoff_path`:
  private local files containing the original opaque activation request, its
  expected successful 27643 result, and the original source handoff receipt.
- `profiles`: an actor-to-original-profile-path mapping, including the runner.
- `runner_actor`: the runner's actor in that mapping.
- `route_map_path`: the original explicit v1 route map; no directory discovery.
- `broker_executable`: the selected executable for any broker routes, or null
  when the map contains only hosted routes.
- `states`: every selected actor's `{enabled, stopped, blocked}` observation;
  blocked is null or an explicit reason. These observations are retained, not
  used to change Core's Stop/control facts or to authorize dispatch.

All selected files must be canonical, private regular single-link files owned
by the actual executing account. Source numeric UID/GID is not preserved. SSD
transport must already have been copied into private local destinations by the
reviewed staging workflow. The adapter does not copy a store or change authority.

Before any profile/config output, the adapter calls
`aim_next.transfer.activate` with the SAME complete original request. This is a
mutating durable confirmation call. Every proposed envelope field must equal
the pinned expected result, including source commit/history, handoff/bundle and
destination identities and the five-field binding. Observation-only readback,
partial results, false durability, stale authority and changed input refuse.
The opaque request's digest algorithm remains transfer-owned; the adapter also
pins the exact input file bytes in its own intent. It never invents an activation.

Outputs are exclusive siblings suffixed `.rebind-<staging_id>`; profile parents
stay the same, so the CLI's default `actor.outbox` path stays the same. Only
declared profile/config/map path fields and hosted writable roots are updated.
Original files, outboxes, request/receipt bytes and Core records remain intact.
Use `profile.write_profile` for new profiles and existing route validators for
each selected route. A route pin/runtime refusal is reported as blocked; a
valid profile is not a claim that its copied native thread has been adopted.
Duplicate physical destinations refuse. Disabled, stopped and known blocked
routes remain explicit; no ready runner map is claimed while any route is held.

A private intent pins the entire request, input hashes and output hashes before
creation. One local lock serializes this staging ID; it is not a cross-host
writer fence. A complete existing file may be reconciled only under that exact
intent, with matching bytes/private metadata and fresh full flushes. A partial
or conflicting file is retained and refuses; it is never deleted or overwritten.
Each retry reconfirms transfer first. The final manifest is published last, after
file/readback checks and an unchanged-input check. Checked Darwin full flushes
are required; uncertainty is retained, never represented as completion.

Receipts contain hashes, actor/status and paths only, never profile contents or
credentials. The command's final `staged` result means a prepared set exists,
not installation, authority approval, native adoption or one live consumer.
1314 must use the real implemented 1306 result, validate the destination account,
and perform actual integration before Warp adopts any staged path. 1310 owns
the actual consumer starts. No fixture result authorizes production rebinding.
