# Pipeline 719: retargeted Verdict bases

The controller keeps the triggering run and event PR metadata unchanged. Shards
still nominate one tested merge, and Git must authenticate its ordered parents,
tree, independent rebuild, source code and reachability on the approved branch.
The original receipt base and `base_at_run` remain separate observations; neither
is replaced by the current PR base.

For a PR judgment the controller also reads the current PR from GitHub. It must
be open, in this repository, for the same number and head, on the already
authenticated approved base ref. Its base commit must still be that branch's
fetched head. Git must read both base commits and their trees. The tested first
parent and current base must have identical trees, including when their commit
identities differ. Missing, unreadable or different trees refuse. Existing
ancestry and stale-head checks remain required.

The protected producer handshake adds `receipt_base`, `base_at_run` and
`base_comparison`: original receipt observations, plus authenticated at-run
commit/tree and current PR number/head/ref/commit/tree. The validator requires
the complete comparison, checks its shape and bindings, and rereads Git trees.
The published receipt names both commits and both trees. A receipt's original
branch name is an observation, not a claim that GitHub still serves that branch.

This is source tooling only. Independent review and coordinator installation on
the default branch precede first use. No deployment gate changes; installed
`cfcb163d` remains authoritative. A source test is no first-landing proof.
