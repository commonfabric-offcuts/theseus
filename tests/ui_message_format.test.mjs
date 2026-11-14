// A message's Markdown as cards and the Reader show it (web/message-format.mjs,
// docs/topic-reading.md "Formatted words"), below the browser, on a small
// document that builds real trees: which blocks a message becomes, the cases
// AIM and loom settled before (agent tables without a dash row, tables drawn
// in box lines, task lists, fences, quotes holding blocks), that the Reader's
// passages cover the whole message and map back to its own words, and that a
// hostile message costs work in proportion to its length.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as format from '../web/message-format.mjs';
import { nameTopicsWith, openLinksWith, wordNodes } from '../web/links.mjs';
import { routeHref } from '../web/topic-navigation.mjs';

// A document whose elements hold child nodes and know their parent, as the browser's do.
class Text {
  constructor(data) { Object.assign(this, { nodeType: 3, nodeName: '#text', data: String(data), parentNode: null }); }
  get textContent() { return this.data; }
}
class Element {
  constructor(tag) {
    Object.assign(this, { nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), childNodes: [], parentNode: null, className: '', dataset: {}, attributes: {},
      handlers: {}, href: '', target: '', rel: '', title: '', scrollLeft: 0, scrollWidth: 0, clientWidth: 0, isConnected: true });
    this.style = { props: {}, textAlign: '', setProperty(name, value) { this.props[name] = value; } };
  }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return { add: (...more) => { this.className = [...new Set([...names(), ...more])].join(' '); },
      remove: name => { this.className = names().filter(n => n !== name).join(' '); },
      toggle: (name, on) => { if (on ?? !names().includes(name)) this.classList.add(name); else this.classList.remove(name); },
      contains: name => names().includes(name) };
  }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = new Text(node); node.parentNode = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  replaceChild(node, old) { this.childNodes[this.childNodes.indexOf(old)] = node; node.parentNode = this; old.parentNode = null; }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (String(value)) this.append(new Text(value)); }
  get ownerDocument() { return doc; }
}
const doc = { createElementNS: (_, tag) => new Element(tag), createElement: tag => new Element(tag), createTextNode: data => new Text(data) };

// Every node under node, in document order.
const walk = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) walk(child, out); return out; };
const all = (node, test) => walk(node).filter(n => n.nodeType === 1 && test(n));
const byClass = (node, name) => all(node, n => n.className.split(' ').includes(name));
const byTag = (node, tag) => all(node, n => n.tagName === tag.toUpperCase());
const texts = nodes => nodes.map(n => n.textContent);
const render = (text, options = {}) => format.formatWords(new Element('span'), text, options);
const kinds = text => format.parseBlocks(text).map(block => block.kind);
const webLinksOf = node => byTag(node, 'a').map(a => a.textContent);

// AIM's fixture (tests/test_aim_ui.py BOX_TABLE): a table a terminal drew.
const BOX_TABLE = `Where each lane lives

  ┌──────────────┬───────┬──────────────────────┐
  │     Lane     │ Owner │        State         │
  ├──────────────┼───────┼──────────────────────┤
  │ Weaver: the  │ warp  │ Landed (#877, #883). │
  │ Moment       │       │ See @gpt6.           │
  └──────────────┴───────┴──────────────────────┘

and prose after it, with https://a.example/880 in it`;

test('a table drawn with box lines is kept as drawn, in its own monospace block', () => {
  const host = render(BOX_TABLE);
  const [box, ...more] = byClass(host, 'md-box');
  assert.ok(box, 'the drawn table is a block of its own');
  assert.equal(more.length, 0);
  assert.ok(box.className.includes('md-pre'), 'shown as code is: monospace, scrolling sideways');
  const lines = box.textContent.split('\n');
  assert.equal(lines.length, 6);
  assert.ok(lines[0].startsWith('┌') && lines.at(-1).startsWith('└'), 'the indent it was pasted with is taken off');
  assert.equal(new Set(lines.map(line => line.length)).size, 1, 'every line keeps its width, so the columns stay under each other');
  assert.ok(box.textContent.includes('(#877, #883)'));
  assert.equal(byTag(box, 'a').length, 0, 'nothing in it becomes a link');
  assert.deepEqual(texts(byClass(host, 'md-p')), ['Where each lane lives', 'and prose after it, with https://a.example/880 in it']);
  assert.equal(byTag(byClass(host, 'md-p')[1], 'a').length, 1, 'the words after it still have their link');
  // One stray line with a bar in it, or two, is not a table.
  for (const text of ['│ a note with a bar\nand a second line', '│ one\n│ two\nthree']) assert.equal(byClass(render(text), 'md-box').length, 0, text);
});

const ROLL_CALL = 'ROLL CALL, 15:57Z. Agent | my request | their response | status | schedule\n\n' +
  'gpt6 | (a) land Weaver PR 951 on your judgment; (b) host half of the menu | (a) #951 clean, CI green; (b) no reply yet | (a) ready; (b) open | (a) today; (b) I chase at 16:30Z\n\n' +
  'fable | prompt-side meaning of the three verbs | meanings posted | done, continuous | prompt block lands the day the schema does\n\n' +
  'og | nothing asked | nothing heard | not on the list | none\n\nThat is everyone.';

test('a table an agent writes as rows of bars, with no dash row, is a table; narrower or uneven rows are not', () => {
  const host = render(ROLL_CALL);
  const [table] = byTag(host, 'table');
  assert.ok(table, 'the rows became a table');
  assert.deepEqual(texts(byTag(table, 'th')), ['ROLL CALL, 15:57Z. Agent', 'my request', 'their response', 'status', 'schedule']);
  const rows = byTag(byTag(table, 'tbody')[0], 'tr');
  assert.equal(rows.length, 3);
  assert.equal(byTag(rows[0], 'td').length, 5);
  assert.ok(rows[0].textContent.includes('PR 951'));
  assert.ok(!table.textContent.includes('|'), 'no bars are left in the table');
  assert.deepEqual(texts(byClass(host, 'md-p')), ['That is everyone.']);
  assert.deepEqual(kinds('Costs:\na | b | c\nd | e | f'), ['paragraph', 'table'], 'rows straight after a line of words start a table');
  // Not tables: one bar per line, however many lines; two rows of different widths; a single row.
  for (const text of ['this | that\nand this | that\nagain | more', 'a | b | c\n\nd | e', 'only | one | row', 'a | b | c\n\n\nd | e | f'])
    assert.equal(byTag(render(text), 'table').length, 0, text);
  // An excerpt's cut last row stays as words.
  const cut = render('a | b | c\nd | e | f\ng | h | i', { partial: true });
  assert.equal(byTag(byTag(cut, 'tbody')[0], 'tr').length, 1);
  assert.deepEqual(texts(byClass(cut, 'md-p')), ['g | h | i']);
});

test('a table with a dash row keeps its alignment and pads a short row, and a bar in a sentence, a rule or a fenced table is no table', () => {
  const host = render('Costs:\n\n| Lane | Owner | State |\n|:-----|:-----:|------:|\n| Weaver | warp | Landed #877 |\n| Service | gpt6 |\n\nafter');
  const [table] = byTag(host, 'table');
  assert.deepEqual(texts(byTag(table, 'th')), ['Lane', 'Owner', 'State']);
  const rows = byTag(byTag(table, 'tbody')[0], 'tr');
  assert.equal(rows.length, 2);
  assert.deepEqual(byTag(rows[1], 'td').map(td => [td.textContent, td.colSpan ?? 1]), [['Service', 1], ['gpt6', 1], ['', 1]], 'a short row is padded, not shifted');
  assert.deepEqual(byTag(table, 'th').map(th => th.style.textAlign), ['left', 'center', 'right']);
  assert.ok(!table.textContent.includes('|'));
  assert.deepEqual(texts(byClass(host, 'md-p')), ['Costs:', 'after']);
  for (const text of ['this | that, no dashes under it', 'a line\n---\nanother', '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'])
    assert.equal(byTag(render(text), 'table').length, 0, text);
  const short = render('| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.ok(!texts(byTag(short, 'td')).includes(':--'), 'a short dash row is not a row of data');
});

// Every cell a table draws, and how many columns a row reaches across.
const cellCount = host => byTag(host, 'td').length + byTag(host, 'th').length;
const reach = row => row.childNodes.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0);

