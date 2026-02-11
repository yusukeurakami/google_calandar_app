# 2026-02-11 — Create Calendar Event Script

## Summary

Added `create_event.js` — a Google Apps Script that creates a test event on the user's default Calendar.

## Changes

### New Files

- **`create_event.js`** — GAS script with `createTestEvent()` function that creates a "GAS test" event on Feb 11, 2026 from 18:00–19:00 JST.

## Testing

- Ran locally via `gas-fakes -f create_event.js` — event was created successfully on the real Google Calendar.
- Event ID: `r30b52rocodsl08lcg2edb0jf0@google.com`
