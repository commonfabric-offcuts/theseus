# kit.sh: sourced by the landing kit's shell steps. K is the kit's folder; `cfg KEY` reads one of this seat's
# settings (config.py). Every landing step runs through `step`, which enforces the child's real exit and keeps
# per-attempt receipts (command, exit, whole output) that nothing overwrites.
K=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
cfg() { /usr/bin/python3 -I "$K/config.py" "$1"; }
# step DIR NAME MARKER CMD...  → 0 only when the child returned 0, wrote output, and (if MARKER is given) printed it.
#   1 child returned non-zero · 2 returned 0 with no output · 3 returned 0 without the marker · 7 receipts unwritable
step() {
  local dir="$1" name="$2" marker="$3"; shift 3
  { printf '%q ' "$@"; printf '\n'; } > "$dir/$name.cmd" 2>/dev/null || { echo "STOP: $name: cannot write receipts in $dir"; return 7; }
  "$@" > "$dir/$name.out" 2>&1; local rc=$?
  printf '%s\n' "$rc" > "$dir/$name.exit" 2>/dev/null || { echo "STOP: $name: cannot write the exit receipt in $dir"; return 7; }
  [ "$rc" = 0 ] || { echo "STOP: $name returned $rc; see $dir/$name.out"; return 1; }
  [ -s "$dir/$name.out" ] || { echo "STOP: $name returned 0 and wrote nothing; see $dir/$name.out"; return 2; }
  [ -z "$marker" ] || /usr/bin/grep -q -- "$marker" "$dir/$name.out" || { echo "STOP: $name returned 0 without '$marker'; see $dir/$name.out"; return 3; }
  return 0
}
# attempt FOLDER CARRY LIVE → prints a new receipts folder FOLDER/attempts/<stamp>, holding the binding (carry head/tree, live head, time).
attempt() {
  local f="$1" w="$2" live="$3" a; a="$f/attempts/$(date '+%Y%m%d-%H%M%S')"
  mkdir -p "$f/attempts" && mkdir "$a" || return 1
  { echo "folder $f"; echo "carry $w"; echo "carry head $(git -C "$w" rev-parse HEAD 2>/dev/null) tree $(git -C "$w" rev-parse 'HEAD^{tree}' 2>/dev/null)"
    echo "live head $(git -C "$live" rev-parse HEAD 2>/dev/null)"; echo "kit $K head $(git -C "$K" rev-parse HEAD 2>/dev/null)"; date; } > "$a/binding.txt" || return 1
  echo "$a"
}
# seal FOLDER → the attempt's receipts become read-only.
seal() { chmod -R a-w "$1" 2>/dev/null; }
# spec FOLDER KEY → one field of FOLDER/SPEC.json.
spec() { /usr/bin/python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1/SPEC.json" "$2"; }
# phases DIR NAME... → DIR/phases.txt: each phase with its exit, or "not reached" when the attempt stopped before it.
phases() {
  local dir="$1" name; shift
  for name in "$@"; do
    if [ -f "$dir/$name.exit" ]; then echo "$name exit $(cat "$dir/$name.exit")"; else echo "$name not reached"; fi
  done > "$dir/phases.txt"
}
