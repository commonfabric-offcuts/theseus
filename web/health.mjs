import { shownTime, datedTime } from './times.mjs';
import { feedLost } from './health-light.mjs';

// The Health page (docs/health.md): what is wrong, in plain words at the top,
// then one line each for the agent runner, the server, every agent, the Mac
// and the latest release, each opening in place for its details. Every line
// is read from the health view; the page reads it again on every commit and
// keeps what it said when a read fails.

const count = n => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const list = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const at = (ms, now) => shownTime(ms, now);
const faultWords = fault => fault ? ` (${fault.exception_class}: ${fault.message})` : '';
// Agents whose failures began this close together began failing for one reason.
const TOGETHER_MS = 2 * 60 * 1000;

// Why the runner ended or paused, and why a wake did not get through, are
// Core's words (runner.why, failing.why; health.py), so the page, the agent
// command line and the notices posted to the team all say the same.
const ROUTE = { codex_queue: "the Codex app's queue", codex_hosted: 'a Codex turn this Theseus hosts', other: 'a route of its own' };

// Whether the Mac's 1-minute load is above its core count; never when either could not be read.
const overloaded = machine => Boolean(machine?.load && machine.cpus && machine.load[0] > machine.cpus);

// A health answer the page can say anything from: what is red, the runner and
// the agents. Anything else is a read that failed, never "nothing is wrong".
export function readable(answer) {
  return Array.isArray(answer?.red) && typeof answer.runner === 'object' && answer.runner !== null && Array.isArray(answer.agents);
}

// How the runner stands, as a phrase after "The agent runner".
export function runnerPhrase(runner, now) {
  const since = Number.isInteger(runner.since_ms) ? at(runner.since_ms, now) : null;
  if (runner.live) return Number.isInteger(runner.started_ms) ? `has been running since ${at(runner.started_ms, now)}` : 'is running';
  if (runner.state === 'paused') return `has been paused${since ? ` since ${since}` : ''} because ${runner.why ?? 'of a reason it did not record'}${faultWords(runner.fault)}`;
  if (runner.state === 'stopped') return `was stopped${since ? ` at ${since}` : ''} and has not come back`;
  if (runner.state === 'exited') return `${runner.why ?? 'ended'}${since ? ` at ${since}` : ''} and has not come back`;
  if (runner.state === 'unrenewed') return `stopped answering${since ? ` at ${since}` : ''}`;
  return 'has never run here';
}

// How the run before this one ended, as "after it was stopped at 2:30 PM".
function priorPhrase(prior, now) {
  const when = Number.isInteger(prior.ended_ms) ? ` at ${at(prior.ended_ms, now)}` : '';
  if (prior.state === 'paused') return `after a pause${when} because ${prior.why ?? 'of a recorded reason'}${faultWords(prior.fault)}`;
  if (prior.state === 'stopped') return `after it was stopped${when}`;
  if (prior.state === 'exited') return `after it ${prior.why ?? 'ended'}${when}`;
  if (prior.state === 'unrenewed') return `after it stopped answering${when}`;
  return '';
}

// "every wake since 8:27 PM failed", and why, in Core's words.
function failedPhrase(failing, now) {
  const since = Number.isInteger(failing.since_ms) ? ` since ${at(failing.since_ms, now)}` : '';
  return failing.outcome === 'error' ? `every wake${since} failed` : `no wake${since} has got through`;
}
const why = failing => `Why: ${failing.why}.`;

