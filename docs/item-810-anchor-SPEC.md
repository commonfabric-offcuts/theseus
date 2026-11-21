# Item 810 — hold the card acted on

Source-only slice under Warp10251, based on the actual live revision
`12cad5cca1bfa5a42b96a97c026c5ab22c9cbc12`.

Before a star or any card-menu action changes the page, capture that message's
identity and screen height. Hold that same card through optimistic drawing,
automatic unfolding, promotion above More, settlement, rereads and canonical
reheading. A dossier-title menu holds its title instead. Resolve the identity
again after drawing; never substitute a newly fetched original for an acted
reply. Extend the existing temporary hold room at either scroll boundary.

Live writing and a visible typing field retain precedence. Menu actions may
transfer focus without a later selection/reveal scroll undoing the hold. The
next pointer, key or scroll gesture ends the act hold; ordinary pagination and
general nonact anchoring keep their existing rule. If an action intentionally
hides its card/title, use the existing next-drawn-card fallback; hidden content
cannot retain a screen height. No forced reopening or fabricated card.

Only anchoring and menu plumbing in `web/app.mjs` and `web/stack-feed.mjs`.
The parallel primary owner handles ordinary ordering/sourceRoots/grouping;
`web/reply-stacks.mjs` and `web/stack-order.mjs` are untouched.

No tests written or run, syntax/module/product execution, diagnostics, browser,
Pool, mutation checks, delegation, board actions, push or deployment. Freeze a
local commit and packet with exact head/tree/ordered parents, changed-file
hashes and full diff. Runtime behavior remains unobserved here.
