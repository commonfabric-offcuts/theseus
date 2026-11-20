# Dossier first-message star (646)

Release220 base 73d3c2b34da8b6d69e1d541833ebd7be88cee189, schema59.
Warp13707 reassigns the current item: one always-visible second-line star,
using the approved natural glyph box and transparent background (Tony8635,
preview33bee3c4). No title padding changes.

The control reflects only the reader’s star on the actual first message.
A reply’s star does not fill this toggle. A press toggles that first message
through existing message.star, with its current star_revision and authority.
A bounded topic_messages named read confirms the first message even when
unloaded. A missing, foreign, withheld, moved or stale-visit answer makes no
command. Pending reads/commands coalesce repeated presses. Existing exact
operation recovery owns uncertain command outcomes.

The press does not navigate, rename, open a Reader, fold, clear a New mark,
or move keyboard focus away from writing. Keyboard Enter/Space works in
place. Other message stars and the dossier’s title/layout remain intact.
Existing Core retention above More continues to apply;735 is outside scope.

Validation will record red on unchanged220 through the real dossier header,
native pointer/touch/keyboard toggles and header invariants, focused identity
and stale-read checks, and a deliberately applied routing mutation.

## Final behavior and current-source boundaries

The filled/hollow glyph is `★`/`☆`, in the existing header font, colour and
separator, with no control background or extra padding. Ordinary and singleton
headers retain their second line. Current220 quiet agent coordination has a
single compact title row (394); that row keeps its existing geometry with the
same visible toggle. This retained compact-row exception was reported to Warp
in Landing before freeze. No header title padding or general folder geometry
changes. The aggregate starred-dossier set still owns retention above More.

MessageMenu's existing first-touch and click-focus capture now exempt this
header control, as they already exempt other inline controls. Without that
boundary, native Space activation moved focus to the message card. The toggle
retains its node through repaint and does not clear visit-only New marks.

## Checks on release220

- The real header failed on unchanged product220: no role-button star existed.
- 16 focused Node checks pass: star/unstar, loaded and unloaded true-first
  identity, fresh revision, foreign instance/id/topic/root, missing/withheld
  source, departed visit/moved anchor, repeated presses during read/command,
  existing uncertain-operation recovery, reply-only stars and external unstar.
- 135/135 affected Node checks pass across the focused file and existing
  dossier renderer799, context857, New781, message menu, menu owners861,
  stack ordering, private-note800 and scroll-carry888 files.
- Native Chrome for Testing156: four cases,1280/390px × light/dark, all pass.
  Each uses real HTTP/Core, native click or touch and keyboard Space. Each
  verifies stored actual-first star/unstar, a separately starred reply left
  intact, initially filled state after reload, second-line transparent natural
  box, unchanged title geometry/header state/URL/Reader visibility, retained
  keyboard focus, folded-header state and exact unfinished writing/focus.
- Applied routing mutation: changed the header command target from confirmed
  first to the loaded head. 5/16 focused checks failed; exact byte restoration
  returned16/16. Source SHA-256 before/restored:
  `a9b207418ef1ce7506db3c57440a625f80ba6acb43d8fe0f5ad61e681d53dda6`.
- `git diff --check` passes. Fetched release/live73 still equals the220 base.

Native evidence is under the auditor's `evidence/646-native-final3/`; the
unchanged220 red is `646-native-red/`, first complete matrix `646-native-green2/`.
Eight browser invocations total retain all results, including the focus
investigation and two harness corrections: ordinary dossiers close to
`folded` (not the quiet-agent-only `head` state), and a personally folded first
message must be opened before its reply field. Every invocation records
Browser.close/disconnection, owned-profile process absence, fixture EOF exit0,
fixture PID absence and closed origin port. No browser remains owned here.
Initial DOM cohort used an unsupported `after` method in its small fixture;
using the simpler equivalent append after the retained star fixed that without
changing the fixture or weakening a check. All initial logs are retained.

Run focused and affected checks with:

```
node --test tests/ui_dossier_header_star_646.test.mjs tests/ui_dossier_renderer_799.test.mjs tests/ui_dossier_context_857.test.mjs tests/ui_dossier_new_781.test.mjs tests/ui_message_menu.test.mjs tests/ui_message_menus_861.test.mjs tests/ui_stack_order.test.mjs tests/ui_note_unfold_800.test.mjs tests/ui_scroll_carry_888.test.mjs
```

Run the native script with `AIM_PLAYWRIGHT_CORE` pointing to Playwright1.63.0's
`index.mjs`, `AIM_CHROME` to the owned Chrome for Testing executable, and an
absolute evidence directory:

```
node tests/dossier_header_star_646_native.mjs /absolute/evidence/directory
```

Limits: no WebKit or full Core suite run for this web-only change. Unloaded
routing and stale-result negatives are owner-level checks; native cases use
loaded first messages. Compact agent and singleton appearance were inspected
in source, not added as native cases. No deployment or735 reveal is claimed.
