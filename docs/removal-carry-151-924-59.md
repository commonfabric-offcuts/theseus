# Removal carry: 151 and 924 after 932 and 625

Warp13629 fixes the order: 932 question closures at 57, 625 answer receipts
at 58, then removal at 59. The exact comparison base is approved 625
`6066c9780ce3c1212d4562ff43ea37d843177eb1`, containing approved 932
`eecc040391e6985711c66a77b42188ab06606d40` and release 210. This carries the
approved 151 `e5080e1f298375d4da2bc9e71e515526ff1a5d6b` and 924 R2
`068e7d64a0d50c6f1f54c9020ca005357ce1ea99`; it does not deploy them.

## Composition

Schema 59 appends retraction identity after existing answer identity. It
preserves answer receipts, closure facts, delivery IDs, reasons, states,
groups, counters, sequence, indexes and triggers. Ordinary and answer
message deliveries retain 625's partial unique index and recipient guard;
retraction deliveries add their own disjoint identity and recipient guard.
A downgrade to 58 preserves every old record, including populated answers,
and refuses after a removal. Older 56 data still traverses all three steps.

The combined delivery painter, CLI and hosted notice distinguish answers,
retractions, requests and ordinary messages. Acknowledging a retraction
cannot acknowledge an answer or lift its next-question admission rule.
The answer module imports dossier roots at use to avoid the import cycle
created by the composed delivery schemas.

Removing an answer now excludes resolved and superseded questions from wait
recovery. The original 151 recovery revived both a topic wait and a
Conversation wait after 932 resolution: the new tests demonstrated both
failures. A removed question has no current question projection or Resolve
operation. The page keeps removal separately from immutable question closure
facts, suppressing stale controls and cover waits without inventing a closure.

924's shared reply painter goes through the current page's parent-context
owner, preserving 891's author-only suppression of withdrawn question words.
Initial rendering and later repaint share that behavior. 151's terminal
source refresh retains supplemental dossier heads and scoped denial handling.

## Checks and fixture adaptations

`test_removal_composition_151.py` checks resolved-question recovery in topics
and Conversation, independent answer/retraction acknowledgment, and refusal
to resolve a retracted question. The page checks retired controls, stale reads,
cover waits, and withdrawn-parent excerpts with the real owners.

`test_removal_migration_151.py` archives actual schema 56 and exact approved
625 schema 58 sources into separate temporary directories. It seeds populated
records, verifies all old rows and delivery constraints through upgrade and
rollback, checks read refusal and idempotence, then verifies that a removal
blocks downgrade. The 58 fixture contains both a closure and an answer receipt.
The historical 56 index check accounts for 625's replacement of ordinary
message uniqueness with a partial index; named indexes and uniqueness remain
asserted. Existing schema expectations advance explicitly to 59.

Meaningful applied mutations remove the closure recovery filter and drop
answer identity from migration's preserved columns. Both must fail; restored
controls use fresh Python caches and match the original file digest.

The cover fixture now follows returned message cursors: a 32,000-character
cover plus new metadata can fill a page before its requested row count.
The two-ask recovery fixture uses distinct recipient sets because 932
intentionally supersedes identical questions in one dossier. Page fixtures
supply the actual new question owners and read nested spans as browser text,
retaining the same assertions. No product size limit or assertion is widened.

The cohort plan lists every file: Core affected families and direct page
module consumers, run on both the approved base and carry. This is not a
whole-suite or native-browser claim. Existing failing cases are compared by
identity, with raw outputs retained; hosted judgment and deployment remain
with the landing owner.

Raw evidence is under
`/Users/commonfabric/.local/share/theseus/auditor/evidence/`:
`151-carry-cohort-plan.json`, `151-carry-head-core-final.json`,
`151-carry-base625-core01.json`, `151-carry-head-node-final02.tap`,
`151-carry-base625-node01.tap`, `151-carry-mutations.json`,
`151-migration-schema59.txt`, and the retained intermediate red runs.

## Final results

Core: 854 checks on the carry, with 185 assertion failures and 95 errors;
750 checks on the exact approved 625 base, with 186 failures and 95 errors.
All 280 carry failure identities also fail on that base. The existing
refresh-request migration fixture repaired by approved 151 now passes.
All 151/924/932/625-specific checks pass. No new Core failure remains.

Page: 1,440 checks on the carry, 1,430 passed and 10 failed; 1,410 on the
base, 1,400 passed and the same 10 failed. The shared failures are the two
line-writer audits, one outcome-card ownership case, one reader-recipient
origin line, and six unread-landing cases. No new page failure remains.
The final star fixture repair models the actual local words-span lookup,
as well as nested text aggregation; the original exact-name oracle stays.

The CI input audit reports 244 pre-existing declaration errors against 247
on the approved base, zero newly introduced errors. This is comparative
regression evidence, not a claim that the inherited suites are green.
`151-core-comparison-final.json` and `151-node-comparison-final.json` list
exact failing identities, and both applied mutations fail while their
exactly restored controls pass. No native browser run was made for this carry.
