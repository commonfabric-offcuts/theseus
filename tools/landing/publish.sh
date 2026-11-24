#!/bin/bash
# publish.sh ITEM ATTEMPT_DIR: publishes a live release from its landing's own receipts in ATTEMPT_DIR: the dossier's
# Evidence paragraph (dossier_evidence.py), the dossier itself, posted once the release record shows the item, the card
# on the seat's cards page, then the seat's on_live command. land_ordinary.sh runs it once the deploy succeeds; run it
# alone to finish a publication that failed, which reruns no test and no deploy. Each run keeps its own receipts in
# <folder>/publish-<stamp>/ with phases.txt, so a failed publication and its recovery stay apart from the deploy's
# result. A part already done (a release-N.id, a card already on the page) is read back and not done twice.
set -u
. "$(dirname "$0")/kit.sh"
ITEM="$1"; A="$2"; F=$(cd "$A/../.." && pwd -P); POSTS=$(cfg posts) || exit 2
REL=$(spec "$F" release) || exit 2
[ "$(cat "$A/land.exit" 2>/dev/null)" = 0 ] || { echo "STOP: $A holds no successful deploy (land.exit); nothing to publish"; exit 2; }
P="$F/publish-$(date '+%Y%m%d-%H%M%S')"; mkdir "$P" || { echo "STOP: cannot make $P"; exit 2; }
PHASES="evidence dossier card on-live"
finish() { phases "$P" $PHASES; seal "$P"; echo "$1"; exit "$2"; }
step "$P" evidence "Evidence:" /usr/bin/python3 -I "$K/dossier_evidence.py" "$ITEM" "$POSTS/dossier-$ITEM.txt" "$A" || finish "NOT PUBLISHED $ITEM: evidence; see $P" 3
step "$P" dossier "posted" bash "$K/post_dossier.sh" "$REL" "$ITEM" || finish "NOT PUBLISHED $ITEM: dossier; see $P" 3
step "$P" card "revised\|already on the page" /usr/bin/python3 -I "$K/cards_add.py" "$ITEM" "$REL" || finish "NOT PUBLISHED $ITEM: card; see $P" 3
ON_LIVE=$(cfg on_live)
if [ -n "$ON_LIVE" ]; then step "$P" on-live "" bash -c "$ON_LIVE \"\$1\" \"live \$2\"" on-live "$ITEM" "$REL" || finish "NOT PUBLISHED $ITEM: on_live; see $P" 3; fi
finish "PUBLISHED $ITEM release $REL: $(cat "$POSTS/release-$REL.id" 2>/dev/null)" 0
