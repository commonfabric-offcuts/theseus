# Item 803 — every admitted message has a dossier frame

Source-only workbench based on live105
`5c15b7b04e48bf4db38de43a7a1dd00faca95595`, under Tony10218/10224 and
Warp10219. Rendering only; the parallel stars builder owns loading and ordering.

Every gathered stack gets dossier chrome, including an unplaced lone root,
a lone reply while its original loads or is refused, gathered-head fallback,
and any residual apart card. Only new keeps its existing message predicate
inside a frame. A singleton keeps its content and existing message fold; it
never becomes a head-only dossier. Its title is independent of its card, so
a between-others fold cannot hide the title. Existing card nodes, IDs,
authors, order, anchors, writing and focus are retained.

The frame identifies the canonical dossier separately from the actual loaded
head entry. Only an actual canonical head supplies original text, author,
marks or folder colour. Otherwise use the admitted canonical name or the
neutral label “Dossier”; never present a reply as the original. First-message
Reply and menu are disabled without that original; the existing canonical
Reply in fallback and Retry remain available, with loading distinguished from
unavailable. Rename and placement use the existing canonical-root handlers.
Apart frames do not duplicate a cover already drawn elsewhere.

Preserve actual-head fetching, source-root frontier handling and filled/apart
removal, folded sender handling (793), and 656 removal. No app/loading/Core,
migration/server/tool/CI changes. No tests written or run, runtime execution,
browser, pool, mutation checks, review gate, delegation, push or deployment.
Delivery is a clean frozen commit with source hashes and full diff; all runtime
and native behaviour remains unrun for root/auditor to assess.
