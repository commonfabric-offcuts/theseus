# Release records

Theseus keeps a record of each release: which commit a deploy put live, when,
which pipeline items it shipped, and the release check's measurements. The
record is the instance's own fact about itself. The pipeline page reads it to
mark items shipped, and the Measurements page (item 12) can be filled from it.

## Naming the items a change ships

The person or agent merging a change is the only one who knows which pipeline
items it delivers, so the change says so when it is committed, in a trailer in
the last paragraph of its commit message:

```
The pipeline marks what a release shipped from its record

Pipeline: 88
Co-Authored-By: ...
```

`Pipeline: 87, 2` names two items. Name an item only on the change that
completes it; a change that does part of an item, or none, carries no trailer.
The trailer is read as git reads trailers (`git interpret-trailers`): only in
the message's last paragraph, and only when every line of that paragraph is a
`Key: value` trailer; the key may be written in any case. A `Pipeline:` line
elsewhere in the message, such as one quoted as an example, names nothing. A
trailer may sit on a branch commit or on the merge commit that brings the
branch in: the deploy reads every commit it ships, merges included. A
`Pipeline` trailer whose value is not a list of item numbers stops the deploy
before anything is stopped.

## The record

| field | meaning |
| --- | --- |
| `release` | the release number. A deploy's record follows the latest one; the first record an instance keeps names its own number, which the deploy takes from the records the repository keeps |
| `commit` | the full commit the release put live |
| `previous` | the commit that was live before it, or `null` when that is not known |
| `deployed_at` | when the deploy's checks of the new release passed, ISO 8601 with its offset from UTC; for a release recorded afterwards, when its server started at that commit |
| `items` | the pipeline item numbers it shipped, each once, in the order their commits came |
| `measurements` | from the release check's summary, or `null` when no summary was kept (below) |
| `source` | `deploy` when the deploy wrote it, `backfill` when it was recorded afterwards |
| `evidence` | where the deploy wrote its evidence, or `null` |

The view adds `deployed_ms` (the same time in epoch milliseconds) and
`recorded_ms` (when the record was written).

`measurements` holds the release check's counts:

```json
{"release_check": {"commit": "...", "started_at": "...", "finished_at": "..."},
 "python_units": {"tests": 1106},
 "node_units": {"tests": 740, "pass": 740},
 "native": {"pass": 208, "total": 208, "steps": {"journal": {"pass": 10, "total": 10}, "...": {}}}}
```

A record never changes: the store refuses to update or delete one. Writing the
same record again returns the one already there (`"recorded": false`), so a
retried deploy step or a backfill run twice adds nothing. A different record
for a commit or a number already recorded is refused with `RELEASE_EXISTS`. An
item ships in one release: a record naming an item an earlier record names is
refused with `ITEM_SHIPPED`. A
record without a number on an instance with none is refused with
`RELEASE_NUMBER_REQUIRED`.

## Writing and reading

- `bin/aim-next-admin record-release --profile /abs/profile.json --record /abs/release.json`
  writes one record from a JSON file holding the fields above (`release`,
  `previous`, `measurements` and `evidence` may be left out). It is an
  operator act on the local instance, never an HTTP route; it prints the
  stored record and whether it was written now. Writing a record also ships the
  outcome's release piece it names, in the same transaction
  ([pipeline.md](pipeline.md#the-release)).
- The `releases` view (`cursor`, `limit`) lists the records newest first;
  `next_cursor` is the last release number on the page. Every enabled member
  of the instance can read it, over `/api/view` like any view.
- `bin/aim-next --profile P releases [--limit N]` prints one line per release,
  newest first; with `--json` it prints each page the view returned.

`tools/deploy.py` writes the record (docs/tools.md); `tools/pipeline/build_pipeline.py`
reads it to build the pipeline page.

## Releases recorded afterwards

A release can go live without its record: releases 18 and 19 shipped before
deploys wrote records, and a deploy can stop after the restart. The system
records them from what it keeps:

- The repository keeps the records of releases 18 and 19 in
  `tools/pipeline/releases/`. A deploy writes those its instance lacks first,
  once they are its records: it records one of them, or, while it records
  none, the newest is the live commit or one of its ancestors. So the next
  release's number follows 19 without being typed, even when only one of the
  two was written by hand.
- A deploy whose live commit is not the latest record's commit records each
  commit a server was started at since that record, in the order they started:
  each is a release, numbered on from the latest, with the items named since
  the commit before it and the time a server first started it. Two deploys in
  a row that put their release live without its record are two releases.
- A deploy of the live commit is a restart and writes no record of its own.
  So running a deploy again at a commit that went live without its record
  records that release once, from its server's run record, with no
  measurements.

The same records can also be written by hand on an instance at schema 23 or later,
without a deploy, once per file:

```sh
LIVE=/path/to/live/checkout INSTANCE=/path/to/instance
"$LIVE/bin/aim-next-admin" record-release --profile "$INSTANCE/tony.profile.json" --record "$LIVE/tools/pipeline/releases/release-18.json"
"$LIVE/bin/aim-next-admin" record-release --profile "$INSTANCE/tony.profile.json" --record "$LIVE/tools/pipeline/releases/release-19.json"
```

Running them again changes nothing, and neither does a deploy after them.
Release 19's measurements come from its release check's summary. Release 18
ran before that tool kept a summary, so its measurements are `null`: the only
count for it is a sentence written by hand on the pipeline page, and a record
holds what a check measured, not what someone wrote down.
