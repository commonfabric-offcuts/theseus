from __future__ import annotations

import test_dossier_covers as fixtures


class CoverCapacityCase(fixtures.CoverCase):
    def test_twenty_thousand_characters_survive_store_and_every_cover_projection(self):
        root, answer, _ = self.dossier()
        text = 'A' * 20000
        written = self.committed(self.cover(root, {'stands': text}))
        self.assertEqual(written['cover']['stands'], text)
        self.assertEqual(self.rows()[-1][0]['stands'], text)
        for reader in ('owner', 'agent-a', 'agent-b'):
            with self.subTest(reader=reader):
                self.assertEqual(self.shown(root, reader)['stands'], text)
                self.assertEqual(self.store.view(reader, 'dossier_cover', {'message_id': answer})['cover']['stands'], text)
                places = self.store.view(reader, 'stack_positions', {'topic_id': 't1', 'message_ids': [answer]})
                self.assertEqual(places['items'][0]['stack_position']['cover']['stands'], text)

    def test_character_boundary_counts_newlines_and_refuses_without_a_partial_update(self):
        root, _, _ = self.dossier()
        text = 'é' * 15999 + '\n' + 'z' * 16000
        self.assertEqual(len(text), 32000)
        self.committed(self.cover(root, {'stands': text, 'waiting': [{'text': 'Keep this wait', 'default': 'Wait'}]}))
        before = self.rows()
        refusal = self.cover(root, {'stands': text + '!', 'waiting': []}, revision=1)
        self.rejected(refusal, 'INVALID_ARGUMENT')
        self.assertEqual(refusal['error']['message'], 'Where it stands is at most 32000 characters')
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.shown(root)['stands'], text)
        self.assertEqual(self.shown(root)['waiting'], before[-1][0]['waiting'])

    def test_cli_keeps_a_twenty_line_board_and_a_twenty_thousand_character_cover_whole(self):
        root, _, _ = self.dossier()
        board = '\n'.join('9:%02d • A release with its full title (%d)' % (n, 900 + n) for n in range(20))
        self.assertGreater(len(board), 300)
        for text in (board, 'Long cover ' + 'x' * (20000 - len('Long cover '))):
            with self.subTest(characters=len(text)):
                code, output, error = self.run_cli('cover', root, '--stands', text)
                self.assertEqual((code, error), (0, ''), output)
                self.assertIn('  stands: ' + text + '\n', output)
                code, output, error = self.run_cli('cover', root)
                self.assertEqual((code, error), (0, ''), output)
                self.assertIn('  stands: ' + text + '\n', output)
