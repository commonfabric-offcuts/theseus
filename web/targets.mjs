// An outcome's target and its checks, the improvement loop, the problems found
// before a check, and the Measurements page (items 14, 12, 104; docs/targets.md).
// Every fact comes from the `outcome_checks` and `check_readings` views; every
// word from targets-words.mjs. The panels read again on every commit and keep
// the reader's open groups and checks.
import { datedTime, shownTime } from './times.mjs';
import { checkChart, problemsChart } from './charts.mjs';
import {
  CANDIDATE_STATE, PROBLEM_KIND, STATUS, STEP_GROUP, WORD, bylineWords, countCell, groupCounts, kindWords, loopSteps, number, plural,
  problemsHeadline, ruleWords, standingSentence, stepCompareWords, took,
  NO_CHECKS, KIND_CHIPS, KIND_QUESTION, WRITE_KEYS, REACH_KEYS, ACCEPT_KEYS, REACH_WHY_FIRST, ACCEPT_WHY_FIRST, askWords, noTargetWords, provesWords, writeButtonWords, writeHowWords,
} from './targets-words.mjs';

export const measurementsHref = workspace => '?' + new URLSearchParams({ measurements: workspace });
const topicHref = id => '?' + new URLSearchParams({ topic: id });
const CHARTS_SHOWN = 6;

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
const time = ms => (typeof ms === 'number' ? el('time', { datetime: new Date(ms).toISOString(), title: datedTime(ms), 'data-ms': String(ms), text: shownTime(ms) }) : null);
const day = ms => (typeof ms === 'number' ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const chip = (text, kind) => el('span', { class: `tg-chip${kind ? ' ' + kind : ''}`, text });
const statusChip = status => chip(STATUS[status] ?? status, 'status-' + status);
const topicLink = (topic, words) => (topic ? el('a', { href: topicHref(topic.id), text: words ?? `“${topic.title}”` }) : null);

// <details> that keep the reader's choice across repaints; open by default when asked.
class Folds {
  constructor() { this.chosen = new Map(); }
  details(key, openByDefault, attrs, summary, ...body) {
    const node = el('details', { ...attrs, 'data-fold': key }, el('summary', null, summary), ...body);
    node.open = this.chosen.has(key) ? this.chosen.get(key) : openByDefault;
    node.addEventListener('toggle', () => this.chosen.set(key, node.open));
    return node;
  }
}

// Every repaint replaces a panel's nodes. The control that had the focus, found again by its data-key
// (or a fold's summary by its data-fold), gets it back, with the caret where it was in a box.
function focusSelector(node) {
  if (node.dataset?.key) return `[data-key="${CSS.escape(node.dataset.key)}"]`;
  if (node.tagName === 'SUMMARY' && node.parentElement?.dataset.fold) return `[data-fold="${CSS.escape(node.parentElement.dataset.fold)}"] > summary`;
  return null;
}
function replaceKeepingFocus(host, ...nodes) {
  const active = document.activeElement;
  const selector = active && active !== host && host.contains(active) ? focusSelector(active) : null;
  const caret = selector && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  host.replaceChildren(...nodes);
  const again = selector && host.querySelector(selector);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (caret && typeof again.setSelectionRange === 'function') again.setSelectionRange(...caret);
}

// A reason box: Return sends its words, Shift+Return is a new line, Escape steps back.
const reasonKeys = (send, back) => event => {
  if (event.key === 'Escape') { event.preventDefault(); back(); }
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!event.repeat) send(); }
};
const reasonBox = (draft, attrs) => {
  const box = el('textarea', { rows: '2', class: 'tg-reason', enterkeyhint: 'done', ...attrs });
  box.value = draft.words;
  box.readOnly = draft.busy;
  // The box grows with the words, a line at a time, where the browser cannot size it to them itself.
  const fit = () => { if (!CSS.supports('field-sizing', 'content')) { box.style.height = 'auto'; box.style.height = `${box.scrollHeight + 2}px`; } };
  box.addEventListener('input', () => {
    draft.words = box.value;
    fit();
    if (draft.error) { draft.error = ''; box.parentElement?.querySelector(':scope > .notice')?.remove(); }
  });
  box.addEventListener('focus', fit);
  return box;
};
const reasonFoot = (draft, keys, ...more) => [
  el('p', { class: 'muted tg-reason-keys' }, el('span', { text: draft.busy ? 'Saving…' : keys }), ...more),
  draft.error ? el('p', { class: 'notice', role: 'status', text: draft.error }) : null];

