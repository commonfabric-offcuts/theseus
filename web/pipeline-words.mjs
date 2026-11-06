// The pipeline's words (item 84; docs/pipeline.md): pure functions of what the
// `pipeline` and `pipeline_item` views answer. No DOM, and no numbers of its
// own: every number the words use arrives in the view (typical.min, stage_times.min).
import { shownTime } from './times.mjs';

export const GLYPHS = {
  building: ['🔨', 'Being built'], next: ['⏭', 'Next'], idle: ['💤', 'Not started'],
  decide: ['❓', 'Needs your decision'], shipped: ['✅', 'Shipped'], dropped: ['–', 'Dropped'],
};
export const SIZE_WORDS = { small: 'Small', medium: 'Medium', large: 'Large' };
// D14: until a message's ⋯ menu offers "Add to pipeline" (24).
export const EMPTY_WORDS = ['Nothing in this pipeline yet.',
  'Add the first item with Add item. Give a message number and its author is recorded as who raised it.',
  'Stages and their times appear once work starts. Typical times appear once at least 3 past items of a size have been through a stage.'];

// A name that starts a sentence is capitalised: "Fable orders it".
export const sentenceName = name => name ? name[0].toUpperCase() + name.slice(1) : '';

// "Alice", "Alice and Bob", "Alice, Bob and Carol".
export function listWords(words) {
  const list = words.map(String);
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

// "1 h 39 min", "25 min", "23 h".
export function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000)), hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export const glyphWords = glyph => GLYPHS[glyph] ?? GLYPHS.idle;

// "Build since 5:41 AM · 1 h 39 min so far"
export function stageLine(stage, now) {
  return { name: stage.name, since: `since ${shownTime(stage.entered_ms, now)}`, soFar: `${duration(now - stage.entered_ms)} so far` };
}

// What past visits say about a stage, or that they are too few (D2).
export function typicalWords(typical, { size, unitMany = 'items' } = {}) {
  if (!typical) return '';
  if ('too_few' in typical) return `Too few past ${unitMany} to show a typical time for this stage: ${typical.too_few} so far, and it takes ${typical.min}.`;
  const loose = typical.loose ? ' Only a few past items, so read it loosely.' : '';
  if (typical.basis === 'release') return `Past releases took ${duration(typical.ms)} in this stage (median of the last ${typical.of}).${loose}`;
  if (typical.basis === 'outcome') return `Past data: this outcome's past ${unitMany} took ${duration(typical.ms)} in this stage (median of ${typical.of}). Not a promise.${loose}`;
  return `Past ${size ?? ''} items took ${duration(typical.ms)} in this stage (median of ${typical.of}).${loose}`.replace('Past  items', 'Past items');
}

// A cell of "How long stages have taken".
export function typicalCell(typical) {
  if (!typical) return ['', ''];
  if ('too_few' in typical) return ['Too few past items', `${typical.too_few} so far`];
  return [duration(typical.ms), `median of ${typical.of}`];
}

// Who raised an item, as a phrase after its size: "raised by fable", or "found in review".
export function raisedWords(item) {
  if (item.raised_by) return { prefix: 'raised by ', who: item.raised_by };
  return { prefix: item.raised_note || '', who: null };
}

