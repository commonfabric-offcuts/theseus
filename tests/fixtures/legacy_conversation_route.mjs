// Execute the app's actual 835 resolver through the real Shell. No copied
// rename, synthetic ready route, transport, server or native browser is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export async function resolveLegacyConversation(shell, view) {
  const app = readFileSync(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const resolver = /  if \(route.kind === 'conversation'\) \{[\s\S]*?\n  \}\n(?=  \/\/ The reader's agent colors)/.exec(app)?.[0];
  assert.ok(resolver, 'the current app owns the legacy Conversation resolver');
  return runInNewContext(`(async () => { let route = shell.route(), topicId = route.id; ${resolver} return topicId; })()`,
    { shell, location: shell.win.location, api: { view }, validate: value => value });
}
