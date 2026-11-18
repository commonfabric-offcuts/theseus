from __future__ import annotations

"""Synthetic immutable Git controls, never native or authenticated admission.

The embedded bytes are the actual reviewed four-width unit, not executed here.
Only temporary repositories and synthetic source/controller receipts are used.
"""
import copy
import json
import subprocess
from pathlib import Path

from tools import base_move as b
import test_tools_base_move as existing

PATH = 'tests/ui_card_editor_652.test.mjs'
BEFORE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { DeckPage } from '../web/deck-page.mjs';\n\nfor (const width of [320, 375, 390, 1280]) test(`item 652: at ${width} the picked card uses the laptop list's focus and reveal, never horizontal paging`, () => {\n  const acts = [], row = {\n    scrollIntoView: options => acts.push(['reveal', options]),\n    focus: options => acts.push(['focus', options]),\n  };\n  const page = Object.assign(Object.create(DeckPage.prototype), {\n    narrow: { matches: width <= 760 }, picked: 0, keyed: false,\n    list: { clientWidth: width, querySelector: () => row, querySelectorAll: () => [row], scrollTo: options => acts.push(['page sideways', options]) },\n  });\n  page.show(true);\n  assert.deepEqual(acts, [['reveal', { block: 'nearest' }], ['focus', { preventScroll: true }]]);\n  acts.length = 0;\n  page.show(false);\n  assert.deepEqual(acts, [['reveal', { block: 'nearest' }]], 'revealing without focus does not steal writing focus');\n});\n"
AFTER = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { DeckPage } from '../web/deck-page.mjs';\n\nfor (const width of [320, 375, 390, 1280]) test(`item 652: at ${width} a pointer pick uses the laptop list's focus and holds the page, never horizontal paging`, () => {\n  const acts = [], row = {\n    scrollIntoView: options => acts.push(['reveal', options]),\n    focus: options => acts.push(['focus', options]),\n  };\n  const page = Object.assign(Object.create(DeckPage.prototype), {\n    narrow: { matches: width <= 760 }, picked: 0, keyed: false,\n    list: { clientWidth: width, querySelector: () => row, querySelectorAll: () => [row], scrollTo: options => acts.push(['page sideways', options]) },\n  });\n  page.show(true);\n  assert.deepEqual(acts, [['focus', { preventScroll: true }]]);\n  acts.length = 0;\n  page.show(false);\n  assert.deepEqual(acts, [], 'an ordinary redraw neither scrolls the page nor steals writing focus (item 644)');\n});\n"
REASON = ('Preserve live item 644 pointer focus(preventScroll) without forced reveal '
          'or scrolling on ordinary redraw at all four widths.')
LISTING = {'path': PATH, 'original_blob': None, 'source_blob': '23f57444c36c5a163f76b35ef7810532ab3af46a',
           'live_blob': None, 'assembly_blob': '8a18797a497672deefb66ba90cf42c15d3e2c4d9', 'reason': REASON}


