# Server-only share-card fonts

- `IBMPlexSansKR-Bold.ttf`: unchanged copy of this repository's
  `android/wear/src/main/res/font/ibm_plex_sans_kr_bold.ttf` (IBM Plex Sans KR).
  Font copyright: 2018 IBM Corp. License: SIL OFL 1.1, `IBMPlexSansKR-LICENSE.txt`.
- `ArchivoBlack-Regular.ttf`: Google Fonts `ofl/archivoblack/ArchivoBlack-Regular.ttf`,
  downloaded 2026-09-20. License: SIL OFL 1.1, `ArchivoBlack-LICENSE.txt`.

Upstream sources:
- https://github.com/google/fonts/tree/main/ofl/archivoblack
- https://github.com/google/fonts/tree/main/ofl/ibmplexsanskr

These are static TTF fonts supported by Satori. They are read from disk once per
server instance by `lib/og/card.tsx`, with Next.js file tracing including them in
deployment output. They are not imported into the browser UI or fetched from a
font CDN on each render. The Korean font deliberately retains all 12,183 mapped
characters so arbitrary Korean crew/event names are not limited to a sample title.

The brand mark is read from `public/roxlogy-mark.svg` unchanged. See
`../../../../brand/roxlogy-brand-guide.html` and `../../../../docs/DESIGN_GAPS_IMPLEMENTATION.md`.
