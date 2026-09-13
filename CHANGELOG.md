# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses date-based [0.0.x] pre-release versioning until a
first stable 1.0.0.

## [0.0.2] - 2026-09-13

### Added

- Settings panel (gear icon in the now-playing bar, or press `,`) with
  Appearance, Equalizer, Playback, and About tabs.
- Visualizer styles: Bars, Wave, Radial, and Ambient, switchable live,
  plus an adjustable background-intensity slider.
- Accent color mode: sample from the current track's artwork (default)
  or a fixed hue you choose.
- Motion preference override (System / Reduced / Full motion) in
  addition to honoring `prefers-reduced-motion` automatically.
- Compact density layout toggle.
- 10-band graphic equalizer (31 Hz–16 kHz) with a preamp and presets
  (Flat, Bass Boost, Treble Boost, Vocal, Acoustic, Electronic,
  Loudness, Custom), built on a new `player/audiograph.ts` Web Audio
  chain. Inert (by design, and stated in the UI) for tracks played
  through the YouTube iframe backend, same cross-origin boundary the
  visualizer's real-FFT mode already respected.
- "Remember playback speed" setting, restored on new tracks and after a
  reload.
- Mobile layout: bottom navigation bar, and a tap-to-expand gesture on
  the now-playing bar for a full-screen player view (≤880px).
- Branded startup splash screen (logo + name + progress bar) shown from
  first paint until the shell is interactive, with a minimum display
  time so it never just flashes, and a fallback that always hides it
  even if startup fails.
- Full app icon set generated from the new logo: favicon (multi-res
  `.ico`), Apple touch icon, standard and maskable PWA icons.
- ESLint (flat config, `typescript-eslint`) via `npm run lint` /
  `npm run lint:fix`.
- Lighthouse CI config (`lighthouserc.json`) and `npm run lighthouse`.
- GitHub Actions workflows: `ci.yml` (lint, typecheck, build) and
  `lighthouse.yml`, both running on push and pull request.
- README: browser/device support section, getting-started scripts,
  updated structure and architecture notes.
- This changelog.

### Changed

- Rebranded from "Session Clock · Music" to **Monomist** — page title,
  manifest, sidebar header, and README.
- `player/analyser.ts` replaced by `player/audiograph.ts`: same
  visualizer `read()` API, now with the EQ chain built in.
- `visual/canvas.ts` switched from a `window` resize listener to
  `ResizeObserver`, and now reads visualizer style/intensity/accent/
  motion from the new settings store instead of being hardcoded.
- `index.html`: added favicon/manifest/apple-touch-icon links, a
  `viewport-fit=cover` viewport meta for safe-area insets, and the
  inline splash screen markup.
- `package.json`: renamed to `monomist`; `typescript` pinned to `^6.0.3`
  (down from `^7.0.2`) because `typescript-eslint` doesn't yet support
  TypeScript 7.0 — a pure tooling-compatibility pin, nothing in the
  codebase needs TS7-only features.
- `package.json`'s `license` field corrected from `ISC` to
  `AGPL-3.0-or-later` to match the actual `LICENSE` file.

### Fixed

- License field/file mismatch in `package.json` (see above).

## [0.0.1] - Initial scaffold

### Added

- Core playback engine: play/pause, prev/next, seek, ±10s skip, mute,
  playback speed, volume, shuffle, repeat, persistent queue.
- YouTube Data API v3 search with debouncing and in-flight request
  cancellation; playback via YouTube's official IFrame Player.
- Library: liked songs, playlists, listening history, "continue
  listening".
- Lyrics: user-supplied LRC text, synced playback via Liricle.
- Ambient cinematic canvas background with a real Web Audio
  `AnalyserNode` visualizer for direct-audio playback, and a
  clearly-labeled ambient fallback for the YouTube iframe path.
- Artwork-sampled accent color, animated via registered CSS
  `@property` custom properties (no per-frame JS).
- Mini-player mode, queue/lyrics side drawer, keyboard shortcuts, Media
  Session (lock-screen/OS media controls) integration.
- PWA shell: manifest and service worker (app-shell caching only,
  never intercepting cross-origin requests).
- Off-main-thread artwork color extraction and history dedup workers.
