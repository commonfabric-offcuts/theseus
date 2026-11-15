import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sheetHead } from './notebook_sheet_native.mjs';

// Images in a Notebook card (item 321, docs/decks.md "Images in a card"), in the real browser against the real
// server, in Chrome and in Safari's engine: an image pasted or dropped into a card being written shows in it at once,
// from this device, while it uploads; it becomes one of the page's attachments, named by a line of the card's words,
// and the card shows it from the page after a reload; × takes it out of the card and off the page. A file that is not
// an image, or an image past Core's limit, is refused with a line saying what was not added and why, and nothing goes
// to Core; a large image within the limit goes. Each state of a card's image (shown from Core, uploading, failed,
// not on the page, being written with its ×, refused, and to read) at 320, 375 and 390 by touch and at a laptop's
// width, in light and dark.
//
// The paste and the drop are the page's own events carrying real Files (ClipboardEvent and DragEvent with a
// DataTransfer), as the other Notebook image checks paste: no check reads or writes the system clipboard or drags
// from the Finder, so what this proves starts at the event the browser hands the page.
export async function cardImageChecks({ check, page, until, control, view, facts, shot }) {
  const png = (await readFile(new URL('fixtures/media/one.png', import.meta.url))).toString('base64');
  const jpg = (await readFile(new URL('fixtures/media/one.jpg', import.meta.url))).toString('base64');
  // A File made in the page from {name, type, base64}, {name, type, size} (zero bytes of that length), or
  // {name, png: [width, height]}: a real PNG of that size, stored without compression, so its length is known.
  const MAKE = `const make=s=>{if(s.base64)return new File([Uint8Array.from(atob(s.base64),c=>c.charCodeAt(0))],s.name,{type:s.type});
    if(!s.png)return new File([new Uint8Array(s.size)],s.name,{type:s.type});
    const [w,h]=s.png,row=1+3*w,raw=new Uint8Array(row*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*row+1+3*x;raw[i]=x*255/w;raw[i+1]=y*255/h;raw[i+2]=160;}
    const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}
    const crc=b=>{let c=~0;for(let i=0;i<b.length;i++)c=t[(c^b[i])&255]^(c>>>8);return ~c>>>0;};
    const blocks=Math.ceil(raw.length/65535),z=new Uint8Array(2+raw.length+5*blocks+4);z[0]=0x78;z[1]=1;let o=2;
    for(let i=0;i<raw.length;i+=65535){const n=Math.min(65535,raw.length-i);z[o++]=i+n>=raw.length?1:0;z[o++]=n&255;z[o++]=n>>8;z[o++]=~n&255;z[o++]=(~n>>8)&255;z.set(raw.subarray(i,i+n),o);o+=n;}
    let a=1,b=0;for(let i=0;i<raw.length;i++){a+=raw[i];if(a>=65521)a-=65521;b+=a;if(b>=65521)b-=65521;}
    z[o++]=b>>8;z[o++]=b&255;z[o++]=a>>8;z[o++]=a&255;
    const chunk=(kind,data)=>{const out=new Uint8Array(12+data.length),v=new DataView(out.buffer);v.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=kind.charCodeAt(i);out.set(data,8);v.setUint32(8+data.length,crc(out.subarray(4,8+data.length)));return out;};
    const head=new Uint8Array(13),v=new DataView(head.buffer);v.setUint32(0,w);v.setUint32(4,h);head[8]=8;head[9]=2;
    return new File([Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',head),chunk('IDAT',z),chunk('IEND',new Uint8Array(0))],s.name,{type:'image/png'});};`;
  // A paste of these files into what the selector names, as the page receives one; whether the page took the event.
  const paste = (p, selector, files) => p.evaluate(`(()=>{${MAKE}const d=new DataTransfer();for(const s of ${JSON.stringify(files)})d.items.add(make(s));
    const e=new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true});document.querySelector(${JSON.stringify(selector)}).dispatchEvent(e);return e.defaultPrevented;})()`);
  // A drag of these files over what the selector names and a drop there; whether the page took each event. An engine
  // whose DragEvent leaves out the DataTransfer it is given (the init dictionary's dataTransfer) has it set on the
  // event, so both engines hand the page the same files.
  const drop = (p, selector, files) => p.evaluate(`(()=>{${MAKE}const d=new DataTransfer();for(const s of ${JSON.stringify(files)})d.items.add(make(s));
    const t=document.querySelector(${JSON.stringify(selector)}),fire=kind=>{const e=new DragEvent(kind,{dataTransfer:d,bubbles:true,cancelable:true});
      if(e.dataTransfer!==d)Object.defineProperty(e,'dataTransfer',{value:d});t.dispatchEvent(e);return e.defaultPrevented;};
    return [fire('dragenter'),fire('dragover'),fire('drop')];})()`);
  // Each image a card (or the card box) shows: its name as written for screen readers, whether its picture has loaded,
  // whether it stands inside its card, and its × when it has one.
  const figures = (p, scope) => p.evaluate(`[...document.querySelectorAll(${JSON.stringify(scope + ' .deck-image')})].map(f=>{
    const i=f.querySelector(':scope > img.image-thumb'),c=f.closest('.deck-card').getBoundingClientRect(),r=f.getBoundingClientRect(),x=f.querySelector(':scope > .deck-image-remove'),b=x?.getBoundingClientRect();
    return {name:f.querySelector(':scope > .deck-image-name')?.textContent??null,shown:Boolean(i&&!i.hidden&&i.complete&&i.naturalWidth>0),inside:r.left>=c.left-0.5&&r.right<=c.right+0.5&&r.width>0,
      remove:x?{label:x.getAttribute('aria-label'),title:x.title,width:Math.round(b.width),height:Math.round(b.height),reached:(()=>{const at=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return x===at||x.contains(at)})()}:null}})`);
  const sideways = p => p.evaluate('document.documentElement.scrollWidth>innerWidth');
  const core = id => view('memory_current', { item_id: id });
  const lines = body => [...body.matchAll(/^!\[([^\]\n]*)\]\(attachment:([A-Za-z0-9._-]+)\)$/gm)].map(([, name, id]) => ({ name, id }));
  // Core's page, once it holds what the probe asks for; a failure says what it held instead.
  const holds = (id, probe, said, timeout) => until(async () => { const now = await core(id); return probe(now) && now; }, said, timeout)
    .catch(async error => { const now = await core(id); assert.ok(probe(now), `${said}: Core's page reads ${JSON.stringify({ body: now.body, attachments: now.attachments })}`); throw error; });
  const media = p => p.calls.filter(call => call.payload?.kind === 'media.begin').length;

  // The upload is held at the page's transport until released, and can then be refused once (cardUploadFails).
  const parsePlan = body => body.split('\n## Notes')[0];
  const HOLD = `globalThis.cardUploadHeld=false;globalThis.cardUploadFails=false;const cardFetch=fetch.bind(globalThis);
    globalThis.fetch=async(...args)=>{if(String(args[0]).includes('/api/media/upload')){
      if(globalThis.cardUploadHeld)await new Promise(done=>globalThis.releaseCardUpload=done);
      if(globalThis.cardUploadFails){globalThis.cardUploadFails=false;return new Response(JSON.stringify({error:{code:'SERVER_BUSY',message:'This media lane is busy; retain its operation.'}}),{status:503,headers:{'content-type':'application/json'}});}}
      return cardFetch(...args);};`;

  await check('notebook card images an image pasted into a card being written shows in it at once and goes to the page; one dropped joins it; both stay across a reload; × takes one out of the card and off the page', async () => {
    const id = 'nb-card-images', ROOT = '#deck-page', BOX = `${ROOT} .deck-writing textarea`, WRITING = `${ROOT} .deck-writing`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Card images', body: '## Plan\n\nShip it.\n\n## Notes\n\nKeep these.\n' })).status, 'committed');
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}`, beforeNavigate: q => q.send('Page.addScriptToEvaluateOnNewDocument', { source: HOLD }) });
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelectorAll('${ROOT} .deck-card').length===2`), 'the cards show');
    const open = async () => {
      await p.point(`${ROOT} .deck-card[data-index="0"] .deck-words`);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), 'the card opens to write');
    };
    await open();
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(BOX)}).value`), 'Plan\nShip it.');
    // Pasted while its upload is held: the card shows it from this device, saying it uploads, and Core has no attachment yet.
    await p.evaluate('globalThis.cardUploadHeld=true');
    assert.equal(await paste(p, BOX, [{ name: 'chart.png', type: 'image/png', base64: png }]), true, 'the page takes the paste: no text goes into the box');
    await until(async () => (await figures(p, WRITING)).some(f => f.shown), 'the pasted image shows in the card at once, from this device');
    assert.deepEqual((await figures(p, WRITING)).map(f => [f.name, f.shown, f.inside]), [['chart.png · Uploading…', true, true]]);
    await until(() => p.evaluate('Boolean(globalThis.releaseCardUpload)'), 'its upload is held at the transport');
    assert.equal((await core(id)).attachments.length, 0, 'Core has no attachment while the upload is held');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(BOX)}).value`), 'Plan\nShip it.', 'the box holds the words as they were');
    await p.evaluate('(globalThis.cardUploadHeld=false,globalThis.releaseCardUpload())');
    const first = await holds(id, page => page.attachments.length === 1 && lines(page.body).length === 1, 'the image goes to the page and the card names it');
    assert.deepEqual([first.attachments[0].name, lines(first.body)], ['chart.png', [{ name: 'chart.png', id: first.attachments[0].id }]]);
    assert.ok(first.body.startsWith(`## Plan\n\nShip it.\n\n![chart.png](attachment:${first.attachments[0].id})\n`), first.body);
    // A second, dropped on the card being written, joins it after the first; the words and the cursor stay.
    assert.deepEqual(await drop(p, WRITING, [{ name: 'photo.jpg', type: 'image/jpeg', base64: jpg }]), [true, true, true], 'the page takes the drag and the drop');
    const both = await holds(id, page => page.attachments.length === 2 && lines(page.body).length === 2, 'the dropped image goes to the page and the card names it after the first');
    assert.deepEqual(lines(both.body).map(line => line.name), ['chart.png', 'photo.jpg']);
    assert.equal(lines(parsePlan(both.body)).length, 2, 'both in the card written, none in the other');
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), true, 'the box keeps the focus');
    await until(async () => { const shown = await figures(p, WRITING); return shown.length === 2 && shown.every(f => f.shown && !f.name.includes('·')); }, 'both show, uploaded');
    await p.key('Escape');
    const card = `${ROOT} .deck-card[data-index="0"]`;
    await until(async () => (await figures(p, card)).filter(f => f.shown).length === 2, 'the card shows both images under its words');
    assert.equal(await p.evaluate(`document.querySelector('${card} .deck-words').textContent`), 'Ship it.', 'the card\'s words are its words, no image line among them');
    assert.equal((await figures(p, `${ROOT} .deck-card[data-index="1"]`)).length, 0, 'the other card shows none');
    assert.equal(await p.evaluate(`document.querySelectorAll('${ROOT} .notebook-image-rows .notebook-image').length`), 0, 'the page\'s own image list leaves the cards\' images to them');
    await shot(p, 'notebook-card-images-laptop');
    // After a reload the card shows them from the page, read through the page itself.
    const reads = p.calls.length;
    await p.send('Page.reload', {});
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelectorAll('${ROOT} .deck-card').length===2`), 'the page comes back');
    await until(async () => (await figures(p, card)).filter(f => f.shown).length === 2, 'the card shows both images after a reload');
    const through = p.calls.slice(reads).filter(call => call.url.endsWith('/api/media/read')).map(call => call.payload?.source_ref?.kind === 'memory' && call.payload.source_ref.id === id);
    assert.ok(through.length >= 2 && through.every(Boolean), `each image is read through the page: ${JSON.stringify(through)}`);
    // Opened again, the box holds the words alone, the images under it, and closing it unchanged writes nothing.
    const revision = (await core(id)).source_ref.revision;
    await open();
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(BOX)}).value`), 'Plan\nShip it.', 'the image lines stay out of the box');
    const writing = await figures(p, WRITING);
    assert.deepEqual(writing.map(f => [f.shown, f.remove?.label, f.remove?.title]), [
      [true, 'Remove the image chart.png from this card', 'Remove the image chart.png from this card'],
      [true, 'Remove the image photo.jpg from this card', 'Remove the image photo.jpg from this card']]);
    await p.key('Escape');
    // The next act on the page writes the next revision: the card opened and closed with nothing done wrote none.
    await p.point(`${ROOT} .deck-card[data-index="1"] .deck-words`);
    await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), 'the other card opens to write');
    await p.key('e', 2); await p.send('Input.insertText', { text: ' More.' }); await p.key('Escape');
    const next = await holds(id, page => page.body.includes('Keep these. More.'), 'the other card\'s words are saved');
    assert.equal(next.source_ref.revision, revision + 1, 'a card opened and closed with nothing done writes no revision');
    // × takes the first out of the card and off the page; the other stays.
    await open();
    await p.point(`${WRITING} .deck-image:first-of-type .deck-image-remove`);
    const left = await holds(id, page => page.attachments.length === 1 && lines(page.body).length === 1, '× takes the image out of the card and off the page');
    assert.deepEqual([left.attachments[0].name, lines(left.body)[0].name], ['photo.jpg', 'photo.jpg']);
    assert.equal(await p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), true, 'the box keeps the focus after ×');
    await p.key('Escape');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // The cards' Undo, pressed as a person presses it.
  const undo = async (p, root) => {
    assert.equal(await p.evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(root + ' .deck-bar button')})].find(b=>b.textContent==='Undo');if(b)b.dataset.undoPress='';return Boolean(b);})()`), true, 'the cards\' Undo shows');
    await p.point(`${root} .deck-bar [data-undo-press]`);
  };

  // × takes an image off the page, and Undo, bringing back the card's line, puts it back, so a card never names an
  // image the page lost: one uploaded, one still uploading when × is pressed, and one someone else added, which Core
  // takes back from a writer of a page that carried it.
  await check('notebook card images Undo after × puts the image back on the page and in its card: one uploaded, one still uploading, and one someone else added', async () => {
    const id = 'nb-card-undo', ROOT = '#deck-page', BOX = `${ROOT} .deck-writing textarea`, WRITING = `${ROOT} .deck-writing`, card = `${ROOT} .deck-card[data-index="0"]`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Card undo', body: '## Plan\n\nShip it.\n\n## Notes\n\nKeep these.\n' })).status, 'committed');
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}`, beforeNavigate: q => q.send('Page.addScriptToEvaluateOnNewDocument', { source: HOLD }) });
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelectorAll('${ROOT} .deck-card').length===2`), 'the cards show');
    const open = async () => {
      await p.point(`${card} .deck-words`);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), 'the card opens to write');
    };
    const named = page => lines(page.body).map(line => line.name);
    // Uploaded: ×, then Undo.
    await open();
    assert.equal(await paste(p, BOX, [{ name: 'chart.png', type: 'image/png', base64: png }]), true);
    const chart = (await holds(id, page => page.attachments.length === 1 && lines(page.body).length === 1, 'the image goes to the page and the card names it')).attachments[0].id;
    await p.key('Escape');
    await until(async () => (await figures(p, card)).some(f => f.shown), 'the card shows its image');
    await open();
    await p.point(`${WRITING} .deck-image-remove`);
    await holds(id, page => page.attachments.length === 0 && lines(page.body).length === 0, '× takes the image out of the card and off the page');
    await p.key('Escape');
    await undo(p, ROOT);
    const back = await holds(id, page => lines(page.body).length === 1 && page.attachments.length === 1, 'Undo puts the line back and the image back on the page');
    assert.deepEqual([lines(back.body)[0].id, back.attachments[0].id, back.attachments[0].name], [chart, chart, 'chart.png']);
    await until(async () => { const shown = await figures(p, card); return shown.length === 1 && shown[0].shown && shown[0].name === 'chart.png'; }, 'the card shows its image again, from the page');
    // Still uploading when × is pressed: Undo puts it back, and it goes to the page once its upload ends.
    await p.evaluate('globalThis.cardUploadHeld=true');
    await open();
    assert.equal(await paste(p, BOX, [{ name: 'held.png', type: 'image/png', base64: png }]), true);
    await until(() => p.evaluate('Boolean(globalThis.releaseCardUpload)'), 'its upload is held at the transport');
    await p.key('Escape');
    await holds(id, page => named(page).join() === 'chart.png,held.png', 'the card names the image still uploading');
    await open();
    assert.deepEqual((await figures(p, WRITING)).map(f => f.name), ['chart.png', 'held.png · Uploading…']);
    await p.point(`${WRITING} .deck-image:nth-of-type(2) .deck-image-remove`);
    await p.key('Escape');
    await holds(id, page => named(page).join() === 'chart.png', '× takes the image still uploading out of the card');
    await undo(p, ROOT);
    await holds(id, page => named(page).join() === 'chart.png,held.png', 'Undo puts its line back');
    await until(async () => (await figures(p, card)).some(f => f.name === 'held.png · Uploading…' && f.shown), 'the card shows it uploading again, from this device');
    await p.evaluate('(globalThis.cardUploadHeld=false,globalThis.releaseCardUpload())');
    const both = await holds(id, page => page.attachments.length === 2, 'its upload ends and it goes to the page');
    assert.deepEqual(lines(both.body).map(line => line.id), both.attachments.map(a => a.id), 'the page carries each image a card names, in order');
    await until(async () => { const shown = await figures(p, card); return shown.length === 2 && shown.every(f => f.shown && !f.name.includes('·')); }, 'the card shows both, uploaded');
    assert.deepEqual(p.errors, []); await p.close();
    // Someone else's: an agent's image on a page the person writes.
    const theirs = 'nb-card-undo-theirs', media = `${theirs}-media-0`, SHEET = '#new-message-sheet .notebook-sheet-page:not([hidden])', SBOX = `${SHEET} .deck-writing textarea`;
    assert.equal((await control({ method: 'agent_page', operation_id: theirs, item_id: theirs, topic_id: 't1', title: 'Their image',
      body: `## Theirs\n\nA chart.\n![their-chart.png](attachment:${media})\n`, attachments: [{ name: 'their-chart.png', image: 'screen.png' }] })).status, 'committed');
    const q = await page(theirs, null, true, { url: `${facts.origin}/?topic=t1&page=${theirs}` });
    await until(() => q.evaluate(`document.querySelector('#new-message-sheet').open && document.querySelectorAll(${JSON.stringify(SHEET + ' .deck-card')}).length===1`), 'the page opens in the composer');
    const theirCard = `${SHEET} .deck-card[data-index="0"]`;
    await until(async () => (await figures(q, theirCard)).some(f => f.shown), 'the card shows their image');
    await q.point(`${theirCard} .deck-words`);
    await until(() => q.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(SBOX)})`), 'the card opens to write');
    await q.point(`${SHEET} .deck-writing .deck-image-remove`);
    await q.key('Escape');
    await holds(theirs, page => page.attachments.length === 0 && lines(page.body).length === 0, '× takes their image out of the card and off the page');
    await undo(q, SHEET);
    const again = await holds(theirs, page => lines(page.body).length === 1 && page.attachments.length === 1, 'Undo puts their image back on the page');
    assert.deepEqual([lines(again.body)[0].id, again.attachments[0].id], [media, media]);
    await until(async () => { const shown = await figures(q, theirCard); return shown.length === 1 && shown[0].shown && shown[0].name === 'their-chart.png'; }, 'the card shows their image again');
    assert.deepEqual(q.errors, []); await q.close();
  });

  // × keeps an image on the page while another card still shows it (a line copied in the Text view), and takes it off
  // once no card does.
  await check('notebook card images × keeps an image on the page while another card shows it, and takes it off with the last', async () => {
    const id = 'nb-card-shared', media = `${id}-media-0`, line = `![screen.png](attachment:${media})`;
    assert.equal((await control({ method: 'agent_page', operation_id: id, item_id: id, topic_id: 't1', title: 'Shared image',
      body: `## A\n\nOne.\n${line}\n\n## B\n\nTwo.\n${line}\n`, attachments: [{ name: 'screen.png', image: 'screen.png' }] })).status, 'committed');
    const SHEET = '#new-message-sheet .notebook-sheet-page:not([hidden])', SBOX = `${SHEET} .deck-writing textarea`;
    const p = await page(id, null, true, { url: `${facts.origin}/?topic=t1&page=${id}` });
    await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && document.querySelectorAll(${JSON.stringify(SHEET + ' .deck-card')}).length===2`), 'the page opens in the composer');
    const open = async index => {
      await p.point(`${SHEET} .deck-card[data-index="${index}"] .deck-words`);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(SBOX)})`), 'the card opens to write');
    };
    await open(0);
    await p.point(`${SHEET} .deck-writing .deck-image-remove`);
    await p.key('Escape');
    // The next act writes after every act before it, so what the page carries then is what × left.
    await open(1);
    await p.key('e', 2); await p.send('Input.insertText', { text: ' More.' }); await p.key('Escape');
    const kept = await holds(id, page => page.body.includes('Two. More.'), 'the next card\'s words are saved');
    assert.deepEqual([lines(kept.body).length, kept.attachments.map(a => a.id)], [1, [media]], 'card A no longer names it, and the page keeps the image card B shows');
    await until(async () => { const shown = await figures(p, `${SHEET} .deck-card[data-index="1"]`); return shown.length === 1 && shown[0].shown && shown[0].name === 'screen.png'; }, 'card B still shows it, from the page');
    // × in the last card that shows it takes it off the page.
    await open(1);
    await p.point(`${SHEET} .deck-writing .deck-image-remove`);
    await p.key('Escape');
    await holds(id, page => lines(page.body).length === 0 && page.attachments.length === 0, '× in the last card that shows it takes it off the page');
    // And it stays off: the next act, once the page has drawn what Core confirmed, brings nothing back.
    await open(0);
    await p.key('e', 2); await p.send('Input.insertText', { text: ' Again.' }); await p.key('Escape');
    const after = await holds(id, page => page.body.includes('One. Again.'), 'the next card\'s words are saved');
    assert.deepEqual([lines(after.body).length, after.attachments], [0, []], 'the image stays off the page');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // A new card holding only images is made, named for the first; a new card with nothing in it is not.
  await check('notebook card images an image pasted into a new card with no words makes a card named for it, and an empty new card makes none', async () => {
    const id = 'nb-card-fresh', ROOT = '#deck-page', BOX = `${ROOT} .deck-writing textarea`, WRITING = `${ROOT} .deck-writing`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Fresh', body: '## Plan\n\nShip it.\n' })).status, 'committed');
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}` });
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelectorAll('${ROOT} .deck-card').length===1`), 'the card shows');
    const fresh = async () => {
      assert.equal(await p.evaluate(`(()=>{const b=[...document.querySelectorAll('${ROOT} .deck-bar button')].find(b=>b.textContent==='New card');if(b)b.dataset.newPress='';return Boolean(b);})()`), true, 'New card shows');
      await p.point(`${ROOT} .deck-bar [data-new-press]`);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)}) && document.activeElement.value===''`), 'a new card opens, empty, to write');
    };
    // Nothing in it: Escape makes no card.
    await fresh();
    await p.key('Escape');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(WRITING)}) && document.querySelectorAll('${ROOT} .deck-card').length===1`), 'the empty new card goes, making none');
    // Only an image: made, named for it.
    await fresh();
    assert.equal(await paste(p, BOX, [{ name: 'diagram.png', type: 'image/png', base64: png }]), true);
    await until(async () => (await figures(p, WRITING)).some(f => f.shown), 'the image shows under the new box');
    await p.key('Escape');
    const made = await holds(id, page => page.attachments.length === 1 && /\n## diagram\n/.test(page.body), 'the new card is made with its image, named for it');
    assert.equal(made.body, `## Plan\n\nShip it.\n\n## diagram\n\n![diagram.png](attachment:${made.attachments[0].id})\n`);
    await until(async () => (await figures(p, `${ROOT} .deck-card[data-index="1"]`)).some(f => f.shown), 'the new card shows its image');
    assert.equal(await p.evaluate(`document.querySelector('${ROOT} .deck-card[data-index="1"] .deck-title').textContent`), 'diagram');
    assert.deepEqual(p.errors, []); await p.close();
  });

  await check('notebook card images a file that is not an image, and an image past the limit, are refused with a line saying what was not added and why; a large image within the limit goes', async () => {
    const id = 'nb-card-refusals', ROOT = '#deck-page', BOX = `${ROOT} .deck-writing textarea`, WRITING = `${ROOT} .deck-writing`, SIGN = `${ROOT} .deck-status`;
    assert.equal((await control({ method: 'outcome_reference', operation_id: id, item_id: id, title: 'Refusals', body: '## Plan\n\nShip it.\n' })).status, 'committed');
    const p = await page(id, null, true, { url: `${facts.origin}/?cards=${id}` });
    await until(() => p.evaluate(`document.body.dataset.ready==='true' && document.querySelectorAll('${ROOT} .deck-card').length===1`), 'the card shows');
    await p.point(`${ROOT} .deck-card[data-index="0"] .deck-words`);
    await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), 'the card opens to write');
    const begun = media(p);
    assert.equal(await paste(p, BOX, [{ name: 'notes.pdf', type: 'application/pdf', size: 2048 }]), true, 'the page takes the paste, so the file goes nowhere');
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(SIGN)}).textContent==='notes.pdf was not added: it is not a PNG, JPEG, GIF or WebP image.'`), 'the line says what was not added and why');
    assert.deepEqual(await drop(p, WRITING, [{ name: 'huge.png', type: 'image/png', size: 16 * 1024 * 1024 + 1 }]), [true, true, true]);
    await until(() => p.evaluate(`document.querySelector(${JSON.stringify(SIGN)}).textContent==='huge.png was not added: an image may be at most 16 MB.'`), 'the line says the image is past the limit');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(SIGN)}).firstElementChild.dataset.save`), 'attention');
    assert.equal(media(p), begun, 'nothing refused goes to Core');
    assert.deepEqual(await figures(p, WRITING), [], 'the card shows nothing refused');
    assert.equal(await p.evaluate(`document.querySelector(${JSON.stringify(BOX)}).value`), 'Plan\nShip it.', 'and its box holds its words');
    assert.deepEqual((await core(id)).attachments, []);
    await shot(p, 'notebook-card-refused-laptop');
    // A large image within the limit: a real PNG of 2300 × 2300, about 15.9 MB stored whole.
    const size = 8 + 25 + 12 + (2 + 2300 * 6901 + 5 * Math.ceil(2300 * 6901 / 65535) + 4) + 12;
    assert.ok(size > 15 * 1024 * 1024 && size < 16 * 1024 * 1024, `the large image is within 1 MB of the limit: ${size}`);
    assert.equal(await paste(p, BOX, [{ name: 'large.png', png: [2300, 2300] }]), true);
    const large = await holds(id, page => page.attachments.length === 1, 'the large image goes to the page', 60000);
    assert.deepEqual([large.attachments[0].name, large.attachments[0].size_bytes, large.attachments[0].inline, lines(large.body).map(line => line.id)],
      ['large.png', size, true, [large.attachments[0].id]]);
    await until(async () => (await figures(p, WRITING)).every(f => f.shown && f.inside) && (await figures(p, WRITING)).length === 1, 'the large image shows within the card');
    await until(() => p.evaluate(`!document.querySelector(${JSON.stringify(SIGN)}).textContent.includes('was not added')`), 'the refusal line goes once an image is taken');
    await p.key('Escape');
    assert.deepEqual(p.errors, []); await p.close();
  });

  // Each state of a card's image, at a phone's narrowest widths by touch and at a laptop's, light and dark, in the
  // composer where a page opens from its link: shown from Core; being written, with its × (a 44-point target on a
  // phone); uploading, from this device; a failed upload, its line and Retry; refused, the line on a row of its own
  // in the head; not on the page, its name; and to read, for someone Core does not let write the page, with no ×.
  await check('notebook card images every state of a card\'s image at 320, 375 and 390 by touch and on a laptop, light and dark: it stands inside its card, its × is a 44-point target named for what it removes, and a refusal takes a line of its own', async () => {
    const SIZE = { laptop: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, 320: { width: 320, height: 640, deviceScaleFactor: 1, mobile: true },
      375: { width: 375, height: 700, deviceScaleFactor: 1, mobile: true }, 390: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } };
    const SHEET = '#new-message-sheet .notebook-sheet-page:not([hidden])', BOX = `${SHEET} .deck-writing textarea`, WRITING = `${SHEET} .deck-writing`;
    const reader = await control({ method: 'agent_topic', operation_id: 'nb-card-images-reader', title: 'Read here', body: 'The agent\'s topic.', team: true, watching: true });
    const theirs = 'nb-card-images-theirs';
    assert.equal((await control({ method: 'agent_page', operation_id: theirs, item_id: theirs, topic_id: reader.topic_id, title: 'Their cards',
      body: `## Theirs\n\nA chart to read.\n![their-chart.png](attachment:${theirs}-media-0)\n`, attachments: [{ name: 'their-chart.png', image: 'screen.png' }] })).status, 'committed');
    for (const size of ['laptop', 390, 375, 320]) for (const scheme of ['light', 'dark']) {
      const label = `${size}-${scheme}`, phone = size !== 'laptop', id = `nb-card-states-${label}`;
      assert.equal((await control({ method: 'agent_page', operation_id: id, item_id: id, topic_id: 't1', title: 'Card states',
        body: `## Shown\n\nAn image from the page.\n![screen.png](attachment:${id}-media-0)\n\n## Gone\n\nAn image no longer on the page.\n![gone.png](attachment:gone-${label})\n`,
        attachments: [{ name: 'screen.png', image: 'screen.png' }] })).status, 'committed');
      const at = (name, url) => page(name, null, true, { url: facts.origin + url, beforeNavigate: async q => {
        await q.send('Page.addScriptToEvaluateOnNewDocument', { source: HOLD });
        await q.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await q.send('Emulation.setDeviceMetricsOverride', SIZE[size]);
        if (phone) await q.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      } });
      const press = async (p, selector) => {
        if (!phone) return p.point(selector);
        let last = null;
        await until(async () => { const now = await p.box(selector), same = Boolean(last && now) && ['x', 'y', 'width', 'height'].every(key => now[key] === last[key]); last = now; return same; }, selector + ' holds its place');
        const x = last.x + last.width / 2, y = last.y + last.height / 2;
        assert.ok(x >= 0 && y >= 0 && x < last.viewportWidth && y < last.viewportHeight, selector + ' is on screen');
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      // The card of that title, by its index; on a phone, one card shows at a time, so it is swiped to by its dot.
      const cardOf = async (p, title) => {
        const index = await p.evaluate(`[...document.querySelectorAll(${JSON.stringify(SHEET + ' .deck-card')})].find(r=>r.querySelector('.deck-title')?.textContent===${JSON.stringify(title)})?.dataset.index ?? null`);
        assert.notEqual(index, null, `the card ${title} shows`);
        const selector = `${SHEET} .deck-card[data-index="${index}"]`;
        if (phone) await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({inline:'start',block:'nearest',behavior:'instant'})`);
        return selector;
      };
      const head = async (p, said) => {
        const drawn = await sheetHead(p);
        assert.deepEqual({ overlaps: drawn.overlaps, off: drawn.off, small: drawn.small, covered: drawn.covered, sideways: drawn.sideways }, { overlaps: [], off: [], small: [], covered: [], sideways: false }, `${label}: ${said}: ${JSON.stringify(drawn)}`);
      };
      let p = await at('nb-card-states-' + label, `/?topic=t1&page=${id}`);
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && document.querySelectorAll(${JSON.stringify(SHEET + ' .deck-card')}).length===2`), 'the page opens in the composer');
      // Shown from Core, inside its card.
      let card = await cardOf(p, 'Shown');
      await until(async () => (await figures(p, card)).some(f => f.shown), `${label}: the card shows its image from the page`);
      assert.deepEqual((await figures(p, card)).map(f => [f.name, f.shown, f.inside, f.remove]), [['screen.png', true, true, null]], `${label}: shown`);
      assert.equal(await sideways(p), false, `${label}: nothing scrolls sideways`);
      await shot(p, `notebook-card-image-shown-${label}`);
      // Not on the page: its name, saying so.
      card = await cardOf(p, 'Gone');
      assert.deepEqual((await figures(p, card)).map(f => [f.name, f.shown, f.inside]), [['gone.png · not on this page', false, true]], `${label}: not on the page`);
      // Being written: the image under the box with its ×, named and with a tooltip, a 44-point target on a phone.
      card = await cardOf(p, 'Shown');
      await press(p, `${card} .deck-words`);
      await until(() => p.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(BOX)})`), `${label}: the card opens to write`);
      await until(async () => (await figures(p, WRITING)).some(f => f.shown), `${label}: the image shows under the box`);
      // A person scrolls to it, as they would to press ×.
      await p.evaluate(`document.querySelector(${JSON.stringify(WRITING + ' .deck-image-remove')}).scrollIntoView({block:'nearest',behavior:'instant'})`);
      const [written] = await figures(p, WRITING);
      assert.deepEqual([written.inside, written.remove.label, written.remove.title, written.remove.reached], [true, 'Remove the image screen.png from this card', 'Remove the image screen.png from this card', true], `${label}: being written`);
      if (phone) assert.ok(written.remove.width >= 44 && written.remove.height >= 44, `${label}: × is 44 points to touch: ${JSON.stringify(written.remove)}`);
      assert.equal(await sideways(p), false);
      await head(p, 'being written');
      await shot(p, `notebook-card-image-writing-${label}`);
      // Refused: the line takes a row of its own in the head, clear of every chip.
      assert.equal(await paste(p, BOX, [{ name: 'notes.pdf', type: 'application/pdf', size: 10 }]), true);
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet .notebook-sheet-status').textContent==='notes.pdf was not added: it is not a PNG, JPEG, GIF or WebP image.'`), `${label}: the refusal says what was not added and why`);
      await head(p, 'refused');
      await shot(p, `notebook-card-image-refused-${label}`);
      // Uploading: pasted while its upload is held, it shows from this device, saying so.
      await p.evaluate('globalThis.cardUploadHeld=true');
      assert.equal(await paste(p, BOX, [{ name: 'pasted.png', type: 'image/png', base64: png }]), true);
      await until(async () => (await figures(p, WRITING)).some(f => f.name === 'pasted.png · Uploading…' && f.shown), `${label}: the pasted image shows from this device while it uploads`);
      assert.ok((await figures(p, WRITING)).every(f => f.inside), `${label}: uploading, inside its card`);
      await head(p, 'uploading');
      await shot(p, `notebook-card-image-uploading-${label}`);
      await until(() => p.evaluate('Boolean(globalThis.releaseCardUpload)'), 'the upload is held');
      // Failed: the upload refused, the card says why and the page's list offers Retry, which sends it again.
      await p.evaluate('(globalThis.cardUploadHeld=false,globalThis.cardUploadFails=true,globalThis.releaseCardUpload())');
      await until(async () => (await figures(p, WRITING)).some(f => f.name.startsWith('pasted.png · ') && f.name !== 'pasted.png · Uploading…'), `${label}: the failed upload says so on the card`);
      const retry = `${SHEET} .notebook-image-rows .notebook-image > button:last-child:not([hidden])`;
      await until(() => p.evaluate(`document.querySelector(${JSON.stringify(retry)})?.textContent==='Retry image'`), `${label}: Retry is offered`);
      assert.ok((await figures(p, WRITING)).every(f => f.inside), `${label}: failed, inside its card`);
      assert.equal(await sideways(p), false);
      await head(p, 'failed');
      await shot(p, `notebook-card-image-failed-${label}`);
      await p.evaluate(`document.querySelector(${JSON.stringify(retry)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
      await press(p, retry);
      await holds(id, page => page.attachments.some(a => a.name === 'pasted.png') && lines(page.body).some(line => line.name === 'pasted.png'), `${label}: Retry sends it and the card names it`);
      await until(async () => (await figures(p, WRITING)).filter(f => f.shown && !f.name.includes('·')).length === 2, `${label}: both show, uploaded`);
      assert.deepEqual(p.errors, []); await p.close();
      // To read: someone Core does not let write the page sees the image and no ×, and cannot open the card to write.
      p = await at('nb-card-states-reader-' + label, `/?topic=${reader.topic_id}&page=${theirs}`);
      await until(() => p.evaluate(`document.querySelector('#new-message-sheet').open && document.querySelector('#new-message-sheet .notebook-sheet-status').textContent==='To read'`), `${label}: the page opens to read`);
      card = await cardOf(p, 'Theirs');
      await until(async () => (await figures(p, card)).some(f => f.shown), `${label}: the reader sees the card's image, read through the page`);
      assert.deepEqual((await figures(p, card)).map(f => [f.name, f.shown, f.inside, f.remove]), [['their-chart.png', true, true, null]], `${label}: to read`);
      await press(p, `${card} .deck-words`);
      assert.equal(await p.evaluate(`Boolean(document.querySelector(${JSON.stringify(WRITING)}))`), false, `${label}: a reader opens no box`);
      assert.equal(await sideways(p), false);
      await shot(p, `notebook-card-image-to-read-${label}`);
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
}
