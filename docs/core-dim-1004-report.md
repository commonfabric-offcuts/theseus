# Keep Dim in Core (1004): freeze report

Base: approved757 `e6049706c764285e89442b34e01dedb61687db2d`, schema62.
Owner branch: `page-lane5/1004-core-dim-757345`. Freeze HEAD/tree and the
raw evidence archive are named in the existing1004 topic. Schema62→63 is
1004's first green successor under Warp14954/Fable14956; no predecessor was
renumbered. Fable owns pipeline stages and actual-live carry/deploy.

## Result and defaults

Dim0/1/2 and both editable sets/inverse focus now belong to the authenticated
actor's Core record. Other devices observe targeted actor changes. Existing
973 controls/painter remain; the exact already-shipped1003 waiting override
and its two corresponding assertions are retained while composing on older757.
OutlineRail only passes its existing runtime handles to the Dim owner.

Absent Core record: Dim0, two empty sets, revision0. Only a valid973 cache may
import at revision0. Existing Core wins, including an explicit saved empty
preference (revision1). Bounds:2048 outcomes and2048 topics per set from Core
capabilities/bootstrap, within the existing2MiB UTF-8 command-envelope bound.
IDs/booleans/shape, duplicates, current read permissions and outcome/topic
binding are validated. Actor-private indexed lookup; no unrelated history read.

Immediate paint keeps semantic intents and exact prepared envelopes in durable,
independently locked localStorage writer records. Recovery claims abandoned
writers, adopts the largest existing row (avoiding a second full copy near quota),
keeps the merged snapshot before removing exact source keys and deduplicates
stable IDs. Unknown answers keep exact requests; known validation refusals may
be final before a ledger record and roll back only their batch. Late results
cannot erase newer edits. Conflicts replay absolute edits over current Core.

Cache/journal scope includes instance, actor and authority ID/epoch. A restored
replacement authority may have a lower revision: its record wins; old uncertain
operations remain intact in their original namespace and are not republished.
Storage/Web Locks refusal leaves an honest unsaved document choice and blocks
unkept publication. There is no session-only durability promise or automatic
old-authority journal deletion. Transient admission failures have at most three
failure-driven100/200/400ms retries; explicit Retry/focus/online can resume later.
There is no idle polling timer. Foreground edits skip initialized background reads.

## Evidence

- `tests/test_rail_dimming_1004.py`:11/11, final restored shipping63 control.
  Actor privacy, permissions/revocation, strict bounds/capability owner, both
  sets, absence versus explicit empty, exact retry/no-op/conflict, simultaneous
  devices, revision/authority fences, migration roundtrip/no auto-upgrade,
  preservation of ordinary records and occupied downgrade refusal.
- `tests/ui_dimming_core_1004.test.mjs`:17/17. Independent devices/cache owners,
  import/Core precedence, semantic conflicts, late success/refusal, unknown
  exact retry, separate durable writers, interrupted transfer and quota,
  crash after receipt before cleanup, replacement authority, typed admission
  backoff/no idle polling, malformed capabilities/receipts and unrecorded
  definitive validation refusal. With973/902:53/53.
- Core affected `test_store.py` + `test_outline_order.py`:26/26.
- Affected client cohort:168/169 versus approved757151/152. The only failure
  is the existing844 fake OutlineRail fixture without `dimming.bind`; complete
  normalized diagnostic and every stack frame match, with only source-root and
  duration normalization. All17new tests pass. No assertion weakened or broad
  green claimed; raw base/head logs and exact comparison JSON retained.
- Real approved757 source initialized the isolated schema62 upgrade fixture.
  Actual migration to63 preserves all96 pre-existing tables and the exact
  workspace command ledger receipt; repeat migrate is a no-op. Saved empty Dim
  creates revision1 and atomically refuses downgrade with `RECORDS_WOULD_BE_LOST`.
  New code refuses old stamp until explicit migrate. No live account data.
- Applied actor-isolation, revision-fence, occupied-downgrade and exact-request
  mutations each fail their intended checks; source bytes restored exactly,
  unique Python caches per mutation/restored control,11/11 and53/53 controls green.
- `tests/dimming_core_1004_native.mjs`:32/32 final cells,16 per engine at
  1280/390/375/320 × Bookends/Paper × light/dark. Each uses real Core/HTTP/Live,
  independent device contexts without copied legacy storage, native modifier
  clicks/inverse and phone taps, cross-device changes, committed-but-lost answer,
  full tab close/reopen and exact retry without another Core revision. All five
  served client hashes match the freeze bytes. Final matrix fresh component
  Store had stamp62 with identical Dim product code; shipping63 additionally
  passed an integrated native smoke after stamp/step registration (1/1).
- All browser runs, including retained failed diagnostics, confirm Browser.close,
  every observed owned PID absent, no profile processes, disposable profile
  removed, fixture EOF/exit0/absence and port closed. No browser remains.

The native checks assert Dim state/Core receipts, target sizes, unchanged URL,
served bytes and browser cleanup. They make no physical-device/IME or latency
claim. Some captures show the app's generic Updates delayed notice under the
fixed two-read scratch fixture and intentional transport loss; clearing that
separate page-wide freshness notice is not measured by these Dim checks.
Final phone/laptop captures in both looks were inspected. Earlier real native
failures exposed missing view instance metadata, fixture Live enablement and
bounded read-admission recovery; all were corrected and retained as raw evidence.

## Reproduce

CPython3.9: `python3 -X pycache_prefix=UNIQUE -m unittest discover -s tests -p test_rail_dimming_1004.py`.
Node: `node --test tests/ui_dimming_core_1004.test.mjs tests/ui_rail_dimming_973.test.mjs tests/ui_outline_disclosure_902.test.mjs`.
Native: set `AIM_PLAYWRIGHT_CORE` to Playwright1.63.0's index.mjs, set
`AIM_CHROME` to Chrome for Testing, and run
`node tests/dimming_core_1004_native.mjs ABS_ARTIFACT_DIR green`.
For WebKit set `AIM_ENGINE=webkit` and its `PLAYWRIGHT_BROWSERS_PATH`.
The driver creates only its own scratch Core/HTTP fixture/profile/port and
refuses launch while one-minute load exceeds12. Under Warp14985, other seats
may run their own isolated work concurrently; no exclusive browser slot exists.

1005/1006 and other ordinary live changes remain required on actual-live carry.
This source is not an installation, an independent approval or Tony acceptance.

Actual browser versions: chromium 156.0.8078.47, webkit 26.6.
