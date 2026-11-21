# An agent answer folds the person's message (955)

Source: Tony13970; assigned by Warp13972/13977, resumed14141.
Base: release245, `a988a19fd6762ee76aa1787b6c305cb05cbb7f0d`.
Own branch: `core-lane7/955-agent-reply-fold`.

When an agent publishes a public reply to a human author's message in an
ordinary topic dossier, Core records an author-personal fold in that same
transaction. The answer stays open. The human must remain enabled and able
to read the topic. No other reader's fold changes. The actual agent remains
attributed as the actor; only the human owner receives the acts notification.

A star or a private note with words at publication keeps the message open.
Any existing personal fold choice wins, including a manual unfold; another
agent reply or a reload cannot reverse that choice. Removing a protection
does not scan or fold past messages. No reply, another person's reply, or an
agent thumb does not trigger this author fold. Existing377 human-replier and
human-thumb folding remain separate. This change excludes Conversations,
whispers and record-only publication. There is no historical backfill.

`Conversation._publish` invokes `Stacks._fold_author_answered`. The helper
reads the one parent, its author/access, current personal acts and the note
key used by topic reading. It does not read the message list or history.
The act is committed with the reply, with its own owner/revision and an
explicit actor-scope notification. A retry returns the recorded answer
without another fold; a failure after the fold insert rolls both back.
No schema or UI product change. A Core-module landing uses938's full-host
restart path, owned by Warp; this source branch does not install itself.

## Verification

`tests/test_agent_answer_fold_955.py` uses actual public commands and isolated
ReaderCase databases. Eight checks cover owner/attribution/notification,
other readers, no reply, other-human reply and old377 behavior, agent thumb,
star/note privacy, explicit unfold, duplicate operation, unavailable author,
agent parent, private/Conversation limits and actual transactional rollback.
The directly obsolete agent-answer expectation in `tests/test_stacks.py`
becomes an author-only fold expectation and retains its agent-thumb control;
its agent reply supplies the passage reason required by current Core.
No unrelated assertion changes. Targeted command:

```
PYTHONPATH=tests PYTHONPYCACHEPREFIX=/absolute/unique-cache /usr/bin/python3 -m unittest test_agent_answer_fold_955 test_stacks.AnsweredFoldCase.test_an_agents_reply_folds_the_author_only_and_its_thumb_adds_no_fold -v
```

Actual240 Core red:4 failures/2 controls pass. Corrected native240 red:
the real agent reply arrives but its parent's Core fold remains false and
its body stays open. Setup errors and an earlier incorrect row selector
remain separate evidence, not additional behavioral reds.

The applied242 mutation routes the personal acts notification to the agent
instead of the owner. The owner-routing oracle fails. Exact source restored,
with unique Python caches for mutation and restoration; restored Stacks
SHA256 `51c7a9dc38c7a77f9003d8120b5c765a66edb30f55c3336354e4a36d53ea01f6`.
Targeted restored checks9/9. Broader candidate cohort28/38 versus pristine242
control19/30: all10 candidate failures also fail on the control. Six expect
old cover-act counts/audiences; three agent replies omit required passage
metadata and one ask omits required ask_wait. The extra old agent-answer
case fails on the control and is the one intentionally updated here.
No broad-suite green claim; raw failures/comparison remain available.
Core source/tests relevant to this comparison are unchanged by243–245.

`tests/agent_answer_fold_955_native.mjs` runs the real HTTP app in an isolated
ui_http instance. Default matrix: ordinary, starred and private-note parents
at1280/390px, light/dark. Actual agent arrival, Core fold, folded row/body,
answer visible, no-answer control, explicit native dossier opening and
message unfold, a further reply, and reload are checked. Opening the outer
dossier is separate from the personal fold; the touch check taps its leading
row words clear of the focus bar. The earlier242 narrow touch timeouts and
corrected12/12 Chrome control are retained, with no UI product change.
Other-human and private/Conversation negatives are Core checks.

Run from the worktree with an absolute evidence directory argument.
`AIM_PLAYWRIGHT_CORE` selects the installed Playwright module; the default
engine is Chrome for Testing from `AIM_CHROME`; `AIM_ENGINE=webkit` selects
WebKit. `AIM_955_BASELINE=1` limits to the ordinary1280/light cell. Use a unique
`PYTHONPYCACHEPREFIX` per Python/mutation phase. Every run records Browser.close,
owned PID/profile absence, fixture stdin EOF/exit0 and port closure. Desktop
engines at phone width are not physical-phone or timing evidence.

Raw phases and receipts are in
`/Users/commonfabric/aim-worktrees/core-lane7-955-evidence`, including
`core-actual-red240.txt`, `native-actual-red240`, `routing-mutant242.txt`,
`routing-restoration242.json`, `core-targeted242.txt`, `core-cohort242.txt`,
`core-control242.txt`, `cohort-comparison242.json` and `chrome-final2-242`.
Final245 targeted Core9/9, native Chrome12/12 and native WebKit12/12 pass.
Final phases: `core-targeted245.txt`, `chrome-final245`, `webkit-final245`.
Both native phases have0 page errors. Browser.close verified all owned
PIDs/profiles absent; Chrome fixture61440 and WebKit fixture61190 exited0
via stdin EOF, PIDs absent and ports closed. Source freezes here for Warp's
one diff/test review; there is no claim of a deployed955 release yet.