// What is wrong, as sentences, most urgent first; [] when nothing is.
// behind: the answer is from before the live feed last came back, and the read after it has not answered.
export function healthProblems(answer, { now, feed, behind = false } = {}) {
  const problems = [];
  const agents = answer.agents ?? [];
  const routedWaiting = agents.filter(agent => agent.route && agent.waiting > 0);
  // The Health link says it could not check, or is checking, by the same rules (health-light.mjs).
  if (feedLost(feed)) problems.push('This page has lost its live connection to the server, so what it shows may be out of date.');
  else if (behind) problems.push('This page is reading Health again now that its live connection is back, so what it shows may be out of date.');
  // Red is Core's one rule (answer.red), which the Health link reads too.
  const red = new Set(answer.red ?? []);
  if (red.has('runner')) {
    const waiting = routedWaiting.length ? ` ${plural(routedWaiting.length, 'agent has', 'agents have')} work waiting.` : '';
    problems.push(`The agent runner ${runnerPhrase(answer.runner, now)}, so no wakes are going out.${waiting}`);
  }
  // Agents that cannot be woken, grouped by when their failures began and why.
  const failing = agents.filter(agent => agent.failing).sort((a, b) => (a.failing.since_ms ?? 0) - (b.failing.since_ms ?? 0));
  const groups = [];
  for (const agent of failing) {
    const group = groups[groups.length - 1];
    if (group && Math.abs((agent.failing.since_ms ?? 0) - (group[0].failing.since_ms ?? 0)) <= TOGETHER_MS && (agent.failing.reason ?? agent.failing.outcome) === (group[0].failing.reason ?? group[0].failing.outcome)) group.push(agent);
    else groups.push([agent]);
  }
  for (const group of groups) {
    const many = group.length > 1, names = group.map(agent => agent.actor_id).sort();
    const counts = group.map(agent => agent.failing.count), low = Math.min(...counts), high = Math.max(...counts);
    const times = low === high ? `${count(high)} ${high === 1 ? 'time' : 'times'}${many ? ' each' : ''}` : `${count(low)} to ${count(high)} times`;
    let words = `${list(names)} can't be woken: ${failedPhrase(group[0].failing, now)} (${times}). ${why(group[0].failing)}`;
    const waiting = group.filter(agent => agent.waiting > 0).sort((a, b) => b.waiting - a.waiting || a.actor_id.localeCompare(b.actor_id));
    if (waiting.length) {
      const [first, ...rest] = waiting;
      words += ` ${plural(first.waiting, 'message is', 'messages are')} waiting for ${first.actor_id}${rest.length ? `, ${list(rest.map(agent => `${count(agent.waiting)} for ${agent.actor_id}`))}` : ''}.`;
    }
    if (many) words += ' Their failures began together, so the cause is something they share, not any one agent.';
    const routes = new Set(group.map(agent => agent.route));
    // Core says when the app is where to look (failing.ask_app_open); an answer from before it said so asks.
    if (routes.size === 1 && routes.has('codex_queue') && group.every(agent => agent.failing.ask_app_open !== false)) {
      words += ` ${many ? 'Their wakes all go' : 'Its wakes go'} through the Codex app's queue, so look there first: is the ChatGPT app open?`;
    }
    problems.push(words);
  }
  for (const agent of agents.filter(agent => agent.not_answering && !agent.failing)) {
    const item = agent.not_answering;
    problems.push(`${agent.actor_id} has not answered its last ${count(item.count)} wakes${Number.isInteger(item.since_ms) ? `, since ${at(item.since_ms, now)}` : ''}; ${plural(agent.waiting, 'message waits', 'messages wait')} for it.`);
  }
  const machine = answer.machine;
  if (overloaded(machine)) {
    problems.push(`The Mac is overloaded: its load is ${machine.load[0]} on ${machine.cpus} cores, so everything here may be slow.`);
  }
  return problems;
}

