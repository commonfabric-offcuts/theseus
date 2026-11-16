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

### A revert takes an item back

A commit that takes an item back out names it the same way, in a
`Train-Item: Revert 412` trailer (`Revert 398, 399` names two). Every revert
carries one. Within the commits a deploy ships, an item's revert cancels its
earlier `Pipeline` claim: the release does not name it, so the release that
later ships it again is not refused for naming an item already shipped. A
`Pipeline` claim after the revert, in the same range, ships it again. A
`Train-Item` value that does not begin with `Revert` is not read; one that
does, and is not followed by a list of item numbers, stops the deploy like a
malformed `Pipeline` value.

A revert committed before this rule has no trailer. The deploy takes such an
item with `--revert N` (once per item), which it refuses unless a commit in
the range claims N and no trailer has reverted it already. Both kinds are
listed in the record's measurements, so the record says what was taken back:

```json
{"reverts": [{"item": 412, "commit": "...", "by": "trailer"},
              {"item": 398, "commit": null, "by": "flag"}]}
```

`reverts` is left out when nothing was, like `known_reds`.

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

The view adds `deployed_ms` (the same time in epoch milliseconds),
`recorded_ms` (when the record was written) and `hosted_judgment` (below;
`null` when none is attached).

`measurements` holds the release check's counts:

```json
{"release_check": {"commit": "...", "started_at": "...", "finished_at": "..."},
 "python_units": {"tests": 1106},
 "node_units": {"tests": 740, "pass": 740},
 "native": {"pass": 208, "total": 208, "steps": {"journal": {"pass": 10, "total": 10}, "...": {}}}}
```

A release the deploy took with known reds (docs/tools.md, "Known reds": browser
cases the live release fails too) also lists them; their cases stay counted as
failed in `native`:

```json
{"known_reds": [{"step": "native-colors", "case": "the exact case name", "live_commit": "...",
                 "live_summary": "/abs/live-check/summary.json", "why": "one line"}]}
```

Each known red also says what took it in `taken_by`: `policy` (the policy at
the live commit admits it), `live` (the live release's check failed it) or
`owner_acceptance` (an owner's acceptance file, which `live_summary` names).
`known_reds` is left out when there are none, so a record without it reads as
before, and a reader that does not know it ignores it, as it does `skipped`.
When this release's check runs steps that the live commit's policy
(`.github/check-baseline.json`) does not review, `steps_beyond_policy` lists
them by name (`["native-card-marks", "native-webkit-invite"]`), so the next
policy covers them, whatever the deploy took: a summary that passed, known
reds, or a merged train. It is left out when there are none, or the live
commit keeps no policy, like `known_reds`. When the policy cannot be read, or
names no list of required steps, `steps_beyond_policy_unread` says why
instead: not read is not "none beyond it", and the deploy goes on.
It sits inside `measurements`, which the store keeps as one JSON object of at
most 16384 bytes, so the record's own fields and the admin verb are unchanged;
a record too large for that is refused before anything stops.

A release deployed from a merged train (docs/tools.md, "A merged train") ran no
local release check, so its measurements hold none of those counts, only the
train as the deploy read it (and `steps_beyond_policy` when there are any):

```json
{"train": {"file": "/abs/train.json", "pr": 31, "kind": "ordinary", "merge_commit": "...", "merged_tree": "...",
           "release_branch": "release/live73", "items": [{"item": 481, "approved_head": "...", "review": "m-..."}],
           "hosted_run": null, "judgment": "pending"}}
```

An ordinary train's `judgment` is `"pending"`: GitHub judges it after the
merge (or, when the train came with a judgment of its merge commit, that
judgment, in the form below, its `head` the merge commit). A judged-first train's is the judgment it came with: `head` (the parent
of the merge commit its runs name), `producer_runs` and `verdict_checks` (each
`{kind, id, name, head_sha, status, conclusion}`, as GitHub listed it) and
`audit`. `hosted_run`, when given, is the run on the merge commit as GitHub
listed it at the deploy. The Health page's latest release says such a record
ran no release check here and says its judgment, never that checks passed
([health.md](health.md)).

When an ordinary train's hosted judgment lands, it is attached to the record:
a separate fact, written once, shown by the view as `hosted_judgment` in the
judged-first form above, its `head` the release's commit. The record itself
keeps saying `"pending"`, as it was written; a reader takes `hosted_judgment`
for what landed since. Only a record whose train is ordinary and pending takes
one (`JUDGMENT_NOT_PENDING` otherwise), every run and check must name the
release's commit (`JUDGMENT_OF_ANOTHER_COMMIT`), the same judgment again
returns the one attached (`"attached": false`), and another is refused with
`RELEASE_JUDGED`. The store refuses to update or delete a judgment.

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
  stored record and whether it was written now. Writing the record of the next
  release also ships the outcome's release, in the same transaction; a record
  of an older release takes only the items it names out of it. The record is a
  fact of every outcome's pipeline, and what each piece holding them has become,
  and its topic, is the state derived from those facts
  ([pipeline.md](pipeline.md#the-release)).
- `bin/aim-next-admin attach-judgment --profile /abs/profile.json --release N --judgment /abs/judgment.json`
  attaches a release's hosted judgment (above) from a JSON file. Like
  `record-release` it is an operator act on the local instance, never an HTTP
  route. `tools/releases.py attach-judgment` reads the judgment from GitHub and
  calls it (docs/tools.md).
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
- The record of a release that went live without one is the next release's
  record, so it ships the release being put together, whatever commit that
  release was checked at ([pipeline.md](pipeline.md#the-release)). After a
  deploy that stopped past its restart, that release is the one it put live,
  still in deploy, and its record ships it as it should. When a commit went live
  outside the release (finished by hand) while another release was being put
  together, the release the next deploy moves into deploy is shipped under the
  older number by the record written before the deploy's own; its items go back
  to building, and the deploy's own record lists them under its number. The
  deploy does not refuse when the release it moves is numbered other than the
  record it writes: in the first case that difference is the recovery above, and
  in the second, recording the live commit's release by any route (a restart, or
  by hand) ships the open release the same way, so a refusal would leave nothing
  else to do. Only a rule that ships a release by the record of its own commit
  would avoid it, and that is a change to how a release ships, not to the deploy.

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