// Where an item came from, grouped by topic: "From Shared targets #257, and #263; the wake plan, step 6".
// Returns runs of {text} and {message} parts for the page to link, and whether it folds.
export function sourceRuns(sources, reader) {
  const shown = sources?.shown ?? [];
  const groups = [];
  for (const source of shown) {
    const key = source.kind === 'message' ? (source.readable ? `t:${source.topic_title}` : 'unreadable')
      : source.kind === 'page' ? `p:${source.memory_item_id}` : `n:${source.text}`;
    let group = groups.find(entry => entry.key === key);
    if (!group) groups.push(group = { key, list: [] });
    group.list.push(source);
  }
  const parts = [];
  groups.forEach((group, index) => {
    if (index) parts.push({ text: '; ' });
    group.list.forEach((source, i) => {
      if (i) parts.push({ text: i === group.list.length - 1 ? ', and ' : ', ' });
      if (source.kind === 'message' && source.readable) {
        parts.push({ message: source, text: `${i ? '' : `${source.topic_title} `}#${source.seq}` });
        if (source.author === reader) parts.push({ text: ' (you)' });
      } else if (source.kind === 'message') parts.push({ text: "a message you can't open" });
      else if (source.kind === 'page') parts.push({ page: source, text: `“${source.title}”` });
      else parts.push({ text: source.text });
    });
  });
  const names = groups.map(group => group.key.startsWith('t:') ? group.key.slice(2) : group.key.startsWith('n:') ? group.key.slice(2)
    : group.key === 'unreadable' ? "messages you can't open" : `“${group.list[0].title}”`);
  const messages = sources?.messages ?? 0, notes = sources?.notes ?? 0, yours = sources?.yours ?? 0;
  const count = [messages ? `${messages} message${messages === 1 ? '' : 's'}` : '', notes ? `${notes} note${notes === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' and ') + (yours ? `, ${yours === messages ? (yours === 1 ? 'yours' : 'all yours') : `${yours} from you`}` : '');
  const total = sources?.count ?? shown.length;
  return { parts, folds: total > 3, summary: `From ${listWords(names)} · ${count}`, more: total - shown.length };
}

// "Still gathering context in a reply thread under Friction log #462 (you). It moves up to Next when ..."
export function gatheringWords(gathering, reader) {
  if (!gathering) return null;
  if (gathering.kind === 'thread') {
    if (!gathering.readable) return { lead: 'Still gathering context in a reply thread you can’t open', link: null, after: '. It moves up to Next when it is ready to build.' };
    return { lead: 'Still gathering context in a reply thread under ', link: `${gathering.topic_title} #${gathering.seq}`,
      mine: gathering.author === reader, after: '. It moves up to Next when it is ready to build, and keeps the thread for whoever builds it.' };
  }
  return { lead: 'Still gathering context on a Notebook page, ', link: `“${gathering.title}”`,
    after: '. It moves up to Next when it is ready to build, and keeps the page for whoever builds it.' };
}

// The latest move, as the row says it: "Moved above 72 by you, 7:12 AM." or "Moved to Next by fable, 6:35 AM, from your Friction log message".
export function placedWords(placed, reader, sectionWords, now) {
  if (!placed || placed.kind !== 'moved') return null;
  const who = placed.by === reader ? 'you' : placed.by;
  const when = shownTime(placed.ms, now);
  if (placed.section === 'dropped') return `Dropped by ${who}, ${when}.`;
  let where;
  if (placed.relative?.above !== undefined && placed.relative.above !== null) where = `above ${placed.relative.above}`;
  else if (placed.relative?.below !== undefined && placed.relative.below !== null) where = `below ${placed.relative.below}`;
  else where = `to ${sectionWords?.[placed.section] ?? placed.section}`;
  if (placed.undo_of) return `Put back by ${who}, ${when}.`;
  const because = placed.because ? `, from ${placed.because.author === reader ? 'your' : `${placed.because.author}'s`} ${placed.because.topic_title} message` : '';
  return `Moved ${where} by ${who}, ${when}${because}.`;
}

// What an item waits for: " · waits for 88" while 88 has not shipped.
export const waitsWords = needs => {
  const open = (needs ?? []).filter(need => !need.shipped).map(need => need.number);
  return open.length ? ` · waits for ${listWords(open)}` : '';
};

