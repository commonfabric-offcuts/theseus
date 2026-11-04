from __future__ import annotations

"""Malformed inputs carry correct intent digests; real decoders checked positives."""

import io
from pathlib import Path
import struct
import unittest
import zlib

from test_media import MediaCase


PNG = b"\x89PNG\r\n\x1a\n"


def png_chunk(kind, payload):
    encoded = kind + payload
    return struct.pack(">I", len(payload)) + encoded + struct.pack(">I", zlib.crc32(encoded) & 0xffffffff)


def webp_chunk(kind, payload):
    return kind + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) % 2 else b"")


def riff_webp(chunks):
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


class ImageStructureCase(MediaCase):
    def fixture(self, suffix):
        return (Path(__file__).parent / "fixtures" / "media" / ("one." + suffix)).read_bytes()

    def refuse_bytes(self, data, content_type):
        media_id = "malformed-%s" % self.serial
        envelope = self.begin(media_id, data, content_type=content_type)
        root = Path(str(self.path) + '.media')
        before = set(root.iterdir()) if root.exists() else set()
        # begin declares the real size/hash of these exact malformed bytes:
        # refusal therefore measures image policy, not a redundant digest gate.
        receipt = self.publish(envelope, io.BytesIO(data))
        self.rejected(receipt, "MEDIA_INVALID")
        self.assertFalse(receipt["recorded"])
        self.assertEqual(self.status(media_id)["state"], "pending")
        self.assertEqual(set(root.iterdir()), before)

    def test_valid_supported_image_controls_remain_exact_inline_resources(self):
        for suffix, content_type in (("png", "image/png"), ("jpg", "image/jpeg"),
                                     ("gif", "image/gif"), ("webp", "image/webp")):
            with self.subTest(content_type=content_type):
                data = self.fixture(suffix)
                media_id = "valid-" + suffix
                envelope = self.begin(media_id, data, content_type=content_type)
                receipt = self.publish(envelope, io.BytesIO(data))
                self.assertTrue(self.committed(receipt)["inline"])
                with self.open({"media_id": media_id}) as resource:
                    self.assertTrue(resource.descriptor["inline"])
                    self.assertEqual(resource.descriptor["content_type"], content_type)
                    self.assertEqual(resource.read(65536), data)

    def test_valid_format_variants_keep_metadata_animation_and_encoded_details(self):
        for name in ('screen.png', 'sixteen.png', 'palette.png', 'animated.png',
                     'progressive.jpg', 'multipicture.jpg', 'extended.webp', 'animated.webp'):
            with self.subTest(name=name):
                data = (Path(__file__).parent / 'fixtures' / 'media' / name).read_bytes()
                content_type = 'image/' + ('jpeg' if name.endswith('.jpg') else name.rsplit('.', 1)[1])
                media_id = 'variant-' + name.replace('.', '-')
                envelope = self.begin(media_id, data, content_type=content_type)
                self.assertTrue(self.committed(self.publish(envelope, io.BytesIO(data)))['inline'])
                with self.open({'media_id': media_id}) as resource:
                    self.assertEqual(self.read_all(resource), data)
                    self.assertEqual(resource.descriptor['content_type'], content_type)
                    self.assertTrue(resource.descriptor['inline'])

    def test_png_signature_and_terminal_wrapper_cannot_hide_raw_svg_or_html(self):
        for raw in (b'<svg xmlns="http://www.w3.org/2000/svg" onload="fixture()"/>',
                    b"<html><script>fixture()</script></html>"):
            with self.subTest(raw=raw):
                malformed = PNG + struct.pack(">I", 13) + b"IHDR" + raw + png_chunk(b"IEND", b"")
                self.refuse_bytes(malformed, "image/png")

    def test_png_crc_and_chunk_bounds_are_checked_independently_of_intent_digest(self):
        valid = self.fixture("png")
        marker = valid.index(b"IDAT")
        length = struct.unpack(">I", valid[marker - 4:marker])[0]
        self.assertGreater(length, 0)
        crc = marker + 4 + length
        wrong_crc = valid[:crc] + bytes([valid[crc] ^ 1]) + valid[crc + 1:]
        bad_length = valid[:marker - 4] + struct.pack(">I", len(valid) + 1) + valid[marker:]
        for malformed in (wrong_crc, bad_length):
            with self.subTest(malformed=malformed):
                self.refuse_bytes(malformed, "image/png")

    def test_png_requires_image_data_and_a_real_terminal_zero_length_iend(self):
        valid = self.fixture("png")
        ihdr = png_chunk(b"IHDR", valid[16:29])
        cases = (
            PNG + ihdr + png_chunk(b"IEND", b""),
            valid[:-12] + png_chunk(b"tEXt", b"not an IEND"),
            valid + png_chunk(b"tEXt", b"after IEND"),
            valid[:-12] + png_chunk(b"IEND", b"x"),
        )
        for malformed in cases:
            with self.subTest(malformed=malformed):
                self.refuse_bytes(malformed, "image/png")

    def test_png_header_fields_and_unique_first_header_are_checked(self):
        valid = self.fixture('png')
        original = valid[16:29]
        headers = [bytes(4) + original[4:], original[:8] + b'\x07' + original[9:],
                   original[:9] + b'\x05' + original[10:], original[:10] + b'\x01' + original[11:],
                   original[:11] + b'\x01' + original[12:], original[:12] + b'\x02']
        cases = [PNG + png_chunk(b'IHDR', header) + valid[33:] for header in headers]
        cases += [PNG + png_chunk(b'tEXt', b'Before header') + valid[8:],
                  valid[:33] + png_chunk(b'IHDR', original) + valid[33:]]
        for index, malformed in enumerate(cases):
            with self.subTest(index=index):
                self.refuse_bytes(malformed, 'image/png')

    def test_jpeg_requires_real_bounded_frame_and_scan_headers(self):
        cases = (
            b"\xff\xd8\xff\xd9",
            b"\xff\xd8\xff\xe0\x00\x02\xff\xd9",
            b"\xff\xd8\xff\xe0\xff\xffshort segment\xff\xd9",
        )
        for malformed in cases:
            with self.subTest(malformed=malformed):
                self.refuse_bytes(malformed, "image/jpeg")

    def test_jpeg_frame_scan_component_tables_and_encoded_bytes_are_required(self):
        def segment(marker, payload):
            return b'\xff' + bytes([marker]) + struct.pack('>H', len(payload) + 2) + payload
        frame_payload = b'\x08\x00\x01\x00\x01\x01\x01\x11\x00'
        frame = segment(0xc0, frame_payload)
        scan = segment(0xda, b'\x01\x01\x00\x00\x3f\x00')
        cases = (scan + b'x', frame + scan,
                 frame + segment(0xda, b'\x02\x01\x00\x00\x3f\x00') + b'x',
                 segment(0xc0, frame_payload[:-1]) + scan + b'x',
                 segment(0xc0, frame_payload[:1] + b'\x00\x00' + frame_payload[3:]) + scan + b'x')
        for index, middle in enumerate(cases):
            with self.subTest(index=index):
                self.refuse_bytes(b'\xff\xd8' + middle + b'\xff\xd9', 'image/jpeg')

    def test_webp_riff_length_is_exact_even_when_inner_image_is_valid(self):
        valid = self.fixture("webp")
        wrong_size = valid[:4] + struct.pack("<I", len(valid) - 8 + 2) + valid[8:]
        self.refuse_bytes(wrong_size, "image/webp")

    def test_webp_chunk_bounds_and_real_image_header_reject_riff_noise(self):
        valid = self.fixture("webp")
        bad_chunk = valid[:16] + struct.pack("<I", len(valid) + 1) + valid[20:]
        cases = (bad_chunk, riff_webp([webp_chunk(b"VP8 ", b"x" * 64)]),
                 riff_webp([webp_chunk(b"VP8L", b"x" * 64)]))
        for malformed in cases:
            with self.subTest(malformed=malformed):
                self.refuse_bytes(malformed, "image/webp")

    def test_webp_extended_frame_requires_bounded_image_payload(self):
        extended = webp_chunk(b'VP8X', b'\x02' + bytes(9))
        for frame in (b'short', bytes(16), bytes(16) + webp_chunk(b'VP8L', b'noise'),
                      bytes(16) + b'VP8L' + struct.pack('<I', 100) + b'\x2f'):
            with self.subTest(frame=frame):
                self.refuse_bytes(riff_webp([extended, webp_chunk(b'ANMF', frame)]), 'image/webp')


# Fixture helpers only; do not multiply the inherited media suite in this draft.
for _name in list(MediaCase.__dict__):
    if _name.startswith("test_") and _name not in ImageStructureCase.__dict__:
        setattr(ImageStructureCase, _name, None)
del MediaCase

if __name__ == "__main__":
    unittest.main()
