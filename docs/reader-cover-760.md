# Reader singleton cover (item 760, rulings 9591/9592)

The Reader requests `StackFeed.dossierCover(id, { alone: true })` so an authored
cover on a root with no replies appears in its existing Cover line and sheet.
`dossierCover(id)` retains the ordinary feed default. Both forms use the current
stack's canonical root and cover, including a root above the loaded page.
No authored text, labels, waits, payload or Core policy changes.
