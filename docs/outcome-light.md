# The outcome light

Every outcome shows one small light with a few words beside it: where it
stands, for the person reading. It comes only from what Theseus records
(posts, hosted agent turns, questions to the reader, and, once the pipeline
is a record, which items are in Now and which have shipped). No agent sets it
or has to remember to. The rules are `aim_next/outcome_rules.py`; the reads are
`aim_next/outcome_light.py`.

## The four lights

In this order, the first that holds:

1. **Waiting on you** (the only lit one): a question to the reader is open in
   one of the outcome's topics. "Waiting on you · 2 questions".
2. **Being worked on**: with the pipeline on, someone other than the reader
   worked on an item in Now in the last hour; with it off, on any of the
   outcome's open topics, or one of them waits on someone. "Worked on at
   6:40 AM".
3. **Done**: for an outcome to keep, every check passes (On target) and, with
   its pipeline on, everything in it shipped; for an outcome to reach, only
   when its owner said it was Reached. "Done", "Done · reached yesterday".
4. **Quiet**: none of the above. It always says since when something was last
   seen ("Quiet since yesterday 3:15 PM"), or "No topics yet". It never says
   nobody is working; what the light is made of (behind the ⓘ on the outcome's
   page) adds that someone may be working on it outside Theseus.

What counts as work is `work.py`'s one rule: posts and hosted turns by anyone
but the reader in the last hour, or a wait. A hosted turn is activity in its
topic, as a post is (version 26), so the scan by activity time misses none.

## What the page says

A state and a time, and one line naming the newest thing; nothing more.

- **An outcome row** (the sidebar and the Outcomes home): the light and a
  state with its time. "Waiting on you · 1 question", "Worked on at 3:32 PM",
  "Done", "Done · reached yesterday", "Quiet since 3:32 PM", "Quiet since
  yesterday 3:15 PM", "No topics yet", "Quiet" (no time known), "Couldn't check
  where it stands".
- **Where it stands**, the card at the top of an outcome's page, is the whole
  of it in two lines under its heading:

      WHERE IT STANDS                                  ⓘ
      ◌ Quiet since 3:32 PM
      Last: fable in “No header bar, and the side rail…”

  The first line is the light and its name with the time ("Waiting on you · 1
  question", "Worked on at 3:32 PM", "Quiet since yesterday at 3:15 PM"). The
  second names who did the newest thing and where, the topic's title one line
  long, cut with an ellipsis, and a link: "Last: fable in “…”" (the newest
  `topic_work`, `last_activity`, `item_work` or `last_now_work` fact); with a
  question waiting, the newest question's topic, "Asked: fable in “Speaker
  notes”"; with no topics, "Started by tony.". The small ⓘ button ("What this
  is made of") opens, in place, what the light is made of: the lead, the
  facts, the also-lines (with "It might be stuck…") and where it comes from.
  It stays open across the repaint on each commit. When the read failed, the
  card says "Couldn't check where it stands" with "Try again".
- **The peek** on a laptop says what the card says: the name with its time and
  the Last line, in plain words.
- **A topic row's** hover title and screen-reader words: a state and a time,
  "fable · 3:32 PM" (who worked in it last, in the last hour), "Quiet since
  yesterday 11:00 PM", "Waiting on you · 6:20 AM", "Quiet" with no time.

## Reads

- `workspaces` items carry `light`: `{light, label, short, unreadable}`.
  `light` is `waiting`, `built`, `done`, `quiet`, or null when the outcome's
  facts could not be read (`unreadable: true`). `short` is
  `{kind: asks, count}`, `{kind: seen, ms}`, `{kind: checks_pass}`,
  `{kind: reached, ms}`, `{kind: talk, ms, how, since_ms}`,
  `{kind: since, ms}` (ms null: no time is known) or `{kind: no_topics}`.
- `outcome_light {workspace_id}` gives the whole of it, for the peek and the
  outcome page: `light`, `lead` (one kind: `asks`, `now_work`, `topics_work`,
  `done`, `reached`, `topics_quiet`, `now_quiet`, `now_quiet_talk`,
  `no_topics`, `unreadable`), `facts` (`ask`, `item_work`, `topic_work`,
  `more_items`, `all_shipped`, `checks_pass`, `last_activity` (with its
  `topic_id` and `title_truncated`, for the Last line's link),
  `last_now_work`, `created`) and `also` (`outside_now`, `also_built`,
  `last_now_work`, `may_be_stalled`, `done_again_when`).
- `attention`'s `latest_waiting` items carry `workspace: {id, title,
  title_truncated}`, so the Waiting on you list names each question's outcome.

The server sends kinds and numbers; the web (`web/outcome-light-words.mjs`)
and the CLI (`aim-next outcomes`) turn them into words.

The questions are read first and alone, so a failure in any later read still
shows Waiting on you. Every read is bounded by what is open now or what
happened in the last hour; the scan for "Quiet since" goes past the hour only
while nothing is being worked on, stops at the first topic whose activity
cannot be newer than what it found, and after 100 topics says "Quiet" with no
time rather than one that may be too early.

The light is worked out when the row is read, as the work ring is. The page
reads again on every commit the live feed announces; nothing sets a timer.

## Until the rest of release 21

The pipeline (item 84), outcome kinds and Reached (D41, D42) and checks
(item 14) are not records yet: every outcome's pipeline reads as off, every
outcome is to keep with no checks, so Done does not show, and "Started by"
names the owner without a time.
