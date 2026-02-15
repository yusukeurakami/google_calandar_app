// --- CONFIGURATION ---
// GDRIVE_FOLDER_ID and CALENDAR_ID are defined in config.js
var ICS_FILE_NAME = 'latest_cal.ics'; // Make sure the file has the .ics extension

// This key is used to tag events created by this script.
// It ensures we only delete events that this script has created.
var SOURCE_PROPERTY_KEY = 'sourceFile';
var SOURCE_PROPERTY_VALUE = 'LATEST_CAL';

// Tag key used to store the ICS UID on each calendar event.
var ICS_UID_TAG_KEY = 'icsUid';

// Set to true to preview changes without modifying the calendar.
var DRY_RUN = false;
// --- END CONFIGURATION ---

// Mapping of Windows Timezone IDs (common in Outlook ICS) to IANA Timezones (supported by GAS)
var TIMEZONE_MAP = {
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Eastern Standard Time': 'America/New_York',
    'GMT Standard Time': 'Europe/London',
    'W. Europe Standard Time': 'Europe/Paris',
    'Central Standard Time': 'America/Chicago',
    'China Standard Time': 'Asia/Shanghai',
    'Singapore Standard Time': 'Asia/Singapore',
    'Hawaiian Standard Time': 'Pacific/Honolulu',
    'Korea Standard Time': 'Asia/Seoul',
    'India Standard Time': 'Asia/Kolkata',
    'Australia Eastern Standard Time': 'Australia/Sydney'
};


