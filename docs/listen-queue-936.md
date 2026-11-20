# A cold load's connection burst

The HTTP listener asks the operating system for a backlog of 128 connections.
A cold page load can open more than five connections before the server's accept
loop next runs; those connections must wait in the listener rather than time out.

This is the pending TCP queue, not an increase to active request workers, read
lanes, deadlines or authority. The existing 16-connection admission bound and
retryable SERVER_BUSY response remain.

`tests/test_listen_queue_936.py` opens twelve connections concurrently while the
actual server listener is waiting to accept, then starts its normal accept loop
and checks that every connection receives the requested static document. It
uses an ephemeral loopback listener and no database. This is a listener check,
not a measurement of production Tailscale latency.