// One agent's line and its details.
function agentLines(agent, now, sending) {
  const waiting = agent.waiting > 0
    ? `${count(agent.waiting)} waiting${Number.isInteger(agent.waiting_since_ms) ? ` since ${at(agent.waiting_since_ms, now)}` : ''}` : 'nothing waiting';
  const state = agent.execution ? ({idle:'idle',working:'working',waiting:'waiting for a reply',stopping:'stopping',stopped:'stopped',failed:'last turn failed',unavailable:'runtime unavailable'}[agent.execution.state] ?? 'state unavailable') : agent.failing ? "can't be woken" : agent.not_answering ? 'not answering' : agent.waking ? 'being woken now'
    : !agent.route ? 'not woken here' : agent.waiting > 0 ? 'wakes going out' : 'all caught up';
  const details = [];
  const replacement = agent.execution?.replacement;
  const age = (now ?? Date.now()) - replacement?.committed_ms;
  const replaced = Number.isInteger(replacement?.committed_ms) && age >= 0 && age < 24 * 60 * 60 * 1000
    && typeof replacement?.old?.thread_id === 'string' && typeof replacement?.new?.thread_id === 'string';
  if (agent.execution) {
    details.push(agent.execution.desired === 'stopped' ? 'Work stays queued. Continue resumes this same agent context.' : 'This agent keeps its Codex context across deliveries and restarts.');
    if (agent.execution.failure && !agent.failing) details.push(`Last failure: ${agent.execution.failure}.`);
    const last = agent.execution.last_finished;
    if (last) details.push(`Last turn ${last.status} at ${at(last.finished_ms, now)}.`);
    if (replaced) {
      details.push(`Context replaced at ${at(replacement.committed_ms, now)}. ${replacement.reason}`);
      details.push(`Previous context: ${replacement.old.thread_id}. Current context: ${replacement.new.thread_id}.`);
      if (Array.isArray(replacement.turns)) details.push(`Triggering turns: ${replacement.turns.join(', ')}.`);
    }
    const recovery = agent.execution.recovery_state;
    if (recovery && recovery !== 'committed') {
      const words = { ready: 'is ready', creating: 'is creating a context', created: 'has a context awaiting setup confirmation',
        prepared: 'is ready to activate', uncertain: 'is unconfirmed', cancelled: 'was cancelled', invalid: 'has an invalid record' };
      details.push(`Context recovery ${words[recovery] ?? 'has an unavailable status'}.`);
    }
  }
  if (agent.failing) details.push(`${failedPhrase(agent.failing, now).replace(/^./, c => c.toUpperCase())} (${plural(agent.failing.count, 'time')}). ${why(agent.failing)}`);
  if (agent.wake_read?.why) details.push(`${agent.wake_read.why}.`);
  // Health's own facts only: what the scheduler then does is its own (docs/effects-runner.md).
  if (agent.not_answering) details.push(`Its last ${count(agent.not_answering.count)} wakes reached it and it has not answered since ${at(agent.not_answering.since_ms, now)}.`);
  if (agent.route) {
    details.push(`Woken through ${ROUTE[agent.route]}.`);
    details.push(Number.isInteger(agent.reached_ms) ? `A wake last got through at ${at(agent.reached_ms, now)}.` : 'No wake has got through yet.');
    // A next wake is said only while a runner sends them.
    if (sending && agent.execution?.desired !== 'stopped' && Number.isInteger(agent.next_due_ms)) details.push(agent.next_due_ms <= now ? 'Its next wake is due now.' : `Its next wake is at ${at(agent.next_due_ms, now)}.`);
    if (!sending && agent.execution?.desired !== 'stopped' && agent.waiting > 0) details.push('It is woken again once the agent runner is back.');
  } else {
    details.push('This Theseus has no route to wake it: it reads its work when it looks.');
  }
  return { summary: `${agent.actor_id} — ${state} · ${waiting}${replaced ? ' · context replaced' : ''}`, details, agent: agent.actor_id, execution:agent.execution, bad: Boolean(agent.failing || agent.not_answering) };
}

