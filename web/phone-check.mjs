import { Attention } from './attention.mjs';

// The phone check (docs/device-evidence.md): a short walk through what only a
// person's own phone can show. Each step asks for one thing, the page writes
// down what the phone did, and the last tap posts it to a topic as a message.
// Nobody types the evidence; the person's only words are a yes or no where
// only their eyes can tell (a notification showed, the colours read clearly).

export const ASKED = { name: 'fable', words: 'the harbour lights' };
const NAMES = ['aim-core', 'aim-spec', 'aim-ux', 'fable'];
const PASSAGE = 'Fable checks the harbour lights each night before the boats come in.';

const luminance = color => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  .map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

const yesNo = value => value === true ? 'yes' : value === false ? 'no' : 'not answered';
// One plain line per step, as the topic shows it; the full record follows as JSON.
export function summaryLines(record) {
  const { page, names, longPress, keyboard, notification, colours } = record;
  const skipped = step => step?.skipped ? 'skipped' : null;
  return [
    page && `This page: ${page.origin} (${page.https ? 'https' : 'not https'}${page.tailnet ? ', over the tailnet' : ''}), signed in as ${page.actor} on ${page.instance}; first tap by ${page.startPointer ?? 'unknown'}; ${page.viewport.width}×${page.viewport.height} at ${page.dpr}x, ${page.scheme} scheme${page.standalone ? ', from the Home Screen' : ''}.`,
    names && `Names list: ${skipped(names) ?? `${names.value === ASKED.name ? `got ${ASKED.name} as asked` : `got "${names.value}", asked for ${ASKED.name}`}, ${names.inputType === 'insertReplacementText' || names.inputType === undefined ? 'picked from the list' : `by ${names.inputType}`}; zoom ${names.scaleBefore} → ${names.scaleAfter}`}.`,
    longPress && `Holding to select: ${skipped(longPress) ?? `selected "${longPress.selected}"${longPress.selected === ASKED.words ? ' as asked' : `, asked for "${ASKED.words}"`}; longest hold ${longPress.longestPressMs ?? 'none'} ms; ${longPress.selectionChanges} selection changes`}.`,
    keyboard && `Keyboard: ${skipped(keyboard) ?? `visible height ${keyboard.visualBefore} → ${keyboard.visualSmallest} px${keyboard.resized ? ' when the keyboard came up' : ' (no resize seen)'}; the box ${keyboard.boxInView ? 'stayed' : 'did not stay'} in view and Send ${keyboard.sendInView ? 'stayed' : 'did not stay'} in view; handles selected "${keyboard.selected?.text ?? ''}"`}.`,
    notification && `Notification: ${skipped(notification) ?? (notification.api === 'absent' ? 'this browser offers web pages no notifications' : `permission ${notification.permissionBefore} → ${notification.permissionAfter}; ${notification.error ? `showing it failed (${notification.error})` : notification.shown ? 'shown' : 'not shown'}; you saw it: ${yesNo(notification.saw)}${notification.clicked ? '; you tapped it' : ''}`)}.`,
    colours && `Reading colours: ${skipped(colours) ?? `${colours.scheme} scheme; your card ${colours.own.contrast}:1, an agent's card ${colours.agent.contrast}:1; reads easily: ${yesNo(colours.clear)}`}.`,
  ].filter(Boolean);
}

export function evidenceBody(record) {
  return ['Phone check: what this phone did, written down by the phone check page (nobody typed it).', '',
    ...summaryLines(record).map(line => '- ' + line), '', '```json', JSON.stringify(record, null, 1), '```'].join('\n');
}

export function postEnvelope({ bootstrap, topicId, operationId, body }) {
  return { v: 1, instance_id: bootstrap.instance_id, operation_id: operationId, kind: 'message.post', target: { topic_id: topicId },
    expected: { authority: { authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch } },
    args: { body } };
}

const el = (doc, tag, props = {}, ...children) => { const node = Object.assign(doc.createElement(tag), props); node.append(...children); return node; };

