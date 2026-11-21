# Personal outcome colors (957)

A person can give selected outcomes a color for themselves. An uncolored
outcome keeps its current appearance. A choice never changes an outcome's
shared record, another person's view, a message, a delivery or a wake.

## Core contract

`outcome.color_set` targets exactly `{workspace_id}` and takes exactly
`{color}`, where color is null (no color) or one of the existing eight palette
names in `AGENT_COLORS`. The caller must be able to read that outcome. Personal
choices remain available for reached, archived and completed outcomes.
`expected.color_revision` is required alongside the usual authority fence.

The receipt's result is `{workspace_id, color, color_revision, changed}`.
Each actor/outcome pair starts at null, revision 0. A changed choice increases
only its own revision; a repeated choice is a no-op. Reset rows remain so a
revision cannot be reused. Stale writes fail with `REVISION_CONFLICT`; an
exact retry keeps its operation ID and returns the original receipt.

`workspace.workspace`, each paged `workspaces.items` entry, and the bounded
`workspace_counts.items` refresh include `color` and `color_revision` for the
caller. These are projections of `outcome_color_choices`, never columns on
the shared workspace. The `workspace` and `workspaces` answers also offer
`color_palette`, in the existing agent palette order. Reads do indexed lookups
only for the outcomes already authorized and returned in the bounded page.

A committed change emits only an actor-scoped `outcome_color` change keyed by
workspace ID. Clients refresh the affected title and loaded rail projections,
retaining revision fences against late reads. No topics or history are read
because a personal color changed.

Schema 59 → 60 adds the actor/workspace choice table. Rollback is allowed only
before any choice row exists, including reset rows.

## Page contract

On the outcome page a small dashed ring beside the title opens a strip:
no color first, then the eight agent colors. A confirmed pick closes it.
The rail uses the chosen color for the outcome name and a faint topic spine;
topic words retain their own appearance. The designer's exact palette and
interaction reference is Notebook page n-cf58c113e9644aaeb482afe9f6f39f59.
Access was supplied and revision 1 read through the bound profile. The
implementation uses its exact bright/deep palette and 45% topic hairline. Colors must be bright on the black rail and deeper on light pages.

Color is optional decoration. A missing, invalid or conflicting color
projection leaves the outcome uncolored and the list usable. An unconfirmed
title projection hides the picker until a confirmed projection arrives.
Counts still refresh when their optional color cannot be confirmed; a partial
color never inherits a previous row's revision. Valid older projections retain
the newer confirmed choice. Saving still requires an exact, recorded receipt
with the expected target, color and revision.

## Evidence

Core checks cover personal isolation, all three read projections, access,
validation, no-op/reset revisions, late writes, retries and migration safety.
Native checks start with the real outcome page and rail failing on release
240, then prove picking, closing, reload, no color and a second person's own
choice. Record actual screenshots, receipts, mutations and browser cleanup.

### Carried candidate and checks

Built on 240, carried cleanly through 242 and 245 onto 247 (`1c426342`). The new
schema is 60; the deployment owner must explicitly migrate 59 → 60 before
starting this code. Normal reads refuse the old schema without changing it.
Downgrading after any personal choice (even a reset) is refused.

The retained checks are:

On the final 245 carry: 44 Core/Store/migration tests and 62 Node tests pass;
both native engines pass all five result entries. All observed owned browser
PIDs, temporary profiles and fixtures are gone, with fixture exit 0 and the
scratch ports closed.

The returned review finding exposed a display failure on older color
projections without a revision. Before the fix, broad wiring had 65 failures
(64 color-confirmation exceptions) against the base's ten. Three added owner
regressions failed before the fix on 247: a mixed-validity outcome list, an
older title projection, and a count refresh with incomplete decoration.
The fix preserves strict save confirmation and drops only unconfirmed display
color. The broad wiring test and its expectations are unchanged.

On the successor's 247 carry, all 65 Node owner checks and 67 Core checks pass
(the original 44 plus 960's 15 and 955's eight carry checks). Broad wiring
passes 485/495, with exactly the same ten failed test identities and
multiplicities as pristine 247. Those ten failures remain visible; this is a
baseline comparison, not an all-green broad-suite claim. The new save checks
also reject missing and incorrect receipt revisions.
Both successor native engines pass all five result entries, with source
hashes matching the final product files and owned browser/profile/fixture/port
cleanup verified.

