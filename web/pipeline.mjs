// The pipeline page, an item's record, the steer menu, the one-line add at the top
// of each section with words and size set on the item in place, Change stages,
// and the rail's Pipeline row (item 84; docs/pipeline.md). Every word comes
// from pipeline-words.mjs; every fact from the `pipeline`, `pipeline_item` and
// `pipeline_row` views. The page reads its views again on every commit and
// keeps the reader's open groups, open menu and focus.
import { agentColor } from './author-colors.mjs';
import { clock, datedTime, shownTime } from './times.mjs';
import { workNote } from './topic-state.mjs';
import {
  EMPTY_WORDS, SIZE_WORDS, checkPipeline, duration, eventWords, factBoxes, gatheringWords, glyphWords, historyLine, listWords,
  pieceTopicWords, placedWords, raisedWords, sentenceName, sourceRuns, stageLine, typicalCell, typicalWords, waitingWords, waitsWords,
} from './pipeline-words.mjs';

export const pipelineHref = (workspace, item) => '?' + new URLSearchParams(item === undefined ? { pipeline: workspace } : { pipeline: workspace, item: String(item) });
const topicHref = id => '?' + new URLSearchParams({ topic: id });

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}
const time = (ms, now) => el('time', { datetime: new Date(ms).toISOString(), title: datedTime(ms), 'data-ms': String(ms), text: shownTime(ms, now) });

// A person or agent as the page names them: "you" in black, an agent in its colour.
function who(id, reader) {
  if (id === reader) return el('span', { class: 'pl-who you', text: 'you' });
  return el('span', { class: `pl-who agent-${safeColor(id)}`, text: id });
}
function safeColor(id) { try { return agentColor(id); } catch { return 'olive'; } }

const SECTION_ORDER = ['now', 'next', 'later', 'candidates'];

export class PipelinePage {
  constructor({ host, header, reader, instanceId, workspace, item = null, read, send }) {
    Object.assign(this, { host, header, reader, instanceId, workspace, itemNumber: item, read, send });
    this.open = new Set(); this.closed = new Set(); this.menu = null; this.confirming = null; this.errors = new Map();
    this.answer = null; this.serial = 0; this.editing = false; this.chain = Promise.resolve();
    // The one-line add's text per section, the words being written per item, the
    // item whose words and size are open, and what was just added.
    this.addDrafts = {}; this.wordDrafts = new Map(); this.details = null; this.added = null; this.savedWords = null;
    // Change stages in place: what is being typed per stage line ("<stage>:<field>"),
    // the new stage's line, the quiet note per stage, and the stage just removed (for Undo).
    this.stageDrafts = new Map(); this.newStage = ''; this.stageNote = null; this.removed = null;
    // The pipeline's own settings in place (the owner's): the title being typed, and the quiet note.
    this.titleDraft = null; this.titleField = null; this.settingsNote = null;
    host.addEventListener('toggle', event => {
      const key = event.target?.dataset?.key; if (!key) return;
      if (event.target.open) { this.open.add(key); this.closed.delete(key); } else { this.open.delete(key); this.closed.add(key); }
    }, true);
    host.addEventListener('keydown', event => this.keydown(event));
    document.addEventListener('click', event => { if (this.menu !== null && !event.target.closest?.('.pl-menu,.pl-steer')) { this.menu = null; this.paint(); } });
  }

  async readAll(section) {
    let cursor = 0, items = [], groups = [], first = null;
    for (;;) {
      const answer = checkPipeline(await this.read('pipeline', { workspace_id: this.workspace, section, ...(cursor ? { cursor } : {}), limit: 100 }), this.instanceId);
      first ??= answer;
      items = items.concat(answer.items ?? []); groups = groups.concat(answer.groups ?? []);
      if (answer.next_cursor === null || answer.next_cursor === undefined) break;
      cursor = answer.next_cursor;
    }
    return { ...first, items, groups };
  }

  async load() {
    const serial = ++this.serial;
    if (this.itemNumber !== null) {
      const answer = await this.read('pipeline_item', { workspace_id: this.workspace, number: this.itemNumber });
      if (answer?.error) throw Error(answer.error.message);
      if (serial !== this.serial) return true;
      this.record = answer; this.paint(); return true;
    }
    const head = await this.readAll('now');
    if (head.pipeline === null) { if (serial === this.serial) { this.answer = head; this.paint(); } return true; }
    const [next, later, candidates, dropped, shipped] = await Promise.all(['next', 'later', 'candidates', 'dropped', 'shipped'].map(section => this.readAll(section)));
    if (serial !== this.serial) return true;
    this.answer = { ...head, sections: { now: head.items, next: next.items, later: later.items, candidates: candidates.items, dropped: dropped.items }, groups: shipped.groups };
    this.paint();
    return true;
  }

  // ---- painting ----------------------------------------------------------------

  paint() {
    const active = document.activeElement;
    const focused = active?.closest?.('[data-key]')?.dataset.key;
    const focusedRole = active?.dataset?.role;
    const caret = isField(active) ? [active.selectionStart, active.selectionEnd] : null;
    const now = clock.now();
    if (this.itemNumber !== null) this.paintRecord(now);
    else this.paintPage(now);
    // The 98 rule: what had focus keeps it, so a reload never moves the reader.
    if (focused) {
      const row = this.host.querySelector(`[data-key="${CSS.escape(focused)}"]`);
      const target = row && (focusedRole ? row.querySelector(`[data-role="${CSS.escape(focusedRole)}"]`) : null) || row?.querySelector('a,button');
      target?.focus({ preventScroll: true });
      // What is being typed keeps its caret: a repaint never moves it.
      if (caret && isField(target)) try { target.setSelectionRange(...caret); } catch { /* a field with no caret */ }
    }
  }

  // With `inPlace` (the owner's pipeline), the title is a line edited where it stands.
  paintHeader(eyebrow, title, description, inPlace = null) {
    this.header.eyebrow.textContent = eyebrow; this.header.description.textContent = description;
    if (inPlace) this.titleInPlace(inPlace); else this.header.title.textContent = title;
    document.title = `${title} · Theseus`;
  }

