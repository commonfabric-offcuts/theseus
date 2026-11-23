# Move and copy Notebook pages with Undo — 1060

Core contract under Warp17503/17535 and Fable17515/17522/17536. The original
pre-edit proposal published at17526 is retained unchanged in its attachment.
One existing
item/piece: p-417791120e4f4b85a9a16e12, topic
t-04025d41539ec6fae6ab10a532b0f32c. Actual intake is release347,
7b890758f36e5dc30fbf6c27594b75f64626ef92, schema65. Own fresh branch/worktree:
page-lane6/1060-notebook-relocation-347-17503. No product edit, test, fixture,
browser or live-data operation preceded this proposal. Tony16210/16214 and
Warp16204/16211/16216 were read through the unchanged bound CLI.

## Actual368 predecessor update (Warp19785)

The source below was checkpointed on367 before HOLD19759. Release368 is now
recorded at a6dbf79558098d9ee97c6612434487719d71f0dc/schema68. This new own
worktree, page-lane6-1060-rebase-368-19785, preserves that checkpoint and the
frozen347/df929b9f trees. The transfer step now follows TEMPLATE67→68 as68→69;
fresh initialization reports69 and includes both TEMPLATE and transfer schemas.
All other current368 source, the current Notebook menu/card behaviors, and the
identity-derived transfer test predecessor remain intact. New test/native
starts remain zero. The71 historical retained result records are not a fresh
18-start budget; a precise cumulative allowance and compatible entry route
must be settled before execution. No earlier approval transfers to this tree.

## Rebase after release367 (Fable19668/Warp19664)

The original347 source and approvals below remain historical evidence. This
Build2 rebase starts from actual367/89c653789cbbcf7eff377af03fc94b021d7eb8f8
in a new own worktree, page-lane6-1060-rebase-367-19668. It preserves every
move/copy/paired Undo behavior and default, plus the current Notebook palette,
Start topic/dossier doors, card keys, editing, selection splitting/quoting and
writing/image ownership. Move to… and Copy to… join the current menu; rail
choices keep the current rail flag and start actions. The existing menu owner
assertion keeps all current entries/actions and adds the two transfer choices.

The provisional source step is67→68 on actual367, with current LINK and LEVEL
steps and367's foreign-key/rollback correction retained. If1040 lands first,
its68 becomes the actual predecessor and this step must be68→69 before tested
source approval/carry. No train order or schema reservation is inferred. The
step-identity-relative1060 assertions remain intact. Source preparation uses
no Core/test/browser import or live store; cumulative historical starts and an
explicit new bounded budget/resource route must be returned before execution.
New Python phases must select fresh caches through explicit -X pycache_prefix,
including under -I; the older environment-only wording below is history.

## Ordered parts

First build and verify the Core commands, migration, four refusal boundaries
and fenced inverse. Then add the right-click/keyboard menu on the rail row,
Notebook panel and page header. Then add native rail drag/drop and Option-copy.
Each part retains its own before/after proof. The final assembled source gets
independent classification/review; this proposal is not a source approval or
claim that a partial implementation completes1060. Fable owns canonical part,
freeze and stage records; Warp owns review and actual predecessor carry/landing.

1028 stays unstarted until BOTH1060 handoff and actual Links LIVE, including
its16064/16068/visible-thumbnail correction/proof gates. Links became live in
348 at1ce8b275d12fd853d1725955c2af7ad073411903/schema66, confirmed through
the bound board/Health after the runner restart. This branch still retains its
actual347 intake; its provisional migration number is not the carry number.
Warp17696/Fable17710 queue1101 for whichever page lane completes its current
piece first, with Fable recording one owner before construction.

## What the current owners actually enforce

`aim_next/memory.py` owns pages, immutable revisions, read marks, stars and
Notebook versions. Its identity trigger currently forbids scope changes;
`memory.revise` cannot move a page. `validation.py` has no move/copy command.
The `memory_star_acts` rows capture their original scope, while `memory_stars`
filters by that captured scope: merely updating a page's scope would strand its
star on the old rail. Both restrictions need deliberate changes and tests.

