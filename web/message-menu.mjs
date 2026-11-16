import { feedControl, feedFence } from './feed-fence-copy.mjs';
// The topic page's light and message bar (docs/interaction.md).
//
// The message under the pointer lights, as a passage lights in the Reader,
// and a small bar of buttons sits over its top corner: 👍 (read and
// understood), ✅ and 🚫 when the message asks the reader for a go-ahead,
// Reply (the Reader opens on the message with the cursor in the reply), and ⋯, the message's
// menu (Copy Link, Mark read or unread; docs/links.md), which a right-click on
// the message opens too, where the pointer is. Under the pointer a passage
// of the message lights too, as in the Reader (FeedPassages): Return on it
// quotes it in the Reader's reply, and ⌘C copies it; with none lit, Return
// replies with nothing quoted, as Reply does. ↑ and ↓ move the light;
// Tab onto a card lights it too, and Tab again goes through its bar (tab). A click on a lit card opens it in the Reader.
// On a phone, a tap lights a card and shows its bar (its 👍 count then names
// who, which a pointer reads on hover); a second tap opens it, and a tap
// anywhere else lets the light go. A cut-off card reads on in
// place once lit (CardScroll), under the wheel or a finger.
//
// The bar is one element for the page, placed over whichever card is lit, so
// the cards themselves (buttons, folded into quiet lines between others) keep
// their shape. The bar never covers the reply arrow beside a card's time.
import { cardIn } from './fold.mjs';
import { pageItself, writing } from './pane-keys.mjs';
import { copyKey, onMac } from './writing-input.mjs';
import { paintReactions, mayThumb, mayAnswer, thumbed, answerOf, ANSWER_WORDS } from './reactions.mjs';
import { entries, entryOf, navigationStops, shownSelected, stopAt, onEarlierRow } from './reply-stacks.mjs';
import { revealSelection } from './reveal.mjs';
import { FeedPassages } from './feed-passages.mjs';
import { reach } from './arrow-reach.mjs';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

// External Copy buttons take the place of their fences among a card's links.
function inlineStops(card) {
  const stops = [];
  for (const node of card.querySelectorAll('a[href],button,[tabindex],.feed-fence-anchor')) {
    if (!node.getClientRects().length) continue;
    const external = feedControl(node);
    if (external) stops.push(external);
    else if (node.tabIndex >= 0 && !node.disabled) stops.push(node);
  }
  return stops;
}

function focusStop(target) {
  const anchor = feedFence(target);
  if (anchor) {
    const card = anchor.closest('.message-card').getBoundingClientRect();
    const top = anchor.getBoundingClientRect().top;
    const win = anchor.ownerDocument.defaultView;
    const height = parseFloat(win.getComputedStyle(anchor).paddingTop);
    // The Copy button occupies the top lane. 'nearest' may leave that lane
    // clipped when the fence spans both edges of an inner scrolling card.
    if (top < Math.max(0, card.top) || top + height > Math.min(win.innerHeight, card.bottom)) {
      anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }
    target.hidden = false;
  }
  target.focus({ preventScroll: true });
}

