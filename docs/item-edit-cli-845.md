# Edit an item from the command line (845)

An outcome member can correct an item's title, words, size and Candidate
group directly. The command line exposes the existing `pipeline.item_edit`
command; it introduces no Core, schema or page behavior.

```
item-edit OUTCOME N [--title T] [--size small|medium|large|none]
                    [--group G] [--words FILE|-]
```

At least one option is required. Only supplied fields change. `--words`
reads UTF-8 from a regular file, or standard input for `-`, using the
existing bounded input reader. An empty file clears the words, `--group ''`
clears the Candidate group, and `--size none` clears the size. Words keep
their whitespace and UTF-8 bytes. Core retains its existing validation
(including the 16,384-byte words limit), shipped-item, membership and sizing rules.

The adapter reads `pipeline_item` for `{workspace_id: OUTCOME, number: N}`,
then sends those same target keys with supplied `title`, `description`,
`size` and `candidate_group` arguments and the read `item_revision`.
A concurrent edit is a revision conflict, not a retry with newer data.
The existing outbox saves the exact request before dispatch. If the
receipt is uncertain, `retry OPERATION` recovers that same operation;
running `item-edit` again would be a new edit.

After a committed command the adapter reads `pipeline_item` again and
prints the same item detail as `item`. JSON mode emits the initial read,
command receipt and final read. If only the last read fails, exit 1 and
`READ_BACK_UNCONFIRMED` name the recorded edit and operation and direct the
reader to `item OUTCOME N`; they do not describe the edit as failed.

This verb has no move, attribution, needs or gathering options. Moving
items and changing attribution keep their existing authorization owners.

## Checks

Start on release 220 (`73d3c2b34da8b6d69e1d541833ebd7be88cee189`).
Run the actual `bin/aim-next` in a fresh process against isolated profiles
and records: an ordinary member edits all four fields and reads them back.
That check must first fail because the verb is missing. Focused checks
also cover omitted/cleared fields, invalid input without a write, denied
access, current revisions and a concurrent edit, committed-but-unread
and unconfirmed-then-retried writes. An applied mutation must fail before
restoration, with separate Python cache directories for both runs.
No browser is needed for this CLI-only change.

## Evidence on 20 November 2026

- Real CLI baseline: the member edit exits 2 with the usage text on unchanged
  220, before product edits. The isolated fixture initializes successfully.
- Eleven focused tests pass, including the actual subprocess, exact words
  with edge whitespace, the Core words boundary, two-item routing, ordinary
  membership, JSON read-back, concurrent edits, read-back failure and retry.
  The first candidate run caught an assertion that expected raw newlines in
  terminal output; the ordinary printer deliberately escapes them. The
  test now checks that existing presentation separately from exact storage.
- Applied revision mutation: replacing the current read revision with `1`
  produces three failures in the then-ten-test focused suite. Restoring the
  exact source passes all ten. Mutant and restored runs use different
  `PYTHONPYCACHEPREFIX` directories, also passed to the real CLI subprocess.
- Final focused plus adjacent suite: 46 tests, 39 pass and 7 fail. Running
  the same 35 adjacent tests on an isolated unchanged 220 checkout gives
  28 pass and the identical 7 failures, with matching diagnostic counts.
  Six are in `test_agent_verbs_pipeline`: five fixtures omit the explicit
  ask go-ahead choice, and one root-post fixture lacks a divergence reason.
  The seventh, in `test_pipeline_steering`, omits the required `ask_wait`.
  These failures are retained and reported; this is not a fully green suite.
- `git diff --check` passes. No Core/schema/page changes or browser runs.

Reproduce the candidate cohort with CPython 3.9:

```sh
PYTHONPATH=.:tests /usr/bin/python3 -m unittest \
  test_item_edit_cli_845 test_agent_verbs_pipeline test_pipeline_steering
```

Local evidence is under
`/Users/commonfabric/.local/share/theseus/auditor/evidence/`: `845-baseline-red.log`,
`845-focused-first.log`, `845-mutant.log`, `845-restored.log`,
`845-mutation.json`, `845-adjacent-baseline.log`, `845-affected-final.log`
and `845-baseline-comparison.json`. The comparison lists all seven test IDs.
