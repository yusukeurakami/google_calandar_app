/**
 * Debug script to inspect the production ICS file format and parsing.
 * checks for TZID formats and parse results.
 */

// Override config to point to production
GDRIVE_FOLDER_ID = '1zHbHUBl1O4rhgD9kh6q2rrhF9XzZSlN2';
ICS_FILE_NAME = 'latest_cal.ics';

function debugICS() {
    Logger.log('Fetching ' + ICS_FILE_NAME + ' from folder ' + GDRIVE_FOLDER_ID);

    var content = getICSFileFromDrive();
    // var content = file.getBlob().getDataAsString();

    Logger.log('File size: ' + content.length);

    // Extract first few VEVENTs to inspect DTSTART/DTEND lines
    var lines = content.split(new RegExp('\\r\\n|\\n|\\r'));
    var eventsCount = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        if (line.startsWith('BEGIN:VEVENT')) {
            eventsCount++;
            if (eventsCount > 5) break; // Check first 5 events
            Logger.log('--- Event ' + eventsCount + ' ---');
        }

        if (line.startsWith('DTSTART') || line.startsWith('DTEND') || line.startsWith('SUMMARY') || line.startsWith('TZID')) {
            // Unfold next line if it starts with space (ICS folding)
            var fullLine = line;
            if (i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
                fullLine += lines[i + 1].substring(1);
            }

            Logger.log('Raw Line: ' + fullLine);

            if (line.startsWith('DTSTART')) {
                // Test parsing
                var parts = fullLine.split(':');
                var prop = parts[0];
                var val = parts[1];

                // Mock property arg for parseICSDate (which expects the full line usually?
                // No, current parseICSDate takes (dateString, propertyString)
                // wait, parseICSDate(dateString, property)
                // usage in import_calendar.js: parseICSDate(value, key)

                var parsed = parseICSDate(val, prop);
                Logger.log('Parsed: ' + parsed.toString());
                Logger.log('Parsed ISO: ' + parsed.toISOString());
            }
        }
    }
}

// Reuse logic from import_calendar.js by concatenation in run_test.sh
