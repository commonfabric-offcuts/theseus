# Archive names and drawing (601)

Rebuilt on release131 under Tony11400 / Warp11402. The old408 build/native
workflow is not resumed. This piece joins843 after both independent reads.

- The dossier title bar, its phone menu, message menus and Reader call the
  existing archive action **Archive**. Its return action is **Bring back**,
  the named default in item601 version5.
- The archived-dossier toggle reads **Archived (n)** whether closed or open.
  It counts admitted dossiers, not messages. Its existing aria-expanded state
  and show/hide action remain; at zero the toggle is absent.
- Every Archive control uses the Reader's existing SVG through the same
  borrowed glyph owner. The title bar's separate down-arrow tray is removed.
  Bring back keeps its existing up-arrow tray on the title bar and menus;
  the Reader retains its pressed-state archive button and message count.
- Stored positions, archive/return actions, Undo, star refusal, message
  loading, theme colours and responsive layout are unchanged. Archive notices
  use the same name, including the client and Core star-hold refusal; the Core
  change is that message string only, with no command or record change. The ordinary
  **More messages** control still loads older messages; it is not an archive.

The interaction guide uses the new names. Earlier prose and historical test
names referring to Move below More / Bring back above More describe these
same existing acts, now named Archive / Bring back.

## Evidence and limits

Focused source/DOM checks, not native input or rendered layout proof. No
browser, native run, full suite or CI. Exact source, commands, raw output and
baseline comparison live in fable-tools/coordinator-20261117/601-next11365.

The selected eight-family unmodified131 baseline has287 pass/1 fail. The
pre-existing menu glyph catalog check omits the live unwatched glyph from its
APPROVED fixture. That unrelated mismatch is left unchanged, not called green.
Four new601 checks fail on unchanged131 before the product edit. They exercise
the actual title bar, desktop/phone menu actions, archive count/expansion and
Reader painter. DOM fixtures supply the Reader SVG read from index.html; they
assert its drawing against the existing independently specified archive shape.

Final source comparison: the same eight families plus ui_archive_601 have
291 pass/1 fail, zero skips; the sole failure is the same catalog mismatch.
Families: ui_inline_wiring, ui_menu_glyphs, ui_stack_order, ui_stack_position,
ui_reader_steps, ui_dossier_lineage_799, ui_dossier_renderer_799,
ui_dossier_heads_799. Run with node --test --test-reporter=tap and the
corresponding tests/<family>.test.mjs paths.

Four actual source mutations (title drawing, menu name, archived count and
Reader name) each fail the intended601 assertion; each restored control passes
4/4. Two existing Core/CLI star-hold scenarios strengthened to check the exact
new refusal fail before the string change and pass after it, with fresh Python
cache directories. Both still verify that refusal moves no dossier, and the
CLI scenario verifies unstar permits the existing action. The initial new
menu test encountered the fixture's missing getClientRects method; supplying
presence for that notice callback fixed the harness, without a product edit.
