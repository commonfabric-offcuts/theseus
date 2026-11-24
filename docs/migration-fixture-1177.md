# Historical message trigger fixture repair (1177)

This is a test-only repair on release 385, commit
`8a7383a176f9ea7bd3c83c34dbbe5bf4224cd740`, schema 69. Production schema,
migration steps and database records are unchanged.

Schema 52 widened `immutable_messages_update` for recorded dossier moves. The
historical fixture removes message columns named by that newer trigger. Before
any column removal, restore the unconditional immutability trigger from the
independently frozen schema-48 DDL. All layouts produced by this helper predate
schema 52. This reuses only the narrow trigger restoration prepared in 1138;
it does not bring in that worktree's unrelated synthetic writers or redesign.

The first focused execution of the earlier source reached a second dependency:
`public_actor_writing`, added after these historical layouts, still named
`private_to`. Four version subcases failed at its column removal. Remove that
index before the helper strips historical columns. The earlier failed run and
all its counters remain retained; no assertion is changed or weakened.

The new regression starts with a real message created through the normal
commands. Seven independent database copies cover layouts 8, early 12, 13, 26,
27, the pre-reaction layout, and 48. Each calls the actual helper, checks the
message table against its frozen DDL, checks the exact historical trigger,
attempts an UPDATE of the existing message, and verifies rejection and unchanged
rows. These cover every message-column removal and the helper's endpoints.

The proposed omission red removes the six-line restoration from an isolated
export while keeping the regression. The helper is the subject under test:
its SQL exception in this test body is a failed helper behavior, not an
acceptable fixture-setup red. Restore the exact bytes after the owned process
has ended and its inherited process group is known empty; use a new pycache
for that control. No active installation or another lane's worktree is used.

Compare the full migration file on the candidate and the exact release-385
export. Preserve every failure and classify setup exceptions, frozen-layout
setup assertions, body assertion failures, body product exceptions and
incomplete invocation separately. Keep all existing schema/data assertions.
The retained Build3 comparison already shows additional frozen-layout drift;
clearing the trigger error alone does not establish that all historical test
bodies reach their assertions or that all migration obligations pass.

The focused proof is one case with seven subcases; the candidate full file is
expected to contain 206 case identities, versus 205 on release 385. Those are
selection expectations, not execution results. No browser is needed. This
source contract does not grant execution, freeze a piece or authorize landing.

The R3 failed positive exposed the reopening-message lookup as a second later
index dependency. The separately granted diagnostic built one schema69 instance
from immutable384 source (production/schema inputs unchanged on385), enumerated
all313 index/trigger/view objects, and traced42 target paths/32 column-drop sites
with object removals, recreations and return boundaries. Its conservative source
table leaves one active dependency identity: topic_reopen_message before
topics.state_message_id is dropped. Remove that index only on the19-to18 branch;
returns at19 and above keep it. No other historical schema/data assertion changes.
The version37 table row is the frozen-file superset's computed fallthrough path,
with no selected helper caller; this repair does not add a37-layout contract.

The raw diagnostic SHA256 is
0527116543817618b405c88b123958a30da2a8a59d42a1130e88f369655c172a.
Its source-order/name matching is not a successful historical DROP. R2/R3 failed
positives remain evidence; their counters are not reset. The next focused positive
and later red/control/full-file phases require an exact new disposition.
