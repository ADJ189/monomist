# Monomist API / Worker architecture

This document covers the Cloudflare Worker + Monomist API scaffolding added
on top of the existing frontend player. It's written for whoever picks up
the future YouTube.js/Innertube adapter next — the short version is:
**one file, `worker/providers/server-youtube-provider.ts`, is where that
work goes.** Everything described below exists to make that a self-contained
change with no route, client, or player-engine edits required.

## Why this exists

The frontend previously talked to YouTube's official Data API v3 directly
from the browser, using a user's OAuth token, and always played back through
YouTube's official embedded IFrame Player. That still works today —
unchanged — and is described in [Fallback behavior](#fallback-behavior)
below. This scaffolding adds a second, server-side path alongside it so
that a future YouTube.js/Innertube-backed provider has somewhere to live,
without YouTube.js, Innertube, PO-token generation, BotGuard, or any other
anti-bot bypass being implemented anywhere in this repo. Those are
explicitly out of scope here; see
[Where the future adapter plugs in](#where-the-future-adapter-plugs-in).

## Request flow

```text
Frontend (src/music/providers/youtube.ts)
  -> Monomist API client (src/api/client.ts)
  -> Cloudflare Worker (worker/index.ts -> worker/router.ts)
  -> RemoteMusicProvider interface (worker/providers/types.ts)
  -> ServerYouTubeProvider placeholder (worker/providers/server-youtube-provider.ts)
  -> [future YouTube.js adapter -- not implemented]
```

One Worker (`worker/index.ts`) serves both the built frontend (via
Cloudflare's static assets binding, for any path not under `/api/`) and the
JSON API (for `/api/*`). There's no separate API host to configure in
production — same origin, same deploy.

## Directory layout

```text
worker/
  index.ts               Worker entry point: routes /api/*, falls back to ASSETS for everything else
  router.ts               Tiny dependency-free path router (method + :param matching)
  env.ts                  Typed Env (bindings, public config, secrets)
  errors.ts                Typed ApiError / NotImplementedError, JSON response helpers
  validation.ts            Request validation shared by routes (query/param parsing)
  rate-limit.ts             RateLimiter abstraction: in-memory default, optional KV-backed
  providers/
    types.ts                RemoteMusicProvider interface -- what a provider must implement
    server-youtube-provider.ts   Placeholder implementation (throws NotImplementedError)
    registry.ts               getProvider(env) -- single point of provider selection
  auth/
    session.ts              Signed session cookie create/verify (HMAC-SHA256)
    oauth.ts                 Google OAuth2 URL building + code exchange (standard, documented endpoints)
  routes/
    health.ts, search.ts, video.ts, playback.ts   One file per endpoint
  __tests__/               Vitest tests for all of the above

src/api/
  types.ts                 Wire types shared by the client and the Worker (single source of truth)
  client.ts                 MonomistApiClient -- the only place the frontend builds /api/* requests
  __tests__/

src/music/providers/youtube.ts   Existing provider, refactored (see below)
src/player/backends.ts            Existing backends, plus DirectAudioBackend (see below)
```

## The provider abstraction

`worker/providers/types.ts` defines `RemoteMusicProvider`: `search`,
`getVideoMetadata`, `getPlaybackInfo`. Routes (`worker/routes/*.ts`) only
ever call through this interface via `getProvider(env)`
(`worker/providers/registry.ts`) — they never import a concrete provider or
contain provider-specific logic. That's deliberate: it's what lets the
placeholder be swapped for a real implementation without touching routing,
validation, or error handling.

### Where the future adapter plugs in

`worker/providers/server-youtube-provider.ts`'s `ServerYouTubeProvider`
class is a placeholder. All three methods currently throw
`NotImplementedError`, which routes turn into a `501 NOT_IMPLEMENTED` JSON
response. The class's doc comment spells out what each method is expected
to do once implemented:

- `search()` — Innertube search, mapped to `ProviderSearchResult[]`
- `getVideoMetadata()` — Innertube video info, mapped to `ProviderVideoMetadata`
- `getPlaybackInfo()` — resolve a stream URL, returned as
  `{ kind: 'audio-url', url, expiresAt }` with `expiresAt` set from the
  stream's real expiry, or `{ kind: 'iframe', embedUrl }` as a fallback

**Explicitly out of scope for that future work:** constructing/wiring an
Innertube client, PO-token generation, BotGuard/attestation solving, or any
other anti-bot bypass. If resolving a playable stream turns out to require
one of those, `getPlaybackInfo()` should keep throwing (or return an
`iframe` source) rather than the adapter growing a workaround for it — this
repo's scope boundary is a design decision, not a placeholder for "not
gotten to yet."

Swapping in a real implementation is a two-line change to
`worker/providers/registry.ts`'s `getProvider()` (return the new class
instead of `ServerYouTubeProvider`) — everything upstream of it (routes,
error handling, rate limiting, the frontend client) is unaffected.

## Typed API

Every endpoint's request/response/error shape is defined once, in
`src/api/types.ts`, and imported by both the Worker (`worker/routes/*.ts`,
via a relative `../../src/api/types` import) and the frontend client
(`src/api/client.ts`). There's no code generation step and no duplicate
definitions to drift apart.

| Endpoint             | Route file                | Notes                                   |
| --------------------- | --------------------------- | ---------------------------------------- |
| `GET /api/health`      | `worker/routes/health.ts`    | Always works, no provider call            |
| `GET /api/search?q=`    | `worker/routes/search.ts`    | 400 if `q` missing/too long                |
| `GET /api/video/:id`    | `worker/routes/video.ts`     | 400 if `:id` doesn't match the id pattern   |
| `GET /api/playback/:id` | `worker/routes/playback.ts`  | Same id validation as `/video/:id`          |

Errors are always a typed JSON body:

```json
{ "error": { "code": "NOT_IMPLEMENTED", "message": "...", "status": 501 } }
```

`ApiErrorCode` (in `src/api/types.ts`) is a closed set:
`BAD_REQUEST`, `NOT_FOUND`, `NOT_IMPLEMENTED`, `RATE_LIMITED`,
`UNAUTHENTICATED`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`. The frontend client
throws a typed `ApiError` (`src/api/client.ts`) carrying that code, so
callers can branch on `err.code` / `err.isNotImplemented` instead of
parsing message strings.

Route handlers **throw** `ApiError` rather than constructing an error
`Response` themselves; `worker/index.ts`'s `handleApi()` is the single
place that catches and converts (`worker/errors.ts`'s `toErrorResponse`).
This keeps every route's error handling identical and is also why
`worker/errors.ts`'s `toErrorResponse` never forwards an arbitrary caught
error's message to the client — only `ApiError`'s own message is trusted to
be client-safe.

## Frontend integration

### `src/api/client.ts`

`MonomistApiClient` (and its default singleton, `monomistApi`) is the only
place in the frontend that constructs `/api/*` requests. It resolves
`fetch` lazily per call (not bound once at construction) specifically so
tests — and anything else that swaps the global `fetch` at runtime — can
intercept it.

### `src/music/providers/youtube.ts`

This is the "refactor `YouTubeProvider` to use the Monomist API where
appropriate" piece. `search()` and `resolvePlayableSource()` each try the
Monomist API client first; on **any** failure (a typed `501
NOT_IMPLEMENTED`, a network error, an unreachable Worker, or even an
unexpected response shape — e.g. a dev server returning its SPA-fallback
HTML for an unmatched `/api/*` path) they fall through to the exact same
direct-to-Data-API-v3 implementation the provider always had.

That fallback path is **unchanged code** — same requests, same OAuth
token, same official IFrame Player embed. Concretely:

- Today, `ServerYouTubeProvider` always throws `NotImplementedError`, so
  every call falls through. **The app's behavior is identical to before
  this scaffolding was added.**
- Once a real server-side provider exists, calls that succeed will be
  served from it instead, with the direct path remaining as a safety net
  for outages or a Worker that isn't deployed in a given environment.

## Playback architecture

### `AudioBackend` (unchanged) and `DirectAudioBackend` (new)

`src/player/backends.ts`'s existing `AudioBackend` is untouched.
`DirectAudioBackend` wraps it and adds one thing: if the loaded
`PlayableSource` carries an `expiresAt`, it schedules a refresh ~30s before
that deadline, re-resolves the source via a resolver callback, and reloads
the *same* `<audio>` element in place (by calling `AudioBackend.load()`
again, which only ever reassigns `.src` on the element it created once in
its constructor). That's what lets an already-attached
`MediaElementAudioSourceNode` (`src/player/audiograph.ts`, used for the
visualizer/EQ) keep working across a refresh instead of needing to be torn
down and reattached, and lets playback continue from the same position
instead of restarting.

`PlayerEngine` (`src/player/engine.ts`) now constructs a
`DirectAudioBackend` for every `audio-url` source, passing a resolver that
re-calls `provider.resolvePlayableSource(track)`. Since no current
provider returns `expiresAt`, the refresh timer simply never fires today —
this is inert scaffolding until the future adapter returns a real,
time-limited stream URL.

The iframe backend (`YouTubeIframeBackend`) is untouched and remains the
default/fallback playback path.

## Authentication/session infrastructure

`worker/auth/session.ts` and `worker/auth/oauth.ts` are infrastructure for
a future login flow — nothing in this repo currently issues a session or
calls the OAuth exchange from a route.

- **`session.ts`**: HMAC-SHA256-signed session cookies
  (`monomist_session`). `readSession(request, env)` verifies and returns
  the payload, or `null` if there's no `SESSION_SECRET` configured, no
  cookie, or the cookie is invalid/expired/tampered.
- **`oauth.ts`**: standard, documented Google OAuth2 endpoints (consent
  URL + authorization-code exchange). This is "sign in with Google"
  plumbing — it has nothing to do with YouTube.js/Innertube stream
  resolution and must never be wired into it.

**Explicitly out of scope:** raw YouTube cookie extraction or storage. If a
future adapter needs YouTube-side state at all, this session/OAuth
infrastructure is not where it goes.

## Environment & secrets

See `.env.example` (documents every variable) and `.dev.vars.example`
(copy to `.dev.vars` for local `wrangler dev` — already gitignored).
`worker/env.ts` is the typed source of truth.

| Variable                       | Public/secret | Set via                              |
| -------------------------------- | --------------- | --------------------------------------- |
| `ENVIRONMENT`                    | public           | `wrangler.toml` `[vars]`                 |
| `PUBLIC_APP_URL`                  | public           | `wrangler.toml` `[vars]`                 |
| `GOOGLE_OAUTH_CLIENT_ID`            | secret*          | `.dev.vars` / `wrangler secret put`        |
| `GOOGLE_OAUTH_CLIENT_SECRET`         | secret           | `.dev.vars` / `wrangler secret put`        |
| `SESSION_SECRET`                   | secret           | `.dev.vars` / `wrangler secret put`        |

\* the client id isn't sensitive on its own but is kept alongside the
secret since it's only needed together with it.

None of the above are required for the app's current `/api/search`,
`/api/video/:id`, or `/api/playback/:id` routes to run (they're
unauthenticated and don't touch the OAuth/session code at all) — they only
matter once the future adapter or a login flow needs them.

**Never logged:** tokens, cookies, `Authorization` headers, or secrets.
`worker/index.ts`'s error handler only logs `method + pathname` for
unexpected errors, deliberately never `request` itself (headers/body).
`worker/auth/oauth.ts`'s token exchange never surfaces a failed response's
body in a thrown error, since Google's error responses can echo request
parameters that include the client secret.

## Rate limiting

`worker/rate-limit.ts` defines a `RateLimiter` interface with two
implementations: `InMemoryRateLimiter` (default, per-isolate, no
dependencies) and `KvRateLimiter` (used automatically when the optional
`MONOMIST_KV` binding is provisioned — see `wrangler.toml`). Both are
fixed-window, courtesy limits (30 req/60s per route+caller by default) —
this is defense against accidental hammering, not a security boundary.

## Running locally

```bash
npm install
npm run build          # builds the frontend into dist/
npm run worker:dev      # wrangler dev -- serves dist/ + /api/* together
```

Or, for frontend-only iteration without the Worker (`YouTubeProvider` will
transparently fall back to its direct-API path, as described above):

```bash
npm run dev             # plain vite dev server, no /api/* routes
```

## Testing

```bash
npm run typecheck        # tsc --noEmit for src/, then a separate pass for worker/
npm run test              # vitest run
npm run build              # vite build
npx wrangler deploy --dry-run --outdir /tmp/out   # validates the Worker bundles/binds correctly, deploys nothing
```

Worker route handlers are plain functions over the standard
`Request`/`Response`/`URL` globals (see `worker/index.ts`'s doc comment),
so they're tested directly under Node — no Miniflare/`workerd` pool
needed for this suite. `npx wrangler dev` / `wrangler deploy` still
exercise the real Workers runtime when you need that.

## Deploying

```bash
npm run build
npx wrangler deploy      # uses wrangler.toml; set secrets first with `wrangler secret put <NAME>`
```

For a KV-backed rate limiter/session store in production, provision a
namespace and uncomment the `[[kv_namespaces]]` block in `wrangler.toml`:

```bash
npx wrangler kv namespace create monomist_kv
```
