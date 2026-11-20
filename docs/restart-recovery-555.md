# A page loading across a restart (555)

Start from release 210, `9808c5171eaeea5ab1bcd0b4bd9ec34e6d20849a`.
Keep the recovery already added with 523 in `47462838e` and the immutable
stamped assets added with 904. The current 555 record has no prior piece or
named branch; its source is Warp's review 5669.

A document whose modules fail before the application runs must recover on
one complete build. Its inline boot runs before stylesheets and modules,
without needing a request. When a failed stamped module belongs to an old
build, a read of the served build causes one fresh load. If the server is
away, refuses the read, or still serves the same build, the page says
“Theseus could not open this page.” with a Reload button. It does not reload
repeatedly. A slow successful load on the same build reads no build and
reloads no extra time. No application has run at this point; retained writing
is left for the normal next load to recover.

Keep `/b/<stamp>/` immutable only for successful assets from that stamp;
index, build reads and refusals stay uncached. Do not serve a different
build's modules under the document's old stamp.

Verify the existing `tests/test_web_build.py` and `tests/ui_boot.test.mjs`,
then the three focused `reading edit build a page` native cases in
`tests/message_edit_native.mjs`. Those cases use a scratch server and records,
hold actual module requests across a restart, and exercise laptop and phone
Reload. Retain an applied recovery-removal failure and its restored control.
Change product code only if the current recovery fails this contract.

## Result on release 210

The product already meets the contract. No product bytes changed. Three
test fixture repairs make the existing native cases executable today:

- Remove a fourth dot from the reader runner's source-list spread. The old
  runner stopped with a syntax error before launching a browser.
- Seed these three plain messages as the scratch person with `message.post`.
  Their purpose is to appear on the page during loading. An agent opening a
  new dossier now requires explicit divergence information; the old seed
  failed admission before reaching the browser action.
- Disable Chrome's network cache for the held-module phase. The initial
  successful `open()` warmed 904's immutable assets, so the old reload never
  issued the entry request that the case waited to hold. This phase models
  a cold module graph. WebKit keeps its existing routed request path.

All existing assertions and case names are retained. Six Python build/server
checks, five Node boot checks and the three focused native cases pass.
The native cases cover old index/new server, lost own-build modules, no
server, Reload by pointer/touch and a successful slow load on one build.

An applied replacement of `web/boot.js` with a nonempty comment reproduced
the missing recovery after the server changed builds: the page stayed
unready with an empty status and no build read. The original bytes were
restored in `finally`; the restored three-case control passed. This mutation
is evidence for the checks, not a claim that release 210 has that defect.

Raw logs and the ownership observer are in
`/Users/commonfabric/.local/share/theseus/core-lane8/evidence/555`:
`web-build.txt`, `boot.txt`, `red-removal` (syntax failure),
`red-recovery-removal02` (seed refusal), `red-recovery-removal03` and
`restored-green01` (cached-request hold failure), `red-recovery-removal04`
(actual recovery-removal red), and `restored-green02` (3/3 restored).
Each launched browser reports `Browser.close`, fixture EOF exit 0 and empty
teardown failures; each ownership record confirms no remaining owned
profile process or child PID and no listening fixture/debug port.

Run the focused browser checks from this worktree with an isolated Chrome
for Testing executable and an absolute scratch evidence directory:

```sh
node tests/reader_persistence_native.mjs "$AIM_CHROME" "$AIM_EVIDENCE" \
  --reading 'reading edit build a page (whose modules|on one build)'
```

Native verification here is Chrome for Testing only. The WebKit path is
preserved but was not run; these local checks make no production timing
claim. Fable owns item bookkeeping and landing of this test-only change.
