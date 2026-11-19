import { glyph } from './glyphs.mjs';
// How each card in a topic reads to the person (docs/topic-reading.md):
// whether they have read it, whether it is talk between agents, and whether
// they have replied to it. Each is a data attribute on the card, so the
// classes the card's colors own are never touched.
import { datedTime, shownTime } from './times.mjs';
import { reactionsOf } from './reactions.mjs';
import { waitingDots } from './outcome-conversation.mjs';

// Talk between agents: an agent wrote it, by name to agents only, and the
// reader is not among them, did not write it, and wrote nothing it answers.
// kindOf(name) is 'agent', 'human' or undefined for someone not known; an
// unknown name is never taken for an agent. Only a person's page dims it.
export function agentTalk(item, viewer, viewerKind, kindOf) {
  if (typeof viewer !== 'string' || !viewer || typeof kindOf !== 'function') throw Error('Whether a message is talk between agents depends on who reads it.');
  const to = item.addressees ?? [];
  return viewerKind === 'human' && item.author_kind === 'agent' && to.length > 0 && !to.includes(viewer) &&
    item.author_id !== viewer && item.reply_to_author !== viewer && to.every(name => kindOf(name) === 'agent');
}

// Whether the person has read a message, as this visit shows it. A message
// keeps how it read when the topic opened, so cards do not change under the
// person's eyes as they scroll; it reads as read at once when they open it in
// the Reader, reply to it or thumb it up, and as unread while it is marked
// unread. A thumbs-up reads it in Core (docs/thumbs.md), here or on another
// page or device, and taking it back leaves it read: any revision of their
// own thumb (thumb_revision above 0) says they gave one. A 👍 given also
// clears their mark in Core, and the page learns it (Reactions' cleared), so
// a marked card reads at once. Their own messages are always read.
export function readNow(item, { viewer, marked = false, opened = false }) {
  if (item.author_id === viewer) return true;
  if (marked) return false;
  return item.unread !== true || opened || Boolean(item.replied) || reactionsOf(item).thumb_revision > 0;
}

// The reader's newest reply to each message, kept as replies arrive: Core says
// it for each message it sends (`replied`), and a reply the person writes
// while the page is open is seen here first.
export function learnReply(messages, item, viewer) {
  if (item.author_id !== viewer || !item.reply_to) return null;
  const parent = messages.get(item.reply_to);
  if (!parent || parent.replied && parent.replied.id !== item.id && (messages.get(parent.replied.id)?.seq ?? 0) > item.seq) return null;
  parent.replied = { id: item.id, sent_ms: Number.isSafeInteger(item.sent_ms) ? item.sent_ms : null };
  return parent;
}

// Waiting for a reply (item 475): Core says it for each of the reader's own
// messages it sends (`awaiting_reply`, aim_next/stacks.py), true while an agent
// received the message and nobody else has replied to it. Core alone starts a
// wait (and only from where the rule begins); the page only ends one, as soon
// as a reply is in front of it, by Core's rule: a message by someone else,
// after the waiting message, in its dossier (its stack_position's root), or
// replying to it (reply_to) wherever it is stacked, or on the record naming the
// reader; or an agent's thumbs-up on it. kindOf(name) is 'agent', 'human' or
// undefined; an unknown name is never taken for an agent. Returns the messages
// it ended.
export function learnAnswered(messages, viewer, kindOf) {
  if (typeof viewer !== 'string' || !viewer || typeof kindOf !== 'function') throw Error('Whether a message is answered depends on who reads it.');
  const latest = new Map(), replied = new Set();
  let named = 0;
  for (const item of messages.values()) {
    if (item.author_id === viewer || !Number.isSafeInteger(item.seq)) continue;
    const root = item.stack_position?.root_id;
    if (typeof root === 'string') latest.set(root, Math.max(latest.get(root) ?? 0, item.seq));
    if (typeof item.reply_to === 'string') replied.add(item.reply_to);
    if (item.whisper !== true && (item.addressees ?? []).includes(viewer)) named = Math.max(named, item.seq);
  }
  const ended = [];
  for (const item of messages.values()) {
    if (item.awaiting_reply !== true) continue;
    const thumbed = (reactionsOf(item).thumbs ?? []).some(thumb => thumb.actor_id !== viewer && kindOf(thumb.actor_id) === 'agent');
    if (!thumbed && !replied.has(item.id) && named <= item.seq && (latest.get(item.stack_position?.root_id) ?? 0) <= item.seq) continue;
    item.awaiting_reply = false;
    ended.push(item);
  }
  return ended;
}

