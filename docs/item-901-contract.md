# Outcome navigation in place (901, first slice)

An outcome click uses the existing page shell, as a topic click does. Topic,
Conversation, outcome (`workspace`) and Outcomes home (`root`) routes can be
both the source and destination of an in-place move. The address and history
entry change; Back and Forward use the same navigation and refusal owners.
Other application routes retain their existing document-navigation behavior.

The shell keeps the actual rail and outline elements, their scroll and the
keys' place while it replaces the departing run's main content. The existing
root presentation remains: its outcomes list occupies the main column and its
rail can be hidden. Visiting root preserves the retained rail/outline for the
next outcome or topic. This does not add a visible rail to the root page.

The app supplies its existing `readyRails` handoff for root as well as outcome
pages. The shell remains the single owner of history, pending moves, build
checks, page retirement and focus landing. The app's current navigation and
writing owners decide whether departure is safe. The shell checks its existing
registered writing guards before an in-place move, including after waiting
for the served-build answer. A held Notebook device write stays on the page
and uses the existing refusal notice; it is not bypassed by avoiding unload.
No new writing, save, close, recovery or navigation owner is introduced.

Same-page links, message and Notebook deep links, changed-build fallback,
refused navigation, late responses and obsolete page listeners keep their
existing ownership. The current page's identity and instance checks remain.
In particular, a response from a retired run must not repaint the new run.

This first slice does not change the outcome read schedule or its commit
refresh policy. The item explicitly permits those as a separate next slice:
topics-first read ordering, removal of the duplicate Conversation read,
bounded foreground concurrency and scoped refreshes remain outstanding.
Server asset caching is item 904. This contract claims no browser timing gain.

Evidence will exercise actual Shell moves/restoration, history and guards,
plus the real app initializer and navigation callbacks in the existing
in-memory wiring fixture. The exact177 source will be retained for behavioral
red checks. Meaningful own checks run under the current shipping rule (12902),
without a separate proof-packet or lease gate. Native pointer, keyboard, touch, rendered scroll/focus and network
timing require separate browser evidence; handler fixtures do not prove them.
