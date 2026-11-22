import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import wave

SCRIPT = Path(__file__).resolve().parents[1] / "skills/precise-audio-clips/scripts/audio_clip.py"
spec = importlib.util.spec_from_file_location("audio_clip", SCRIPT)
clip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clip)


class AudioClipTest(unittest.TestCase):
    def test_clock_timestamps(self):
        self.assertEqual(clip.seconds("1:39") - clip.seconds("0:26"), 73)
        self.assertEqual(clip.seconds("1:02:03.25"), clip.seconds("3723.25"))

    def test_invalid_timestamps(self):
        for value in ("NaN", "Infinity", "-1", "1:60", "1.5:20", "a", "1:2:3:4"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                clip.seconds(value)

    def test_end_exclusive_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "source.wav", Path(temp) / "out.wav"
            samples = struct.pack("<10h", *range(10))
            with wave.open(str(source), "wb") as wav:
                wav.setparams((1, 2, 10, 0, "NONE", "not compressed"))
                wav.writeframes(samples)
            result = clip.trim_wav(source, output, clip.seconds("0.2"), clip.seconds("0.7"))
            self.assertEqual(result["frames"], 5)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual(wav.readframes(10), samples[4:14])
            with self.assertRaises(FileExistsError):
                clip.trim_wav(source, output, clip.seconds("0.2"), clip.seconds("0.7"))
            for start, end in (("0", "1.1"), (".4", ".4"), (".1", ".11")):
                with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                    clip.trim_wav(source, Path(temp) / "invalid.wav", clip.seconds(start), clip.seconds(end))


if __name__ == "__main__":
    unittest.main()
