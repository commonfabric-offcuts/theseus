"""The landing's decisions that read only values, so each is tested without a board, a clone or a deploy (1196)."""
import datetime


def clock(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime('%-I:%M %p')


def carry_refusal(spec, source_parents):
    """Why the head this landing merges is not the head its review was written of, or None.

    The review describes one head (SPEC review_head), which must be the approved head. The landing merges SOURCE: that
    head itself, when live is already in it, or the carry carry_ordinary.sh makes, the merge of live (BASE) into it."""
    approved, reviewed, source, base = spec.get('approved_head'), spec.get('review_head'), spec.get('source'), spec.get('base')
    if not reviewed:
        return 'SPEC.json names no review_head, the head its review was written of'
    if reviewed != approved:
        return 'the review was written of %s, but the approved head is %s' % (reviewed[:8], (approved or '')[:8])
    if source == approved:
        return None
    if list(source_parents) != [approved, base]:
        return 'the carry %s is not live %s merged into the reviewed head %s; its parents are %s' % (
            (source or '')[:8], (base or '')[:8], approved[:8], ' '.join(p[:8] for p in source_parents) or 'none')
    return None


def proof(spec, piece, carry_read=None):
    """The landing's proof clause for the dossier, or raises ValueError with why there is none.

    A piece is frozen at the lane's approved head (approved in Review after the freeze) or, carried onto live, at the
    carry head, which the landing seat read in the lane's worktree before the carry and fable froze before the landing.
    A piece that may not be frozen (one changing tests/test_migrations.py) is proved instead by fable's read of the
    exact carry head: carry_read is that message as the board returns it, or None when SPEC names none."""
    freeze, approved = piece.get('freeze') or {}, piece.get('approval') or {}
    landed = spec.get('carry') or spec['approved_head']
    if not freeze.get('head_commit') and 'carry_read' in spec:
        if not carry_read:
            raise ValueError('fable\'s read named in SPEC.json carry_read is not on the board')
        if carry_read.get('author_id') != 'fable' or landed not in (carry_read.get('body') or ''):
            raise ValueError('message %s is not fable\'s read of the carry %s' % (carry_read.get('id'), landed))
        return "the builder's own proof, read in its worktree before the carry; the carry read by fable at %s, with no freeze (%s)" % (
            clock(carry_read['sent_ms']), spec['carry_read'].get('why') or 'a piece that may not be frozen')
    if freeze.get('head_commit') not in (spec['approved_head'], landed):
        raise ValueError('piece %s is frozen at %s, not the landing head %s' % (spec['piece'], freeze.get('head_commit'), landed))
    if not isinstance(freeze.get('at_ms'), int):
        raise ValueError('piece %s has no freeze time' % spec['piece'])
    if freeze['head_commit'] == spec['approved_head']:
        if not (isinstance(approved.get('at_ms'), int) and approved['at_ms'] >= freeze['at_ms']):
            raise ValueError('piece %s has no approval given after its freeze' % spec['piece'])
        return "the builder's own proof, read and approved in Review at %s" % clock(approved['at_ms'])
    return "the builder's own proof, read in its worktree before the carry; the carry frozen by %s at %s" % (
        freeze.get('by') or 'fable', clock(freeze['at_ms']))