/**
 * Main function to sync ICS file from Google Drive to Google Calendar.
 *
 * Uses composite recurrenceKey-based matching to correctly handle:
 *   - New events (create)
 *   - Updated events — content or time changes (update in-place)
 *   - Removed events — no longer in ICS file (delete from calendar)
 *   - Recurring events — master VEVENTs with RRULE are expanded into
 *     individual occurrence events via expandRecurringEvents()
 *   - Recurring event exceptions — VEVENTs sharing the same UID but
 *     distinguished by RECURRENCE-ID (RFC 5545 Section 3.8.4.4)
 *   - Excluded dates — EXDATE entries are skipped during expansion
 *
 * The recurrenceKey is:
 *   - UID alone for standalone (non-recurring) events
 *   - UID + "|" + occurrence-date for recurring instances (both RRULE-
 *     expanded and exception VEVENTs with RECURRENCE-ID)
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

        // Expand master recurring events (RRULE) into individual occurrences.
        // After this call every recurring series is represented as discrete
        // events, each with a recurrenceKey of UID|occurrence-date.
        icsEvents = expandRecurringEvents(icsEvents);
        if (icsEvents.length === 0) {
            Logger.log('No events after recurring event expansion');
            return;
        }

        // Build a map of recurrenceKey → event for O(1) lookups.
        // recurrenceKey is UID for standalone events, or
        // UID|occurrence-date for recurring instances (both expanded
        // and exception VEVENTs).
        var icsMap = {};
        for (var i = 0; i < icsEvents.length; i++) {
            if (icsEvents[i].recurrenceKey) {
                icsMap[icsEvents[i].recurrenceKey] = icsEvents[i];
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
        var calMap = {};  // recurrenceKey → CalendarEvent
        var ourEventCount = 0;

        for (var k = 0; k < existingEvents.length; k++) {
            var calEvent = existingEvents[k];
            var sourceTag = calEvent.getTag(SOURCE_PROPERTY_KEY);
            if (sourceTag === SOURCE_PROPERTY_VALUE) {
                var recKey = calEvent.getTag(ICS_UID_TAG_KEY);
                if (recKey) {
                    calMap[recKey] = calEvent;
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

        var mutationCount = 0;  // Track total mutations for throttling

        var icsKeys = Object.keys(icsMap);
        for (var m = 0; m < icsKeys.length; m++) {
            var icsKey = icsKeys[m];
            var icsEvent = icsMap[icsKey];

            try {
                if (calMap[icsKey]) {
                    // Event exists on calendar — check if it needs updating
                    var calendarEvent = calMap[icsKey];

                    if (!eventsEqual(icsEvent, calendarEvent)) {
                        if (DRY_RUN) {
                            Logger.log('[DRY RUN] UPDATE: "' + icsEvent.summary + '" (key: ' + icsKey + ')');
                        } else {
                            calendarEvent.setTitle(icsEvent.summary || 'Untitled Event');
                            calendarEvent.setTime(icsEvent.start, icsEvent.end);
                            calendarEvent.setDescription(icsEvent.description || '');
                            calendarEvent.setLocation(icsEvent.location || '');
                            mutationCount = throttleAfterMutation_(mutationCount);
                        }
                        updatedCount++;
                    } else {
                        unchangedCount++;
                    }

                    // Remove from calMap so remaining entries are orphans
                    delete calMap[icsKey];

                } else {
                    // New event — create it
                    if (DRY_RUN) {
                        Logger.log('[DRY RUN] CREATE: "' + icsEvent.summary + '" at ' + icsEvent.start + ' (key: ' + icsKey + ')');
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
                        newEvent.setTag(ICS_UID_TAG_KEY, icsKey);
                        mutationCount = throttleAfterMutation_(mutationCount);
                    }
                    createdCount++;
                }
            } catch (error) {
                Logger.log('Error processing event "' + icsEvent.summary + '": ' + error.toString());
                Logger.log('Sleeping 10s after error before continuing...');
                Utilities.sleep(10000);
                errorCount++;
            }
        }

        // --- 6. Delete orphaned events (on calendar but not in ICS) ---
        var deletedCount = 0;
        var orphanKeys = Object.keys(calMap);
        for (var n = 0; n < orphanKeys.length; n++) {
            var orphanKey = orphanKeys[n];
            var orphanEvent = calMap[orphanKey];
            try {
                if (DRY_RUN) {
                    Logger.log('[DRY RUN] DELETE: "' + orphanEvent.getTitle() + '" at ' + orphanEvent.getStartTime() + ' (key: ' + orphanKey + ')');
                } else {
                    orphanEvent.deleteEvent();
                    mutationCount = throttleAfterMutation_(mutationCount);
                }
                deletedCount++;
            } catch (error) {
                Logger.log('Error deleting orphan event "' + orphanEvent.getTitle() + '": ' + error.toString());
                Logger.log('Sleeping 10s after error before continuing...');
                Utilities.sleep(10000);
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
 * Throttles calendar mutations to avoid Google Calendar rate limits.
 *
 * Sleeps 1 second after every mutation, plus an extra 5 seconds every
 * 20 mutations.  This keeps the script well under the burst threshold
 * that triggers "You have been creating or deleting too many calendars
 * or calendar events in a short time".
 *
 * @param {number} mutationCount - Current count of mutations performed.
 * @return {number} Updated mutation count (incremented by 1).
 */
