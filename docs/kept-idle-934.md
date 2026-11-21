# Kept static connections (934)

A static HTTP/1.1 response may keep an unambiguously empty request open.
Every Content-Length, Transfer-Encoding and Connection field participates in
that decision: absent length or exactly one `0`, no transfer encoding, and
no `close` token. Duplicate lengths close even when they agree. APIs, media,
errors and Live keep their existing response and admission rules.

The server keeps at most sixteen active connection/request permits and a
separate pool of sixteen idle kept connections. After a static answer it
enters the idle pool and returns its active permit. It waits at most two
seconds, advertised as `Keep-Alive: timeout=2`, or the remainder of the
original absolute input deadline, whichever is shorter. Pool overflow closes
the connection. A next byte, including already buffered pipelining, leaves
the idle pool and must reacquire an active permit before parsing a request.
Full active admission returns the existing unconfirmed SERVER_BUSY refusal.
Idle activity cannot bypass or renew the absolute request deadline. Thread
exit, EOF, timeout and refusal release exactly the permits they still own.
The existing request timeout stays ten seconds; upload extensions remain
owned by the body reader. At most 32 connection threads are retained.

Checks use real loopback sockets with a temporary web build, no live store.
They cover sixteen idle connections plus another successful request, actual
two-second idle expiry/hint, duplicate framing/close fields, pipelining,
active admission on reuse, recovery after refusal/EOF and unchanged absolute
deadlines. Shorter test settings exercise boundary paths; the default idle
expiry is also measured directly. No browser or production latency claim.
