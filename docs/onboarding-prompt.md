# Outcome onboarding prompt (item 790)

Contract written before implementation, on live99 source
`a34f72f0b3555a274fd4ae5adb07123ff89c3a85`, under Tony9784 option 1,
Warp9806/9837. This is an interactive agent handoff. Item 791 is excluded.

The outcome page has a quiet ⋯ with **Onboarding prompt…**, visible only to
its current owner. The row opens a sheet with Codex and Claude choices. A
choice reads the current prompt from Core and immediately attempts to copy
it, without a preview approval. The same sheet shows the exact readable,
selectable text. A successful copy announces “Onboarding prompt copied.” in
a toast and in the sheet. Clipboard refusal says copying failed, preserves
the text for manual selection, and offers Retry copy. Retry reads current
facts again. Read refusal clears previous text and offers a read retry; it
never claims a copy or displays a transport error containing supplied data.
Closing or changing ownership invalidates an in-flight read. A late clipboard
result cannot repaint a closed or superseded sheet. This action sends no
command, creates no identity, and saves no preference.

`onboarding_prompt {workspace_id, variant}` is a read-only Core view, shared
by HTTP and the CLI. `variant` is `codex` or `claude`. Core checks workspace
access and exact ownership before reading context. A coordinator, team member,
participant or outsider cannot obtain it. Unknown/extra arguments fail closed.
It reads one transaction snapshot using explicitly named columns: outcome
title/purpose/owner, at most 100 team members, 100 open unarchived topics,
32 waits per topic, and 100 Now item short titles. SQL is scoped to that
outcome and uses LIMIT plus one to detect truncation. Truncated sections say
so and point to the existing CLI for the remaining facts. Topic state notes
explain waits; wait names include both explicit state waits and outstanding
asks, without reading message bodies or private whispers. Release membership lookup is limited to 101 newest records; if more exist,
Now says its context is unavailable rather than guessing. The final encoded
prompt is capped at 120,000 bytes, below the Core summary limit. No broad pipeline
reconstruction, whole-instance actor listing, Notebook-body reading or runtime
credential-file access is used. Theseus currently has neither a rules setting
nor a pinned-note relation (workspaces schema, memory schema and page settings
inspected at this base). The rules section explicitly says this context is
unavailable; it does not infer rules from arbitrary Notebook pages. No schema
or persistent setting is added. If those sources are introduced later, they
need an explicit authorized source contract before inclusion.

Only the selected textual facts enter the formatter. They are checked for
credential-shaped material before any response is returned; unsafe context
refuses the entire prompt with generic words, without echoing the value.
This guard follows scoped authorized reads, not an unscoped export followed
by filtering. It cannot identify every possible human-written secret; no
claim of universal secret detection is made. Synthetic negative fixtures put
canaries in permitted text and unrelated private records. No credential
values or real sign-in paths belong in prompts, UI, fixtures or evidence.

The prompt gives the outcome facts, explains their bounded snapshot, and
points to `docs/agent-cli.md` and `docs/agent-guide.md`. CLI examples use a
literal owner-supplied placeholder, never a real sign-in location. They cover
binding, topics, read, pipeline, post, reply, explicit asks/tells and retaining
operation identity on uncertainty. One owner setup step uses the existing
Team → + Invite agent flow to grant a named agent identity and securely
configure its CLI sign-in separately. The prompt does not grant access itself
or tell an agent to use somebody else's identity.

Both variants use generic shell capability language. Only their instruction
file guidance differs: applicable AGENTS.md for Codex; applicable CLAUDE.md
for Claude. No model names, API differences, unsupported tool names or claims
that Claude cannot read AGENTS.md. Primary sources fetched 2026-11-18:

- [OpenAI: custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
  grounds the instruction-file wording. OpenAI Docs skill read at
  `/Users/commonfabric/.codex/skills/.system/openai-docs/SKILL.md`.
- [Claude Code: project memory](https://code.claude.com/docs/en/memory)
  grounds CLAUDE.md wording; it also documents optional AGENTS.md support.
- Local `docs/agent-cli.md`, `aim_next/invite.py`, `docs/agents.md`,
  `aim_next/store.py`, `aim_next/topic_state.py`, `aim_next/validation.py` and
  `aim_next/pipeline.py` ground identity, scope, read/post and Now contracts.

Focused Core and Node checks cover owner denial, current state, bounded
sections, both variants, unsafe context, no unrelated/private facts, clipboard
success/refusal/retry, stale responses and no extra approval step. Actual
source mutations must apply once, fail the relevant check and pass after
restore. Each Python phase uses its own effective PYTHONPYCACHEPREFIX under
CPython 3.9. Node runs with concurrency 1; one local workload at a time.

Native cases are literal `^reading item 790`, connected to native-reading and
native-webkit-reading. Laptop and phone prove owner menu, both variants,
actual browser copy/paste, readable failure and retry, current facts and
non-owner absence. Generated browser expressions are syntax-checked below
the browser. Dry enumeration precedes freezing a clean commit. Budget:
0 prior starts, 2 allocated (maximum 1 Chromium, then 1 WebKit), 16 unallocated
under the 18-start ceiling. Read raw Chromium results before requesting
WebKit at the same frozen head. Product fault requiring an edit stops this
round; no local browser/server, full suites, retries or frozen edits. Pool
submission is requested through the coordinator; this builder never pushes
or reads pool credentials. Independent review follows return; this document
and builder report do not approve the piece.

## Composition on live 120, 19 November

Warp11182 authorizes this piece on live120 (5e62cd5c), using focused quick
checks and an independent source read, with no preview or browser run.
The three original commits through fdaba199 are composed together. The only
conflicts are integration points: retain every current Store mixin and add
Onboarding, retain the native suite imports and add its onboarding import,
and retain current CSS before appending the onboarding rules. No schema,
record mutation, permission relaxation or clipboard behavior changes.

The old Review3 hold was the selected-paste recorder assertion. Auditor10103
approved its correction at fdaba199: raw-only success asserts the selected
raw record rather than a failing unselected command record. Composition and
its fresh source read remained; there is no outstanding product finding in
that review. The current permission boundary is still owner-only before any
context read, and the six focused Core controls are retained unchanged.

Historical browser results remain historical: original Chromium2/6,
WebKit6/6, then diagnostic Chromium7/7; the latter proved native editing-command
paste when raw Meta+V did not paste. The instrument correction adds no new
browser observation. No browser, physical-phone or final clipboard proof is
claimed for this composition. The prior WebKit Claude-current-retry gap and
five missing native source captures remain as documented in the earlier
investigation and selected-record contract.

Defaults remain explicit: owner-only entry, Codex/Claude choice with current
facts read on every copy/retry, readable text when clipboard permission fails,
and one separate owner identity-setup step. Rules context is stated unavailable;
ordinary Notebook pages are not inferred to be rules. At more than100 release
records, bounded Pipeline Now context is stated unavailable, never guessed.
No credential file is read or copied and no autonomous runner starts.

Current focused comparison: live120 Core18/18 and Node116/116; candidate
Core24/24 (six added onboarding checks) and Node138/138 (22 added onboarding
and paste-recorder controls), all exit0 with zero failures or skips. These
are focused checks, not a browser or complete-suite claim. The final source
also contains the test-only 832 merge6202e0c3; every Core/web byte is unchanged
by that rebase, and its inline fixture passed its own396 checks. Evidence is
coordinator-20261117/790-live120-11182/QUICK-COMPARISON.json.
