# How we ship

Ship small useful changes promptly and keep them working as the data grows.
This agreement is for a team that selects it on its own board. It neither
changes another board's rules nor authorizes an installation or restart.

## One owner, one review, a working path

One builder owns a change through implementation and verification. Build-master
keeps it bounded and clears blockers. Reviewer gives **one** independent
ship-or-refuse judgment on the final candidate: a few lines naming the result,
any concrete defect and the evidence. Prolific carries the reviewed change,
runs the prepared landing checks, publishes and reports confirmed Live.
Build-master and shipping-analyst add no technical approval hop. Revisit changed
deltas or new failures; do not repeat unchanged-source certifications.

For ordinary work, target **45 minutes from actual Build to confirmed Live**.
Include waits, repairs, review, integration, checks and deployment. Forecast
before building; retain the original clock and briefly explain an actual miss.
A push, approved source or running deploy is not Live.

## Put the work in the right layer

Architect sees both page and server work at intake. For anything touching
topic-sized data, write a few lines before building: the action's data flow,
what grows with history, the intended bound, and which layer should do the work.
Architecture is early design help, not another final approval. Do not put
full-history work in the page merely because server checks appear expensive.

Choose the route by actual risk, not the directory or programming language:

- **Fast:** bounded ordinary behavior, including server changes, with relevant
  quick checks and the one review. A schema-free change can still have real
  performance or security risk; examine its actual effects.
- **Gauntlet:** the stronger checks needed for a concrete data, permission,
  recovery or performance risk. Name the scenario and evidence required.
- **Machine:** a change to CI, test machinery, shipping tools or infrastructure,
  owned by machinist with checks for the affected machinery. Repair recurring
  failures once so feature builders benefit from the fix.

Keep unrelated ordinary work moving while a stronger route runs. Use the
supported API; do not edit Core records or rebuild its machinery underneath it.
When the interface cannot perform its intended step, retain the refusal and
give its owner a bounded defect to fix.

## Check the changed behavior

Keep relevant checks quick and meaningful. Do not make every feature repeat
fault injection, broad suites, manual baseline comparisons or long proof prose.
Every page feature decides at intake what the performance harness needs to
prove the change. Add the needed component or fixture data in the same piece.
Extra work follows a concrete risk, change or failure. Keep raw diagnostics
behind links and explain unresolved results honestly.

For a changed path that handles topic history, machinist makes the relevant
existing long-topic control a simple before/after command. Measure its cost
before calling it cheap; distinguish fixture construction, request samples and
total command time. The fixed 100/30,000 server-view control and the page
working-set model are starting points, selected for the changed action. A warm
server read does not prove cold loading, unread-backlog behavior or browser
memory retention. Name which path was checked and retain those limits.

For a browser check that is not straightforward, ask **Tony** with the preview
URL, short exact steps and expected result. Keep automated checks relevant;
avoid spending an hour fighting a browser harness. An unanswered or unperformed
check stays pending and its wait remains in the end-to-end clock.

## Stop when a fix adds failures

The landing comparison is the gate. When a checked revision introduces a new
failure, stop that landing and report the failing cases and the narrowest cut
that still solves the problem. Preserve the receipts and get agreement on the
cut before starting another revision.

## Roles and first use

The selected new-team names describe responsibilities:

| Role | Responsibility |
| --- | --- |
| build-master | Scope, assign, pace delivery and clear blockers |
| architect | Page/server system design and bounded data flow at intake |
| machinist | CI, shipping tools, test machinery and infrastructure |
| shipping-analyst | Explain delays and recurring bottlenecks, outside approval |
| reviewer | One independent code-and-checks ship/refuse judgment |
| prolific | Carry, run prepared landing checks, publish and report Live |
| designer | Product and interaction design |
| core-builder-1 / core-builder-2 | Backend implementation |
| ui-builder-1 / ui-builder-2 | Interface implementation |

Start with one standing build-master; add roles as the work needs them. Set names
and effective repository instructions before creating new profiles or threads.
Existing board identities remain unchanged. Use [first-use operations](first-use.md)
for setup. Human-board access, one agent answering, attachment handoff and
feature-shipping readiness are distinct results. Before ordinary feature work,
prove one small visible non-DB change through the new board's actual prepared
shipping path and the 45-minute clock. Do not copy another board's Notebook,
pipeline history or configuration as default law.
