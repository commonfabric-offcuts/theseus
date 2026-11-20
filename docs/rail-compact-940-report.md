# 940 · Builder receipt

Exact base: release210,9808c5171eaeea5ab1bcd0b4bd9ec34e6d20849a.
Own branch: page-lane5/940-compact-corrections-live210. Current940 item had
no prior piece/topic; single work topic t-423f24eb84c4fd56379d0ddc7732a033.
Warp13551 supplied the actual designer patch and13605 assigned the handoff.
Fable retains pipeline/stage/carry/deploy ownership.

All ten supplied CSS lines remain unchanged. Removing only the additional
Compact .ol-dossiers:empty guard yields the designer's exact CSS blob
f891dc63702e9805903122458b840bd711cd1687. The guard preserves rails.css's
existing empty-container behavior against nested specificity; it fixes the
actual new101.984375→98.796875 navigation-height failure. No JS product,
Core, schema, routing, reader scope, phone or Roomy change. No withdrawn
bullet-title adjustment.

Actual unmodified210 native baseline:12 failures, three in each1280/1512
light/dark Compact case: starred links44px instead of24px, other-wait chip88px
rather than the own-wait marker's15.1875px, and a different hover background.
The patch renders both starred dossier/Notebook rows as one24px indented
line and an open ellipsis ring, retaining the full question/asker hover words.
The scratch tests also activate the existing feed landing and Notebook sheet.
Eight Roomy/phone/coarse cases compare actual geometry/styles with210.

Relevant Node owners:100/100 across ui_rail_density_935, ui_outline_stars,
ui_outline_disclosure_902, ui_outline_order, outline_stars_oracle, ui_rails,
ui_topic_rail. Native940 checks use real scratch Core stars, page and question,
CfT156,1280/1512 light/dark plus protected scopes. No physical-phone, Safari
or universal timing claim. Guarded final native result:32/32 assertions, zero page errors,
all12 scopes complete. Browser.close disconnected, owned process tree/profile
absent; fixture5536 EOF exit0/PID absent/port55773 closed.

935 Compact cases were reused, with optional width/Compact-only selectors;
default runner cases and every assertion remain. A comparison-only collection
mode retains nonzero exit while reaching later cases after an existing red.
Both baseline and guarded head completed keys/pencil reach, actual retained
list geometry and native delayed navigation, width gestures/persistence and
docked Notebook/composer bounds, at1280/1512 in both themes. All four cohorts
have the same one remaining red: light-Compact static rail pixels reaches
2 RGB levels against the unchanged1-level limit. Geometry passes on210 and
on the guarded head; the unguarded designer patch's new geometry red is fixed.
The strict pixel oracle and its actual8-level single-pixel negative control
remain unchanged. These cohort runs remain red, with no new failure on head;
they are not reported as fully green or silently widened to2.

All new raw evidence stays outside the repository at the seat's artifacts:
/Users/commonfabric/.local/share/theseus/fable-tools/coordinator-20261117/hosted-seats13216/work/page_lane5/artifacts/.
940-native/baseline210 and guarded-final hold actual feature/protected-scope
records and screenshots;940-native/935-{baseline,guarded}{1280,1512}-compare
hold comparison records/frames.940-tests/935-comparison-summary.json lists
all four nonzero exits and exact failures; node-guarded-final.tap is the Node
receipt. Earlier native setup rejections (participation, agent divergence and
agent-to-human ask contract) and an incorrect Reader expectation are retained under
separate paths, not counted as layout failures; dossier navigation correctly
lands in the feed. Browser.close and owned browser/profile absence, fixture
EOF exit/PID absence/closed port are checked after each launched run.
