# Frozen migration test source (1105)

Base: actual353, 488381d2de0becb68d2adab48f02bf9862b516ea, schema66.
Fable17918/17922; piece p-cfad9ac8cb8749f28a4a89ef, Now/Build1.
Core8 owns this source slice; Fable stages and Warp reviews/carries/lands.

The existing freeze CLI reads ancestry and the no-renames changed-path diff.
It will also read each changed `tests/**/*.py` file from the exact head's
Git tree/blob, never the working copy. Missing head paths represent deletions;
symlinks, non-blobs, unreadable, non-UTF-8 or unparseable Python refuse.
Candidate source is parsed as data, never imported or executed.

`pipeline.freeze` gains optional `test_sources`, a mapping of exactly those
changed Python-test paths to their UTF-8 bodies (or null for deleted paths).
It is required when those paths exist, and empty/omitted otherwise. Defaults:
256 KiB per body and 1 MiB total UTF-8; oversized bodies refuse. Core validates
coverage/bounds and the inert AST after existing authority/revision/path checks,
before no-op or any freeze/piece/pipeline mutation. No Git runs in Core's
transaction. `MIGRATION_TEST_LITERAL` names the file and 1-based line and says
use `next(step for step in STEPS if step[2] is X_SCHEMA)` for a step and
`STEPS[-1][1]` for latest. Malformed source/coverage uses INVALID_ARGUMENT.
Core's immutable operation fingerprint binds the exact supplied bodies for
replay; Core retains the fingerprint and receipt, not the source bodies. The
original request bodies remain in the CLI's durable outbox. The existing
freeze row/view still names base/head/files/classification.
As with the existing path binder, the authorized producer is trusted to bind
its supplied source to Git: Core cannot authenticate an external repository.

Recognized direct literal forms (decimal version strings, including historic
versions in changed files):
- `migrate(path, instance, binding, "66")` or `target="66"`, including imported
  aliases and attribute `.migrate` calls.
- SQL UPDATE/INSERT/REPLACE into metadata's schema_version with inline quoted
  numeric value or literal numeric bound parameters; metadata dict/attribute
  schema_version assignments or update calls with a numeric string.
- assertEqual/assertSequenceEqual/assertTupleEqual/assertListEqual or Python
  assert comparisons between a `step`/`STEPS` expression and a two-element
  numeric string tuple/list, e.g. `step[:2]` versus `("65", "66")`.

The rule inspects whole changed files, not only added lines. Unchanged tests
(including pre64 historical suites) and deleted bodies are not scanned.
Token-derived `step[0]`/`step[1]`, latest `STEPS[-1][1]`, SCHEMA_VERSION,
omitted migrate target, comments/docstrings, ordinary numeric tuples and
SELECT assertions remain valid. No exception permits a literal downgrade in
a changed file: use the relevant token's prior step. This is a bounded syntax
check, not whole-program dataflow: dynamic SQL/string assembly, variable
indirection, wrappers and arbitrary aliases are outside its guarantee.
No legacy-suite rewrite or schema/runtime/controller/installed-guard change.

Checks use isolated Git repositories/profiles/stores only. Real CLI-to-Core
bad-head refusal must precede any freeze/version mutation; a good working copy
cannot mask a bad head and a bad working copy cannot taint a good head.
Check all named syntax, file/line guidance, token/latest/default successes,
unchanged historical/deleted/renamed paths, malformed coverage/source/bounds,
existing authority/stale/approved/no-op/replay behavior and shared views.
Retain actual353 red, corrected green, whole relevant original product owners
applied red and exact restored green, with direct exits, unique caches, full
source maps and cleanup. No browser/HTTP/native workload; Page5 owns1075.
Final changed paths/classifier determine JUDGED; no approval inferred here.
