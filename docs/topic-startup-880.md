# Topic startup reads (880)

After the topic and its existing startup prerequisites are confirmed, the
page starts its initial message page, memory page and recovery journal
without waiting for one another. It joins the color read already started
before the topic; there is still only one color load.

The message query remains newest 30 (`audience: all`, `direction: before`)
and memory remains 20 for the topic's existing scope. Every checkedView and
instance check remains. The existing feed and actor baselines precede these
list reads. No editor or clickable source is created until both list bodies
arrive; all four startup promises must succeed before the normal startup
continuation adopts the journal and wires the page. Color failure retains
its existing nonfatal fallback.

A refused list or journal still refuses startup. A journal opened for a
failed join is closed even if it arrives later, without touching a newer
attempt's journal. No new durable state, owner or query is introduced.

Checks use the actual page initialization and rendering with in-memory
transport/journal substitutes: held reads, every completion order, unchanged
bounds and identities, refusal and late cleanup. They establish ordering and
fences, not a measured production speedup or native browser click behavior.
