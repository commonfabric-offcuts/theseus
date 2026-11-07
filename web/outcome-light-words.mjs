// The outcome light's words (item 86, docs/outcome-light.md). The server
// sends kinds and numbers; these turn them into what a person would say out
// loud, and keep it true: no line says nobody is working, and none guesses
// what comes next. Nothing here reads the page or the clock: a time is a part
// {ms, form} that the painter says with spokenTime, so it follows the day.
//
// Every function returns parts: strings and times, joined in order. The
// page and the rows say a state and a time, and one Last line; what the
// light is made of (the lead, the facts, the also-lines) waits behind the ⓘ.

export const SOURCE = 'This comes from posts, agent work and questions in Theseus. Work done somewhere else won’t show here.';
export const MAYBE = 'It might be stuck, or someone may be working on it outside Theseus.';
export const UNREADABLE_PEEK = 'Open the outcome to try again.';

const time = (ms, form) => Number.isSafeInteger(ms) ? [{ ms, form }] : [];
const known = ms => Number.isSafeInteger(ms);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "35, 37, 47, 48, 88 and 91"
const listed = values => values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
// What someone did, after their name: "posted at 6:31 AM", "worked on it yesterday at 11:58 PM".
const did = (how, ms, about = false) => [how === 'turn' ? 'worked on it' : about ? 'posted about it' : 'posted', ...(known(ms) ? [' ', ...time(ms, 'at')] : [])];
// After a comma: "yesterday at 3:15 PM", or today "at 6:45 AM" with no comma.
const whenAfter = ms => !known(ms) ? [] : [' ', { ms, form: 'commaSince' }];

// The light's kind as the page names it on its lamp: the four, or unknown.
export const lampKind = light => light?.light ?? 'unknown';

// The rail row's line: a state and a time, nothing more, in two pieces that
// each stay whole, so a narrow row breaks only between them: [what, when].
export function shortPieces(light) {
  const short = light?.short;
  if (!light?.light) return [['Couldn’t check'], ['where it stands']];
  switch (short?.kind) {
    case 'asks': return [['Waiting on you ·'], [plural(short.count, 'question', 'questions')]];
    case 'seen': return known(short.ms) ? [['Worked on'], time(short.ms, 'at')] : [['Being worked on'], []];
    case 'checks_pass': return [['Done'], []];
    case 'reached': return [['Done ·'], ['reached ', ...time(short.ms, 'dayAt')]];
    case 'no_topics': return [['No topics yet'], []];
    // Talk outside Now: quiet since the last work in Now; the talk is the outcome's Last line.
    case 'talk': return known(short.since_ms) ? [['Quiet since'], time(short.since_ms, 'short')] : [['Quiet'], []];
    default: return known(short?.ms) ? [['Quiet since'], time(short.ms, 'short')] : [['Quiet'], []];
  }
}

// The light's name with its time, at the top of the peek and of the outcome
// page: "Quiet since 3:32 PM", "Worked on at 3:32 PM", "Waiting on you · 1 question".
export function lightName(light) {
  if (!light?.light) return ['Couldn’t check where it stands'];
  const short = light.short ?? {};
  if (light.light === 'waiting') return short.kind === 'asks' ? [`Waiting on you · ${plural(short.count, 'question', 'questions')}`] : ['Waiting on you'];
  if (light.light === 'built') return known(short.ms) ? ['Worked on ', ...time(short.ms, 'at')] : ['Being worked on'];
  if (light.light === 'done') return short.kind === 'reached' ? ['Done · reached ', ...time(short.ms, 'dayAt')] : ['Done'];
  if (short.kind === 'no_topics') return ['No topics yet'];
  if (short.kind === 'talk') return known(short.since_ms) ? ['Quiet since ', ...time(short.since_ms, 'since')] : ['Quiet'];
  return known(short.ms) ? ['Quiet since ', ...time(short.ms, 'since')] : ['Quiet'];
}

// The one line under the name: who did the newest thing, and where.
// {label, by, link: {topic | item, text}} for "Last: fable in “No header bar…”"
// (a question waiting on the reader: "Asked: fable in “Speaker notes”"), or
// {text} for a line with nothing to link, or null when there is nothing to add.
export function lastLine(answer) {
  const facts = Array.isArray(answer?.facts) ? answer.facts : [];
  if (answer?.lead?.kind === 'reached') return { text: [`${answer.lead.by} said it was reached`] };
  for (const fact of facts) {
    switch (fact?.kind) {
      case 'ask': return { label: 'Asked:', by: fact.by, link: { topic: fact.topic_id, text: fact.title + (fact.title_truncated ? '…' : '') } };
      case 'topic_work': return { label: 'Last:', by: fact.by, link: { topic: fact.topic_id, text: fact.title + (fact.title_truncated ? '…' : '') } };
      case 'last_activity': return { label: 'Last:', by: fact.by, link: { topic: fact.topic_id, text: fact.topic_title + (fact.title_truncated ? '…' : '') } };
      case 'item_work': case 'last_now_work': return { label: 'Last:', by: fact.by, link: { item: fact.item, text: `${fact.item}. ${fact.title}` } };
      case 'created': return factParts(fact);
      default: break;
    }
  }
  return null;
}