// The three facts boxes (9.1): Live now, Next release, Being built; or an unsized pipeline's own.
export function factBoxes(answer, now) {
  const facts = answer.facts ?? {}, pipeline = answer.pipeline;
  if (!pipeline.ships_in_releases) {
    const building = facts.building ?? { items: [], pieces: 0 };
    return [
      ['Being prepared', building.items.length ? `${building.items.length} ${building.items.length === 1 ? pipeline.unit_one : pipeline.unit_many}` : 'Nothing yet',
        building.items.length ? listWords(building.items) : ''],
      ['Done', `${facts.done ?? 0} ${(facts.done ?? 0) === 1 ? pipeline.unit_one : pipeline.unit_many}`, 'Since this outcome began.'],
    ];
  }
  const live = facts.live ? ['Live now', `Release ${facts.live.release}`, `deployed ${shownTime(facts.live.deployed_ms, now)}`] : ['Live now', 'Nothing released yet', ''];
  let next;
  if (facts.next_release) {
    const stage = facts.next_release.stage;
    next = ['Next release', `Release ${facts.next_release.release}${stage ? `, in ${stage.name.toLowerCase()}` : ''}`,
      stage ? `since ${shownTime(stage.entered_ms, now)}, with ${facts.next_release.items.length} items` : ''];
  } else {
    const waiting = facts.approved_waiting ?? [];
    next = ['Next release', 'Nothing combined yet', waiting.length ? `${listWords(waiting)} ${waiting.length === 1 ? 'is' : 'are'} approved and wait${waiting.length === 1 ? 's' : ''} to be combined.` : ''];
  }
  const building = facts.building ?? { items: [], pieces: 0 };
  const built = building.items.length
    ? ['Being built', `${building.items.length} item${building.items.length === 1 ? '' : 's'} in ${building.pieces} piece${building.pieces === 1 ? '' : 's'}`, building.items.join(', ')]
    : ['Being built', 'Nothing yet', ''];
  return [live, next, built];
}

// A piece's topic line: "Topic: Building 37, 35 and 34 · built together as one large piece · Activity seen 7:16 AM".
export function pieceTopicWords(piece, now) {
  const together = piece.items.length > 1 && piece.size ? ` · built together as one ${piece.size} piece` : '';
  const work = piece.topic?.work;
  let activity = '';
  if (work?.observed && work.seen_ms) activity = ` · Activity seen ${shownTime(work.seen_ms, now)}`;
  else if (work?.seen_ms) activity = ` · No activity seen since ${shownTime(work.seen_ms, now)}`;
  else activity = ' · No activity seen yet';
  return { together, activity };
}

// "Build: 5:41 AM to 6:31 AM, 46 min · sent back with 3 findings"
export function historyLine(entry, now) {
  const outcome = entry.left_note || entry.left_outcome || '';
  return `${entry.name}: ${shownTime(entry.entered_ms, now)} to ${shownTime(entry.left_ms, now)}, ${duration(entry.left_ms - entry.entered_ms)}${outcome ? ` · ${outcome}` : ''}`;
}

// An item's events in its record: "Added by fable, 6:35 AM", "Moved to Next by fable ...".
export function eventWords(event, reader, sectionWords, now) {
  const who = event.by === reader ? 'you' : event.by;
  const when = shownTime(event.ms, now);
  if (event.kind === 'added') return `Added by ${who}, ${when}${event.payload?.imported ? ', from the hand-written page' : ''}.`;
  if (event.kind === 'edited') return `Edited by ${who}, ${when}: ${Object.keys(event.payload?.after ?? {}).join(', ')}.`;
  if (event.kind === 'moved') {
    const after = event.payload?.after ?? {};
    if (after.section === 'dropped') return `Dropped by ${who}, ${when}.`;
    if (event.payload?.undo_of) return `Put back by ${who}, ${when}.`;
    const relative = event.payload?.relative;
    const where = relative?.above != null ? `above ${relative.above}` : relative?.below != null ? `below ${relative.below}` : `to ${sectionWords?.[after.section] ?? after.section}`;
    return `Moved ${where} by ${who}, ${when}.`;
  }
  return `${event.kind} by ${who}, ${when}.`;
}

// The waiting row: " · about 92, <title> · fable asked you, since 7:05 AM".
export const waitingWords = (row, now) => ` · about ${row.number}, ${row.item_title} · ${row.by} asked you, since ${shownTime(row.since_ms, now)}`;

// Checks that a view answer has the shape these words read; a failure names what is missing.
export function checkPipeline(answer, instanceId) {
  if (!answer || answer.error) throw Error(answer?.error?.message ?? 'The pipeline could not be read.');
  if (answer.instance_id !== instanceId) throw Error('This pipeline belongs to a different instance.');
  if (answer.pipeline !== null && (typeof answer.pipeline !== 'object' || !Array.isArray(answer.pipeline.stages))) throw Error('The pipeline could not be confirmed.');
  if (answer.items !== undefined && !Array.isArray(answer.items)) throw Error('The pipeline could not be confirmed.');
  return answer;
}
