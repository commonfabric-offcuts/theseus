#!/bin/bash
# node_suite_check.sh CARRY_WORKTREE [LIVE_CHECKOUT] [OUT_DIR]
# Runs the whole node unit suite on the carry tree and on live, and names any failure the carry adds, any shared
# failure whose cause changed, and any case that passed on live and no longer runs on the carry.
# Receipts in OUT_DIR (a landing names its sealed attempt folder; the default is a cache): binding.txt (each tree's
# path, head and tree id), <tag>.tap (node's whole output), <tag>.events.jsonl (each case's file, name and status, from
# node_reporter.mjs), <tag>.exit (node's own return code), <tag>.fails (names), changed.txt (the carry's changed files).
# Exit 0: no new failure. Exit 3: new failures (listed). Exit 4: a failure shared with live has a changed cause (listed).
# Exit 5: a case that passed on live is skipped, todo, cancelled or gone on the carry, in a test file the carry did not
# change (listed; execution_compare.py). Exit 2: a suite did not run to its summary, ran no test, cancelled a case, its
# summary does not add up, its result lines or plan do not match its counts, it ran a fraction of the suite, its summary and its failing identities disagree, node's return code disagrees with its
# summary, or the carry's failure count rose without a named new failure.
set -u
. "$(dirname "$0")/kit.sh"
CARRY="$1"; LIVE="${2:-$(cfg live)}"
OUT="${3:-$(cfg scratch)/node-suite}"; mkdir -p "$OUT" || exit 2
{ for pair in "carry:$CARRY" "live:$LIVE"; do tag=${pair%%:*}; dir=${pair#*:}
    echo "$tag $dir head $(git -C "$dir" rev-parse HEAD 2>/dev/null) tree $(git -C "$dir" rev-parse 'HEAD^{tree}' 2>/dev/null)"; done
  echo "node $(command -v node) $(node --version 2>/dev/null)"; date; } > "$OUT/binding.txt" || exit 2
names() { /usr/bin/grep -E "^\s*not ok [0-9]+ - " "$1" | sed -E 's/^\s*not ok [0-9]+ - //; s/ +$//' | sort -u; }
count() { /usr/bin/grep -E "^# $2 [0-9]+$" "$1" | tail -1 | awk '{print $3}'; }
for pair in "carry:$CARRY" "live:$LIVE"; do
  tag=${pair%%:*}; dir=${pair#*:}
  # Both suites run fresh on every call. A stored result is not reused: the suite's outcome also depends on the inherited
  # environment and the runtimes its tests spawn, which no key here binds.
  ( cd "$dir" && nice -n 15 node --test --test-reporter=tap --test-reporter-destination=stdout \
      --test-reporter="$K/node_reporter.mjs" --test-reporter-destination="$OUT/$tag.events.jsonl" tests/*.test.mjs ) > "$OUT/$tag.tap" 2>&1; rc=$?; echo "$rc" > "$OUT/$tag.exit"
  T=$(count "$OUT/$tag.tap" tests); P=$(count "$OUT/$tag.tap" pass); F=$(count "$OUT/$tag.tap" fail)
  C=$(count "$OUT/$tag.tap" cancelled); SK=$(count "$OUT/$tag.tap" skipped); TD=$(count "$OUT/$tag.tap" todo)
  [ -n "$T" ] && [ -n "$P" ] && [ -n "$F" ] || { echo "node suite did not run to its summary on $tag ($dir; node returned $rc)"; tail -5 "$OUT/$tag.tap"; exit 2; }
  [ "$T" -gt 0 ] || { echo "node ran no test on $tag ($dir): an empty suite is not a run"; exit 2; }
  [ "$T" = $(( P + F + ${C:-0} + ${SK:-0} + ${TD:-0} )) ] || { echo "node summary does not add up on $tag: tests $T, pass $P, fail $F, cancelled ${C:-0}, skipped ${SK:-0}, todo ${TD:-0}"; exit 2; }
  if [ "$F" = 0 ] && [ "${C:-0}" = 0 ]; then [ "$rc" = 0 ] || { echo "node returned $rc on $tag with no failure in its summary"; exit 2; }
  else [ "$rc" != 0 ] || { echo "node returned 0 on $tag with $F failures in its summary"; exit 2; }; fi
  NOTOK=$(/usr/bin/grep -cE "^\s*not ok [0-9]+ - " "$OUT/$tag.tap")
  # The summary and the body must agree: a failure count needs failing identities, and no failure means none.
  # Node's TAP names every failed or cancelled case on its own not-ok line (the real suite reads 77 of 77 and 40 of 40),
  # so the count of not-ok lines must equal the summary's fail + cancelled; a missing or extra identity refuses.
  # A cancelled case is a run that did not finish: neither tree is read with one.
  [ "${C:-0}" = 0 ] || { echo "node cancelled ${C} case(s) on $tag: not a complete run"; exit 2; }
  [ "$NOTOK" = $(( F + ${C:-0} )) ] || { echo "node summary on $tag says $F failed and ${C:-0} cancelled but $NOTOK cases are marked not ok"; exit 2; }
  # Every case has its result line, and the plan counts the top-level ones (the real suite: 4938 results, plan 1..4896).
  RES=$(/usr/bin/grep -cE "^\s*(ok|not ok) [0-9]+ - " "$OUT/$tag.tap"); TOP=$(/usr/bin/grep -cE "^(ok|not ok) [0-9]+ - " "$OUT/$tag.tap")
  PLAN=$(/usr/bin/grep -E "^1\.\.[0-9]+$" "$OUT/$tag.tap" | tail -1 | sed -E 's/^1\.\.//')
  [ "$RES" = "$T" ] || { echo "node summary on $tag says $T tests but $RES result lines are present"; exit 2; }
  EV=$(/usr/bin/grep -c . "$OUT/$tag.events.jsonl" 2>/dev/null || echo 0)
  [ "$EV" = "$T" ] || { echo "node summary on $tag says $T tests but the case reporter wrote $EV"; exit 2; }
  [ -n "$PLAN" ] && [ "$PLAN" = "$TOP" ] || { echo "node plan on $tag (1..${PLAN:-none}) does not count its $TOP top-level results"; exit 2; }
  echo "$tag: tests $T pass $P fail $F (node returned $rc; $NOTOK not-ok lines; plan 1..$PLAN)"
done
# The whole suite is thousands of cases; a tree that ran a fraction of them is not the suite.
CT=$(count "$OUT/carry.tap" tests); LT=$(count "$OUT/live.tap" tests)
[ "$LT" -ge 1000 ] || { echo "live ran only $LT tests: not the whole suite"; exit 2; }
[ $(( CT * 10 )) -ge $(( LT * 9 )) ] || { echo "the carry ran $CT tests to live's $LT: most of the suite is missing on the carry"; exit 2; }
names "$OUT/carry.tap" > "$OUT/carry.fails"; names "$OUT/live.tap" > "$OUT/live.fails"
NEW=$(comm -23 "$OUT/carry.fails" "$OUT/live.fails")
# A failure count that rose on the carry must be explained by a named new failure.
CF=$(count "$OUT/carry.tap" fail); LF=$(count "$OUT/live.tap" fail)
if [ "$CF" -gt "$LF" ] && [ -z "$NEW" ]; then echo "the carry fails $CF cases to live's $LF but names no new failure; the TAP is not trusted"; exit 2; fi
if [ -n "$NEW" ]; then echo "NEW FAILURES on the carry (not on live):"; echo "$NEW"; exit 3; fi
# A test failing on both trees for different reasons passes a comparison of names; its normalized cause must match too.
/usr/bin/python3 -I "$K/cause_compare.py" "$OUT/carry.tap" "$OUT/live.tap"; CRC=$?
[ "$CRC" = 0 ] || exit 4
# A case that passed on live must still run on the carry; a skip or a lost body adds no failing name.
git -C "$CARRY" diff --name-only "$(git -C "$LIVE" rev-parse HEAD)" HEAD > "$OUT/changed.txt" || { echo "cannot list the carry's changed files against live"; exit 2; }
/usr/bin/python3 -I "$K/execution_compare.py" "$OUT/carry.events.jsonl" "$OUT/live.events.jsonl" "$OUT/changed.txt"; ERC=$?
[ "$ERC" = 0 ] || exit "$ERC"
echo "no new node failure (live carries $(wc -l < "$OUT/live.fails" | tr -d ' ') known)"
