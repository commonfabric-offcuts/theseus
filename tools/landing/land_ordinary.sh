#!/bin/bash
# land_ordinary.sh ITEM CARRY_WORKTREE
# The one way an ordinary piece lands, fail closed at every step, each step's real exit enforced by `step` (kit.sh),
# each attempt's command/exit/output kept read-only under <folder>/attempts/<stamp>/ with phases.txt naming every
# phase's exit or that it was not reached:
#   the preflight must pass before the suite starts;
#   the whole node suite on the carry against live must add no failure (node_suite_check.sh's exit);
#   the preflight must return 0 and print PREFLIGHT OK; the landing must return 0 and print DEPLOY EXIT0.
# The whole landing holds the lane lock (tools/lane_lock.py landing): a pending landing admits no new lane run, and the
# runs already open drain before its suite starts. Once the deploy succeeds, publish.sh posts the dossier and the card;
# a publication that fails is finished by running publish.sh alone, with no test or deploy run again.
set -u
. "$(dirname "$0")/kit.sh"
ITEM="$1"; W="$2"; LIVE=$(cfg live) || exit 2; POSTS=$(cfg posts) || exit 2; F="$(cfg work)/$ITEM-land"
# The deploy this landing makes replaces the live checkout's files under it, so the kit runs from the seat's clone.
case "$K/" in "$LIVE"/*) echo "STOP: run the kit from your clone, not from the live checkout $LIVE"; exit 2;; esac
[ -d "$F" ] || { echo "STOP: no landing folder $F"; exit 2; }
[ -d "$W" ] || { echo "STOP: no carry worktree $W"; exit 2; }
# The folder's input contract, checked before the suite so a missing or changed input costs nothing.
/usr/bin/python3 -I "$K/check_inputs.py" "$F" || exit 2
# The dossier and the card are drafted before the landing starts, so a live release never waits on its publication.
for draft in "$POSTS/dossier-$ITEM.txt" "$POSTS/card-$ITEM.md"; do
  [ -s "$draft" ] || { echo "STOP: write $draft before landing (the runbook says what it holds)"; exit 2; }
done
if [ -z "${LANDING_LOCK_HELD:-}" ]; then
  export LANDING_LOCK_HELD=1
  exec /usr/bin/python3 -I "$K/../lane_lock.py" landing --label "$(spec "$F" release) $ITEM" -- bash "$K/land_ordinary.sh" "$@"
fi
PHASES="preflight-early node-suite preflight land"
A=$(attempt "$F" "$W" "$LIVE") || { echo "STOP: cannot open a receipts folder under $F/attempts"; exit 2; }
echo "receipts: $A"
# The preflight reads the installed guard's file policy and the release record without merging; run once here so a
# refusal there costs seconds, not the whole suite, and again after the suite against what is then live.
step "$A" preflight-early "PREFLIGHT OK" /usr/bin/python3 -I "$K/land.py" "$F" --preflight; RC=$?
tail -3 "$A/preflight-early.out" 2>/dev/null
[ "$RC" = 0 ] || { phases "$A" $PHASES; seal "$A"; exit 4; }
mkdir -p "$A/node-suite-tap"
step "$A" node-suite "" bash "$K/node_suite_check.sh" "$W" "$LIVE" "$A/node-suite-tap"; RC=$?
tail -4 "$A/node-suite.out" 2>/dev/null
[ "$RC" = 0 ] || { phases "$A" $PHASES; seal "$A"; exit 3; }
step "$A" preflight "PREFLIGHT OK" /usr/bin/python3 -I "$K/land.py" "$F" --preflight; RC=$?
tail -3 "$A/preflight.out" 2>/dev/null
[ "$RC" = 0 ] || { phases "$A" $PHASES; seal "$A"; exit 4; }
step "$A" land "DEPLOY EXIT0" /usr/bin/python3 -I "$K/land.py" "$F"; RC=$?
/usr/bin/grep -E "^(STOP|DEPLOY EXIT|RUNNER POLICY|STAGE REFUSED|11-release|06-migrate|Traceback|[A-Za-z.]+Error)" "$A/land.out" 2>/dev/null | cut -c1-160 | tail -8
/usr/bin/grep -q "^STAGE REFUSED" "$A/land.out" 2>/dev/null && echo "WARNING: a record stage was refused after the deploy decision; read $A/land.out and reconcile the record"
phases "$A" $PHASES; seal "$A"
[ "$RC" = 0 ] || exit 5
echo "LIVE $ITEM as release $(spec "$F" release) at $(git -C "$LIVE" rev-parse --short HEAD) $(date '+%-I:%M %p')"
bash "$K/publish.sh" "$ITEM" "$A"; PRC=$?
echo "LANDED $ITEM $(git -C "$LIVE" rev-parse --short HEAD) $(date '+%-I:%M %p') receipts $A"
# The carry worktree is finished once the release is live; a plain remove refuses a dirty tree, which then stays.
git -C "$(cfg clone)" worktree remove "$W" 2>&1 | tail -1; [ -d "$W" ] && echo "KEPT carry worktree $W" || echo "removed carry worktree $W"
[ "$PRC" = 0 ] || { echo "NOT PUBLISHED: finish with: bash $K/publish.sh $ITEM $A"; exit 6; }
