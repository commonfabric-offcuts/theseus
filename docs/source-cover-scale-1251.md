# Source cover reads (1251)

Source keys select possible item relations before current reader-visible
ancestry confirms dossier membership. Item rows still require destination
membership. The source-existence gate remains independent of destination
access. Historical actor-scoped change keys remain candidates after an item
relation is removed; they contribute only when their source message is visible
and belongs to the requested canonical dossier. No durable state or schema
changes; reads never write aggregates or repair records.

A newest-visible topic window of32 messages can certify a dossier's newest
message and newest message by another author when both global maxima belong
to it. Read its first candidate before consuming that window; an unrelated
newest candidate goes directly to the exact recursive aggregate, so older
named-message reads do not pay for a later unrelated window. An incomplete certificate retains the exact recursive aggregate,
including a full window of the reader's own messages. This is a shortcut for
this demonstrated hot path, not universal constant cost for arbitrary dossiers.
Source/change candidate volume and ancestry depth remain real costs.

Keep the1250 measuring files unchanged. Compare declared live and candidate
product imports with100/30000 targets and300 dossiers, warm before/30, two
retained excluded warmups per side and nine alternating paired blocks. Complete
Api parse/expansion, checkedView and TopicViews acceptance are inside timing;
SQL/VM diagnostics are separate. The1.5 median ratio is unchanged. Keep462's
historical red labeled462. No native/cold/other-view claim follows here.

Own complete-file checks compare all candidate membership/source/clock fields
to the authoritative recursive relation across private sources, joins/splits,
withdrawal, removal/restoration, destination access and aggregate fallback.
The100/1000 VM control distinguishes the original full-history walks from this
repair; the unchanged100/30000 request experiment decides the actual bound.