async function sent(send, kind, target, args, expected) {
  const receipt = await send(kind, target, args, expected);
  if (receipt?.status !== 'committed') throw Error(receipt?.error?.message ?? 'Not saved; nothing changed.');
  return receipt;
}

function readingRow(reading) {
  return el('li', { class: `tg-reading${reading.candidate ? ' candidate' : ''}` },
    el('span', { class: 'tg-reading-label' }, reading.label, reading.at_ms ? ', ' : '', time(reading.at_ms)),
    el('span', { class: 'tg-reading-words', text: reading.words }),
    reading.accepted ? el('span', { class: 'tg-accepted', text: `${reading.accepted.by} accepted it: “${reading.accepted.why}”` }) : null);
}

function checkBody(check, view, workspace) {
  const parts = [];
  if (check.readings?.length) parts.push(el('ul', { class: 'tg-readings' }, check.readings.slice().reverse().map(readingRow)));
  else if (check.pending_words) parts.push(el('p', { class: 'muted', text: check.pending_words }));
  if (check.waiting) parts.push(el('p', { class: 'tg-waiting' }, `${check.waiting.by} asked you about this `, time(check.waiting.since_ms), ' in ', topicLink({ id: check.waiting.topic_id, title: check.waiting.topic_title }), '.'));
  if (check.fix_topic) parts.push(el('p', null, 'Being fixed in ', topicLink(check.fix_topic), '. Nothing here needs you.'));
  if (check.rule) parts.push(el('p', { class: 'muted', text: ruleWords(check.rule, view.loop?.live?.release) + (check.rule.set_by ? ` Set by ${check.rule.set_by}.` : '') }));
  if (check.left_by_topic) parts.push(el('p', { class: 'muted' }, 'Left behind by the topic ', topicLink(check.left_by_topic), check.left_by_topic.state === 'done' ? ', now Done.' : '.'));
  if (check.explain) parts.push(el('p', { class: 'muted', text: check.explain }));
  const links = el('p', { class: 'tg-links' });
  if (check.record_page) links.append(el('span', { class: 'muted', text: `From the Notebook page “${check.record_page.title}”` }));
  if (check.readings?.length) links.append(el('a', { href: measurementsHref(workspace), text: 'Open Measurements' }));
  if (links.childNodes.length) parts.push(links);
  return parts;
}

function checkSummary(check) {
  const latest = check.latest;
  const words = latest ? [latest.words, ' · ', latest.label, latest.at_ms ? ', ' : '', time(latest.at_ms)] : [check.pending_words || ''];
  return [el('span', { class: 'tg-check-name', text: check.name }), statusChip(check.status),
    check.proves ? el('span', { class: 'tg-proves', text: provesWords(check.proves) }) : null, el('span', { class: 'tg-check-latest muted' }, ...words)];
}

export class OutcomeTargets {
  // hosts: target, loop, problems; read(view, args); send(kind, target, args, expected); reader: the actor.
  constructor({ hosts, workspace, reader, read, send }) {
    Object.assign(this, { hosts, workspace, reader, read, send });
    this.folds = new Folds();
    this.notice = '';
    this.reaching = null; // the Reached box's draft while it is open: { words, anyway, busy, error }
    this.accepting = new Map(); // check_id -> the draft of its "Ship it anyway" reason
    this.writer = null;
  }

  async load() {
    try {
      const view = await this.read('outcome_checks', { workspace_id: this.workspace });
      this.view = view;
      this.paint();
      return true;
    } catch (error) {
      for (const host of Object.values(this.hosts)) { host.hidden = true; }
      this.hosts.target.hidden = false;
      this.hosts.target.replaceChildren(el('p', { class: 'notice', text: `The target could not be read: ${error.message}` }));
      return false;
    }
  }

  act(work) {
    this.notice = '';
    return work().then(() => this.load()).catch(error => { this.notice = error.message; this.paint(); });
  }

  paint() {
    const view = this.view;
    this.paintTarget(view);
    this.paintLoop(view);
    this.paintProblems(view);
  }

