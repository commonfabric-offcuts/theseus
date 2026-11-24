# Left rail shortcuts

Option plus the physical Digit1…Digit0 keys opens an assigned left rail item,
including while typing. Unassigned keys, other modifiers, composition and native
browser shortcuts keep their existing behavior. A held key navigates once.

The existing context menu gains a Key row: ten numbers and ×. Choosing a number
moves it from its previous item; each item has at most one number. A quiet number
keycap sits beside the title; its tooltip and the menu name Option. The rail's
Keys guide lists the current assignments. No shortcuts are assigned by default.

Assignments are browser-local localStorage preferences, separated by instance
and reader. Unavailable storage keeps choices in this document and says so in
the menu. Valid choices from other tabs refresh without a Core command. Stored
destinations are validated internal routes, never arbitrary URLs.

The shell owns one shortcut listener across in-place moves. Bootstrap binds
every page, including Health; startup and retired pages remain inactive. A loaded row uses
its existing click action (including current waiting-question routing); a row
not currently drawn uses the same guarded shell opening. A modal/inert rail
does not accept a shortcut. Menus retain their existing source confirmation,
outside dismissal, Escape and focus return. No Core, schema or cross-device
storage change is included.
