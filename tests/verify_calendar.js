/**
 * Script to verify events on the calendar after production sync.
 * Lists the count and details of events tagged with sourceFile=LATEST_CAL.
 */

// Override config to point to production calendar (if needed, but config.js should have it)
// GDRIVE_FOLDER_ID is defined in config.js

function verifyCalendar() {
    Logger.log('=== VERIFICATION STARTED ===');

    var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!calendar) {
        Logger.log('Error: Could not access calendar: ' + CALENDAR_ID);
        return;
    }

    // Wide range to catch all events
    var start = new Date('2025-01-01T00:00:00Z');
    var end = new Date('2027-01-01T00:00:00Z');

    Logger.log('Fetching events from ' + start.toISOString() + ' to ' + end.toISOString());

    var events = calendar.getEvents(start, end);
    Logger.log('Total events in range: ' + events.length);

    var ourEvents = [];
    for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var source = event.getTag(SOURCE_PROPERTY_KEY);

        if (source === SOURCE_PROPERTY_VALUE) {
            ourEvents.push(event);
        }
    }

    Logger.log('Events tagged with ' + SOURCE_PROPERTY_VALUE + ': ' + ourEvents.length);

    if (ourEvents.length === 0) {
        Logger.log('WARNING: No imported events found! The sync might not have run or failed.');
    } else {
        Logger.log('--- Sample Events (First 10) ---');
        var limit = Math.min(ourEvents.length, 10);
        for (var j = 0; j < limit; j++) {
            var e = ourEvents[j];
            Logger.log((j + 1) + '. "' + e.getTitle() + '"');
            Logger.log('   Start: ' + e.getStartTime());
            Logger.log('   End:   ' + e.getEndTime());
            Logger.log('   UID:   ' + e.getTag(ICS_UID_TAG_KEY));
            Logger.log('');
        }
    }

    Logger.log('=== VERIFICATION COMPLETE ===');
}

verifyCalendar();
