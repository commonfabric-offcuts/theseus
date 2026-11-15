import assert from 'node:assert/strict';

// The form rule, on every page and dialog of the fixture, in the real browser
// against the real server, at 1440 and 390 wide. Getting something in is one
// line or one tap, never a form, so a page fails here when:
//   - a one-line text box is wider than 32rem (about a sentence);
//   - a text box for a few sentences is wider than 40rem;
//   - a box for a name, or a filter of names, is wider than 14rem;
//   - a choice of four or fewer is a <select>, or visible round buttons;
//   - people or options are a stack of checkboxes rather than names tapped once;
//   - a button is stretched well beyond its words;
//   - a chip that toggles does not say whether it is on (aria-pressed).
// Writing a message is not a form: the composers (#writing-body,
// #inline-writing-body, #opening-body) are left out of the width limits, and
// so are rows that are whole cards or list entries (a topic in the rail, a
// message card). Every press is a native input event.
//
// On release 20 this fails on: #outcome-title-input (54rem), the New outcome
// purpose box (54rem), its team name box (50rem); #opening-title-input
// (54rem), the participant checkbox tiles, Add image stretched to 54rem; the
// Reader's "To topic" dropdown of one topic (48rem); the Reader's and the
// topic composer's Address boxes (45rem, ~57rem); and the People row's
// "Add a name" box (38rem at 1280).

// The audit, run in the page: every visible control that breaks the rule.
export const AUDIT = `(() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const shown = e => (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : e.getClientRects().length > 0) && !e.closest('[inert]');
  const describe = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '') +
    (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : '') + (e.placeholder ? '{' + e.placeholder + '}' : '');
  const rems = e => e.getBoundingClientRect().width / rem;
  const WRITING = new Set(['writing-body', 'inline-writing-body', 'opening-body']);
  const ROWS = '#workspaces,#topics,.topic-list,#messages,#memory-items,#outcome-references-list,.waiting-list,#sent-to-you,#waiting-on-you,#unfinished-work,.message-card,.memory-card,.nav-item';
  const nameBox = e => e.hasAttribute('list') || e.classList.contains('name-filter') || Boolean(e.closest('.people-add,.actor-choices,.audience')) ||
    /\\b(name|names|filter|find|someone|recipient)\\b/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.placeholder || ''));
  const out = [];
  for (const e of document.querySelectorAll('input')) {
    if (!shown(e) || ['checkbox', 'radio', 'file', 'hidden', 'button', 'submit', 'reset', 'color', 'range', 'image'].includes(e.type)) continue;
    const name = nameBox(e), limit = name ? 14 : 32, w = rems(e);
    if (w > limit + .05) out.push({ rule: name ? 'name box wider than 14rem' : 'one-line box wider than 32rem', control: describe(e), rem: +w.toFixed(1) });
  }
  for (const e of document.querySelectorAll('textarea')) {
    if (!shown(e) || WRITING.has(e.id)) continue;
    const w = rems(e);
    if (w > 40.05) out.push({ rule: 'text box wider than 40rem', control: describe(e), rem: +w.toFixed(1) });
  }
  for (const e of document.querySelectorAll('select')) {
    if (!shown(e)) continue;
    const choices = [...e.options].filter(option => option.value !== '').length;
    if (choices <= 4) out.push({ rule: 'a choice of ' + choices + ' as a dropdown', control: describe(e) });
  }
  const groups = (selector, key) => {
    const found = new Map();
    for (const e of document.querySelectorAll(selector)) if (shown(e)) { const k = key(e); found.set(k, [...(found.get(k) ?? []), e]); }
    return found;
  };
  for (const [k, group] of groups('input[type=radio],[role=radio]', e => e.name || e.closest('[role=radiogroup],fieldset,div') || e.parentElement)) {
    if (group.length <= 4) out.push({ rule: 'a choice of ' + group.length + ' as round buttons', control: describe(typeof k === 'string' ? group[0] : k) });
  }
  for (const [k, group] of groups('input[type=checkbox]', e => (e.closest('label') ?? e).parentElement)) {
    if (group.length >= 2) out.push({ rule: group.length + ' checkboxes where names tapped once belong', control: describe(k) });
  }
  for (const e of document.querySelectorAll('button')) {
    if (!shown(e) || e.closest(ROWS)) continue;
    const text = e.textContent.trim();
    if (!text) continue;
    const range = document.createRange(); range.selectNodeContents(e);
    const label = range.getBoundingClientRect().width, w = e.getBoundingClientRect().width;
    if (w > label * 2 && w - label > 5 * rem) out.push({ rule: 'button stretched beyond its words', control: describe(e) + ' “' + text.slice(0, 40) + '”', rem: +(w / rem).toFixed(1), words: +(label / rem).toFixed(1) });
    if (e.classList.contains('choice-chip') && !e.hasAttribute('aria-pressed') && !e.hasAttribute('aria-expanded')) out.push({ rule: 'a chip that does not say whether it is on', control: describe(e) });
  }
  return out;
})()`;