export async function phoneCheck({ api, bootstrap, topicId, doc = document, win = window, notifications = globalThis.Notification,
  operationId = 'phone-check-' + crypto.randomUUID() }) {
  const record = {};
  const visual = () => ({ width: Math.round(win.visualViewport?.width ?? win.innerWidth), height: Math.round(win.visualViewport?.height ?? win.innerHeight),
    scale: Math.round((win.visualViewport?.scale ?? 1) * 100) / 100, top: Math.round(win.visualViewport?.offsetTop ?? 0) });
  const media = query => Boolean(win.matchMedia?.(query).matches);
  const main = el(doc, 'main', { id: 'phone-check', className: 'phone-check' },
    el(doc, 'h1', { textContent: 'Phone check' }),
    el(doc, 'p', { className: 'muted', textContent: 'A few minutes. Each step asks for one thing, and this page writes down what your phone did. Nothing is sent until the last step.' }));
  doc.body.replaceChildren(main);
  doc.title = 'Phone check · Theseus';
  const steps = [];
  // A step is one section: its words, its controls, and once done, what was recorded.
  const step = (id, title, words, ...controls) => {
    const done = el(doc, 'p', { className: 'phone-check-done' }); done.hidden = true;
    const skip = el(doc, 'button', { type: 'button', className: 'quiet', textContent: 'Skip this step' });
    const section = el(doc, 'section', { id: 'check-' + id, className: 'phone-check-step' }, el(doc, 'h2', { textContent: title }),
      el(doc, 'p', { textContent: words }), ...controls, skip, done);
    section.hidden = true; main.append(section);
    const entry = { id, section, done, skip, finish: null };
    entry.finish = (key, value) => {
      if (entry.finished) return; entry.finished = true;
      record[key] = value;
      section.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = true; });
      skip.hidden = true;
      done.textContent = '✓ ' + (summaryLines({ [key]: value })[0] ?? 'Recorded.');
      done.hidden = false;
      const next = steps[steps.indexOf(entry) + 1];
      if (next) { next.section.hidden = false; next.shown?.(); next.section.scrollIntoView?.({ block: 'start' }); }
    };
    steps.push(entry); return entry;
  };

  // 0. This page itself, over the tailnet, and the tap that starts it.
  const start = el(doc, 'button', { type: 'button', className: 'primary', id: 'check-start', textContent: 'Start' });
  let startPointer = null;
  start.addEventListener('pointerdown', event => { startPointer = event.pointerType; });
  main.append(start);

  // 1. The names list: the box that addresses someone in a reply, and the list the phone offers for it.
  const list = el(doc, 'datalist', { id: 'phone-check-names' }, ...NAMES.map(name => el(doc, 'option', { value: name })));
  const nameInput = el(doc, 'input', { id: 'check-name', className: 'name-filter', placeholder: 'Someone else', autocomplete: 'off' });
  nameInput.setAttribute('list', list.id); nameInput.setAttribute('aria-label', 'Name someone');
  const names = step('names', 'The names list', `Tap the box, then pick ${ASKED.name} from the names your phone offers. It is the box you use to address someone in a reply.`,
    el(doc, 'div', { className: 'audience' }, el(doc, 'span', { className: 'muted', textContent: 'Address' }), nameInput), list);
  const nameFacts = { asked: ASKED.name, offered: NAMES, scaleBefore: null, scaleAfter: null, fontSize: null, inputs: [] };
  nameInput.addEventListener('focus', () => { nameFacts.scaleBefore ??= visual().scale; nameFacts.fontSize = win.getComputedStyle(nameInput).fontSize; });
  nameInput.addEventListener('input', event => {
    nameFacts.inputs.push(event.inputType ?? null);
    if (NAMES.includes(nameInput.value)) names.finish('names', { ...nameFacts, value: nameInput.value, inputType: event.inputType, scaleAfter: visual().scale });
  });
  names.skip.onclick = () => names.finish('names', { ...nameFacts, skipped: true });

  // 2. Holding to select words, and the handles that change the selection.
  const passage = el(doc, 'article', { id: 'check-passage', textContent: PASSAGE });
  const passagePane = el(doc, 'div', { className: 'reading-pane phone-check-passage' }, passage);
  const keepSelection = el(doc, 'button', { type: 'button', id: 'check-selection', textContent: 'That is my selection' });
  const longPress = step('long-press', 'Holding to select', `Press and hold on "harbour" until it is selected, then drag the handles so "${ASKED.words}" is selected.`, passagePane, keepSelection);
  const pressFacts = { asked: ASKED.words, selected: '', longestPressMs: null, pointerTypes: [], contextMenus: 0, selectionChanges: 0 };
  let pressedAt = null;
  passage.addEventListener('pointerdown', event => { pressedAt = event.timeStamp; pressFacts.pointerTypes.push(event.pointerType); });
  const released = event => { if (pressedAt !== null) pressFacts.longestPressMs = Math.max(pressFacts.longestPressMs ?? 0, Math.round(event.timeStamp - pressedAt)); pressedAt = null; };
  passage.addEventListener('pointerup', released); passage.addEventListener('pointercancel', released);
  passage.addEventListener('contextmenu', () => { pressFacts.contextMenus++; });
  doc.addEventListener('selectionchange', () => {
    const selection = doc.getSelection();
    if (!selection?.rangeCount || !passage.contains(selection.anchorNode) || !passage.contains(selection.focusNode)) return;
    pressFacts.selectionChanges++;
    if (selection.toString()) pressFacts.selected = selection.toString();
  });
  keepSelection.onclick = () => longPress.finish('longPress', { ...pressFacts });
  longPress.skip.onclick = () => longPress.finish('longPress', { ...pressFacts, skipped: true });

  // 3. The keyboard: what it leaves visible, and the handles inside a writing box.
  const box = el(doc, 'textarea', { id: 'check-writing', rows: 3, placeholder: 'Type a few words' });
  const send = el(doc, 'button', { type: 'button', className: 'primary', id: 'check-send-lookalike', textContent: 'Send', tabIndex: -1 });
  send.setAttribute('aria-hidden', 'true');
  const recordKeyboard = el(doc, 'button', { type: 'button', id: 'check-record-keyboard', textContent: 'Record the keyboard' });
  const keyboard = step('keyboard', 'The keyboard', 'Tap the box so the keyboard comes up, type a few words, then hold on one word and use the handles to select it.',
    el(doc, 'div', { className: 'inline-composer phone-check-writing' }, box, el(doc, 'div', { className: 'writing-footer' }, send)), recordKeyboard);
  const keyFacts = { innerBefore: null, visualBefore: null, visualSmallest: null, resized: false, boxInView: null, sendInView: null, scaleAfter: null, typed: 0, selected: null };
  const inView = node => { const r = node.getBoundingClientRect(), v = visual(); return r.top >= v.top - 0.5 && r.bottom <= v.top + v.height + 0.5; };
  box.addEventListener('focus', () => {
    if (keyFacts.visualBefore === null) { keyFacts.visualBefore = visual().height; keyFacts.innerBefore = win.innerHeight; keyFacts.visualSmallest = visual().height; }
  });
  win.visualViewport?.addEventListener('resize', () => {
    if (keyFacts.visualBefore === null || doc.activeElement !== box) return;
    const now = visual();
    if (now.height < keyFacts.visualSmallest) {
      keyFacts.visualSmallest = now.height; keyFacts.resized = true;
      keyFacts.boxInView = inView(box); keyFacts.sendInView = inView(send); keyFacts.scaleAfter = now.scale; keyFacts.innerAfter = win.innerHeight;
    }
  });
  box.addEventListener('input', () => { keyFacts.typed = box.value.length; });
  const handles = () => { if (box.selectionEnd > box.selectionStart) keyFacts.selected = { start: box.selectionStart, end: box.selectionEnd, text: box.value.slice(box.selectionStart, box.selectionEnd) }; };
  box.addEventListener('select', handles); doc.addEventListener('selectionchange', () => { if (doc.activeElement === box) handles(); });
  recordKeyboard.onclick = () => {
    if (!keyFacts.resized) { keyFacts.boxInView = inView(box); keyFacts.sendInView = inView(send); keyFacts.scaleAfter = visual().scale; }
    keyboard.finish('keyboard', { ...keyFacts });
  };
  keyboard.skip.onclick = () => keyboard.finish('keyboard', { ...keyFacts, skipped: true });

  // 4. A notification, through the same code the topic page notifies with.
  const allow = el(doc, 'button', { type: 'button', id: 'check-notify', textContent: 'Allow and show a notification' });
  const saw = el(doc, 'button', { type: 'button', id: 'check-saw', textContent: 'It appeared' });
  const missed = el(doc, 'button', { type: 'button', id: 'check-missed', textContent: 'Nothing appeared' });
  const question = el(doc, 'p', { className: 'phone-check-question' }, 'Did a notification appear? ', saw, ' ', missed); question.hidden = true;
  const notify = step('notification', 'A notification', 'Tap below. If your phone asks whether Theseus may send notifications, allow it; a test notification should then appear.', allow, question);
  const notifyFacts = { api: typeof notifications === 'function' ? 'present' : 'absent', permissionBefore: notifications?.permission ?? null,
    permissionAfter: null, shown: false, error: null, clicked: false, saw: null };
  allow.onclick = async () => {
    allow.disabled = true;
    if (notifyFacts.api === 'absent') { notify.finish('notification', { ...notifyFacts }); return; }
    const attention = new Attention({ api: { view: () => Promise.reject(Error('not read here')) }, instanceId: bootstrap.instance_id, doc,
      notifications, open: () => { notifyFacts.clicked = true; } });
    try { notifyFacts.permissionAfter = await attention.ask(); } catch (error) { notifyFacts.error = `${error.name}: ${error.message}`; }
    notifyFacts.permissionAfter ??= notifications.permission;
    if (notifyFacts.permissionAfter === 'granted') {
      try {
        attention.notify({ id: 'phone-check', message: { author_id: 'fable', body: 'This is the phone check\'s test notification.' }, topic: { title: 'the phone check', title_truncated: false } });
        notifyFacts.shown = true;
      } catch (error) { notifyFacts.error = `${error.name}: ${error.message}`; }
    }
    question.hidden = false;
  };
  saw.onclick = () => notify.finish('notification', { ...notifyFacts, saw: true });
  missed.onclick = () => notify.finish('notification', { ...notifyFacts, saw: false });
  notify.skip.onclick = () => notify.finish('notification', { ...notifyFacts, skipped: true });

  // 5. The reading colours, on the page's own cards.
  const own = el(doc, 'article', { className: 'message-card own-message', id: 'check-own' },
    el(doc, 'span', { className: 'message-author', textContent: bootstrap.actor }), el(doc, 'span', { className: 'message-preview', textContent: 'Your own message: black, with light words.' }));
  const agent = el(doc, 'article', { className: 'message-card agent-card agent-green', id: 'check-agent' },
    el(doc, 'span', { className: 'message-author', textContent: 'fable' }), el(doc, 'span', { className: 'message-preview', textContent: 'An agent\'s message, in its colour.' }));
  const clear = el(doc, 'button', { type: 'button', id: 'check-clear', textContent: 'Both read easily' });
  const unclear = el(doc, 'button', { type: 'button', id: 'check-unclear', textContent: 'Not easily' });
  const colours = step('colours', 'Reading colours', 'Can you read both cards easily?', own, agent, el(doc, 'p', {}, clear, ' ', unclear));
  const paint = node => { const style = win.getComputedStyle(node); return { background: style.backgroundColor, color: style.color, contrast: contrast(style.color, style.backgroundColor) }; };
  const colourFacts = () => ({ scheme: media('(prefers-color-scheme: dark)') ? 'dark' : 'light', own: paint(own), agent: paint(agent) });
  clear.onclick = () => colours.finish('colours', { ...colourFacts(), clear: true });
  unclear.onclick = () => colours.finish('colours', { ...colourFacts(), clear: false });
  colours.skip.onclick = () => colours.finish('colours', { ...colourFacts(), skipped: true });

  // 6. Sending what was recorded: one message to the topic, read back after.
  const post = el(doc, 'button', { type: 'button', className: 'primary', id: 'check-post', textContent: 'Send to Theseus' });
  const summary = el(doc, 'ul', { id: 'check-summary' });
  const outcome = el(doc, 'p', { id: 'check-outcome', role: 'status' });
  const done = step('send', 'Send what your phone did', 'This is what goes to the topic, as one message from you.', summary, post, outcome);
  done.skip.hidden = true;
  done.shown = () => { summary.replaceChildren(...summaryLines(record).map(line => el(doc, 'li', { textContent: line }))); };
  let body = null;
  post.onclick = async () => {
    post.disabled = true; body ??= evidenceBody(record);
    outcome.textContent = 'Sending…';
    try {
      const receipt = await api.command(postEnvelope({ bootstrap, topicId, operationId, body }));
      if (receipt?.status !== 'committed' || !receipt.result?.message_id) throw Error(receipt?.error?.message ?? 'Theseus did not record the message.');
      const back = await api.view('source', { kind: 'message', id: receipt.result.message_id });
      const same = back?.body === body;
      outcome.textContent = same ? 'Sent, and read back from Theseus exactly. Thank you.' : 'Sent, but the copy read back differs. Tell fable.';
      main.dataset.sent = receipt.result.message_id;
    } catch (error) {
      // The same operation again: a send that did land is not repeated.
      outcome.textContent = `${error.message} Tap Send to Theseus to try again.`;
      post.disabled = false;
    }
  };

  start.onclick = () => {
    const v = visual();
    record.page = { origin: win.location.origin, https: win.location.protocol === 'https:', tailnet: win.location.hostname.endsWith('.ts.net'),
      actor: bootstrap.actor, instance: bootstrap.instance_id, startPointer, userAgent: win.navigator.userAgent,
      screen: { width: win.screen?.width ?? null, height: win.screen?.height ?? null }, dpr: win.devicePixelRatio,
      viewport: { width: win.innerWidth, height: win.innerHeight }, visual: v, touchPoints: win.navigator.maxTouchPoints ?? 0,
      coarse: media('(pointer: coarse)'), hoverNone: media('(hover: none)'), scheme: media('(prefers-color-scheme: dark)') ? 'dark' : 'light',
      standalone: media('(display-mode: standalone)') || win.navigator.standalone === true };
    start.disabled = true;
    const line = el(doc, 'p', { className: 'phone-check-done', textContent: '✓ ' + summaryLines({ page: record.page })[0] });
    start.after(line);
    steps[0].section.hidden = false;
  };
}
