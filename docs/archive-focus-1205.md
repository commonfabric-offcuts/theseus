# Archive panel focus (1205)

While any control in the right rail's Archive panel has focus, the panel fills
two thirds of the rail's visible height. Moving focus between a replica and the
view controls keeps it expanded; moving focus outside restores its compact
height. The rail beside the page is one viewport tall, including on resize.

The existing scrolling, Grid/List/Auto choices, archive and Bring back actions,
keyboard navigation and hidden-shelf behavior stay with their existing owners.
The focus rule changes presentation only and stores no new state.

The focus/height observations in `tests/archive_shelf_native.mjs` cover the
expanded and compact states, internal focus moves and viewport resize. Native
execution follows the existing postlanding gauntlet; source checks alone do not
prove the measured height.
