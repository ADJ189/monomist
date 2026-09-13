<p align="center">
  <img src="public/icon/logo-master.png" alt="Monomist logo" width="120" height="120" />
</p>

<h1 align="center">Monomist</h1>

<p align="center">
  A local-first, cinematic music player: real playback, a live artwork-driven
  visualizer, an ambient animated background, and a 10-band equalizer — not
  just a UI shell.
</p>

---

Typechecked (`npm run typecheck`), linted (`npm run lint`), and buildable
(`npm run build`) end to end. See [What's stubbed](#whats-stubbed--next-steps)
for the one piece it isn't wired to yet: a live YouTube OAuth token source.

## Feature coverage

- **Playback**: play/pause, prev/next, seek (click-to-seek progress bar),
  ±10s skip, mute, playback speed (0.75×–2×, optionally remembered across
  tracks/reloads), volume, shuffle (Fisher–Yates, anchors the
  currently-playing track), repeat (off/all/one), persistent queue
  (debounced writes to IndexedDB).
- **Discovery**: debounced, `AbortController`-cancelled search against the
  official YouTube Data API v3, with a follow-up batched `videos.list`
  call to fill in real durations. Recent searches are stored and shown as
  chips.
- **Library**: liked songs, playlists (create/rename/delete, add/remove
  track, via a lightweight prompt-based picker), listening history,
  "continue listening" (deduped, most-recent-first).
- **Lyrics**: paste-your-own LRC text, synced via Liricle, active-line
  highlighting, auto-scroll, click-to-seek. No third-party lyrics API is
  wired in — see `lyrics/provider.ts` for why.
- **Visualizer & background**: a live Web Audio `AnalyserNode`-driven
  canvas with four styles (Bars / Wave / Radial / Ambient), an animated
  gradient wash sampled from the current track's artwork (or a fixed
  accent color, your choice), adjustable intensity, and full
  `prefers-reduced-motion` support (with a manual override in Settings).
- **10-band graphic equalizer**: ±12 dB per band (31 Hz–16 kHz), a preamp,
  and presets (Flat / Bass Boost / Treble Boost / Vocal / Acoustic /
  Electronic / Loudness / Custom). Applies to direct-audio playback only —
  see [Web Audio's cross-origin limit](#whats-intentionally-not-here)
  below for why it can't reach the YouTube iframe path, and the Settings
  panel says so in plain language rather than silently no-oping.
- **Settings panel** (gear icon, or press `,`): Appearance (visualizer
  style, background intensity, accent color, motion, compact density),
  Equalizer, Playback (remember speed), About.
- **Player experience**: mini-player mode, a mobile "expand to full
  player" gesture, a queue/lyrics side drawer, keyboard shortcuts (space,
  ←/→ seek, N/P, M mute, S shuffle, R repeat, L like, Q queue, / search,
  `,` settings), Media Session integration (lock-screen/OS media
  controls, progressive enhancement — no-ops where unsupported).
- **PWA**: manifest + icon set (including a maskable Android icon) +
  service worker caching the app shell (HTML/CSS/JS) cache-first;
  explicitly never intercepts cross-origin requests (YouTube API,
  thumbnails, the IFrame player), so nothing about the music source
  itself is cached. A branded startup splash covers first paint until the
  shell is interactive.

## Getting started

```bash
npm install
npm run dev          # local dev server
npm run build         # production build -> dist/
npm run preview       # serve the production build locally
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run lint:fix      # eslint . --fix
npm run lighthouse    # build, then run Lighthouse CI against dist/
```

Requires Node ≥20 (see `.nvmrc`). `npm run lighthouse` needs a local Chrome
install (Lighthouse CI drives headless Chrome); CI runs it in
`.github/workflows/lighthouse.yml` on every push/PR, alongside
`.github/workflows/ci.yml` for lint + typecheck + build.

> **Note on the `typescript` version:** pinned to `^6.0.3` rather than the
> newer 7.x line — `typescript-eslint` doesn't support TypeScript 7.0 yet
> (throws on import). Nothing in this codebase needs TS7-only features, so
> this is a pure tooling-compatibility pin; revisit once
> `typescript-eslint` catches up.

## Where the animation and workers actually earn their place

- `visual/colorbridge.ts` + `workers/artwork.worker.ts`: artwork decode
  and pixel sampling run entirely off the main thread. The registered
  custom properties (`--accent-h/-s/-l`, typed CSS `@property`) mean the
  resulting color crossfade costs nothing on the main thread. Stale
  worker responses (from a track you've since skipped past) are
  discarded.
- `library/history.ts` + `workers/data.worker.ts`: the "continue
  listening" dedup only goes to a worker once history has enough rows
  (300+) that the postMessage round-trip is actually cheaper than a
  direct main-thread loop — see the file's header comment for why that
  threshold exists instead of always using the worker.
- `player/audiograph.ts`: a real Web Audio graph (EQ bands → analyser)
  reads and shapes actual audio for `audio-url` playback. For the
  YouTube IFrame backend, there's a hard browser boundary — the iframe's
  audio lives in a separate, cross-origin browsing context that Web
  Audio has no access to. Rather than fake reactive data or a working
  EQ, that path uses a clearly-labeled ambient pulse for the visualizer
  (`isRealAudioData: false`) and leaves the EQ inert, both stated
  outright in the UI instead of silently pretending to work.
- `player/engine.ts`: queue-state writes are debounced (400ms); history
  is trimmed in batches past 2000 rows, not checked on every write.
- `ui/shell.ts`: search is debounced (300ms) with in-flight cancellation.
- `visual/canvas.ts`: the ambient canvas stops entirely when the tab is
  hidden, uses `ResizeObserver` (not a `window.resize` listener) so it
  also reacts correctly to container-driven size changes, and respects
  `prefers-reduced-motion` — with a per-user override in Settings — for
  frequency shapes and particles alike.

## What was borrowed, and from where

**LiMusic (`limusic-master`)** — the animatable-artwork-tint technique
described above, and the general shell shape (persistent now-playing
bar, slide-in side drawer, marquee for overflowing titles).

**Monochrome (`monochrome-main`)** — the restraint: near-black neutral
surfaces, one `cubic-bezier(0.2, 0, 0, 1)` easing curve and two duration
tokens reused on every transition instead of one-off values per
component, letting the sampled accent color be the one un-restrained
element.

**Metrolist** (open-source) — informed the settings panel's structure
(tabbed sections, segmented controls, an inline equalizer) and the
mobile mini-player → full-player expand gesture. No code was copied —
Metrolist is a native Android/Compose app, so this is a from-scratch web
reimplementation of the same interaction patterns, not a port.

Neither LiMusic's nor Monochrome's YouTube-stream-handling code was used
— see the next section.

## What's intentionally not here

`music/provider.ts` and `music/providers/youtube.ts` document this
directly: there's no code path that fetches or deciphers a raw/adaptive
YouTube stream URL. Search and metadata go through the official YouTube
Data API v3; playback resolves to an `'iframe'` source that mounts
YouTube's own official IFrame Player (video stays attached, per YouTube's
terms) — same approach already used in Session Clock's `musicdock.ts`.

