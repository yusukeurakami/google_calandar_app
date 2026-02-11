// var folderId = "1zHbHUBl1O4rhgD9kh6q2rrhF9XzZSlN2"
// var calendarName = "LandmarkX"

/**
 * @OnlyCurrentDoc
 *
 * The above comment directs Apps Script to limit the scope of file
 * access for this script to only files used by the script.
 */

// --- CONFIGURATION ---
const GDRIVE_FOLDER_ID = '1zHbHUBl1O4rhgD9kh6q2rrhF9XzZSlN2';
const ICS_FILE_NAME = 'latest_cal.ics'; // Make sure the file has the .ics extension
// const CALENDAR_ID = '08ef9c4c99bb8797cdb9b6674e270f09ef6b88a09c549611032b0eb6a8f8b48c@group.calendar.google.com'; //
const CALENDAR_ID = '8d0c4e93d1f2951030783a222a0b1c29c3e3d485e1d90d1438cc5e9b28c7c2a4@group.calendar.google.com';

// This key is used to tag events created by this script.
// It ensures we only delete events that this script has created.
const SOURCE_PROPERTY_KEY = 'sourceFile';
const SOURCE_PROPERTY_VALUE = 'LandmarkX';

// Tag key used to store the ICS UID on each calendar event.
const ICS_UID_TAG_KEY = 'icsUid';

// Set to true to preview changes without modifying the calendar.
const DRY_RUN = true;
// --- END CONFIGURATION ---


/**
 * Main function to sync ICS file from Google Drive to Google Calendar.
 *
 * Uses ICS UID-based matching to correctly handle:
 *   - New events (create)
 *   - Updated events — content or time changes (update in-place)
 *   - Removed events — no longer in ICS file (delete from calendar)
 *
 * Only events tagged with SOURCE_PROPERTY_KEY / SOURCE_PROPERTY_VALUE are
 * touched, so manually created calendar events are never affected.
 */
