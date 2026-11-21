# Quoted feed reply regression checks (947)

Tony's13838 and13958 pictures showed an empty card reply still open after
publication.941 had already repaired the inline-origin Reader's publication
callback in214. A reloaded tab then passed Tony's quoted-send check
(“test... works!”); Warp14001 closes947 as fixed by941 and asks for this
**two-file test/document package only**, on239. There is no product change,
new fix, schema change or fresh-reproduction claim.

## Checks retained

`tests/quoted_feed_send_947_native.mjs` drives the real page through an
isolated HTTP/Core fixture and Playwright with Chrome for Testing. It keeps
the actual quoted line while adding the reply, rather than replacing the
visible quote with a short word. Each case uses its own context and parent.

The final239 run passes28/28:1280/390px, light/dark, with seven gestures:

- quote a feed passage, return from Reader, send from the card;
- quote a feed passage and send directly from Reader;
- open the inline field first, quote in Reader, return and send;
- ordinary unquoted card Send;
-941's inline-origin Reader Send;
- an unquoted `mine` reply to a nested open Ask addressed to the person;
- a quoted reply to that same open-Ask shape.

The Ask cases prove Core's question was waiting beforehand and answered
afterward. Each send proves the reply's source identity and actual quote
excerpt/revision, typed body suffix and visible sent card. Unsent writing is
visible before Send. The empty card field must close and remain closed during
a bounded1000ms late-repaint observation; this is not a speed assertion.
The browser API closes every run, and the harness checks observed browser
PIDs/profile processes absent, fixture EOF0/absence, empty fixture stderr
and closed origin port. Phone-width evidence uses emulation, not a physical
phone. The executable supports `--webkit`; the final239 freeze was run in
Chrome only.

Run from the checkout root with `AIM_PLAYWRIGHT_CORE` naming the installed
Playwright `index.mjs` file and `AIM_CHROME` naming Chrome for Testing:

```sh
node tests/quoted_feed_send_947_native.mjs /absolute/scratch/evidence
```

## Evidence and limits

Raw evidence:
`/Users/commonfabric/.local/share/theseus/page-lane6/evidence/947/`.
Final `chrome239-final/results.json` has28 passing results, source hashes and
verified cleanup. `CHECKPOINT.md`, `CHECKPOINT.json` and `CHECKPOINT239.md`
retain the earlier investigations. No product failure was reproduced and no
failure is waived by these controls. The existing941 evidence records its
actual historical failure and correction; this package adds no new mutation.

Earlier unchanged220 probes pass22 Chrome path/keyboard cells and four
WebKit inline-quote cells; four fresh236 inline-quote cells also pass.
Those used earlier harness revisions and are not claimed as final239 runs.
The two initial valid Chrome probes repeat the later matrix and are not
added to22. Initial unquoted239 Ask probes pass2/2; the repaint run's first
unquoted cell passes. Its quoted cell stopped on a fixture selector mismatch:
Reader plain paragraph spans expose `data-start`, while the feed uses
`md-p`. The corrected selector is included in the final28/28 run. Earlier
unsupported directory import, wrong feed paragraph selector and wrong quote
field (`text` versus Core's `excerpt`) are retained as harness failures,
separate from product behavior. All launched fixtures/browsers were cleaned.

Nothing here reopens947, changes941/937's publication guards or claims a
physical-phone result.959 is next, then954, per Warp14001.
