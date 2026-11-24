# Header effects only on hover (1176)

Tony's1176 correction supersedes1167's press/focus and always-visible folded
chevron default. The open card's own author header lights the existing ink7%
no-line band and reveals its existing chevron only while that header is
hovered. A folded card's visible header is its existing `.message-folded` row;
only hovering that row lights its full-width strip and reveals its right-turned
chevron. Earlier rows remain excluded. The hidden author
header of a folded card is not a hover target. Focus and press alone reveal
neither effect; leaving the header hides them even while the card keeps focus.

Keep the same card as the keyboard stop, its ordinary focus ring, the existing
fold/header/x/menu/Undo owners and glyph node, dimensions, inset, angle, and
reduced-motion rule. Singleton, Only new and Earlier retain their existing
presentation. No JavaScript, Core, schema or persisted-record change.

The source change is confined to stack-look.css; update the existing1167 CSS
contract to name the new default while retaining all renderer/owner checks.
A selected own CSS assertion must be red against shipped379 and green against
the proposed CSS. Node assertions establish source/DOM contracts, not native
hover, focus, layout or timing. A separately bounded isolated Chromium cell
must be explicitly disposed before any browser entry. No child is authorized
by this preparation; fresh exact plan/grant/Build/source/live gates apply.

Resource admission follows Warp20874/Fable20882: up to3 lane entries while
load1m<12on18; another lane is not a hold. A Warp whole-suite landing enters
with no lane entry and holds new entries until its suite-ended notice.
