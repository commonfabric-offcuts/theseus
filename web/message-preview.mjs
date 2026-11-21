// A message shown by one line in the feed (item 447; docs/reply-stacks.md,
// "Folded messages" and "The head"): a folded message's row, and a dossier's
// short name until someone types one. The line is the author's own words, read
// as the card reads the message (message-format.mjs): the first line of the
// first block that is not a quote, without the marks that begin it (a list's
// dash or number, a task's box, a heading's #s) or emphasis marks. A message
// that is only quotes shows its first quoted line inside quote marks, so it
// reads as a quote and not as the author's words; one with only attachments
// says what is attached. Nothing is cut at a colon or a full stop: the page's
// ellipsis shortens a line too long for its row. A line over 200 characters,
// as long as a stack's name may be, ends at a word with "…".
// Pipeline titles keep their own rule (pipeline-words.mjs, firstLine).
import { parseBlocks } from './message-format.mjs';
import { replyBasisPresentation } from './reply-basis.mjs';

const LIMIT = 200;
const EMPHASIS = /\*\*|__|~~|`/g;

// The first line of text with words, its emphasis marks dropped and its spaces folded to one.
const lineOf = text => String(text ?? '').split('\n')
  .map(line => line.replace(EMPHASIS, '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';

// A block's first line of words: a list by its first item, a table by its head.
function blockLine(block) {
  if (block.kind === 'list') return lineOf(block.items.map(item => item.words.text).find(text => lineOf(text)));
  if (block.kind === 'table') return lineOf(block.head.cells.map(cell => cell.text).filter(Boolean).join(' | '));
  return block.words ? lineOf(block.words.text) : '';
}

// The first line of the author's own words in blocks, else that of the first quote (quoted: true).
function wordsOf(blocks) {
  let quote = null;
  for (const block of blocks) {
    if (block.kind === 'quote') { quote ??= block; continue; }
    const text = blockLine(block);
    if (text) return { text, quoted: false };
  }
  if (!quote) return { text: '', quoted: false };
  const inner = quote.blocks ? wordsOf(quote.blocks).text : lineOf(quote.words.text);
  return { text: inner, quoted: Boolean(inner) };
}

// A long line ends at a word near LIMIT, with "…", and is never longer than LIMIT.
function bounded(line) {
  if (line.length <= LIMIT) return line;
  const cut = line.slice(0, LIMIT - 1), space = cut.lastIndexOf(' ');
  return `${(space > LIMIT * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// item: a message as the feed holds it ({body, attachments, preview}).
export function messagePreview(item) {
  const body = item?.body ?? '', basis = replyBasisPresentation(body, { replyBasis: item?.reply_basis, agentReply: item?.author_kind === 'agent' && Boolean(item?.reply_to) });
  const { text, quoted } = wordsOf(parseBlocks(body.slice(basis?.headingEnd ?? 0), { partial: item?.preview === true }));
  if (text) return bounded(quoted ? `“${text}”` : text);
  const attached = (item?.attachments ?? []).map(attachment => attachment?.name || 'a file');
  return attached.length ? bounded(`Attached: ${attached.join(', ')}`) : '';
}
