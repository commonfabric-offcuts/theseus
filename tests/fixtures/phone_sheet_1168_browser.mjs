// Isolated presentation fixture: the server supplies production index.html and
// styles, with application scripts removed. No account, Store, API or send.
import { ComposeBar } from '../../web/compose-bar.mjs';

const get = id => document.getElementById(id);
const root = get('inline-composer'), field = get('inline-writing-body');
const dialog = get('new-message-sheet');
root.hidden = false;
get('inline-who-chip').textContent = 'Isolated fixture';
get('inline-writing-title').textContent = 'New message';
get('inline-kind').hidden = false;
const bar = new ComposeBar({ root, field,
  panels: { who: get('inline-who-panel'), plus: get('inline-plus-panel') },
  openers: { who: get('inline-who-chip'), plus: get('inline-plus-button') },
  taller: get('inline-taller-field'), win: window });
get('new-message-close').addEventListener('click', () => dialog.close());
dialog.showModal();
window.fixture1168 = { bar, field, root, dialog };
document.body.dataset.fixture1168 = 'ready';