Existing Core readability is the authority, not the old handoff's abbreviated
audience description: a topic can be read by its outcome's team as well as its
creator, active participants and outcome owner. Writing is narrower. A
coordinator label alone grants no read. Draft pages withhold all words/images/
references from agents. Closed outcomes remain read-only. Existing private
message, removed-source, media and exact-revision rules remain in force.

## Core command proposal

All shapes below also carry the existing v/instance/operation/authority
envelope. One transaction validates rights, exact revisions and all effects;
existing Store operation fingerprinting keeps retry identities and receipts.

* `memory.move`: target `{item_id}`; args `{owner_scope:{kind,id}}`; expected
  `{item_revision}`. The scope is `topic` or `workspace`, within this instance.
  Preserve page id, creator, sequence, all revisions, images and personal marks.
  Append one attributed revision with unchanged content and change scope in
  that same transaction. Return the existing page result shape plus exact old
  scope, new scope and transfer identity. Same-scope move refuses without an
  effect; it does not create an Undo target for a no-op.
* `memory.copy`: target `{item_id}`; args `{owner_scope:{kind,id},copy_id}`;
  expected `{item_revision,copy_revision:0}`. `copy_id` is a new id chosen and
  kept with the original request, never generated again on retry. Copy the
  selected current revision, attachments, references and draft flag into a
  new identity created by the mover. Its title is the exact title plus
  ` copy`. Prefix its body with an ordinary id-based link to the original;
  prefix the original's body with a link to the copy as a new revision by the
  same mover. Both effects commit together or neither does. Same-Notebook
  copy is allowed. Title/body limits and id collision refuse atomically.
* `memory.transfer.undo`: target `{transfer_id}`; args `{}`; expected
  `{item_revision}` and, for a copy, `{copy_revision}` as well. The transfer
  belongs to this actor and names a committed forward move/copy, never a
  caller-supplied alternate source/destination. The fences are its exact
  resulting revisions, not newly fetched revisions. An inverse move appends
  a revision and restores the original scope. An inverse copy restores the
  original's exact before-link body and appends a deleted revision of the
  clone with its backlink removed. Historical revisions remain immutable.
  Later edits on either affected page refuse the whole inverse. Repeat the
  same inverse operation for a lost reply; a different second inverse is
  refused, not silently applied again.

Copy receipts keep `item_id`/`revision` for the original and a separately
named copy result `{item_id,revision,owner_scope,source_ref}`. No full page body
is added to an operation receipt. `committed_ms` is captured by Core in the
first recorded receipt and therefore remains identical on replay, even if a
client failed to persist its first answer. Undo's device deadline uses that
epoch timestamp plus600000ms; device wall-clock changes keep their ordinary
clock limitations. Both forward commands return enough captured
scope/revision/transfer identity to form the inverse without borrowing a later
observation. Changing a saved envelope after an unknown result is still a
payload mismatch, never a retry.

## Four refusal boundaries and audience

1. The actor cannot read/write the source under current Notebook rules:
   `FORBIDDEN`, with a plain source-write reason and no private content.
2. The actor cannot write/post in the destination under existing Core rules:
   `FORBIDDEN`, with a plain destination reason. An unreadable or missing
   destination remains indistinguishable. A move is no route around a closed
   outcome, draft-agent protection or posting restriction.
3. A retained structured source reference exposes quoted evidence that any
   current destination reader cannot read: `NOTEBOOK_AUDIENCE_CONFLICT`.
   Keep attribution; never silently strip the link or recast words as the
   mover's. Move checks every retained revision whose history will become
   readable there, not only today's body. Copy checks the content it copies.
   Resolve real Core readers and exact source/whisper/draft access inside the
   authoritative transaction. Future membership changes keep their existing
   access semantics. Plain pasted words without structured provenance cannot
   be identified as quotations; this feature does not claim content inference.
4. Moving this identity out of an outcome whose pipeline item names it as a
   source: `NOTEBOOK_SOURCE_OUTCOME_CONFLICT`. Keep that source in its outcome,
   including when other outcomes also name it. Copy does not relocate the
   original pipeline source, so the original item/source remains intact.
   The inverse rechecks the applicable boundary; it is not a permission bypass.

