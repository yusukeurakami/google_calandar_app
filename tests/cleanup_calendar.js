/**
 * Script to clean up events created by the local test runner.
 * Scans a wide range and deletes all events tagged with sourceFile=LATEST_CAL.
 */

// Override config to point to production calendar
// GDRIVE_FOLDER_ID is irrelevant for cleanup but needed for config load.
GDRIVE_FOLDER_ID = '1zHbHUBl1O4rhgD9kh6q2rrhF9XzZSlN2';

function cleanupCalendar() {
    Logger.log('=== CLEANUP STARTED ===');

    var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!calendar) {
        Logger.log('Error: Could not access calendar: ' + CALENDAR_ID);
        return;
    }

    // Wide range to catch all events
    var start = new Date('2025-01-01T00:00:00Z');
    var end = new Date('2027-01-01T00:00:00Z');

    Logger.log('Scanning events from ' + start.toISOString() + ' to ' + end.toISOString());

    var events = calendar.getEvents(start, end);
    Logger.log('Found ' + events.length + ' total events in range.');

    var deletedCount = 0;
    var errorCount = 0;

    for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var source = event.getTag(SOURCE_PROPERTY_KEY);

        if (source === SOURCE_PROPERTY_VALUE) {
            try {
                Logger.log('Deleting event ' + (deletedCount + 1) + ': "' + event.getTitle() + '" at ' + event.getStartTime());
                event.deleteEvent();
                deletedCount++;

                // Throttle to avoid Google Calendar rate limits.
                // Sleep 1s every deletion, extra 5s every 20 deletions.
                Utilities.sleep(1000);
                if (deletedCount % 20 === 0) {
                    Logger.log('Throttle pause at ' + deletedCount + ' deletions...');
                    Utilities.sleep(5000);
                }
            } catch (e) {
                Logger.log('Error deleting event: ' + e.toString() + '. Sleeping 10s before retry...');
                errorCount++;
                Utilities.sleep(10000);
            }
        }
    }

    Logger.log('=== CLEANUP COMPLETE ===');
    Logger.log('Deleted ' + deletedCount + ' events.');
    Logger.log('Errors: ' + errorCount);
}

cleanupCalendar();
