# 2026-02-15: Fix Missing Recurring Event Instances

## Problem

Recurring events with `RECURRENCE-ID` exception instances (e.g. "GSRD-1定例"
with 17 VEVENTs sharing the same UID) were not imported. Only one instance
per UID survived because `icsMap` and `calMap` used the bare `UID` as the
sole key, causing later entries to overwrite earlier ones.

## Root Cause

- `parseICSContent()` did not parse `RECURRENCE-ID`.
- `importICSFile()` built `icsMap[uid]` — only one event per UID.
- Same collision in `calMap[uid]` for existing calendar events.

## Changes

### `import_calendar.js`

1. **`parseICSContent()`**: Added `recurrenceId` and `recurrenceKey` fields
   to each parsed event. Added `case 'RECURRENCE-ID':` to the parser switch.
   Composite key is computed at `END:VEVENT`:
   - No RECURRENCE-ID → `recurrenceKey = uid`
   - With RECURRENCE-ID → `recurrenceKey = uid + "|" + recurrenceIdValue`

2. **`importICSFile()`**: Replaced all `uid`-based map operations with
   `recurrenceKey`-based ones:
   - `icsMap` keyed by `recurrenceKey`
   - `calMap` keyed by `recurrenceKey` (read from `ICS_UID_TAG_KEY` tag)
   - New calendar events tagged with `recurrenceKey`
   - Log messages updated to show `key:` instead of `UID:`

3. **Docstrings**: Updated for `importICSFile()` and `parseICSContent()` to
   document the composite key scheme and RECURRENCE-ID handling.

### `tests/test_recurrence_key.js` (new)

Local Node.js test that verifies:
- "GSRD-1定例" produces 18 distinct entries (1 parent + 17 exceptions)
- All recurrenceKeys are unique
- Date-shifted instance (9/15→9/16) retains correct RECURRENCE-ID
- Jan 26 instance (the reported missing event) is parsed correctly

## Backward Compatibility

Existing calendar events tagged with bare UID will not match composite keys
that include `|recurrenceId`. On first sync after deployment, those events
will be deleted and re-created with the new tag format. Non-recurring events
(bare UID, no RECURRENCE-ID) are unaffected.
