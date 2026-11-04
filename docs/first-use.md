# Retained first-use operations

This is the operator procedure for one separately configured Theseus instance.
It does not install or start anything. A local activation receipt supplies the
actual paths, revision, port, IDs and results. Existing AIM remains available;
no migration, legacy data access or legacy wake-route change is part of setup.

## Prepare one instance

Use a new canonical private root outside the repository's temporary test data.
Record the selected database, authority, instance ID, actor IDs, profiles and
operation IDs before their respective acts. Preserve incomplete artifacts;
never adopt a directory because it looks empty or retry setup with invented
identities after an uncertain result.

The existing initialization API is
`aim_next.store.initialize(db_path, instance_id, initial_actors,
authority_path=authority_path)`. It exclusively creates the authority and
database and returns a result containing `binding`. `initial_actors` is a list of objects with
explicit `id`, `kind` and optional `name`. Save new private actor profiles with
`aim_next.profile.write_profile(path, db_path, instance_id, actor_id,
binding=result["binding"])`. Existing profiles are never overwritten. Initialization and
profile publication failures require inspection of the preserved result and
paths, not deletion and blind repetition.

For the initial configured workspace, aim-lead performs setup through its own
profile and owns the workspace. Tony and the selected reply agent belong to its
team; Tony is also explicitly included as a topic participant. Workspace
ownership transfer is staged. Ordinary reading/replying uses team/topic access.
All introductory messages are actually lead-authored. Setup and pre-handoff
probes do not perform acts through Tony's profile.

Use retained command envelopes for `workspace.create`, private opening draft,
preparation and `topic.create_and_send`; inspect each committed result before
depending on it. Read back the workspace, topic, participants and applicable
Notebook guidance through the lead CLI. The [CLI contract](agent-cli.md) defines
envelopes, binding capture, original-operation lookup and separate acknowledgment.
The CLI has no initialization or binary-upload verb.

Prepare a new private route map/config/profile for the selected agent using the
[Codex broker contract](codex-broker.md). Provision its immutable route pin under
the Core runner guard before starting effects, release the guard, then compare
the selected map, config, profile, actor, destination and pin. Never reuse a
fixture pin or discover a destination from ambient state. This config connects
only the named agent; it is not evidence that every AIM agent is reachable.

## Start and retain process ownership

The supported process entries remain foreground programs:

```sh
bin/aim-next-server --profile /absolute/tony-profile.json --port CHOSEN_PORT
bin/aim-next-runner --profile /absolute/lead-profile.json \
  --runner-id CHOSEN_RUNNER_ID --routes /absolute/routes.json
```

The operator selects a free loopback port and retains that origin across
restarts. Port `0` is useful for isolated trials, but a retained browser journal
needs a stable origin. An occupied explicit port refuses startup; do not stop
its existing owner. This initial path is local to the Mac; remote/mobile access
is staged. Do not widen the bind to make the URL reachable elsewhere.

For the retained instance, launch each entry in its own detached session with
closed input and private retained stdout/stderr logs. A foreground process
inside an agent tool session, or a successful launch call alone, does not prove
it survives the chat turn. Record and check the actual process after launcher
exit. No service, login startup, crash restart or general supervisor is included.

Keep an exclusive private run record containing source revision, exact argv,
profile and authority binding, port/runner ID, PID, start identity, executable
and log paths for each owned process. Confirm these observations against the
actual processes. Preserve prior run records rather than overwriting them.
If recording or ownership confirmation fails, resolve that launch before
starting another; do not leave an untracked process or claim startup succeeded.

The server's ready line reports its instance, actor and listen address; compare
the full authority binding separately through the saved profile/CLI. The
runner's ownership event establishes its acquired lease. Neither establishes
that an agent received or answered a message. A wake acceptance and the
recipient's separate `delivery.ack` remain different records.

Before handing over, verify scoped views through the lead CLI, save and inspect
an initial backup, and record actual process/binding observations. The frozen
connected-checkpoint receipts supply the existing interaction proof; setup is
not permission to replay test conversations in the retained instance.

