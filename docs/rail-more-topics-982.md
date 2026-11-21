# More topics in the outcome rail (982)

Build from release267 (`0fa8c8e640ae89d08e50da08642bb5b034698895`).
Tony14304's screenshot shows More topics beside Done (135). Reproduce its
visibility across actual rail-navigation sequences before selecting a fix.
Record shown row identities, authoritative next cursor, list owner and button
state, distinguishing a remaining page from a stale or reset projection.

TopicPages owns the Core cursor and loaded extent; TopicRail owns More and
its paging act plus Done/Archived counts. OutlineRail keeps the persistent
rail and the handoff between its own and a page's list. Reuse these owners.

More shows exactly when eligible outcome topics remain beyond the rows
already loaded. Navigation within the same rail keeps that truth and the
loaded extent; pressing More keeps loading the next page. Exhaustion hides
it. Current-topic/Conversation injection, Done/Archived, Build exclusion and
saved row order retain their existing rules; Done counts do not change.
Default paging remains20, with bounded/scoped reads (901/923), no whole
outcome scan or guessed total. Waiting remains981's dim layer.

Retain a current-head red navigation trace and negative controls for actual
paging, exhaustion and unchanged Done count. Use real owners below the
browser and actual navigation/Core fixture in isolated native evidence.
Routing/extent corrections get an applied/restored meaningful negative.
Under replacement14500, one substantial workload per seat, with independent
isolated browsers after uptime confirms one-minute load below12/18.
Verify Browser.close, observed owned PIDs/profile absence
and fixture EOF/exit0/PID/closed-port cleanup. Fable owns stages, Warp review
and carry; Tony keeps acceptance.

Six focused owner checks retain two current267 reds and four controls. A
21-topic outcome can show all21 because the last is the current-topic row,
yet its cursor still points at that duplicate and More stays visible. After
loading25, a newly constructed route also forgets that loaded extent.

Keep only the read extent (last ordered position and loaded count), scoped
to document, instance, reader, outcome and list/build policy. A new route
rereads fresh Core answers through that extent; cached rows/counts never
decide More. When the separately injected current row lies past a cursor,
one bounded one-row probe checks whether it is the sole remaining row. A
confirmed duplicate is consumed without adding a visible row; an unshown
row keeps the cursor/More. Apply the same check after More. Validate every
probe with TopicPages and publish changed paging state atomically. No new
Core API, total count, saved preference or cross-reader cache.

Final evidence on267: the final native harness reproduces18pass/4fail on
pristine267 and passes88/88 on the candidate in Bookends/Paper, light/dark,
at1280px. Real Core holds21 active topics plus its Conversation and3 Done;
native More/topic/tail-topic/home/topic-again actions retain the actual row
IDs, keep the document and leave Done(3) unchanged. No outline read warnings
or page errors remain. Actual engine is Chromium156.0.8078.47. No phone,
WebKit, performance or keyboard-equivalence claim follows from this run.

Owner checks pass34/34, including9 new checks. All32 test files directly
naming the changed module or selected outline/scoping owners compare:
pristine876/868pass/8fail; candidate885/877pass/8fail. Failed identities and
normalized full diagnostics match exactly; old failures remain unwaived.
Four actual final-source mutations independently break tail reconciliation,
extent retention, reader isolation and shared outcome reread; each fails its
named control, and byte-exact restoration returns9/9 targeted checks green.

An intermediate refactor required a topic-only publication method from the
shared reread function. Screenshot review exposed its outcome warning and
the initial cohort recorded28 introduced failures. The final shared adapter
and WorkspacePages control fix that regression; native no-warning assertions
now cover it. The first native locator assumed button role despite KeyTree's
treeitem role; that timeout, the initial warning-bearing native run, and two
incomplete WorkspacePages fixture attempts remain diagnostics, not proof.
Every browser run retains verified Browser.close/PID/profile absence and
scratch fixture EOF/exit0/PID/closed-port cleanup.
