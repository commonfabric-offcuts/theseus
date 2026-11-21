# Command–Down moves the selected dossier below More (705)

On release220, StackFeed routes Command–Down to reorder-down. Change its feed
key action to the existing personal `stack.aside` path, for the dossier Return
would act on: pointer-hover, keyboard or last-touch selection. A selected
message resolves to its containing dossier, including when its real root is
outside the loaded page. No selection acts on nothing. Writing, other controls,
the Reader and open menus keep their keys. Outline/right-rail ordering stays
with its existing pane owner. Reorder-down remains in the dossier's menu with
no Command–Down label; the archive command owns that label and the guide.

Reuse current220's star hold, pending/retry/refusal handling, root fencing,
personal positions, focus on More and Undo. No Core/schema change. The previous
f7078990 implementation's small routing idea is useful; its old native driver,
attempt allocations and unresolved three WebKit failures are historical, not
the workflow or a passing result for this source.

Fresh proof: first show actual native Command–Down on220 issuing reorder
instead of archive. After the change, native topic and Conversation scenarios
at390/1280 light/dark verify actual Core aside state and no stack.place request,
root identity from message/header selection, no-selection and writing controls,
star hold, other-reader isolation, and Undo. Retain nearby Node selection,
menu, star, retry and ordering controls. Phone uses emulated touch with a native
keyboard event; no physical phone claim. A small applied/restored routing
mutation must make the target check fail. Freeze on own meaningful green.