// What the light is made of, behind the ⓘ on the outcome page: the
// sentence that says why. facts tells "The latest:" apart.
export function leadWords(lead, facts = [], outcome = '') {
  const more = facts.some(fact => fact?.kind === 'more_items'), lastNow = facts.some(fact => fact?.kind === 'last_now_work');
  switch (lead?.kind) {
    case 'asks': return [lead.count === 1 ? 'A question is waiting for your answer:' : `${lead.count} questions are waiting for your answer:`];
    case 'now_work':
      if (lead.of === 1) return ['Its one item in Now was worked on in the last hour:'];
      if (more) return [`${lead.seen} of the ${lead.of} items in Now were worked on in the last hour. The latest:`];
      return [`${lead.seen} of the ${lead.of} items in Now ${lead.seen === 1 ? 'was' : 'were'} worked on in the last hour:`];
    case 'topics_work': return ['It has no pipeline, so work in any of its open topics counts. Worked on in the last hour:'];
    case 'done': return [lead.pipeline ? 'Everything in its pipeline has shipped, and all its checks pass:' : 'All its checks pass:'];
    case 'reached': return [`${lead.by} said ${outcome || 'it'} was reached`, ...(known(lead.ms) ? [',', ...whenAfter(lead.ms)] : []), ':'];
    case 'topics_quiet': return ['Nothing has been posted or worked on in its open topics since then, and no one is waiting on an answer.'];
    case 'now_quiet':
      if (lead.of === 0) return ['Nothing is in Now, and no one is waiting on an answer.'];
      if (lead.ever === false) return [`None of its ${lead.of} items in Now has been worked on yet, and no one is waiting on an answer.`];
      if (lead.of === 1) return ['Its one item in Now has not been worked on since then, and no one is waiting on an answer.' + (lastNow ? ' The last one worked on:' : '')];
      return [`None of its ${lead.of} items in Now has been worked on since then, and no one is waiting on an answer.` + (lastNow ? ' The last one worked on:' : '')];
    case 'now_quiet_talk':
      return [`None of its ${lead.of} items in Now has been worked on `, ...(known(lead.since_ms) ? ['since ', ...time(lead.since_ms, 'day')] : ['yet']),
        ', and no one is waiting on an answer. ', lead.how === 'turn' ? 'Someone worked in a topic ' : 'Someone posted ', ...time(lead.talk_ms, 'part'), ', outside Now:'];
    case 'no_topics': return ['There’s nothing to show until it has a topic.'];
    case 'unreadable': return ['Theseus couldn’t read this outcome’s pipeline just now, so it isn’t guessing. Questions for you are checked separately: if one were waiting, you’d still see it.'];
    default: return [];
  }
}

// One fact: {link, detail} where link names a topic or an item and detail
// follows it, muted, after " — "; or {text} for a fact that is a sentence.
export function factParts(fact) {
  switch (fact?.kind) {
    case 'ask': return { link: { topic: fact.topic_id, text: fact.title + (fact.title_truncated ? '…' : '') },
      detail: fact.by ? [`${fact.by} asked`, ...(known(fact.ms) ? [' ', ...time(fact.ms, 'at')] : [])] : ['waiting on your answer'] };
    case 'item_work': return { link: { item: fact.item, text: `${fact.item}. ${fact.title}` }, detail: [`${fact.by} `, ...did(fact.how, fact.ms)] };
    case 'topic_work': return { link: { topic: fact.topic_id, text: fact.title + (fact.title_truncated ? '…' : '') },
      detail: fact.by ? [`${fact.by} `, ...did(fact.how, fact.ms)] : ['waiting on an answer'] };
    case 'last_now_work': return { link: { item: fact.item, text: `${fact.item}. ${fact.title}` }, detail: [`${fact.by} `, ...did(fact.how, fact.ms, true)] };
    case 'more_items': return { text: [`and ${fact.numbers.length} more: ${listed(fact.numbers.map(String))}`] };
    case 'all_shipped': return { text: [`All ${fact.count} items have shipped. The last went out`, ...whenAfter(fact.last_release_ms), '.'] };
    case 'checks_pass': return { text: [`All ${fact.count} checks passed when they last ran`, ...(known(fact.last_run_ms) ? [',', ...whenAfter(fact.last_run_ms)] : []), '.'] };
    case 'last_activity': return { text: [`The last thing that happened: ${fact.by} ${fact.how === 'turn' ? 'worked in' : 'posted in'} ${fact.topic_title},`, ...whenAfter(fact.ms), '.'] };
    case 'created': return { text: known(fact.ms) ? [`Started by ${fact.by} `, ...time(fact.ms, 'at'), '.'] : [`Started by ${fact.by}.`] };
    default: return { text: [] };
  }
}

// One also-line under the facts.
export function alsoWords(also) {
  switch (also?.kind) {
    case 'outside_now': return [`Outside Now, ${also.by} ${also.how === 'turn' ? 'worked in' : 'posted in'} ${also.topic_title} `, ...time(also.ms, 'at'), '.'];
    case 'also_built': return [`Work is going on too: ${also.seen} of the ${also.of} items in Now ${also.seen === 1 ? 'was' : 'were'} worked on in the last hour.`];
    case 'last_now_work': return [`The last work on anything in Now was ${also.by}’s ${also.how === 'turn' ? 'work' : 'post'} in ${also.topic_title},`, ...whenAfter(also.ms), '.'];
    case 'may_be_stalled': return [MAYBE];
    case 'done_again_when': return [`Its other ${also.shipped} items have shipped and all ${also.checks} checks pass. It shows Done again when ${listed(also.waiting_on.map(String))} ${also.waiting_on.length === 1 ? 'ships' : 'ship'} and the checks still pass.`];
    default: return [];
  }
}
