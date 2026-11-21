# A focused long card shows its whole source (636)

Warp13751 delegates636 on release220,
`73d3c2b34da8b6d69e1d541833ebd7be88cee189`. The reported symptom is a long
message with two fenced blocks and a long gap remaining clipped after its
card is focused, with no `data-whole="shown"`, in both engines. The historical
failure is evidence of the symptom, not proof of a current cause.

The pre-change check observes the actual focus path, source read/response
and card/preview geometry. `CardScroll.expand` returns without painting
after a failed source read or a hidden preview; the evidence below
distinguishes these paths before a product edit.

The bounded native reproduction uses the reported two-block body on220 in
isolated HTTP/Core records, with short and one-block messages as controls.
Focus, source response, whole-state and geometry evidence stay with a failure.
The fix must let the person read the complete body in the current card while
preserving explicit Show full, held presses, copy-button focus, revisions,
retired cards and surrounding scroll position. No retry may read a retired
topic or paint an obsolete revision. The source's denied-topic release hold
is a separate historical problem and is not resumed here.

On unchanged220 the normal matrix passed24/24. Brief real background-lane
congestion recovered2/2; keeping that lane occupied produced the reported
10-second clipped-card timeout in both engines, with trusted focus, a visible
506px preview, and a real503 SERVER_BUSY source response. This establishes a
current failure mechanism, not attribution of the historical intermittent
runs. The count of fences is not a read-admission rule.

Ordinary expansion retains its background read. A typed busy refusal gets
one foreground attempt only while the same connected, visible, unchanged
card still owns keyboard focus. There is no timer or broader refresh.
Retired cards, changed revisions, authority/permission refusals, and hover
without focus do not trigger that attempt. If foreground also fails, the
excerpt remains and explicit Show full is still available.

Native browser checks use isolated headless Chrome for Testing and WebKit,
one owned workload at a time, with verified browser/fixture/profile/process/
port cleanup. No fake-DOM timing or physical-device claim. The exact failure
and restored controls precede freeze; Fable owns pipeline stages and Warp
owns current carry/landing.

## Checks and limits

`tests/ui_card_scroll.test.mjs` has two meaningful baseline failures after a
fixture-only missing `ownerDocument` correction (the initial four setup
errors are retained separately). It checks focused recovery, a second busy
refusal, focus loss, retirement, hidden preview, edited epoch, permission and
authority refusals, and unfocused hover. The seven-file affected Node cohort
passes128/128, including existing Show full, source identity/revision,
message-menu, press-hold, formatting and freshness checks.

Final candidate phases pass28/28 normal cells (24 original-shaped reply and
negative controls, four standalone-root controls),16/16 occupied-background
cells (12 reply/negative controls and four roots), and2/2 restored mutation
controls. All final phases have zero page errors. Browser.close, identified
owned PID/profile absence and fixture EOF0/PID/port cleanup pass each phase;
profile directories from the initial diagnostic runs were removed separately
after confirming their processes absent. No workload remains at freeze.

`tests/focused_long_card_636_native.mjs` uses real isolated HTTP/Core records,
real browser focus and the server's actual background admission lane. A
fixture-owned request holds that lane at its callback; no response is
fabricated. Long one/two-fence controls finish via background503 then
foreground200 before the hold is released. Short controls need no source
read. The standalone agent-root controls complement the original reply
matrix. Phone widths are touch-enabled desktop engines; physical devices
and native finger gestures are not claimed.

The actual routing mutation changes only the recovery call from foreground
to background. Both engines then time out with two real background503s.
Restoring the file byte for byte restores both cases. The product file's
restored SHA256 is
`c5156f5195091c61e6f572b32dd67d370423c2e9a62d7693d035f511871f171f`.
Raw phase results, commands, cleanup and mutation receipts are retained in
`/Users/commonfabric/aim-worktrees/core-lane7-636-evidence`.

Run with `AIM_PLAYWRIGHT_CORE` pointing to Playwright1.63.0's `index.mjs` and
`AIM_CHROME` to Chrome for Testing156. The first argument is a fresh evidence
directory; the optional second argument filters case names. Set
`AIM_636_CONGESTED=1` for occupied-background cases. Normal defaults cover
two-fence replies at320/375/390/1280 light/dark, short and one-fence controls
at1280 light/dark, and standalone two-fence roots at1280 light/dark, in both
engines. Congestion defaults cover short/one/two/root at390/1280 light in
both engines. No test reads or writes live records.
