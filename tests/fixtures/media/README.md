# Synthetic media controls

The `one.*` files are the original 1x1 decoder-checked controls. The additional
48x32 images were generated from a mathematical RGB drawing, never personal
photos or screenshots, with Pillow 11.3.0 under Python 3.9:

- `screen.png`: sRGB iCCP, pHYs, ordinary text containing SVG/HTML words, and
  two IDAT chunks split without changing the compressed stream.
- `sixteen.png`: 16-bit grayscale; `palette.png`: indexed color with tRNS.
- `animated.png`: two-frame APNG.
- `progressive.jpg`: progressive JPEG; `multipicture.jpg`: EXIF APP1 plus MPF,
  with a second complete JPEG after the first EOI.
- `extended.webp`: VP8X with ICC/EXIF and lossless image data;
  `animated.webp`: two ANMF frames.

All frames were loaded by Pillow's actual decoders. PNG/JPEG were also decoded
to TIFF with macOS ImageIO through sips. The author's saved fixture-health
receipt and generation script preserve exact origins, tool version, hashes,
dimensions, frame counts and decoder results. No decoder is a runtime or test
suite dependency: the checked-in bytes exercise the bounded Core policy.

Inline means accepted by publication policy, not fully codec-valid. PNG chunks
and CRCs, JPEG headers before the first scan, and WebP container/image headers
are checked; encoded pixels remain opaque. GIF retains signature/trailer checks.
Ready media retain their recorded inline decision when that policy changes.
