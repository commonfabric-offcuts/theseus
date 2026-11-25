# Bounded current context in onboarding (1222)

The existing owner-only `onboarding_prompt` read retains its permission check,
identity setup, secret screening, snapshot and 120,000 encoded-byte limit.
It adds no view, command, schema or runtime authority.

Pipeline owns `_onboarding_now`: at most 101 scoped Now rows and 101 current
Now memberships, with current work considered first when historical rows fill
the sample. At most 100 verified short names are returned. Exact per-item
release indexes written by PieceClock are checked against that one release;
open memberships/stage entries witness current work. Finished items are
excluded. There is no release-history reconstruction. An unindexed, unheld
legacy row in a release pipeline is unresolved, not silently active or empty.
Missing/disabled pipelines, empty results, unresolved rows and truncation have
different words. The snapshot retains workspace/pipeline/item revisions and,
for current work, piece revision and stage-entry identity. A limited sample is
never a complete pipeline inventory; the prompt directs the agent to read it.

Rules come from the existing authorized `current_rule` view, not arbitrary
Notebook pages or private source bodies. Include its policy ID/revision,
Notebook ID/revision, and each displayed rule's ID/revision, summary and exact
source reference (including message offsets). A 20,000-character rules section
discloses omitted rules; the entire selected record is screened for unsafe text
before truncation. Unconfigured and unavailable differ from an empty rule set.

The factual human-ask example reads the source and dossier cover, quotes the
current raw passage, supplies explicit intent, `--no-go-ahead`, literal choices,
an explicit absence of a promised default, root/cover revision and a retained
operation ID. Placeholders are replaced from the actual reads before running.
Both variants retain their shared assignment and separate owner identity step.

Proof uses isolated real Store/CLI records: active work beyond 100 releases,
active work beyond a historical Now sample, exact indexed shipment and legacy
uncertainty, version/source freshness, owner denial, secret/private canaries,
section and byte limits, no record changes and a published ask/linked cover wait.
The normal live/candidate comparison runs complete selected files. Existing
clipboard/native obligations remain separate; this Core change proves no new
browser interaction.