export class MessageMenu {
  // host: #messages. item(id): its loaded topic_messages item. viewer, kind:
  // who reads. reply(id, card): the Reader on it, the cursor in the reply.
  // thumb(item, on) and answer(item, yes|no): the person's acts.
  // expand(card, item): reads a cut-off card on in place. more(item, button):
  // the message's ⋯ menu, opened from the bar's ⋯ (openMessageMenu).
  // copy(item, words): puts the message's words on the clipboard, or the
  // words given, a passage of them (⌘C, copies). quote(id, card, chosen): the
  // Reader on it with chosen ({start, end, text} of its words) quoted.
  constructor({ host, item, viewer, kind, reply, quote = (id, card) => reply(id, card), thumb, answer, more, expand = () => {}, copy = () => {}, mac = onMac(), doc = document }) {
    Object.assign(this, { host, item, viewer, kind, reply, quote, thumb, answer, more, expand, copy, mac, doc });
    this.lit = null; this.touch = false; this.before = null;
    this.bar = this.buildBar();
    this.passages = new FeedPassages({ host, doc, lights: () => this.returns(), entryOf: target => this.entryOf(target) });
    // Scrolling or a repaint can put another card under a stationary pointer
    // and fire pointerover. Only actual pointer movement takes the light from
    // the keyboard; otherwise repeated arrows can bounce between stacks.
    let pointer = null, reverseTab = null;
    doc.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      // WebKit also emits pointermove after a scroll with unchanged screen
      // coordinates. That event must not take selection from the keyboard.
      // After a finger's press the pointer has no place yet, and the first
      // mouse move only gives it one: WebKit may send a mouse's move after a
      // scroll that follows a tap, and that move must not take a light the
      // tap gave (docs/reply-stacks.md, "The bar").
      const still = pointer ? pointer.x === event.screenX && pointer.y === event.screenY : this.touch;
      pointer = { x: event.screenX, y: event.screenY };
      // While the bar's ⋯ menu is open the light stays on its message.
      if (still || this.menuOpen()) return;
      const entry = this.entryOf(event.target);
      if (entry && entry !== this.lit) this.light(entry);
      else if (!entry && !this.ownsControls(event.target)) this.light(null);
      // The keys follow the pointer too (item 387): what it moved onto takes the keyboard's place, as a click gives it (claim).
      if (this.host.contains(event.target)) this.hover(event);
      // Then the passage under it lights, where Return would quote it (FeedPassages).
      if (entry && entry === this.lit) this.passages.point(event, entry);
    });
    // What was lit when the press began: the press itself focuses the card,
    // which lights it, before its click arrives.
    doc.addEventListener('pointerdown', event => { reverseTab = null; this.touch = event.pointerType === 'touch'; this.before = this.lit; }, true);
    // A press on a word of the card's own reaction line acts, and opens nothing,
    // but for a tap on the 👍 count: on a phone that lights the card, which
    // names who (the bar's 👍 thumbs it).
    // On a phone, the first tap on a card lights it; the next opens it.
    host.addEventListener('click', event => {
      const entry = this.entryOf(event.target);
      if (!entry) return;
      const react = event.target.closest?.('[data-react]');
      if (react && cardIn(entry).contains(react)) {
        event.preventDefault(); event.stopPropagation();
        this.light(entry);
        if (!(this.touch && react.classList.contains('reaction-count'))) this.act(react.dataset.react);
        return;
      }
      // An earlier message's row shows whole at the first tap (reply-stacks.mjs, item 476); its tab, and the card
      // drawn whole under Only new, light first as any card's does.
      if (onEarlierRow(entry, event.target)) return;
      // A message folded to its row unfolds at the first tap (reply-stacks.mjs).
      if (this.touch && entry !== this.before && !event.target.closest?.('a, .fold-line') && cardIn(entry).dataset.folded !== 'true') {
        this.light(entry);
        // The reply arrow answers its own first tap with its words (card-reading.mjs).
        if (event.target.closest?.('.replied-mark')) return;
        event.preventDefault(); event.stopPropagation();
      }
    }, true);
    // A click or tap in a message or a dossier also moves the keys' place there
    // (item 386): it runs before the control pressed acts, so whatever that
    // control focuses itself (a menu, the Reader, a field) still takes the focus.
    host.addEventListener('click', event => this.claim(event.target), true);
    // A tap anywhere but a message, its bar, its menu or a pop-up lets the light go. A
    // finger lifted after a scroll ends in pointercancel, so scrolling keeps it.
    // Where the tap landed is read from the path the release was sent along: a
    // repaint held through the press runs as the finger lifts (press-hold.mjs),
    // before this hears it, and can replace the element it landed on, which no
    // longer says which message it was in. Its nearest part still drawn does.
    doc.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch' || !this.lit) return;
      const at = event.composedPath().find(node => node.nodeType === 1 && node.isConnected) ?? null;
      if (!this.entryOf(at) && !this.bar.contains(at) && !at?.closest?.('dialog, .message-menu-list')) this.light(null);
    });
    doc.addEventListener('focusin', event => {
      const entry = this.entryOf(event.target), reverse = reverseTab;
      reverseTab = null;
      if (entry && entry !== this.lit) this.light(entry);
      // Safari may focus the page itself when a clicked stack unfolds. That
      // is not a move to another control and must keep the selected message.
      else if (!entry && !pageItself(event.target, doc) && !this.ownsControls(event.target)) this.light(null);
      // On backward entry the browser lands on this card's last native stop.
      // A Copy button after it in the message lives outside native tab order.
      if (reverse && !reverse.defaultPrevented && entry && this.entryOf(reverse.target) !== entry) {
        const card = cardIn(entry);
        if (card.contains(event.target)) {
          const last = inlineStops(card).at(-1);
          if (feedFence(last)) focusStop(last);
        }
      }
    });
    doc.addEventListener('keyup', event => { if (event.key === 'Tab') reverseTab = null; });
    // Pointer selection need not move DOM focus. When the person uses keys
    // again, the focused pane owns the light before its key handler runs.
    doc.addEventListener('keydown', event => {
      if (event.isComposing || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', ' '].includes(event.key)) return;
      reverseTab = event.key === 'Tab' && event.shiftKey && !event.ctrlKey && !event.metaKey ? event : null;
      const at = doc.activeElement, entry = this.entryOf(at);
      if (entry && !this.lit) this.light(entry);
      else if (!entry && !pageItself(at, doc) && !this.ownsControls(at)) this.light(null);
    }, true);
    doc.addEventListener('keydown', event => this.key(event));
    doc.defaultView.addEventListener('scroll', () => this.place(), { passive: true });
    doc.defaultView.addEventListener('resize', () => this.place());
    // Content above the lit card can grow or shrink without a scroll (the
    // side rail filling in above the topic on a phone, a card arriving): the
    // page's size changes, and the bar follows its card. The bar's own width
    // changes too ("Link copied" on its ⋯), and it keeps to its corner.
    this.sizes = new doc.defaultView.ResizeObserver(() => this.place());
    this.sizes.observe(doc.body); this.sizes.observe(host); this.sizes.observe(this.bar);
    // A reply stack's head that comes to show only its row loses its bar, and
    // gets it back once its full message shows again, as a message a dossier
    // folds and unfolds does (barless). A lit message
    // its stack folds away loses its light, and its bar with it (place).
    new doc.defaultView.MutationObserver(() => { if (this.lit) this.paintBar(); })
      .observe(host, { subtree: true, attributes: true, attributeFilter: ['data-head-open', 'hidden', 'data-folded'] });
  }
  buildBar() {
    const doc = this.doc, bar = doc.createElement('div');
    bar.className = 'message-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'This message'); bar.hidden = true;
    const make = (name, label, title) => {
      const button = doc.createElement('button');
      button.type = 'button'; button.dataset.act = name; button.textContent = label; button.title = title;
      button.setAttribute('aria-label', title);
      // The bar never takes the focus from the page on a press, so Return still
      // replies. On mousedown, not pointerdown: WebKit drops a tap's click when
      // its pointerdown is cancelled, and a tap's mousedown comes after the touch.
      button.addEventListener('mousedown', event => event.preventDefault());
      // A press on the bar puts the keys on its message, as a press in the message does (claim).
      button.onclick = () => { if (this.lit) this.claim(cardIn(this.lit)); this.act(name); };
      return button;
    };
    this.buttons = {
      thumb: make('thumb', '👍', 'Thumbs-up: read and understood'),
      yes: make('yes', '✅', 'Go ahead'),
      no: make('no', '🚫', "Don't"),
      reply: make('reply', 'Reply', 'Reply (Return)'),
      more: make('more', '⋯', 'More for this message'),
    };
    this.buttons.more.setAttribute('aria-haspopup', 'menu'); this.buttons.more.setAttribute('aria-expanded', 'false');
    bar.append(...Object.values(this.buttons));
    doc.body.append(bar);
    return bar;
  }
  // The list entry a target is in: a card, or a fold holding its card, on its
  // own or in a reply stack (reply-stacks.mjs).
  entryOf(target) { return entryOf(this.host, feedFence(target?.closest?.('.feed-fence-copy')) ?? target); }
  ownsControls(target) { return this.bar.contains(target) || Boolean(target?.closest?.('.message-menu-list')); }
  // The entries on show, in the page's order; a stack's folded replies are not.
  entries() {
    return navigationStops(this.host);
  }
  // Whether the bar's ⋯ menu is open.
  menuOpen() { return this.buttons.more.getAttribute('aria-expanded') === 'true'; }
  // The ⋯ that shows the entry's menu and says "Link copied": the bar's, while
  // the entry is lit; else none.
  moreFor(entry) { return entry && entry === this.lit && !this.bar.hidden ? this.buttons.more : null; }
  // Moves the keyboard's place, coarsely, to what a click or tap fell in: the
  // dossier's chevron, or the message (a head's row is its head, which stands
  // for the dossier once it shows as one row), focused as the keys focus it
  // (key), without scrolling, so the next
  // arrow, Return or shortcut acts from there. Writing keeps the focus, with
  // a composer's own controls and panels, a menu and a dialog, as the page's
  // keys leave them alone (pane-keys.mjs, writing): whether the press fell
  // there or the focus is there (a press on the bar takes no focus). One that
  // ends a drag selecting words leaves it, so the words stay selected.
  claim(target) {
    const at = target?.nodeType === 1 ? target : target?.parentElement, focused = this.doc.activeElement;
    if (!at || writing(at) || writing(focused) || focused?.isContentEditable || this.doc.getSelection?.()?.isCollapsed === false) return;
    const header = at.closest('.stack-toggle');
    const entry = header ? null : this.entryOf(at);
    const stop = header ?? (entry && (cardIn(entry).hidden ? entry.querySelector('.fold-line') : cardIn(entry)));
    if (!stop || stop === this.doc.activeElement || !stop.getClientRects().length) return;
    stop.focus({ preventScroll: true });
    if (header) this.light(null);
  }
  // The pointer moved onto a message or a dossier's header: the keys act there
  // next, as after a click (claim), without scrolling. Only a pointer that
  // really moved, with no button held (a drag selecting words), comes here.
  // Writing keeps the focus (claim), and so do an open menu, the Reader or any
  // other dialog, so typing and their keys never go elsewhere.
  hover(event) {
    if (event.buttons || open || this.host.closest('[inert]') || this.doc.querySelector('dialog[open]')) return;
    this.claim(event.target);
  }
  light(entry) {
    if (this.lit && this.lit !== entry) {
      this.lit.classList.remove('lit'); cardIn(this.lit).classList.remove('lit');
      // "Link copied" was said of the message the light leaves.
      unsay(this.buttons.more);
    }
    this.lit = entry;
    this.passages.follow(entry);
    if (!entry) { this.bar.hidden = true; return; }
    this.host.dataset.lastMessage = entry.dataset.id;
    entry.classList.add('lit'); cardIn(entry).classList.add('lit');
    this.paintBar();
  }
  paintBar() {
    const item = this.lit && this.item(this.lit.dataset.id);
    if (!item || this.barless()) { this.bar.hidden = true; return; }
    // Also runs when a selected stack opens: its header alone has no message
    // viewport to measure until the original card becomes visible.
    const card = cardIn(this.lit);
    if (item.preview && !card.hidden) this.expand(card, item);
    const { thumb, yes, no } = this.buttons;
    thumb.hidden = !mayThumb(item, this.viewer);
    thumb.setAttribute('aria-pressed', String(thumbed(item, this.viewer)));
    const answerable = mayAnswer(item, this.viewer, this.kind), mine = answerOf(item, this.viewer);
    yes.hidden = no.hidden = !answerable;
    yes.setAttribute('aria-pressed', String(mine === 'yes')); no.setAttribute('aria-pressed', String(mine === 'no'));
    this.bar.hidden = false;
    this.place();
  }
  // Whether the lit message shows no bar: a reply stack's head showing only its
  // row, the stack's tab (reply-stacks.mjs), until its full message shows; and a
  // message a dossier shows as its folded row (item 471), which a press unfolds.
  // Under Only new a stack draws nothing, and its messages read whole.
  barless() {
    const card = this.lit && cardIn(this.lit), section = card?.closest('.reply-stack');
    if (!section || card.closest('.only-new')) return false;
    return card.classList.contains('stack-head-card') && section.dataset.headOpen === 'false'
      || card.dataset.folded === 'true' && section.dataset.single === 'false';
  }
  // Over the lit card's top end corner, inside the window while any of the
  // card is, and scrolled away with it. Where that would cover the reply arrow
  // beside the card's time, or the 👍 on a folded message's row (item 390),
  // it sits above that line, or else below it.
  // In a reply stack it stays below the tab's bottom edge while the tab is in
  // the window, so it never crosses where the tab meets the stack; once the tab
  // has gone above the window it scrolls away with the card as any bar does.
  // Where the tab leaves no room above the reply arrow, it sits under the card
  // rather than over its words and answers. A lit message no longer on show
  // (gone from the page, or folded away in its stack) has no box to sit
  // over: its light goes, so no bar is left over the stack's fold line.
  place() {
    if (this.lit && !this.lit.getClientRects().length) { this.light(null); return; }
    if (this.bar.hidden || !this.lit) return;
    const box = this.lit.getBoundingClientRect(), width = this.bar.offsetWidth, height = this.bar.offsetHeight;
    const view = this.doc.documentElement.clientWidth;
    const left = Math.max(8, Math.min(box.right - width - 12, view - width - 8));
    const tab = this.lit.closest('.reply-stack')?.querySelector(':scope > [data-id] .stack-head, :scope > .stack-rename')?.getBoundingClientRect();
    const floor = Math.max(4, tab?.height ? tab.bottom + 2 : 4);
    let top = Math.min(Math.max(4, box.top - height / 2), box.bottom - height);
    if (floor > 4) top = Math.max(floor, top);
    const card = cardIn(this.lit);
    for (const kept of [card.querySelector(':scope > .message-author .replied-mark'), card.querySelector(':scope > .message-folded > .folded-thumb')]) {
      const mark = kept?.getBoundingClientRect();
      if (mark?.width && mark.right > left && mark.left < left + width && mark.bottom > top && mark.top < top + height) {
        top = mark.top - height - 2 >= floor ? mark.top - height - 2 : floor > 4 ? box.bottom + 2 : mark.bottom + 2;
      }
    }
    this.bar.style.left = `${left}px`;
    this.bar.style.top = `${top}px`;
  }
  // A repaint: each loaded card's reaction line, and the bar as it now stands.
  paint() {
    for (const entry of entries(this.host)) {
      const item = this.item(entry.dataset.id);
      if (item) paintReactions(cardIn(entry), item, this.viewer, this.kind, this.doc);
    }
    if (this.lit && !this.lit.isConnected) this.light(null);
    else if (this.lit) this.paintBar();
  }
  act(name) {
    const entry = this.lit, item = entry && this.item(entry.dataset.id);
    if (!item) return;
    const card = cardIn(entry);
    if (name === 'reply') return this.reply(item.id, card);
    if (name === 'more') return this.more(item, this.buttons.more);
    if (name === 'thumb' && mayThumb(item, this.viewer)) return this.thumb(item, !thumbed(item, this.viewer));
    if ((name === 'yes' || name === 'no') && mayAnswer(item, this.viewer, this.kind) && name in ANSWER_WORDS) return this.answer(item, name);
  }
  // ↑ ↓ move the light and Return replies to the lit message, anywhere on the page
  // but in writing, in a pop-up, or on another control.
  key(event) {
    if (this.copies(event)) return;
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || (event.altKey && event.key !== 'Tab')) return;
    if (event.key === 'Tab') return this.tab(event);
    // Nor under a drawer or sheet open over the page, which makes the page inert.
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || this.doc.querySelector('dialog[open]') || this.host.closest('[inert]')) return;
    const at = this.doc.activeElement;
    if (at?.matches?.(EDITABLE) || at?.closest?.('.rail')) return;
    // The bar's own buttons, and every control in the list but a card itself (a
    // folded line, a link in the words, a reaction, the reply arrow, a stack's
    // line), answer Return themselves. On the bar ↑ and ↓ go on from its message.
    const onBar = this.bar.contains(at) && event.key !== 'Enter' && this.lit?.isConnected;
    const inList = at && this.host.contains(at), onPage = pageItself(at, this.doc) || inList || onBar;
    const entry = inList && this.entryOf(at);
    if (!onPage || inList && event.key === 'Enter' && !(entry && at === cardIn(entry))) return;
    if (event.key === 'Enter') {
      if (event.shiftKey || !this.lit?.isConnected) return;
      event.preventDefault();
      // Words selected in the lit message, or a passage of it lit, are quoted
      // as the Reader opens on it; with none, Return replies as Reply does.
      const chosen = this.passages.chosen(this.lit), item = this.item(this.lit.dataset.id);
      if (chosen && item) this.quote(item.id, cardIn(this.lit), chosen);
      else this.act('reply');
      return;
    }
    const entries = this.entries();
    if (!entries.length) return;
    // A dossier's chevron holding the focus is where the keys are, whether it
    // is a stop of its own or stands for its dossier's head; else the lit message.
    const selected = (at?.matches?.('.stack-toggle') ? stopAt(this.host, at, entries) : null)
      ?? this.lit ?? entries.find(entry => entry.dataset.id === this.host.dataset.lastMessage);
    const index = entries.indexOf(selected);
    const inView = entries.find(entry => entry.getBoundingClientRect().bottom > 0);
    // Focus on the list's own control between the stops (More messages, a
    // stack's line) is where the keys are: ↑ the stop drawn just above it, ↓
    // the one just below.
    const between = inList && at !== this.host && !entry && !at.closest('.stack-toggle');
    const after = stop => Boolean(at.compareDocumentPosition(stop) & at.DOCUMENT_POSITION_FOLLOWING);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = between ? (step > 0 ? entries.find(after) : entries.findLast(stop => !after(stop)))
      : index < 0 ? inView ?? entries[0] : entries[index + step];
    if (!next) {
      // Past the last message (or above the first, with no buttons over the
      // feed), the keys go on to what lies that way in the page's column: More
      // messages, the People row, the Notebook and the reply (arrow-reach.mjs).
      const from = between || !selected ? at : cardIn(selected).hidden ? selected.querySelector('.fold-line') : cardIn(selected);
      if (from && reach(from, step > 0 ? 'down' : 'up', { within: this.host.closest('#main') ?? null, doc: this.doc })) event.preventDefault();
      return;
    }
    event.preventDefault();
    // A dossier's header shows no message toolbar (focusin also clears the
    // light when focus lands on the chevron).
    this.light(next.matches('.stack-toggle') ? null : next);
    const target = cardIn(next).hidden ? next.querySelector('.fold-line') : cardIn(next);
    target?.focus({ preventScroll: true });
    revealSelection(shownSelected(next));
    this.place();
  }
  // ⌘C (Ctrl-C off a Mac) with no words selected copies the lit message's
  // words as written, as the Reader's ⇧⌘C copies the message it shows: the
  // message the pointer or the keys lit last, which Return would answer, or
  // the passage of it lit under the pointer, which Return would quote. Words
  // selected anywhere, the focus in writing or a pop-up, or no lit message
  // leave the key to the browser, which copies as it always does. Whether it
  // took the key.
  copies(event) {
    if (event.defaultPrevented || event.isComposing || !copyKey(event, this.mac) || !this.lit?.isConnected) return false;
    if (this.doc.querySelector('dialog[open]') || this.host.closest('[inert]') || writing(this.doc.activeElement)) return false;
    if (this.doc.getSelection?.()?.isCollapsed === false) return false;
    const item = this.item(this.lit.dataset.id);
    if (!item) return false;
    event.preventDefault();
    // A passage lit in it is what is copied, as Return would quote it.
    const words = this.passages.copied(this.lit);
    if (words) this.copy(item, words); else this.copy(item);
    return true;
  }
  // Whether Return, pressed now, would answer the lit message (key): the
  // focus on the page itself or on a card, not in writing, a rail, a pop-up
  // or another control, which take Return themselves.
  returns(at = this.doc.activeElement) {
    if (this.doc.querySelector('dialog[open]') || this.host.closest('[inert]') || open) return false;
    if (at?.matches?.(EDITABLE) || at?.closest?.('.rail')) return false;
    const inList = at && this.host.contains(at), entry = inList && this.entryOf(at);
    return inList ? Boolean(entry && at === cardIn(entry)) : pageItself(at, this.doc);
  }
  // The bar sits at the end of the page, so the keys reach it from its card:
  // Tab from the lit card goes to the bar's first button, as the card's own ⋯
  // once followed it; Tab from the bar's last goes on from the card, by the
  // browser's own order, and Shift-Tab from its first comes back to the card.
  // Tab from the lit message goes through the 👍 on its folded row
  // (StackFeed.paintFoldedThumb) and the star in its header
  // (StackFeed.paintStar), then its bar's buttons, ⋯ last, then on from the
  // message; Shift-Tab comes back the same way.
  tab(event) {
    if (!this.lit?.isConnected) return;
    const card = cardIn(this.lit), at = this.doc.activeElement;
    const star = card.querySelector(':scope > .message-author > .card-star'), folded = card.querySelector(':scope > .message-folded > .folded-thumb');
    const order = [folded, star, ...(this.bar.hidden ? [] : Object.values(this.buttons))].filter(each => each && !each.hidden && each.getClientRects().length);
    if (!order.length) return;
    const inline = inlineStops(card);
    const index = order.indexOf(at), position = inline.indexOf(at);
    if (event.shiftKey && position === 0) { event.preventDefault(); focusStop(order.at(-1)); }
    else if (position >= 0 && inline[position + (event.shiftKey ? -1 : 1)]) {
      event.preventDefault(); focusStop(inline[position + (event.shiftKey ? -1 : 1)]);
    } else if (!event.shiftKey && feedFence(at)) {
      // Resume native Tab order from this message rather than the overlay.
      const last = card.querySelectorAll('a[href],button,[tabindex]');
      const stop = [...last].filter(el => el.tabIndex >= 0 && el.getClientRects().length).at(-1);
      (stop ?? card).focus({ preventScroll: true });
    } else if (!event.shiftKey && at === card) { event.preventDefault(); order[0].focus({ preventScroll: true }); }
    else if (!event.shiftKey && index === order.length - 1 && inline.length) { event.preventDefault(); focusStop(inline[0]); }
    else if (!event.shiftKey && index === order.length - 1) card.focus({ preventScroll: true });
    else if (!event.shiftKey && index >= 0) { event.preventDefault(); order[index + 1].focus({ preventScroll: true }); }
    else if (event.shiftKey && index === 0) { event.preventDefault(); card.focus({ preventScroll: true }); }
    else if (event.shiftKey && index > 0) { event.preventDefault(); order[index - 1].focus({ preventScroll: true }); }
  }
}

