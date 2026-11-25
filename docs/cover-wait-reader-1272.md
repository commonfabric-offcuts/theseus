# Whose answer a cover awaits

The no-options/no-default note uses the same current reader and awaited actor
as the existing wait label. The awaited actor is the wait's actor_id, falling
back to the cover owner for legacy waits. Only a known reader matching that
actor sees “Waiting for your answer.” Other or unknown readers see “Waiting
for an answer.” The existing label supplies the authorized person's name;
the note performs no identity lookup and exposes no additional identity.

Both the feed/Reader cover sheet and the compact wait tooltip pass their
existing context to the formatter. Choices, defaults and authored reasons keep
their existing presentation. Waits, question closure and answer identity,
revision and actions remain authoritative in their existing owners. A changed
reader, owner or wait repaints through the existing cover keys; unchanged rows
retain the 1276 behavior. No read, timer, polling, admission or window behavior
is added.

Focused controls exercise the actual formatter, sheet, tooltip and Reader
paint method with modeled DOM/input. The answer control uses its real handler
and current revision; this does not prove native key, touch, hover or focus
behavior. Native work is outside this piece's selected controls.
