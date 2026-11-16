# Outfit typeface

Outfit is the ASTAROT brand typeface. It is licensed under the SIL Open Font
License, Version 1.1, Copyright 2021 The Outfit Project Authors
(https://github.com/Outfitio/Outfit-Fonts). `OFL.txt` is the license text from
that repository at commit 902773808eb372f70fb34e8946dd1ffe604efc79, unmodified.
Outfit has no Reserved Font Name.

## Where it is used

- The ASTAROT wordmark in `docs/brand/astarot/` is the outline of the Outfit
  Bold (700) glyphs. `tools/astarot_brand_from_reference.py` builds it from the
  static Outfit Bold that Google Fonts serves (Version 1.100, SHA-256
  `cc3235ab6d698be85a2735d1fd59ba8f73b144cb763c00aaf173b68f0471a9c7`).
- The logos and the brand board set the subtitle in Outfit as SVG text.

## Bundling

VRCT-VOX will bundle Outfit font files with the app so that the subtitle and
other brand text display in Outfit without a remote font. The bundling is part
of the P1 UI work (ADR-011). No Outfit font file is in the repository or in a
build yet. When one is added, it ships with this `OFL.txt`, and this file lists
its name, version, size and SHA-256.
