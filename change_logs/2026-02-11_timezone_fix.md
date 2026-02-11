# 2026-02-11 — Timezone Support Fix

## Summary

Corrected ICS time parsing to handle timezones properly.

## Changes

### `import_calendar.js`
- Rewrote `parseICSDate` to use `Utilities.parseDate` for `TZID` support
- Added support for `Z` suffix (UTC) using ISO-like string parsing
- Added fallback for `Utilities.parseDate` (mock support for local testing)

### `tests/gas_polyfills.js`
- Added `Utilities_parseDate_Mock` to simulate timezone conversion for `America/Los_Angeles` test case (handling DST offset correctly)

## Verification Results

| Scenario | Input Time | Expected JST | Actual Result | Status |
|---|---|---|---|---|
| UTC | `10:00 Z` | `19:00 JST` | `19:00 JST` | ✅ |
| Floating | `14:00` | `14:00 JST` | `14:00 JST` | ✅ |
| PST (TZID) | `09:00 LA` | `01:00+1 JST` | `01:00+1 JST` | ✅ |

The script now correctly converts foreign timezones to the script's local timezone (JST) instead of treating them as local times.
