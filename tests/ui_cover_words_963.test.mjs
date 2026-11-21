import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { coverSheet, coverKey } from '../web/dossier-cover.mjs';
import { formatNodes } from '../web/message-format.mjs';

const context = { viewer:'reader', nameOf:x=>x, topicId:'topic', rootId:'root' };
const cover = { owner:'reader', stands:'', waiting:[], revision:7, by:'writer', at_ms:1795230000000 };
const rich = '- **Built** the first piece\n- Check `exact bytes`\n- Read [the result](https://example.test/result)';
function fixture() {
  const doc=miniDocument(),create=doc.createElement;
  doc.createElement=tag=>{const n=create(tag);n.style={setProperty(){}};return n;};
  return doc;
}
const tree=n=>n.nodeType===3?{text:n.textContent}:{tag:n.tagName,cl:n.className,text:n.textContent,
  href:n.href??n.getAttribute('href'),children:n.children.map(x=>typeof x==='string'?{text:x}:tree(x))};

test('963 a three-line cover list uses message blocks, bold, code and authored links',()=>{
  const doc=fixture(),sheet=coverSheet(doc,{...cover,stands:rich},context),words=sheet.querySelector('.cover-stands');
  assert.equal(words.querySelectorAll('.md-list').length,1);
  assert.equal(words.querySelectorAll('.md-item').length,3);
  assert.equal(words.querySelector('strong').text,'Built');
  assert.equal(words.querySelector('code').text,'exact bytes');
  assert.equal(words.querySelector('a').text,'the result');
  assert.equal(words.querySelector('a').href,'https://example.test/result');
  assert.deepEqual(words.children.map(tree),formatNodes(rich,{doc}).map(tree));
  assert.ok(words.classList.contains('formatted'));
});
test('963 plain LF, blank lines and literal angle brackets retain their original node and class',()=>{
  const doc=fixture();
  for(const stands of ['Plain standing words','First\nSecond','First\n\nSecond','Keep <literal> & "words"']) {
    const sheet=coverSheet(doc,{...cover,stands},context),words=sheet.querySelector('.cover-stands');
    assert.equal(words.textContent,stands);assert.equal(words.children.length,0);
    assert.equal(words.className,'cover-words cover-stands');
  }
});
test('963 inline-only marks and escapes follow message formatting and unsafe HTML stays text',()=>{
  const doc=fixture();
  for(const stands of ['**Ready** with `code` and https://example.test/',String.raw`Escaped \*marks\*`,'<script>bad()</script> **safe**']) {
    const words=coverSheet(doc,{...cover,stands},context).querySelector('.cover-stands');
    assert.deepEqual(words.children.map(tree),formatNodes(stands,{doc}).map(tree));
    assert.equal(words.querySelectorAll('script').length,0);
  }
});
test('963 complete HTML fences keep their existing sandbox and surrounding literal words',()=>{
  const doc=fixture(),stands='Before **literal**\n\n```html\n<button>Run</button>\n```\n\nAfter';
  const words=coverSheet(doc,{...cover,stands},context).querySelector('.cover-stands');
  assert.equal(words.querySelectorAll('iframe').length,1);
  assert.equal(words.querySelector('iframe').getAttribute('sandbox'),'allow-scripts');
  assert.equal(words.querySelectorAll('strong').length,0);
  assert.match(words.text,/Before \*\*literal\*\*/);
  assert.equal(words.classList.contains('formatted'),false);
});
test('963 32000 characters, exact source and current revision footer survive formatting',()=>{
  const doc=fixture(),stands='**Ready**\n'+'x'.repeat(31990),input={...cover,stands};
  assert.equal(stands.length,32000);
  const key=coverKey(input,context),sheet=coverSheet(doc,input,context);
  assert.equal(input.stands,stands);assert.equal(coverKey(input,context),key);
  assert.equal(sheet.querySelector('strong').text,'Ready');
  assert.ok(sheet.querySelector('.cover-stands').text.endsWith('x'.repeat(31990)));
  assert.equal(sheet.querySelector('.cover-revision-line').querySelector('time').dataset.ms,String(cover.at_ms));
  assert.notEqual(coverKey({...input,revision:8,at_ms:cover.at_ms+1},context),key);
});
