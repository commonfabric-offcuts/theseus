# 1089 — Reading fixture runtime restoration

## Source and scope

The actual intake is release341, `aec1b5589bb26fa34ebdc0708b77c7a4bccf1f6f`, schema65. Work lives on Page5's own `page-lane5/1089-reading-fixture-teardown-341` branch. Warp17330/Fable17332 explicitly supply approved1083 `c8fdc98f718ef0680aa97e534e50d9a87ec441fe` as the source baseline for the two normal reading callers. Their bodyCompleted, bodyError and teardownError declarations, body catch/sidecar and result fields remain intact. The341 fixture is byte-equal at that1083 head. The original intake and explicit caller dependency are retained separately in the source maps; no new live intake or deployment is inferred.

This piece changes only test fixtures, caller evidence wiring, tests and this contract. It does not change shipped web/Core/schema/runner/installation code. The separate1074/1093 correction and1090's wider reading failures remain outside it. The initial contracts and all later dispositions are retained with the proof, beginning at17321, revised17328/17331.

## Owned cleanup

`tests/fixtures/ui_http.py` owns restoration when stdin reaches EOF or its requesting test aborts before explicit restoration. Each actual server retains its own candidate Build/CSP, including stopped/restarted servers.650 first unwinds its exact saved owner; the fixture then restores each owned public Build/CSP and clears721/785 phase bookkeeping before their legacy close checks.645,650,674,721,731,738,783 and optional785 are covered. Needing restoration is an observation, never a test failure by itself.

The fixture attempts remaining independent restoration, control and HTTP cleanup stages after a failure. Actual restoration, cleanup or evidence-write errors remain nonzero with full stderr tracebacks. An original fixture exception propagates, with cleanup errors separately retained; a clean fixture does not rewrite the requesting test's original failure or return code. Control refusals already returned to a requester remain in that response. Cleanup completion is recorded after the fixture's TemporaryDirectory exits. SIGKILL or interruption before resource ownership is established is outside this finally contract.

## Retained observations

Both `tests/reader_persistence_native.mjs` and `tests/webkit_native.mjs` automatically pass `--teardown-observations <evidencePath>/fixture-teardown.jsonl` for normal `--reading` runs after creating the evidence directory. The fixture creates that file exclusively, refusing existing proof, and writes flushed JSONL stage/restoration observations there. It is outside the disposable fixture root. No unsolicited control stdout or success stderr is introduced.

A restoration observation names its owner, need, before/after Build stamp/source hashes/CSP hash, expected hashes and runtime selections. The final cleanup record retains errors and any fixture exception. The callers' shared `fixture_teardown_evidence.mjs` reader retains the raw file and adds `fixtureTeardown` with filename, SHA256, parsed records and explicit errors to native.json. Missing, malformed, truncated or incomplete required proof produces a nonzero caller result after the original report fields are written. The raw sidecar survives a later native.json write failure. Its records never become passing product cases or synthesize1079 body completion.

## Checks and retained failures

The focused Python suite has17 passing tests: actual applied runtime swaps followed by a requesting child that really exits1; exact Build/CSP restoration and fixture exit0; no-swap/explicit restore; stopped/restarted servers; nested650; pre-existing/unwritable observation paths; and applied restore-verification plus HTTP-close faults alongside a real malformed-input body error. Original body errors, fixture stdout/stderr/EOF/exit and owned cleanup remain separate. The shared Node evidence/protocol suite has20 passing tests. Both normal callers pass Node syntax checks, and exact1083 protected source passages are retained/read back.

Red-first on untouched341 failed all three named645/650/783 abort cases. Applying the entire exact old341 fixture owner later makes all eight runtime-abort cases fail; restoring exact fixed bytes returns the focused17 to green. Unique effective Python cache prefixes, applied/restored hashes, raw commands/exits, selected input/source bodies/maps and every failed phase remain in `artifacts/1089` and the published packet.

The existing22-test freshness/restart/650 cohort retains five failures. The old fixture's corresponding20-test unchanged subset has the exact same five names and assertion payloads: three REPLY_PASSAGE_REQUIRED cases, one ASK_WAIT_REQUIRED case and one PERSON_TOPIC case. The two additional restart cases pass under the new EOF contract. These five failures are unwaived and unchanged; no broader all-green claim is made and their assertions were not weakened. The packet retains the comparison. An initial traceback-oracle mistake, an unquoted shell-pattern refusal and a prelaunch load>12 refusal also remain, distinct from product reds.

## Limits and delivery

The final packet names exact source HEAD/tree, per-file bodies and test phases. Runs precede the source commit; the later body/hash join is explicit, with selected declared inputs rather than exhaustive loaded-runtime closure. No browser, native gesture, physical device, performance or full reading-suite execution is claimed. The two full browser callers were source/syntax checked; the shared evidence function is checked below the browser and against real fixture output. Earlier legacy freshness cases waited for their fixture exits but did not retain every historical TCP address; focused drivers retain PID/TCP cleanup observations and the final process scan is separate.

The shared fixture workload was accepted at17384 from Page6's actual clean17381 release, after source-only preparation. A load13.27/18 final launch was refused; it ran later below12. Product/test source stays fixed once meaningful proof is green. Page5 pushes only its exact own branch and supplies the source/test packet for Warp's independent read and Fable's canonical freeze/carry; no Page5 installation or stage transition is included. Tony owns Done.
