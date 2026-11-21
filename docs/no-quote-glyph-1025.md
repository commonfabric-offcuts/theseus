# A glyph for a reply without a quote (1025)

Named default: reuse the existing monochrome reply SVG (`glyph('reply')`),
small and quiet in the reply basis position. Its hover title and accessible
name say “Reply without a quote:” and the exact reason. It adds no action.
Only the generated heading is folded; the quoted reason and reply prose remain
readable as before. No message body is rewritten by rendering.

Core stops inserting the heading in NEW reason replies, but keeps the existing
quoted-reason prefix, immutable reply_basis, source/authority checks and exact
caller body. Quoted replies stay exact. Edits and assessment readback accept the
recorded old or new prefix, preserving the existing variant and its reason.
New reason bases carry reason_format:2; absent means the historical heading.
The existing prefix reader therefore handles both without a dispatcher change.
No migration or retroactive message edit.

Message renderers get explicit message/reply context. A current structured
reason produces the mark. Historical agent replies beginning with the exact
old heading and reason quote fold only that heading into the same mark.
Unrelated prose, Notebook examples, interior/case-varied headings, human/root
messages and quoted-passage replies are not generic prefix-stripping targets.
Previews skip the generated heading to show the author’s own first words.

The renderer keeps the original raw body and source offsets. Card excerpts,
read-on/show-full, preference redraw and Reader all keep the reply context.
Visible reason/prose selections must return their exact source words; the SVG
is decorative source-wise, with its meaning supplied to assistive technology.

Retain the actual pre-edit regression, Core protocol/edit/readback checks,
renderer/preview/offset controls, actual prefix and rendering mutations with
byte restoration, and source-matched native Chrome/WebKit evidence at phone
and laptop widths in both looks. Native hover/read/navigation is separate from
Core receipt evidence. Use isolated stores/origins/profiles/ports and verify
Browser.close/process/profile/fixture cleanup. No physical-phone, screen-reader
hardware or timing claim from headless proof. Fable owns canonical records;
Warp owns independent review and carry/landing.
