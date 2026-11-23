import { AGENT_PALETTE } from './author-colors.mjs';

// Only this surface's colour classes change. Selection, editing and the
// page's independent card markers belong to their existing painters.
export function paintNotebookColor(node, color) {
  const chosen = AGENT_PALETTE.includes(color) ? color : null;
  node.classList.toggle('notebook-tinted', chosen !== null);
  for (const name of AGENT_PALETTE) node.classList.toggle('agent-' + name, name === chosen);
}
