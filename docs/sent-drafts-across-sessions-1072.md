# Sent drafts retire across sessions (1072)

Intake: release 336, `c3bdd6e69165aff33948f8ba61734cf6952c3c10`
(tree `5d928e18fd5f8b6c11965d5a07bcd1f6047aa96d`), in the separate
`core-lane7/1072-sent-drafts-336` worktree. Fable's 17034 handoff lifts the
temporary wait behind 1040. This piece lands after 337. Warp owns carry, merge
and deployment; Fable owns canonical records, freeze and stage.

## Experience and identity

Two real app sessions of the same human share one isolated Core. A reply typed
and saved in A is opened from Core in B, with the same source, topic, draft ID,
revision and generation. Sending it in A retires that exact sent writing in B
and folds B's inline card composer. Unsent writing keeps the composer open and
remains recoverable. Tony's 16920 screenshot suggests a stale copy but does not
establish its lineage; the reproduction must establish the actual cause.

Retirement requires a committed send for the exact shared draft generation and
revision. Preparation already clears Core's draft and rotates its generation;
an empty successor or a missing saved-writing lamp alone is not a send receipt.
Send can first save the unchanged writing at a later revision while finalizing
its ordinary Tell choice. Record and prove that intervening save chain and the
submission's actual revision; do not assume B's earlier read revision is the
prepared revision. Identity, generation and the exact chosen writing still
have to match. The first native producer stopped on that incorrect test
assumption before reaching its fold assertion; retain it as an oracle failure.
Preserve newer local edits, another source's draft, image work, prepared or
uncertain submissions, source identity and authority. Do not clear recovery
storage broadly or give one session's send authority over unrelated writing.
An unconfirmed refresh keeps writing visible. Existing save/prepare/send
operations retain their identities and EditorSession remains their sole owner.

## Owners and bounded reads

Read the current owners before changing them: Core `aim_next/drafts.py`,
`web/editor.mjs`, `web/session.mjs`, `web/app-session.mjs`,
`web/card-replies.mjs`, `web/app.mjs`, `web/topic-views.mjs`, and the recovery
journal/cleanup owners. The initial hypothesis is that a saved-writing change
repaints the card but never reconciles its already registered draft. This is a
hypothesis until the real-entry red proves it. Native `baseline-cft-2` now
proves it on Chrome for Testing 148: B received two real retired-writing
answers, Core committed the exact generation at revision 2 after the unchanged
revision-1 save, and B kept the sent words visible. Both never-sent fields and
Core writing survived. The phase failed at its named fold assertion with
stable source maps and verified browser/fixture cleanup.

The fix uses existing views only. Each open card captures the source-scoped
submission `through` watermark at registration. A `yours:<message>` freshness
refresh checks only that registered source's writing. On a new generation,
read new submission metadata after its captured watermark, at most 20 rows per
pass, and the exact matching submission. A continuation remains a pending
freshness read; no whole-actor send history is loaded. Committed sends are
checked against the same source/topic/draft/generation and an equal or later
prepared revision, bracketed by unchanged runtime authority. A clean older
acknowledged revision of that same generation can retire; a dirty or newer
local revision cannot. No new Core view, command, schema or migration is needed.

The existing session queue owns replacing the proven stale writing with Core's
current draft and keeping that transition in the journal. Recheck the complete
captured writing and authority after reads and while the journal is saved.
Newer input, unfinished sends, selected local image work or failed persistence
keeps the composer open. Canonical image references imported from Core have no
local bytes to discard; retire only those exact passive references with their
sent writing. Fold the matching card only after the transition is durable and
it still holds no writing; do not steal focus or close another composer.

Use the existing actor/source/topic scoped writing invalidation and bounded
editor-state/submission reads. Do not reread the outcome list or unbounded
submission history. If the reproduction requires a new Core view or shape,
extend this contract with its exact arguments and identity proof before that
edit. Coordinate the app/card integration with Page5's 1073 and Page6's 1077;
their separate worktrees and active phases stay untouched.

## Verification and retained evidence

Before product edits, retain a failing real app case on the intake source:
native typing/quoting and Send in A, B reading the actual saved writing, exact
Core draft/submission/send lineage, and B remaining open with the stale copy.
Keep a never-sent control in both sessions. Add controls for newer B writing,
another draft, and preparation with no committed send. Assert both the visible
fold and the retained writing/journal state, not just a lamp.

Build small below-browser checks around real Core identities and the actual
registry/card owners. Run corrected native proof in isolated Chrome for Testing
and WebKit, then actually restore the old product owner files, observe the
same named regression, restore the exact corrected bytes and rerun. Retain
failed setup phases as failures, not product reds. Record source body hashes at
phase start/end, actual responses and receipts, Python/runtime/cache identities,
and scoped read traffic. Each Python phase uses its own cache directory.

No browser or fixture workload starts while Page5 owns 1073 or before Page6's
earlier 1077 request is handed off. Announce the owned slot and run one relevant
workload at a time below load 12 on 18 cores. Close browsers through
Browser.close, end the fixture by EOF, verify clean exit, absent owned PIDs and
private profile, and TCP refusal before releasing the slot. User Chrome stays
free. State uncovered cases and defaults explicitly; do not claim 1046's
single-session closure proves this cross-session behavior.
