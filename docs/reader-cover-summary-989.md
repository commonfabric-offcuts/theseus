# Read the collapsed cover summary (989)

Warp14516/14523 and item989 assign the Reader's one-line cover summary: bold
and code show their words, written links show their label, without the inline
marks visible in963's previews. New own base is release271/90f48a872fa02b98ac8f7b317d007de6107cb1a2.

Reader.paintCover currently assigns the raw standing words (then payload,
then the existing wait description). Use the existing inline painter for the
authored summary text and copy its visible text into the summary's plain
span. Do not insert formatted controls/links into this one control. Preserve
plain/escaped words, fallback precedence, payload pill, revision/change key,
root/access semantics and expanded963 cover rendering. HTML stays literal in
the summary; no new HTML interpreter or network lookup. Existing CSS owns the
one line and ellipsis.

Retain a real Reader red before product; exercise nested marks, code, link
labels, literal/escaped negatives, unchanged plain760 chains, payload/wait
fallback and repaint/open-state controls below the browser. Native isolated
Chromium/WebKit check the actual Reader renderer's collapsed words and native
summary toggle at1280/320 in both themes/looks, not whole-app or physical-phone
behavior. Record observed engine/source hashes and all owned cleanup. Compare
the relevant Reader/cover/inline cohorts to pristine271; keep existing reds
unwaived. Follow Landing14500's per-seat load rule (below12 on18 cores), freeze
on own green, push only the exact own branch, and ask Warp for the diff/test
read. Fable owns binding/stages and Warp carry/deploy.

Run the direct checks with `node --test tests/ui_reader_cover_summary_989.test.mjs tests/ui_reader_cover_760.test.mjs`.
The native runner is `tests/reader_cover_summary_989_native.mjs EVIDENCE_DIR`
(`--red` reads the exact271 Reader origin, `--webkit` selects WebKit). Set
AIM_PLAYWRIGHT_CORE to the installed matching module, and AIM_CHROME to
Chrome for Testing for Chromium. Its reports record actual browser type,
candidate/baseline source hashes and owned fixture/browser cleanup.