  paintPage(now) {
    const answer = this.answer, pipeline = answer.pipeline;
    const page = [];
    if (!pipeline || !pipeline.enabled) {
      this.paintHeader(answer.workspace_title ?? '', pipeline?.title ?? 'Pipeline', 'This outcome’s pipeline is off.');
      page.push(this.turnOn(pipeline));
      this.host.replaceChildren(...page);
      return;
    }
    const sized = pipeline.sized;
    this.paintHeader(answer.workspace_title, pipeline.title, sized
      ? `Every feature and fix by number. As of ${shownTime(now, now)}, from what Theseus has seen happen.`
      : `Every ${pipeline.unit_one} being prepared, by stage. As of ${shownTime(now, now)}, from what Theseus has seen happen.`, pipeline.you_own ? pipeline : null);
    if (pipeline.you_own) page.push(this.settingsLine(pipeline));
    const sections = answer.sections, any = SECTION_ORDER.some(name => sections[name].length) || answer.groups.some(group => group.items.length);
    if (answer.waiting?.length) {
      page.push(el('section', { class: 'waiting-on-you', 'aria-label': 'Waiting on you' }, el('h2', { text: `Waiting on you (${answer.waiting.length})` }),
        el('ul', { class: 'waiting-list' }, ...answer.waiting.map(row => el('li', {}, el('a', { href: topicHref(row.topic_id), text: row.topic_title }),
          el('span', { class: 'muted', text: waitingWords(row, now) }))))));
    }
    if (answer.banner) {
      const banner = answer.banner;
      page.push(el('div', { class: 'pl-banner', role: 'status' }, el('strong', { text: `Release ${banner.release} is live, deployed ${shownTime(banner.deployed_ms, now)}.` }),
        el('span', { class: 'muted', text: banner.items.length ? `It shipped ${listWords(banner.items)}. They moved to Shipped from the deploy’s release record.` : 'Its record names no items.' })));
    }
    page.push(el('div', { class: 'pl-facts' }, ...factBoxes(answer, now).map(([label, value, sub]) =>
      el('div', { class: 'pl-fact-box' }, el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }), sub ? el('span', { class: 'muted', text: sub }) : null))));
    if (!any) page.push(el('div', { class: 'pl-empty' }, el('p', {}, el('strong', { text: EMPTY_WORDS[0] })), el('p', { text: EMPTY_WORDS[1] }), el('p', { class: 'muted', text: EMPTY_WORDS[2] })));
    const words = pipeline.section_words ?? {};
    const byNumber = new Map(SECTION_ORDER.flatMap(name => sections[name]).map(item => [item.number, item]));
    if (answer.release_piece) {
      const piece = answer.release_piece;
      page.push(section('Next release', null, el('article', { class: 'pl-item', 'aria-label': `Release ${piece.release_number}`, 'data-key': `piece:${piece.id}` },
        el('div', { class: 'pl-head' }, glyph('building'), el('span', { class: 'pl-title', text: `Release ${piece.release_number}, being put together` })),
        el('p', { class: 'pl-meta', text: `${piece.items.length} item${piece.items.length === 1 ? '' : 's'}, combined from their approved pieces:` }),
        el('ul', { class: 'pl-meta pl-release-items' }, ...piece.items.map(number => el('li', {}, el('span', { class: 'pl-num', text: String(number) }), ' ',
          el('a', { href: pipelineHref(this.workspace, number), text: piece.titles?.[String(number)] ?? byNumber.get(number)?.title ?? '' }),
          ...(byNumber.get(number) ? this.origin(byNumber.get(number)) : [])))),
        this.stageBox(piece, pipeline, now, false))));
    }
    // Now: the pieces being built, then what is planned and not started.
    const pieces = answer.pieces ?? [];
    const inPiece = new Set(pieces.flatMap(piece => piece.items).concat(answer.release_piece?.items ?? []));
    const nowRows = sections.now.filter(item => !inPiece.has(item.number));
    // Each section opens with its one line: a title and Return adds an item there.
    page.push(section(words.now ?? 'Now', sized ? 'Being built, and what is planned for this release.' : 'Being prepared, soonest first.',
      this.addLine(pipeline, 'now'),
      ...pieces.map((piece, index) => this.pieceCard(piece, byNumber, pipeline, now, index === 0)),
      nowRows.length && pieces.length ? el('p', { class: 'muted pl-planned', text: 'Planned for this release, not started yet' }) : null,
      nowRows.length ? this.rows(nowRows, pipeline, now) : null));
    const coordinator = pipeline.coordinator ? sentenceName(pipeline.coordinator === this.reader ? 'you' : pipeline.coordinator) : 'The owner';
    page.push(section(words.next ?? 'Next', sized ? `The release after Now. ${coordinator} order${pipeline.coordinator === this.reader ? '' : 's'} it; steer with ⋯.` : 'Not started; steer with ⋯.',
      this.addLine(pipeline, 'next'), sections.next.length ? this.rows(sections.next, pipeline, now) : null));
    page.push(section(words.later ?? 'Later', null, this.addLine(pipeline, 'later'), sections.later.length ? this.rows(sections.later, pipeline, now) : null));
    const groups = [...new Set(sections.candidates.map(item => item.candidate_group))];
    page.push(section(words.candidates ?? 'Candidates', 'Not ordered yet.', this.addLine(pipeline, 'candidates'), ...groups.map(group => {
      const items = sections.candidates.filter(item => item.candidate_group === group);
      const key = `group:${group}`;
      const asked = items.some(item => item.glyph === 'decide');
      return el('details', { class: 'pl-group', 'data-key': key, open: this.open.has(key) || (asked && !this.closed.has(key)) },
        el('summary', {}, sentenceName(group || 'Ungrouped'), el('span', { class: 'muted', text: ` · ${items.length}` })), this.rows(items, pipeline, now));
    })));
    page.push(this.stagesSection(pipeline));
    page.push(this.timesSection(answer, pipeline));
    page.push(this.shippedSection(answer, pipeline, now));
    if (sections.dropped.length) page.push(section('Dropped', 'Kept with its number, so it can come back.', this.rows(sections.dropped, pipeline, now, { dropped: true })));
    this.host.replaceChildren(...page);
  }

  pieceCard(piece, byNumber, pipeline, now, first) {
    const card = el('article', { class: 'pl-item', 'data-key': `piece:${piece.id}`, 'aria-label': `Item${piece.items.length > 1 ? 's' : ''} ${listWords(piece.items)}` });
    piece.items.forEach((number, index) => {
      const known = byNumber.get(number);
      const item = known ?? { number, title: piece.titles?.[String(number)] ?? '', glyph: 'building', sources: null, raised_by: null, raised_note: '', size: null, asks: [] };
      const ring = index === 0 && piece.topic?.work?.observed
        ? el('span', { class: 'topic-work', 'aria-hidden': 'true', title: workNote(piece.topic.work, this.reader) }) : null;
      // Each item being built keeps its own ⋯ (9.1.3, D3): Open its record, and Drop…, which asks first.
      const key = `item:${number}`;
      const lines = el('div', { class: 'pl-piece-item', 'data-key': key, 'data-number': String(number) },
        this.head(item, item.glyph === 'decide' ? 'decide' : 'building', ring), this.meta(item, pipeline, now), ...this.origin(item));
      if (this.confirming === number) lines.append(this.dropConfirm(item));
      if (this.errors.get(key)) lines.append(el('p', { class: 'pl-error', role: 'status', text: this.errors.get(key) }));
      if (known && pipeline.you_steer) lines.append(...this.steer(item, [item], 0, pipeline, { underway: true }));
      card.append(lines);
    });
    if (piece.topic) {
      const words = pieceTopicWords(piece, now);
      card.append(el('p', { class: 'pl-meta' }, 'Topic: ', el('a', { href: topicHref(piece.topic.id), text: piece.topic.title }), words.together, words.activity));
    }
    card.append(this.stageBox(piece, pipeline, now, first));
    return card;
  }

  stageBox(piece, pipeline, now, openHistory) {
    const box = el('div', { class: 'pl-stagebox' });
    const stage = piece.stage;
    if (!stage) return box;
    const chips = [
      ...piece.stages_so_far.map(entry => ['done', `${entry.name} · ${duration(entry.left_ms - entry.entered_ms)}`, `${datedTime(entry.entered_ms)} to ${datedTime(entry.left_ms)}`]),
      ['now', stage.name, `Now, since ${datedTime(stage.entered_ms)}`],
      ...piece.ahead.map(name => ['ahead', name, 'Not reached yet']),
    ];
    box.append(el('ol', { class: 'pl-stages', 'aria-label': 'Stages' }, ...chips.map(([kind, words, title], index) => el('li', {},
      el('span', { class: `pl-chip ${kind}`, title, 'aria-current': kind === 'now' ? 'step' : null, text: words }),
      index < chips.length - 1 ? el('span', { class: 'pl-sep', 'aria-hidden': 'true', text: '›' }) : null))));
    const line = stageLine(stage, now);
    const current = el('p', { class: 'pl-current' }, el('strong', { text: line.name }), ` ${line.since} · ${line.soFar}`);
    if (stage.note) current.append(el('span', { class: 'muted', text: stage.note }));
    if (stage.owner_gate) {
      if (stage.you_leave_it) {
        current.append(el('span', { class: 'pl-gate-you', text: `Waiting on you: ${stage.gate_words || 'say when this stage is done.'}` }));
        const next = piece.ahead_ids?.[0];
        current.append(el('span', {}, el('button', { type: 'button', 'data-role': 'leave', text: 'Done with this stage',
          onclick: () => this.act(`piece:${piece.id}`, () => next
            ? this.command('pipeline.stage_enter', { piece_id: piece.id }, { stage_id: next, round: 1, left_outcome: 'passed' }, { piece_revision: piece.version })
            : this.command('pipeline.piece_finish', { piece_id: piece.id }, {}, { piece_revision: piece.version })) })));
      } else current.append(el('span', { class: 'muted', text: `Waiting on ${pipeline.owner}` }));
    } else if (stage.gate_words) current.append(el('span', { class: 'muted', text: stage.gate_words }));
    if (stage.gate_checks?.length) current.append(el('span', { class: 'muted', text: `Checked by: ${listWords(stage.gate_checks)}. Checks become records with the outcome's checks; until then the gate is shown, not enforced.` }));
    const typical = typicalWords(stage.typical, { size: piece.size, unitMany: pipeline.unit_many });
    if (typical) current.append(el('span', { class: 'muted', text: typical }));
    box.append(current);
    if (piece.stages_so_far.length) {
      const key = `history:${piece.id}`;
      box.append(el('details', { class: 'pl-history', 'data-key': key, open: this.open.has(key) || (openHistory && !this.closed.has(key)) },
        el('summary', { text: 'Stages so far' }),
        el('ol', {}, ...piece.stages_so_far.map(entry => el('li', { text: historyLine(entry, now) })), el('li', { text: `${stage.name}: since ${shownTime(stage.entered_ms, now)}` }))));
    }
    const error = this.errors.get(`piece:${piece.id}`);
    if (error) box.append(el('p', { class: 'pl-error', role: 'status', text: error }));
    return box;
  }

  head(item, glyphKind, extra) {
    const words = el('span', { class: 'pl-words' }, el('a', { class: 'pl-title', href: pipelineHref(this.workspace, item.number), title: item.description || null, text: item.title }));
    if (glyphKind === 'decide' || item.glyph === 'decide') words.append(el('span', { class: 'topic-state mine', 'data-state': 'waiting', text: 'Waiting on you' }));
    if (extra) words.append('⁠', extra);
    return el('div', { class: 'pl-head' }, glyph(glyphKind ?? item.glyph), el('span', { class: 'pl-num', text: String(item.number) }), words);
  }

  meta(item, pipeline, now, more = []) {
    const raised = raisedWords(item);
    const parts = [];
    if (pipeline.sized && item.size) parts.push(`${SIZE_WORDS[item.size]} · `);
    parts.push(raised.prefix);
    if (raised.who) parts.push(who(raised.who, this.reader));
    return el('p', { class: 'pl-meta' }, ...parts, waitsWords(item.needs), ...more);
  }

  origin(item) {
    if (!item.sources) return [];
    const runs = sourceRuns(item.sources, this.reader);
    const linked = runs.parts.map(part => part.message ? el('a', { href: topicHref(part.message.topic_id), title: `Open ${part.message.topic_title}`, text: part.text }) : part.text);
    const nodes = [];
    if (!runs.parts.length) return nodes;
    if (!runs.folds) nodes.push(el('p', { class: 'pl-origin' }, el('span', { class: 'sr-only', text: 'Where this came from: ' }), 'From ', ...linked));
    else {
      const key = `origin:${item.number}`;
      nodes.push(el('details', { class: 'pl-origin', 'data-key': key, open: this.open.has(key) },
        el('summary', {}, el('span', { class: 'sr-only', text: 'Where this came from: ' }), runs.summary),
        el('p', {}, el('strong', { text: 'Where this came from: ' }), ...linked, runs.more > 0 ? ` and ${runs.more} more in its record` : '')));
    }
    const gathering = gatheringWords(item.gathering, this.reader);
    if (gathering) nodes.push(el('p', { class: 'pl-origin pl-maturing' }, gathering.lead,
      gathering.link ? (item.gathering.topic_id ? el('a', { href: topicHref(item.gathering.topic_id), text: gathering.link }) : gathering.link) : null, gathering.mine ? ' (you)' : '', gathering.after));
    return nodes;
  }

  rows(items, pipeline, now, { dropped = false } = {}) {
    return el('ul', { class: 'pl-rows' + (dropped ? ' pl-dropped' : '') }, ...items.map((item, index) => this.row(item, items, index, pipeline, now)));
  }

  row(item, list, index, pipeline, now) {
    const key = `item:${item.number}`;
    const placed = placedWords(item.placed, this.reader, pipeline.section_words, now);
    const moved = item.placed?.kind === 'moved' && !item.placed.undo_of && item.section !== 'dropped' && (now - item.placed.ms) < 24 * 3600 * 1000;
    const li = el('li', { class: 'pl-row' + (moved ? ' moved' : ''), 'data-key': key, 'data-number': String(item.number) });
    const more = [];
    for (const ask of item.asks ?? []) more.push(` · ${ask.by} asked you, since ${shownTime(ask.since_ms, now)}`);
    const stageWords = item.stage ? [' · ', `${item.stage.name} since ${shownTime(item.stage.entered_ms, now)}`] : [];
    const body = el('div', { class: 'pl-body' }, this.head(item), this.meta(item, pipeline, now, [...more, ...stageWords]), ...this.origin(item));
    for (const ask of item.asks ?? []) body.append(el('p', { class: 'pl-note' }, `“${ask.excerpt}” In `, el('a', { href: topicHref(ask.topic_id), text: ask.topic_title }), '.'));
    if (placed && (now - item.placed.ms) < 7 * 24 * 3600 * 1000) {
      const undo = item.placed.by === this.reader && !item.placed.undo_of
        ? el('button', { type: 'button', 'data-role': 'undo', text: item.section === 'dropped' ? 'Restore' : 'Undo',
          onclick: () => this.act(key, () => this.command('pipeline.item_move', { workspace_id: this.workspace, number: item.number }, { undo_of: item.placed.event }, { item_revision: item.version })) })
        : null;
      body.append(el('p', { class: 'pl-note' }, placed, undo));
    } else if (item.section === 'dropped' && item.dropped && pipeline.you_steer) {
      body.append(el('p', { class: 'pl-note' }, el('button', { type: 'button', 'data-role': 'undo', text: 'Restore',
        onclick: () => this.act(key, () => this.command('pipeline.item_move', { workspace_id: this.workspace, number: item.number }, { undo_of: item.dropped.event }, { item_revision: item.version })) })));
    }
    if (this.confirming === item.number) body.append(this.dropConfirm(item));
    const editable = item.section !== 'dropped' && item.glyph !== 'shipped';
    if (editable && this.details === item.number) body.append(this.detailsPanel(item, pipeline));
    const error = this.errors.get(key);
    if (error) body.append(el('p', { class: 'pl-error', role: 'status', text: error }));
    li.append(body);
    if (editable) li.append(el('button', { type: 'button', class: 'pl-edit', 'data-role': 'details', 'aria-expanded': this.details === item.number ? 'true' : 'false',
      'aria-label': `${this.details === item.number ? 'Close details' : 'Details'} of ${item.number}`, text: this.details === item.number ? 'Close' : 'Details', onclick: () => this.toggleDetails(item.number) }));
    if (pipeline.you_steer && item.section !== 'dropped' && item.glyph !== 'shipped') li.append(...this.steer(item, list, index, pipeline));
    return li;
  }

  // Drop… on an item being built asks first (D3): Drop it, or Keep it, which changes nothing.
  dropConfirm(item) {
    const key = `item:${item.number}`;
    return el('p', { class: 'pl-confirm', role: 'alert' }, `Drop ${item.number}? It is being built now, so this stops work under way. `,
      el('button', { type: 'button', 'data-role': 'drop-confirm', text: 'Drop it', onclick: () => { this.confirming = null; this.act(key, () => this.move(item, { section: 'dropped', underway_confirmed: true })); } }),
      el('button', { type: 'button', 'data-role': 'drop-keep', text: 'Keep it', onclick: () => { this.confirming = null; this.paint(); this.host.querySelector(`[data-key="${key}"] [data-role="steer"]`)?.focus(); } }));
  }

  // The ⋯ button and, while it is open, its menu.
  steer(item, list, index, pipeline, { underway = false } = {}) {
    const key = `item:${item.number}`;
    const button = el('button', { type: 'button', class: 'pl-steer', 'data-role': 'steer', 'aria-label': `Steer ${item.number}`, 'aria-haspopup': 'menu',
      'aria-expanded': this.menu === item.number ? 'true' : 'false', text: '⋯',
      onclick: () => { this.menu = this.menu === item.number ? null : item.number; this.paint(); this.host.querySelector(`[data-key="${key}"] .pl-menu button`)?.focus(); } });
    return this.menu === item.number ? [button, this.steerMenu(item, list, index, pipeline, underway)] : [button];
  }

  // An item being built (`underway`) is not ordered or moved from here: its menu is Open its record and Drop….
  steerMenu(item, list, index, pipeline, underway = false) {
    const words = pipeline.section_words ?? {};
    const button = (label, keys, action) => el('button', { type: 'button', role: 'menuitem', onclick: () => { this.menu = null; action(); } },
      el('span', { text: label }), keys ? el('kbd', { text: keys }) : null);
    const key = `item:${item.number}`;
    const up = index > 0 ? list[index - 1] : null, down = index < list.length - 1 ? list[index + 1] : null;
    const menu = el('div', { class: 'pl-menu', role: 'menu', 'aria-label': `Steer ${item.number}` });
    if (!underway) {
      if (up) menu.append(button('Move up', '⌘↑', () => this.act(key, () => this.move(item, { above: up.number }))));
      if (down) menu.append(button('Move down', '⌘↓', () => this.act(key, () => this.move(item, { below: down.number }))));
      menu.append(el('hr'));
      for (const name of SECTION_ORDER) if (name !== item.section) menu.append(button(`Move to ${words[name] ?? name}`, null, () => this.act(key, () => this.move(item, { section: name }))));
      menu.append(el('hr'));
    }
    menu.append(button('Open its record', null, () => location.assign(pipelineHref(this.workspace, item.number))));
    menu.append(button('Drop…', null, () => {
      if (item.stage) { this.confirming = item.number; this.paint(); this.host.querySelector(`[data-key="${key}"] [data-role="drop-keep"]`)?.focus(); }
      else this.act(key, () => this.move(item, { section: 'dropped' }));
    }));
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.menu = null; this.paint(); this.host.querySelector(`[data-key="${key}"] .pl-steer`)?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const buttons = [...menu.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
        buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); event.preventDefault();
      }
    });
    return menu;
  }

  keydown(event) {
    if (!(event.metaKey || event.ctrlKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const row = event.target.closest?.('.pl-row'); if (!row || !this.answer?.pipeline?.you_steer) return;
    const list = [...row.parentElement.children], index = list.indexOf(row);
    const other = list[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!other) return;
    event.preventDefault();
    const number = Number(row.dataset.number), item = this.findItem(number);
    if (!item) return;
    this.act(`item:${number}`, () => this.move(item, event.key === 'ArrowUp' ? { above: Number(other.dataset.number) } : { below: Number(other.dataset.number) }));
  }

  findItem(number) {
    for (const items of Object.values(this.answer?.sections ?? {})) { const found = items.find(item => item.number === number); if (found) return found; }
    return null;
  }

  move(item, args) {
    if (args.section === 'candidates' && item.section !== 'candidates') args.candidate_group = '';
    return this.command('pipeline.item_move', { workspace_id: this.workspace, number: item.number }, args, { item_revision: item.version });
  }

  // The item as this page last read it: a row of the page, or the record's own item.
  current(number) {
    return this.itemNumber !== null ? (this.record?.item?.number === number ? this.record.item : null) : this.findItem(number);
  }

  // An edit on the item as last read; the acts run one after another, so each reads the revision the last one left.
  edit(number, args) {
    const item = this.current(number);
    if (!item) throw Error(`${number} moved since this page read it. It is shown where it is now.`);
    return this.command('pipeline.item_edit', { workspace_id: this.workspace, number }, args, { item_revision: item.version });
  }

  async command(kind, target, args, expected = {}) {
    const receipt = await this.send(kind, target, args, expected);
    if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'Theseus did not confirm this change.');
    return receipt.result;
  }

  // An act from the page: its refusal shows in plain words under the row and keeps focus there.
  // Acts run one at a time. `role` names the control that takes focus after; false leaves
  // focus where the reader put it (the repaint keeps it).
  act(key, action, role = null) {
    const run = async () => {
      this.errors.delete(key);
      try { await action(); await this.load(); }
      // A refusal says why under its row, and the page reads again, so what it shows is how things stand now.
      catch (error) { this.errors.set(key, error.message); try { await this.load(); } catch { this.paint(); } }
      if (role === false) return;
      const scope = `[data-key="${CSS.escape(key)}"]`;
      const target = (role ? this.host.querySelector(`${scope} [data-role="${CSS.escape(role)}"]`) : null) ?? this.host.querySelector(`${scope} a, ${scope} button`);
      target?.focus({ preventScroll: true });
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  stagesSection(pipeline) {
    const steer = pipeline.you_steer, editing = steer && this.editing;
    const list = editing ? this.stageLines(pipeline) : el('ol', { class: 'pl-stagedefs' }, ...pipeline.stages.map((stage, index) => el('li', {},
      el('span', { class: 'pl-num', text: String(index + 1) }),
      el('div', {}, el('p', {}, el('strong', { text: stage.name }), stage.done_when ? `: ${stage.done_when}` : ''),
        el('p', { class: 'muted', text: [gateWords(stage, pipeline.owner), stage.added_note].filter(Boolean).join(' ') })))));
    const foot = el('p', { class: 'muted pl-stagedefs-foot' }, 'A change to the stages applies to items that enter a stage after it; past times stay with the stage they were measured in. ',
      steer ? el('button', { type: 'button', 'data-role': 'edit-stages', 'aria-expanded': editing ? 'true' : 'false', text: editing ? 'Done' : 'Change stages',
        onclick: () => { this.editing = !this.editing; this.removed = null; this.stageNote = null; this.paint(); } }) : null);
    const key = 'stages';
    const details = el('details', { class: 'pl-group pl-stages-group', 'data-key': key, open: this.open.has(key) || editing || (!pipeline.ships_in_releases && !this.closed.has(key)) },
      el('summary', {}, 'Stages', el('span', { class: 'muted', text: ` · ${pipeline.stages.length}` })),
      el('p', { class: 'muted', text: editing ? 'Each change saves as you make it: a name or line on Return or when you click away, a chip when you tap it.' : 'This outcome’s own stages, in order. Every item passes through each one.' }),
      list, foot);
    return el('section', { class: 'pl-section', 'aria-label': 'Stages' }, details);
  }

  // Change stages (the form rule): each stage is its own line, edited where it stands.
  // Its name and done-when save on Return or blur, Rounds is three chips and the
  // owner's word one chip, each saved on its tap; a new stage is one line.
  stageLines(pipeline) {
    const stages = pipeline.stages, owner = sentenceName(pipeline.owner === this.reader ? 'you' : pipeline.owner);
    const list = el('ol', { class: 'pl-stagedefs pl-stage-lines', 'aria-label': 'Change stages' }, ...stages.map((stage, index) => {
      const id = stage.stage_id, key = `stage:${id}`, name = stage.name || `stage ${index + 1}`;
      const chip = (role, words, pressed, title, change) => el('button', { type: 'button', class: 'pl-pick', 'data-role': role, 'aria-pressed': pressed ? 'true' : 'false', title, text: words,
        onclick: () => { if (change) this.stageAct(id, change, role); } });
      const move = (role, words, label, change) => el('button', { type: 'button', class: 'pl-stage-move', 'data-role': role, 'aria-label': label, title: label, text: words,
        onclick: () => this.stageAct(id, change, role) });
      const note = this.stageNote?.id === id ? el('p', { class: 'pl-stage-note muted', role: 'status', text: this.stageNote.text }) : null;
      const error = this.errors.get(key);
      return el('li', { 'data-key': key },
        el('span', { class: 'pl-num', text: String(index + 1) }),
        el('div', { class: 'pl-stage-edit' },
          el('div', { class: 'pl-stage-line' },
            this.stageField(stage, 'name', { 'aria-label': `Name of stage ${index + 1}`, placeholder: 'Stage name', maxlength: '200' }),
            this.stageField(stage, 'done', { 'aria-label': `When ${name} is done`, placeholder: 'Done when…', maxlength: '2000' })),
          el('div', { class: 'pl-stage-line' },
            el('span', { class: 'pl-picks', role: 'group', 'aria-label': `Rounds in ${name}` }, el('span', { class: 'muted', 'aria-hidden': 'true', text: 'Rounds' }),
              ...ROUND_CHIPS.map(([value, words, title]) => chip(`rounds-${value}`, words, stage.rounds === value, title,
                stage.rounds === value ? null : list => { stageIn(list, id).rounds = value; }))),
            chip('gate-owner', `${owner === 'You' ? 'Your' : `${owner}’s`} word`, !!stage.gate?.owner,
              stage.gate?.owner ? `Only ${owner === 'You' ? 'you move' : `${owner} moves`} an item past this stage. Tap to let it pass without.` : `Tap so that only ${owner === 'You' ? 'you move' : `${owner} moves`} an item past this stage.`,
              list => { const gate = stageIn(list, id).gate; gate.owner = !gate.owner; }),
            this.stageField(stage, 'checks', { 'aria-label': `Who or what checks ${name}`, placeholder: 'Checked by…', maxlength: '1000' }),
            el('span', { class: 'pl-stage-moves' },
              index ? move('stage-up', '↑', `Move ${name} up`, list => { list.splice(index - 1, 0, list.splice(index, 1)[0]); }) : null,
              index < stages.length - 1 ? move('stage-down', '↓', `Move ${name} down`, list => { list.splice(index + 1, 0, list.splice(index, 1)[0]); }) : null,
              stages.length > 1 ? move('stage-remove', '×', `Remove ${name}`, list => {
                const at = list.findIndex(other => other.stage_id === id);
                if (at < 0) throw Error(`${name} is no longer a stage. The stages are shown as they are now.`);
                this.removed = { stage: list.splice(at, 1)[0], index: at };
              }) : null)),
          note, error ? el('p', { class: 'pl-error', role: 'status', text: error }) : null));
    }));
    const add = titleLine({
      key: 'add-stage', value: this.newStage, label: 'Add a stage', placeholder: 'Add a stage…', hint: 'Return adds it last · Escape clears',
      input: value => { this.newStage = value; },
      cancel: (had, input) => { if (!had) input.blur(); },
      submit: title => {
        this.newStage = ''; this.paint();
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'stage';
        const stage = { stage_id: `${slug}-${Date.now().toString(36)}`, name: title, done_when: '', gate: { checks: [], owner: false, words: '' }, rounds: 'none', scope: 'piece', added_note: '' };
        this.act('add-stage', async () => {
          try { await this.setStages(list => { list.push(stage); }); this.removed = null; this.stageNote = { id: stage.stage_id, text: 'Added. Its done-when and chips are optional.' }; }
          catch (error) { if (!this.newStage) this.newStage = title; throw error; }
        }, false);
      },
    });
    const error = this.errors.get('add-stage');
    if (error) add.append(el('p', { class: 'pl-error pl-line-note', role: 'status', text: error }));
    const removed = this.removed;
    const undo = removed ? el('p', { class: 'pl-stage-removed muted', 'data-key': 'stage-undo', role: 'status' }, `Removed ${removed.stage.name}. `,
      el('button', { type: 'button', 'data-role': 'undo', text: 'Undo', onclick: () => this.act('stage-undo', async () => {
        await this.setStages(list => { if (!list.some(other => other.stage_id === removed.stage.stage_id)) list.splice(Math.min(removed.index, list.length), 0, removed.stage); });
        this.removed = null; this.stageNote = { id: removed.stage.stage_id, text: 'Back.' };
      }, false) }), this.errors.get('stage-undo') ? el('span', { class: 'pl-error', text: ` ${this.errors.get('stage-undo')}` }) : null) : null;
    return el('div', { class: 'pl-stage-editing' }, list, undo, add);
  }

  // One line of a stage, saved on Return or blur; Escape puts back what was saved.
  stageField(stage, field, attrs) {
    const id = stage.stage_id, key = `${id}:${field}`;
    const input = el('input', { type: 'text', class: `pl-stage-${field}`, 'data-role': `stage-${field}`, autocomplete: 'off', enterkeyhint: 'done', spellcheck: 'true', ...attrs });
    input.value = this.stageDrafts.get(key) ?? stageText(stage, field);
    input.oninput = () => { this.stageDrafts.set(key, input.value); if (this.stageNote?.id === id) this.stageNote = null; };
    input.onblur = () => this.saveStageText(id, field);
    input.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); this.saveStageText(id, field); }
      else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        this.stageDrafts.delete(key); input.value = stageText(this.stageOf(id) ?? stage, field); input.blur();
      }
    };
    return input;
  }

  stageOf(id) { return this.answer?.pipeline?.stages?.find(stage => stage.stage_id === id) ?? null; }

  saveStageText(id, field) {
    const key = `${id}:${field}`, draft = this.stageDrafts.get(key), stage = this.stageOf(id);
    if (draft === undefined || !stage) return this.chain;
    if (draft.trim() === stageText(stage, field)) { this.stageDrafts.delete(key); return this.chain; }
    return this.act(`stage:${id}`, async () => {
      // Read again when its turn comes: an earlier save may already have sent these words.
      const text = this.stageDrafts.get(key), now = this.stageOf(id);
      if (text === undefined || !now) return;
      if (text.trim() !== stageText(now, field)) {
        if (field === 'name' && !text.trim()) throw Error('A stage needs a name. Escape puts the old one back.');
        await this.setStages(list => { setStageText(stageIn(list, id), field, text.trim()); });
        this.stageNote = { id, text: 'Saved.' };
      }
      if (this.stageDrafts.get(key) === text) this.stageDrafts.delete(key);
    }, false);
  }

  // A tap on a stage's chip or move: the whole list as last read, with that one change.
  stageAct(id, change, role) {
    return this.act(`stage:${id}`, async () => { await this.setStages(change); this.stageNote = { id, text: 'Saved.' }; }, role);
  }

  // pipeline.stages_set takes the whole ordered list; each change is made to the list
  // as the page last read it, at its turn, with the revision that read carried.
  setStages(change) {
    const pipeline = this.answer?.pipeline;
    if (!pipeline) throw Error('This pipeline changed since this page read it. It is shown as it is now.');
    const list = pipeline.stages.map(({ you_leave_it, ...stage }) => ({ ...stage, gate: { ...stage.gate } }));
    change(list);
    return this.command('pipeline.stages_set', { workspace_id: this.workspace }, { stages: list }, { pipeline_revision: pipeline.version });
  }

  timesSection(answer, pipeline) {
    const times = answer.stage_times;
    if (!times?.rows?.length) return null;
    const sizes = times.sized ? ['small', 'medium', 'large'] : ['all'];
    const cell = typical => { const [value, sub] = typicalCell(typical); return el('td', {}, value, el('small', { text: sub })); };
    return section('How long stages have taken', times.sized
      ? 'Past data, not a promise. Each number is the median: half of past items of that size spent less time in the stage, half spent more.'
      : `Past data from this outcome's own ${pipeline.unit_many}, not a promise. Half of past ${pipeline.unit_many} spent less time in the stage, half spent more.`,
    el('table', { class: 'pl-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Stage' }), ...sizes.map(size => el('th', { scope: 'col', text: size === 'all' ? `Past ${pipeline.unit_many}` : SIZE_WORDS[size] })))),
      el('tbody', {}, ...times.rows.map(row => row.release
        ? el('tr', {}, el('th', { scope: 'row', text: row.label }), el('td', { colspan: String(sizes.length) }, typicalCell(row.release)[0],
          el('small', { text: 'whole release' + ('of' in row.release ? ` · median of the last ${row.release.of} releases` : ` · ${row.release.too_few} so far`) })))
        : el('tr', {}, el('th', { scope: 'row', text: row.label }), ...sizes.map(size => cell(row.cells[size])))))));
  }

  shippedSection(answer, pipeline, now) {
    const groups = answer.groups ?? [];
    if (!groups.length) return null;
    return section(pipeline.ships_in_releases ? 'Shipped' : 'Done', pipeline.ships_in_releases ? 'Each release lists what its deploy record says it shipped.' : `Each ${pipeline.unit_one} is done when its last stage is.`,
      ...groups.map((group, index) => {
        const key = `shipped:${group.label}`;
        return el('details', { class: 'pl-group pl-shipped', 'data-key': key, open: this.open.has(key) || (index === 0 && !this.closed.has(key)) },
          el('summary', {}, group.label + (group.deployed_ms ? `, ${datedTime(group.deployed_ms)}` : ''), el('span', { class: 'muted', text: ` · ${group.items.length} item${group.items.length === 1 ? '' : 's'}` })),
          el('ul', {}, ...group.items.map(item => el('li', {}, el('span', { role: 'img', 'aria-label': 'Shipped', text: '✅' }), el('span', { class: 'pl-num', text: String(item.number) }),
            el('a', { href: pipelineHref(this.workspace, item.number), class: 'pl-shipped-title', text: item.title }), ...this.origin(item)))),
          group.record || group.notes.length ? el('p', { class: 'muted' }, group.record ? `Release record ${group.record}` : 'Written by hand',
            group.notes.length ? ` · also ${group.notes.length} smaller change${group.notes.length === 1 ? '' : 's'} with no number` : '') : null,
          group.notes.length ? el('ul', { class: 'pl-notes' }, ...group.notes.map(text => el('li', { text }))) : null);
      }));
  }

  // The one line at the top of a section (the form rule): a title and Return adds it
  // there, last; Escape clears it. Words and size are set on the item afterwards.
  addLine(pipeline, name) {
    const key = `add:${name}`, label = pipeline.section_words?.[name] ?? sentenceName(name);
    const form = titleLine({
      key, value: this.addDrafts[name] ?? '', label: `Add an item to ${label}`, hint: `Return adds it to ${label} · Escape clears`,
      input: value => { this.addDrafts[name] = value; },
      cancel: (had, input) => { if (!had) input.blur(); },
      submit: title => {
        // The line clears at once, so the next title can be typed while this one is added.
        this.addDrafts[name] = ''; this.added = null; this.paint();
        this.act(key, async () => {
          const args = { title, section: name, sources: [{ note: 'the pipeline page' }] }; // "From the pipeline page"; who added it is its `added` event
          if (name === 'candidates') args.candidate_group = '';
          try {
            const result = await this.command('pipeline.item_add', { workspace_id: this.workspace }, args);
            if (this.details !== null) this.saveWords(this.details);
            this.added = { section: name, number: result.number }; this.details = result.number;
            if (name === 'candidates') { this.open.add('group:'); this.closed.delete('group:'); }
          } catch (error) {
            if (!this.addDrafts[name]) this.addDrafts[name] = title;
            throw error;
          }
        }, false);
      },
    });
    if (this.added?.section === name) form.append(el('p', { class: 'pl-line-note muted', role: 'status', text: `Added ${this.added.number}, last in ${label}. ${pipeline.sized ? 'Words and a size are' : 'Words are'} optional; set them on it below.` }));
    const error = this.errors.get(key);
    if (error) form.append(el('p', { class: 'pl-error pl-line-note', role: 'status', text: error }));
    return form;
  }

  // An item's words (a sentence or two) and its size as three chips, set in place.
  detailsPanel(item, pipeline, record = false) {
    const number = item.number, key = `item:${number}`;
    const area = el('textarea', { class: 'pl-words-box', rows: '2', 'data-role': 'words', placeholder: 'Words, if they help: a sentence or two', 'aria-label': `Words for ${number}` });
    area.value = this.wordDrafts.get(number) ?? item.description ?? '';
    area.oninput = () => { this.wordDrafts.set(number, area.value); if (this.savedWords === number) this.savedWords = null; };
    area.onblur = () => this.saveWords(number);
    area.onkeydown = event => {
      if (event.key === 'Escape' && !record) { event.preventDefault(); this.closeDetails(number); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.saveWords(number); }
    };
    const panel = el('div', { class: 'pl-details' }, area);
    if (pipeline.sized) {
      panel.append(el('div', { class: 'pl-sizes', role: 'group', 'aria-label': `Size of ${number}` }, el('span', { class: 'muted', text: 'Size' }),
        ...['small', 'medium', 'large'].map(size => el('button', {
          type: 'button', class: 'pl-size', 'data-role': `size-${size}`, 'aria-pressed': item.size === size ? 'true' : 'false', 'aria-label': SIZE_WORDS[size],
          title: item.size === size ? `${SIZE_WORDS[size]}. Tap again for no size.` : SIZE_WORDS[size], text: size[0].toUpperCase(),
          onclick: () => this.act(key, () => this.edit(number, { size: item.size === size ? null : size }), `size-${size}`),
        }))));
    }
    panel.append(el('p', { class: 'pl-details-note muted', text: this.savedWords === number ? 'Saved.' : 'Optional. Words save when you click away or press ⌘Return.' }));
    return panel;
  }

  saveWords(number) {
    const draft = this.wordDrafts.get(number), item = this.current(number);
    if (draft === undefined || !item) return this.chain;
    if (draft === (item.description ?? '')) { this.wordDrafts.delete(number); return this.chain; }
    return this.act(`item:${number}`, async () => {
      // Read again when its turn comes: an earlier save may already have sent these words.
      const words = this.wordDrafts.get(number), now = this.current(number);
      if (words === undefined || !now) return;
      if (words !== (now.description ?? '')) { await this.edit(number, { description: words }); this.savedWords = number; }
      if (this.wordDrafts.get(number) === words) this.wordDrafts.delete(number);
    }, false);
  }

  toggleDetails(number) {
    if (this.details === number) return this.closeDetails(number);
    if (this.details !== null) this.saveWords(this.details);
    this.details = number; this.savedWords = null; this.paint();
    this.host.querySelector(`[data-key="item:${number}"] [data-role="words"]`)?.focus();
  }

  closeDetails(number) {
    this.saveWords(number);
    this.details = null; this.paint();
    this.host.querySelector(`[data-key="item:${number}"] [data-role="details"]`)?.focus();
  }

  // Turning a pipeline on is one tap with the defaults (the form rule); its title and
  // whether items are sized are changed afterwards on the page, in place.
  turnOn(pipeline) {
    // The owner or the coordinator turns it on (they steer it together).
    const answer = this.answer;
    const steers = answer.pipeline ? answer.pipeline.you_steer : answer.you_steer === true;
    const box = el('div', { class: 'pl-empty' }, el('p', {}, el('strong', { text: 'This outcome’s pipeline is off.' })),
      el('p', { class: 'muted', text: 'A pipeline numbers every piece of work this outcome delivers, from first mention to the release that shipped it. Turning it on keeps nothing hidden; turning it off keeps every item.' }));
    if (!steers) return box;
    box.append(el('p', { class: 'pl-turn-on' }, el('button', { type: 'button', class: 'primary', 'data-role': 'turn-on', text: 'Turn on',
      onclick: () => this.act('turn-on', async () => {
        await this.command('pipeline.configure', { workspace_id: this.workspace }, { enabled: true }, { pipeline_revision: pipeline?.version ?? 0 });
        this.settingsNote = { text: 'On. Change its title above, or whether items are sized, right here.' };
      }, false).then(() => { if (this.answer?.pipeline?.enabled) this.titleField?.focus({ preventScroll: true }); }) }),
    el('span', { class: 'muted', text: pipeline ? `Comes back as ${pipeline.title}, with every item it kept.` : 'Starts as “Pipeline”, with items sized small, medium or large. Both change on the page after.' })));
    const error = this.errors.get('turn-on');
    if (error) box.append(el('p', { class: 'pl-error', role: 'status', text: error }));
    return el('div', { 'data-key': 'turn-on' }, box);
  }

  // The owner's title, edited where it stands in the page header: Return or blur saves it,
  // Escape puts it back. The same element stays across repaints, so typing is never lost.
  titleInPlace(pipeline) {
    const field = this.titleField ??= el('input', { type: 'text', class: 'pl-title-input', 'aria-label': 'Pipeline title', title: 'Return saves · Escape puts it back',
      autocomplete: 'off', enterkeyhint: 'done', maxlength: '200', spellcheck: 'true' });
    field.oninput = () => { this.titleDraft = field.value; this.settingsNote = null; };
    field.onblur = () => this.saveTitle();
    field.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); this.saveTitle(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.titleDraft = null; field.value = this.answer?.pipeline?.title ?? ''; field.blur(); }
    };
    if (document.activeElement !== field) field.value = this.titleDraft ?? pipeline.title;
    const title = this.header.title;
    if (title.childNodes.length !== 1 || title.firstChild !== field) title.replaceChildren(field);
  }

  saveTitle() {
    const draft = this.titleDraft, pipeline = this.answer?.pipeline;
    if (draft === null || !pipeline) return this.chain;
    if (draft.trim() === pipeline.title) { this.titleDraft = null; return this.chain; }
    return this.act('settings', async () => {
      const text = this.titleDraft, now = this.answer?.pipeline;
      if (text === null || !now) return;
      if (text.trim() !== now.title) {
        await this.command('pipeline.configure', { workspace_id: this.workspace }, { enabled: now.enabled, title: text.trim() }, { pipeline_revision: now.version });
        this.settingsNote = { text: 'Title saved.' };
      }
      if (this.titleDraft === text) this.titleDraft = null;
    }, false);
  }

  // The owner's settings line: whether items are sized, one chip, saved on its tap;
  // the quiet note or the refusal for the title above shows here too.
  settingsLine(pipeline) {
    const error = this.errors.get('settings');
    return el('div', { class: 'pl-settings', 'data-key': 'settings' },
      el('button', { type: 'button', class: 'pl-pick', 'data-role': 'sized', 'aria-pressed': pipeline.sized ? 'true' : 'false',
        title: pipeline.sized ? 'Items can be small, medium or large. Tap to stop sizing them.' : 'Tap so that items can be small, medium or large.',
        text: 'Sized S · M · L',
        onclick: () => this.act('settings', async () => {
          const now = this.answer.pipeline;
          await this.command('pipeline.configure', { workspace_id: this.workspace }, { enabled: now.enabled, sized: !now.sized }, { pipeline_revision: now.version });
          this.settingsNote = { text: now.sized ? 'Items are no longer sized.' : 'Items can be sized now: S, M or L on each.' };
        }, 'sized') }),
      this.settingsNote ? el('span', { class: 'muted', role: 'status', text: this.settingsNote.text }) : null,
      error ? el('span', { class: 'pl-error', role: 'status', text: error }) : null);
  }

  // ---- an item's record (9.1.5) ----------------------------------------------------

  paintRecord(now) {
    const answer = this.record, item = answer.item, pipeline = answer.pipeline;
    this.paintHeader(`${answer.workspace_title} · ${pipeline.title}`, `${item.number}. ${item.title}`, item.description);
    const page = [el('p', {}, el('a', { href: pipelineHref(this.workspace), text: `← ${pipeline.title}` }))];
    const status = item.shipped ? (item.shipped.release ? `Shipped in release ${item.shipped.release}, ${shownTime(item.shipped.deployed_ms, now)}.`
      : item.shipped.note ? `Shipped ${item.shipped.note}.` : `Done ${shownTime(item.shipped.done_ms, now)}.`)
      : item.section === 'dropped' ? 'Dropped. Kept with its number, so it can come back.' : `In ${pipeline.section_words?.[item.section] ?? item.section}.`;
    const editable = item.section !== 'dropped' && !item.shipped;
    page.push(el('article', { class: 'pl-item', 'data-key': `item:${item.number}` }, this.head(item), this.meta(item, pipeline, now), el('p', { class: 'pl-meta', text: status }),
      editable ? this.detailsPanel(item, pipeline, true) : null, this.errors.get(`item:${item.number}`) ? el('p', { class: 'pl-error', role: 'status', text: this.errors.get(`item:${item.number}`) }) : null));
    for (const ask of item.asks) page.push(el('p', { class: 'pl-note' }, `${ask.by} asked you, since ${shownTime(ask.since_ms, now)}: “${ask.excerpt}” In `, el('a', { href: topicHref(ask.topic_id), text: ask.topic_title }), '.'));
    const runs = sourceRuns(item.sources, this.reader);
    page.push(section('Where this came from', null, runs.parts.length
      ? el('p', { class: 'pl-origin-whole' }, ...runs.parts.map(part => part.message ? el('a', { href: topicHref(part.message.topic_id), text: part.text }) : part.text))
      : el('p', { class: 'muted', text: 'Nothing recorded.' })));
    const gathering = gatheringWords(item.gathering, this.reader);
    if (gathering) page.push(el('p', { class: 'pl-origin pl-maturing' }, gathering.lead, gathering.link ?? '', gathering.mine ? ' (you)' : '', gathering.after));
    if (item.pieces?.length) {
      page.push(section('Stages', null, ...item.pieces.map(piece => el('div', { class: 'pl-item' },
        piece.topic ? el('p', { class: 'pl-meta' }, 'Topic: ', el('a', { href: topicHref(piece.topic.id), text: piece.topic.title })) : null,
        piece.stage ? this.stageBox(piece, pipeline, now, true)
          : el('ol', { class: 'pl-history-list' }, ...piece.stages_so_far.map(entry => el('li', { text: historyLine(entry, now) })))))));
    }
    const progress = item.events.find(event => event.payload?.progress?.length);
    if (progress) page.push(el('p', { class: 'pl-note', text: `Progress noted by hand before the pipeline was part of Theseus: ${progress.payload.progress.join(' ')}` }));
    page.push(section('What happened to it', null, el('ol', { class: 'pl-events' }, ...item.events.map(event => el('li', { text: eventWords(event, this.reader, pipeline.section_words, now) })))));
    this.host.replaceChildren(...page);
  }
}

