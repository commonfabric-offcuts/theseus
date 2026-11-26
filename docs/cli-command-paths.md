# Hosted CLI command paths (1320)

`hosted_notice.cli_command(cli, profile_path, broker=None)` renders the trusted
hosted thread's CLI invocation as a POSIX shell command. The selected executable
is `/usr/bin/python3 -I`, followed by the supplied CLI path and exactly one of
`--profile PROFILE` or `--broker BROKER`. A supplied broker keeps the existing
broker selection; the private profile path does not appear in that command.

Each supplied path is one shell argument, including spaces, Unicode,
apostrophes, dollar signs, command substitution syntax and glob characters.
Rendering does not resolve paths, search the account's home, select another
instance, change a binding or rewrite a saved operation. Paths whose spelling
already needs no shell quoting retain their existing command text.

`tests/test_hosted_notice.py` executes the displayed command through `/bin/sh`
against an isolated fixture CLI under two unrelated temporary roots. It
observes exact argv, isolated Python and absence of shell expansion for both
profile and broker forms. This proves the rendered shell invocation, without
claiming an account move, a live hosted turn or native browser behavior.
The fake Codex app-server fixture's plain `split()` parser does not model
quoted commands; existing ordinary-path fixture turns retain that limitation.
