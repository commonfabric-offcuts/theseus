# Item 799 — real dossier heads above the loaded page

Seat: codex-799-head10025, under Warp10013. Base: release102,
602fbb03ec343261e35ffea5e7a561712dc016f6. Ordinary UI design correction.
Tony9936 reports a Fast Trains reply appearing stray even though Core places it
in a dossier rooted roughly 1,500 messages earlier. The actual report text and
picture have not yet been captured; ITEM-ACTIVE's attributed summary is the
available source. No original screenshot will be manufactured.

## Result

An admitted distant first message heads its dossier, folded to the normal head
row with its real first line and dossier name. All loaded branches, including
the formerly gathered head, remain replies within the folder. A loaded real
head and a standalone message retain their existing rendering. This is not
item796/801 and does not alter item800 private-note folding.

## Identity, admission and lifetime

Use the existing topic_messages view with explicit message_ids, bounded to
roots named by the loaded messages' Core stack_position.root_id. These are
admitted ordinary message items, never invented bodies or reply excerpts.
Keep supplemental heads separate from TopicViews.messages, its runs, newest
and olderCursor. A supplemental item is presentation-only and cannot imply
that the intervening history is loaded. A missing/private source is never
substituted by the oldest loaded reply. Root reads carry a generation and
exact topic/root identity; obsolete results cannot paint after navigation,
access changes, root membership changes or a newer read.

Loading is explicit. Errors, refused access and missing sources are separate
states. Only a source that cannot be shown uses “Reply in <dossier name>”,
opening the canonical root route through the existing guarded navigation.
Loading and errors have clear status and a retry, without asserting missing
or refusal. An available head always uses the default. Revalidate on relevant
acts, source edits and admission changes; discard supplemental bodies before
revalidation. Unknown source names use a neutral dossier label, never private
first-line text.

## Gathering, paging and placement

Retain item550 grouping, branch visibility, descendant order, loaded-page
sorting, placement and More fill/apart policy. Decorate gathered stacks with
supplemental admitted roots after their loaded grouping and position are
computed. A supplement contributes no placement key, pagination frontier,
newest/lifted sequence or implied loaded count. Preserve the former gathered
head as a visible branch. Root identity is stable across More; when the real
root is paged in it occurs once, with source ownership handed to the page.
Supplemental entries never lower fillFrom's loaded frontier. Page read-through
continues to use TopicViews loaded runs. All redraws use keepListAnchor and
preserve focus, scroll and writing.

## Implementation boundaries

No schema, Core permission or new Core view. Existing declared renderer/app
and reading test inputs only. Any need to modify protected runner/input
declarations is returned as a concrete classification boundary before editing
those files. No live store/tree, credential/profile/session/env reads, board,
flight, push, PR, deployment, signals, delegation or unowned work.

## Acceptance and evidence

Exactly eight own scenario cases named with literal prefix “reading item 799”:
320/375/390 and laptop, each light/dark, in each engine. Each case exercises
real isolated Core receipts and view admission before browser; distant root
and loaded reply, ordinary loaded head and standalone negatives, native
pointer/touch exact source and canonical dossier navigation with writing kept,
More without duplicate/frontier invention, meaningful placement, privacy and
fallback. Own branches live inside those eight cases. Loading/error/missing,
revision and stale navigation are checked below browser where appropriate.
Dry-enumerate the actual readingChecks entrypoint before freeze.

Use actual product-source mutants, assert they applied, retain meaningful
red failure, restore bytes exactly, then pass restored controls. Every measured
size/position carries a realistic named tolerance and a crossing mutant.
Failure diagnostics and screenshot precede page close; retain screenshot
capture error separately. Close owned pages through the harness and preserve
Browser.close, fixture exit, cleanup and health evidence. Native phone widths
are emulation, not proof on a physical iPhone or its OS keyboard.

## Budget and delivery

Zero previous starts. Exactly two allocated serial starts: native-reading,
then native-webkit-reading, both ^reading item 799, max1 each. Sixteen of the
whole-piece eighteen remain unallocated. Only driver pool_requests may start
them; freeze clean source before requesting, no interengine edits or retry.
Read the entire first result before requesting the second; own product failure
stops spending. No local HTTP/browser/whole suite. Focused Node checks run
serial with concurrency1; any Python workload uses CPython3.9 and an effective,
asserted unique PYTHONPYCACHEPREFIX per control/mutant/restoration.

Return whole SPEC/REPORT, exact head/tree/ordered parents, full binary diff,
all tracked source SHA256, original/local/native artifact hashes and source
capture bindings/omissions, literal case/phase counts/errors, selected actual
phone/laptop captures with device limits, and budget. Unrun is never passed.
Independent review and composition belong to root/auditor, not this builder.
