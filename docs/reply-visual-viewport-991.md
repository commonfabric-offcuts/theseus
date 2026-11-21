# Reply writing above the keyboard (991)

Base275: `712e21e0970fb3982a447a091fc25315e2b4032f`.
Tony14570 and Warp14573 require the focused inline reply and pencil-sheet
field, including footer and Send, to stay inside a phone's visual viewport
after keyboard resize and visual pan, including a second resize.

Keep ComposeBar's persistent keyboard/viewport owner and its CSS variables.
Coalesce changed viewport and writing geometry after layout. Read the live
focused main textarea at that point; ignore hidden, retired, readonly and
unrelated inputs. Reveal its field box and visible footer/act through its
own scrolling container, honouring scroll padding and an8px gap (larger scroll padding wins).
No new adjustment on an unchanged laptop viewport. Existing normal opening,
panel, Reader/private-note,975 fitting and writing/send owners are preserved.
No Core, schema, saved layout or editor/selection change.

Retain actual275 native shrink failure before a fix. Check actual390px
visualViewport height changes and a second shrink in Chromium and WebKit,
with focused field/footer geometry and desktop controls. Same-height offset
changes and stale/blurred fields have handler geometry/lifecycle controls. Geometry/lifecycle ports below the browser are not native evidence.
Desktop engines with mobile settings and real viewport resize are not a
physical iOS/Android keyboard. Tony's phone after landing remains the
dependable check; Warp owns that handoff. Freeze on meaningful greens for
one diff/test read; Fable owns binding/stages and Warp carry/deploy.
