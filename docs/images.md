# Images while writing

How an image gets into a reply or a new message on the topic page and in the
Reader (`web/image-pick.mjs`, `web/reader.mjs`, `web/inline-composer.mjs`). A
Notebook card takes an image the same ways, pasted, dropped or picked with
`#img`, and shows it under its words ([decks.md](decks.md#images-in-a-card)).
Every way in ends in the same place: the image goes through `Uploads`
(`web/uploads.mjs`), with the same limits, device copy and confirmation as a
file chosen with Add image.

## Four ways in

- **Paste.** An image pasted into the writing is added, as before.
- **Add image** opens the file picker.
- **Paste image.** Where the browser can say, without asking, that the
  clipboard holds an image, the button reads Paste image, and a press adds
  that image; Choose file beside it still opens the picker. The page asks only
  Chrome and Edge, and only when the writing or the window takes focus: it
  calls `navigator.permissions.query({name: 'clipboard-read'})` and reads the
  clipboard only when the person has already granted that permission. It never
  asks for the permission itself. Safari, Firefox and every browser on iPhone
  and iPad read the clipboard only inside a press and show their own Paste
  button, so there the button always reads Add image; on an iPhone or iPad,
  press and hold in the writing and tap Paste.
- **#img.** Typing `#img` at the start of a line or after a space opens a short
  list under the writing of the topic's recent images. Letters typed straight
  after it (`#imgchart`) narrow the list by name. ↑ ↓ move through it, Return
  or Tab picks, Escape closes it, and a tap or click picks one; the writing
  keeps focus throughout. The choice ↑ ↓ reach comes into view by the one rule
  for what the keys select (docs/interaction.md). Picking takes the `#img` words out of the writing as
  one edit Undo puts back, reads the image's verified bytes through the message
  that carries it, and adds them as a pasted image: a copy of its own in this
  reply, so an image someone else sent can be used as it is.

## Thumbnails

Each image in a composer is a small thumbnail in the strip above the field,
at every width (docs/reader.md). It holds its place before it loads, and one
with nothing to show gives its place to the image's name. A thumbnail is
the file as chosen while it is in memory, else the copy saved on this device, else the verified
original read back from Theseus (`Uploads.preview`). Each image in the #img
list has one too, read through its message. Theseus keeps no smaller copy and
refuses a second image read while one is under way, so the page's image reads
take turns (`readInTurn`): thumbnails load one after another, a picked image
goes ahead of thumbnails not yet started, and a thumbnail whose row has gone
is not read. A sent message's images in the Reader keep their Open button;
its read does not take a turn, so it can still meet a busy refusal while
thumbnails load.

A narrower row, on a phone, shows no thumbnail. Beside one, the row's words
would have so little room that their lines change as Check confirmation or
Retry upload comes in before Remove, and the row would grow or shrink under a
finger; without one, the row lays out as it did before thumbnails.

## The view: `topic_images`

`topic_images {topic_id, limit?}` lists the images a writer may pick in a
topic, newest first: those carried by the newest 200 messages the reader may
see in the topic and, for a topic in an outcome, in that outcome's
conversation when the reader may read it. A whisper's images show only to its
two people. Each image is listed once, with the newest message that carries
it:

    {instance_id, topic_id, topics: [topic ids read], window: 200,
     items: [{source_ref: {kind: "message", id}, topic_id, author_id, sent_ms,
              attachment: {id, name, content_type, size_bytes, sha256, inline}}]}

`limit` is 1 to 50 (default 24). Only verified inline images (PNG, JPEG, GIF,
WebP) are listed. The window bounds the read however long the topic is, so an
image older than the newest 200 messages is not offered. A reader who may not
read the topic is refused as for `topic`.