const isField = node => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;

// One line for a title (the form rule): placeholder "Add an item…", Return submits it,
// Escape clears it (and then `cancel` hears whether it held text). The pipeline page's
// sections and a message's Add to pipeline both use it.
export function titleLine({ key, value = '', label, hint, placeholder = 'Add an item…', input, submit, cancel }) {
  const field = el('input', { type: 'text', class: 'pl-line-input', 'data-role': 'add-title', placeholder, 'aria-label': label, autocomplete: 'off',
    enterkeyhint: 'done', maxlength: '500', spellcheck: 'true' });
  field.value = value;
  field.oninput = () => input?.(field.value);
  field.onkeydown = event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    const had = field.value !== '';
    if (had) { field.value = ''; input?.(''); }
    cancel?.(had, field);
  };
  const form = el('form', { class: 'pl-line', 'data-key': key }, field, el('span', { class: 'pl-line-hint muted', text: hint }));
  form.onsubmit = event => { event.preventDefault(); const title = field.value.trim(); if (title) submit(title, field); };
  return form;
}

function glyph(kind) {
  const [mark, words] = glyphWords(kind);
  return el('span', { class: 'pl-glyph', 'data-glyph': kind, role: 'img', 'aria-label': words, title: words, text: mark });
}

function section(title, note, ...kids) {
  return el('section', { class: 'pl-section', 'aria-label': title }, el('h2', { text: title }), note ? el('span', { class: 'muted', text: note }) : null, ...kids);
}

