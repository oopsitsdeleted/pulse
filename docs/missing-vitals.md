# Missing vitals: device diagnostic build

Health Monitor now retains imported SpO2, with the existing one-sided range and 95% floor. Missing values stay
`no_data`. Scoring version 32 replays stored history; Recovery's formula is unchanged.

Settings > Data source > Data check includes a header for every checked Health Connect type:

- `not allowed (permission API)`: the permission API does not report the type as readable.
- `allowed; read succeeded; 0 raw records`: Health Connect returned no records in the printed read window.
- `read failed (CODE)`: the read failed, rather than establishing that no data exists.
- `invalid time/value`: returned records the summary cannot interpret.
- `unreadable ranges skipped`: malformed-record isolation left out one or more ranges.

The report reads all apps before import filtering. If raw records exist but the daily Pulse value is missing,
investigate timestamp/day mapping and import persistence. If Health Connect's UI shows entries in the same window but
the API returns none, investigate the installed build, Android/Health Connect version and data availability to third-party
readers. Do not infer that the source app never exports a vital from this symptom alone.

Native error messages are not copied because they may contain health records; only bounded error codes are included.
The user-shared diagnostic still contains health readings, as before. It is not telemetry.

After installing the fork's updated APK over the existing fork build, sync, run Data check again, and inspect the
`OxygenSaturation` and `RespiratoryRate` header lines. Do not uninstall or clear storage to troubleshoot this.
