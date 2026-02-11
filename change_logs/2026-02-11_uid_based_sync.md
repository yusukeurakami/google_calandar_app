# 2026-02-11 — UID-Based Calendar Sync

## Summary

Rewrote `importICSFile()` to use ICS UID-based matching instead of title+time matching.

## Changes

### Modified Files

- **`import_calendar.js`** — Complete rewrite of sync logic:
  - **UID-based matching**: Events are matched by ICS `UID` stored as a `icsUid` tag on calendar events, instead of title + start time
  - **Create**: New UIDs → create event with both `sourceFile` and `icsUid` tags
  - **Update**: Existing UID with changed content (title, time, description, location) → update in-place
  - **Delete**: UIDs on calendar but no longer in ICS → delete orphaned event
  - **Dry-run mode**: `DRY_RUN = true` (default) logs all planned actions without executing
  - **`eventsEqual()`**: New helper comparing title, start, end, description, and location
  - Changed `const`/`let` to `var` for broader GAS runtime compatibility
  - Google-style JSDoc docstrings on all functions

## Problems Solved

1. **Stale content**: Events with same title+time but changed description/location are now updated
2. **Time shifts**: Events whose time changed are updated in-place instead of duplicated
3. **Orphaned events**: Events removed from ICS are cleaned up from the calendar

## Safety

- Only events tagged with `sourceFile=LandmarkX` are ever modified or deleted
- `DRY_RUN = true` by default — must explicitly set to `false` to commit changes

## Testing

- Dry-run against new calendar: `242 created, 0 updated, 0 unchanged, 0 deleted, 0 errors`
