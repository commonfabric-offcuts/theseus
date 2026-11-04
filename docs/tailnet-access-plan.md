# Theseus tailnet access

Tony requests the same phone access as AIM. This is a narrow HTTP deployment
change over released `4e15770`; inline New message remains a separate slice.

Today `aim_next/server.py:300–315` requires exactly the loopback Host and Origin;
`create_server:615–639` binds 127.0.0.1 and derives that pair. `serve.py:13–36`
exposes no external origin option. AIM already uses Tailscale Serve HTTPS on
`commons-macbook-pro-1.saga-castor.ts.net:443` to loopback5190. Serve preserves
the incoming Host. Theseus currently listens on loopback5192. Existing Serve
routes must remain unchanged.

## Trigger and result

An optional `--tailnet-origin https://NAME.ts.net:PORT` registers one exact
external HTTPS authority/origin pair alongside the existing loopback pair.
Only canonical lowercase ASCII DNS names ending in `.ts.net`, with optional
nondefault valid port, are accepted. No credentials, path, query, fragment,
wildcard, whitespace or trailing dot. Invalid configuration refuses before
binding. The default remains loopback-only. No bind widening or forwarded-header
trust is introduced.

Each request must contain one allowed Host. Authenticated API requests retain
the bearer session requirement. Every POST and any request supplying Origin must
contain exactly the origin paired with its Host. Cross-pair, missing POST
Origin, duplicates and other origins refuse before Store dispatch. Forwarded
headers cannot select an origin or actor. Existing profile/authority, admission,
media and operation semantics remain unchanged.

The ready line names both configured addresses without a session token. Serve
is configured with `--bg --https=5192 http://127.0.0.1:5192`, retaining every
existing route and no Funnel entry. Tailnet access policy is the access boundary;
this remains Tony's single-actor instance, just as the local endpoint is.

## Bounded proof and delivery

Write meaningful HTTP reds for explicit external shell/bootstrap/view/command
acceptance alongside local access; default external rejection; exact Host/Origin
pair refusals (including duplicates and forwarded spoofing); malformed startup
configuration. Use an isolated fixture/FakeStore, no live writes. Run the touched
HTTP/launcher checks. Apply and restore one Host-allowlist and one Origin-pair
mutant, require actual changed bytes and intended assertion failure, use fresh
Python caches. No browser or broad suite is needed for unchanged UI behavior.

Independent Fable critique precedes implementation and final review precedes
shipping. Core has returned its test lane; lead holds it for these bounded
checks while UX prepares inline tests without running them.

Publish only the reviewed tailnet commit to the existing Theseus branch, then
gracefully restart only the owned server on the same loopback port/profile with
the additional origin. Preserve runner, database, authority, profiles and local
browser journal. Save process identities and Serve configuration before/after.
Verify TLS/static assets, shell/session/bootstrap and one scoped read through
the tailnet URL without printing tokens or producing commands. Confirm the old
local URL and AIM route still work. Actual phone rendering remains Tony's check.

The HTTPS origin has its own browser-local journal; server-saved writing remains
the same instance. Do not migrate or clear the Mac origin's local writing.
Document the exact phone link, restart command and rollback of only port5192.
