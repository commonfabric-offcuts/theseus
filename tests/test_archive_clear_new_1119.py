from __future__ import annotations

"""1119: Archive is one guarded read-and-place transaction in an isolated Store.

Select ArchiveNewCase explicitly: imported fixture classes are not extra cases.
No browser/native behavior is claimed by this Core cohort.
"""
import json
import sqlite3
from unittest.mock import patch

from aim_next.contract import Refusal
from test_stacks import StackCase


class ArchiveNewCase(StackCase):
    def post(self, body='Words', actor='agent-a', topic='t1', **args):
        # Keep this item's synthetic fixture explicit; do not change StackCase.
        if args.get('reply_to') and not args.get('whisper'):
            args.setdefault('reply_without_quote', '1119 isolated fixture continuation; no source passage is needed')
        return super().post(body, actor=actor, topic=topic, **args)

    def latest(self):
        return self.sql("SELECT max(seq) FROM messages WHERE topic_id='t1'")[0][0]

    def archive(self, root, through=None, revision=0, actor='owner', op=None, **extra):
        return self.command('stack.aside', {'through': self.latest() if through is None else through,
                            'clear_new': True, **extra}, target={'message_id': root},
                            expected={'aside_revision': revision}, actor=actor, op=op)

    def position(self, mid, actor='owner'):
        answer = self.store.view(actor, 'stack_positions', {'topic_id': 't1', 'message_ids': [mid]})
        self.assertNotIn('error', answer, answer)
        return answer['items'][0]['stack_position']

    def mark(self, mid, revision=0, actor='owner'):
        return self.committed(self.command('message.mark', {'marked': True}, target={'message_id': mid},
                              expected={'mark_revision': revision}, actor=actor))

    def reading(self):
        tables = ('deliveries', 'delivery_groups', 'recipient_schedule', 'message_marks', 'message_acts')
        return {name: self.sql('SELECT * FROM ' + name + ' ORDER BY rowid') for name in tables}

    def pending(self, mid, actor='owner'):
        return self.sql("SELECT id FROM deliveries WHERE message_id=? AND recipient_id=? AND state='pending'", (mid, actor))

    def mark_revision(self, mid, actor='owner'):
        return self.sql('SELECT revision FROM message_marks WHERE message_id=? AND actor_id=?', (mid, actor))[0][0]

    def test_archive_opt_in_reads_existing_new_in_one_guarded_act(self):
        root = self.post('A fresh public dossier', addressees=['owner'], intent='tell')
        child = self.post('Its unread answer', reply_to=root)
        self.mark(child)
        self.assertTrue(self.pending(root), 'the real direct delivery exists before the act')
        self.assertTrue(self.pending(child), 'the real subscription delivery exists before the act')
        receipt = self.archive(root)
        # Declared baseline red: 386 refuses the new explicit reading contract.
        # This assertion is reached after accepted fixture commands, not setup.
        self.assertEqual(receipt.get('status'), 'committed', '1119 Archive clear_new must be an accepted guarded act: ' + repr(receipt))
        result = self.committed(receipt)
        self.assertEqual(result['cleared_new'], {'through': self.latest(), 'deliveries': 2, 'marks': 1})
        self.assertEqual(self.pending(root) + self.pending(child), [])
        self.assertEqual(self.mark_revision(child), 2)
        self.assertTrue(self.position(child)['below'])
        self.assertEqual(self.store.view('owner', 'marks', {'topic_id': 't1'})['items'], [])
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'limit': 100})
        self.assertFalse(any(item['unread'] for item in page['items']))
        self.assertIsNone(self.store.view('owner', 'topic_unread', {'topic_id': 't1'})['oldest_unread'])

    def test_legacy_position_only_archive_keeps_its_existing_reading_meaning(self):
        root = self.post(); self.mark(root)
        before = self.reading()
        result = self.committed(self.command('stack.aside', {'through': self.latest()},
                                target={'message_id': root}, expected={'aside_revision': 0}))
        after = self.reading()
        self.assertNotIn('cleared_new', result)
        for name in ('deliveries', 'delivery_groups', 'recipient_schedule', 'message_marks'):
            self.assertEqual(after[name], before[name], name)

    def test_newer_other_author_reply_survives_the_observed_boundary_and_revives(self):
        root = self.post(); through = self.latest()
        later = self.post('Arrived after the user acted', reply_to=root)
        self.mark(later)
        result = self.committed(self.archive(root, through=through))
        self.assertEqual(result['cleared_new'], {'through': through, 'deliveries': 1, 'marks': 0})
        self.assertEqual(self.pending(root), [])
        self.assertTrue(self.pending(later)); self.assertEqual(self.mark_revision(later), 1)
        self.assertFalse(self.position(root)['below'])
        self.assertEqual(self.position(root)['through'], through)

    def test_own_reply_stays_archived_then_another_authors_reply_returns_it(self):
        root = self.post(); self.committed(self.archive(root))
        own = self.post('My continuation', actor='owner', reply_to=root)
        self.assertTrue(self.position(own)['below'])
        later = self.post('Someone answers', reply_to=own)
        self.assertFalse(self.position(later)['below']); self.assertTrue(self.pending(later))

    def test_unloaded_and_joined_members_are_read_by_canonical_membership(self):
        root = self.post(); parent = root
        for n in range(12):
            parent = self.post('Unloaded ancestor %d' % n, reply_to=parent)
        side = self.post('A joined dossier'); joined = self.post('Its answer', reply_to=side)
        self.committed(self.join(side, parent)); self.mark(root); self.mark(joined)
        result = self.committed(self.archive(root))
        self.assertEqual(result['cleared_new']['deliveries'], 15)
        self.assertEqual(result['cleared_new']['marks'], 2)
        for mid in (root, parent, side, joined):
            self.assertEqual(self.pending(mid), []); self.assertTrue(self.position(mid)['below'])
        page = self.store.view('owner', 'topic_messages', {'topic_id': 't1', 'limit': 2})
        self.assertEqual(len(page['items']), 2)
        self.assertTrue(all(not item['unread'] for item in page['items']))

    def test_unrelated_dossier_and_another_readers_marks_and_deliveries_survive(self):
        root = self.post(); other = self.post('Unrelated dossier')
        self.mark(root); self.mark(other); self.mark(root, actor='agent-b')
        before_other = self.pending(other)
        before_b = self.sql("SELECT * FROM deliveries WHERE recipient_id='agent-b' ORDER BY id")
        self.committed(self.archive(root))
        self.assertEqual(self.pending(other), before_other); self.assertEqual(self.mark_revision(other), 1)
        self.assertEqual(self.mark_revision(root, 'agent-b'), 1)
        self.assertEqual(self.sql("SELECT * FROM deliveries WHERE recipient_id='agent-b' ORDER BY id"), before_b)

    def test_hidden_whisper_does_not_change_an_outside_readers_position_or_read_state(self):
        root = self.post('Public root')
        # Whispers omit intent; Core owns their private Tell semantics.
        private = self.post('Private answer', actor='owner', reply_to=root, addressees=['agent-a'], whisper=True)
        self.mark(private, actor='agent-a')
        before = self.pending(private, 'agent-a')
        self.committed(self.archive(root, through=self.sql('SELECT seq FROM messages WHERE id=?', (root,))[0][0], actor='agent-b'))
        self.assertTrue(self.position(root, 'agent-b')['below'])
        self.assertEqual(self.pending(private, 'agent-a'), before)
        self.assertEqual(self.mark_revision(private, 'agent-a'), 1)
        self.rejected(self.store.view('agent-b', 'stack_positions', {'topic_id': 't1', 'message_ids': [private]}), 'FORBIDDEN')

    def test_star_refusal_precedes_any_read_side_effect(self):
        root = self.post(); self.mark(root); self.committed(self.star(root))
        before = self.reading()
        self.rejected(self.archive(root), 'STARRED_IN_DOSSIER')
        self.assertEqual(self.reading(), before)

    def test_stale_aside_revision_precedes_any_read_side_effect(self):
        root = self.post(); self.committed(self.archive(root)); self.mark(root)
        before = self.reading()
        self.rejected(self.archive(root, revision=0), 'REVISION_CONFLICT')
        self.assertEqual(self.reading(), before)

    def test_changed_root_and_inaccessible_actor_refuse_before_reading(self):
        root, destination = self.post(), self.post('Destination')
        self.mark(root); self.committed(self.join(root, destination)); before = self.reading()
        self.rejected(self.archive(root), 'STACK_CHANGED')
        self.rejected(self.archive(destination, actor='outsider'), 'FORBIDDEN')
        self.assertEqual(self.reading(), before)

    def test_same_operation_replay_cannot_clear_a_mark_renewed_after_commit(self):
        root = self.post(); through = self.latest(); self.mark(root)
        first = self.archive(root, through=through, op='archive-once'); self.committed(first)
        self.mark(root, revision=2); before = self.reading()
        self.assertEqual(self.archive(root, through=through, op='archive-once'), first)
        self.assertEqual(self.reading(), before); self.assertEqual(self.mark_revision(root), 3)

    def test_new_archive_at_same_placement_clears_new_mark_without_new_aside_revision(self):
        root = self.post(); through = self.latest(); self.committed(self.archive(root, through=through))
        self.mark(root); result = self.committed(self.archive(root, through=through, revision=1))
        self.assertFalse(result['changed']); self.assertEqual(result['aside_revision'], 1)
        self.assertEqual(result['cleared_new'], {'through': through, 'deliveries': 0, 'marks': 1})
        self.assertEqual(self.mark_revision(root), 2)

    def test_undo_restores_placement_only_and_keeps_new_reminders(self):
        root = self.post(); self.mark(root); self.committed(self.archive(root))
        self.mark(root, revision=2)
        self.committed(self.command('stack.aside', {'through': None, 'key': 7}, target={'message_id': root}, expected={'aside_revision': 1}))
        self.assertFalse(self.position(root)['below']); self.assertEqual(self.position(root)['order_key'], 7)
        self.assertEqual(self.mark_revision(root), 3); self.assertEqual(self.pending(root), [])

    def test_malformed_or_future_reading_arguments_are_rejected_without_effect(self):
        root = self.post(); self.mark(root); before = self.reading()
        for args in ({'through': self.latest(), 'clear_new': 'yes'}, {'through': None, 'clear_new': True},
                     {'through': self.latest(), 'clear_new': True, 'extra': 1}, {'through': self.latest() + 100, 'clear_new': True}):
            self.rejected(self.command('stack.aside', args, target={'message_id': root}, expected={'aside_revision': 0}), 'INVALID_ARGUMENT')
        self.assertEqual(self.reading(), before)

    def test_draft_survives_and_reading_option_is_not_stored_as_placement(self):
        root = self.post(); self.committed(self.save_draft('reply', {'kind': 'message', 'id': root}, 't1', 'Exact unsent words'))
        before = self.sql("SELECT * FROM drafts WHERE id='reply'")
        self.committed(self.archive(root))
        self.assertEqual(self.sql("SELECT * FROM drafts WHERE id='reply'"), before)
        value = json.loads(self.rows('aside')[0][3]); self.assertEqual(value, {'through': self.latest()})

    def test_failure_after_real_acknowledgments_rolls_back_counts_marks_and_placement(self):
        root = self.post(); self.mark(root); before = self.reading(); observed = []
        def fail_after_ack(db, actor, message):
            observed.append(db.execute("SELECT state FROM deliveries WHERE message_id=? AND recipient_id=?", (root, actor)).fetchone()[0])
            raise Refusal('REVISION_CONFLICT', '1119 injected failure after acknowledgment')
        with patch.object(self.store, '_clear_mark', side_effect=fail_after_ack):
            self.rejected(self.archive(root), 'REVISION_CONFLICT')
        self.assertEqual(observed, ['acknowledged'], 'the control reached a real in-transaction mutation')
        self.assertEqual(self.reading(), before, 'SAVEPOINT rolls back delivery/group/schedule/mark/aside together')
        self.committed(self.archive(root))
        self.assertEqual(self.pending(root), []); self.assertEqual(self.mark_revision(root), 2)

    def test_non_new_correction_notification_is_not_acknowledged_by_archive(self):
        root = self.post()
        # Exercise the real notification owner in this isolated store. This
        # revision-2 correction is not a second original unread delivery.
        with sqlite3.connect(str(self.path)) as db:
            db.row_factory = sqlite3.Row
            notification = self.store._queue_delivery(db, root, 'owner', 't1', {'correction': 1}, revision=2)
        result = self.committed(self.archive(root))
        self.assertEqual(result['cleared_new']['deliveries'], 1)
        self.assertEqual(self.sql('SELECT state FROM deliveries WHERE id=?', (notification,)), [('pending',)])
        self.assertIsNone(self.store.view('owner', 'topic_unread', {'topic_id': 't1'})['oldest_unread'])

    def test_wrong_authority_is_refused_without_any_read_side_effect(self):
        root = self.post(); self.mark(root); before = self.reading()
        envelope = self.envelope('stack.aside', {'message_id': root}, {'through': self.latest(), 'clear_new': True}, {'aside_revision': 0})
        envelope['expected']['authority']['authority_epoch'] = 'another-epoch'
        self.rejected(self.store.command('owner', envelope), 'AUTHORITY_CHANGED')
        self.assertEqual(self.reading(), before)
