# Notebook Chat availability and followed room reads (1042)

Intake: actual release314 `99bbe6a776d41c15f3fadba33de1f359214220f9`,
tree `a1648b6bcd46c63f0b107fecd7160d131231ccc8`, schema65. Own fresh branch
page-lane6/1042-chat-314-15845;1021 fifth source remains immutable. Fable15845
and current item revision5 replace the older proposed agent/person-card Chat
protocol with the existing Notebook **Chat about this…** flow.

Current owners: DeckPage.cardMenuItems/ask/sendAsk, NotebookPage.load/readRoom,
NotebookSheet.followed and app.notebookAskIn. Topic pages ask only that topic's
enabled agent participants; outcome pages ask only enabled agent participants
of that outcome's Conversation. A missing Conversation has no destination.
The same existing composer, exact retry, draft/privacy and write permissions
remain; choosing Chat sends nothing until the person presses Ask.

The scoped fix will give a disabled card Chat row its own explanation, using
the shared menu's existing description support. An empty outcome destination
says “No agent in this outcome’s Conversation yet”. Topic absence, private
draft, read-only page and an already-open ask explain their own condition.
Native evidence must first bind the actual outcome-page/Notebook surface with
one enabled Conversation agent, then observe an empty destination and a real
team/Conversation join on the followed commit, without reload. Existing room
recovery already retries null/empty rooms and must be retained if it works.
No timer/poll/cache authority or new sending owner is added.

Surface trace so far: outcomePages/OutcomeReferences lists document buttons in
the outcome's main Notebook, opening NotebookSheet. Its page header menu and
the rail's NotebookRailMenu use notebookMenuItems, which has no Chat choice;
Cards has the existing per-card Chat menu. The outcome page's right rail lists
no Notebook pages. A whole-page menu has no explicit card context; do not
silently ask about a first card or invent a whole-page chat protocol. Retain
the native trace and settle that surface dependency before expanding scope.

Verification: meaningful pre-edit disabled-row red; actual native menu/ask
opening with Core read boundary and no sent message, real empty-room join
recovery, topic routing and enablement/privacy controls; current owner/importer
base/head pairs and applied/restored controls after product changes. Both
looks, laptop/phone, supported Chrome/WebKit phases with exact source/producer/
served hashes. One own relevant workload, load<=12/18, isolated headless browser
profile/origin/store; Browser.close/observed PID/profile/fixture EOFexit0/absence/
empty errors/closedport each phase. Emulated viewport/input is not a physical
phone/IME proof. Requested ordinary; Fable owns actual classification/freeze/
stages and Warp independent read/approval/carry/landing.

## Pre-edit actual314 trace and bounded decision

The corrected native trace proves the outcome main Notebook document -> sheet
Cards -> per-card menu opens the existing Chat composer, focused on the actual
Conversation's one enabled coordinator, with no message sent. The missing-door
claim is not reproduced on that surface. The empty Conversation row lacks an
explanation (real red). Merely adding an agent to the outcome team correctly
leaves it disabled: Core Conversation participants are people plus coordinator,
not all team agents. A subsequent real coordinator choice creates the enabled
Conversation participant; the followed topic read enables Chat without reload.
This is coordinator-join evidence, not a headless-seat provisioning exercise.

Keep the already-working followed room read and recipient scope unchanged.
The only product correction is the card-menu descriptor's disabled reason.
The outcome rail contains no Notebook pages, so the conditional missing rail
door is not observed. No whole-page menu silently chooses a first card.1028's
page-colour/page-menu/thumbnail changes remain Page5's;1042 does not alter them.
Initial native setup mistakes (team vs Conversation, nonexistent Cards button,
full bootstrap authority object) and the client already-asking fixture paint
error are retained separately from the corrected behavior red.

Unknown initial/failed room reads must not claim there is no agent. One derived,
unpersisted roomConfirmed bit distinguishes a successful null/empty answer
from an unavailable read; it changes no recipient, read schedule or send owner.
The explanation says who can be asked is not confirmed until the first read
answers. Existing previously confirmed rooms remain kept after failed rereads.
Native phone entry selects the existing Notebook tab before pressing the
document; the first full matrix's omitted tab is a retained fixture failure.
