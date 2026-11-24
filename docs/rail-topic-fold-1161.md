# Seven topics in the left rail

At rest an outcome shows its first seven active topics in the person's drawn
order, followed by about 85% of its eighth row fading to nothing. There is no
folded count. Starred dossiers and pages stay with their topic. More topics,
Done and Archived sit below the fold. Seven or fewer topics keep today's view.

Hover anywhere in the topic area or move keyboard focus into it to reveal the
whole list. A current topic beyond the seventh, including Done or Archived,
keeps its list open. On a phone, the first touch on the peeking row reveals;
the next navigates through the existing guard. Modified links keep their acts.
CSS grows the list in .22s and delays folding by .35s; reduced motion is instant.

TopicRail still owns rows, order, paging, marks and navigation. The outline's
fold owner measures the drawn eighth row, including the space taken by earlier
stars, so compact, roomy and wrapped phone rows use their actual heights.
It clips the existing nodes rather than removing, hiding or rearranging them.
All rows remain available to the existing accessibility and keyboard tree.
Missing browsing context or measurement support leaves the full list available. No Core/schema,
stored preference, timer, new paging request or separate topic projection.

The designer reference is spec9e9a7830 and prototype d8ddd10a; the prototype's
configuration panel and +N experiment are excluded.