function importICSFile() {
    try {
        // --- 1. Read and parse ICS from Drive ---
        var icsContent = getICSFileFromDrive();
        if (!icsContent) {
            Logger.log('Error: Could not read ICS file from Drive');
            return;
        }

        var icsEvents = parseICSContent(icsContent);
        if (icsEvents.length === 0) {
            Logger.log('No events found in ICS file');
            return;
        }

        // Build a map of ICS UID → event for O(1) lookups
        var icsMap = {};
        for (var i = 0; i < icsEvents.length; i++) {
            if (icsEvents[i].uid) {
                icsMap[icsEvents[i].uid] = icsEvents[i];
            }
        }

        // --- 2. Get the target calendar ---
        var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
        if (!calendar) {
            Logger.log('Error: Could not access calendar with ID: ' + CALENDAR_ID);
            return;
        }

        // --- 3. Compute the date range of all ICS events ---
        var minDate = icsEvents[0].start;
        var maxDate = icsEvents[0].end;
        for (var j = 1; j < icsEvents.length; j++) {
            if (icsEvents[j].start < minDate) { minDate = icsEvents[j].start; }
            if (icsEvents[j].end > maxDate) { maxDate = icsEvents[j].end; }
        }
        // Pad by 1 day on each side to catch edge cases
        var rangeStart = new Date(minDate.getTime() - 86400000);
        var rangeEnd = new Date(maxDate.getTime() + 86400000);

        Logger.log('Fetching existing calendar events from ' + rangeStart.toISOString() + ' to ' + rangeEnd.toISOString());

        // --- 4. Fetch existing events and filter to "ours" ---
        var existingEvents = calendar.getEvents(rangeStart, rangeEnd);
        var calMap = {};  // ICS UID → CalendarEvent
        var ourEventCount = 0;

        for (var k = 0; k < existingEvents.length; k++) {
            var calEvent = existingEvents[k];
            var sourceTag = calEvent.getTag(SOURCE_PROPERTY_KEY);
            if (sourceTag === SOURCE_PROPERTY_VALUE) {
                var uid = calEvent.getTag(ICS_UID_TAG_KEY);
                if (uid) {
                    calMap[uid] = calEvent;
                }
                ourEventCount++;
            }
        }

        Logger.log('Found ' + existingEvents.length + ' total events in range, ' + ourEventCount + ' owned by this script');

        // --- 5. Sync: create, update, or skip ---
        var createdCount = 0;
        var updatedCount = 0;
        var unchangedCount = 0;
        var errorCount = 0;

        var icsUids = Object.keys(icsMap);
        for (var m = 0; m < icsUids.length; m++) {
            var icsUid = icsUids[m];
            var icsEvent = icsMap[icsUid];

            try {
                if (calMap[icsUid]) {
                    // Event exists on calendar — check if it needs updating
                    var calendarEvent = calMap[icsUid];

                    if (!eventsEqual(icsEvent, calendarEvent)) {
                        if (DRY_RUN) {
                            Logger.log('[DRY RUN] UPDATE: "' + icsEvent.summary + '" (UID: ' + icsUid + ')');
                        } else {
                            calendarEvent.setTitle(icsEvent.summary || 'Untitled Event');
                            calendarEvent.setTime(icsEvent.start, icsEvent.end);
                            calendarEvent.setDescription(icsEvent.description || '');
                            calendarEvent.setLocation(icsEvent.location || '');
                        }
                        updatedCount++;
                    } else {
                        unchangedCount++;
                    }

                    // Remove from calMap so remaining entries are orphans
                    delete calMap[icsUid];

                } else {
                    // New event — create it
                    if (DRY_RUN) {
                        Logger.log('[DRY RUN] CREATE: "' + icsEvent.summary + '" at ' + icsEvent.start + ' (UID: ' + icsUid + ')');
                    } else {
                        var newEvent = calendar.createEvent(
                            icsEvent.summary || 'Untitled Event',
                            icsEvent.start,
                            icsEvent.end,
                            {
                                description: icsEvent.description || '',
                                location: icsEvent.location || ''
                            }
                        );
                        newEvent.setTag(SOURCE_PROPERTY_KEY, SOURCE_PROPERTY_VALUE);
                        newEvent.setTag(ICS_UID_TAG_KEY, icsUid);
                    }
                    createdCount++;
                }
            } catch (error) {
                Logger.log('Error processing event "' + icsEvent.summary + '": ' + error.toString());
                errorCount++;
            }
        }

        // --- 6. Delete orphaned events (on calendar but not in ICS) ---
        var deletedCount = 0;
        var orphanUids = Object.keys(calMap);
        for (var n = 0; n < orphanUids.length; n++) {
            var orphanUid = orphanUids[n];
            var orphanEvent = calMap[orphanUid];
            try {
                if (DRY_RUN) {
                    Logger.log('[DRY RUN] DELETE: "' + orphanEvent.getTitle() + '" at ' + orphanEvent.getStartTime() + ' (UID: ' + orphanUid + ')');
                } else {
                    orphanEvent.deleteEvent();
                }
                deletedCount++;
            } catch (error) {
                Logger.log('Error deleting orphan event "' + orphanEvent.getTitle() + '": ' + error.toString());
                errorCount++;
            }
        }

        // --- 7. Summary ---
        var prefix = DRY_RUN ? '[DRY RUN] ' : '';
        Logger.log(prefix + 'Sync complete: ' +
            createdCount + ' created, ' +
            updatedCount + ' updated, ' +
            unchangedCount + ' unchanged, ' +
            deletedCount + ' deleted, ' +
            errorCount + ' errors');

    } catch (error) {
        Logger.log('Error in importICSFile: ' + error.toString());
    }
}


/**
 * Compares an ICS event object with an existing CalendarEvent.
 *
 * @param {Object} icsEvent - Parsed ICS event with summary, start, end,
 *     description, and location fields.
 * @param {CalendarEvent} calEvent - Google Calendar event object.
 * @return {boolean} True if all compared fields are identical.
 */
function eventsEqual(icsEvent, calEvent) {
    if ((icsEvent.summary || '') !== calEvent.getTitle()) { return false; }
    if (icsEvent.start.getTime() !== calEvent.getStartTime().getTime()) { return false; }
    if (icsEvent.end.getTime() !== calEvent.getEndTime().getTime()) { return false; }
    if ((icsEvent.description || '') !== (calEvent.getDescription() || '')) { return false; }
    if ((icsEvent.location || '') !== (calEvent.getLocation() || '')) { return false; }
    return true;
}


/**
 * Reads the ICS file from Google Drive.
 *
 * @return {string|null} The content of the ICS file, or null on error.
 */
function getICSFileFromDrive() {
    try {
        var folder = DriveApp.getFolderById(GDRIVE_FOLDER_ID);
        var files = folder.getFilesByName(ICS_FILE_NAME);

        if (!files.hasNext()) {
            Logger.log('Error: File not found: ' + ICS_FILE_NAME);
            return null;
        }

        var file = files.next();
        var content = file.getBlob().getDataAsString();

        Logger.log('Successfully read ICS file: ' + ICS_FILE_NAME);
        return content;

    } catch (error) {
        Logger.log('Error reading file from Drive: ' + error.toString());
        return null;
    }
}


