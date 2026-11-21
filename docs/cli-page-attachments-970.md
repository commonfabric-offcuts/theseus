# Save a page attachment from the CLI (970)

Base252 `3d8756b464971dd16b064591e4d6693564768fd5`, delegated by Warp14389.
`aim-next attachment ID --page n-… --out FILE` selects a Notebook page as the
readable source. Exactly one of --page and --message is required. The page
source is Core’s existing exact `{kind:"memory",id:PAGE,revision:N}` open_media reference.
The existing memory_status read resolves the current reference before opening
bytes, without fetching the page’s words. Concurrent edits leave this captured
reference in force; Core checks access again when opening it. Without a revision
option this selects the current page revision at lookup; an attachment
retained only in older revisions does not authorize this current-page read.

Core remains responsible for page visibility, attachment membership, ready
state and verified bytes. CLI retains the same private exclusive new-file
write, no overwrite/symlink replacement, fsync and partial-write cleanup.
No schema or new media/source authority. The broker uses the same existing
open_media transport, with no filesystem path sent to Core.

Plain saved output is unchanged. JSON from --page names page_id beside the
attachment descriptor and path. --message’s JSON message_id and bytes remain
exactly as before. Missing/both source selectors refuse before output files.

Checks publish isolated real media and pages, prove the current Core read
already succeeds, then retain the CLI red. Current-revision membership,
unreadable page, existing file, source exclusivity, message compatibility and
actual broker routing are exercised. A wrong page-source routing mutation
must fail and restore byte for byte. No browser or live record/tool edits.

Verification: ten new cases pass default discovery, including exact bytes,
JSON, current-revision/captured-reference race, unreadable/unattached sources,
no overwrite, source exclusivity, unchanged message reads and actual broker
source forwarding. Three applied controls (exact baseline CLI, wrong page
source kind, omitted source scope) fail and restore byte for byte to green.
Initial unversioned fixture and intermediate lookup-output diagnostics are
retained separately; the accepted baseline control uses the final exact-ref
fixture and unchanged252 CLI. No original assertion changed.

The broader101-case CLI/media cohort has96 pass and5 existing upload-post
failures. All five reproduce in pristine252’s91 cases; that baseline also hit
the known ninth-client capacity race handled by separate approved978. No new
failing identity/cause appears in the candidate. Full raw failures remain,
none waived; this is not a broad all-suite-green claim. No browser, model
turn, schema or Core/media authority change is claimed.