test('a table draws the cells it was written with and one empty cell to its edge for a short row, so what it draws grows with its length', () => {
  const shapes = {
    'a long row under a narrow head': n => '| a |\n|---|\n|' + 'x|'.repeat(n) + '\n' + '|y|\n'.repeat(n),
    'a wide head over short rows': n => '|' + 'h|'.repeat(n) + '\n|' + '-|'.repeat(n) + '\n' + '|y|\n'.repeat(n),
  };
  for (const [name, make] of Object.entries(shapes)) {
    for (const n of [100, 200]) {
      const text = make(n), host = render(text), [table] = byTag(host, 'table');
      assert.ok(table, name);
      assert.ok(cellCount(host) <= text.length, `${name}: ${cellCount(host)} cells for ${text.length} characters`);
      const rows = byTag(table, 'tr'), width = Math.max(...rows.map(reach));
      assert.ok(width >= n, `${name}: the table is as wide as its widest row`);
      for (const row of rows) assert.equal(reach(row), width, `${name}: every row reaches the table's far edge`);
    }
  }
  // A full row draws no filler, and a filler keeps its column's alignment.
  const host = render('| a | b | c |\n|---|:-:|--:|\n| 1 | 2 | 3 |\n| 4 |');
  const [full, short] = byTag(byTag(host, 'tbody')[0], 'tr');
  assert.deepEqual(byTag(full, 'td').map(td => [td.textContent, td.colSpan ?? 1]), [['1', 1], ['2', 1], ['3', 1]]);
  assert.deepEqual(byTag(short, 'td').map(td => [td.textContent, td.colSpan ?? 1, td.style.textAlign]), [['4', 1, ''], ['', 2, 'center']]);
});

test('~~words~~ are struck through, and a run that does not close stays words', () => {
  const host = render('~~gone~~ text and ~~ not this~~ or ~~open');
  assert.deepEqual(texts(byTag(host, 's')), ['gone']);
  assert.equal(host.textContent, 'gone text and ~~ not this~~ or ~~open');
});

test('task items show an open or a ticked box, lists nest by indent, and each item keeps its own number or bullet', () => {
  const host = render('- a\n- b\n  - b1\n  - b2\n- c\n\n1. one\n2. two\n\n- [ ] open\n- [x] done\n- [X] also done');
  const items = byClass(host, 'md-item');
  assert.deepEqual(items.map(item => [byClass(item, 'md-marker')[0].textContent, byClass(item, 'md-item-words')[0].textContent]),
    [['•', 'a'], ['•', 'b'], ['•', 'b1'], ['•', 'b2'], ['•', 'c'], ['1.', 'one'], ['2.', 'two'], ['☐', 'open'], ['☑', 'done'], ['☑', 'also done']]);
  assert.deepEqual(items.map(item => item.style.props['--md-depth']), ['0', '0', '1', '1', '0', '0', '0', '0', '0', '0']);
  assert.deepEqual(items.filter(item => item.classList.contains('md-done')).map(item => item.textContent), ['☑done', '☑also done']);
  assert.equal(all(host, n => n.tagName === 'INPUT').length, 0, 'a glyph, not a control: a card is a button');
  // A list that mixes bullets and numbers keeps both.
  const mixed = render('- a\n  1. one\n  2. two\n- b\n3) three');
  assert.deepEqual(texts(byClass(mixed, 'md-marker')), ['•', '1.', '2.', '•', '3)']);
  const numbered = render('1. x\n- y');
  assert.deepEqual(texts(byClass(numbered, 'md-marker')), ['1.', '•'], 'a bullet under a number is a bullet');
  assert.deepEqual(texts(byClass(render('- [ ]no space\n- [y] other'), 'md-item-words')), ['[ ]no space', '[y] other'], 'only "[ ] " and "[x] " make a task');
});

test('a fence closes only on its own marker, as long or longer, with nothing after it, and keeps its language', () => {
  const lang = byClass(render('```js\nlet a = 1 <b>\n```'), 'md-pre');
  assert.deepEqual([lang.length, lang[0].dataset.lang, lang[0].textContent], [1, 'js', 'let a = 1 <b>']);
  assert.equal(all(lang[0], n => n.tagName === 'B').length, 0, 'markup in code is words');
  const cases = [
    ['```\nx\n```js\ny\n```', 'x\n```js\ny'],
    ['~~~\na\n```\nb\n~~~', 'a\n```\nb'],
    ['````\na\n```\nb\n````', 'a\n```\nb'],
    ['```\na\n  ```  \nafter', 'a'],
    ['```\nno end', 'no end'],
  ];
  for (const [text, code] of cases) assert.equal(byClass(render(text), 'md-pre')[0]?.textContent, code, text);
  assert.deepEqual(kinds('```\na\n  ```  \nafter'), ['code', 'paragraph']);
  assert.deepEqual(byClass(render('```\na\n```\n```\nb\n```'), 'md-pre').map(n => n.textContent), ['a', 'b'], 'two fences, two blocks');
  const inline = render('use ```code``` here');
  assert.deepEqual([kinds('```code``` here\nmore'), texts(byClass(inline, 'md-code'))], [['paragraph'], ['code']], 'backticks with a backtick after them on the line are inline code, not a fence');
  assert.deepEqual(byClass(render('```py title\nx\n```'), 'md-pre').map(n => n.dataset.lang), ['py'], 'the first word of the info is the language');
});

test('a quote holds blocks, a quote in a quote nests, and nesting stops at nine', () => {
  const host = render('> - a\n> - b\n>\n> # h\n> **bold**');
  const [quote] = byClass(host, 'md-quote');
  assert.deepEqual(texts(byClass(quote, 'md-item-words')), ['a', 'b']);
  assert.deepEqual(texts(byClass(quote, 'md-heading')), ['h']);
  assert.deepEqual(texts(byTag(quote, 'strong')), ['bold']);
  const nested = render('> outer\n> > inner\n> > more');
  assert.deepEqual(byClass(nested, 'md-quote').map(q => q.textContent), ['outerinner\nmore', 'inner\nmore']);
  const deep = render('> '.repeat(3000) + 'deep');
  assert.equal(byClass(deep, 'md-quote').length, 9);
  assert.ok(deep.textContent.endsWith('deep'));
  // loom's mixed case: code with a language, a quote with emphasis, a rule and a table.
  const mixed = render('```py\nx = 1 <b>\n```\n\n> quoted *thing*\n> more\n\n---\n\n| a | b |\n|---|---|\n| 1 | **2** |\n');
  assert.deepEqual(byClass(mixed, 'md-pre').map(n => [n.dataset.lang, n.textContent]), [['py', 'x = 1 <b>']]);
  assert.deepEqual(texts(byTag(byClass(mixed, 'md-quote')[0], 'em')), ['thing']);
  assert.equal(byClass(mixed, 'md-rule').length, 1);
  assert.deepEqual([texts(byTag(mixed, 'th')), texts(byTag(byTag(mixed, 'td')[1], 'strong'))], [['a', 'b'], ['2']]);
});

