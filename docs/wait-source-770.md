# A cover’s waiting pill opens its source (item 770)

Fresh carry of the previously approved 73b68359 onto release 134, on Warp
11459 and 11489. The old preview/native workflow is superseded; no browser.

A manually written cover wait may record message_id. Core checks that a named
source belongs to the current dossier and obeys the existing payload visibility
and whisper rules. The CLI records the supplied MESSAGE before resolving the
canonical dossier root. Omitted or null keeps a source-free wait; existing
records are never backfilled and no schema changes.

Warp 11508 names the default destination: the readable message_id, otherwise
the readable ask_id already recorded by item 738, otherwise the current
canonical dossier root. Core applies the same VISIBLE check to both source
fields for each reader and omits unseen IDs from the projection. The answer
controls and go_ahead/revision fence are unchanged. There is no second source
lookup in the browser.

Each sheet wait uses that destination. The shared summary pill follows the
first wait in recorded order; its count, per-person words, options, default
and answer controls remain. Existing link navigation handles destination
access and writing guards. Modified clicks keep native link behavior.

Root fallback uses current stack_position.root_id, or the singleton head,
and participates in the render key so joining a dossier repaints the link.
The Reader lookup can find a root outside the loaded page. The full cover
sheet, singleton exposure, refresh controls and ordering keep current rules.
A Reader repaint of unchanged writing keeps its active selection, otherwise
restores the saved draft selection; this is a DOM/handler claim until a native
check is specifically authorized.

Named carry resolutions: cover_values.py combines source filtering with
738’s answer fence; dossier-cover.mjs retains per-actor words, answer controls
and 783 refresh fields while adding links; reply-stacks.mjs retains the current
cover-first composition while passing the canonical root. Historical native
results from the old branch are not acceptance evidence for this source.

## Current carry evidence

Base 134: 303a867f83bbb7267415b909728265f7c25a4ce9. Seven new Core checks
and five new Node checks pass and fail on the old source first. Twelve actual
source mutations each fail an intended assertion; restored controls pass all
seven Core or five Node checks, with independent Python bytecode directories
and exact byte restoration. Native selection/keyboard behavior is not claimed.

Seven existing Node families pass 287/287 on 134; the carry plus the five new
checks passes 292/292. Three Python families have 78 tests on 134: 41 pass and
37 already fail (36 legacy asks omit required ask_wait; one CLI assertion
expects lowercase default instead of the current Default). The carry adds
seven passing checks: 85 total, 48 pass, the identical 37 failures. These are
reported as existing failures, never as a green full suite. No new failure.

The three conflict resolutions are named above. Raw evidence, baseline and
candidate logs, applied mutation script and restoration hashes are in
fable-tools/coordinator-20261117/770-next11500. No preview, browser, hosted
CI, full-suite run, schema migration, or historical native acceptance claim.
