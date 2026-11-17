// The two rails beside a topic and an outcome's Conversation (pipeline items
// 272 and 131; docs/rails.md): the outline of every outcome on the left
// (outline-rail.mjs) and the outcome's things on the right (things-rail.mjs).
// The shell (in-place-navigation.mjs) keeps both across moves between those
// pages; each hears every run of the page and reads through it.
import { shell as host, listen } from './in-place-navigation.mjs';
import { OutlineRail } from './outline-rail.mjs';
import { ThingsRail } from './things-rail.mjs';
import { panes, feedKey, inMessages, messagesSideways } from './panes.mjs';
import { arrowReach, onNothing } from './arrow-reach.mjs';

const storage = win => { try { return win.localStorage; } catch { return null; } };

export const shell = host;

shell.extend((doc, win) => {
  const outline = doc.getElementById('outline'), things = doc.getElementById('things');
  if (outline) {
    const rail = new OutlineRail({ host: outline, open: (target, title) => shell.open(target, title), read: (name, args, readClass) => shell.view(name, args, readClass), storage: storage(win) });
    shell.follow(rail);
    listen(doc, 'visibilitychange', () => rail.shown());
    panes.outline = rail;
    // The phone's drawer opens on the outline's place (rail-drawer.mjs).
    shell.drawerFocus = () => rail.drawerOpened();
  }
  if (things) {
    const rail = new ThingsRail({ host: things, backdrop: doc.getElementById('things-backdrop'), storage: storage(win) });
    shell.follow(rail);
    listen(doc, 'visibilitychange', () => rail.shown());
    panes.things = rail;
  }
  // ⌘Return: a new message in the place the keys are on, or in the page's own (panes.mjs).
  panes.write = (target, title) => shell.write(target, title);
  // → and ← in the messages move to the rails beside them, ↑ from the top
  // message to the header's buttons (panes.mjs); the shell keeps this across moves.
  listen(doc, 'keydown', event => { if (doc.documentElement.hasAttribute('data-rails')) feedKey(event, doc); });
  // An arrow nothing else used lands on the nearest control that way, on
  // every page (arrow-reach.mjs). On a topic and a Conversation the panes'
  // own keys answer first: in the rails' trees, on the buttons at the top of
  // the feed, and in the messages (and from the page itself, while there are
  // messages to light and no sheet over them, under which the page is inert
  // and the arrows go to the sheet). The messages' arrows are theirs alone (↑
  // and ↓ move between them, ← and → switch a stack and leave only for a rail
  // on screen; on a dossier's title bar glyphs ← and → go along the title bar,
  // panes.mjs, messagesSideways), and so are ↑ and ↓ from the page itself, which light one; any
  // other arrow the panes' keys leave unused (↑ from the header's top row, ←
  // or → from nothing or past a row's end with no pane on screen that way)
  // goes on here, as everywhere in a pane off its keys (the logo block,
  // the chips, People, the right rail's name): within that pane, and ← and →
  // past its edge on to the pane beside, as from the messages.
  const feed = () => doc.documentElement.hasAttribute('data-rails');
  const PANES = [['#rail', 'outline'], ['#main', 'feed'], ['#things', 'things']];
  arrowReach(doc, {
    listen,
    managed: (at, way) => feed() && ((way === 'up' || way === 'down') && (onNothing(at, doc) && Boolean(doc.querySelector('#messages [data-id]'))) && !doc.getElementById('main')?.inert
      || ((way === 'up' || way === 'down') ? inMessages(at, doc) : messagesSideways(at, doc))),
    region: at => feed() ? at.closest('.message-bar') ?? at.closest(PANES.map(([pane]) => pane).join(',')) : null,
    beyond: (at, way) => {
      const pane = PANES.find(([selector]) => at.closest(selector))?.[1];
      return Boolean(pane) && (way === 'left' || way === 'right') && !at.closest('.message-bar') && panes.step(pane, way, doc);
    },
  });
});
