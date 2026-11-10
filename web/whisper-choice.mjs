// How a message is sent: Whisper, Tell or Ask (docs/whispers.md), and the
// line above Send that says in words who will see it.
//
// The draft holds the person's own choice: `whisper` true when they chose
// Whisper (or held it while a second name made it a Tell), false when they
// chose Tell or Ask, and absent or null while they have not chosen; `intent`
// as ever. With no choice of theirs the default decides (defaultChoice, the
// one place D1 and I3 live). Core refuses a whisper to more than one name
// whatever the page sends.

const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

const CHOICES = [['whisper', 'Whisper'], ['tell', 'Tell'], ['ask', 'Ask']];
const WORDS = Object.fromEntries(CHOICES);
const WHISPER_NEEDS_ONE = 'Name one agent to whisper to them.';
const WHISPER_TO_ONE = 'A whisper goes to one agent. With more than one name, choose Tell or Ask.';
const ASK_NEEDS_SOMEONE = 'Name someone to ask them.';

// "a", "a and b", "a, b and c".
export function list(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const canWhisper = (names, kindOf) => names.length === 1 && kindOf(names[0]) === 'agent';

// What a message starts as when the person has not chosen: exactly one agent
// named, a new message or a reply to anything, is a whisper (D1); in an
// outcome's conversation it is a Tell, replies included (I3); otherwise a Tell.
export function defaultChoice(names, kindOf, { conversation = false } = {}) {
  return canWhisper(names, kindOf) && !conversation ? 'whisper' : 'tell';
}

// The choice the writing is sent with, and whether a second name moved a
// whisper to a Tell (switched), which taking that name away undoes.
export function choiceOf(draft, names, kindOf, options = {}) {
  if (!names.length) return { choice: 'tell', switched: false };
  if (draft.intent === 'ask') return { choice: 'ask', switched: false };
  if (draft.whisper === true) {
    if (canWhisper(names, kindOf)) return { choice: 'whisper', switched: false };
    return { choice: 'tell', switched: names.length > 1 };
  }
  if (draft.whisper === false || draft.intent === 'tell') return { choice: 'tell', switched: false };
  return { choice: defaultChoice(names, kindOf, options), switched: false };
}

// The fields a click on one choice writes to the draft: the person's own choice, kept from then on.
export function chosen(choice) {
  if (choice === 'whisper') return { whisper: true, intent: null };
  return { whisper: false, intent: choice };
}

// The fields that write down the choice the writing shows now, for writing
// that moves whole to a place with another default (the Reader's To, I3):
// with someone named and no choice of the person's, the default where it was
// written becomes the choice, so it is sent there as it was shown here.
export function shownChoice(draft, names, kindOf, options = {}) {
  const own = typeof draft.whisper === 'boolean' || ['ask', 'tell'].includes(draft.intent);
  return own || !names.length ? {} : chosen(defaultChoice(names, kindOf, options));
}

// Naming someone more: a message that was a whisper by default holds the
// whisper, so it shows as switched to a Tell and becomes a whisper again
// when the second name is taken away.
export function naming(draft, names, kindOf, options = {}) {
  return choiceOf(draft, names, kindOf, options).choice === 'whisper' && draft.whisper !== true ? { whisper: true } : {};
}

// Naming nobody: a message to nobody neither asks, tells nor whispers.
export const unnamed = { whisper: null, intent: null };

// The fields the writing is frozen with when it is sent.
export function sending(draft, names, kindOf, options = {}) {
  const { choice } = choiceOf(draft, names, kindOf, options);
  if (choice === 'whisper') return { whisper: true, intent: null };
  return { whisper: false, intent: names.length ? choice : null };
}

// [who, what always shows, what a phone leaves out to keep Send in view]
// place: where the writing is posted when that is not the topic being read
// ("the conversation"), or null; its readers are that place's, so this
// topic's people are not named as them.
export function audienceWords({ choice, switched }, names, everyone, { answeringWhisper = false, place = null } = {}) {
  if (choice === 'whisper') {
    return [`Only you and ${names[0]}`, ' will see this.', ` No other agent gets it, and ${names[0]} takes it as a question, not an instruction.`];
  }
  const readers = place ? `Everyone in ${place}` : 'Everyone in this topic';
  const all = !place && everyone.length ? ` That is ${list(everyone)}.` : '';
  if (switched) {
    return [readers, ' will see this. A whisper goes to one agent. Nothing you wrote is lost.',
      ` Adding ${names.at(-1)} made this a Tell. To reach ${list(names)} privately, send each a whisper.`];
  }
  if (answeringWhisper && choice === 'tell') return [readers, ' will see this. The whisper itself stays private.', all];
  if (!names.length) return [readers, ' will see this.', `${all} It goes to no one by name.`];
  if (choice === 'ask') {
    return [readers, ` will see this, and it waits on ${list(names)} until ${names.length > 1 ? 'each replies' : 'they reply'}.`, all];
  }
  return [readers, ' will see this.', `${all} It goes to ${list(names)} by name; nothing is owed back.`];
}

// The who chip's words (docs/reader.md): what Send does and, from the same
// words as the line above (audienceWords), who sees it, said short.
// "Tell fable · everyone here", "Whisper to fable · only you two",
// "Ask fable and warp · everyone here", or "Everyone here" with nobody named;
// posted elsewhere (place), "Tell fable · in the conversation", or
// "Everyone in the conversation".
export function chipWords(state, names, everyone = [], options = {}) {
  const [who] = audienceWords(state, names, everyone, options);
  const elsewhere = who.replace(/^Everyone in /, '');
  const short = who.startsWith('Only you and ') ? 'only you two' : who === 'Everyone in this topic' ? 'everyone here' : `in ${elsewhere}`;
  if (!names.length) return who === 'Everyone in this topic' ? 'Everyone here' : who;
  const verb = state.choice === 'whisper' ? 'Whisper to' : state.choice === 'ask' ? 'Ask' : 'Tell';
  return `${verb} ${list(names)} · ${short}`;
}

// The word on Send: what pressing it does. A message to nobody by name is
// sent to the topic, so it says Send.
export function sendWord(state, names) {
  return state.choice === 'whisper' ? 'Whisper' : state.choice === 'ask' ? 'Ask' : names.length ? 'Tell' : 'Send';
}

// Paints the choice and its line into row, the Send button's word, the who
// chip's words (chip, when the composer has one) and the writing field's
// dashed line; returns the choice. The choice is three chips
// tapped once (aria-pressed says which is on), never round buttons; an arrow
// key moves the choice along them, as it did on round buttons. The chips are
// made once per row, so a choice that keeps the focus keeps it across paints.
// lineHost: where the sentence saying who sees it goes, when not under the
// chips (the composer's who panel puts it first).
// place: where the writing is posted when that is not the topic being read (audienceWords).
export function paintChoice(row, { draft, names, kindOf, everyone, send, field, chip = null, lineHost = null, readOnly = false, answeringWhisper = false,
  conversation = false, place = null, onChoose }) {
  if (!row.querySelector('.intent-choice')) {
    const group = node('div', undefined, 'intent-choice');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'How this is sent');
    for (const [value, words] of CHOICES) {
      const chip = node('button', undefined, 'choice-chip'); chip.type = 'button'; chip.dataset.intent = value;
      chip.onclick = () => { if (chip.getAttribute('aria-pressed') !== 'true') row.choose?.(value); };
      chip.append(words);
      group.append(chip);
    }
    group.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      const chips = [...group.querySelectorAll('button[data-intent]')].filter(chip => !chip.disabled);
      const at = chips.indexOf(event.target?.closest?.('button[data-intent]'));
      if (!step || at < 0) return;
      event.preventDefault();
      const next = chips[(at + step + chips.length) % chips.length];
      next.focus(); next.onclick();
    });
    const line = node('p', undefined, 'audience-line'); line.setAttribute('aria-live', 'polite');
    if (lineHost) { row.replaceChildren(group); lineHost.replaceChildren(line); } else row.replaceChildren(group, line);
  }
  row.choose = onChoose;
  const state = choiceOf(draft, names, kindOf, { conversation });
  for (const chip of row.querySelectorAll('button[data-intent]')) {
    const value = chip.dataset.intent;
    const why = value === 'whisper' && !canWhisper(names, kindOf) ? (names.length > 1 ? WHISPER_TO_ONE : WHISPER_NEEDS_ONE)
      : value === 'ask' && !names.length ? ASK_NEEDS_SOMEONE : '';
    chip.setAttribute('aria-pressed', value === state.choice ? 'true' : 'false');
    chip.disabled = readOnly || Boolean(why);
    // Why a choice is greyed out is part of its name, as words a screen reader says after it.
    chip.title = why;
    if (why) chip.setAttribute('aria-label', `${WORDS[value]}, ${why}`); else chip.removeAttribute('aria-label');
  }
  const [who, words, more] = audienceWords(state, names, everyone, { answeringWhisper, place });
  const line = (lineHost ?? row).querySelector('.audience-line');
  line.classList.toggle('switched', state.switched);
  line.replaceChildren(node('strong', who), state.switched ? node('span', words, 'switch-words') : words, node('span', more, 'audience-more'));
  field?.classList.toggle('whispering', state.choice === 'whisper');
  const word = send?.querySelector('.send-word');
  if (word) word.textContent = sendWord(state, names);
  if (chip) {
    chip.textContent = chipWords(state, names, everyone, { answeringWhisper, place });
    chip.classList.toggle('whispering', state.choice === 'whisper');
  }
  return state;
}

