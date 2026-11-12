// A message cut off on the topic page reads on in place (docs/interaction.md).
//
// A card shows at most the first 1,024 bytes of a message (item.preview). When
// the pointer comes to rest on such a card, the keyboard lights it or a finger
// taps it, the whole message is read from its source and the whole card
// becomes a box of the same height that scrolls under the wheel, the trackpad
// or a finger, so the rest reads without opening the Reader and nothing around
// the card moves. At the box's top or bottom edge the same scroll carries on
// with the page, both ways (the browser's own scroll chaining: the box never
// holds it, aim.css). Author, time and reply context scroll with the words;
// the card's border and the dossier's separate title stay in place.
// Where a finger scrolls, the excerpt is never taller than most of the
// window, so the page still scrolls
// beside the card. Opening it still shows it whole.
import { formatWords } from './message-format.mjs';

export const SCROLL_CUE = 'Open to read it whole';

// Which ways a scrolling box has more hidden.
export function edges(box) {
  const above = box.scrollTop > 0, below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  box.dataset.more = above && below ? 'both' : above ? 'above' : below ? 'below' : 'none';
}

export class CardScroll {
  constructor({ read }) { this.read = read; this.loading = new WeakSet(); this.wholes = new Map(); }
  // The whole of a cut-off message, read from its source once (a read that
  // fails is asked again next time); known(id) has it once it has come.
  async whole(id) {
    if (this.wholes.has(id)) return this.wholes.get(id);
    const source = await this.read(id);
    if (source?.source_ref?.id !== id || typeof source.body !== 'string') throw Error('The message could not be read whole.');
    this.wholes.set(id, source.body);
    return source.body;
  }
  known(id) { return this.wholes.get(id); }
  // card: the message's card; item: its topic_messages item.
  async expand(card, item) {
    if (!item?.preview || card.dataset.whole === 'shown' || this.loading.has(card)) return false;
    const preview = card.querySelector(':scope > .message-preview');
    if (!preview?.getBoundingClientRect().height) return false;
    this.loading.add(card);
    try {
      const body = await this.whole(item.id);
      if (!card.isConnected || !preview.getBoundingClientRect().height) return false;
      // Measure only while the message is shown, never a closed stack's zero-
      // height root. Keep the whole card's size, including its header and cue.
      const height = card.getBoundingClientRect().height;
      card.style.maxHeight = `${Math.ceil(height)}px`;
      formatWords(preview, body);
      preview.classList.add('scroll-in-place');
      card.classList.add('scroll-in-place');
      edges(card);
      card.addEventListener('scroll', () => edges(card), { passive: true });
      const cue = card.querySelector(':scope > .message-preview-cue');
      if (cue) cue.textContent = SCROLL_CUE;
      card.dataset.whole = 'shown';
      return true;
    } catch { return false; }
    finally { this.loading.delete(card); }
  }
}
