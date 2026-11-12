// Quiet only when every loaded message is explicitly between known agents.
// Room posts, human replies and uncertain ancestry keep the dossier visible.
// This is a presentation choice, never a delivery or unread decision.
export function coordinationStack(stack, quiet) {
  const items = [stack.head, ...stack.replies], ids = new Set(items.map(item => item.id));
  return items.every(item => quiet(item) && (!item.reply_to || ids.has(item.reply_to)));
}
