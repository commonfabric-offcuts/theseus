# Topic working set (1247)

The page admits at most300 canonical full message records, counting loaded
messages and supplemental dossier originals together. Canonical message entry
DOM follows the same budget. Reading/focus/Reader/edit/explicit navigation pins
consume that budget; unread ranges and open dossiers do not pin every member.
Original private writing, image bytes and pending operation envelopes remain
with their existing owners and are counted separately from passive feed data.

Eviction releases the message object and all passive presentation references.
Retained runs split wherever an eviction makes a gap. The newest arrival
watermark and older-history cursor remain independent. A gap is reconstructed
through the existing authorized30-message paging or named-message reads;
absence from this window is never a read, a removal, or a dossier relationship.
Late reads from an older window must not restore an evicted run. Revision and
terminal hints are bounded to256 entries; no cold full-body cache is added.

The window has at most8 loaded runs. A huge dossier uses the same member
window, retaining its admitted original inside the shared budget. Active
writing/image/unknown-operation owners are never discarded to meet a passive
cache limit. If protected admission cannot fit, it is reported and passive
admission pauses rather than inventing a successful trim.

The300/8/256 budgets are initial test values. Native proof must measure both
canonical DOM and retained objects through sustained arrivals and scroll-back,
alongside anchor/read/writing correctness, command identity and action timings.
