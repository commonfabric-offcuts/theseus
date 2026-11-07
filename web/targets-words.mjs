// Every word the target, the checks, the improvement loop and the Measurements
// page say (items 14, 12, 104; docs/targets.md). Pure: facts in, words out.

export const WORD = {
  on_target: 'On target', not_on_target: 'Not on target yet', not_there: 'Not there yet', reached: 'Reached',
};
export const STATUS = {
  passing: 'Passing', failing: 'Failing', measured: 'Measured', holding: 'Holding', not_run: 'Not run yet', waiting: 'Waiting on you',
};
const STATUS_COUNT = {
  passing: n => `${n} passing`, failing: n => `${n} failing`, measured: n => `${n} measured`, holding: n => `${n} holding`,
  not_run: n => `${n} not run yet`, waiting: n => `${n} waiting on you`,
};
const ORDER = ['failing', 'waiting', 'passing', 'holding', 'measured', 'not_run'];

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const number = n => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(n));

export function list(parts) {
  if (parts.length < 2) return parts.join('');
  return parts.slice(0, -1).join(', ') + (parts.length > 2 ? ',' : '') + ' and ' + parts[parts.length - 1];
}

// "2 passing", "3 measured, 3 not run yet": a group's summary line.
export function groupCounts(counts) {
  return ORDER.filter(name => counts[name] > 0).map(name => STATUS_COUNT[name](counts[name])).join(', ');
}

// The sentence under the target: the word, as the checks say it (14 "Being built, as the checks say").
export function standingSentence({ word, kind, counts, failing, reachOffered, title }) {
  if (word === 'reached') return null;
  const parts = [];
  if (counts.failing) parts.push(`${counts.failing} ${counts.failing === 1 ? 'fails' : 'fail'}`);
  if (counts.passing) parts.push(`${counts.passing} ${counts.passing === 1 ? 'passes' : 'pass'}`);
  if (counts.holding) parts.push(`${counts.holding} ${counts.holding === 1 ? 'meets its target' : 'meet their targets'} two rounds in a row`);
  if (counts.measured) parts.push(`${counts.measured} ${counts.measured === 1 ? 'has readings and has not met a target yet' : 'have readings and have not met a target yet'}`);
  if (counts.not_run) parts.push(`${counts.not_run} ${counts.not_run === 1 ? 'has' : 'have'} never run`);
  if (counts.waiting) parts.push(`${counts.waiting} ${counts.waiting === 1 ? 'waits' : 'wait'} on your answers`);
  if (!counts.total) {
    return kind === 'reach'
      ? `${WORD[word] ?? 'No target yet'}: nothing checks this outcome yet, so it is reached when you say so.`
      : 'Nothing checks this outcome yet, so Theseus says nothing about whether it is on target.';
  }
  let first = `${WORD[word]}, as the checks say: ${list(parts)}.`;
  if (failing) first = `${WORD[word]}: “${failing.name}” fails${failing.label ? ` at ${failing.label}` : ''}. The checks say: ${list(parts)}.`;
  const then = kind === 'reach'
    ? (reachOffered ? `Every check passes and every measure is met. Is ${title} reached?` : 'It reads Reached when you say so; Theseus offers it once every check passes and every measure is met.')
    : 'It reads On target once every check passes and every measure meets its target two releases in a row.';
  return `${first} ${then}`;
}

export function kindWords(kind) {
  return kind === 'reach' ? 'An outcome to reach: it ends when you say it is reached.' : 'An outcome to keep: it goes on, on target while its checks pass.';
}

// "Written by fable from the evaluation record, Nov 5 · unchanged since"
export function bylineWords(target, day) {
  if (!target?.text) return '';
  const origin = target.origin_note ? ` ${target.origin_note}` : '';
  return `Written by ${target.written_by}${origin}${day ? ', ' + day : ''} · ${target.changed_since ? 'changed since its first words' : 'unchanged since'}`;
}

export function fractionWords(tolerance) {
  const named = [[0.2, 'a fifth'], [0.25, 'a quarter'], [0.5, 'a half'], [0.1, 'a tenth'], [0.75, 'three quarters']];
  for (const [value, word] of named) if (Math.abs(tolerance - value) < 1e-9) return word;
  const tenths = Math.round(tolerance * 10);
  if (Math.abs(tolerance * 10 - tenths) < 1e-9 && tenths > 0) return `${tenths} tenths`;
  return `${Math.round(tolerance * 100)} hundredths`;
}

// D29: the rule written on a measure. "Worse when both of 2 runs are more than a fifth slower than both of release 19's."
export function ruleWords(rule, liveRelease) {
  if (!rule || rule.tolerance === null || rule.tolerance === undefined) return '';
  const against = liveRelease ? `release ${liveRelease}'s` : "the live release's";
  const way = rule.better === 'higher' ? 'lower' : 'slower';
  const runs = rule.repeats > 1 ? `both of ${rule.repeats} runs are` : 'its run is';
  const theirs = rule.repeats > 1 ? `both of ${against}` : against;
  return `Worse when ${runs} more than ${fractionWords(rule.tolerance)} ${way} than ${theirs}.`;
}

export const STEP_GROUP = { units: 'Unit checks', measures: 'Measures', browser: 'Browser checks, one at a time' };

