// Skills and tools (item 17; docs/skills-and-tools.md, section 1): a tool's own
// page, the outcome page's "Skills and tools" section with "+ Uses a tool",
// the outcome rail's list of them, and "Tools this topic improves" in Topic
// settings. Every word about a check comes from the server (aim_next/tool_words.py):
// these painters only place it. A word that is not the server's, or a pass with
// no count, refuses to paint rather than say something the record does not.
import { timeNode } from './times.mjs';
import { routeHref } from './topic-navigation.mjs';

export const FAILED = 'The skills and tools could not be read.';
const NOT_SAVED = 'Not saved; nothing changed.';
const KIND = { skill: 'Skill', tool: 'Tool' };
const validId = id => typeof id === 'string' && id.length > 0 && [...id].length <= 200 && !/[\x00-\x1f]/.test(id);
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const el = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false && child !== ''));
  return node;
};

// ---- words ------------------------------------------------------------------

// A tool's page, by its home and id.
export const toolHref = (home, id) => routeHref({ kind: 'tool', id: home, tool: id });

// The live word as parts: the server's words, and for a pass its time ({ms}).
// Never a pass without a recorded count of at least one, all passed; never "0 of 0".
export function wordParts(word) {
  if (!word || typeof word.words !== 'string' || !word.words || /\b0 of 0\b/.test(word.words)) throw Error(FAILED);
  if (word.state === 'passed') {
    if (!Number.isSafeInteger(word.total) || word.total < 1 || word.passed !== word.total || !Number.isSafeInteger(word.at_ms)) throw Error(FAILED);
    return [word.words, ' · ', { ms: word.at_ms }];
  }
  if (!['not_run', 'not_evaluated', 'failed', 'counted_nothing'].includes(word.state)) throw Error(FAILED);
  return [word.words];
}

// "Used by": the outcomes the reader can open, then how many they cannot.
export function usedByWords(usedBy, hidden) {
  if (!Array.isArray(usedBy) || !Number.isSafeInteger(hidden) || hidden < 0) throw Error(FAILED);
  const more = hidden ? `${usedBy.length ? 'and ' : ''}${hidden} ${hidden === 1 ? 'outcome' : 'outcomes'} you cannot open` : null;
  return { names: usedBy.map(user => user.title), more, none: !usedBy.length && !hidden ? 'No outcome says it uses this yet.' : null };
}

// Topics the reader cannot open, counted, never named.
export const hiddenTopicsWords = n => n ? `and ${n} ${n === 1 ? 'topic' : 'topics'} you cannot open` : null;

// One version that went back: its time, the server's words as a clause, then its topic.
export function wentBackParts(item) {
  if (!Number.isSafeInteger(item?.recorded_ms) || typeof item.words !== 'string' || !item.words) throw Error(FAILED);
  return [{ ms: item.recorded_ms }, ': ', item.words.charAt(0).toLowerCase() + item.words.slice(1), '.'];
}

// What a finder line offers: each choice whose name has every typed word.
export function matching(items, typed, nameOf = item => item.name) {
  const words = String(typed ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => words.every(word => nameOf(item).toLowerCase().includes(word)));
}

// ---- answers ------------------------------------------------------------------

function checkItem(item) {
  if (!validId(item?.tool_id) || !(item.kind in KIND) || typeof item.name !== 'string' || typeof item.summary !== 'string' ||
      !validId(item.home?.workspace_id) || typeof item.home.readable !== 'boolean') throw Error(FAILED);
  wordParts(item.word);
}
export function checkTools(answer, instanceId, workspaceId) {
  if (answer?.instance_id !== instanceId || answer.workspace_id !== workspaceId || !Array.isArray(answer.own) || !Array.isArray(answer.used) ||
      !Array.isArray(answer.offer) || typeof answer.reader_may_use !== 'boolean') throw Error(FAILED);
  for (const item of [...answer.own, ...answer.used]) checkItem(item);
  return answer;
}
export function checkTool(answer, instanceId, toolId) {
  const tool = answer?.tool;
  if (answer?.instance_id !== instanceId || tool?.tool_id !== toolId || !Array.isArray(tool.files) || !Array.isArray(answer.went_back?.items) ||
      !Array.isArray(answer.topics) || !Number.isSafeInteger(answer.topics_hidden)) throw Error(FAILED);
  checkItem(tool);
  usedByWords(answer.used_by, answer.used_by_hidden);
  for (const item of answer.went_back.items) wentBackParts(item);
  return answer;
}
export function checkTopicTools(answer, instanceId, topicId) {
  if (answer?.instance_id !== instanceId || answer.topic_id !== topicId || !Array.isArray(answer.linked) || !Array.isArray(answer.offered) ||
      typeof answer.reader_may_link !== 'boolean') throw Error(FAILED);
  for (const tool of [...answer.linked, ...answer.offered]) if (!validId(tool?.tool_id) || typeof tool.name !== 'string') throw Error(FAILED);
  return answer;
}

