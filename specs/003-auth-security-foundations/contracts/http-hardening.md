# Contract: HTTP and browser hardening

This page lists what every response must carry and which requests must be refused (FR-027 –
FR-031, US7). These are checked by backend integration tests and by the production smoke check
in [quickstart.md](../quickstart.md#v12-production-hardening-smoke-check).

## Response headers

| Header | Value | Applies to |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Production, HTTPS responses |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | All responses. In Development, `upgrade-insecure-requests` is dropped and `connect-src` adds `ws://localhost:5173`. |
| `X-Content-Type-Options` | `nosniff` | All |
| `Referrer-Policy` | `no-referrer` | All |
| `X-Frame-Options` | `DENY` | All |
| `Cross-Origin-Opener-Policy` | `same-origin` | All |
| `Cross-Origin-Resource-Policy` | `same-origin` | All |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=()` | All. `camera=(self)` because feature 002's in-app camera uses `getUserMedia` on the app's own origin; no other origin or embedded frame may use it. |
| `Cache-Control` | `no-store` | `/api/*` and `index.html`. Hashed static assets keep long caching. |
| `Content-Disposition` | `attachment; filename="api.json"` | `/api/*` (ASVS 14.4.2): a browser that opens an API URL directly downloads it rather than rendering it. |

These headers are **not** sent: `Server` (Kestrel `AddServerHeader = false`), `X-Powered-By`, and
any `Access-Control-Allow-*` (no CORS middleware, R10).

## Transport

- In Production, HTTP requests get a `308` redirect to HTTPS (`UseHttpsRedirection`), and the
  host's "HTTPS only" setting is on.
- `AllowedHosts` is the real host name in `appsettings.Production.json`. A request with any
  other `Host` header gets `400`.
- Forwarded headers are trusted only from the platform proxy (`ForwardLimit = 1`).

## Refused requests

| Request | Result |
|---|---|
| Unsafe method (`POST`/`PUT`/`PATCH`/`DELETE`) to `/api/*` whose `Origin` is not in `Security:AllowedOrigins` | `403 csrf_failed` |
| Unsafe method with no `Origin` and `Sec-Fetch-Site` ≠ `same-origin` | `403 csrf_failed` |
| Unsafe method with a missing or invalid `X-CSRF-Token` | `403 csrf_failed` |
| A non-public `/api/*` endpoint without a valid session | `401 unauthenticated`, and **no work is done**: no Claude call, no quota use (US3.1) |
| `/auth/*` body over 4 KB, `/estimates/text` over the 001 limits, photo over 6 MB | `413` / `400` as in the 001 contract |
| Any unhandled exception | `500` problem+json with a generic `title` only. No stack trace, exception type, SQL, path or configuration (FR-031). The detail goes to the server log, and that log entry has no request body. |

## Logging rules (FR-025, FR-030)

- Request bodies, cookies, the `Authorization` header and `X-CSRF-Token` are never logged.
- Connection strings and keys are read from configuration and never written to logs or error
  responses.
- Existing Claude error logs keep logging only the status code and the SDK message, never the
  prompt, the description or the photo. A test checks this.
