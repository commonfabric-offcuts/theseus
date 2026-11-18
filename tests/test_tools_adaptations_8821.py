from __future__ import annotations

"""Literal document/test boundaries; review objects are SYNTHETIC.

Real immutable Git trees supply entries, never source admission or native proof.
"""
import copy
import subprocess
import unittest
from unittest import mock
from tools import base_move as b

OLD = 'a958f7cdebe3743b9a6ebf63c11564629d737bce'
SOURCE = '5903d8b8fac63b8b4e6d191dbc8d59db5094d9b0'
LIVE = '0a68981b0fa25b9a6085c5f9ab1ecf8d16bf9b7d'
FINAL = '4225184688d7503296e1c0034f1418cb48f4a9d3'
OVERLAPS = ['docs/experience-guidelines.md', 'docs/interaction.md', 'docs/rails.md', 'tests/acts.json', 'tests/outcome_rail_native.mjs', 'tools/ci-input-reads.json']
LISTING = [{'assembly_blob': '80d840ed8e40beead225e8519bcbd3e368844bda',
  'live_blob': None,
  'original_blob': None,
  'path': 'tests/outline_stars_native.mjs',
  'reason': 'Retain every original assertion and identity; add only35 state/reopen/readiness lines '
            'for the original visible, loaded, nonbusy dossier row after native phone drawer '
            'reopening, with bounded failure evidence.',
  'source_blob': '02fe0a1f2b9b4a0a868e59f686562b970cd6ca02'},
 {'assembly_blob': 'a3bacaba479930e26eccc3675d05074b9d39b55d',
  'live_blob': 'da3db531d43497916f8108d207a7e1df9e87a279',
  'original_blob': 'da3db531d43497916f8108d207a7e1df9e87a279',
  'path': 'tests/webkit_native.mjs',
  'reason': 'Correct only the stale SKIPPED key to the exact offered picture-link Return name; '
            'retain HELD, its qualification and the missing-offer guard; no picture behavior pass.',
  'source_blob': 'ec212d08a9d23f7e9230e20faea7acca6bd6227e'}]


def git(*args):
    return subprocess.run(['git'] + list(args), capture_output=True, text=True)


class LiteralAdaptations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.actual = {h: b.entries(git, h) for h in (OLD, SOURCE, LIVE, FINAL)}

    def setUp(self):
        self.listing = copy.deepcopy(LISTING)
        self.maps = copy.deepcopy(self.actual)
        self.review = {'conflict_paths': list(OVERLAPS)}  # SYNTHETIC scope-only review

    def consume(self):
        with mock.patch.object(b, 'entries', side_effect=lambda unused, head: self.maps[head]):
            b.resolution_scope(git, OLD, SOURCE, LIVE, FINAL, self.review, self.listing)

    def test_exact_two_adaptations_and_six_overlaps(self):
        # Control without the map fixture: actual Git supplies all four trees.
        b.resolution_scope(git, OLD, SOURCE, LIVE, FINAL, self.review, self.listing)
        for row in LISTING:
            for key, head in [('original_blob', OLD), ('source_blob', SOURCE), ('live_blob', LIVE), ('assembly_blob', FINAL)]:
                expected = None if row[key] is None else '100644 blob ' + row[key]
                self.assertEqual(self.actual[head].get(row['path']), expected)

    def test_each_literal_claim_and_reason_refuses_change(self):
        for i in range(2):
            for key in ('original_blob', 'source_blob', 'live_blob', 'assembly_blob', 'reason'):
                with self.subTest(path=LISTING[i]['path'], key=key):
                    self.listing = copy.deepcopy(LISTING)
                    self.listing[i][key] = 'changed' if key == 'reason' else '0' * 40
                    with self.assertRaisesRegex(b.Refused, 'reason differs|reviewed blobs differ'):
                        self.consume()

    def test_each_actual_entry_and_mode_refuses_change(self):
        for row in LISTING:
            for head in (OLD, SOURCE, LIVE, FINAL):
                for entry in ('100644 blob ' + '0' * 40, '100755 blob ' + row['assembly_blob'], None):
                    if self.actual[head].get(row['path']) == entry:
                        continue
                    with self.subTest(path=row['path'], head=head, entry=entry):
                        self.maps = copy.deepcopy(self.actual)
                        if entry is None:
                            self.maps[head].pop(row['path'], None)
                        else:
                            self.maps[head][row['path']] = entry
                        with self.assertRaisesRegex(b.Refused, 'Git entry differs'):
                            self.consume()

    def test_missing_or_duplicate_listing_refuses(self):
        for listing in (LISTING[:1], LISTING[1:], [], LISTING + LISTING[:1]):
            with self.subTest(listing=listing):
                self.listing = copy.deepcopy(listing)
                with self.assertRaisesRegex(b.Refused, 'scope widening|duplicate test adaptation'):
                    self.consume()

    def test_unknown_test_document_and_product_paths_refuse(self):
        for path in ('tests/other.mjs', 'docs/other.md', 'web/outline-dossiers.mjs'):
            with self.subTest(path=path):
                self.listing = copy.deepcopy(LISTING)
                self.listing[0]['path'] = path
                with self.assertRaisesRegex(b.Refused, 'unsupported test adaptation path'):
                    self.consume()

    def test_unlisted_product_nonoverlap_refuses(self):
        self.maps[FINAL]['web/outline-dossiers.mjs'] = '100644 blob ' + '0' * 40
        with self.assertRaisesRegex(b.Refused, 'scope widening'):
            self.consume()

    def test_candidate_claim_cannot_authorize_new_test_bytes(self):
        self.maps[FINAL][LISTING[1]['path']] = '100644 blob ' + '0' * 40
        self.listing[1]['assembly_blob'] = '0' * 40
        with self.assertRaisesRegex(b.Refused, 'reviewed blobs differ'):
            self.consume()

    def test_overlap_list_stays_exact(self):
        self.review['conflict_paths'].append(LISTING[0]['path'])
        with self.assertRaisesRegex(b.Refused, 'resolution path scope differs'):
            self.consume()
