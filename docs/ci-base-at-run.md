# The base used to build a pull request's tested merge

The producer preserves `base` as the GitHub event's base ref and SHA. Beside
it, a PR shard records `base_at_run: {ref, sha}`, where `sha` is `HEAD^1` read
from Git in that shard's tested checkout. This is the base used to build the
merge, which can be newer than the PR event's base. Push receipts use null.
The combined provenance carries that same value and refuses disagreeing shards.
Key presence is part of the format: new push receipts explicitly carry null
in every shard and in combined provenance. An all-legacy replay preserves
absence throughout. Mixing absence and null refuses. PR observations require
an actual forty-hex-digit Git first parent before they can be written.

This receipt is data, not authorization. The protected controller fetches the
exact tested merge, verifies its head, parents and tree, rebuilds the merge, and
checks the tested base is a commit reached by the authenticated base branch.
It compares the candidate against that tested base, while independently
binding the original event-base metadata. A first parent outside the base
branch must refuse, even if every producer receipt claims it.

Older receipts already record the Git-read first parent in `merge`. A
controller can read that legacy representation with the same independent Git
checks; it must never invent a `base_at_run` observation in an older archive.

The producer change lands through its own premerge judgment first. The
controller consumer follows it; the old controller can ignore the additive
field while continuing its existing base check.