// The page's lines, from one health answer: [{group, key, label, summary, details, bad}].
export function healthLines(answer, { now, feed } = {}) {
  const lines = [];
  const runner = answer.runner;
  const runnerDetails = [];
  if (runner.live && runner.prior) runnerDetails.push(`It came back at ${at(runner.started_ms, now)} ${priorPhrase(runner.prior, now)}.`.replace(' .', '.'));
  if (runner.live && runner.resumed_because === 'cleanup_confirmed') runnerDetails.push('It resumed on its own once it confirmed a stuck broker process was gone.');
  if (!runner.live && runner.prior) runnerDetails.push(`Before that it had come back ${priorPhrase(runner.prior, now)}.`);
  if (runner.live && !runner.prior) runnerDetails.push('Core has no record of how its previous run ended.');
  if (!runner.live) runnerDetails.push('Wakes go out again once a runner takes the role; the supervisor brings it back on its own only after a crash it recorded.');
  lines.push({ group: 'Theseus', key: 'runner', label: 'Agent runner', summary: runnerPhrase(runner, now).replace(/^./, c => c.toUpperCase()), details: runnerDetails, bad: (answer.red ?? []).includes('runner') });
  const server = answer.server;
  if (server) {
    const live = feedLost(feed) ? 'live updates lost' : server.live_feed ? 'live updates on' : 'no live updates';
    const details = [`It serves database version ${answer.schema_version}.`];
    if (Number.isInteger(server.database_busy_last_minute)) details.push(`${server.database_busy_last_minute} database-busy replies in the last minute. This count resets when the server restarts.`);
    if (!server.live_feed) details.push('Without live updates, this page and the Health link read again only when opened or shown, and a runner that stops answering is told to the team by the next act, not at the moment.');
    lines.push({ group: 'Theseus', key: 'server', label: 'Server', summary: `Answering since ${at(server.started_ms, now)} · ${live}`, details, bad: feedLost(feed) });
  }
  for (const agent of answer.agents ?? []) lines.push({ group: 'Agents', key: `agent:${agent.actor_id}`, label: null, ...agentLines(agent, now, runner.live) });
  // The Mac's load and core count are each said, or said to be unreadable; never left out.
  const machine = answer.machine ?? { load: null, cpus: null };
  const cores = machine.cpus ? `${machine.cpus} cores` : 'a core count that could not be read';
  if (machine.load) {
    const [one, five, fifteen] = machine.load, busy = machine.cpus ? one / machine.cpus : null;
    const word = busy === null ? 'how busy is not known' : busy > 1 ? 'overloaded' : busy > 0.7 ? 'busy' : 'light';
    lines.push({ group: 'This Mac and releases', key: 'machine', label: 'This Mac', summary: `Load ${one} on ${cores} · ${word}`,
      details: [`${one} over the last minute, ${five} over 5 minutes, ${fifteen} over 15. Read at ${at(answer.read_ms, now)}, when this page last read Health.`], bad: overloaded(machine) });
  } else {
    lines.push({ group: 'This Mac and releases', key: 'machine', label: 'This Mac', summary: `Its load could not be read · ${cores}`,
      details: [`The Mac did not give its load when this page last read Health, at ${at(answer.read_ms, now)}; it is read again with the next change.`], bad: false });
  }
  const release = answer.release;
  if (release) {
    const details = [];
    const check = release.check, train = release.train, scoped = release.scoped;
    const native = check?.native ? `${count(check.native.pass)} of ${count(check.native.total)} browser` : null;
    const parts = check ? [check.python != null && `${count(check.python)} Python`, check.node != null && `${count(check.node)} Node`, native].filter(Boolean) : [];
    if (train) {
      // A release from a merged train (items 481, 482): no release check ran here, so none is said to have passed.
      const first = train.kind === 'judged-first';
      details.push(`It came from a merged train${first ? ' judged before its merge' : ''}, so no release check ran here.`);
      details.push(train.judgment === 'judged'
        ? `${first ? 'That' : 'Its hosted'} judgment: ${count(train.succeeded)} of ${count(train.total)} runs and checks succeeded.`
        : 'Its hosted judgment is still pending.');
    } else if (parts.length) {
      // A small fix deployed on a scoped run (item 608) says which browser steps ran, and its full run: pending, or what it found.
      if (scoped) details.push(`It deployed on a scoped run: ${count(scoped.ran)} of ${count(scoped.steps)} browser steps, the ones its files touch, beside the units, the deploy's refusals and the wake replay.`);
      // Only counts a release check kept are said to have passed; a check with none of them said nothing.
      details.push(`Its release check${Number.isInteger(check.finished_ms) ? ` finished at ${datedTime(check.finished_ms)}` : ''}: ${list(parts)} checks passed.`);
      if (scoped) details.push(scoped.judgment === 'judged' ? `Its full run: ${count(scoped.succeeded)} of ${count(scoped.total)} runs and checks succeeded.` : 'Its full run is still pending.');
    } else {
      details.push('No release check summary was kept for it.');
    }
    if (release.items.length) details.push(`It shipped pipeline ${release.items.length === 1 ? 'item' : 'items'} ${list(release.items.map(String))}.`);
    lines.push({ group: 'This Mac and releases', key: 'release', label: 'Latest release', summary: `Release ${release.release} went live at ${at(release.deployed_ms, now)}`, details, bad: false });
  } else {
    lines.push({ group: 'This Mac and releases', key: 'release', label: 'Latest release', summary: 'No release is recorded yet', details: [], bad: false });
  }
  return lines;
}

