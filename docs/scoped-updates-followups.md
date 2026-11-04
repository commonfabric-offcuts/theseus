# Scoped-update review follow-ups

This records the remaining limits from Fable's review of
`3270cbeeba4b01ad6305cf16616f80e60d992627` (AIM `m-9d8865cf`, 2026-11-04).
It is a follow-up list, not a claim that the release is installed. The release
receipt identifies the published revision and corrections actually verified.

The final review requires five corrections before release: resync access-loss
handling, working stopped-state Refresh, a visible stop on binding mismatch,
retry classification for uncoded server errors, and early startup-list refusal
validation. The accepted correction specification is revision 04, reviewed in
`m-f4a35091`. Those requirements supersede earlier per-dimension severity labels.

## Recovery and access

- A failed attempt to open another source can overlap Retry access and leave
  that action disabled. Retry access can also move focus away from writing
  started while the check was pending.
- The update notice and its actions are outside the modal reader. Close the
  reader to inspect them. A runtime authority change requires explicit review
  of saved writing; reconnect through the browser's Reload after that review.
  This increment does not automatically restart freshness after adoption.
- Following actual topic regrant, a stale “Topic updates remain paused” label
  or hidden More control can remain. Source-only Retry access intentionally
  does not restore topic access or restart topic updates.
- Source refusal hides the source body and media, but a Notebook title may
  remain visible. A restored source can retain an obsolete unavailable heading.
- An old page or manual-mode page can retain a dead HTTP session after a server
  restart. Browser Reload obtains the new session; its in-page Refresh cannot.
  Preserve writing and honor the unload protection. Never clear the journal.

## Work and presentation bounds

- A persistently failing dirty resource can block other dirty resources.
  Confirmed submission receipts restored from an older runtime can also supply
  an unreachable topic-version target. Filtering local effects by current
  authority and bounding independent-resource progress are follow-up work.
- Fetch work is scoped, but painting repeatedly searches the loaded card list.
  Its cost can grow quadratically with loaded history. The 1,000/10,000-record
  measurements cover **unrelated history**, not an equally large loaded view.
- New replies can land above the viewport while the reader is at the top of
  the topic page. Automatic arrival does not yet guarantee that every new card
  is visible without scrolling.
- The fixed foreground/background read partition does not preempt an active
  Store callback or guarantee latency
  under slow storage or overload. See [measured costs](scoped-updates.md).

## Evidence qualifications

The original native resync-authority ordering assertion can pass when the
expected event is absent, and its bootstrap observations can include cleanup
reads. It does not independently prove that specific ordering. Some original
“healthy again” waits also accept a deferred state; they do not independently
prove a successful catch-up. The correction receipt must name any new checks
that supersede these limits rather than treating the original assertions as
stronger proof than they provide.

The existing API error discards the difference between a broken body stream
and JSON parse failure after HTTP 200. The accepted narrow error correction
does not add that distinction; such a response remains a diagnostic stop with
explicit retry. It is not evidence that every mid-body network failure backs
off automatically.

Inherited image/recovery limitations remain in the first-use evidence receipt.
These follow-ups do not authorize changes to the live instance, migrations,
automatic authority adoption, or another full compatibility test run.