References are evaluated using the destination's current Core audience,
including its outcome team. Personal stars, read marks and mere page URLs do
not grant access. Backlinks are ordinary links, not newly quoted source words;
opening either page still checks its own current scope. Deleted sources are
not movable/copyable. Exact id links keep following the same page after a move,
with current scope discovered by Core, not an unguarded redirect granting read.

The history check is scoped to the selected page and its retained evidence;
it must not scan unrelated Notebooks or reconstruct the whole instance. Its
cost grows with that page's historical references and is named explicitly in
proof. Preserve bounded read/list APIs and current field/image limits.

## Atomic records, counters and migration

An append-only `memory_transfer_acts` record binds actor/operation/kind,
original/copy ids, before/after scopes and exact before/after revisions. An
inverse names its forward record, with at most one kept inverse per forward
act. The page identity trigger continues to prohibit id/creator/sequence
changes and allows a scope transition only with its matching transaction's
immutable move/inverse witness. Revisions and transfer records cannot be
updated or deleted. No earlier attributed body is rewritten.

Each distinct touched Notebook counter ticks once per atomic act, including
two changed pages in a same-Notebook copy. Emit page changes for every affected
identity and old/new scope, plus the corresponding Notebook versions. Old
scope readers lose access under ordinary Core reads; new scope readers gain
only what this validated share permits. Move retains per-person read and star
identities; the star projection follows the page's current scope rather than
rewriting historical star acts. A clone starts with no copied personal stars
or other people's reads. The mover reads the revisions they write.

A migration is required; fixture schema numbering from65 is provisional, not
a production reservation ahead of Links. Init and upgrade must agree; reads
and servers never migrate. Retain an explicit rollback refusal once transfer
history exists, since old code would misinterpret relocated stars/scopes.
Warp17535 classifies1060 as judged: it lands alone in its hour. Actual carry
numbering follows the real predecessor. The local65→66 step is provisional.

Copy writes two pages under the same real operation. The revision uniqueness
key becomes `(author_id,operation_id,item_id)` rather than one revision per
actor/operation. The migration copies all old revision values unchanged and
reinstates the immutable guards; no foreign key points to this rebuilt table.

Expected Core owners: `memory.py`, a focused transfer helper if useful,
`validation.py`, and `store.py`/`migrations.py` for schema/mixin registration.
Use the existing pipeline source table for the dependency check; no edit to
Core7's active `pipeline.py` guard work is planned. No active guard, tool,
runner, launcher or live installation edits are included.

## Client parts after Core

`NotebookWriting` stays the save/action owner. Capture and flush actual visible
writing and image association before move/copy, as1051 does before delete.
Unsaved/conflicted/journal-failed state preserves the page and recovery.
Persist the exact forward envelope and its Undo metadata before closing or
navigating; unknown forward answers and an already-kept inverse remain owed.
Keep the page-id/instance/person/authority journal and Web Lock across scope
changes; no prefix clearing or retargeting of another writer's state.

Default lifetime is600000ms from Core's first committed forward timestamp,
kept with its matching receipt and preserved across retries/reload. Expiry blocks only a new
inverse choice. Native text editing, composition and existing keyboard scope
keep their ownership. A refused inverse keeps its actual reason and writing.
Warp17535 settles the notice crossing: a completed move/copy draws no success
banner; only pending, uncertain or refused lines remain. Command-Z selects the
newest move/copy on this device for600000ms from its first committed receipt,
persisted so reload, a stale writer or a replay cannot renew the window.
This supersedes1051's old quiet-success notice, under shipped1082's rule.
The document owner takes an eligible transfer's Command-Z before a focused
rail tree can consume it. Text fields and composition retain native Undo;
older deletion behavior keeps its existing event phase.
An explicitly opening page resumes its own journal before automatic document
recovery can acquire a second writer for it. A transfer paints the body already
read by its writer; it does not launch another unowned post-receipt read.
An old topic evicts a moved or newly unreadable page without carrying its
destination title/body. If the page returns at a newer revision between the
scoped and current reads, freshness retries; an omitted unchanged page still
fails the malformed-response guard.

Menu Move to…/Copy to… lists the current outcome and its topics through scoped
paged queries, keyboard reachable from all three real page doors. No loading
the page's writer merely to paint its menu. Drag uses actual side-rail topic/
outcome destinations, previews where it will land, unmodified drop moves and
Option-drop copies. Reuse the same command/journal/Undo path. Coarse targets
are44px; failure is one meaningful line. No native drag claim from handlers.

