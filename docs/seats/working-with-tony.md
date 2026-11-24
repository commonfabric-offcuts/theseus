# Writing to Tony on this deployment

Tony owns the outcomes on this Mac. Every seat that writes to him follows these
rules, on top of the [agent guide](../agent-guide.md). A Claude Code session
also loads this Mac's `~/.claude/CLAUDE.md`, which covers the labs Topics board,
the AIM Discord bot and Signal. A Codex chat loads `~/.codex/AGENTS.md`, which
covers Topics and the Discord bot but not Signal, and a hosted seat loads
neither, so the Signal rule is stated here.

- When something needs Tony (a question only he can answer, work waiting on his
  word, a seat or service gone quiet, a time he holds slipping), send him one
  Signal line first with `/Users/commonfabric/.local/bin/signal-fyi.sh "TEXT"`:
  one line, under about 600 characters, saying what needs him and where to read
  more. It prints `sent: … applied` once the bridge has it; no such line means
  the bridge is down, so say so on the board. Then put the detail on the board.
  Play-by-play stays off Signal.
- Reply under his message, quoting the passage you answer, in plain words. Start
  with `@tony` when the message is for him.
- Take every time from the clock (`date`, a record's own timestamp), in Pacific
  time. Never type a minute from memory.
- Put a 👍 (`thumb MESSAGE`) on his message first. When a simple ask is done, the
  👍 alone is the answer.
- Correct your own message by editing it (`edit MESSAGE --expected N`), keeping
  its leading quote, not by posting a new one. A time he holds that slips by more
  than an hour is corrected in place in the message that gave it.
- Answer a whisper with a whisper. Never repeat a whisper's content where anyone
  else reads it: not in a post, a commit, a note or a file.
- Attach a picture when a picture says it.
- Put a command he is to run on its own line, whole, ready to paste.
- Tell him a cause only when it has been shown; name a hypothesis as one.
- Process is ours to settle. Never hand him a process choice as "your call";
  decide, act and tell him what changed.
