// An outcome archived or completed by its owner, and brought back (item 404;
// docs/targets.md, "Archived and completed"). The words and the quiet word
// buttons every surface shares: Complete and Archive in the target card,
// Bring back on "Where it stands", on a row under the Outcomes home's
// "Archived (N)" and on a topic's line. Core decides everything; a press
// sends outcome.end_set and the page reads again.
import { on } from './repaint.mjs';

export const ACTS = {
  completed: { word: 'Complete', busy: 'Completing…', title: 'Complete this outcome: it leaves your outcomes, and you can bring it back' },
  archived: { word: 'Archive', busy: 'Archiving…', title: 'Archive this outcome: you’re not pursuing it; it leaves your outcomes, and you can bring it back' },
};
export const BRING_BACK = 'Bring back';
export const BRING_BACK_BUSY = 'Bringing back…';
export const BRING_BACK_TITLE = 'Bring back this outcome: it returns to your outcomes with the topics archiving took';
// A row's own name, so several rows read apart to a screen reader.
export const bringBackName = title => (title ? `Bring back ${title}` : BRING_BACK_TITLE);

// A date as the lists say it: "Nov 15".
export const endDay = ms => (Number.isSafeInteger(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// A row under "Archived (N)": "Archived Nov 15" or "Completed Nov 15", with no dot (the light says "Archived · Nov 15").
export function endedRowWords(end) {
  const word = end?.state === 'completed' ? 'Completed' : 'Archived';
  const day = endDay(end?.ms);
  return day ? `${word} ${day}` : word;
}

// The line in a topic's header while its outcome is kept to read this way.
export function keptLine(kind, ms) {
  if (kind === 'completed') return `This outcome was completed${endDay(ms) ? ' ' + endDay(ms) : ''}; its topics are kept to read`;
  return 'This outcome is archived; its topics are kept to read';
}

// One quiet word button: a real button, named and titled, at least 44px tall on a phone (aim.css .end-word). Every
// property is an attribute, and the press is set with on(), so a repaint (repaint.mjs) carries both onto the button
// already shown and a press held across a commit still lands.
export function wordButton(doc, { word, title, name = title, key, onclick, busy = false }) {
  const button = doc.createElement('button');
  button.setAttribute('type', 'button');
  button.setAttribute('class', 'link-button end-word');
  button.setAttribute('title', title);
  button.setAttribute('aria-label', name);
  if (key) button.setAttribute('data-key', key);
  if (busy) button.setAttribute('aria-disabled', 'true');
  button.textContent = word;
  on(button, 'onclick', () => { if (button.getAttribute('aria-disabled') !== 'true') onclick(); });
  return button;
}

// Sends outcome.end_set; resolves with Core's answer, or throws its words when it refused.
export async function sendEnd(send, workspace, state, revision) {
  const receipt = await send('outcome.end_set', { workspace_id: workspace }, { state }, { workspace_revision: revision });
  if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'Not saved; nothing changed.');
  return receipt.result;
}

// The topic header's line (host, a muted paragraph) from the outcome's light: shown while the outcome is archived or
// completed, with Bring back for its owner (bringBack, or null); hidden otherwise. A refusal is said on the line.
export function paintKeptLine(host, light, bringBack = null) {
  const kind = light?.lead?.kind;
  if (kind !== 'archived' && kind !== 'completed') { host.hidden = true; host.replaceChildren(); return; }
  const doc = globalThis.document;
  const parts = [keptLine(kind, light.lead.ms)];
  if (bringBack) {
    const button = wordButton(doc, { word: BRING_BACK, title: BRING_BACK_TITLE, key: 'bring-back', onclick: async () => {
      button.textContent = BRING_BACK_BUSY; button.setAttribute('aria-disabled', 'true');
      host.querySelector('.notice')?.remove();
      try { await bringBack(); }
      catch (error) {
        button.textContent = BRING_BACK; button.removeAttribute('aria-disabled');
        const notice = doc.createElement('span');
        notice.className = 'notice'; notice.setAttribute('role', 'status'); notice.textContent = ' ' + error.message;
        host.append(notice);
      }
    } });
    parts.push(' ', button);
  }
  host.replaceChildren(...parts);
  host.hidden = false;
}
