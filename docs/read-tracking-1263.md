# Visible-card read processing (1263)

The two shared IntersectionObservers retain their separate half-card and
viewport-middle eligibility rules. Their callbacks keep current candidate
entries, so a read pass visits candidates rather than walking every feed card.
Each pass still measures current geometry; no observer entry or cached rectangle
authorizes a read by itself. Registration and forgetting use the existing card
identity map; late callbacks cannot enroll an evicted or replaced card.
The loaded-message metadata walk in seenRanges stays, including its gap/order
rules. Both observers still watch retained cards; this cut bounds processing,
not the browser's observation population.

ReadThrough, Core read admission, TopicViews' accepted/unknown read truth, New
and unread counts, and loaded-run range boundaries retain their owners. Initial
layout, focus/visibility, authority/access, Reader and modal gates remain. There
is no new dwell delay, polling or scheduling owner. All candidate references and
observers retire with the page, including in-place navigation.

Interaction inventory: scrolling by pointer/wheel, keyboard or touch changes the
same two observations; focus or visibility return rechecks their candidates.
Showing/closing the Reader or review, showing a folded card, repainting, loading
older messages, held arrivals, window eviction and replacement all retain their
current geometry and identity fences. Named owner tests model those events and
report outcomes. Native gesture, focus, scroll, layout and CPU proof remain
separate; visitation counts are not measured CPU savings.
