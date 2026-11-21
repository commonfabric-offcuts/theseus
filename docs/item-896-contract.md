# Restore a scroll only for its move

Reconciliation gathers the nodes it actually inserts or moves during one
arrangement, including nested reply and section moves. At the existing final
restore point, a remembered box is written only when a moved node contains it.
An unchanged card keeps its current offset, even if its latest scroll event has
not arrived. No scroll positions or layout geometry are read while arranging.

After one restoration attempt, forget that box's remembered offsets, including
when a hidden box cannot accept the write. A later arrange cannot replay them.
The next scroll event may record fresh offsets. Detached boxes are still
forgotten; unmoved remembered boxes stay available for their eventual move.
Moved tables and long messages keep their position, and both axes still count.

Checks call actual arrangeStacks/reconcile below the browser, model a hidden
box rejecting a write, and retain the existing 888 controls. Its former table
identity tautology is replaced by lookup in the actual current card subtree.
These checks prove event/restore ownership, not native layout or timing.
