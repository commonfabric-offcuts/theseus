// The top of a topic: the outcome's name, the title
// with a gear that opens Topic settings, and under the title only the topic's
// note, as a subtitle. Where the topic stands in full, and the form that
// changes it, are in Topic settings (topic-settings.mjs); the topic's people
// are its Team, on the title row's right, under the title (item 465).
import { STATES, stateLabel, stateTitle, waitingQuestion, waitsOn } from './topic-state.mjs';

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
function stateMark(topic, reader, doc, openQuestion) {
  const question = topic.kind === 'conversation' ? waitingQuestion(topic, reader) : null;
  const mark = doc.createElement(question ? 'a' : 'strong');
  mark.className = 'topic-state';
  mark.dataset.state = waitsOn(topic).length ? 'waiting' : STATES.includes(topic.state) ? topic.state : 'active';
  if (waitsOn(topic).includes(reader)) mark.classList.add('mine');
  mark.textContent = stateLabel(topic, reader);
  mark.title = waitsOn(topic).length || topic.state === 'waiting' ? stateTitle(topic, reader) : mark.textContent;
  if (question) {
    mark.href = '?' + new URLSearchParams({ topic: topic.id, message: question });
    if (openQuestion) mark.onclick = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openQuestion(question);
    };
  }
  return mark;
}

// ✅ Done, beside the state of a topic Ready for review (Tony, 10 Nov: a
// shipped piece's topic waits there for the person to mark it Done). done()
// is the Done chip's own tap in Topic settings; the repaint after Core's
// answer takes the button away.
function doneButton(done, doc) {
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'mark-done'; button.title = 'Mark this topic done';
  button.setAttribute('aria-label', 'Mark done');
  const glyph = doc.createElement('span');
  glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = '✅';
  button.append(glyph, ' Done');
  button.onclick = () => done();
  return button;
}

// subtitle: the #topic-description paragraph. The state word comes first,
// then a real space, so a screen reader says "Done, Shipped…", not
// "DoneShipped". A plainly Active topic with no note shows no subtitle.
// done: how the reader marks the topic Done, given only to a reader who may
// say where it stands; a topic Ready for review then shows ✅ Done after its
// state. A repaint keeps the focus on ✅ Done while it shows, and once it
// goes, gives the focus to the subtitle, which now says Done.
export function paintSubtitle(subtitle, topic, reader, doc = document, done = null, openQuestion = null) {
  const focused = subtitle.children ? [...subtitle.children].some(node => node === doc.activeElement && node.classList?.contains('mark-done')) : false;
  const parts = [];
  if (!plainActive(topic)) parts.push(stateMark(topic, reader, doc, openQuestion));
  const button = done && topic.state === 'review' ? doneButton(done, doc) : null;
  if (button) parts.push(' ', button);
  const note = subtitleNote(topic);
  if (note) {
    const words = doc.createElement('span');
    words.className = 'state-note'; words.textContent = note;
    if (parts.length) parts.push(' ');
    parts.push(words);
  }
  subtitle.replaceChildren(...parts);
  subtitle.hidden = !parts.length;
  if (!focused) return;
  if (button) { button.focus(); return; }
  subtitle.setAttribute('tabindex', '-1');
  subtitle.focus();
}

// The title, the subtitle and whether the gear shows. settings is false where
// no Topic settings apply (a conversation refuses every change they make).
// done marks the topic Done from ✅ Done (paintSubtitle).
export function paintTopicHeader({ title, subtitle, gear }, topic, reader, { settings = true, doc = document, done = null, question = null } = {}) {
  title.textContent = topic.title;
  paintSubtitle(subtitle, topic, reader, doc, settings ? done : null, question);
  gear.hidden = !settings;
}