// A message's ⋯ menu (docs/links.md, "A message's menu"): a small list of
// what can be done to one message, opened from the ⋯ on its bar or the
// Reader's, or by a right-click on it. Each item is one tap or click and closes the menu. Up and Down move
// between the items, Escape closes it and gives the focus back to what opened
// it, and a press outside it or a scroll that moves what opened it closes it.
// One is open at a time.
let open = null;

const element = (doc, tag, props = {}) => Object.assign(doc.createElement(tag), props);

// anchor: a ⋯ button, or the card a right-click landed on; at: where the
// pointer was for a right-click, else the menu sits under the anchor. items:
// [{ label, act, keys }] in order; act may answer a promise; keys, the keys
// that do the same, shown at the item's end.
// sheet: on a phone (a narrow window) the menu opens as a sheet from the
// bottom of the window, its items full width, rather than under its button.
export function openMessageMenu({ anchor, at = null, items, label = 'Message', sheet = false, doc = globalThis.document, win = globalThis }) {
  if (open?.anchor === anchor && !at) { open.close(true); return null; }
  open?.close(false);
  if (!items.length) return null;
  const root = element(doc, 'div', { className: 'message-menu-list' });
  root.setAttribute('role', 'menu'); root.setAttribute('aria-label', label);
  const buttons = items.map(item => {
    const button = element(doc, 'button', { type: 'button', textContent: item.label });
    button.setAttribute('role', 'menuitem');
    if (item.keys) { button.append(element(doc, 'span', { className: 'menu-keys', textContent: item.keys })); }
    button.onclick = event => { event.stopPropagation(); menu.close(true); item.act(); };
    return button;
  });
  root.append(...buttons);
  const keys = event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); menu.close(true); return; }
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const now = buttons.indexOf(doc.activeElement);
    const next = step === -Infinity ? 0 : step === Infinity ? buttons.length - 1 : ((now < 0 ? 0 : now) + step + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
  };
  const outside = event => { if (!root.contains(event.target) && !(at === null && anchor.contains(event.target))) menu.close(false); };
  const scrolled = event => {
    if (root.contains(event.target)) return;
    const now = anchor.isConnected === false ? null : anchor.getBoundingClientRect();
    if (now && Math.abs(now.top - box.top) < 1 && Math.abs(now.left - box.left) < 1) return;
    menu.close(root.contains(doc.activeElement));
  };
  root.addEventListener('keydown', keys);
  root.addEventListener('click', event => event.stopPropagation());
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('scroll', scrolled, true);
  const menu = { anchor, root, close(restore) {
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('scroll', scrolled, true);
    root.remove(); anchor.setAttribute?.('aria-expanded', 'false');
    if (open === menu) open = null;
    if (restore && anchor.isConnected !== false) anchor.focus({ preventScroll: true });
  } };
  open = menu;
  anchor.setAttribute?.('aria-expanded', 'true');
  // Inside the Reader's dialog it belongs to the dialog's layer; elsewhere, to the page.
  (anchor.closest?.('dialog[open]') ?? doc.body).append(root);
  const box = anchor.getBoundingClientRect();
  if (sheet && win.matchMedia?.('(max-width: 760px)').matches) {
    root.classList.add('menu-sheet');
    buttons[0].focus({ preventScroll: true });
    return menu;
  }
  const width = root.offsetWidth || 0, height = root.offsetHeight || 0;
  const W = win.innerWidth ?? Infinity, H = win.innerHeight ?? Infinity;
  // At the pointer for a right-click; else under the ⋯, its right edge on the ⋯'s, or above it with no room below.
  const x = at ? at.x : box.right - width, below = at ? at.y : box.bottom + 4, above = (at ? at.y : box.top - 4) - height;
  const top = below + height + 8 <= H || above < 8 ? below : above;
  Object.assign(root.style, { position: 'fixed', top: `${Math.round(Math.max(8, top))}px`, left: `${Math.round(Math.max(8, Math.min(x, W - width - 8)))}px` });
  buttons[0].focus({ preventScroll: true });
  return menu;
}