test('a backslash before any ASCII punctuation shows it as written, as CommonMark reads escapes, and before anything else stays', () => {
  const cases = [
    ['\\*not italic\\*', '*not italic*'],
    ['a \\_b\\_ c', 'a _b_ c'],
    ['\\`x\\`', '`x`'],
    ['\\~~x~~', '~~x~~'],
    ['\\[x](https://a.example)', '[x](https://a.example)'],
    ['a \\q b \\\\ c', 'a \\q b \\ c'],
    ['\\d+\\.\\d and \\!', '\\d+.\\d and !'],
    ['\\# \\> \\$ \\@ \\{ \\}', '# > $ @ { }'],
    ['\\é \\日 \\1', '\\é \\日 \\1'],
  ];
  for (const [text, shown] of cases) {
    const host = render(text);
    assert.equal(host.textContent, shown, text);
    assert.equal(all(host, n => ['EM', 'STRONG', 'S', 'CODE'].includes(n.tagName)).length, 0, text + ' makes no mark');
  }
  assert.deepEqual(texts(byTag(render('\\*a* *b*'), 'em')), ['b']);
});

test('lines ending in CR LF read as lines: tables, lists and words carry no CR', () => {
  const host = render('| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n- x\r\n- y\r\n\r\nline one\r\nline two');
  assert.deepEqual([texts(byTag(host, 'th')), texts(byTag(host, 'td'))], [['a', 'b'], ['1', '2']]);
  assert.deepEqual(texts(byClass(host, 'md-item-words')), ['x', 'y']);
  assert.deepEqual(texts(byClass(host, 'md-p')), ['line one\nline two']);
  assert.ok(!host.textContent.includes('\r'));
});

test('only http and https become links, and nothing in a message becomes markup', () => {
  const text = '[x](javascript:alert(1)) [y](data:text/html,hi) <script>alert(1)</script> [ok](https://ok.example/a_b)';
  const host = render(text);
  const links = byTag(host, 'a');
  assert.deepEqual(links.map(a => [a.textContent, a.href]), [['ok', 'https://ok.example/a_b']]);
  assert.equal(host.textContent, '[x](javascript:alert(1)) [y](data:text/html,hi) <script>alert(1)</script> ok');
  assert.equal(all(host, n => n.tagName === 'SCRIPT').length, 0);
  // A link's address is never read as emphasis, but emphasis may hold a link.
  assert.equal(byTag(render('see https://a.example/x_y_z and'), 'em').length, 0);
  const italic = render('see _https://b.example/c_d_ now');
  assert.deepEqual([texts(byTag(italic, 'em')), byTag(italic, 'a').map(a => a.href)], [['https://b.example/c_d'], ['https://b.example/c_d']], 'italics hold the address, its own _ inside it');
  // A mark that would open inside an address and close after it does not cut the link.
  for (const text of ['see https://a.example/_x and y_ z', 'see https://a.example/**x and** z', 'see https://a.example/~~x and~~ z', 'see https://a.example/[x](https://b.example/y) z']) {
    const host = render(text);
    assert.deepEqual([webLinksOf(host), all(host, n => ['EM', 'STRONG', 'S'].includes(n.tagName)).length, host.textContent], [[text.split(' ')[1]], 0, text], text);
  }
  const held = render('**see https://a.example/x**');
  assert.deepEqual([texts(byTag(held, 'strong')), texts(byTag(byTag(held, 'strong')[0], 'a'))], [['see https://a.example/x'], ['https://a.example/x']]);
  // Every mark holds an address written straight before its closer, on a card and in the Reader alike.
  for (const [mark, tag] of [['**', 'strong'], ['__', 'strong'], ['~~', 's'], ['*', 'em'], ['_', 'em']]) {
    const text = `${mark}see https://a.example/x${mark} now`;
    for (const [where, host] of [['card', render(text)], ['Reader', passages(text)]]) {
      const held = byTag(host, tag);
      assert.deepEqual([texts(held), byTag(host, 'a').map(a => [a.textContent, a.href]), host.textContent.replace(/\s+$/, '')],
        [['see https://a.example/x'], [['https://a.example/x', 'https://a.example/x']], 'see https://a.example/x now'], `${where}: ${text}`);
    }
  }
});

// What a line draws, on a card and in the Reader alike: marks with their
// words, and links with their words and where they go.
const lineOf = host => [all(host, n => ['EM', 'STRONG', 'S', 'CODE'].includes(n.tagName)).map(n => `${n.tagName.toLowerCase()}:${n.textContent}`),
  byTag(host, 'a').map(a => [a.textContent, a.href]), host.textContent.replace(/\s+$/, '')];
const bothWays = (text, expected) => {
  for (const [where, host] of [['card', render(text)], ['Reader', passages(text)]]) assert.deepEqual(lineOf(host), expected, `${where}: ${text}`);
};

test('an escape is read before an address, so an escaped mark next to an address is the mark, never part of the address', () => {
  // The address ends where the escape starts, as an address never holds an escape's backslash.
  bothWays('see https://a.example/my\\_page now', [[], [['https://a.example/my', 'https://a.example/my']], 'see https://a.example/my_page now']);
  bothWays('_see https://a.example/x\\_ now_', [['em:see https://a.example/x_ now'], [['https://a.example/x', 'https://a.example/x']], 'see https://a.example/x_ now']);
  bothWays('*see https://a.example/x\\* now*', [['em:see https://a.example/x* now'], [['https://a.example/x', 'https://a.example/x']], 'see https://a.example/x* now']);
  bothWays('~~see https://a.example/x\\~~ now~~', [['s:see https://a.example/x~~ now'], [['https://a.example/x', 'https://a.example/x']], 'see https://a.example/x~~ now']);
  // A backslash before a letter is no escape, and stays the address's own.
  assert.deepEqual(lineOf(render('see https://a.example/a\\b now')), [[], [['https://a.example/a\\b', 'https://a.example/a/b']], 'see https://a.example/a\\b now']);
});

test('in a [named](link)\'s target an escaped bracket is the bracket as written: it neither opens nor closes the target', () => {
  // \) and \( are in the target, and the target ends at the first unescaped ) that closes it.
  bothWays('[a](https://a.example/x\\)y) after', [[], [['a', 'https://a.example/x)y']], 'a after']);
  bothWays('[a](https://a.example/x\\(y) after', [[], [['a', 'https://a.example/x(y']], 'a after']);
  // An escaped backslash escapes nothing after it, so the ) after it closes the target.
  bothWays('[a](https://a.example/x\\\\)y)', [[], [['a', 'https://a.example/x/']], 'ay)']);
  // A target whose only ) is escaped, or whose brackets an escaped ) leaves open, is no named link.
  bothWays('[a](https://m.example/\\)a', [[], [['https://m.example/', 'https://m.example/']], '[a](https://m.example/)a']);
  bothWays('[a](https://a.example/(x\\)y) after', [[], [['https://a.example/(x', 'https://a.example/(x']], '[a](https://a.example/(x)y) after']);
  // A backslash before a space escapes nothing: the space still ends the target.
  bothWays('[a](https://a.example/b\\ c)', [[], [['https://a.example/b\\', 'https://a.example/b/']], '[a](https://a.example/b\\ c)']);
});

