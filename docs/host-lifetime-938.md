# Host lifetime across a web deploy (938)

Warp13481 chooses a separately pinned host, with the existing full-stop path
for incompatible changes. The installed launcher and guard source were read
under13524: `900-land13411/land.py`, `deploy-trains.json`, and its verified
guard's `tools/deploy.py`, which equals the release210 source.

The deploy exposes a runner preflight before any outer seat boundary.
Existing hosts without a verified source record use the full-stop path once.
Before anything stops, preflight exports and verifies the candidate snapshot
and requires canonical instance/source paths and closed regular route inputs.
A candidate predating the policy module refuses while both old processes stay
alive. Preflight may populate the private source cache, including on a dry run;
it changes no running process, route, profile or Core record. Start validates
its inputs before making any run record and reports a typed deploy refusal.
When that path starts hosted routes, it exports the candidate's tracked
`aim_next/**`, `bin/**` and `tools/runner_runtime.py` into a private immutable
source directory and records the commit, schema, exact file set, Git object
IDs and SHA256s in the runner's launch record. It starts the supervisor from
that source, keeping the existing explicitly selected broker executable and
all route/profile/pin identities. No profile or authentication is copied.

A release is compatible only when that source still verifies, the stored
schema is unchanged, and every protected file is identical between the
pinned runner source and candidate, and the route-map/config input hashes
still match the launch record. All of `aim_next/**` is protected because
the runner imports Store and its mixins, including lazy imports; `bin/**`
also protects the bound CLI/broker it dispatches. The policy module protects
the interpretation of the source record. Added/deleted/renamed files count.
Unreadable or tampered facts refuse before changing the installation.
The exact compared paths are returned and saved with the deployment plan.
A matching file policy keeps only a live host with its lease. If no runner is
alive, preflight selects the ordinary start path and prepares the candidate
source before the server stops; an absent host cannot permanently block web
releases. A live process with a lost lease still refuses.

For a compatible release, the same runner/supervisor and app-server children
stay alive. The deploy verifies the captured process identity, running Core
owner/version and unexpired lease before stopping the web server, after the
existing online backup, and after the code move. It skips migration, restarts
only the web server, and verifies the same runner again. It never takes the
runner guard, changes routes, resets a hand, interrupts a turn or closes child
stdin. A schema/runtime change uses the existing stop-runner, stop-server,
backup, fast-forward, migrate, restart order. Genuine Stop/Continue is unchanged.

The caller must use the policy before `wait_boundary`; leaving an unconditional
outer wait would preserve the original bottleneck. The coordinator owns that
installation change. This source change touches no live launcher or service.

Checks keep the existing full-stop expectations. New checks use real Git,
scratch authority/store records and subprocesses: held hosted execution across
source/HTTP cutover, delivery and committed-operation retry, incompatible
runtime/schema selection, ownership loss, backup/migration failure and genuine
Stop/Continue. The app-server fixture is a separate scripted process running
the real CLI, not a model-service claim. No live record or authenticated home
is used by the checks.
