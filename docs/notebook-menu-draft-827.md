# Notebook menu actions preserve Private Draft (827)

Star/Unstar, opening or canceling Rename, and saving a renamed title leave a
Notebook page's current `draft` value unchanged. This holds for both true and
false, in Text and Cards, over the topic and on the full page. Opening and
closing the menu also changes no writing. Only the explicit Private Draft
action (and its existing Undo owner) changes this flag.

The existing NotebookWriting revision, journal, merge, authority and permission
owners remain in use. A star changes only this reader's star; Rename keeps the
exact body, attachments, references and Draft flag in its revision. A menu
selection never substitutes a second write stream or a default draft value.

Reproduce on exact release210 before changing product code. Retain the shipped
792 shared-menu owner and 878 Private Draft guards. Check actual native taps
at phone width, with desktop reference, both themes, Text/Cards and sheet/full
surfaces, with Core flag/body/revision readback and actual reload. If210 already
holds the behavior, report that fact and preserve it with focused checks rather
than introduce a duplicate fix. DOM-only handler checks make no native claim.
