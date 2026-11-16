# Skills and tools

A skill is a procedure an agent follows; a tool is a program it runs. Each has
a home outcome, where it is improved and evaluated, and a page there. A tool is
files in this repository, shipped in the release commit like any other code, so
it has one version: the live one. When a release changes a tool and the tool's
own check fails, the tool goes back to its live version, the release is checked
again and ships, and the home outcome gets a topic saying why.

Nothing is ever held. Going back is a change to the release itself: the tool's
files are put back to their live contents in a new commit on top of the
candidate, and that commit is what is checked and what ships.

## The record

One JSON file per skill or tool, `skills/<id>.json`, with exactly these keys:

```json
{"id": "mutant-runner", "kind": "tool", "name": "Mutant runner",
 "summary": "Breaks one line on purpose to show a check catches it",
 "home": "building-theseus",
 "files": ["tools/mutant.py", "tests/test_tools_mutant.py"],
 "check": {"python": "tests/test_tools_mutant.py"}}
```

- `id`: lowercase words joined by hyphens, at most 40 characters, the file's
  name without `.json`.
- `kind`: `skill` or `tool`.
- `name`: 1 to 60 characters; `summary`: 1 to 200, one line.
- `home`: the id of the home outcome, at most 200 characters.
- `files`: at least one path of a regular file under `skills/`, `tools/` or
  `tests/`, no duplicates and no `..`. Never the deploy tool or anything a
  train guards (`tools/train.py`'s `DEPLOY_TOOL`, `CONTROLLER`, `MIGRATIONS`),
  `tools/release_check.py` and every file it runs, `tools/tool_check.py`, or
  `tests/acts.json`: deploy and the release checks stay ordinary code.
- `check`: `null`, or exactly one of `{"python": "tests/test_*.py"}` or
  `{"node": "tests/*.test.mjs"}`, one of its `files`.
- Across all records at a commit a path belongs to at most one record, and no
  record's file is another record's `skills/<id>.json`.

`aim_next/tool_records.py` reads records (one parser for the server, the CLI,
the tool step and `tests/test_tool_records.py`, which fails naming each problem
in the repository's records). Because a check is a unit module, the release
check's own `python-units` and `node-units` run every tool's check on every
release; because it is one of the tool's files, a tool that goes back takes its
check back with it.

A tool's content is its record file and its files. Its content id is the
sha256 of the lines `PATH\0SHA256(BYTES)\n`, one per path, sorted by path. The
live version is the content in the code the server runs.

## What Core records

The records are not copied into Core: the server and the CLI read
`skills/*.json` from their own code once, when the process starts. A record the
process cannot read makes the views refuse `TOOL_RECORDS_UNREADABLE`, naming
the file; never an empty list. Core keeps three append-only tables (schema step
43 to 44), their rows never updated or deleted:

- `tool_uses`: an outcome says it uses a tool, or no longer does. Command
  `tool.use`, target `{workspace_id}`, args `{tool_id, used}`. The tool must be
  live (`TOOL_NOT_FOUND`), the actor on the outcome (`FORBIDDEN`), the outcome
  not reached (`OUTCOME_REACHED`). Nothing else makes an outcome a user: not
  running the tool, not linking a topic, not being its home.
- `tool_links`: a topic is about a tool. Command `tool.link`, target
  `{topic_id}`, args `{tool_id, linked}`. A link needs a live tool, a topic in
  the tool's home (`TOPIC_NOT_IN_HOME`, naming the home only to someone who can
  write there) and a topic, not a Conversation (`NOT_A_TOPIC`). An unlink is
  taken wherever the topic now is, by anyone who can read it, so no link is
  left where nobody can reach it.
- `tool_runs`: what a tool's own check found in a release, recorded by the
  tool step. Command `tool.record`, target `{workspace_id: HOME}`, args
  `{run}`, by an agent on the home. Its key is `(tool_id, fate, tree_sha)`: the
  same run again answers `recorded: false`, a different one under the key is
  refused `TOOL_RUN_EXISTS`. Every field is validated (`INVALID_ARGUMENT`
  naming it). A run's `fate` is `new` (a changed version that passed and
  ships), `back` (one that did not pass and went back) or `live` (the live
  version's check, run again after going back). A `back` row opens its topic in
  the same transaction: in the home, addressed to the home's coordinator (its
  owner when it has none), by the recorder, linked to the tool.