```
PYTHONPATH=tests /usr/bin/python3 -B -m unittest test_outcome_colors test_colors test_outline_counts_933 test_outcome_live_key_904 test_store test_removal_migration_151 -v
# Successor carry also includes test_topic_latest_960 and test_agent_answer_fold_955.
node --test tests/ui_outcome_colors_957.test.mjs tests/ui_outcome_refresh_923.test.mjs tests/ui_outcomes.test.mjs tests/ui_outline*.test.mjs
node --test tests/ui_inline_wiring.test.mjs
AIM_BROWSER=chromium node tests/outcome_colors_957_native.mjs <evidence-directory>
AIM_BROWSER=webkit node tests/outcome_colors_957_native.mjs <evidence-directory>
```

The native commands also require `AIM_PLAYWRIGHT_CORE` (the Playwright module)
and, for Chromium, `AIM_CHROME` (Chrome for Testing). They use isolated real
HTTP/Core fixtures, never live records. Each engine covers 1280/390 widths in
light/dark, native click/tap, bounded arrows, Escape/Tab exits, confirmed
pick/reset, reload and a fresh browser session. Desktop checks include
Bookends/Paper and Compact/Roomy. A separate real actor session proves that
two readers keep independent choices; the ordinary topic page has no picker.
Only the outcome name and existing spine change; other outcomes, topic
words, title ink and typography stay unchanged. Each run retains receipts,
screenshots, source hashes and observed owned-PID/profile/fixture/port cleanup.

WebKit revealed that its pointer press can focus the page before click,
closing the palette prematurely. Swatches now cancel mousedown's default
focus and explicitly focus the pressed button. Pointerdown is not cancelled,
so touch retains its native click. Both engines exercise this path.

Core tests independently seed schema 59 using archived release 242 code,
prove reads do not migrate, migrate all old records unchanged, and read the
default choice. Retained schema 56/58 migration tests now expect the current
schema version; their record/index/trigger/sequence and rollback assertions
remain. The earlier round-trip check also compares fresh and migrated table
DDL and prevents rollback for both selected and reset rows.

Five actual mutations were applied, observed failing, and restored byte for
byte with passing controls: remove the Core revision fence; omit the actor
filter from a choice lookup; allow rollback with occupied choice rows; accept
an older client projection; and remove the rail title's color CSS. Each Python
mutation and restored control used its own `PYTHONPYCACHEPREFIX`.

Local evidence is under
`/Users/commonfabric/.local/share/theseus/auditor/evidence/`: final engine
directories `957-chromium-245` and `957-webkit-245`; Core/Node logs
`957-core-final-245.log` and `957-node-245.log`; mutation records
`957-mutations-242/results.json`, `results-revision.json`, and
`957-css-mutation.json`. Native results count four width/theme entries plus
the separate-reader entry, not every assertion as a separate test.

The successor evidence uses `957-core-r2-247.log`, `957-node-r2-247.log`,
`957-review-focused-red247.log`, and `957-review-wiring-comparison247.json`
with both raw broad-wiring logs. Its engine directories are
`957-chromium-r2-247` and `957-webkit-r2-247`.

### Scope of the review

Self-review traced authorization before every choice lookup/write, the
actor/outcome primary key, monotonic reset revisions, exact authority and
operation identity on retries, stale-read protection, access loss, picker
retirement on navigation, bounded refreshes and occupied rollback. The shared
outcome record and global outcome-list key do not change. No coordination
messages, deliveries or wake records are created by the color command.

The old `test_migrations -f` suite is not claimed green. Its first
`BlocksStepCase` fails at fixture schema comparison (`test_migrations.py:527`)
on untouched 242 as well as the candidate: its historical fixture omits
48 later schema objects on the base, plus the new choice table here. Both
raw logs are retained as `957-migrations-baseline-242.log` and
`957-migrations-242.log`. Release 245 changes no Core or migration tests.
The current-schema migration checks above pass; the historical fixture
maintenance remains outside this slice.
