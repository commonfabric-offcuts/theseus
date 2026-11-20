# Outcome home grid (879)

An outcome home keeps the outline on the left and has no right rail or
right-rail opener. Topic and Conversation pages retain their right rail.
The existing shell and ThingsRail own this visibility and their read lifetime;
a hidden outcome rail starts no background reads or subscriptions.

The topic cards use all the remaining width and fit as many columns as their
minimum width permits: at least four at 1440 CSS pixels with the default
16px root size, and exactly one at 760px or less. The named color default is
white title and metadata in dark mode only; light-mode colors are unchanged.

With focus on a topic card, plain Left/Right move within its visual row;
Up/Down move to the adjacent visual row, choosing the nearest horizontal
center. Actual card rectangles determine each move, including after a resize
or reorder. An uneven last row receives Down at its nearest existing card.
At every outer edge focus stays put and the arrow is consumed. Home/End
retain the first/last card behavior. Tab, Return, modified arrows, writing,
menus, group toggles and More controls retain the existing key grammar.
The card owner handles grid movement; the pane router delegates only keys
owned by the card, leaving other controls and topic panes unchanged.

The outcome title menu and siderail menus belong to863 and are untouched.
No record, query, durable preference, route or schema contract changes.

Evidence is focused Node execution of actual owners with supplied DOM
rectangles, plus CSS source contracts and applied/restored mutations. This
does not establish rendered layout, native keyboard events or browser focus
behavior; no browser or server is used for this piece's build evidence.