## Verification and evidence

Meaningful Core reds on exact347 first: same/cross-outcome moves and copies,
all four refusal boundaries, historical hidden references, draft/private
audiences, old-source pipeline integrity, retained read/star/id history,
reciprocal link bytes/attribution, both counters, exact replay/id collision,
source/copy CAS, inverse races and no partial effects after refusal. Verify
init/upgrade/occupied downgrade and wrong authority/instance through real
Store and bound CLI/HTTP adapters where each belongs. Preserve existing
Notebook/permission/history/draft/media/migration assertions unchanged.

Run a bounded relevant cohort, record raw failures and direct child exits,
then actually apply the old whole relevant owners and restore exact bytes.
Use unique scratch roots and `PYTHONPYCACHEPREFIX` for each Python phase.
Later actual CFT/WebKit proof covers native menu/Option-drop/Command-Z,
navigation/reload, lost responses, refused destinations and existing writing
ownership in both looks and laptop/phone widths. Synthetic clocks prove the
boundary, not a ten-minute timing result or physical OS/device gesture.

Capture command/selected input bodies and START/END digests per phase; these
are bounded inventories, not a complete runtime graph. Retain actual red,
fixture errors and failed cleanup/mutation controls without calling them green.
Test only isolated records; use no live-account mutation. A substantial phase
starts only below12/18 load. Page6's private browser/HTTP claims17634/17692
follow actual clean handoffs; the first was released17656 before restart.
Page5's1059 is next after the second actual clean release under17721.
Pure bounded Core tests follow17522's separate load/cleanup rule.
Browser/HTTP work requires the current explicit clean handoff, in-use notice,
Browser.close, fixture EOF/exit/errors and owned PID/profile/TCP cleanup before
release. No Tony browser or physical device is used.

The retained native harness is `tests/notebook_transfer_1060_native.mjs`.
At1280/390 in bookends/paper it uses actual menu keys/taps, Command-Z,
reload and real HTTP/Core/IndexedDB. Laptop cells also use native HTML drag
and Option-drag. Recovery drops a committed copy's answer then asserts exact
replay, one clone/revision and the original deadline; queues Undo before the
move receipt; and races an actual competing clone revision against paired
Undo. A **synthetic** destination rejection proves browser presentation and
retention only; the four actual Core refusal boundaries have separate tests.

The1280-bookends cell in each engine also holds a real media upload after
file-input selection, compares exact69 device-kept PNG bytes and digest,
blocks transfer until association, then checks the same media through move,
copy, inverse and authenticated raw media read. It verifies native text-field
Undo and full-page header departure/request handoff/Command-Z reopening.
This is neither an OS file-picker gesture nor phone drag/image coverage.
Fixture navigation drains observed API requests rather than cancelling reads
incidentally. Earlier setup, polling/auth fixture errors and product failures
remain retained. Cleanup observes descendants at phase boundaries; it does
not claim complete instantaneous process history. No physical ten-minute
elapsed-time or device-clock-change result is claimed.

## Review17743 correction

Rejected head1d583983 is retained with its original source/test packet. The
unchanged seat migration suites exposed an already-present transfer layout
beside a lower schema marker: those fixtures initialize the latest schema,
remove their own older slice and then migrate up. The transfer downgrade
already drops its table. The additive table/index/immutable-trigger install
now tolerates its existing layout without replacing witnesses; the revision
rebuild still preserves all values. A new occupied reinstall control checks
two installs, exact page/revision/witness/schema equality, FK/integrity checks,
immutable guards, lossy-down refusal and the subsequent exact paired inverse.
The five existing seat cases are unchanged.

A known internal current-topic page target keeps the shared sheet's direct id read and
its opener. The sheet itself asks Core for the page and access; the label does
not grant access or override current ownership. Authored URL queries, other
destinations and links to a particular revision keep their existence/access
confirmation and current-scope resolution. The existing788
real-app wiring case is unchanged. Rejected whole owners are actually applied
and restored with their raw exits/maps. The prior64 native checks remain
attributed to1d583983; this correction uses bounded Core/real-app adapter checks
and launches no browser while Page5 owns1059.
