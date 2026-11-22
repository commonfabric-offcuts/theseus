---
name: precise-audio-clips
description: Retrieve audio from a user-selected public video or local recording, cut an exact timestamp interval, verify the samples and MP3 duration, and deliver discoverable MP3 and WAV files. Use for rehearsal tracks, backing tracks, excerpts, and removing music after a specified endpoint.
---

# Precise audio clips

Turn the user's chosen recording into a usable file. Preserve the source, honor exact timestamps, verify the cut, and put the result somewhere the user can find it.

## Establish the requested cut

Identify the exact source and start/end timestamps. Ask for missing endpoints in the existing request stack while preparing the source. Interpret `0:26 through 1:39` as the interval [26.000, 99.000): 73 seconds, excluding the sample at the end. Do not remove leading silence before interpreting timestamps. Do not substitute another performance, add fades, normalize, or trim silence unless requested.

## Obtain editable audio

For a local file, use that file. For a public video, try a normal public download before concluding that a Premium offline download is unusable. Premium offline storage is not an ordinary audio file; it is not necessary for a public download.

Find a supported Python, FFmpeg, and, when needed, a JavaScript runtime. If tools are missing, create a task-local virtual environment (a current Python may be required) and install `yt-dlp[default]` and `imageio-ffmpeg` there. Avoid changing global packages. The bundled FFmpeg path is available with:

```sh
.audio-tools/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
```

Download the exact public video with `yt-dlp --ignore-config --no-playlist -f bestaudio --no-progress -o 'SOURCE.%(ext)s' URL`, using an absolute output path in the task directory. Supply `--js-runtimes deno:/absolute/path/to/deno` when available/required. Run commands with argument arrays when composing them in code. Do not access credentials, browser cookies, protected caches, or decrypt offline media. Preserve the downloaded source and record its URL/title. If normal retrieval fails, inspect the actual error and consult current official tool documentation. Authorized system-audio recording is a possible fallback, but introduces alignment and completeness checks; do not claim it was performed unless it was. Ask for a local source only when the available authorized paths are exhausted.

## Cut and verify

Run the bundled helper with a local source and an available FFmpeg executable:

```sh
python scripts/audio_clip.py --input SOURCE --start 0:26 --end 1:39 --output-base /absolute/task/path/rehearsal-clip --ffmpeg /absolute/path/to/ffmpeg
```

Resolve `scripts/audio_clip.py` relative to this SKILL.md. The helper decodes to 24-bit PCM WAV, retains the decoded full recording, cuts on the nearest sample boundary using decimal timestamps, exports WAV and MP3, compares the WAV samples against the source interval, checks decoded MP3 length, and saves a verification JSON. It refuses overwrites and invalid/out-of-range intervals. Run in a new output directory/base for each attempt; a failed run may leave files to inspect.

Inspect the verification result and check that the content is not silent. If an unwanted musical entry is close to the endpoint, inspect/listen around that boundary. Waveform transients can support timing choices but do not prove perceptual quality. Do not call numerical checks a listening check. Keep the requested endpoint unless the user authorizes a change; explain any sample rounding.

## Deliver in the request's stack

Attach the MP3 (easy playback) and WAV (editing quality) to the Theseus reply. Also place verified identical copies in a user-visible destination such as Downloads when access is authorized. Refuse to overwrite a different existing file; choose a fresh filename. Give the destination and exact filename in the reply, together with source interval and output duration. A hidden worker path alone is insufficient. Read the posted reply back, confirm attachment references, then acknowledge the original delivery separately. Use the current CLI's quote/revision flags and preserve the original request stack.

Keep personal sources and filenames in their personal outcome. Reuse this general procedure without copying personal details into public outcome documentation.

## Maintain the skill

Run `python -m unittest discover -s tests -p 'test_precise_audio_clips.py'` from the package root for timestamp/boundary checks. Run a real FFmpeg integration check when changing encoding or sample handling. This package includes a native Theseus catalog record homed in `oldwell-personal`; catalog publication requires the application release owner. Do not modify live services to install it.