// ---- painting ---------------------------------------------------------------------

export function paintParts(node, parts, doc = node.ownerDocument) {
  node.replaceChildren(...parts.map(part => typeof part === 'string' ? doc.createTextNode(part) : timeNode(part.ms, doc)));
  return node;
}

// Whether what a painter would draw is what it drew last: a read that brings nothing new (a commit elsewhere, the live
// feed) replaces no node, so a press already under way on one of its buttons is not lost.
function same(painter, ...state) {
  const key = JSON.stringify(state);
  if (painter.drawn === key) return true;
  painter.drawn = key;
  return false;
}

// Put focus back where it was after a repaint replaced the node holding it.
function keepFocus(host, paint, doc = host.ownerDocument) {
  const active = host.contains(doc.activeElement) ? doc.activeElement : null;
  const key = active?.getAttribute('data-focus-key');
  paint();
  if (!key) return;
  const again = host.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (again && !again.disabled) again.focus();
}

// A link that opens its place through the page (open), so writing not yet saved
// still asks first.
function placeLink(doc, href, text, open, className = '') {
  const link = el(doc, 'a', { href, textContent: text, className });
  link.onclick = event => { if (!plainClick(event)) return; event.preventDefault(); open(); };
  return link;
}

// A glyph button: its name for screen readers, a tooltip, and a target a finger can hit.
function glyph(doc, text, name, onclick) {
  const button = el(doc, 'button', { type: 'button', className: 'quiet glyph-button', textContent: text, title: name });
  button.setAttribute('aria-label', name);
  button.onclick = onclick;
  return button;
}

// One quiet line opened from a button: type to find, Return or a click chooses
// the one shown first (or the one the arrows picked), Escape closes it and leaves
// everything as it was, with the focus back on the button.
export class Finder {
  constructor({ doc = document, id, button, label, placeholder, choices, nameOf = item => item.name, choose, nothing }) {
    Object.assign(this, { doc, id, label, choices, nameOf, choose, nothing });
    this.items = null; this.active = 0; this.busy = false; this.opened = false;
    this.button = el(doc, 'button', { type: 'button', className: 'quiet finder-open', textContent: button });
    this.button.setAttribute('data-focus-key', `${id}-open`);
    this.button.setAttribute('aria-expanded', 'false');
    this.button.onclick = () => this.opened ? this.shut() : this.open();
    this.input = el(doc, 'input', { type: 'text', className: 'finder-input', autocomplete: 'off', spellcheck: false, placeholder, enterKeyHint: 'go' });
    this.input.setAttribute('data-focus-key', `${id}-input`);
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', `${id}-list`);
    this.input.setAttribute('aria-label', label);
    this.input.oninput = () => { this.active = 0; this.paintList(); };
    this.input.onkeydown = event => this.key(event);
    this.list = el(doc, 'ul', { className: 'finder-list', id: `${id}-list` });
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.state = el(doc, 'p', { className: 'notice', hidden: true });
    this.state.setAttribute('role', 'status');
    this.line = el(doc, 'div', { className: 'finder', hidden: true }, this.input, this.list, this.state);
    this.node = el(doc, 'div', { className: 'finder-host' }, this.button, this.line);
  }
  shown() { return matching(this.items ?? [], this.input.value, this.nameOf).slice(0, 8); }
  paintList() {
    if (this.items === null) { this.list.replaceChildren(el(this.doc, 'li', { className: 'muted', textContent: 'Reading…' })); return; }
    const found = this.shown();
    this.active = Math.min(this.active, Math.max(found.length - 1, 0));
    this.input.removeAttribute('aria-activedescendant');
    if (!found.length) {
      this.list.replaceChildren(el(this.doc, 'li', { className: 'muted', textContent: this.input.value.trim() ? 'Nothing matches.' : this.nothing }));
      return;
    }
    this.list.replaceChildren(...found.map((item, index) => {
      const option = el(this.doc, 'li', { id: `${this.id}-${index}`, className: 'finder-option', textContent: this.nameOf(item) });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.active));
      option.onmousedown = event => event.preventDefault();
      option.onclick = () => this.take(item);
      return option;
    }));
    this.input.setAttribute('aria-activedescendant', `${this.id}-${this.active}`);
  }
  key(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const found = this.shown();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.shut(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (found.length) { this.active = (this.active + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length; this.paintList(); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat && found[this.active]) this.take(found[this.active]);
    }
  }
  say(text) { this.state.textContent = text; this.state.hidden = !text; }
  async open() {
    this.opened = true; this.items = null; this.active = 0; this.input.value = ''; this.say('');
    this.line.hidden = false; this.button.setAttribute('aria-expanded', 'true');
    this.paintList(); this.input.focus();
    try { this.items = await this.choices(); }
    catch (error) { this.items = []; this.say(error.message || FAILED); }
    if (this.opened) this.paintList();
  }
  shut(focus = true) {
    this.opened = false; this.line.hidden = true; this.say('');
    this.button.setAttribute('aria-expanded', 'false');
    if (focus) this.button.focus();
  }
  async take(item) {
    if (this.busy) return;
    this.busy = true; this.input.setAttribute('aria-busy', 'true');
    try { await this.choose(item); this.shut(); }
    catch (error) { this.say(error.message || NOT_SAVED); this.input.focus(); }
    finally { this.busy = false; this.input.removeAttribute('aria-busy'); }
  }
}

