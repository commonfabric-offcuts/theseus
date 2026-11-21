# New arrivals during this visit (833)

A message by someone else that arrives while its topic is open carries a red
`new` in its header. Scrolling and the server's read receipts do not clear it.
The mark belongs only to this document: topic navigation keeps it, while reload
or closing the tab forgets it. No browser storage or server record is added.

An action on that message clears its visit mark: fold, Reader or composer open,
reply, thumbs-up, star, or a phone tap. Expanding a stack preserves the marks on
its replies. The dossier header and folded/earlier counts include the union of
the existing New messages and visit-marked messages, counted once, using 781's
red New control. That control opens the newest eligible message and clears its
visit mark through the existing completed-open path.

Only accepted live message pages add marks. Initial pages, older history,
repaints, moved dossiers and messages fetched on returning to a topic do not.
Repeated responses cannot restore a handled mark. The in-memory owner is scoped
to the document, instance, reader and authority; another identity starts fresh.
The server's read rule and existing receipt/authority fences remain unchanged.

Source: Tony's Landing 11030 and 11051, accepted defaults 11031/11047, item 833,
and the accelerated parallel build order 11109. The final base is live 119,
ab845d8168530dbbe560cee5651c85f2c7cd2f41, including 781 and 834. Validate with
focused units and isolated native Chrome/WebKit observations at laptop and
390px widths. No browser suite or physical-phone claim.

## Validation, 19 November 2026

The live-page check failed before the arrival callback was connected and passed
afterwards. Three visit-state tests cover live versus initial/older/own arrivals,
already-read incoming messages, late answers, topic return, reload/identity reset,
and folded counts. The existing 781 application check now supplies the real
visit owner and executes the actual combined predicate; an added test verifies
that an already-read live arrival stays marked after an unknown read result,
retries the identical operation, then clears only with its confirmed receipt.
Its phone stand-in now has the real header wrapper and action callback. No
assertion was removed or relaxed.

Standalone observations in owned Chrome for Testing and WebKit processes passed
at 1280px and 390px: arrivals, scroll persistence, native topic round-trip in one
document, stack expansion, fold/phone tap clearing only its target, exact newest
New selection, reload reset, reply composer, Reader, thumbs-up and star. Chrome
had no JavaScript or HTTP errors. WebKit had reload-time access-control fetch
errors; unchanged live119 reproduced that error family during reloads. All
observed feature actions completed, with no HTTP error response. Mobile WebKit
uses PageDown/PageUp because that engine does not expose mouse-wheel input on a
mobile page; this is not a physical iPhone swipe claim. All browsers were closed
through Browser.close. The first observer's missing star selector and unsupported
mobile wheel attempt are retained in the evidence, then corrected in the observer.

Seven existing focused test files are compared by exact failing names against
live119, plus the visit-state file on the candidate. The original 781 renderer
fixture failure and existing inline-page stand-in failures remain outside this
slice (832). Baseline: 332 tests, 215 pass, 117 fail. Candidate: 336 tests,
219 pass, the same 117 fail, with no added or removed failing name. This is not
a clean-suite claim. The build is cf48826631ca853585a7;
all six changed served product files match source bytes. Evidence packet:
`auditor/evidence/item833-11109`, including native JSON/HTML/screenshots, baseline
reload comparison, initial test summary and final test output, and served-source hashes.

## Final follow-ups under the no-test instruction

After the initial 833 freeze at 1af92008, source review found that hiding an open
dossier's first message by clicking its title bypassed the Fold callback. That
path now reports the same action, clearing only the first message; beginning a
rename does too. The focused title-fold assertion failed before this hook and
passed after it, before the later no-test instruction arrived.

Tony then requested that the missing green selection for 781 on both Mac and
phone ride in this release without testing (781 fixes 11137/11148, Warp11142 and
11149). New now explicitly focuses and lights the live chosen message before
awaiting whole words, re-acquires its node after layout, and restores the light
after the receipt repaint only if focus still belongs to that selected card.
Already-focused cards no longer depend on another focusin event. The original
source/revision/authority and exact confirmed-receipt guards remain; a later
user focus is not reclaimed. The existing extracted-function fixture is supplied
with the additional menu binding, but has not been run after this selection fix.

No further test or browser run was made for these final changes. The counts,
served hashes and four browser observations above describe the initial 833
freeze, not proof of the final selection behavior. Final source review is Warp's;
Tony tests on live. The trailer is Pipeline: 833 per11151: 781 is already shipped
in119, and this release body names its follow-up without shipping its item twice.