test('whether a [ opens a link is read before any address inside it, so an address there holds brackets unless the [ is a link', () => {
  // A [ that opens a link: its words are a link's words, brackets and all, with no address in them.
  bothWays('[a https://a.example/x[b] c](https://d.example/)', [[], [['a https://a.example/x[b] c', 'https://d.example/']], 'a https://a.example/x[b] c']);
  bothWays('[see https://a.example/q?ids[]=1 now](https://d.example/)', [[], [['see https://a.example/q?ids[]=1 now', 'https://d.example/']], 'see https://a.example/q?ids[]=1 now']);
  // A [ that never becomes a link is words, and an address after it holds brackets as it does anywhere else.
  bothWays('[see https://a.example/q?ids[]=1 now] tail', [[], [['https://a.example/q?ids[]=1', 'https://a.example/q?ids[]=1']], '[see https://a.example/q?ids[]=1 now] tail']);
  bothWays('[draft: see https://a.example/q?ids[]=1 and more', [[], [['https://a.example/q?ids[]=1', 'https://a.example/q?ids[]=1']], '[draft: see https://a.example/q?ids[]=1 and more']);
  bothWays('see https://a.example/q?ids[]=1 now', [[], [['https://a.example/q?ids[]=1', 'https://a.example/q?ids[]=1']], 'see https://a.example/q?ids[]=1 now']);
  // A [ that is words changes nothing after it: the address reads as it does without the [.
  const V = 'https://a.example/v1[final](https://b.example/v2)';
  for (const text of [`[draft see ${V}`, `draft see ${V}`]) bothWays(text, [[], [[V, V]], text]);
  const X = 'https://a.example/x,[b](https://c.example/)';
  bothWays('(see [notes https://a.example/x,[b](https://c.example/))', [[], [[X, X]], '(see [notes https://a.example/x,[b](https://c.example/))']);
  bothWays('(see [http://[::1]:8080/x])', [[], [['http://[::1]:8080/x', 'http://[::1]:8080/x']], '(see [http://[::1]:8080/x])']);
  bothWays('[x [a](https://a.example/) https://b.example/q?ids[]=1 now',
    [[], [['a', 'https://a.example/'], ['https://b.example/q?ids[]=1', 'https://b.example/q?ids[]=1']], '[x a https://b.example/q?ids[]=1 now']);
  // A [ around a link is no link (links never hold links), whatever follows its ].
  bothWays('[a [b](https://b.example/) c](https://c.example/)',
    [[], [['b', 'https://b.example/'], ['https://c.example/', 'https://c.example/']], '[a b c](https://c.example/)']);
  // A [ ] with no words opens no link: the address after it is a bare one.
  bothWays('[](https://a.example/) x', [[], [['https://a.example/', 'https://a.example/']], '[](https://a.example/) x']);
  bothWays('[a [b [c](https://c.example/) d] e](https://e.example/)',
    [[], [['c', 'https://c.example/'], ['https://e.example/', 'https://e.example/']], '[a [b c d] e](https://e.example/)']);
  // The ] that closes a [ is found past escaped brackets and code, which bind tighter than brackets.
  bothWays('[a \\] b](https://d.example/)', [[], [['a ] b', 'https://d.example/']], 'a ] b']);
  bothWays('[a `]` b](https://d.example/)', [['code:]'], [['a ] b', 'https://d.example/']], 'a ] b']);
  bothWays('[a `b](https://d.example/) c`', [['code:b](https://d.example/) c'], [], '[a b](https://d.example/) c']);
});

test('underscores inside a word, in any script, open and close nothing, and stars still do', () => {
  for (const text of ['rename card__header and card__body', 'set MAX__A and MAX__B', 'my__var__name', 'café_menu_ is open', '日本_テスト_ です', 'snake_case_name here'])
    bothWays(text, [[], [], text]);
  // Standing as a word of its own, the same marks open and close.
  bothWays('call __init__ here', [['strong:init'], [], 'call init here']);
  bothWays('café*menu* is open', [['em:menu'], [], 'cafémenu is open']);
  bothWays('_café_ and __über__', [['em:café', 'strong:über'], [], 'café and über']);
});

// A line's words as HTML: elements by tag, a link with where it goes.
const html = text => {
  const visit = node => (node.nodeType === 3 ? node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    : `<${node.tagName.toLowerCase()}${node.tagName === 'A' ? ` href="${node.href}"` : ''}>${node.childNodes.map(visit).join('')}</${node.tagName.toLowerCase()}>`);
  return format.inlineNodes(text, { doc }).map(visit).join('');
};

test('marks open and close by CommonMark\'s rules for runs, and addresses end by GFM\'s', () => {
  const A = 'https://a.example/x';
  for (const [text, drawn] of [
    // Where a run may open: by the whitespace and punctuation on either side.
    ['*foo bar*', '<em>foo bar</em>'],
    ['a * foo bar*', 'a * foo bar*'],
    ['a*"foo"*', 'a*"foo"*'],
    ['5*6*78', '5<em>6</em>78'],
    ['*foo*bar', '<em>foo</em>bar'],
    ['foo-_(bar)_', 'foo-<em>(bar)</em>'],
    // A symbol is punctuation too (CommonMark 0.31), so a star between € and a letter closes nothing.
    ['*$*alpha and *€*bravo', '*$*alpha and *€*bravo'],
    // _ opens and closes nothing inside a word, in any script.
    ['5_6_78', '5_6_78'],
    ['пристаням_стремятся_', 'пристаням_стремятся_'],
    ['_foo_bar_baz_', '<em>foo_bar_baz</em>'],
    ['__foo__bar', '__foo__bar'],
    ['**foo**bar', '<strong>foo</strong>bar'],
    // The rule of three, and what is left of a run that closed one mark opening the next.
    ['*foo**bar**baz*', '<em>foo<strong>bar</strong>baz</em>'],
    ['*foo**bar*', '<em>foo**bar</em>'],
    ['foo***bar***baz', 'foo<em><strong>bar</strong></em>baz'],
    ['foo******bar*********baz', 'foo<strong><strong><strong>bar</strong></strong></strong>***baz'],
    ['*b***c*', '<em>b</em>*<em>c</em>'],
    ['**a***b***', '<strong>a</strong><em>b</em>**'],
    ['**foo *bar* baz**', '<strong>foo <em>bar</em> baz</strong>'],
    // Code and links take their place first; marks never cut them.
    ['*foo`*`', '*foo<code>*</code>'],
    [`[not a \`link](${A}\`)`, `[not a <code>link](${A}</code>)`],
    [`*a [b*](${A})`, `*a <a href="${A}">b*</a>`],
    [`[a *b* \`c\`](${A})`, `<a href="${A}">a <em>b</em> <code>c</code></a>`],
    [`[a\\_b](${A})`, `<a href="${A}">a_b</a>`],
    [`[a [b] c](${A})`, `<a href="${A}">a [b] c</a>`],
    // Links never hold links: the inner one closes first, and the outer brackets are words.
    [`[a [b](${A}) c](https://a.example/y)`, `[a <a href="${A}">b</a> c](<a href="https://a.example/y">https://a.example/y</a>)`],
    [`[see ${A}](https://b.example/y)`, `<a href="https://b.example/y">see ${A}</a>`],
    [`[see ${A} now](https://b.example/y)`, `<a href="https://b.example/y">see ${A} now</a>`],
    [`[see ${A}] now`, `[see <a href="${A}">${A}</a>] now`],
    // ~~ is two tildes exactly.
    ['~~a~~ ~~~b~~~ ~c~ ~~ d~~ ~~~~e~~~~', '<s>a</s> ~~~b~~~ ~c~ ~~ d~~ ~~~~e~~~~'],
    // Code: a run closes only on a run of its own length; one space off each end.
    ['``a`b`` and ` `` `', '<code>a`b</code> and <code>``</code>'],
    ['\\`a` and \\\\*b*', '`a` and \\<em>b</em>'],
    // An address keeps what it opened and leaves sentence punctuation, marks and an unopened bracket out.
    [`(see ${A}.) and ${A}_(y)_, ok`, `(see <a href="${A}">${A}</a>.) and <a href="${A}_(y)">${A}_(y)</a>_, ok`],
    [`_${A}_ **${A}** ~~${A}~~`, `<em><a href="${A}">${A}</a></em> <strong><a href="${A}">${A}</a></strong> <s><a href="${A}">${A}</a></s>`],
    [`${A}\\_y and ${A}\\\\`, `<a href="${A}">${A}</a>_y and <a href="${A}">${A}</a>\\`],
  ]) assert.equal(html(text), drawn, text);
});