// The receipt of a command, or a refusal in the server's words.
async function sent(promise) {
  const receipt = await promise;
  if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? NOT_SAVED);
  return receipt.result;
}

// A tool's own page (section 1, "The tool page").
export class ToolPage {
  constructor({ host, header, toolId, instanceId, read, send, open, doc = host.ownerDocument }) {
    Object.assign(this, { host, header, toolId, instanceId, read, send, open, doc });
    this.limit = 5; this.answer = null; this.unlinking = new Set();
    this.status = el(doc, 'p', { className: 'notice tool-status', hidden: true });
    this.status.setAttribute('role', 'status');
    this.linker = new Finder({ doc, id: 'link-topic', button: 'Link a topic', label: 'Find an open topic to link', placeholder: 'Find an open topic',
      nothing: 'No open topic here is left to link.', nameOf: topic => topic.title,
      choices: () => this.openTopics(), choose: topic => this.link(topic.id, true) });
  }
  get home() { return this.answer?.tool.home ?? null; }
  async load() {
    try {
      this.answer = checkTool(await this.read('tool', { tool_id: this.toolId, limit: this.limit }), this.instanceId, this.toolId);
      this.paint();
      return true;
    } catch (error) {
      this.say(error.message || FAILED);
      if (!this.answer) { this.host.replaceChildren(this.status); this.host.hidden = false; }
      return false;
    }
  }
  say(text) { this.status.textContent = text; this.status.hidden = !text; }
  // The home outcome's open topics not yet linked.
  async openTopics() {
    const topics = [], linked = new Set(this.answer.topics.map(topic => topic.topic_id));
    let cursor = '';
    do {
      const answer = await this.read('workspace_topics', { workspace_id: this.home.workspace_id, cursor });
      topics.push(...answer.items); cursor = answer.next_cursor;
    } while (cursor);
    return topics.filter(topic => !linked.has(topic.id) && topic.kind !== 'conversation');
  }
  async link(topicId, linked) {
    await sent(this.send('tool.link', { topic_id: topicId }, { tool_id: this.toolId, linked }));
    this.say('');
    await this.load();
  }
  async unlink(topic) {
    this.unlinking.add(topic.topic_id); this.paint();
    try { await this.link(topic.topic_id, false); }
    catch (error) { this.say(error.message || NOT_SAVED); }
    finally {
      this.unlinking.delete(topic.topic_id); this.paint();
      // Its × again when the topic is still there (refused), or "Link a topic" once the row has gone.
      const again = this.host.querySelector(`[data-focus-key="${CSS.escape(`unlink:${topic.topic_id}`)}"]`);
      if (!this.host.contains(this.doc.activeElement)) (again ?? (this.host.contains(this.linker.button) ? this.linker.button : null))?.focus();
    }
  }
  // Its name as the title, its one-line summary under it, and the word Skill or Tool above.
  paintHeader(tool) {
    this.header.eyebrow.textContent = KIND[tool.kind];
    this.header.title.textContent = tool.name;
    this.header.description.textContent = tool.summary;
  }
  section(id, title, ...body) {
    const doc = this.doc;
    return el(doc, 'section', { className: 'tool-section' }, el(doc, 'h2', { id, textContent: title }), ...body);
  }
  paint() {
    const doc = this.doc, answer = this.answer, tool = answer.tool, home = tool.home;
    if (same(this, answer, [...this.unlinking], this.limit)) return;
    this.paintHeader(tool);
    const homeLine = el(doc, 'p', { className: 'tool-line' }, el(doc, 'span', { className: 'tool-label', textContent: 'Home: ' }),
      home.readable ? placeLink(doc, routeHref({ kind: 'workspace', id: home.workspace_id }), home.title, () => this.open({ kind: 'workspace', id: home.workspace_id }, home.title))
        : 'an outcome you are not on');
    const word = paintParts(el(doc, 'span', { className: 'tool-word' }), wordParts(tool.word), doc);
    word.setAttribute('data-state', tool.word.state);
    // Its check's word says what it is about ("Its check passed: …", "Not evaluated yet: it has no check"), so it needs no label.
    const checkLine = el(doc, 'p', { className: 'tool-line' }, word);
    const used = usedByWords(answer.used_by, answer.used_by_hidden);
    const usedLine = el(doc, 'p', { className: 'tool-line tool-used' }, el(doc, 'span', { className: 'tool-label', textContent: 'Used by: ' }));
    if (used.none) usedLine.append(used.none);
    answer.used_by.forEach((user, index) => usedLine.append(index ? ', ' : '', placeLink(doc, routeHref({ kind: 'workspace', id: user.workspace_id }), user.title,
      () => this.open({ kind: 'workspace', id: user.workspace_id }, user.title))));
    if (used.more) usedLine.append(answer.used_by.length ? ' ' : '', used.more);
    const parts = [homeLine, checkLine, usedLine];
    if (answer.went_back.items.length) {
      const list = el(doc, 'ul', { className: 'tool-went-back' }, ...answer.went_back.items.map(item => {
        const line = paintParts(el(doc, 'li'), wentBackParts(item), doc);
        if (item.topic) line.append(' Topic: ', placeLink(doc, routeHref({ kind: 'topic', id: item.topic.topic_id }), item.topic.title,
          () => this.open({ kind: 'topic', id: item.topic.topic_id }, item.topic.title)), '.');
        return line;
      }));
      const more = answer.went_back.next_cursor !== null && this.limit < 100
        ? el(doc, 'button', { type: 'button', className: 'quiet', textContent: 'More', onclick: () => { this.limit = Math.min(100, this.limit + 5); return this.load(); } }) : null;
      if (more) more.setAttribute('data-focus-key', 'went-back-more');
      parts.push(this.section('tool-went-back-heading', 'Went back', list, more));
    }
    const topics = el(doc, 'ul', { className: 'tool-topics' }, ...answer.topics.map(topic => {
      const row = el(doc, 'li', { className: 'tool-topic' }, el(doc, 'span', { className: 'tool-topic-words' }, placeLink(doc, routeHref({ kind: 'topic', id: topic.topic_id }), topic.title,
        () => this.open({ kind: 'topic', id: topic.topic_id }, topic.title)), el(doc, 'span', { className: 'muted', textContent: ` · ${stateWords(topic.state)}` })));
      if (topic.reader_may_unlink) {
        const unlink = glyph(doc, '×', `Take ${topic.title} off this tool`, () => this.unlink(topic));
        unlink.setAttribute('data-focus-key', `unlink:${topic.topic_id}`);
        unlink.disabled = this.unlinking.has(topic.topic_id);
        row.append(unlink);
      }
      return row;
    }));
    const hiddenTopics = hiddenTopicsWords(answer.topics_hidden);
    const noTopics = !answer.topics.length && !hiddenTopics ? el(doc, 'p', { className: 'empty', textContent: 'No topics about it yet.' }) : null;
    parts.push(this.section('tool-topics-heading', 'Topics about it', answer.topics.length ? topics : null,
      hiddenTopics ? el(doc, 'p', { className: 'muted', textContent: hiddenTopics }) : null, noTopics, answer.reader_may_link ? this.linker.node : null));
    const files = el(doc, 'details', { className: 'tool-files' }, el(doc, 'summary', { textContent: 'Files' }),
      el(doc, 'ul', {}, el(doc, 'li', {}, el(doc, 'code', { textContent: tool.record_path }), el(doc, 'span', { className: 'muted', textContent: ' · its record' })),
        ...tool.files.map(file => el(doc, 'li', {}, el(doc, 'code', { textContent: file.path }), file.check ? el(doc, 'span', { className: 'muted', textContent: ' · its check' }) : null))));
    const open = this.host.querySelector('.tool-files')?.open ?? false;
    files.open = open;
    parts.push(files);
    keepFocus(this.host, () => this.host.replaceChildren(this.status, ...parts), doc);
    this.host.hidden = false;
  }
}