export class HealthPage {
  constructor({ host, read, control = null, feed = () => null, now = () => Date.now(), doc = host.ownerDocument }) {
    Object.assign(this, { host, read, control, feed, now, doc });
    this.controlling = new Set(); this.controlError = null;
    this.answer = null; this.open = new Set(); this.failed = false;
    // The commit the answer is true at, and the commit the live feed named when it last came back (health-light.mjs).
    this.seq = -1; this.known = -1; this.floor = -1;
  }

  // A live feed event: the number it came back with, or a commit.
  heard(event) {
    if (Number.isSafeInteger(event?.seq)) {
      this.known = Math.max(this.known, event.seq);
      if (event.kind === 'state' && event.state === 'live') this.floor = event.seq;
    }
    if (event?.kind === 'state') this.paint();
  }

  async load() {
    const started = this.known;
    try {
      const answer = await this.read();
      if (!readable(answer)) throw new Error('Health could not be read: the answer did not say what is red.');
      this.answer = answer;
      // A server that does not name the commit: the commit known when the read began.
      this.seq = Number.isSafeInteger(answer.commit_seq) ? answer.commit_seq : started;
      this.failed = false;
    } catch (error) {
      this.failed = error?.message || 'Health could not be read.';
    }
    this.paint();
    return !this.failed;
  }

  el(tag, text, className) {
    const node = this.doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  paint() {
    // Lines opened stay open across reads.
    for (const details of this.host.querySelectorAll('details[data-key]')) {
      if (details.open) this.open.add(details.dataset.key); else this.open.delete(details.dataset.key);
    }
    const parts = [];
    if (this.controlError) parts.push(this.el('p', this.controlError, 'notice'));
    if (this.failed) parts.push(this.el('p', this.answer ? `${this.failed} What is shown is from the last read.` : this.failed, 'notice'));
    if (!this.answer) { this.host.replaceChildren(...parts); return; }
    const now = this.now(), feed = this.feed();
    const problems = healthProblems(this.answer, { now, feed, behind: this.seq < this.floor });
    const top = this.el('section', undefined, problems.length ? 'health-top health-bad' : 'health-top');
    top.setAttribute('aria-label', 'What needs attention');
    top.setAttribute('role', 'status');
    if (problems.length) for (const words of problems) top.append(this.el('p', words));
    else top.append(this.el('p', 'Everything is working: the agent runner is sending wakes and they are getting through.'));
    parts.push(top);
    let group = null;
    const lines = this.el('div', undefined, 'health-lines');
    for (const line of healthLines(this.answer, { now, feed })) {
      if (line.group !== group) { group = line.group; lines.append(this.el('h2', group, 'health-heading')); }
      const details = this.el('details', undefined, line.bad ? 'health-line bad' : 'health-line');
      details.dataset.key = line.key;
      details.open = this.open.has(line.key);
      const summary = this.el('summary');
      if (line.label) summary.append(this.el('span', `${line.label}: `, 'health-label'));
      summary.append(this.el('span', line.summary));
      details.append(summary);
      if (this.control && line.execution?.can_control) {
        const desired = line.execution.desired === 'stopped' ? 'running' : 'stopped';
        const button = this.el('button', desired === 'running' ? 'Continue' : 'Stop');
        button.dataset.agentControl = line.agent;
        button.disabled = this.controlling.has(line.agent);
        button.onclick = async () => {
          if (this.controlling.has(line.agent)) return;
          this.controlling.add(line.agent); this.controlError = null; button.disabled = true;
          try {
            const receipt = await this.control(line.agent, desired, line.execution.execution_revision);
            if (receipt?.status !== 'committed') throw new Error(receipt?.error?.message ?? 'The change could not be confirmed. Read the current state and try again.');
          } catch (error) { this.controlError = error?.message ?? 'The change could not be confirmed.'; }
          finally { this.controlling.delete(line.agent); await this.load(); }
        };
        details.append(button);
      }
      if (line.execution?.work) {
        const work=line.execution.work, link=this.el('a',line.execution.state==='waiting'?'Open the question':'Open queued work');
        link.href='/?'+new URLSearchParams({topic:work.topic_id,message:work.message_id});
        const row=this.el('p');row.append(link);details.append(row);
      }
      for (const words of line.details) details.append(this.el('p', words, 'muted'));
      lines.append(details);
    }
    parts.push(lines);
    this.host.replaceChildren(...parts);
  }
}
