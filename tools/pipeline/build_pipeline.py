#!/usr/bin/python3 -I
from __future__ import annotations

"""Build the hand-written Release pipeline page from items.json and the edits below.

Usage: tools/pipeline/build_pipeline.py [OUTPUT]   (default: release-pipeline.txt)

Moved as it was from a temporary folder; item 84 replaces it with pipeline
records in Theseus. Each revision appends its edits here, as before.
"""

import json
from pathlib import Path
import sys

m=json.load(open(Path(__file__).resolve().parent / 'items.json'))['items']
m.append({'title':'A Notebook page shows when it changed since you last read it','what':'A Notebook page you have read gets a mark when it is revised, like an unread count, until you open it again; the Reader shows what changed.','asked_by':'tony','size':'M'})
m.append({'title':'Writing in a topic makes you one of its participants','what':'Anyone who writes in a topic becomes a participant, so they can say where it stands (its state), not only the topic\'s creator and the outcome\'s owner.','asked_by':'tony','size':'S'})
m.append({'title':'Asking is part of sending: the system sets and clears "Waiting on you"','what':'A message to a person must say whether it asks or tells; the command refuses one that says neither. An asking message makes its topic wait on that person in the same act, the wait clears itself when they reply in the topic, and it shows how long it has waited. Agents asking agents get the same, so an unanswered ask becomes visible. Nobody has to remember to set or clear it.','asked_by':'tony','size':'M'})
m.append({'title':'Done topics fold away, a new message reopens one, and archived topics can be found','what':'In an outcome\'s list, Done topics fold into one closed "Done (N)" line at the bottom that opens to show them. A new message in a Done topic brings it back as active, so nothing gets lost there. Archived topics leave the list but stay reachable from an "Archived" line, instead of only by link as today.','asked_by':'tony','size':'M'})
m.append({'title':'A topic shows whether anyone is working on it','what':'"Active" today covers being built, parked, and ongoing. The list tells working from parked using facts the system has, such as the topic being in NOW on this page, or a participant having posted or taken a turn in it recently, rather than an agent remembering to say so.','asked_by':'tony','size':'M'})
m.append({'title': 'The Reader drops the bright green ring around the message', 'what': 'The focus ring drawn around the message in the Reader goes; focus is still shown where a keyboard user needs it.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': 'Private note moves to the lower left, before Add image, and says what it will do', 'what': 'The Private note control sits at the lower left before Add image, and its label follows its state: "Add note", then "Show note" once one exists.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': 'The Reader drops the "Reply" label row', 'what': 'The separate "Reply" label and its row go; the writing field\'s own placeholder says what it is.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': 'In wide layout, the top bar spans both panels', 'what': 'When the Reader is in its wide layout, the bar at the top of the left panel runs across both panels.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': 'Option-Up and Option-Down move between messages in the Reader, as in AIM', 'what': 'Option-Up and Option-Down step to the previous and next message in the Reader, as the AIM message view did.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': 'Choose agents from a list, and an @mention adds that agent to To', 'what': 'A dropdown lists the agents you can address. Typing @name of an agent in the writing adds it to the To field.', 'asked_by': 'tony', 'size': 'M'})
m.append({'title': 'Move around the whole page by keyboard', 'what': 'The keyboard reaches everything, sidebar to topic page and back, with a visible place and predictable keys.', 'asked_by': 'tony', 'size': 'M'})
m.append({'title': 'Reorder topics in an outcome', 'what': 'Drag a topic, or use Cmd-Up and Cmd-Down, to change the order of topics in an outcome. The order is saved for everyone.', 'asked_by': 'tony', 'size': 'M'})
m[21]['title']="The Reader's heading shows the topic name, and clicking it opens the topic"
m[21]['what']="The Reader's large 'Message' heading becomes the source topic's name, which opens that topic when clicked. The smaller 'Message' on the author and time line goes, and the back button drops the word 'Topic' but keeps its arrow."
m[24]['title']='Thumbs-up on a message, for you and for agents'
m[24]['what']='You can thumbs-up a message to say you got it and understood it, instead of typing "ack". Agents get the same from their command line, so they stop sending messages that only say they received something. It stays tied to that message and does not complete the topic.'
m[9]['title']='A reply records which message it answers, even without a quote'
m[9]['what']='A reply carries a link to the message it answers, whether or not you quoted any of it, and everyone, agents included, sees which message that is.'
m.append({'title': 'An outcome has its own conversation for status and intake; topics are only work that ends', 'what': "What's live, the Friction log and the like are not arrows: they never land. Each outcome gets its own standing conversation for status and for dropping in friction and requests. Each item in it is then taken into a topic or onto this page, and marked as taken. Topics stay for work that ends.", 'asked_by': 'tony', 'size': 'M'})
m.append({'title': 'The tools we built move into the repo, with checks', 'what': "The deploy script, the release check and mutant runner, this page's builder and the baseline measurement live today in temporary folders that are cleaned after a few idle days. They move into the Theseus repo under tools/, are reviewed and get their own checks, so they cannot evaporate and every agent can use them.", 'asked_by': 'fable', 'size': 'S'})
m[26]['what']="After Return inserts a quote, the visible cursor lands after the quote and its newline, ready to type. If the writing is now taller than the field, the field scrolls so the cursor stays in view. Reproduce Tony's exact steps first."
m.append({'title': 'The pipeline becomes part of Theseus, for every outcome', 'what': 'Every outcome gets a pipeline. Each item is a record, not a line of text: number, title, who raised it, size, and links to its topic and to the release that shipped it. Its glyph comes from facts: being built when its topic is open with work observed (73), needs your decision when an ask to you waits (71), shipped when a release containing it is deployed (12). You steer by reordering or dropping items, and nobody hand-edits a page or posts that it changed.', 'asked_by': 'tony', 'size': 'L'})
m.append({'title': 'A choice with one option is shown as plain text, not a dropdown', 'what': 'Where the Reader offers only one place to reply, for example a Notebook page opened from a topic, it says "Replying in <topic>" instead of showing a dropdown with a single choice.', 'asked_by': 'tony', 'size': 'S'})
m.append({'title': "The outcome's row shows where the whole outcome stands", 'what': 'Next to each outcome in the sidebar, one light from facts: being built (work observed in NOW items), waiting on you (an ask to you is waiting), done (everything in its pipeline shipped and its checks pass), or no activity observed (nothing in progress and nothing moving, so it may be stalled). It never claims nobody is working when Theseus cannot see.', 'asked_by': 'tony', 'size': 'M'})
m[68]['title']='Notebook pages sit beside topics in the sidebar, and show when they changed'
m[68]['what']="An outcome's Notebook pages get equal billing with its topics in the sidebar, not only as a closed line above each topic. A page you have read is marked when it changes, like an unread count, until you open it, and the Reader shows what changed."
m[83]['title']='The pipeline becomes part of Theseus, for any outcome that delivers work'
m[83]['what']='An outcome can turn on a pipeline when it delivers work; it is an option, not something every outcome gets, because the Notebook is for anything people and agents work on together. Each item is a record, not a line of text: number, title, who raised it, size, and links to its topic and to the release that shipped it. Its glyph comes from facts: being built when its topic is open with work observed (73), needs your decision when an ask to you waits (71), shipped when a release containing it is deployed (12). You steer by reordering or dropping items, and nobody hand-edits a page or posts that it changed.'
m[9]['title']='A reply records which message it answers, and goes to its author'
m[9]['what']="A reply carries a link to the message it answers, whether or not you quoted any of it, and is addressed to that message's author by default; you can remove them. Everyone, agents included, sees which message it answers."
m[77]['title']='Option-Up and Option-Down move the line or list item you are on, as in AIM'
m[77]['what']='In a writing field, Option-Up and Option-Down move the line, list item or paragraph the cursor is on (or the selected ones) above or below its neighbour, as the AIM editor did. With the cursor on "b) two" in "a) one / b) two / c) three", Option-Up gives "b) two / a) one / c) three". Undo puts it back. Where nothing can move, the keys do what they normally do.'
m[23]['title']='Copy Link on any message, and a pasted link opens that message'
m[23]['what']='Two parts. 1) Each message can copy its Theseus link to the clipboard: from an overflow menu that replaces the Stacked/Wide button (Stacked/Wide moves into it), and from a new right-click menu on any message. 2) When a message containing such a link is shown, the link is recognised and becomes clickable, opening that message in the Reader.'
m[23]['size']='M'
m[23]['asked_by']='tony'
m.append({'title':'Close never loses what you typed when the device save fails','what':'Pressing Close at the moment a device save fails can today lose what was typed during that save, while the page still closes. Close stops taking typing while it saves, or saves again before closing, and refuses with a plain reason if it cannot keep the writing.','asked_by':'found-in-review','size':'S'})
m.append({'title':'Each deploy records which pipeline items it shipped','what':'Every merged change names the item numbers it delivers; the deploy writes a release record listing them. The pipeline marks those items shipped from that record, and Where things stand (8) shows what is live from it. 12 keeps its own place.','asked_by':'fable','size':'S'})
m.append({'title':'Search messages, with filters for yours, by author and by date','what':'A search box finds text across every topic and Notebook page you can read. Filters narrow it to your own messages, to an author, to a date range, or to an outcome. Each result shows its topic, author and time with the words highlighted, and opens that message in the Reader. Agents get the same search from their command line.','asked_by':'tony','size':'M'})
m[28]['title']='A colour for each agent, on its name and its cards'
m[28]['what']='Each agent gets its own background colour: on its name, and kept consistent as the background of the cards that carry its messages, in light and dark. Your colour is black and is already done. No coloured left edges on cards. The look is judged by eye, by Fable with Warp as the eval, not by a rule.'
m[29]['title']='A red line marks the messages you have not replied to'
m[29]['what']='A red "New" line sits just below the oldest message you have not replied to. When you reply, it moves up to just below the next most recent message you have not replied to, and it goes when you have replied to all of them. Knowing which message a reply answers comes from 10.'
m[81]['what']=m[81]['what']+" Only the outcome's coordinator answers what is posted there, and other agents only when named, so a post never draws several agents saying the same thing. It aims to be natural enough that a separate Q&A is not needed."
m[28]['what']="Your black and Fable's dark green stay as they are; every other agent gets its own background colour, on its name and kept consistent as the background of the cards that carry its messages, in light and dark. Clicking an agent's name lets you change its colour, and your choice is kept for you on every device. No coloured left edges on cards. The look is judged by eye, by Fable with Warp as the eval."
m.append({'title':'Cmd-A in the writing selects only the message text','what':'In the Reader and the inline composer, Cmd-A while writing selects all of the message text and nothing else on the page or in the controls around it.','asked_by':'tony','size':'S'})
GLYPH={}
PROGRESS={27:'Still broken at 5:45 PM Thu Nov 5 (you).',12:'First step ships with this release: a Measurements page on the outcome, updated by hand at each release. Filling it on every deploy is the rest of this item.',1:'All 22 are fixed and each group was reviewed independently; the final run of every check is under way.',2:'Done for refusals: × now says why it cannot close and keeps the draft and image. The saving sign is still to build.'}
who={'tony':'you','fable':'Fable','found-in-review':'found in review','aim-core':'aim-core','aim-ux':'aim-ux','aim-spec':'aim-spec','warp':'warp'}
size={'S':'small','M':'medium','L':'large'}
def by(x):
    a=x['asked_by']
    return 'found in review' if a=='found-in-review' else 'asked by '+who.get(a,a)
