# Targets, the two kinds of outcome, and the improvement loop

An outcome says what done looks like in a few sentences, its target, and
proves it with checks. Every outcome is one of two kinds: to reach, which ends
when its owner says so, or to keep, which goes on. After each release the
checks are read again, and anything that got worse is named. The records are
`aim_next/checks.py` and `aim_next/outcome_kind.py`; every rule that turns them
into words is a pure function in `aim_next/outcome_rules.py`; the page is
`web/targets.mjs` and `web/charts.mjs`, with its words in
`web/targets-words.mjs`.

## Two kinds of outcome

- **To reach**: it ends, like an admission or an office move. Its owner says
  when it is reached.
- **To keep**: it goes on, like a product kept working.

An outcome is started with a kind or without one. Without one it reads to keep
until its owner chooses, and an outcome made before release 21 reads to keep
too. On the outcome's page the owner sees the kind as two chips and changes it
with one tap; everyone else reads it in words. Each change is a new row in
`outcome_kinds`, so the history is kept, and the start row says who started
the outcome and when.

**Reached** is final. Only the owner says it, only of an outcome to reach, in a
sentence or two of his own. It opens in place on the page, and Return marks it.
When a check is not met, or nothing checks the outcome at all, he confirms that
first (`NOT_MET` otherwise). Every topic of the outcome then closes, and any
later change to it is refused `OUTCOME_REACHED`, while a reader's own state
there still saves. Reached outcomes leave the list and fold into one line,
"Reached (N)", which reads them only when it is opened.

## The target and its word

The owner or the coordinator writes the target with "Write the target": the
box opens in place, Return saves, and Escape leaves the words as they were.
There is no Save button. The first wording, and the owner's own, are current
at once. Anyone else's later wording is an ask to the owner, and keeps his
Waiting on you lit until he uses the words or keeps the old ones (D8; the ask
is held by `outcome_asks.held_ask`, so a reply that does not decide never
leaves it unlit).

The target's word, first that holds:

1. **Reached**: the owner said so.
2. **Not there yet**: an outcome to reach, with or without a target or checks.
3. **No target yet**: neither words nor checks. It claims nothing.
4. **On target**: every check passes, and every measure has met its target at
   the last two releases in a row.
5. **Not on target yet**: otherwise. When it read On target at the previous
   release, the words name the first check that now fails.

Checks with no words yet still give a word; the card says who writes the
words.

## Checks

A check is either a **pass** check (it passed or failed) or a **measure** (a
number, with a unit, which way is better, and optionally a target and a
tolerance). Each says where its readings come from: the release check
(`release-check:*`), a skill's check, or a report by hand. It can say which
words of the target it proves, and the page shows that under it.

A check's status: **waiting** (an ask about it awaits the owner), **not run**,
**passing**, **failing** (a pass check that failed, or a measure outside its
target), **holding** (met at the last two releases in a row), or **measured**
(a measure with no target, or met but not yet held). A group of checks opens
by itself when one of its checks fails or waits; otherwise it is closed. A run
of the checks shows on the page live, with no reload: each panel is painted
again in place, so what is on screen stays the same controls, a press held
while something commits still lands, and a fold the reader opened stays open. Measurements lists every
reading of every check by release, with a chart per check: every mark is also
in the table under it, with what produced it, and a candidate is drawn hollow.
A line under each chart says the reading of the mark under the pointer, or of
the mark Tab has reached, so a mouse and a keyboard both read it.

## What got worse

At a deploy the candidate's run is compared with the live baseline: per check,
its reading in the newest release-check run at the live release's commit (never
a reported run). A pass check is **failed** or has **fewer** cases. A measure is
compared only with a base run made with the same tools; with none it is
"not compared", which counts as fewer. With repeated runs, a measure is worse
only when it is slower in every run. Two records cover a regression: an
allowance for fewer cases from a commit on, and the owner's word that one
measure got worse at one run (accept-worse). Nothing else covers a failure.

`tools/deploy.py` measures the candidate before anything stops, as the
config's reporter: a member of the outcome who is not its coordinator, so the
coordinator is told rather than telling itself. A release check summary of the
commit is measured even when its steps failed. `02-checks` reads the live
release's checks, the owner's allowances and each check's open fix topic and
works out what got worse; a failed read refuses, and never reads as "no
checks". For each worse check, `02-worse` tells the coordinator: in the check's
open fix topic, or in a new one named for what failed ("“A new arrival keeps
your place while you write” fails at the release 23 candidate", "Wake time got
worse at the release 23 candidate", "Unit checks did not run at …"), whose
first message asks for a clearer title if there is one. Each write is named
from the check and the commit, so a deploy run again for the same commit finds
the same topic and tells nobody twice. `02-run` writes the run, each worse
reading naming its fix topic, and notes on the release piece "Held: Wake time
got worse." Then the deploy refuses, naming what got worse first, then a
summary that did not pass. The outcome page shows the candidate stopped, its
fix topic and the owner's choice to accept a worse measure; once he has, the
same commit is deployed again and goes on. Every candidate run the deploy
records (its commit not already a release) is the run of the next release, one
past the latest recorded, and its readings name that release's piece, whether
the piece was combined with a commit, without one, or is checking a new commit
after a stop. A later release combined meanwhile is not that piece, and a
release is combined once (`RELEASE_PIECE_EXISTS`). A trial or a base rerun
names no piece (D32, D34), so neither ever opens a gate.
The piece's gate, its "Held" note and the held test that lets the coordinator
take an item back read those readings. Before anything stops, the release
piece leaves `checks` for `deploy`; its gate holds on the readings `02-run`
wrote. A new candidate after a stop is the piece's next round of `checks`,
which the gate does not hold. A dry run measures and says what got worse, and
writes nothing.

## The improvement loop

After each release the outcome page says what it left behind (the first pass
check whose cases grew from the release before to the live one: a release that
is not stopped as worse ships and leaves its new checks behind), which items
likely caused a check to stop (from trial runs that leave items out), and the
problems found before a check caught them, counted by kind per release
(defects and design misses), each with what now covers it. Tolerances are said
as fractions ("a quarter"), never percentages.
