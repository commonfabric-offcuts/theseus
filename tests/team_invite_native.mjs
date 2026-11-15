import assert from 'node:assert/strict';

// Inviting an agent from an outcome's Team panel (item 324,
// docs/agents.md "Inviting an agent"), in the real browser against the real
// server: one name line and two chips, Return invites, Core registers the
// agent and adds it to the team, the server writes its sign-in file (private,
// in the fixture's own sign-in folder) and the page shows the prompt to paste
// into the agent. Each state of the control (the line, Inviting…, a refusal,
// a sign-in file not written with Try again, the prompt, and none for a
// member who does not organise) has its own case, and every state is measured
// at 320, 375 and 390 by touch and on a laptop, in light and dark. Runs in the
// forms step (tests/reader_persistence_native.mjs --forms).

const PHONES = [[320, 568], [375, 667], [390, 844]];
// Every visible control of the Team panel's invite, and the prompt, measured
// where the page draws them.
const MEASURE = `(()=>{
  const shown=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const name=e=>e.id?'#'+e.id:(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).join('.'):e.tagName.toLowerCase())+(e.textContent.trim()?' “'+e.textContent.trim().slice(0,20)+'”':'');
  const controls=[...document.querySelectorAll('#team-invite button,#team-invite input')].filter(shown);
  const box=e=>{const b=e.getBoundingClientRect();return {name:name(e),x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom}};
  const rects=controls.map(box);
  const overlaps=[];
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],c=rects[j];
    if(a.x<c.right-.5&&c.x<a.right-.5&&a.y<c.bottom-.5&&c.y<a.bottom-.5)overlaps.push(a.name+' over '+c.name)}
  const pre=document.querySelector('#invite-prompt-text');
  const blocks=[...document.querySelectorAll('#team-invite .invite-line,#team-invite .invite-prompt,#team-invite .invite-state')].filter(shown).map(box);
  return {sideways:document.documentElement.scrollWidth-innerWidth,width:innerWidth,rects,overlaps,
    outside:[...rects,...blocks].filter(r=>r.x<-.5||r.right>innerWidth+.5).map(r=>r.name),
    promptSideways:pre&&shown(pre)?pre.scrollWidth-pre.clientWidth:0}})()`;

