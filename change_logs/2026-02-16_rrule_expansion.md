# 2026-02-16 — RRULE Expansion for Recurring Events

## Problem

The ICS import script treated master recurring VEVENTs (those with `RRULE`)
as single events, creating only one calendar event at the DTSTART date.
Outlook exports recurring series as:

1. **One master VEVENT** with `RRULE` (defines the recurrence pattern) and
   optionally `EXDATE` (excluded dates)
2. **Exception VEVENTs** with `RECURRENCE-ID` (individually modified or
   confirmed occurrences)

The 198 exception instances were synced correctly, but occurrences that
existed only as part of the `RRULE` pattern were never created. For
example, a weekly Tuesday series with 103 total occurrences but only 51
exception VEVENTs was missing 42 occurrences on the calendar.

## Changes

### `import_calendar.js`

**Parser enhancements (`parseICSContent`):**
- Added `rrule`, `exdates`, `dtStartRaw`, and `dtStartProperty` fields to
  the parsed event object.
- Added `RRULE` and `EXDATE` cases to the property switch statement.
- `DTSTART` case now also stores the raw value string and full property
  line (with TZID) for use during expansion.

**New helper functions:**
- `padZero_(num)` — zero-pads a number for date formatting.
- `formatICSDateStr_(date)` — formats a Date as `YYYYMMDD`.
- `parseRRule_(rruleStr)` — parses an RRULE value into a structured object
  (FREQ, INTERVAL, UNTIL, BYDAY, WKST).
- `getNthWeekdayOfMonth_(year, month, weekday, n)` — finds the Nth (or
  last) weekday occurrence in a given month.
- `expandRRule_(masterEvent)` — expands a master event's RRULE into
  individual occurrence date-time strings. Supports `FREQ=WEEKLY` (single
  and multiple BYDAY, with INTERVAL) and `FREQ=MONTHLY` (Nth/last weekday).
- `expandRecurringEvents(events)` — post-processes all parsed VEVENTs:
  identifies masters, expands them into individual occurrences, skips
  EXDATE entries and dates covered by exception VEVENTs.

**Main sync flow (`importICSFile`):**
- Added `expandRecurringEvents()` call after `parseICSContent()` and before
  the sync loop.
- Updated docstring to document RRULE expansion and the new recurrenceKey
  format (UID + "|" + occurrence-date for all recurring instances).

### `tests/test_rrule_expansion.js` (new)

Local Node.js test that verifies:
1. Total event count increases after expansion (441 → 844).
2. A known weekly series produces exactly 93 occurrences (103 Tuesdays − 10
   EXDATE).
3. All 10 EXDATE entries are properly excluded.
4. RRULE-expanded occurrences exist for dates not covered by exceptions.
5. Exception instances are preserved without duplication.
6. All recurrenceKeys remain unique (1 known Outlook duplicate tolerated).
7. Monthly RRULE series are correctly expanded.

## Migration Notes

On first run after this change:
- **28 old master events** (tagged with just UID as key) will be detected as
  orphans and deleted.
- **~430 new expanded occurrences** will be created.
- **198 existing exception instances** will be matched by their existing
  `UID|RECURRENCE-ID` key and remain unchanged.
