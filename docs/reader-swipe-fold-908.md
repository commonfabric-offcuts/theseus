# Fold by swiping, and return to the feed

A qualifying swipe on the Reader's message uses the existing personal Fold
command. The Reader stays open while that command is pending. Once that act
commits, the same Reader closes through its existing close/save owner, keeping
the current unsent words, recipients, images and caret. A replaced Reader is
never closed by the old answer. A refusal, unknown answer or failed local save
keeps the Reader open with its notice. Feed swipes keep their existing behavior.

When a swipe cannot fold, the existing status line says why:
“Starred messages stay in view; unstar it to fold.”, “Already folded.”, or
“Nothing to fold here”. A qualifying horizontal swipe is consumed even when
it cannot fold. A sideways scrolling box, selection, zoom or vertical scroll
keeps its existing gesture. The shared message menu retains a disabled Fold
row with the starred reason. A star never becomes permission to fold.

A message's filled star is visible from its first paint, including a dossier's
first card. The old CSS exception hiding that first card's already-painted star
until hover/focus is removed. Unstarring changes the same painted state at once;
the Reader and dossier title retain their existing shared star owners.

Focused checks run actual app, StackFeed, Reader swipe, close and save owners
with in-memory transport/device ports, plus the shipped CSS rule. They do not
claim native touch/trackpad, focus or rendered-pixel proof.
