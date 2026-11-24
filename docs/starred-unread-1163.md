# Starred dossier unread badges (1163)

A starred dossier row shows how many messages in its current canonical dossier
are unread for this reader. The count includes unstarred replies and joined
stacks, excludes messages routed elsewhere, and follows the reader's active
subscription/direct delivery groups and existing unread marks. A pending
delivery plus a mark counts once; an inactive subscription, another reader's
marks, invisible whisper, unsent message or the reader's own writing contributes
nothing. Acknowledging a delivery does not clear an existing mark. This view
performs no read/ack/mark/fold/star/membership write.

The topic-scoped `stars` view extends each existing `dossier` with `unread`
(nonnegative integer, zero by default) and `oldest_unread` (the existing unread
route shape `{id, seq, sent_ms}`, or null). Every star in the same dossier gets
the same complete count, regardless of star pagination. Unscoped `stars`
retains its existing shape. Access, star order, names, previews, removal,
withheld words and bounded star pages retain their existing owners.

Derive only the requested topic's active unread candidates, through existing
`unread_groups`, the pending group/topic index and `marks.MARKED`; resolve
those candidates with `StackRoots`. Read no unrelated topic histories and
persist no dossier counter. Work scales with this topic's eligible pending
rows and marks plus their canonical ancestry, not all already-read members.
No schema/migration change is authorized or required. This Core read-path
change lands JUDGED alone, independent of 1028's colour/schema work.

The outline keeps one row per canonical dossier and its current star order.
Use the existing unread badge appearance and spoken count, absent at zero.
A pointer on the title keeps its canonical-root landing; a press on the count
or Return on a counted row uses its Core-provided oldest unread message with
the same guarded in-feed landing. No extra focus stop or Reader opens. The
existing delivery/mark-to-topic invalidation refreshes the loaded star extent;
a late old-actor read cannot republish it. Notebook-page stars remain unchanged.

Preparation authorizes no test/helper/fixture/native/browser entry. Return the
exact source, cases, input maps and bounded caller for independent coverage
and Fable's grant. A separately bounded isolated Chromium cell remains a
proposal pending Warp's disposition; modeled DOM checks prove no native input,
layout or timing. Existing fixture/runtime limitations must be named.

## Resumed source boundary

Fable21426 resumes the existing Build1 p-4d1efc1eb9a142ef8c4663ba on
release385, commit8a7383a176f9ea7bd3c83c34dbbe5bf4224cd740, tree
2587943e2e5e521748badf557872244ad25e79b3. The379 draft/history remains
untouched. The intended Core and outline deltas transfer onto a new own
worktree; these three owners are byte-identical between379 and385.
All1163 test/helper/fixture/native/browser starts and runtime allowance
remain zero.1176/1178 proof or exhausted allowances do not transfer.
No new piece, migration, pipeline change or release classification is implied.

## Prepared checks and defaults

The finite unit proposal is one Python red on the first new public-view case,
then, after reading that actual reached assertion, one exact application of
stacks.py and outline-dossiers.mjs and a Python23/Node17 green. These are
three enclosing unit roots maximum, two Python and one Node, serial in this
lane. No helper or discovery execution is proposed. Every root has a raw
terminal, time/output bound, full source/runtime before-after maps and strict
owned-group observation; none has started. Existing exact-key assertions gain
only the two added dossier fields. All other inherited assertions stay intact.

Core cases cover nested unstarred replies, complete counts across star pages,
join/split, eligible subscription/direct groups, inactive groups, mark/delivery
deduplication, own writing, other readers, invisible whispers, revoked access,
corrections, unsend, read-only/no-write views and indexed bounded work. The
Node cases paint the real OutlineDossiers owner and reuse actual unread count
and landing selection helpers, alongside existing paging/freshness and shared
route/presentation cases. Memory DOM assertions do not establish native input,
layout or timing. Existing outline.open/Shell/landOnMessage retain guarded
navigation; no second navigation or stored unread authority is introduced.

One separately proposed headless Chrome for Testing cell at1280/light uses a
fresh ui_http temporary store, real Core scoped count and native badge click
and Return, with the actual oldest card on screen, no Reader, then a real
mark clear refreshing to zero. Its35 intervening synthetic notes do not touch
live records. Browser.close, direct fixture exit, strict raw process/profile
absence and closed fixture port are required. A failure/unknown retains its
receipts and stops browser use; no test Chrome is signalled. No phone, dark,
native save-fault, hover or performance result is claimed by this single cell.
The inherited HTTP fixture substitutes calm machine facts; it supplies no
actual machine-load evidence. Entry admission must observe the real Mac.

The default at no eligible unread is0/null and no badge. Stars remain personal;
read-only outcomes remain readable; marks remain independent from deliveries.
The retired right-rail Starred list (788) is not recreated: current scoped
stars supply the outline and current Starred message discovery; unscoped
stars retain their exact old shape. Native inputs, grants and current-live
compatibility are separate from these source preparations.