  paintTarget(view) {
    const host = this.hosts.target, target = view.target;
    host.hidden = false;
    const word = view.word;
    const head = el('div', { class: 'tg-head' }, el('h2', { class: 'tg-eyebrow', text: 'Target' }), word ? chip(WORD[word], 'word-' + word) : null);
    const parts = [head];
    if (!target?.text) {
      parts.push(el('p', { text: noTargetWords({ hasChecks: view.groups.length > 0, kind: view.kind.kind, youSteer: view.you_steer, coordinator: view.coordinator, owner: view.owner }) }));
    } else {
      parts.push(el('p', { class: 'tg-text', text: target.text }), el('p', { class: 'muted tg-byline', text: bylineWords(target, day(target.written_ms)) }));
    }
    if (target?.proposed) {
      const proposed = target.proposed;
      const box = el('div', { class: 'tg-proposed' }, el('p', null, el('strong', { text: `${proposed.by} proposes new words` }), view.you_own ? ' for you to accept or decline:' : `, waiting on ${view.owner}:`),
        el('p', { class: 'tg-text', text: proposed.text }));
      if (view.you_own) {
        const settle = outcome => () => this.act(() => sent(this.send, 'target.settle', { workspace_id: view.workspace_id }, { revision: proposed.revision, outcome },
          { target_revision: view.relevant_versions.checks }));
        box.append(el('div', { class: 'tg-actions' }, el('button', { type: 'button', class: 'primary', 'data-key': 'settle-accepted', text: 'Use these words', onclick: settle('accepted') }),
          el('button', { type: 'button', 'data-key': 'settle-declined', text: 'Keep the current words', onclick: settle('declined') })));
      }
      parts.push(box);
    }
    if (view.you_steer && !view.reached) parts.push(this.writing(view));
    else this.writer = null;
    if (target?.text && !view.groups.length) parts.push(el('p', { class: 'muted tg-no-checks', text: NO_CHECKS }));
    if (view.reached) {
      parts.push(el('p', { class: 'tg-reached' }, el('strong', { text: 'Reached' }), ' ', time(view.reached.ms), ` by ${view.reached.by}: “${view.reached.words}”. Its topics are kept to read.`));
    } else {
      const counts = view.counts;
      const sentence = standingSentence({ word, kind: view.kind.kind, counts, failing: view.failing_check, reachOffered: view.reach?.offered, title: view.workspace_title });
      if (sentence) parts.push(el('p', { class: 'tg-standing', text: sentence }));
    }
    parts.push(this.kindLine(view));
    if (this.notice) parts.push(el('p', { class: 'notice', role: 'status', text: this.notice }));
    for (const group of view.groups) {
      const checks = group.checks.map(check => this.folds.details('check:' + check.check_id, check.status === 'failing' || check.status === 'waiting',
        { class: `tg-check status-${check.status}` }, checkSummary(check), el('div', { class: 'tg-check-body' }, checkBody(check, view, view.workspace_id))));
      parts.push(this.folds.details('group:' + group.name, group.open, { class: 'tg-group' },
        [el('span', { class: 'tg-group-name', text: group.name }), el('span', { class: 'muted', text: groupCounts(group.counts) })], ...checks));
    }
    if (view.groups.length) parts.push(el('p', { class: 'tg-links' }, el('a', { href: measurementsHref(view.workspace_id), text: 'Open Measurements: every reading by release' })));
    // A repaint on every commit moves the open box into the new card; the writer keeps their place in it.
    replaceKeepingFocus(host, el('div', { class: 'tg-card' }, parts));
  }

  // D8: "Write the target", for the owner and the coordinator; the box opens in place and keeps what is typed across repaints.
  writing(view) {
    const hasTarget = Boolean(view.target?.text), youOwn = view.you_own;
    if (!this.writer) {
      return el('div', { class: 'tg-write-open' }, el('button', { type: 'button', class: hasTarget ? '' : 'primary', 'data-key': 'write-open', text: writeButtonWords({ hasTarget, youOwn }),
        onclick: () => this.openWriter(view) }));
    }
    const writer = this.writer;
    writer.needsAsk = hasTarget && !youOwn;
    writer.how.textContent = writeHowWords({ hasTarget, youOwn, owner: view.owner });
    writer.topicsLine.hidden = !writer.needsAsk;
    if (writer.needsAsk) this.paintTopics(view);
    writer.error.hidden = !writer.error.textContent;
    this.writerReady();
    return writer.node;
  }

