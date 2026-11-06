// Each agent's own color: a tint behind its cards and a deeper one behind its
// name, the same agent always the same color (docs/reading-colors.md, "Agent
// colors"). The colors themselves live in aim.css, one class per name here.
// Fable's green is the color its cards already had (the live --soft); orchid
// is no one's by default, and anyone can be given it.
export const AGENT_PALETTE = ['green', 'blue', 'indigo', 'violet', 'orchid', 'rose', 'peach', 'cyan', 'olive'];
const KNOWN = { 'aim-lead': 'blue', 'aim-ux': 'violet', fable: 'green', 'aim-core': 'cyan', 'aim-spec': 'rose', warp: 'peach' };
const OTHERS = ['indigo', 'olive'];

// Any other agent: FNV-1a over its id's UTF-8 bytes picks indigo or olive,
// which no team agent has, so no other agent is taken for one of the team.
export function agentColor(id) {
  if (typeof id !== 'string' || !id) throw Error('An agent color needs the agent id.');
  if (Object.hasOwn(KNOWN, id)) return KNOWN[id];
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return OTHERS[hash % OTHERS.length];
}

// The person's own messages keep their black; a person's other messages keep
// the plain card.
export function cardClass(item, actor) {
  if (item.author_id === actor) return 'message-card own-message';
  if (item.author_kind === 'agent') return `message-card agent-card agent-${agentColor(item.author_id)}`;
  return 'message-card';
}