const stateWords = state => ({ active: 'Active', waiting: 'Waiting', review: 'Ready for review', done: 'Done' })[state] ?? 'Active';

function row(doc, item, open, extra = null) {
  const link = placeLink(doc, toolHref(item.home.workspace_id, item.tool_id), item.name, () => open({ kind: 'tool', id: item.home.workspace_id, tool: item.tool_id }, item.name), 'tool-name');
  const word = paintParts(el(doc, 'span', { className: 'tool-word' }), wordParts(item.word), doc);
  word.setAttribute('data-state', item.word.state);
  return el(doc, 'li', { className: 'tool-row' }, el(doc, 'div', { className: 'tool-row-words' }, link, el(doc, 'span', { className: 'muted', textContent: ` · ${KIND[item.kind]}` }),
    el(doc, 'span', { className: 'tool-row-word' }, word)), extra);
}

// The outcome page's "Skills and tools": its own tools, then those it said it
// uses, and "+ Uses a tool" for a reader who can write in it.
export class OutcomeTools {
  constructor({ host, workspace, instanceId, read, send, open, doc = host.ownerDocument }) {
    Object.assign(this, { host, workspace, instanceId, read, send, open, doc });
    this.answer = null; this.leaving = new Set();
    this.status = el(doc, 'p', { className: 'notice', hidden: true });
    this.status.setAttribute('role', 'status');
    this.finder = new Finder({ doc, id: 'uses-tool', button: '+ Uses a tool', label: 'Find a tool this outcome uses', placeholder: 'Find a tool',
      nothing: 'No other tool to add.', choices: async () => (await this.fresh()).offer, choose: tool => this.use(tool.tool_id, true) });
  }
  async fresh() { this.answer = checkTools(await this.read('tools', { workspace_id: this.workspace }), this.instanceId, this.workspace); return this.answer; }
  async load() {
    try { await this.fresh(); this.paint(); return true; }
    catch (error) {
      // The section keeps what it showed; it says why it could not read.
      this.say(error.message || FAILED);
      if (!this.answer) { this.host.replaceChildren(this.heading(), this.status); this.host.hidden = false; }
      return false;
    }
  }
  say(text) { this.status.textContent = text; this.status.hidden = !text; }
  // Headed as the outcome page's other sections are.
  heading() { return el(this.doc, 'div', { className: 'rail-heading' }, el(this.doc, 'h2', { id: 'tools-heading', textContent: 'Skills and tools' })); }
  async use(toolId, used) {
    await sent(this.send('tool.use', { workspace_id: this.workspace }, { tool_id: toolId, used }));
    this.say('');
    await this.load();
  }
  async leave(item) {
    this.leaving.add(item.tool_id); this.paint();
    try { await this.use(item.tool_id, false); }
    catch (error) { this.say(error.message || NOT_SAVED); }
    finally {
      this.leaving.delete(item.tool_id); this.paint();
      const again = this.host.querySelector(`[data-focus-key="${CSS.escape(`unuse:${item.tool_id}`)}"]`);
      if (!this.host.contains(this.doc.activeElement)) (again ?? (this.host.contains(this.finder.button) ? this.finder.button : null))?.focus();
    }
  }
  paint() {
    const doc = this.doc, answer = this.answer;
    if (same(this, answer, [...this.leaving])) return;
    const shown = answer.own.length || answer.used.length || answer.reader_may_use;
    if (!shown) { this.host.hidden = true; this.host.replaceChildren(); return; }
    const own = answer.own.length ? el(doc, 'ul', { className: 'tool-rows' }, ...answer.own.map(item => row(doc, item, this.open))) : null;
    const used = answer.used.length ? [el(doc, 'h3', { textContent: 'Used here' }), el(doc, 'ul', { className: 'tool-rows' }, ...answer.used.map(item => {
      const off = answer.reader_may_use ? glyph(doc, '×', `This outcome no longer uses ${item.name}`, () => this.leave(item)) : null;
      if (off) { off.setAttribute('data-focus-key', `unuse:${item.tool_id}`); off.disabled = this.leaving.has(item.tool_id); }
      return row(doc, item, this.open, off);
    }))] : [];
    // Only what there is: a null handed to replaceChildren would be drawn as the word "null".
    keepFocus(this.host, () => this.host.replaceChildren(...[this.heading(), this.status, own, ...used,
      answer.reader_may_use ? this.finder.node : null].filter(Boolean)), doc);
    this.host.hidden = false;
  }
}