export function stepCompareWords(step) {
  if (step.state === 'running') return 'Running';
  if (step.state === 'waiting') return 'Waits its turn';
  if (step.compare === 'new') return 'New step';
  if (step.now && step.now.passed === false) return 'Fails';
  if (step.compare === 'more') return '✓ ' + step.note;
  if (step.compare === 'fewer') return 'Fewer pass';
  return '✓ Same';
}

export function countCell(part) {
  if (!part) return '';
  if (typeof part.pass === 'number' && typeof part.total === 'number') return part.pass === part.total ? `${number(part.pass)} pass` : `${number(part.pass)} of ${number(part.total)}`;
  return '';
}

export function took(ms) {
  if (typeof ms !== 'number') return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export const CANDIDATE_STATE = { running: 'Running its checks', passed: 'Nothing got worse', stopped: 'Stopped: something got worse', accepted: 'Worse, and accepted' };

// The four steps of "How each change is checked" (104), filled in with where the newest change is.
export function loopSteps(loop) {
  const live = loop?.live?.release;
  const candidate = loop?.candidate;
  const liveName = live ? `release ${live}` : 'the live release';
  const steps = [
    { title: 'A change is proposed', now: candidate ? `${candidate.label}${candidate.items?.length ? ': ' + plural(candidate.items.length, 'pipeline item', 'pipeline items') : ''}` : 'Nothing is being checked now.' },
    { title: "It runs this outcome's checks", now: candidate ? `${plural(candidate.steps.filter(s => s.state === 'landed').length, 'step has', 'steps have')} results${candidate.steps_total ? ` of ${candidate.steps_total}` : ''}.` : '' },
    { title: `Each result lands here, beside ${liveName}'s`, now: candidate ? (candidate.worse.length ? plural(candidate.worse.length, 'result is worse', 'results are worse') : 'None worse so far.') : '' },
    { title: 'Worse stops it. Otherwise it ships and leaves its checks behind', now: loop?.left_behind ? `Release ${loop.left_behind.release} left ${number(loop.left_behind.now - loop.left_behind.before)} more cases behind than release ${loop.left_behind.from_release} for “${loop.left_behind.name}”: ${number(loop.left_behind.now)}, from ${number(loop.left_behind.before)}.` : '' },
  ];
  return steps;
}

function releaseProblems(release) {
  const total = release.counts.defect + release.counts.design_miss;
  if (!total) return `Release ${release.release}: none found${release.state === 'live' ? ' so far' : ''}`;
  const kinds = [];
  if (release.counts.design_miss) kinds.push(plural(release.counts.design_miss, 'design miss', 'design misses'));
  if (release.counts.defect) kinds.push(plural(release.counts.defect, 'defect', 'defects'));
  return `Release ${release.release}: ${total} found, ${list(kinds)}, ${release.closed} closed yet`;
}

// The live release's count, and the newest earlier release that had any.
export function problemsHeadline(problems) {
  const counted = (problems?.releases ?? []).filter(r => r.counts);
  const live = counted.find(r => r.state === 'live');
  if (!live) return '';
  const earlier = counted.find(r => r.state === 'shipped' && r.counts.defect + r.counts.design_miss > 0);
  return [releaseProblems(live), earlier && !(live.counts.defect + live.counts.design_miss) ? releaseProblems(earlier) : null].filter(Boolean).join(' · ');
}

export const PROBLEM_KIND = { defect: 'Defect', design_miss: 'Design miss' };

// D8: writing the target in place. The button, what Save does for this writer, and the ask it sends when needed.
export function writeButtonWords({ hasTarget, youOwn }) {
  if (!hasTarget) return 'Write the target';
  return youOwn ? 'Change the words' : 'Propose new words';
}
export function writeHowWords({ hasTarget, youOwn, owner }) {
  if (youOwn) return hasTarget ? 'Your words are the target as soon as you save. The earlier words are kept.' : 'Your words are the target as soon as you save.';
  if (!hasTarget) return `Your words are the target as soon as you save; ${owner} can change them.`;
  return `${owner} decides on new words. Saving asks ${owner} in:`;
}
export const WRITE_KEYS = 'Return saves · Shift+Return for a new line · Esc cancels';
// The two deliberate reasons: Reached, and shipping a worse result. Return sends the words; nothing is sent without them.
export const REACH_KEYS = 'Return marks it reached · Shift+Return for a new line · Esc for not yet';
export const ACCEPT_KEYS = 'Return accepts it · Shift+Return for a new line · Esc closes';
export const REACH_WHY_FIRST = 'Say why it is reached first, in your own words.';
export const ACCEPT_WHY_FIRST = 'Say why the trade is worth it first, in your own words.';
export const askWords = text => `New words for the target, for you to use or keep the current ones (on the outcome page):\n\n${text}`;
export const provesWords = proves => `Proves: “${proves}”`;
export const NO_CHECKS = 'No checks yet. The agents add them, and each one says which words of the target it proves.';

// No target words yet: who writes them, and (to keep, without checks) that nothing is said about being on target.
export function noTargetWords({ hasChecks, kind, youSteer, coordinator, owner }) {
  const who = youSteer ? 'You write' : coordinator ? `${coordinator}, this outcome's coordinator, writes` : `${owner}, this outcome's owner, writes`;
  if (hasChecks) return `No target words yet. ${who} them.`;
  const after = kind === 'keep' ? ' Until it has checks, Theseus says nothing about whether this outcome is on target.' : '';
  return `No target yet. A target is a few sentences saying what done looks like, plus the checks that prove it. ${who} it.${after}`;
}
