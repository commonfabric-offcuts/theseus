from __future__ import annotations

from tests import own_receipt_fixtures as portable

"""Literal document/test boundaries; review objects are SYNTHETIC.

Real immutable Git trees supply entries, never source admission or native proof.
"""
import copy
import subprocess
import unittest
from unittest import mock
from tools import base_move as b

OLD = 'a958f7cdebe3743b9a6ebf63c11564629d737bce'
SOURCE = 'f31e319994ecc96c5565828a53fde75c01bd3386'
LIVE = '0a68981b0fa25b9a6085c5f9ab1ecf8d16bf9b7d'
FINAL = 'dddf00e171fa3924f12e9a1c4f20cac5a6602d3c'
OVERLAPS = ['docs/interaction.md', 'tests/acts.json', 'tests/stack_native.mjs', 'tools/ci-input-reads.json']
LISTING = [
    {'path': 'docs/dossier-covers.md', 'original_blob': '405543b6bf11eb290f3276c7c82767a15d5d3327',
     'source_blob': 'dc2a2964d5a92f0e6cd4897f885b11001ff70e11',
     'live_blob': '405543b6bf11eb290f3276c7c82767a15d5d3327',
     'assembly_blob': 'd28833e622ce354a8aa134cfa1992f088970752b',
     'reason': 'Document the requested-width fit boundary with unchanged 2px tolerance, native Tab diagnostics and separate mutant/restored results; no product or key mapping change.'},
    {'path': 'tests/dossier_promises_native.mjs', 'original_blob': None,
     'source_blob': 'bfa1b3e7ccedac3829910d591c3b07abbf0e1590', 'live_blob': None,
     'assembly_blob': '3d5d3338854685301cec3e631166390d15b11c02',
     'reason': 'Bound fit to requested and actual viewports, observe native Tab delivery/calibration without changing acceptance, retain every mutant error and separate exact restored control, and snapshot eight additional actual sources; fourteen identities and 2px tolerance unchanged.'},
]


def git(*args):
    return subprocess.run(portable.git_command() + list(args), capture_output=True, text=True)


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

    def test_exact_two_adaptations_and_four_overlaps(self):
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
        for path in ('tests/other.mjs', 'docs/other.md', 'web/dossier-cover.mjs'):
            with self.subTest(path=path):
                self.listing = copy.deepcopy(LISTING)
                self.listing[0]['path'] = path
                with self.assertRaisesRegex(b.Refused, 'unsupported test adaptation path'):
                    self.consume()

    def test_unlisted_product_nonoverlap_refuses(self):
        self.maps[FINAL]['web/dossier-cover.mjs'] = '100644 blob ' + '0' * 40
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
