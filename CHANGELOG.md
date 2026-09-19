# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses date-based [0.0.x] pre-release versioning until a
first stable 1.0.0.

## [0.1.0] - 2026-09-18

A larger update than the version bump alone suggests -- jumping from
0.0.4 straight to 0.1.0 rather than 0.0.5 to reflect that. All six items
below were flagged in PR review of the 0.0.4 Worker/API scaffolding and
are fixed here.

### Fixed (PR bug fixes)

- **Cancelled searches could resolve with stale/empty results
  (`src/music/providers/youtube.ts`)** -- `YouTubeProvider.search()`
  caught every error from the Monomist API attempt, including
  `AbortError`, and treated it the same as "try the fallback instead."
  With no OAuth token available, the direct-API fallback returns an
  empty result without ever consulting the abort signal, so a cancelled
  search (e.g. the user typed again) could still resolve successfully
  and overwrite a newer, still-in-flight search's results. `search()`
  now checks the signal before starting and rethrows `AbortError` from
  the remote attempt instead of falling back.
- **`package.json` and `package-lock.json` had drifted apart** -- the
  0.0.4 update bumped `package.json` to `0.0.4` but the committed
  lockfile still read `0.0.3`. Re-synced via `npm install`; both (and
  `CHANGELOG.md`) now agree.
- **`worker:deploy` never targeted the production environment
  (`package.json`, `wrangler.toml`)** -- the script ran a bare `wrangler
  deploy`, which uses the top-level (development) `vars` rather than
  `[env.production]`, so a real deploy could go out with the localhost
  `PUBLIC_APP_URL` and `ENVIRONMENT=development`. `worker:deploy` now
  passes `--env production` explicitly. Chasing this down also surfaced
  a more serious problem: a stray `wrangler.jsonc` (no `main` field) had
  ended up alongside `wrangler.toml`, and Wrangler silently prefers a
  JSON(C) config over TOML with **no warning** -- confirmed via `wrangler
  deploy --dry-run`, which reported "No bindings found" and a
  static-assets-only upload. In practice this meant the entire Worker
  script -- every `/api/*` route, rate limiting, all of it -- was dead
  configuration in any real deployment despite `wrangler deploy`
  exiting successfully. Removed `wrangler.jsonc`, folded its
  `not_found_handling: single-page-application` setting into
  `wrangler.toml`, and verified both `--env production` and a bare
  deploy now correctly bundle `worker/index.ts` with the expected
  bindings.
- **CI didn't run the test suite (`.github/workflows/ci.yml`)** -- the
  0.0.4 update added ~90 Vitest tests and a `test` script, but the CI
  job only ran lint, typecheck, and build, so a regression covered only
  by tests wouldn't have blocked a PR. Added a `Test` step (`npm test`)
  ahead of `Build`.
- **A malformed URL became an unhandled 500 (`worker/router.ts`)** --
  `decodeURIComponent()` throws a raw `URIError` on malformed
  percent-encoding (e.g. a path segment containing a lone `%ZZ`), which
  propagated out of the router uncaught and was logged and returned as
  a generic `INTERNAL_ERROR` rather than the client-error it actually
  is. The router now catches this and throws a typed
  `ApiError('BAD_REQUEST')` instead.
- **A transient refresh failure could let a temporary media URL expire
  outright (`src/player/backends.ts`)** -- `DirectAudioBackend`'s
  scheduled refresh, on failure, only notified `onError` and never
  scheduled a follow-up attempt. Since the currently-loaded URL keeps
  playing regardless of whether re-resolving it succeeded, a single
  transient failure (a momentary network blip re-resolving the track)
  meant no further refresh was ever scheduled, so the URL would later
  expire for real and playback would simply stop. Refresh failures now
  retry quietly on a short, bounded delay for as long as the
  currently-loaded URL still has meaningful runway before its own
  expiry; `onError` only fires once that runway is exhausted.

### Added

- Additional test coverage for all six fixes above (Vitest suite grew
  from ~87 to 96 tests), including new cases for already-aborted and
  mid-flight-aborted search signals, malformed percent-encoded route
  params, and the bounded-retry/eventual-`onError` behavior of a
  repeatedly-failing refresh.

## [0.0.4] - 2026-09-17

### Added

- Cloudflare Worker (`worker/`) serving the built frontend plus a typed
  `/api/*`: `GET /api/health`, `GET /api/search?q=`, `GET /api/video/:id`,
  `GET /api/playback/:id`. Routes contain no provider-specific logic --
  they call through a `RemoteMusicProvider` interface
  (`worker/providers/types.ts`) via `getProvider()`
  (`worker/providers/registry.ts`).
- `worker/providers/server-youtube-provider.ts`: a deliberate placeholder
  (`ServerYouTubeProvider`) for a future server-side YouTube.js/Innertube
  adapter. Every method throws `NotImplementedError` (501). YouTube.js,
  Innertube, PO-token generation, BotGuard, and other anti-bot bypasses
  are explicitly not implemented anywhere in this change -- see
  `docs/ARCHITECTURE.md`.
