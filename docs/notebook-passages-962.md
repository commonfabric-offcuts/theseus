# Notebook display passages · 962

Base: release252, `3d8756b464971dd16b064591e4d6693564768fd5`.
Tony’s14010/14028 and Warp’s14318 assign the existing message reading
behavior to Notebook display.983,982,967 and958 remain separate work.

Saved Notebook cards, opening prose and read-only revision pages use the
message passage owners. `FeedPassages` owns sentence/Markdown mapping,
Shift extension, light geometry and Copy. `DossierSelectionQuote` owns
coarse-pointer selection and its Quote pill, including held selection during
native focus/collapse. Optional surface ports preserve their existing message
defaults. Notebook supplies its actual saved page, visible revision and current
surface eligibility. No second selection or composer implementation is added.

A card’s existing title/body elements share formatter source coordinates;
controls and layout remain in their current owners. Literal title marks stay literal. Plain Return quotes the
selected or lit passage into the existing Reader. Copy retains existing raw
Markdown semantics. A native selection keeps its focus as the pointer crosses
another card. Links, buttons, menus, card editing, literal Text writing and
their keys retain their existing behavior. Unsaved card/page content is never
attributed to the saved revision. Repaint, revision change, editing, closing or
loss of eligibility removes the old light.

Bookends uses the message cards’ ink/field selection treatment. Paper uses a
22% accent/paper mix with normal ink, scoped to Notebook display and Notebook
sources in the Reader. Ordinary message formatting and styles remain unchanged.

Quotes retain the exact memory id and immutable revision. Where displayed
cards omit hidden metadata/image/stack lines, contiguous source parts preserve
the joined visible writing while each excerpt remains valid against Core’s
source. Repeated words are mapped within the actual saved card region.

The current hosting topic remains the destination. A full page or outcome
revision view uses the Notebook’s existing owning topic/conversation routing.
A tab-private pending quote is fenced by instance, person, destination, page,
revision and token. The Reader claims it before its synchronous edit and
restores it if writing cannot accept it. Storage/source refusal retains the
intent without changing a draft; retry/reload adds the quote once. A late claim
cannot take a newer selection. Quoting appends to existing writing and sends
nothing; sending remains the existing explicit act.

`tests/notebook_passages_962_native.mjs` retains actual baseline hover/Return
reds and editing controls against a selected own pristine checkout.
`tests/notebook_passages_962_acceptance.mjs --all` runs real display, selection,
quote receipts, phone-context pill, Copy/control/fence/link, revision,
projection/send, draft recovery and ordinary-message controls in isolated
Chrome for Testing with scratch HTTP/Core. Paper screenshots are inspected.
Desktop mouse selection plus touch activation in a coarse context does not
claim physical phone handles, software keyboard or native system-menu proof.

Owner tests stay below the browser. An actual applied revision-fence mutant
must fail, then byte-exact restoration must pass. The broad wiring comparison
names its existing baseline failures without weakening or waiving them.
An inherited full-page narrow-column layout defect at1280px is reported with
pristine252/candidate images; this slice preserves the existing geometry.
All browsers close through Browser.close; observed owned PIDs/profiles,
fixture EOF/exit0 and closed ports are checked. Artifacts stay outside the
repository. Freeze with exact source head/tree/base for Warp’s one diff/test
read. Fable owns pipeline stages and Warp owns carry/deploy.

Review correction14382/14383: the full-page initializer supplies its own lazy
binding port, including the helper in the route declaration contract and
constructing the shared controller only when saved words bind in the active
run. The unchanged867 route cut must still load before picking and preserve
Cards-over-Text preference. Failure notices hand the error object to the
existing line writer; retry text accompanies it without losing its type/code.
Compare every test file naming a touched module against pristine252 before
the successor freeze. Retain both requested regressions and all baseline reds.