export const AWAITING_WORDS = 'Waiting for a reply';
export const UNWATCHED_WORDS = 'No agent was woken: no agent was addressed or listening when this message was sent.';
// The Conversation's three dots at the foot of the card (outcome-conversation.mjs),
// in the card's own ink, while the message waits for a reply; gone once it does
// not. Repainting keeps one.
export function paintAwaiting(card, item, doc = card.ownerDocument) {
  const row = card.querySelector(':scope > .reply-wait');
  const unwatched = item.no_agent_notified === true;
  if (item.awaiting_reply !== true && !unwatched) { row?.remove(); return; }
  if (row?.dataset.unwatched === String(unwatched)) return;
  row?.remove();
  const host = doc.createElement('span'); host.className = 'item-tags reply-wait';
  const group = doc.createElement('span'); group.className = 'item-tag-group';
  host.dataset.unwatched = String(unwatched);
  if (unwatched) {
    const mark = doc.createElement('span'); mark.className = 'no-agent-notified';
    mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', UNWATCHED_WORDS); mark.title = UNWATCHED_WORDS;
    mark.append(glyph('unwatched', doc, 18)); group.append(mark);
  } else group.append(waitingDots(doc, AWAITING_WORDS));
  host.append(group);
  card.append(host);
}

// The arrow, drawn as nodes: a hook back to the left.
function arrowIcon(doc) {
  const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
  for (const [name, value] of Object.entries({ viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  for (const [name, value] of Object.entries({ d: 'M6.5 3.5 2.5 7.5l4 4M2.8 7.5H9a4.5 4.5 0 0 1 4.5 4.5v.5', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(name, value);
  svg.append(path);
  return svg;
}
const repliedWords = sent => (sent === null ? 'You replied' : `You replied at ${shownTime(sent)}`);

// Keep the shown tip inside the page's viewport, including when its arrow
// is near either edge. innerWidth can already include page overflow on a
// phone; clientWidth is the device-sized layout we must keep (831).
function placeReplyTip(arrow) {
  const tip = arrow.querySelector('.replied-words');
  // Measure off the left edge first: even a temporary right overflow can
  // enlarge WebKit's page scroll area before the final placement.
  tip.style.setProperty('--reply-tip-left', '-100vw');
  const size = tip.getBoundingClientRect().width;
  if (!size) return;
  const at = arrow.getBoundingClientRect();
  const edge = 16, width = arrow.ownerDocument.documentElement.clientWidth;
  const left = Math.max(edge, Math.min(at.left, width - edge - size));
  tip.style.setProperty('--reply-tip-left', `${left - at.left}px`);
}

// The card's read and agent-talk state, and its reply arrow: on the card's
// author line, beside the time, shown once the person has replied. It sits
// there, not in a corner, so the message bar (message-menu.mjs), which floats
// over the lit card's top corner, never covers it. Under the
// pointer it says when ("You replied at 4:40 AM") and a click goes to the
// reply (go). Nothing needs the pointer: a first tap shows the words, as the
// pointer would, and a second tap on the arrow or its words goes to the reply;
// a tap anywhere else puts the words away (showOnTap). A card is a button, so
// the arrow is a part of it that the card's own click handler sends to go; a
// screen reader hears the words with the card's.
export function paintReading(card, item, { read, quiet, go }) {
  if (read) card.dataset.read = ''; else delete card.dataset.read;
  if (quiet) card.dataset.talk = 'agents'; else delete card.dataset.talk;
  let arrow = card.querySelector('.replied-mark');
  if (!item.replied) { arrow?.remove(); return; }
  if (!arrow) {
    const doc = card.ownerDocument;
    arrow = doc.createElement('span'); arrow.className = 'replied-mark';
    const icon = doc.createElement('span'); icon.className = 'replied-icon'; icon.append(arrowIcon(doc));
    const words = doc.createElement('span'); words.className = 'replied-words';
    arrow.append(icon, words);
  }
  // The author line is drawn afresh when what it shows changes (marks.mjs), so the arrow goes back at its end.
  const line = card.querySelector(':scope > .message-author') ?? card;
  if (arrow.parentElement !== line || arrow.nextSibling) line.append(arrow);
  const sent = item.replied.sent_ms ?? null, words = repliedWords(sent);
  arrow.dataset.reply = item.replied.id;
  arrow.title = sent === null ? words : `You replied at ${datedTime(sent)}`;
  const shown = arrow.querySelector('.replied-words');
  if (shown.textContent !== words) shown.textContent = words;
  arrow.onpointerenter = () => placeReplyTip(arrow);
  arrow.onpointerdown = event => { arrow.dataset.pointer = event.pointerType; };
  arrow.onclick = event => {
    event.stopPropagation();
    const touched = arrow.dataset.pointer === 'touch' || arrow.dataset.pointer === 'pen';
    delete arrow.dataset.pointer;
    if (touched && !('shown' in arrow.dataset)) { arrow.dataset.shown = ''; placeReplyTip(arrow); return; }
    delete arrow.dataset.shown;
    go(item.replied.id);
  };
}

// The words a tap showed stay until the next press anywhere but on them: one
// listener for the whole page, added once as this module loads, so a move in
// place, which ends only what the page added since it began
// (in-place-navigation.mjs), never takes it away.
const page = globalThis.document;
page?.addEventListener?.('pointerdown', event => {
  for (const arrow of page.querySelectorAll('.replied-mark[data-shown]')) if (!arrow.contains(event.target)) delete arrow.dataset.shown;
}, true);
page?.defaultView?.addEventListener?.('resize', () => {
  for (const arrow of page.querySelectorAll('.replied-mark:is([data-shown],:hover)')) placeReplyTip(arrow);
});

// A quiet message (talk between agents) wakes when the person presses it: a
// tap or click on its line or card lifts the dim for the rest of the visit,
// as the pointer resting on it does, so a phone needs nothing more than a tap.
const waking = new WeakSet();
export function wakeOnPress(list) {
  if (waking.has(list)) return;
  waking.add(list);
  list.addEventListener('click', event => {
    const entry = event.target.closest?.('[data-talk=agents]');
    if (entry && list.contains(entry)) (entry.closest('.message-fold') ?? entry).dataset.woken = '';
  }, true);
}

// The ranges of messages seen on screen, for `topic.read_through`. A range
// runs over messages in the topic's order, so it holds only messages that were
// seen: a message loaded between two seen ones and not itself on screen (a
// reply folded in its stack, or a card a stack moved elsewhere) ends one range
// and starts the next. The reader's own messages are never delivered to them,
// so they neither count nor break a range. runOf(id) is the loaded run a
// message is in; a range never spans a gap between runs.
export function seenRanges(items, shown, runOf, viewer) {
  const runs = new Map();
  for (const item of items) {
    const run = runOf(item.id);
    if (!runs.has(run)) runs.set(run, []);
    runs.get(run).push(item);
  }
  const ranges = [];
  for (const run of runs.values()) {
    run.sort((a, b) => a.seq - b.seq);
    let open = null;
    for (const item of run) {
      if (item.author_id === viewer) continue;
      if (shown(item.seq)) { if (open) open[1] = item.seq; else open = [item.seq, item.seq]; }
      else if (open) { ranges.push(open); open = null; }
    }
    if (open) ranges.push(open);
  }
  return ranges;
}
