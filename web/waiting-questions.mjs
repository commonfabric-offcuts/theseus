// Waiting on you takes you to the question (item 148, docs/outcome-light.md).
// A press on Waiting on you (the outline's outcome row, a topic row, the
// Conversation row or the outcome light) opens the oldest question waiting on
// the reader there, and each press after it the next one, round to the oldest
// again after the newest. A question is { topic_id, message_id?, ms }: an ask
// fact of outcome_light, a topic's ask or a wait in the Conversation, with the
// time it was asked. Where a place's presses have got to is no more than the
// last question opened there: one answered since drops out, and the next press
// goes on from where it stood. It is kept for the tab (sessionStorage), since
// most presses leave the page: the outcome's page reaches a topic by loading
// it, and Back loads the outcome's page again. A tab that cannot keep it, or
// keeps a value with no time, starts again at the oldest; nothing says so.

const time = question => Number.isSafeInteger(question?.ms) ? question.ms : 0;
const text = value => typeof value === 'string' ? value : '';
// Oldest first; questions asked in the same millisecond keep one order, by topic and then by message.
export function compareQuestions(a, b) {
  return time(a) - time(b) || text(a.topic_id).localeCompare(text(b.topic_id)) || text(a.message_id).localeCompare(text(b.message_id));
}
export const oldestFirst = questions => (Array.isArray(questions) ? questions : []).filter(question => text(question?.topic_id)).sort(compareQuestions);

// The question after last, oldest first, or the oldest when none comes after it; null when none waits.
export function nextQuestion(questions, last = null) {
  const ordered = oldestFirst(questions);
  if (!last) return ordered[0] ?? null;
  return ordered.find(question => compareQuestions(question, last) > 0) ?? ordered[0] ?? null;
}

// Where a question opens: its topic, at its message when it was asked by one.
export const questionTarget = question => ({ kind: 'topic', id: question.topic_id, ...(text(question.message_id) ? { message: question.message_id } : {}) });

const tab = () => globalThis.sessionStorage, KEY = 'waiting-question:';

// The presses of each place, by a key such as "outcome:w1" or "conversation:w1".
// The page's own presses are read first; a place it has not pressed yet starts
// from what the tab kept. storage() is sessionStorage, or a stand-in in tests.
export class QuestionPresses {
  constructor(storage = tab) { this.storage = storage; this.last = new Map(); }
  recall(place) {
    if (this.last.has(place)) return this.last.get(place);
    // A kept value with no time, or none that reads, comes before every question (compareQuestions): the press opens the oldest.
    try { return JSON.parse(this.storage()?.getItem(KEY + place) ?? 'null'); } catch { return null; }
  }
  next(place, questions) {
    const question = nextQuestion(questions, this.recall(place));
    if (!question) return null;
    const last = { topic_id: question.topic_id, ms: time(question), ...(text(question.message_id) ? { message_id: question.message_id } : {}) };
    this.last.set(place, last);
    // A tab that cannot keep this one keeps none, so the next page starts at the oldest rather than from an older press.
    try { this.storage()?.setItem(KEY + place, JSON.stringify(last)); } catch { try { this.storage()?.removeItem(KEY + place); } catch { /* the next page starts at the oldest */ } }
    return question;
  }
}
// The page's own: the outline and the outcome's page go through the same presses.
export const presses = new QuestionPresses();