- Typed error model (`worker/errors.ts`), request validation
  (`worker/validation.ts`), and a rate-limit abstraction
  (`worker/rate-limit.ts`, in-memory by default, KV-backed when a
  `MONOMIST_KV` binding is provisioned).
- Server-side session (`worker/auth/session.ts`, signed cookies) and
  Google OAuth (`worker/auth/oauth.ts`, standard endpoints) infrastructure
  for a future login flow -- unused by any route today. No raw YouTube
  cookie handling.
- `src/api/`: shared wire types (`types.ts`) and a typed frontend client
  (`client.ts`, `monomistApi`) -- the only place the frontend builds
  `/api/*` requests.
- `src/player/backends.ts`: `DirectAudioBackend`, wrapping the existing
  (unchanged) `AudioBackend` with `expiresAt`-based refresh scheduling for
  temporary media URLs, reloading the same `<audio>` element so an
  attached `MediaElementAudioSourceNode` survives a refresh.
  `PlayerEngine` now constructs this backend for `audio-url` sources; it
  behaves identically to `AudioBackend` when no `expiresAt` is present
  (the case for every provider today).
- `wrangler.toml`, `.dev.vars.example`, `.env.example`, `.gitignore`,
  `tsconfig.worker.json` (separate Workers-runtime typecheck from the
  frontend's DOM-lib typecheck).
- `docs/ARCHITECTURE.md`: request flow, directory layout, and exactly
  where the future YouTube.js adapter plugs in.
- Vitest (`vitest.config.ts`) plus 87 tests across routing, the error
  model, rate limiting, request validation, sessions, OAuth, the provider
  placeholder, individual routes, the Worker's fetch dispatcher, the
  frontend API client, `DirectAudioBackend`'s refresh behavior, and
  `YouTubeProvider`'s fallback behavior.

### Changed

- `src/music/providers/youtube.ts`: `search()` and
  `resolvePlayableSource()` now try the Monomist API client first,
  falling back to the exact same direct-to-Data-API-v3 implementation
  this provider always had on any failure (a typed `NOT_IMPLEMENTED`
  response, a network error, or an unreachable Worker). Since
  `ServerYouTubeProvider` is currently a placeholder that always throws,
  **the app's behavior is unchanged** -- every request still falls
  through to the original code path.
- `package.json`: added `test`, `typecheck:worker`, `worker:dev`,
  `worker:deploy` scripts; added `vitest`, `wrangler`,
  `@cloudflare/workers-types`, and `happy-dom` as devDependencies.

## [0.0.3] - 2026-09-14

### Fixed

- Resolved all 5 open Dependabot alerts, all transitive dev-only
  dependencies pulled in by `@lhci/cli`, none reachable from the
  shipped app:
  - `tmp` — arbitrary temp file/dir write via symlinked `dir`
    ([GHSA-52f5-9888-hmc6]) and prefix/postfix path traversal
    ([GHSA-ph9p-34f9-6g65]). Pinned via `overrides` to `^0.2.4`
    (both fixed there).
  - `uuid` — missing buffer bounds check in v3/v5/v6 with a
    caller-supplied buffer ([GHSA-w5hq-g745-h8pq]). Pinned via
    `overrides` to `^11.1.1`.
  - `extract-zip` — unvalidated symlink path traversal on
    extraction ([GHSA-jmr9-qjv8-65gv], [GHSA-7pqw-9j4j-h8q3]).
    No version of `extract-zip` has ever fixed this (upstream
    dead end). It only entered the tree via `lighthouse@12.6.1`
    (pinned by `@lhci/cli@0.15.1`) requiring an old
    `puppeteer-core` whose `@puppeteer/browsers` still used
    `extract-zip` to unpack downloaded Chrome builds.
    `@puppeteer/browsers@3.x` dropped `extract-zip` entirely, so
    `overrides` also force `lighthouse@^13.4.1`,
    `puppeteer-core@^25.3.0`, and `@puppeteer/browsers@^3.2.2`,
    which removes `extract-zip` from the tree rather than
    accepting the risk. Verified `lhci --version` and
    `lhci autorun --help` still load correctly under the
    overridden versions.
  - Also swept up `qs`'s array-limit bypass and buffer-check DoS
    (moderate, via `express`) with the same mechanism.
  - `npm audit` now reports 0 vulnerabilities. Lint, typecheck,
    and build all verified clean against the new lockfile.

[GHSA-52f5-9888-hmc6]: https://github.com/advisories/GHSA-52f5-9888-hmc6
[GHSA-ph9p-34f9-6g65]: https://github.com/advisories/GHSA-ph9p-34f9-6g65
[GHSA-w5hq-g745-h8pq]: https://github.com/advisories/GHSA-w5hq-g745-h8pq
[GHSA-jmr9-qjv8-65gv]: https://github.com/advisories/GHSA-jmr9-qjv8-65gv
[GHSA-7pqw-9j4j-h8q3]: https://github.com/advisories/GHSA-7pqw-9j4j-h8q3

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
