# Return keeps the new Notebook editor focused (1151)

On release 376 (`c5d7882428506e3cb12910a77683986457098ad4`), Return from
a displayed Notebook card opens and focuses a new empty editor. The disclosure
renderer also remembers the previously focused card. Its later measurement
callback can restore that card's focus while the new editor remains open.
Keys then arrive at a card row rather than the editor that owns them.

While a card editor is open, a deck repaint must not ask the disclosure owner
to restore its previous card/control focus. The editor keeps its normal focus
and selection owner; a Display-only repaint keeps disclosure focus restoration.
Existing Return, Command Return, selection, composition and writing guards stay
with their existing owners. No stored content or schema change is required.

The unit checks use the real Notebook key/open/writer, deck renderer and
disclosure callback with explicit DOM/observer ports. They establish callback
ordering and focus intent, not native keyboard behavior, layout or timing.
Browser execution is waived by Warp20456. The later carry retains its own
whole-Node gate. Test roots need Fable's separate pinned-plan grant.