const ROUND_CHIPS = [
  ['none', 'None', 'No rounds: an item passes this stage once.'],
  ['together', 'Together', 'Each round together: an item can come back for more rounds, each counted with the first.'],
  ['split', 'First apart', 'First round apart: the first round is counted on its own, later rounds together.'],
];
const STAGE_TEXT = { name: stage => stage.name, done: stage => stage.done_when ?? '', checks: stage => stage.gate?.words ?? '' };
const stageText = (stage, field) => STAGE_TEXT[field](stage);
function setStageText(stage, field, text) {
  if (field === 'name') stage.name = text;
  else if (field === 'done') stage.done_when = text;
  else stage.gate.words = text;
}
function stageIn(list, id) {
  const stage = list.find(other => other.stage_id === id);
  if (!stage) throw Error('That stage is no longer there. The stages are shown as they are now.');
  return stage;
}

function gateWords(stage, owner) {
  const parts = [];
  if (stage.gate?.owner) parts.push(`${owner}’s word. Nothing else moves an item past this stage.`);
  if (stage.gate?.checks?.length) parts.push(`checks ${listWords(stage.gate.checks)}`);
  if (stage.gate?.words) parts.push(stage.gate.words);
  return parts.length ? `Checked by: ${parts.join('; ')}` : 'Checked by: its own words';
}