// A message with every kind of block, and inline marks in each.
const EVERYTHING = '\n# Title with **bold**\r\n\r\nFirst sentence with *em* and `code`. Second at https://a.example/x?y=1 here. Third [named](https://b.example/z).\n\n' +
  '- [ ] a task with ~~gone~~ words\n- an item\n  carried on\n  1. a number\n\n> quoted **line**\n> > deeper\n\n```js\nlet a = 1;\n```\n\n' +
  BOX_TABLE + '\n\n| L | R |\n|:-|-:|\n| a \\| b | **c** |\n| short |\n\nx | y | z\n1 | 2 | 3\n\n---\n\nThe \\*end\\*.';

// The Reader's passages (drawPassages) and where each boundary in their text falls in the source.
function passages(body, options) {
  const host = new Element('div');
  format.drawPassages(host, body, doc, options);
  return host;
}
const positions = (host, body) => {
  const out = [];
  for (const node of walk(host)) {
    if (node.nodeType !== 3) continue;
    const marker = (() => { for (let at = node.parentNode; at; at = at.parentNode) if (at.className?.includes('md-marker')) return true; return false; })();
    const tail = node.parentNode?.parentNode === host && node === node.parentNode.childNodes.at(-1) && !node.data.trim() && node.parentNode.childNodes.length > 1;
    for (let k = 0; k <= node.data.length; k++) out.push({ node, k, at: format.sourcePosition(node, k), glyph: marker || tail });
  }
  return out;
};

test('a [named](link) goes to its target as written, brackets, quote marks and end punctuation in it, and shows the author\'s words', async t => {
  for (const [text, href, shown] of [
    ['[Markdown](https://en.wikipedia.org/wiki/Markdown_(disambiguation)) after', 'https://en.wikipedia.org/wiki/Markdown_(disambiguation)', 'Markdown after'],
    ["[x](https://a.example/it's) after", "https://a.example/it's", 'x after'],
    ['[x](https://a.example/p.) after', 'https://a.example/p.', 'x after'],
    ['[x](https://a.example/q?a=1,b;c!) after', 'https://a.example/q?a=1,b;c!', 'x after'],
    ['[x](https://a.example/(a)(b)) after', 'https://a.example/(a)(b)', 'x after'],
    ['([x](https://a.example/y)) after', 'https://a.example/y', '(x) after'],
  ]) {
    const host = render(text);
    assert.deepEqual([byTag(host, 'a').map(a => [a.textContent, a.href]), host.textContent], [[[shown.replace(/[()]| after/g, ''), href]], shown], text);
  }
  // A target whose brackets do not close, or with a space in it, is no named link: its address is drawn as any is.
  for (const text of ['[x](https://a.example/(b) after', '[x](https://a.example/b c)', '[x](http:a.example)', '[x](HTTP:a.example)'])
    assert.ok(!byTag(render(text), 'a').some(a => a.textContent === 'x'), text);
  // A named link to one of this Theseus's topics keeps the author's words, whether the name is known or still being read.
  const previous = globalThis.location;
  globalThis.location = new URL('https://theseus.example:5211/?topic=t1');
  const T1 = 't-' + '1'.repeat(32), T2 = 't-' + '2'.repeat(32), read = Promise.resolve('Launch plan');
  nameTopicsWith(id => (id === T1 ? 'Launch copy' : read));
  t.after(() => { globalThis.location = previous; nameTopicsWith(() => null); });
  const host = render(`see [the copy](https://theseus.example:5211/?topic=${T1}) and [the notes](https://theseus.example:5211/?topic=${T2})`);
  await read; await null;
  assert.deepEqual(byTag(host, 'a').map(a => [a.textContent, a.href, a.target]), [['the copy', `?topic=${T1}`, ''], ['the notes', `?topic=${T2}`, '']]);
});

test('the Reader\'s passages cover the whole message, with no gap or overlap, and every character maps back to its own source', () => {
  for (const body of [EVERYTHING, 'Plain words. Two sentences.', 'One', '\n\nleading blank lines\n\n', '- a\n- b', '```\nopen fence', ROLL_CALL, 'See [the *new* `plan`](https://a.example/x) now.']) {
    const host = passages(body);
    const spans = host.childNodes.map(node => [Number(node.dataset.start), Number(node.dataset.end)]);
    assert.ok(spans.length > 0, JSON.stringify(body));
    assert.equal(spans[0][0], 0, 'from the first character');
    assert.equal(spans.at(-1)[1], body.length, 'to the last');
    spans.forEach(([start, end], n) => { assert.ok(start < end, 'no empty passage'); if (n) assert.equal(start, spans[n - 1][1], 'no gap or overlap'); });
    const marks = positions(host, body);
    let last = 0;
    for (const { node, k, at, glyph } of marks) {
      assert.equal(typeof at, 'number', `a position for ${JSON.stringify(node.data)} at ${k}`);
      assert.ok(at >= last, `positions run forward: ${JSON.stringify(node.data)} at ${k} is ${at}, after ${last}`);
      last = at;
      let passage = node; while (passage.parentNode !== host) passage = passage.parentNode;
      assert.ok(at >= Number(passage.dataset.start) && at <= Number(passage.dataset.end), 'inside its own passage');
      // A [named](link) is quoted whole: its words are somewhere in what it maps to.
      const link = (() => { for (let at = node.parentNode; at; at = at.parentNode) if (at.tagName === 'A') return at; return null; })();
      if (link) { if (k === 0) assert.ok(body.slice(at, format.sourcePosition(node, node.data.length, true)).includes(node.data), `the link ${node.data} maps to its source`); }
      else if (k < node.data.length && !glyph) {
        const next = format.sourcePosition(node, k + 1);
        assert.ok(body.slice(at, next).includes(node.data[k]), `${JSON.stringify(node.data[k])} of ${JSON.stringify(node.data)} comes from ${JSON.stringify(body.slice(at, next))}`);
      }
    }
  }
  assert.deepEqual(passages('').childNodes, [], 'no words, no passages');
});

// A drawing of nodes as words and elements, without the blocks and passages that hold them.
const drawing = host => {
  const out = [];
  const visit = node => {
    if (node.nodeType === 3) { if (typeof out.at(-1) === 'string') out[out.length - 1] += node.data; else out.push(node.data); return; }
    const held = node.tagName === 'SPAN' && (!node.className || node.className.includes('md-p'));
    if (!held) out.push(`<${node.tagName.toLowerCase()}${node.href ? ' ' + node.href : ''}>`);
    for (const child of node.childNodes) visit(child);
    if (!held) out.push(`</${node.tagName.toLowerCase()}>`);
  };
  for (const child of host.childNodes) visit(child);
  return out.join('');
};

test('the Reader draws a paragraph as its card does: a sentence end inside a link, code or a mark cuts none of them', () => {
  for (const body of [
    '[Why? See here](https://a.example/x) after',
    '[Step one. Then two](https://a.example/x) after. And more.',
    "Read [x](https://a.example/a'b!Next) now",
    'Run `Stop. Go` now. Then more.',
    '**Stop. Go** now. Then *Wait. Here* too.',
    'First https://a.example/x. Then [b](https://b.example/y). Last.',
    '**a [b**](https://a.example/x) c. Then more.',
  ]) {
    const card = drawing(render(body)), reader = passages(body);
    assert.equal(drawing(reader), card, body);
    assert.ok(!reader.textContent.includes(']('), `${body}: no Markdown of a link is left in the Reader`);
  }
  // A paragraph's sentences are still its passages.
  assert.deepEqual(passages('One [a](https://a.example/x). Two `b`. Three **c**.').childNodes.map(node => node.textContent), ['One a. ', 'Two b. ', 'Three c.']);
});

