# Temporary Wide replies (906)

A quote from a desktop Stacked Reader opens Wide for that Reader only. The saved layout stays unchanged. Repainting the same open source keeps this temporary choice; closing it or opening a different source drops it. Ordinary saved reply text does not widen an opening. The explicit Wide/Stacked toggle acts on the visible layout, clears the temporary choice and saves the chosen layout through ReaderLayout as before. A phone remains stacked.

When the same inline reply is expanded to the modal Reader, a retained quote or writing exceeding four rendered lines uses the same temporary Wide. The inline field is measured at its existing width, including wrapping; ordinary inline writing of four lines or less keeps the saved layout. This adds no draft field, storage key or navigation owner. Existing editor writing, quote references, caret and width preferences remain with their owners.

Checks use the real Reader show, quote, expand, close and toggle methods with isolated DOM/storage ports. They distinguish the displayed layout from the saved preference and cover same-source repaint, next-source opening, explicit toggles, ordinary saved text and the inline/phone boundaries. Native rendering remains a separate limit of these fixtures.
