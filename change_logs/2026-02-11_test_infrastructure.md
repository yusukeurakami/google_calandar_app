# 2026-02-11 — Test Infrastructure and Config Extraction

## Summary

Added test infrastructure for UID-based sync and extracted config to a separate file.

## Changes

### New Files

- **`config.js`** — Extracted `GDRIVE_FOLDER_ID` and `CALENDAR_ID` from `import_calendar.js`
- **`tests/test_data.ics`** — Minimal ICS file with 3 test events
- **`tests/test_config.js`** — Overrides config for test Drive folder and ICS filename
- **`tests/test_sync.js`** — Calls `importICSFile()` with test config
- **`tests/run_test.sh`** — Concatenates all files and runs with gas-fakes

### Modified Files

- **`import_calendar.js`** — Removed hardcoded IDs (now in `config.js`); fixed line splitting in `parseICSContent` to use `String.fromCharCode(10)` for gas-fakes compatibility
- **`.gitignore`** — Added `config.js` to exclude sensitive IDs from Git

## Test Results (all 4 scenarios passed)

| Scenario | Expected | Actual | Status |
|---|---|---|---|
| CREATE (first run) | 3 created | 3 created, 0 updated, 0 unchanged, 0 deleted | ✅ |
| IDEMPOTENCY (re-run) | 3 unchanged | 0 created, 0 updated, 3 unchanged, 0 deleted | ✅ |
| UPDATE (desc + time shift) | 2 updated | 0 created, 2 updated, 1 unchanged, 0 deleted | ✅ |
| DELETE (remove 1 event) | 1 deleted | 0 created, 0 updated, 2 unchanged, 1 deleted | ✅ |
