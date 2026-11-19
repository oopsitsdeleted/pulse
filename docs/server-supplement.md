# Optional Pulse server supplement

Install the matching server image. On Android, open Settings → Data source → Pulse server supplement and enter
the HTTPS origin and your existing web Pulse username/password. The server and mobile profile must use the same
time zone. Reverse proxies must pass the requests to Pulse without interactive redirects.

The password is sent only to the selected HTTPS origin for sign-in, then discarded. The server credential is kept
in SecureStore; no Google access token, refresh token, or client secret is sent to Android. The only other records
shared are downloads from the selected server. A foreground sync refreshes the last 180 days; background scoring
uses the cached snapshot. A failed refresh keeps the last good snapshot. Disconnect removes the snapshot and
attempts to revoke the session. An offline disconnect still forgets the credential locally.

SpO2, respiratory rate, RHR, HRV (including deep-sleep summary) and VO2 max fill gaps in Health Connect measurements.
Server RHR fills a gap before the sleep-derived fallback. Manually logged SpO2 still takes precedence. Google's
activity roll-ups (active kcal, AZM, active/light/sedentary minutes and daily average HR) take precedence in displays
where available. These are not necessarily Fitbit-only, and are never added to a local value. No server scores,
temperature baseline, workouts or individual samples are imported. Recovery's formula is unchanged.
