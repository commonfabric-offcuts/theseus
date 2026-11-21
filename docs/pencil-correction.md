# Pencil sheet correction (items 673, 670, 671, 672)

An answer for a sent message can close only the same presentation and opening,
with the same text version and successor writing cycle. Images belong either
to that successor cycle or to a frozen submission. A successor's selected image,
open picker, capture/upload, or unresolved image recovery keeps the sheet open.
A submission's frozen images do not by themselves hold the successor open.
`currentImages` and `imageBarrier` supply those ownership and recovery rules;
upload transitions do not necessarily increment the text version.

The correction's native cases are registered by `runPencil` in
`tests/reader_compose_native.mjs`. `tests/pencil-states.mjs` lists each explicit
branch. Every case has Topic and Conversation, 320/375/390 and laptop, light and
dark variants, in the harness's two engines. Registration is not execution.
Publication and preparation cases hold their different actual boundaries.
Loaded access checking/recovery uses the native Retry access act and the real
loaded availability check. Local and server saving hold their respective real
persistence boundaries. Rare presentation branches are explicitly marked model
fixtures; they exercise the real status/image/choice renderers without claiming
a production failure. Late-image cases hold a real Core `message.send` committed
answer, use the native file chooser for successor writing, and then release it.

Measured positions use a case-named 2 CSS pixel tolerance, target sizes a named
1 pixel tolerance, menu spacing 1 pixel, and menu height 2 pixels. Field growth
allows 4 pixels around the added line heights; the one-line field includes its
named padding allowance. Card count, order, IDs, exact writing, send identities,
status and selected-image identities stay exact. The native 12 pixel card move,
full-height sheet, fixed field and enlarged menu mutants must still fail.

The next builder/fixer/assembly brief and independent review checklist must
retain both rules: every measured position/size assertion names a tolerance in
its case, wide enough for the runner engines and narrow enough to reject its
meaningful mutant; every affected element branch (normal, saving/busy, refused
and recovery, read-only, empty and error) has its own native case at 320/375/390
and laptop in both themes and engines, and a fix reruns every state of that
element. Missing native evidence is unrun proof, not a newly inferred product
defect. Historical receipts retain their original source identity.


The bounded overnight continuation first merges live a958f7cd with the retained
f28458aa head. Context seeding reuses the coordinator act's recorded result;
retrying that act with a new expected revision is an operation identity error.
Native save cases place the caret at the end by the keyboard, and every held
server save shares one release gate. Cleanup retains its own error beside the
first error; it cannot overwrite the failing assertion.

The inline image Remove button occupies a separate flow slot. Its old 44px
corner hit target covered the center of a 44px thumbnail: an intended opener
press could remove a memory-only image, leave a ready image without its Remove
control, or prevent a removed capture/upload from finishing. Native checks
assert the opener center is reachable and the exact selection survives before
releasing the held send answer. Phone-width inline controls retain their 44px
floor even if a chooser changes the browser's pointer media mode.

A confirmed answer also leaves an outstanding inline picker, image list,
agent/naming menu, or newly reported error in front. These presentation owners
are additional to the existing presentation/opening/text/cycle/image fences.
Four separate successor-presentation cases join the full matrix for both
Send gestures. Normal cases in both engines precede any applied mutation;
registration and local contracts do not claim a native pass.

The final bounded correction adds exactly four selectors: `item 673 shard
chromium topic`, `item 673 shard chromium conversation`, `item 673 shard webkit
topic`, and `item 673 shard webkit conversation`. Each owns 592 unchanged normal
names, 30 actual native mutations and their 30 exact restored controls. Their
union is the retained 2,368/120/120 inventory, with empty intersections. The full
`item 673` route and unrelated literal substring filters keep their meaning.
Shard phases run their normals before applicable mutations, failing closed on
normal failures. An empty or incomplete phase is not acceptance.

Observation is passive until the application's existing ready transition after
initialization. It returns the exact send promise with its receiver and arguments,
and observes fulfillment/rejection without an unhandled finally promise. It
never changes startup scheduling or independently settles Send. Native save
insertion uses document-end movement, inspects the exact text and caret, and
asserts the complete result. Journal attention now comes from repeated real
backend put refusals for that editor, retained until controlled persistence
recovery; its rows, stamps, writing and save operation/receipt identities are
traced. A successful recovery-copy retirement is distinguished from failure to
persist. Held routes wake on exceptions, release before page closure, and keep
primary and cleanup errors separately. Browser ownership ends through close.