export async function teamInviteChecks({ check, page, until, control, view, facts, shot }) {
  const quiet = async (p, expression) => { try { return await p.evaluate(expression); } catch { return false; } };
  const visible = (p, selector) => quiet(p, `(e=>Boolean(e)&&e.getClientRects().length>0)(document.querySelector(${JSON.stringify(selector)}))`);
  const text = (p, selector) => p.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const focused = p => p.evaluate('document.activeElement?.id || document.activeElement?.className || null');
  const invites = (p, before = 0) => p.calls.slice(before).filter(call => call.payload?.kind === 'workspace.agent_invite').map(call => call.payload);
  let serial = 0;
  const outcome = async (title, more = {}) => {
    const id = `w-invite-${++serial}`;
    await control({ method: 'team_outcome', operation_id: `invite-outcome-${serial}`, workspace_id: id, title, ...more });
    return id;
  };
  const open = async (name, workspace) => {
    const p = await page(name, null, true, { url: `${facts.origin}/?workspace=${workspace}` });
    await until(() => visible(p, '#outcome-team'), 'the Team panel shows');
    return p;
  };
  const press = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await p.point(selector);
  };
  // A finger's tap, where the control is drawn and not covered.
  const tap = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const b = await p.box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible ${selector}`);
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${at.x},${at.y}))`), true, `${selector} is not covered where it is tapped`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const openLine = async (p, by = press) => {
    await by(p, '#invite-agent');
    await until(async () => await visible(p, '#invite-agent-name') && await focused(p) === 'invite-agent-name', 'the name line opens, focused');
  };
  const type = async (p, words) => {
    await p.point('#invite-agent-name'); await p.key('a', 4);
    await p.send('Input.insertText', { text: words });
    assert.equal(await p.evaluate(`document.querySelector('#invite-agent-name').value`), words);
  };
  const said = p => text(p, '#team-invite .invite-state');
  const files = () => control({ method: 'sign_in_files' });
  const pressed = p => p.evaluate(`[...document.querySelectorAll('#team-invite .invite-harness .choice-chip')].map(c=>c.textContent+':'+c.getAttribute('aria-pressed'))`);
  // The team as the panel draws it: one chip per member, by name.
  const teamNames = p => p.evaluate(`[...document.querySelectorAll('#team-people .chips > :not(.add-chip)')].map(c=>c.firstChild.textContent)`);
  const phone = async (p, width, height) => {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  };
  const laptop = async p => {
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  };
  const theme = (p, scheme) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const painted = p => p.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  // The state as it is drawn now, at every phone width by touch and on a laptop, in light and dark: nothing
  // scrolls sideways or reaches past the screen, no control covers another, the prompt wraps, and by touch
  // every control is at least 44px each way. Shots go to the evidence (the pull request's screenshots).
  const fits = async (p, state) => {
    const found = [];
    for (const [width, height, touch] of [...PHONES.map(([w, h]) => [w, h, true]), [1440, 900, false]]) {
      if (touch) await phone(p, width, height); else await laptop(p);
      for (const scheme of ['light', 'dark']) {
        await theme(p, scheme);
        await p.evaluate(`document.querySelector('#outcome-team').scrollIntoView({block:'start'})`);
        await painted(p);
        const m = await p.evaluate(MEASURE);
        const where = `${state} at ${width} ${scheme}`;
        if (m.sideways > 0) found.push(`${where}: the page scrolls sideways by ${m.sideways}px`);
        if (m.outside.length) found.push(`${where}: past the screen: ${m.outside.join(', ')}`);
        if (m.overlaps.length) found.push(`${where}: ${m.overlaps.join('; ')}`);
        if (m.promptSideways > 0) found.push(`${where}: the prompt scrolls sideways by ${m.promptSideways}px`);
        if (touch) for (const r of m.rects) if (r.w < 43.5 || r.h < 43.5) found.push(`${where}: ${r.name} is ${r.w.toFixed(0)}×${r.h.toFixed(0)}, under 44px to touch`);
        if (!m.rects.length) found.push(`${where}: nothing of the invite is drawn`);
        if ([320, 390, 1440].includes(width)) await shot(p, `invite-${state.replace(/[^a-z0-9]+/gi, '-')}-${width}-${scheme}`);
      }
    }
    await theme(p, 'light'); await laptop(p); await painted(p);
    assert.deepEqual(found, [], `${state}: ${found.length} layout fault(s)\n${found.join('\n')}`);
  };

  await check('forms invite an agent from the Team panel: a name, Codex, Return; it joins the team, its sign-in file is private, and the prompt names it, its file and the agent guide', async () => {
    const workspace = await outcome('Invite by pointer');
    const p = await open('invite-pointer', workspace);
    const before = (await files()).length;
    assert.deepEqual(await p.evaluate(`(b=>[b.textContent,b.title,b.getAttribute('aria-expanded')])(document.querySelector('#invite-agent'))`),
      ['+ Invite agent', 'Invite an agent to this outcome', 'false'], 'one short line, with its tooltip, closed');
    await openLine(p);
    assert.deepEqual(await pressed(p), ['Claude Code:true', 'Codex:false'], 'two chips, Claude Code to start with');
    assert.equal(await p.evaluate(`document.querySelector('#invite-agent').getAttribute('aria-expanded')`), 'true');
    // Escape puts the line away and gives the focus back; the opener opens it again.
    await p.key('Escape');
    await until(async () => !await visible(p, '#invite-agent-name') && await focused(p) === 'invite-agent', 'Escape closes the line, the focus on the opener');
    await openLine(p);
    await type(p, 'Release scribe');
    await press(p, '#team-invite [data-harness=codex]');
    assert.deepEqual(await pressed(p), ['Claude Code:false', 'Codex:true'], 'one tap chooses Codex');
    assert.equal(await focused(p), 'invite-agent-name', 'the focus goes back to the name, so Return invites');
    const sent = p.calls.length;
    await p.key('Enter');
    await until(() => visible(p, '#invite-prompt-text'), 'the prompt shows');
    const [request, ...more] = invites(p, sent);
    assert.deepEqual(more, [], 'one invitation');
    assert.deepEqual([request.target, request.args, request.expected.workspace_revision], [{ workspace_id: workspace }, { name: 'Release scribe', harness: 'codex' }, 1]);
    // Core keeps the agent on the outcome's team, and the panel shows it.
    const members = (await view('workspace_members', { workspace_id: workspace })).items.map(item => [item.actor_id, item.kind, item.name]);
    assert.deepEqual(members.find(item => item[0] === 'release-scribe'), ['release-scribe', 'agent', 'Release scribe']);
    await until(async () => (await teamNames(p)).includes('Release scribe'), 'the team shows the agent');
    // The sign-in file: one, private to this user, binding the new agent.
    const written = await files();
    assert.equal(written.length, before + 1);
    assert.deepEqual(written.find(file => file.name === 'release-scribe.profile.json'), { name: 'release-scribe.profile.json', mode: '0o600', regular: true, mine: true, actor: 'release-scribe' });
    // The prompt: who it is, where its sign-in file is, and to read the agent guide; never what the file holds.
    assert.equal(await text(p, '#team-invite .invite-said'), 'Release scribe is on the team. Paste this into Codex:');
    const words = await text(p, '#invite-prompt-text');
    for (const part of ['You are Release scribe, an agent in Theseus', 'You run in Codex.', 'Your Theseus ID is release-scribe; people address you as @release-scribe.',
      'the outcome “Invite by pointer”', '/sign-in/release-scribe.profile.json. It is private', 'docs/agent-guide.md', 'Then wait for work with `watch --once`']) {
      assert.ok(words.includes(part), `the prompt says ${part}: ${words}`);
    }
    const page = await p.evaluate('document.documentElement.outerHTML');
    for (const secret of await control({ method: 'secrets' })) assert.equal(page.includes(secret), false, 'the page never shows what the sign-in file holds');
    assert.equal(await focused(p), 'invite-copy', 'the focus is on the copy glyph');
    assert.deepEqual(await p.evaluate(`[...document.querySelectorAll('#team-invite .invite-copy,#team-invite .invite-close')].map(b=>[b.getAttribute('aria-label'),b.title])`),
      [['Copy the prompt', 'Copy the prompt'], ['Close the prompt', 'Close the prompt']], 'each glyph has its name and its tooltip');
    // The copy glyph puts the prompt on the page's own clipboard (the Mac's pasteboard is never touched).
    await p.evaluate(`(()=>{window.copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copied.push(text)}})})()`);
    await press(p, '#team-invite .invite-copy');
    await until(async () => (await text(p, '#team-invite .invite-copied')) === 'Copied', 'a quiet Copied');
    assert.deepEqual(await p.evaluate('window.copied'), [words]);
    await shot(p, 'invite-prompt-laptop');
    await press(p, '#team-invite .invite-close');
    await until(async () => !await visible(p, '#invite-prompt-text') && await focused(p) === 'invite-agent', 'the × closes the prompt, the focus on the opener');
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite a copy the browser refuses says so plainly and selects the prompt to copy by hand', async () => {
    const workspace = await outcome('Invite, copy refused');
    const p = await open('invite-copy-refused', workspace);
    await openLine(p); await type(p, 'Copy tester'); await p.key('Enter');
    await until(() => visible(p, '#invite-prompt-text'), 'the prompt shows');
    await p.evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new DOMException('Write permission denied.','NotAllowedError')}})`);
    await press(p, '#team-invite .invite-copy');
    await until(async () => (await text(p, '#team-invite .invite-copied')) === 'Copying was refused here. The prompt is selected: copy it with your keyboard or menu.', 'the refusal in plain words');
    assert.equal(await p.evaluate('getSelection().toString()'), await text(p, '#invite-prompt-text'), 'the whole prompt is selected');
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite a taken name is refused in plain words, the name kept and selected to change in place, and no file is written', async () => {
    const workspace = await outcome('Invite, a taken name');
    const p = await open('invite-taken', workspace);
    const before = await files();
    await openLine(p); await type(p, 'Fixture Notebook Agent');
    const sent = p.calls.length;
    await p.key('Enter');
    const refusal = 'There is already someone called Fixture Notebook Agent here. Choose another name, such as Fixture Notebook Agent 2.';
    await until(async () => (await said(p)) === refusal, 'the refusal in plain words');
    assert.equal(invites(p, sent).length, 1);
    assert.deepEqual(await p.evaluate(`(i=>[document.activeElement===i,i.value,i.selectionStart,i.selectionEnd,i.readOnly])(document.querySelector('#invite-agent-name'))`),
      [true, 'Fixture Notebook Agent', 0, 'Fixture Notebook Agent'.length, false], 'the name is kept, focused and selected');
    assert.equal(await visible(p, '#invite-prompt-text'), false, 'no prompt');
    assert.deepEqual(await files(), before, 'no sign-in file');
    await fits(p, 'a taken name');
    // Typing over the selection is the recovery: the next Return is a new invitation.
    await p.point('#invite-agent-name'); await p.key('a', 4);
    await p.send('Input.insertText', { text: 'Second scribe' });
    assert.equal(await said(p), '', 'typing clears the refusal');
    await p.key('Enter');
    await until(() => visible(p, '#invite-prompt-text'), 'the prompt shows');
    const [first, second] = invites(p, sent);
    assert.notEqual(second.operation_id, first.operation_id);
    assert.deepEqual(second.args, { name: 'Second scribe', harness: 'claude-code' });
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite once the person no longer organises the outcome, before the page has read it, Core refuses in plain words and nothing is written or shown', async () => {
    const workspace = await outcome('Invite, handed on', { team: [facts.agent] });
    const p = await open('invite-handed-on', workspace);
    const before = await files();
    await openLine(p); await type(p, 'Late helper');
    // The page reads nothing more: it still believes the person owns the outcome.
    p.intercept(payload => typeof payload?.name === 'string');
    await control({ method: 'outcome_change', operation_id: 'invite-handed-on-owner', sender: facts.actor, workspace_id: workspace, owner: facts.agent });
    await until(async () => (await view('workspace', { workspace_id: workspace })).workspace.owner_id === facts.agent, 'Core has the new owner');
    assert.equal(await visible(p, '#invite-agent'), true, 'the page still shows the invite');
    const sent = p.calls.length;
    await p.key('Enter');
    const refusal = 'Only the outcome\'s owner or its coordinator can invite an agent to it.';
    await until(async () => (await said(p)) === refusal, 'Core\'s refusal in plain words');
    assert.equal(invites(p, sent).length, 1, 'the page asked, and Core refused');
    assert.equal(await visible(p, '#invite-prompt-text'), false, 'no prompt');
    assert.deepEqual(await files(), before, 'no sign-in file');
    assert.equal((await view('actors', { kind: 'agent' })).items.some(item => item.id === 'late-helper'), false, 'no agent registered');
    await fits(p, 'refused, no longer organising');
    p.intercept(null);
    for (const entry of p.held.splice(0)) await p.release(entry);
    // Once the page reads the outcome, the invite goes, and the refusal stays said.
    await until(async () => !await visible(p, '#invite-agent'), 'the page learns the person no longer organises it');
    assert.equal(await said(p), refusal);
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite a member who does not organise the outcome is offered no invite, and is offered it once the outcome is handed to them', async () => {
    const workspace = await outcome('Invite, a member only', { team: [facts.agent], owner: facts.agent });
    const p = await open('invite-member', workspace);
    await until(async () => (await teamNames(p)).length >= 2, 'the team shows');
    assert.deepEqual([await visible(p, '#team-invite'), await visible(p, '#invite-agent'), await visible(p, '#team-people .add-chip')], [false, false, false],
      'neither + Add nor + Invite agent for a member who does not organise the outcome');
    await shot(p, 'invite-member-only-1440');
    // Handed back, the outcome is the person's to organise: the page learns it and offers the invite.
    await control({ method: 'outcome_change', operation_id: 'invite-member-handed-back', sender: facts.agent, workspace_id: workspace, owner: facts.actor });
    await until(() => visible(p, '#invite-agent'), 'the invite is offered once the person owns the outcome');
    await openLine(p);
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite while the invitation is out the line says Inviting… and a second Return sends nothing; an answer lost then sends the same invitation, which Core takes once', async () => {
    const workspace = await outcome('Invite, a lost answer');
    const p = await open('invite-lost', workspace);
    await openLine(p); await type(p, 'Patient helper');
    let hold = true;
    p.intercept(payload => payload?.kind === 'workspace.agent_invite' && hold && !(hold = false));
    const sent = p.calls.length;
    await p.key('Enter');
    await until(() => p.held.some(entry => entry.payload?.kind === 'workspace.agent_invite'), 'the answer is held');
    assert.equal(await said(p), 'Inviting…');
    assert.deepEqual(await p.evaluate(`(i=>[i.readOnly,i.getAttribute('aria-busy')])(document.querySelector('#invite-agent-name'))`), [true, 'true'], 'the name cannot change while it is out');
    await p.key('Enter');
    assert.equal(invites(p, sent).length, 1, 'a second Return sends nothing');
    await fits(p, 'inviting');
    await p.fail(p.held.splice(0, 1)[0]);
    await until(async () => (await said(p))?.startsWith('Not confirmed: '), 'the lost answer is said');
    assert.ok((await said(p)).endsWith(' Press Return to try once more.'));
    assert.equal(await p.evaluate(`document.querySelector('#invite-agent-name').value`), 'Patient helper', 'the name is kept');
    await p.key('Enter');
    await until(() => visible(p, '#invite-prompt-text'), 'the prompt shows');
    const [first, second] = invites(p, sent);
    assert.deepEqual(second, first, 'the very same invitation');
    const written = (await files()).filter(file => file.actor === 'patient-helper');
    assert.deepEqual(written.map(file => file.mode), ['0o600'], 'one sign-in file');
    assert.equal((await view('workspace_members', { workspace_id: workspace })).items.filter(item => item.actor_id === 'patient-helper').length, 1);
    assert.deepEqual(p.errors, []);
  });

  await check('forms invite a sign-in file that could not be written says so with Try again, which writes it with the same invitation', async () => {
    const workspace = await outcome('Invite, a file not written');
    const p = await open('invite-not-written', workspace);
    await openLine(p); await type(p, 'Quiet helper');
    await control({ method: 'sign_in_folder', writable: false });
    try {
      const sent = p.calls.length;
      await p.key('Enter');
      await until(async () => (await said(p))?.startsWith('Quiet helper is on the team, but its sign-in file could not be written in '), 'the file not written is said');
      assert.ok((await said(p)).endsWith('Try again: the same invitation writes it, and nothing else is repeated.Try again'), await said(p));
      assert.equal(await focused(p), 'text-action invite-retry', 'the focus is on Try again');
      await until(async () => (await teamNames(p)).includes('Quiet helper'), 'the agent is on the team already');
      assert.equal(await visible(p, '#invite-prompt-text'), false, 'no prompt without its sign-in file');
      assert.equal((await files()).some(file => file.actor === 'quiet-helper'), false);
      await fits(p, 'not written, Try again');
      await control({ method: 'sign_in_folder', writable: true });
      await press(p, '#team-invite .invite-retry');
      await until(() => visible(p, '#invite-prompt-text'), 'Try again writes it and the prompt shows');
      const [first, second] = invites(p, sent);
      assert.deepEqual(second, first, 'the same invitation, which Core answers from its record');
      assert.deepEqual((await files()).filter(file => file.actor === 'quiet-helper').map(file => [file.name, file.mode]), [['quiet-helper.profile.json', '0o600']]);
      assert.deepEqual(p.errors, []);
    } finally {
      await control({ method: 'sign_in_folder', writable: true });
    }
  });

  await check('forms invite on a phone by touch the line and the prompt fit at 320, 375 and 390 and on a laptop, in light and dark', async () => {
    const workspace = await outcome('Invite on a phone, with a title long enough to wrap on the narrowest screen');
    const p = await open('invite-phone', workspace);
    await phone(p, 320, 568);
    await openLine(p, tap);
    await tap(p, '#team-invite [data-harness=codex]');
    assert.deepEqual(await pressed(p), ['Claude Code:false', 'Codex:true'], 'a tap chooses Codex');
    await p.send('Input.insertText', { text: 'Phone helper' });
    await fits(p, 'the line');
    await phone(p, 320, 568);
    await p.evaluate(`document.querySelector('#invite-agent-name').focus()`);
    await p.key('Enter');
    await until(() => visible(p, '#invite-prompt-text'), 'the prompt shows');
    await fits(p, 'the prompt');
    assert.deepEqual(p.errors, []);
  });
}
