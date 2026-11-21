# Pencil sheet keys (1018)

Base: live302, `962fb5912fc5efb7c6ff8bbb0db40904e7c6e01f`.
Sources: Tony15153, Warp15156/15157, Fable15160/15162.
Build1: `p-8f0fe45e28634f6c9e94b7b0`, page-lane5.

Option-N is Alt with physical `KeyN`: open the pencil sheet in Note mode,
or switch it to Note. Option-M (`KeyM` with Alt) switches the existing
pencil composer to Message mode. Both work while typing and with the sheet
open or closed; they consume the Mac dead-key/micro-sign event without
inserting it. Switching keeps writing, its selection and the chosen Notebook
destination. Repeated keys do
not restart an opening, and active IME composition keeps its keys.

Plain Return takes the same existing Send path as Command-Return when the
pencil sheet is open or focus is inside its inline composer, provided no
text field holds the caret. This includes Return after clicking Note.
Return in text remains a newline; Command-Return in the writing remains
Send. A nested naming dialog or a select keeps its own Return. Empty,
read-only and busy writing keep the existing Send guards. Other composers,
Notebook editing and reading retain their keys. The guide and Keys legend
name the shortcuts and the Return default. No phone UI or pointer change.

Page6 owns979's card publication/close continuation in `InlineComposer.send`;
this slice owns pencil key routing and does not edit that continuation.
Designer Note-send/Notebook-close animation prototypes stay separate.
Warp owns the independent read and carry/landing, reconciling shared-file
edits; Fable owns binding, stages and source readbacks (15164).

Before product edits, retain native failures on unchanged302. Verify native
Option keys, typing/caret preservation, modal/inline Return, newline and
Command-Return controls, both looks and light/dark at laptop width in Chrome
for Testing and WebKit. Use real isolated HTTP/Core sends and verify exact
recorded content. Keep focused Node regression checks, browser-served source
hashes and strict owned Browser.close/PID/profile/fixture/port cleanup.
No physical-phone, installed-Safari, IME-native or latency claim follows from
desktop engine runs. Freeze at meaningful green and push only the own branch.
