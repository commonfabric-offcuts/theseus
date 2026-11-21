# Reply Send rests above the phone keyboard (993)

On release278,991 only scrolls a covered footer. Safari may already have
scrolled it much higher on focus. While the phone viewport is reduced, settle
the current writing/footer/act foot to the visible bottom minus the existing
8px (or larger scroll padding), moving down as well as up. Bound that move so
the field box's top never rises above its visible scroller/viewport top. A box
taller than the available space keeps its top; its full height cannot also fit.

Keep the same scroller, two-frame coalescing and resize/pan/typing triggers.
Preserve unchanged-bounds page scrolling, laptop behavior and all existing
991/975 lifecycle/hidden/readonly/disabled/writing/selection controls. No Core,
schema, CSS or draft/send change. Desktop390px native shrink is geometry
evidence; Tony's same-phone keyboard and Safari accessory bar remain acceptance.
