# Outcome page follow-ups (852)

Tony11555 and Warp11557/11561 request eight page changes after847. The shared
Team line moves above the Notebook and follows the topic's right alignment and
phone wrapping. Invite agent uses Add's label span and chip metrics. The
Notebook shows a card-stack or text icon without repeated view words; changed
counts stay beside the title. Its heading disappears while its New page pencil
stays at the right. Topics uses sentence case, and New topic uses that pencil
with an accessible name.

The existing topic-list owner still supplies cards and their activation. The
outcome cards implement the center pane's focus and key operations; the shared
panes controller routes both siderails into it and back. First up/down from the
page lands on its first topic. Up/down traverse displayed cards, Home/End reach
the ends, and a round trip through either rail restores the last topic. Return
uses the card's existing link/rail activation. Hidden panes, dialogs, writing,
modifiers and denied/empty lists retain their existing boundaries. No extra
topic read, saved navigation state, Core command or schema is introduced.

Focused module and actual handler checks cover destinations, pane handoff,
guards, the live Notebook preference, badge placement and shared glyph/chip
markup. Actual routing mutations must fail, then pass after byte-exact restore.
CSS/source checks establish styling intent, not rendered native geometry.
No browser or screenshots are authorized; release notes state that limit.