def item(n):
    x=m[n-1]
    p=f"\n    Progress: {PROGRESS[n]}" if n in PROGRESS else ''
    return f"{GLYPH[n]} {n}. {x['title']}  ({size[x['size']]}; {by(x)})\n    {x['what']}{p}\n"
PROGRESS.update({
 1:'Started 3:26 PM Thu Nov 5. Now: the last full run of every check, then two independent reviews, then deploy.',
 2:'Started 3:26 PM Thu Nov 5, inside the repair in 1. Done for refusals: × now says why it cannot close and keeps the draft and image. The saving sign is still to build.',
 3:'Started 4:55 PM Thu Nov 5. This release runs every check mode twice. Making the deploy itself refuse to ship without that is still to build.',
 4:'Started 4:55 PM Thu Nov 5, inside the full run: each case that fails only sometimes is fixed at its cause, not rerun until it passes.',
 12:'Not started: it starts when this release deploys. First step: a Measurements page on the outcome, updated by hand at each release. Filling it on every deploy is the rest of this item.',
})
PROGRESS.update({1:'Started 3:26 PM Thu Nov 5. The network drop at about 7:40 PM stopped one agent; its fixes were kept. Every check passed once the Mac was quiet, and the review of the fixes approved them. Now: the review of the stale-page fix, then the merge, one more full run, a last review, then deploy.'})
PROGRESS.update({2:'Started 3:26 PM Thu Nov 5, inside the repair in 1. Done for refusals: × now says why it cannot close and keeps the draft and image. The saving sign rides with 87 in NEXT.',3:'Started 4:55 PM Thu Nov 5. This release runs every check mode before deploy. The deploy refusing to ship on a failed check rides in NEXT, because the journeys (6) need it.'})
PROGRESS.update({2:'The refusals part shipped in release 18. Now: the saving sign, built with 87.',3:'Release 18 ran every check mode before deploy. Now: the deploy refuses to ship on a failed check, built with 83.',12:'First step shipped with release 18: the Measurements page, updated by hand at each deploy. Filling it on every deploy comes with 88 and 83.'})
SEC={'NOW':'🔨','NEXT':'⏭','LATER':'💤','CANDIDATES':'💤'}
groups=[
 ("NOW: being built overnight, started 10:30 PM Thu Nov 5. Pieces merge and deploy as their dependencies land; nothing is cut to meet a time",[87,90,2,3,83,37,10,30,51,29,59,58,71,73,88,70,48,82,47,84,14,86,8,69,17,35,34,12]),
 ("NEXT: the release after NOW. I decide this order; tell me if you disagree",[89,72,22,74,76,75,77,85]),
 ("LATER: the order I plan after that",[26,27,28,78,25,23,24,79,80,81]),
 ("CANDIDATES: things you asked for in the app",[11,31,61,62]),
 ("CANDIDATES: how we work, measure and know it's right",[9,13,15,16,18,19,20,21,32,33,5,63,68]),
 ("CANDIDATES: agents, wakes and hosting",[36,38,39,40,41,42,43,44,45,46]),
 ("CANDIDATES: smaller fixes and polish",[49,50,52,53,54,55,56,57,60,64,65,66,67,6]),
]
seen=[n for _,g in groups for n in g]+[7,1,4]
assert sorted(seen)==list(range(1,91)), (set(range(1,91))-set(seen), [n for n in seen if seen.count(n)>1])
for head,g in groups:
    for n in g: GLYPH[n]=SEC[head.split(':')[0]]
