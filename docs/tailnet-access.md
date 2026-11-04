# Phone access through Tailscale

Theseus can retain its local URL and also accept one explicitly configured
Tailscale HTTPS origin. It continues listening only on `127.0.0.1`.

Start the same instance with its existing profile and stable port, adding:

```sh
bin/aim-next-server --profile /absolute/tony-profile.json --port 5192 \
  --tailnet-origin https://commons-macbook-pro-1.saga-castor.ts.net:5192
```

Then add only the new forwarding port:

```sh
tailscale serve --bg --https=5192 http://127.0.0.1:5192
tailscale serve status --json
```

The retained first-use phone link is
<https://commons-macbook-pro-1.saga-castor.ts.net:5192/?topic=first-use-topic>.
The phone must be connected to the tailnet. Existing AIM remains on its current
HTTPS port443 route. Save and compare Serve configuration before and after;
never reset the shared configuration. Funnel is not part of this setup.

This is a single-actor prototype: anyone permitted to reach this endpoint by
the tailnet policy can load its session and act as the profile's actor, Tony.
The hostname allowlist is not an identity check. Tailscale access policy is the
network boundary, as for the existing AIM endpoint. No remote user header is
trusted to select an actor or origin.

The optional origin must be canonical lowercase HTTPS with a `.ts.net` DNS
name and an optional nondefault port. Credentials, paths, queries, fragments,
wildcards and ambiguous forms refuse startup. Without it, only the loopback
Host is accepted. Each API Origin must match its own configured Host, and the
existing bearer session remains required; cross-origin access is not enabled.

Restart only the owned server gracefully, retaining its profile, database,
authority and loopback port. Leave the effects runner running. A server restart
creates a new session, so reload the Mac page once. Its local journal remains
on the same origin. The phone's HTTPS origin has a separate browser-local
journal; only server-saved drafts carry over between devices/origins. Do not
clear or migrate the Mac's unsent local writing.

Verify TLS, identical public assets, matching instance/actor bootstrap and a
scoped read through HTTPS. Never print the embedded session token or make a
live test send. A successful Mac-side HTTPS check does not prove phone
rendering or its current Tailscale connection.

To remove this forwarding endpoint only:

```sh
tailscale serve --https=5192 off
```

The local server can then be restarted without `--tailnet-origin`. This does
not remove the instance or change existing AIM/other Serve routes.
