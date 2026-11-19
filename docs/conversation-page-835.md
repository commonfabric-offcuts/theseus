# Outcomes open at home; conversations read as topics

Item 835 retires the special browser Conversation page. Outcomes home and
outline outcome links open `?workspace=OUTCOME`. The existing conversation
appears in the topic list under its recorded title, opens `?topic=TOPIC`, and
uses the ordinary topic heading, messages and composer. Legacy
`?conversation=OUTCOME` resolves its topic and replaces the address without
changing records. Existing topic/message/page links retain their destinations.

Remove the separate Conversation navigation row, Only new filter, conversation
empty-state prose and item-takes tag row. Keep authored messages, source links,
asks, replies, saved writing and server routing rules. The retained server kind
still prohibits Topic settings changes; this browser change must not offer
commands Core will refuse. The Reader may still send a reply to the outcome's
conversation through its existing destination and draft-preservation mechanism.

Core continues to omit the active conversation from `workspace_topics`.
On the first active-list page only, the browser reads the outcome's one
conversation and its topic, then carries it separately from the paged records.
It is drawn once among ordinary topic rows. Server cursors, loaded extent and
Done/Archived lists remain authoritative; later pages do not trigger the extra
reads. No server, schema or stored-record change belongs to this piece.

Validation follows Tony11224/Warp11225: focused checks compared with then-live,
source review on the frozen head, one-piece release for Tony's live test. No
preview, browser suite, full suite or CI. Retired Conversation-only expectations
are replaced with ordinary-topic behavior checks, not treated as compatibility
requirements. Warp owns retiring item408 and the Later Only new items. Item836
can replace the topic list later; it does not block this work.

## Outcome home disposition (Tony11266, Warp11289/11290)

The title and editable purpose, Where it stands, target/checks and Pipeline
line stay first, followed by topics, the outcome Notebook, team/invites and
skills/tools. Ended/Bring back remain in standing, and Onboarding prompt stays
in the title overflow menu. Saved writing and unfinished work use their
existing recovery paths.

Also waiting, improvement-loop details and pre-check problems follow the
primary sections. A closed-by-default More from this outcome section reuses
the existing bounded context reader for Starred, Waiting for…, Previews, Pull
requests and Images. It reads on opening, preserves source-message links, and
does not duplicate the Notebook or tools. Its recent-message limits remain;
it is not a complete archive. Image bytes use the current page's API.

Sent to you by name is removed from both the outcome and Outcomes list pages.
No delivery is acknowledged by removing this display. Notifications remain.
No settings sheet is added. This list was posted to Tony in Landing before
freeze (11289/11291); Warp accepted it in 11290.

## Checks during implementation

The original eight focused families passed 341/341 on live 123. The first
candidate passed 332/332 after nine obsolete special-Conversation assertions
were retired. Additional checks exercise ordinary topic identity/counts/asks,
loaded extent and cursors, legacy links, retained content and lazy loading.
An isolated CPython 3.9 Core fixture supplies real view shapes: outcome, topic
and work records remain unchanged; Core's existing agent-message exposure
bookkeeping is explicitly allowed and checked.

Initial new checks caught fixture assumptions about the ask contract, agent
exposure writes and the inline presentation callback. The retained-content
check also exposed a missing media-reader connection in the embedded section;
that is fixed. Raw failing and restored logs remain in auditor/evidence.

## Frozen comparison on release 126

The candidate carries automatically onto live 126
`d5c46e3fd3696be586585d9765bfd821049eb461`; no conflict was hand-resolved.
The same fourteen focused families pass 414/414 on that live baseline. The
candidate, including the new 835 family, passes 416/416, with zero failures
or skips. Nine obsolete special-Conversation checks are retired; the old wall
Mark read check is replaced by a no-ack wall-removal check, and eleven new
adapter/routing/content checks are added. Existing 768/783/785/650 behavior remains in the combined source.

Five applied mutation controls fail as intended and their separately restored
controls pass: route an outcome back to Conversation; omit the companion topic;
retain the legacy address; omit the embedded image reader; corrupt the isolated
Core fixture's topic record. Each Python phase uses a fresh bytecode-cache
prefix. The retained-image check reads through the supplied API callback,
without a browser. Raw evidence: `835-baseline126.tap`, `835-candidate126.tap`,
`835-mutation-checks.py`, `835-mutations.json`, and each mutant/restored TAP
under `~/.local/share/theseus/auditor/evidence/`.

No preview, browser, native suite, full suite or CI was run. These checks do
not prove touch, focus, layout or image rendering in a native browser. Tony's
live check remains the acceptance of those interactions. Prior native limits
on 768/783/650 remain source-bound; none is promoted by this comparison.