function throttleAfterMutation_(mutationCount) {
    mutationCount++;
    Utilities.sleep(1000);
    if (mutationCount % 20 === 0) {
        Logger.log('Throttle pause at ' + mutationCount + ' mutations...');
        Utilities.sleep(5000);
    }
    return mutationCount;
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
 * Handles multi-line folding (RFC 5545 Section 3.1), text unescaping
 * (Section 3.3.11), RECURRENCE-ID (Section 3.8.4.4) for recurring
 * event exception instances, and RRULE / EXDATE for recurrence expansion.
 *
 * Each returned event includes a recurrenceKey field used as the unique
 * identifier for syncing:
 *   - UID alone for standalone/parent events
 *   - UID + "|" + RECURRENCE-ID value for recurrence exceptions
 *
 * Master recurring events (those with RRULE) are returned with the rrule,
 * exdates, dtStartRaw, and dtStartProperty fields populated so that
 * expandRecurringEvents() can expand them into individual occurrences.
 *
 * @param {string} icsContent - The raw ICS file content.
 * @return {Array<Object>} Array of event objects with summary, description,
 *     location, start, end, uid, recurrenceId, recurrenceKey, rrule,
 *     exdates, dtStartRaw, and dtStartProperty fields.
 */
function parseICSContent(icsContent) {
    var events = [];
    var LF = String.fromCharCode(10);
    var CR = String.fromCharCode(13);
    var lines = icsContent.split(CR + LF).join(LF).split(LF);

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
                uid: '',
                recurrenceId: '',
                recurrenceKey: '',
                rrule: '',
                exdates: [],
                dtStartRaw: '',
                dtStartProperty: ''
            };
            continue;
        }

        // End of an event
        if (line === 'END:VEVENT') {
            if (currentEvent && currentEvent.start && currentEvent.end) {
                // Build composite key: UID alone for standalone/parent events,
                // UID|RECURRENCE-ID for recurrence exception instances.
                // RECURRENCE-ID is the original occurrence date (RFC 5545 Section
                // 3.8.4.4) and stays stable even when the instance is rescheduled.
                currentEvent.recurrenceKey = currentEvent.recurrenceId
                    ? currentEvent.uid + '|' + currentEvent.recurrenceId
                    : currentEvent.uid;
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
                        currentEvent.dtStartRaw = value;
                        currentEvent.dtStartProperty = property;
                        break;
                    case 'DTEND':
                        currentEvent.end = parseICSDate(value, property);
                        break;
                    case 'UID':
                        currentEvent.uid = value;
                        break;
                    case 'RECURRENCE-ID':
                        // Store the raw date-time value (e.g. "20260126T160500")
                        // for use as part of the composite recurrenceKey.
                        currentEvent.recurrenceId = value;
                        break;
                    case 'RRULE':
                        currentEvent.rrule = value;
                        break;
                    case 'EXDATE':
                        // EXDATE values are comma-separated date-time strings.
                        // Multiple EXDATE lines may appear; append to the array.
                        var exVals = value.split(',');
                        for (var exIdx = 0; exIdx < exVals.length; exIdx++) {
                            var exVal = exVals[exIdx].trim();
                            if (exVal) {
                                currentEvent.exdates.push(exVal);
                            }
                        }
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

    // 1. Handle UTC (Z suffix)
    if (dateString.endsWith('Z')) {
        var year = parseInt(dateString.substring(0, 4));
        var month = parseInt(dateString.substring(4, 6)) - 1;
        var day = parseInt(dateString.substring(6, 8));
        var hour = parseInt(dateString.substring(9, 11));
        var minute = parseInt(dateString.substring(11, 13));
        var second = parseInt(dateString.substring(13, 15));
        // Create date as UTC
        return new Date(Date.UTC(year, month, day, hour, minute, second));
    }

    // 2. Handle Named Timezone (TZID parameter)
    // Extract TZID if present (e.g. DTSTART;TZID=America/Los_Angeles:...)
    var tzidMatch = property && property.match(/TZID=([^:;]+)/);
    if (tzidMatch && !isDateOnly) {
        var tzid = tzidMatch[1];
        var year = dateString.substring(0, 4);
        var month = dateString.substring(4, 6);
        var day = dateString.substring(6, 8);
        var hour = dateString.substring(9, 11);
        var minute = dateString.substring(11, 13);
        var second = dateString.substring(13, 15);

        // Format as ISO-like string for Utilities.parseDate
        // parseDate formats: https://docs.oracle.com/javase/7/docs/api/java/text/SimpleDateFormat.html
        var dateStr = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second;

        // Map generic/Windows timezone to IANA if possible
        if (TIMEZONE_MAP[tzid]) {
            tzid = TIMEZONE_MAP[tzid];
        }

        try {
            // Parses "date in TZID" -> "Date object (script timezone)"
            // Fallback to mock for local testing if Utilities.parseDate is missing/proxied
            if (typeof Utilities !== 'undefined' && Utilities.parseDate) {
                return Utilities.parseDate(dateStr, tzid, "yyyy-MM-dd'T'HH:mm:ss");
            } else if (typeof Utilities_parseDate_Mock !== 'undefined') {
                return Utilities_parseDate_Mock(dateStr, tzid, "yyyy-MM-dd'T'HH:mm:ss");
            } else {
                throw new Error('Utilities.parseDate not available');
            }
        } catch (e) {
            Logger.log('Error parsing timezone ' + tzid + ': ' + e.toString() + '. Falling back to local.');
        }
    }

    // 3. Fallback: Floating / Local Time (or Date Only)
    var year, month, day, hour = 0, minute = 0, second = 0;

    if (isDateOnly || dateString.length === 8) {
        // Date only: YYYYMMDD
        year = parseInt(dateString.substring(0, 4));
        month = parseInt(dateString.substring(4, 6)) - 1;
        day = parseInt(dateString.substring(6, 8));
    } else if (dateString.length >= 15) {
        // Date and time: YYYYMMDDTHHMMSS (floating)
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


// ==========================================================================
// RRULE Expansion – turns master recurring VEVENTs into individual events
// ==========================================================================

/**
 * Pads a number with a leading zero if it is less than 10.
 *
 * @param {number} num - The number to pad.
 * @return {string} Zero-padded two-character string representation.
 */
function padZero_(num) {
    return num < 10 ? '0' + num : '' + num;
}


/**
 * Formats a JavaScript Date as an ICS-style date string (YYYYMMDD).
 *
 * Uses the Date's local (script-timezone) year, month, and day values
 * so that the output matches the wall-clock representation used by
 * DTSTART and RECURRENCE-ID in the ICS file.
 *
 * @param {Date} date - The date to format.
 * @return {string} Formatted date string in YYYYMMDD format.
 */
function formatICSDateStr_(date) {
    return '' + date.getFullYear() +
        padZero_(date.getMonth() + 1) +
        padZero_(date.getDate());
}


/**
 * Parses an RRULE value string into a structured object.
 *
 * Supports the following RRULE components (RFC 5545 Section 3.3.10):
 *   - FREQ:     WEEKLY or MONTHLY
 *   - INTERVAL: repeat interval (default 1)
 *   - UNTIL:    end date (parsed into a JavaScript Date)
 *   - BYDAY:    day-of-week specifiers, e.g. "TU", "MO,TU,TH",
 *               "1TU" (first Tuesday), "-1TH" (last Thursday)
 *   - WKST:     week-start day (default SU)
 *
 * @param {string} rruleStr - The RRULE value (without the "RRULE:" prefix).
 * @return {Object} Parsed rule with freq, interval, until, byDay, and
 *     wkst fields.
 */
function parseRRule_(rruleStr) {
    var parts = rruleStr.split(';');
    var rule = {
        freq: '',
        interval: 1,
        until: null,
        byDay: [],
        wkst: 'SU'
    };
    for (var i = 0; i < parts.length; i++) {
        var eqIndex = parts[i].indexOf('=');
        if (eqIndex < 0) { continue; }
        var key = parts[i].substring(0, eqIndex);
        var val = parts[i].substring(eqIndex + 1);
        switch (key) {
            case 'FREQ':
                rule.freq = val;
                break;
            case 'INTERVAL':
                rule.interval = parseInt(val, 10);
                break;
            case 'UNTIL':
                rule.until = parseICSDate(val, '');
                break;
            case 'BYDAY':
                rule.byDay = val.split(',');
                break;
            case 'WKST':
                rule.wkst = val;
                break;
        }
    }
    return rule;
}


/**
 * Finds the Nth (or last) occurrence of a weekday in a given month.
 *
 * Examples:
 *   getNthWeekdayOfMonth_(2025, 0, 2, 1)  → first Tuesday of Jan 2025
 *   getNthWeekdayOfMonth_(2025, 0, 4, -1) → last Thursday of Jan 2025
 *
 * @param {number} year    - Full year (e.g. 2025).
 * @param {number} month   - Zero-based month (0 = January, 11 = December).
 * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
 * @param {number} n       - Occurrence number: positive from the start
 *     (1 = first, 2 = second …), or -1 for the last occurrence.
 * @return {number|null} Day of the month (1-based), or null if the
 *     requested occurrence does not exist in the given month.
 */
function getNthWeekdayOfMonth_(year, month, weekday, n) {
    if (n > 0) {
        // Nth occurrence from the start of the month
        var firstDay = new Date(year, month, 1);
        var firstDow = firstDay.getDay();
        var daysUntilFirst = (weekday - firstDow + 7) % 7;
        var nthDay = 1 + daysUntilFirst + (n - 1) * 7;
        // Verify the result is still within the same month
        var check = new Date(year, month, nthDay);
        if (check.getMonth() !== month) { return null; }
        return nthDay;
    } else if (n === -1) {
        // Last occurrence — work backwards from month end
        var lastDay = new Date(year, month + 1, 0);
        var lastDom = lastDay.getDate();
        var lastDow = lastDay.getDay();
        var daysBack = (lastDow - weekday + 7) % 7;
        return lastDom - daysBack;
    }
    return null;
}


/**
 * Expands an RRULE into individual occurrence date-time strings.
 *
 * Generates every occurrence from DTSTART through UNTIL according to the
 * recurrence rule.  Each occurrence is returned as a raw ICS date-time
 * string (YYYYMMDDTHHMMSS) in the same timezone as DTSTART, matching the
 * format used by RECURRENCE-ID for exception instances.
 *
 * Supported rules:
 *   - FREQ=WEEKLY  — single or multiple BYDAY values, with INTERVAL
 *   - FREQ=MONTHLY — BYDAY with Nth-weekday (e.g. 1TU, -1TH), with INTERVAL
 *
 * @param {Object} masterEvent - The master recurring VEVENT, with fields:
 *     rrule, dtStartRaw, dtStartProperty, start, end.
 * @return {Array<Object>} Array of occurrence objects, each with:
 *     dateStr (string), start (Date), end (Date).
 */
function expandRRule_(masterEvent) {
    var DAY_MAP = { 'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6 };
    var rule = parseRRule_(masterEvent.rrule);
    var occurrences = [];

    if (!rule.freq || !rule.until) {
        Logger.log('Warning: RRULE missing FREQ or UNTIL, skipping expansion for UID: ' + masterEvent.uid);
        return occurrences;
    }

    // Extract date and time portions from DTSTART raw value
    // e.g. "20250218T150500" → datePart="20250218", timePart="T150500"
    var dtStartRaw = masterEvent.dtStartRaw;
    var tIndex = dtStartRaw.indexOf('T');
    var timePart = tIndex >= 0 ? dtStartRaw.substring(tIndex) : '';
    var datePart = tIndex >= 0 ? dtStartRaw.substring(0, tIndex) : dtStartRaw;

    // Parse start-date components (wall-clock / local time)
    var startYear  = parseInt(datePart.substring(0, 4), 10);
    var startMonth = parseInt(datePart.substring(4, 6), 10) - 1; // 0-based
    var startDay   = parseInt(datePart.substring(6, 8), 10);
    var startDate  = new Date(startYear, startMonth, startDay);

    // Event duration in milliseconds (constant across occurrences)
    var duration = masterEvent.end.getTime() - masterEvent.start.getTime();

    // Safety cap to avoid runaway loops
    var MAX_OCCURRENCES = 520;

    // ------------------------------------------------------------------
    // WEEKLY expansion
    // ------------------------------------------------------------------
    if (rule.freq === 'WEEKLY') {
        // Resolve target days-of-week
        var targetDays = [];
        for (var i = 0; i < rule.byDay.length; i++) {
            var dayCode = rule.byDay[i].replace(/^[+-]?\d+/, ''); // strip ordinal prefix
            if (DAY_MAP[dayCode] !== undefined) {
                targetDays.push(DAY_MAP[dayCode]);
            }
        }
        if (targetDays.length === 0) {
            targetDays.push(startDate.getDay());
        }
        targetDays.sort(function (a, b) { return a - b; });

        // Week-start day of week (from WKST, default SU = 0)
        var wkstDow = DAY_MAP[rule.wkst] !== undefined ? DAY_MAP[rule.wkst] : 0;

        // Align to the start of DTSTART's week (based on WKST)
        var daysToWeekStart = (startDate.getDay() - wkstDow + 7) % 7;
        var weekStart = new Date(startYear, startMonth, startDay - daysToWeekStart);

        var safetyCounter = 0;
        while (safetyCounter < MAX_OCCURRENCES) {
            for (var d = 0; d < targetDays.length; d++) {
                var targetDow = targetDays[d];
                var daysFromWkStart = (targetDow - wkstDow + 7) % 7;
                var occDate = new Date(
                    weekStart.getFullYear(), weekStart.getMonth(),
                    weekStart.getDate() + daysFromWkStart
                );

                // Skip dates before the series start
                if (occDate < startDate) { continue; }

                // Build ICS date-time string for this occurrence
                var occDateStr = formatICSDateStr_(occDate) + timePart;

                // Convert to a real Date via the same timezone as DTSTART
                var occStart = parseICSDate(occDateStr, masterEvent.dtStartProperty);

                // Stop if past UNTIL
                if (occStart > rule.until) { return occurrences; }

                occurrences.push({
                    dateStr: occDateStr,
                    start: occStart,
                    end: new Date(occStart.getTime() + duration)
                });

                if (occurrences.length >= MAX_OCCURRENCES) { return occurrences; }
            }

            // Advance to the next active week
            weekStart = new Date(
                weekStart.getFullYear(), weekStart.getMonth(),
                weekStart.getDate() + 7 * rule.interval
            );
            safetyCounter++;
        }

    // ------------------------------------------------------------------
    // MONTHLY expansion
    // ------------------------------------------------------------------
    } else if (rule.freq === 'MONTHLY') {
        if (rule.byDay.length === 0) {
            Logger.log('Warning: MONTHLY RRULE without BYDAY, skipping for UID: ' + masterEvent.uid);
            return occurrences;
        }

        // Parse ordinal + day code, e.g. "1TU" → nth=1, dayCode="TU"
        var byDayStr = rule.byDay[0];
        var nthMatch = byDayStr.match(/^([+-]?\d+)(\w{2})$/);
        if (!nthMatch) {
            Logger.log('Warning: Cannot parse MONTHLY BYDAY "' + byDayStr + '", skipping for UID: ' + masterEvent.uid);
            return occurrences;
        }
        var nth = parseInt(nthMatch[1], 10);
        var mDayCode = nthMatch[2];
        var targetWeekday = DAY_MAP[mDayCode];
        if (targetWeekday === undefined) {
            Logger.log('Warning: Unknown day code "' + mDayCode + '", skipping for UID: ' + masterEvent.uid);
            return occurrences;
        }

        // Iterate month-by-month
        var curYear = startYear;
        var curMonth = startMonth;
        for (var m = 0; m < MAX_OCCURRENCES; m++) {
            var dayOfMonth = getNthWeekdayOfMonth_(curYear, curMonth, targetWeekday, nth);
            if (dayOfMonth !== null) {
                var occDate = new Date(curYear, curMonth, dayOfMonth);
                if (occDate >= startDate) {
                    var occDateStr = formatICSDateStr_(occDate) + timePart;
                    var occStart = parseICSDate(occDateStr, masterEvent.dtStartProperty);

                    if (occStart > rule.until) { return occurrences; }

                    occurrences.push({
                        dateStr: occDateStr,
                        start: occStart,
                        end: new Date(occStart.getTime() + duration)
                    });

                    if (occurrences.length >= MAX_OCCURRENCES) { return occurrences; }
                }
            }

            // Advance by INTERVAL months
            curMonth += rule.interval;
            while (curMonth > 11) {
                curMonth -= 12;
                curYear++;
            }
        }

    } else {
        Logger.log('Warning: Unsupported RRULE FREQ "' + rule.freq + '", skipping for UID: ' + masterEvent.uid);
    }

    return occurrences;
}


/**
 * Expands master recurring events into individual occurrence events.
 *
 * Post-processes the array of parsed VEVENTs to:
 *   1. Identify master events (have RRULE, no RECURRENCE-ID)
 *   2. Expand each master's RRULE into individual occurrence events
 *   3. Skip occurrences whose date appears in EXDATE (excluded dates)
 *   4. Skip occurrences covered by exception VEVENTs (RECURRENCE-ID match)
 *   5. Copy the master's summary, description, and location to each
 *      expanded occurrence
 *
 * Each expanded occurrence receives a recurrenceKey of UID + "|" +
 * occurrence-date-string, which matches the format used by exception
 * instances.  This allows the sync logic to seamlessly create, update,
 * or delete individual occurrences on subsequent runs.
 *
 * If an RRULE cannot be expanded (unsupported FREQ, missing UNTIL, etc.),
 * the master event is kept as a standalone event so it does not disappear.
 *
 * @param {Array<Object>} events - Array of parsed event objects from
 *     parseICSContent.
 * @return {Array<Object>} Flat array of events with masters replaced by
 *     their expanded occurrences.  Exception and standalone events are
 *     preserved unchanged.
 */
function expandRecurringEvents(events) {
    // --- Categorize events ---
    var masters = [];
    var exceptions = [];
    var standalone = [];

    for (var i = 0; i < events.length; i++) {
        var evt = events[i];
        if (evt.rrule && !evt.recurrenceId) {
            masters.push(evt);
        } else if (evt.recurrenceId) {
            exceptions.push(evt);
        } else {
            standalone.push(evt);
        }
    }

    Logger.log('Recurring event breakdown: ' + masters.length + ' masters, ' +
        exceptions.length + ' exceptions, ' + standalone.length + ' standalone');

    // --- Build UID → { recurrenceId: true } map for quick exception lookup ---
    var exceptionsByUid = {};
    for (var j = 0; j < exceptions.length; j++) {
        var excEvt = exceptions[j];
        if (!exceptionsByUid[excEvt.uid]) {
            exceptionsByUid[excEvt.uid] = {};
        }
        exceptionsByUid[excEvt.uid][excEvt.recurrenceId] = true;
    }

    // --- Expand each master ---
    var expandedEvents = [];
    for (var k = 0; k < masters.length; k++) {
        var master = masters[k];

        // EXDATE set for O(1) lookup
        var exdateSet = {};
        for (var ed = 0; ed < master.exdates.length; ed++) {
            exdateSet[master.exdates[ed]] = true;
        }

        // Exception dates for this UID
        var excDates = exceptionsByUid[master.uid] || {};

        // Expand the RRULE into individual occurrences
        var occurrences = expandRRule_(master);

        // If expansion failed, keep the master as a standalone event
        if (occurrences.length === 0) {
            Logger.log('Warning: Could not expand RRULE for "' + master.summary +
                '", keeping as standalone');
            standalone.push(master);
            continue;
        }

        var skippedExdate = 0;
        var skippedException = 0;

        for (var oc = 0; oc < occurrences.length; oc++) {
            var occ = occurrences[oc];

            // Skip if excluded by EXDATE
            if (exdateSet[occ.dateStr]) {
                skippedExdate++;
                continue;
            }

            // Skip if an exception VEVENT overrides this occurrence
            if (excDates[occ.dateStr]) {
                skippedException++;
                continue;
            }

            // Create an expanded event with the master's content
            expandedEvents.push({
                summary: master.summary,
                description: master.description,
                location: master.location,
                start: occ.start,
                end: occ.end,
                uid: master.uid,
                recurrenceId: occ.dateStr,
                recurrenceKey: master.uid + '|' + occ.dateStr,
                rrule: '',
                exdates: [],
                dtStartRaw: '',
                dtStartProperty: ''
            });
        }

        var created = occurrences.length - skippedExdate - skippedException;
        Logger.log('Expanded "' + master.summary + '": ' +
            occurrences.length + ' total, ' +
            skippedExdate + ' exdate-excluded, ' +
            skippedException + ' exception-covered, ' +
            created + ' new occurrences');
    }

    // --- Combine all events ---
    var result = standalone.concat(exceptions).concat(expandedEvents);
    Logger.log('After expansion: ' + result.length + ' total events (' +
        expandedEvents.length + ' from RRULE expansion)');

    return result;
}