The same answer twice (`changed: false`, `recorded: false`) writes nothing.

Views: `tools {workspace_id}` (the outcome's own tools, those it uses, and what
"+ Uses a tool" offers), `tool {tool_id, cursor, limit}` (the record, its
files, the live word, the versions that went back, newest first, paged, the
outcomes that use it and the linked topics, each counted and not named when the
reader cannot open it), and `topic_tools {topic_id}` (the tools linked to the
topic and the home's tools Topic settings offers).

## States and words

Every word comes from `aim_next/tool_words.py`, built once from the record and
the rows; the pages, the CLI and the topic a version that went back opens all
say the same thing. A tool's live word is from the newest run whose content id
is the live content id:

| state | when | words |
| --- | --- | --- |
| `passed` | that run passed | "Its check passed: 42 of 42" and its time |
| `not_run` | it has a check and no run of the live content | "Its check has not run on this version yet" |
| `not_evaluated` | it has no check | "Not evaluated yet: it has no check" |
| `failed` | that run failed | "Its check failed on this version: 3 of 42 failed" |
| `counted_nothing` | that run counted nothing | "Its check ran no tests on this version" |

A pass needs a recorded count of at least one, every test passed. Nothing ever
reads "0 of 0", and a tool has no held, pending or being-checked state. A
version that went back reads "A new version failed its check (3 of 42 failed:
test_a, test_b, test_c) and went back to its live version"; a first version
"... and did not ship".

## What a person sees

- **The tool page**, `?workspace=HOME&tool=ID`, page kind `skill`: Skill or
  Tool, its name and summary; Home, a link to it; Its check, the live word;
  Used by, the outcomes that said so and still do, then how many the reader
  cannot open; Went back, five at a time with More, each with its topic;
  Topics about it, each with its state and a × to take it off, and Link a
  topic, one line that finds an open topic of the home as it is typed (Return
  or a click links it, Escape closes it leaving things as they were); Files,
  folded. Its rail is the home's when the reader can read the home; otherwise
  the page has no rail and the logo block and ← Outcomes head it.
- **The outcome page**'s Skills and tools: the tools it homes, then those it
  uses under Used here, each with the same word and opening its page. For a
  reader on the outcome, + Uses a tool finds a tool homed elsewhere as it is
  typed, and a × under Used here says the outcome no longer uses it. The
  section shows only when it has something or the reader can add.
- **The rails**: the left rail's Skills and tools on a tool page, a pipeline,
  measurements or new-topic page lists the same tools by name; the right rail's
  lists a topic's linked tools, and on a Conversation the outcome's. Both hide
  when empty.
- **Topic settings**: Tools this topic improves, the home's tools as chips; a
  tap links, a second unlinks, saved at once. A tool linked from elsewhere
  shows as a chip so it can be taken off. The line shows only when there is a
  chip to show.

The code: `web/skills.mjs` (the page, the outcome section, the rail list and
the chips), `web/things-rail.mjs` (the right rail), `aim_next/tools_core.py`
(tables, commands, views) and `aim_next/cli_tools.py` (the agent verbs,
[agent-cli.md](agent-cli.md#skills-and-tools)).

## A release: the tool step

`tools/tool_check.py` ([tools.md](tools.md#tool-check-toolstool_checkpy))
runs on a release candidate before it is judged. It runs each changed tool's
check once on the candidate's exact commit; a tool whose check does not pass
goes back (every path its record names, on either side, gets its live content
in a new commit; items whose change touched those paths are taken back with a
`Train-Item: Revert` trailer, and their new act rows on those paths leave the
ledger); the new commit is checked again, until a round sends nothing more
back. A tool that went back and still fails at its live content is broken by
something else in the release: the release stops, nothing is recorded and no
commit is made. A changed tool with no check ships new and runs nothing.

Only a tool's own failing check sends it back; anything else the step cannot do
stops the release. If the step is skipped, a broken tool still never ships: its
check is a unit module, so the release's own unit step fails.

## Not in this slice

Rerunning other outcomes' checks when a tool changes; a tool breaking another
outcome's checks (the release stops); several versions of a tool or an outcome
pinning one; retiring a tool with its home; guessing who uses a tool; moving a
home except by editing its record in a release; checks that are not one unit
module; tool versions on check readings; posting a second failure into an
open topic (a second failing version opens a new topic); a run or break button
in the product.
