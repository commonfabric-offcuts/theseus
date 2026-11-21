import { openMessageMenu } from './message-menu.mjs';

// A presentation choice for one document and one waiting episode. Core's
// waiting facts are never changed, and a different message starts unsilenced.
const silenced = new WeakMap();
const choices = doc => {
  if (!silenced.has(doc)) silenced.set(doc, new Set());
  return silenced.get(doc);
};

export function waitingEnded(doc, key) {
  silenced.get(doc)?.delete(key);
}

export function waitingSilence(mark, key, doc, show = openMessageMenu) {
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'waiting-silence';
  button.setAttribute('aria-label', mark.getAttribute('aria-label'));
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(mark);
  if (choices(doc).has(key)) mark.classList.add('is-silent');
  button.onclick = event => {
    event.stopPropagation();
    show({ anchor: button, label: mark.getAttribute('aria-label'), doc, win: doc.defaultView ?? globalThis,
      items: [{ label: 'Silence', glyph: 'kept', act() {
        if (button.isConnected === false) return;
        choices(doc).add(key);
        mark.classList.add('is-silent');
      } }],
    });
  };
  return button;
}
