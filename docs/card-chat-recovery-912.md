# A card's Chat availability recovers

The existing **Chat about this…** menu choice becomes available without reopening
the Notebook page after an unavailable participant read recovers or an agent joins
an empty topic. Item 927's removal of the standalone Ask glyph stays in place.

The shared card page owns one room read at a time. A header paint reads the room;
a followed commit retries when there is no room or no enabled agent. Once a room
has agents, ordinary commits do not repeat that read. A failed read is quiet and
does not discard a previously available room. An empty topic keeps Chat disabled.
No timers, extra persisted state, participant authority or new sending owner are
added. A late answer cannot update a closed page or a different owner scope.

Both the full Notebook page and the visible Notebook sheet use the actual
NotebookPage load path; the sheet's existing followed owner decides which page
loads. Recovery keeps the current writing and the existing Chat action. Focused
checks use actual page, writing, sheet-follow and menu owners with memory-only
storage, view and DOM ports. They do not prove native gestures or live timing.