// Takes the choice away, as a private note or a closed composer has none.
export function clearChoice(row, field, send, lineHost = null) {
  row.replaceChildren(); lineHost?.replaceChildren(); row.choose = null;
  field?.classList.remove('whispering');
  const word = send?.querySelector('.send-word');
  if (word) word.textContent = 'Send';
}

// A whisper's card, read from the viewer's side: after the author's name,
// "· whisper to aim-ux" or "· whisper to you", and on the viewer's own
// whisper that has no answer yet, a muted "· no answer yet" (not a light).
// Repainting keeps one of each.
export function whisperWords(item, viewer) {
  return `whisper to ${item.private_to === viewer ? 'you' : item.private_to}`;
}
export function paintWhisperAuthor(author, item, viewer, doc = document) {
  for (const old of author.querySelectorAll('.whisper-label, .whisper-wait')) old.remove();
  const words = whisperWords(item, viewer);
  const label = doc.createElement('span'); label.className = 'whisper-label'; label.textContent = ` · ${words}`;
  author.insertBefore(label, author.querySelector('.message-time'));
  if (item.no_answer) {
    const wait = doc.createElement('span'); wait.className = 'whisper-wait'; wait.textContent = ' · no answer yet';
    author.append(wait);
  }
  const card = author.closest('.message-card'), time = author.querySelector('.message-time')?.textContent.replace(/^ · /, '');
  card?.setAttribute('aria-label', `${item.author_id}, ${words}${time ? `, ${time}` : ''}. ${item.body}`);
}