class TestAdaptations(existing.BaseMoveFixture):
    replace_assembly = existing.BaseMove.replace_assembly

    def branch(self, name, start, changes):
        if name == 'judged':
            changes = list(changes) + [(PATH, BEFORE)]
        return super().branch(name, start, changes)

    def setUp(self):
        super().setUp()
        self.replace_assembly([(PATH, AFTER)])
        self.evidence_body['test_adaptations'] = [copy.deepcopy(LISTING)]

    def accepted(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        return self.evidence_of('02-release')['record']['measurements']['train']['base_move']

    def test_exact_reviewed_test_adaptation(self):
        measured = self.accepted()
        self.assertFalse(measured['source_observed']['passed'])
        self.assertEqual(measured['source_observed']['red_count'], 1)
        body = b.document(measured['evidence'])
        self.assertEqual(body['test_adaptations'], [LISTING])
        self.assertEqual(b.document(body['review'])['evidence_sha256'],
                         b.digest(b.canonical({k: v for k, v in body.items() if k != 'review'})))
        self.assertEqual(self.git(self.work, 'rev-parse', self.head + ':' + PATH), LISTING['source_blob'])
        self.assertEqual(self.git(self.work, 'rev-parse', self.assembly + ':' + PATH), LISTING['assembly_blob'])

    def test_product_path_never_qualifies(self):
        self.replace_assembly([('web/deck-page.mjs', AFTER)])
        self.evidence_body['test_adaptations'][0]['path'] = 'web/deck-page.mjs'
        self.refuse('unsupported test adaptation path')

    def test_other_test_name_with_identical_bytes_refuses(self):
        self.replace_assembly([('tests/ui_product.test.mjs', AFTER)])
        self.evidence_body['test_adaptations'][0]['path'] = 'tests/ui_product.test.mjs'
        self.refuse('unsupported test adaptation path')

    def test_unlisted_test_change_refuses(self):
        del self.evidence_body['test_adaptations']
        self.refuse('scope widening')

    def test_unlisted_product_change_beside_valid_adaptation_refuses(self):
        self.replace_assembly([('web/deck-page.mjs', '// extra product\n')])
        self.refuse('scope widening')

    def test_unlisted_other_test_beside_valid_adaptation_refuses(self):
        self.replace_assembly([('tests/ui_other.test.mjs', '// extra test\n')])
        self.refuse('scope widening')

    def test_wrong_before_blob_refuses(self):
        self.evidence_body['test_adaptations'][0]['source_blob'] = '0' * 40
        self.refuse('reviewed blobs differ')

    def test_wrong_after_blob_refuses(self):
        self.evidence_body['test_adaptations'][0]['assembly_blob'] = '0' * 40
        self.refuse('reviewed blobs differ')

    def test_absence_must_be_explicit(self):
        del self.evidence_body['test_adaptations'][0]['original_blob']
        self.refuse('fields')

    def test_wrong_original_absence_refuses(self):
        self.evidence_body['test_adaptations'][0]['original_blob'] = '0' * 40
        self.refuse('reviewed blobs differ')

    def test_wrong_live_absence_refuses(self):
        self.evidence_body['test_adaptations'][0]['live_blob'] = '0' * 40
        self.refuse('reviewed blobs differ')

    def test_empty_listing_refuses(self):
        self.evidence_body['test_adaptations'] = []
        self.refuse('empty or invalid test adaptations')

    def test_null_listing_refuses(self):
        self.evidence_body['test_adaptations'] = None
        self.refuse('empty or invalid test adaptations')

    def test_duplicate_listing_refuses(self):
        self.evidence_body['test_adaptations'].append(copy.deepcopy(LISTING))
        self.refuse('duplicate test adaptation')

    def test_reused_listing_on_unadapted_assembly_refuses(self):
        self.replace_assembly([(PATH, BEFORE)])
        self.refuse('test adaptation Git entry differs: assembly_blob')

    def test_actual_assembly_blob_read_from_git(self):
        self.replace_assembly([(PATH, AFTER + '// unreviewed\n')])
        self.refuse('test adaptation Git entry differs: assembly_blob')

    def test_missing_assembly_entry_refuses(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        self.git(self.work, 'rm', PATH)
        self.replace_assembly([])
        self.refuse('test adaptation Git entry differs: assembly_blob')

    def test_actual_source_blob_read_from_git(self):
        # Keep every claimed blob unchanged, but change the immutable source tree.
        self.git(self.work, 'checkout', '-q', '--detach', self.head)
        self.write(PATH, BEFORE + '// unreviewed source\n')
        other = self.commit('different source')
        git = lambda *args: subprocess.run(
            ['git', '-C', str(self.work)] + list(args), capture_output=True, text=True)
        with self.assertRaisesRegex(b.Refused, 'test adaptation Git entry differs: source_blob'):
            b.resolution_scope(git, self.old, other, self.L, self.assembly, self.review, [LISTING])

    def test_executable_mode_refuses(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        self.git(self.work, 'update-index', '--chmod=+x', PATH)
        self.replace_assembly([])
        self.refuse('test adaptation Git entry differs: assembly_blob')

    def test_symlink_mode_refuses(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        self.git(self.work, 'update-index', '--cacheinfo', '120000', LISTING['assembly_blob'], PATH)
        self.replace_assembly([])
        self.refuse('test adaptation Git entry differs: assembly_blob')

    def test_missing_reason_refuses(self):
        del self.evidence_body['test_adaptations'][0]['reason']
        self.refuse('fields')

    def test_empty_reason_refuses(self):
        self.evidence_body['test_adaptations'][0]['reason'] = ' '
        self.refuse('reason differs')

    def test_wrong_reason_refuses(self):
        self.evidence_body['test_adaptations'][0]['reason'] = 'Allow unrelated feature work'
        self.refuse('reason differs')

    def test_missing_independent_review_attribution_refuses(self):
        self.review['reviewer'] = ''
        self.refuse('missing review attribution')

    def test_original_audit_cannot_replace_final_resolution_review(self):
        self.review['record'] = self.review['judgment_audit']
        self.refuse('independent resolution review missing')

    def altered_after_review(self, change):
        path = self.candidate()
        train = json.loads(path.read_text())
        body = b.document(train['base_move'])
        change(body)
        train['base_move'] = self.save('changed-after-review.json', body)
        path.write_text(json.dumps(train))
        self.refused_train(path, self.merged, self.github, 'review binding differs')

    def test_listing_added_after_final_review_refuses(self):
        listing = self.evidence_body.pop('test_adaptations')
        self.altered_after_review(lambda body: body.update(test_adaptations=listing))

    def test_listing_reason_changed_after_final_review_refuses(self):
        self.altered_after_review(lambda body: body['test_adaptations'][0].update(reason='different'))

    def test_listing_removed_after_final_review_refuses(self):
        self.altered_after_review(lambda body: body.pop('test_adaptations'))

    def test_missing_review_binding_refuses(self):
        self.review['evidence_sha256'] = ''
        # candidate() deliberately binds the body; remove the binding afterwards.
        path = self.candidate()
        train = json.loads(path.read_text()); body = b.document(train['base_move'])
        review = b.document(body['review']); del review['evidence_sha256']
        body['review'] = self.save('unsigned-review.json', review)
        train['base_move'] = self.save('unsigned-body.json', body)
        path.write_text(json.dumps(train))
        self.refused_train(path, self.merged, self.github, 'fields')

    def test_overlap_review_stays_exact(self):
        self.review['conflict_paths'] = [PATH]
        self.refuse('resolution path scope differs')

    def test_candidate_claims_cannot_authorize_unknown_test_bytes(self):
        self.replace_assembly([(PATH, AFTER + '// unknown bytes\n')])
        self.evidence_body['test_adaptations'][0]['assembly_blob'] = self.git(
            self.work, 'rev-parse', self.assembly + ':' + PATH)
        self.refuse('reviewed blobs differ')

    def test_product_with_exact_reviewed_test_blobs_refuses(self):
        # Isolate path qualification: every listed blob is genuine and matches
        # Git, but at a product path. No unlisted mismatch masks this assertion.
        target = 'web/product.mjs'
        heads = []
        for start, content in ((self.head, BEFORE), (self.assembly, AFTER)):
            self.git(self.work, 'checkout', '-q', '--detach', start)
            self.write(PATH, BEFORE)
            self.write(target, content)
            heads.append(self.git(self.work, 'commit-tree', self.git(self.work, 'write-tree'),
                                  '-p', start, '-m', 'Synthetic path qualification fixture'))
        listing = dict(LISTING, path=target)
        git = lambda *args: subprocess.run(['git', '-C', str(self.work)] + list(args),
                                          capture_output=True, text=True)
        with self.assertRaisesRegex(b.Refused, 'unsupported test adaptation path'):
            b.resolution_scope(git, self.old, heads[0], self.L, heads[1], self.review, [listing])

    def test_actual_original_absence_read_from_git(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.old)
        self.write(PATH, BEFORE)
        other = self.commit('Synthetic original entry present')
        git = lambda *args: subprocess.run(['git', '-C', str(self.work)] + list(args),
                                          capture_output=True, text=True)
        with self.assertRaisesRegex(b.Refused, 'test adaptation Git entry differs: original_blob'):
            b.resolution_scope(git, other, self.head, self.L, self.assembly, self.review, [LISTING])

    def test_actual_live_absence_read_from_git(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.L)
        self.write(PATH, BEFORE)
        other = self.commit('Synthetic live entry present')
        git = lambda *args: subprocess.run(['git', '-C', str(self.work)] + list(args),
                                          capture_output=True, text=True)
        with self.assertRaisesRegex(b.Refused, 'test adaptation Git entry differs: live_blob'):
            b.resolution_scope(git, self.old, self.head, other, self.assembly, self.review, [LISTING])


CORRECTION_LISTING = [{'path': 'tests/card_editor_652.mjs', 'original_blob': None, 'source_blob': '68f60f880e532186cc49b972b3208a46203e4dfe', 'live_blob': None, 'assembly_blob': 'cb188b6c11f8aee76f61332e32e302ea45522736', 'reason': 'Preserve native press/focus requirements, retain original causes, capture missing delivery/media/failure evidence and unique normal/mutant/restored geometry; unchanged456 identities and six phases.'}, {'path': 'tests/ui_card_editor_652_contract.test.mjs', 'original_blob': None, 'source_blob': None, 'live_blob': None, 'assembly_blob': 'b90dc6e506d7c474e27e6bb4009e4f3e168a6bfa', 'reason': 'New browser-free contract checks hold phone-width44px rule and truthful diagnostic/error/phase preservation.'}]
CORRECTION_OLD = 'f4b4524c5859212b62062f030a84c8d309b3cd72'
CORRECTION_NEW = '7c4e13ba506c9eb4443ebe70202d8ee490db7bcc'

def correction_bytes(revision, path, blob):
    observed = subprocess.check_output(['git', 'rev-parse', revision + ':' + path], text=True).strip()
    if observed != blob:
        raise AssertionError('independent correction fixture blob differs')
    return subprocess.check_output(['git', 'show', revision + ':' + path]).decode()


class CorrectionAdaptations(existing.BaseMoveFixture):
    """Exact helper and newly added contract, immutable Git synthetic envelopes."""
    replace_assembly = existing.BaseMove.replace_assembly

    def branch(self, name, start, changes):
        if name == 'judged':
            row = CORRECTION_LISTING[0]
            changes = list(changes) + [(row['path'], correction_bytes(CORRECTION_OLD, row['path'], row['source_blob']))]
        return super().branch(name, start, changes)

    def setUp(self):
        super().setUp()
        self.replace_assembly([(row['path'], correction_bytes(CORRECTION_NEW, row['path'], row['assembly_blob'])) for row in CORRECTION_LISTING])
        self.evidence_body['test_adaptations'] = copy.deepcopy(CORRECTION_LISTING)

    def test_exact_helper_and_new_contract_adaptations(self):
        self.trained(self.host(), self.candidate(), self.merged, self.github)
        measured = self.evidence_of('02-release')['record']['measurements']['train']['base_move']
        body = b.document(measured['evidence'])
        self.assertEqual(body['test_adaptations'], CORRECTION_LISTING)
        self.assertFalse(measured['source_observed']['passed'])

    def test_new_contract_requires_explicit_absent_source(self):
        self.evidence_body['test_adaptations'][1]['source_blob'] = '0' * 40
        self.refuse('reviewed blobs differ')

    def test_unlisted_added_contract_refuses(self):
        self.evidence_body['test_adaptations'].pop()
        self.refuse('scope widening')

    def test_wrong_diagnostic_helper_bytes_refuse(self):
        row = CORRECTION_LISTING[0]
        self.replace_assembly([(row['path'], '// unreviewed helper\n')])
        self.refuse('Git entry differs')

    def test_product_with_reviewed_helper_bytes_refuses(self):
        row = self.evidence_body['test_adaptations'][0]
        raw = correction_bytes(CORRECTION_NEW, row['path'], row['assembly_blob'])
        self.replace_assembly([('web/helper.mjs', raw)])
        row['path'] = 'web/helper.mjs'
        self.refuse('unsupported test adaptation path')

    def test_unlisted_product_beside_exact_addendum_refuses(self):
        self.replace_assembly([('web/extra.mjs', '// not authorized\n')])
        self.refuse('scope widening')

    def test_reviewed_reason_is_exact(self):
        self.evidence_body['test_adaptations'][0]['reason'] += ' extra'
        self.refuse('reason differs')

    def test_new_contract_requires_regular_mode(self):
        self.git(self.work, 'checkout', '-q', '--detach', self.assembly)
        self.git(self.work, 'update-index', '--chmod=+x', CORRECTION_LISTING[1]['path'])
        self.replace_assembly([])
        self.refuse('Git entry differs')

    def test_candidate_cannot_authorize_changed_helper_bytes(self):
        row = self.evidence_body['test_adaptations'][0]
        self.replace_assembly([(row['path'], '// unreviewed diagnostic helper\n')])
        row['assembly_blob'] = self.git(self.work, 'rev-parse', self.assembly + ':' + row['path'])
        self.refuse('reviewed blobs differ')

    def test_malformed_path_refuses(self):
        self.evidence_body['test_adaptations'][0]['path'] = []
        self.refuse('unsupported test adaptation path')