test('a mark never opens or closes inside a link, code or an escaped mark, and holds them whole', () => {
  const cases = [
    ['**a [b**](https://a.example/x) c', [], [['b**', 'https://a.example/x']]],
    ['*see `a*b` here*', ['em:see a*b here'], []],
    ['_a [b_](https://a.example/x)_', ['em:a b_'], [['b_', 'https://a.example/x']]],
    ['~~gone [x](https://a.example/y)~~', ['s:gone x'], [['x', 'https://a.example/y']]],
    ['*a \\* b*', ['em:a * b'], []],
    // Marks inside marks still open and close at the edges of what holds them.
    ['__*a* b__', ['strong:a b', 'em:a'], []],
    ['__*a*__', ['strong:a', 'em:a'], []],
    ['_a **b_ c**', ['em:a **b'], []],
    // Code runs over a line end within a paragraph, as CommonMark reads it.
    ['a `b\nc` d', ['code:b c'], []],
  ];
  for (const [text, marks, links] of cases) {
    const host = render(text);
    const got = [all(host, n => ['EM', 'STRONG', 'S', 'CODE'].includes(n.tagName)).map(n => `${n.tagName.toLowerCase()}:${n.textContent}`).filter(mark => !mark.startsWith('code:') || text.includes('\n')),
      byTag(host, 'a').map(a => [a.textContent, a.href])];
    assert.deepEqual(got, [marks, links], text);
  }
  assert.deepEqual(texts(byTag(render('*see `a*b` here* and `x\ny` z'), 'code')), ['a*b', 'x y'], 'code holds its marks, and its line end is a space');
  assert.deepEqual(texts(byTag(render('`` `a` `` and ` b ` and `  `'), 'code')), ['`a`', 'b', '  '], 'one space comes off each end of code that has one at both, unless it is all spaces');
  // An excerpt may have cut an address at its end: it stays words there, and is a link anywhere else.
  assert.deepEqual(webLinksOf(render('**see** https://a.example/x and https://a.example/y', { partial: true })), ['https://a.example/x']);
});

test('a selection maps back to the author\'s own words: marks it covers whole, a link whole, a table as written', () => {
  const body = 'Some **bold** words and a [link](https://a.example/x) here.\n\n- [ ] task one\n- item *two*\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const host = passages(body);
  const textOf = words => walk(host).find(n => n.nodeType === 3 && n.data === words);
  const quote = (from, fromAt, to, toAt) => body.slice(format.sourcePosition(from, fromAt), format.sourcePosition(to, toAt, true));
  const bold = textOf('bold');
  assert.equal(quote(bold, 0, bold, 4), '**bold**', 'a whole bold word keeps its marks');
  assert.equal(quote(bold, 1, bold, 3), 'ol', 'part of it is its letters');
  assert.equal(quote(textOf('Some '), 0, textOf(' words and a '), 6), 'Some **bold** words');
  const link = byTag(host, 'a')[0];
  assert.equal(quote(link.childNodes[0], 1, textOf(' here.'), 5), '[link](https://a.example/x) here', 'a link a selection partly covers is taken whole');
  // So is one whose words have marks, from any word inside it.
  const marked = 'Read [the *new* plan](https://a.example/y) today.', inMarked = passages(marked);
  const word = walk(inMarked).find(n => n.nodeType === 3 && n.data === 'new');
  assert.equal(marked.slice(format.sourcePosition(word, 1), format.sourcePosition(walk(inMarked).find(n => n.nodeType === 3 && n.data === ' today.'), 6, true)), '[the *new* plan](https://a.example/y) today');
  assert.equal(marked.slice(format.sourcePosition(walk(inMarked).find(n => n.nodeType === 3 && n.data === 'Read '), 0), format.sourcePosition(word, 2, true)), 'Read [the *new* plan](https://a.example/y)');
  assert.equal(quote(textOf(' words and a '), 1, link.childNodes[0], 2), 'words and a [link](https://a.example/x)');
  const marker = byClass(host, 'md-marker')[0].childNodes[0];
  assert.equal(quote(marker, 0, textOf('task one'), 8), '- [ ] task one', 'from the box, the item as written');
  assert.equal(quote(textOf('two'), 0, textOf('two'), 3), '*two*');
  const cells = byClass(host, 'md-cell');
  assert.equal(quote(cells[0].childNodes[0], 0, cells.at(-1).childNodes[0], 1), '| a | b |\n|---|---|\n| 1 | 2 |', 'the whole table, as written');
  assert.equal(quote(cells[1].childNodes[0], 0, cells[2].childNodes[0], 1), 'b |\n|---|---|\n| 1');
  // Boundaries between nodes, as a selection of whole elements gives them.
  const strong = byTag(host, 'strong')[0];
  assert.equal(body.slice(format.sourcePosition(strong.parentNode, strong.parentNode.childNodes.indexOf(strong)), format.sourcePosition(strong.parentNode, strong.parentNode.childNodes.indexOf(strong) + 1, true)), '**bold**');
  assert.equal(format.sourcePosition(new Text('elsewhere'), 0), null, 'a node the message did not draw is nowhere in it');
});

// Inputs that cost quadratic time in a naive reader of Markdown (loom's
// tests/page_pane/test_markdown.py hostile inputs, and ours).
const HOSTILE = {
  'unclosed bold': n => '**a '.repeat(n),
  'unclosed struck': n => '~~a '.repeat(n),
  'unclosed italics': n => '*a '.repeat(n),
  'unclosed underscores': n => '_a '.repeat(n),
  // Runs of one kind that close nothing, after runs of another that open nothing: each search for an opener stops where the last one did.
  'stars before underscores': n => '*a_ '.repeat(n),
  'stars and underscores both ways': n => '*a_ _b* '.repeat(n),
  'escapes beside addresses': n => 'https://a.example/x\\_'.repeat(n),
  'link words with marks': n => '[a *b* `c`](https://a.example/x) '.repeat(n),
  backticks: n => '`'.repeat(n),
  'backtick runs': n => Array.from({ length: n }, (_, k) => '`'.repeat(1 + (k % 7)) + 'a ').join(''),
  brackets: n => '['.repeat(n),
  'link openers': n => '[a](https://'.repeat(n),
  // Whether each [ opens a link is found once, in one pass, however brackets nest or stay open around addresses.
  'unclosed brackets before addresses': n => '[see https://a.example/q?ids[]=1 '.repeat(n),
  'nested brackets around addresses, closed at the end': n => '[a https://a.example/q?x[]=1 '.repeat(n) + ']'.repeat(n) + '(https://d.example/)',
  'nested brackets closed by targets': n => '[a ['.repeat(n) + '](https://d.example/)'.repeat(2 * n),
  'links inside many open brackets': n => '['.repeat(n) + '[a](https://a.example/) '.repeat(n),
  'a link whose target holds links': n => '[a](https://a.example/'.repeat(n) + ')'.repeat(n),
  'quote markers': n => '> '.repeat(n),
  'closing brackets after an address': n => 'https://a.example/' + ')'.repeat(n),
  'addresses and topic ids': n => ('https://a.example/x t-' + 'a'.repeat(32) + ' ').repeat(n),
  'heading with a long gap': n => '# a' + ' '.repeat(n) + 'b',
  'dash row with a long gap': n => '| a | b |\n|-' + ' '.repeat(n) + 'x',
  backslashes: n => '\\'.repeat(n),
  bars: n => 'a | b | c\n'.repeat(n),
  sentences: n => 'One https://a.example/x. '.repeat(n),
  'link targets with brackets': n => '[a](https://a.example/(b)'.repeat(n),
  'brackets sharing a target that is no address': n => '['.repeat(n) + '](https://' + 'a'.repeat(n) + '%)',
  'targets that are no address, one inside another': n => '[a](https://%'.repeat(n / 4) + ')'.repeat(n / 4),
  'a long row under a narrow head': n => '| a |\n|---|\n|' + 'x|'.repeat(n) + '\n' + '|y|\n'.repeat(n),
  'a wide head over short rows': n => '|' + 'h|'.repeat(n) + '\n|' + '-|'.repeat(n) + '\n' + '|y|\n'.repeat(n),
};

