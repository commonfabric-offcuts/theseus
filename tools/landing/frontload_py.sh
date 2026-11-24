#!/bin/bash
# frontload_py.sh NAME SOURCE_REPO TREE_OR_COMMIT LIVE_COMMIT OWN_FILES PY_FILES
# The Python tests of a piece whose node suite the landing itself runs: the named Python
# files with unittest on the tree and on an export of LIVE, each in a fresh HOME/TMPDIR under the seat's scratch,
# at nice 15. OWN_FILES run on the tree only; PY_FILES are compared tree vs live. Both lists are comma-separated
# paths under tests/. Every run is a producer: announce it first, stop it by group.
# Output: <scratch>/frontload/NAME-<stamp>/ with SUMMARY.txt; exit 0 = no failure the tree adds over live.
set -u
. "$(dirname "$0")/kit.sh"
NAME="$1"; REPO="$2"; SRC="$3"; LIVE="$4"; OWN="$5"; PY="$6"
R=$(cfg scratch)/frontload/$NAME-$(date +%Y%m%d-%H%M%S)
mkdir -p "$R/tree" "$R/live" || exit 2
git -C "$REPO" archive "$SRC" | tar -x -C "$R/tree" || { echo "STOP: cannot export $SRC from $REPO"; exit 2; }
git -C "$(cfg live)" archive "$LIVE" | tar -x -C "$R/live" || { echo "STOP: cannot export live $LIVE"; exit 2; }
echo "tree $(git -C "$REPO" rev-parse "$SRC^{tree}") live $LIVE" > "$R/binding.txt"
pyrun() {  # pyrun TAG DIR FILES...
  local tag="$1" dir="$2"; shift 2
  local s="$R/py-$tag"; mkdir -p "$s/home" "$s/tmp" "$s/pyc"
  ( cd "$dir" && env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin HOME="$s/home" TMPDIR="$s/tmp" \
      PYTHONPATH="$dir/tests:$dir" PYTHONPYCACHEPREFIX="$s/pyc" nice -n 15 /usr/bin/python3 -B -m unittest -v "$@" ) > "$s/out.txt" 2>&1
  echo $? > "$s/exit"
}
IFS=, read -r -a PYF <<< "$PY"; IFS=, read -r -a OWNF <<< "$OWN"
pyrun tree-cmp "$R/tree" "${PYF[@]}" &
pyrun live-cmp "$R/live" "${PYF[@]}" &
pyrun tree-own "$R/tree" "${OWNF[@]}" &
wait
fails() { /usr/bin/grep -E '^(FAIL|ERROR): ' "$1" | sort -u; }
{
  echo "binding: $(cat "$R/binding.txt")"
  for t in tree-cmp live-cmp tree-own; do echo "python $t: exit $(cat "$R/py-$t/exit") $(tail -1 "$R/py-$t/out.txt")"; done
  for t in tree-cmp live-cmp tree-own; do echo "python $t ran: $(/usr/bin/grep -E '^Ran [0-9]+ tests' "$R/py-$t/out.txt")"; done
  echo "python failures on the tree that live does not have:"
  comm -23 <(fails "$R/py-tree-cmp/out.txt") <(fails "$R/py-live-cmp/out.txt")
  echo "own-file python failures:"; fails "$R/py-tree-own/out.txt"
} > "$R/SUMMARY.txt"
cat "$R/SUMMARY.txt"; echo "results: $R"
NEWPY=$(comm -23 <(fails "$R/py-tree-cmp/out.txt") <(fails "$R/py-live-cmp/out.txt") | wc -l | tr -d ' ')
OWNPY=$(fails "$R/py-tree-own/out.txt" | wc -l | tr -d ' ')
[ "$NEWPY" = 0 ] && [ "$OWNPY" = 0 ] && [ "$(cat "$R/py-tree-own/exit")" = 0 ]