export async function formChecks({ check, page, until, control, view, facts, shot }) {
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const phone = async p => {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  };
  const desk = p => p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // The audit at both widths; a failure names every control that broke the rule, and where.
  const audit = async (p, where) => {
    const found = [];
    for (const [width, size] of [[1440, desk], [390, phone]]) {
      await size(p);
      await p.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      for (const item of await p.evaluate(AUDIT)) found.push({ where: `${where} at ${width}`, ...item });
      await shot(p, `forms-${where.replace(/[^a-z0-9]+/gi, '-')}-${width}`);
    }
    await desk(p);
    assert.deepEqual(found, [], `${where}: ${found.length} control(s) break the form rule\n${found.map(item => JSON.stringify(item)).join('\n')}`);
  };
  const press = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await p.point(selector);
  };
  const ready = p => until(() => quiet(p, `document.body.dataset.ready === 'true'`), 'the page is ready');
  const go = async (p, href) => { await p.send('Page.navigate', { url: facts.origin + href }); await ready(p); };

  await check('forms the audit names a box too wide, a short dropdown, round buttons, checkboxes and a stretched button', async () => {
    // The known-bad control: each broken rule, drawn on a real page, is named.
    const p = await page('forms-control', null, true);
    const found = await p.evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'forms-known-bad'; host.style.cssText = 'position:fixed;inset:0;background:var(--paper);z-index:9;overflow:auto;padding:1rem';
      host.innerHTML = '<input id="bad-line" style="width:54rem"><input id="bad-name" placeholder="Add a name" style="width:30rem">' +
        '<textarea id="bad-text" style="width:48rem"></textarea><select id="bad-select"><option value="">Choose</option><option value="a">A</option></select>' +
        '<div><label><input type="radio" name="r">One</label><label><input type="radio" name="r">Two</label></div>' +
        '<div><label><input type="checkbox">aim-core</label><label><input type="checkbox">Warp</label></div>' +
        '<button id="bad-button" type="button" style="display:block;width:54rem">Add image</button>' +
        '<button id="bad-chip" type="button" class="choice-chip">Waiting</button>' +
        '<input id="good-line" style="width:30rem"><textarea id="writing-body" style="width:50rem"></textarea><button type="button">Done</button>';
      // Only the known-bad controls count: the page behind them is inert, which the audit leaves out.
      for (const node of document.body.children) node.inert = true;
      document.body.append(host);
      return ${AUDIT}.map(item => item.rule).sort();
    })()`);
    assert.deepEqual(found, ['2 checkboxes where names tapped once belong', 'a chip that does not say whether it is on', 'a choice of 1 as a dropdown', 'a choice of 2 as round buttons',
      'button stretched beyond its words', 'name box wider than 14rem', 'one-line box wider than 32rem', 'text box wider than 40rem'].sort(), 'every known-bad control is named, and the writing box and the good line are not');
    await p.close();
  });

  await check('forms the Outcomes page and its New outcome line keep to the rule', async () => {
    const p = await page('forms-outcomes', null, true, { url: facts.origin + '/' });
    await audit(p, 'Outcomes');
    await press(p, '#new-outcome');
    await until(() => quiet(p, `document.activeElement?.id === 'new-outcome-title'`), 'New outcome opens one title line, focused');
    assert.equal(await p.evaluate(`document.querySelector('#new-outcome').getAttribute('aria-expanded')`), 'true');
    await audit(p, 'New outcome line');
    await p.key('Escape');
    await until(() => quiet(p, `!document.querySelector('#new-outcome-title') && document.activeElement?.id === 'new-outcome'`), 'Escape closes the line and the focus goes back');
    await p.close();
  });

  await check('forms an outcome page, its New topic line, its purpose and its team keep to the rule', async () => {
    const p = await page('forms-outcome', null, true, { url: facts.origin + '/?workspace=w1' });
    await audit(p, 'Outcome page');
    await press(p, '#new-topic');
    await until(() => quiet(p, `document.activeElement?.id === 'new-topic-title'`), 'New topic opens one title line, focused');
    await audit(p, 'New topic line');
    await p.key('Escape');
    // The owner says what the outcome is for, in place.
    const purpose = await p.evaluate(`[...document.querySelectorAll('#outcome-purpose button')].find(b=>!b.hidden)?.textContent`);
    assert.ok(['Add a purpose', 'Edit purpose'].includes(purpose), 'the owner can set the purpose in place: ' + purpose);
    await press(p, '#outcome-purpose button.text-action');
    await until(() => quiet(p, `document.activeElement?.id === 'outcome-purpose-input'`), 'the purpose box opens, focused');
    await audit(p, 'Outcome purpose');
    await p.key('Escape');
    // The team's "+ Add" opens the people not yet in as names tapped once.
    await press(p, '#team-people .add-chip');
    await until(() => quiet(p, `!document.querySelector('#team-people .people-add').hidden`), 'the people to add to the team are shown');
    await audit(p, 'Team, adding');
    await p.close();
  });

  await check('forms a topic page, its Team and its composer keep to the rule', async () => {
    const p = await page('forms-topic', null, true);
    await audit(p, 'Topic page');
    await press(p, '#participants .add-chip');
    await until(() => quiet(p, `!document.querySelector('#participants .people-add').hidden`), 'the people to add are shown');
    await audit(p, 'Topic Team, adding');
    // Topic settings is its own piece and ships as it is; it is not audited here.
    await p.close();
  });

  await check('forms the Reader on a message, on a Notebook page, its note and its Start a topic line keep to the rule', async () => {
    const body = 'Should the release go out on Friday? Everyone has checked it.';
    const asked = await control({ method: 'agent_message', operation_id: 'forms-question', body });
    const card = `#messages [data-id="${asked.result.message_id}"]`;
    const p = await page('forms-reader', null, true);
    await until(() => quiet(p, `Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the message is drawn');
    await press(p, card);
    await until(() => quiet(p, `document.querySelector('#reader').open`), 'the Reader opens');
    await audit(p, 'Reader reply');
    await press(p, '#start-from-message');
    await until(() => quiet(p, `document.activeElement?.id === 'start-topic-title'`), 'one title line, focused');
    assert.equal(await p.evaluate(`document.querySelector('#start-topic-title').value`), 'Should the release go out on Friday?', 'filled from the first sentence of the message');
    await audit(p, 'Start a topic line');
    await p.key('Escape');
    assert.equal(await p.evaluate(`document.querySelector('#reader').open`), true, 'Escape in the line closes the line, not the Reader');
    await press(p, '#toggle-note');
    assert.equal(await p.evaluate(`document.querySelector('#send-reply').textContent.trim()`), 'Done', 'a note that saves as it is written finishes with Done');
    await audit(p, 'Reader private note');
    await p.close();
    const n = await page('forms-notebook', null, true);
    await until(() => quiet(n, `Boolean(document.querySelector('#memory-items .memory-card'))`), 'the Notebook card is drawn');
    // A Notebook page as it stands opens in the composer over the feed; at a revision, in the Reader.
    const item = await n.evaluate(`document.querySelector('#memory-items .memory-card').dataset.id`);
    await press(n, '#memory-items .memory-card');
    await until(() => quiet(n, `document.querySelector('#new-message-sheet.notebook-mode')?.open && Boolean(document.querySelector('#new-message-sheet .notebook-sheet-page:not([hidden])')) && document.querySelector('#notebook-sheet-title').textContent.trim() !== ''`), 'the composer opens on the Notebook page');
    await audit(n, 'Notebook page in the composer');
    const revision = (await view('memory_current', { item_id: item })).source_ref.revision;
    await go(n, `/?topic=t1&page=${encodeURIComponent(item)}&revision=${revision}`);
    await until(() => quiet(n, `document.querySelector('#reader').open`), 'the Reader opens on the Notebook page at its revision');
    await audit(n, 'Reader on a Notebook page');
    await n.close();
  });

  await check('forms a resumed opening and a resumed outcome form keep to the rule', async () => {
    const p = await page('forms-resumed', null, true, { url: facts.origin + '/' });
    const opening = await p.evaluate(`import('/topic-navigation.mjs').then(m=>m.routeHref({kind:'opening',workspace:'w1',opening:'forms-opening',topic:'forms-opening-topic'}))`);
    await go(p, '/' + opening);
    await audit(p, 'Resumed opening');
    const outcome = await p.evaluate(`import('/topic-navigation.mjs').then(m=>m.routeHref({kind:'create',intent:'forms-intent'}))`);
    await go(p, '/' + outcome);
    await audit(p, 'Resumed outcome form');
    await p.close();
  });
}
