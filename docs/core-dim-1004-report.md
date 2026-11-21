# Keep Dim in Core (1004):15008 correction report

Source base is approved757 `e6049706c764285e89442b34e01dedb61687db2d`;
returned parent `51cc05d74ef6bfa3daed7f1bfe01e925f23dc01e` on the same owned
branch `page-lane5/1004-core-dim-757345`. Exact corrected HEAD/tree and raw bundle
are published under Warp15008 in the existing1004 topic. Current tested schema
is63, with no slot reservation: Warp15019/Fable15021 may require one rebase onto
approved1002 for64. No stage, runtime, installer, live record or operator route
was changed by Page5.

## Required corrections

1. The757 migration fixture's first post61 upgrade and idempotent repeat now use
   SCHEMA_VERSION before comparing against the fresh latest layout/reading under
   current code. Its literal61 predecessor layout/metadata/read-refusal and exact
   record/backfill/manual-wait assertions remain. Its distinct injected failed
   61→62 rollback test still targets62, exactly as owner15011/15020 specifies.
2. A bounded optional candidate on the existing actor-only preference view prunes
   unreadable973 places through the same indexed permission helper before import.
   Saved Core wins. This is the explicit new Core read/validation delta for review;
   command, table and migration bytes are unchanged from51cc05d7. No unrelated
   lists/history or per-ID request cascade. The exact legacy key is retired after
   import/current Core authority, so later loads do not retry the stale copy.
3. The filtered import is prepended before semantic clicks retained during the
   initial read. Immediate paint remains; the initial read cannot erase the old
   set or the newer click. Native tests hold the actual HTTP read while clicking.
4. Malformed/foreign-version writer rows and invalid snapshots are preserved,
   individually unlocked and skipped. A damaged row cannot poison valid writers.
5. Successful journal save clears journalError; later pending edits no longer
   display the old quota/failure status.
6. Equal/older Dim change versions skip the preference view and repaint; newer
   device revisions still refresh. Commit-only Live still requires the bounded
   actor change page to learn the version. No extra preference read follows a
   known own echo. Unchanged presentation suppresses painter callbacks as well.

The earlier14994 wiring correction remains: no re-export in rail-dimming; the
sole state-name consumer imports dim-choices directly. No inliner/assertion was
weakened. Optional old-intent aging was not invented: retained intents have no
expiry, and an inverse may replace a newer choice after recovery. Storage/Web
Locks and the existing2MiB envelope bound remain explicit limits.

## Measured checks

- `test_rail_dimming_1004.py`:12/12, including the new read-only filtered candidate,
  actor privacy/permissions/revocation, shape/limits, exact retry/conflict/race,
  current authority, absence versus saved empty, migration/downgrade refusal.
- `test_source_item_cover_migration_757.py`:2/2, with the actual first-method red
  retained before the latest-version correction and the failed-step control green.
- `ui_dimming_core_1004.test.mjs`:22/22; with973/902,58/58. Five new15008 cases
  first failed independently, then pass after the owner fixes. Realistic bootstrap
  authority display metadata is retained while envelope authority uses its pair.
- Eleven affected Node files:658/669 versus636/647 on exact approved757. Both have
  the same11 failures, and every full normalized diagnostic/traceback frame is
  equal after source-root/per-test-duration normalization only. These are the ten
  existing wiring-canary failures and the existing844 incomplete fake OutlineRail.
  All22 added cases pass. No broad-green or waived-assertion claim.
- Six actually applied candidate-permission, import/click-order, malformed-row,
  error-recovery, known-revision and legacy-retirement mutants each fail their
  intended check. Exact source bytes restored; unique Python cache per Core
  mutation/control;12/12 and58/58 restored controls pass. Raw hashes/logs retained.
- Fresh current-source native matrices:32/32,16 each in Chromium156.0.8078.47 and
  WebKit26.6 at1280/390/375/320 × Bookends/Paper × light/dark, using real Core/HTTP/
  Live and independently stored device contexts. Both engines prove mixed-readable
  legacy pruning and exact973 retirement, native click during a held first Core
  read, cross-device Dim/inverse, committed-but-lost answer, full tab close/reopen
  and exact original operation retry without another revision. All five served
  client hashes match corrected product bytes. These matrices use shipping63.
- Every native run verifies Browser.close, all observed owned PIDs absent, no
  profile processes, disposable profile removed, fixture EOF/exit0/absence and
  closed port. No owned browser/workload remains after cleanup. Phone targets
  and unchanged native-click URL are checked. No physical-device, IME or latency
  claim. Some scratch captures may show generic page freshness notices under the
  fixed two-read fixture/intentional loss; whole-page freshness is not this check.

Previous8dad/51cc evidence stays labeled by its actual source. Earlier raw privacy/
revision/downgrade/exact-request mutation evidence, the96-table actual approved62
upgrade/ledger preservation proof and the26/26 Store/outline-order cohort remain
carried unchanged behavior evidence. The new bounded read adapter gets the
specific candidate/privacy check above rather than a claim that all Core bytes
stayed identical. Original32-cell component-stamp62 data is not relabeled current.

## Defaults and reproducibility

Absent row is Dim0/empty/rev0; only valid973 imports at0, existing Core wins and
explicit empty save creates1. Backend owns2048 outcome/topic exceptions per set
within2MiB. Independently locked durable pending writers preserve exact unknown
requests. Storage refusal keeps an honest unkept choice and blocks publication;
malformed/future rows and old-authority uncertain operations remain preserved.
Transient admission backoff is at most100/200/400ms, with no idle polling.

CPython3.9: use a unique `-X pycache_prefix=ABS` and unittest discovery for each
of the two named Python files. Node: run the three focused modules above; the
raw cohort log records all eleven comparison inputs. Native: set
AIM_PLAYWRIGHT_CORE to Playwright1.63.0's index.mjs, AIM_CHROME to Chrome for
Testing, and run `node tests/dimming_core_1004_native.mjs ABS_OUTPUT green`.
WebKit uses AIM_ENGINE=webkit and its PLAYWRIGHT_BROWSERS_PATH. The driver creates
its own synthetic Core fixture/profile/port and checks actual load below12.
No fixture writes are attributed to real users. No live data or Tony browser.

Return the corrected exact source to the existing15008 review. Fable retains
stages, actual-live carry preserving1003/1005/1006 and judged landing. No independent
approval or installation is claimed here.