BUILDING={87,90,2,3,83,10,30,51,29,59,58,71,73}
for n in [87,90,2,3,83,37,10,30,51,29,59,58,71,73,88,70,48,82,47,84,14,86,8,69,17,35,34,12]: GLYPH[n]='🔨' if n in BUILDING else '💤'
GLYPH[31]='❓'
out=["""Release pipeline

Changed 10:59 PM Thu Nov 5: release 18 is live, so 1 and 4 moved to SHIPPED; tonight's set is now NOW, with 🔨 on what is being built; NEXT starts with 89 (search).

🔨 being built   ⏭ next   💤 not started   ❓ needs your decision   ✅ shipped

Every feature and fix we could build next is on this page with a number. A number never changes and is never reused, so you can refer to any item by its number.

Who decides: agents drive the order; you steer. I put what we build next in NEXT. Reply in "What's live and what's next" with numbers only when you want something different, for example "10 before 69" or "drop 62". ❓ marks the few items that need your decision. Every release updates this page: what it shipped moves to SHIPPED with its date. This page is written by hand until 84 makes the pipeline part of Theseus.

Each item says its size (small, medium or large, compared with the others) and who raised it.
"""]
for head,g in groups:
    out.append("\n"+head+"\n\n"+"\n".join(item(n) for n in g))
