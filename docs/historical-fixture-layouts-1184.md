# Historical migration fixtures (1184)

Historical tests construct current synthetic records and then reproduce an
independently frozen old layout. The previous per-feature column/table removal
missed later schema additions, so setup failed before migration assertions ran.
The shared helper now builds the complete declared layout from its frozen SQL.
No production migration or Store command contract is changed by this repair.

## Exact fixture construction

`tests/historical_fixture.py` owns the reconstruction used by
`step_back_by_hand`. The fixture file supplies the complete SQL. Early12 is
explicit;31 uses30 because its settling step changed records, not layout.

One owned SQLite transaction removes non-target objects and tables, reconstructs
changed retained tables, and reinstalls the exact indexes, views and triggers.
A constrained TEMP table copies the shared occupied columns, applying the old
defaults. The main table is created from its original frozen SQL so ALTER RENAME
cannot rewrite the stored CREATE. Allocation history uses
`main.sqlite_sequence` explicitly: a TEMP AUTOINCREMENT copy has its own sequence
table. An incompatible retained row raises with its version/table and rolls back
the whole operation; the connection closes. No `IGNORE` or writable-schema path
hides a failed copy.

The pre-existing historical record adaptations remain explicit: pre28 removes
the conversation supplied by current workspace creation; pre32 removes the
later Health actor and metadata. These prepare an old fixture before measuring
its migration. They do not remove occupied records during the migration being
checked.

## Positive current writers

`post_fields` adapts only explicitly positive fixture calls. An agent reply
missing both passage choices receives a test-authored whole-discussion reason.
An agent Ask to a person receives its current parent-cover fence and an explicit
question if no ask-wait field was supplied. Human replies, explicit choices and
explicit invalid values stay intact. `StoreCase.command` and deliberate refusal
suites are unchanged.

The helper is used by the migration writers and the named stack, New line,
Starred dossier, Between others, topic-reading, dossier-New and reaction
consumers. Current writers needed by a historical roundtrip run before the
frozen layout is constructed. The Blocks current writer starts its piece in a
separate agent-created topic and keeps the person's discussion topic separate.

## Historical boundaries and current compatibility

An old physical down/up test uses that fixture's actual adjacent successor in
`migrations.STEPS`. It does not upgrade through every later feature and then
remove those features' records to obtain a downgrade. In particular the real
48-to49 dossier-order backfill stays populated; its refusal and complete rollback
have their own current-head witness.

Full-head tests still compare the schema with a freshly initialized current
instance and exercise current commands/views. `current_legacy_rows` explicitly
checks the added tables are empty for these pre49 fixtures, every old delivery's
request/answer/retraction fields are null, each old Notebook revision remains
undeleted, and the removal horizon names the last old message. It then compares
the retained earlier rows. It changes no stored record and does not silently
ignore a populated later table.

The independent17-to48 frozen ladder retains its complete physical roundtrip.
Separate17-to-current checks retain the whole current chain, current views and
occupied-order refusal. Horizon, cover and topic-position roundtrips likewise
remain separate from current writer compatibility.

`OccupiedBoundaryCase` adds27 isolated refusal witnesses. Each first proves its
adjacent empty boundary can step back, then inserts the historical feature's
record and requires the actual adjacent refusal with every database byte and
retained row unchanged. This prevents a later occupied-order guard from masking
a broken earlier guard. Cleared marks/folds/covers, reset colors, earlier draft
revisions and reopened outcomes retain their history. Existing current-command
positive coverage remains alongside these historical checks.

## Verification scope

Four occupied-row, allocation, rollback and explicit-argument witnesses check
the shared helper, including applied loss mutations and restored controls.
The migration-file collection has243 identities:225 locally defined bodies
and18 inherited StoreCase bodies. The four helper witnesses are separate.
Reports retain the actual method-definition file for inherited tests.

Affected consumer files run complete, including the independent admission and
refusal suites. A changed file runs again as a complete-file continuation;
its previous attempt remains visible. The731 subprocess fixture records its
actual PID, parent/group and reaped result, supplies explicit reply and root
reasons, and checks the complete composed message body and stable order.

The input manifest declares the helper's independently frozen schema files
and generated database snapshots. Its real repository audit and deployment
readers have their own complete-file results. Source discovery, actual body
reachability, direct process results and cleanup are retained separately in
the1184 Theseus dossier. Historical baseline failures keep their exact source,
phase, exception and failing statement; fixture construction and permitted
physical migration rollback remain separate checks.
