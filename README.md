# Theseus (AIM Next)

A fresh AIM implementation with outcome workspaces, stable topic identity, one transactional record authority, and a shared reader/composer.

Tony authorized the rewrite on 2026-11-03 in AIM message `m-6eb13d4e`. This repository is separate from `/Users/commonfabric/aim`; its records and services do not reuse the existing instance.

Implementation is in progress. The single build plan and its critique/dispositions are maintained at `/Users/commonfabric/aim/work/scaling-architecture-2026-11-03/first-build-plan.md`. The product direction is in the adjacent `entity-model.md`.

The reviewed foundation contains the shared Python command/query core, private instance profiles, loopback HTTP adapter, reader/composer, Notebook revisions, attachment storage, agent-effects runner and backup/recovery APIs. A prepared submission and its successor draft have separate identities. CLI and HTTP callers use the same recorded operation results; a lost response is reconciled under the original operation ID.

A bounded connected checkpoint has exercised the served reader, a real agent's CLI reply and separate delivery acknowledgment. It is closed; its temporary runtime is not a retained service. Image-upload controls remain in review. The first-use handoff uses the page's explicit **Refresh** button for new replies and Notebook changes. Automatic scoped updates follow as the next increment on the same instance, origin and data; they do not gate that first handoff. The implemented [scoped changes query](docs/changes-query.md) supplies the backend contract, but does not itself update the browser. Publication to the private `tonyespinoza1/theseus` repository does not activate a usable instance or replace existing AIM.

The first usable slice will open one configured topic. Native New topic and full management/navigation remain staged. [First-use operations](docs/first-use.md) describes the explicit instance, ownership, process lifetime and recovery handoff. The local handoff must name the exact delivered revision and remaining limits.

The server runs in the foreground with an explicit profile and port:

```sh
bin/aim-next-server --profile /absolute/path/to/private-profile.json --port 0
```

Port `0` requests a free loopback port and prints the selected URL. A missing reader shell, invalid binding or occupied explicit port refuses startup. The launcher creates no database, searches no default data directory, accepts no author override and installs no service. A profile names an existing database and registered actor; its format is enforced by `aim_next/profile.py`.

Checks use the supported Python 3.9 runtime and Node's built-in test runner. Select the modules and native sequences that prove the changed contract; the commands below enumerate all new-repository checks, not a required gate for every edit:

```sh
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
```

These checks exercise the new contracts. Native browser proof and isolated recovery evidence are required for the completed user path; no old-AIM compatibility-suite claim is implied. Local execution receipts live under the ignored `work/evidence/` directory.
