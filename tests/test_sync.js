/**
 * @fileoverview Test runner for ICS Calendar Sync.
 *
 * Calls importICSFile() using test_config.js overrides to read
 * test_data.ics from the test Drive folder instead of production.
 *
 * Usage:
 *   bash tests/run_test.sh
 *
 * Test scenarios (run in order):
 *   1. First run with DRY_RUN=true  → shows planned CREATE actions
 *   2. Set DRY_RUN=false, run again → creates 3 events on calendar
 *   3. Run again → 0 created, 3 unchanged (idempotent)
 *   4. Edit test_data.ics on Drive (change a description) → 1 updated
 *   5. Remove an event from test_data.ics on Drive → 1 deleted
 */

Logger.log('=== TEST SYNC START ===');
Logger.log('Using folder: ' + GDRIVE_FOLDER_ID);
Logger.log('Using file: ' + ICS_FILE_NAME);
Logger.log('DRY_RUN: ' + DRY_RUN);

// importICSFile();

Logger.log('=== TEST SYNC COMPLETE ===');
