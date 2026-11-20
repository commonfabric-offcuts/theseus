# Item 932 verification

Base: release 205, `6e5d2098b178e6fbaf3d2591d1393bdf7923557c`.
The contract is in [question-resolution-932.md](question-resolution-932.md).

## Core

The 11 new cases in `tests/test_question_resolution_932.py` cover identical
recipient sets versus different sets/askers/dossiers, go-ahead supersession
without an answer, asker/coordinator authority, atomic rollback, exact retry,
immutable closure, retained words/deliveries, existing thumbs and Undo,
Conversation waits, record-owned decisions, source/feed/delivery agreement,
migration/occupied rollback, closed outcomes and legacy manual cover sources.
Four original feature checks were red on the unchanged base.

The 11 new cases, 12 withdrawal cases and six ask-cover cases pass. Applied
authority-guard removal fails the authority test; exact restoration passes
with a fresh Python cache. Withdrawal's old migration assertion now names the
current schema constant; its migration and closure assertions are retained.

An expanded cohort ran 99 cases: 39 passed and 60 failed. The same 60 test
identities fail with the same refusal codes in the three old modules on the
unchanged 205 tree (70 cases there): `test_reactions`, `test_thumb_answers`,
`test_blocking_asks`. They omit current publication requirements: 55
`ASK_WAIT_REQUIRED`, three `REPLY_PASSAGE_REQUIRED`, two
`DIVERGENCE_REASON_REQUIRED`. This change does not repair those fixtures or
claim that broader cohort is green. The comparison includes every failure,
not a sample.

## Page and native checks

Seven Node files pass 117 cases: question resolution, question withdrawal,
dossier cover, reactions, stack order, freshness and pressed reactions (882).
The new cases cover authoritative affordances, stale-cover filtering,
successor links, terminal state monotonicity, ordinary thumb Undo, exact
unknown-outcome retry, duplicate presses, old-page responses and learning
before reload. Applied removal of the cover filter fails; exact restoration
passes. Existing withdrawal scanner checks now follow the actual shared menu
and extracted-function boundaries; their assertions are retained.

`tests/question_resolution_932_native.mjs` passes four final cases: 1280 and
390 CSS pixels, light and dark. It uses an isolated Core/HTTP fixture and
Chrome for Testing. Native cover clicks open the Reader; Enter or touch
resolves. Real refresh requests are held at the browser transport while the
receipt removes the cover wait. The Reader and words remain, reload retains
the result, a native successor link opens the resolved question, and both
questions still have no yes/no answer. Header bounds exclude overlaps greater
than 0.01 CSS pixel (DOMRect shared edges differed by 0.000002 pixel). Screenshots
were inspected. The fixture's explicit synthetic actor option avoids a server
restart changing its independent comparison-build identity.

Earlier native attempts are retained. 01 had a wrong expected display string
(missing required reply context) and a restart-induced fixture build mismatch;
02 had an invalid unnamed read hold and a subsequent Reader timeout; 03 had a
route-release/unroute race and ended before its cleanup report (a subsequent
process inventory found no fixture or test browser). 04 passed the four
behavior cases. Screenshot review and 05 exposed header hit-target overlap;
spacing was fixed. 06/07 refined the geometric assertion after a shared-edge
floating-point overlap; 08 passed, then phone navigation alignment was restored.
Final 09 passes all four cases, with actual held-request counts, no page errors,
Browser.close disconnection, zero owned-profile processes, fixture EOF/exit 0,
fixture PID absent and its port closed. No user browser or live records are used.

Raw local evidence: `/Users/commonfabric/.local/share/theseus/auditor/evidence/932-*`.
The final native result is `932-native09/results.json`; Node output is
`932-node-final.txt`; baseline comparison is
`932-baseline-failure-classification.json`. Authority and cover mutations have
separate mutant and restored outputs. Source is frozen only after these checks.

## Composition and defaults

Schema 57 is provisional until composition with 151. Preserve 928's derived
Conversation repair when combining: closure deletes its exact
`conversation_waits`, synchronizes waits, then calls `_touch_topic` in the same
transaction. This branch does not replace 928's `topic_state.py` change.

Existing thumb clearing remains the default for both old and new plain asks.
Resolution and supersession are distinct from explicit go-ahead decisions and
withdrawal. Target/stage-owned decisions keep their existing authority.