out.append("""
SHIPPED

Release 18, 10:57 PM Thu 5 November 2026
✅ 1. Fix the 22 browser checks that failed on the live app. All 11 modes pass: 152 browser cases.
✅ 4. Each case that failed only sometimes was fixed at its cause, or shown to fail only when the Mac was overloaded.
- A Notebook page you reply to no longer goes stale: once it is revised, opening it shows the new revision and your next reply is about the page you see. Only writing you have started keeps its older revision, and the Reader says so.
- Typing in the Reader while another message is opening is kept, saved on this device as you type. Sending, images and Save note wait until it opens, and say why. If the device cannot keep your writing, the Reader stays put rather than replacing it.
- × and Close say why they cannot close, and keep the draft and image (part of 2).
- A version check that is blocked says your saved version was read, instead of "unavailable".
- Removing an image in the inline composer no longer takes focus away from your writing.
- Every check mode ran before deploy (part of 3), and the Measurements page has the numbers (first step of 12).

5 November 2026
✅ 7. This page.
- Mark unread: a message you have read can be marked unread again from the Reader. It shows an Unread pill and counts in the topic and outcome until you open it again.
- Closing the Reader after "Read it" clears the last mark leaves focus on the page, without a ring around it.
- A waiting list puts you first ("Waiting on you, ...") and the topic's own page shows its state whole.
- Counts are compact pills that stand out from their row and stay with their title.
- A row marked read in Sent hands focus to the row now in its place.
- Reader passage and your own messages have clearer colours.
- The outcome's Notebook pages are listed at the top of each topic, closed by default, and open in the Reader.
- Attachments: a refusal names its attachment and clears once the attachment opens.
- Checks: the page's look is judged from screenshots, on laptop and phone, light and dark.
""")
open(sys.argv[1] if len(sys.argv) > 1 else 'release-pipeline.txt','w').write("".join(out))
print(len("".join(out).encode()))
