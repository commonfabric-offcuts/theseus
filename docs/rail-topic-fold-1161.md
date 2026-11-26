# Seven topics in the left rail

At rest an outcome shows its first seven active topics in the person's drawn
order, followed by about 85% of its eighth row fading to nothing. There is no
folded count. Starred dossiers and pages stay with their topic. More topics,
Done and Archived sit below the fold. Seven or fewer topics keep today's view.

Rest the pointer on the faded eighth row for 250 ms to reveal the list.
Moving 6 px or more restarts the wait, and leaving the row cancels it. A press
reveals it immediately. On touch, the first tap reveals the list and the next
navigates through the existing guard. Modified links keep their acts.
Keyboard movement into or through the list holds it open. A feed click, key
press or sideways dossier swipe closes it, even after in-place navigation.
The shell owns the dismissal listeners and the list removes them on disposal.
CSS grows the list in .22s and delays folding by .35s; reduced motion is instant.

If the current topic is past the visible rows or in Done or Archived, its
original link occupies the faded slot at rest and returns to its usual
position when the list opens.

TopicRail still owns rows, order, paging, marks and navigation. The outline's
fold owner measures the drawn eighth row, including the space taken by earlier
stars, so compact, roomy and wrapped phone rows use their actual heights.
It clips the existing nodes rather than removing, hiding or rearranging them.
All rows remain available to the existing accessibility and keyboard tree.
Missing browsing context or measurement support leaves the full list available. No Core/schema,
stored preference, new paging request or separate topic projection. Each list
has at most one pointer-rest timer, canceled on dismissal or disposal.

The designer reference is spec9e9a7830 and prototype d8ddd10a; the prototype's
configuration panel and +N experiment are excluded.
