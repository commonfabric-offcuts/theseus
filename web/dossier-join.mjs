import { openMessageMenu } from './message-menu.mjs';

// A proposal records nothing. Only the menu's actual second activation owns
// the join; a saved callback after dismissal cannot perform it.
export function openDossierJoin({ anchor, canRestore = () => true, choice, current, commit, say, doc, win = doc.defaultView }) {
  let selecting = false, closed = false, used = false;
  const items = [
    { key: 'cancel', label: 'Cancel', glyph: 'back', act() {} },
    { key: 'confirm-join', label: `Join “${choice.from}” into “${choice.into}”`, description: 'For everyone here', glyph: 'joinup', act() {
      if (!selecting || used) return;
      used = true;
      const now = current();
      if (!now || now.token !== choice.token) { say('These dossiers changed. Open Join again.'); return; }
      commit(now);
    } },
  ];
  const menu = openMessageMenu({ anchor, items, label: 'Join dossiers', sheet: true, focusKey: 'cancel', doc, win });
  if (!menu) return null;
  const close = menu.close.bind(menu);
  menu.close = restore => { closed = true; close(restore && canRestore()); };
  const button = menu.root.querySelectorAll('button')[1], activate = button.onclick;
  button.onclick = event => {
    if (closed || used) return;
    selecting = true;
    try { return activate(event); } finally { selecting = false; }
  };
  return menu;
}
