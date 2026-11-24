# Added and removed words in agent edits (1169)

Core keeps the existing reader eligibility and revision history. For a human
who read an agent message before its edit, `struck` becomes
`{revision, cuts: [{at, words}], added: [{start, end}]}`. All positions refer to
the current body in UTF-16 units. Pure additions qualify. Whitespace alone
does not. Numbers containing decimal points, commas, colons or a final percent
are one token. Changes separated by punctuation, spaces and at most one word
merge into one replacement. Existing token/edit/cut/removed-text bounds remain;
the bounded fallback marks the differing middle. Excerpts omit changes beyond
their end and clip an added range crossing that end. No schema changes.

The page keeps Core's complete shape in card, dossier and Reader caches. Added
words use the selected ink fill and accent underline; removals precede their
replacement with the existing muted strike. Both have accessible labels. Text
splitting preserves source positions, so quotes and selection use current words
only, even across Markdown boundaries.

Eligible readers initially see marks and `Edited · hide changes`. Hiding redraws
the cached current words without a fetch and changes the byline to `show changes`.
The choice is local to this device, keyed by actor, message and current revision;
the next edit defaults to showing marks again. Without `struck`, only `Edited`
appears. Core remains the authority for eligibility; a device preference cannot
reveal a revision Core did not supply.
