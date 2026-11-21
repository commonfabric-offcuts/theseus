# Image menu in the topic rail (998)

The Images section uses the shared menu for right-click, Context Menu / Shift-F10,
and a stationary phone hold. Ordinary thumbnail clicks and Return still open the
image. Focus returns to the selected thumbnail. Moving or scrolling cancels a pending
hold; navigation fences pending menu reads and actions. The menu uses existing menu glyphs and sheet.

Warp14687 defines four actions, all client-only: Copy link copies a stable image
address on the configured share origin; that page reads the carrying source and
verified media through existing authenticated APIs. Copy image writes PNG bytes
to the clipboard (other supported image formats are decoded to PNG); failure is
said, never success. Download saves the original verified file, retaining its
name. Archive its message uses existing stack.aside for the carrying message's
dossier, for this reader, including its replies. The row says this scope. It does
not delete the image or change topic_images. Undo restores the previous through
and order with the committed aside revision, so it cannot undo a later change.
An already archived message offers Bring back its message. A starred dossier
stays protected by the existing Core rule. Unknown Archive and Undo writes retain the same request when the menu is reopened.
A final recorded refusal allows a new plan from the current revision.

No Core, schema, endpoint, Finder reveal or image-specific archive is added.
Finder reveal needs a separate judged piece after987/757: authenticated exact
Host/Origin plus source/media access, verified export path, local-device proof
(not loopback peer alone behind Tailnet Serve), explicit remote Download.

Build base: release280 /2a42f34a8cf0e207905247acb237747608710a0a, fast-forwarded
from the clean279 intake. 996 owns ThingsRail headings/disclosure/Left;998 owns
imageSection and its menu reset. Browser evidence is isolated fixture data only.

Checks: ui_image_rail_menu_998.test.mjs tests routing, source validation, original
media verification, stale action fences, clipboard refusal and fenced archive/Undo.
image_rail_menu_998_native.mjs proves native doors, focus, normal opening, copies,
download and actual isolated Core archive/Undo at390/1280 in both looks and themes. Chromium
proves native phone hold; WebKit's driver has no sustained finger gesture, so its
keyboard/right-click/tap checks are reported separately from the shared hold unit
checks. Actual applied controls must fail and exact restoration must pass.

## Validation on the isolated candidate

- Owner checks:8/8. Applied mutations removing the post-media navigation fence,
  substituting the old Undo revision, and breaking image-route shape each fail
  their intended test. Exact byte restoration passes8/8.
- Chromium11/11 and WebKit11/11:8 layout/theme cases plus JPEG/GIF/WebP
  conversion cases per engine. Native image clipboard readback decodes48×32
  PNG and1×1 converted images; WebKit reads its actual native paste files.
  Downloads match the original fixture bytes and names. Copied image links
  reopen and reload; a source that does not exist shows no image. Archive and
  Undo are read back from isolated Core, and Bring back is offered in between.
- Surrounding13-file cohort on pristine280:214 total,213 pass,1 fail. Candidate
  plus the new owner file:222 total,221 pass,1 fail. The full normalized failure
  is identical:844’s outline fixture omits the current handle needed by bind.
  These runs do not claim a fully green broad suite.
- Retained native red evidence includes the initial incorrect current() call,
  the phone overlay covering the menu, and a long-press release activating a
  row underneath the finger. The final candidate corrects all three.
- Each native run closes its owned browser through Browser.close, checks all
  observed PIDs and the temporary profile are gone, ends the fixture by stdin
  EOF with exit0, and checks its PID and port are gone.

Evidence lives under the auditor’s evidence/998 directory, including commands,
source and harness hashes, raw diagnostics, screenshots and normalized cohort
comparison. Physical-device acceptance and native WebKit sustained-finger holds
remain unrun. Grid arrow navigation is outside998 and retains its existing rule;
996’s section-heading/Left behavior belongs to its separately landed change.
