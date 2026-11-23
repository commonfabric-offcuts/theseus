# 1091: the message menu as a palette

Pre-edit contract for Page5 under Landing18296/18298/18307. The current
canonical item is1091i9/Now, unbound;1113 is refrozen536487dd/p7 and read
clean by Warp18431, with Fable's approval/landing still separate.1076 stays
preserved. This new own branch starts from actual live356
bc8f125646fb7450b1a1242f851562feb3887751/tree8a862edb990594881cf51cb04da1c120f5dfcaf2:
page-lane5/1091-message-menu-palette-356-18431. No other worktree is changed.

The designer's whole4944-byte spec.md, SHA256
c595387685b8cc30f7d330cd4c34a46dc9a4aa2628bf4f14e26f0f143149e15a,
is the contract, supplemented by Warp18307. The full245-line prototype.diff,
CSS and all five supplied pictures have been read/viewed and retained with
exact identities in artifacts/1091. The prototype targets341aec1b5589;
it is a historical reference, not an automatically applicable live patch.
No access to the withheld original designer topic is needed or attempted.

Every This message endpoint gets the same palette: feed bar ellipsis,
message right-click, dossier title ellipsis, and the Reader. Core-derived
eligibility and exact acts/destinations remain authoritative. Marks are
Star, Read/Unread and Archive/Bring back, lit by their offered state; the
remote two-choice read case uses its first offered choice. Copy link sits
at their right. Names and keys appear in titles and accessible labels.

Ordinary rows follow the exact spec order: Ask for update, cover request,
Edit, Start new, pipeline add, Move to topic, Withdraw question, Show full
message, Split back out, then unnamed Reader/topic/layout rows in existing
order. Topic and Dossier are separate Start new buttons with separate acts,
never a radio selection; a lone offered start remains an ordinary row.
Only offered Retract/Unsend/Delete is red after its separator. Withdraw
question stays ordinary with waits glyph. Rename, the Replies switch,
Acts on, and message-menu Paragraphs access leave as the replacement ships.
Reader Wide/Stacked and every other-label menu retain their own behavior.

Keys form grouped fold/move/join/final controls, including latest/all,
Undo/reset and the phone move-or-join act. Every key remains a real button
with its full action name. Initial focus uses the first ordinary row;
all four arrows traverse every enabled button in rendered order, including
both Start new acts. Home/End, Escape/Tab, outside press, scroll-close,
focusKey targeting, dialog layering and source-scope checks stay intact.
The phone keeps the existing bottom sheet. Coarse marks, pair and key
buttons are at least44px high, including the final CSS cascade.

Joined | Broken out moves into the rail foot in this same change, per
Warp18307. It keeps TextDisplayPreferences' exact instance/reader scoped
text-display / break-out-paragraphs identity and Joined default. Storage
refusal keeps a usable in-memory choice. Changing it preserves the current
card/Reader source mapping and writing; it triggers only the existing
source redraw while keeping the feed anchor. A replacement rail foot gets
one remounted switch, with selected state restored and owned observers /
listeners disposed when the app run retires. The old access remains until
this replacement ships. The held rail.html redesign is separate.

Page5 owns message-menu.mjs and the new message-palette module/style plus
paragraph-switch module, its tests and affected message-menu docs. The
current1096 draft owns notebook-menu.mjs/notebook-menu.css, Notebook starts,
its Reader-memory branch and Notebook tests. Both touch app.mjs/index.html:
1091's wiring is its paragraph preference import/mount/retire and message
item removal plus its stylesheet link;1096's Notebook imports/Reader-memory/
page-start wiring and stylesheet remain Page6's. No broad rewrites of those
shared files. Existing menu_glyphs.mjs is also in1096's draft (lock glyph);
any1091 key-footer helper adjustment must be scoped and reconciled, never
overwrite Page6's glyph entry. No new global glyph is planned.

Meaningful checks come first: rows/states/eligibility for agent reply, own
reply/question, dossier and Reader; two independent starts; destructive
rule; focus/navigation/close; Paragraphs persistence, denied storage,
remount and app retirement. Preserve assertions unrelated to deliberately
moved or retired controls. Run bounded relevant Node cohorts and the
whole-node comparison against actual live before final freeze. Retain real
old-source reds and exact correction controls. No fake-DOM timing claims.

Native proof uses fresh isolated scratch records/profile/origin in Chrome
for Testing and WebKit at laptop/phone widths, including each ellipsis and
right-click, actual keyboard/touch activation, coarse targets, screenshots
against the supplied pictures, source/body preservation and Paragraphs
reload/remount. The shared order is1096,1091,1028 ONE, then held jobs under
18307's ready-work exception; every actual launch requires fresh<12/18 raw
OS gates, exact owned boundaries, NEW INUSE and full real FREE cleanup.
No native window is claimed by source preparation. No tests, fixtures,
browsers, profiles or live data have been launched for1091 at this point.

Fable owns canonical binding/stages and independent approval; Warp owns
carry/landing/runtime. This is authorized ordinary web-only work, no
gauntlet under18296/18298; final paths/effective policy still determine
classification, and a guarded-path conflict returns to Warp. Freeze only
meaningful green exact sources, push only this branch, return immutable
diff/results/limits for independent review. Prototype checks are not1091
implementation evidence.
