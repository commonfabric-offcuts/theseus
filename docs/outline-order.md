# A person's own order of their outcomes and topics

The outline on the left of a topic or a Conversation (docs/rails.md) lists
every outcome the reader is on, and under the outcome being read its topics.
The reader may move an outcome, or a topic within its outcome, up or down
with ⌘↑ and ⌘↓ (docs/interaction.md, "Keys across the panes"). The order
they make is theirs alone: Core keeps it, so it holds on every device they
sign in on and survives a reload, and nobody else sees it. Nothing else
moves a row: a new message changes counts and lights, never the order.

The code: `aim_next/outline_order.py` (Core), `web/outline-order.mjs` (what
the page shows, and how a move is sent), `web/outline-rail.mjs` and
`web/topic-navigation.mjs` (the lists that draw it).

## What Core keeps

One order for the reader's outcomes, and one for the topics of each outcome
they can read. An order is a list of ids, at most 500 (`LIMITS.order_ids`)
and 32768 bytes as JSON (`LIMITS.order_utf8_bytes`, so every list that
carries it keeps room for its items), with a revision that only grows. Schema version 34 adds the table
(`outline_orders`, one row per person and scope). Stepping back to 33 is
refused once anyone has placed an order, since the order would be lost.

## `outline.order_set`

A command like every other (`POST /api/command`, the CLI's command path),
recorded in the operations ledger, answered again with what it recorded
when its operation is sent again.

```json
{"kind": "outline.order_set", "operation_id": "…", "target": {"workspace_id": "W"},
 "expected": {"authority": {…}, "order_revision": 3}, "args": {"ids": ["t2", "t9", "t1"]}}
```

- `target` names the outcome whose topics these are; `{}` is the reader's
  outcomes. Nothing else may be named.
- `args.ids` is the whole order, each id once, within the bounds above
  (`INVALID_ARGUMENT` otherwise). An empty list places nothing.
- `expected.order_revision` is required: the revision the sender read. A
  different revision is refused (`REVISION_CONFLICT`, with the current
  revision in `current_versions`), so a late request from one device never
  undoes a newer order made on another.
- Outcomes: each must be one the reader is on. One they are not on, or one
  that does not exist, is refused with the same words (`FORBIDDEN`, "You can
  only place the outcomes you are on"), so a refusal tells nobody an outcome
  exists. Topics: the reader must be able to read the outcome (`FORBIDDEN`
  otherwise), and each id must be one of its topics (`INVALID_ARGUMENT`).
- Committed: `{"workspace_id": W or null, "ids": […], "order_revision": N,
  "changed": true}`. The same order again changes nothing (`changed: false`,
  the revision as it was).
- It writes one change in the reader's own scope (`outcome_order` or
  `topic_order`) and nothing to a topic's or outcome's, so no count, light,
  activity time or "new" moves, and no other reader hears of it.

## How it is read back

Every page of the `workspaces` view, and every page of `workspace_topics`
(the active, done and archived lists alike), carries the reader's order:

```json
"order": {"ids": ["w3", "w1"], "revision": 2}
```

Read, the order leaves out what the reader can no longer place (an outcome
they left, a topic gone from the outcome), so what a client reads it may
send back as it is. With nothing placed it is `{"ids": [], "revision": 0}`.
The lists themselves keep their own order (outcomes by id, topics latest
activity first); the page places them.

A client reads `order` for its `ids` and `revision` and passes over any
other field a later Core adds to it. An answer with no `order` (an older
Core) places nothing. An `order` it cannot read (not an object, ids that
are not strings, a revision that is not a whole number) is refused as the
rest of the list would be.

## What the page shows

From what Core lists and what the reader placed (`placeIn`):

- What they placed keeps their order.
- What they never placed (a new outcome, a new topic, or one on a page not
  yet loaded when they moved) goes where it goes today relative to the
  rest: right after whatever Core lists just before it, or first when
  nothing is. A new one never moves the placed ones around.
- What Core no longer lists simply drops out; an id the page does not know
  is passed over.

A move trades places with the neighbour shown (with a chip showing only
what is new, the next one shown; those out of sight stay where they are),
shows at once, and is sent in the background, one request per scope at a
time. Moves made while one is out go together in the next, fenced on the
revision the one before got. What is saved is everything shown, in its
order, with what an earlier save placed that this page does not show kept
after the place it had (`toSave`). A topic moves only within the list that
holds it (topics, Done, Archived), never into another outcome.

The row moved keeps the focus, and a screen reader hears where it went
("Second moved to 3 of 9", or "Second is already first"). ⌘Z right after
puts the last move back, as a move of its own; once the keys leave the
outline the moves stay. Changed on another device meanwhile, the move is
refused, the page shows the order Core holds and says so. A move that could
not be sent puts the order back as it was and says why.

The page keeps one book of orders for the whole visit (`book`), so the
page's own topic list under the outcome being read and the outline's own
lists show the same order, and so does the side rail on an outcome's other
pages.

## Checks

- Core: `tests/test_outline_order.py`: per-viewer isolation, every list
  carrying it, refusal of outcomes the viewer is not on and of another
  outcome's topics, validation, the revision fence and retries, what drops
  out as it is read, and that nothing else changes.
- The merge, the move, what is saved, reading the shape and the sending:
  `tests/ui_outline_order.test.mjs`.
- In a browser, by the real keys: `tests/outcome_rail_native.mjs` ("rail ⌘↑
  ⌘↓ move an outcome, and a topic within its outcome, …"), in Chrome for
  Testing and Safari's engine.
