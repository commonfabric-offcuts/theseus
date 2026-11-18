# Image buttons as thumbnails (653 / 6b)

Source-only feel preview on release 96, base
`0a68981b0fa25b9a6085c5f9ab1ecf8d16bf9b7d`. Item 651 (6a) already opens
displayed thumbnails in a new tab. Item 652 keeps the same card editor on
phones and laptops. This pass changes image presentation, not those defaults.

## Contract and defaults

A control representing a particular available image shows that image using
the existing `paintThumb` loader and `.image-thumb` styles. Keep its existing
action, source/attachment identity, accessible name, keyboard path and access
checks. A displayed thumbnail keeps 651's new-tab action; a neighboring named
Open button keeps its existing in-place Open/Download action, as the words
and thumbnail in `#img` already keep distinct actions. Do not replace Open,
Download, Retry, Remove, upload, confirmation or cancellation with another act.

Use the Notebook attachment list's **3rem square, `object-fit:contain`** for
Notebook card images, page images and the remaining Open controls. The whole
image keeps its aspect ratio, letterboxed inside the square, with no crop.
This replaces the large clickable Notebook pictures. Keep the existing
2.75rem cover squares in composers and `#img`, and the existing 4.2rem cover
squares on message cards and the rail. No global thumbnail setting.

For remaining Open controls, show the thumbnail beside the named Open action
as one compact image control. Only verified inline PNG/JPEG/GIF/WebP
descriptors qualify. Thumbnail reads take their existing `paintThumb` turn,
through the exact source (or the current author's own attachment where the
existing action has no source). Check that the control is still current before
and after the read. Do not turn an unknown descriptor into a speculative read.
Loading reserves the thumbnail's square; failure leaves the existing named
Open fallback and its current refusal/retry behavior. No fallback image.
Thumbnail and named Open targets are at least 44px in each dimension.

No change to Core, private visibility, selection, writing, caret, To, Reader
layout, scrolling, Notebook saving or upload/delete/download/cancel behavior.
No reads of retained/superseded recovery bytes to decorate their actions.

## Source inventory before implementation

| Surface and source | Before | Planned presentation / retained action |
| --- | --- | --- |
| Message cards: topic, Conversation, dossier (`card-images.mjs`) | 4.2rem cover thumbnails; 651 opens image; rest of card opens Reader | Already thumbnails; unchanged, including near-window loading and access withdrawal |
| Right rail Images (`things-rail.mjs`, `rails.css`) | Cover thumbnails; image opens new tab, containing message link navigates | Already thumbnails; unchanged, including rail/sheet scroll and visibility |
| Reader reply and New message, inline or sheet (`reader.mjs`, `inline-composer.mjs`, `image-rows.mjs`) | 2.75rem cover strip; image opens new tab and existing overlay opens options | Already thumbnails; unchanged, including Remove, blocked-send choices and writing |
| `#img` in both composers and Notebook Text/Cards (`image-pick.mjs`) | 2.75rem cover thumbnail opens new tab; row words / writing's arrows and Return pick | Already thumbnails; unchanged |
| Notebook attachment list, Text/Cards, sheet/full page (`notebook-page.mjs`) | 3rem contain thumbnails, with Retry/Remove separate | Existing convention; unchanged |
| Notebook card image, reading and in-place writing, sheet/full page (`notebook-page.mjs`, `deck-page.mjs`, `aim.css`) | Large clickable picture, up to 14rem high; image opens new tab; separate × | 3rem contain thumbnail; retain caption/state, new-tab act and × |
| Notebook image line in Reader at a revision / outcome page in place (`page-image.mjs`, `aim.css`) | Large clickable picture, up to 28rem / 60dvh; caption under it | 3rem contain thumbnail; retain caption and 651 action; missing page attachment reads nothing |
| Reader source attachments, messages and Notebook revisions (`app.mjs:sourceAttachments/attachmentControl`) | Named Open button reads verified media, then shows image in place and Download | Add 3rem contain thumbnail alongside the same Open; new-tab thumbnail follows 651 |
| Set-aside reply whose words stay on its line (`app.mjs:showPending/attachmentControl`) | Each attachment has Open, same in-place/Download act; Undo and Copy separate | Same shared thumbnail presentation for verified image descriptors; current review/owner scope retained |
| Sent to you by name → Read it here, for a topic no longer readable (`attention.mjs`, `app.mjs:sentAttachment/attachmentControl`) | Read exact permitted message first, then attachment Open | Same shared thumbnail presentation only after source is read; keep exact-message permission and Open |
| New topic opening (`opening-view.mjs`) | Filename/state, Retry upload and Remove; no image-opening button | Action controls stay as they are; no arbitrary thumbnail on Retry/Remove |
| Review versions, retained image copies (`app.mjs`) | Check confirmation, discard/recover/change choices, named metadata | Recovery actions stay as they are; no preview fetch of superseded bytes |
| Add image / Paste image / Choose file / generic image marks and glyphs | Generic actions or decorative marks | Unchanged; no particular image to depict |
| Image shown after explicit Open (`attachmentControl`) | Passive in-place image plus Download | Unchanged; this result is not an image button |

## Boundaries

An id-only or non-inline descriptor keeps its existing named Open fallback;
this pass does not add descriptor discovery or change media authority. A future
surface without an existing verified descriptor/loader is outside this bounded
visual pass, rather than permission to fetch a private or superseded image.
The inventory is source inspection, not runtime coverage. No tests, syntax or
compile checks, browser/native/Pool runs, review or server processes are
authorized before Tony's feel approval. Coordinator hosts the committed
candidate off-copy after return.

## Test/build stage under warp 9078

The 9078 order advances the exact source preview `932856a663ddeb1d6c48346d2a4deab30763c0d2`
to tests. It does not record physical-phone testing or change the preview default.
The live97 source is not merged here. Product source remains the preview's.

Own cases include `item 653` in their reported names:

- `tests/ui_image_buttons_653.test.mjs` checks the actual shared attachment
  control's verified qualification, exact source/revision/id/digest cache key,
  queued-read cancellation and late-read rejection, plus separate Open actions.
  Exact source mutants remove the before/after guards. These component doubles
  make no claim about native input or browser layout.
- `tests/test_item_653_fixture.py` uses the private fixture's real Store commands
  to attach an optional image to its existing lost-topic named-message case.
  It checks that the exact named source remains readable while its topic is denied.
- `tests/image_buttons_653.mjs`, registered in `native-compose`, captures actual
  original-source reds and unmodified before images, restores exact preview
  source, then exercises the changed surfaces in both engines. The cases cover
  each width/theme, Notebook cards and revisions, source thumbnails beside Open,
  retained replies and permitted Read it here, as well as source read states.
- `tests/notebook_images_653_native.mjs`, registered through the existing
  `native-notebook` and `native-webkit-notebook` owners, keeps the contain square
  in sheet/full-page normal, busy, refused/recovered, save-error/recovered,
  read-only, empty, missing and read-error states. State injection happens at
  transport boundaries; writing and control activation use native input.

Geometry allows 2 CSS pixels of layout rounding; touch targets allow 0.5px.
The original large-image presentation remains well outside those tolerances.
No software keyboard or physical iOS pass is inferred from emulated touch.
Execution, raw failures, source bindings, inspected images, unreached states and
pool bounds belong to the external REPORT.md and ACCEPTANCE.json for this stage.
