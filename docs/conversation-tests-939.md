# Conversation fixture requests (939)

Base: release 205, `6e5d2098b178e6fbaf3d2591d1393bdf7923557c`.
The unmodified module runs 33 tests: 17 pass and 16 fail. Each failure was
read against its current test and the reply/ask contracts. Fourteen stop at
the required agent reply passage; two stop at person-ask metadata. No schema
version assertion fails in this module.

Retain all 33 tests and their behavior assertions. The local Conversation
fixture supplies an explicit omission reason for synthetic agent replies,
and factual person asks supply current dossier root/revision, question, no
choices and no promised default with a reason. The direct CLI partial-answer
case also supplies its explicit reply choice. Human writing stays unchanged.
These are real Core requests, with no validation or permission bypass.

The sixteen baseline failures and their request corrections:

| Case (in `tests/test_conversation.py`) | Correction |
| --- | --- |
| `CliCase.test_an_agent_chooses_the_coordinator_and_an_answerer_posts_part_of_an_answer` | CLI reply choice |
| `CliCase.test_an_agent_reads_the_conversation_and_what_became_of_each_item` | Agent reply choice |
| `ItemsCase.test_an_answer_to_part_keeps_the_item_new_until_an_answer_to_all_of_it` | Agent reply choice |
| `ItemsCase.test_only_who_answers_an_item_may_reply_to_it_and_elsewhere_any_agent_may` | Agent reply choice before answerer authority is checked |
| `ItemsCase.test_open_items_are_the_ones_not_settled_and_only_a_conversation_has_them` | Agent reply choice |
| `ItemsCase.test_what_people_and_named_agents_post_is_an_item_and_what_answers_is_not` | Agent reply choice |
| `ItemsCase.test_whispers_answers_and_replies_to_an_ask_are_not_items_and_a_follow_up_is` | Agent reply choice and person-ask metadata |
| `ItemsCase.test_with_two_agents_named_either_answers_the_first_settles_it_and_the_second_adds_a_line` | Agent reply choice |
| `WaitsCase.test_an_agent_asked_there_that_leaves_the_team_is_waited_on_no_more_and_rejoining_brings_nothing_back` | Person-ask metadata |
| `WaitsCase.test_an_answerers_ask_back_on_an_item_answers_it_and_waits_on_its_author_until_they_reply_to_that_ask` | Agent reply choice and person-ask metadata |
| `WaitsCase.test_an_answerers_ask_back_that_takes_part_leaves_the_item_new_and_still_waits` | Agent reply choice and person-ask metadata |
| `WaitsCase.test_an_ask_waits_on_each_person_until_they_reply_to_that_ask` | Agent reply choice |
| `WaitsCase.test_the_coordinators_asks_on_two_items_wait_apart_and_a_new_post_clears_neither` | Agent reply choice and person-ask metadata |
| `WhoIsInItCase.test_changing_the_coordinator_moves_who_is_in_it_once_and_the_old_one_still_owes_its_asks` | Agent reply choice |
| `WhoIsInItCase.test_leaving_the_team_ends_a_place_in_it_with_its_waits_and_joining_brings_the_next_message` | Person-ask metadata |
| `WhoIsInItCase.test_who_is_delivered_a_message_there_is_its_people_its_coordinator_and_whoever_it_names` | Agent reply choice |

No product change or test retirement is planned. If an assertion reveals an
actual defect after its request is valid, name it separately before changing
the product. Verification is isolated scratch Core/CLI only, with retained
baseline and corrected receipts; no browser is needed.
