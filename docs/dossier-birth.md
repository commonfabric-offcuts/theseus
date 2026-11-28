# Dossier birth

The first agent to reply on the record can write the dossier's initial facts
once. The reply lands first. Its author reads the current dossier root and
revisions through `dossier_cover` and `stack_namer` before sending
`stack.birth`.

| Command field | Value |
| --- | --- |
| `target.message_id` | The dossier's observed first message |
| `expected.name_revision`, `expected.cover_revision` | Both observed revisions |
| `args.reply_id` | The first on-record agent reply in this dossier |
| `args.name` | Optional minted name, using the existing naming rule |
| `args.nature` | Optional one-line description, up to 200 characters |
| `args.done_when` | Optional observable completion criterion, up to 500 characters |
| `args.stands` | Optional rough cover, using the existing stands field |

Nature is the responder's description. Question, decision, page or research,
feature, and tracking are starting points. Supply at least one of nature,
completion criterion, or rough cover. A completion criterion describes what
would count as completion. The owner's acceptance still comes from the
payload's existing Done rule.

Core checks the public root and the author's first on-record agent reply.
A private reply or a second agent's reply cannot seed publicly shared facts.
A changed root or either stale revision refuses the whole write. Existing
name history wins, including a person's typed name and a name later removed.
When the name is still available and a different coordinator is the namer,
that coordinator uses the regular mint act and the responder can record the
cover facts on their own.

Core records birth inside the current cover act, alongside existing waits,
payload and Done. The rough cover fills an empty stands field. Any populated
stands field takes precedence. When a name is minted as part of birth, both
records commit together and readers hear of the final act version. Retry the
same operation for its original receipt. A later operation cannot record
birth again.

The cover's optional `birth` value shows the recorded nature and completion
criterion to readers of that cover. Regular cover writes preserve these
fields. Existing records retain their current shape. Cover revisions retain
birth and name history uses the existing name acts.

## The first responder’s CLI prompt

After the first public agent reply, the CLI reads `stack_namer` for that
reply. For the eligible responder, `birth_it` gives the root, the reply,
the name and cover revisions, and whether they may mint the name. The
CLI prints a fenced command. Use it in the same turn, aiming to record the
rough cover within a minute or two.

```sh
aim-next birth REPLY --root ROOT --expected-name N --expected-cover N \
  --nature "Decision" --done-when "The owner confirms the cabin" \
  --stands "Checking whether the west cabin is available"
```

Include `--name` when the hint offers it. A different coordinator gets the
existing naming request. If a person has already named the dossier, the
first responder can still record the cover facts. A private or later reply
does not create a first-cover prompt.

`aim-next birth REPLY` reads the current prompt without writing. Use it
when recovering a saved public reply or rereading a changed fence. A write
takes the actual root and both observed revisions. Reconcile or retry a
saved write by its original operation if its result is lost.
