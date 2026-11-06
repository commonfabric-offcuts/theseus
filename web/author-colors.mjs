// Each agent's own color: a tint behind its cards and a deeper one behind its
// name, the same agent always the same color (docs/reading-colors.md, "Agent
// colors"). The colors themselves live in aim.css, one class per name here.
export const AGENT_PALETTE = ['blue', 'indigo', 'violet', 'orchid', 'rose', 'peach', 'cyan', 'olive'];
const KNOWN = { 'aim-lead': 'blue', 'aim-ux': 'violet', fable: 'orchid', 'aim-core': 'cyan', 'aim-spec': 'rose', warp: 'peach' };

// Any other agent: FNV-1a over its id's UTF-8 bytes picks from the palette.
export function agentColor(id) {
  if (typeof id !== 'string' || !id) throw Error('An agent color needs the agent id.');
  if (Object.hasOwn(KNOWN, id)) return KNOWN[id];
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return AGENT_PALETTE[hash % AGENT_PALETTE.length];
}

// The person's own messages keep their black; a person's other messages keep
// the plain card.
export function cardClass(item, actor) {
  if (item.author_id === actor) return 'message-card own-message';
  if (item.author_kind === 'agent') return `message-card agent-card agent-${agentColor(item.author_id)}`;
  return 'message-card';
}
