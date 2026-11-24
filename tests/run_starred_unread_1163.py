from __future__ import annotations

"""Finite selected Core identities, with no discovery or subprocesses."""

import sys
import unittest


NEW = [
    "test_unstarred_nested_replies_count_only_in_their_dossier_and_name_the_reachable_oldest",
    "test_every_star_page_has_the_complete_count_and_joins_and_splits_use_current_roots",
    "test_pending_plus_mark_counts_once_and_reading_keeps_the_independent_mark",
    "test_leaving_deactivates_old_subscription_but_a_new_direct_delivery_still_counts",
    "test_other_readers_marks_invisible_whispers_and_own_writing_never_add_to_the_count",
    "test_access_revocation_refuses_the_scoped_projection_without_erasing_its_star",
    "test_zero_default_and_read_only_projection_change_no_record_or_unscoped_shape",
    "test_an_agent_correction_is_not_a_second_unread_message",
    "test_an_unsent_reply_disappears_from_its_starred_dossier_count",
    "test_unrelated_history_and_cancelled_rows_do_not_increase_scoped_view_work",
    "test_scoped_candidate_queries_use_group_topic_and_reader_mark_indexes",
]
OLD = [
    "test_outline_stars.OutlineStars.test_titles_follow_real_roots_names_and_live_star_order",
    "test_outline_stars.OutlineStars.test_scoped_reads_do_not_expose_another_actor_or_private_note",
    "test_outline_stars.OutlineStars.test_whispers_private_notes_and_membership_are_checked_at_each_read",
    "test_outline_stars.OutlineStars.test_scoped_empty_and_denied_topic_have_no_fallback_to_other_topics",
    "test_new_line.CountLeadsThereCase.test_a_pending_delivery_deep_in_a_dossier_far_up_the_topic_is_counted_and_led_to_until_it_is_read",
    "test_new_line.CountLeadsThereCase.test_what_the_reader_cannot_reach_or_is_not_theirs_is_never_counted",
    "test_marks.MarkCountCase.test_a_pending_delivery_and_its_mark_count_once_and_reading_keeps_the_mark",
    "test_marks.MarkCountCase.test_a_pending_row_of_a_cancelled_subscription_does_not_hide_the_mark",
    "test_marks.MarkCountCase.test_a_mark_on_your_own_message_counts_nowhere",
    "test_marks.MarkCountCase.test_mark_leave_and_rejoin_counts_one_and_a_lost_topic_holds_its_mark_dormant",
    "test_starred_dossier.StarredDossierCase.test_item_655_root_membership_distinguishes_singletons_replies_and_joined_stacks",
    "test_starred_dossier.StarredDossierCase.test_item_655_a_whisper_the_reader_cannot_see_does_not_make_a_dossier",
]


if __name__ == "__main__":
    if sys.argv[1:] not in (["old_red"], ["fixed_green"]):
        raise SystemExit("Name exactly old_red or fixed_green")
    names = ["test_starred_unread_1163.StarredUnread1163." + name for name in NEW]
    names = names[:1] if sys.argv[1] == "old_red" else names + OLD
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun != len(names) or result.skipped or result.unexpectedSuccesses:
        raise SystemExit(2)
    raise SystemExit(0 if result.wasSuccessful() else 1)
