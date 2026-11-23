# Outcome Links in the agent CLI (1102)

Core8 owns this ordinary-intended CLI slice under Fable17768 and Warp17712,
from actual351 f4968864236368d25d7604ca9c1c10af80a6c77a/schema66 in a
separate core-lane8/1102-cli-links-351-17768 worktree. Piece
p-817ab85d06174fc8b12094a8.1099's frozen17c6b755 source remains untouched.
Tony17711 authorizes no database/schema change. The existing Links service,
authority capture, collection, URL validator, CAS, operation journal and
permissions are sufficient; this slice adds CLI access, not a new authority.

## Commands and defaults

- `link-add OUTCOME URL [--title TITLE]` explicitly keeps that URL in the
  outcome. The existing canonical_url validator supplies its identity. An
  omitted title is the site's canonical hostname, matching the page's default,
  with IPv6 brackets retained; no remote title fetch or automatic URL harvest.
  The current row revision (zero if absent) fences the write. Re-adding a
  removed row restores that one identity. Explicit/default title replaces the
  current title, as the Add form does.
- `link-rename OUTCOME URL TITLE` renames an existing kept row, preserving its
  URL/removal value. A missing or removed Link is refused rather than added
  or resurrected. Core retains its bounded nonempty title rules.
- `link-remove OUTCOME URL` removes an existing saved row while preserving
  its exact title and identity. Removal retains the Core override; repeating
  removal is an idempotent Core no-op. A URL never kept in the collection is
  refused rather than creating an unsolicited preview override.

Each command reads only bounded workspace_links pages for that outcome,
finds the exact canonical URL and uses its current link_revision. It sends
workspace.link_set through cli.Agent.command, which already captures the
selected profile's validated authority pair, saves the exact original
request before dispatch and journals the recorded receipt. No fabricated,
foreign, refreshed-in-place or guessed authority is accepted. Core rechecks
current membership, closed state, authority and revision at the write.
No automatic conflict retry or fresh operation after an uncertain result.

After the receipt, read the same existing workspace_links view independently
and report the current exact row, including a newer concurrent value if it
has changed since the write. JSON exposes the real reads and committed
receipt. A failed post-write read says READ_BACK_UNCONFIRMED/exit1 and names
the original operation, so it cannot be mistaken for an unsent edit. A
missing row after the complete bounded read is likewise unconfirmed. Retry
keeps the saved operation and returns its original Core result; no new write.

## Owners and proof

Expected product owners: cli.py registration/mixin integration plus a small
cli_links.py adapter. Existing workspace_links/validation/authority/profile
and database/schema writers remain unchanged. Agent CLI reference and this
contract document the real behavior; final changed paths determine actual
classification. Core7 owns1100, Page6 owns1101, Page5 retains1059's private
native/HTTP slot; this pure Core/CLI work claims no browser/native/HTTP slot.

Before implementation retain actual351 red assertions for the real CLI
route. Then test real subprocess agent add and shared workspace_links
readback, title defaults and explicit Unicode title, rename/remove/re-add,
full bounded pagination, exact outbox authority/receipt, stale conflict,
missing/foreign/stale authority, denied membership/closed outcomes, lost
receipt retry and post-write readback failure. All test actors/profiles and
records are created by the isolated fixture; no live link write or profile
edit. Run one relevant workload at a time, load-admitted below12/18, with
unique caches/direct exit/raw logs and complete source maps. Apply the whole
actual-old CLI owner, observe the failure and restore exact fixed bytes;
retain relevant controls and all failures/held phases. Meaningful applied
routing/authority/readback mutations must fail their named controls and be
restored, without weakening unrelated assertions.

Publish the contract and bound immutable intake before product edits. Freeze
on meaningful green checks and push only this exact branch for Warp's one
independent diff/test read; Fable owns canonical stages/carry/landing. No
live runtime, installed guard, active recipe, SPEC or schema edit.17751's
ordinary window stays closed while1087 runs alone; priority is not landing
permission and later guard-publication gates remain.