// Reading addresses is the costliest step there is, so it is also counted
// apart from the work meter, at the browser's own URL: characters handed to it.
function countingAddresses(t) {
  const Real = globalThis.URL, count = { read: 0 };
  globalThis.URL = class extends Real { constructor(address, base) { count.read += String(address).length; super(address, base); } };
  t.after(() => { globalThis.URL = Real; });
  return count;
}

test('a hostile message costs work in proportion to its length', t => {
  const addresses = countingAddresses(t);
  for (const [name, make] of Object.entries(HOSTILE)) {
    const work = [], read = [];
    for (const n of [4000, 8000]) {
      const text = make(n), cards = { steps: 0 }, reader = { steps: 0 };
      addresses.read = 0;
      format.formatNodes(text, { doc, meter: cards });
      passages(text, { meter: reader });
      for (const meter of [cards, reader]) assert.ok(meter.steps > 0 && meter.steps <= 40 * text.length, `${name}: ${meter.steps} steps for ${text.length} characters`);
      assert.ok(addresses.read <= 4 * text.length, `${name}: ${addresses.read} characters read as addresses for ${text.length}`);
      work.push(cards.steps + reader.steps); read.push(addresses.read);
    }
    assert.ok(work[1] <= 2.2 * work[0], `${name}: twice the length costs ${work[1] / work[0]} times the work`);
    assert.ok(read[1] <= 2.2 * Math.max(read[0], 1), `${name}: twice the length reads ${read[1] / read[0]} times the addresses`);
  }
  // Nothing in the unclosed runs formats: the words are as written.
  for (const name of ['unclosed bold', 'unclosed struck', 'brackets', 'link openers']) assert.equal(render(HOSTILE[name](50)).textContent, HOSTILE[name](50), name);
});

test('a table that runs wider than its box fades at the edge it scrolls toward, on scroll and on resize, with no timer', t => {
  const observed = [], unobserved = [], timers = [];
  let notify;
  const previous = { ResizeObserver: globalThis.ResizeObserver, setTimeout: globalThis.setTimeout, requestAnimationFrame: globalThis.requestAnimationFrame };
  globalThis.ResizeObserver = class { constructor(fn) { notify = fn; } observe(node) { observed.push(node); } unobserve(node) { unobserved.push(node); } };
  globalThis.setTimeout = (...args) => { timers.push(args); return 0; };
  globalThis.requestAnimationFrame = (...args) => { timers.push(args); return 0; };
  t.after(() => Object.assign(globalThis, previous));
  const host = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n┌─┐\n│x│\n└─┘');
  const [wrap] = byClass(host, 'md-table-wrap'), [box] = byClass(host, 'md-box');
  assert.ok(observed.includes(wrap) && observed.includes(byTag(wrap, 'table')[0]), 'the box and what it holds are watched for size');
  assert.ok(observed.includes(box), 'a drawn table too');
  const edges = node => ['md-more-left', 'md-more-right'].filter(name => node.classList.contains(name));
  Object.assign(wrap, { clientWidth: 300, scrollWidth: 300 });
  notify([{ target: wrap }]);
  assert.deepEqual(edges(wrap), [], 'a table that fits does not fade');
  Object.assign(wrap, { clientWidth: 300, scrollWidth: 900 });
  notify([{ target: byTag(wrap, 'table')[0] }]);
  assert.deepEqual(edges(wrap), ['md-more-right'], 'wider than its box: the right edge fades');
  wrap.scrollLeft = 200;
  for (const fn of wrap.handlers.scroll) fn({});
  assert.deepEqual(edges(wrap), ['md-more-left', 'md-more-right'], 'scrolled part way: both edges');
  wrap.scrollLeft = 600;
  for (const fn of wrap.handlers.scroll) fn({});
  assert.deepEqual(edges(wrap), ['md-more-left'], 'scrolled to the end: the left edge only');
  wrap.isConnected = false;
  notify([{ target: wrap }]);
  assert.ok(unobserved.includes(wrap), 'a table no longer on the page is let go');
  assert.deepEqual(timers, [], 'no timer or frame is asked for');
});

