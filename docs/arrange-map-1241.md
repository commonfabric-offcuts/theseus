# One message map per arrange (1241)

StackFeed takes the current loaded/supplemental message map once for each
synchronous arrange. Act projection, held places, header stars and card painting
share it. A nested arrange takes its own current map and restores the enclosing
scope; success and exceptions release the scope. Commands and deferred handlers
outside it still read the current provider. No map is cached between passes.

arrangeStacks accepts optional `on.arrange` for its `state.again` continuation.
StackFeed supplies its normal arrange; other callers keep the existing renderer
fallback. More, Earlier, fold and reveal therefore enter a fresh StackFeed pass
without closing over its previous map. Ordering, pending acts, source heads,
held/New/Only-new choices and the hold callback retain their owners.

The own file counts actual DossierHeads map-provider calls through StackFeed and
the renderer, and checks projection/current-map changes, nested/error cleanup,
and retained handlers. These model checks measure requested map construction,
not CPU, geometry, native focus or measured interaction speed.

Interaction inventory: authoritative feed/act refresh calls the ordinary pass;
pointer/tap and Return/Space controls change star, dossier level, More/Earlier,
rename, join, split, place or archive through their existing owners. Keyboard
fold/reorder/archive/Undo and wheel/touch folding also reach arrange. Hover and
ordinary scrolling alone do not request this map; focus/reading/writing holds
and Only-new choices remain renderer inputs. No handler or key assignment changes.

The own file models card-star click/Return/Space, actual dossier-toggle callback,
the shared More/Earlier/fold/reveal continuation, and current maps/holds. Other
command/gesture routes retain their direct consumer files (including dossier
keys1037, level858, selection-quote, and inline wiring); the discovery list is
handoff input for the later ordinary cycle. Native pointer, touch, wheel,
focus/scroll and CPU proof remains unrun by this focused source fixture.
