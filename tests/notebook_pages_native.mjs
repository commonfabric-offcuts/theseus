import assert from 'node:assert/strict';

// Notebook pages in the real browser against the real server: an outcome's
// pages sit in the sidebar after its topics; a page the reader has read and
// an agent revised since wears its new revisions as a count, live, with no
// reload; opening it shows what changed since, as marked words, and puts the
// light out; a page in the topic's own Notebook wears the same light; at 390 wide, in light and in dark, the pages are in the
// rail "☰ Topics" opens over the topic, nothing leaves the screen and the changed words stay readable; and on the outcome's own page the pages
// follow the topics and open in place.
export async function notebookChecks({ check, page, until, control, view, facts, shot }) {
  const id = 'notebook-release-plan', row = `#outcome-references-list .reference[data-id="${id}"]`;
  const light = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(row + ' .unread-count')});return b?{text:b.textContent,className:b.className,said:document.querySelector(${JSON.stringify(row + ' .sr-only')})?.textContent}:null})()`);
  const listed = async () => (await view('memory_items', { owner_scope: { kind: 'workspace', id: 'w1' } })).items.find(item => item.id === id);
  let revision = 0;
  const revise = async body => {
    const answer = revision === 0
      ? await control({ method: 'outcome_reference', operation_id: `${id}-create`, item_id: id, title: 'Release plan', body })
      : await control({ method: 'memory_revise', operation_id: `${id}-revise-${revision}`, item_id: id, expected_revision: revision, title: 'Release plan', body });
    assert.equal(answer.status, 'committed', JSON.stringify(answer)); revision += 1;
  };
  const openRow = async p => {
    await p.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({block:'center',inline:'center'})`);
    await p.point(row);
    await until(() => p.evaluate("document.querySelector('#reader').open && document.querySelector('#source-body').textContent.length > 0"), 'the Reader shows the page');
  };
  const closeReader = async p => { await p.point('#reader-close'); await until(() => p.evaluate("!document.querySelector('#reader').open"), 'the Reader closes'); };
  // WCAG contrast of an element's text on the nearest opaque background behind it.
  const contrast = (p, selector) => p.evaluate(`(()=>{
    const rgb=c=>c.match(/[\\d.]+/g).map(Number);
    const lum=([r,g,b])=>[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
    const e=document.querySelector(${JSON.stringify(selector)});let at=e,bg=null;
    while(at){const c=rgb(getComputedStyle(at).backgroundColor);if(c.length<4||c[3]>0.99){if(c.length>=3&&!(c.length===4&&c[3]===0)){bg=c;break;}}at=at.parentElement;}
    bg??=rgb(getComputedStyle(document.body).backgroundColor);
    const a=lum(rgb(getComputedStyle(e).color)),b=lum(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  })()`);

  await check('notebook a page read and revised since wears its new revisions in the sidebar until opened, and the Reader shows what changed', async () => {
    await revise('Ship on Friday.\nDan reviews the notes.\n');
    const p = await page('notebook-light', null, true);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed in the sidebar');
    assert.equal(await p.evaluate(`document.querySelector('.rail').contains(document.querySelector(${JSON.stringify(row)}))`), true);
    assert.equal(await light(p), null, 'a page never read wears no light');
    await openRow(p);
    await until(async () => (await listed())?.read_revision === 1, 'Core records the read');
    assert.equal(await p.evaluate("document.querySelector('#source-changes').hidden"), true, 'nothing to compare on a first read');
    await closeReader(p);
    await revise('Ship on Monday.\nDan reviews the notes.\n');
    const lit = await until(() => light(p), 'the light comes on live, with no reload');
    assert.deepEqual(lit, { text: '1', className: 'unread-count changed', said: ', changed since you read it, 1 new revision' });
    // The light is the unread count's: same shape and colour as a topic's.
    const looks = await p.evaluate(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(row + ' .unread-count')}));return [s.backgroundColor,s.borderRadius,s.fontSize]})()`);
    const probe = await p.evaluate(`(()=>{const b=document.createElement('span');b.className='unread-count';document.querySelector('#topics').append(b);const s=getComputedStyle(b);const v=[s.backgroundColor,s.borderRadius,s.fontSize];b.remove();return v})()`);
    assert.deepEqual(looks, probe);
    await shot(p, 'notebook-sidebar-light');
    await openRow(p);
    await until(() => p.evaluate("!document.querySelector('#source-changes').hidden"), 'what changed shows above the page');
    const changes = await p.evaluate(`({title:document.querySelector('#source-changes-title').textContent,open:document.querySelector('#source-changes').open,
      added:[...document.querySelectorAll('#source-changes-body .changes-added')].map(e=>e.lastChild.previousSibling.textContent),
      removed:[...document.querySelectorAll('#source-changes-body .changes-removed')].map(e=>e.lastChild.previousSibling.textContent),
      struck:getComputedStyle(document.querySelector('#source-changes-body .changes-removed')).textDecorationLine,
      above:document.querySelector('#source-changes').compareDocumentPosition(document.querySelector('#source-body'))===Node.DOCUMENT_POSITION_FOLLOWING})`);
    assert.deepEqual(changes, { title: 'What changed since you read revision 1', open: true, added: ['Monday'], removed: ['Friday'], struck: 'line-through', above: true });
    await shot(p, 'notebook-reader-changes');
    await until(async () => (await light(p)) === null, 'the light goes out once the page is read');
    await closeReader(p);
    assert.deepEqual(p.errors, []);
  });

  await check('notebook a page in the topic\'s own Notebook wears the same light, live, and opening it puts the light out', async () => {
    const seeded = await control({ method: 'seed', memory_items: 1 }), topicPage = seeded.item_ids[0];
    const card = `#memory-items .memory-card[data-id="${topicPage}"]`;
    const cardLight = p => p.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(card + ' .unread-count')});return b?{text:b.textContent,className:b.className,said:document.querySelector(${JSON.stringify(card + ' .sr-only')})?.textContent}:null})()`);
    const read = async () => (await view('memory_items', { owner_scope: { kind: 'topic', id: 't1' } })).items.find(item => item.id === topicPage)?.read_revision;
    const p = await page('notebook-topic-light', null, true);
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'the topic\'s Notebook lists the page');
    assert.equal(await cardLight(p), null, 'a page never read wears no light');
    const openCard = async () => {
      await p.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
      await p.point(card);
      await until(() => p.evaluate("document.querySelector('#reader').open && document.querySelector('#source-body').textContent.length > 0"), 'the Reader shows the page');
    };
    await openCard();
    await until(async () => (await read()) === 1, 'Core records the read');
    await closeReader(p);
    const answer = await control({ method: 'memory_revise', operation_id: `${topicPage}-revise`, item_id: topicPage, expected_revision: 1, title: 'Fixture item 0', body: 'Fixture Notebook body, revised.' });
    assert.equal(answer.status, 'committed', JSON.stringify(answer));
    assert.deepEqual(await until(() => cardLight(p), 'the light comes on live, with no reload'),
      { text: '1', className: 'unread-count changed', said: ', changed since you read it, 1 new revision' });
    await shot(p, 'notebook-topic-light');
    await openCard();
    await until(() => p.evaluate("!document.querySelector('#source-changes').hidden"), 'what changed shows above the page');
    await until(async () => (await cardLight(p)) === null, 'the light goes out once the page is read');
    // A page with nothing to compare, opened next, carries none of the changes just shown.
    await closeReader(p);
    await openRow(p);
    await until(() => p.evaluate("document.querySelector('#reader-title').textContent === 'Release plan'"), 'the outcome\'s page opens');
    await until(async () => (await listed())?.read_revision === (await listed())?.revision, 'it is read as it stands');
    assert.equal(await p.evaluate("document.querySelector('#source-changes').hidden"), true, 'the next page shows none of the first page\'s changes');
    await closeReader(p);
    assert.deepEqual(p.errors, []);
  });

  await check('notebook at 390 wide, in light and in dark, the pages and what changed stay on screen and readable', async () => {
    for (const scheme of ['light', 'dark']) {
      const p = await page(`notebook-phone-${scheme}`, null, true);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed');
      await revise(`Ship on ${scheme === 'light' ? 'Tuesday' : 'Wednesday'}.\nDan reviews the notes, and Warp signs off.\n`);
      await until(() => light(p), 'the light comes on');
      // On a phone the pages are in the rail, folded behind "☰ Topics" over the topic.
      await p.point('#rail-open');
      await until(() => p.evaluate("document.getElementById('rail').classList.contains('open')"), 'the rail opens over the topic');
      const fit = await p.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect(),d=document.getElementById('rail').getBoundingClientRect();
        return {page:document.documentElement.scrollWidth,height:r.height,left:r.left,right:r.right,drawer:[d.left,d.right]}})()`);
      assert.ok(fit.page <= 390, `no sideways page scroll: ${fit.page}`);
      assert.ok(fit.height >= 44 && fit.left >= fit.drawer[0] && fit.right <= fit.drawer[1] + 0.5, `a touch-sized row inside the open rail: ${JSON.stringify(fit)}`);
      assert.ok(await contrast(p, row) >= 4.5, 'the row title is readable');
      await shot(p, `notebook-phone-${scheme}-sidebar`);
      await openRow(p);
      assert.equal(await p.evaluate("document.getElementById('rail').classList.contains('open')"), false, 'opening the page folds the rail away');
      await until(() => p.evaluate("!document.querySelector('#source-changes').hidden"), 'what changed shows');
      const box = await p.evaluate(`(()=>{const c=document.querySelector('#source-changes').getBoundingClientRect(),b=document.querySelector('#source-body').getBoundingClientRect();return {left:c.left,right:c.right,body:b.height}})()`);
      assert.ok(box.left >= 0 && box.right <= 390, `the changes stay inside the screen: ${JSON.stringify(box)}`);
      assert.ok(box.body >= 60, `the page itself keeps room to read: ${box.body}`);
      for (const selector of ['#source-changes-body .changes-added', '#source-changes-body .changes-removed', '#source-changes-title']) {
        const ratio = await contrast(p, selector);
        assert.ok(ratio >= 4.5, `${scheme}: ${selector} contrast ${ratio.toFixed(2)}`);
      }
      await shot(p, `notebook-phone-${scheme}-changes`);
      await closeReader(p);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });

  await check('notebook an outcome page lists its pages after its topics with the same light, and one opens in place with what changed', async () => {
    const p = await page('notebook-outcome', null, true, { url: facts.origin + '/?workspace=w1' });
    await until(() => p.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), 'the page is listed on the outcome page');
    assert.equal(await p.evaluate(`document.querySelector('#outcome-page').contains(document.querySelector(${JSON.stringify(row)})) &&
      document.querySelector('#topic-navigation').compareDocumentPosition(document.querySelector('#outcome-references'))===Node.DOCUMENT_POSITION_FOLLOWING`), true);
    await revise('Ship on Thursday.\nDan reviews the notes, and Warp signs off.\n');
    await until(() => light(p), 'the light comes on');
    await p.point(row);
    await until(() => p.evaluate("!document.querySelector('#page-here').hidden && Boolean(document.querySelector('#page-here .source-changes'))"), 'the page opens in place with what changed');
    const here = await p.evaluate(`({title:document.querySelector('#page-here h2').textContent,focused:document.activeElement===document.querySelector('#page-here h2'),
      body:document.querySelector('#page-here .page-here-body').textContent,added:[...document.querySelectorAll('#page-here .changes-added')].map(e=>e.lastChild.previousSibling.textContent)})`);
    assert.deepEqual(here, { title: 'Release plan', focused: true, body: 'Ship on Thursday.\nDan reviews the notes, and Warp signs off.\n', added: ['Thursday'] });
    await until(async () => (await light(p)) === null, 'the light goes out');
    await shot(p, 'notebook-outcome-page');
    // Where the outcome stands sits above its topics (item 86), so Close may be below the fold: scroll to it as a reader would.
    await p.evaluate(`document.querySelector('#page-here button').scrollIntoView({block:'center'})`);
    await p.point('#page-here button');
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(row)})`), true, 'Close gives the focus back to the row');
    assert.deepEqual(p.errors, []);
  });
}