Give Tony the ordinary topic URL, without a bearer token. Its normal HTML
response establishes his in-memory session. Any local process fetching that URL
receives that session too: agents must not open Tony's personal page or capture
its HTML/token as a probe. This is the existing trusted-local posture, not a new
authentication guarantee. Lead-profile CLI reads are the pre-handoff probe.

## Stop, inspect and resume

Compare a saved PID with its current start identity and executable/argv before
signaling. If identity differs or cannot be established, stop the procedure;
a PID alone does not authorize signaling a replacement process. Send SIGINT or
SIGTERM only to the owned HTTP/runner entry, never a discovered browser or a
broad process group. Confirm actual exit, retained runner cleanup result and
port release. A signal sent, a stale run record or a remaining durable lease is
not proof of current process state.

The [effects runner](effects-runner.md) stops new claims and preserves the
current invocation's cleanup deadline. Exit `0` is graceful stop; `75` means
idle ownership was lost and requires a fresh process after bounded backoff.
Exit `2` requires inspection of the final JSON status line; the exit code alone
does not distinguish a persisted pause from `fatal_unsaved` or another refusal.
A persisted pause is not cleared by restart:
resolve its cause, read its current version, then deliberately use
`--resume-version INTEGER`. `fatal_unsaved` means even the attempted pause
could not be confirmed; preserve the logs and inspect before any restart.

The lead operator owns noticing and reporting process exits. The activation
receipt must name the actual exit observer, or explicitly disclose that exit
status is checked at operator checkpoints with no immediate-alert guarantee.
No automatic restart follows either arrangement. After runner exit, new agent
wakes wait for a deliberate restart. If HTTP remains running, Tony can still
read and commit permitted sends; pending deliveries remain in SQLite, but no
recipient consumption or timely answer is implied.

A Codex app update can change the broker's guarded version token and stop
queue operations. Compare the refusal with [the compatibility contract](codex-broker.md)
and review the new protocol before changing that guard. Do not extend budgets,
rewrite pins or create new attempt IDs simply to make a refused wake pass.

## Preserve uncertain acts and recover explicitly

For a send whose outcome is unknown, retain its original operation, exact
writing, source revision, audience and attachment references. Look up that
operation through its original bound profile. A timeout is not a refusal, and
a new ID is a new act. Do not overwrite a newer draft with the older frozen
submission. Local upload histories are governed by their delivered UI contract;
do not claim that a database backup contains uncommitted browser bytes.

Backup may run online. Use the existing [recovery API](recovery-api.md), a new
private bundle path and the exact expected binding. Inspect the completed
bundle and retain its digest. It includes ready private and public media;
pending uploads are not ready media. Preserve the instance and original bundle.

Restore is a separate deliberate operation:

1. Stop/drain the owned effects process and confirm cleanup. Retain the exact
   activation request, UUID, bundle digest and new candidate path.
2. Use the existing `activate` and `activation_readback` APIs. A changed source
   commit identity can require a fresh backup for normal cutover.
3. Only `activate` returning `durability_confirmed: true` supplies the binding
   permitted for new profiles and route pins. `published_observed` and its
   `observed_binding` are observations only, even when they look correct.
4. Preserve the original instance, bundle, candidate, old profiles and old
   operations. A failed profile save does not justify deleting a candidate.
   Resume effects only after explicit new-binding/pin checks.
5. Retain the browser origin and old journal. Old-epoch attempts remain frozen;
   follow explicit private-branch recovery before choosing a new act. Never
   automatically repin, resend or erase old writing after activation.

The existing failure classifications and flush limits in the recovery contract
apply. Component tests and process-exit probes are not physical power-loss or
production-load proof.

## Handoff boundary

The local handoff names the exact source and remote revision, instance binding,
owned processes, entry URL, configured workspace/topic/team, initial backup and
checks actually performed. It distinguishes implemented components from the
usable path and names omissions. New topic UI, full management/navigation,
workspace ownership transfer, remote/mobile access and unattended restart are
staged. Basic attachments and scoped freshness must be delivered and reviewed
before this first-use handoff; these instructions alone do not satisfy that gate.
