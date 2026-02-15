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
 * Mocks Utilities.parseDate using Node's Intl API for correct timezone
 * conversion.
 *
 * Given a date-time string and an IANA timezone, returns a Date object
 * representing that wall-clock time in the specified timezone.
 *
 * @param {string} dateStr - Date string in "yyyy-MM-dd'T'HH:mm:ss" format.
 * @param {string} timeZone - IANA timezone identifier (e.g. "Asia/Tokyo").
 * @param {string} format - SimpleDateFormat pattern (ignored; we always
 *     expect the ISO-like format from import_calendar.js).
 * @return {Date} JavaScript Date representing the specified time.
 */
var Utilities_parseDate_Mock = function (dateStr, timeZone, format) {
    var parts = dateStr.match(
        new RegExp('(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})')
    );
    if (!parts) { return new Date(); }

    var year   = parseInt(parts[1], 10);
    var month  = parseInt(parts[2], 10) - 1; // 0-based
    var day    = parseInt(parts[3], 10);
    var hour   = parseInt(parts[4], 10);
    var minute = parseInt(parts[5], 10);
    var second = parseInt(parts[6], 10);

    // Treat the input components as if they were UTC, then use Intl to
    // find the timezone offset at that moment.
    var utcMs = Date.UTC(year, month, day, hour, minute, second);

    var formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });

    // Format utcMs in the target timezone to discover the offset.
    var fp = formatter.formatToParts(new Date(utcMs));
    var tz = {};
    for (var i = 0; i < fp.length; i++) {
        tz[fp[i].type] = parseInt(fp[i].value, 10);
    }

    // offset = (value displayed in tz) − (the actual UTC we fed in)
    var tzMs = Date.UTC(tz.year, tz.month - 1, tz.day, tz.hour, tz.minute, tz.second);
    var offsetMs = tzMs - utcMs;

    // The input says "these components are in <timeZone>".
    // So the real UTC instant = inputAsUTC − offset.
    return new Date(utcMs - offsetMs);
};
