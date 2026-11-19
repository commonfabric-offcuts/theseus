# Cover refresh and readable waits (853)

Tony11558 and Warp11561 ask for a shared cover-sheet correction. A sheet has
only its actual content rows; no empty heading holds a refresh button. Its
existing refresh control, including status, occupies the lower-right corner
beside the final content row. The feed and Reader use the same arrangement.
It does not create a separate refresh row or overlap the cover's words.

On a fine pointer with hover, the idle control appears while the cover is hovered
or contains focus. Pending or busy dots and errors stay visible and pressable
without hover (869, Tony11703 and Warp11707), using the same control and its
existing data-pending/status state. The override belongs to the same fine-pointer
media query; no new request or progress owner is introduced.
Opacity, rather than display or visibility, preserves the
keyboard stop. The named default on touch/no-hover is always visible. A
singleton's compact pills retain their inline control; they are not a sheet.

Wait words use the existing inline Markdown renderer, including safe links and
literal code, without a block that would separate them from their label.
Core's words remain unchanged. A wait with no options and no
default says only “Waiting for your answer.” in its note; explicit choices,
defaults and their explanations remain. The same note feeds the compact
pill's title. Source links and answer controls keep their existing owners.

Focused checks cover actual sheet composition, formatting, source routes,
answer controls and refresh request retention. CSS checks establish intent,
not rendered geometry or native focus behavior. No browser or native run is
authorized. Applied mutations must fail and byte-exact restored controls pass.

869's checks hold the existing renderer's pending, busy and error states against
the matching persistent-visibility declaration, and retain the idle-hover and
touch defaults. Pending visibility fails against live145 before the rule is added.
