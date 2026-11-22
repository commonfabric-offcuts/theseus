#!/usr/bin/env python3
"""Exact PCM interval extraction with verified MP3 export. Python 3.12+."""
import argparse
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import subprocess
import wave


def seconds(value):
    try:
        parts = [Decimal(p) for p in value.split(":")]
        if not 1 <= len(parts) <= 3 or any(not p.is_finite() or p < 0 for p in parts):
            raise ValueError("Use nonnegative seconds, mm:ss, or hh:mm:ss")
        if len(parts) > 1 and (any(p >= 60 for p in parts[1:]) or any(p != int(p) for p in parts[:-1])):
            raise ValueError("Invalid clock timestamp")
        result = Decimal(0)
        for part in parts:
            result = result * 60 + part
        return result
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("Invalid timestamp") from exc


def trim_wav(source, output, start, end):
    with wave.open(str(source), "rb") as src:
        rate = src.getframerate()
        first, last = [int((t * rate).to_integral_value(rounding=ROUND_HALF_UP)) for t in (start, end)]
        if start < 0 or end <= start or first >= last or last > src.getnframes():
            raise ValueError("Interval must contain samples and fit within the recording")
        params = src.getparams()
        src.setpos(first)
        expected = src.readframes(last - first)
    with open(output, "xb") as handle:
        with wave.open(handle, "wb") as dst:
            dst.setparams(params)
            dst.writeframes(expected)
    with wave.open(str(output), "rb") as check:
        if check.getnframes() != last - first or check.readframes(last - first) != expected:
            raise RuntimeError("WAV source-sample comparison failed")
    return {"sample_rate": rate, "channels": params.nchannels,
            "first_frame": first, "end_frame_exclusive": last,
            "frames": last - first, "duration_seconds": str(Decimal(last - first) / rate),
            "pcm_sha256": hashlib.sha256(expected).hexdigest(),
            "contains_nonzero_samples": any(expected)}


def run(args):
    subprocess.run(args, check=True, stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--output-base", type=Path, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    start, end = seconds(args.start), seconds(args.end)
    if end <= start:
        parser.error("end must follow start")
    base = args.output_base
    full, wav, mp3, report = [Path(str(base) + suffix) for suffix in ("-full.wav", ".wav", ".mp3", "-verification.json")]
    for path in (full, wav, mp3, report):
        if path.exists():
            raise FileExistsError(path)
    base.parent.mkdir(parents=True, exist_ok=True)
    ff = [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n"]
    run(ff + ["-i", str(args.input), "-vn", "-c:a", "pcm_s24le", str(full)])
    result = trim_wav(full, wav, start, end)
    if not result["contains_nonzero_samples"]:
        raise ValueError("Selected interval is digitally silent; inspect the source")
    run(ff + ["-i", str(wav), "-c:a", "libmp3lame", "-q:a", "2", str(mp3)])
    # Count streaming PCM bytes so lengthy clips do not require a second in-memory copy.
    with subprocess.Popen(ff + ["-i", str(mp3), "-f", "s16le", "-c:a", "pcm_s16le", "-"], stdout=subprocess.PIPE, stdin=subprocess.DEVNULL) as proc:
        size = 0
        while chunk := proc.stdout.read(1024 * 1024):
            size += len(chunk)
        if proc.wait() != 0:
            raise RuntimeError("MP3 decode failed")
    if size != result["frames"] * result["channels"] * 2:
        raise RuntimeError("Decoded MP3 sample count differs from WAV")
    result.update(source=str(args.input.resolve()), requested_start=str(start), requested_end=str(end),
                  mp3_decoded_frames=result["frames"], wav=str(wav.resolve()), mp3=str(mp3.resolve()),
                  listened=False)
    with report.open("x") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