/**
 * Parses ICS content and extracts events.
 *
 * Handles multi-line folding (RFC 5545 Section 3.1) and text
 * unescaping (Section 3.3.11).
 *
 * @param {string} icsContent - The raw ICS file content.
 * @return {Array<Object>} Array of event objects with summary, description,
 *     location, start, end, and uid fields.
 */
function parseICSContent(icsContent) {
    var events = [];
    var lines = icsContent.replace(new RegExp('\\r\\n', 'g'), '\\n').split('\\n');

    var currentEvent = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        // Handle line continuation (lines starting with space or tab)
        while (i + 1 < lines.length && (lines[i + 1].charAt(0) === ' ' || lines[i + 1].charAt(0) === '\t')) {
            line += lines[i + 1].substring(1);
            i++;
        }

        // Start of a new event
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {
                summary: '',
                description: '',
                location: '',
                start: null,
                end: null,
                uid: ''
            };
            continue;
        }

        // End of an event
        if (line === 'END:VEVENT') {
            if (currentEvent && currentEvent.start && currentEvent.end) {
                events.push(currentEvent);
            }
            currentEvent = null;
            continue;
        }

        // Parse event properties
        if (currentEvent) {
            var colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                var property = line.substring(0, colonIndex);
                var value = line.substring(colonIndex + 1);

                // Remove property parameters (e.g., DTSTART;VALUE=DATE:20240101)
                var semicolonIndex = property.indexOf(';');
                var cleanProperty = semicolonIndex > 0 ? property.substring(0, semicolonIndex) : property;

                // Unescape ICS text values per RFC 5545 Section 3.3.11
                // Order matters: decode literal backslash last to avoid double-unescaping
                value = value.split('\\n').join('\n');
                value = value.split('\\,').join(',');
                value = value.split('\\;').join(';');
                value = value.split('\\\\').join('\\');

                switch (cleanProperty) {
                    case 'SUMMARY':
                        currentEvent.summary = value;
                        break;
                    case 'DESCRIPTION':
                        currentEvent.description = value;
                        break;
                    case 'LOCATION':
                        currentEvent.location = value;
                        break;
                    case 'DTSTART':
                        currentEvent.start = parseICSDate(value, property);
                        break;
                    case 'DTEND':
                        currentEvent.end = parseICSDate(value, property);
                        break;
                    case 'UID':
                        currentEvent.uid = value;
                        break;
                }
            }
        }
    }

    Logger.log('Parsed ' + events.length + ' events from ICS file');
    return events;
}


/**
 * Parses an ICS date string into a JavaScript Date object.
 *
 * Supports both date-only (YYYYMMDD) and datetime (YYYYMMDDTHHMMSS or
 * YYYYMMDDTHHMMSSZ) formats as defined in RFC 5545 Section 3.3.5.
 *
 * @param {string} dateString - The ICS date string.
 * @param {string} property - The full property line (to check for VALUE=DATE).
 * @return {Date} The parsed date.
 */
function parseICSDate(dateString, property) {
    // Check if it's a date-only value (no time)
    var isDateOnly = property && property.includes('VALUE=DATE');

    // ICS format: YYYYMMDDTHHMMSSZ or YYYYMMDD
    // Remove timezone indicator if present
    if (dateString.endsWith('Z')) { dateString = dateString.slice(0, -1); }

    var year, month, day, hour = 0, minute = 0, second = 0;

    if (isDateOnly || dateString.length === 8) {
        // Date only: YYYYMMDD
        year = parseInt(dateString.substring(0, 4));
        month = parseInt(dateString.substring(4, 6)) - 1; // JavaScript months are 0-indexed
        day = parseInt(dateString.substring(6, 8));
    } else if (dateString.length >= 15) {
        // Date and time: YYYYMMDDTHHMMSS
        year = parseInt(dateString.substring(0, 4));
        month = parseInt(dateString.substring(4, 6)) - 1;
        day = parseInt(dateString.substring(6, 8));
        hour = parseInt(dateString.substring(9, 11));
        minute = parseInt(dateString.substring(11, 13));
        second = parseInt(dateString.substring(13, 15));
    } else {
        Logger.log('Warning: Unrecognized date format: ' + dateString);
        return new Date();
    }

    return new Date(year, month, day, hour, minute, second);
}
