# Item 768 own checks

Historical check-slice record, retained verbatim below. The current source-only
731 composition and omitted harness/CI declarations are recorded in
[768 preparation](text-display-768-preparation.md). None of the results below
accepts that composition or allocates a new run.

The product source starts at approved preview 2740617c08044d10e16391d3b4437a1e59e4b66c,
tree 45d95ae126e34545579ca49483e4310068897f97. These checks implement spec
9118 section 7 with 9139, 9149, 9155 and 9217; the preview's feel approval
supplies no test receipt. No product files change in this check slice.

`tests/ui_text_display_768.test.mjs` exercises the actual formatted-word parser,
drawing and registry, with fixtures in `tests/text_display_768_fixtures.mjs`:
exact mapped UTF-16 characters and source runs (including CRLF and Unicode),
pure and idempotent partitions, protected inline spans and block identities,
list markers/tasks/depth, exact source projections at selection ends, rejecting
corrupt transforms and in-place mutation, registry order, and scoped preferences.
`TEXT_DISPLAY_SOURCE` selects an extracted source directory for prefeature red.
The actual prefeature is release97 3187c1bc851bdb256c272928a00dce974e2c8e48,
the preview draft's parent. The behavioral red is one unsplit drawn paragraph
where three are required. Missing stage failures are separately retained.

`tests/text_display_768_native.mjs` is registered by the existing reading checks.
All seven native cases contain `item 768` for the allocated filtered runners.
Six cover laptop/phone widths and sentence/enumerator/list fixtures, in each
case cards and Reader: real pointer drag, native Copy, Return, lit Copy/Return,
the existing ellipsis toggle, immediate Off/On redraw, retained writing,
reload persistence, unchanged saved source and protected formatted marks.
A separate case checks actual browser localStorage reader/instance scope and
another browser context as a separate device, while the original remains On.
Reader identity isolation uses the real preference module on actual storage;
it does not claim an authenticated second-person UI session.

Native selection uses measured word rectangles solely as pointer coordinates;
no Range, Selection API or handler call creates the selection. Chromium reads
the actual clipboard after its native Copy edit command. WebKit pastes with its
native keys into the reply and undoes the paste. Permission failures are errors
with their exact diagnostics; no stub supplies clipboard content. Native pointer
selection at phone width is not physical touch selection or iOS acceptance.

The Reader paragraph spacing assertion names a 1 CSS px tolerance and 4 CSS px
minimum gap. Its in-case mutant actually changes sentence spans to inline with
zero margins, must fail the same geometry assertion, then is removed and the
original geometry rechecked. The focused source mutant changes partition slicing
to drop the first character, verifies the mutation bytes, requires failure,
restores the original bytes and requires a passing control. Raw logs, patches,
source identity and hashes live in the owned external evidence directory.

The only hosted allocations are reading-768-9295, webkit-reading-768-9295,
python-768-9295 and node-768-9295, once each. Start count before this build: 0;
14 of the whole-piece 18 remain unallocated. The native pair precedes whole
units. No test failure is waived. Independent review under 8139 follows;
neighboring keyboard traversal, access, conflict, recovery, physical iOS and
native touch-selection evidence remain explicit gaps.

## Repair and diagnosis under auditor 9387

The repair starts at frozen 3289d650, without changing product bytes. The
inline-wiring dependency loader now discovers namespace imports and binds their
actual module exports; its focused check runs the actual parser, registry and
rule through the VM. Three item 614 mutation anchors retain displayRules while
removing only struck-word propagation. A focused app-wiring check covers initial
cards and arriving edits; the existing formatted-word check covers expansion.
The correction-probe check executes the actual extracted `readable` function
with bounded protocol replies for true, false and rejected fetches, checking
owned target cleanup and preservation of the result/error. This is below-browser
instrument evidence, not a new correction-mode native receipt.

The ten filtered native cases retain the original six own paths and device
isolation case, and add three named diagnostics. Passive observers record actual
capture/bubble pointer, mouse, selectstart, selectionchange, modifier-key and
focus events, their defaultPrevented state, selection endpoints, hit coordinates,
visibility and computed ancestor styles. Ranges measure pointer coordinates only.
The diagnostic compares Off and On on the same authored interval, separate
standalone default button/div controls, and actual prefeature public web bytes.
The fixture uses its existing isolated immutable-Build swap mechanism, with a
separate 125-file archive authenticated against 3187c1bc's exact Git blobs.
Both source maps and restored Build identity are retained; candidate Core and
records stay in the fixture. Restoration runs in finally and fixture teardown
refuses an unrestored comparison. No control substitutes for the six own paths.

New reads are declared in tools/ci-input-reads.json; the exact 19 prior findings
remain carried. Four prior hosted starts plus exactly two allocated diagnostics
means at most six starts, with twelve of eighteen unallocated. Only Chromium
is requested first. Its complete raw return, source bindings and cleanup must
be read before any WebKit request; a demonstrated product/parent conflict stops
this seat with WebKit unused. These allocations contain no full acceptance run
or retry. Diagnostic success never approves the feature. Physical iOS and
neighboring states remain unproved. No product repair is authorized in this seat.

The first Chromium diagnostic at 8c1685f7 captured Off and six independent On
empty selections, but aborted after reload: its ready predicate could accept
the old document before the replacement arrived. Its default controls and
prefeature comparison were unreached. All 80 captured source hashes match that
commit, and browser/fixture teardown is clean. This failed receipt is retained.
The remaining WebKit allocation uses separate new owned documents for the
Off/On comparison, standalone default controls as their own case, and a new
prefeature document opened after the immutable-Build swap. Each case closes its
pages; the prefeature finally restores the candidate even if page closure fails.
This harness change invalidates any claim that Chromium tested the final
instrument bytes. Product bytes remain unchanged; no Chromium retry is allocated.
