import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardWords, copyWordsChoice, hasClipboardWords, notebookClipboard } from '../web/copy-words.mjs';
import { documentPort } from './fixtures/card_text_867.mjs';

test('copy text preserves authored Markdown, drops attachment lines, and leaves literal fenced text', () => {
  const doc = documentPort();
  const raw = '## Heading\n\n![Example](attachment:example)\n**Authored** [words](https://example.org).\n\n```\n![literal](attachment:literal)\n```';
  const result = clipboardWords(raw, doc);
  assert.equal(result.plain, raw.replace('![Example](attachment:example)\n', ''));
  assert.equal(hasClipboardWords('![Only image](attachment:the-image)'), false);
  assert.equal(hasClipboardWords('[A link](https://example.org)'), true);
});

test('copy selected Notebook cards keeps source headings in page order', () => {
  const doc = documentPort();
  const body = '## One\n\nText in one.\n\n### Two\n\nText in two.\n\n## Three\n\nText in three.';
  assert.equal(notebookClipboard(body, 'cards', new Set([2, 0]), doc).plain, '## One\n\nText in one.\n\n## Three\n\nText in three.');
  assert.equal(notebookClipboard(body, 'cards', new Set([1]), doc).plain, '### Two\n\nText in two.');
});

test('copy writes both types once, falls back to plain, and says when both fail', async () => {
  const writes = [], notices = [];
  let richRefused = false, plainRefused = false;
  class ClipboardItem { constructor(blobs) { this.blobs = blobs; } }
  const clipboard = {
    async write(items) {
      assert.equal(items.length, 1);
      const rich = await Promise.all(Object.entries(items[0].blobs).map(async ([type, blob]) => [type, await (await blob).text()]));
      if (richRefused) throw Error('rich clipboard denied');
      writes.push(rich);
    },
    async writeText(plain) {
      if (plainRefused) throw Error('plain clipboard denied');
      writes.push(plain);
    },
  };
  const doc = { defaultView: { ClipboardItem, navigator: { platform: 'MacIntel', clipboard } } };
  const selection = { plain: 'words', html: '<b>words</b>' };
  const choose = copyWordsChoice({ doc, selection, status: words => notices.push(words) });
  assert.equal(choose.label, 'Copy selected text');
  assert.equal(choose.keys, '⌘C');
  await choose.act();
  richRefused = true;
  await choose.act();
  plainRefused = true;
  await choose.act();
  assert.deepEqual(writes, [[['text/plain', 'words'], ['text/html', '<b>words</b>']], 'words']);
  assert.deepEqual(notices, ['Selection copied.', 'Selection copied.', 'Could not copy. Select the text and use Copy.']);
});

test('copy cannot write a whole source that arrives after its opening changes', async () => {
  let advance, current = true;
  const body = new Promise(resolve => { advance = resolve; });
  let written = false, said = false;
  const doc = { defaultView: { navigator: { platform: '', clipboard: { writeText() { written = true; } } } } };
  const choice = copyWordsChoice({ doc, contents: () => body, current: () => current, status: () => { said = true; } });
  const attempt = choice.act();
  current = false;
  advance({ plain: 'stale words', html: '<p>stale words</p>' });
  await attempt;
  assert.equal(written, false);
  assert.equal(said, false);
});
