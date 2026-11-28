// Each row owns one on-demand read. Its revision, topic and connection to the
// open dossier must still match when the source arrives.
const parts = new WeakMap();
const unavailable = 'Changes for this revision are unavailable.';

function element(doc, tag, name, text) {
  const node = doc.createElement(tag);
  if (name) node.className = name;
  if (text) node.textContent = text;
  return node;
}

export function makeEditEcho(doc, id, jump) {
  const row = element(doc, 'div', 'edit-echo'), controls = element(doc, 'div', 'edit-echo-controls');
  const toggle = element(doc, 'button', 'reply-echo edit-echo-toggle', 'Changes');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', id);
  const panel = element(doc, 'div', 'edit-echo-diff');
  panel.id = id; panel.setAttribute('role', 'status'); panel.hidden = true;
  controls.append(jump, toggle);
  row.append(controls, panel);
  parts.set(row, { toggle, panel, key: null, request: 0 });
  return row;
}

function close(state) {
  state.request++;
  state.toggle.setAttribute('aria-expanded', 'false');
  state.panel.replaceChildren();
  state.panel.hidden = true;
}

function paintDiff(panel, source, echo, item, latest) {
  const diff = source?.edit_echo?.diff, doc = panel.ownerDocument;
  if (source?.source_ref?.kind !== 'message' || source.source_ref.id !== item.id ||
      source.topic_id !== item.topic_id || source.withheld || source.removal ||
      source.edit_echo?.group_revision !== echo.group_revision || source.edit_echo.revision !== echo.revision ||
      (latest && source.revision !== item.revision) || !diff ||
      !Array.isArray(diff.cuts) || !Array.isArray(diff.added)) {
    panel.textContent = unavailable; return;
  }
  const cuts = diff.cuts.map(change => change?.words).filter(words => typeof words === 'string' && words);
  const additions = diff.added.map(change => {
    if (typeof change?.words === 'string') return change.words;
    if (typeof source.body === 'string' && diff.to_revision === source.revision &&
        Number.isSafeInteger(change?.start) && Number.isSafeInteger(change.end) &&
        change.start >= 0 && change.start < change.end && change.end <= source.body.length)
      return source.body.slice(change.start, change.end);
    return '';
  }).filter(Boolean);
  panel.replaceChildren();
  for (const [label, tag, words] of [['Before', 'del', cuts], ['After', 'ins', additions]]) {
    if (!words.length) continue;
    const line = element(doc, 'p', 'edit-echo-change');
    line.append(element(doc, 'strong', '', label), element(doc, tag, '', words.join(' … ')));
    panel.append(line);
  }
  if (!panel.firstChild) panel.textContent = unavailable;
}

export function activateEditEcho(row, item, echo, latest, read) {
  const state = parts.get(row), { panel, toggle } = state;
  const key = JSON.stringify([item.topic_id, item.revision, echo.revision, latest]);
  if (key !== state.key) { state.key = key; close(state); }
  toggle.setAttribute('aria-label', `Show changes to message #${item.seq}, revision ${echo.revision}`);
  toggle.onclick = async () => {
    if (!panel.hidden) { close(state); return; }
    const request = ++state.request;
    toggle.setAttribute('aria-expanded', 'true');
    panel.textContent = 'Loading changes…'; panel.hidden = false;
    const current = () => row.isConnected && !panel.hidden && state.request === request;
    const ref = { kind: 'message', id: item.id, ...(!latest ? { edit_echo_revision: echo.revision } : {}) };
    try {
      const source = await read(ref);
      if (current()) paintDiff(panel, source, echo, item, latest);
    } catch {
      if (current()) panel.textContent = unavailable;
    }
  };
}
