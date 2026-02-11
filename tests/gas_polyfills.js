/**
 * @fileoverview Polyfills for gas-fakes to support Utilities.
 *
 * gas-fakes doesn't implement all Utilities methods. This provides
 * mocks/polyfills for testing purposes.
 */

// We cannot assign to Utilities.parseDate directly in gas-fakes because
// Utilities is a proxy that disallows setting properties.
// So we define a global mock that import_calendar.js can fall back to.

/**
 * Mocks Utilities.parseDate for specific test cases.
 *
 * CAUTION: This is NOT a full timezone parser. It only handles
 * timezones used in test_data.ics for verification.
 */
var Utilities_parseDate_Mock = function (dateStr, timeZone, format) {
    // dateStr is formatted as "yyyy-MM-dd'T'HH:mm:ss" by import_calendar.js
    // e.g. "2026-03-12T09:00:00"

    var parts = dateStr.match(new RegExp('(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})'));
    if (!parts) return new Date();

    var year = parseInt(parts[1]);
    var month = parseInt(parts[2]) - 1;
    var day = parseInt(parts[3]);
    var hour = parseInt(parts[4]);
    var minute = parseInt(parts[5]);
    var second = parseInt(parts[6]);

    // Create a base date (treated as if it were UTC to modify it easily)
    var date = new Date(Date.UTC(year, month, day, hour, minute, second));

    // Apply offset based on timeZone
    if (timeZone === 'America/Los_Angeles') {
        // America/Los_Angeles in March 2026 is PDT (UTC-7)
        // We want to return a UTC Date object that corresponds to 09:00 PDT
        // 09:00 PDT = 16:00 UTC

        // This Date object, when printed in JST environment (UTC+9),
        // will show as 01:00 JST next day. Which is correct.

        return new Date(Date.UTC(year, month, day, hour + 7, minute, second));
    }

    // Fallback for unknown zones (treat as UTC/Local)
    return new Date(Date.UTC(year, month, day, hour, minute, second));
};
