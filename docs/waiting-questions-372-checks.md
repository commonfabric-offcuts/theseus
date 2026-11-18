# Checks for every waiting question (372)

`tests/test_waiting_questions_372.py` creates an isolated outcome with topics
A and B and two Conversation asks through Core commands. It asserts four
identities, exact source opening, no database mutation by reads, expanded
actual-reader topic/list metadata, existing settlement differences, said-wait
deduplication, archive/done behavior, thumb/undo, metadata query scope and
exact-message blocking. `attention.waiting_on_me` still counts three places.

`tests/ui_waiting_questions_372.test.mjs` holds passive oldest-question hrefs,
same-page topic advancement and wrap, four-identity cycles across page loads,
and independent remembered positions. It is a unit check, not native evidence.

`tests/waiting_questions_372_native.mjs`, called by
`tests/topic_reading_native.mjs`, offers eight `reading item 372` cases to
`native-reading` and `native-webkit-reading`: 320, 375, 390 and 1280 pixels,
light and dark. Each records actual synthetic A+B+two-Conversation asks,
asserts the exact four source identities/count, presses the outcome light five
times with Back between presses, observes each source once then wrap, and
adds a second ordinary-topic ask to prove three repeated row presses stay on
the same document and cycle both asks. Narrow cases use native touch events;
the laptop uses native pointer events. Escape closes the Reader. Named
tolerances are viewportOverflowPx=1, targetEdgePx=1 and
minimumVisibleHeightPx=1; measurements and native targets are retained.
Existing compact light-control sizing is recorded, not redefined as a new
44px requirement. This does not qualify general target sizing.

The test builder's raw results, mutation/control logs and exact source
manifest live under `checks/372-tests9358` in the coordinator's evidence
directory. An offered case is not proof it ran or passed; consult REPORT,
SOURCE and ACCEPTANCE there. Cases close their owned pages in `finally`;
the harness owns browser and fixture teardown and reports actual health.

The supplied preview files remain byte-for-byte unchanged. Parent-96 red
checks and four applied/caught/restored mutants cover wrong count, second
Conversation omission, blocking topic deduplication and first-only topic
presses. Each Python mutation and restored control has its own effective
CPython 3.9 cache prefix. The first Python invocation accidentally ran the
candidate before the parent red; its log is retained and this chronology is
not described as strict red-first execution.

The copied live-data scenario and physical-phone feel were never exercised
by this seat. Asker withdrawal is absent and NOT COVERED. Neighboring focus,
To/writing preservation, permission changes while open, recovery, deep paging,
Only new and both-rail integration remain qualified by the checks actually
run and source reads; this piece claims no blanket qualification. No scaling
claim or performance measurement is made.

The first full Python run retained 3,169 tests and 11 failures. Corrections
to verification code distinguish compact durable wait heads from expanded
question navigation, count both blocking and plain asks, repair two ledger
anchors, classify the relocated visibility query, and declare the own case's
two generated-database reads. Focused controls cover these corrections; the
full Python raw result remains failed. Nineteen undeclared input reads also
exist on parent96 and remain unresolved here.

Verification-order breach: the builder applied two temporary product mutants
to prove the repaired ledger anchors after the native runs, then restored
both files byte-for-byte. The brief explicitly invalidates native binding
after product edits, so those 8/8 results in each engine remain historical
evidence and are not final qualification. No native retry is authorized by
the four-slot allocation. The handoff remains not ready despite restored
product hashes; the coordinator decides the next action.
