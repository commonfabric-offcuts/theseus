// The two rails beside a topic and an outcome's Conversation (pipeline items
// 272 and 131; docs/rails.md): the outline of every outcome on the left
// (outline-rail.mjs) and the outcome's things on the right (things-rail.mjs).
// The shell (in-place-navigation.mjs) keeps both across moves between those
// pages; each hears every run of the page and reads through it.
import { shell as host, listen } from './in-place-navigation.mjs';
import { OutlineRail } from './outline-rail.mjs';
import { ThingsRail } from './things-rail.mjs';
import { panes, feedKey } from './panes.mjs';

const storage = win => { try { return win.localStorage; } catch { return null; } };

export const shell = host;

shell.extend((doc, win) => {
  const outline = doc.getElementById('outline'), things = doc.getElementById('things');
  if (outline) {
    const rail = new OutlineRail({ host: outline, open: (target, title) => shell.open(target, title), read: (name, args, readClass) => shell.view(name, args, readClass), storage: storage(win) });
    shell.follow(rail);
    listen(doc, 'visibilitychange', () => rail.shown());
    panes.outline = rail;
  }
  if (things) {
    const rail = new ThingsRail({ host: things, backdrop: doc.getElementById('things-backdrop'), storage: storage(win) });
    shell.follow(rail);
    listen(doc, 'visibilitychange', () => rail.shown());
    panes.things = rail;
  }
  // → and ← in the messages move to the rails beside them (panes.mjs); the shell keeps this across moves.
  listen(doc, 'keydown', event => { if (doc.documentElement.hasAttribute('data-rails')) feedKey(event, doc); });
});
