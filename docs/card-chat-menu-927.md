# Card chat and keyboard menu (927)

In Notebook Cards, **Chat about this…** moves from the standalone speech
bubble into **This card** (⋯). It opens the existing card chat composer, with
the same destination, saved writing and availability rules. Links to existing
card conversations remain links. A stale menu must still address its own card
after a reorder, or do nothing if that card is gone.

The page's existing Context Menu / Shift+F10 shortcut opens the focused card's
menu. The shared menu owns Up/Down, Home/End and Return. Escape closes it and
returns focus to that card, so card cursor control continues. Clicking ⋯ keeps
the existing pointer behavior. Writing fields retain their own keys; Return
still creates a card and Command+Return still edits one.

Checks cover the actual card menu, removed chat glyph, availability and stale
card identity, plus native browser keyboard focus, selection, chat opening,
Escape and pointer opening at desktop and phone widths.
