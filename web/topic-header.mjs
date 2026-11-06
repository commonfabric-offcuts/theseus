// The top of a topic: the outcome's name, the title
// with a gear that opens Topic settings, and under the title only the topic's
// note, as a subtitle. Where the topic stands in full, and the form that
// changes it, are in Topic settings (topic-settings.mjs); the people are at
// the bottom of the page, after the messages.
import { STATES, stateLabel, waitsOn } from './topic-state.mjs';

// Active, and waiting on nobody: the state that needs no word of its own.
export const plainActive = topic => (STATES.includes(topic?.state) ? topic.state : 'active') === 'active' && !waitsOn(topic).length;

const ONGOING = /^Ongoing:\s*/;

// The note's own words. On a plainly Active topic a leading "Ongoing:" says
// what Active already says, so it goes and the next letter is capitalised;
// every other note keeps every word.
export function subtitleNote(topic) {
  const note = typeof topic?.state_note === 'string' ? topic.state_note : '';
  if (!plainActive(topic) || !ONGOING.test(note)) return note;
  const rest = note.replace(ONGOING, '');
  return rest ? rest[0].toUpperCase() + rest.slice(1) : '';
}

// The state word as the live pill, for a topic that is not plainly Active.
function stateMark(topic, reader, doc) {
  const mark = doc.createElement('strong');
  mark.className = 'topic-state';
  mark.dataset.state = waitsOn(topic).length ? 'waiting' : STATES.includes(topic.state) ? topic.state : 'active';
  if (waitsOn(topic).includes(reader)) mark.classList.add('mine');
  mark.textContent = mark.title = stateLabel(topic, reader);
  return mark;
}

// subtitle: the #topic-description paragraph. The state word comes first,
// then a real space, so a screen reader says "Done, Shipped…", not
// "DoneShipped". A plainly Active topic with no note shows no subtitle.
export function paintSubtitle(subtitle, topic, reader, doc = document) {
  const parts = [];
  if (!plainActive(topic)) parts.push(stateMark(topic, reader, doc));
  const note = subtitleNote(topic);
  if (note) {
    const words = doc.createElement('span');
    words.className = 'state-note'; words.textContent = note;
    if (parts.length) parts.push(' ');
    parts.push(words);
  }
  subtitle.replaceChildren(...parts);
  subtitle.hidden = !parts.length;
}

// The title, the subtitle and whether the gear shows. settings is false where
// no Topic settings apply (a conversation refuses every change they make).
export function paintTopicHeader({ title, subtitle, gear }, topic, reader, { settings = true, doc = document } = {}) {
  title.textContent = topic.title;
  paintSubtitle(subtitle, topic, reader, doc);
  gear.hidden = !settings;
}

// A page that is not a topic: its own description, and no gear.
export function paintPageHeader({ subtitle, gear }, description) {
  subtitle.replaceChildren(); subtitle.textContent = description; subtitle.hidden = false;
  gear.hidden = true;
}
