# 2026-02-11 — Fix import_calendar.js for gas-fakes Compatibility

## Summary

Fixed `import_calendar.js` to run locally with `gas-fakes` by replacing regex literals that are incompatible with the `gas-fakes` `new Function()` executor.

## Changes

### Modified Files

- **`import_calendar.js`** — Replaced 4 regex literal patterns with string-based alternatives:
  - Line 138: `/\r?\n/` → `new RegExp('\r\n', 'g')` + `.split('\n')`
  - Line 147: `/^[ \t]/` → `charAt(0)` checks
  - Line 186: Regex-based unescape → `split().join()` chains
  - Line 232: `/Z$/` → `endsWith('Z')` + `slice(0, -1)`

## Root Cause

The `gas-fakes` CLI wraps scripts in `new Function()` for execution, which double-interprets backslash escapes. Regex literals with backslash-heavy patterns (especially `\\\\`) become malformed during this process, resulting in `SyntaxError: Invalid regular expression: missing /`.

## Testing

- Ran `gas-fakes -f import_calendar.js` locally
- Successfully read `latest_cal.ics` (446 events) from Google Drive folder `1zHbHUBl1O4rhgD9kh6q2rrhF9XzZSlN2`
- Imported 1 new event, skipped 445 duplicates