  openWriter(view) {
    const field = el('textarea', { rows: '3', class: 'tg-write-text', 'data-key': 'writer', 'aria-label': 'The target, in a few sentences',
      placeholder: 'What done looks like, in a few sentences', enterkeyhint: 'done' });
    field.value = view.target?.text ?? '';
    const how = el('p', { class: 'muted tg-write-how' }), topicsLine = el('div', { class: 'tg-topics', role: 'group', 'aria-label': 'The topic the ask goes in' });
    const error = el('p', { class: 'notice', role: 'status' });
    // Return saves the words and Esc cancels, so the box has no Save button (the form rule); Cancel is a quiet word for a tap.
    const keys = el('span', { class: 'tg-write-keys', text: WRITE_KEYS });
    const cancel = el('button', { type: 'button', class: 'link-button', 'data-key': 'writer-cancel', text: 'Cancel', onclick: () => this.closeWriter() });
    const node = el('div', { class: 'tg-write' }, field, how, topicsLine, error, el('p', { class: 'muted tg-reason-keys' }, keys, ' ', cancel));
    this.writer = { node, field, how, topicsLine, error, keys, cancel, ready: false, original: field.value, topics: null, topic: null, busy: false, needsAsk: false };
    field.addEventListener('input', () => this.writerReady());
    node.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeWriter(); }
      else if (event.key === 'Enter' && event.target === field && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!event.repeat) this.saveWriter(); }
    });
    this.paint();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  closeWriter() {
    const had = this.writer;
    this.writer = null;
    this.paint();
    if (had) this.hosts.target.querySelector('[data-key="write-open"]')?.focus();
  }

  writerReady() {
    const writer = this.writer;
    const text = writer.field.value.trim();
    writer.ready = !writer.busy && Boolean(text) && text !== writer.original.trim() && !(writer.needsAsk && !writer.topic);
    writer.field.readOnly = writer.busy;
    writer.keys.textContent = writer.busy ? 'Saving…' : WRITE_KEYS;
  }

  // The ask goes in a topic of this outcome: its newest few, as chips; the newest is chosen.
  paintTopics(view) {
    const writer = this.writer;
    if (writer.topics === null) {
      writer.topics = 'reading';
      this.read('workspace_topics', { workspace_id: view.workspace_id, limit: 4 }).then(answer => {
        if (this.writer !== writer) return;
        writer.topics = answer.items.map(item => ({ id: item.id, title: item.title }));
        writer.topic = writer.topics[0]?.id ?? null;
        this.paint();
      }).catch(failure => { if (this.writer === writer) { writer.topics = []; writer.error.textContent = `The topics could not be read: ${failure.message}`; this.paint(); } });
    }
    if (!Array.isArray(writer.topics)) { writer.topicsLine.replaceChildren(el('span', { class: 'muted', text: 'Reading its topics…' })); return; }
    if (!writer.topics.length) {
      writer.topicsLine.replaceChildren(el('span', { class: 'muted', text: `No topic in this outcome yet. Start one, then ask ${view.owner} there.` }));
      return;
    }
    writer.topicsLine.replaceChildren(...writer.topics.map(topic => el('button', { type: 'button', class: 'tg-topic-chip', 'data-key': 'ask-topic:' + topic.id, 'aria-pressed': String(topic.id === writer.topic),
      text: topic.title, title: topic.title, onclick: () => { writer.topic = topic.id; this.paint(); } })));
  }

  async saveWriter() {
    const writer = this.writer, view = this.view;
    if (!writer || writer.busy) return;
    this.writerReady();
    if (!writer.ready) return;
    const text = writer.field.value.trim();
    const args = { text };
    if (writer.needsAsk) args.ask = { topic_id: writer.topic, body: askWords(text) };
    writer.busy = true; writer.error.textContent = ''; this.paint();
    try {
      await sent(this.send, 'target.propose', { workspace_id: view.workspace_id }, args, { target_revision: view.relevant_versions.checks });
      if (this.writer === writer) this.writer = null;
      await this.load();
    } catch (failure) {
      writer.busy = false;
      writer.error.textContent = failure.message;
      this.paint();
      writer.field.focus();
    }
  }

  // D41: the kind is two chips for the owner, one tap each; everyone else reads it in words.
  kindLine(view) {
    const kind = view.kind.kind;
    if (view.reached || !view.kind.you_change) return el('div', { class: 'tg-kind' }, el('span', { class: 'muted', text: kindWords(kind) }));
    const question = el('span', { class: 'muted kind-question', id: 'kind-question', text: KIND_QUESTION });
    const chips = el('div', { class: 'kind-chips', role: 'group', 'aria-labelledby': 'kind-question' }, KIND_CHIPS.map(([value, label, hint]) =>
      el('button', { type: 'button', class: 'kind-chip', 'data-key': 'kind:' + value, 'aria-pressed': String(value === kind),
        onclick: () => { if (value !== kind) this.act(() => sent(this.send, 'outcome.kind_set', { workspace_id: view.workspace_id }, { kind: value }, { workspace_revision: view.relevant_versions.workspace })); } },
      el('strong', { text: label }), el('span', { class: 'muted', text: hint }))));
    const line = el('div', { class: 'tg-kind' }, question, chips);
    if (kind !== 'reach') return line;
    if (!this.reaching) {
      line.append(el('button', { type: 'button', class: view.reach?.offered ? 'primary' : '', 'data-key': 'say-reached', text: 'Say it is reached', onclick: () => this.openReach() }));
      return line;
    }
    return el('div', null, line, this.reachBox(view));
  }

  // D42: Reached is final, so it opens in place first; then one or two sentences, and Return marks it reached.
  reachBox(view) {
    const draft = this.reaching, unmet = view.reach?.unmet ?? [];
    const words = reasonBox(draft, { 'data-key': 'reach-words', maxlength: '500', 'aria-label': 'Why it is reached, in your own words', placeholder: 'Why it is reached, in a sentence or two' });
    words.addEventListener('keydown', reasonKeys(() => this.sendReach(), () => this.closeReach()));
    // Not offered: something is not met, or nothing checks it yet; either way he confirms first (Core refuses NOT_MET without it).
    let anyway = null;
    if (!view.reach?.offered) {
      anyway = el('input', { type: 'checkbox', 'data-key': 'reach-anyway', disabled: draft.busy });
      anyway.checked = draft.anyway;
      anyway.addEventListener('change', () => { draft.anyway = anyway.checked; });
    }
    return el('div', { class: 'tg-reach' }, el('p', null, 'Reached is final: every topic of this outcome closes and is kept to read, and nothing more changes in it.'),
      anyway ? el('label', null, anyway, unmet.length ? ` Mark it reached anyway: not met yet, ${unmet.map(item => `“${item.name}” (${item.why.replace('_', ' ')})`).join(', ')}`
        : ' Mark it reached anyway: nothing checks it yet') : null,
      words, reasonFoot(draft, REACH_KEYS, el('button', { type: 'button', class: 'link-button', 'data-key': 'reach-not-yet', text: 'Not yet', onclick: () => this.closeReach() })));
  }

  openReach() {
    this.reaching = { words: '', anyway: false, busy: false, error: '' };
    this.paint();
    this.hosts.target.querySelector('[data-key="reach-words"]')?.focus();
  }

  closeReach() {
    if (this.reaching?.busy) return;
    this.reaching = null;
    this.paint();
    this.hosts.target.querySelector('[data-key="say-reached"]')?.focus();
  }

  async sendReach() {
    const draft = this.reaching, view = this.view;
    if (!draft || draft.busy) return;
    if (!draft.words.trim()) { draft.error = REACH_WHY_FIRST; this.paint(); return; }
    const args = { words: draft.words };
    if (draft.anyway && !view.reach?.offered) args.unmet_confirmed = true;
    draft.busy = true; draft.error = ''; this.paint();
    try {
      await sent(this.send, 'outcome.reach', { workspace_id: view.workspace_id }, args, { workspace_revision: view.relevant_versions.workspace });
      if (this.reaching === draft) this.reaching = null;
      await this.load();
    } catch (failure) {
      draft.busy = false; draft.error = failure.message;
      this.paint();
    }
  }

  paintLoop(view) {
    const host = this.hosts.loop, loop = view.loop;
    if (!loop || !view.groups.length) { host.hidden = true; return; }
    host.hidden = false;
    const steps = loopSteps(loop);
    const parts = [el('h2', { class: 'tg-section', text: 'How each change is checked' }),
      el('p', { class: 'muted', text: loop.candidate ? `The same four steps for every change to this outcome, filled in with where ${loop.candidate.label.replace(' candidate', '').toLowerCase()} is.` : 'The same four steps for every change to this outcome.' }),
      el('ol', { class: 'tg-steps' }, steps.map((step, index) => el('li', null, el('span', { class: 'muted', text: `Step ${index + 1}` }), el('strong', { text: step.title }), step.now ? el('span', { text: step.now }) : null))),
      el('p', { class: 'muted', text: 'Whatever ships becomes the bar the next change is compared with.' })];
    if (loop.candidate) parts.push(this.candidateCard(view, loop));
    else if (loop.live) parts.push(el('p', { text: `No change is being checked now. Release ${loop.live.release} is live.` }));
    const charted = view.groups.flatMap(group => group.checks).filter(check => check.chart && check.source !== 'found-problems').slice(0, CHARTS_SHOWN);
    if (charted.length || view.problems) {
      parts.push(el('h2', { class: 'tg-section', text: 'Measures by release' }),
        el('p', { class: 'muted', text: 'One chart per measure. Point at a mark, or open its numbers, to see which release and what produced each reading.' }),
        el('div', { class: 'tg-charts' }, charted.map(checkChart), view.problems ? problemsChart(view.problems) : null));
    }
    replaceKeepingFocus(host, ...parts);
  }

  candidateCard(view, loop) {
    const candidate = loop.candidate, live = loop.live?.release;
    const head = el('div', { class: 'tg-head' }, el('h3', { text: candidate.label }), chip(CANDIDATE_STATE[candidate.state] ?? candidate.state, 'state-' + candidate.state));
    const facts = el('p', { class: 'muted' }, 'Started ', time(candidate.started_ms), ` · ${plural(candidate.steps.filter(step => step.state === 'landed').length, 'step has', 'steps have')} results`,
      candidate.steps_total ? ` of ${candidate.steps_total}` : '', candidate.commit ? ` · commit ${candidate.commit.slice(0, 7)}` : '');
    const rows = [];
    for (const group of ['units', 'measures', 'browser']) {
      const steps = candidate.steps.filter(step => step.group === group);
      if (!steps.length) continue;
      rows.push(el('tr', { class: 'tg-step-group' }, el('th', { colspan: '5', scope: 'colgroup', text: STEP_GROUP[group] })));
      for (const step of steps) {
        rows.push(el('tr', { class: `tg-step state-${step.state}` }, el('th', { scope: 'row', text: step.label }),
          el('td', { text: countCell(step.live) }), el('td', { text: step.state === 'landed' ? countCell(step.now) || (step.now?.passed ? 'passed' : 'failed') : step.state === 'running' ? 'running' : '' }),
          el('td', { text: stepCompareWords(step) }),
          el('td', null, took(step.now?.ms), step.live?.ms ? el('span', { class: 'muted', text: ` ${live ? 'release ' + live : 'live'}: ${took(step.live.ms)}` }) : null)));
      }
    }
    const tableNode = el('div', { class: 'table-scroll' }, el('table', { class: 'tg-run' },
      el('thead', null, el('tr', null, ['Step', live ? `Release ${live}` : 'Live', 'Candidate', live ? `Compared with release ${live}` : 'Compared', 'Took'].map(text => el('th', { scope: 'col', text })))),
      el('tbody', null, rows)));
    const parts = [head, facts];
    for (const item of candidate.worse) {
      const worse = el('div', { class: 'tg-worse' }, el('p', null, el('strong', { text: item.name }), `: ${item.why}`,
        typeof item.now === 'number' ? ` (${number(item.now)}${item.unit ? ' ' + item.unit : ''}, was ${number(item.base)})` : ''),
      item.fix_topic ? el('p', null, 'Being fixed in ', topicLink(item.fix_topic), '. Nothing here needs you.') : null,
      item.accepted ? el('p', { class: 'tg-accepted', text: `${item.accepted.by} accepted it: “${item.accepted.why}”` }) : null);
      if (candidate.you_accept && !item.accepted && item.kind === 'failed' && candidate.run_id) worse.append(this.acceptForm(view, item, candidate));
      parts.push(worse);
    }
    if (candidate.likely_cause) parts.push(el('p', { text: `Likely cause: ${(candidate.likely_cause.items ?? []).map(n => 'item ' + n).join(', ')}, from runs without it.` }));
    if (candidate.account) parts.push(el('p', { class: 'muted' }, `${candidate.account.by}: “${candidate.account.excerpt}”`));
    parts.push(tableNode);
    return el('section', { class: 'tg-card tg-candidate', 'aria-label': candidate.label }, parts);
  }

  // D31: shipping a worse result is deliberate, so the fold opens first; then one or two sentences, and Return accepts it.
  acceptForm(view, item, candidate) {
    const key = item.check_id;
    if (!this.accepting.has(key)) this.accepting.set(key, { words: '', busy: false, error: '' });
    const draft = this.accepting.get(key);
    const why = reasonBox(draft, { 'data-key': 'accept-why:' + key, maxlength: '2000', 'aria-label': 'Why you accept this worse result', placeholder: 'Why the trade is worth it, in a sentence or two' });
    const fold = this.folds.details('accept:' + key, false, { class: 'tg-accept' }, 'Ship it anyway: accept this worse result',
      el('p', { class: 'muted', text: 'Only a worse measure can be accepted, by you, at this commit. Your words are kept beside the result; the target does not change.' }),
      why, reasonFoot(draft, ACCEPT_KEYS));
    why.addEventListener('keydown', reasonKeys(() => this.sendAccept(key, candidate.run_id), () => {
      if (draft.busy) return;
      this.folds.chosen.set('accept:' + key, false);
      fold.open = false;
      fold.querySelector('summary').focus();
    }));
    return fold;
  }

  async sendAccept(checkId, runId) {
    const draft = this.accepting.get(checkId), view = this.view;
    if (!draft || draft.busy) return;
    if (!draft.words.trim()) { draft.error = ACCEPT_WHY_FIRST; this.paint(); return; }
    draft.busy = true; draft.error = ''; this.paint();
    try {
      await sent(this.send, 'check.accept_worse', { workspace_id: view.workspace_id, check_id: checkId }, { run_id: runId, why: draft.words },
        { checks_revision: view.relevant_versions.checks });
      this.accepting.delete(checkId);
      await this.load();
    } catch (failure) {
      draft.busy = false; draft.error = failure.message;
      this.paint();
    }
  }

  paintProblems(view) {
    const host = this.hosts.problems, problems = view.problems;
    if (!problems) { host.hidden = true; return; }
    host.hidden = false;
    const releases = problems.releases.filter(release => release.problems?.length);
    const body = releases.map(release => el('div', { class: 'tg-problem-release' },
      el('h3', { text: `Release ${release.release}` }), el('span', { class: 'muted', text: `${plural(release.counts.defect + release.counts.design_miss, 'found', 'found')} · ${release.closed} closed` }),
      el('ul', { class: 'tg-problems' }, release.problems.map(problem => el('li', null,
        el('p', null, chip(PROBLEM_KIND[problem.kind]), ' ', el('strong', { text: problem.what })),
        el('p', { class: 'muted' }, `Found by ${problem.found_by === this.reader ? 'you' : problem.found_by}, `,
          problem.source.kind === 'message' && problem.source.readable ? topicLink({ id: problem.source.topic_id, title: problem.source.topic_title }, problem.source.topic_title) : problem.source.kind === 'note' ? `in a note: ${problem.source.text}` : 'in a message you cannot read',
          ', ', time(problem.found_ms)),
        el('p', { class: 'tg-cover' }, el('strong', { text: 'Check that now covers it: ' }), problem.cover ? problem.cover.words || (problem.cover.item ? `item ${problem.cover.item.number}` : '') : 'no check yet',
          problem.closed ? ` Closed: shown to fail without the fix.` : '. Closed once that check is shown to fail without the fix.'))))));
    replaceKeepingFocus(host, this.folds.details('problems', false, { class: 'tg-problems-fold' },
      [el('span', { class: 'tg-section', text: 'Problems found before a check' }), el('span', { class: 'muted', text: problemsHeadline(problems) })],
      el('p', { class: 'muted', text: 'Each problem found in the live app before any check caught it, under the release it was found in. A defect: the code did not do what was decided. A design miss: it did what was decided, and that was wrong. Fewer per release is the aim.' }),
      body.length ? body : el('p', { class: 'muted', text: 'None found yet.' })));
  }
}

