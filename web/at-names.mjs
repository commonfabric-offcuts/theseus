// Who writing goes to when it starts with @names (docs/reader.md,
// "Naming who a message is to"). Core decides it when the writing is frozen
// to be sent (aim_next/addressing.py); this is the same rule, word for word,
// so the composer says beforehand who Core will record.
//
// A member is someone the topic's messages can be sent to (its participants
// and the outcome's team, switched on, not the writer), named by actor id or
// name in any case; an id wins over a name, and a name two members share
// names nobody. The names are read from the start, after any spaces: "@" and
// a word of letters, digits, "_", "." and "-" (a "." ending it is not part
// of it), followed by the end, a space or one of , : ; ! ? and the run stops
// at the first word that names no member, which is plain text.

// The spaces both copies agree on (JavaScript's \s and Python's differ).
const SPACE = ' \\t\\n\\r\\f\\v\\u00a0';
const LEAD = new RegExp(`[${SPACE}]*`, 'y');
const WORD = new RegExp(`@([A-Za-z0-9_.\\-]+)(?=[${SPACE},:;!?]|$)[${SPACE},:;]*`, 'y');

// members: [{ id, name? }]. The ids the writing's leading @names name, in order, each once.
export function leadingNames(body, members) {
  const byId = new Map(), byName = new Map();
  for (const { id, name } of members) {
    if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), id);
    if (name) byName.set(name.toLowerCase(), new Set([...byName.get(name.toLowerCase()) ?? [], id]));
  }
  const named = [];
  LEAD.lastIndex = 0; LEAD.exec(body);
  let at = LEAD.lastIndex;
  for (;;) {
    WORD.lastIndex = at;
    const word = WORD.exec(body);
    if (!word) return named;
    const key = word[1].replace(/\.+$/, '').toLowerCase(), shared = byName.get(key);
    const member = byId.get(key) ?? (shared?.size === 1 ? [...shared][0] : undefined);
    if (member === undefined) return named;
    if (!named.includes(member)) named.push(member);
    at = WORD.lastIndex;
  }
}

// Who the writing goes to: the members its leading @names name, else names
// (whoever the composer offers or the person named).
export function addressedTo(body, members, names) {
  const named = leadingNames(body ?? '', members ?? []);
  return named.length ? named : names;
}
