# Interactive HTML in a cover or Notebook

A complete `html` fence draws an interactive document in a sandbox. Covers
keep all surrounding text literal; Notebook pages keep their existing Markdown.
Ordinary messages and incomplete fences remain text. Core retains the original
fence and its words, including through Notebook Text, editing, copying and reads.

Scripts run, without a same-origin, storage or Core capability. The main page's
CSP is unchanged. `/interactive-html` serves a content-free, no-store bootstrap
under its own CSP. The page embeds it with only `sandbox="allow-scripts"`.
The bootstrap creates a second opaque `srcdoc` frame, again with only scripts
allowed. Its CSP denies network resources, connections, child frames, forms and
base URLs. The outer CSP admits only `about:` child documents, including after
navigation. Neither frame admits popups or top navigation.

The bootstrap alone also sends an empty Connection-Allowlist and disables DNS
prefetch. Before parsing fence HTML it tests a peer connection with the fixed
documentation address `stun:192.0.2.1:9`, plus fetch and image requests to its
own content-free endpoint. All must fail, and a local ReportingObserver must
receive the browser's `connection-allowlist` / `webrtc` / `enforce` record with
an empty allowlist for this document. A five-second timeout, ordinary network
failure without that record, or any successful probe means the exact fence
stays visible source with the approved explanation. No browser version list.
The report group is local: there is no Reporting-Endpoints network destination.
Peer, observer, pending fetch, image and timer are cleaned up on either outcome.
Before fence code runs, the inner bridge locks RTCPeerConnection,
webkitRTCPeerConnection and RTCDataChannel to non-writable, non-configurable
throwing stubs. A fence gets a plain error in its own document. This also
prevents the observed Chromium renderer termination on a denied inner RTC
attempt; the outer browser enforcement report remains the product's proof.

The page sends the fence text only in a postMessage, with a fresh per-frame
nonce. Every receiver checks the sending window and nonce; opaque children
must also report origin `null`. The bootstrap accepts its one initialization
only from its embedding parent. No HTML enters the application DOM or a URL.
The fence limit is 131072 UTF-8 bytes; a larger fence shows a plain refusal and
retains its source. Height reports are finite and clamped to one screen; the
inner document scrolls. Links relay only bounded absolute HTTP(S) addresses,
and the parent opens a new tab with noopener/noreferrer only while both the
bootstrap's and page's own user activation are active. Activation from a click
elsewhere on the page does not authorize a timer-posted fence link. A message
alone is never permission to open a tab.

Unit checks cover actual render owners, source retention, incomplete/ordinary
message negatives, size refusal, channel routing and response policy. Browser
checks separately establish script execution, opaque-origin restrictions,
network/navigation refusal (including a STUN attempt inside srcdoc), native
link activation and internal scrolling.
DOM assertions alone do not establish those browser boundaries.

Rulings: Warp 13153 (literal cover exception), 13156 (isolated transport),
13185 and 13196 (measured enforcement and visible-source fallback), 13281
(bootstrap activation and literal-cover preservation), and 13309 (RTC stubs
and a separate native raw-RTC probe with its renderer result recorded).
No schema or durable command changes.