// The rail's Pipeline row (D19): the pipeline's title, Waiting on you when an
// item is ❓ for the reader, and the work ring when a Now piece's topic has work seen.
export class PipelineRow {
  constructor({ section, host, workspace, current = false, read, reader }) {
    Object.assign(this, { section, host, workspace, current, read, reader });
    this.on = false; // whether the outcome's pipeline is on: a message offers Add to pipeline only then
  }
  async load() {
    let answer;
    try { answer = await this.read('pipeline_row', { workspace_id: this.workspace }); }
    catch { return false; }
    if (answer?.error) return false;
    const row = answer.pipeline;
    this.on = !!row;
    this.section.hidden = !row;
    if (!row) { this.host.replaceChildren(); return true; }
    const link = el('a', { class: 'nav-item', href: pipelineHref(this.workspace), 'aria-current': this.current ? 'page' : null }, row.title);
    if (row.asks) link.append(el('span', { class: 'topic-state mine', 'data-state': 'waiting', text: 'Waiting on you' }));
    if (row.work?.observed) {
      link.title = workNote(row.work, this.reader);
      link.append(el('span', { class: 'topic-work', 'aria-hidden': 'true' }), el('span', { class: 'sr-only', text: ` · ${link.title}` }));
    }
    this.host.replaceChildren(link);
    return true;
  }
}

// The outcome page's pipeline line (D11): "Pipeline: Release pipeline ›", or,
// for its owner or coordinator while the pipeline is off, "Pipeline: off · Turn on".
export async function paintPipelineLine(host, { workspace, read }) {
  let answer;
  try { answer = await read('pipeline_row', { workspace_id: workspace }); } catch { host.hidden = true; return false; }
  if (answer?.error) { host.hidden = true; return false; }
  if (answer.pipeline) {
    host.replaceChildren('Pipeline: ', el('a', { href: pipelineHref(workspace), text: `${answer.pipeline.title} ›` }),
      answer.pipeline.asks ? el('span', { class: 'topic-state mine', 'data-state': 'waiting', text: 'Waiting on you' }) : '');
    host.hidden = false;
  } else if (answer.you_steer) {
    host.replaceChildren('Pipeline: off · ', el('a', { href: pipelineHref(workspace), text: 'Turn on' }));
    host.hidden = false;
  } else host.hidden = true;
  return true;
}