// The Measurements page: every check's readings by release, with a chart where they carry numbers.
export class MeasurementsPage {
  constructor({ host, header, workspace, read }) {
    Object.assign(this, { host, header, workspace, read });
    this.older = [];
  }

  async load() {
    try {
      const [view, readings] = await Promise.all([this.read('outcome_checks', { workspace_id: this.workspace }), this.read('check_readings', { workspace_id: this.workspace })]);
      this.header.eyebrow.textContent = view.workspace_id;
      this.header.title.textContent = `Measurements: ${view.workspace_title}`;
      this.header.description.textContent = 'Every check of this outcome, with each reading by release and what produced it.';
      this.paint(view, readings);
      return true;
    } catch (error) {
      this.host.replaceChildren(el('p', { class: 'notice', text: `The measurements could not be read: ${error.message}` }));
      return false;
    }
  }

  paint(view, readings) {
    const byGroup = new Map();
    for (const check of readings.checks) {
      if (!byGroup.has(check.group_name)) byGroup.set(check.group_name, []);
      byGroup.get(check.group_name).push(check);
    }
    const parts = [el('p', null, el('a', { href: '?' + new URLSearchParams({ workspace: view.workspace_id }), text: `← ${view.workspace_title}` })),
      el('p', null, chip(WORD[view.word] ?? 'No target yet', 'word-' + view.word), ' ', view.target?.text ?? '')];
    for (const [name, checks] of byGroup) {
      parts.push(el('h2', { class: 'tg-section', text: name }));
      for (const check of checks) {
        const rows = check.readings.map(reading => el('tr', null, el('th', { scope: 'row' }, reading.label), el('td', null, time(reading.at_ms)),
          el('td', { text: reading.words }), el('td', { class: 'muted', text: reading.source === 'reported' ? `Reported${reading.note ? ': ' + reading.note : ''}` : reading.source === 'found-problems' ? 'Problems filed' : reading.note || 'The release check' })));
        parts.push(el('section', { class: 'tg-card tg-measure' }, el('div', { class: 'tg-head' }, el('h3', { text: check.name }), statusChip(check.status)),
          check.proves ? el('p', { class: 'muted', text: provesWords(check.proves) }) : null,
          check.rule ? el('p', { class: 'muted', text: ruleWords(check.rule, view.loop?.live?.release) }) : null,
          check.chart ? checkChart(check) : null,
          rows.length ? el('div', { class: 'table-scroll' }, el('table', null, el('thead', null, el('tr', null, ['Reading', 'When', 'Result', 'What produced it'].map(text => el('th', { scope: 'col', text })))), el('tbody', null, rows)))
            : el('p', { class: 'muted', text: check.pending_words || 'No readings yet.' }),
          check.explain ? el('p', { class: 'muted', text: check.explain }) : null));
      }
    }
    if (view.problems) parts.push(el('h2', { class: 'tg-section', text: 'Problems found before a check' }), problemsChart(view.problems));
    this.host.replaceChildren(...parts);
  }
}

// D10: the outcome's target as one closed line at the top of a topic, opening to its words.
export function paintTopicTarget(host, target, open) {
  if (!target) { host.hidden = true; host.replaceChildren(); return; }
  host.hidden = false;
  const wasOpen = host.querySelector('details')?.open ?? false;
  const details = el('details', { class: 'tg-topic-line' }, el('summary', null, el('span', { class: 'tg-eyebrow', text: 'Target' }), ' ', chip(WORD[target.word] ?? 'No target yet', 'word-' + target.word),
    el('span', { class: 'muted', text: ` ${target.workspace_title}${target.counts.total ? ` · ${groupCounts(target.counts)}` : ''}` })),
  el('p', { class: 'tg-text', text: target.text ?? 'No target written yet.' }),
  el('p', null, el('a', { href: '?' + new URLSearchParams({ workspace: target.workspace_id }), text: `Open ${target.workspace_title}`, onclick: open })));
  details.open = wasOpen;
  host.replaceChildren(details);
}
