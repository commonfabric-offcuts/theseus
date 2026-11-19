# Human-created topics keep their sidebar place (837)

Tony's 833 tracking topic disappeared from the ordinary sidebar when a Build
piece named it. The old Core rule classified every topic ever named by a
piece as Build, including topics a person had created for their own use.

Core now classifies only **agent-created** linked topics as Build, using the
topic's durable `creator_id` and the creator's kind. It is independent of who
links the piece or reads the sidebar. Human-created topics remain ordinary
topics across linking, finishing, relinking, and pipeline off/on. Archive and
Done still remove them from the open sidebar. Release references follow the
same rule. Conversation keeps its separate row.

The sole product change is `_build_topics` in `aim_next/pipeline.py`.
`workspace_topics`, its Build counts and `building` collection, the outcome
counts, and the `topic` flag already use that shared classification. No new
command, schema, migration, stored preference, message edit, or history repair.
An agent-created topic is still a Build topic even when a human links it.

## Live-store scope

On actual release 132 (`c0a4254c38ecfe596065dd41c57a9f4da9b43473`), the
read-only comparison found these six linked human-created topics in the bound
auditor's accessible outcome, Building Theseus. All six were created by Tony.

| Topic | Before | After |
| --- | --- | --- |
| 833 (`t-deedb65fcb3143b79940710228c1018b`) | Build | Ordinary open sidebar |
| Fragmented dossiers (`t-426c417eb4864c0da6cdb22cafb7bc13`) | Build | Ordinary open sidebar |
| Fold bug on Mobile (`t-e26a737efc6748458ad95fd0748db953`) | Build | Ordinary open sidebar |
| i keep seeing various warnings now.  this one is persisting. | Done; Build flag true | Done; Build flag false |
| Ship final ad hoc releases | Done; Build flag true | Done; Build flag false |
| Conversation | Separate Conversation row; Build flag true | Same row; Build flag false |

225 agent-created Build topics retained their classification. The comparison
checks the complete classification set difference, including Conversation
outside the ordinary lists. Topic fields other than the derived Build flag
remain identical.

The probe loads the original auditor profile and checks its exact binding.
It runs installed Core view handlers with only the candidate `_build_topics`
method substituted, before and after in the same SQLite `mode=ro`,
`query_only` transaction under the original authority fence. Reads are paged;
there are no commands or read marks. The release-132 snapshot took 24 ms and
reported zero changes. This is server-view evidence, not native UI evidence.

## Checks

The five new Core scenarios cover human topics across a piece's lifetime,
mixed human/agent pagination and counts, retained records and access limits,
Archive/Done, a release link, and the separate Conversation row. Existing
Build fixtures now create topics as agents through real commands and mark
the fixture openings read; they do not rewrite creator identities or history.

Focused comparison on actual 132:

```
PYTHONPATH=.:tests PYTHONPYCACHEPREFIX=<unique-directory> /usr/bin/python3 -m unittest \
  test_build_topics test_topic_state test_outline_order test_pipeline_stages test_pipeline_steering
```

- Untouched live: 97 tests, 88 pass, 9 fail, zero skips.
- Candidate: 102 tests, 93 pass, the same 9 fail, zero skips.
- All five new scenarios pass. The original four failed on unchanged 131;
  restoring the old classification also fails the new Conversation scenario.
- Three applied source mutations remove the creator filter, invert its kind,
  or ignore pipeline enabled state. Each fails an assertion; each byte-exact
  restored control passes all six selected scenarios (five new plus the
  existing pipeline-on/off scenario). Every Python mutation and restored
  control uses its own fresh `PYTHONPYCACHEPREFIX`.

The nine existing failures all stop at `ASK_WAIT_REQUIRED`: their Ask
fixtures omit required wait metadata before reaching their intended
assertions. They are not repaired or called green in this change:

- `test_build_topics`: `test_the_build_list_carries_every_open_build_topic_holding_a_piece_under_way_whatever_page_it_is_on`.
- `test_pipeline_stages`: `test_a_stage_on_the_owners_word_needs_an_ask_and_only_the_owner_leaves_it`,
  `test_combining_into_a_release_stage_on_the_owners_word_needs_an_ask_in_the_release_topic`,
  `test_combining_leaves_a_stage_on_the_owners_word_only_by_the_owner`,
  `test_dropping_the_last_item_of_a_piece_on_the_owners_word_is_the_owners`,
  `test_only_the_owner_gives_or_takes_off_their_word_on_a_stage`,
  `test_the_coordinator_sets_aside_only_what_the_owner_did_not_place_and_not_while_the_owner_holds_it`,
  `test_the_database_keeps_the_owners_word_whatever_writes_the_entry`.
- `test_pipeline_steering`: `test_an_ask_about_an_item_waits_on_the_one_asked_until_they_answer`.

Raw logs, comparison script/JSON, and applied/restored mutation evidence are
under `/Users/commonfabric/.local/share/theseus/auditor/evidence/837-*`.
No browser, preview, native suite, full suite, or CI was run for this slice.
Fable backs up before landing this Core change and reads the live sidebar
view back after deployment; Warp reviews the frozen source.
