# Inline message replies (907, with 916)

A message's first body click or tap opens its reply below it and focuses the
writing. A click while the reply shows opens the Reader; an editable own
message opens in Edit. A double click does the same, retaining the 400 ms / 6 px
bounds and leaving drags and controls to their own handlers. A dossier title's
Reply opens the latest message's reply.

Opening another reply by click closes the previous click-opened empty field.
Fields holding writing, chosen recipients, quotes, images, uploads or pending
submissions stay. If the inline source read fails, the Reader's normal source
notice and access to authorized retained writing remain reachable; a late
failure cannot replace a newer card or Reader opening.

Every loaded message with a saved reply receives its own composer. These are
DOM adapters of the existing InlineComposer; the EditorRegistry still owns one
EditorSession for each source/destination. The Reader reuses that exact owner.
Opening a Reader suspends all card controls and keeps their writing locally;
closing it restores the cards. Escape closes one card only after keeping its
writing. New messages, private notes, sends, attachments and recovery retain
their existing owners. Restoring saved replies reads only admitted messages,
with at most two loads at once; it does not open a Reader or mark messages read.

The field grows to four lines on desktop and three on phone. The upward
chevron doubles that cap, then points down to restore it. Closing the field
resets that opening's height. No redundant To line appears under the writing; recipient chips and the
How/To panel remain. An expanded inline reply uses 906's temporary Wide layout
when its writing includes a quote or wraps past four lines; phones stay stacked.
906 is an explicit, already-approved dependency of this branch.

An image strip's growth or shrink scrolls the page by the change, keeping the
field's bottom in place within the visible viewport (including the keyboard).
Offscreen replies do not move the page. No text or caret mutation performs this
anchoring, and the New message composer and Reader retain their own layout.

Validation: five real HTTP/Core registry checks cover independent writing,
Reader handoff, Escape and a refused local save, source-bound sending, input
suspension, and access retry with stale answers. All five fail on the original
181 owner, which has no card presentation. The gesture wiring checks replace
890's retired first-click Reader/second-click overlay behavior while retaining
its shared Edit owner and Save/Cancel/Use saved/Escape checks.

The native fixture (`tests/card_replies_907_native.mjs`) uses Chrome for Testing
and an isolated real HTTP/Core store at desktop and phone viewport widths. It
checks three saved fields, height controls, shared Reader writing and temporary
layout, Escape/reopen, native file selection and removal with bottom/text/caret
preservation, first body click/tap focus, own-message Edit, and a desktop double
click on another author's message. Phone checks use browser touch emulation;
a physical mobile keyboard was not exercised. The fixture closes its browser
normally. Run it with AIM_PLAYWRIGHT_CORE and AIM_CHROME pointing to the local
Playwright module and Chrome for Testing, and an evidence-directory argument.
