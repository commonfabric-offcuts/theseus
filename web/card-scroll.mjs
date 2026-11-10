// A message cut off on the topic page reads on in place (docs/interaction.md).
//
// A card shows at most the first 1,024 bytes of a message (item.preview). When
// the pointer comes to rest on such a card, the keyboard lights it or a finger
// taps it, the whole message is read from its source and the card's words
// become a box of the same height that scrolls under the wheel, the trackpad
// or a finger, so the rest reads without opening the Reader and nothing around
// the card moves. Where a finger scrolls, the excerpt is never taller than
// most of the window (aim.css), so the page still scrolls beside the card.
// Opening it still shows it whole.
import { formatWords } from './message-format.mjs';

export const SCROLL_CUE = 'Scroll here for the rest · Open to read it whole';

export class CardScroll {
  constructor({ read }) { this.read = read; this.loading = new WeakSet(); }
  // card: the message's card; item: its topic_messages item.
  async expand(card, item) {
    if (!item?.preview || card.dataset.whole === 'shown' || this.loading.has(card)) return false;
    const preview = card.querySelector(':scope > .message-preview');
    if (!preview) return false;
    this.loading.add(card);
    try {
      const source = await this.read(item.id);
      if (!card.isConnected || source?.source_ref?.id !== item.id || typeof source.body !== 'string') return false;
      // The box keeps the height the excerpt had, so the list holds still.
      const height = Math.max(preview.getBoundingClientRect().height, 96);
      preview.style.maxHeight = `${Math.ceil(height)}px`;
      formatWords(preview, source.body);
      preview.classList.add('scroll-in-place');
      const cue = card.querySelector(':scope > .message-preview-cue');
      if (cue) cue.textContent = SCROLL_CUE;
      card.dataset.whole = 'shown';
      return true;
    } catch { return false; }
    finally { this.loading.delete(card); }
  }
}
