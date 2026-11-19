# Pulse Mobile supplement (test image)

This is for the separate Expo Android app, not this repository's Capacitor web shell.
The Docker image adds a read-only, versioned mobile API on the existing Pulse origin:

- `POST /api/mobile/v1/session` signs in with an existing Pulse username/password via Better Auth.
- `GET /api/mobile/v1/measurements?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts the scoped bearer and returns up to 180 days of cached daily measurements for that user.
- `DELETE /api/mobile/v1/session` revokes the device's session.

Host Pulse behind HTTPS with `APP_URL` set to the public origin. Keep your existing `.env`,
database and volume. The test image requires no new database tables. On a Compose install, back up first,
then point only the `pulse` service at the test image. Remove its `build: .` or use `--no-build`
and recreate only that service. Do not remove the Postgres volume.

The API serves the existing Google sync's cached measurements; it does not send Google's credentials,
read another user's rows or trigger Google requests. It is disabled in demo mode. The bearer encapsulates
a normal server-side session and only works on the mobile routes. Revoking the session, resetting the account
password, or rotating the server secret invalidates it. A device that disconnects while offline discards the
token locally; the server session may last until revocation or expiry.

If you use a separate interactive access proxy, mobile requests must be able to reach Pulse's authenticated mobile
routes without being redirected. Do not bypass authentication for the rest of the site.
