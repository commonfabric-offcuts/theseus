const copy = structuredClone;
const TYPES = new Set(['image/png','image/jpeg','image/gif','image/webp']);
const megabytes = bytes => `${Math.floor(bytes / 1048576)} MB`;
const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');

// A page's images use the same Core media.begin/media.publish protocol as
// message images. Bytes and the exact two requests share the page's journal;
// publication is not page attachment until its receipt has been confirmed.
// An image's media id is chosen when it is taken in, so a card can name it at
// once (item 321, docs/decks.md "Images in a card"); its bytes show from this
// device until Core has them.
export class NotebookImages {
  // released: what this visit took off the page, by media id, so Undo can put it back (restore).
  constructor(writing) { this.writing=writing; this.running=new Map(); this.arriving=new Map(); this.dropped=new Set(); this.released=new Map(); }
  // Whether the page takes this file, decided at once, before its bytes are read: {media, name}, or a refusal that
  // says what was not added and why.
  admit(file) {
    const w=this.writing, limits=w.bootstrap.limits;
    if(w.closed||w.readOnly||w.deleted)throw Error('This page cannot be changed here.');
    const name=file.name||'Pasted image.'+(file.type.split('/')[1]||'png');
    if(!TYPES.has(file.type)||!file.size)throw Error(`${name} was not added: it is not a PNG, JPEG, GIF or WebP image.`);
    if(file.size>limits.image_bytes)throw Error(`${name} was not added: an image may be at most ${megabytes(limits.image_bytes)}.`);
    const pending=[...w.images.filter(i=>!i.removed&&!i.ready),...this.arriving.values()];
    const sizes=w.value.attachments.map(ref=>w.images.find(i=>i.ready?.media_id===ref.id)?.size??w.base.source.attachments.find(a=>a.id===ref.id)?.size_bytes);
    if(sizes.some(n=>!Number.isInteger(n)))throw Error('Read this page’s attachments again before adding another image.');
    if(sizes.length+pending.length>=limits.attachment_count||[...sizes,...pending.map(i=>i.size)].reduce((n,size)=>n+size,file.size)>limits.attachment_bytes)
      throw Error(`${name} was not added: a page holds at most ${limits.attachment_count} images, ${megabytes(limits.attachment_bytes)} in all.`);
    if(new TextEncoder().encode(name).length>limits.media_name_utf8_bytes)throw Error('The image name is too long.');
    return {media:crypto.randomUUID(),name};
  }
  // The image the page holds under a media id: its entry, or the file still being read in; null when it holds none.
  held(media) {
    return this.writing.images.find(i=>!i.removed&&(i.media===media||i.begin?.target.media_id===media||i.ready?.media_id===media))??this.arriving.get(media)??null;
  }
  async capture(file, admitted=this.admit(file)) {
    const w=this.writing, discarded=w.discardVersion, {media,name}=admitted;
    this.arriving.set(media,{media,name,type:file.type,size:file.size,file});
    let bytes;
    try {bytes=await file.arrayBuffer();} finally {this.arriving.delete(media);}
    if(w.closed||w.readOnly||w.deleted||discarded!==w.discardVersion)throw Error('This page is no longer open for writing.');
    if(this.dropped.delete(media))return null;
    const entry={id:crypto.randomUUID(),media,name,type:file.type,size:file.size,bytes,begin:null,publish:null,begun:false,ready:null,associated:false,removed:false,error:null};
    w.images.push(entry); w.notify();
    try {await w.persist();}
    catch(error){entry.error='Device copy unavailable: '+error.message+'. Keep this page open.';w.notify();return entry;}
    this.run(entry); return entry;
  }
  // keep: × in a card took it off (docs/decks.md, "Images in a card"), so Undo may put it back.
  async remove(id, {keep=false}={}) {
    const w=this.writing, entry=w.images.find(i=>i.id===id||i.media===id||i.ready?.media_id===id), arriving=this.arriving.get(id);
    if(w.closed||w.readOnly||w.deleted)return;
    // An image still being read in is not taken in at all.
    if(arriving)this.dropped.add(id);
    const media=entry?.ready?.media_id??id;
    // What putting it back needs, for this visit: its entry and bytes, or the file still being read in.
    if(keep)this.released.set(entry?.media??media,{entry,bytes:entry?.bytes??null,file:arriving?.file??null,name:arriving?.name??null});
    if(entry){entry.removed=true;entry.bytes=null;}
    w.edit({attachments:w.value.attachments.filter(a=>a.id!==media)},w.capture());
    await w.persist(); w.notify();
  }
  // An image this visit took off the page, put back on it: Undo brought back a card line naming it (docs/decks.md,
  // "Images in a card"). One uploaded is attached again; one still uploading goes on uploading, from its bytes, and
  // is attached once Core has it; one Core held before this visit is attached again by its id, which Core takes from
  // a writer of a page that has carried it. An image never taken off this page is left alone.
  async restore(media) {
    const w=this.writing, kept=this.released.get(media);
    if(!kept||w.closed||w.readOnly||w.deleted)return null;
    this.released.delete(media);
    const old=kept.entry;
    if(!old) {
      // Still being read in, it is taken after all; read in and let go, it is taken again from its file.
      if(this.arriving.has(media)){this.dropped.delete(media);return null;}
      if(kept.file)return this.capture(kept.file,{media,name:kept.name});
      if(!w.value.attachments.some(a=>a.id===media))w.edit({attachments:[...w.value.attachments,{id:media}]},w.capture());
      await w.persist(); w.notify(); return null;
    }
    if(old.ready){old.removed=false;old.associated=false;this.associate(old);w.notify();return old;}
    // Its bytes go back under an entry of its own, so the device copy holds them again, once any request the removal
    // stopped has ended; what that request reached carries over.
    const entry={...old,id:crypto.randomUUID(),bytes:kept.bytes,removed:false,associated:false,error:null};
    w.images=[...w.images.filter(i=>i!==old),entry]; w.notify();
    await this.running.get(old.id);
    Object.assign(entry,{begin:old.begin,publish:old.publish,begun:old.begun,ready:old.ready});
    if(entry.ready)entry.bytes=null;
    if(w.closed||w.readOnly||w.deleted||entry.removed)return entry;
    this.run(entry); return entry;
  }
  run(entry) {
    if(this.running.has(entry.id))return this.running.get(entry.id);
    const job=this.upload(entry).finally(()=>{this.running.delete(entry.id);this.writing.notify();});
    this.running.set(entry.id,job);return job;
  }
  async upload(e) {
    const w=this.writing, valid=()=>!w.closed&&!w.readOnly&&!w.deleted&&!e.removed;
    if(!valid())return;
    try {
      e.error=null;
      // Retry may follow a failed initial device copy. Retain the bytes and
      // current request state before attempting any network work again.
      await w.persist();
      if(e.ready){if(valid())this.associate(e);return;}
      if(!e.begin) {
        const hash=await digest(new Blob([e.bytes],{type:e.type}));
        if(!valid())return;
        const id=e.media??crypto.randomUUID(),pub=crypto.randomUUID(),expected={authority:copy(w.bootstrap.authority)};
        // Bootstrap authority may have extra descriptive fields; only the
        // canonical pair belongs in a command.
        expected.authority={authority_id:w.bootstrap.authority.authority_id,authority_epoch:w.bootstrap.authority.authority_epoch};
        e.begin={v:1,instance_id:w.bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'media.begin',target:{media_id:id},expected:{...expected,media_revision:0},
          args:{name:e.name,content_type:e.type,size_bytes:e.size,sha256:hash,publish_operation_id:pub}};
        e.publish={v:1,instance_id:w.bootstrap.instance_id,operation_id:pub,kind:'media.publish',target:{media_id:id},expected:{...expected,media_revision:1},args:{}};
        await w.persist();
      }
      if(!valid())return;
      if(!e.begun) {
        const answer=await w.api.command(copy(e.begin));
        this.confirm(answer,e.begin);
        if(answer.result?.media_id!==e.begin.target.media_id||answer.result.media_revision!==1||answer.result.state!=='pending')throw Error('Image preparation did not match.');
        if(!valid())return;
        e.begun=true;await w.persist();
      }
      if(!valid())return;
      const answer=await w.api.upload(copy(e.publish),new Blob([e.bytes],{type:e.type})); this.confirm(answer,e.publish);
      const d=answer.result,a=e.begin.args;
      if(d?.media_id!==e.publish.target.media_id||d.media_revision!==2||d.state!=='ready'||d.name!==a.name||d.content_type!==a.content_type||
          d.size_bytes!==a.size_bytes||d.sha256!==a.sha256||typeof d.inline!=='boolean')throw Error('The uploaded image does not match the selected file.');
      if(w.closed)return;
      e.ready=copy(d);e.bytes=null;await w.persist();
      if(valid())this.associate(e);
      w.notify();
    } catch(error) { if(w.closed)return;e.error=error.message; await w.persist().catch(()=>{});w.notify(); }
  }
  confirm(r,e) {
    if(r?.instance_id!==e.instance_id||r.operation_id!==e.operation_id||r.kind!==e.kind)throw Error('Image confirmation does not match its request.');
    if(r.status!=='committed'||r.recorded!==true)throw Error(r.error?.message??'Image confirmation is uncertain. Retry this image.');
  }
  associate(e) {
    const w=this.writing;
    if(w.closed||w.readOnly||w.deleted||e.removed||e.associated)return;
    e.associated=true;
    if(!w.value.attachments.some(a=>a.id===e.ready.media_id))w.edit({attachments:[...w.value.attachments,{id:e.ready.media_id}]},w.capture());
    else w.persist().catch(error=>{e.error=error.message;w.notify();});
  }
  resume() {
    const w=this.writing;
    for(const e of w.images)if(!e.removed){
      if(!e.ready)this.run(e);
      else this.associate(e);
    }
  }
}