// The outcome rail's "Skills and tools": the same tools, names only, each
// opening its page. Hidden when there are none.
export class ToolsRail {
  constructor({ section, host, workspace, instanceId, read, open, current = null, doc = host.ownerDocument }) {
    Object.assign(this, { section, host, workspace, instanceId, read, open, current, doc });
  }
  async load() {
    try {
      const answer = checkTools(await this.read('tools', { workspace_id: this.workspace }), this.instanceId, this.workspace);
      const items = [...answer.own, ...answer.used];
      this.host.replaceChildren(...items.map(item => {
        const link = placeLink(this.doc, toolHref(item.home.workspace_id, item.tool_id), item.name,
          () => this.open({ kind: 'tool', id: item.home.workspace_id, tool: item.tool_id }, item.name), 'nav-item');
        if (item.tool_id === this.current) link.setAttribute('aria-current', 'page');
        return link;
      }));
      this.section.hidden = !items.length;
      return true;
    } catch {
      // A rail section that cannot be read keeps what it showed.
      return false;
    }
  }
}

// Topic settings' "Tools this topic improves": the home outcome's tools as
// chips, and any tool linked from elsewhere so it can be taken off. A tap
// links, a second tap unlinks, saved at once.
export class TopicTools {
  constructor({ host, topicId, instanceId, read, send, doc = host.ownerDocument }) {
    Object.assign(this, { host, topicId, instanceId, read, send, doc });
    this.answer = null; this.pending = new Set();
    this.notice = el(doc, 'p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
  }
  async load() {
    try {
      this.answer = checkTopicTools(await this.read('topic_tools', { topic_id: this.topicId }), this.instanceId, this.topicId);
      this.paint();
      return true;
    } catch {
      return false;
    }
  }
  chips() {
    const linked = new Map(this.answer.linked.map(tool => [tool.tool_id, tool]));
    const offered = this.answer.reader_may_link ? this.answer.offered : [];
    const shown = [...offered.map(tool => ({ ...tool, linked: linked.has(tool.tool_id) }))];
    for (const tool of this.answer.linked) if (!offered.some(other => other.tool_id === tool.tool_id)) shown.push({ ...tool, linked: true });
    return shown;
  }
  paint() {
    const doc = this.doc, chips = this.chips();
    if (same(this, chips, [...this.pending])) return;
    if (!chips.length) { this.host.hidden = true; this.host.replaceChildren(); return; }
    const group = el(doc, 'div', { className: 'state-chips tool-chips' }, ...chips.map(tool => {
      const chip = el(doc, 'button', { type: 'button', className: 'choice-chip tool-chip', textContent: tool.name });
      chip.setAttribute('data-focus-key', `tool:${tool.tool_id}`);
      chip.setAttribute('aria-pressed', String(tool.linked));
      chip.title = tool.linked ? `Take this topic off ${tool.name}` : `This topic improves ${tool.name}`;
      // aria-disabled, not disabled, while it saves: the chip keeps the focus for the next tap.
      chip.setAttribute('aria-disabled', String(this.pending.has(tool.tool_id)));
      chip.onclick = () => { if (!this.pending.has(tool.tool_id)) this.toggle(tool); };
      return chip;
    }));
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', 'topic-tools-heading');
    keepFocus(this.host, () => this.host.replaceChildren(el(doc, 'h3', { id: 'topic-tools-heading', textContent: 'Tools this topic improves' }), group, this.notice), doc);
    this.host.hidden = false;
  }
  async toggle(tool) {
    const linked = !tool.linked;
    this.pending.add(tool.tool_id);
    // Shown at once; the server's answer settles it.
    const was = this.answer;
    this.answer = { ...was, linked: linked ? [...was.linked, tool] : was.linked.filter(other => other.tool_id !== tool.tool_id) };
    this.paint();
    try { await sent(this.send('tool.link', { topic_id: this.topicId }, { tool_id: tool.tool_id, linked })); this.notice.hidden = true; }
    catch (error) { this.answer = was; this.notice.textContent = error.message || NOT_SAVED; this.notice.hidden = false; }
    finally { this.pending.delete(tool.tool_id); this.paint(); await this.load(); }
  }
}
