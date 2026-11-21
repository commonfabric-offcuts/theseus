// A linked wait uses the message's existing answer command and observed fence.
import { ANSWER_WORDS } from './reactions.mjs';
let runtime = null;
export const configureCoverAnswers = provider => { runtime = provider; };

export function coverAnswers(doc, wait, context) {
  if (!runtime || wait.actor_id !== context.viewer || wait.go_ahead !== true || !Number.isSafeInteger(wait.answer_revision)) return null;
  const host = doc.createElement('span'); host.className = 'cover-answers';
  host.setAttribute('role', 'group'); host.setAttribute('aria-label', wait.text);
  const status = doc.createElement('span'); status.className = 'cover-answer-status'; status.setAttribute('role', 'status');
  const buttons = [];
  for (const answer of ['yes', 'no']) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'cover-answer';
    button.textContent = ANSWER_WORDS[answer]; button.title = `${ANSWER_WORDS[answer]}: ${wait.text}`;
    button.onclick = async event => {
      event.stopPropagation();
      const current = runtime(); if (!current.reactions) return;
      const recorded = context.answering?.();
      for (const choice of buttons) choice.disabled = true;
      status.textContent = '';
      try {
        const receipt = await current.reactions.answer({ id: wait.ask_id, reactions: { version: 0, thumbs: [], answers: [], thumb_revision: 0, answer_revision: wait.answer_revision } }, answer);
        await recorded?.(receipt);
      } catch (error) { status.textContent = error.message; }
      finally { for (const choice of buttons) choice.disabled = false; current.changed(); }
    };
    // Keep the containing card's keyboard activation from also opening its Reader.
    button.onkeydown = event => event.stopPropagation();
    buttons.push(button); host.append(button);
  }
  host.append(status); return host;
}