That also means the equalizer and real-FFT visualizer can't reach audio
played through the iframe path: Web Audio has no way to tap or reroute
audio inside a separate, cross-origin browsing context it doesn't own.
That's a browser security boundary, not a missing feature — see
`player/audiograph.ts`.

Lyrics are user-supplied rather than pulled from a third-party lyrics API
for the same underlying reason most "free" lyrics endpoints are
themselves unofficial/scraped services — see `lyrics/provider.ts`.

## What's stubbed / next steps

- `getStoredYouTubeToken()` in `main.ts` reads a placeholder settings key.
  Wire it to Session Clock's existing `ensureFreshToken()` /
  `integrations.ts` OAuth flow.
- Search suggestions are local (your own recent searches), not a live
  YouTube suggest API — that's a separate, undocumented endpoint with
  its own quota/ToS questions, kept out for the same reason as the
  stream-extraction layer.
- No album/artist pages yet — search results and playlists are
  track-level only.

## Browser & device support

No framework, no polyfills — built to degrade gracefully instead:

- **EQ / real-FFT visualizer**: needs Web Audio (`AudioContext`, with a
  `webkitAudioContext` fallback for older WebKit). Falls back to an
  ambient (non-audio-reactive) visualizer where unavailable, never a
  broken/blank canvas.
- **Resize handling**: `ResizeObserver` where available, a `window`
  resize listener otherwise.
- **Layout**: responsive from ~320px phones through ultrawide desktops;
  a dedicated ≤880px layout swaps the sidebar for a bottom nav and adds
  a full-player expand gesture on the now-playing bar. Uses `100dvh` (with
  a `100vh` fallback) so mobile browser chrome resizing doesn't clip the
  shell, plus `env(safe-area-inset-*)` padding for notches/home
  indicators.
- **Input**: `pointer: coarse` media query bumps touch targets; all
  interactive elements use `touch-action: manipulation` to avoid the
  old mobile-Safari tap delay; `:focus-visible` styling for keyboard
  navigation.
- **Motion**: `prefers-reduced-motion` is honored everywhere animation
  happens, with a manual override in Settings for either direction.
- **Icons**: standard + maskable PWA icons, a dedicated Apple touch
  icon (opaque background — iOS doesn't composite icon transparency
  reliably), and a multi-resolution `favicon.ico`.

## Structure

```
src/
  core/types.ts                  domain types
  music/provider.ts               MusicProvider interface
  music/providers/youtube.ts      the only provider implementation
  player/queue.ts                  shuffle/repeat/remove, provider-agnostic
  player/backends.ts               AudioBackend + YouTubeIframeBackend
  player/engine.ts                 orchestrates provider + queue + backend
  player/audiograph.ts             EQ chain + real FFT (audio) / ambient fallback (iframe)
  player/media-session.ts          OS/lock-screen media controls
  library/likes.ts, playlists.ts, history.ts
  lyrics/provider.ts, sync.ts      user-supplied LRC + Liricle sync
  storage/db.ts                     Dexie/IndexedDB schema
  storage/settings-store.ts         typed app settings, sync-first cache over db.settings
  visual/colorbridge.ts             drives the animated accent color
  visual/canvas.ts                  ambient cinematic background + visualizer
  workers/artwork.worker.ts         off-thread dominant-color extraction
  workers/data.worker.ts            off-thread history dedup (large lists only)
  ui/shell.ts, keyboard.ts          DOM, views, wiring, shortcuts
  ui/settings.ts                    settings panel (Appearance/Equalizer/Playback/About)
public/
  manifest.json, sw.js              PWA shell caching
  icons/                            favicon, apple touch icon, PWA + maskable icons, splash logo
eslint.config.js                    flat ESLint config (typescript-eslint)
lighthouserc.json                   Lighthouse CI thresholds
.github/workflows/ci.yml            lint + typecheck + build on push/PR
.github/workflows/lighthouse.yml    Lighthouse CI on push/PR
```

## Deno Deploy

This project is a Vite browser application. For Deno Deploy, use the
repository build settings below:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

The included `deno.json` mirrors the local Vite tasks for Deno's Node/npm
compatibility layer. No custom Deno HTTP server is required; the built
`dist/` directory is the deployment artifact.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[GNU AGPL v3.0 or later](./LICENSE).
