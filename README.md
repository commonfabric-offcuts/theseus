# AIM Next

A fresh AIM implementation with outcome workspaces, stable topic identity, one transactional record authority, and a shared reader/composer.

Tony authorized the rewrite on 2026-11-03 in AIM message `m-6eb13d4e`. This repository is separate from `/Users/commonfabric/aim`; its records and services do not reuse the existing instance.

Implementation is in progress. The single build plan and its critique/dispositions are maintained at `/Users/commonfabric/aim/work/scaling-architecture-2026-11-03/first-build-plan.md`. The product direction is in the adjacent `entity-model.md`.

The current foundation contains a shared Python command/query core, private instance profiles, a loopback HTTP adapter and the reader's editor-state module. A prepared submission and its successor draft have separate identities. CLI and HTTP callers use the same recorded operation results; a lost response is reconciled under the original operation ID.

The complete reader, Notebook/review workflow, agent-effects runner, attachment publication and backup/restore path are still being integrated. This checkout is not a replacement for the current AIM instance and is not ready for everyday use.

The server runs in the foreground with an explicit profile and port:

```sh
bin/aim-next-server --profile /absolute/path/to/private-profile.json --port 0
```

Port `0` requests a free loopback port and prints the selected URL. A missing reader shell, invalid binding or occupied explicit port refuses startup. The launcher creates no database, searches no default data directory, accepts no author override and installs no service. A profile names an existing database and registered actor; its format is enforced by `aim_next/profile.py`.

Focused checks use the supported Python 3.9 runtime and Node's built-in test runner:

```sh
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
```

These checks exercise the new contracts. Native browser proof and isolated recovery evidence are required for the completed user path; no old-AIM compatibility-suite claim is implied. Local execution receipts live under the ignored `work/evidence/` directory.