// Every kind of link to one of this Theseus's places opens here, as it did
// before a message's words were formatted (docs/links.md): in every block
// formatting draws, on a card and in the Reader alike, written as an address,
// as a [named](link) or as a topic's bare id. A click hands the page's opener
// the place and keeps the browser from following the link; a click with a
// modifier is left to the browser; and no click reaches the card or passage
// around it. A link elsewhere opens in a new tab and never the opener.
test('every kind of in-app link opens here from every block formatting draws, on a card and in the Reader', t => {
  const O = 'https://theseus.example:5211', T1 = 't-' + 'a'.repeat(32), previous = globalThis.location;
  globalThis.location = new URL(O + '/?topic=t1');
  const opened = [];
  openLinksWith((route, title) => opened.push(route));
  nameTopicsWith(id => (id === T1 ? 'Launch copy' : null));
  t.after(() => { globalThis.location = previous; openLinksWith(null); nameTopicsWith(() => null); });
  const PLACES = [
    ['a topic', '/?topic=t1', { kind: 'topic', id: 't1' }],
    ['a message', '/?topic=t1&message=m-1', { kind: 'topic', id: 't1', message: 'm-1' }],
    ["a topic's Notebook page as it stands", '/?topic=t1&page=n-1', { kind: 'topic', id: 't1', page: 'n-1' }],
    ["a topic's Notebook page at a revision", '/?topic=t1&page=n-1&revision=2', { kind: 'topic', id: 't1', page: 'n-1', revision: '2' }],
    ["an outcome's Notebook page as it stands", '/?workspace=w1&page=notebook-linked-plan', { kind: 'workspace', id: 'w1', page: 'notebook-linked-plan' }],
    ["an outcome's Notebook page at a revision", '/?workspace=w1&page=n-2&revision=1', { kind: 'workspace', id: 'w1', page: 'n-2', revision: '1' }],
    ['an outcome', '/?workspace=w1', { kind: 'workspace', id: 'w1' }],
    ["an outcome's conversation", '/?conversation=w1', { kind: 'conversation', id: 'w1' }],
    ["an outcome's pipeline", '/?pipeline=w1', { kind: 'pipeline', id: 'w1' }],
    ['a pipeline item', '/?pipeline=w1&item=24', { kind: 'item', id: 'w1', item: '24' }],
  ];
  const LINKS = [
    ...PLACES.map(([what, path, route]) => [`${what}, by its address`, O + path, route]),
    ...PLACES.map(([what, path, route]) => [`${what}, as a [named](link)`, `[the place](${O + path})`, route]),
    ["a topic's bare id", T1, { kind: 'topic', id: T1 }],
  ];
  const ELSEWHERE = 'https://elsewhere.example/x';
  // Each block formatting draws, with the link in it, and how to find that block's node: in the
  // Reader a paragraph is drawn as its sentences, each a passage of its own.
  const inside = (node, test) => { for (let at = node.parentNode; at; at = at.parentNode) if (test(at)) return true; return false; };
  const has = name => node => node.className?.split?.(' ').includes(name);
  const BLOCKS = [
    ['a paragraph', link => `The plan: ${link} as it stands, or ${ELSEWHERE} elsewhere.`, node => has('md-p')(node) || (node.tagName === 'SPAN' && !node.className && 'start' in node.dataset)],
    ['a list item', link => `- first\n- the plan: ${link} as it stands, or ${ELSEWHERE} elsewhere`, has('md-item-words')],
    ['a numbered item', link => `1. the plan: ${link} as it stands, or ${ELSEWHERE} elsewhere`, has('md-item-words')],
    ['a task item', link => `- [ ] the plan: ${link} as it stands, or ${ELSEWHERE} elsewhere`, has('md-item-words')],
    ['a heading', link => `## The plan: ${link} as it stands, or ${ELSEWHERE} elsewhere`, has('md-heading')],
    ['a table cell', link => `| what | where |\n| --- | --- |\n| plan | ${link} as it stands, or ${ELSEWHERE} elsewhere |`, node => node.tagName === 'TD'],
    ["an agent's table cell", link => `what | where | when\nplan | ${link} as it stands, or ${ELSEWHERE} elsewhere | now`, node => node.tagName === 'TD'],
    ['a quote', link => `> The plan: ${link} as it stands, or ${ELSEWHERE} elsewhere.`, has('md-quote')],
    ['a quote past nine deep, whose words are one paragraph', link => `${'> '.repeat(10)}The plan: ${link} as it stands, or ${ELSEWHERE} elsewhere.`, has('md-quote')],
    ['a list in a quote', link => `> - the plan: ${link} as it stands, or ${ELSEWHERE} elsewhere`, node => has('md-item-words')(node) && inside(node, has('md-quote'))],
    ['bold words', link => `**The plan: ${link} as it stands, or ${ELSEWHERE} elsewhere.**`, node => node.tagName === 'STRONG'],
  ];
  const press = (a, fields = {}) => {
    const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...fields };
    for (const fn of a.handlers.click ?? []) fn(event);
    return event;
  };
  for (const [what, link, route] of LINKS) {
    // As the link was drawn before its words were formatted, where it can be: the place its anchor opened.
    const plain = link.startsWith('[') ? null : wordNodes(link, { doc }).find(node => node.tagName === 'A');
    if (plain) { opened.length = 0; press(plain); assert.deepEqual(opened, [route], `${what}: unformatted, it opens ${JSON.stringify(route)}`); }
    for (const [block, write, held] of BLOCKS) {
      for (const [where, host] of [['card', render(write(link))], ['Reader', passages(write(link))]]) {
        const at = `${what}, in ${block}, in the ${where}`;
        const anchors = byTag(host, 'a');
        assert.equal(anchors.length, 2, `${at}: the link and the address elsewhere are links`);
        const [a, away] = anchors;
        assert.ok(inside(a, held) && inside(away, held), `${at}: drawn in its block`);
        assert.deepEqual([a.href, a.target, a.rel], [routeHref(route), '', ''], `${at}: a link to this Theseus's place, opened here`);
        assert.deepEqual([away.href, away.target, away.rel], [ELSEWHERE, '_blank', 'noopener noreferrer'], `${at}: elsewhere opens in a new tab`);
        opened.length = 0;
        const click = press(a);
        assert.deepEqual(opened, [route], `${at}: a click opens the place here`);
        assert.deepEqual([click.prevented, click.stopped], [true, true], `${at}: the browser does not follow it, and the card or passage around it is not pressed`);
        opened.length = 0;
        const modified = press(a, { metaKey: true }), other = press(away);
        assert.deepEqual(opened, [], `${at}: a click with a modifier, or on a link elsewhere, opens nothing here`);
        assert.deepEqual([modified.prevented, modified.stopped, other.prevented, other.stopped], [false, true, false, true], `${at}: the browser follows those, and nothing around them is pressed`);
      }
    }
  }
});

// The Reader draws a page's or a message's plain words as they were written,
// whitespace at the end aside, as a Notebook page's link opens it.
test('the Reader draws plain words as written, whitespace at the end aside, and its passages still cover all of them', () => {
  for (const body of ['Ship on Monday.\nDan reviews the notes.\n', 'The linked page, revised.', 'First line\nsecond line\n\nA new paragraph. Two sentences.\n\n', 'One\n']) {
    const host = passages(body);
    assert.equal(host.textContent, body.trimEnd(), JSON.stringify(body));
    assert.deepEqual([host.childNodes[0].dataset.start, host.childNodes.at(-1).dataset.end], ['0', String(body.length)], JSON.stringify(body));
  }
});

test('fence copy is opt-in, preserves payload and quote mapping, and excludes inline code and box tables', () => {
  const body = '> ~~~~ text\r\n> \t  α <tag> & `literal`  \r\n> \r\n> end\r\n> ~~~~\r\n\r\nAfter `inline`.';
  assert.equal(byClass(render(body), 'fence-copy').length, 0);
  const host = render(body, { copyFences: true });
  const buttons = byClass(host, 'fence-copy');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, '', 'control labels never enter selection or notebook cursor mapping');
  assert.equal(byClass(host, 'md-pre')[0].textContent, '\t  α <tag> & `literal`  \n\nend');
  assert.equal(host.textContent, render(body).textContent);
  const code = byClass(host, 'md-pre')[0], text = code.childNodes[0];
  const oldCode = byClass(render(body), 'md-pre')[0];
  for (let n = 0; n <= text.data.length; n++) {
    for (const end of [false, true]) assert.equal(format.sourcePosition(text, n, end), format.sourcePosition(oldCode.childNodes[0], n, end));
  }
  assert.equal(byClass(render(BOX_TABLE, { copyFences: true }), 'fence-copy').length, 0);
});

test('only a terminated closing line proves a fence complete in an excerpt, including quoted fences', () => {
  for (const marker of ['```', '~~~~']) {
    for (const quote of ['', '> ']) {
      const lines = [marker, 'one', marker].map(line => quote + line).join('\n');
      assert.equal(byClass(render(lines, { partial: true, copyFences: true }), 'fence-copy').length, 0, 'last delimiter may be a truncated non-closing line');
      assert.equal(byClass(render(lines + '\n', { partial: true, copyFences: true }), 'fence-copy').length, 1);
      assert.equal(byClass(render(lines, { copyFences: true }), 'fence-copy').length, 1);
      assert.equal(byClass(render(quote + marker + '\n' + quote + 'one', { partial: true, copyFences: true }), 'fence-copy').length, 0);
      assert.equal(byClass(render(quote + marker + '\n' + quote + 'one', { copyFences: true }), 'fence-copy').length, 1);
    }
  }
  assert.equal(byClass(render('```\n```', { copyFences: true }), 'fence-copy').length, 1, 'empty fence');
});


test('a URL written directly after a fence opener stays visible and copyable, including in a quote', () => {
  const url = 'https://discord.com/channels/123/456/789';
  for (const prefix of ['', '> ']) {
    const body = [prefix + '```' + url, prefix + '```'].join('\n');
    const host = render(body, { copyFences: true });
    assert.equal(byClass(host, 'md-pre')[0].textContent, url);
    assert.equal(byClass(host, 'fence-copy').length, 1);
  }
  assert.equal(byClass(render('```javascript\nconst x = 1;\n```'), 'md-pre')[0].textContent, 'const x = 1;');
});