// Says on the ⋯ button what was just done ("Link copied") until the next press
// or key anywhere, when it shows ⋯ again. A press changes it back once it has
// landed (its click), not as it starts: the words are wider than ⋯, so a
// press on the button itself would otherwise end beside it and open nothing.
export function sayOn(button, words, doc = globalThis.document) {
  const before = button.dataset.said ?? button.textContent;
  button.dataset.said = before; button.textContent = words; button.classList.add('said');
  const back = () => {
    doc.removeEventListener('click', back, true); doc.removeEventListener('keydown', back, true);
    if (button.textContent === words) { button.textContent = before; button.classList.remove('said'); }
    delete button.dataset.said;
  };
  doc.addEventListener('click', back, true); doc.addEventListener('keydown', back, true);
}

// Takes back what sayOn said, at once: the ⋯ it was said on now stands for
// another message.
export function unsay(button) {
  if (button.dataset.said === undefined) return;
  button.textContent = button.dataset.said; button.classList.remove('said');
  delete button.dataset.said;
}

// What a copy the clipboard refused says, wherever a message's words are copied.
export const COPY_REFUSED = 'Could not copy. Select the text and use Copy.';
// Puts text on the clipboard. Settles true when it is there.
export async function copyText(text, nav = globalThis.navigator) {
  try { await nav.clipboard.writeText(text); return true; } catch { return false; }
}
