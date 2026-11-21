# Applied reaction buttons (882)

Every pressed message-bar button and the Reader's thumbs-up beside Send use
the dossier cover's existing `--stack-cover-inset` token in one CSS rule.
The token is defined on `:root`, with light/dark values in `stack-look.css`,
so the fixed bar outside a dossier inherits it. Hover alone keeps its existing
fill. A confirmed Go ahead or Don't in the bar shares the pressed treatment.

The existing reaction owner still paints `aria-pressed` from recorded state.
An unresolved or refused press does not change it. An already applied thumb
stays applied while taking it back is pending or refused. No JavaScript,
command, timing, delivery or schema change is part of882.

The focused Node check has a source-contract red on actual158, reads the
actual bar/Reader paint helpers, and runs held/refused/confirmed reaction
responses through their existing client owner. An applied selector mutant
that embosses hover alone must fail, then pass after exact restoration.
These are source/handler checks, not native pointer or visual acceptance.
