# Release records

Theseus keeps a record of each release: which commit a deploy put live, when,
which pipeline items it shipped, and the release check's measurements. The
record is the instance's own fact about itself. The pipeline page reads it to
mark items shipped, and the Measurements page (item 12) can be filled from it.

## The record

| field | meaning |
| --- | --- |
| `release` | the release number. A deploy's record follows the latest one; the first record an instance keeps names its own number |
| `commit` | the full commit the release put live |
| `previous` | the commit that was live before it, or `null` when that is not known |
| `deployed_at` | when the deploy's checks of the new release passed, ISO 8601 with its offset from UTC |
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
for a commit or a number already recorded is refused with `RELEASE_EXISTS`. A
record without a number on an instance with none is refused with
`RELEASE_NUMBER_REQUIRED`.

## Writing and reading

- `bin/aim-next-admin record-release --profile /abs/profile.json --record /abs/release.json`
  writes one record from a JSON file holding the fields above (`release`,
  `previous`, `measurements` and `evidence` may be left out). It is an
  operator act on the local instance, never an HTTP route; it prints the
  stored record and whether it was written now.
- The `releases` view (`cursor`, `limit`) lists the records newest first;
  `next_cursor` is the last release number on the page. Every enabled member
  of the instance can read it, over `/api/view` like any view.
- `bin/aim-next --profile P releases [--limit N]` prints one line per release,
  newest first; with `--json` it prints each page the view returned.

