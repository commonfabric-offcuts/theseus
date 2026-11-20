# Decisions in the Reader (860)

The Reader shows the same go-ahead choices and recorded answers as a message
card. One renderer in reactions.mjs owns the choice words, eligibility,
selected answer, other people's answers and the outsider explanation. Cards
retain their delegated spans; the Reader draws actual buttons on its existing
reaction line below the source message.
The Reader's own thumbs-up action and its existing count remain intact.

Only an addressed human can decide a go-ahead question. A withdrawn question
offers no decision and does not regain an unanswered label. Prior answers
remain visible. Non-message and unavailable Reader sources show no controls.

A Reader decision uses the existing Reactions.answer command path with the
message's current answer revision. While pending, its choices are disabled and their DOM nodes stay in place.
The existing learned-result owner updates both surfaces. A late completion
cannot answer a different Reader source, erase newer writing or replace the
current source's controls; a refused or lost answer keeps its existing notice.

Focused checks exercise the actual shared drawing and Reader command wiring,
including selected/other answers, outsider/agent/tell/withdrawn states, pending
and refused results, source changes and the same exact command revision.
The missing Reader decisions must fail before the change. Applied mutations
must fail assertions and exact restored controls must pass. These checks make
no native keyboard, focus, layout or browser claim.

This is page-only work on live157, schema55. It preserves 366's withdrawal
guard and all later shipped behavior. No Core or schema change belongs to860.

Warp11989 confirms this placement and requires propagation both ways: a card
answer appears in the Reader, and a Reader answer appears on the card.860 may
land when approved at a safe shared-test-slot boundary, ahead of829.
