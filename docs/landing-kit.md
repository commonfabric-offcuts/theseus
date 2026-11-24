# Landing a frozen piece

The landing kit in `tools/landing` lands one approved ordinary piece onto live: carry, whole-suite comparison,
merge, deploy, dossier and card. Any seat holding landing duty runs it, and after a restart it needs nothing but this
page, a clone and the seat's config.

[landing.md](landing.md) says which route a change takes; this page is how an ordinary one is carried out. The kit
is the hand process seats already ran, moved into the repository, so it is introduced as
[landing.md](landing.md#introduce-landing-and-check-tools-reversibly) asks: its first landing is one bounded ordinary
landing with the seat's previous scripts ready as the fallback, and not using it is the off switch.

Run the kit from a clone of the repository, never from the live checkout: the deploy replaces live's files under a
running landing, and `land_ordinary.sh` refuses to start there.

## Once per seat

1. Copy `tools/landing/config.example.json` to `~/.config/theseus/landing.json` (or point `THESEUS_LANDING_CONFIG`
   at another file) and fill every key; `config.py` describes each one.
2. Check it: `python3 -I tools/landing/config.py --check`.

## Per piece

1. `bash tools/landing/new_folder.sh ITEM` makes `<work>/ITEM-land` and records the kit's file hashes in
   `INPUTS.json`. Every later step refuses if the kit changes after this; to land with a change made on purpose, read
   it, then `python3 -I tools/landing/check_inputs.py --record <work>/ITEM-land`.
2. Fill `SPEC.json`'s null fields: `piece`, `topic`, `release` (live's number plus one), `title`, `review` (what the
   head does and its kind, which becomes the merge body), `review_head` (the head that review was written of),
   `approved_head` (the same head) and `pr`. A node case the piece stops running on purpose (skipped, renamed or
   removed) goes in `execution_changes` as `{"file", "names", "why"}`, one entry per case, or the node suite refuses
   the landing.
3. Draft `<posts>/dossier-ITEM.txt` (first line `Release NNN is live: …`, with a line `Evidence: EVIDENCE_TO_FILL`)
   and `<posts>/card-ITEM.md` (with `live as release NNN at TIME`). A landing without both refuses before it starts.
4. `bash tools/landing/carry_ordinary.sh ITEM APPROVED_HEAD LIVE_COMMIT BRANCH PR` merges live into the head, pushes
   the carry to the PR's branch, fills the rest of `SPEC.json` and runs the preflight. It exits 0 only when all of
   that held: 3 on a conflict or a refused `SPEC.json`, 4 when the push was refused (`SPEC.json` unchanged), 5 when
   the preflight refused (the carry is pushed; `carry-preflight.out` holds the preflight's whole output). Run the
   piece's own tests on the carry worktree, each wrapped in `python3 -I tools/lane_lock.py run --label "ITEM what" -- …`.
5. Ask fable to freeze the piece at the carry head. A piece that may not be frozen (one changing
   `tests/test_migrations.py`) lands on fable's read of the carry instead: put `carry_read` `{topic, seq, id, why}`,
   naming that message, in `SPEC.json`.
6. `bash tools/landing/land_ordinary.sh ITEM CARRY_WORKTREE` is the landing. It takes the lane lock (no new lane run
   starts, open runs drain), runs the preflight, the whole node suite on the carry against live (each shared
   failure's cause compared, and every case that passed on live checked to run on the carry), the preflight again,
   then `land.py`: backup, rehearsal on a copy, merge, combine, deploy. Once live, `publish.sh` fills the dossier's
   evidence from the receipts and posts the dossier and the card; the card states the time the release record gives
   for the release, however late the publication finishes.
7. Once live: `python3 -I tools/landing/drop_premerge_backup.py <work>/ITEM-land`.

## When it stops

| Exit | Meaning | Next |
|---|---|---|
| 2 | an input, the config, the kit or a draft refused; nothing ran | read the STOP line |
| 3 | the node suite refused: a new failure, a shared failure's changed cause, or a case that passed on live and is skipped or gone on the carry with no reason in `execution_changes` | `node-suite.out` names which; the lane fixes it, or names a deliberate change with its reason; carry again |
| 4 | the preflight refused (a guarded file, the release record, the review's head) | read `preflight*.out`; a guarded file takes the judged path |
| 5 | `land.py` stopped | read `land.out` and `STOP.json`; with `MERGED.json` present the PR is merged, so read it before anything else |
| 6 | live, publication unfinished | `bash tools/landing/publish.sh ITEM ATTEMPT_DIR`, which reruns no test and no deploy; a dossier request already saved goes again unchanged under the same operation id, so a post Core recorded is answered, not made twice |

## Receipts

Each landing attempt keeps, read-only, `<work>/ITEM-land/attempts/<stamp>/`: `binding.txt` (carry, live and kit
heads), each phase's `.cmd`, `.out` and `.exit`, the node suite's TAP, and `phases.txt`, which names every phase's exit
or that it was not reached; the node suite's case events (each case's file, name and how it ended) sit beside its
TAP. The carry keeps its merge, push and preflight output in the folder as `carry-*.out`. Each publication keeps `<work>/ITEM-land/publish-<stamp>/` the same way, so a failed
publication and its recovery stay apart from the deploy's result.

## What it refuses

- a kit changed since the folder was made, or run from the live checkout
- a landing with no dossier or card draft
- a carry whose review was written of another head, or that is not live merged into the reviewed head
- a carry whose push or preflight refused, reported as the carry's own exit
- a carry that adds a node failure, or a shared failure whose cause changed
- a case that passed on live and is skipped, todo, cancelled or gone on the carry, unless `execution_changes` names
  that case with its reason (listed either way); an edit elsewhere in its test file explains nothing
- a second dossier post for one release, a different request under its operation, and a dossier recorded as posted
  before the message itself is read back from the board as the seat's, in the releases topic, with the whole text
- an ordinary piece that changes a file the deploy guards
- a dossier proof that is not the piece's own freeze and approval, or fable's read of the exact carry

`tests/test_landing_kit.py` holds a case for each.
