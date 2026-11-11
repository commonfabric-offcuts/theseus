// Each agent's own color: a tint behind its cards and a deeper one behind its
// name, the same agent always the same color (docs/reading-colors.md, "Agent
// colors"). The colors themselves live in aim.css, one class per name here.
// Fable's green is the color its cards already had (the live --soft); indigo
// is no one's by default, and anyone can be given it.
export const AGENT_PALETTE = ['green', 'blue', 'indigo', 'violet', 'rose', 'peach', 'cyan', 'olive'];
const KNOWN = { 'aim-lead': 'blue', 'aim-ux': 'violet', fable: 'green', 'aim-core': 'peach', 'aim-spec': 'rose', warp: 'cyan' };

// Any other agent is olive, which no team agent has and which is the farthest
// of the free colors from the team's, so no other agent is taken for one of
// the team.
export function agentColor(id) {
  if (typeof id !== 'string' || !id) throw Error('An agent color needs the agent id.');
  return Object.hasOwn(KNOWN, id) ? KNOWN[id] : 'olive';
}

// The person's own messages keep their black; a person's other messages keep
// the plain card. color(id) is the color the reader sees an agent in: their
// own choice for it (docs/reading-colors.md, "Choosing an agent's color"), or
// by default the agent's own.
// A whisper keeps its author's card and adds its dashed line (whisper).
export function cardClass(item, actor, color = agentColor) {
  const whisper = item.whisper ? ' whisper' : '';
  if (item.author_id === actor) return 'message-card own-message' + whisper;
  if (item.author_kind === 'agent') return `message-card agent-card agent-${color(item.author_id)}` + whisper;
  return 'message-card' + whisper;
}

// Recolor an existing card without erasing the stack, selection or reading
// classes owned by other painters. A refresh can happen while it is in use.
const COLOR_CLASSES = ['message-card', 'own-message', 'agent-card', 'whisper', ...AGENT_PALETTE.map(name => 'agent-' + name)];
export function paintCardColor(card, item, actor, color = agentColor) {
  const next = cardClass(item, actor, color).split(' ');
  for (const name of COLOR_CLASSES) if (!next.includes(name)) card.classList.remove(name);
  for (const name of next) card.classList.add(name);
}

// The Reader's page for a source: an agent's message on its card's color
// under the pointer, the card the person just pressed; the person's own
// message, another person's and a Notebook page on the neutral page, never
// the green that is Fable's card.
export function paneClass(source, actor, color = agentColor) {
  if (source?.source_ref?.kind === 'message' && source.author_kind === 'agent' && source.author !== actor)
    return `reading-pane agent-pane agent-${color(source.author)}`;
  return 'reading-pane';
}
