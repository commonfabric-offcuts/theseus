# Topic-foot composer at rest (995)

The topic-foot composer uses its pencil-sheet card grammar before focus as well
as while writing. Its empty card, type, surface and footer remain consistent
across the native rest-to-writing transition. Message/Note and + stay available
in their established header/footer positions. The open pencil sheet and the
985 phone-sheet controls retain their current styles and behavior.

Start from release278. Reproduce the old at-rest style on that exact source,
then compare native rest/writing snapshots at desktop and phone widths in
Bookends and Paper, light and dark. Preserve the baseline failure and preview
pairs; verify served CSS bytes, native focus/typing and unchanged open-sheet
control styles. Browser cleanup uses Browser.close, observed owned PID/profile
absence and fixture EOF/exit0/PID/port closure. This is browser viewport evidence,
not physical-phone keyboard evidence. No Core, schema, sending or viewport logic
changes. Warp owns independent review/carry/landing and Fable owns stages.

The dense-card state gate is widened without changing its specificity. The
black material and touch rules also include the embedded home: those rules
previously matched only an open dialog. Existing open selectors are retained,
so their cascade and the 985 phone layout stay intact; Notebook mode remains
excluded.

Run `tests/topic_foot_rest_995_native.mjs` with `AIM_PLAYWRIGHT_CORE` pointing to
Playwright and `AIM_CHROME` pointing to Chrome for Testing, passing an evidence
directory. Add `--webkit` for WebKit or `--quick` for the 390px dark Bookends
cell. `--baseline` records the known rest/focus mismatch on pristine release278.
The full matrix covers 320, 375, 390 and 1280px in both looks and themes, checks
empty-footer parity with the pencil, compares open-sheet styles to release278,
and exercises Message/Note, +, native multiline typing, save and send to the
isolated fixture. This replaces the historical 959 folded-layout expectation
for this deliberately changed surface.
